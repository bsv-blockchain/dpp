#!/usr/bin/env node
/**
 * Move an EPCIS exchange from one store to another
 * (spec/epcis-interoperability.md section 8). Runs from the packed packages:
 * it imports @bsv/dpp-credentials with its ./epcis-exchange entry point, and
 * @bsv/dpp-protocol with @bsv/sdk for the one step that signs and inspects
 * the package the snapshot travels in.
 *
 *   node examples/recover-epcis.mjs            # obtains the pinned GS1 files on the first run
 *   node examples/recover-epcis.mjs --offline  # uses the provisioned GS1 files and fetches nothing
 *
 * What it does: fills a store in memory with two source scopes that use the
 * same event identifier and a conflict that was decided, takes a recovery
 * snapshot of it, lists the snapshot's entries in the manifest of a
 * dpp-evidence-package@1, signs and inspects that package, restores the
 * snapshot into a folder through the file-system adapter against the signed
 * inventory, and shows that the same request answers the same import there,
 * that the originals are the same bytes and that the index was rebuilt. It
 * then shows the public form, and three snapshots that are refused by name.
 *
 * What it does not do: reach a source, carry or need a credential, or touch
 * a passport. The package here carries an exchange and nothing of a token's
 * history, and its manifest says so. The key that signs it is made for this
 * run and kept nowhere.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrivateKey } from '@bsv/sdk'
import { evidencePackageSigner, evidencePackageSigningKey, inspectEvidencePackage, signEvidenceManifest } from '@bsv/dpp-protocol'
import { provisionGs1Artefacts } from '@bsv/dpp-credentials'
import {
  checkEpcisExchangeInvariants,
  createMemoryEpcisStorage,
  epcisConflictId,
  epcisRecoveryFiles,
  exportEpcisPublicEvidence,
  exportEpcisRecovery,
  exportEpcisSource,
  findEpcisAssociations,
  getEpcisConflict,
  importEpcisSource,
  listEpcisImports,
  listEpcisRelocations,
  openFileEpcisStorage,
  recoverEpcisExchange,
  resolveEpcisConflict,
  restoreEpcisRecovery,
  verifyEpcisRecovery,
} from '@bsv/dpp-credentials/epcis-exchange'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = (sentence) => console.log(sentence)
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const fail = (sentence) => { say(`${sentence} That is a defect.`); process.exitCode = 1 }
/** Say the sentence when the check holds; otherwise say what was found, and fail the run. */
const hold = (ok, sentence, otherwise) => { if (ok) say(sentence); else fail(otherwise) }

const unknown = process.argv.slice(2).filter((a) => a !== '--offline')
if (unknown.length > 0) { console.error(`usage: node examples/recover-epcis.mjs [--offline]; unknown option ${unknown.join(', ')}`); process.exit(2) }

// An import is refused without the pinned schema, and nothing fetches by itself.
const artefacts = await provisionGs1Artefacts({ offline: process.argv.includes('--offline') })
if (!artefacts.ok) {
  for (const file of artefacts.files.filter((f) => f.outcome === 'failed')) say(`The pinned GS1 file ${file.fileName} is not available in ${artefacts.dir}: ${file.reason}: ${file.detail}.`)
  say('Nothing is validated without the pinned schema. Run dpp-gs1-artefacts fetch with network access, or place the files GS1 publishes in that folder.')
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(join(root, 'fixtures/vectors/dpp/interoperability/epcis/v1.json'), 'utf8')).vectors.find((v) => v.id === 'five-event-document').input.document
const encode = (document) => new TextEncoder().encode(JSON.stringify(document))
const commissioning = fixture.epcisBody.eventList[2]
const withEvents = (eventList) => ({ ...fixture, epcisBody: { eventList } })
const received = '2026-03-10T00:00:00.000Z'
const request = (storage, sourceId, requestId, bytes) => ({ storage, sourceId, requestId, bytes, mediaType: 'application/ld+json', receivedAt: received, provenance: { kind: 'file', filename: `${requestId}.jsonld` }, policy: { policyId: 'example-policy@1' } })

/* ---- the deployment being left ---- */

const first = createMemoryEpcisStorage()
const original = encode(fixture)
await importEpcisSource(request(first, 'factory-a', 'shipment-1', original))
// The same event identifier with another body: a conflict under factory-a, and under factory-b simply another source's event.
await importEpcisSource(request(first, 'factory-a', 'shipment-1-corrected', encode(withEvents([{ ...commissioning, disposition: 'in_transit' }]))))
await importEpcisSource(request(first, 'factory-b', 'shipment-1', encode(withEvents([{ ...commissioning, bizStep: 'inspecting' }]))))
const conflictId = epcisConflictId('factory-a', 'event-id', commissioning.eventID)
const conflict = await getEpcisConflict(first, conflictId)
await resolveEpcisConflict(first, { conflictId, decision: 'The corrected document stands.', disposition: 'body-selected', selectedBodyDigest: conflict.observations[1].bodyDigest, decidedAt: '2026-03-11T00:00:00.000Z', decidedBy: 'quality desk' })
say(`The first store holds ${plural((await listEpcisImports(first)).length, 'import')} under two source scopes, and one conflict that was decided with both of its observations kept.`)

