import type { Collection, Db, Filter } from 'mongodb'

/** One indexed DPP state (admitted output, kept after spend as history). */
export interface DppRecord {
  txid: string
  outputIndex: number
  passportId: string
  /** Chip UID from the payload's data-carrier property; '' when absent. */
  uid: string
  op: string
  timestamp: string
  previousTxid: string
  spent: boolean
  /** txid of the state that spent this one; '' while unspent. */
  spendingTxid: string
  createdAt: Date
  /**
   * The store's own insertion sequence: assigned once, at insert, and never
   * rewritten. It is the order `spec/portable-evidence.md` section 1 pages by,
   * so two readers of one snapshot receive the same pages and a cursor names
   * a position that a concurrent insert cannot shift. Rows written before the
   * field existed are numbered at boot in createdAt, txid, outputIndex order,
   * which is the order the bounded lookup has always answered them in.
   */
  sequence: number
}

/** What the lookup service hands the store; the store assigns `sequence`. */
export type DppRecordInput = Omit<DppRecord, 'sequence'>

/** Which records a page or an export is about: one of the two keys, non-empty. */
export interface RecordSelector {
  passportId?: string
  uid?: string
}

/** The sequences a page reads: after < sequence <= upTo. */
export interface SequenceRange {
  after: number
  upTo: number
}

/**
 * Record store for ls_dpp. Abstract so tests (and the backend dev mode) can
 * run in memory; production uses Mongo via the overlay's lookup-service
 * factory.
 */
export interface DppRecordStore {
  insert: (record: DppRecordInput) => Promise<void>
  markSpent: (txid: string, outputIndex: number, spendingTxid: string) => Promise<void>
  /**
   * Undo `markSpent`: the state that spent this one was retracted, an announced
   * transaction the network refused (`POST /retract`), so this one is the tip
   * again.
   */
  markUnspent: (txid: string, outputIndex: number) => Promise<void>
  delete: (txid: string, outputIndex: number) => Promise<void>
  findByPassport: (passportId: string) => Promise<DppRecord[]>
  findByUid: (uid: string) => Promise<DppRecord[]>
  /**
   * The highest sequence assigned so far, 0 when nothing was ever inserted:
   * what a snapshot pins. A deleted row's sequence stays assigned, so the
   * answer never goes backwards.
   */
  highestSequence: () => Promise<number>
  /**
   * The records matching the selector whose sequence lies in the range,
   * ascending by sequence, at most `limit` of them. The one query a page is
   * made of, so both stores answer it from an index rather than a scan.
   */
  findPage: (selector: RecordSelector, range: SequenceRange, limit: number) => Promise<DppRecord[]>
}

/**
 * The one accepted spelling of a selector: exactly one key, a non-empty string.
 * Checked in the store and not only at the HTTP handler, because the Mongo
 * store would run whatever object it is handed as a filter.
 */
export function selectorFilter(selector: RecordSelector): { passportId: string } | { uid: string } {
  const passportId = typeof selector.passportId === 'string' && selector.passportId !== '' ? selector.passportId : undefined
  const uid = typeof selector.uid === 'string' && selector.uid !== '' ? selector.uid : undefined
  if (passportId != null && uid == null) return { passportId }
  if (uid != null && passportId == null) return { uid }
  throw new Error('selector must name exactly one of passportId or uid, non-empty')
}

interface SequenceCounter {
  _id: string
  value: number
}

const COUNTER_ID = 'dppRecords'

export class MongoDppStorage implements DppRecordStore {
  private readonly records: Collection<DppRecord>
  private readonly counters: Collection<SequenceCounter>
  private ready?: Promise<void>

  constructor(db: Db) {
    this.records = db.collection<DppRecord>('dppRecords')
    this.counters = db.collection<SequenceCounter>('dppCounters')
  }

  /**
   * Indexes, and the one migration this store has ever needed: rows written
   * before `sequence` existed are numbered in createdAt, txid, outputIndex
   * order, so every row has a position before the first page is served and the
   * pages of an old deployment read in the order its lookups always answered.
   * Runs once per process on first use, and `main()` awaits it at boot so the
   * numbering never races a request. Idempotent: a second boot finds nothing
   * to number.
   */
  async ensureReady(): Promise<void> {
    this.ready ??= (async () => {
      await this.records.createIndex({ passportId: 1, sequence: 1 })
      await this.records.createIndex({ uid: 1, sequence: 1 })
      await this.records.createIndex({ txid: 1, outputIndex: 1 }, { unique: true })
      const legacy = this.records
        .find({ sequence: { $exists: false } })
        .sort({ createdAt: 1, txid: 1, outputIndex: 1 })
      for await (const row of legacy) {
        const sequence = await this.nextSequence()
        // The filter repeats the existence test so a row a concurrent insert
        // numbered in the meantime keeps the number it was given.
        await this.records.updateOne(
          { txid: row.txid, outputIndex: row.outputIndex, sequence: { $exists: false } },
          { $set: { sequence } }
        )
      }
    })().catch((error: unknown) => {
      this.ready = undefined
      throw error
    })
    await this.ready
  }

