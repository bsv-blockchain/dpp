import { describe, expect, it } from 'vitest'
import { PrivateKey, Utils } from '@bsv/sdk'
import { inspectEvidencePackage, inventoryEntry, manifestSigningPreimage, pathProblem, signEvidenceManifest, type EvidencePackageManifest, type UnsignedEvidenceManifest } from '../src/evidencePackage.js'

const exporter = PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([7])), 'hex')
const stranger = PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([8])), 'hex')
const signer = { sign: (preimage: number[]) => exporter.sign(preimage).toDER() as number[] }
const txBytes = Utils.toArray('0100000001' + 'ab'.repeat(40), 'hex')
const reportBytes = Utils.toArray(JSON.stringify({ reportVersion: '1', checks: [] }), 'utf8')

async function build(): Promise<{ manifest: EvidencePackageManifest; files: Map<string, number[]> }> {
  const files = new Map<string, number[]>([['transactions/aa.hex', txBytes], ['reports/report.json', reportBytes]])
  const unsigned: UnsignedEvidenceManifest = {
    format: 'dpp-evidence-package', version: '1', passportId: 'urn:example:passport:1',
    genesis: { txid: 'aa'.repeat(32), outputIndex: 0 }, selectedTip: { txid: 'bb'.repeat(32), outputIndex: 0 },
    exportedAt: '2026-09-05T12:00:00Z', exporter: { id: exporter.toPublicKey().toString(), role: 'registry' },
    profiles: ['battery@2'], disclosure: { scope: 'public', recoveryBackup: false },
    completeness: { snapshots: [{ source: 'ls_dpp', snapshotId: 's1', completeForSnapshot: true }], withheld: ['restricted tiers owner, legitimate, authority'], absent: [] },
    sources: [{ id: 'ls_dpp', kind: 'overlay-lookup', observedAt: '2026-09-05T11:59:00Z', result: 'unspent' }],
    inventory: [inventoryEntry('transactions/aa.hex', 'transactions', 'application/octet-stream', txBytes, { represents: 'aa'.repeat(32) }), inventoryEntry('reports/report.json', 'reports', 'application/json', reportBytes)],
    signature: { suite: 'bsv-ecdsa-der', signer: exporter.toPublicKey().toString() },
  }
  return { manifest: await signEvidenceManifest(unsigned, signer), files }
}

describe('the evidence package (portable-evidence.md §2)', () => {
  it('verifies a well-formed package on all three questions and reports what was withheld', async () => {
    const { manifest, files } = await build()
    const result = inspectEvidencePackage(manifest, files, { expectedPassportId: 'urn:example:passport:1', expectedSigner: exporter.toPublicKey().toString() })
    expect(result).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [], recoveryBackup: false })
    expect(result.declaredWithheld).toEqual(['restricted tiers owner, legitimate, authority'])
  })

  it('keeps the signature and the inventory apart: a valid signature over a manifest whose bytes were swapped', async () => {
    const { manifest, files } = await build()
    files.set('transactions/aa.hex', [...txBytes.slice(0, -1), txBytes[txBytes.length - 1] ^ 1])
    const result = inspectEvidencePackage(manifest, files)
    expect(result.signatureValid).toBe(true)
    expect(result.inventoryVerified).toBe(false)
    expect(result.failures.map((f) => f.reason)).toEqual(['digest-mismatch'])
  })

  it('names a missing file, an unlisted file and a wrong length', async () => {
    const { manifest, files } = await build()
    files.delete('reports/report.json')
    files.set('evidence/extra.bin', [1, 2, 3])
    const result = inspectEvidencePackage(manifest, files)
    expect(result.failures.map((f) => [f.reason, f.path])).toEqual([['file-missing', 'reports/report.json'], ['file-unlisted', 'evidence/extra.bin']])
    const shortened = new Map(files)
    shortened.set('reports/report.json', reportBytes.slice(1))
    shortened.delete('evidence/extra.bin')
    expect(inspectEvidencePackage(manifest, shortened).failures.map((f) => f.reason)).toEqual(['length-mismatch', 'digest-mismatch'])
  })

  it('refuses any tampering with the manifest under the exporter\'s key, and a signer other than the expected one', async () => {
    const { manifest, files } = await build()
    const tampered = { ...manifest, completeness: { ...manifest.completeness, withheld: [] } }
    const result = inspectEvidencePackage(tampered, files)
    expect(result.signatureValid).toBe(false)
    expect(result.failures.map((f) => f.reason)).toEqual(['signature-invalid'])
    const foreign = inspectEvidencePackage(manifest, files, { expectedSigner: stranger.toPublicKey().toString() })
    expect(foreign.signatureValid).toBe(true)
    expect(foreign.failures.map((f) => f.reason)).toEqual(['signer-unexpected'])
  })

  it('refuses path abuse: absolute, traversing, backslash, NUL, duplicate and the manifest\'s own name', async () => {
    expect(pathProblem('/etc/passwd')).toBe('absolute')
    expect(pathProblem('a/../b')).toBe('traverses upwards')
    expect(pathProblem('a\\b')).toBe('contains a backslash')
    expect(pathProblem('a\u0000b')).toBe('contains NUL')
    expect(pathProblem('C:x')).toBe('drive-qualified')
    expect(pathProblem('a//b')).toBe('empty segment')
    expect(pathProblem('manifest.json')).toBe('names the manifest itself')
    expect(pathProblem('reports/report.json')).toBeUndefined()
    const { manifest, files } = await build()
    const abused = { ...manifest, inventory: [...manifest.inventory, { ...manifest.inventory[0], path: '../escape' }, { ...manifest.inventory[1] }] }
    const result = inspectEvidencePackage(abused, files)
    expect(result.structureValid).toBe(false)
    expect(result.inventoryVerified).toBe(false)
    expect(result.failures.map((f) => f.reason)).toEqual(expect.arrayContaining(['path-invalid', 'path-duplicate']))
  })

  it('refuses a public package that calls itself a recovery backup, and a package about another passport', async () => {
    const { manifest, files } = await build()
    const backup = { ...manifest, disclosure: { scope: 'public' as const, recoveryBackup: true } }
    expect(inspectEvidencePackage(backup, files).failures.map((f) => f.reason)).toEqual(['disclosure-contradiction', 'signature-invalid'])
    const substituted = inspectEvidencePackage(manifest, files, { expectedPassportId: 'urn:example:passport:2' })
    expect(substituted.structureValid).toBe(false)
    expect(substituted.failures.map((f) => f.reason)).toEqual(['passport-mismatch'])
  })

  it('signs the manifest without its own signature value and nothing else', async () => {
    const { manifest } = await build()
    expect(manifestSigningPreimage(manifest)).toEqual(manifestSigningPreimage({ ...manifest, signature: { ...manifest.signature, value: 'ff' } }))
    expect(manifestSigningPreimage(manifest)).not.toEqual(manifestSigningPreimage({ ...manifest, exportedAt: '2026-09-05T12:00:01Z' }))
  })
})
