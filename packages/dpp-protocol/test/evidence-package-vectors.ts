/**
 * Portable vectors for the evidence package manifest (`spec/portable-evidence.md`
 * §2, `contracts/evidence-package.schema.json`). A second implementation
 * reproduces the manifest signing preimage, recomputes every inventory digest
 * from the files, verifies the exporter's signature, and reaches the same
 * three separate answers. Files travel base64-encoded; the private key is a
 * synthetic test key, published deliberately.
 */
import { PrivateKey, Utils } from '@bsv/sdk'
import { inspectEvidencePackage, inventoryEntry, manifestSigningPreimage, signEvidenceManifest, type EvidencePackageManifest, type UnsignedEvidenceManifest } from '../src/evidencePackage.js'

const exporter = PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([7])), 'hex')
const stranger = PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([8])), 'hex')
const txBytes = Utils.toArray('0100000001' + 'ab'.repeat(40), 'hex')
const reportBytes = Utils.toArray(JSON.stringify({ reportVersion: '1', checks: [] }), 'utf8')

async function buildPackage(): Promise<{ manifest: EvidencePackageManifest; files: Map<string, number[]> }> {
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
  const manifest = await signEvidenceManifest(unsigned, { sign: (preimage) => exporter.sign(preimage).toDER() as number[] })
  return { manifest, files }
}

const base64Files = (files: Map<string, number[]>): Record<string, string> => Object.fromEntries([...files.entries()].map(([path, bytes]) => [path, Utils.toBase64(bytes)]))

export async function evidencePackageVectors(): Promise<Record<string, unknown>> {
  const vectors: Array<Record<string, unknown>> = []
  const vector = (id: string, description: string, manifest: EvidencePackageManifest, files: Map<string, number[]>, options: { expectedPassportId?: string; expectedSigner?: string }, tags: string[]) => {
    const result = inspectEvidencePackage(manifest, files, options)
    vectors.push({
      id,
      description,
      input: { manifest, files_base64: base64Files(files), options },
      expected: {
        structure_valid: result.structureValid,
        inventory_verified: result.inventoryVerified,
        signature_valid: result.signatureValid,
        failure_reasons: result.failures.map((f) => f.reason),
        preimage_hex: Utils.toHex(manifestSigningPreimage(manifest)),
      },
      tags,
    })
  }
  const base = await buildPackage()
  vector('valid-package', 'A public-scope package of two files under a signed manifest; the preimage is the canonical JSON of the manifest without signature.value.', base.manifest, base.files, { expectedPassportId: 'urn:example:passport:1', expectedSigner: exporter.toPublicKey().toString() }, ['evidence-package', 'valid'])
  const swapped = new Map(base.files); swapped.set('transactions/aa.hex', [...txBytes.slice(0, -1), txBytes[txBytes.length - 1] ^ 1])
  vector('digest-swap', 'One byte of one file changed: the signature still verifies, the inventory does not.', base.manifest, swapped, {}, ['evidence-package', 'refusal'])
  const missing = new Map(base.files); missing.delete('reports/report.json'); missing.set('evidence/extra.bin', [1, 2, 3])
  vector('missing-and-unlisted', 'A listed file absent and an unlisted file present.', base.manifest, missing, {}, ['evidence-package', 'refusal'])
  vector('tampered-manifest', 'The withheld declaration removed after signing.', { ...base.manifest, completeness: { ...base.manifest.completeness, withheld: [] } }, base.files, {}, ['evidence-package', 'refusal'])
  vector('signer-unexpected', 'A valid signature by a signer other than the one the reader expected.', base.manifest, base.files, { expectedSigner: stranger.toPublicKey().toString() }, ['evidence-package', 'refusal'])
  vector('path-abuse', 'An inventory entry that traverses upwards and a duplicated path.', { ...base.manifest, inventory: [...base.manifest.inventory, { ...base.manifest.inventory[0], path: '../escape' }, { ...base.manifest.inventory[1] }] }, base.files, {}, ['evidence-package', 'refusal'])
  vector('backup-contradiction', 'A public-scope package declaring itself a recovery backup.', { ...base.manifest, disclosure: { scope: 'public', recoveryBackup: true } }, base.files, {}, ['evidence-package', 'refusal'])
  vector('passport-mismatch', 'The reader expected another passport.', base.manifest, base.files, { expectedPassportId: 'urn:example:passport:2' }, ['evidence-package', 'refusal'])
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.evidencepackage.v1',
    name: 'DPP evidence package v1: a signed manifest over a content-addressed inventory',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.2.0',
    parity_class: 'required',
    vectors,
  }
}
