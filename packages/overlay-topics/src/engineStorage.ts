import { Utils } from '@bsv/sdk'
import type { AppliedTransaction, Output, Storage } from '@bsv/overlay'
import type { Collection, Db } from 'mongodb'

/**
 * The overlay Engine's own storage, which is a different thing from
 * `DppRecordStore` in storage.ts.
 *
 * The engine tracks admitted UTXOs, their spend state, their consumption
 * graph and the BEEF each transaction arrived in. `ls_dpp` separately keeps
 * the passport index it answers lookups from. `@bsv/overlay` ships only a
 * knex implementation of this interface, whose migration chain is MySQL-only
 * (`INSERT IGNORE` and `longblob` in
 * node_modules/@bsv/overlay/src/storage/knex/migrations/2024-07-17-001-transactions.ts),
 * so a MySQL instance would have to be provisioned beside the service purely
 * for the engine. The DPP programme already runs one database. These two
 * implementations keep it that way.
 *
 * Semantics mirror KnexStorage exactly, including its quirks:
 * - `insertOutput` never overwrites an existing (txid, outputIndex, topic).
 * - BEEF is stored once per txid, not per output.
 * - `deleteOutput` ignores the topic argument when deleting, and drops the
 *   BEEF only when the txid has no outputs left.
 *
 * Both also implement `RetractableStorage`: two operations the upstream
 * interface lacks and `POST /retract` needs, undoing a spend mark and
 * forgetting an applied transaction, so a retracted phantom state leaves the
 * real tip a tip and can be announced again if the network later takes it.
 */

/**
 * The engine storage plus what a retraction needs. The upstream `Storage`
 * only ever marks an output spent, because the Engine's own eviction prunes a
 * consumed lineage whole and never restores one. Retraction restores one, so
 * it needs the inverse. Since `@bsv/overlay` 2.3.1 the interface itself
 * declares the optional `deleteAppliedTransaction(txid, topic)`, which the
 * Engine uses to evict unproven admissions it has stopped waiting for, and
 * the same member serves retraction here; both implementations below provide
 * it. `markUTXOAsUnspent` stays this package's own. Both are optional so a
 * foreign `Storage` still fits; without them the retraction route says which
 * repair it could not make.
 */
export interface RetractableStorage extends Storage {
  /** Clear the spent flag on an output whose spender was retracted. */
  markUTXOAsUnspent?: (txid: string, outputIndex: number, topic: string) => Promise<void>
}

/** One stored engine output. BEEF lives in the transactions map, keyed by txid. */
interface StoredOutput {
  txid: string
  outputIndex: number
  /** base64, because a Mongo round trip of a number[] is neither small nor typed. */
  outputScript: string
  satoshis: number
  topic: string
  spent: boolean
  outputsConsumed: Array<{ txid: string; outputIndex: number }>
  consumedBy: Array<{ txid: string; outputIndex: number }>
  blockHeight?: number
  score?: number
}

interface StoredTransaction {
  txid: string
  /** base64 BEEF. */
  beef: string
}

interface StoredApplied {
  txid: string
  topic: string
}

interface StoredInteraction {
  host: string
  topic: string
  since: number
}

function toOutput(stored: StoredOutput, beef?: string): Output {
  const output: Output = {
    txid: stored.txid,
    outputIndex: stored.outputIndex,
    outputScript: Utils.toArray(stored.outputScript, 'base64'),
    satoshis: stored.satoshis,
    topic: stored.topic,
    spent: stored.spent,
    outputsConsumed: stored.outputsConsumed,
    consumedBy: stored.consumedBy,
  }
  if (stored.blockHeight != null) output.blockHeight = stored.blockHeight
  if (stored.score != null) output.score = stored.score
  if (beef != null) output.beef = Utils.toArray(beef, 'base64')
  return output
}

function fromOutput(output: Output): StoredOutput {
  const stored: StoredOutput = {
    txid: output.txid,
    outputIndex: Number(output.outputIndex),
    outputScript: Utils.toBase64(output.outputScript),
    satoshis: Number(output.satoshis),
    topic: output.topic,
    spent: output.spent,
    outputsConsumed: output.outputsConsumed ?? [],
    consumedBy: output.consumedBy ?? [],
  }
  if (output.blockHeight != null) stored.blockHeight = output.blockHeight
  if (output.score != null) stored.score = output.score
  return stored
}

