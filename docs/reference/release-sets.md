# Release sets

A release set is a declared combination of packages, interfaces, profiles and conformance selection. It gives an integrator a reproducible compatibility target. It is separate from a particular application's deployment or a public package publication.

## Install and record a candidate

Follow [package installation](../packages/README.md) to build candidate tarballs and exercise them in a clean consumer. Keep `release/candidates.json`, the produced artefact digests and the consuming application's lockfile. Together they identify the actual bytes installed.

Before replacing a service, compare its capability document with the selection the client expects. Use [migration](../migration.md) to rehearse the change against retained data. A successful package build does not establish that a running operator has upgraded.

## Declared sets

| Set | Source state |
|---|---|
| [dpp-release-2026-09](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09.json) | Superseded |
| [dpp-release-2026-09-2](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09-2.json) | Superseded |
| [dpp-release-2026-09-3](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09-3.json) | Superseded |

The current candidate is `dpp-release-2026-09-4`, declared in `release/dpp-release-2026-09-4.json` in the release checkout. It adds the version 4 profile drafts and updated dependencies through beta.2 versions of all four packages. [Publishing profile updates](publishing-profile-updates.md) walks through preparation, approval and verification.

Each record links package versions, interfaces, profiles and its conformance selection. The [support table](../packages/support-table.md) is generated from the selected record. Historical declarations remain in the earlier records.

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/README.md) produces a candidate record containing the source revision and artefact digests. A release-set name alone is not that source revision. [Package installation](../packages/README.md#source-access) gives the reviewed source snapshot; [the implementer start](../implement/README.md) identifies the bundle manifest.

The source repository is public and the initial beta.1 packages are available from npm. Publication of the beta.2 candidate set remains pending. Source links and candidate-generation instructions do not announce that update as published.

## Experimental package compatibility

The first public npm releases use `-beta.1` versions and the `next` tag. Pin exact versions and retain the consuming application lockfile. APIs may change significantly during testing; review release notes before upgrading. Published package versions are immutable, so each change requires a new version.

Package prerelease versions are separate from specification, wire-format and frozen profile versions. Compare the selected release declaration and operator capabilities before testing interoperability. Installing these packages establishes neither live interoperability nor production readiness.
