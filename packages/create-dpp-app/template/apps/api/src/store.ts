// The application's records and its journal. The journal is the single
// source of truth for every write: each state is recorded before it is acted
// on, with the index's answer, the network's answer and the proof, so a retry
// continues an operation instead of building a second transaction. The
// worker loop reads the same records to find what is still owed.
//
// Two implementations: MongoDB for a running platform, memory for tests.
import type { Collection, Db } from 'mongodb'
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
  timestamp: string
  actor: string
  controllerKey: string
  payloadPublic: string
  /** The owner tier the state commits to: only the hash goes on chain; the ciphertext lives here, nowhere else. */
  ownerTier?: { hash: string; ciphertext: string }
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

export interface Store {
  getPassport(passportId: string): Promise<PassportRecord | undefined>
  listPassports(filter?: { brandId?: string }): Promise<PassportRecord[]>
  savePassport(record: PassportRecord): Promise<void>
  /** Only for a passport whose genesis was never written: a journal with states is never deleted. */
  deletePassport(passportId: string): Promise<void>
  getOffer(requestId: string): Promise<OfferRecord | undefined>
  listOffers(filter?: { passportId?: string; brandId?: string; status?: OfferRecord['status'] }): Promise<OfferRecord[]>
  saveOffer(record: OfferRecord): Promise<void>
  /** `passportId` selects the claims about that passport: a historical claim by its passport, an EPCIS lifecycle claim by any passport it binds. */
  listClaims(filter?: { passportId?: string; eventId?: string }): Promise<ClaimRecord[]>
  saveClaim(record: ClaimRecord): Promise<void>
  getBrand(id: string): Promise<BrandRecord | undefined>
  listBrands(ids?: string[]): Promise<BrandRecord[]>
  saveBrand(record: BrandRecord): Promise<void>
  recordSpend(spend: SpendRecord): Promise<void>
  spentSince(at: string): Promise<number>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function claimMatches(record: ClaimRecord, filter: { passportId?: string; eventId?: string }): boolean {
  if (filter.eventId != null && (!isEpcisLifecycleRecord(record) || record.eventId !== filter.eventId)) return false
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
  async savePassport(record: PassportRecord) {
    this.passports.set(record.passportId, clone(record))
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
  async saveOffer(record: OfferRecord) {
    this.offers.set(record.requestId, clone(record))
  }
  async listClaims(filter: { passportId?: string; eventId?: string } = {}) {
    return [...this.claims.values()].filter((c) => claimMatches(c, filter)).map(clone)
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
    this.spends.push(clone(spend))
  }
  async spentSince(at: string) {
    return this.spends.filter((s) => s.at >= at).reduce((sum, s) => sum + s.satoshis, 0)
  }
}

export class MongoStore implements Store {
  private passports: Collection<PassportRecord>
  private offers: Collection<OfferRecord>
  private claims: Collection<ClaimRecord>
  private brands: Collection<BrandRecord>
  private spends: Collection<SpendRecord>

  constructor(db: Db) {
    this.passports = db.collection<PassportRecord>('passports')
    this.offers = db.collection<OfferRecord>('offers')
    this.claims = db.collection<ClaimRecord>('claims')
    this.brands = db.collection<BrandRecord>('brands')
    this.spends = db.collection<SpendRecord>('spends')
  }

  async init(): Promise<void> {
    await this.passports.createIndex({ passportId: 1 }, { unique: true })
    await this.passports.createIndex({ brandId: 1 })
    await this.offers.createIndex({ requestId: 1 }, { unique: true })
    await this.offers.createIndex({ passportId: 1 })
    await this.claims.createIndex({ id: 1 }, { unique: true })
    await this.claims.createIndex({ passportId: 1 })
    await this.claims.createIndex({ boundPassports: 1 })
    await this.claims.createIndex({ eventId: 1 })
    await this.brands.createIndex({ id: 1 }, { unique: true })
    await this.spends.createIndex({ at: 1 })
  }

  private strip<T extends object>(doc: (T & { _id?: unknown }) | null): T | undefined {
    if (doc == null) return undefined
    const { _id: _ignored, ...rest } = doc
    return rest as T
  }

  async getPassport(passportId: string) {
    return this.strip(await this.passports.findOne({ passportId }))
  }
  async listPassports(filter: { brandId?: string } = {}) {
    const docs = await this.passports.find(filter.brandId == null ? {} : { brandId: filter.brandId }).sort({ createdAt: -1 }).toArray()
    return docs.map((d) => this.strip(d)!)
  }
  async savePassport(record: PassportRecord) {
    await this.passports.replaceOne({ passportId: record.passportId }, record, { upsert: true })
  }
  async deletePassport(passportId: string) {
    await this.passports.deleteOne({ passportId, states: { $size: 0 } })
  }
  async getOffer(requestId: string) {
    return this.strip(await this.offers.findOne({ requestId }))
  }
  async listOffers(filter: { passportId?: string; brandId?: string; status?: OfferRecord['status'] } = {}) {
    const query: Record<string, unknown> = {}
    if (filter.passportId != null) query.passportId = filter.passportId
    if (filter.brandId != null) query.brandId = filter.brandId
    if (filter.status != null) query.status = filter.status
    const docs = await this.offers.find(query).sort({ createdAt: -1 }).toArray()
    return docs.map((d) => this.strip(d)!)
  }
  async saveOffer(record: OfferRecord) {
    await this.offers.replaceOne({ requestId: record.requestId }, record, { upsert: true })
  }
  async listClaims(filter: { passportId?: string; eventId?: string } = {}) {
    const query: Record<string, unknown> = {}
    if (filter.passportId != null) query.$or = [{ passportId: filter.passportId }, { boundPassports: filter.passportId }]
    if (filter.eventId != null) query.eventId = filter.eventId
    const docs = await this.claims.find(query).sort({ createdAt: -1 }).toArray()
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
    await this.spends.insertOne(spend)
  }
  async spentSince(at: string) {
    const docs = await this.spends.find({ at: { $gte: at } }).toArray()
    return docs.reduce((sum, s) => sum + s.satoshis, 0)
  }
}