const outpointKey = (txid: string, outputIndex: number, topic: string): string =>
  `${txid}.${outputIndex}.${topic}`

/** Engine storage in memory: for tests, local runs and the offline rehearsal. */
export class InMemoryOverlayStorage implements RetractableStorage {
  private readonly outputs = new Map<string, StoredOutput>()
  private readonly transactions = new Map<string, string>()
  private readonly applied = new Set<string>()
  private readonly interactions = new Map<string, number>()

  async insertOutput(utxo: Output): Promise<void> {
    const key = outpointKey(utxo.txid, Number(utxo.outputIndex), utxo.topic)
    if (!this.outputs.has(key)) this.outputs.set(key, fromOutput(utxo))
    if (utxo.beef != null && !this.transactions.has(utxo.txid)) {
      this.transactions.set(utxo.txid, Utils.toBase64(utxo.beef))
    }
  }

  async findOutput(
    txid: string,
    outputIndex: number,
    topic?: string,
    spent?: boolean,
    includeBEEF = false
  ): Promise<Output | null> {
    for (const stored of this.outputs.values()) {
      if (stored.txid !== txid || stored.outputIndex !== outputIndex) continue
      if (topic != null && stored.topic !== topic) continue
      if (spent != null && stored.spent !== spent) continue
      return toOutput(stored, includeBEEF ? this.transactions.get(txid) : undefined)
    }
    return null
  }

  async findOutputsByOutpoints(
    outpoints: Array<{ txid: string; outputIndex: number }>,
    includeBEEF = false
  ): Promise<Output[]> {
    const wanted = new Set(outpoints.map((o) => `${o.txid}.${o.outputIndex}`))
    const found: Output[] = []
    for (const stored of this.outputs.values()) {
      if (!wanted.has(`${stored.txid}.${stored.outputIndex}`)) continue
      found.push(toOutput(stored, includeBEEF ? this.transactions.get(stored.txid) : undefined))
    }
    return found
  }

  async findOutputsForTransaction(txid: string, includeBEEF = false): Promise<Output[]> {
    const beef = includeBEEF ? this.transactions.get(txid) : undefined
    return [...this.outputs.values()]
      .filter((stored) => stored.txid === txid)
      .map((stored) => toOutput(stored, beef))
  }

  async findUTXOsForTopic(
    topic: string,
    since?: number,
    limit?: number,
    includeBEEF = false
  ): Promise<Output[]> {
    let rows = [...this.outputs.values()].filter(
      (stored) => stored.topic === topic && !stored.spent
    )
    if (since != null && since > 0) rows = rows.filter((stored) => (stored.score ?? 0) >= since)
    rows.sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    if (limit != null && limit > 0) rows = rows.slice(0, limit)
    return rows.map((stored) =>
      toOutput(stored, includeBEEF ? this.transactions.get(stored.txid) : undefined)
    )
  }

  async deleteOutput(txid: string, outputIndex: number, _topic: string): Promise<void> {
    for (const [key, stored] of this.outputs) {
      if (stored.txid === txid && stored.outputIndex === outputIndex) this.outputs.delete(key)
    }
    const remaining = [...this.outputs.values()].some((stored) => stored.txid === txid)
    if (!remaining) this.transactions.delete(txid)
  }

  async markUTXOAsSpent(txid: string, outputIndex: number, topic: string): Promise<void> {
    const stored = this.outputs.get(outpointKey(txid, outputIndex, topic))
    if (stored != null) stored.spent = true
  }

  async markUTXOAsUnspent(txid: string, outputIndex: number, topic: string): Promise<void> {
    const stored = this.outputs.get(outpointKey(txid, outputIndex, topic))
    if (stored != null) stored.spent = false
  }

  async updateConsumedBy(
    txid: string,
    outputIndex: number,
    topic: string,
    consumedBy: Array<{ txid: string; outputIndex: number }>
  ): Promise<void> {
    const stored = this.outputs.get(outpointKey(txid, outputIndex, topic))
    if (stored != null) stored.consumedBy = consumedBy
  }

