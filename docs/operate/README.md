# Run a service

Begin with the [limitations](limitations.md) and [reference deployment](../deployment.md). The preset runs an index and MongoDB. The [environment example](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/deploy/operator.env.example) lists its configuration.

## What to prepare

Install Docker with Docker Compose and obtain the [source checkout](../packages/README.md#source-access). The preset builds the index from this repository and stores admitted records in a named MongoDB volume. It does not start a writer, wallet or attestation registry.

Create the local environment file once. If it already exists, edit it instead of overwriting its values:

```sh
cp deploy/operator.env.example deploy/operator.env
```

Fill in these settings before starting the containers:

| Setting | Value to supply and why |
|---|---|
| `SERVICE_IDENTITY_KEY` | The publisher's compressed public identity key. The index uses it to check admitted passport signatures; it does not need the private key. |
| `SUBMIT_TOKEN` | A secret shared with authorised writers for submission and retraction. |
| `ARC_CALLBACK_TOKEN` | A separate secret for the proof-ingestion caller or broadcaster callback. |
| `NETWORK` | The blockchain network used by the wallet and header lookups. The preset defaults to `main`. |
| `ACCEPTANCE_COMMITMENT` | The preset selects `required`, so clients need the managed-custody acceptance commitment for version 2 transfers. |

For an empty local fixture rehearsal, the fixture's publisher public key is available with:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
console.log(fixture.custodianKey)
JS
```

That key belongs to synthetic data; choose the actual publisher key for a deployment. Generate each bearer token separately, for example with `openssl rand -hex 32`, and put the values in the local environment file. Leave `SERVER_PRIVATE_KEY` empty.

## Start and inspect

From the repository root:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

Expect `/health` to identify the running topics and lookup services, and `/capabilities` to return the server's declared interfaces and profile selection. A healthy empty index still returns no passport records.

If startup fails, inspect the service logs:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env logs --tail=100 overlay mongo
```

A missing identity key or invalid policy can stop the host. Connection refusal can mean the host is still starting, failed to start or is exposed on a different `OVERLAY_PORT`. An export response of 503 means export is unavailable, commonly because no `EXPORT_SIGNING_KEY` is set; it is not evidence that the passport has no history.

Continue with [your first lookup](../reference/contracts.md#find-passport-records), then the writer and proof flow. To stop this preset while retaining its named volume, use:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env down
```

The [Compose source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/deploy/compose.yml) fixes the local arrangement. The [host configuration](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/index.ts) defines the remaining options. Use the returned capability document when selecting clients; [contracts](../reference/contracts.md) identify its schema and the service interface.

Follow [broadcast and proofs](wallet-broadcast-proofs.md), [peer synchronisation](federation.md), then [export and recovery](export-import-recovery.md).

Stored records and resumable cursors have different lifetimes. Cursor secrets are per process; restarting invalidates existing cursors. The [export ledger entries](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) describe the tested scope.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
