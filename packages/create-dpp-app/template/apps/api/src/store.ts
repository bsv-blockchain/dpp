// The application's records and its journal. The journal is the single
// source of truth for every write: each state is recorded before it is acted
// on, with the index's answer, the network's answer and the proof, so a retry
// continues an operation instead of building a second transaction. The
// worker loop reads the same records to find what is still owed.
//
// Two implementations: MongoDB for a running platform, memory for tests.
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { MongoServerError, type Collection, type Db, type ObjectId } from 'mongodb'
import type { ManagedAcceptanceRecord, SignedLifecycleClaim } from '@bsv/dpp-protocol'

export type IndexAnswer = 'pending' | 'admitted' | 'duplicate' | 'refused' | 'unauthorised' | 'unreachable' | 'not-asked'
export type NetworkAnswer = 'pending' | 'accepted' | 'refused' | 'unanswered' | 'not-sent' | 'dry-run'

export interface StateEntry {
  op: 'ISSUE' | 'UPDATE' | 'TRANSFER' | 'RETIRE'
  txid: string
  outputIndex: number
  /** The transaction as hex, and the BEEF the index and a reader take, base64. */
  rawTx: string
  beef: string
  /** The original BEEF once beef has been enriched with a proof. */
  sentBeef?: string
  /** Recovery data for the incomplete operation. A completed entry needs only its ordinary journal fields. */
  nextHolder?: PassportRecord['holder']
  acceptance?: ManagedAcceptanceRecord
  walletReference?: string
  /** SHA-256 of the index base URL where this draft may have been announced. Older journals omit it. */
  draftIndexId?: string
  timestamp: string
  actor: string
  controllerKey: string
  payloadPublic: string
  /** The owner tier the state commits to: only the hash goes on chain; the ciphertext lives here, nowhere else. */
  ownerTier?: {
    hash: string
    ciphertext: string
    /** A transferred blob uses the giver's public identity key as the recipient wallet's decryption counterparty. */
    senderIdentityKey?: string
  }
  index: IndexAnswer
  refusal?: string
  network: NetworkAnswer
  proof?: { merklePath: string; blockHeight: number }
  proofPushed?: boolean
}

export interface PassportRecord {
  passportId: string
  brandId: string
  profile: string
  createdAt: string
  status: 'active' | 'retired'
  /** Who controls the passport now: the party name the platform derives the controller key for. */
  holder: { party: string; controllerKey: string }
  states: StateEntry[]
  /** Every acceptance record the platform signed for this passport, kept for its life: a reader needs it to check a transfer. */
  acceptanceRecords: ManagedAcceptanceRecord[]
}

export interface OfferRecord {
  requestId: string
  passportId: string
  brandId: string
  mechanism: 'claim-code' | 'named-recipient'
  /** SHA-256 of the claim code, hex; the code itself is shown once and never stored. */
  claimCodeHash?: string
  recipientIdentityKey?: string
  terms: Record<string, unknown>
  termsDigest: string
  holderIdentityKey: string
  expectedPredecessor: { txid: string; outputIndex: number }
  createdAt: string
  expiresAt: string
  status: 'open' | 'accepted' | 'transferred' | 'declined' | 'withdrawn' | 'expired'
  record?: ManagedAcceptanceRecord
  transferTxid?: string
}

/**
 * A lifecycle claim this application holds. Two formats, told apart by
 * `claimFormat`: an EPCIS lifecycle claim (`dpp-epcis-lifecycle@1`), which is
 * what this application issues, kept as its exact signed bytes; and a
 * historical native claim (`dpp-lifecycle-v1`), which this application issued
 * before it moved to EPCIS lifecycle claims and still reads. A record written
 * before the move carries no `claimFormat` and is a historical native claim.
 */
export type ClaimRecord = EpcisLifecycleClaimRecord | HistoricalClaimRecord

export interface ClaimRegistryAnswer {
  url: string
  status: number
  accepted: boolean
  attestationId?: string
  detail?: string
}

