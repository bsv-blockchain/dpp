#!/usr/bin/env node
/**
 * Carry a custom profile out of one deployment and validate from it in another, offline.
 *
 *   node examples/portable-profile.mjs                 the two example profiles under examples/custom-profile/
 *   node examples/portable-profile.mjs --keep <folder> the same, and leave the exported package in <folder> to look at
 *
 * A profile held by a binding is a folder of files. This script shows that
 * the folder can travel inside an evidence package, and that a deployment
 * which has only the package validates exactly as the first one did:
 *
 *   1. the first deployment registers the example profiles from their folders
 *      and exports a profile bundle: each binding in its exact bytes, every
 *      file the binding lists, and a descriptor;
 *   2. the bundle is listed in the manifest of a dpp-evidence-package@1,
 *      signed by the exporter, and written to a folder;
 *   3. the network is switched off;
 *   4. the second deployment fills its registry from that folder alone,
 *      trusting the binding digests its own operator chose, and checks every
 *      payload vector. Each answer is compared with the first deployment's;
 *   5. two packages that are signed correctly are refused all the same: one
 *      carries a more permissive binding under the same profile name, and one
 *      carries an altered shapes file. A package with a file missing is
 *      reported incomplete, and a payload under that profile is unknown.
 *
 * The signing key is thrown away at the end. Nothing is fetched, sent,
 * issued or anchored, and the only files written are in a temporary folder.
 *
 * The JSON-LD and SHACL steps need jsonld, n3 and shacl-engine, as
 * examples/custom-profile.mjs does. Results print one sentence per check.
 */
