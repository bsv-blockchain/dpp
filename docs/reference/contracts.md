# Contracts and schemas

Use the service contract for its request, response and error definitions. The report and data schemas are separate interfaces.

| Source |
|---|
| [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml) |
| [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml) |
| [contracts/interoperability.yaml](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/interoperability.yaml) |
| [contracts/verification-report.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/verification-report.schema.json) |
| [contracts/capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/capabilities.schema.json) |
| [contracts/publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/publisher-policy.schema.json) |
| [contracts/paginated-history.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/paginated-history.schema.json) |
| [contracts/evidence-package.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/evidence-package.schema.json) |
| [contracts/evidence-export.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/evidence-export.schema.json) |
| [contracts/native-evidence-extension.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/native-evidence-extension.schema.json) |
| [contracts/epcis-import.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/epcis-import.schema.json) |
| [contracts/passport-source.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/passport-source.schema.json) |
| [contracts/passport-projection.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/passport-projection.schema.json) |
| [contracts/profile-evidence.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/profile-evidence.schema.json) |
| [release/release-set.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/release/release-set.schema.json) |
| [conformance/manifest.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.schema.json) |
| [conformance/baseline.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline.schema.json) |
| [conformance/selection.schema.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/selection.schema.json) |
| [packages/dpp-profiles/schemas](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas) |

For implementation workflow, see [registry](../implement/roles/registry.md), [overlay](../implement/roles/overlay.md) and [interoperability](../interoperability/README.md). [Native validation](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml#L781-L831) defines the request-context option and supplied token history.
