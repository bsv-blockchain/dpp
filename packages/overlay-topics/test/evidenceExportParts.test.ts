import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { Beef, MerklePath, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import { chainFromBeef, inspectEvidencePackage } from '@bsv/dpp-core'
import { buildCapabilities } from '../src/capabilities.js'
import { buildEvidenceExportPart, envelopeFiles, exportCoveragePreimage, exportManifestDigest, inspectEvidenceExportPart, joinEvidenceExport, type EvidenceExportPart, type EvidencePackageEnvelope } from '../src/evidenceExport.js'
import { HistoryPaginator } from '../src/history.js'
import { MAX_EXPORT_PART_BYTES, MAX_EXPORT_STATES, SNAPSHOT_TTL_MS } from '../src/limits.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, eventTx, fixtureChain, genesisTx, lookupPassport, newNode, SERVER_ID, submitBeef, type TestNode } from './helpers.js'

/**
 * GET /evidence-export (spec/portable-evidence.md section 2, the complete
 * export): a lineage longer than the bounded package's cap leaves operator A
 * as parts over one snapshot that tile its sequence range, joins complete,
 * and restores into operator B from the parts alone; a state admitted while
 * the parts are being read stays out of the snapshot; every bound, refusal
 * and join problem is named; and the bounded package keeps saying what it
 * does not carry.
 */

const root = new URL('../../../', import.meta.url)
const packageSchema = JSON.parse(readFileSync(new URL('contracts/evidence-package.schema.json', root), 'utf8'))
const exportSchema = JSON.parse(readFileSync(new URL('contracts/evidence-export.schema.json', root), 'utf8'))
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)
ajv.addSchema(packageSchema)
const validatePart = ajv.compile(exportSchema)

const HOST = '127.0.0.1'
const EXPORT_KEY = PrivateKey.fromHex('77'.repeat(32))
const EXPORTER = EXPORT_KEY.toPublicKey().toString()
const NOW = new Date('2026-09-06T12:00:00Z')
const LONG = 505
const LONG_PASSPORT = 'https://dpp.bsvb.net/01/09521000000018/21/LONG-EXPORT-1'
const LONG_UID = 'LONG-EXPORT-UID'
const F = fixtureChain()

/** A connected lineage of LONG states, each proven before the next spends it so every BEEF stays compact. */
let long: { txs: Transaction[]; beefs: number[][] }

beforeAll(async () => {
  const txs: Transaction[] = []
  const beefs: number[][] = []
  const stamp = (i: number): string => new Date(Date.UTC(2026, 6, 26, 9, 0, i)).toISOString().replace(/\.000Z$/, 'Z')
  const payloadPublic = JSON.stringify({ name: 'Long lineage', dataCarrier: LONG_UID })
  let { tx } = await genesisTx({ passportId: LONG_PASSPORT, payloadPublic, timestamp: stamp(0) })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_200)
  txs.push(tx)
  beefs.push(tx.toBEEF())
  for (let i = 1; i < LONG; i++) {
    const next = (await eventTx(tx, { passportId: LONG_PASSPORT, payloadPublic, op: i % 2 === 0 ? 'REPAIRED' : 'SOLD', timestamp: stamp(i) })).tx
    next.merklePath = MerklePath.fromCoinbaseTxidAndHeight(next.id('hex'), 800_200 + i)
    txs.push(next)
    beefs.push(next.toBEEF())
    tx = next
  }
  long = { txs, beefs }
}, 120_000)

let running: RunningService[] = []
afterEach(async () => {
  await Promise.all(running.map((r) => r.close()))
  running = []
})

async function serve(node: TestNode, extra: Record<string, unknown> = {}): Promise<string> {
  const service = await startOverlayService(node.engine, {
    port: 0,
    host: HOST,
    components: node.components,
    exportSigningKey: EXPORT_KEY.toHex(),
    now: () => NOW,
    ...extra,
  })
  running.push(service)
  return `http://${HOST}:${service.port}`
}

/** Admit a lineage straight into the engine, the way a backfill or a restore does. */
async function admit(node: TestNode, beefs: number[][]): Promise<void> {
  for (const beef of beefs) {
    const steak = await node.engine.submit({ beef, topics: ['tm_dpp'] })
    expect(steak.tm_dpp.outputsToAdmit).toHaveLength(1)
  }
}

