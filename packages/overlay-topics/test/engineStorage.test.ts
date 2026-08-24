import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Output, Storage } from '@bsv/overlay'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { InMemoryOverlayStorage, MongoOverlayStorage } from '../src/engineStorage.js'

/**
 * The engine storage contract, run identically over both implementations.
 *
 * Until 2026-08-13 `MongoOverlayStorage` had no test at all: it is the
 * implementation the hosted deployment persists with, and its entire evidence
 * was one manual container restart. Its docblock names the KnexStorage quirks
 * it deliberately mirrors, and none of them was asserted anywhere, so a
 * refactor that "fixed" one would have passed every suite and changed what the
 * engine sees. These cases are those quirks written down as executable
 * sentences, and they run over `InMemoryOverlayStorage` too, because two
 * implementations of one interface drift in exactly the places nobody compares.
 *
 * The Mongo half runs against a real mongod (`mongodb-memory-server`), because
 * the quirks live in query semantics: `$setOnInsert` leaving an existing row
 * untouched, `deleteMany` keyed without the topic, `$or: []` being an error a
 * guard has to catch. A hand-rolled collection fake would prove the fake.
 * First run downloads the mongod binary, so the hooks carry long timeouts.
 */

const TXID_A = 'aa'.repeat(32)
const TXID_B = 'bb'.repeat(32)

function output(over: Partial<Output> = {}): Output {
  return {
    txid: TXID_A,
    outputIndex: 0,
    outputScript: [0x51],
    satoshis: 1,
    topic: 'tm_dpp',
    spent: false,
    outputsConsumed: [],
    consumedBy: [],
    ...over,
  } as Output
}

interface Harness {
  fresh: () => Promise<Storage>
  /** Present on the implementation that has indexes to create. */
  ensureIndexes?: (storage: Storage) => Promise<void>
}

let mongod: MongoMemoryServer | undefined
let client: MongoClient | undefined
let mongoDbCount = 0

const harnesses: Array<[string, Harness]> = [
  ['in memory', { fresh: async () => new InMemoryOverlayStorage() }],
  [
    'mongodb',
    {
      fresh: async () => {
        // A database per test: isolation without collection-by-collection
        // cleanup, on a server whose databases are all throwaway.
        return new MongoOverlayStorage(client!.db(`contract_${mongoDbCount++}`))
      },
      ensureIndexes: async (storage) => {
        await (storage as MongoOverlayStorage).ensureIndexes()
      },
    },
  ],
]

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
}, 300_000)

afterAll(async () => {
  await client?.close()
  await mongod?.stop()
}, 60_000)

