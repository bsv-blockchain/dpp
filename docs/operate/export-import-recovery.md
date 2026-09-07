# Export, import and recovery

An index export, a registry archive and retained private signing access are separate recovery inputs. Establish which source and snapshot each archive covers before replacing a provider.

| Recovering | Source |
|---|---|
| Index evidence within the package bound | [Package operation](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml), [package schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/evidence-package.schema.json) |
| Longer index history across parts | [Complete-export operation](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml), [part schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/evidence-export.schema.json) |
| Registry-held claims and associated evidence | [Registry export contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml) |
| Reference inspection and restore | [Package tests](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/test/evidenceExport.test.ts), [complete-export tests](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/test/evidenceExportParts.test.ts) |

Follow the [portable-evidence requirements](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/portable-evidence.md) and [exchange requirements](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/exchange.md) when validating and joining the archive. Re-import through the replacement service's normal intake, then compare the retained history and reports.

An export cannot recover a missing private key or evidence the source did not retain. The registry package has no token history or restricted material. A provider replacement can therefore need both archives and separately retained custody access.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) marks complete index export tested and durable independent publication gap. Its evidence is local and synthetic. [Migration](../migration.md) covers rollout and rollback.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
