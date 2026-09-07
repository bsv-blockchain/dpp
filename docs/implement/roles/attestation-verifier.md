# Attestation verifier

Start with claim and anchor inputs, plus verification policy. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/identity.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/attestation-anchor-v1.json)

## First exercise

Use the selected claim and anchor fixtures, then the report cases that combine them. Keep the expected subject separate from the evidence being tested.

Key attribution, issuer authority and transaction inclusion are separate evidence questions.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
