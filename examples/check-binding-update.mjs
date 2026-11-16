#!/usr/bin/env node
/**
 * Check a binding against new files, review the change report and see what
 * the proposed next version would do to the profile's own vectors.
 *
 *   node examples/check-binding-update.mjs
 *       the example profile under examples/custom-profile/example-bottle@1, against a changed context made here
 *   node examples/check-binding-update.mjs <binding folder> <candidate folder> [--release <text>] [--revision <commit>] [--out <folder>]
 *       a binding folder of your own against a folder of candidate files; prints the report as JSON
 *
 * A binding is immutable. When the source of a profile publishes its files
 * again with changes, nothing is edited: `checkBindingUpdate` compares the
 * active version with the candidate files and answers with a report and a
 * proposed binding at the next version. It registers nothing and fetches
 * nothing. Whether the proposal is ever used is decided afterwards, by
 * whoever adds its digest to a registry's trusted list.
 *
 * With two folders, the candidate folder holds the next version's files
 * under the names the binding lists them by. A listed file that is not
 * there is reported as removed. `--out` writes the proposed `binding.json`,
 * its files and `update-report.json` into a new binding folder to review.
 * A file the binding does not list yet has to state its role and licence,
 * which a folder cannot say, so adding one is done with the function itself.
 *
 * Without arguments the script walks through the whole decision on the
 * example profile, and results print one sentence per check, never a score.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { bindingPayloadValidator, checkBindingUpdate, createProfileRegistry, profileBindingDigest } from '@bsv/dpp-profiles'
import { VALIDATION_ENGINE_LIBRARIES, createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

const here = dirname(fileURLToPath(import.meta.url))
const { values: options, positionals } = parseArgs({ allowPositionals: true, options: { release: { type: 'string' }, revision: { type: 'string' }, out: { type: 'string' } } })
const utf8 = (text) => new TextEncoder().encode(text)

/** The active version as a registry holds it: registered from its folder, with every file held to the binding's record. */
async function registerFolder(folder, alsoTrusted = []) {
  const bindingBytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))
  const registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(bindingBytes), ...alsoTrusted] })
  const result = await registry.register({ bindingBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(folder, artefact.path))) })
  if (!result.ok) { console.error(`${folder} was refused as ${result.code}: ${result.detail}`); process.exit(1) }
  return { registry, active: result.profile }
}
const fromProposal = (proposal) => (artefact) => proposal.artefacts.find((entry) => entry.artefact.path === artefact.path)?.bytes

// Two folders: the check alone, for a maintainer or an operator with new files in hand.
if (positionals.length > 0) {
  if (positionals.length !== 2) { console.error('Usage: node examples/check-binding-update.mjs <binding folder> <candidate folder> [--release <text>] [--revision <commit>] [--out <folder>]'); process.exit(1) }
  const [bindingFolder, candidateFolder] = positionals.map((folder) => resolve(folder))
  const { active } = await registerFolder(bindingFolder)
  const artefacts = active.binding.artefacts.filter((artefact) => existsSync(join(candidateFolder, artefact.path))).map((artefact) => ({ path: artefact.path, bytes: new Uint8Array(readFileSync(join(candidateFolder, artefact.path))) }))
  const source = { ...(options.release == null ? {} : { release: options.release }), ...(options.revision == null ? {} : { revision: options.revision }) }
  const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts, ...(Object.keys(source).length > 0 ? { source } : {}) } })
  console.log(JSON.stringify(report, null, 2))
  if (options.out != null && proposal != null) {
    const out = resolve(options.out)
    if (existsSync(out)) { console.error(`${out} exists already. The proposal is written to a new folder, never over another.`); process.exit(1) }
    for (const [path, bytes] of [['binding.json', proposal.bindingBytes], ...proposal.artefacts.map((entry) => [entry.artefact.path, entry.bytes]), ['update-report.json', utf8(`${JSON.stringify(report, null, 2)}\n`)]]) {
      mkdirSync(dirname(join(out, path)), { recursive: true })
      writeFileSync(join(out, path), bytes)
    }
    console.error(`${proposal.profile} is written to ${out} with binding digest ${proposal.bindingDigest}. Nothing was registered.`)
  }
  // A proposal that could not be written is the one outcome a script should stop on.
  process.exit(report.outcome === 'refused' ? 1 : 0)
}