describe.each(harnesses)('engine storage on %s', (_name, harness) => {
  it('never rewrites an output already admitted under its (txid, outputIndex, topic)', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ satoshis: 187 }))
    await storage.insertOutput(output({ satoshis: 99_999, spent: true }))
    const found = await storage.findOutput(TXID_A, 0, 'tm_dpp')
    expect(found?.satoshis).toBe(187)
    expect(found?.spent).toBe(false)
  })

  it('stores BEEF once per txid, so a second output cannot replace it', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ outputIndex: 0, beef: [1, 2, 3] }))
    await storage.insertOutput(output({ outputIndex: 1, beef: [9, 9, 9] }))
    const second = await storage.findOutput(TXID_A, 1, 'tm_dpp', undefined, true)
    expect(second?.beef).toEqual([1, 2, 3])
  })

  it('deleteOutput ignores its topic argument, exactly as KnexStorage does', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ topic: 'tm_dpp' }))
    await storage.insertOutput(output({ topic: 'tm_uora_dpp' }))
    await storage.deleteOutput(TXID_A, 0, 'tm_dpp')
    expect(await storage.findOutput(TXID_A, 0, 'tm_dpp')).toBeNull()
    // The other topic's row went with it: the argument is accepted and unread.
    expect(await storage.findOutput(TXID_A, 0, 'tm_uora_dpp')).toBeNull()
  })

  it('drops BEEF only when the txid has no outputs left', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ outputIndex: 0, beef: [1, 2, 3] }))
    await storage.insertOutput(output({ outputIndex: 1 }))
    await storage.deleteOutput(TXID_A, 0, 'tm_dpp')
    const survivor = await storage.findOutput(TXID_A, 1, 'tm_dpp', undefined, true)
    expect(survivor?.beef).toEqual([1, 2, 3])
    await storage.deleteOutput(TXID_A, 1, 'tm_dpp')
    // The transaction row is gone with its last output: a re-admitted output
    // arriving without BEEF finds nothing left over from the first life.
    await storage.insertOutput(output({ outputIndex: 1 }))
    const revenant = await storage.findOutput(TXID_A, 1, 'tm_dpp', undefined, true)
    expect(revenant?.beef).toBeUndefined()
  })

  it('findOutput filters on topic and spent state', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ topic: 'tm_dpp' }))
    await storage.insertOutput(output({ topic: 'tm_uora_dpp' }))
    await storage.markUTXOAsSpent(TXID_A, 0, 'tm_dpp')
    // The spend touched only its topic.
    expect((await storage.findOutput(TXID_A, 0, 'tm_dpp'))?.spent).toBe(true)
    expect((await storage.findOutput(TXID_A, 0, 'tm_uora_dpp'))?.spent).toBe(false)
    // And the spent filter selects between them.
    expect((await storage.findOutput(TXID_A, 0, undefined, false))?.topic).toBe('tm_uora_dpp')
  })

  it('findUTXOsForTopic answers unspent only, scored from `since`, ascending, limited', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ outputIndex: 0, score: 1 }))
    await storage.insertOutput(output({ outputIndex: 1, score: 3 }))
    await storage.insertOutput(output({ outputIndex: 2, score: 2 }))
    await storage.insertOutput(output({ outputIndex: 3, score: 4, spent: true }))
    const fromTwo = await storage.findUTXOsForTopic('tm_dpp', 2)
    expect(fromTwo.map((o) => o.score)).toEqual([2, 3])
    const limited = await storage.findUTXOsForTopic('tm_dpp', 2, 1)
    expect(limited.map((o) => o.score)).toEqual([2])
  })

  it('findOutputsByOutpoints answers empty for an empty list instead of erroring', async () => {
    // Mongo refuses `$or: []`, so the guard in front of it is load-bearing.
    const storage = await harness.fresh()
    expect(await storage.findOutputsByOutpoints([])).toEqual([])
  })

  it('findOutputsByOutpoints hydrates BEEF per txid when asked', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ txid: TXID_A, beef: [1] }))
    await storage.insertOutput(output({ txid: TXID_B, beef: [2] }))
    const rows = await storage.findOutputsByOutpoints(
      [
        { txid: TXID_A, outputIndex: 0 },
        { txid: TXID_B, outputIndex: 0 },
      ],
      true
    )
    const byTxid = new Map(rows.map((row) => [row.txid, row.beef]))
    expect(byTxid.get(TXID_A)).toEqual([1])
    expect(byTxid.get(TXID_B)).toEqual([2])
  })

  it('round-trips consumedBy, block height and a replaced BEEF', async () => {
    const storage = await harness.fresh()
    await storage.insertOutput(output({ beef: [1] }))
    await storage.updateConsumedBy(TXID_A, 0, 'tm_dpp', [{ txid: TXID_B, outputIndex: 0 }])
    await storage.updateOutputBlockHeight(TXID_A, 0, 'tm_dpp', 900_001)
    await storage.updateTransactionBEEF(TXID_A, [7, 7])
    const found = await storage.findOutput(TXID_A, 0, 'tm_dpp', undefined, true)
    expect(found?.consumedBy).toEqual([{ txid: TXID_B, outputIndex: 0 }])
    expect(found?.blockHeight).toBe(900_001)
    // updateTransactionBEEF replaces, unlike insertOutput, which is the point
    // of it: proofs arrive after admission.
    expect(found?.beef).toEqual([7, 7])
  })

  it('applied transactions are idempotent per (txid, topic)', async () => {
    const storage = await harness.fresh()
    const applied = { txid: TXID_A, topic: 'tm_dpp' }
    await storage.insertAppliedTransaction(applied)
    await storage.insertAppliedTransaction(applied)
    expect(await storage.doesAppliedTransactionExist(applied)).toBe(true)
    expect(await storage.doesAppliedTransactionExist({ txid: TXID_A, topic: 'tm_uora_dpp' })).toBe(
      false
    )
  })

  it('interactions default to zero and round-trip', async () => {
    const storage = await harness.fresh()
    expect(await storage.getLastInteraction('peer.example', 'tm_dpp')).toBe(0)
    await storage.updateLastInteraction('peer.example', 'tm_dpp', 42)
    await storage.updateLastInteraction('peer.example', 'tm_dpp', 43)
    expect(await storage.getLastInteraction('peer.example', 'tm_dpp')).toBe(43)
  })

  it('survives index creation twice, on the implementation that has any', async () => {
    const storage = await harness.fresh()
    if (harness.ensureIndexes == null) return
    await harness.ensureIndexes(storage)
    await harness.ensureIndexes(storage)
    await storage.insertOutput(output())
    expect(await storage.findOutput(TXID_A, 0, 'tm_dpp')).not.toBeNull()
  })
})
