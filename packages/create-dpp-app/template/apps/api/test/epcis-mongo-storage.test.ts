// The MongoDB storage adapter of the EPCIS exchange, held to what the module
// asks of any adapter. The module ships a suite for that and this file runs
// it, unchanged, against one MongoDB node in memory: the same kind of node
// the reference deployment runs, where no multi-document transaction is
// available. The suite stops the store before and after every durable call
// of an import, a conflict decision and an index rebuild, reopens it, and
// checks that nothing acknowledged was lost and nothing is half recorded.
//
// The suite stops the adapter between its calls. The tests after it stop it
// inside them, at each step the adapter itself takes in the database, and
// run two writers over one store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EPCIS_RECORD_KINDS,
  EpcisStorageError,
  EpcisStorageFault,
  checkEpcisExchangeInvariants,
  epcisStorageAdapterSuite,
  exportEpcisSource,
  findEpcisImportByRequest,
  importEpcisSource,
  recoverEpcisExchange,
  type EpcisExchangeStorage,
  type EpcisImportOutcome,
  type EpcisStorageAdapterHarness,
} from '@bsv/dpp-credentials/epcis-exchange'
import { MONGO_EPCIS_MAX_BATCH_BYTES, openMongoEpcisStorage, type MongoEpcisStorage, type MongoEpcisStorageOptions, type MongoEpcisStorageStep } from '../src/epcis/mongo-storage.js'
import { epcisDocument, gs1Dir, item, objectEvent, sha256, startMongo, utf8, type Json, type TestMongo } from './epcis-fixtures.js'

let mongo: TestMongo
beforeAll(async () => {
  mongo = await startMongo()
})
afterAll(async () => {
  await mongo.stop()
})

// The simulated crashes are made by the test, so waiting for the journal adds nothing but time. One test below runs with it on.
// Small chunks, so a source of a few thousand bytes is held in several.
const quick: MongoEpcisStorageOptions = { journal: false, chunkBytes: 16 * 1024 }

const harness = (): EpcisStorageAdapterHarness => {
  const db = mongo.database()
  return {
    open: () => openMongoEpcisStorage(db, quick),
    abandon: (storage) => (storage as MongoEpcisStorage).abandon(),
    destroy: async () => {
      await db.dropDatabase()
    },
  }
}

describe('the node these tests run on', () => {
  it('is a single node without multi-document transactions', async () => {
    const hello = await mongo.client.db('admin').command({ hello: 1 })
    expect(hello.setName).toBeUndefined()
    const session = mongo.client.startSession()
    try {
      const refused = await session
        .withTransaction(async () => {
          await mongo.database().collection('probe').insertOne({ n: 1 }, { session })
        })
        .then(
          () => undefined,
          (error: unknown) => error as { message?: string; originalError?: { message?: string } }
        )
      // The driver words the node's refusal in its own way and keeps the node's beside it.
      expect(`${refused?.message} ${refused?.originalError?.message}`).toMatch(/Transaction numbers are only allowed on a replica set member or mongos|does not support retryable writes/)
    } finally {
      await session.endSession()
    }
  })
})

describe('the shared adapter suite: the MongoDB adapter', () => {
  const cases = epcisStorageAdapterSuite(harness, { artefactsDir: gs1Dir() })
  it('covers the interface and every crash', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14)
    expect(cases.filter((test) => test.name.startsWith('crash:')).length).toBe(5)
  })
  for (const test of cases) it(test.name, test.run, 300_000)
})

