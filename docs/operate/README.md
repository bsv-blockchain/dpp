# Run a service

Begin with the [limitations](limitations.md) and [reference deployment](../deployment.md). The preset runs an index and MongoDB. The [environment example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/deploy/operator.env.example) lists its configuration.

From the repository root:

```sh
cp deploy/operator.env.example deploy/operator.env
# Set SERVICE_IDENTITY_KEY, SUBMIT_TOKEN and ARC_CALLBACK_TOKEN in that file.
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

The [Compose source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/deploy/compose.yml) fixes the local arrangement. The [host configuration](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/src/index.ts) defines the remaining options. Use the returned capability document when selecting clients; [contracts](../reference/contracts.md) identify its schema and the service interface.

Follow [broadcast and proofs](wallet-broadcast-proofs.md), [peer synchronisation](federation.md), then [export and recovery](export-import-recovery.md).

Stored records and resumable cursors have different lifetimes. Cursor secrets are per process; restarting invalidates existing cursors. The [export ledger entries](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) describe the tested scope.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