let failures = 0
const say = (ok, sentence) => {
  console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`)
  if (!ok) failures++
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

// 1. The active version: the example profile, registered from its folder as examples/custom-profile.mjs does.
const folder = join(here, 'custom-profile', 'example-bottle@1')
const { registry, active } = await registerFolder(folder)
const activeBindingBytes = readFileSync(join(folder, 'binding.json'))
say(true, `${active.profile} is the active version, under binding digest ${active.bindingDigest}.`)

// 2. The candidate: the same files, with a context that drops one term, gives another a different meaning and adds a third.
// A real candidate is the files the profile's source published. The check takes bytes and fetches nothing.
const context = JSON.parse(readFileSync(join(folder, 'context.jsonld'), 'utf8'))
delete context['@context'].capacityMillilitres
context['@context'].batch = 'bottle:productionLot'
context['@context'].colour = 'bottle:colour'
const changedContext = utf8(`${JSON.stringify(context, null, 2)}\n`)
const candidate = { artefacts: active.artefacts.map(({ artefact, bytes }) => ({ path: artefact.path, bytes: artefact.path === 'context.jsonld' ? changedContext : bytes })) }

// 3. The check. One report, one proposal, and nothing registered.
const { report, proposal } = checkBindingUpdate({ active, candidate })
console.log(`\nThe report for ${report.active.profile}:`)
for (const entry of report.artefacts) {
  const side = (snapshot) => (snapshot == null ? 'absent' : `${snapshot.byteLength} bytes, SHA-256 ${snapshot.sha256}`)
  console.log(`  ${entry.path}: ${entry.change}, compared by ${entry.compared}${entry.change === 'unchanged' ? '' : `\n    before: ${side(entry.before)}\n    after:  ${side(entry.after)}`}`)
  for (const term of entry.context?.read === true ? entry.context.terms : []) console.log(`    ${term.change} ${term.term}${term.breaking ? ' (breaking)' : ''}`)
}
for (const sentence of report.breaking) console.log(`  Breaking: ${sentence}`)
for (const sentence of report.review) console.log(`  To review: ${sentence}`)
console.log('')

const terms = report.artefacts.find((entry) => entry.path === 'context.jsonld')?.context?.terms ?? []
const named = (change) => terms.filter((term) => term.change === change).map((term) => `${term.term}${term.breaking ? ', breaking' : ''}`).join('; ')
say(report.outcome === 'proposed' && proposal?.profile === 'example-bottle@2', `the check proposes ${proposal?.profile} under a binding digest of its own, ${proposal?.bindingDigest}.`)
say(named('removed') === 'capacityMillilitres, breaking' && named('redefined') === 'batch, breaking' && named('added') === 'colour', `the report lists what the context removes (${named('removed')}), redefines (${named('redefined')}) and adds (${named('added')}).`)
say(report.artefacts.filter((entry) => entry.change === 'unchanged').length === 3, 'the three files that did not change are listed as unchanged, each with the same length and digest on both sides.')
say(report.limits.vectors === 'not-run' && report.limits.activation === 'explicit-registration', 'the report states its limits: it ran no vector, and it activates nothing.')

// 4. The active version is what it was.
const still = registry.resolve('example-bottle', 1)
say(still === active && still.bindingDigest === profileBindingDigest(activeBindingBytes) && Buffer.from(still.bindingBytes).equals(activeBindingBytes), `${active.profile} still resolves to the same binding, byte for byte, and the registry holds no ${proposal.profile}.`)
const untrusted = await registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })
say(!untrusted.ok && untrusted.code === 'binding-untrusted' && registry.resolve('example-bottle', 2) == null, `registering the proposal there is refused as ${untrusted.ok ? 'nothing' : untrusted.code}: this registry was never told to trust its digest.`)

// 5. The review. A registry made for the review trusts the proposal's digest, so the vectors can be run under it.
// This is the part the check leaves to its caller, because it needs the validation engines.
const review = await registerFolder(folder, [proposal.bindingDigest])
const accepted = await review.registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })
say(accepted.ok, `a review registry that trusts the digest registers ${proposal.profile} beside ${active.profile}.`)
const validate = bindingPayloadValidator({ registry: review.registry, engines })
const answer = async (vector, version, digest) => {
  // A vector is written for the active version. Under the proposal the same product declares the proposed version and its digest.
  const payload = version === active.version ? vector.payload : { ...vector.payload, profile_version: version, ...(vector.payload.profile_binding_sha256 === active.bindingDigest ? { profile_binding_sha256: digest } : {}) }
  const result = await validate({ profile: active.id, profileVersion: version, payloadPublic: JSON.stringify(payload), passportId: vector.passportId })
  return `${result.status}${result.detail.cause == null ? '' : ` (${result.detail.cause})`}`
}
const differing = []
let ran = 0
for (const path of [...active.binding.vectors.positive, ...active.binding.vectors.negative]) {
  const vector = JSON.parse(readFileSync(join(folder, path), 'utf8'))
  if (vector.kind === 'registration') continue
  ran++
  const before = await answer(vector, active.version, active.bindingDigest)
  const after = await answer(vector, proposal.version, proposal.bindingDigest)
  if (before !== after) differing.push(`${path}: ${before} under ${active.profile}, ${after} under ${proposal.profile}`)
}
for (const line of differing) console.log(`  ${line}`)
const nowFailing = differing.filter((line) => line.includes(': pass under') && line.includes(`, fail (profile-rule-violation) under ${proposal.profile}`))
say(nowFailing.length === active.binding.vectors.positive.length, `of ${ran} payload vectors, ${differing.length} answer differently under the proposal, and the ${nowFailing.length} that passed now fail: each states the capacity the candidate context no longer defines. That is the removal the report marked as breaking.`)

// 6. What the registry refuses, whoever asks.
const overwrite = utf8(`${JSON.stringify({ ...proposal.binding, version: active.version, profile: active.profile }, null, 2)}\n`)
const takeover = await registerFolder(folder, [profileBindingDigest(overwrite)])
const refused = await takeover.registry.register({ bindingBytes: overwrite, resolveArtefact: fromProposal(proposal) })
say(!refused.ok && refused.code === 'binding-conflict' && takeover.registry.resolve('example-bottle', 1).bindingDigest === active.bindingDigest, `the proposed files written back as ${active.profile} are refused as ${refused.ok ? 'nothing' : refused.code}, even with that digest trusted: a changed binding is a new version.`)

// 7. No change, no proposal.
const same = checkBindingUpdate({ active, candidate: { artefacts: active.artefacts.map(({ artefact, bytes }) => ({ path: artefact.path, bytes })) } })
say(same.report.outcome === 'unchanged' && same.proposal == null, 'checked against its own files, the profile reports no change and proposes nothing.')

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
