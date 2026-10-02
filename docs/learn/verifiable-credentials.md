# Verifiable credentials

Use this page if a partner asks you for World Wide Web Consortium (W3C) verifiable credentials, or sends you some to check. A native DPP build does not need them: it signs and anchors native lifecycle claims instead, as [build an application](../packages/build-an-application.md) shows in "Sign and anchor a lifecycle claim".

## What a credential is

A verifiable credential (VC) is an issuer's statement secured by a proof that a recipient can check. It names the issuer and the subject and carries claims about that subject. In a digital product passport (DPP) a credential can carry a product assertion or a lifecycle event, such as a repair, beside the passport's own history.

A [DID](dids.md) identifies the issuer and leads to its verification keys. The credential carries what that issuer says, and the proof attributes the statement to a key. Whether to accept the statement is a separate decision, made on evidence and policy: a DID document alone does not establish accreditation or the truth of a claim, and a passing proof does not raise identity assurance above [Ring 0](identity-and-authority.md#ring-0).

A native lifecycle claim is a different format. Signing one does not produce a W3C credential, and a credential is not a native claim.

## What the packages support

`@bsv/vsc` implements two credential representations. Each selects its own data model, proof suite and identity rules, and each has its own entry point.

| Representation | What you can do | Entry point and functions | Ledger status |
|---|---|---|---|
| Verifiable Supply Chain (VSC) SEAL, profile `vsc-draft-compat/0.1.0` | Issue and verify, with `Ed25519Signature2020` or `bbs-2023` proofs | `@bsv/vsc`: `issueSealEd25519`, `issueSealBbs`, `verifySeal` | `tested`: rows `VSC-2-structure`, `VSC-3-proofs` |
| External passport credential, profile `vc-di-ecdsa-rdfc-2019@1` | Verify only, with `ecdsa-rdfc-2019` proofs; this profile has no issuance API | `@bsv/vsc/exchange`: `verifyExternalCredential`, and `externalCredentialVerifierFor` to feed the passport report | `tested`: rows `EXTC-1-representation`, `EXTC-5-registry-intake` |

The terms in that table:

- A **SEAL** is the credential the VSC profile uses to carry a signed supply chain event, its subjects and supporting references.
- **`Ed25519Signature2020`** is an Ed25519 signature over the credential's canonical form.
- **`bbs-2023`** is a BBS signature that lets a holder later present only some of the claims, through a derived proof bound to one presentation request. Proving that the presenter is the holder, and an HTTPS transport for presentations, are not implemented.
- **`ecdsa-rdfc-2019`** is an ECDSA signature with a P-256 key over the credential's canonical form. The external profile uses it with VC Data Model 2.0 and `did:web` issuers.

`verifyExternalCredential` comes from `@bsv/vsc/exchange`, not from the root entry point: importing it from `@bsv/vsc` gives `undefined`.

The ledger rows are in the [conformance ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json); [conformance and the ledger](../reference/conformance.md) explains how to read and check them.

## Run the credential exercises

From the root of a checkout, after `npm ci` and `npm run build` ([quick start](../quick-start.md#get-the-code)):

```sh
npm run test -w @bsv/vsc -- test/crypto.test.ts test/verification.test.ts
npm run test -w @bsv/vsc -- test/exchange.test.ts test/exchange-vectors.test.ts
```

The first command exercises SEAL issuance, proof verification and the evidence checks, and ends `Tests  20 passed (20)`. The second exercises the external profile with valid, altered, expired, revoked and unsupported credentials, and ends `Tests  60 passed (60)`. The tests supply identity documents and status evidence locally, and the passes include refusals of deliberately invalid inputs. No wallet or funds are needed.

`node examples/verify-external-credential.mjs`, from the same place, verifies one external credential and a copy with one subject value changed, one line per check. Every check on the original prints `Holds:`; on the altered copy `proof` prints `FAILS:`, as it should, and the command still exits with status 0.

## Connect an issuer or verifier

1. Install the package at its exact version: `npm install --save-exact @bsv/vsc@0.2.0-beta.4`. It runs on Node 22 or later, server side only ([@bsv/vsc](../packages/vsc.md)).
2. **To issue a SEAL**, prepare the event, the product subject, the issuer's DID document, a status entry and a signing key the DID document authorises for assertion. Call `issueSealEd25519` or `issueSealBbs` from `@bsv/vsc`. These suites use their own keys: your wallet's BSV key is not an interchangeable input. The [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/vsc/README.md#issuance-and-verification) shows the call with its document loader and policies.
3. **To verify a SEAL**, call `verifySeal` from `@bsv/vsc` with the credential, a document loader for the contexts and the issuer's documents, the observation time, a status policy and an authority policy.
4. **To verify an external credential**, keep the exact bytes you received and call `verifyExternalCredential` from `@bsv/vsc/exchange`. [External credential verification](../interoperability/external-credentials.md) has the complete call with its policy, and how to map the vector file onto it.
5. **To show the result in a passport report**, pass the credential's exact bytes in the `externalCredentials` evidence of `verifyPassportEvidence`, and give its policy a `credentialVerifier` made with `externalCredentialVerifierFor` from `@bsv/vsc/exchange`.

Whichever you verify, take the expected product identifier from your own request, not from the credential, and read proof, issuer authority, subject binding, time and status as separate findings. Missing status or authority evidence leaves a finding `unknown` even when the proof verifies ([evidence and its limits](evidence-and-freshness.md)). If you anchor a credential, anchor the original secured bytes: a derived presentation or a reformatted copy is a different byte sequence and a different commitment.

## Not in the packages

The reference application, whose source is not public, also issues and verifies compact JSON Web Signature (JWS) credentials with ES256K through a signer it injects. That signer is part of the reference application, not of the published packages (ledger row `EXCH-4-signer`, `tested`), and it does not close the gaps below.

## What remains incomplete

| Capability | Ledger status and remaining work |
|---|---|
| The exact upstream VSC context and its test suite | `unassessed` (rows `VSC-context-upstream`, `VSC-conformance-suite`): the reviewed upstream context and an executable suite are unavailable, so the package uses its own declared context |
| United Nations Transparency Protocol (UNTP) 0.7.0 passport | `gap` (row `UNTP-0.7.0-dpp`): an application pilot exists, but its credential still lacks the pinned UNTP context, terms and issuing-software block and does not validate against the pinned schema |
| UNTP traceability event | `gap` (row `UNTP-0.7.0-dte`): no event export exists, and the mapping needs actual event evidence |
| An optional ES256 application signer | Not implemented; the tested ES256K signer does not provide it (row `EXCH-4-signer`) |

The [VSC profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/vsc-profile.md) and the [external credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) define the two representations. The BSV DID method does not replace the DID method, proof purpose or curve a profile selects.

## Next

| You are | Go to |
|---|---|
| Verifying a partner's credential | [External credential verification](../interoperability/external-credentials.md) |
| Building with the packages | [@bsv/vsc](../packages/vsc.md), then [gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence) to add credentials to a report |
| Implementing a verifier yourself | [Attestation verifier](../implement/roles/attestation-verifier.md) |
