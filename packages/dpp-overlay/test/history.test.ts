import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { startOverlayService, type RunningService } from '../src/index.js'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SNAPSHOT_TTL_MS } from '../src/limits.js'
import type { HistoryPage } from '../src/history.js'
import type { DppRecordInput } from '../src/storage.js'
import { bodyOf, newNode, PASSPORT_ID, UID, type TestNode } from './helpers.js'

/**
 * GET /history (spec/portable-evidence.md section 1): pages of one snapshot in
 * the store's sequence order. The store is seeded directly, because what is
 * under test is the page contract and the cursor, not admission; 1201 records
 * is two full pages of the maximum and a remainder, and twelve of the default
 * and a remainder.
 */

const schema = JSON.parse(readFileSync(new URL('../../../contracts/paginated-history.schema.json', import.meta.url), 'utf8'))
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)
const validatePage = ajv.compile(schema)

const HOST = '127.0.0.1'
const START = new Date('2026-09-05T12:00:00Z')
const TOTAL = 1201

function record(n: number, overrides: Partial<DppRecordInput> = {}): DppRecordInput {
  return {
    txid: `${n}`.padStart(64, '0'),
    outputIndex: 0,
    passportId: PASSPORT_ID,
    uid: UID,
    op: n === 0 ? 'ACTIVATE' : 'REPAIRED',
    timestamp: '2026-07-26T09:00:00Z',
    previousTxid: n === 0 ? '' : `${n - 1}`.padStart(64, '0'),
    spent: false,
    spendingTxid: '',
    createdAt: new Date(1_753_500_000_000 + n * 1000),
    ...overrides,
  }
}

let clock: Date
let node: TestNode
let running: RunningService | undefined
let base = ''

beforeEach(async () => {
  clock = new Date(START)
  node = newNode()
  for (let n = 0; n < TOTAL; n++) await node.records.insert(record(n))
  running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components, now: () => clock })
  base = `http://${HOST}:${running.port}`
})

afterEach(async () => {
  await running?.close()
  running = undefined
})

