#!/usr/bin/env node
/**
 * Verify an externally issued passport credential under the
 * vc-di-ecdsa-rdfc-2019@1 profile (spec/external-credential-profile.md) from
 * the published vectors, with a static document loader over the pinned
 * documents and a required issuer policy naming the fixture issuer. One
 * sentence per check, and separately the exact-byte digests of the issued
 * bytes and of a re-serialised copy, which differ while both proofs hold.
 *
 *   node examples/verify-external-credential.mjs           # after npm run build -w @bsv/vsc
 *   node examples/verify-external-credential.mjs <vectors.json>
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createExternalDocumentLoader, verifyExternalCredential } from '@bsv/vsc/exchange'

const path = process.argv[2] ?? new URL('../fixtures/vectors/dpp/interoperability/external-credential/v1.json', import.meta.url)
const { vectors } = JSON.parse(readFileSync(path, 'utf8'))
const byId = (id) => vectors.find((v) => v.id === id)
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
let failures = 0

async function verify(vector) {
  const documents = new Map(Object.entries(vector.input.documents))
  const p = vector.input.policy
  return verifyExternalCredential({
    bytes: new TextEncoder().encode(vector.input.credential),
    representation: vector.input.representation,
    policy: {
      documentLoader: createExternalDocumentLoader(documents),
      evaluationTime: p.evaluationTime,
      expectedSubject: p.expectedSubject,
      authorityPolicy: { id: p.authority.id, required: true, trustedIssuers: p.authority.trustedIssuers },
      statusPolicy: { id: p.status.id, maxAgeMs: p.status.maxAgeMs, resolve: async (url) => { const d = documents.get(url); if (d == null) throw new Error('not pinned'); return d } },
    },
  })
}

for (const id of ['positive', 'tampered-subject']) {
  const vector = byId(id)
  const result = await verify(vector)
  console.log(`\n${id}: ${vector.description.split('.')[0]}.`)
  for (const [name, check] of Object.entries(result.checks)) {
    const reason = check.issues[0] == null ? '' : ` (${check.issues[0].code}: ${check.issues[0].message})`
    console.log(`  ${check.outcome === 'verified' ? 'Holds' : check.outcome === 'not-required' ? 'Not required' : check.outcome === 'invalid' ? 'FAILS' : check.outcome === 'unsupported' ? 'Unsupported' : 'Unknown'}: ${name}${reason}`)
  }
  const expectedProof = vector.expected.checks.proof
  if (result.checks.proof.outcome !== expectedProof) { failures += 1; console.log(`  FAILS: the proof answered ${result.checks.proof.outcome}, the vector expects ${expectedProof}.`) }
  if (result.digest !== vector.expected.sha256) { failures += 1; console.log('  FAILS: the exact-byte digest does not match the vector.') }
}

const positive = byId('positive'), reformatted = byId('reformatted')
const again = await verify(reformatted)
console.log('\nexact bytes against the proof:')
console.log(`  issued bytes      sha256 ${sha256(positive.input.credential)}`)
console.log(`  re-serialised     sha256 ${sha256(reformatted.input.credential)}`)
console.log(`  ${again.checks.proof.outcome === 'verified' ? 'Holds' : 'FAILS'}: the re-serialised copy's RDF proof still verifies, and its digest is a different commitment; only the issued bytes are what an anchor commits to.`)
if (sha256(positive.input.credential) === sha256(reformatted.input.credential)) failures += 1
console.log('\nThis example evaluates the credential under its own suite and a fixture policy. It does not establish issuer accreditation, the truth of the claims, chain inclusion, or any token operation.')
process.exitCode = failures === 0 ? 0 : 1