  async updateTransactionBEEF(txid: string, beef: number[]): Promise<void> {
    this.transactions.set(txid, Utils.toBase64(beef))
  }

  async updateOutputBlockHeight(
    txid: string,
    outputIndex: number,
    topic: string,
    blockHeight: number
  ): Promise<void> {
    const stored = this.outputs.get(outpointKey(txid, outputIndex, topic))
    if (stored != null) stored.blockHeight = blockHeight
  }

  async insertAppliedTransaction(tx: AppliedTransaction): Promise<void> {
    this.applied.add(`${tx.txid}.${tx.topic}`)
  }

  async doesAppliedTransactionExist(tx: AppliedTransaction): Promise<boolean> {
    return this.applied.has(`${tx.txid}.${tx.topic}`)
  }

  async deleteAppliedTransaction(txid: string, topic: string): Promise<void> {
    this.applied.delete(`${txid}.${topic}`)
  }

  async updateLastInteraction(host: string, topic: string, since: number): Promise<void> {
    this.interactions.set(`${host}.${topic}`, since)
  }

  async getLastInteraction(host: string, topic: string): Promise<number> {
    return this.interactions.get(`${host}.${topic}`) ?? 0
  }
}

/** Engine storage on MongoDB: the hosted deployment's persistence. */
export class MongoOverlayStorage implements RetractableStorage {
  private readonly outputs: Collection<StoredOutput>
  private readonly transactions: Collection<StoredTransaction>
  private readonly applied: Collection<StoredApplied>
  private readonly interactions: Collection<StoredInteraction>

  constructor(db: Db, prefix = 'overlay') {
    this.outputs = db.collection<StoredOutput>(`${prefix}Outputs`)
    this.transactions = db.collection<StoredTransaction>(`${prefix}Transactions`)
    this.applied = db.collection<StoredApplied>(`${prefix}AppliedTransactions`)
    this.interactions = db.collection<StoredInteraction>(`${prefix}Interactions`)
  }

  /** Call once at boot; index creation is not on any request path. */
  async ensureIndexes(): Promise<void> {
    await this.outputs.createIndex(
      { txid: 1, outputIndex: 1, topic: 1 },
      { unique: true, name: 'outpoint_topic' }
    )
    await this.outputs.createIndex({ txid: 1, outputIndex: 1 }, { name: 'outpoint' })
    await this.outputs.createIndex({ topic: 1, spent: 1, score: 1 }, { name: 'topic_spent_score' })
    await this.transactions.createIndex({ txid: 1 }, { unique: true, name: 'txid' })
    await this.applied.createIndex({ txid: 1, topic: 1 }, { unique: true, name: 'applied' })
    await this.interactions.createIndex(
      { host: 1, topic: 1 },
      { unique: true, name: 'host_topic' }
    )
  }

  private async beefFor(txids: string[]): Promise<Map<string, string>> {
    if (txids.length === 0) return new Map()
    const rows = await this.transactions.find({ txid: { $in: txids } }).toArray()
    return new Map(rows.map((row) => [row.txid, row.beef]))
  }

  async insertOutput(utxo: Output): Promise<void> {
    const stored = fromOutput(utxo)
    // $setOnInsert only: an output already admitted is never rewritten, which
    // is what KnexStorage does with its existence check.
    await this.outputs.updateOne(
      { txid: stored.txid, outputIndex: stored.outputIndex, topic: stored.topic },
      { $setOnInsert: stored },
      { upsert: true }
    )
    if (utxo.beef != null) {
      await this.transactions.updateOne(
        { txid: stored.txid },
        { $setOnInsert: { txid: stored.txid, beef: Utils.toBase64(utxo.beef) } },
        { upsert: true }
      )
    }
  }

  async findOutput(
    txid: string,
    outputIndex: number,
    topic?: string,
    spent?: boolean,
    includeBEEF = false
  ): Promise<Output | null> {
    const filter: Record<string, unknown> = { txid, outputIndex }
    if (topic != null) filter.topic = topic
    if (spent != null) filter.spent = spent
    const stored = await this.outputs.findOne(filter)
    if (stored == null) return null
    const beef = includeBEEF ? (await this.beefFor([txid])).get(txid) : undefined
    return toOutput(stored, beef)
  }

