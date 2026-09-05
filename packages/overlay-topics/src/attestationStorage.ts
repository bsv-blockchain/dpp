import type { Collection, Db, Filter } from 'mongodb'
import type { AnchorMetadata } from './attestationAnchor.js'

export interface AttestationRecord extends AnchorMetadata {
  txid: string
  outputIndex: number
  lockingKey: string
  createdAt: Date
}
export interface AttestationCursor { txid: string; outputIndex: number }
export interface AttestationQuery {
  issuer?: string
  subject?: string
  attestationId?: string
  digest?: string
  anchoredBy?: string
  attestationType?: string
  representation?: string
  mediaType?: string
  limit?: number
  after?: AttestationCursor
}
export interface AttestationStore {
  insert(record: AttestationRecord): Promise<void>
  delete(txid: string, outputIndex: number): Promise<void>
  find(query: AttestationQuery): Promise<AttestationRecord[]>
}
export const MAX_ATTESTATION_RESULTS = 500
export const DEFAULT_ATTESTATION_RESULTS = 100
export const ATTESTATION_SELECTORS = ['issuer', 'subject', 'attestationId', 'digest', 'anchoredBy', 'attestationType', 'representation', 'mediaType'] as const

export function validateAttestationQuery(value: unknown): AttestationQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('query must be an object')
  const query = value as Record<string, unknown>
  for (const [field, entry] of Object.entries(query)) {
    if (ATTESTATION_SELECTORS.includes(field as typeof ATTESTATION_SELECTORS[number])) {
      if (typeof entry !== 'string' || entry.length === 0 || Buffer.byteLength(entry) > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(entry)) throw new Error(`invalid query selector ${field}`)
    } else if (field !== 'limit' && field !== 'after') throw new Error(`unsupported query field ${field}`)
  }
  if (!ATTESTATION_SELECTORS.slice(0, 5).some(field => query[field] !== undefined)) throw new Error('query requires issuer, subject, attestationId, digest or anchoredBy')
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || (query.limit as number) < 1 || (query.limit as number) > MAX_ATTESTATION_RESULTS)) throw new Error('limit must be an integer from 1 to 500')
  if (query.after !== undefined) {
    const after = query.after as Record<string, unknown>
    if (!after || typeof after !== 'object' || Array.isArray(after) || Object.keys(after).sort().join(',') !== 'outputIndex,txid' || typeof after.txid !== 'string' || !/^[0-9a-f]{64}$/.test(after.txid) || !Number.isSafeInteger(after.outputIndex) || (after.outputIndex as number) < 0) throw new Error('after must be an exact transaction outpoint')
  }
  return value as AttestationQuery
}

function selectors(query: AttestationQuery): Record<string, string> {
  return Object.fromEntries(ATTESTATION_SELECTORS.filter(field => query[field] !== undefined).map(field => [field, query[field]!]))
}

function compare(a: AttestationCursor, b: AttestationCursor): number {
  return a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.outputIndex - b.outputIndex
}

export class InMemoryAttestationStorage implements AttestationStore {
  private readonly records = new Map<string, AttestationRecord>()

  async insert(record: AttestationRecord): Promise<void> {
    const key = `${record.txid}.${record.outputIndex}`
    if (!this.records.has(key)) this.records.set(key, { ...record })
  }
  async delete(txid: string, outputIndex: number): Promise<void> { this.records.delete(`${txid}.${outputIndex}`) }
  async find(value: AttestationQuery): Promise<AttestationRecord[]> {
    const query = validateAttestationQuery(value)
    const filter = Object.entries(selectors(query)) as Array<[keyof AnchorMetadata, string]>
    return [...this.records.values()]
      .filter(record => filter.every(([key, val]) => record[key] === val) && (!query.after || compare(record, query.after) > 0))
      .sort(compare).slice(0, query.limit ?? DEFAULT_ATTESTATION_RESULTS).map(record => ({ ...record }))
  }
}

export class MongoAttestationStorage implements AttestationStore {
  private readonly records: Collection<AttestationRecord>
  private ready?: Promise<void>
  constructor(db: Db) { this.records = db.collection<AttestationRecord>('attestationAnchorsV1') }

  private async ensureIndexes(): Promise<void> {
    this.ready ??= (async () => {
      await this.records.createIndex({ txid: 1, outputIndex: 1 }, { unique: true })
      for (const field of ATTESTATION_SELECTORS.slice(0, 5)) await this.records.createIndex({ [field]: 1, txid: 1, outputIndex: 1 })
    })().catch(error => { this.ready = undefined; throw error })
    await this.ready
  }
  async insert(record: AttestationRecord): Promise<void> {
    await this.ensureIndexes()
    await this.records.updateOne({ txid: record.txid, outputIndex: record.outputIndex }, { $setOnInsert: record }, { upsert: true })
  }
  async delete(txid: string, outputIndex: number): Promise<void> {
    await this.ensureIndexes()
    await this.records.deleteOne({ txid, outputIndex })
  }
  async find(value: AttestationQuery): Promise<AttestationRecord[]> {
    const query = validateAttestationQuery(value)
    await this.ensureIndexes()
    const filter: Filter<AttestationRecord> = selectors(query)
    if (query.after) filter.$or = [{ txid: { $gt: query.after.txid } }, { txid: query.after.txid, outputIndex: { $gt: query.after.outputIndex } }]
    return await this.records.find(filter).sort({ txid: 1, outputIndex: 1 }).limit(query.limit ?? DEFAULT_ATTESTATION_RESULTS).toArray()
  }
}