describe('the MongoDB adapter', () => {
  const AT = '2026-03-10T00:00:00.000Z'
  const documentBytes = utf8(JSON.stringify(epcisDocument([objectEvent(1, [item('ADAPTER-1')]), objectEvent(2, [item('ADAPTER-1'), item('ADAPTER-2')]), objectEvent(3, [item('ADAPTER-2')], { 'example:note': 'seen on the line' })]), null, 2))
  const request = (storage: EpcisExchangeStorage, requestId = 'request-1', bytes = documentBytes) => ({ storage, sourceId: 'source-a', requestId, bytes, mediaType: 'application/ld+json', receivedAt: AT, provenance: { kind: 'file' as const }, policy: { policyId: 'test-policy@1' }, artefactsDir: gs1Dir(), now: () => AT })
  const record = (outcome: EpcisImportOutcome) => {
    if (outcome.outcome !== 'retained') throw new Error(JSON.stringify(outcome))
    return outcome.record
  }
  const dump = async (storage: EpcisExchangeStorage): Promise<Array<[string, string, Json]>> => {
    const out: Array<[string, string, Json]> = []
    for (const kind of Object.values(EPCIS_RECORD_KINDS)) for (const held of await storage.list(kind, { limit: 100_000 })) out.push([kind, held.key, held.value])
    return out
  }
  const held = async (storage: EpcisExchangeStorage): Promise<unknown[]> => (await storage.list('suite', { limit: 20 })).map((r) => [r.key, r.revision, r.value.n])

  it('keeps an import across a close and a reopen, waiting for the journal', async () => {
    const db = mongo.database()
    const first = await openMongoEpcisStorage(db)
    const imported = record(await importEpcisSource(request(first)))
    await first.close()
    await expect(first.get('import', 'aaaa')).rejects.toMatchObject({ code: 'closed' })
    const second = await openMongoEpcisStorage(db)
    expect(second.reopened).toEqual({ batchesApplied: 0 })
    expect(await findEpcisImportByRequest(second, 'source-a', 'request-1')).toEqual(imported)
    expect(Buffer.from((await exportEpcisSource(second, imported.importId))!.bytes).equals(Buffer.from(documentBytes))).toBe(true)
    expect(await checkEpcisExchangeInvariants(second, { associations: true })).toEqual([])
    // The value of a record is held as the JSON text it was written as, so it reads back exactly, whatever its member names are.
    const strange = { '': 1, 'a.b': { $set: [1.5, -0, 1e21, null] }, 'café ☃': 'ok', 'with\u0000nul': true }
    await second.commit([{ op: 'put', kind: 'suite', key: 'strange', value: strange }])
    expect((await second.get('suite', 'strange'))!.value).toEqual(JSON.parse(JSON.stringify(strange)))
    await second.close()
  })

  it('refuses a database that holds another format, and a batch too large to commit as one document', async () => {
    const foreign = mongo.database()
    await foreign.collection<{ _id: string }>('epcis_log').insertOne({ _id: 'log', format: 'something-else', version: '9' } as never)
    await expect(openMongoEpcisStorage(foreign, quick)).rejects.toMatchObject({ code: 'corrupt' })

    const storage = await openMongoEpcisStorage(mongo.database(), quick)
    const large = 'x'.repeat(MONGO_EPCIS_MAX_BATCH_BYTES)
    await expect(storage.commit([{ op: 'put', kind: 'suite', key: 'small', value: { n: 1 } }, { op: 'put', kind: 'suite', key: 'large', value: { large } }])).rejects.toMatchObject({ code: 'invalid-value' })
    // Nothing of the refused batch was written.
    expect(await held(storage)).toEqual([])
  })

  it('applies a batch whole when it is stopped at any database step and reopened', async () => {
    const writes = [
      { op: 'put' as const, kind: 'suite', key: 'one.record', value: { n: 1 } },
      { op: 'put' as const, kind: 'suite', key: 'two.record', value: { n: 2 }, expect: 1 },
      { op: 'delete' as const, kind: 'suite', key: 'three.record' },
    ]
    const seed = async (storage: EpcisExchangeStorage): Promise<void> => {
      await storage.commit([
        { op: 'put', kind: 'suite', key: 'two.record', value: { n: 0 } },
        { op: 'put', kind: 'suite', key: 'three.record', value: { n: 3 } },
      ])
    }
    const before = [['three.record', 1, 3], ['two.record', 1, 0]]
    const after = [['one.record', 1, 1], ['two.record', 2, 2]]
    const steps: MongoEpcisStorageStep[] = []
    {
      const db = mongo.database()
      await seed(await openMongoEpcisStorage(db, quick))
      const traced = await openMongoEpcisStorage(db, { ...quick, interrupt: (step) => void steps.push(step) })
      await traced.commit(writes)
      expect(await held(traced)).toEqual(after)
    }
    expect(steps).toEqual(['batch-commit', 'record-put', 'record-put', 'record-delete', 'batch-clear'])
    for (let at = 0; at < steps.length; at += 1) {
      const db = mongo.database()
      await seed(await openMongoEpcisStorage(db, quick))
      let seen = 0
      const stopping = await openMongoEpcisStorage(db, { ...quick, interrupt: () => { if (seen++ === at) throw new EpcisStorageFault(at + 1, 'before', steps[at]!) } })
      await expect(stopping.commit(writes)).rejects.toBeInstanceOf(EpcisStorageFault)
      await expect(stopping.get('suite', 'one.record')).rejects.toBeInstanceOf(EpcisStorageFault)
      const reopened = await openMongoEpcisStorage(db, quick)
      // Before the log document names the batch it never happened. From then on it always completes.
      const committed = at >= 1
      expect(await held(reopened), `stopped before ${steps[at]} (step ${at + 1})`).toEqual(committed ? after : before)
      expect(reopened.reopened.batchesApplied, steps[at]).toBe(committed ? 1 : 0)
      // The deleted record is gone to every reader, and a record put in its place starts a new count.
      if (committed) {
        expect(await reopened.get('suite', 'three.record')).toBeUndefined()
        expect(await reopened.commit([{ op: 'put', kind: 'suite', key: 'three.record', value: { n: 9 }, expect: 'absent' }])).toEqual({ committed: true })
        expect((await reopened.get('suite', 'three.record'))!.revision).toBe(1)
      }
    }
  })

  it('never shows half of a source: bytes stopped before their head document are not there', async () => {
    const bytes = new Uint8Array(40_000).map((_, i) => (i * 7) & 0xff)
    const digest = sha256(bytes)
    for (const stopAt of [0, 1, 2, 3] as const) {
      const db = mongo.database()
      let seen = 0
      const steps: MongoEpcisStorageStep[] = []
      const stopping = await openMongoEpcisStorage(db, { ...quick, interrupt: (step) => { steps.push(step); if (seen++ === stopAt) throw new EpcisStorageFault(stopAt + 1, 'before', step) } })
      await expect(stopping.putBytes(digest, bytes)).rejects.toBeInstanceOf(EpcisStorageFault)
      // 40,000 bytes are three chunks and then the head.
      expect(steps.at(-1)).toBe(stopAt < 3 ? 'bytes-chunk' : 'bytes-head')
      const reopened = await openMongoEpcisStorage(db, quick)
      expect(await reopened.getBytes(digest), `stopped at step ${stopAt + 1}`).toBeUndefined()
      await reopened.putBytes(digest, bytes)
      expect(Buffer.from((await reopened.getBytes(digest))!).equals(Buffer.from(bytes))).toBe(true)
      await reopened.deleteBytes(digest)
      expect(await reopened.getBytes(digest)).toBeUndefined()
    }
  })

  it('gives the same store when an import is stopped at every database step, then recovered and retried', async () => {
    // The uninterrupted import is the measure, and its trace is the list of places to stop.
    const steps: MongoEpcisStorageStep[] = []
    const control = await openMongoEpcisStorage(mongo.database(), { ...quick, interrupt: (step) => void steps.push(step) })
    const controlRecord = record(await importEpcisSource(request(control)))
    const controlStore = await dump(control)
    expect(steps.length).toBeGreaterThan(20)
    expect(new Set(steps)).toEqual(new Set(['bytes-chunk', 'bytes-head', 'batch-commit', 'record-put', 'record-delete', 'batch-clear']))

    const outcomes = { discarded: 0, finished: 0 }
    for (let at = 0; at < steps.length; at += 1) {
      const where = `stopped before database step ${at + 1} of ${steps.length} (${steps[at]})`
      const db = mongo.database()
      let seen = 0
      const stopping = await openMongoEpcisStorage(db, { ...quick, interrupt: () => { if (seen++ === at) throw new EpcisStorageFault(at + 1, 'before', steps[at]!) } })
      await expect(importEpcisSource(request(stopping)), where).rejects.toBeInstanceOf(EpcisStorageFault)

      const reopened = await openMongoEpcisStorage(db, quick)
      const report = await recoverEpcisExchange(reopened, { now: () => AT })
      expect(report.remaining, where).toBe(0)
      expect(await checkEpcisExchangeInvariants(reopened, { associations: true }), where).toEqual([])
      const receipt = await findEpcisImportByRequest(reopened, 'source-a', 'request-1')
      if (receipt == null) {
        // No receipt: nothing of the request is left, bytes included.
        outcomes.discarded += 1
        expect(await reopened.getBytes(controlRecord.sha256), where).toBeUndefined()
        expect(await dump(reopened), where).toEqual([])
      } else {
        // A receipt: recovery finished the import to the same result, and the source is whole.
        outcomes.finished += 1
        expect(receipt, where).toEqual(controlRecord)
        expect(Buffer.from((await exportEpcisSource(reopened, receipt.importId))!.bytes).equals(Buffer.from(documentBytes)), where).toBe(true)
      }
      const retried = await importEpcisSource(request(reopened))
      expect(record(retried), where).toEqual(controlRecord)
      expect(await dump(reopened), where).toEqual(controlStore)
      await db.dropDatabase()
    }
    // Both sides of the receipt were stopped at.
    expect(outcomes.discarded).toBeGreaterThan(1)
    expect(outcomes.finished).toBeGreaterThan(10)
  }, 300_000)

  it('lets a second process finish a committed batch, and never lets the first bring back what was deleted since', async () => {
    const db = mongo.database()
    // The first writer is held still after it committed a batch of two records and applied one of them.
    let puts = 0
    let release: () => void = () => undefined
    const stalled = new Promise<void>((resolve) => { release = resolve })
    let reached: () => void = () => undefined
    const atStall = new Promise<void>((resolve) => { reached = resolve })
    const first = await openMongoEpcisStorage(db, { ...quick, interrupt: async (step) => { if (step === 'record-put' && (puts += 1) === 2) { reached(); await stalled } } })
    const committing = first.commit([
      { op: 'put', kind: 'suite', key: 'kept.record', value: { n: 1 } },
      { op: 'put', kind: 'suite', key: 'gone.record', value: { n: 1 } },
    ])
    await atStall

    // A second process reads: it finds the batch committed, applies all of it and sees both records.
    const second = await openMongoEpcisStorage(db, quick)
    expect(second.reopened.batchesApplied).toBe(1)
    expect(await held(second)).toEqual([['gone.record', 1, 1], ['kept.record', 1, 1]])
    // It then deletes one and rewrites the other, in two further batches.
    expect(await second.commit([{ op: 'delete', kind: 'suite', key: 'gone.record', expect: 1 }])).toEqual({ committed: true })
    expect(await second.commit([{ op: 'put', kind: 'suite', key: 'kept.record', value: { n: 2 }, expect: 1 }])).toEqual({ committed: true })

    // The first writer wakes and applies the rest of its old batch. Every write of it meets a record a later batch wrote, and changes nothing.
    release()
    expect(await committing).toEqual({ committed: true })
    expect(await held(second)).toEqual([['kept.record', 2, 2]])
    expect(await held(first)).toEqual([['kept.record', 2, 2]])
    expect(await first.get('suite', 'gone.record')).toBeUndefined()
  })

  it('serialises two writers on one store, and shows a reader whole batches only', async () => {
    const db = mongo.database()
    const writers = [await openMongoEpcisStorage(db, quick), await openMongoEpcisStorage(db, quick)]
    const reader = await openMongoEpcisStorage(db, quick)
    await writers[0]!.commit([
      { op: 'put', kind: 'suite', key: 'pair.left', value: { n: 0 } },
      { op: 'put', kind: 'suite', key: 'pair.right', value: { n: 0 } },
    ])
    let writing = true
    const torn: unknown[] = []
    const reading = (async () => {
      while (writing) {
        const [left, right] = await reader.list('suite', { prefix: 'pair.', limit: 2 })
        // Both records are written in one batch, so they always agree.
        if (left!.value.n !== right!.value.n || left!.revision !== right!.revision) torn.push([left, right])
      }
    })()
    // Each writer adds one to both records twenty-five times, expecting the revision it read. A lost race is answered, and tried again.
    const increments = async (storage: EpcisExchangeStorage): Promise<number> => {
      let lost = 0
      for (let done = 0; done < 25; ) {
        const now = (await storage.get('suite', 'pair.left'))!
        const next = { n: (now.value.n as number) + 1 }
        const result = await storage.commit([
          { op: 'put', kind: 'suite', key: 'pair.left', value: next, expect: now.revision },
          { op: 'put', kind: 'suite', key: 'pair.right', value: next, expect: now.revision },
        ])
        if (result.committed) done += 1
        else lost += 1
      }
      return lost
    }
    await Promise.all(writers.map(increments))
    writing = false
    await reading
    expect(torn).toEqual([])
    // Fifty increments were acknowledged, and fifty are held: none was lost and none applied twice.
    expect(await held(reader)).toEqual([['pair.left', 51, 50], ['pair.right', 51, 50]])
  })

  it('refuses a malformed call the way every adapter does', async () => {
    const storage = await openMongoEpcisStorage(mongo.database(), quick)
    await expect(storage.putBytes(sha256(utf8('other')), utf8('exact'))).rejects.toBeInstanceOf(EpcisStorageError)
    await expect(openMongoEpcisStorage(mongo.database(), { collectionPrefix: 'Not A Name' })).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(openMongoEpcisStorage(mongo.database(), { chunkBytes: 0 })).rejects.toMatchObject({ code: 'invalid-value' })
  })
})
