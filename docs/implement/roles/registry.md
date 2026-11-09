# Registry

Registry implementers can use this guide to build validation, storage and retrieval interfaces for signed claims and evidence. A registry retains exact bytes so another party can retrieve and evaluate them; it may also validate without storing. It neither replaces the passport history held by an index nor recovers missing signing keys.

## Prerequisites and scope

| Work | Input and source |
|---|---|
| Implementation target | The registry contract revision linked below, your selected package set and the roles you implement. Record package versions and source revision. |
| Validation exercise | Node.js 22 or later, npm and git; complete [checkout setup](../../quick-start.md#get-the-code), including `npm ci` and `npm run build`. Run at the checkout root using its signed claim fixture. |
| Service comparison | Your registry URL, or network access to `https://dpp-resolver.bsvb.net`; hosted validation needs no credentials. |
| Storage and retrieval | Your persistent store for exact claim bytes, metadata and reports. |
| Optional anchoring | Your registry's wallet, anchoring key and index access, as described below. Declare this role separately. |

## Start with validation

1. Implement `POST /validate`. It accepts a supported secured representation as JSON. For the native exercise, the body is the signed claim and `subject` is the independently expected passport identifier.
2. Call `verifyLifecycleClaim(claim, { passportId: subject })` from `@bsv/dpp-protocol` for signature and subject binding ([issuer quick start](../../quick-start.md#sign-a-claim)). Call `verifyPassportEvidence` for the shared report when the request carries token history or your registry holds evidence for that passport.
3. Return the named outcome, checks and report under `attestation-registry/1`, as the [validate operation](https://github.com/bsv-blockchain/dpp/blob/2bcff85c1ccbb24aa6c49274c0af0c6b5b190991/contracts/registry.yaml#L743-L786) defines. Store nothing.
4. Run this [validation request](../../quick-start.md#ask-a-registry-to-check-the-claim). It reads the fixture, avoiding manual transcription. Set `REGISTRY_URL` to your service; the shown hosted demonstration URL needs no credentials and stores nothing.

```sh
REGISTRY_URL=https://dpp-resolver.bsvb.net node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const url = new URL('/validate', process.env.REGISTRY_URL ?? 'http://localhost:4000')
url.searchParams.set('subject', fixture.unsignedClaim.passportId)
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fixture.claim),
})
assert.equal(response.status, 200)
const result = await response.json()
console.log(JSON.stringify(result.report ?? result, null, 2))
JS
```

| Inspect | Expected result |
|---|---|
| HTTP response | 200 |
| Report | Native signature and subject binding pass. The fixture request also passes validity period and evidence; checks needing evidence not sent, including token history or anchor evidence, remain `unknown` with reasons. |

Stop if the assertion or expected checks fail; use the [HTTP guide](../../reference/contracts.md#validate-a-claim) for the response and error boundary. A hosted answer is comparison evidence, not a substitute for the selected contract.

This completes only the validation milestone. Continue with storage, exact-byte retrieval and evidence reporting below. Test malformed, missing-evidence and valid inputs separately for every supported operation.

## No public reference registry

The DPP checkout starts no registry; no registry package or container image is published. The programme's registry lives in a separate, non-public repository. Implement the contract with the published packages and compare answers with the hosted demonstration. Declare the registry role under [conformance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md), and any anchoring or issuer role separately.

## The minimum a registry serves

Implement these operations in this order, testing each with a malformed input, a missing-evidence input and a valid input before starting the next. The [contract](https://github.com/bsv-blockchain/dpp/blob/2bcff85c1ccbb24aa6c49274c0af0c6b5b190991/contracts/registry.yaml) defines every request and response shape.

| Operation | What it must do | Package support |
|---|---|---|
| `GET /capabilities` | Declare the representations, proof suites, topic and lookup service, interoperability profiles and explicit `unsupported` entries, and name your anchoring key, under `publisherPolicy.anchoringServices` in the schema's document or as `anchoredBy` in the contract's, so a verifier can tell your anchors from others'; never a certification claim | The [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/capabilities.schema.json) and the contract's [capabilities operation](https://github.com/bsv-blockchain/dpp/blob/2bcff85c1ccbb24aa6c49274c0af0c6b5b190991/contracts/registry.yaml#L539-L547), which define two different documents (see below) |
| `POST /validate` | Verify without storing, as above | `verifyLifecycleClaim`, `verifyPassportEvidence` |
| `POST /attestations` | Verify the explicit secured representation under the declared policy; store the exact bytes with their media type, representation, digest and scoped report; refuse an invalid or unsupported submission by name (a `vsc-seal-json-v1` SEAL, whose profile is parked, as `unsupported` with `representation-unsupported`); store a duplicate once; report acceptance, anchoring and inclusion as separate fields | `verifyLifecycleClaim`, `lifecycleClaimBytes`, `lifecycleClaimDigest` |
| `GET /attestations` and `GET /attestations/{id}/report` | Page the held records over a stable snapshot; return the stored report for one record | The contract's cursor and snapshot rules |
| `GET /attestations/{id}/proof` | Return the canonical bytes with everything a third party needs to check the anchor without this service; once the anchor is mined, send its `blockHeight` and `merklePath` too if you hold them, so a verifier need not ask a chain source | `lifecycleClaimBytes` |
| `GET /history` | The lifecycle history of one passport from the claims held; a lookup, not an export | |
| `GET /passports/{passportId}/evidence-package` | The signed `dpp-evidence-package@1` envelope for one passport | `signEvidenceManifest`, `inspectEvidencePackage` |

Anchoring is the registry's optional second role. When performed, build the `bsv-attestation-anchor-v1` locking script with `buildAttestationAnchor` over the stored bytes' digest and metadata, broadcast it through the registry's own wallet, announce the transaction to `tm_attestation` on an overlay, and serve the proof route so a reader can check the anchor independently. [Rules](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md) section 5 fixes the script, the [anchor example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/verify-attestation-anchor.mjs) is the reader a proof must satisfy, and [choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet) covers the wallet. An accepted record can remain unanchored, and the intake response says so.

Certifications, GS1 resolution and showcase routes belong to the hosted demonstration's other roles, outside the registry minimum. The contract defines no status list routes: check the status lists credential issuers publish, and leave publishing them to the issuer. Serve both showcase routes cross-origin for the hosted proof page to read your registry ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)).

`GET /chain` is also outside the minimum: it gives a passport's custody timeline and anchors. The contract says readers needing raw envelopes for independent verification should not depend on it. Use `GET /attestations?subject=<passport identifier>` and `GET /attestations/{id}/proof` per claim ([gather a passport's evidence](../../packages/dpp-protocol.md#gather-a-passports-evidence)).

Registries do not exchange claims. Only the registry that received a claim holds it. The anchor carries digest, identifier, issuer, subject, type, representation, media type and anchoring service key ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 5), but no registry address. Neither a passport state, capability document nor GS1 link type names a registry. Another stack can find the anchor through an index holding it; to retrieve the claim, it must already know the registry. Until the standard provides discovery, obtain that address from the passport's publisher ([known limitations](../../operate/limitations.md)).

Given an anchor without its claim bytes, six checks remain `unknown` ([full comparison](../../packages/dpp-protocol.md#what-the-report-takes)):

| Check | Status | Reason |
|---|---|---|
| `anchorSignature`, `anchorKeyDerivation` | `pass` | Anchor evidence remains available. |
| `nativeAttestationSignature`, `schema`, `credentialTime`, `credentialStatus` | `unknown` | `no-evidence` |
| `anchorDigestAndMetadataBinding` | `unknown` | `secured-bytes-absent` |
| `evidenceAvailability` | `unknown` | `referenced-artefact-unavailable` |

The two capability documents are not one:

| Document | Fields and scope |
|---|---|
| DPP [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/capabilities.schema.json) | `capabilitiesVersion`, `implementation`, `roles`, `protocols`, `profiles`, `anchorFormats`; required of every implementation by [conformance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md) section 4. |
| Registry contract's `Capabilities` | `protocol: attestation-registry/1`, `representations`, `proofSuites`, `unsupported`, `legacyIntake`; served by the hosted demonstration registry. |

Serve the schema's document to conform. Which document `GET /capabilities` answers with is not settled yet. Stop before claiming that either shape resolves which document the route serves.

## Add storage and retrieval

1. After validation, add intake and retain the secured representation with its identifier, subject and evidence.
2. Add exact-byte retrieval. Confirm it returns what you retained before adding history, status or export.
3. Supply optional token history as request context when token checks are needed. Do not add it to the signed claim or invent an anchor-script request field.
4. Run the malformed-input, missing-evidence and valid-input cases for each supported operation.

Treat a registry archive as one recovery input. The reference archive does not contain token history, restricted evidence or keys. [Recovery](../../operate/export-import-recovery.md) explains how that affects provider replacement.

## Exact implementation sources

- [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/2bcff85c1ccbb24aa6c49274c0af0c6b5b190991/contracts/registry.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/2bcff85c1ccbb24aa6c49274c0af0c6b5b190991/spec/services.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md)
- [spec/portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/portable-evidence.md)

To see your registry the way a stranger will, run `node examples/check-registry.mjs <your registry>`: it checks every record against the chain ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)). Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
