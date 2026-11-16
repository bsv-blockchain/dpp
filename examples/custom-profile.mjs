#!/usr/bin/env node
/**
 * Register a custom profile from a folder and validate payloads against it.
 *
 *   node examples/custom-profile.mjs                      the two example profiles under examples/custom-profile/
 *   node examples/custom-profile.mjs <folder>             a profile folder of your own, holding binding.json
 *   node examples/custom-profile.mjs --describe <file>... the byte length and SHA-256 a binding records for each file
 *
 * A custom profile is a folder: a binding file, the files the binding names
 * and the vectors that show what the profile accepts and refuses. Nothing in
 * @bsv/dpp-profiles is edited to add one. This script does what an
 * application does at start-up: it reads the binding's exact bytes, trusts
 * its digest, registers it with the files from the folder, and then checks
 * every vector the binding lists.
 *
 * `example-bottle@1` uses every step: a JSON Schema, its own JSON-LD context,
 * SHACL shapes with one SPARQL constraint, a background file and the
 * product-to-passport identity rules. `example-notebook@1` is plain JSON and
 * uses the schema and the identity rules only. Both are invented for this
 * repository, and every GTIN in them is under the GS1 demonstration prefix 952.
 *
 * The JSON-LD and SHACL steps need three libraries this package does not
 * install for you: jsonld, n3 and shacl-engine. Without them those steps
 * answer unknown, never pass, and this script says so.
 *
 * Results print one sentence per check, never a score.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { bindingPayloadValidator, createProfileRegistry, describeArtefact, profileBindingDigest } from '@bsv/dpp-profiles'
import { VALIDATION_ENGINE_LIBRARIES, createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

// What an author runs while writing a binding: each artefact entry records these two values.
if (args[0] === '--describe') {
  for (const file of args.slice(1)) console.log(file, JSON.stringify(describeArtefact(readFileSync(file))))
  process.exit(0)
}

let failures = 0
const say = (ok, sentence) => {
  console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`)
  if (!ok) failures++
}

const folders = args.length > 0 ? args.map((folder) => resolve(folder)) : ['example-bottle@1', 'example-notebook@1'].map((name) => join(here, 'custom-profile', name))
const read = (folder, path) => readFileSync(join(folder, path))
const json = (folder, path) => JSON.parse(read(folder, path).toString('utf8'))
// The caller's side of registration: an artefact is its file in the folder. A vector may swap one file for another.
const fromFolder = (folder, substitute = {}) => (artefact) => new Uint8Array(read(folder, substitute[artefact.path] ?? artefact.path))

// 1. The engines. The schema compiler is the caller's, as for every profile; the other two come from the adapter.
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
let engines = { jsonSchema: ajv }
try {
  engines = { ...engines, ...(await createValidationEngine()) }
  say(true, 'the JSON-LD and SHACL engines loaded, with the SPARQL constraints.')
} catch (cause) {
  const install = Object.entries(VALIDATION_ENGINE_LIBRARIES).map(([name, version]) => `${name}@${version}`).join(' ')
  say(false, `the JSON-LD and SHACL engines did not load (${cause.message}); install ${install}. Until then every step that needs them answers unknown.`)
}

// 2. Registration. The trusted list is the digests of the bindings this deployment chose, taken over their exact bytes.
const profiles = folders.map((folder) => { const bytes = new Uint8Array(read(folder, 'binding.json')); return { folder, bytes, digest: profileBindingDigest(bytes), binding: json(folder, 'binding.json') } })
const registry = createProfileRegistry({ trustedBindingDigests: profiles.map((p) => p.digest) })
for (const p of profiles) {
  const result = await registry.register({ bindingBytes: p.bytes, resolveArtefact: fromFolder(p.folder) })
  say(result.ok, result.ok ? `${result.profile.profile} registered from its folder under binding digest ${result.profile.bindingDigest}, with ${result.profile.artefacts.length} artefact${result.profile.artefacts.length === 1 ? '' : 's'} held to length and digest.` : `${p.folder} was refused as ${result.code}: ${result.detail}`)
}
say(registry.resolve('general', 2)?.format === 'manifest', 'the same registry still answers for general@2, a profile defined by a manifest.')

// 3. The vectors each binding lists.
const validate = bindingPayloadValidator({ registry, engines })
for (const p of profiles) {
  for (const path of [...p.binding.vectors.positive, ...p.binding.vectors.negative]) {
    const vector = json(p.folder, path)
    if (vector.kind === 'registration') {
      // A registration vector starts from an empty registry with its own trusted list, and expects the last registration to be refused.
      const fresh = createProfileRegistry({ trustedBindingDigests: vector.trustedBindingDigests })
      let last
      for (const step of vector.register) last = await fresh.register({ bindingBytes: new Uint8Array(read(p.folder, step.binding)), resolveArtefact: fromFolder(p.folder, step.substitute) })
      const named = vector.expected.artefact == null || last.artefact === vector.expected.artefact
      say(!last.ok && last.code === vector.expected.refusal && named, `${p.binding.profile} ${path}: registration is refused as ${last.ok ? 'nothing' : last.code}${last.artefact == null ? '' : `, naming ${last.artefact}`}; the vector expects ${vector.expected.refusal}.`)
      continue
    }
    const result = await validate({ profile: p.binding.id, profileVersion: p.binding.version, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
    const cause = result.detail.cause
    const step = result.detail.steps.find((s) => s.status === result.status)?.step
    const expected = vector.expected
    say(result.status === expected.status && cause === expected.cause, `${p.binding.profile} ${path}: ${result.status}${cause == null ? '' : ` (${cause}, at ${step})`}; the vector expects ${expected.status}${expected.cause == null ? '' : ` (${expected.cause})`}.`)
  }
}

// 4. What a verifier does with the same function: one payload, one answer, with the findings in the detail.
const first = profiles[0]
const sample = json(first.folder, first.binding.vectors.positive[0])
const answer = await validate({ profile: first.binding.id, profileVersion: first.binding.version, payloadPublic: JSON.stringify(sample.payload), passportId: sample.passportId })
console.log(`\n${first.binding.profile}, ${first.binding.vectors.positive[0]}, step by step:`)
for (const s of answer.detail.steps) console.log(`  ${s.step}: ${s.status}${(s.findings ?? []).map((f) => `\n    ${f.severity} ${f.constraint}${f.path == null ? '' : ` at ${f.path}`}: ${f.message ?? ''}`).join('')}`)
const unpassported = await validate({ profile: first.binding.id, profileVersion: first.binding.version, payloadPublic: JSON.stringify(sample.payload) })
say(unpassported.status === 'unknown', `the same payload checked without a passport identifier is ${unpassported.status}, never pass.`)

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
