#!/usr/bin/env node
/**
 * A passport projection from pinned sources, derived twice with the inputs in
 * different arrival orders, printed one sentence per finding. Reads the
 * published projection vectors and the synthetic profile they carry; nothing
 * here touches a network, a wallet or a chain, and no product it names exists.
 *
 *   node examples/project-passport.mjs [vector id]
 */
import { readFileSync } from 'node:fs'
import { projectPassport, verifyProjectionCommitment } from '@bsv/dpp-profiles'

const file = JSON.parse(readFileSync(new URL('../fixtures/vectors/dpp/interoperability/projection/v1.json', import.meta.url), 'utf8'))
const wanted = process.argv[2] ?? 'item-legitimate'
const vector = file.vectors.find((v) => v.id === wanted)
if (vector == null) { console.error(`no vector ${wanted}; the file carries ${file.vectors.map((v) => v.id).join(', ')}`); process.exit(2) }

const input = { ...vector.input, profile: file.shared.profile }
let failures = 0
const check = (holds, description) => { console.log(`${holds ? 'Holds' : 'FAILS'}: ${description}`); if (!holds) failures++ }

const first = projectPassport(input)
const reversed = projectPassport({ ...input, sources: [...input.sources].reverse(), relationships: [...input.relationships].reverse(), measurements: [...(input.measurements ?? [])].reverse() })

check(first.projection.projectionDigest === vector.expected.projectionDigest, `the derivation reproduces the pinned digest ${vector.expected.projectionDigest.slice(0, 16)}… for ${vector.id}.`)
check(reversed.projection.projectionDigest === first.projection.projectionDigest, 'the same inputs in the reverse arrival order derive the identical digest.')
const commitment = verifyProjectionCommitment(first.projection)
check(commitment.digestValid && commitment.idValid, 'the projection identity is derived from its committed body and nothing else.')
check(JSON.stringify(first.projection.fieldResults) === JSON.stringify(vector.expected.fieldResults), 'every field result (availability, applicability, finding) is the pinned one.')
check(JSON.stringify(first.projection.values) === JSON.stringify(vector.expected.values), 'every value and its source pointer is the pinned one.')

for (const [key, result] of Object.entries(first.projection.fieldResults)) {
  const value = first.projection.values[key]
  const where = value == null ? '' : ` from ${value.source.recordId}@${value.source.revisionId}`
  console.log(`  ${key}: ${result.availability}, ${result.applicability}${result.finding == null ? '' : `, ${result.finding}`}${where}${result.reason == null ? '' : ` (${result.reason})`}`)
}
console.log(`Sources read: ${first.projection.sourceRefs.map((s) => `${s.recordId}@${s.revisionId}`).join(', ')}; relationships: ${first.projection.relationshipRefs.length}; complete: ${first.validation.ok}.`)
console.log('This example derives data under a named policy. It verifies no signature, anchor, credential status or authority, and a projection is never a secured representation.')
process.exitCode = failures === 0 ? 0 : 1
