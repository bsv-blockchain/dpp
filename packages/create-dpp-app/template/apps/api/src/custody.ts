// Hand-ons under managed-custody@1 (spec/managed-custody.md): offer,
// acceptance, transfer. The custodian, this platform, fixes the current tip,
// a digest of the exact terms shown to the recipient and an expiry; the
// recipient accepts with a claim code or as a named identity; the custodian
// signs and keeps the acceptance record; the TRANSFER commits to it in
// field 15 and moves control to the recipient's managed key. Only the third
// step touches the chain. A declined or expired offer writes nothing.
import { Hash, PrivateKey, Utils } from '@bsv/sdk'
import { bindAcceptanceToState, canonicalJson, inspectManagedAcceptance, signManagedAcceptance, type ManagedAcceptanceClaim, type ManagedAcceptanceRecord } from '@bsv/dpp-protocol'
import type { Parties, Party } from './parties.js'
import type { OfferRecord, PassportRecord, Store } from './store.js'
import type { PlatformWallet } from './wallet.js'
import { WriteRefused, type Writer } from './writer.js'

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

export class Custody {
  private readonly lifetime: number

  constructor(private readonly options: CustodyOptions) {
    this.lifetime = options.offerLifetimeSeconds ?? 7 * 24 * 3600
  }