export interface EpcisLifecycleClaimRecord {
  id: string
  claimFormat: 'dpp-epcis-lifecycle@1'
  /** The passport the claim was issued from; it is one of `boundPassports`. */
  passportId: string
  /** Every passport a binding of the claim names. Which of them the event concerns, and how, is decided by verifying the claim. */
  boundPassports: string[]
  attestationId: string
  digest: string
  eventId: string
  eventType: string
  issuer: string
  issuedBy: string
  /** The exact RFC 8785 bytes of the signed claim, as UTF-8 text: what is verified, sent, anchored and exported. */
  bytes: string
  /** The retained EPCIS event the claim was issued from, when it was imported. */
  importedFrom?: { importId: string; pointer: string }
  registry?: ClaimRegistryAnswer
  createdAt: string
}

export interface HistoricalClaimRecord {
  id: string
  claimFormat?: 'dpp-lifecycle-v1'
  passportId: string
  issuer: string
  issuedBy: string
  claim: SignedLifecycleClaim
  registry?: ClaimRegistryAnswer
  createdAt: string
}

/** Whether a record holds an EPCIS lifecycle claim; every other record is a historical native claim. */
export const isEpcisLifecycleRecord = (record: ClaimRecord): record is EpcisLifecycleClaimRecord => record.claimFormat === 'dpp-epcis-lifecycle@1'

export interface BrandRecord {
  id: string
  name: string
  identityKey: string
  did: string
  createdAt: string
}

export interface SpendRecord {
  txid: string
  satoshis: number
  at: string
}

export interface ClaimFilter {
  passportId?: string
  eventId?: string | string[]
  attestationIds?: string[]
  limit?: number
}

type JournalChange = (current: PassportRecord | undefined) => PassportRecord | undefined

export const isInterrupted = (state: StateEntry): boolean =>
  state.network === 'pending' || state.network === 'unanswered' || state.network === 'refused' || state.network === 'not-sent'

export interface Store {
  getPassport(passportId: string): Promise<PassportRecord | undefined>
  listPassports(filter?: { brandId?: string }): Promise<PassportRecord[]>
  /** Whether the journal holds a passport whose identifier begins with this text, such as every item of one GTIN under this host. */
  anyPassportUnder(idPrefix: string): Promise<boolean>
  savePassport(record: PassportRecord): Promise<void>
  /** Apply a synchronous edit to the latest journal. Returning undefined removes it. The edit can run again on a concurrent revision. */
  changePassport(id: string, edit: JournalChange): Promise<PassportRecord | undefined>
  /** Only for a passport whose genesis was never written: a journal with states is never deleted. */
  deletePassport(passportId: string): Promise<void>
  getOffer(requestId: string): Promise<OfferRecord | undefined>
  listOffers(filter?: { passportId?: string; brandId?: string; status?: OfferRecord['status'] }): Promise<OfferRecord[]>
  createOpenOffer(record: OfferRecord): Promise<boolean>
  saveOffer(record: OfferRecord): Promise<void>
  changeOfferStatus(record: OfferRecord, expected: OfferRecord['status']): Promise<boolean>
  /** `passportId` selects the claims about that passport: a historical claim by its passport, an EPCIS lifecycle claim by any passport it binds. */
  listClaims(filter?: ClaimFilter): Promise<ClaimRecord[]>
  saveClaim(record: ClaimRecord): Promise<void>
  getBrand(id: string): Promise<BrandRecord | undefined>
  listBrands(ids?: string[]): Promise<BrandRecord[]>
  saveBrand(record: BrandRecord): Promise<void>
  recordSpend(spend: SpendRecord): Promise<void>
  spentSince(at: string): Promise<number>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function claimMatches(record: ClaimRecord, filter: ClaimFilter): boolean {
  if (filter.eventId != null) {
    if (!isEpcisLifecycleRecord(record)) return false
    const eventIds = Array.isArray(filter.eventId) ? filter.eventId : [filter.eventId]
    if (!eventIds.includes(record.eventId)) return false
  }
  if (filter.attestationIds != null && (!isEpcisLifecycleRecord(record) || !filter.attestationIds.includes(record.attestationId))) return false
  if (filter.passportId == null) return true
  return isEpcisLifecycleRecord(record) ? record.boundPassports.includes(filter.passportId) : record.passportId === filter.passportId
}

export class MemoryStore implements Store {
  private passports = new Map<string, PassportRecord>()
  private offers = new Map<string, OfferRecord>()
  private claims = new Map<string, ClaimRecord>()
  private brands = new Map<string, BrandRecord>()
  private spends: SpendRecord[] = []

