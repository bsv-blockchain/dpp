import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { InMemoryDppStorage, MongoDppStorage, selectorFilter, type DppRecordInput, type DppRecordStore } from '../src/storage.js'

/**
 * The record store contract behind ls_dpp and GET /history, run identically
 * over both implementations: the sequence assigned at insert, the page query,
 * the spend marks and their undo. The Mongo half runs against a real mongod,
 * as engineStorage.test.ts does and for the same reason: the sequence counter
 * and the numbering of legacy rows are query semantics, and a collection fake
 * would prove the fake.
 */

const PASSPORT = 'https://id.gs1.org/01/09506000134352/21/STORE-1'
const OTHER = 'https://id.gs1.org/01/09506000134352/21/STORE-2'

function input(n: number, overrides: Partial<DppRecordInput> = {}): DppRecordInput {
  return {
    txid: `${n}`.padStart(64, 'a'),
    outputIndex: 0,
    passportId: PASSPORT,
    uid: 'STORE-UID',
    op: n === 0 ? 'ACTIVATE' : 'REPAIRED',
    timestamp: '2026-07-26T09:00:00Z',
    previousTxid: '',
    spent: false,
    spendingTxid: '',
    createdAt: new Date(1_753_500_000_000 - n * 1000),
    ...overrides,
  }
}

let mongod: MongoMemoryServer | undefined
let client: MongoClient | undefined
let count = 0

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
}, 300_000)

afterAll(async () => {
  await client?.close()
  await mongod?.stop()
}, 60_000)

const harnesses: Array<[string, () => DppRecordStore]> = [
  ['in memory', () => new InMemoryDppStorage()],
  ['mongodb', () => new MongoDppStorage(client!.db(`records_${count++}`))],
]

describe.each(harnesses)('the record store, %s', (_name, fresh) => {
  it('assigns a strictly increasing sequence at insert and keeps it on re-insert', async () => {
    const store = fresh()
    for (let n = 0; n < 5; n++) await store.insert(input(n))
    const rows = await store.findByPassport(PASSPORT)
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5])
    // createdAt runs backwards above: the order is the sequence's, not the clock's.
    expect(rows.map((r) => r.txid)).toEqual([0, 1, 2, 3, 4].map((n) => input(n).txid))
    await store.insert(input(2, { op: 'EDIT' }))
    const after = await store.findByPassport(PASSPORT)
    expect(after.find((r) => r.txid === input(2).txid)).toMatchObject({ sequence: 3, op: 'EDIT' })
    expect(after.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5])
  })

  it('answers highestSequence as what was assigned, unmoved by deletion', async () => {
    const store = fresh()
    expect(await store.highestSequence()).toBe(0)
    for (let n = 0; n < 3; n++) await store.insert(input(n))
    expect(await store.highestSequence()).toBe(3)
    await store.delete(input(2).txid, 0)
    expect(await store.highestSequence()).toBe(3)
    await store.insert(input(9))
    expect((await store.findByPassport(PASSPORT)).map((r) => r.sequence)).toContain(4)
  })

  it('pages by sequence within a range, under either selector', async () => {
    const store = fresh()
    for (let n = 0; n < 10; n++) await store.insert(input(n, n % 2 === 0 ? {} : { passportId: OTHER, uid: 'OTHER-UID' }))
    const evens = await store.findPage({ passportId: PASSPORT }, { after: 0, upTo: 10 }, 100)
    expect(evens.map((r) => r.sequence)).toEqual([1, 3, 5, 7, 9])
    expect((await store.findPage({ uid: 'OTHER-UID' }, { after: 2, upTo: 8 }, 2)).map((r) => r.sequence)).toEqual([4, 6])
    expect((await store.findPage({ passportId: PASSPORT }, { after: 0, upTo: 4 }, 100)).map((r) => r.sequence)).toEqual([1, 3])
    expect(await store.findPage({ passportId: PASSPORT }, { after: 9, upTo: 10 }, 100)).toEqual([])
    await expect(store.findPage({}, { after: 0, upTo: 10 }, 100)).rejects.toThrow(/exactly one/)
    await expect(store.findPage({ passportId: PASSPORT, uid: 'x' }, { after: 0, upTo: 10 }, 100)).rejects.toThrow(/exactly one/)
  })

  it('marks spent and unspent', async () => {
    const store = fresh()
    await store.insert(input(0))
    await store.markSpent(input(0).txid, 0, 'f'.repeat(64))
    expect((await store.findByPassport(PASSPORT))[0]).toMatchObject({ spent: true, spendingTxid: 'f'.repeat(64) })
    await store.markUnspent(input(0).txid, 0)
    expect((await store.findByPassport(PASSPORT))[0]).toMatchObject({ spent: false, spendingTxid: '' })
  })
})

describe('the record store, mongodb, rows older than the field', () => {
  it('numbers legacy rows once, in createdAt, txid, outputIndex order, before serving', async () => {
    const db = client!.db(`records_legacy_${count++}`)
    const legacy = (n: number, createdAt: Date, txid = `${n}`.padStart(64, 'b'), outputIndex = 0) => {
      const { sequence: _s, ...rest } = { ...input(n), sequence: undefined, txid, outputIndex, createdAt }
      return rest
    }
    await db.collection('dppRecords').insertMany([
      legacy(3, new Date('2026-08-03T00:00:00Z')),
      legacy(1, new Date('2026-08-01T00:00:00Z')),
      legacy(2, new Date('2026-08-02T00:00:00Z'), `${2}`.padStart(64, 'b'), 1),
      legacy(2, new Date('2026-08-02T00:00:00Z'), `${2}`.padStart(64, 'b'), 0),
      legacy(4, new Date('2026-08-02T00:00:00Z'), `${4}`.padStart(64, 'a')),
    ])
    const store = new MongoDppStorage(db)
    const rows = await store.findByPassport(PASSPORT)
    expect(rows.map((r) => [r.txid[0], r.txid.at(-1), r.outputIndex, r.sequence])).toEqual([
      ['b', '1', 0, 1],
      ['a', '4', 0, 2],
      ['b', '2', 0, 3],
      ['b', '2', 1, 4],
      ['b', '3', 0, 5],
    ])
    await store.insert(input(7))
    expect((await store.findByPassport(PASSPORT)).at(-1)?.sequence).toBe(6)
    // A second store over the same database finds nothing left to number.
    const again = new MongoDppStorage(db)
    expect((await again.findByPassport(PASSPORT)).map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(await again.highestSequence()).toBe(6)
  })
})

describe('the selector', () => {
  it('accepts exactly one non-empty string key', () => {
    expect(selectorFilter({ passportId: 'p' })).toEqual({ passportId: 'p' })
    expect(selectorFilter({ uid: 'u' })).toEqual({ uid: 'u' })
    for (const bad of [{}, { passportId: '' }, { passportId: 'p', uid: 'u' }, { uid: { $ne: '' } as unknown as string }]) {
      expect(() => selectorFilter(bad)).toThrow(/exactly one/)
    }
  })
})
