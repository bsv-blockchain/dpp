# Registry

Start with storage, verification adapters and the service contract. Select this role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) and read the [role definition](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md).

## Implementation sources

- [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/services.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md)
- [spec/portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/portable-evidence.md)

## First exercise

Implement validation from the contract, then run the [validation request](../../quick-start.md#registry-validation) against that service. Add intake and exact-byte retrieval, then the selected history, status and export operations. Test each against the contract and its referenced evidence.

The validation contract accepts token history beside the claim; it supplies no caller-provided anchor-script field. The report source defines the no-independent-subject case. The reference registry archive has no token history, restricted evidence or keys.

Use [the fixture harness](../fixture-runner.md) and [evidence reporting](../reporting.md). [Source gaps](../fixture-runner.md#source-gaps) remain open. The [reference quick starts](../../quick-start.md) provide executable examples for package consumers.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