  async getPassport(passportId: string) {
    const record = this.passports.get(passportId)
    return record == null ? undefined : clone(record)
  }
  async listPassports(filter: { brandId?: string } = {}) {
    return [...this.passports.values()].filter((p) => filter.brandId == null || p.brandId === filter.brandId).map(clone)
  }
  async anyPassportUnder(idPrefix: string) {
    return [...this.passports.keys()].some((passportId) => passportId.startsWith(idPrefix))
  }
  async savePassport(record: PassportRecord) {
    this.passports.set(record.passportId, clone(record))
  }
  async changePassport(id: string, edit: JournalChange) {
    const current = this.passports.get(id)
    const next = edit(current == null ? undefined : clone(current))
    if (next == null) this.passports.delete(id)
    else this.passports.set(id, clone(next))
    return next
  }
  async deletePassport(passportId: string) {
    this.passports.delete(passportId)
  }
  async getOffer(requestId: string) {
    const record = this.offers.get(requestId)
    return record == null ? undefined : clone(record)
  }
  async listOffers(filter: { passportId?: string; brandId?: string; status?: OfferRecord['status'] } = {}) {
    return [...this.offers.values()]
      .filter((o) => (filter.passportId == null || o.passportId === filter.passportId) && (filter.brandId == null || o.brandId === filter.brandId) && (filter.status == null || o.status === filter.status))
      .map(clone)
  }
  async createOpenOffer(record: OfferRecord) {
    if (this.offers.has(record.requestId) || [...this.offers.values()].some(held => held.passportId === record.passportId &&
      (held.status === 'open' || (held.status === 'accepted' && offerTipSlot(held) === offerTipSlot(record))))) return false
    this.offers.set(record.requestId, clone(record))
    return true
  }
  async saveOffer(record: OfferRecord) {
    this.offers.set(record.requestId, clone(record))
  }
  async changeOfferStatus(record: OfferRecord, expected: OfferRecord['status']) {
    if (this.offers.get(record.requestId)?.status !== expected) return false
    this.offers.set(record.requestId, clone(record))
    return true
  }
  async listClaims(filter: ClaimFilter = {}) {
    const matches: ClaimRecord[] = []
    for (const record of this.claims.values()) {
      if (claimMatches(record, filter)) matches.push(clone(record))
      if (filter.limit != null && matches.length >= filter.limit) break
    }
    return matches
  }
  async saveClaim(record: ClaimRecord) {
    this.claims.set(record.id, clone(record))
  }
  async getBrand(id: string) {
    const record = this.brands.get(id)
    return record == null ? undefined : clone(record)
  }
  async listBrands(ids?: string[]) {
    return [...this.brands.values()].filter((b) => ids == null || ids.includes(b.id)).map(clone)
  }
  async saveBrand(record: BrandRecord) {
    this.brands.set(record.id, clone(record))
  }
  async recordSpend(spend: SpendRecord) {
    if (!this.spends.some((held) => held.txid === spend.txid)) this.spends.push(clone(spend))
  }
  async spentSince(at: string) {
    return this.spends.filter((s) => s.at >= at).reduce((sum, s) => sum + s.satoshis, 0)
  }
}

// The existing unique index accepts multiple keys on an open offer. Its passport key
// blocks other opens. Its outpoint key persists through signing until transfer settles.
const offerTipSlot = (offer: OfferRecord): string =>
  JSON.stringify([offer.passportId, offer.expectedPredecessor.txid, offer.expectedPredecessor.outputIndex])

export class MongoStore implements Store {
  private passports: Collection<PassportRecord & { _journalRevision?: string }>
  private offers: Collection<OfferRecord & { _openSlot?: string | string[] }>
  private claims: Collection<ClaimRecord>
  private brands: Collection<BrandRecord>
  private spends: Collection<SpendRecord & { _id: string | ObjectId }>

