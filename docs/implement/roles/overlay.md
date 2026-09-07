# Overlay

An overlay is an index for selected blockchain records. It admits transactions under its topic rules, stores the admitted evidence and answers lookups. It lets a reader find passport records without scanning the whole blockchain. It does not broadcast transactions or make a lookup response a verification result.

## Run the reference service

Use [Run a service](../../operate/README.md) for the Docker Compose setup. It starts the index and its MongoDB database, explains the required settings and checks `/health` and `/capabilities`.

An empty, healthy index has no passport history to return. The [lookup example](../../reference/contracts.md#find-passport-records) makes a request; admission of suitable records must be exercised separately before expecting populated results.

## Build an independent overlay

Implement topic admission and persistent storage before adding peer synchronisation. Admission evaluates both the record and the operator's selected publisher/custody policy. Keep the decision distinct from the HTTP transport status and the transaction's network status.

Exercise submission, lookup and proof ingestion with the same admitted transaction. A later proof update must remain associated with the correct record. Test duplicates and refused records, then restart the service and repeat the lookup.

Add history and export against their selected interfaces. Check pagination, a resumed request and an expired cursor. Finally exercise [federation](../../operate/federation.md), including a record a peer offers but local policy refuses. Peer availability is not a reason to bypass local admission.

The [HTTP guide](../../reference/contracts.md) gives the request sequence and the [limitations](../../operate/limitations.md) distinguish the supplied host's gaps from contract requirements.

## Exact implementation sources

- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/services.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md)
- [spec/exchange.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/exchange.md)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
