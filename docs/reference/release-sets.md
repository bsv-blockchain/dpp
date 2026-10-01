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
| [dpp-release-2026-09-4](https://github.com/bsv-blockchain/dpp/blob/f54e750de4c7731a30563e5f1caad762adbfb737/release/dpp-release-2026-09-4.json) | Superseded; its beta.2 packages are published |
| [dpp-release-2026-09-5](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/release/dpp-release-2026-09-5.json) | Superseded; its beta.3 packages are published |

The current set is `dpp-release-2026-10`, declared in `release/dpp-release-2026-10.json`, a candidate whose packages are not yet published. Its overlay topics package asks a synchronising peer for a predecessor only through the passport output, once the overlay names the output its graph reached, and its profiles package refuses identifiers it does not publish; all four packages take new versions because each package's documentation changed. [Publishing profile updates](publishing-profile-updates.md) walks through preparation, approval and verification.

The beta.3 packages of the preceding set, `dpp-release-2026-09-5`, were published under `next` on 27 September 2026, with the VSC package unchanged at beta.2. The [publication receipt](beta-3-publication.md) records the exact approved plan, source revision, archive digests and successful registry consumer check. That set is now marked superseded; the approved plan bound its JSON as it stood at source revision `921a1d36e6a1888ef0d1b08aaf2cf7df54525d81`, and the plan is reproduced from that revision.

The four beta.2 packages of `dpp-release-2026-09-4` were published under `next` on 18 September 2026. The [publication receipt](beta-2-publication.md) records the exact approved plan, source revision, archive digests and successful registry consumer check. That set is now marked superseded; the approved plan bound its JSON as it stood at source revision `f54e750de4c7731a30563e5f1caad762adbfb737`, and the plan is reproduced from that revision. No transition to broader release readiness or promotion of the draft industry profiles is made here.

Each record links package versions, interfaces, profiles and its conformance selection. The [support table](../packages/support-table.md) is generated from the selected record. Historical declarations remain in the earlier records.

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/release/README.md) produces a candidate record containing the source revision and artefact digests. A release-set name alone is not that source revision. [Package installation](../packages/README.md#source-access) gives the reviewed source snapshot; [the implementer start](../implement/README.md) identifies the bundle manifest.

The source repository and the npm packages are public. The beta.3 publication moved `next` to beta.3 for core, overlay topics and profiles, left the VSC package at beta.2 and left `latest` at beta.1. Consumer applications must adopt the packages and activate any successor profiles separately.

## Experimental package compatibility

The published experimental npm releases use `-beta.3` versions for core, overlay topics and profiles and `-beta.2` for the VSC package, under the `next` tag; the current candidate uses `-beta.4` for the first three and `-beta.3` for the VSC package. Pin exact versions and retain the consuming application lockfile. APIs may change significantly during testing; review release notes before upgrading. Published package versions are immutable, so each change requires a new version.

Package prerelease versions are separate from specification, wire-format and frozen profile versions. Compare the selected release declaration and operator capabilities before testing interoperability. Installing these packages establishes neither live interoperability nor production readiness.
