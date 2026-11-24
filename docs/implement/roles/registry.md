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
2. Call `verifyLifecycleClaim(claim, { passportId: subject })` from `@bsv/dpp-protocol` for signature and subject binding ([issuer quick start](../../quick-start.md#sign-a-claim)). Call `verifyPassportEvidence` for the shared report whenever the evidence identifies one subject or the caller supplies one. Include any available token history and use the specified missing-evidence findings for the rest.
3. Return the named outcome, checks and report under `attestation-registry/1`, as the [validate operation](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml#L267-L301) defines. Store nothing.
4. Run this [validation request](../../quick-start.md#ask-a-registry-to-check-the-claim). It reads the fixture, avoiding manual transcription. From a repository checkout with dependencies installed, set `REGISTRY_URL` to your local service.

```sh
REGISTRY_URL=http://localhost:4000 node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const readSchema = (name) => JSON.parse(readFileSync('contracts/' + name + '.schema.json', 'utf8'))
const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
ajv.addSchema(readSchema('capabilities'))
const checkCapabilities = ajv.compile(readSchema('registry-capabilities'))
const checkReport = ajv.compile(readSchema('verification-report'))
const capabilities = await fetch(new URL('/capabilities', process.env.REGISTRY_URL))
assert.equal(capabilities.status, 200)
assert.ok(checkCapabilities(await capabilities.json()), ajv.errorsText(checkCapabilities.errors))

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
assert.equal(result.contract, 'attestation-registry/1')
assert.ok(checkReport(result.report), ajv.errorsText(checkReport.errors))
console.log(JSON.stringify(result.report, null, 2))
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

The registry contract lists seven operations, and they are all it lists. Implement them in this order, testing each with a malformed input, a missing-evidence input and a valid input before starting the next. The [contract](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml) defines every request and response shape.

| Operation | What it must do | Package support |
|---|---|---|
| `GET /capabilities` | Serve the common capability document and declare the `registry` role, the contract, the representations, proof suites, topic and lookup service, interoperability profiles and explicit `unsupported` entries, and name your anchoring key under `publisherPolicy.anchoringServices`, so a verifier can tell your anchors from others'; never a certification claim | The [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/capabilities.schema.json), with the members the contract asks of a registry (see below) |
| `POST /validate` | Verify without storing, as above | `verifyLifecycleClaim`, `verifyPassportEvidence` |
| `POST /attestations` | Verify the explicit secured representation under the declared policy; store the exact bytes with their media type, representation, digest and scoped report; refuse an invalid or unsupported submission by name (a `vsc-seal-json-v1` SEAL, whose profile is parked, as `unsupported` with `representation-unsupported`, and a body naming no current representation, a historical UORA body among them, as `invalid`); store a duplicate once; report acceptance, anchoring and inclusion as separate fields | `verifyLifecycleClaim`, `lifecycleClaimBytes`, `lifecycleClaimDigest` |
| `GET /attestations` | Page the held records over a stable snapshot | The contract's cursor and snapshot rules |
| `GET /attestations/{id}/proof` | Return the canonical bytes with everything a third party needs to check the anchor without this service; once the anchor is mined, send its `blockHeight` and `merklePath` too if you hold them, so a verifier need not ask a chain source | `lifecycleClaimBytes` |
| `GET /chain` | A passport's custody timeline with each record's anchor, unbounded or in pages of a snapshot | The contract's cursor and snapshot rules |
| `GET /passports/{passportId}/evidence-package` | The signed `dpp-evidence-package@1` envelope for one passport: `exporter.id` is your anchoring identity key, the one your capability document names, and the manifest is signed by its BRC-42 child for `[1, 'dpp evidence package v1']`, the passport identifier and counterparty `anyone`, as every exporter's is | `evidencePackageSigningKey`, `signEvidenceManifest`, `evidencePackageSigner`, `inspectEvidencePackage` |

Anchoring is the registry's optional second role. When performed, build the `bsv-attestation-anchor-v1` locking script with `buildAttestationAnchor` over the stored bytes' digest and metadata, broadcast it through the registry's own wallet, announce the transaction to `tm_attestation` on an overlay, and serve the proof route so a reader can check the anchor independently. [Rules](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/rules.md) section 5 fixes the script, the [anchor example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/verify-attestation-anchor.mjs) is the reader a proof must satisfy, and [choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet) covers the wallet. An accepted record can remain unanchored, and the intake response says so.

A registry may serve more than these, and the contract does not describe it. The reference registry also serves a stored record's report, a passport's history, profile documents, a GS1 resolver origin with the printed-label route, and showcase routes, and documents them itself; a client that relies on one of them relies on that registry, not on the standard. The hosted proof page reads a registry's showcase routes ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)). The contract defines no status list routes: check the status lists credential issuers publish, and leave publishing them to the issuer.

The contract has no legacy intake. A registry that holds records stored under a historical UORA representation keeps them readable as `legacy-uora-json`, and refuses a new historical body as it refuses any body naming no current representation. Such a record retains no secured bytes, only the canonical bytes its digest commits to: the record list names it, the proof and chain routes serve those canonical bytes, and the evidence package names it under what the registry could not produce.

The contract says readers needing raw envelopes for independent verification should not depend on `GET /chain`. Use `GET /attestations?subject=<passport identifier>` and `GET /attestations/{id}/proof` per claim ([gather a passport's evidence](../../packages/dpp-protocol.md#gather-a-passports-evidence)).

Registries do not exchange claims. Only the registry that received a claim holds it. The anchor carries digest, identifier, issuer, subject, type, representation, media type and anchoring service key ([rules](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/rules.md) section 5), but no registry address. Neither a passport state, capability document nor GS1 link type names a registry. Another stack can find the anchor through an index holding it; to retrieve the claim, it must already know the registry. Until the standard provides discovery, obtain that address from the passport's publisher ([known limitations](../../operate/limitations.md)).

Given an anchor without its claim bytes, six checks remain `unknown` ([full comparison](../../packages/dpp-protocol.md#what-the-report-takes)):

| Check | Status | Reason |
|---|---|---|
| `anchorSignature`, `anchorKeyDerivation` | `pass` | Anchor evidence remains available. |
| `nativeAttestationSignature`, `schema`, `credentialTime`, `credentialStatus` | `unknown` | `no-evidence` |
| `anchorDigestAndMetadataBinding` | `unknown` | `secured-bytes-absent` |
| `evidenceAvailability` | `unknown` | `referenced-artefact-unavailable` |

A registry serves one capability document, the one [conformance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md) section 4 requires of every implementation. An index may expose it through its optional HTTP extension. The registry route uses `contracts/registry-capabilities.schema.json`, which extends the common schema. The repository contains a complete example in `conformance/examples/capabilities-registry.json`.

| Member | What a registry declares | In the earlier registry document |
|---|---|---|
| `capabilitiesVersion` | `"1"` | Absent |
| `implementation` | Your registry's `name` and `version`; optionally `sourceRevision` and `baselineId` | Absent |
| `roles` | `registry`, beside any other role you claim | Absent |
| `protocols` | `{ "id": "attestation-registry", "version": "1" }`. You should also name `registry-http` at the contract version you implement and each anchor protocol you write, such as `bsv-attestation-anchor` at `1` | `protocol: "attestation-registry/1"` |
| `profiles` | The exact profiles you implement, such as the exchange profile `vc-di-ecdsa-rdfc-2019` at `1`; an empty list when you name none | Absent |
| `representations` | One object for each representation intake accepts: its `id`, its `mediaType` and `verification: "content"` | A list of the identifiers alone |
| `proofSuites` | The proof suites you verify | Unchanged |
| `anchorFormats` | Each anchor format you write or still hold records under, with its status, such as `bsv-attestation-anchor-v1` as `current`; an empty list when you anchor nothing | Absent |
| `topics` and `services` | `tm_attestation` and `ls_attestation` | `topic` and `lookupService` |
| `interoperability` | `discovery`, `externalCredential` and `externalCredentialPolicy`, with `resolverOrigin` when you serve a resolver | Unchanged |
| `publisherPolicy.anchoringServices` | Your anchoring identity key, when you anchor | `anchoredBy` |
| `exporterIdentityKey` | The identity key your evidence packages name as `exporter.id`, when you sign packages | `anchoredBy` |
| `unsupported` | What you do not implement, each with only an `id` and a `reason`: the parked `vsc-seal-json-v1` and, where historical records are held, `legacy-uora-json` | Unchanged |

The schema refuses a member it does not define, so the earlier members cannot stay beside these. An earlier draft of the registry contract defined a document of its own for this route, the third column, which a registry could not serve together with this one. The hosted demonstration registry still serves that earlier document until it is redeployed, so read a registry's anchoring key from `publisherPolicy.anchoringServices` first and from `anchoredBy` where that is absent, as `examples/check-registry.mjs` does.

## Add storage and retrieval

1. After validation, add intake and retain the secured representation with its identifier, subject and evidence.
2. Add exact-byte retrieval. Confirm it returns what you retained before adding the chain, status or export.
3. Supply optional token history as request context when token checks are needed. Do not add it to the signed claim or invent an anchor-script request field.
4. Run the malformed-input, missing-evidence and valid-input cases for each supported operation.

Treat a registry archive as one recovery input. The reference archive does not contain token history, restricted evidence or keys. [Recovery](../../operate/export-import-recovery.md) explains how that affects provider replacement.

## Exact implementation sources

- [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/services.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md)
- [spec/portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/portable-evidence.md)

To see your registry the way a stranger will, run `node examples/check-registry.mjs <your registry>`: it checks every record against the chain ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)). Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
