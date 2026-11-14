// The MongoDB storage adapter for the EPCIS exchange.
//
// `@bsv/dpp-credentials/epcis-exchange` never opens a database. It is handed
// six methods and builds import, pull, export and recovery on them. This file
// is those six methods over MongoDB, and nothing else: it holds no EPCIS
// logic of its own.
//
// The hard promise is the batch: `commit` applies every write or none, also
// across a crash. The reference deployment runs one MongoDB node, where a
// multi-document transaction is not available, so the batch is made atomic
// without one:
//
//   <prefix>log      one document: a sequence number, and the batch that is
//                    committed and not yet applied, if there is one
//   <prefix>records  one document per record, stamped with the sequence of
//                    the batch that last wrote it
//   <prefix>bytes    one document per retained source: its length and how
//                    many chunks hold it
//   <prefix>chunks   the exact bytes, in chunks
//
// A commit reads the log document at sequence N, checks every expectation,
// and then replaces the log document with "sequence N+1, committed, these
// writes" on the condition that it is still at N and idle. That one
// conditional update of one document is the commit: MongoDB applies it
// whole or not at all on a single node, and it is acknowledged from the
// journal. Before it the batch never happened. After it the batch is applied
// record by record and the log document is marked idle again.
//
// A store that stopped in between finds the committed batch when it is next
// opened, or when any other call looks, and applies it again. Applying twice
// is harmless: each write sets a whole value, and only on a record whose
// stamp is older than the batch. For that guard to hold after a delete, a
// deleted record leaves a small marker in place of its value, so an old
// batch applied late can never bring it back. Markers are not removed.
//
// A read is taken between two looks at the log document. If the sequence
// moved, or a batch was half applied, the read is taken again, so a reader
// in another process never sees part of a batch.
//
// It passes the module's shared adapter suite, which is the claim it makes.
import { Binary, MongoServerError, type Collection, type Db } from 'mongodb'
import {
  EPCIS_STORAGE_KEY,
  EPCIS_STORAGE_KIND,
  EpcisStorageError,
  assertStorageBytes,
  assertStorageDigest,
  assertStorageList,
  assertStorageName,
  checkedWrites,
  type EpcisCommitResult,
  type EpcisExchangeStorage,
  type EpcisStoredRecord,
  type EpcisWriteExpectation,
} from '@bsv/dpp-credentials/epcis-exchange'

export const MONGO_EPCIS_STORAGE_FORMAT = { format: 'dpp-epcis-exchange-mongodb', version: '1' } as const

/** One batch is one MongoDB document until it is applied, and a document holds at most 16 MiB. A larger batch is refused before anything is written. */
export const MONGO_EPCIS_MAX_BATCH_BYTES = 15 * 1024 * 1024
const DEFAULT_CHUNK_BYTES = 1024 * 1024

/** The database steps a write goes through, in the order they happen. A test stops the adapter before any one of them. */
export type MongoEpcisStorageStep = 'bytes-chunk' | 'bytes-head' | 'bytes-delete' | 'batch-commit' | 'record-put' | 'record-delete' | 'batch-clear'

export interface MongoEpcisStorageOptions {
  /** The collections are named `<prefix>log`, `<prefix>records`, `<prefix>bytes` and `<prefix>chunks`. `epcis_` by default. */
  collectionPrefix?: string
  /**
   * Wait for the journal before a commit or a put of bytes is answered. On
   * by default. Off only for a test that simulates crashes itself: without it
   * a power loss can undo a write the caller was told had happened.
   */
  journal?: boolean
  /** How many bytes one chunk document holds. 1 MiB by default. */
  chunkBytes?: number
  /**
   * Called before each database step. A test throws from it to stop the
   * adapter exactly where a crash would. Once it throws, this adapter answers
   * nothing more and the database is left as it was at that step. A test may
   * also wait in it, to hold one writer still while another works.
   */
  interrupt?: (step: MongoEpcisStorageStep) => void | Promise<void>
}

export interface MongoEpcisStorage extends EpcisExchangeStorage {
  /** What opening the store had to finish: 1 when a committed batch was found and applied. */
  readonly reopened: { batchesApplied: number }
  /** Stop answering. The database connection belongs to whoever opened it and stays open. */
  close(): Promise<void>
  /** Stop answering and leave the database exactly as it is, the way a process that died would. For tests of recovery. */
  abandon(): void
}