async function fetchPart(base: string, passportId: string, cursor?: string | null, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> {
  const query = `passportId=${encodeURIComponent(passportId)}${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
  const response = await fetch(`${base}/evidence-export?${query}`, { headers })
  return { status: response.status, body: await bodyOf(response) }
}

/** Walk every part of one export over HTTP, asserting each validates. */
async function walk(base: string, passportId: string, headers: Record<string, string> = {}): Promise<EvidenceExportPart[]> {
  const parts: EvidenceExportPart[] = []
  let cursor: string | null | undefined
  for (;;) {
    const { status, body } = await fetchPart(base, passportId, cursor, headers)
    expect(status).toBe(200)
    expect(validatePart(body), JSON.stringify(validatePart.errors)).toBe(true)
    parts.push(body as EvidenceExportPart)
    cursor = body.nextCursor
    if (cursor == null) return parts
  }
}

/** Build parts in process with narrowed bounds, the way the route does it with the defaults. */
async function buildParts(node: TestNode, passportId: string, bounds: { maxStates?: number; maxBytes?: number } = {}, now: () => Date = () => NOW): Promise<{ parts: EvidenceExportPart[]; paginator: HistoryPaginator }> {
  const paginator = new HistoryPaginator(node.records, { now })
  const parts: EvidenceExportPart[] = []
  let cursor: string | null | undefined
  for (;;) {
    const part = await buildEvidenceExportPart({ passportId, cursor, paginator, engineStorage: node.storage, signingKey: EXPORT_KEY, now: now(), software: 'test', ...bounds })
    if (part == null) throw new Error('nothing held')
    expect(validatePart(part), JSON.stringify(validatePart.errors)).toBe(true)
    parts.push(part)
    cursor = part.nextCursor
    if (cursor == null) return { parts, paginator }
  }
}

const ranges = (parts: EvidenceExportPart[]): Array<[number, number]> => parts.map((p) => [p.part.sequenceRange.from, p.part.sequenceRange.to])

describe('GET /evidence-export', () => {
  it(`exports ${LONG} connected states as parts over one snapshot that tile it, join complete and restore into a second operator`, async () => {
    const a = newNode()
    const baseA = await serve(a)
    for (const beef of long.beefs) expect((await submitBeef(baseA, beef)).headers.get('x-admission')).toBe('tm_dpp=admitted')

    const parts = await walk(baseA, LONG_PASSPORT)
    expect(parts.map((p) => [p.part.index, p.part.states, p.final])).toEqual([[1, MAX_EXPORT_STATES, false], [2, LONG - MAX_EXPORT_STATES, true]])
    expect(ranges(parts)).toEqual([[1, MAX_EXPORT_STATES], [MAX_EXPORT_STATES + 1, LONG]])
    expect(parts.every((p) => p.snapshot.id === parts[0].snapshot.id && p.snapshot.sequence === LONG && p.snapshot.source === 'ls_dpp')).toBe(true)
    expect(parts[0].nextCursor).toEqual(expect.any(String))
    expect(parts[1].nextCursor).toBeNull()

    // Each part is a package of its own: inspected on its three questions, with its own declarations.
    for (const part of parts) {
      const inspection = inspectEvidencePackage(part.package.manifest, envelopeFiles(part.package), { expectedPassportId: LONG_PASSPORT, expectedSigner: EXPORTER })
      expect(inspection).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [], recoveryBackup: false })
      expect(part.package.manifest.completeness.absent).toEqual([])
      expect(part.package.manifest.completeness.withheld).toHaveLength(3)
      expect(part.package.manifest.disclosure).toEqual({ scope: 'public', recoveryBackup: false })
      expect(part.package.manifest.inventory.map((e) => e.category)).not.toContain('reports')
    }
    const [first, second] = parts.map((p) => p.package.manifest)
    expect(first.genesis).toEqual({ txid: long.txs[0].id('hex'), outputIndex: 0 })
    expect(first.selectedTip).toBeUndefined()
    expect(first.completeness.snapshots).toEqual([{ source: 'ls_dpp', snapshotId: parts[0].snapshot.id, completeForSnapshot: false, scope: `passportId=${LONG_PASSPORT}; sequences 1..${MAX_EXPORT_STATES} of snapshot ${parts[0].snapshot.id}; part 1 of the complete export` }])
    expect(second.genesis).toBeUndefined()
    expect(second.selectedTip).toEqual({ txid: long.txs[LONG - 1].id('hex'), outputIndex: 0 })
    expect(second.completeness.snapshots[0]).toMatchObject({ completeForSnapshot: false, scope: expect.stringContaining('part 2 of the complete export') })
    expect(Object.keys(first.inventory.length === 0 ? {} : parts[0].package.files).filter((p) => p.startsWith('status/'))).toEqual(['status/spend-observations-part-1.json'])

    // Joined, the parts are the whole snapshot: every transaction and proof, none repeated, nothing missing.
    const joined = joinEvidenceExport(parts, { expectedPassportId: LONG_PASSPORT, expectedSigner: EXPORTER })
    expect(joined.problems).toEqual([])
    expect(joined.complete).toBe(true)
    expect(joined.absent).toEqual([])
    expect([...joined.files.keys()].filter((p) => p.startsWith('transactions/'))).toHaveLength(LONG)
    expect([...joined.files.keys()].filter((p) => p.startsWith('proofs/'))).toHaveLength(LONG)
    for (const [i, tx] of long.txs.entries()) {
      expect(Utils.toHex(joined.files.get(`transactions/${tx.id('hex')}.tx`)!)).toBe(tx.toHex())
      if (i % 100 === 0) expect(Transaction.fromBEEF(joined.files.get(`proofs/${tx.id('hex')}.beef`)!).id('hex')).toBe(tx.id('hex'))
    }

    // The bounded package for the same passport still says what it does not carry, and names no genesis it does not hold.
    const bounded = await bodyOf(await fetch(`${baseA}/evidence-package?passportId=${encodeURIComponent(LONG_PASSPORT)}`)) as EvidencePackageEnvelope
    expect(bounded.manifest.completeness.snapshots[0].completeForSnapshot).toBe(false)
    expect(bounded.manifest.completeness.absent).toEqual(long.txs.slice(0, LONG - MAX_EXPORT_STATES).flatMap((tx) => [`transaction:${tx.id('hex')}:0`, `proof:${tx.id('hex')}:0`]))
    expect(bounded.manifest.genesis).toBeUndefined()
    expect(bounded.manifest.selectedTip).toEqual({ txid: long.txs[LONG - 1].id('hex'), outputIndex: 0 })
    expect(inspectEvidencePackage(bounded.manifest, envelopeFiles(bounded), { expectedPassportId: LONG_PASSPORT })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true })

    // Operator B: a fresh engine under the same publisher key, fed the joined proofs in the order the transactions dictate.
    const merged = new Beef()
    const proofs = new Map<string, number[]>()
    for (const [path, bytes] of joined.files) {
      if (!path.startsWith('proofs/')) continue
      proofs.set(path.slice('proofs/'.length, -'.beef'.length), bytes)
      merged.mergeBeef(bytes)
    }
    const ordered = chainFromBeef(merged, LONG_PASSPORT)
    expect(ordered.map((tx) => tx.id('hex'))).toEqual(long.txs.map((tx) => tx.id('hex')))
    const b = newNode()
    await admit(b, ordered.map((tx) => proofs.get(tx.id('hex'))!))

    // A is gone; B serves the whole history, and B's own complete export joins complete.
    await running.shift()!.close()
    const baseB = await serve(b)
    const fromB = await lookupPassport(baseB, { passportId: LONG_PASSPORT })
    expect(fromB).toHaveLength(MAX_EXPORT_STATES)
    const spent = new Map<string, boolean>()
    let cursor: string | null = null
    do {
      const page: Record<string, any> = await bodyOf(await fetch(`${baseB}/history?passportId=${encodeURIComponent(LONG_PASSPORT)}&limit=500${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`))
      for (const item of page.items) spent.set(item.txid, item.spent)
      cursor = page.nextCursor
      if (cursor == null) expect(page.completeForSnapshot).toBe(true)
    } while (cursor != null)
    expect(spent.size).toBe(LONG)
    expect([...spent.values()].filter((s) => !s)).toHaveLength(1)
    expect(spent.get(long.txs[LONG - 1].id('hex'))).toBe(false)
    const again = joinEvidenceExport(await walk(baseB, LONG_PASSPORT), { expectedPassportId: LONG_PASSPORT, expectedSigner: EXPORTER })
    expect(again.problems).toEqual([])
    expect(again.complete).toBe(true)
    expect([...again.files.keys()].filter((p) => p.startsWith('transactions/')).sort()).toEqual([...joined.files.keys()].filter((p) => p.startsWith('transactions/')).sort())
  }, 180_000)

  it('closes a part on the byte bound with at least one state, and on the state bound, and the parts still tile', async () => {
    const node = newNode(F.serverKey)
    await admit(node, F.beefs)
    const byBytes = await buildParts(node, F.passportId, { maxBytes: 1 })
    expect(byBytes.parts.map((p) => p.part.states)).toEqual([1, 1, 1, 1, 1, 1])
    expect(ranges(byBytes.parts)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])
    expect(joinEvidenceExport(byBytes.parts, { expectedPassportId: F.passportId })).toMatchObject({ complete: true, problems: [] })

    const byStates = await buildParts(node, F.passportId, { maxStates: 4 })
    expect(byStates.parts.map((p) => [p.part.index, p.part.states, p.final])).toEqual([[1, 4, false], [2, 2, true]])
    expect(ranges(byStates.parts)).toEqual([[1, 4], [5, 6]])
    expect(joinEvidenceExport(byStates.parts, { expectedPassportId: F.passportId })).toMatchObject({ complete: true, problems: [] })

    // Within the defaults, one part is the whole snapshot and says so, exactly as the bounded package does.
    const whole = await buildParts(node, F.passportId)
    expect(whole.parts).toHaveLength(1)
    expect(whole.parts[0]).toMatchObject({ final: true, nextCursor: null, part: { index: 1, states: 6, sequenceRange: { from: 1, to: 6 } } })
    expect(whole.parts[0].package.manifest.completeness.snapshots[0]).toEqual({ source: 'ls_dpp', snapshotId: whole.parts[0].snapshot.id, completeForSnapshot: true, scope: `passportId=${F.passportId}` })
    expect(whole.parts[0].package.manifest.genesis).toEqual({ txid: F.txs[0].id('hex'), outputIndex: F.outputIndexes[0] })
    expect(whole.parts[0].package.manifest.selectedTip).toEqual({ txid: F.txs[5].id('hex'), outputIndex: F.outputIndexes[5] })

    // A bound above the limits module's numbers is the limits module's numbers.
    const paginator = new HistoryPaginator(node.records, { now: () => NOW })
    const capped = await buildEvidenceExportPart({ passportId: F.passportId, paginator, engineStorage: node.storage, signingKey: EXPORT_KEY, now: NOW, software: 'test', maxStates: MAX_EXPORT_STATES * 10, maxBytes: MAX_EXPORT_PART_BYTES * 10 })
    expect(capped?.part.states).toBe(6)
  })

  it('keeps a state admitted during the export out of the snapshot, and a fresh export reads it', async () => {
    const node = newNode()
    await admit(node, long.beefs.slice(0, 5))
    const paginator = new HistoryPaginator(node.records, { now: () => NOW })
    const build = (cursor?: string | null) => buildEvidenceExportPart({ passportId: LONG_PASSPORT, cursor, paginator, engineStorage: node.storage, signingKey: EXPORT_KEY, now: NOW, software: 'test', maxStates: 3 })
    const first = (await build())!
    expect(first).toMatchObject({ snapshot: { sequence: 5 }, part: { index: 1, states: 3, sequenceRange: { from: 1, to: 3 } }, final: false })

    await admit(node, long.beefs.slice(5, 7))
    const second = (await build(first.nextCursor))!
    expect(second).toMatchObject({ snapshot: { id: first.snapshot.id, sequence: 5 }, part: { index: 2, states: 2, sequenceRange: { from: 4, to: 5 } }, final: true, nextCursor: null })
    // The tip within the snapshot is state 5, spent by now in the store; the part says what the store says.
    expect(second.package.manifest.selectedTip).toBeUndefined()
    const joined = joinEvidenceExport([first, second], { expectedPassportId: LONG_PASSPORT })
    expect(joined).toMatchObject({ complete: true, problems: [] })
    expect([...joined.files.keys()].filter((p) => p.startsWith('transactions/'))).toHaveLength(5)

    const fresh = await buildParts(node, LONG_PASSPORT, { maxStates: 3 })
    expect(fresh.parts.map((p) => p.part.states)).toEqual([3, 3, 1])
    expect(fresh.parts[0].snapshot.id).not.toBe(first.snapshot.id)
    expect(fresh.parts[2].package.manifest.selectedTip).toEqual({ txid: long.txs[6].id('hex'), outputIndex: 0 })
    expect([...joinEvidenceExport(fresh.parts).files.keys()].filter((p) => p.startsWith('transactions/'))).toHaveLength(7)
  })

  it('refuses a tampered cursor, a history cursor, a cursor for another passport and an expired snapshot, by name', async () => {
    let clock = new Date(NOW)
    const node = newNode(F.serverKey)
    await admit(node, F.beefs)
    const base = await serve(node, { now: () => clock })
    // A first part with room to continue needs a lineage longer than one part; narrow through a direct build over the same paginator is not reachable over HTTP, so use the long lineage.
    const longNode = newNode()
    await admit(longNode, long.beefs)
    const longBase = await serve(longNode, { now: () => clock })
    const first = await fetchPart(longBase, LONG_PASSPORT)
    expect(first.status).toBe(200)
    const cursor: string = first.body.nextCursor
    const [body, tag] = [cursor.slice(0, cursor.lastIndexOf('.')), cursor.slice(cursor.lastIndexOf('.') + 1)]
    const flipped = body[0] === 'A' ? 'B' : 'A'
    for (const bad of [`${flipped}${body.slice(1)}.${tag}`, `${body}.${tag.slice(1)}`, body, 'nonsense']) {
      const refused = await fetchPart(longBase, LONG_PASSPORT, bad)
      expect(refused.status).toBe(400)
      expect(refused.body).toMatchObject({ status: 'error', error: 'cursor-invalid' })
    }
    const other = await fetchPart(longBase, F.passportId, cursor)
    expect(other.status).toBe(400)
    expect(other.body).toMatchObject({ error: 'cursor-invalid', description: expect.stringContaining('different query') })

    const history = await bodyOf(await fetch(`${longBase}/history?passportId=${encodeURIComponent(LONG_PASSPORT)}&limit=1`))
    const crossed = await fetchPart(longBase, LONG_PASSPORT, history.nextCursor)
    expect(crossed.status).toBe(400)
    expect(crossed.body).toMatchObject({ error: 'cursor-invalid', description: 'the cursor was issued for the history, not the export' })
    const reverse = await bodyOf(await fetch(`${longBase}/history?passportId=${encodeURIComponent(LONG_PASSPORT)}&cursor=${encodeURIComponent(cursor)}`))
    expect(reverse).toMatchObject({ error: 'cursor-invalid', description: 'the cursor was issued for the export, not the history' })

    const foreign = await fetchPart(base, LONG_PASSPORT, cursor)
    expect(foreign.status).toBe(400)
    expect(foreign.body.error).toBe('cursor-invalid')

    clock = new Date(NOW.getTime() + SNAPSHOT_TTL_MS)
    expect((await fetchPart(longBase, LONG_PASSPORT, cursor)).status).toBe(200)
    clock = new Date(NOW.getTime() + SNAPSHOT_TTL_MS + 1)
    const expired = await fetchPart(longBase, LONG_PASSPORT, cursor)
    expect(expired.status).toBe(410)
    expect(expired.body).toMatchObject({ status: 'error', error: 'snapshot-expired', hint: expect.stringContaining('restart the complete export without a cursor') })
    const restarted = await fetchPart(longBase, LONG_PASSPORT)
    expect(restarted.status).toBe(200)
    expect(restarted.body.snapshot.id).not.toBe(first.body.snapshot.id)
  }, 120_000)

  it('requires the bearer when EXPORT_TOKEN is set, and leaves the bounded package and the history open', async () => {
    const node = newNode(F.serverKey)
    await admit(node, F.beefs)
    const base = await serve(node, { exportToken: 'operator-export-secret' })
    const refused = await fetchPart(base, F.passportId)
    expect(refused.status).toBe(401)
    expect(refused.body).toMatchObject({ status: 'error', error: 'export-unauthorised' })
    expect((await fetchPart(base, F.passportId, undefined, { authorization: 'Bearer wrong' })).status).toBe(401)
    const parts = await walk(base, F.passportId, { authorization: 'Bearer operator-export-secret' })
    expect(parts).toHaveLength(1)
    expect((await fetch(`${base}/evidence-package?passportId=${encodeURIComponent(F.passportId)}`)).status).toBe(200)
    expect((await fetch(`${base}/history?passportId=${encodeURIComponent(F.passportId)}`)).status).toBe(200)
    const capabilities = await bodyOf(await fetch(`${base}/capabilities`))
    expect(capabilities.limits.evidenceExport).toBe('bearer')
  })

  it('answers 503 export-unavailable without a signing key, 404 for an unknown passport and 400 without one', async () => {
    const unsigned = newNode()
    const bare = await startOverlayService(unsigned.engine, { port: 0, host: HOST, components: unsigned.components })
    running.push(bare)
    const refused = await fetchPart(`http://${HOST}:${bare.port}`, 'x')
    expect(refused.status).toBe(503)
    expect(refused.body).toMatchObject({ status: 'error', error: 'export-unavailable' })
    const base = await serve(newNode())
    const unknown = await fetchPart(base, 'https://dpp.bsvb.net/01/09521000000018/21/NOBODY')
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toBe('passport-unknown')
    const missing = await fetch(`${base}/evidence-export`)
    expect(missing.status).toBe(400)
    expect((await bodyOf(missing)).error).toBe('query-invalid')
  })

  it('the join names a repeated part, a missing part, a part from another snapshot, a flipped byte, a wrong passport and a false final', async () => {
    const node = newNode(F.serverKey)
    await admit(node, F.beefs)
    const { parts } = await buildParts(node, F.passportId, { maxStates: 2 })
    expect(parts).toHaveLength(3)
    const problemsOf = (given: EvidenceExportPart[], options: Parameters<typeof joinEvidenceExport>[1] = {}) => joinEvidenceExport(given, options).problems

    expect(joinEvidenceExport([])).toMatchObject({ complete: false, problems: ['no parts were supplied'] })
    expect(problemsOf([parts[2], parts[0], parts[1]])).toEqual([])
    expect(problemsOf([parts[0], parts[1], parts[1], parts[2]])).toContain('part 2 is repeated')
    expect(problemsOf([parts[0], parts[2]])).toEqual(expect.arrayContaining(['part 3 arrived where part 2 was expected', 'part 3 covers 5..6; sequences 3..4 are missing']))
    expect(problemsOf([parts[0], parts[1]])).toEqual(expect.arrayContaining(['part 2 is the last part received and is not final']))
    // A wrong expectation fails every part on its own before any tiling: the package is about another passport, or signed by another key.
    expect(problemsOf(parts, { expectedPassportId: 'someone-else' })).toEqual(expect.arrayContaining([`part 1: the package is about ${F.passportId}, not someone-else`, 'part 1: its coverage is not established, so its range, index and finality are not counted']))
    expect(problemsOf(parts, { expectedSigner: SERVER_ID })).toEqual(expect.arrayContaining([expect.stringContaining('part 1: signed by'), `part 1: the coverage record is signed by ${EXPORTER}, not the expected ${SERVER_ID}`]))

    const later = await buildParts(node, F.passportId, { maxStates: 2 }, () => new Date(NOW.getTime() + 1000))
    expect(problemsOf([parts[0], later.parts[1], parts[2]])).toEqual(expect.arrayContaining([`part 2 is from snapshot ${later.parts[1].snapshot.id}, not ${parts[0].snapshot.id}`]))

    const flipped: EvidenceExportPart = { ...parts[1], package: { ...parts[1].package, files: { ...parts[1].package.files } } }
    const path = Object.keys(flipped.package.files).find((p) => p.startsWith('transactions/'))!
    const bytes = Utils.toArray(flipped.package.files[path], 'base64')
    bytes[10] ^= 0x01
    flipped.package.files[path] = Utils.toBase64(bytes)
    // A part whose package does not inspect clean contributes nothing to the tiling, so the gap it leaves is named too.
    expect(problemsOf([parts[0], flipped, parts[2]])).toEqual([
      `part 2: ${path} does not hash to its inventory digest`,
      'part 2: its coverage is not established, so its range, index and finality are not counted',
      'part 3 arrived where part 2 was expected',
      'part 3 covers 5..6; sequences 3..4 are missing',
    ])

    // A final flag or a range edited outside the signature is a signature failure first; the part then counts for nothing.
    const claimed: EvidenceExportPart = { ...parts[1], final: true }
    expect(problemsOf([parts[0], claimed, parts[2]])).toEqual(expect.arrayContaining([expect.stringContaining('part 2: the coverage signature does not verify'), 'part 2: its coverage is not established, so its range, index and finality are not counted']))
    const shortened: EvidenceExportPart = { ...parts[2], part: { ...parts[2].part, sequenceRange: { from: 5, to: 5 } } }
    expect(problemsOf([parts[0], parts[1], shortened])).toEqual(expect.arrayContaining([expect.stringContaining('part 3: the coverage signature does not verify'), 'part 2 is the last part received and is not final']))
  })

  it('trusts no unsigned wrapper field: a genuine first part dressed as a whole export, or any altered coverage fact, is refused by the coverage signature', async () => {
    const node = newNode(F.serverKey)
    await admit(node, F.beefs)
    const { parts } = await buildParts(node, F.passportId, { maxStates: 3 })
    expect(parts).toHaveLength(2)
    const expected = { expectedPassportId: F.passportId, expectedSigner: EXPORTER }
    const clone = (part: EvidenceExportPart): EvidenceExportPart => JSON.parse(JSON.stringify(part))
    const transactions = (joined: ReturnType<typeof joinEvidenceExport>) => [...joined.files.keys()].filter((p) => p.startsWith('transactions/')).length

    // The unmodified two-part export joins complete, and each part's coverage is authentic and bound.
    const whole = joinEvidenceExport(parts, expected)
    expect(whole).toMatchObject({ complete: true, problems: [] })
    expect(transactions(whole)).toBe(6)
    for (const part of parts) {
      expect(validatePart(part), JSON.stringify(validatePart.errors)).toBe(true)
      expect(inspectEvidenceExportPart(part, expected)).toMatchObject({ coverageAuthentic: true, manifestBound: true, failures: [] })
      expect(part.manifestSha256).toBe(exportManifestDigest(part.package.manifest))
      expect(part.signature.signer).toBe(part.package.manifest.signature.signer)
    }

    // The reviewed scenario: the first part alone, with only its unsigned wrapper edited to look final and whole.
    const dressed = clone(parts[0])
    dressed.final = true
    dressed.nextCursor = null
    dressed.part.sequenceRange.to = dressed.snapshot.sequence
    const refused = joinEvidenceExport([dressed], expected)
    expect(refused.complete).toBe(false)
    expect(refused.problems).toEqual(expect.arrayContaining([
      `part 1: the coverage signature does not verify under ${EXPORTER}; its range, index and finality establish nothing`,
      'part 1: its coverage is not established, so its range, index and finality are not counted',
    ]))
    expect(transactions(refused)).toBe(0)
    expect(joinEvidenceExport([parts[0]], expected)).toMatchObject({ complete: false, problems: ['part 1 is the last part received and is not final'] })

    // Every other coverage fact is under the same signature.
    const altered: Array<[string, (p: EvidenceExportPart) => void]> = [
      ['index', (p) => { p.part.index = 3 }],
      ['states', (p) => { p.part.states = 9 }],
      ['from', (p) => { p.part.sequenceRange.from = 0 }],
      ['snapshot id', (p) => { p.snapshot.id = 'other' }],
      ['snapshot sequence', (p) => { p.snapshot.sequence = 99 }],
      ['snapshot source', (p) => { p.snapshot.source = 'ls_other' }],
      ['passport', (p) => { p.passportId = 'https://dpp.bsvb.net/01/09521000000018/21/OTHER' }],
      ['manifest digest', (p) => { p.manifestSha256 = '0'.repeat(64) }],
      ['export version', (p) => { (p as { exportVersion: string }).exportVersion = '2' }],
    ]
    for (const [what, mutate] of altered) {
      const part = clone(parts[1])
      mutate(part)
      const inspection = inspectEvidenceExportPart(part, { expectedPassportId: part.passportId, expectedSigner: EXPORTER })
      expect(inspection.coverageAuthentic, what).toBe(false)
      expect(joinEvidenceExport([parts[0], part], expected).complete, what).toBe(false)
    }

    // A genuine package under another genuine part's coverage record: the digest binding refuses it, and a recomputed digest fails the signature.
    const substituted = clone(parts[0])
    substituted.package = clone(parts[1]).package
    const bound = inspectEvidenceExportPart(substituted, expected)
    expect(bound.coverageAuthentic).toBe(true)
    expect(bound.manifestBound).toBe(false)
    expect(bound.failures).toEqual(expect.arrayContaining([expect.stringContaining('the package is not the one the record covers')]))
    substituted.manifestSha256 = exportManifestDigest(substituted.package.manifest)
    expect(inspectEvidenceExportPart(substituted, expected).coverageAuthentic).toBe(false)

    // A coverage record re-signed by another key is refused as another signer, whatever it says.
    const stranger = PrivateKey.fromHex('88'.repeat(32))
    const resigned = clone(parts[0])
    resigned.final = true
    resigned.nextCursor = null
    resigned.part.sequenceRange.to = resigned.snapshot.sequence
    resigned.signature = { suite: 'bsv-ecdsa-der', signer: stranger.toPublicKey().toString(), value: '' }
    resigned.signature.value = Utils.toHex(stranger.sign(exportCoveragePreimage(resigned)).toDER() as number[])
    const strangerInspection = inspectEvidenceExportPart(resigned, expected)
    expect(strangerInspection.coverageAuthentic).toBe(true)
    expect(strangerInspection.failures).toEqual(expect.arrayContaining([
      `part 1: the coverage record is signed by ${stranger.toPublicKey().toString()} but the package by ${EXPORTER}`,
      `part 1: the coverage record is signed by ${stranger.toPublicKey().toString()}, not the expected ${EXPORTER}`,
    ]))
    expect(joinEvidenceExport([resigned], expected).complete).toBe(false)
    // And without an expected signer, the package's own signer is the one the record must carry.
    expect(joinEvidenceExport([resigned], { expectedPassportId: F.passportId }).complete).toBe(false)

    // A discarded suffix whose remaining last part is genuine but not final stays incomplete, with the unsigned cursor agreeing.
    const truncated = clone(parts[0])
    truncated.nextCursor = null
    expect(joinEvidenceExport([truncated], expected).problems).toEqual(expect.arrayContaining(['part 1 says final false but nextCursor is null', 'part 1 is the last part received and is not final']))
  })

  it('the capability document states the complete export as open, behind a bearer or unavailable, with its bounds', () => {
    const at = new Date('2026-09-05T12:00:00Z')
    const off = buildCapabilities({ serviceIdentityKey: SERVER_ID, exportAvailable: false, networkOracleConfigured: false, at })
    expect(off.limits.evidenceExport).toBe('unavailable')
    expect(off.unsupported.find((u) => u.id === 'evidence-package-export')?.reason).toContain('GET /evidence-export')
    const open = buildCapabilities({ serviceIdentityKey: SERVER_ID, exportAvailable: true, networkOracleConfigured: false, at })
    expect(open.limits).toMatchObject({ evidenceExport: 'open', maxEvidenceExportPartStates: MAX_EXPORT_STATES, maxEvidenceExportPartBytes: MAX_EXPORT_PART_BYTES })
    const bearer = buildCapabilities({ serviceIdentityKey: SERVER_ID, exportAvailable: true, completeExportBearer: true, networkOracleConfigured: false, at })
    expect(bearer.limits.evidenceExport).toBe('bearer')
  })
})
