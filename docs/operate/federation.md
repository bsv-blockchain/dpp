# Federation with static peers

## Configure the second instance

First build and run the [initial operator](README.md). The second preset uses the image built by the first, and has a separate database and named volume.

Copy `deploy/operator.env.example` to `deploy/operator-b.env`. Set `OVERLAY_PORT=8081` so the published ports do not collide. Set `SYNC_PEERS=http://host.docker.internal:8080` for the supplied same-machine arrangement; on separate hosts use an address reachable from the second container.

Use separate submit, callback and export secrets. For the first shared-record exercise, use the same publisher public key as the first instance, or a publisher policy accepting the relevant keys. An operator's own identity and its accepted publisher keys answer different questions.

After filling in the second file, start and inspect it:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
curl --fail http://localhost:8081/health
curl --fail http://localhost:8081/capabilities
```

## Observe the exchange

Use the [same passport lookup](../reference/contracts.md#find-passport-records) against each operator by changing `INDEX_URL`. After the first has admitted records and synchronisation has run, inspect which records the second holds and verify them independently.

Check an initially empty peer, a restarted peer catching up and a record the second policy refuses. Synchronisation makes candidates available; local admission still evaluates them. Two containers controlled by one administrator demonstrate the mechanism, not separately administered operation.

## Preset sources

The reference host uses the Graph Aware Synchronisation Protocol (GASP) with configured peers.

Read the [second-operator preset](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/deploy/compose.second-operator.yml) and [peer configuration](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/sync.ts) before choosing keys, publisher policy and peer addresses. The [service source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/services.md) holds admission and synchronisation requirements.

Newly synchronised states can carry proofs. A later proof update to an already-held output needs a separate ingestion path in this reference host. The [federation tests](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/test/federation.test.ts#L240-L285) exercise that distinction.

Use [recovery](export-import-recovery.md) for evidence outside the synchronised history. The [limitations](limitations.md) and [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) identify what local tests do not establish about independent operation.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