/* ---- the snapshot ---- */

const snapshot = await exportEpcisRecovery({ storage: first })
if (!snapshot.ok) { say(`The export was refused: ${snapshot.code}: ${snapshot.detail}`); process.exit(1) }
const { descriptor } = snapshot
const count = (kind) => descriptor.inventory.filter((entry) => entry.kind === kind).length
say(`The snapshot ${descriptor.snapshot.snapshotId.slice(0, 16)} carries ${plural(count('original'), 'original')}, ${plural(count('import'), 'import record')}, ${plural(count('observation'), 'observation')} and ${plural(count('resolution'), 'decision')} for ${descriptor.scopes.map((scope) => scope.sourceId).join(' and ')}, as ${plural(snapshot.files.size, 'file')} with one inventory entry each.`)
say(`It claims ${descriptor.completeness.claim} at a boundary with ${descriptor.snapshot.boundary}, and leaves out: ${descriptor.omitted.map((omitted) => `${omitted.what} (${omitted.reason})`).join(', ')}.`)
say(`A package that carries it declares disclosure ${snapshot.manifest.disclosure.scope} and recoveryBackup ${snapshot.manifest.disclosure.recoveryBackup}.`)

/* ---- the package that carries it ---- */

// A snapshot is not a format of its own. The exporter lists its entries in the manifest of an evidence package, with what the snapshot says beside them, and signs that manifest.
const passportId = 'https://passports.example/01/09521234543213/21/SER1'
const exporter = PrivateKey.fromRandom()
const exporterIdentity = exporter.toPublicKey().toString()
const signingKey = evidencePackageSigningKey(exporter, passportId)
const manifest = await signEvidenceManifest({
  format: 'dpp-evidence-package',
  version: '1',
  passportId,
  exportedAt: new Date().toISOString(),
  exporter: { id: exporterIdentity, role: 'writer' },
  disclosure: snapshot.manifest.disclosure,
  completeness: { snapshots: snapshot.manifest.snapshots, withheld: snapshot.manifest.withheld, absent: ['the token history, its proofs and its claims: this package carries an EPCIS exchange only'] },
  sources: [],
  inventory: snapshot.inventory,
  signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
}, { sign: (preimage) => signingKey.sign(preimage).toDER() })
const inspection = inspectEvidencePackage(manifest, new Map([...snapshot.files].map(([path, bytes]) => [path, Array.from(bytes)])), { expectedPassportId: passportId, expectedSigner: evidencePackageSigner(exporterIdentity, passportId) })
hold(inspection.structureValid && inspection.inventoryVerified && inspection.signatureValid === true && inspection.failures.length === 0,
  `Listed in the manifest of a dpp-evidence-package@1 with nothing added to that format, the package inspects on its structure, its inventory and its signature: ${manifest.inventory.length} inventory entries, ${plural(manifest.completeness.snapshots.length, 'snapshot declaration')} and ${plural(manifest.completeness.withheld.length, 'withheld line')}.`,
  `The package does not inspect: ${inspection.failures.map((failure) => failure.reason).join(', ')}.`)
// From here the inventory is the signed manifest's, as a destination has it.
const inventory = manifest.inventory
const verified = await verifyEpcisRecovery(epcisRecoveryFiles(snapshot.files), { inventory })
hold(verified.ok, 'Checked by itself against that inventory, the snapshot agrees with its descriptor and satisfies the invariants of the exchange.', `The snapshot does not verify: ${verified.code}.`)

/* ---- the restore, into another adapter ---- */

