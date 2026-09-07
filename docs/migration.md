# Migration

Identify the deployed release, stored record versions and selected profiles before changing a service. Use the [release records](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-3.json) and [compatibility guide](learn/versions-and-compatibility.md) to separate those changes.

## Build an inventory

For each running component, record its package or application revision, service contract, selected industry and custody profiles, publisher policy and stored record versions. Retain the old configuration and a recoverable data copy before changing the service.

For example, a service may need to read old version 1 records while a writer begins version 2 records. Updating the reader first allows it to inspect both existing and newly created evidence. Changing a profile selection is a separate migration because the payload is interpreted under the declared profile version.

Use the fixture reader and a copy of retained deployment data to compare results before and after the change. An unchanged transaction should not silently acquire a different subject or a stronger assurance claim because the software changed.

## Rollout

1. Rehearse against a copy of retained data and verify the existing history.
2. Deploy readers that support the intended record and profile selections.
3. Check index admission policy and the writer's selected formats.
4. Exercise writing, verification, export and recovery before switching live traffic.

The exact upgrade transition is defined in the [record model](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md#L94-L114); acceptance is defined in the [managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/managed-custody.md).

## Rollback and retained evidence

Keep the pre-change deployment and a recoverable data copy. A software rollback does not undo published transactions. Check the older reader's supported formats before directing it at newer records.

Use [export and recovery](operate/export-import-recovery.md) to rehearse provider replacement. Industry-profile successors remain separate selections; [battery](profiles/battery.md) and [textile](profiles/textile.md) link their current and draft manifests.

The third release set changes the HTTP/export interface while retaining the on-chain record formats. [Release history](reference/release-sets.md) links the exact declarations.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
