# Passport reader

Start with transaction and proof handling. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/README.md)

## First exercise

Decode the record and exercise supplied-history verification with the selected positive and refusal cases. Compare the report with the report fixtures.

A report needs an independently supplied subject and explicit evidence sources; the report source also defines the case where no independent expectation is available.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