  /** One atomic increment per insert: the counter is the order, gaps included. */
  private async nextSequence(): Promise<number> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: COUNTER_ID },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' }
    )
    if (counter == null) throw new Error('the sequence counter did not answer')
    return counter.value
  }

  async insert(record: DppRecordInput): Promise<void> {
    await this.ensureReady()
    // The sequence is allotted before the row is written, so a snapshot taken
    // between the two may pin a number whose row lands a moment later. The
    // Engine admits one transaction at a time per request, so the window is
    // the width of one write; a page that has already passed that position
    // does not go back for it, and the next snapshot has it.
    const sequence = await this.nextSequence()
    await this.records.updateOne(
      { txid: record.txid, outputIndex: record.outputIndex },
      // $setOnInsert: a re-admitted output keeps the position it was first
      // given, and only its other fields are refreshed.
      { $set: record, $setOnInsert: { sequence } },
      { upsert: true }
    )
  }

  async markSpent(txid: string, outputIndex: number, spendingTxid: string): Promise<void> {
    await this.ensureReady()
    await this.records.updateOne(
      { txid, outputIndex },
      { $set: { spent: true, spendingTxid } }
    )
  }

  async markUnspent(txid: string, outputIndex: number): Promise<void> {
    await this.ensureReady()
    await this.records.updateOne({ txid, outputIndex }, { $set: { spent: false, spendingTxid: '' } })
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    await this.ensureReady()
    await this.records.deleteOne({ txid, outputIndex })
  }

  async findByPassport(passportId: string): Promise<DppRecord[]> {
    await this.ensureReady()
    return await this.records.find({ passportId }).sort({ sequence: 1 }).toArray()
  }

  async findByUid(uid: string): Promise<DppRecord[]> {
    await this.ensureReady()
    return await this.records.find({ uid }).sort({ sequence: 1 }).toArray()
  }

  async highestSequence(): Promise<number> {
    await this.ensureReady()
    const counter = await this.counters.findOne({ _id: COUNTER_ID })
    return counter?.value ?? 0
  }

  async findPage(selector: RecordSelector, range: SequenceRange, limit: number): Promise<DppRecord[]> {
    await this.ensureReady()
    const filter: Filter<DppRecord> = {
      ...selectorFilter(selector),
      sequence: { $gt: range.after, $lte: range.upTo },
    }
    return await this.records.find(filter).sort({ sequence: 1 }).limit(limit).toArray()
  }
}

export class InMemoryDppStorage implements DppRecordStore {
  private readonly records = new Map<string, DppRecord>()
  private assigned = 0

  private key(txid: string, outputIndex: number): string {
    return `${txid}.${outputIndex}`
  }

  async insert(record: DppRecordInput): Promise<void> {
    const key = this.key(record.txid, record.outputIndex)
    // As the Mongo store: a re-admitted output keeps its first position.
    const sequence = this.records.get(key)?.sequence ?? ++this.assigned
    this.records.set(key, { ...record, sequence })
  }

  async markSpent(txid: string, outputIndex: number, spendingTxid: string): Promise<void> {
    const record = this.records.get(this.key(txid, outputIndex))
    if (record != null) {
      record.spent = true
      record.spendingTxid = spendingTxid
    }
  }

  async markUnspent(txid: string, outputIndex: number): Promise<void> {
    const record = this.records.get(this.key(txid, outputIndex))
    if (record != null) {
      record.spent = false
      record.spendingTxid = ''
    }
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    this.records.delete(this.key(txid, outputIndex))
  }

  async findByPassport(passportId: string): Promise<DppRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.passportId === passportId)
      .sort((a, b) => a.sequence - b.sequence)
  }

  async findByUid(uid: string): Promise<DppRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.uid === uid)
      .sort((a, b) => a.sequence - b.sequence)
  }

  async highestSequence(): Promise<number> {
    return this.assigned
  }

  async findPage(selector: RecordSelector, range: SequenceRange, limit: number): Promise<DppRecord[]> {
    const filter = selectorFilter(selector)
    const matches = (r: DppRecord): boolean =>
      'passportId' in filter ? r.passportId === filter.passportId : r.uid === filter.uid
    return [...this.records.values()]
      .filter((r) => matches(r) && r.sequence > range.after && r.sequence <= range.upTo)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
  }
}