async function page(params: Record<string, string>): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${base}/history?${new URLSearchParams(params).toString()}`)
  return { status: response.status, body: await bodyOf(response) }
}

/** Walk an export to its end, asserting each page validates and the pages tile the snapshot. */
async function walk(params: Record<string, string>): Promise<HistoryPage[]> {
  const pages: HistoryPage[] = []
  let cursor: string | null = null
  for (;;) {
    const { status, body } = await page(cursor == null ? params : { ...params, cursor })
    expect(status).toBe(200)
    expect(validatePage(body), JSON.stringify(validatePage.errors)).toBe(true)
    pages.push(body as HistoryPage)
    cursor = body.nextCursor
    if (cursor == null) break
  }
  const snapshotIds = new Set(pages.map((p) => p.snapshotId))
  expect(snapshotIds.size).toBe(1)
  pages.forEach((p, i) => {
    const last = i === pages.length - 1
    expect(p.truncated).toBe(!last)
    expect(p.completeForSnapshot).toBe(last)
    expect(p.nextCursor == null).toBe(last)
    if (i > 0) expect(p.scope.sequenceRange.from).toBe(pages[i - 1].scope.sequenceRange.to + 1)
  })
  return pages
}

const sequences = (pages: HistoryPage[]): number[] => pages.flatMap((p) => p.items.map((i) => i.sequence))
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('GET /history', () => {
  it('pages 1201 records at the maximum and at the default, in sequence order, tiling the snapshot', async () => {
    const atMax = await walk({ passportId: PASSPORT_ID, limit: String(MAX_PAGE_SIZE) })
    expect(atMax.map((p) => p.items.length)).toEqual([500, 500, 201])
    expect(atMax.map((p) => p.pageSize)).toEqual([500, 500, 500])
    expect(sequences(atMax)).toEqual(range(1, TOTAL))
    expect(atMax.map((p) => p.scope.sequenceRange)).toEqual([{ from: 1, to: 500 }, { from: 501, to: 1000 }, { from: 1001, to: TOTAL }])
    expect(atMax[0].scope).toMatchObject({ source: 'ls_dpp', query: { passportId: PASSPORT_ID } })
    expect(atMax[0].items[0]).toEqual({
      txid: '0'.repeat(64), outputIndex: 0, op: 'ACTIVATE', timestamp: '2026-07-26T09:00:00Z',
      previousTxid: '', spent: false, spendingTxid: '', sequence: 1,
    })

    const atDefault = await walk({ passportId: PASSPORT_ID })
    expect(atDefault).toHaveLength(13)
    expect(atDefault.map((p) => p.pageSize)).toEqual(Array(13).fill(DEFAULT_PAGE_SIZE))
    expect(atDefault[12].items).toHaveLength(1)
    expect(sequences(atDefault)).toEqual(range(1, TOTAL))
  })

  it('keeps concurrent inserts out of an open snapshot and out of its page boundaries', async () => {
    const first = await page({ passportId: PASSPORT_ID, limit: '500' })
    expect(first.status).toBe(200)
    for (let n = TOTAL; n < TOTAL + 7; n++) await node.records.insert(record(n))

    const second = await page({ passportId: PASSPORT_ID, limit: '500', cursor: first.body.nextCursor })
    expect(second.body.items.map((i: { sequence: number }) => i.sequence)).toEqual(range(501, 1000))
    const third = await page({ passportId: PASSPORT_ID, limit: '500', cursor: second.body.nextCursor })
    expect(third.body.items.map((i: { sequence: number }) => i.sequence)).toEqual(range(1001, TOTAL))
    expect(third.body).toMatchObject({ nextCursor: null, completeForSnapshot: true, truncated: false, snapshotId: first.body.snapshotId })
    expect(third.body.scope.sequenceRange).toEqual({ from: 1001, to: TOTAL })

    // A second reader of the same snapshot receives the same second page.
    const again = await page({ passportId: PASSPORT_ID, limit: '500', cursor: first.body.nextCursor })
    expect(again.body).toEqual(second.body)

    // A fresh export sees a later snapshot with the inserts in it.
    const fresh = await walk({ passportId: PASSPORT_ID, limit: '500' })
    expect(fresh[0].snapshotId).not.toBe(first.body.snapshotId)
    expect(sequences(fresh)).toEqual(range(1, TOTAL + 7))
  })

  it('refuses a tampered cursor, a cursor from another process and a cursor for another query, by name', async () => {
    const first = await page({ passportId: PASSPORT_ID, limit: '500' })
    const cursor: string = first.body.nextCursor
    const [body, tag] = [cursor.slice(0, cursor.lastIndexOf('.')), cursor.slice(cursor.lastIndexOf('.') + 1)]
    // Each flip is chosen against the character it replaces, so the tampered
    // value always differs from the genuine one; choosing against the body's
    // first character for the tag made this assertion pass by luck one run in
    // sixty-four when the tag happened to start with the chosen letter.
    const flipped = body[0] === 'A' ? 'B' : 'A'
    const flippedTag = tag[0] === 'A' ? 'B' : 'A'
    for (const bad of [`${flipped}${body.slice(1)}.${tag}`, `${body}.${tag.slice(1)}`, body, 'nonsense', `${body}.${flippedTag}${tag.slice(1)}`]) {
      const { status, body: answer } = await page({ passportId: PASSPORT_ID, cursor: bad })
      expect(status).toBe(400)
      expect(answer).toMatchObject({ status: 'error', error: 'cursor-invalid' })
    }

    const other = newNode()
    for (let n = 0; n < 5; n++) await other.records.insert(record(n))
    const foreign = await startOverlayService(other.engine, { port: 0, host: HOST, components: other.components })
    try {
      const response = await fetch(`http://${HOST}:${foreign.port}/history?passportId=${encodeURIComponent(PASSPORT_ID)}&cursor=${encodeURIComponent(cursor)}`)
      expect(response.status).toBe(400)
      expect((await bodyOf(response)).error).toBe('cursor-invalid')
    } finally {
      await foreign.close()
    }

    const otherQuery = await page({ uid: UID, cursor })
    expect(otherQuery.status).toBe(400)
    expect(otherQuery.body).toMatchObject({ error: 'cursor-invalid', description: expect.stringContaining('different query') })
  })

  it('answers 410 snapshot-expired after ten minutes, with the instruction to restart', async () => {
    const first = await page({ passportId: PASSPORT_ID, limit: '500' })
    clock = new Date(START.getTime() + SNAPSHOT_TTL_MS)
    expect((await page({ passportId: PASSPORT_ID, limit: '500', cursor: first.body.nextCursor })).status).toBe(200)
    clock = new Date(START.getTime() + SNAPSHOT_TTL_MS + 1)
    const expired = await page({ passportId: PASSPORT_ID, limit: '500', cursor: first.body.nextCursor })
    expect(expired.status).toBe(410)
    expect(expired.body).toMatchObject({ status: 'error', error: 'snapshot-expired', hint: expect.stringContaining('without a cursor') })
    // Restarting without a cursor takes a new snapshot at the new clock.
    const restarted = await page({ passportId: PASSPORT_ID, limit: '500' })
    expect(restarted.status).toBe(200)
    expect(restarted.body.snapshotId).not.toBe(first.body.snapshotId)
  })

  it('lets a reader detect a repeated or a missing page from the sequences alone', async () => {
    const pages = await walk({ passportId: PASSPORT_ID, limit: '500' })
    const check = (received: HistoryPage[]): string[] => {
      const problems: string[] = []
      let expectFrom = 1
      for (const p of received) {
        if (p.scope.sequenceRange.from < expectFrom) problems.push(`repeated: page from ${p.scope.sequenceRange.from} seen before`)
        else if (p.scope.sequenceRange.from > expectFrom) problems.push(`missing: sequences ${expectFrom} to ${p.scope.sequenceRange.from - 1}`)
        for (const item of p.items) if (item.sequence < expectFrom) problems.push(`duplicate item ${item.sequence}`)
        expectFrom = p.scope.sequenceRange.to + 1
      }
      return problems
    }
    expect(check(pages)).toEqual([])
    expect(check([pages[0], pages[1], pages[1], pages[2]])).toEqual([
      'repeated: page from 501 seen before',
      ...range(501, 1000).map((s) => `duplicate item ${s}`),
    ])
    expect(check([pages[0], pages[2]])).toEqual(['missing: sequences 501 to 1000'])
  })

  it('validates limit: default 100, maximum 500, anything else refused by name', async () => {
    for (const limit of ['0', '501', 'abc', '1.5', '-1', '100abc']) {
      const { status, body } = await page({ passportId: PASSPORT_ID, limit })
      expect(status, limit).toBe(400)
      expect(body).toMatchObject({ status: 'error', error: 'limit-invalid' })
    }
    expect((await page({ passportId: PASSPORT_ID, limit: '1' })).body.pageSize).toBe(1)
    expect((await page({ passportId: PASSPORT_ID, limit: '500' })).body.pageSize).toBe(500)
    expect((await page({ passportId: PASSPORT_ID })).body.pageSize).toBe(100)
  })

  it('answers a uid query, and refuses neither or both selectors', async () => {
    const byUid = await walk({ uid: UID, limit: '500' })
    expect(sequences(byUid)).toEqual(range(1, TOTAL))
    expect(byUid[0].scope.query).toEqual({ uid: UID })
    for (const params of [{}, { passportId: PASSPORT_ID, uid: UID }, { passportId: '' }]) {
      const { status, body } = await page(params)
      expect(status).toBe(400)
      expect(body).toMatchObject({ status: 'error', error: 'query-invalid' })
    }
  })

  it('answers an empty, complete page for a passport it does not hold', async () => {
    const { status, body } = await page({ passportId: 'https://id.gs1.org/01/09506000134352/21/NOBODY' })
    expect(status).toBe(200)
    expect(validatePage(body)).toBe(true)
    expect(body).toMatchObject({ items: [], nextCursor: null, truncated: false, completeForSnapshot: true })
  })

  it('is 503 history-unavailable on a node started without its record store', async () => {
    const bare = await startOverlayService(newNode().engine, { port: 0, host: HOST })
    try {
      const response = await fetch(`http://${HOST}:${bare.port}/history?passportId=x`)
      expect(response.status).toBe(503)
      expect((await bodyOf(response)).error).toBe('history-unavailable')
    } finally {
      await bare.close()
    }
  })
})