const folder = mkdtempSync(join(tmpdir(), 'dpp-epcis-recover-'))
const second = await openFileEpcisStorage(join(folder, 'store'))
try {
  await recoverEpcisExchange(second)
  const restored = await restoreEpcisRecovery({ storage: second, source: epcisRecoveryFiles(snapshot.files), inventory })
  if (!restored.ok) { say(`The restore was refused: ${restored.code}: ${restored.detail}`); process.exit(1) }
  say(`Restored into a folder through the file-system adapter: ${restored.outcome}, ${plural(restored.written.imports, 'import')} and ${plural(restored.written.originals, 'original')} written, ${restored.associations.associationsWritten} index entries rebuilt.`)
  const relocations = await listEpcisRelocations(second, restored.snapshotId)
  say(`Each original was read back from the folder and held to its digest; ${plural(relocations.length, 'relocation record')} say where each went, and the snapshot is unchanged.`)

  const exported = await exportEpcisSource(second, (await importEpcisSource(request(second, 'factory-a', 'shipment-1', original))).record.importId)
  if (Buffer.from(exported.bytes).equals(Buffer.from(original))) say('The original the second store gives back is the bytes the first one received.')
  else fail('The second store gives back other bytes than the first one received.')

  // A client that never heard its answer sends the request again, to the new store.
  const before = (await listEpcisImports(second)).length
  const retried = await importEpcisSource({ ...request(second, 'factory-a', 'shipment-1', original), receivedAt: new Date().toISOString() })
  if (retried.outcome === 'retained' && retried.replayed && retried.record.receivedAt === received && (await listEpcisImports(second)).length === before) say(`The request shipment-1 made again answers the import of ${retried.record.receivedAt} and writes no second receipt.`)
  else fail('The retried request did not answer the restored import.')
  const changed = await importEpcisSource(request(second, 'factory-a', 'shipment-1', encode(withEvents([commissioning]))))
  hold(changed.outcome === 'request-conflict', `The same request identifier with other bytes answers ${changed.outcome}, and the restored import stands.`, `The same request identifier with other bytes answered ${changed.outcome}, not request-conflict.`)

  const decided = await getEpcisConflict(second, conflictId)
  say(`The conflict is ${decided.state} there, by the decision "${decided.resolutions[0].decision}" of ${decided.resolutions[0].decidedBy}, with ${plural(decided.observations.length, 'observation')} kept.`)
  say(`Under factory-b the same event identifier is ${(await getEpcisConflict(second, epcisConflictId('factory-b', 'event-id', commissioning.eventID))) == null ? 'one event with one body: the two scopes were not merged' : 'in conflict, which is a defect'}.`)
  const item = commissioning.epcList[0]
  const found = await findEpcisAssociations(second, { identifier: item, granularity: 'instance' })
  say(`The rebuilt index finds ${item} in ${plural(found.associations.length, 'event')}, and the store breaks ${(await checkEpcisExchangeInvariants(second, { associations: true })).length} of its invariants.`)

  const again = await restoreEpcisRecovery({ storage: second, source: epcisRecoveryFiles(snapshot.files), inventory })
  hold(again.ok && again.outcome === 'unchanged', `The same snapshot restored again is ${again.outcome}: what is already there and equal is left alone.`, `The same snapshot restored again answered ${again.ok ? again.outcome : again.code}, not unchanged.`)
} finally {
  await second.close()
  rmSync(folder, { recursive: true, force: true })
}

/* ---- the public form, and what is refused ---- */

const open = await exportEpcisPublicEvidence({ storage: first, allow: (record) => record.sourceId === 'factory-b' })
if (!open.ok) { say(`The public export was refused: ${open.code}: ${open.detail}`); process.exit(1) }
say(`The public form carries ${plural(open.descriptor.inventory.filter((entry) => entry.kind === 'original').length, 'original')} the access policy allowed, with its record and no provenance, and claims ${open.descriptor.completeness.claim}.`)
const refusedPublic = await restoreEpcisRecovery({ storage: createMemoryEpcisStorage(), source: epcisRecoveryFiles(open.files), inventory: open.inventory })
hold(refusedPublic.code === 'not-a-recovery-snapshot', `Offered for restore, it is refused as ${refusedPublic.code}: a public package is not a recovery backup.`, `The public form offered for restore answered ${refusedPublic.ok ? 'a restore' : refusedPublic.code}.`)

const without = (kind) => {
  const files = new Map(snapshot.files)
  files.delete(`${snapshot.root}/${descriptor.inventory.find((entry) => entry.kind === kind).path}`)
  return files
}
for (const [what, kind, code] of [['an original', 'original', 'original-missing'], ['a conflict decision', 'resolution', 'record-missing']]) {
  const empty = createMemoryEpcisStorage()
  const refused = await restoreEpcisRecovery({ storage: empty, source: epcisRecoveryFiles(without(kind)), inventory })
  hold(refused.code === code && empty.state.bytes.size === 0 && empty.state.records.size === 0, `A snapshot missing ${what} is refused as ${refused.code}, and nothing is written.`, `A snapshot missing ${what} answered ${refused.ok ? 'a restore' : refused.code}, not ${code}.`)
}
const altered = new Map(snapshot.files)
const some = `${snapshot.root}/${descriptor.inventory.find((entry) => entry.kind === 'original').path}`
altered.set(some, Uint8Array.from(altered.get(some), (byte, index) => (index === 20 ? byte ^ 1 : byte)))
const refusedAltered = await restoreEpcisRecovery({ storage: createMemoryEpcisStorage(), source: epcisRecoveryFiles(altered), inventory })
hold(refusedAltered.code === 'original-altered', `A snapshot with one bit of an original changed is refused as ${refusedAltered.code}.`, `A snapshot with one bit of an original changed answered ${refusedAltered.ok ? 'a restore' : refusedAltered.code}, not original-altered.`)

say('No credential was carried or needed: a snapshot holds none, and the operator provisions them at the destination before a pull is run.')
say('The one signature made here is the exporter\'s, over the manifest of the package. Nothing was issued, anchored or written to a token by this example.')
