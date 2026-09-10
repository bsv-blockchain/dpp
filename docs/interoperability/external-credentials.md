# External credential verification

Select the credential profile before choosing a verifier. The World Wide Web Consortium (W3C) Verifiable Credentials data model and the selected proof suite are separate inputs.

The [verifiable credential guide](../learn/verifiable-credentials.md) explains what a credential carries and which issuance and verification paths exist. [BSV DIDs](../learn/dids.md) explains issuer identity; this external profile specifically selects `did:web`.

## Prepare the verifier inputs

For the selected external representation, retain the credential's exact received bytes and the expected product identifier. Supply the issuer's identity/key documents, the required contexts, observation time and the policy for status and authority checks.

The reference profile uses a Data Integrity proof with the `ecdsa-rdfc-2019` suite and P-256 keys. The main VSC SEAL verifier is a different entry point. Passing a credential to whichever verifier happens to parse JSON is not representation selection.

`verifyExternalCredential` evaluates the credential checks; `externalCredentialVerifierFor` adapts them to the shared passport report. Missing status or authority sources can leave those findings unknown even when the proof itself verifies.

## Run the selected cases

After [setup](../quick-start.md#prepare-the-checkout), run:

```sh
npm run test -w @bsv/vsc -- test/exchange.test.ts test/exchange-vectors.test.ts
```

The tests use fixture documents and published test keys, including unsupported formats, altered proofs and missing evidence. Expect the selected cases to pass their assertions. This does not contact an issuer's live status service or perform a product assessment.

When connecting an application, retain exact-byte and proof results separately, and show the [per-check report](../learn/evidence-and-freshness.md). Live identity assurance is Ring 0; higher rings are absent.

## Source definitions

| Integration task | Source |
|---|---|
| Select representation and suite | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/external-credential-profile.md) |
| Supply verification adapters | [Reference exchange API](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/vsc/src/exchange.ts) |
| Interpret the shared report | [Verification source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md) |
| Exercise the format | [Credential vectors](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/vectors/dpp/interoperability) |

Exact received bytes and proof verification remain separate results. A reformatted credential can require a different exact-byte finding even where its proof evaluates the same way. Use [the attestation verifier guide](../implement/roles/attestation-verifier.md) for the surrounding evidence workflow.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
