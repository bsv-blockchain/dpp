# Attestation issuer

Start with a signing adapter and retained claim evidence. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/identity.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/attestation-anchor-v1.json)

## First exercise

Read the unsigned claim and issuer key from the native fixture. Sign through the selected format, compare the resulting secured representation with the fixture, then submit it to the verifier.

An independent issuer implements the selected signing source without using the reference DPP function.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.