import dns from 'node:dns'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PrivateKey } from '@bsv/sdk'
import { evidencePackageSigner, evidencePackageSigningKey, inspectEvidencePackage, signEvidenceManifest } from '@bsv/dpp-protocol'
import {
  bindingPayloadValidator,
  createProfileRegistry,
  describeArtefact,
  exportProfileBundle,
  openProfileBundle,
  profileBindingDigest,
  profileBundleDirectory,
  profileBundleFiles,
  registerProfileBundle,
} from '@bsv/dpp-profiles'
import { VALIDATION_ENGINE_LIBRARIES, createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

const here = dirname(fileURLToPath(import.meta.url))
const keepAt = process.argv[2] === '--keep' ? process.argv[3] : undefined
if (process.argv[2] === '--keep' && keepAt == null) { console.error('--keep needs a folder'); process.exit(2) }

let failures = 0
const say = (ok, sentence) => {
  console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`)
  if (!ok) failures++
}
const utf8 = (text) => new TextEncoder().encode(text)
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes))
const writeTo = (folder, files) => {
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), bytes)
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
let engines = { jsonSchema: ajv }
try {
  engines = { ...engines, ...(await createValidationEngine()) }
} catch (cause) {
  const install = Object.entries(VALIDATION_ENGINE_LIBRARIES).map(([name, version]) => `${name}@${version}`).join(' ')
  say(false, `the JSON-LD and SHACL engines did not load (${cause.message}); install ${install}.`)
}

// 1. The first deployment: the example profiles, registered from their folders as examples/custom-profile.mjs does.
const folders = ['example-bottle@1', 'example-notebook@1'].map((name) => join(here, 'custom-profile', name))
const profiles = folders.map((folder) => {
  const bytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))
  return { folder, bytes, digest: profileBindingDigest(bytes), binding: json(bytes) }
})
const first = createProfileRegistry({ trustedBindingDigests: profiles.map((p) => p.digest) })
for (const p of profiles) {
  const result = await first.register({ bindingBytes: p.bytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(p.folder, artefact.path))) })
  say(result.ok, result.ok ? `the first deployment registered ${result.profile.profile} from its folder.` : `${p.folder} was refused as ${result.code}: ${result.detail}`)
}

// The export reads everything back from the registry, so what leaves is what was held to its digest at registration.
// A binding that lists notices needs them read from its folder. These two list none. The licence text travels with the files it covers.
const bundle = await exportProfileBundle({
  registry: first,
  readNotice: (profile, path) => new Uint8Array(readFileSync(join(profiles.find((p) => p.binding.profile === profile.profile).folder, path))),
  licenceTexts: [{ licence: 'Apache-2.0', bytes: new Uint8Array(readFileSync(join(here, '..', 'LICENSE'))) }],
})
if (!bundle.ok) { console.error(`The export was refused as ${bundle.code}: ${bundle.detail}`); process.exit(1) }
const artefactCount = profiles.reduce((count, p) => count + p.binding.artefacts.length, 0)
say(bundle.descriptor.profiles.length === profiles.length && bundle.files.size === profiles.length + artefactCount + 2, `the bundle covers ${bundle.manifest.profiles.join(' and ')} in ${bundle.files.size} files: ${profiles.length} bindings, the ${artefactCount} artefacts they list, one licence text and the descriptor.`)
say(bundle.descriptor.licences.every((entry) => entry.path != null), `every licence a carried file is under is named, and its text is carried: ${bundle.descriptor.licences.map((entry) => `${entry.licence} at ${entry.path}`).join(', ')}.`)
say(profiles.every((p) => profileBindingDigest(bundle.files.get(`profiles/${p.binding.profile}/binding.json`)) === p.digest), 'each binding is carried in its exact bytes: the digest of the carried file is the digest the records declare.')
say(bundle.inventory.every((entry) => { const actual = describeArtefact(bundle.files.get(entry.path)); return entry.category === 'schemas' && actual.sha256 === entry.sha256 && actual.byteLength === entry.byteLength }), `every file has one inventory entry in the schemas category, with its media type, length and SHA-256.`)
const limits = bundle.descriptor.limits
say(limits.trust === 'destination-trusted-digests' && limits.ownerCommitment === 'not-established' && limits.profiles === 'bindings-only', 'the descriptor states its limits: the destination decides trust, only profiles held by a binding are carried, and validation under them says nothing about payload_owner_hash.')
say(bundle.descriptor.omitted.length === 0, 'nothing is left out of this bundle. A file its publisher does not let others pass on would be named here by address and digest, never carried.')

// 2. The package. The exporter lists the bundle's entries in its own manifest and signs it for one passport.
const passportId = 'https://passports.example/01/09521234543213/21/BTL-0001'
const exporter = PrivateKey.fromRandom()
const exporterIdentity = exporter.toPublicKey().toString()
const signingKey = evidencePackageSigningKey(exporter, passportId)
const packageOf = async (files, describedAs = bundle) => {
  const manifest = await signEvidenceManifest({
    format: 'dpp-evidence-package',
    version: '1',
    passportId,
    exportedAt: new Date().toISOString(),
    exporter: { id: exporterIdentity, role: 'writer' },
    profiles: describedAs.manifest.profiles,
    disclosure: { scope: 'public', recoveryBackup: false },
    // Nothing of the token history is in this package: it carries the profiles only, and says so.
    completeness: { snapshots: [], withheld: describedAs.manifest.withheld, absent: ['the token history, its proofs and its claims: this package carries profile definitions only'] },
    sources: [],
    inventory: describedAs.inventory.filter((entry) => files.has(entry.path)).map((entry) => ({ ...entry, ...describeArtefact(files.get(entry.path)) })),
    signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
  }, { sign: (preimage) => signingKey.sign(preimage).toDER() })
  return { manifest, files }
}
const signedCorrectly = ({ manifest, files }) => {
  const inspection = inspectEvidencePackage(manifest, new Map([...files].map(([path, bytes]) => [path, Array.from(bytes)])), { expectedPassportId: passportId, expectedSigner: evidencePackageSigner(exporterIdentity, passportId) })
  return inspection.structureValid && inspection.inventoryVerified && inspection.signatureValid === true && inspection.failures.length === 0
}
const genuine = await packageOf(bundle.files)
say(signedCorrectly(genuine), 'the package inspects on all three questions: its structure, its inventory against the files, and the exporter\'s signature.')

const folder = keepAt == null ? mkdtempSync(join(tmpdir(), 'dpp-portable-profile-')) : resolve(keepAt)
writeTo(folder, [...genuine.files, ['manifest.json', utf8(`${JSON.stringify(genuine.manifest, null, 2)}\n`)]])

// The answers of the first deployment, to compare with.
const vectors = profiles.flatMap((p) => [...p.binding.vectors.positive, ...p.binding.vectors.negative].map((path) => ({ p, path, vector: JSON.parse(readFileSync(join(p.folder, path), 'utf8')) })).filter((v) => v.vector.kind !== 'registration'))
const check = (registry, { p, vector }) => bindingPayloadValidator({ registry, engines })({ profile: p.binding.id, profileVersion: p.binding.version, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
const before = []
for (const v of vectors) before.push(await check(first, v))

// 3. No network from here on. Every attempt is counted, and refused.
const attempts = []
const off = (what) => (...args) => { attempts.push(`${what} ${typeof args[0] === 'string' ? args[0] : ''}`.trim()); throw new Error(`the network is off: ${what}`) }
globalThis.fetch = off('fetch')
net.Socket.prototype.connect = off('socket connect')
dns.lookup = off('dns.lookup')
dns.promises.lookup = off('dns.promises.lookup')

// 4. The second deployment. It has the folder and its own operator's list of trusted digests, and nothing else.
const opened = await openProfileBundle(profileBundleDirectory(folder))
if (!opened.ok) { console.error(`The bundle was refused as ${opened.code}: ${opened.detail}`); process.exit(1) }
const trusted = profiles.map((p) => p.digest)
const second = createProfileRegistry({ trustedBindingDigests: trusted })
for (const result of await registerProfileBundle(second, opened.bundle)) {
  say(result.ok, result.ok ? `the second deployment registered ${result.profile.profile} from the package, under binding digest ${result.profile.bindingDigest}.` : `${result.profile} was refused as ${result.code}: ${result.detail}`)
}
let same = 0
for (const [index, v] of vectors.entries()) {
  const after = await check(second, v)
  const expected = v.vector.expected
  const agrees = JSON.stringify(after) === JSON.stringify(before[index]) && after.status === expected.status && after.detail.cause === expected.cause
  if (agrees) same++
  else say(false, `${v.p.binding.profile} ${v.path}: the second deployment answers ${after.status}${after.detail.cause == null ? '' : ` (${after.detail.cause})`} and the first ${before[index].status}; the vector expects ${expected.status}.`)
}
say(same === vectors.length, `${same} of ${vectors.length} payload vectors get the same answer from the package as from the folders, step for step and finding for finding, and each is the answer its vector expects.`)

// 5. What a destination refuses, whoever signed the package.
const bottle = profiles[0]
const checkBottle = (registry, path) => check(registry, { p: bottle, vector: JSON.parse(readFileSync(join(bottle.folder, path), 'utf8')) })
const validatesBottle = async (registry, path) => (await checkBottle(registry, path)).status

// A binding under the same name that no longer runs the shapes, so a bottle with a part that is not dishwasher safe would pass.
const permissive = { ...bottle.binding, artefacts: bottle.binding.artefacts.filter((a) => a.role === 'schema' || a.role === 'context'), validation: { steps: ['json-schema', 'json-ld-expand', 'passport-identity'], engine: { requires: ['json-schema-2020-12'] }, blockingSeverities: ['Violation'] } }
const permissiveBytes = utf8(`${JSON.stringify(permissive, null, 2)}\n`)
const attackers = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(permissiveBytes)] })
await attackers.register({ bindingBytes: permissiveBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(bottle.folder, artefact.path))) })
const substitutedBundle = await exportProfileBundle({ registry: attackers })
const substituted = await packageOf(substitutedBundle.files, substitutedBundle)
const reopen = async (pack) => (await openProfileBundle(profileBundleFiles(pack.files))).bundle
{
  const registry = createProfileRegistry({ trustedBindingDigests: trusted })
  const [untrusted] = await registerProfileBundle(registry, await reopen(substituted))
  say(signedCorrectly(substituted) && !untrusted.ok && untrusted.code === 'bundle-binding-untrusted', `a correctly signed package with a more permissive binding for ${bottle.binding.profile} is refused as ${untrusted.ok ? 'nothing' : untrusted.code}: the signature says who assembled it and gives the binding no authority.`)
  const [named] = await registerProfileBundle(registry, await reopen(substituted), { expected: profiles.map((p) => ({ profile: p.binding.profile, bindingDigest: p.digest })) })
  say(!named.ok && named.code === 'bundle-binding-substituted', `told which digest to expect, the destination names it as ${named.ok ? 'nothing' : named.code}: another definition under the same name.`)
  say(registry.resolve(bottle.binding.id, bottle.binding.version) == null && await validatesBottle(registry, 'vectors/item.json') === 'unknown', 'nothing was registered from it, so a payload under that profile is unknown there, never pass.')
  const committed = await checkBottle(attackers, 'vectors/item.json')
  say(committed.status === 'fail' && committed.detail.cause === 'profile-binding-mismatch', `a registry that did accept the substitute still fails a valid record that declares the real binding digest (${committed.detail.cause}): the record commits to its binding.`)
}

// The real binding with a shapes file that requires nothing. The exporter lists and signs the altered file.
{
  const files = new Map(bundle.files).set(`profiles/${bottle.binding.profile}/shapes.ttl`, utf8('# no shapes\n'))
  const altered = await packageOf(files)
  const registry = createProfileRegistry({ trustedBindingDigests: trusted })
  const [result] = await registerProfileBundle(registry, await reopen(altered))
  say(signedCorrectly(altered) && !result.ok && result.code === 'bundle-artefact-altered' && result.artefact === 'shapes.ttl', `a correctly signed package with an altered shapes file is refused as ${result.ok ? 'nothing' : result.code}, naming ${result.artefact}: the trusted binding records the file's length and SHA-256.`)
}

// A package with one file missing.
{
  const files = new Map(bundle.files)
  files.delete(`profiles/${bottle.binding.profile}/background.ttl`)
  const registry = createProfileRegistry({ trustedBindingDigests: trusted })
  const results = await registerProfileBundle(registry, await reopen(await packageOf(files)))
  const refused = results.find((result) => !result.ok)
  say(refused?.code === 'bundle-artefact-missing' && refused.artefact === 'background.ttl' && results.filter((result) => result.ok).length === 1, `a package without background.ttl is reported incomplete (${refused?.code}), and the other profile in it is still restored.`)
  say(await validatesBottle(registry, 'vectors/item.json') === 'unknown', 'a payload under the incomplete profile is unknown, never pass.')
}

say(attempts.length === 0, `no network call was attempted after the switch-off${attempts.length === 0 ? '' : `: ${attempts.join(', ')}`}.`)

if (keepAt == null) rmSync(folder, { recursive: true, force: true })
else console.log(`The package is in ${folder}: manifest.json beside profiles/.`)
console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
