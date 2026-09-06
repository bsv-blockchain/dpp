# Service contracts and errors

**Audience:** implementers and consumers of the index, registry and application interoperability services. **Canonical sources:** [`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/overlay.yaml) 0.7.0-draft, [`contracts/registry.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/registry.yaml) 0.2.0, [`contracts/interoperability.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/interoperability.yaml) 0.1.0-draft, and the JSON schemas under `contracts/`.

The contracts are OpenAPI documents kept canonical in Git and never restated here. What follows is how they fit together and the error vocabulary they share.

## The overlay contract

| Route | Wire | Purpose |
|---|---|---|
| `POST /submit` | BRC-22 | Announce a BEEF to named topics; `X-Admission` answers `admitted`, `duplicate` or `none` |
| `POST /lookup` | BRC-24 | Query `ls_dpp`, `ls_attestation` or the historical service by exact selector; answers carry each state's own bytes and proof |
| `POST /arc-ingest` | Proof push | A merkle path for a held transaction, verified against the header source before storage |
| `GET /health`, the documentation routes | | The topics and services served |
| `GET /capabilities` | `capabilities.schema.json` | The capability document |
| `GET /history` | `paginated-history.schema.json` | Pages over a stable snapshot; `cursor-invalid` (400), `snapshot-expired` (410) |
| `GET /evidence-package` | `evidence-package.schema.json` | The bounded signed package; `export-unavailable` (503) |
| `GET /evidence-export` | `evidence-export.schema.json` | The complete export, one part per request; `export-unauthorised` (401) when a bearer is required |
| `POST /retract` | | Withdraw an admitted output; `retraction-refused` (409), `chain-tracker-unavailable` (503) |
| `POST /requestSyncResponse`, `POST /requestForeignGASPNode` | GASP | What a synchronising peer reads |

## The registry contract

Intake (`POST /attestations`) with explicit representation selection and named refusal outcomes (422) and duplicates (409); `POST /validate` answering under a `contract` discriminator with the verification report; `GET /attestations/{id}/report`; proof and history routes paged over a snapshot; the evidence package export per passport; status list publication and retrieval; certifications; the profile documents; the hosted GS1 resolver routes when a resolver origin is configured; and `GET /capabilities` with the registry's readiness statements under `unsupported`. The reference registry checks the document against its router in both directions, and an independent registry should do the same.

## The interoperability contract

The application's routes for EPCIS imports, pulls, publication of a mapped event, source export, passport projections and model revisions. No route performs a token operation; an import is a data operation and a transfer still needs the passport service and the recipient's acceptance.

## Error vocabulary

Errors are named, never numeric alone. The verification report's shared reason codes are the vocabulary for every check outcome (`decode-failed`, `signature-invalid`, `link-broken`, `proof-absent`, `representation-unsupported`, `policy-missing` and the rest, listed in `contracts/verification-report.schema.json`); an implementation-specific code begins with `x-`. Service errors carry a code in the body (`cursor-invalid`, `snapshot-expired`, `export-unavailable`, `export-unauthorised`, `retraction-refused`) beside the HTTP status. A named result blocks what depended on it and never degrades silently: an unsupported required proof, profile or extension is `representation-unsupported`, `suite-unsupported` or `not-selected`, not a weaker check.

## Where the contracts leave room

The archive form of an evidence package, the bounds of an export part, whether the complete export is authenticated, the storage behind a snapshot, the bearer scheme, and the host and port are a build's own. The capability document is where a build states its choices, and a client reads it before assuming a limit.
