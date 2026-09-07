# Specification index

The linked source revision holds the rules. Source disagreements remain listed in [the fixture guide](../implement/fixture-runner.md#source-gaps).

## Use the guides to start a task

The [model](../start/architecture.md) explains how passport records, claims and evidence services fit together. The [quick start](../quick-start.md) runs the reference implementation. The role guides then explain the inputs and work needed for an independent component.

The specification is the source for exact encoding and verification behaviour when implementing those components. Use the record model for state layout and transitions, the attestation rules for claims and anchors, and verification for the shared report. Custody and profiles add the selected policy and data requirements; service contracts define the HTTP exchange.

If a fixture disagrees with the text, retain the failing input and both readings. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists the known conflicts; the documentation does not silently choose a new rule.

## Exact source documents

| Source | Subject |
|---|---|
| [conformance.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) | Conformance: layers, roles, the baseline and the ledger |
| [custody.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/custody.md) | Custody arrangements |
| [design-rationale.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/design-rationale.md) | Design rationale |
| [epcis-interoperability.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/epcis-interoperability.md) | Electronic Product Code Information Services (EPCIS) exchange |
| [exchange.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/exchange.md) | Exchange profiles: credential representations beside the native record |
| [external-credential-profile.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/external-credential-profile.md) | External credential profile: vc-di-ecdsa-rdfc-2019@1 |
| [gs1-discovery.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/gs1-discovery.md) | GS1 discovery |
| [identity.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/identity.md) | Identity, control and application boundaries |
| [legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/legacy-uora-anchor-v3.md) | Historical native claims and anchor format |
| [managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/managed-custody.md) | Managed acceptance |
| [passport-projections.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/passport-projections.md) | Passport sources, projections and publication |
| [portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/portable-evidence.md) | Portable evidence |
| [profiles.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/profiles.md) | Profiles and identifiers |
| [record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md) | The record model, version 2 |
| [record-model.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md) | The record model |
| [rules.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md) | Attestations and complete-representation anchors |
| [services.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/services.md) | Service roles and verification boundaries |
| [verification.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md) | One verification contract |
| [vsc-profile.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/vsc-profile.md) | Verifiable Supply Chain (VSC) draft profile |
| [writing.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/writing.md) | Writing a state: the writer's lifecycle |

Use [contracts](contracts.md) for machine-readable interfaces and [conformance](conformance.md) for the requirement ledger.
