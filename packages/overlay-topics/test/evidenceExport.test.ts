import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { Beef, PrivateKey, ProtoWallet, Transaction, Utils } from '@bsv/sdk'
import { chainFromBeef, inspectEvidencePackage, type EvidencePackageManifest, type EvidenceReport } from '@bsv/dpp-core'
import { envelopeFiles, type EvidencePackageEnvelope } from '../src/evidenceExport.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, eventTx, fixtureChain, genesisTx, lookupPassport, makeData, newNode, submitBeef, type TestNode } from './helpers.js'
import { K1, K2, OPERATORS, policyChain } from './policy-fixture.js'

/**
 * GET /evidence-package (spec/portable-evidence.md section 2): the passport
 * admitted from fixtures/chain-v1.json leaves operator A as a signed package,
 * is inspected on its three separate questions, survives a flipped byte only
 * in the answer that should notice it, and is restored into operator B from
 * nothing but the package, after which B answers the lookup A did.
 */

const root = new URL('../../../', import.meta.url)
const schema = JSON.parse(readFileSync(new URL('contracts/evidence-package.schema.json', root), 'utf8'))
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)
const validateManifest = ajv.compile(schema)

const HOST = '127.0.0.1'
const EXPORT_KEY = PrivateKey.fromHex('77'.repeat(32))
const EXPORTER = EXPORT_KEY.toPublicKey().toString()
const NOW = new Date('2026-09-05T12:00:00Z')
const F = fixtureChain()

