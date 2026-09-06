# @bsv/dpp-overlay-topics

**Audience:** operators and developers embedding or running an index. **Version in the current set:** 0.4.0. **Runtime:** Node 22 or later, server only (`node:crypto`, `node:fs`, `node:http`, MongoDB driver). **Runtime dependencies:** `@bsv/dpp-core` ^0.3.0, `@bsv/overlay` 2.3.1, `@bsv/sdk` 2.4.2, `mongodb` ^7.0.0. **Canonical sources:** [`packages/overlay-topics/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/overlay-topics/README.md), [`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/overlay.yaml) 0.7.0-draft, [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §2.

The index, as a library and as a service. Importing the package never starts a server: the specifier gives you the topic managers, lookup services, storage adapters and the helpers behind the extension routes, and the HTTP host is reached by path (`node dist/index.js`, the image's command) and never by import.

## As a library

| Export | What it is |
|---|---|
| `DppTopicManager`, `DppLookupService` | `tm_dpp` and `ls_dpp`: passport admission under the record rules and the configured custody policy, and lookup by passport identifier or outpoint |
| `AttestationTopicManager`, `AttestationLookupService` | `tm_attestation` and `ls_attestation`: admission of `bsv-attestation-anchor-v1` outputs by exact script, framed signature and key derivation; lookup by exact selector with an outpoint cursor |
| `UoraAnchorTopicManager`, `UoraAnchorLookupService` | The historical `tm_uora_dpp` and `ls_uora_dpp`, separately named and never aliased |
| `InMemoryDppStorage`, `MongoDppStorage`, the attestation and anchor stores, `InMemoryOverlayStorage`, `MongoOverlayStorage` | The record stores with insertion sequences, and the engine storage with the retraction hook |
| `buildCapabilities` | The capability document from constants and configuration |
| The history, evidence export, retraction, policy configuration and synchronisation modules | The logic behind `GET /history`, `GET /evidence-package`, `GET /evidence-export` (with `joinEvidenceExport` and `inspectEvidenceExportPart` for the reader's side), `POST /retract`, `PUBLISHER_POLICY_FILE` and `SYNC_PEERS` |

The reference application runs both components in process against the in-memory storage for its offline mode and tests; that is the smallest embedding.

## As a service

The host speaks the ecosystem's wire (`POST /submit`, `POST /lookup`, `POST /arc-ingest`, `GET /health`, the documentation routes), the five extension routes the contract documents, and the two GASP routes a peer reads. Configuration is environment only; the package README's table names every variable, what it does when set and what happens when it is not. The image builds from the repository root and the [operator preset](../operate/README.md) runs it beside a MongoDB.

## What it holds and what it says

The index admits, indexes and serves. It does not broadcast; the writers' wallets do. It verifies every pushed proof against its header source before storing it. It answers admission (`admitted`, `duplicate`, `none`) and that answer is neither network acceptance nor inclusion. A refused spend of a tip keeps the tip and its lineage. Its capability document names, from configuration, which custody profile it admits, whether it exports, whether it synchronises, its limits, and by name what it does not do.

## Known boundaries

Stated in full in the package README and on [known limitations](../operate/limitations.md): synchronisation carries current outputs and their lineages, not every historical artefact; a proof that reaches one operator does not travel to another through GASP; an unproven state announced during a partition synchronises once its proof reaches the source; history cursors are per process; the bounded package is capped at 500 states and the complete export exists for the rest; two nodes under one administration prove the mechanism and never independence.

## Independence note

An independent overlay implementation serves the same contract without this package: the same routes, the same admission rules, the same capability document shape, the same refusal names. The contract file and the overlay's test targets are what hold it; [the overlay role guide](../implement/roles/overlay.md) says which.
