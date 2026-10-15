import type { Collection, Db, Filter } from 'mongodb'

/** One admitted UORA anchor, flattened for the queries `ls_uora_dpp` answers. */
export interface UoraAnchorRecord {
  txid: string
  outputIndex: number
  /** Lower-case hex SHA-256 of the attestation's canonical form. */
  digest: string
  attestationId: string
  /** The claiming party, `did:key`. The primary index: this is the DID-keyed lookup. */
  issuer: string
  /** The same key as hex, stored so a caller holding a chain key need not encode one. */
  issuerKey: string
  /** The passport id the claim is about. */
  subject: string
  uoraType: string
  /** The anchoring treasury the output names, checked against the locking key. */
  anchoredBy: string
  /** The anchoring service's per-attestation key, kept so attribution is auditable. */
  lockingKey: string
  createdAt: Date
}

/**
 * What a caller may select on. Every field is an exact match; there is no
 * prefix or regex search, deliberately, because an unanchored pattern over an
 * attacker-supplied index is the cheapest denial of service an overlay offers.
 */
export interface UoraAnchorQuery {
  issuer?: string
  issuerKey?: string
  subject?: string
  attestationId?: string
  digest?: string
  uoraType?: string
  anchoredBy?: string
  limit?: number
}

/** Answers stay bounded whatever the caller asks for. */
export const MAX_ANCHOR_RESULTS = 500

export interface UoraAnchorStore {
  insert: (record: UoraAnchorRecord) => Promise<void>
  delete: (txid: string, outputIndex: number) => Promise<void>
  find: (query: UoraAnchorQuery) => Promise<UoraAnchorRecord[]>
}

/** The selectors, minus the paging control, as a plain object. */
function selectors(query: UoraAnchorQuery): Array<[keyof UoraAnchorRecord, string]> {
  const pairs: Array<[keyof UoraAnchorRecord, string]> = []
  const fields = [
    'issuer',
    'issuerKey',
    'subject',
    'attestationId',
    'digest',
    'uoraType',
    'anchoredBy',
  ] as const
  for (const key of fields) {
    const value = query[key]
    if (typeof value === 'string' && value !== '') pairs.push([key, value])
  }
  return pairs
}

function bounded(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return MAX_ANCHOR_RESULTS
  return Math.min(Math.floor(limit), MAX_ANCHOR_RESULTS)
}

export class MongoUoraAnchorStorage implements UoraAnchorStore {
  private readonly anchors: Collection<UoraAnchorRecord>

  constructor(db: Db) {
    this.anchors = db.collection<UoraAnchorRecord>('uoraAnchors')
    void this.anchors.createIndex({ issuer: 1, createdAt: 1 })
    void this.anchors.createIndex({ subject: 1, createdAt: 1 })
    void this.anchors.createIndex({ attestationId: 1 })
    void this.anchors.createIndex({ digest: 1 })
    void this.anchors.createIndex({ anchoredBy: 1, createdAt: 1 })
    void this.anchors.createIndex({ txid: 1, outputIndex: 1 }, { unique: true })
  }

  async insert(record: UoraAnchorRecord): Promise<void> {
    await this.anchors.updateOne(
      { txid: record.txid, outputIndex: record.outputIndex },
      { $set: record },
      { upsert: true }
    )
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    await this.anchors.deleteOne({ txid, outputIndex })
  }

  async find(query: UoraAnchorQuery): Promise<UoraAnchorRecord[]> {
    const filter = Object.fromEntries(selectors(query)) as Filter<UoraAnchorRecord>
    return await this.anchors
      .find(filter)
      .sort({ createdAt: 1 })
      .limit(bounded(query.limit))
      .toArray()
  }
}

export class InMemoryUoraAnchorStorage implements UoraAnchorStore {
  private readonly anchors = new Map<string, UoraAnchorRecord>()

  private key(txid: string, outputIndex: number): string {
    return `${txid}.${outputIndex}`
  }

  async insert(record: UoraAnchorRecord): Promise<void> {
    this.anchors.set(this.key(record.txid, record.outputIndex), record)
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    this.anchors.delete(this.key(txid, outputIndex))
  }

  async find(query: UoraAnchorQuery): Promise<UoraAnchorRecord[]> {
    const pairs = selectors(query)
    return [...this.anchors.values()]
      .filter((record) => pairs.every(([field, value]) => record[field] === value))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, bounded(query.limit))
  }
}
