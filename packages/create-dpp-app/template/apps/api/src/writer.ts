// The writer: every state goes through the six steps of spec/writing.md in
// order. Build it unsent; check it with the reader's own rules; announce it
// to the index and send only on admission; send, and report only the
// network's answer; push the proof once the wallet has it; keep everything.
// The journal entry is written before each step is acted on, so a retry
// continues an operation and never builds a second transaction.
//
// Under managed custody the platform wallet is publisher and holds the lock;
// the acting party (a brand, a holder) signs as actor from a key the
// platform derives for it, and the controller key in field 6 is that
// party's per-passport key.
import { MerklePath, Transaction, Utils, type WalletProtocol } from '@bsv/sdk'
import {
  acceptanceCommitment,
  bindAcceptanceToState,
  buildLockingScript,
  completeState,
  findDppOutputs,
  ownerBlobHash,
  ownerKeyFor,
  verifyChain,
  verifyOwnerBlob,
  type DppStateDataV2,
  type DppStateV2,
  type ManagedAcceptanceRecord,
} from '@bsv/dpp-protocol'
import { PROFILE_RETIRED, RETIRED_PROFILE_REPLACEMENTS, describeRetiredProfile, isRetiredProfile, type BindingProfile, type BindingValidationDetail, type PayloadValidation } from '@bsv/dpp-profiles'
import type { BoundProfiles, ViewCheck } from './bound-profiles.js'
import { identifierProblems, isDemonstrationPolicy, type IdentifierPolicy } from './identifiers.js'
import type { IndexClient } from './index-client.js'
import type { Party } from './parties.js'
import { DEMONSTRATION_NOTICE, isProfileId, sectorIssueSuccessor, validatePayload, type ManifestProfileId } from './profiles.js'
import { isInterrupted, type PassportRecord, type StateEntry, type Store } from './store.js'
import { ActionAlreadySeen, type PlatformWallet, type Tip } from './wallet.js'

/** BRC-43 protocol the owner tier is encrypted under (spec/record-model.md section 7). */
export const OWNER_DATA_PROTOCOL: WalletProtocol = [2, 'dpp owner data v1']

export class WriteRefused extends Error {
  constructor(
    readonly code: string,
    detail: string,
    /** What the API adds to its answer beside the code and the sentence: for a product document that was refused, the validation with its findings. It goes to the caller that sent the document and is never logged. */
    readonly data?: Record<string, unknown>
  ) {
    super(detail)
  }
}

/**
 * Refuse a write under a retired profile, by the one code every such
 * refusal carries. It covers a new payload and equally a state that would
 * carry an old payload forward, since that state would declare the retired
 * profile too. Called before anything is derived, signed or asked of the
 * index.
 */
export function refuseRetiredProfile(profile: string): void {
  if (isRetiredProfile(profile)) throw new WriteRefused(PROFILE_RETIRED, `${describeRetiredProfile(profile)} Nothing was signed.`, { replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile] })
}

export function requireIssuableProfile(profile: string): void {
  if (isRetiredProfile(profile)) {
    const historical = RETIRED_PROFILE_REPLACEMENTS[profile]
    const replacedBy = sectorIssueSuccessor(historical) ?? historical
    throw new WriteRefused(PROFILE_RETIRED, `${describeRetiredProfile(profile)} Use ${replacedBy} for new issuance. Nothing was signed.`, { replacedBy })
  }
  const replacedBy = sectorIssueSuccessor(profile)
  if (replacedBy != null) throw new WriteRefused('profile-superseded', `Use ${replacedBy} to issue a new passport. Existing ${profile} passports keep their original binding.`, { replacedBy })
}

type SealedTier = { hash: string; ciphertext: number[]; senderIdentityKey?: string }

export interface WriterOptions {
  store: Store
  wallet: PlatformWallet
  index: IndexClient
  identifiers: IdentifierPolicy
  /** The profiles held by a binding, with the validation engine. */
  bound: BoundProfiles
  /** Whether writes may reach the chain. False builds, checks and journals a state and then stops before the send. */
  livePublishing: boolean
  spendCapSatoshis: number
  log?: (line: string) => void
}

export interface WriteOutcome {
  entry: StateEntry
  state: DppStateV2
  record: PassportRecord
}

/** The precise cause a binding validation names, or a word for an answer that names none. */
const causeOf = (validation: PayloadValidation): string =>
  typeof validation.detail === 'object' && validation.detail != null && !Array.isArray(validation.detail) ? ((validation.detail as BindingValidationDetail).cause ?? validation.status) : validation.status

