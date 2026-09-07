# @bsv/dpp-overlay-topics

Reference topic managers, lookup services and an HTTP host. Use the [support table](support-table.md) for versions and runtime dependencies.

## Choose library or service use

Import the package to embed topic managers, lookup services and record stores in an application. The import does not listen on a port. Starting the HTTP host is a separate choice, useful when writers and readers connect over the network.

For the service route, use [the Compose setup](../operate/README.md). It explains publisher keys, authentication tokens, storage and the first health and capability checks. Then issue [a passport lookup](../reference/contracts.md#find-passport-records).

For library use, supply the storage and engine integration required by the host application. Keep topic admission and lookup responsibilities separate: admission decides which offered outputs the policy accepts; lookup retrieves retained candidates for a reader to verify. An in-memory store is useful for a test but does not retain records across process loss.

Add proof ingestion and [recovery](../operate/export-import-recovery.md) before treating an embedded index as a retained evidence source. [The overlay role](../implement/roles/overlay.md) gives the implementation order and failure cases.

## Integration sources

| Integration | Source |
|---|---|
| Embed passport and attestation indexing | [Library exports](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/lib.ts) |
| Run the HTTP service | [Host and configuration](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/index.ts) |
| Serve or consume its interface | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml) |
| Select storage and service adapters | [Package guide](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/README.md) |

Importing the library does not start the host. Begin service setup at [Operate](../operate/README.md); use the [overlay role](../implement/roles/overlay.md) when building an independent implementation.

Read [operating limitations](../operate/limitations.md) before relying on synchronisation or recovery. New proof-bearing states and later proof updates to already-held states follow different paths in the reference host.
