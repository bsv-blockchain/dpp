# External credential verification

Select the credential profile before choosing a verifier. The World Wide Web Consortium (W3C) Verifiable Credentials data model and the selected proof suite are separate inputs.

| Integration task | Source |
|---|---|
| Select representation and suite | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/external-credential-profile.md) |
| Supply verification adapters | [Reference exchange API](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/vsc/src/exchange.ts) |
| Interpret the shared report | [Verification source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md) |
| Exercise the format | [Credential vectors](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/vectors/dpp/interoperability) |

Exact received bytes and proof verification remain separate results. A reformatted credential can require a different exact-byte finding even where its proof evaluates the same way. Use [the attestation verifier guide](../implement/roles/attestation-verifier.md) for the surrounding evidence workflow.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
