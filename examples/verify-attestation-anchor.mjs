#!/usr/bin/env node
/** Offline commitment and native signature verification using public test data. */
import { readFileSync } from 'node:fs'
import { LockingScript, Utils } from '@bsv/sdk'
import { lifecycleClaimBytes, lifecycleClaimDigest, verifyLifecycleClaim } from '@bsv/dpp-core'
import { decodeAttestationAnchor } from '@bsv/dpp-overlay-topics'

const path = process.argv[2] ?? new URL('../fixtures/attestation-anchor-v1.json', import.meta.url)
const fixture = JSON.parse(readFileSync(path, 'utf8'))
const anchor = decodeAttestationAnchor(LockingScript.fromHex(fixture.lockingScript))
let failures = 0
const check = (holds, description) => {
  console.log(`${holds ? 'Holds' : 'FAILS'}: ${description}`)
  if (!holds) failures++
}
check(anchor !== null, 'the anchoring service signature, key derivation and ten-field layout verify.')
check(Utils.toUTF8(lifecycleClaimBytes(fixture.claim)) === fixture.representationBytes,
  'the complete secured representation includes the native claim signature.')
const result = verifyLifecycleClaim(fixture.claim)
check(result.signature === 'verified' && result.identityBinding === 'key-identified',
  'the native claim signature verifies under its did:key issuer.')
if (anchor) {
  check(anchor.digest === lifecycleClaimDigest(fixture.claim), 'the anchor commits to those complete secured bytes.')
  check(anchor.issuer === fixture.claim.issuer && anchor.subject === fixture.claim.passportId && anchor.attestationType === fixture.claim.eventType,
    'the carried issuer, subject and event type match the signed claim.')
  check(anchor.representation === 'dpp-lifecycle-json-v1' && anchor.mediaType === 'application/json',
    'the representation and media type select the native lifecycle verifier.')
}
console.log('This example does not evaluate business authority, physical product binding, credential status, VSC conformance or transaction inclusion.')
process.exitCode = failures === 0 ? 0 : 1
