# Passport writer

Start with transaction construction and a wallet adapter. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [spec/writing.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/writing.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/custody.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/README.md)

## First exercise

Reproduce the selected positive record fixtures with their published test inputs. Run the refusal cases against the resulting records before attempting a service exchange.

The writer duties include behaviour that fixtures alone cannot demonstrate. Keep the writer self-report with the test evidence; mining time is unmeasured here.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.