const instant = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const short = (hex: string): string => `${hex.slice(0, 12)}...`

function journalTip(record: PassportRecord | undefined, txid: string): StateEntry {
  const tip = record?.states.at(-1)
  if (tip?.txid !== txid) throw new WriteRefused('tip-moved', 'the journal tip changed before this operation could finish')
  return tip
}

export class Writer {
  private readonly log: (line: string) => void

  constructor(private readonly options: WriterOptions) {
    this.log = options.log ?? (() => {})
  }

  /** The platform wallet's lock key for a passport: its own per-passport key, which only it can open. */
  private lockKey(passportId: string): Promise<string> {
    return ownerKeyFor(passportId, this.options.wallet.publisher)
  }

  /** The tip from the journal's BEEF, which carries its ancestry and, once proven, its merkle path. */
  private tipOf(record: PassportRecord): Tip | undefined {
    const last = record.states.at(-1)
    if (last == null) return undefined
    const beef = Utils.toArray(last.beef, 'base64') as number[]
    return { tx: Transaction.fromAtomicBEEF(beef), txid: last.txid, outputIndex: last.outputIndex, beef }
  }

  /** The owner tier of a manifest profile: checked against the profile's restricted schema, then sealed. */
  private async sealOwnerTier(controller: Party, passportId: string, profile: ManifestProfileId, fields: Record<string, unknown>): Promise<{ hash: string; ciphertext: number[] }> {
    const check = validatePayload(profile, 'restricted', fields)
    if (!check.valid) throw new WriteRefused('owner-tier-invalid', `the owner tier is refused by the restricted schema of ${profile}: ${check.problems.join('; ')}`)
    return await this.seal(controller, passportId, fields)
  }

