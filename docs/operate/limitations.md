# Known limitations

Read these before deploying the reference service. Sources: [conformance/manifest.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json), [conformance/examples/capabilities-reference-node.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/examples/capabilities-reference-node.json).

| Limit | Consequence and source |
|---|---|
| Later proofs for already-held outputs are not refreshed by peer synchronisation | Supply the proof to each affected operator; [federation tests](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/test/federation.test.ts#L240-L285) distinguish this from new states carrying proofs. |
| Synchronisation covers current outputs and their lineages | Use [exports](export-import-recovery.md) for the separately retained evidence. |
| Cursors are per process | A restart or a different replica can invalidate a cursor; [history implementation](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/history.ts). |
| The package route is bounded | Use the complete-export route for longer histories; [capability limits](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/examples/capabilities-reference-node.json). |
| A refused tip spend affects peer availability | The record store retains the lineage, but engine tip availability has a separate limit; [retraction tests](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/test/retract.test.ts). |
| The local scripts-only setting skips header verification | It cannot supply verified inclusion; [host configuration](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/index.ts). |
| The host does not advertise service discovery | Configure discovery separately; [capability exclusions](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/examples/capabilities-reference-node.json). |
| Durable independent publication has ledger status `gap` | No independently administered replica is demonstrated; [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L3769). |
| Registry export is a scoped archive | It has no token history, restricted evidence or keys; [registry guide](../implement/roles/registry.md). |

Hosting of the reference index: open; today it is a standalone container reached by its URL. Local peer tests do not establish independent operation.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
