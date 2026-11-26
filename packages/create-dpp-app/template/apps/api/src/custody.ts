// Hand-ons under managed-custody@2 (spec/managed-custody.md): offer,
// acceptance, transfer. The custodian, this platform, fixes the current tip,
// a digest of the exact terms shown to the recipient and an expiry; the
// recipient accepts with a claim code or as a named identity; the custodian
// signs and keeps the acceptance record; the TRANSFER commits to it in
// field 15 and moves control to the recipient's managed key. Only the third
// step touches the chain. A declined or expired offer writes nothing.
import { Hash, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import { bindAcceptanceToState, canonicalJson, findDppOutputs, inspectManagedAcceptance, signManagedAcceptance, type ManagedAcceptanceClaim, type ManagedAcceptanceRecord } from '@bsv/dpp-protocol'
import type { Parties, Party } from './parties.js'
import { isInterrupted, type OfferRecord, type PassportRecord, type Store } from './store.js'
import type { PlatformWallet } from './wallet.js'
import { WriteRefused, refuseRetiredProfile, type Writer } from './writer.js'

const instant = (offsetSeconds = 0): string => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
const sha256hex = (text: string): string => Utils.toHex(Hash.sha256(Utils.toArray(text, 'utf8')))

export interface CustodyOptions {
  store: Store
  wallet: PlatformWallet
  parties: Parties
  writer: Writer
  /** How long an offer stays open. */
  offerLifetimeSeconds?: number
}

interface CreateOfferInput {
  record: PassportRecord
  /** Direct callers already hold the party. HTTP authenticates the holder of the original offer on a retry. */
  holder: Party | ((partyName: string) => Promise<Party>)
  requestId?: string
  terms: Record<string, unknown>
  mechanism?: 'claim-code' | 'named-recipient'
  recipientIdentityKey?: string
}

type Outpoint = OfferRecord['expectedPredecessor']
const sameOutpoint = (left: Outpoint, right: Outpoint): boolean =>
  left.txid === right.txid && left.outputIndex === right.outputIndex

/** Check a retained offer against the custodian's signed record using only public keys and the carried journal. */
export function acceptanceMatchesOffer(offer: OfferRecord, record: ManagedAcceptanceRecord, passport: PassportRecord, custodian: string): boolean {
  const inspection = inspectManagedAcceptance(record, { custodians: [custodian] })
  if (!inspection.signatureValid || inspection.failures.length > 0) return false
  try {
    return record.requestId === offer.requestId && record.passportId === offer.passportId &&
      record.termsDigest === offer.termsDigest && sha256hex(canonicalJson(offer.terms)) === offer.termsDigest &&
      record.lineageGenesis.txid === passport.states[0]?.txid && record.lineageGenesis.outputIndex === passport.states[0]?.outputIndex &&
      canonicalJson(record.expectedPredecessor) === canonicalJson(offer.expectedPredecessor) &&
      record.offer.mechanism === offer.mechanism && record.offer.recipientRef === (offer.mechanism === 'claim-code' ? offer.claimCodeHash : offer.recipientIdentityKey) &&
      record.offer.holderIdentityKey === offer.holderIdentityKey && record.offer.createdAt === offer.createdAt && record.offer.expiresAt === offer.expiresAt
  } catch {
    return false
  }
}

/** A later state's actor held the preceding outpoint. Only the original holder may repeat or withdraw that offer. */
export function offerHolderName(record: PassportRecord, offer?: OfferRecord): string {
  if (offer?.passportId === record.passportId) {
    const predecessor = record.states.findIndex(state => sameOutpoint(state, offer.expectedPredecessor))
    if (predecessor >= 0) return record.states[predecessor + 1]?.actor ?? record.holder.party
  }
  return record.holder.party
}

function requireOfferTip(saved: PassportRecord | undefined, predecessor: Outpoint): asserts saved is PassportRecord {
  const tip = saved?.states.at(-1)
  if (tip && isInterrupted(tip)) throw new WriteRefused('operation-interrupted', 'resolve the unsettled passport state before making an offer')
  if (!tip || !sameOutpoint(tip, predecessor)) throw new WriteRefused('tip-moved', 'the passport moved before the offer was saved')
}

interface AcceptOfferInput {
  requestId: string
  claimCode?: string
  recipientIdentityKey?: string
  /** The authenticated member accepting a named offer. */
  recipient?: Party
}

interface AcceptedTransfer {
  offer: OfferRecord
  record: ManagedAcceptanceRecord
  transferTxid: string
}

export class Custody {
  private readonly lifetime: number
  private readonly accepting = new Map<string, Promise<AcceptedTransfer>>()

  constructor(private readonly options: CustodyOptions) {
    this.lifetime = options.offerLifetimeSeconds ?? 7 * 24 * 3600
  }

  /**
   * The holder asks the custodian to offer the passport, by claim code (the
   * code is returned once and only its hash is kept) or to a named identity.
   */
  async offer(args: CreateOfferInput): Promise<{ offer: OfferRecord; claimCode?: string }> {
    const { record, requestId } = args
    // Offer identifiers are also URL path segments. Dot segments would be normalised away by clients.
    if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.length || Buffer.byteLength(requestId) > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(requestId) || Buffer.from(requestId).toString() !== requestId || requestId === '.' || requestId === '..')) {
      throw new WriteRefused('offer-request-id-invalid', 'an offer request ID must be printable text of 1 to 128 UTF-8 bytes and cannot be a dot segment')
    }
    const retained = requestId === undefined ? undefined : await this.options.store.getOffer(requestId)
    const holder = typeof args.holder === 'function' ? await args.holder(offerHolderName(record, retained)) : args.holder
    const mechanism = args.mechanism ?? 'claim-code'
    const recipientIdentityKey = args.recipientIdentityKey ?? undefined
    const termsDigest = sha256hex(canonicalJson(args.terms))
    const replay = (existing: OfferRecord) => {
      if (existing.passportId !== record.passportId || existing.brandId !== record.brandId || existing.holderIdentityKey !== holder.identityKey ||
        existing.mechanism !== mechanism || (existing.recipientIdentityKey ?? undefined) !== recipientIdentityKey || existing.termsDigest !== termsDigest) {
        throw new WriteRefused('offer-request-conflict', 'this request ID is already used for a different offer')
      }
      // Replay the creation response with its current status, omitting fields added by acceptance.
      const { record: _acceptance, transferTxid: _transfer, ...offer } = existing
      return { offer }
    }
    if (retained) return replay(retained)
    // A hand-on ends in a TRANSFER, which the writer refuses under a retired profile. Refused here, no offer is left open that can never complete.
    refuseRetiredProfile(record.profile)
    if (record.status === 'retired') throw new WriteRefused('retired', `${record.passportId} is retired`)
    if (record.holder.party !== holder.name) throw new WriteRefused('not-the-holder', `${holder.name} does not hold ${record.passportId}`)
    const tip = record.states.at(-1)
    if (tip == null) throw new WriteRefused('not-issued', `${record.passportId} has no state`)
    if (mechanism !== 'named-recipient' && mechanism !== 'claim-code') throw new WriteRefused('offer-mechanism-invalid', 'use claim-code or named-recipient')
    if (mechanism === 'named-recipient' && recipientIdentityKey === undefined) throw new WriteRefused('recipient-missing', 'a named-recipient offer needs the recipient identity key')
    if (recipientIdentityKey !== undefined && (typeof recipientIdentityKey !== 'string' || !/^0[23][0-9a-f]{64}$/.test(recipientIdentityKey))) {
      throw new WriteRefused('recipient-invalid', 'the recipient identity key must be a compressed public key in lower-case hex')
    }
    const claimCode = mechanism === 'claim-code' ? Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 8)) : undefined
    const offer: OfferRecord = {
      requestId: requestId ?? `offer-${Date.now().toString(36)}-${Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 4))}`,
      passportId: record.passportId,
      brandId: record.brandId,
      mechanism,
      ...(claimCode == null ? {} : { claimCodeHash: sha256hex(claimCode) }),
      ...(recipientIdentityKey === undefined ? {} : { recipientIdentityKey }),
      terms: args.terms,
      termsDigest,
      holderIdentityKey: holder.identityKey,
      expectedPredecessor: { txid: tip.txid, outputIndex: tip.outputIndex },
      createdAt: instant(),
      expiresAt: instant(this.lifetime),
      status: 'open',
    }
    if (await this.reserveOffer(offer)) return { offer, claimCode }
    // Unique insertion also covers callers racing on the same request from different processes.
    const winner = requestId === undefined ? undefined : await this.options.store.getOffer(requestId)
    if (winner) return replay(winner)
    throw new WriteRefused('offer-open', `${record.passportId} already has an open offer or an acceptance awaiting transfer.`)
  }

  private async reserveOffer(offer: OfferRecord): Promise<boolean> {
    const { store } = this.options
    const saved = await store.getPassport(offer.passportId)
    try {
      requireOfferTip(saved, offer.expectedPredecessor)
    } catch (cause) {
      // Another creator may have inserted and transferred this request since the caller's initial lookup.
      if (await store.getOffer(offer.requestId)) return false
      throw cause
    }
    if (!await store.createOpenOffer(offer)) {
      // An old or interrupted writer can leave an open offer at a spent outpoint. A matching
      // request must replay it. A new request may replace it once its successor is settled.
      const [open] = await store.listOffers({ passportId: offer.passportId, status: 'open' })
      if (!open || open.requestId === offer.requestId || !saved.states.slice(0, -1).some(state => sameOutpoint(state, open.expectedPredecessor))) return false
      await store.changeOfferStatus({ ...open, status: 'withdrawn' }, 'open')
      if (!await store.createOpenOffer(offer)) return false
    }
    // The journal and offers are separate durable records. A delayed insert can overlap a spend.
    const latest = await store.getPassport(offer.passportId)
    try {
      requireOfferTip(latest, offer.expectedPredecessor)
    } catch (cause) {
      // Acceptance or closure already won the race. Return the retained response without the creation secret.
      if (!await store.changeOfferStatus({ ...offer, status: 'withdrawn' }, 'open')) return false
      throw cause
    }
    return true
  }

  async withdraw(requestId: string, holder: Party): Promise<OfferRecord> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    if (offer.holderIdentityKey !== holder.identityKey) throw new WriteRefused('not-the-holder', 'only the holder withdraws an offer')
    if (offer.status !== 'open') throw new WriteRefused('offer-closed', `offer ${requestId} is ${offer.status}`)
    return await this.closeOpenOffer(offer, 'withdrawn')
  }

  /** What a recipient sees before deciding: the terms the digest covers, and when the offer closes. */
  async preview(requestId: string): Promise<{ requestId: string; passportId: string; terms: Record<string, unknown>; expiresAt: string; status: OfferRecord['status'] }> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    return { requestId, passportId: offer.passportId, terms: offer.terms, expiresAt: offer.expiresAt, status: offer.status }
  }

  async decline(requestId: string, claimCode?: string, recipientIdentityKey?: string): Promise<OfferRecord> {
    const offer = await this.openOffer(requestId, claimCode, recipientIdentityKey)
    return await this.closeOpenOffer(offer, 'declined')
  }

  private async closeOpenOffer(offer: OfferRecord, status: 'withdrawn' | 'declined' | 'expired'): Promise<OfferRecord> {
    const closed = { ...offer, status }
    if (!await this.options.store.changeOfferStatus(closed, 'open')) throw new WriteRefused('offer-closed', `offer ${offer.requestId} is no longer open`)
    return closed
  }

  private checkRecipient(offer: OfferRecord, claimCode?: string, recipientIdentityKey?: string): void {
    if (offer.mechanism === 'claim-code' && (typeof claimCode !== 'string' || sha256hex(claimCode) !== offer.claimCodeHash)) throw new WriteRefused('claim-code-wrong', 'the claim code does not match this offer')
    if (offer.mechanism === 'named-recipient' && (recipientIdentityKey == null || recipientIdentityKey !== offer.recipientIdentityKey)) throw new WriteRefused('recipient-wrong', 'this offer is addressed to another identity')
  }

  private recipientFor(offer: OfferRecord, args: AcceptOfferInput): Party {
    const managed = this.options.parties.recipient(offer.requestId)
    this.checkRecipient(offer, args.claimCode, args.recipient?.identityKey ?? args.recipientIdentityKey)
    if (offer.mechanism === 'claim-code') return managed
    const recipient = args.recipient ?? managed
    if (recipient.identityKey !== offer.recipientIdentityKey) throw new WriteRefused('recipient-wrong', 'the accepting party must control the named identity')
    return recipient
  }

  private async openOffer(requestId: string, claimCode?: string, recipientIdentityKey?: string): Promise<OfferRecord> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    if (offer.status !== 'open') throw new WriteRefused('offer-closed', `offer ${requestId} is ${offer.status}`)
    if (offer.expiresAt <= instant()) {
      await this.closeOpenOffer(offer, 'expired')
      throw new WriteRefused('offer-expired', `offer ${requestId} expired at ${offer.expiresAt}`)
    }
    this.checkRecipient(offer, claimCode, recipientIdentityKey)
    return offer
  }

  /**
   * The recipient accepts: the custodian derives the recipient's managed
   * identity, records and signs the acceptance, keeps it, then writes the
   * TRANSFER that commits to it. The tip must still be the one the offer named.
   */
  async accept(args: AcceptOfferInput): Promise<AcceptedTransfer> {
    const offer = await this.options.store.getOffer(args.requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${args.requestId}`)
    const recipient = this.recipientFor(offer, args)
    const underway = this.accepting.get(offer.requestId)
    if (underway != null) return await underway
    const pending = this.acceptOffer(offer, args, recipient)
    this.accepting.set(offer.requestId, pending)
    try {
      return await pending
    } finally {
      this.accepting.delete(offer.requestId)
    }
  }

  private async acceptOffer(offer: OfferRecord, args: AcceptOfferInput, recipient: Party): Promise<AcceptedTransfer> {
    const { store, wallet } = this.options
    if (offer.status !== 'open' && offer.status !== 'accepted' && offer.status !== 'transferred') throw new WriteRefused('offer-closed', `offer ${offer.requestId} is ${offer.status}`)
    const passport = await store.getPassport(offer.passportId)
    if (passport == null) throw new WriteRefused('passport-unknown', `no passport ${offer.passportId}`)
    if (offer.status !== 'open') {
      if (offer.record == null) throw new WriteRefused('acceptance-invalid', 'the accepted offer has no signed record')
      await this.checkAcceptance(offer, offer.record, passport, recipient)
      return await this.completeTransfer(offer, offer.record, passport, recipient)
    }
    if (offer.expiresAt <= instant()) {
      await this.closeOpenOffer(offer, 'expired')
      throw new WriteRefused('offer-expired', `offer ${offer.requestId} expired at ${offer.expiresAt}`)
    }
    refuseRetiredProfile(passport.profile)
    const tip = passport.states.at(-1)
    if (tip?.txid !== offer.expectedPredecessor.txid || tip.outputIndex !== offer.expectedPredecessor.outputIndex) throw new WriteRefused('tip-moved', 'the passport moved since the offer was made; ask for a new offer')

    const claim: ManagedAcceptanceClaim = {
      acceptanceFormat: 'dpp-managed-acceptance@2',
      requestId: offer.requestId,
      passportId: offer.passportId,
      lineageGenesis: { txid: passport.states[0].txid, outputIndex: passport.states[0].outputIndex },
      expectedPredecessor: offer.expectedPredecessor,
      termsDigest: offer.termsDigest,
      offer: {
        holderIdentityKey: offer.holderIdentityKey,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        mechanism: offer.mechanism,
        recipientRef: offer.mechanism === 'claim-code' ? offer.claimCodeHash : offer.recipientIdentityKey,
      },
      acceptance: {
        recipientIdentityKey: recipient.identityKey,
        destinationKey: await recipient.controllerKey(offer.passportId),
        acceptedAt: instant(),
        evidenceKind: 'custodian-attested',
      },
      custodian: wallet.identityKey,
    }
    const record = await signManagedAcceptance(claim, wallet.custodian)
    await this.checkAcceptance(offer, record, passport, recipient)
    const accepted: OfferRecord = { ...offer, status: 'accepted', record }
    if (!await store.changeOfferStatus(accepted, 'open')) {
      const held = await store.getOffer(offer.requestId)
      if (held == null || held.status === 'open') throw new WriteRefused('offer-changed', 'the offer changed while its acceptance was being recorded')
      return await this.acceptOffer(held, args, this.recipientFor(held, args))
    }
    return await this.completeTransfer(accepted, record, passport, recipient)
  }

  private async checkAcceptance(offer: OfferRecord, record: ManagedAcceptanceRecord, passport: PassportRecord, recipient: Party): Promise<void> {
    if (!acceptanceMatchesOffer(offer, record, passport, this.options.wallet.identityKey)
      || record.acceptance.recipientIdentityKey !== recipient.identityKey || record.acceptance.destinationKey !== await recipient.controllerKey(offer.passportId)) {
      throw new WriteRefused('acceptance-invalid', 'the signed acceptance must identify this offer, recipient and destination')
    }
  }

  private async completeTransfer(offer: OfferRecord, record: ManagedAcceptanceRecord, passport: PassportRecord, recipient: Party): Promise<AcceptedTransfer> {
    const { store, writer } = this.options
    const predecessor = passport.states.findIndex(entry => entry.txid === offer.expectedPredecessor.txid && entry.outputIndex === offer.expectedPredecessor.outputIndex)
    if (predecessor < 0) throw new WriteRefused('tip-moved', 'the passport no longer holds the predecessor of this offer')
    let entry = passport.states[predecessor + 1]
    if (entry == null) {
      if (offer.status === 'transferred') throw new WriteRefused('acceptance-mismatch', 'the completed offer has no retained transfer')
      refuseRetiredProfile(passport.profile)
      try {
        const outcome = await writer.transfer({ record: passport, holder: this.holderOf(passport), recipient, acceptance: record, eventData: { word: typeof offer.terms.word === 'string' ? offer.terms.word : 'Handed on' } })
        entry = outcome.entry
      } catch (cause) {
        // Another process may have completed the transfer, or a successful journal write may have lost its response.
        const retained = (await store.getPassport(offer.passportId))?.states[predecessor + 1]
        if (retained == null || (retained.network !== 'accepted' && retained.network !== 'dry-run')) throw cause
        entry = retained
      }
    }
    if (entry.op !== 'TRANSFER') throw new WriteRefused('tip-moved', 'another operation followed the predecessor of this offer')
    const tx = Transaction.fromHex(entry.rawTx)
    const outputs = findDppOutputs(tx)
    const output = outputs[0]
    if (entry.txid !== tx.id('hex') || outputs.length !== 1 || output?.outputIndex !== entry.outputIndex || output.state.version !== '2'
      || !tx.inputs.some(input => input.sourceTXID === offer.expectedPredecessor.txid && input.sourceOutputIndex === offer.expectedPredecessor.outputIndex)
      || bindAcceptanceToState(record, output.state).length > 0) throw new WriteRefused('acceptance-mismatch', 'the retained transfer does not bind this signed acceptance')
    if (entry.network !== 'accepted' && entry.network !== 'dry-run') throw new WriteRefused('operation-interrupted', `the send of transfer ${entry.txid} has no successful answer`)
    const completed: OfferRecord = { ...offer, status: 'transferred', transferTxid: entry.txid }
    if (offer.status !== 'transferred' && await store.changeOfferStatus(completed, 'accepted')) return { offer: completed, record, transferTxid: entry.txid }
    const held = await store.getOffer(offer.requestId)
    if (held?.status !== 'transferred' || held.transferTxid !== entry.txid || held.record == null || canonicalJson(held.record) !== canonicalJson(record)) throw new WriteRefused('acceptance-mismatch', 'the offer does not record this completed transfer')
    return { offer: held, record, transferTxid: entry.txid }
  }

  /** The party that controls the passport now, resolved from the journal's holder name. */
  holderOf(passport: PassportRecord): Party {
    const { parties } = this.options
    const split = passport.holder.party.indexOf(':')
    const scope = passport.holder.party.slice(0, split)
    const id = passport.holder.party.slice(split + 1)
    if (scope === 'brand') return parties.brand(id)
    if (scope === 'recipient') return parties.recipient(id)
    if (scope === 'member') return parties.member(id)
    throw new WriteRefused('holder-unknown', `the holder ${passport.holder.party} is not a managed identity this platform derives`)
  }
}
