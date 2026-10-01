# Overlay

An overlay is an index for selected blockchain records. It admits transactions under its topic rules, stores the admitted evidence and answers lookups. It lets a reader find passport records without scanning the whole blockchain. It does not broadcast transactions or make a lookup response a verification result.

## Run the reference service

Use [Run a service](../../operate/README.md) for the Docker Compose setup. It starts the index and its MongoDB database, explains the required settings and checks `/health` and `/capabilities`.

An empty, healthy index has no passport history to return. The [lookup example](../../reference/contracts.md#find-passport-records) makes a request; admission of suitable records must be exercised separately before expecting populated results.

## Build an independent overlay

Implement topic admission and persistent storage before adding peer synchronisation. Admission evaluates both the record and the operator's selected publisher/custody policy. Keep the decision distinct from the HTTP transport status and the transaction's network status.

Cover both topics, `tm_dpp` for passport states and `tm_attestation` for anchors. The native baseline's overlay role requires `SVC-2-passport-admission`, `SVC-2-version-2-admission`, `SVC-2-anchor-admission`, `SVC-2-cursor-lookup`, `SVC-2-proof-ingest`, `SVC-6-idempotent-admission` and `OVL-contract-must`.

Exercise submission, lookup and proof ingestion with the same admitted transaction. A later proof update must remain associated with the correct record. Test duplicates and refused records, then restart the service and repeat the lookup.

The fixtures let you start offline. Their states are raw transactions that are not mined, so wrap each in a BEEF with the states before it and check admission against the topic rules first, as the [overlay package page](../../packages/dpp-overlay-topics.md) shows for the version 2 lineage. The reference host runs without a header source when `CHAIN_TRACKER=scripts-only`, for local development only; a proof update needs a merkle path from a mined transaction, or a stub header source in your own tests.

Add history and export against their selected interfaces. Check pagination, a resumed request and an expired cursor. Finally exercise [federation](../../operate/federation.md), including a record a peer offers but local policy refuses. Peer availability is not a reason to bypass local admission.

The [HTTP guide](../../reference/contracts.md) gives the request sequence and the [limitations](../../operate/limitations.md) distinguish the supplied host's gaps from contract requirements.

## Exact implementation sources

- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/overlay.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model-v2.md)
- [spec/exchange.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/exchange.md)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