  constructor(db: Db) {
    this.passports = db.collection<PassportRecord & { _journalRevision?: string }>('passports')
    this.offers = db.collection<OfferRecord & { _openSlot?: string | string[] }>('offers')
    this.claims = db.collection<ClaimRecord>('claims')
    this.brands = db.collection<BrandRecord>('brands')
    this.spends = db.collection<SpendRecord & { _id: string | ObjectId }>('spends')
  }

  async init(): Promise<void> {
    await this.passports.createIndex({ passportId: 1 }, { unique: true })
    await this.passports.createIndex({ brandId: 1 })
    await this.offers.createIndex({ requestId: 1 }, { unique: true })
    await this.offers.createIndex({ passportId: 1 })
    await this.offers.createIndex({ _openSlot: 1 }, { unique: true, sparse: true })
    await this.claims.createIndex({ id: 1 }, { unique: true })
    await this.claims.createIndex({ passportId: 1 })
    await this.claims.createIndex({ boundPassports: 1 })
    await this.claims.createIndex({ eventId: 1 })
    await this.claims.createIndex({ attestationId: 1 })
    await this.brands.createIndex({ id: 1 }, { unique: true })
    await this.spends.createIndex({ at: 1 })
  }

  private strip<T extends object>(doc: (T & { _id?: unknown }) | null): T | undefined {
    if (doc == null) return undefined
    const { _id: _ignored, _journalRevision: _revision, _openSlot: _slot, ...rest } = doc as T & { _id?: unknown; _journalRevision?: string; _openSlot?: string | string[] }
    return rest as T
  }

