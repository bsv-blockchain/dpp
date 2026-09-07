# Federation with static peers

The reference host uses the Graph Aware Synchronisation Protocol (GASP) with configured peers. Start one [operator](README.md), then use a separate environment file and database for the second:

```sh
cp deploy/operator.env.example deploy/operator-b.env
# Configure the second operator using the preset below.
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
```

Read the [second-operator preset](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/deploy/compose.second-operator.yml) and [peer configuration](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/src/sync.ts) before choosing keys, publisher policy and peer addresses. The [service source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/services.md) holds admission and synchronisation requirements.

Newly synchronised states can carry proofs. A later proof update to an already-held output needs a separate ingestion path in this reference host. The [federation tests](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/test/federation.test.ts#L240-L285) exercise that distinction.

Use [recovery](export-import-recovery.md) for evidence outside the synchronised history. The [limitations](limitations.md) and [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) identify what local tests do not establish about independent operation.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
