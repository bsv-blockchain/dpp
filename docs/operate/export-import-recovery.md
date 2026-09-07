# Export, import and recovery

An index export, a registry archive and retained private signing access are separate recovery inputs. Establish which source and snapshot each archive covers before replacing a provider.

## Retrieve the right archive

For the reference index, configure `EXPORT_SIGNING_KEY` as a separate private key for signing export manifests. Configure `EXPORT_TOKEN` for access to complete exports. Neither setting replaces the publisher key used for record admission.

Use `GET /evidence-package` for the bounded package and `GET /evidence-export` when the full history needs several parts. Both take the passport identifier. The complete-export response supplies the cursor used for the next part; keep the snapshot and coverage information with every part.

The history listing alone is not an archive of transaction bytes. A bounded lookup can omit earlier history. Do not infer complete retention from either returning a successful response.

## Rehearse a replacement

1. Obtain and retain the archive, its manifest and the operator key expected to sign it.
2. Check the inventory, file digests and manifest signature. For a multipart export, check coverage before joining the parts; missing or repeated parts remain an error.
3. Supply the replacement index with the intended publisher policy. Submit retained transaction evidence in predecessor order through normal admission.
4. Retrieve it from the replacement and run the reader again. Compare the history and per-check reports while the original provider is unavailable.

If a cursor expires or the service restarts, begin a new export snapshot. Mixing parts from different snapshots can create an archive that was never complete at either point.

Keep registry claims, restricted documents and signing access in the recovery plan separately. Restoring publicly retrievable evidence does not restore the ability to spend or update the passport.

## Exact archive interfaces

| Recovering | Source |
|---|---|
| Index evidence within the package bound | [Package operation](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml), [package schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/evidence-package.schema.json) |
| Longer index history across parts | [Complete-export operation](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml), [part schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/evidence-export.schema.json) |
| Registry-held claims and associated evidence | [Registry export contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml) |
| Reference inspection and restore | [Package tests](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/test/evidenceExport.test.ts), [complete-export tests](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/test/evidenceExportParts.test.ts) |

Follow the [portable-evidence requirements](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/portable-evidence.md) and [exchange requirements](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/exchange.md) when validating and joining the archive. Re-import through the replacement service's normal intake, then compare the retained history and reports.

An export cannot recover a missing private key or evidence the source did not retain. The registry package has no token history or restricted material. A provider replacement can therefore need both archives and separately retained custody access.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) marks complete index export tested and durable independent publication gap. Its evidence is local and synthetic. [Migration](../migration.md) covers rollout and rollback.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