type JournalledWrite = { op: 'put'; kind: string; key: string; revision: number; json: string } | { op: 'delete'; kind: string; key: string }

interface LogDocument {
  _id: 'log'
  format: string
  version: string
  /** One more for each committed batch. */
  sequence: number
  /** `committed`: `writes` is a batch that will be applied, now or when the store is next opened. */
  state: 'idle' | 'committed'
  writes: JournalledWrite[]
}

interface RecordDocument {
  _id: string
  kind: string
  key: string
  /** False for the marker a delete leaves. */
  live: boolean
  /** The sequence of the batch that last wrote this document. */
  sequence: number
  revision?: number
  /** The value as JSON text, so it is read back exactly as it was written, whatever its member names and numbers are. */
  json?: string
}

interface BytesDocument {
  _id: string
  byteLength: number
  chunks: number
  chunkBytes: number
}

interface ChunkDocument {
  _id: string
  data: Binary
}

const isDuplicateKey = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000
const recordId = (kind: string, key: string): string => `${kind}/${key}`
const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8')

export async function openMongoEpcisStorage(db: Db, options: MongoEpcisStorageOptions = {}): Promise<MongoEpcisStorage> {
  const prefix = options.collectionPrefix ?? 'epcis_'
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(prefix)) throw new EpcisStorageError('invalid-value', 'a collection prefix is a lower-case name of at most 32 characters')
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 8 * 1024 * 1024) throw new EpcisStorageError('invalid-value', 'a chunk holds 1 byte to 8 MiB')
  // `majority` is the node itself on a single node. The journal is what makes an acknowledged write survive a stop.
  const durable = options.journal === false ? { writeConcern: { w: 1 as const } } : { writeConcern: { w: 'majority' as const, j: true } }

  const log: Collection<LogDocument> = db.collection<LogDocument>(`${prefix}log`)
  const records: Collection<RecordDocument> = db.collection<RecordDocument>(`${prefix}records`)
  const heads: Collection<BytesDocument> = db.collection<BytesDocument>(`${prefix}bytes`)
  const chunks: Collection<ChunkDocument> = db.collection<ChunkDocument>(`${prefix}chunks`)

  let closed = false
  let stopped: unknown
  const usable = (): void => {
    if (stopped != null) throw stopped
    if (closed) throw new EpcisStorageError('closed', 'the EPCIS store was closed')
  }
  const step = async (name: MongoEpcisStorageStep): Promise<void> => {
    if (options.interrupt == null) return
    try {
      await options.interrupt(name)
    } catch (error) {
      stopped = error
      throw error
    }
  }

  /* ---- the log document ---- */

  try {
    await log.updateOne({ _id: 'log' }, { $setOnInsert: { ...MONGO_EPCIS_STORAGE_FORMAT, sequence: 0, state: 'idle', writes: [] } }, { upsert: true, ...durable })
  } catch (error) {
    // Two processes opening a new store at once: the other one made the document.
    if (!isDuplicateKey(error)) throw error
  }
  const readLog = async (): Promise<LogDocument> => {
    const held = await log.findOne({ _id: 'log' })
    if (held == null) throw new EpcisStorageError('corrupt', `${prefix}log holds no log document`)
    if (held.format !== MONGO_EPCIS_STORAGE_FORMAT.format || held.version !== MONGO_EPCIS_STORAGE_FORMAT.version) throw new EpcisStorageError('corrupt', `${prefix}log holds format ${JSON.stringify({ format: held.format, version: held.version })}, which this adapter does not read`)
    if (!Number.isSafeInteger(held.sequence) || (held.state !== 'idle' && held.state !== 'committed') || !Array.isArray(held.writes)) throw new EpcisStorageError('corrupt', `${prefix}log does not hold a log document this adapter could have written`)
    return held
  }

  /** Apply one committed batch. Each write lands only on a record that an earlier batch wrote last, so applying it again, or late, changes nothing. */
  const apply = async (writes: readonly JournalledWrite[], sequence: number): Promise<void> => {
    for (const write of writes) {
      if (!EPCIS_STORAGE_KIND.test(write.kind) || !EPCIS_STORAGE_KEY.test(write.key)) throw new EpcisStorageError('corrupt', `${prefix}log names a record this adapter could not have written`)
      const older = { _id: recordId(write.kind, write.key), sequence: { $lt: sequence } }
      try {
        if (write.op === 'put') {
          await step('record-put')
          await records.updateOne(older, { $set: { kind: write.kind, key: write.key, live: true, revision: write.revision, json: write.json, sequence } }, { upsert: true })
        } else {
          await step('record-delete')
          // No upsert: a record that was never written has nothing an older batch could bring back.
          await records.updateOne(older, { $set: { live: false, sequence }, $unset: { revision: '', json: '' } })
        }
      } catch (error) {
        // The record already carries this batch or a later one, so the insert the upsert fell back to met it.
        if (!isDuplicateKey(error)) throw error
      }
    }
  }

  /** The sequence the store is idle at, after finishing any batch that was committed and not yet applied. */
  let batchesApplied = 0
  const settle = async (): Promise<number> => {
    for (;;) {
      const held = await readLog()
      if (held.state === 'idle') return held.sequence
      await apply(held.writes, held.sequence)
      await step('batch-clear')
      await log.updateOne({ _id: 'log', sequence: held.sequence, state: 'committed' }, { $set: { state: 'idle', writes: [] } })
      batchesApplied += 1
    }
  }

  // Reopening: finish what a stopped store had committed.
  let known: number | undefined = await settle()
  const reopened = { batchesApplied }

  /** Take a read between two looks at the log. An unchanged, idle log means no batch was committed or half applied while the read was made. */
  const consistently = async <T>(read: () => Promise<T>): Promise<T> => {
    for (;;) {
      if (known == null) known = await settle()
      const answer = await read()
      const held = await log.findOne({ _id: 'log' }, { projection: { sequence: 1, state: 1 } })
      if (held != null && held.state === 'idle' && held.sequence === known) return answer
      known = undefined
    }
  }

  const toStored = (held: RecordDocument): EpcisStoredRecord => ({ kind: held.kind, key: held.key, revision: held.revision as number, value: JSON.parse(held.json as string) as EpcisStoredRecord['value'] })

  /* ---- one call at a time in this process ---- */

  let tail: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run)
    tail = next.catch(() => undefined)
    return next
  }

  // Identifiers are ASCII, so `\uffff` sorts after every identifier that starts with the same text: it closes a range over one prefix.
  const chunkRange = (sha256: string, size?: number): { $gte: string; $lt: string } => {
    const start = size == null ? `${sha256}.` : `${sha256}.${size}.`
    return { $gte: start, $lt: `${start}\uffff` }
  }

  return {
    reopened,

    putBytes: (sha256, bytes) =>
      inTurn(async () => {
        usable()
        assertStorageBytes(sha256, bytes)
        if ((await heads.findOne({ _id: sha256 }, { projection: { _id: 1 } })) != null) return
        const count = Math.ceil(bytes.byteLength / chunkBytes)
        // A chunk is named by the digest, the chunk size and its position, so one left by an interrupted put holds exactly what this put would write.
        for (let index = 0; index < count; index += 1) {
          await step('bytes-chunk')
          const data = new Binary(Buffer.from(bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes)))
          await chunks.replaceOne({ _id: `${sha256}.${chunkBytes}.${String(index).padStart(6, '0')}` }, { data }, { upsert: true })
        }
        // The head document is the moment the bytes are held. It is written last, from the journal, so it never names chunks that are not there.
        await step('bytes-head')
        try {
          await heads.insertOne({ _id: sha256, byteLength: bytes.byteLength, chunks: count, chunkBytes }, durable)
        } catch (error) {
          if (!isDuplicateKey(error)) throw error
        }
      }),

    getBytes: (sha256) =>
      inTurn(async () => {
        usable()
        assertStorageDigest(sha256)
        const head = await heads.findOne({ _id: sha256 })
        if (head == null) return undefined
        const parts = await chunks.find({ _id: chunkRange(sha256, head.chunkBytes) }).sort({ _id: 1 }).toArray()
        const out = new Uint8Array(head.byteLength)
        let offset = 0
        for (const part of parts) {
          const data = part.data.buffer.subarray(0, part.data.position)
          if (offset + data.byteLength > out.byteLength) break
          out.set(data, offset)
          offset += data.byteLength
        }
        // All of them or an error: part of a source is never answered.
        if (parts.length !== head.chunks || offset !== head.byteLength) throw new EpcisStorageError('corrupt', `the bytes held under ${sha256} are not whole`)
        return out
      }),

    deleteBytes: (sha256) =>
      inTurn(async () => {
        usable()
        assertStorageDigest(sha256)
        await step('bytes-delete')
        // The head goes first, so the bytes are gone as one step and what is left of them is never read.
        await heads.deleteOne({ _id: sha256 }, durable)
        await chunks.deleteMany({ _id: chunkRange(sha256) })
      }),

    get: (kind, key) =>
      inTurn(async () => {
        usable()
        assertStorageName(kind, key)
        const held = await consistently(() => records.findOne({ _id: recordId(kind, key) }))
        return held == null || !held.live ? undefined : toStored(held)
      }),

    list: (kind, options) =>
      inTurn(async () => {
        usable()
        assertStorageList(kind, options)
        const prefixed = options.prefix ?? ''
        // Record identifiers are `<kind>/<key>`, so the order of the identifiers of one kind is the order of its keys.
        const from = options.after != null && options.after >= prefixed ? { $gt: recordId(kind, options.after) } : { $gte: recordId(kind, prefixed) }
        const held = await consistently(() =>
          records
            .find({ _id: { ...from, $lt: `${recordId(kind, prefixed)}\uffff` }, live: true })
            .sort({ _id: 1 })
            .limit(options.limit)
            .toArray()
        )
        return held.filter((record) => record.key.startsWith(prefixed)).map(toStored)
      }),

    commit: (writes) =>
      inTurn(async (): Promise<EpcisCommitResult> => {
        usable()
        const batch = checkedWrites(writes)
        if (batch.length === 0) return { committed: true }
        const texts = batch.map((write) => (write.op === 'put' ? JSON.stringify(write.value) : ''))
        const size = texts.reduce((sum, text, index) => sum + utf8Length(text) + utf8Length(batch[index]!.key) + 128, 0)
        if (size > MONGO_EPCIS_MAX_BATCH_BYTES) throw new EpcisStorageError('invalid-value', `a batch of ${size} bytes is larger than the ${MONGO_EPCIS_MAX_BATCH_BYTES} bytes this adapter commits as one MongoDB document; nothing was written`)
        for (;;) {
          const sequence: number = known ?? (await settle())
          known = sequence
          const held = new Map((await records.find({ _id: { $in: batch.map((write) => recordId(write.kind, write.key)) } }).toArray()).map((record) => [record._id, record]))
          const journal: JournalledWrite[] = []
          let failed: Extract<EpcisCommitResult, { committed: false }>['failed'] | undefined
          batch.forEach((write, index) => {
            const now = held.get(recordId(write.kind, write.key))
            const found: EpcisWriteExpectation = now?.live === true ? (now.revision as number) : 'absent'
            if (failed == null && write.expect !== undefined && write.expect !== found) failed = { kind: write.kind, key: write.key, expected: write.expect, found }
            journal.push(write.op === 'delete' ? { op: 'delete', kind: write.kind, key: write.key } : { op: 'put', kind: write.kind, key: write.key, revision: (found === 'absent' ? 0 : found) + 1, json: texts[index]! })
          })
          if (failed != null) {
            // The answer is given only if nothing was committed while the expectations were read. Otherwise they are read again.
            const after = await log.findOne({ _id: 'log' }, { projection: { sequence: 1, state: 1 } })
            if (after != null && after.state === 'idle' && after.sequence === sequence) return { committed: false, failed }
            known = undefined
            continue
          }
          // This update is the commit. It takes effect only if no other batch was committed since the expectations were read.
          await step('batch-commit')
          const taken = await log.updateOne({ _id: 'log', sequence, state: 'idle' }, { $set: { sequence: sequence + 1, state: 'committed', writes: journal } }, durable)
          if (taken.matchedCount === 0) {
            known = undefined
            continue
          }
          known = undefined
          await apply(journal, sequence + 1)
          await step('batch-clear')
          const cleared = await log.updateOne({ _id: 'log', sequence: sequence + 1, state: 'committed' }, { $set: { state: 'idle', writes: [] } })
          // When another process finished the batch first it may have committed further ones, so the sequence is looked up again.
          if (cleared.matchedCount === 1) known = sequence + 1
          return { committed: true }
        }
      }),

    close: () =>
      inTurn(async () => {
        closed = true
      }),

    abandon: () => {
      if (closed || stopped != null) return
      stopped = new EpcisStorageError('closed', 'the EPCIS store was abandoned')
    },
  }
}