  /**
   * One owner tier, sealed: encrypted to the controller's own key for this
   * passport and committed to by the hash of the ciphertext, which is what
   * field 11 carries (spec/record-model.md section 7). Every profile's
   * restricted data goes through here, whatever checked it first.
   */
  private async seal(controller: Party, passportId: string, fields: Record<string, unknown>): Promise<{ hash: string; ciphertext: number[] }> {
    const plaintext = Utils.toArray(JSON.stringify(fields), 'utf8') as number[]
    const { ciphertext } = await controller.wallet.encrypt({ plaintext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self' })
    const hash = ownerBlobHash(ciphertext)
    if (!verifyOwnerBlob(ciphertext, hash)) throw new WriteRefused('owner-tier-unsound', 'the sealed owner tier does not verify against its hash')
    return { hash, ciphertext }
  }

  /** Resolve carried bytes against the selected predecessor output, including a historical state with no owner commitment. */
  private carriedTier(passportId: string, tip: Tip, entry: StateEntry): SealedTier | undefined {
    const previous = findDppOutputs(tip.tx).find((output) => output.outputIndex === tip.outputIndex)?.state
    if (tip.tx.id('hex') !== tip.txid || previous?.passportId !== passportId) throw new WriteRefused('owner-tier-unsound', 'the retained predecessor differs from the selected passport tip')
    const tier = entry.ownerTier
    if (tier == null && previous.payloadOwnerHash === '') return undefined
    const ciphertext = tier == null ? undefined : Utils.toArray(tier.ciphertext, 'base64')
    if (tier == null || ciphertext == null || tier.hash !== previous.payloadOwnerHash || !verifyOwnerBlob(ciphertext, previous.payloadOwnerHash)) {
      throw new WriteRefused('owner-tier-unsound', 'the retained owner tier does not match the signed predecessor commitment')
    }
    return { ...tier, ciphertext }
  }

  private async transferTier(passportId: string, tier: SealedTier, giver: Party, recipient: Party): Promise<SealedTier> {
    const key = { protocolID: OWNER_DATA_PROTOCOL, keyID: passportId }
    try {
      const { plaintext } = await giver.wallet.decrypt({ ...key, ciphertext: tier.ciphertext, counterparty: tier.senderIdentityKey ?? 'self' })
      const { ciphertext } = await giver.wallet.encrypt({ ...key, plaintext, counterparty: recipient.identityKey })
      return { hash: ownerBlobHash(ciphertext), ciphertext, senderIdentityKey: giver.identityKey }
    } catch {
      throw new WriteRefused('owner-tier-unavailable', 'the holder could not open and re-encrypt the committed owner tier for this recipient')
    }
  }

  private async withinSpendCap(): Promise<void> {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
    const spent = await this.options.store.spentSince(dayAgo)
    if (spent >= this.options.spendCapSatoshis) throw new WriteRefused('spend-cap', `the platform has spent ${spent} satoshis in the last day, at or over SPEND_CAP_SATOSHIS=${this.options.spendCapSatoshis}`)
  }

  /**
   * One state through the six steps. `actor` signs as actor; `controller` is
   * the party whose per-passport key field 6 names after this state (the
   * actor until a hand-on, the recipient on a TRANSFER).
   */
  private async writeState(args: {
    record: PassportRecord
    op: StateEntry['op']
    actor: Party
    controller: Party
    profile: string
    /** A new public payload and owner tier; RETIRE carries the tip's bytes unchanged. TRANSFER re-encrypts the restricted part to the new holder. */
    payload?: Record<string, unknown>
    ownerFields?: Record<string, unknown>
    /** Under a profile held by a binding: the complete product document, in place of `payload` and `ownerFields`. */
    product?: Record<string, unknown>
    eventData?: Record<string, unknown>
    acceptance?: ManagedAcceptanceRecord
  }): Promise<WriteOutcome> {
    const { op, actor, controller, profile } = args
    const { store, wallet, index } = this.options
    const passportId = args.record.passportId
    // The caller may have read the passport before another request advanced it.
    const latest = await store.getPassport(passportId)
    const record = latest ?? args.record
    const unresolved = latest?.states.find(isInterrupted)
    if (unresolved != null) throw new WriteRefused('operation-interrupted', `resolve ${short(unresolved.txid)} before writing another state`)
    if (op !== 'ISSUE' && latest?.states.at(-1)?.txid !== args.record.states.at(-1)?.txid) throw new WriteRefused('tip-moved', 'the requested predecessor is no longer the journal tip')
    // Every operation, RETIRE included: each would sign a state whose payload declares the retired profile.
    refuseRetiredProfile(profile)
    const tip = this.tipOf(record)
    if (op === 'ISSUE' && tip != null) throw new WriteRefused('already-issued', `${passportId} already has ${record.states.length} state(s); a second genesis is never written`)
    if (op !== 'ISSUE' && tip == null) throw new WriteRefused('not-issued', `${passportId} has no genesis to follow`)
    if (record.status === 'retired') throw new WriteRefused('retired', `${passportId} ended with a RETIRE; nothing may follow it`)
    const tipEntry = record.states.at(-1)
    let payloadPublic: string
    let sealed: SealedTier | undefined
    const bound = this.options.bound.get(profile)
    const writesData = args.payload != null || args.product != null
    if (writesData && bound == null && !isProfileId(profile)) throw new WriteRefused('profile-unknown', `${profile} is not a profile this platform holds: it is neither a published industry profile nor a binding registered at start-up`)
    if (writesData && bound != null) {
      if (args.product == null || args.payload != null || args.ownerFields != null) {
        throw new WriteRefused('product-required', `${profile} is held by a binding: send the complete product document as product, and neither payload nor ownerFields. The API splits it into its public and restricted parts.`)
      }
      // The identifier the document is checked against is this state's own, the one written into field 3 and signed below.
      const prepared = await this.prepareBound(bound, args.product, passportId)
      payloadPublic = prepared.payloadPublic
      sealed = await this.seal(controller, passportId, prepared.restrictedProduct ?? {})
    } else if (args.payload != null) {
      if (args.product != null) throw new WriteRefused('payload-required', `${profile} is a manifest profile: send payload and ownerFields, not product`)
      if (!isProfileId(profile)) throw new WriteRefused('profile-unknown', `${profile} is not a profile this platform holds`)
      const demo = isDemonstrationPolicy(this.options.identifiers)
      if (!demo && Object.hasOwn(args.payload, 'notice')) throw new WriteRefused('demonstration-notice-unexpected', 'A real-product record cannot carry a demonstration notice.')
      const { notice = DEMONSTRATION_NOTICE, ...fields } = args.payload
      const payload = demo ? { notice, ...fields } : args.payload
      const publicCheck = validatePayload(profile, 'public', payload)
      if (!publicCheck.valid) throw new WriteRefused('payload-invalid', `the public payload is refused by the ${profile} schema: ${publicCheck.problems.join('; ')}`)
      payloadPublic = JSON.stringify(payload)
      // A new payload with no owner fields carries the tip's sealed tier unchanged, when the actor still controls it.
      sealed =
        args.ownerFields == null && tip != null && tipEntry != null
          ? this.carriedTier(passportId, tip, tipEntry)
          : await this.sealOwnerTier(controller, passportId, profile, args.ownerFields ?? {})
    } else if (args.product != null) {
      throw new WriteRefused('payload-required', `${profile} is a manifest profile: send payload and ownerFields, not product`)
    } else {
      if (tip == null || tipEntry == null) throw new WriteRefused('nothing-to-carry', `${passportId} has no tip whose payload this ${op} could carry`)
      payloadPublic = tipEntry.payloadPublic
      sealed = this.carriedTier(passportId, tip, tipEntry)
    }
    await this.withinSpendCap()

    if (op === 'TRANSFER' && sealed != null) sealed = await this.transferTier(passportId, sealed, actor, controller)

    const previousController = tip == null ? undefined : record.holder.controllerKey
    const controllerKey = await controller.controllerKey(passportId)
    const data: DppStateDataV2 = {
      version: '2',
      op,
      passportId,
      timestamp: instant(),
      ownerIdentityKey: controllerKey,
      actorIdentityKey: actor.identityKey,
      actorKeyId: actor.name,
      eventData: args.eventData == null ? '' : JSON.stringify(args.eventData),
      payloadPublic,
      payloadOwnerHash: sealed?.hash ?? '',
      previousTxid: tip == null ? '' : tip.txid,
      previousOutputIndex: tip == null ? null : tip.outputIndex,
      lineageGenesis: tip == null ? null : { txid: record.states[0].txid, outputIndex: record.states[0].outputIndex },
      // The actor is never the controller key itself, so every later state proves control by linkage from the actor's identity key to the previous field 6.
      controlLinkage: tip == null ? '' : await actor.controlLinkage(passportId),
      authorisationCommitment: args.acceptance == null ? '' : acceptanceCommitment(args.acceptance),
    }
    if (tip != null && previousController != null && (await actor.controllerKey(passportId)) !== previousController) {
      // The holder itself under another key is a deployment that does not hold the secret its keys are derived from, such as one restored without it.
      throw new WriteRefused(
        'not-the-controller',
        actor.name === record.holder.party
          ? `${passportId} is controlled by ${record.holder.party} under the key ${previousController}, and the key this deployment derives for ${actor.name} is another one: it does not hold the secret the passport was written under (BRAND_ROOT_SECRET for a brand, MANAGED_IDENTITY_SECRET for a recipient). Nothing was signed.`
          : `${actor.name} does not control ${passportId}; its controller key is held by ${record.holder.party}`
      )
    }
    const state = (await completeState(data, actor.wallet, wallet.publisher)) as DppStateV2
    const lockingScript = buildLockingScript(state, await this.lockKey(passportId))

    // Section 3: built unsent, complete and signed, spending nothing until it is sent.
    let built
    try {
      built = await wallet.adapter.build({ lockingScript, tip, passportId })
    } catch (cause) {
      throw new WriteRefused('wallet-build-failed', `the wallet could not build the ${op} (${cause instanceof Error ? cause.message : String(cause)}); nothing was sent. An empty wallet needs funding first.`)
    }
    const outputIndex = findDppOutputs(built.tx)[0]?.outputIndex ?? 0
    const entry: StateEntry = {
      op,
      txid: built.txid,
      outputIndex,
      rawTx: built.tx.toHex(),
      beef: Utils.toBase64(built.beef),
      timestamp: data.timestamp,
      actor: actor.name,
      controllerKey,
      payloadPublic: data.payloadPublic,
      ...(sealed == null ? {} : { ownerTier: { ...sealed, ciphertext: Utils.toBase64(sealed.ciphertext) } }),
      index: 'pending',
      network: 'pending',
    }
    entry.nextHolder = { party: controller.name, controllerKey }
    if (args.acceptance != null) entry.acceptance = args.acceptance
    if (built.reference != null) entry.walletReference = built.reference
    const settle = async (patch: Partial<StateEntry>) => {
      const updated = await store.changePassport(passportId, (current) => {
        const draft = journalTip(current, built.txid)
        if (draft.network !== 'pending') throw new WriteRefused('operation-interrupted', 'the draft was already resolved')
        Object.assign(draft, patch)
        return current
      })
      return updated!
    }
    const abandon = async (code: string, detail: string): Promise<never> => {
      const current = await settle({ network: code === 'network-refused' ? 'refused' : 'not-sent' })
      await this.removeDraft(current, built.txid, detail)
      throw new WriteRefused(code, detail)
    }

    try {
      // Verify against the selected predecessor before reserving an unsent draft.
      const lineage = record.states.map((s) => Transaction.fromHex(s.rawTx))
      const checked = await verifyChain([...lineage, built.tx], { chainTracker: 'scripts only', serverIdentityKey: wallet.identityKey, managedAcceptance: true })
      if (!checked.valid) throw new WriteRefused('own-check-refused', `the writer's own check refuses the unsent ${op}: ${checked.error ?? 'no reason given'}`)
      // Under a binding the reader's payload check runs here too, on the state as the unsent transaction carries it:
      // the public payload and the passport identifier are read back from the signed bytes, never from what was prepared.
      if (bound != null && writesData) {
        const signed = findDppOutputs(built.tx)[0]?.state
        const view = signed == null ? undefined : await this.options.bound.validatePublic({ profile: bound.id, profileVersion: bound.version, payloadPublic: signed.payloadPublic, passportId: signed.passportId })
        const cause = view == null ? 'no state was decoded' : causeOf(view)
        if (view == null || view.status === 'fail' || (view.status === 'unknown' && cause !== 'restricted-tier-withheld')) {
          throw new WriteRefused('own-check-refused', `the writer's own check refuses the unsent ${op}: its public payload does not validate under ${profile} for the passport identifier it signs (${cause})`)
        }
      }

      // Section 3: a state after the genesis spends the tip the index returns for the passport.
      if (tip != null) {
        const held = await index.lineage(passportId).catch(() => undefined)
        const heldTip = held?.at(-1)?.id('hex')
        if (held != null && heldTip !== tip.txid) {
          throw new WriteRefused('tip-moved', `the index's tip for ${passportId} is ${heldTip == null ? 'nothing' : short(heldTip)}, not ${short(tip.txid)}`)
        }
      }

      if (args.acceptance != null && bindAcceptanceToState(args.acceptance, state).length !== 0) throw new WriteRefused('acceptance-mismatch', 'the signed acceptance does not bind to the proposed transfer')
      await store.changePassport(passportId, (current) => {
        if (op === 'ISSUE' && current?.states.length) throw new WriteRefused('already-issued', 'another write already reserved this passport')
        const unresolved = current?.states.find(isInterrupted)
        if (unresolved != null) throw new WriteRefused('operation-interrupted', `resolve ${short(unresolved.txid)} before writing another state`)
        if (current?.states.at(-1)?.txid !== tip?.txid || current?.status === 'retired') throw new WriteRefused('tip-moved', 'the journal tip changed while the candidate was prepared')
        const latest = current ?? { ...record, states: [], acceptanceRecords: [] }
        latest.states.push(entry)
        return latest
      })
    } catch (cause) {
      // After a lost acknowledgement the journal can already hold this exact transaction.
      // Discard only a draft that no persisted writer owns.
      const held = await store.getPassport(passportId)
      if (!held?.states.some((item) => item.txid === built.txid)) await wallet.adapter.discard(built)
      throw cause
    }
    this.log(`${op} ${short(built.txid)} built unsent for ${passportId}`)

    let announced = await index.announce(built.beef)
    await settle({ index: announced, refusal: index.lastRefusal })
    if (announced === 'refused') await abandon('index-refused', `the index refused ${short(built.txid)} while it was still a draft: ${index.lastRefusal ?? 'no reason given'}`)
    if (announced === 'unauthorised') await abandon('index-unauthorised', 'the index wants a submit token, or a different one; nothing was sent')

    if (!this.options.livePublishing && wallet.kind === 'toolbox') {
      await abandon('live-publishing-off', 'LIVE_PUBLISHING is false: the unsent draft was aborted.')
    }

    // Sections 4 and 5: send, and report only the network's answer.
    const sent = await wallet.adapter.send(built).catch(() => 'unanswered' as const)
    if (sent === 'refused') await abandon('network-refused', `the network refused ${short(built.txid)}`)
    if (sent === 'unanswered') {
      await settle({ network: 'unanswered' })
      throw new WriteRefused('network-unanswered', `the network has not answered for ${short(built.txid)}; resolve the retained transaction before writing another state`)
    }
    let updated = await this.finishDraft(passportId, entry, entry.nextHolder!, args.acceptance)
    if (announced === 'unreachable') {
      announced = await index.announce(built.beef).catch(() => 'unreachable' as const)
      updated = await this.recordAnnouncement(passportId, built.txid, announced, index.lastRefusal)
    }
    const written = updated.states.find((item) => item.txid === built.txid)!
    this.log(`${op} ${short(built.txid)} written: index ${written.index}, network ${written.network}`)
    return { entry: written, state, record: updated }
  }

  private async finishDraft(id: string, entry: StateEntry, holder: PassportRecord['holder'], acceptance?: ManagedAcceptanceRecord): Promise<PassportRecord> {
    const accepted = this.options.wallet.kind === 'test' ? 'dry-run' : 'accepted'
    if (entry.network !== 'pending' && entry.network !== 'unanswered') throw new WriteRefused('not-interrupted', 'this draft cannot be marked sent')
    if (holder.controllerKey !== entry.controllerKey) throw new WriteRefused('not-the-controller', 'the retained holder differs from the signed controller')
    // Repeating this accounting after interruption is idempotent by transaction ID.
    await this.options.store.recordSpend({ txid: entry.txid, satoshis: Math.ceil(entry.rawTx.length / 20) + 1, at: entry.timestamp })
    const record = await this.options.store.changePassport(id, (current) => {
      const draft = journalTip(current, entry.txid)
      if (draft.network !== 'pending' && draft.network !== 'unanswered') throw new WriteRefused('not-interrupted', 'this draft cannot be marked sent')
      draft.network = accepted
      current!.holder = holder
      if (draft.op === 'RETIRE') current!.status = 'retired'
      if (acceptance != null && !current!.acceptanceRecords.some((item) => acceptanceCommitment(item) === acceptanceCommitment(acceptance))) current!.acceptanceRecords.push(acceptance)
      delete draft.nextHolder
      delete draft.acceptance
      delete draft.walletReference
      return current
    })
    return record!
  }

  private async removeDraft(record: PassportRecord, txid: string, reason: string): Promise<PassportRecord> {
    const entry = journalTip(record, txid)
    try {
      await this.options.wallet.adapter.discard({ tx: Transaction.fromHex(entry.rawTx), txid, beef: Utils.toArray(entry.sentBeef ?? entry.beef, 'base64') as number[], reference: entry.walletReference })
    } catch (cause) {
      if (cause instanceof ActionAlreadySeen) {
        await this.options.store.changePassport(record.passportId, (latest) => {
          const draft = journalTip(latest, txid)
          if (draft.network === 'not-sent' || draft.network === 'refused') draft.network = 'unanswered'
          return latest
        })
        throw new WriteRefused('network-seen', 'the wallet reports that the transaction was seen; retain it and resolve the network outcome')
      }
      throw cause
    }
    if (entry.index === 'admitted' || entry.index === 'duplicate' || entry.index === 'pending' || entry.index === 'unreachable') {
      const withdrawn = await this.options.index.retract(txid, reason, entry.outputIndex)
      if (!withdrawn.ok && !withdrawn.absent) throw new WriteRefused('retraction-pending', `the draft is retained until the index confirms withdrawal: ${withdrawn.detail}`)
    }
    const remaining = await this.options.store.changePassport(record.passportId, (current) => {
      const draft = journalTip(current, txid)
      if (draft.network !== 'refused' && draft.network !== 'not-sent') throw new WriteRefused('not-interrupted', 'the draft was already resolved')
      current!.states.pop()
      return current!.states.length === 0 ? undefined : current
    })
    return remaining ?? { ...record, states: [] }
  }

  /** Resolve the retained transaction once its fate is known. */
  async resolveInterrupted(record: PassportRecord, txid: string, outcome: 'sent' | 'abandoned'): Promise<PassportRecord> {
    const latest = await this.options.store.getPassport(record.passportId)
    const entry = latest?.states.find((s) => s.txid === txid)
    if (latest == null || entry == null) throw new WriteRefused('unknown-state', `${short(txid)} is not in the journal`)
    if (!isInterrupted(entry)) throw new WriteRefused('not-interrupted', `${short(txid)} is ${entry.network}`)
    if (latest.states.at(-1)?.txid !== txid) throw new WriteRefused('not-the-tip', `${short(txid)} is not the newest state`)
    if (outcome === 'abandoned') {
      const cancelling = await this.options.store.changePassport(record.passportId, (current) => {
        const draft = journalTip(current, txid)
        if (!isInterrupted(draft)) throw new WriteRefused('not-interrupted', 'the draft was already resolved')
        draft.network = 'not-sent'
        return current
      })
      return this.removeDraft(cancelling!, txid, 'the operator confirmed that the interrupted transaction was abandoned')
    }
    let acceptance = entry.acceptance
    if (entry.op === 'TRANSFER') {
      const state = findDppOutputs(Transaction.fromHex(entry.rawTx)).find((out) => out.outputIndex === entry.outputIndex)?.state
      if (state?.version !== '2') throw new WriteRefused('acceptance-mismatch', 'the retained transfer cannot be decoded')
      if (acceptance == null) {
        const offers = await this.options.store.listOffers({ passportId: record.passportId })
        acceptance = [...latest.acceptanceRecords, ...offers.flatMap((offer) => offer.record == null ? [] : [offer.record])].find((item) => acceptanceCommitment(item) === state.authorisationCommitment)
      }
      if (acceptance == null || bindAcceptanceToState(acceptance, state).length > 0) throw new WriteRefused('acceptance-mismatch', 'the signed acceptance for the interrupted transfer is unavailable or differs')
    }
    const holder = entry.nextHolder ?? { party: acceptance == null ? entry.actor : `recipient:${acceptance.requestId}`, controllerKey: entry.controllerKey }
    return this.finishDraft(record.passportId, entry, holder, acceptance)
  }

  async recordAnnouncement(id: string, txid: string, index: StateEntry['index'], refusal?: string): Promise<PassportRecord> {
    const result = await this.options.store.changePassport(id, (current) => {
      const state = current?.states.find((item) => item.txid === txid)
      if (state == null) throw new WriteRefused('unknown-state', 'the announced transaction is absent from the journal')
      if (state.index !== 'admitted' && state.index !== 'duplicate') Object.assign(state, { index, refusal })
      return current
    })
    return result!
  }

  /** Keep the proof against the exact transaction for which it was obtained. */
  async prove(record: PassportRecord, txid: string): Promise<boolean> {
    const id = record.passportId
    let entry = (await this.options.store.getPassport(id))?.states.find((s) => s.txid === txid)
    if (entry == null) throw new WriteRefused('unknown-state', `${short(txid)} is not in the journal of ${id}`)
    if (entry.network !== 'accepted' && entry.network !== 'dry-run') return false
    if (entry.proof == null) {
      const path = await this.options.wallet.adapter.merklePathFor(txid)
      if (path == null) return false
      const tx = Transaction.fromHex(entry.rawTx)
      tx.merklePath = path
      const updated = await this.options.store.changePassport(id, (current) => {
        const state = current?.states.find((s) => s.txid === txid)
        if (state == null) throw new WriteRefused('unknown-state', 'the proven state is absent')
        if (state.proof == null) {
          state.sentBeef = state.beef
          state.beef = Utils.toBase64(tx.toAtomicBEEF())
          state.proof = { merklePath: path.toHex(), blockHeight: path.blockHeight }
        }
        return current
      })
      entry = updated!.states.find((s) => s.txid === txid)!
    }
    if (entry.proofPushed !== true) {
      const proof = entry.proof!
      const pushed = await this.options.index.pushProof(txid, MerklePath.fromHex(proof.merklePath))
      if (pushed.ok) await this.options.store.changePassport(id, (current) => {
        const state = current?.states.find((s) => s.txid === txid)
        if (state?.proof?.merklePath === proof.merklePath) state.proofPushed = true
        return current
      })
    }
    return true
  }

  /**
   * A product document under a binding, validated whole, split and built into
   * the exact public payload, before anything is signed. A document that
   * fails, that could not be checked or whose public part is too large is
   * refused here, with the validation in the refusal for the form to show.
   */
  private async prepareBound(bound: BindingProfile, product: Record<string, unknown>, passportId: string) {
    const { identifiers } = this.options
    const prepared = await this.options.bound.prepare({ profile: bound, product, passportId, ...(isDemonstrationPolicy(identifiers) ? { notice: DEMONSTRATION_NOTICE } : {}) })
    if (prepared.ok) return prepared
    const views: { validation?: ViewCheck; publicView?: ViewCheck } = {}
    if (prepared.validation != null) views.validation = await this.options.bound.viewCheck('whole', prepared.validation, { profile: bound, product })
    if (prepared.publicView != null) views.publicView = await this.options.bound.viewCheck('public', prepared.publicView)
    const failed = (views.publicView ?? views.validation)?.steps.filter((step) => step.status !== 'pass').flatMap((step) => step.messages) ?? []
    const said = failed.length === 0 ? '' : ` ${failed.slice(0, 5).join(' ')}${failed.length > 5 ? ` And ${failed.length - 5} more.` : ''}`
    const engine = this.options.bound.engineProblem
    if (prepared.code === 'validation-failed') throw new WriteRefused('product-invalid', `${prepared.detail} Nothing was signed.${said}`, { ...views, cause: views.validation?.cause })
    if (prepared.code === 'validation-unavailable') {
      throw new WriteRefused('product-not-validated', `${prepared.detail} Nothing was signed.${engine == null ? said : ` The validation engine is not available: ${engine}`}`, { ...views, cause: views.validation?.cause })
    }
    if (prepared.code === 'public-payload-too-large') {
      throw new WriteRefused('public-payload-too-large', `${prepared.detail} Nothing was signed. Move data out of the public properties or shorten it: the restricted part does not count towards the limit.`, { byteLength: prepared.byteLength, limit: prepared.limit })
    }
    if (prepared.code === 'public-view-failed') throw new WriteRefused('public-view-failed', `${prepared.detail} Nothing was signed.${said}`, { ...views, cause: views.publicView?.cause })
    throw new WriteRefused(prepared.code, `${prepared.detail} Nothing was signed.`)
  }

  /** The first state: the brand opens the passport under its own controller key. */
  async issue(args: { brandId: string; brand: Party; passportId: string; profile: string; payload?: Record<string, unknown>; ownerFields?: Record<string, unknown>; product?: Record<string, unknown> }): Promise<WriteOutcome> {
    // Before the identifier is checked or the index asked: the answer does not depend on either.
    requireIssuableProfile(args.profile)
    const problems = identifierProblems(args.passportId, this.options.identifiers)
    if (problems.length > 0) throw new WriteRefused('identifier-refused', `${args.passportId} cannot be written because ${problems.join('; and ')}`)
    const existing = await this.options.store.getPassport(args.passportId)
    if (existing != null && existing.states.length > 0) throw new WriteRefused('already-issued', `${args.passportId} is already in the journal`)
    const held = await this.options.index.lineage(args.passportId).catch(() => [])
    if (held.length > 0) throw new WriteRefused('already-on-index', `the index already holds ${held.length} state(s) for ${args.passportId}; use a serial that is not in use`)
    const record: PassportRecord = {
      passportId: args.passportId,
      brandId: args.brandId,
      profile: args.profile,
      createdAt: instant(),
      status: 'active',
      holder: { party: args.brand.name, controllerKey: await args.brand.controllerKey(args.passportId) },
      states: [],
      acceptanceRecords: [],
    }
    // A manifest profile's genesis always carries a payload and an owner tier; a bound profile's carries the product document.
    const data = args.product != null ? { product: args.product } : { payload: args.payload ?? {}, ownerFields: args.ownerFields ?? {} }
    return await this.writeState({ record, op: 'ISSUE', actor: args.brand, controller: args.brand, profile: args.profile, ...data })
  }

  /** A later state that changes the data, by the party that controls the passport. */
  async update(args: { record: PassportRecord; actor: Party; payload?: Record<string, unknown>; ownerFields?: Record<string, unknown>; product?: Record<string, unknown>; eventData?: Record<string, unknown> }): Promise<WriteOutcome> {
    const data = args.product != null ? { product: args.product } : { payload: args.payload ?? {}, ownerFields: args.ownerFields }
    return await this.writeState({ record: args.record, op: 'UPDATE', actor: args.actor, controller: args.actor, profile: args.record.profile, ...data, eventData: args.eventData })
  }

  /** The hand-on: the holder acts, control moves to the recipient's key, field 15 commits to the custodian-signed acceptance record, and the new commitment binds the ciphertext delivered to the recipient. */
  async transfer(args: { record: PassportRecord; holder: Party; recipient: Party; acceptance: ManagedAcceptanceRecord; eventData?: Record<string, unknown> }): Promise<WriteOutcome> {
    return await this.writeState({ record: args.record, op: 'TRANSFER', actor: args.holder, controller: args.recipient, profile: args.record.profile, eventData: args.eventData, acceptance: args.acceptance })
  }

  /** The end of the lineage; nothing may follow it. The payload and owner tier do not change on RETIRE (record model version 2, rule 8). */
  async retire(args: { record: PassportRecord; actor: Party; reason: string }): Promise<WriteOutcome> {
    return await this.writeState({ record: args.record, op: 'RETIRE', actor: args.actor, controller: args.actor, profile: args.record.profile, eventData: { reason: args.reason } })
  }
}
