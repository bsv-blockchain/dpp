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
} from '@bsv/dpp-core'
import type { ProfileId } from '@bsv/dpp-profiles'
import { identifierProblems, type IdentifierPolicy } from './identifiers.js'
import type { IndexClient } from './index-client.js'
import type { Party } from './parties.js'
import { validatePayload } from './profiles.js'
import type { PassportRecord, StateEntry, Store } from './store.js'
import type { PlatformWallet, Tip } from './wallet.js'

/** BRC-43 protocol the owner tier is encrypted under (spec/record-model.md section 7). */
const OWNER_DATA_PROTOCOL: WalletProtocol = [2, 'dpp owner data v1']

export class WriteRefused extends Error {
  constructor(
    readonly code: string,
    detail: string
  ) {
    super(detail)
  }
}

export interface WriterOptions {
  store: Store
  wallet: PlatformWallet
  index: IndexClient
  identifiers: IdentifierPolicy
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

const instant = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const short = (hex: string): string => `${hex.slice(0, 12)}...`

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

  private async sealOwnerTier(controller: Party, passportId: string, profile: ProfileId, fields: Record<string, unknown>): Promise<{ hash: string; ciphertext: number[] }> {
    const check = validatePayload(profile, 'restricted', fields)
    if (!check.valid) throw new WriteRefused('owner-tier-invalid', `the owner tier is refused by the restricted schema of ${profile}: ${check.problems.join('; ')}`)
    const plaintext = Utils.toArray(JSON.stringify(fields), 'utf8') as number[]
    const { ciphertext } = await controller.wallet.encrypt({ plaintext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self' })
    const hash = ownerBlobHash(ciphertext)
    if (!verifyOwnerBlob(ciphertext, hash)) throw new WriteRefused('owner-tier-unsound', 'the sealed owner tier does not verify against its hash')
    return { hash, ciphertext }
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
    profile: ProfileId
    /** A new public payload and owner tier; absent, the tip's are carried unchanged, which RETIRE requires and a hand-on keeps simple. */
    payload?: Record<string, unknown>
    ownerFields?: Record<string, unknown>
    eventData?: Record<string, unknown>
    acceptance?: ManagedAcceptanceRecord
  }): Promise<WriteOutcome> {
    const { record, op, actor, controller, profile } = args
    const { store, wallet, index } = this.options
    const passportId = record.passportId
    const tip = this.tipOf(record)
    if (op === 'ISSUE' && tip != null) throw new WriteRefused('already-issued', `${passportId} already has ${record.states.length} state(s); a second genesis is never written`)
    if (op !== 'ISSUE' && tip == null) throw new WriteRefused('not-issued', `${passportId} has no genesis to follow`)
    if (record.status === 'retired') throw new WriteRefused('retired', `${passportId} ended with a RETIRE; nothing may follow it`)
    const pending = record.states.find((s) => s.network === 'pending')
    if (pending != null) throw new WriteRefused('operation-interrupted', `${short(pending.txid)} was built and announced but its send was never answered for; resolve it first (was it sent, or abandoned?) before the next state`)

    const tipEntry = record.states.at(-1)
    let payloadPublic: string
    let sealed: { hash: string; ciphertext: number[] }
    if (args.payload != null) {
      const publicCheck = validatePayload(profile, 'public', args.payload)
      if (!publicCheck.valid) throw new WriteRefused('payload-invalid', `the public payload is refused by the ${profile} schema: ${publicCheck.problems.join('; ')}`)
      payloadPublic = JSON.stringify(args.payload)
      // A new payload with no owner fields carries the tip's sealed tier unchanged, when the actor still controls it.
      sealed =
        args.ownerFields == null && tipEntry?.ownerTier != null
          ? { hash: tipEntry.ownerTier.hash, ciphertext: Utils.toArray(tipEntry.ownerTier.ciphertext, 'base64') as number[] }
          : await this.sealOwnerTier(controller, passportId, profile, args.ownerFields ?? {})
    } else {
      if (tipEntry?.ownerTier == null) throw new WriteRefused('nothing-to-carry', `${passportId} has no tip whose payload and owner tier this ${op} could carry`)
      payloadPublic = tipEntry.payloadPublic
      sealed = { hash: tipEntry.ownerTier.hash, ciphertext: Utils.toArray(tipEntry.ownerTier.ciphertext, 'base64') as number[] }
    }
    await this.withinSpendCap()

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
      payloadOwnerHash: sealed.hash,
      previousTxid: tip == null ? '' : tip.txid,
      previousOutputIndex: tip == null ? null : tip.outputIndex,
      lineageGenesis: tip == null ? null : { txid: record.states[0].txid, outputIndex: record.states[0].outputIndex },
      // The actor is never the controller key itself, so every later state proves control by linkage from the actor's identity key to the previous field 6.
      controlLinkage: tip == null ? '' : await actor.controlLinkage(passportId),
      authorisationCommitment: args.acceptance == null ? '' : acceptanceCommitment(args.acceptance),
    }
    if (tip != null && previousController != null && (await actor.controllerKey(passportId)) !== previousController) {
      throw new WriteRefused('not-the-controller', `${actor.name} does not control ${passportId}; its controller key is held by ${record.holder.party}`)
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
      ownerTier: { hash: sealed.hash, ciphertext: Utils.toBase64(sealed.ciphertext) },
      index: 'pending',
      network: 'pending',
    }
    record.states.push(entry)
    await store.savePassport(record)
    this.log(`${op} ${short(built.txid)} built unsent for ${passportId}`)

    const settle = async (patch: Partial<StateEntry>): Promise<void> => {
      Object.assign(entry, patch)
      await store.savePassport(record)
    }
    // A state that is not written leaves the journal as it was: the unsent action is aborted and the entry removed.
    const abandon = async (code: string, detail: string): Promise<never> => {
      await wallet.adapter.discard(built)
      record.states.pop()
      if (record.states.length === 0) await store.deletePassport(record.passportId)
      else await store.savePassport(record)
      throw new WriteRefused(code, detail)
    }

    // Section 2: the verifier's own checks on the unsent transaction, with the lineage so far in front of it.
    const lineage = record.states.slice(0, -1).map((s) => Transaction.fromHex(s.rawTx))
    const checked = await verifyChain([...lineage, built.tx], { chainTracker: 'scripts only', serverIdentityKey: wallet.identityKey, managedAcceptance: true })
    if (!checked.valid) await abandon('own-check-refused', `the writer's own check refuses the unsent ${op}: ${checked.error ?? 'no reason given'}`)

    // Section 3: a state after the genesis spends the tip the index returns for the passport.
    if (tip != null) {
      const held = await index.lineage(passportId).catch(() => undefined)
      const heldTip = held?.at(-1)?.id('hex')
      if (held != null && heldTip !== tip.txid) {
        await abandon('tip-moved', `the index's tip for ${passportId} is ${heldTip == null ? 'nothing' : short(heldTip)}, not ${short(tip.txid)}`)
      }
    }

    // Section 3: announce first, send only on admission. An unreachable index refuses nothing.
    let announced = await index.announce(built.beef)
    await settle({ index: announced, refusal: index.lastRefusal })
    if (announced === 'refused') await abandon('index-refused', `the index refused ${short(built.txid)} while it was still a draft: ${index.lastRefusal ?? 'no reason given'}`)
    if (announced === 'unauthorised') await abandon('index-unauthorised', 'the index wants a submit token, or a different one; nothing was sent')

    if (!this.options.livePublishing && wallet.kind === 'toolbox') {
      await abandon('live-publishing-off', 'LIVE_PUBLISHING is false: the state was built, checked and admitted as a draft, then aborted. Set LIVE_PUBLISHING=true to write to the chain.')
    }

    // Sections 4 and 5: send, and report only the network's answer.
    const sent = await wallet.adapter.send(built)
    await settle({ network: wallet.kind === 'test' ? 'dry-run' : sent })
    if (sent === 'refused') {
      if (announced === 'admitted') await index.retract(built.txid, 'the network refused the transaction after the index admitted it')
      await abandon('network-refused', `the network refused ${short(built.txid)}; the state never existed and nothing was spent`)
    }
    if (sent === 'unanswered') throw new WriteRefused('network-unanswered', `the wallet has not yet reported the network's answer for ${short(built.txid)}; do not rebuild, the worker will continue from the journal`)
    await store.recordSpend({ txid: built.txid, satoshis: Math.ceil(built.tx.toBinary().length / 10) + 1, at: instant() })

    // Section 6: an announcement that could not be made is retried, never a reason to spend again.
    if (announced === 'unreachable') {
      announced = await index.announce(built.beef)
      await settle({ index: announced, refusal: index.lastRefusal })
    }

    record.holder = { party: controller.name, controllerKey }
    if (op === 'RETIRE') record.status = 'retired'
    if (args.acceptance != null) record.acceptanceRecords.push(args.acceptance)
    await store.savePassport(record)
    this.log(`${op} ${short(built.txid)} written: index ${entry.index}, network ${entry.network}`)
    return { entry, state, record }
  }

