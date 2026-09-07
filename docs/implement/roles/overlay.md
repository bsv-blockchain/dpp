# Overlay

Start with topic admission, storage and an HTTP service. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/services.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md)
- [spec/exchange.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/exchange.md)

## First exercise

Implement the selected contract and admission rules. Drive the service with the selected fixture transactions, then exercise lookup, proofs and export under the same policy.

Use operating guides only for the reference deployment. An independent overlay implements the contract and its own admission decisions.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.
