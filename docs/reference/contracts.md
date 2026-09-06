# Contracts and schemas

Machine-readable interfaces, canonical in Git. Any rendering elsewhere identifies the same revision and is checked for drift.

| File | Version | What it fixes |
|---|---|---|
| [`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/overlay.yaml) | 0.7.0-draft | The index's HTTP surface: the ecosystem wire, the five extension routes and the two synchronisation routes, with the admission rules under `x-dpp-profile` |
| [`contracts/registry.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/registry.yaml) | 0.2.0 | The registry's HTTP surface, machine-checked against the reference registry's router |
| [`contracts/interoperability.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/interoperability.yaml) | 0.1.0-draft | The application's routes for EPCIS imports, pulls, publication, source export, projections and model revisions |
| [`contracts/verification-report.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/verification-report.schema.json) | report 1 | The report, its sixteen check names in order and the shared reason codes |
| [`contracts/capabilities.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/capabilities.schema.json) | | The capability document |
| [`contracts/publisher-policy.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/publisher-policy.schema.json) | `dpp-publisher-policy@1` | The versioned publisher key set |
| [`contracts/paginated-history.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/paginated-history.schema.json) | | Pages over a snapshot |
| [`contracts/evidence-package.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/evidence-package.schema.json) | `dpp-evidence-package@1` | The signed package manifest |
| [`contracts/evidence-export.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/evidence-export.schema.json) | `dpp-evidence-export@1` | The complete export part and its coverage record |
| [`contracts/native-evidence-extension.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/native-evidence-extension.schema.json) | `urn:bsv:dpp:native-evidence:1` | How an external credential references native evidence |
| [`contracts/epcis-import.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/epcis-import.schema.json) | | The durable EPCIS import record |
| [`contracts/passport-source.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/passport-source.schema.json) | | Source revisions and relationships |
| [`contracts/passport-projection.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/passport-projection.schema.json) | `passport-projection@1` | The projection envelope |
| [`contracts/profile-evidence.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/profile-evidence.schema.json) | | The shared evidence, measurement, certification, document, language and date shapes |
| [`release/release-set.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/release/release-set.schema.json) | | The release set, including the support declaration of every entry point |
| [`conformance/manifest.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/manifest.schema.json), [`conformance/baseline.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/baseline.schema.json), [`conformance/selection.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/selection.schema.json) | | The ledger, a baseline and a selection |
| The profiles package's schemas | | The manifest schemas, product identity, exchange, operator and interoperability profile schemas, and the pinned GS1 resolver schemas, under `packages/dpp-profiles/schemas/` |
