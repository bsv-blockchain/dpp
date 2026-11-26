import { readFileSync } from 'node:fs'
import { Beef, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import { describe, expect, it } from 'vitest'
import { custodianPriv, makeDataV2, signedStateV2, stateTxV2 } from './helpers-v2.js'
import { evidencePackageSigningKey, inspectEvidencePackage, inventoryEntry, signEvidenceManifest, type EvidencePackageManifest, type InventoryEntry } from '../src/evidencePackage.js'

const v1 = JSON.parse(readFileSync(new URL('../../../fixtures/managed-acceptance-v1.json', import.meta.url), 'utf8'))
const v2 = JSON.parse(readFileSync(new URL('../../../fixtures/managed-acceptance-v2.json', import.meta.url), 'utf8'))
const profile = 'managed-custody@3'
const key = PrivateKey.fromRandom()
const json = (value: unknown) => Utils.toArray(JSON.stringify(value), 'utf8')
const ref = (commitment: string) => `acceptance:sha256:${commitment}`

interface File { path: string; category: InventoryEntry['category']; bytes: number[]; representation?: string; represents?: string }
const transfer = (fixture: typeof v1): File => ({ path: `transactions/${fixture.commitment}.tx`, category: 'transactions', bytes: Utils.toArray(fixture.transfer.rawTx, 'hex'), representation: 'raw-transaction' })
const report = (value: unknown): File => ({ path: 'reports/copy.json', category: 'reports', bytes: json(value) })

async function assemble(contents: File[], absent: string[] = [], withheld: string[] = [], profiles = [profile], opts: Partial<EvidencePackageManifest> = {}) {
  const signingKey = evidencePackageSigningKey(key, opts.passportId ?? v1.record.passportId)
  const manifest = await signEvidenceManifest({
    format: 'dpp-evidence-package', version: '1', passportId: v1.record.passportId,
    exportedAt: '2026-09-05T12:00:00Z', exporter: { id: key.toPublicKey().toString(), role: 'registry' },
    profiles, disclosure: { scope: 'public', recoveryBackup: false }, completeness: { absent, withheld, snapshots: [] }, sources: [],
    inventory: contents.map(file => inventoryEntry(file.path, file.category, file.category === 'transactions' ? 'application/octet-stream' : 'application/json', file.bytes, { ...(file.representation == null ? {} : { representation: file.representation }), ...(file.represents == null ? {} : { represents: file.represents }) })),
    ...opts, signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
  }, { sign: bytes => signingKey.sign(bytes).toDER() as number[] })
  const files = new Map(contents.map(file => [file.path, file.bytes]))
  return { manifest, files, inspect: () => inspectEvidencePackage(manifest, files) }
}

describe('managed-custody@3 package inspection', () => {
  it('requires exactly one disposition per distinct carried transfer commitment', async () => {
    const txs = [transfer(v1), transfer(v2)]
    const first = ref(v1.commitment)
    const second = ref(v2.commitment)
    expect((await assemble(txs, [first], [second + ' not-public'])).inspect().failures).toEqual([])
    for (const [absent, withheld] of [
      [[first], []], [[first, second], [first + ' not-public']], [[first, first, second], []],
      [[first, second, ref('00'.repeat(32))], []], [[first], [second]], [[first, second], [first]],
    ]) {
      expect((await assemble(txs, absent, withheld)).inspect()).toMatchObject({
        structureValid: false, inventoryVerified: true, signatureValid: true,
        failures: expect.arrayContaining([expect.objectContaining({ reason: 'disclosure-contradiction' })]),
      })
    }
  })

  it('refuses a signed record in a report or a copied journal even under another media label', async () => {
    for (const record of [v1.record, v2.record]) {
      const carried = report({ receipts: [{ record }] })
      carried.path = 'evidence/copied.bin'
      expect((await assemble([carried])).inspect().failures).toMatchObject([{ reason: 'disclosure-contradiction', path: carried.path }])
    }
    expect((await assemble([report({ representation: v1.record.acceptanceFormat, signature: 'example' })])).inspect().failures).toEqual([])
  })

  it('refuses a retained offer and a disclosed claim code in a public report', async () => {
    const offer = { requestId: 'example', passportId: v1.record.passportId, holderIdentityKey: v1.holderKey, expectedPredecessor: v1.record.expectedPredecessor, mechanism: 'named-recipient', status: 'open' }
    for (const data of [{ offers: [offer] }, { replay: { claimCode: 'private-claim-code' } }]) {
      expect((await assemble([report(data)])).inspect().failures).toMatchObject([{ reason: 'disclosure-contradiction' }])
    }
  })

  it('checks private DPP payloads in BEEF ancestors while counting only the selected state', async () => {
    const proof: File = { path: 'proofs/history.beef', category: 'proofs', bytes: [], representation: 'beef' }
    const beef = new Beef()
    beef.mergeRawTx(transfer(v1).bytes)
    const target = Transaction.fromHex(v2.transfer.rawTx)
    beef.mergeTransaction(target)
    proof.represents = target.id('hex') + ':' + v2.transfer.outputIndex
    proof.bytes = beef.toBinary()
    expect((await assemble([proof], [ref(v2.commitment)])).inspect().failures).toEqual([])
    expect((await assemble([proof])).inspect().structureValid).toBe(false)
    const copied = await signedStateV2(makeDataV2({ payloadPublic: JSON.stringify({ priorReceipt: v1.record }) }))
    beef.mergeTransaction(stateTxV2(copied, custodianPriv.toPublicKey()))
    proof.bytes = beef.toBinary()
    expect((await assemble([proof], [ref(v2.commitment)])).inspect().failures).toMatchObject([{ reason: 'disclosure-contradiction', path: proof.path }])
  })

  it('uses the declared outpoint for a raw transaction containing more than one DPP output', async () => {
    const combined = new Transaction()
    for (const fixture of [v1, v2]) combined.addOutput(Transaction.fromHex(fixture.transfer.rawTx).outputs[fixture.transfer.outputIndex])
    const file = { ...transfer(v2), bytes: combined.toBinary(), represents: combined.id('hex') + ':1' }
    expect((await assemble([file], [ref(v2.commitment)])).inspect().failures).toEqual([])
  })

  it('checks UTF-8 text reports, copied JSON with a byte-order mark, and reference archive envelopes', async () => {
    const pkg = await assemble([report(v1.record)], [], [], ['managed-custody@2'])
    const envelope = { manifest: pkg.manifest, files: Object.fromEntries([...pkg.files].map(([path, bytes]) => [path, Utils.toBase64(bytes)])) }
    for (const bytes of [Utils.toArray('Prior acceptance\n' + JSON.stringify(v1.record) + '\n', 'utf8'), [0xef, 0xbb, 0xbf, ...json(v2.record)], json({ originalResponse: envelope })]) {
      expect((await assemble([{ path: 'reports/export.txt', category: 'reports', bytes }])).inspect().structureValid).toBe(false)
    }
  })

  it('inspects each nested public manifest under its own profile and disposition', async () => {
    const tx = transfer(v1)
    const reference = ref(v1.commitment)
    const outer = async (inner: EvidencePackageManifest) => (await assemble([
      { path: 'index/manifest.json', category: 'reports', bytes: json(inner), representation: 'dpp-evidence-package@1' },
      { ...tx, path: 'index/' + tx.path },
    ], [], [reference + ' not-public'])).inspect()
    expect(await outer((await assemble([tx], [reference])).manifest)).toMatchObject({ structureValid: true, failures: [] })
    expect((await outer((await assemble([tx])).manifest)).failures).toMatchObject([{ reason: 'disclosure-contradiction', path: 'index/manifest.json' }])
    expect((await outer((await assemble([tx], [], [], ['managed-custody@2'])).manifest)).failures).toEqual([])
  })

  it('refuses an unreadable embedded archive and a relabelled nested transaction outpoint', async () => {
    const malformed = report({ manifest: { format: 'dpp-evidence-package' }, files: { private: '%%%invalid%%%' } })
    expect((await assemble([malformed])).inspect().structureValid).toBe(false)

    const tx = { ...transfer(v1), represents: v1.transfer.txid + ':' + v1.transfer.outputIndex }
    const nested = (await assemble([tx], [ref(v1.commitment)])).manifest
    const outer = await assemble([
      { path: 'index/manifest.json', category: 'reports', bytes: json(nested), representation: 'dpp-evidence-package@1' },
      { ...tx, path: 'index/' + tx.path, represents: v1.transfer.txid + ':0' },
    ])
    expect(outer.inspect().failures).toMatchObject([{ reason: 'disclosure-contradiction', path: 'index/manifest.json' }])
  })

  it('binds the successor signer to the declared identity and checks historical nested identities', async () => {
    const file = report({})
    const { manifest, files } = await assemble([file])
    const directlySigned = async (profiles: string[]) => signEvidenceManifest({
      ...manifest, profiles, signature: { suite: 'bsv-ecdsa-der', signer: key.toPublicKey().toString() },
    }, { sign: bytes => key.sign(bytes).toDER() as number[] })
    expect(inspectEvidencePackage(await directlySigned([profile]), files).failures).toMatchObject([{ reason: 'signer-unexpected' }])
    expect(inspectEvidencePackage(await directlySigned(['managed-custody@2']), files).failures).toEqual([])

    const nested = await assemble([file], [], [], ['managed-custody@2'], { exporter: { id: PrivateKey.fromRandom().toPublicKey().toString(), role: 'overlay' } })
    const enclosing = await assemble([
      { path: 'index/manifest.json', category: 'reports', bytes: json(nested.manifest), representation: 'dpp-evidence-package@1' },
      { ...file, path: 'index/' + file.path },
    ])
    expect(enclosing.inspect().failures).toMatchObject([{ reason: 'signer-unexpected', path: 'index/manifest.json' }])
  })

  it('validates the optional profiles list before interpreting any selection', async () => {
    for (const profiles of [profile, [5], ['not-versioned'], null]) {
      const { manifest, files } = await assemble([report({})])
      const result = inspectEvidencePackage({ ...manifest, profiles: profiles as string[] }, files)
      expect(result.structureValid).toBe(false)
      expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'format', detail: expect.stringContaining('profiles') }))
    }
  })

  it('opens a historical public package with a record under its own rules and reports a required successor as not-selected', async () => {
    const old = await assemble([report(v1.record)], [], [], ['managed-custody@2'])
    expect(old.inspect().failures).toEqual([])
    const selected = await assemble([report({})])
    expect(inspectEvidencePackage(selected.manifest, selected.files, { requiredCustodyProfile: 'managed-custody@99' as typeof profile }).failures).toMatchObject([{ reason: 'not-selected' }])
    expect(inspectEvidencePackage(old.manifest, old.files, { requiredCustodyProfile: profile })).toMatchObject({
      inventoryVerified: true, signatureValid: true, failures: [{ reason: 'not-selected' }],
    })
    expect((await assemble([report(v2.record)], [], [], [profile], { disclosure: { scope: 'all-tiers', recoveryBackup: true } })).inspect().failures).toEqual([])
  })
})