  /**
   * A write interrupted between the announcement and the network's answer,
   * for example by a crash, leaves an entry with network 'pending'. Only the
   * operator knows what happened: 'sent' keeps it and carries on; 'abandoned'
   * withdraws it from the index, aborts it in the wallet and removes it, so
   * the next state builds on the previous tip. Never rebuild a state that
   * was sent.
   */
  async resolveInterrupted(record: PassportRecord, txid: string, outcome: 'sent' | 'abandoned'): Promise<PassportRecord> {
    const at = record.states.findIndex((s) => s.txid === txid)
    const entry = record.states[at]
    if (entry == null) throw new WriteRefused('unknown-state', `${short(txid)} is not in the journal of ${record.passportId}`)
    if (entry.network !== 'pending') throw new WriteRefused('not-interrupted', `${short(txid)} is ${entry.network}, not interrupted`)
    if (at !== record.states.length - 1) throw new WriteRefused('not-the-tip', `${short(txid)} is not the newest state`)
    if (outcome === 'sent') {
      entry.network = 'accepted'
      await this.options.store.savePassport(record)
      return record
    }
    if (entry.index === 'admitted') await this.options.index.retract(txid, 'the write was interrupted before the network answered')
    await this.options.wallet.adapter.discard({ tx: Transaction.fromHex(entry.rawTx), txid, beef: Utils.toArray(entry.beef, 'base64') as number[] })
    record.states.pop()
    if (record.states.length === 0) await this.options.store.deletePassport(record.passportId)
    else {
      // The actor of the abandoned state was the holder when it was built; control returns to the previous tip's key.
      const previous = record.states.at(-1)!
      record.holder = { party: entry.actor, controllerKey: previous.controllerKey }
      record.status = 'active'
      await this.options.store.savePassport(record)
    }
    return record
  }