  /**
   * The holder asks the custodian to offer the passport, by claim code (the
   * code is returned once and only its hash is kept) or to a named identity.
   */
  async offer(args: { record: PassportRecord; holder: Party; terms: Record<string, unknown>; mechanism?: 'claim-code' | 'named-recipient'; recipientIdentityKey?: string }): Promise<{ offer: OfferRecord; claimCode?: string }> {
    const { record, holder } = args
    if (record.status === 'retired') throw new WriteRefused('retired', `${record.passportId} is retired`)
    if (record.holder.party !== holder.name) throw new WriteRefused('not-the-holder', `${holder.name} does not hold ${record.passportId}`)
    const tip = record.states.at(-1)
    if (tip == null) throw new WriteRefused('not-issued', `${record.passportId} has no state`)
    const open = await this.options.store.listOffers({ passportId: record.passportId, status: 'open' })
    if (open.length > 0) throw new WriteRefused('offer-open', `${record.passportId} already has an open offer ${open[0].requestId}; withdraw it first`)
    const mechanism = args.mechanism ?? 'claim-code'
    if (mechanism === 'named-recipient' && args.recipientIdentityKey == null) throw new WriteRefused('recipient-missing', 'a named-recipient offer needs the recipient identity key')
    const claimCode = mechanism === 'claim-code' ? Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 8)) : undefined
    const offer: OfferRecord = {
      requestId: `offer-${Date.now().toString(36)}-${Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 4))}`,
      passportId: record.passportId,
      brandId: record.brandId,
      mechanism,
      claimCodeHash: claimCode == null ? undefined : sha256hex(claimCode),
      recipientIdentityKey: args.recipientIdentityKey,
      terms: args.terms,
      termsDigest: sha256hex(canonicalJson(args.terms)),
      holderIdentityKey: holder.identityKey,
      expectedPredecessor: { txid: tip.txid, outputIndex: tip.outputIndex },
      createdAt: instant(),
      expiresAt: instant(this.lifetime),
      status: 'open',
    }
    await this.options.store.saveOffer(offer)
    return { offer, claimCode }
  }

  async withdraw(requestId: string, holder: Party): Promise<OfferRecord> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    if (offer.holderIdentityKey !== holder.identityKey) throw new WriteRefused('not-the-holder', 'only the holder withdraws an offer')
    if (offer.status !== 'open') throw new WriteRefused('offer-closed', `offer ${requestId} is ${offer.status}`)
    offer.status = 'withdrawn'
    await this.options.store.saveOffer(offer)
    return offer
  }

  /** What a recipient sees before deciding: the terms the digest covers, and when the offer closes. */
  async preview(requestId: string): Promise<{ requestId: string; passportId: string; terms: Record<string, unknown>; expiresAt: string; status: OfferRecord['status'] }> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    return { requestId, passportId: offer.passportId, terms: offer.terms, expiresAt: offer.expiresAt, status: offer.status }
  }

  async decline(requestId: string, claimCode?: string): Promise<OfferRecord> {
    const offer = await this.openOffer(requestId, claimCode)
    offer.status = 'declined'
    await this.options.store.saveOffer(offer)
    return offer
  }

  private async openOffer(requestId: string, claimCode?: string, recipientIdentityKey?: string): Promise<OfferRecord> {
    const offer = await this.options.store.getOffer(requestId)
    if (offer == null) throw new WriteRefused('offer-unknown', `no offer ${requestId}`)
    if (offer.status !== 'open') throw new WriteRefused('offer-closed', `offer ${requestId} is ${offer.status}`)
    if (offer.expiresAt <= instant()) {
      offer.status = 'expired'
      await this.options.store.saveOffer(offer)
      throw new WriteRefused('offer-expired', `offer ${requestId} expired at ${offer.expiresAt}`)
    }
    if (offer.mechanism === 'claim-code' && (claimCode == null || sha256hex(claimCode) !== offer.claimCodeHash)) throw new WriteRefused('claim-code-wrong', 'the claim code does not match this offer')
    if (offer.mechanism === 'named-recipient' && recipientIdentityKey !== offer.recipientIdentityKey) throw new WriteRefused('recipient-wrong', 'this offer is addressed to another identity')
    return offer
  }

  /**
   * The recipient accepts: the custodian derives the recipient's managed
   * identity, records and signs the acceptance, keeps it, then writes the
   * TRANSFER that commits to it. The tip must still be the one the offer named.
   */
  async accept(args: { requestId: string; claimCode?: string; recipientIdentityKey?: string }): Promise<{ offer: OfferRecord; record: ManagedAcceptanceRecord; transferTxid: string }> {
    const { store, wallet, parties, writer } = this.options
    // An acceptance whose TRANSFER did not get written is retried with the same record, never signed twice.
    const earlier = await store.getOffer(args.requestId)
    const retrying = earlier?.status === 'accepted' && earlier.record != null && earlier.transferTxid == null
    const offer = retrying ? earlier : await this.openOffer(args.requestId, args.claimCode, args.recipientIdentityKey)
    if (retrying && offer.mechanism === 'claim-code' && (args.claimCode == null || sha256hex(args.claimCode) !== offer.claimCodeHash)) throw new WriteRefused('claim-code-wrong', 'the claim code does not match this offer')
    const passport = await store.getPassport(offer.passportId)
    if (passport == null) throw new WriteRefused('passport-unknown', `no passport ${offer.passportId}`)
    const tip = passport.states.at(-1)
    if (tip == null || tip.txid !== offer.expectedPredecessor.txid) throw new WriteRefused('tip-moved', 'the passport moved since the offer was made; ask for a new offer')
    const holder = this.holderOf(passport)
    const recipient = parties.recipient(offer.requestId)
    if (retrying) {
      const record = offer.record!
      const outcome = await writer.transfer({ record: passport, holder, recipient, acceptance: record, eventData: { word: typeof offer.terms.word === 'string' ? offer.terms.word : 'Handed on' } })
      offer.status = 'transferred'
      offer.transferTxid = outcome.entry.txid
      await store.saveOffer(offer)
      return { offer, record, transferTxid: outcome.entry.txid }
    }

    const claim: ManagedAcceptanceClaim = {
      acceptanceFormat: 'dpp-managed-acceptance@1',
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
    const record = await signManagedAcceptance(claim, wallet.acceptanceSigner)
    const inspection = inspectManagedAcceptance(record, { custodians: [wallet.identityKey] })
    if (!inspection.structureValid || !inspection.signatureValid || inspection.failures.length > 0) throw new WriteRefused('acceptance-invalid', `the acceptance record does not inspect clean: ${inspection.failures.map((f) => f.detail).join('; ')}`)
    offer.status = 'accepted'
    offer.record = record
    await store.saveOffer(offer)

    const outcome = await writer.transfer({
      record: passport,
      holder,
      recipient,
      acceptance: record,
      eventData: { word: typeof offer.terms.word === 'string' ? offer.terms.word : 'Handed on' },
    })
    const mismatches = bindAcceptanceToState(record, outcome.state)
    if (mismatches.length > 0) throw new WriteRefused('acceptance-mismatch', `the record does not bind to the TRANSFER: ${mismatches.map((m) => m.detail).join('; ')}`)
    offer.status = 'transferred'
    offer.transferTxid = outcome.entry.txid
    await store.saveOffer(offer)
    return { offer, record, transferTxid: outcome.entry.txid }
  }

  /** The party that controls the passport now, resolved from the journal's holder name. */
  holderOf(passport: PassportRecord): Party {
    const { parties } = this.options
    const [scope, id] = passport.holder.party.split(':', 2)
    if (scope === 'brand') return parties.brand(id)
    if (scope === 'recipient') return parties.recipient(id)
    if (scope === 'member') return parties.member(id)
    throw new WriteRefused('holder-unknown', `the holder ${passport.holder.party} is not a managed identity this platform derives`)
  }
}
