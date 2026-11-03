# Verifiable credentials

Application teams can use this page to select and verify supported World Wide Web Consortium (W3C) credentials exchanged with partners. Native DPP builds use signed, anchored lifecycle claims and do not need W3C credentials; see [build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim".

## Before you start

| Task | Inputs and where they come from |
|---|---|
| Runtime | Node 22 or later; the package runs server side only. |
| Run exercises | Use the [checkout](../quick-start.md#get-the-code) root after `npm ci` and `npm run build`. Tests supply local identity documents and status evidence; no wallet or funds. |
| Issue a SEAL | Your event and product subject, issuer DID document, status entry and a signing key that document authorises for assertion. The suites need their own keys; a wallet's BSV key is not interchangeable. |
| Verify a credential | The received credential, contexts and issuer documents through a document loader, observation time, status policy and authority policy. For an external credential, retain its exact received bytes. |
| Bind the subject | Take the expected product identifier from your own request, never from the credential. |

## What a credential is

A verifiable credential (VC) names an issuer and subject and secures claims with a proof a recipient can check. Beside a digital product passport's (DPP) history, it can carry product assertions or lifecycle events, such as repairs.

A [DID](dids.md) identifies the issuer and leads to verification keys; the proof attributes its statement to a key. Acceptance still needs evidence and policy. A DID document establishes neither accreditation nor truth, and a passing proof does not raise identity assurance above [Ring 0](identity-and-authority.md#ring-0).

Native lifecycle claims and W3C credentials are different formats. Signing a native claim does not produce a credential, or vice versa.

## What the packages support

`@bsv/dpp-credentials` supports two representations, each with its own data model, proof suite, identity rules and entry point.

| Representation | What you can do | Entry point and functions | Ledger status |
|---|---|---|---|
| Verifiable Supply Chain (VSC) SEAL, profile `vsc-draft-compat/0.1.0` | Issue and verify, with `Ed25519Signature2020` or `bbs-2023` proofs | `@bsv/dpp-credentials`: `issueSealEd25519`, `issueSealBbs`, `verifySeal` | `tested`: rows `VSC-2-structure`, `VSC-3-proofs` |
| External passport credential, profile `vc-di-ecdsa-rdfc-2019@1` | Verify only, with `ecdsa-rdfc-2019` proofs; this profile has no issuance API | `@bsv/dpp-credentials/exchange`: `verifyExternalCredential`, and `externalCredentialVerifierFor` to feed the passport report | `tested`: rows `EXTC-1-representation`, `EXTC-5-registry-intake` |

The terms in that table:

- A **SEAL** is the credential the VSC profile uses to carry a signed supply chain event, its subjects and supporting references.
- **`Ed25519Signature2020`** is an Ed25519 signature over the credential's canonical form.
- **`bbs-2023`** is a BBS signature that lets a holder later present only some of the claims, through a derived proof bound to one presentation request. Proving that the presenter is the holder, and an HTTPS transport for presentations, are not implemented.
- **`ecdsa-rdfc-2019`** is an ECDSA signature with a P-256 key over the credential's canonical form. The external profile uses it with VC Data Model 2.0 and `did:web` issuers.

`verifyExternalCredential` comes from `@bsv/dpp-credentials/exchange`, not from the root entry point: importing it from `@bsv/dpp-credentials` gives `undefined`.

The ledger rows are in the [conformance ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json); [conformance and the ledger](../reference/conformance.md) explains how to read and check them.

## Run the credential exercises

1. Run both exercises from the prepared checkout:

```sh
npm run test -w @bsv/dpp-credentials -- test/crypto.test.ts test/verification.test.ts
npm run test -w @bsv/dpp-credentials -- test/exchange.test.ts test/exchange-vectors.test.ts
```

| Command above | Coverage | Expected result |
|---|---|---|
| First | SEAL issuance, proof verification and evidence checks | `Tests  20 passed (20)` |
| Second | External credentials: valid, altered, expired, revoked and unsupported | `Tests  60 passed (60)` |

Passing tests include refusals of deliberately invalid inputs.

2. From the same directory, run `node examples/verify-external-credential.mjs`:

```sh
node examples/verify-external-credential.mjs
```

| Local input | Expected finding |
|---|---|
| Original external credential supplied by the example | Every check prints `Holds:`, one line per check. |
| Copy with one subject value changed | on the altered copy `proof` prints `FAILS:`, as it should, and the command still exits with status 0. |

## Connect an issuer or verifier

1. Install [@bsv/dpp-credentials](../packages/dpp-credentials.md) at its exact version: `npm install --save-exact @bsv/dpp-credentials@0.2.0-beta.6`.
2. **Issue a SEAL:** pass the prepared issuance inputs to `issueSealEd25519` or `issueSealBbs` from `@bsv/dpp-credentials`. The [package guide](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/README.md#issuance-and-verification) shows the call with its document loader and policies.
3. **Verify a SEAL:** call `verifySeal` from `@bsv/dpp-credentials` with the credential and verification inputs above.
4. **Verify an external credential:** pass the retained bytes to `verifyExternalCredential` from `@bsv/dpp-credentials/exchange`. [External credential verification](../interoperability/external-credentials.md) supplies the complete call, policy and vector mapping.
5. **Include it in a passport report:** pass exact bytes as `externalCredentials` evidence to `verifyPassportEvidence`. Supply a policy `credentialVerifier` made with `externalCredentialVerifierFor` from `@bsv/dpp-credentials/exchange`.

Read proof, issuer authority, subject binding, time and status separately. Stop short of claiming verification for a finding left `unknown` by missing status or authority evidence, even if the proof passes ([evidence and its limits](evidence-and-freshness.md)). Anchor only the original secured bytes: a derived presentation or reformatted copy has different bytes and a different commitment.

## Not in the packages

The reference application, whose source is not public, issues and verifies compact JSON Web Signature (JWS) credentials using an injected ES256K signer (ledger row `EXCH-4-signer`, `tested`). The signer is absent from published packages and does not close the gaps below.

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
| Building with the packages | [@bsv/dpp-credentials](../packages/dpp-credentials.md), then [gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence) to add credentials to a report |
| Implementing a verifier yourself | [Attestation verifier](../implement/roles/attestation-verifier.md) |