let running: RunningService[] = []
afterEach(async () => {
  await Promise.all(running.map((r) => r.close()))
  running = []
  vi.restoreAllMocks()
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

/** The fixture chain, announced the way a backfill does: each state atomic over its predecessors. */
async function admitFixture(base: string): Promise<void> {
  for (const beef of F.beefs) {
    const response = await submitBeef(base, beef)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-admission')).toBe('tm_dpp=admitted')
  }
}

async function exportPackage(base: string, passportId: string): Promise<{ status: number; envelope: EvidencePackageEnvelope; body: Record<string, any> }> {
  const response = await fetch(`${base}/evidence-package?passportId=${encodeURIComponent(passportId)}`)
  const body = await bodyOf(response)
  return { status: response.status, envelope: body as EvidencePackageEnvelope, body }
}

const parseJsonFile = (envelope: EvidencePackageEnvelope, path: string): any =>
  JSON.parse(Utils.toUTF8(Utils.toArray(envelope.files[path], 'base64')))

describe('GET /evidence-package', () => {
  it('exports the fixture passport as a package whose structure, inventory and signature all verify', async () => {
    const node = newNode(F.serverKey)
    const base = await serve(node)
    await admitFixture(base)

    const { status, envelope } = await exportPackage(base, F.passportId)
    expect(status).toBe(200)
    const { manifest } = envelope
    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true)

    const inspection = inspectEvidencePackage(manifest, envelopeFiles(envelope), { expectedPassportId: F.passportId, expectedSigner: EXPORTER })
    expect(inspection).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [], recoveryBackup: false })

    const paths = Object.keys(envelope.files).sort()
    expect(paths).toEqual([
      ...F.txs.map((tx) => `proofs/${tx.id('hex')}.beef`),
      'reports/verification-report.json',
      'status/spend-observations.json',
      ...F.txs.map((tx) => `transactions/${tx.id('hex')}.tx`),
    ].sort())
    expect(manifest.inventory.map((e) => e.path).sort()).toEqual(paths)
    expect(manifest).toMatchObject({
      format: 'dpp-evidence-package',
      version: '1',
      passportId: F.passportId,
      genesis: { txid: F.txs[0].id('hex'), outputIndex: F.outputIndexes[0] },
      selectedTip: { txid: F.txs[5].id('hex'), outputIndex: F.outputIndexes[5] },
      exportedAt: NOW.toISOString(),
      exporter: { id: EXPORTER, role: 'overlay', software: expect.stringContaining('@bsv/dpp-overlay-topics@') },
      profiles: ['single-operator@1'],
      policyId: 'reference-node-environment',
      disclosure: { scope: 'public', recoveryBackup: false },
    })
    expect(manifest.completeness.snapshots).toEqual([{ source: 'ls_dpp', snapshotId: expect.any(String), completeForSnapshot: true, scope: `passportId=${F.passportId}` }])
    expect(manifest.completeness.withheld).toHaveLength(3)
    expect(manifest.completeness.withheld.join(' ')).toMatch(/owner.*legitimate.*authority/)
    // Every fixture state carries a synthetic proof here, so nothing is absent.
    expect(manifest.completeness.absent).toEqual([])
    expect(manifest.sources.map((s) => [s.kind, s.result])).toEqual([['overlay-lookup', 'unspent'], ['spend-status', 'unspent']])

    // The raw transactions are the fixture's pinned bytes, and the SOLD state sits at index 1.
    for (const [i, tx] of F.txs.entries()) {
      expect(Utils.toHex(Utils.toArray(envelope.files[`transactions/${tx.id('hex')}.tx`], 'base64'))).toBe(tx.toHex())
      expect(manifest.inventory.find((e) => e.path === `transactions/${tx.id('hex')}.tx`)).toMatchObject({
        category: 'transactions', represents: `${tx.id('hex')}:${F.outputIndexes[i]}`, representation: 'raw-transaction',
      })
    }

    const observations = parseJsonFile(envelope, 'status/spend-observations.json')
    expect(observations.states.map((s: { spent: boolean }) => s.spent)).toEqual([true, true, true, true, true, false])
    expect(observations.snapshotId).toBe(manifest.completeness.snapshots[0].snapshotId)

    const report = parseJsonFile(envelope, 'reports/verification-report.json') as EvidenceReport
    expect(report.reportVersion).toBe('1')
    expect(report.checkedAt).toBe(NOW.toISOString())
    expect(report.expectedSubject).toEqual({ passportId: F.passportId, source: 'request-context' })
    expect(report.suppliedTip).toEqual({ txid: F.txs[5].id('hex'), outputIndex: 0 })
    const checkStatus = Object.fromEntries(report.checks.map((c) => [c.name, c.status]))
    expect(checkStatus).toMatchObject({ recordEncoding: 'pass', actorSignatures: 'pass', publisherSignatures: 'pass', linkage: 'pass', subjectBinding: 'pass' })
    expect(report.checks.find((c) => c.name === 'inclusion')).toMatchObject({ status: 'unknown', reasonCode: 'not-selected' })
    expect(report.observations.latestState).toBe('observed')
    expect(report.observations.sources).toEqual([expect.objectContaining({ id: 'ls_dpp', kind: 'spend-status', result: 'unspent' })])
  })

  it('a flipped byte fails the inventory and nothing else', async () => {
    const node = newNode(F.serverKey)
    const base = await serve(node)
    await admitFixture(base)
    const { envelope } = await exportPackage(base, F.passportId)
    const files = envelopeFiles(envelope)
    const path = `transactions/${F.txs[2].id('hex')}.tx`
    const bytes = [...files.get(path)!]
    bytes[10] ^= 0x01
    files.set(path, bytes)
    const inspection = inspectEvidencePackage(envelope.manifest, files, { expectedPassportId: F.passportId, expectedSigner: EXPORTER })
    expect(inspection.structureValid).toBe(true)
    expect(inspection.signatureValid).toBe(true)
    expect(inspection.inventoryVerified).toBe(false)
    expect(inspection.failures).toEqual([{ reason: 'digest-mismatch', path, detail: expect.stringContaining(path) }])
    // And an edited manifest fails the signature, not the inventory.
    const edited = { ...envelope.manifest, completeness: { ...envelope.manifest.completeness, absent: ['nothing'] } } as EvidencePackageManifest
    const forged = inspectEvidencePackage(edited, envelopeFiles(envelope))
    expect(forged.inventoryVerified).toBe(true)
    expect(forged.signatureValid).toBe(false)
  })

  it('restores into a second operator from the package alone, which then serves the history A did', async () => {
    const a = newNode(F.serverKey)
    const baseA = await serve(a)
    await admitFixture(baseA)
    const { envelope } = await exportPackage(baseA, F.passportId)
    const fromA = await lookupPassport(baseA, { passportId: F.passportId })
    expect(fromA).toHaveLength(6)

    // Operator B: a fresh engine under the same publisher key, fed the
    // package's proofs in the order the transactions themselves dictate.
    const proofs = new Map<string, number[]>()
    const merged = new Beef()
    for (const [path, base64] of Object.entries(envelope.files)) {
      if (!path.startsWith('proofs/')) continue
      const beef = Utils.toArray(base64, 'base64')
      proofs.set(path.slice('proofs/'.length, -'.beef'.length), beef)
      merged.mergeBeef(beef)
    }
    const ordered = chainFromBeef(merged, F.passportId)
    expect(ordered.map((tx) => tx.id('hex'))).toEqual(F.txs.map((tx) => tx.id('hex')))
    const b = newNode(F.serverKey)
    for (const tx of ordered) {
      const steak = await b.engine.submit({ beef: proofs.get(tx.id('hex'))!, topics: ['tm_dpp'] })
      expect(steak.tm_dpp.outputsToAdmit).toHaveLength(1)
    }

    const normalise = (outputs: Array<{ beef: number[]; outputIndex: number }>) =>
      outputs.map((o) => ({ txid: Transaction.fromBEEF(o.beef).id('hex'), outputIndex: o.outputIndex, beef: Utils.toBase64(o.beef) })).sort((x, y) => x.txid.localeCompare(y.txid))
    const answerB = (await b.engine.lookup({ service: 'ls_dpp', query: { passportId: F.passportId } })) as { outputs: Array<{ beef: number[]; outputIndex: number }> }
    expect(normalise(answerB.outputs)).toEqual(normalise(fromA))

    // A is gone; B serves the history, the same six states, spent marks and all.
    await running.shift()!.close()
    const baseB = await serve(b)
    expect(normalise(await lookupPassport(baseB, { uid: F.uid }))).toEqual(normalise(fromA))
    const history = await bodyOf(await fetch(`${baseB}/history?passportId=${encodeURIComponent(F.passportId)}`))
    expect(history.items.map((i: { txid: string; spent: boolean }) => [i.txid, i.spent])).toEqual(F.txs.map((tx, i) => [tx.id('hex'), i < 5]))
    expect(history.completeForSnapshot).toBe(true)
    const again = await exportPackage(baseB, F.passportId)
    expect(inspectEvidencePackage(again.envelope.manifest, envelopeFiles(again.envelope), { expectedPassportId: F.passportId })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true })
  })

  it('carries the policy chain under authority/ and evaluates the report under it, declaring missing proofs absent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chain = policyChain()
    const node = newNode('', { publisherPolicy: chain })
    node.components.publisherPolicy = { chain, operators: OPERATORS, versions: [1, 2], source: 'test' }
    node.components.serviceIdentityKey = undefined
    const base = await serve(node)
    const { tx: genesis } = await genesisTx({ timestamp: '2026-03-01T00:00:00Z' }, new ProtoWallet(K1))
    const { tx: event } = await eventTx(genesis, { timestamp: '2026-07-01T00:00:00Z' }, new ProtoWallet(K2))
    expect((await submitBeef(base, genesis.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect((await submitBeef(base, event.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=admitted')

    const passportId = makeData().passportId
    const { status, envelope } = await exportPackage(base, passportId)
    expect(status).toBe(200)
    expect(validateManifest(envelope.manifest), JSON.stringify(validateManifest.errors)).toBe(true)
    expect(inspectEvidencePackage(envelope.manifest, envelopeFiles(envelope), { expectedPassportId: passportId })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true })
    expect(parseJsonFile(envelope, 'authority/publisher-policy.json')).toEqual(chain)
    expect(envelope.manifest.inventory.find((e) => e.path === 'authority/publisher-policy.json')).toMatchObject({ category: 'authority', representation: 'dpp-publisher-policy@1' })
    expect(envelope.manifest.policyId).toBe('dpp-publisher-policy@1:2')
    // Neither state is mined, so both merkle paths are declared absent, by name.
    expect(envelope.manifest.completeness.absent).toEqual([`merkle-path:${genesis.id('hex')}`, `merkle-path:${event.id('hex')}`])
    const report = parseJsonFile(envelope, 'reports/verification-report.json') as EvidenceReport
    expect(report.policyId).toBe('dpp-publisher-policy@1:2')
    expect(report.checks.find((c) => c.name === 'publisherSignatures')?.status).toBe('pass')
    expect(report.checks.find((c) => c.name === 'inclusion')).toMatchObject({ status: 'unknown', reasonCode: 'proof-absent' })
  })

  it('carries at most 500 states, the newest, and declares the rest absent by outpoint', async () => {
    const node = newNode()
    const passportId = 'https://id.gs1.org/01/09506000134352/21/LONG-1'
    const txidOf = (n: number): string => `${n}`.padStart(64, '0')
    for (let n = 0; n < 505; n++) {
      await node.records.insert({
        txid: txidOf(n), outputIndex: 0, passportId, uid: 'LONG-UID', op: n === 0 ? 'ACTIVATE' : 'REPAIRED',
        timestamp: '2026-07-26T09:00:00Z', previousTxid: n === 0 ? '' : txidOf(n - 1), spent: n < 504, spendingTxid: n < 504 ? txidOf(n + 1) : '', createdAt: new Date(),
      })
    }
    const base = await serve(node)
    const { status, envelope } = await exportPackage(base, passportId)
    expect(status).toBe(200)
    expect(validateManifest(envelope.manifest), JSON.stringify(validateManifest.errors)).toBe(true)
    expect(envelope.manifest.completeness.snapshots[0].completeForSnapshot).toBe(false)
    // The five oldest fall outside the cap and lead the absent list; the 500
    // within it have no bytes in this bare store and are absent for that
    // reason, so every state is named and none is implied present.
    expect(envelope.manifest.completeness.absent.slice(0, 10)).toEqual([0, 1, 2, 3, 4].flatMap((n) => [`transaction:${txidOf(n)}:0`, `proof:${txidOf(n)}:0`]))
    expect(envelope.manifest.completeness.absent).toHaveLength(505 * 2)
    expect(Object.keys(envelope.files).sort()).toEqual(['reports/verification-report.json', 'status/spend-observations.json'])
    expect(parseJsonFile(envelope, 'status/spend-observations.json').states).toHaveLength(500)
    expect(inspectEvidencePackage(envelope.manifest, envelopeFiles(envelope), { expectedPassportId: passportId })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true })
  })

  it('answers 503 export-unavailable without a signing key, 404 for an unknown passport and 400 without one', async () => {
    const unsigned = newNode()
    const bare = await startOverlayService(unsigned.engine, { port: 0, host: HOST, components: unsigned.components })
    running.push(bare)
    const refused = await fetch(`http://${HOST}:${bare.port}/evidence-package?passportId=x`)
    expect(refused.status).toBe(503)
    expect(await bodyOf(refused)).toMatchObject({ status: 'error', error: 'export-unavailable' })

    const base = await serve(newNode())
    const unknown = await fetch(`${base}/evidence-package?passportId=${encodeURIComponent('https://id.gs1.org/01/09506000134352/21/NOBODY')}`)
    expect(unknown.status).toBe(404)
    expect((await bodyOf(unknown)).error).toBe('passport-unknown')
    const missing = await fetch(`${base}/evidence-package`)
    expect(missing.status).toBe(400)
    expect((await bodyOf(missing)).error).toBe('query-invalid')
  })
})
