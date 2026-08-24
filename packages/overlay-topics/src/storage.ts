import type { Collection, Db } from 'mongodb'

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
}

/**
 * Record store for ls_dpp. Abstract so tests (and the backend dev mode) can
 * run in memory; production uses Mongo via the overlay's lookup-service
 * factory.
 */
export interface DppRecordStore {
  insert: (record: DppRecord) => Promise<void>
  markSpent: (txid: string, outputIndex: number, spendingTxid: string) => Promise<void>
  delete: (txid: string, outputIndex: number) => Promise<void>
  findByPassport: (passportId: string) => Promise<DppRecord[]>
  findByUid: (uid: string) => Promise<DppRecord[]>
}

export class MongoDppStorage implements DppRecordStore {
  private readonly records: Collection<DppRecord>

  constructor(db: Db) {
    this.records = db.collection<DppRecord>('dppRecords')
    void this.records.createIndex({ passportId: 1 })
    void this.records.createIndex({ uid: 1 })
    void this.records.createIndex({ txid: 1, outputIndex: 1 }, { unique: true })
  }

  async insert(record: DppRecord): Promise<void> {
    await this.records.updateOne(
      { txid: record.txid, outputIndex: record.outputIndex },
      { $set: record },
      { upsert: true }
    )
  }

  async markSpent(txid: string, outputIndex: number, spendingTxid: string): Promise<void> {
    await this.records.updateOne(
      { txid, outputIndex },
      { $set: { spent: true, spendingTxid } }
    )
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    await this.records.deleteOne({ txid, outputIndex })
  }

  async findByPassport(passportId: string): Promise<DppRecord[]> {
    return await this.records.find({ passportId }).sort({ createdAt: 1 }).toArray()
  }

  async findByUid(uid: string): Promise<DppRecord[]> {
    return await this.records.find({ uid }).sort({ createdAt: 1 }).toArray()
  }
}

export class InMemoryDppStorage implements DppRecordStore {
  private readonly records = new Map<string, DppRecord>()

  private key(txid: string, outputIndex: number): string {
    return `${txid}.${outputIndex}`
  }

  async insert(record: DppRecord): Promise<void> {
    this.records.set(this.key(record.txid, record.outputIndex), record)
  }

  async markSpent(txid: string, outputIndex: number, spendingTxid: string): Promise<void> {
    const record = this.records.get(this.key(txid, outputIndex))
    if (record != null) {
      record.spent = true
      record.spendingTxid = spendingTxid
    }
  }

  async delete(txid: string, outputIndex: number): Promise<void> {
    this.records.delete(this.key(txid, outputIndex))
  }

  async findByPassport(passportId: string): Promise<DppRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.passportId === passportId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async findByUid(uid: string): Promise<DppRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.uid === uid)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
}