  async findOutputsByOutpoints(
    outpoints: Array<{ txid: string; outputIndex: number }>,
    includeBEEF = false
  ): Promise<Output[]> {
    if (outpoints.length === 0) return []
    const stored = await this.outputs
      .find({ $or: outpoints.map((o) => ({ txid: o.txid, outputIndex: o.outputIndex })) })
      .toArray()
    if (!includeBEEF) return stored.map((row) => toOutput(row))
    const beef = await this.beefFor([...new Set(stored.map((row) => row.txid))])
    return stored.map((row) => toOutput(row, beef.get(row.txid)))
  }

  async findOutputsForTransaction(txid: string, includeBEEF = false): Promise<Output[]> {
    const stored = await this.outputs.find({ txid }).toArray()
    const beef = includeBEEF ? (await this.beefFor([txid])).get(txid) : undefined
    return stored.map((row) => toOutput(row, beef))
  }

  async findUTXOsForTopic(
    topic: string,
    since?: number,
    limit?: number,
    includeBEEF = false
  ): Promise<Output[]> {
    const filter: Record<string, unknown> = { topic, spent: false }
    if (since != null && since > 0) filter.score = { $gte: since }
    let cursor = this.outputs.find(filter).sort({ score: 1 })
    if (limit != null && limit > 0) cursor = cursor.limit(limit)
    const stored = await cursor.toArray()
    if (!includeBEEF) return stored.map((row) => toOutput(row))
    const beef = await this.beefFor([...new Set(stored.map((row) => row.txid))])
    return stored.map((row) => toOutput(row, beef.get(row.txid)))
  }

  async deleteOutput(txid: string, outputIndex: number, _topic: string): Promise<void> {
    await this.outputs.deleteMany({ txid, outputIndex })
    const remaining = await this.outputs.countDocuments({ txid }, { limit: 1 })
    if (remaining === 0) await this.transactions.deleteOne({ txid })
  }

  async markUTXOAsSpent(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.outputs.updateOne({ txid, outputIndex, topic }, { $set: { spent: true } })
  }

  async markUTXOAsUnspent(txid: string, outputIndex: number, topic: string): Promise<void> {
    await this.outputs.updateOne({ txid, outputIndex, topic }, { $set: { spent: false } })
  }

  async updateConsumedBy(
    txid: string,
    outputIndex: number,
    topic: string,
    consumedBy: Array<{ txid: string; outputIndex: number }>
  ): Promise<void> {
    await this.outputs.updateOne({ txid, outputIndex, topic }, { $set: { consumedBy } })
  }

  async updateTransactionBEEF(txid: string, beef: number[]): Promise<void> {
    await this.transactions.updateOne(
      { txid },
      { $set: { beef: Utils.toBase64(beef) } },
      { upsert: true }
    )
  }

  async updateOutputBlockHeight(
    txid: string,
    outputIndex: number,
    topic: string,
    blockHeight: number
  ): Promise<void> {
    await this.outputs.updateOne({ txid, outputIndex, topic }, { $set: { blockHeight } })
  }

  async insertAppliedTransaction(tx: AppliedTransaction): Promise<void> {
    await this.applied.updateOne(
      { txid: tx.txid, topic: tx.topic },
      { $setOnInsert: { txid: tx.txid, topic: tx.topic } },
      { upsert: true }
    )
  }

  async doesAppliedTransactionExist(tx: AppliedTransaction): Promise<boolean> {
    return (await this.applied.countDocuments(
      { txid: tx.txid, topic: tx.topic },
      { limit: 1 }
    )) > 0
  }

  async deleteAppliedTransaction(txid: string, topic: string): Promise<void> {
    await this.applied.deleteOne({ txid, topic })
  }

  async updateLastInteraction(host: string, topic: string, since: number): Promise<void> {
    await this.interactions.updateOne({ host, topic }, { $set: { since } }, { upsert: true })
  }

  async getLastInteraction(host: string, topic: string): Promise<number> {
    const row = await this.interactions.findOne({ host, topic })
    return row?.since ?? 0
  }
}