  /** Section 7: the wallet's proof, pushed to the index and kept with the bytes. Returns whether a proof is now held. */
  async prove(record: PassportRecord, txid: string): Promise<boolean> {
    const entry = record.states.find((s) => s.txid === txid)
    if (entry == null) throw new WriteRefused('unknown-state', `${short(txid)} is not in the journal of ${record.passportId}`)
    if (entry.proof == null) {
      const path = await this.options.wallet.adapter.merklePathFor(txid)
      if (path == null) return false
      entry.proof = { merklePath: path.toHex(), blockHeight: path.blockHeight }
      const tx = Transaction.fromHex(entry.rawTx)
      tx.merklePath = path
      entry.beef = Utils.toBase64(tx.toAtomicBEEF())
      await this.options.store.savePassport(record)
    }
    if (entry.proofPushed !== true) {
      const pushed = await this.options.index.pushProof(txid, MerklePath.fromHex(entry.proof.merklePath))
      entry.proofPushed = pushed.ok
      await this.options.store.savePassport(record)
      this.log(`proof for ${short(txid)} ${pushed.ok ? 'reached the index' : `not taken by the index: ${pushed.detail}`}`)
    }
    return true
  }

  /** The first state: the brand opens the passport under its own controller key. */
  async issue(args: { brandId: string; brand: Party; passportId: string; profile: ProfileId; payload: Record<string, unknown>; ownerFields: Record<string, unknown> }): Promise<WriteOutcome> {
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
    return await this.writeState({ record, op: 'ISSUE', actor: args.brand, controller: args.brand, profile: args.profile, payload: args.payload, ownerFields: args.ownerFields })
  }

  /** A later state that changes the data, by the party that controls the passport. */
  async update(args: { record: PassportRecord; actor: Party; payload: Record<string, unknown>; ownerFields?: Record<string, unknown>; eventData?: Record<string, unknown> }): Promise<WriteOutcome> {
    return await this.writeState({ record: args.record, op: 'UPDATE', actor: args.actor, controller: args.actor, profile: args.record.profile as ProfileId, payload: args.payload, ownerFields: args.ownerFields, eventData: args.eventData })
  }

  /** The hand-on: the holder acts, control moves to the recipient's key, field 15 commits to the custodian-signed acceptance record, and the payload and owner tier travel unchanged. */
  async transfer(args: { record: PassportRecord; holder: Party; recipient: Party; acceptance: ManagedAcceptanceRecord; eventData?: Record<string, unknown> }): Promise<WriteOutcome> {
    return await this.writeState({ record: args.record, op: 'TRANSFER', actor: args.holder, controller: args.recipient, profile: args.record.profile as ProfileId, eventData: args.eventData, acceptance: args.acceptance })
  }

  /** The end of the lineage; nothing may follow it. The payload and owner tier do not change on RETIRE (record model version 2, rule 8). */
  async retire(args: { record: PassportRecord; actor: Party; reason: string }): Promise<WriteOutcome> {
    return await this.writeState({ record: args.record, op: 'RETIRE', actor: args.actor, controller: args.actor, profile: args.record.profile as ProfileId, eventData: { reason: args.reason } })
  }
}
