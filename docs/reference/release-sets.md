# Release sets

A release set is a declared combination of packages, interfaces, profiles and conformance selection. It gives an integrator a reproducible compatibility target. It is separate from a particular application's deployment or a public package publication.

## Install and record a candidate

Follow [package installation](../packages/README.md) to build candidate tarballs and exercise them in a clean consumer. Keep `release/candidates.json`, the produced artefact digests and the consuming application's lockfile. Together they identify the actual bytes installed.

Before replacing a service, compare its capability document with the selection the client expects. Use [migration](../migration.md) to rehearse the change against retained data. A successful package build does not establish that a running operator has upgraded.

## Declared sets

| Set | Source state |
|---|---|
| [dpp-release-2026-09](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09.json) | Superseded |
| [dpp-release-2026-09-2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-2.json) | Superseded |
| [dpp-release-2026-09-3](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-3.json) | Candidate |

Each record links package versions, interfaces, profiles and its conformance selection. The [support table](../packages/support-table.md) is generated from the selected record. Historical declarations remain in the earlier records.

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/README.md) produces a candidate record containing the source revision and artefact digests. A release-set name alone is not that source revision. [Package installation](../packages/README.md#source-access) gives the reviewed source snapshot; [the implementer start](../implement/README.md) identifies the bundle manifest.

Repository publication remains open. Source links and candidate-generation instructions do not announce a public package release.
