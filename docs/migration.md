# Migration

Identify the deployed release, stored record versions and selected profiles before changing a service. Use the [release records](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/release/dpp-release-2026-09-5.json) and [compatibility guide](learn/versions-and-compatibility.md) to separate those changes.

## Build an inventory

For each running component, record its package or application revision, service contract, selected industry and custody profiles, publisher policy and stored record versions. Retain the old configuration and a recoverable data copy before changing the service.

For example, a service may need to read old version 1 records while a writer begins version 2 records. Updating the reader first allows it to inspect both existing and newly created evidence. Changing a profile selection is a separate migration because the payload is interpreted under the declared profile version.

Run the reader, `node examples/verify-passport.mjs <passportId> <indexUrl>`, against a copy of the retained data restored into a scratch index ([export and recovery](operate/export-import-recovery.md)) with the old packages and then the new, and compare the results. An unchanged transaction should not silently acquire a different subject or a stronger assurance claim because the software changed.

## Rollout

For industry-profile changes, use [the consumer adoption guide](profiles/updating-applications.md) to prepare the change report, notify application owners and track UI/backend readiness. Installing a package and activating a successor are separate steps.

1. Rehearse against a copy of retained data and verify the existing history.
2. Deploy readers that support the intended record and profile selections.
3. Check index admission policy and the writer's selected formats.
4. Exercise writing, verification, export and recovery before switching live traffic.

The exact upgrade transition is defined in the [record model](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model-v2.md#L94-L114); acceptance is defined in the [managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/managed-custody.md).

## Rollback and retained evidence

Keep the pre-change deployment and a recoverable data copy. A software rollback does not undo published transactions. Check the older reader's supported formats before directing it at newer records.

Use [export and recovery](operate/export-import-recovery.md) to rehearse provider replacement. Industry-profile successors remain separate selections; [battery](profiles/battery.md) and [textile](profiles/textile.md) link their current and draft manifests.

The third release set changes the HTTP/export interface while retaining the on-chain record formats. The fifth, the beta.3 packages, keeps every wire format and changes what an operator checks: the first version of a publisher policy now governs the history before its own issue, synchronisation holds its checkpoint where an offered output did not arrive and leaves an output behind after five rounds, and `PUBLISHER_POLICY_JSON` carries a policy inline ([changelog](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/CHANGELOG.md), 27 September 2026). The October set, the beta.4 packages, keeps every wire format and changes nothing an operator checks: the index asks a synchronising peer for a predecessor only through the passport output once the overlay names the output its graph reached, and the profile readers refuse identifiers they do not publish. [Release history](reference/release-sets.md) links the exact declarations.
