#!/usr/bin/env node
/**
 * Check an anchor the way rules.md §6 says a stranger can: from the output's
 * own bytes plus the attestation it commits to, with no call to the service
 * that wrote it.
 *
 *   node examples/verify-anchor.mjs            # fixtures/anchor-v3.json
 *   node examples/verify-anchor.mjs <file>     # a JSON file of the same shape
 *
 * The checks, in the order the rules list them: the attestation's canonical
 * bytes hash to field 2; the anchor's field-8 signature verifies over the
 * length-delimited preimage and the locking key is the BRC-42 child of the
 * field-7 service key (both are what the reader's parse enforces: it returns
 * nothing for an output that fails either); the issuer DID decodes to the
 * issuer key the attestation names; and every refusal vector the fixture
 * carries is refused. The claim is canonicalised here, with the standard's own
 * canonicaliser, so the recipe starts from the claim and not from bytes it
 * was handed.
 *
 * Results print one sentence per check, never a score.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hash, LockingScript, Utils } from '@bsv/sdk'
import { canonicalBytes, canonicalString } from '@bsv/dpp-core'
import { identityKeyFromDidKey, tryParseUoraAnchor, expectedLockingKey } from '@bsv/dpp-overlay-topics'

const here = dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] ?? join(here, '..', 'fixtures', 'anchor-v3.json')
const F = JSON.parse(readFileSync(file, 'utf8'))

let failures = 0
const say = (ok, sentence) => {
  console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`)
  if (!ok) failures++
}

const canonical = canonicalString(F.attestation)
say(canonical === F.canonical, 'the claim canonicalises to the pinned bytes: keys sorted, no whitespace, strings and safe integers only.')
const digest = Utils.toHex(Hash.sha256(canonicalBytes(F.attestation)))
say(digest === F.digest, `those bytes hash to ${digest.slice(0, 12)}..., which is field 2.`)

const anchor = tryParseUoraAnchor(LockingScript.fromHex(F.lockingScript))
say(anchor != null, 'the anchor parses: eight fields, the v3 prefix, a signature that verifies over the length-delimited preimage, and a locking key derived from the anchoring service in field 7.')
if (anchor != null) {
  say(anchor.digest === F.digest, 'field 2 of the parsed anchor is the digest above.')
  say(anchor.subject === F.subject && anchor.uoraType === F.uoraType && anchor.attestationId === F.attestationId,
    `the anchor names subject ${anchor.subject.split('/21/')[1] ?? anchor.subject}, type ${anchor.uoraType}, attestation ${anchor.attestationId.split('/').pop()}.`)
  say(anchor.anchoredBy === F.anchoredBy && anchor.lockingKey === expectedLockingKey(F.anchoredBy, F.attestationId),
    `the output locks to the BRC-42 child of the anchoring service ${F.anchoredBy.slice(0, 12)}..., so that service, and only it, could have written it.`)
  say(anchor.issuer === F.issuerDid && identityKeyFromDidKey(F.issuerDid) === F.issuerKey,
    `the issuer ${F.issuerDid.slice(0, 20)}... decodes offline to the key the attestation names; the anchor carries it, the attestation's own signature proves it.`)
}

const refusals = [
  ...F.boundaryShifted.map((hex, i) => [`boundaryShifted[${i}]`, hex]),
  ['uncompressedKey', F.uncompressedKey],
  ...F.malformedTail.map((hex, i) => [`malformedTail[${i}]`, hex]),
]
for (const [name, hex] of refusals) {
  say(tryParseUoraAnchor(LockingScript.fromHex(hex)) === null, `the reader refuses ${name}.`)
}

console.log(failures === 0 ? 'Every check holds.' : `${failures} check(s) fail.`)
process.exit(failures === 0 ? 0 : 1)