  async getPassport(passportId: string) {
    return this.strip(await this.passports.findOne({ passportId }))
  }
  async listPassports(filter: { brandId?: string } = {}) {
    const docs = await this.passports.find(filter.brandId == null ? {} : { brandId: filter.brandId }).sort({ createdAt: -1 }).toArray()
    return docs.map((d) => this.strip(d)!)
  }
  async anyPassportUnder(idPrefix: string) {
    // A range over the unique index on passportId: every identifier that begins with the prefix sorts from it to it followed by the highest code point.
    return (await this.passports.findOne({ passportId: { $gte: idPrefix, $lt: `${idPrefix}\u{10ffff}` } }, { projection: { _id: 1 } })) != null
  }
  async savePassport(record: PassportRecord) {
    await this.passports.replaceOne({ passportId: record.passportId }, { ...record, _journalRevision: randomUUID() }, { upsert: true })
  }
  async changePassport(passportId: string, edit: JournalChange) {
    for (;;) {
      const saved = await this.passports.findOne({ passportId })
      const current = this.strip(saved)
      const next = edit(current == null ? undefined : clone(current))
      if (isDeepStrictEqual(current, next)) return next
      if (saved == null) {
        if (next == null) return undefined
        try {
          await this.passports.insertOne({ ...next, _journalRevision: randomUUID() })
          return next
        } catch (cause) {
          if (cause instanceof MongoServerError && cause.code === 11000) continue
          throw cause
        }
      }
      const version = { _id: saved._id, _journalRevision: saved._journalRevision ?? { $exists: false } }
      if (next == null) {
        if ((await this.passports.deleteOne(version)).deletedCount === 1) return undefined
      } else if ((await this.passports.replaceOne(version, { ...next, _journalRevision: randomUUID() })).matchedCount === 1) {
        return next
      }
    }
  }
  async deletePassport(passportId: string) {
    await this.passports.deleteOne({ passportId, states: { $size: 0 } })
  }
  async getOffer(requestId: string) {
    return this.strip(await this.offers.findOne({ requestId: { $eq: requestId } }))
  }
  async listOffers(filter: { passportId?: string; brandId?: string; status?: OfferRecord['status'] } = {}) {
    const query: Record<string, unknown> = {}
    if (filter.passportId != null) query.passportId = filter.passportId
    if (filter.brandId != null) query.brandId = filter.brandId
    if (filter.status != null) query.status = filter.status
    const docs = await this.offers.find(query).sort({ createdAt: -1 }).toArray()
    return docs.map((d) => this.strip(d)!)
  }
  async createOpenOffer(record: OfferRecord) {
    // Earlier stores and restored offers have no reservation field. They still hold their place.
    if (await this.offers.findOne({ passportId: record.passportId, $or: [
      { status: 'open' },
      { status: 'accepted', 'expectedPredecessor.txid': record.expectedPredecessor.txid, 'expectedPredecessor.outputIndex': record.expectedPredecessor.outputIndex },
    ] }, { projection: { _id: 1 } })) return false
    try {
      await this.offers.insertOne({ ...record, _openSlot: [record.passportId, offerTipSlot(record)] })
      return true
    } catch (cause) {
      if (cause instanceof MongoServerError && cause.code === 11000) return false
      throw cause
    }
  }
  async saveOffer(record: OfferRecord) {
    await this.offers.replaceOne({ requestId: record.requestId }, record, { upsert: true })
  }
  async changeOfferStatus(record: OfferRecord, expected: OfferRecord['status']) {
    const replacement = record.status === 'accepted' ? { ...record, _openSlot: offerTipSlot(record) } : record
    return (await this.offers.replaceOne({ requestId: record.requestId, status: expected }, replacement)).matchedCount === 1
  }
  async listClaims(filter: ClaimFilter = {}) {
    const query: Record<string, unknown> = {}
    if (filter.passportId != null) query.$or = [{ claimFormat: { $ne: 'dpp-epcis-lifecycle@1' }, passportId: filter.passportId }, { claimFormat: 'dpp-epcis-lifecycle@1', boundPassports: filter.passportId }]
    if (filter.eventId != null) query.eventId = Array.isArray(filter.eventId) ? { $in: filter.eventId } : filter.eventId
    if (filter.attestationIds != null) query.attestationId = { $in: filter.attestationIds }
    const cursor = this.claims.find(query).sort({ createdAt: -1, id: 1 })
    if (filter.limit != null) cursor.limit(filter.limit).maxTimeMS(30_000)
    const docs = await cursor.toArray()
    return docs.map((d) => this.strip<ClaimRecord>(d as ClaimRecord & { _id?: unknown })!).filter((c) => claimMatches(c, filter))
  }
  async saveClaim(record: ClaimRecord) {
    await this.claims.replaceOne({ id: record.id }, record, { upsert: true })
  }
  async getBrand(id: string) {
    return this.strip(await this.brands.findOne({ id }))
  }
  async listBrands(ids?: string[]) {
    const docs = await this.brands.find(ids == null ? {} : { id: { $in: ids } }).sort({ createdAt: 1 }).toArray()
    return docs.map((d) => this.strip(d)!)
  }
  async saveBrand(record: BrandRecord) {
    await this.brands.replaceOne({ id: record.id }, record, { upsert: true })
  }
  async recordSpend(spend: SpendRecord) {
    // Older rows have ObjectId keys. New rows use txid so concurrent recovery counts a send once.
    if (await this.spends.findOne({ txid: spend.txid }, { projection: { _id: 1 } })) return
    await this.spends.updateOne({ _id: spend.txid }, { $setOnInsert: spend }, { upsert: true })
  }
  async spentSince(at: string) {
    const docs = await this.spends.find({ at: { $gte: at } }).toArray()
    return docs.reduce((sum, s) => sum + s.satoshis, 0)
  }
}
