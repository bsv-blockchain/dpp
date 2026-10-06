# Registry

A registry retains signed claims and evidence so another party can retrieve and evaluate them. It can also expose a validation operation without storing the request. It does not replace the passport history held by an overlay or recover a missing signing key.

## Start with validation

The first interface to implement is `POST /validate`. It accepts a supported secured representation as JSON. For the native exercise, send the signed claim as the body and the independently expected passport identifier in the `subject` query parameter.

For a native claim the operation is two package calls. `verifyLifecycleClaim(claim, { passportId: subject })` from `@bsv/dpp-core` checks the signature and the subject binding, exactly as the [issuer quick start](../../quick-start.md#sign-a-claim) does. `verifyPassportEvidence` produces the shared verification report when the request carries token history or the registry holds evidence for that passport. Answer under the `attestation-registry/1` contract with the named outcome, the checks and the report, as the [validate operation](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/registry.yaml#L773-L823) defines them, and store nothing.

Run the [validation request](../../quick-start.md#ask-a-registry-to-check-the-claim) against your service. The example reads the signed claim from the local fixture, so there is no claim object to transcribe. Expect HTTP 200 and inspect the report's native-signature and subject-binding checks. Missing token or anchor evidence remains unestablished. To see the expected answer before writing a line, run the same request against the hosted demonstration registry at `https://dpp-resolver.bsvb.net`, which serves the operation without credentials and stores nothing. The [HTTP guide](../../reference/contracts.md#validate-a-claim) explains the request, response and error boundary.

## No public reference registry

The DPP checkout does not start a registry, and no registry package or container image is published. The registry the programme operates is maintained in a separate repository that is not public. Build against the contract: everything it requires of a registry can be implemented with the published packages, and the hosted demonstration registry is available for comparing answers. A registry is a role of its own under [conformance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md); the anchoring and issuer roles it may also perform are declared separately.

## The minimum a registry serves

Implement these operations in this order, testing each with a malformed input, a missing-evidence input and a valid input before starting the next. The [contract](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/registry.yaml) defines every request and response shape.

| Operation | What it must do | Package support |
|---|---|---|
| `GET /capabilities` | Declare the representations, proof suites, topic and lookup service, interoperability profiles and explicit `unsupported` entries, and name your anchoring key, under `publisherPolicy.anchoringServices` in the schema's document or as `anchoredBy` in the contract's, so a verifier can tell your anchors from others'; never a certification claim | The [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/capabilities.schema.json) and the contract's [capabilities operation](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/registry.yaml#L572-L580), which define two different documents (see below) |
| `POST /validate` | Verify without storing, as above | `verifyLifecycleClaim`, `verifyPassportEvidence` |
| `POST /attestations` | Verify the explicit secured representation under the declared policy; store the exact bytes with their media type, representation, digest and scoped report; refuse an invalid or unsupported submission by name; store a duplicate once; report acceptance, anchoring and inclusion as separate fields | `verifyLifecycleClaim`, `lifecycleClaimBytes`, `lifecycleClaimDigest` |
| `GET /attestations` and `GET /attestations/{id}/report` | Page the held records over a stable snapshot; return the stored report for one record | The contract's cursor and snapshot rules |
| `GET /attestations/{id}/proof` | Return the canonical bytes with everything a third party needs to check the anchor without this service; once the anchor is mined, send its `blockHeight` and `merklePath` too if you hold them, so a verifier need not ask a chain source | `lifecycleClaimBytes` |
| `GET /history` | The lifecycle history of one passport from the claims held; a lookup, not an export | |
| `GET /passports/{passportId}/evidence-package` | The signed `dpp-evidence-package@1` envelope for one passport | `signEvidenceManifest`, `inspectEvidencePackage` |

Anchoring is the registry's optional second role. When performed, build the `bsv-attestation-anchor-v1` locking script with `buildAttestationAnchor` over the stored bytes' digest and metadata, broadcast it through the registry's own wallet, announce the transaction to `tm_attestation` on an overlay, and serve the proof route so a reader can check the anchor independently. [Rules](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md) section 5 fixes the script, the [anchor example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/verify-attestation-anchor.mjs) is the reader a proof must satisfy, and [choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet) covers the wallet. An accepted record can remain unanchored, and the intake response says so.

Status lists, certifications, GS1 resolution and the showcase routes in the contract belong to the hosted demonstration's other roles and are not part of the registry minimum. Serve the two showcase routes, and answer them cross-origin, if you want the hosted proof page to read your registry ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)).

`GET /chain`, a custody timeline of one passport's records with their anchors, is outside the minimum too, and the contract says a caller needing raw envelopes for independent verification should not depend on it. A reader gets a passport's claims from the minimum instead, with `GET /attestations?subject=<passport identifier>` and one `GET /attestations/{id}/proof` per claim, as [gather a passport's evidence](../../packages/dpp-core.md#gather-a-passports-evidence) shows.

Registries do not exchange claims. A claim is held only by the registry it was submitted to, and nothing names that registry: the anchor carries the claim's digest, identifier, issuer, subject, type, representation, media type and anchoring service key ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 5), and no passport state, capability document or GS1 link type names a registry either. A reader on another stack finds the anchor through any index that holds it, but gets the claim only from a registry it already knows to ask. Until the standard gives a registry a way to be named, a reader learns it from the passport's publisher ([known limitations](../../operate/limitations.md)). Given the anchor without the claim or its bytes, the report still passes `anchorSignature` and `anchorKeyDerivation`, and six checks read `unknown`: `nativeAttestationSignature`, `schema`, `credentialTime` and `credentialStatus` with `no-evidence`, `anchorDigestAndMetadataBinding` with `secured-bytes-absent`, and `evidenceAvailability` with `referenced-artefact-unavailable` ([the full comparison](../../packages/dpp-core.md#what-the-report-takes)).

The two capability documents are not one. The [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/capabilities.schema.json) defines the DPP capability document every implementation serves under [conformance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md) section 4, with `capabilitiesVersion`, `implementation`, `roles`, `protocols`, `profiles` and `anchorFormats`. The contract's `Capabilities` is a registry document with `protocol: attestation-registry/1`, `vscProfile`, `vscConformance` and `legacyIntake`, which the hosted demonstration registry serves. Serve the schema's document to conform; which document `GET /capabilities` answers with is not settled yet.

## Add storage and retrieval

Once validation works, add intake and exact-byte retrieval. Retain the secured representation and associate its identifier, subject and stored evidence. Test that retrieval returns what was retained before adding history, status or export operations.

Supply optional token history as request context when token checks are needed; it is not a field to add to the signed claim. Do not invent an anchor-script request field. For each supported operation, test malformed input, missing evidence and a valid input as separate cases.

Treat a registry archive as one recovery input. The reference archive does not contain token history, restricted evidence or keys. [Recovery](../../operate/export-import-recovery.md) explains how that affects provider replacement.

## Exact implementation sources

- [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/registry.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md)
- [spec/portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/portable-evidence.md)

To see your registry the way a stranger will, run `node examples/check-registry.mjs <your registry>`: it checks every record against the chain ([run an anchor proof page](attestation-verifier.md#run-an-anchor-proof-page)). Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
