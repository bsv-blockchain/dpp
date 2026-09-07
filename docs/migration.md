# Migration

Identify the deployed release, stored record versions and selected profiles before changing a service. Use the [release records](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/release/dpp-release-2026-09-3.json) and [compatibility guide](learn/versions-and-compatibility.md) to separate those changes.

## Rollout

1. Rehearse against a copy of retained data and verify the existing history.
2. Deploy readers that support the intended record and profile selections.
3. Check index admission policy and the writer's selected formats.
4. Exercise writing, verification, export and recovery before switching live traffic.

The exact upgrade transition is defined in the [record model](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md#L94-L114); acceptance is defined in the [managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/managed-custody.md).

## Rollback and retained evidence

Keep the pre-change deployment and a recoverable data copy. A software rollback does not undo published transactions. Check the older reader's supported formats before directing it at newer records.

Use [export and recovery](operate/export-import-recovery.md) to rehearse provider replacement. Industry-profile successors remain separate selections; [battery](profiles/battery.md) and [textile](profiles/textile.md) link their current and draft manifests.

The third release set changes the HTTP/export interface while retaining the on-chain record formats. [Release history](reference/release-sets.md) links the exact declarations.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
