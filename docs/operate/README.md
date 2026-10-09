# Run a service

Begin with the [limitations](limitations.md) and [the hosted reference](../deployment.md). The preset runs an index and MongoDB. The [environment example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/deploy/operator.env.example) lists its configuration.

Use this page when you have chosen to operate the reference index. [Choose packages and services](../start/choose-components-and-services.md) explains the alternative of an arranged provider and which other capabilities your task needs. The goal here is an index with the expected admission and access settings, not a complete passport platform.

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

That key belongs to synthetic data; choose the actual publisher key for a deployment. Generate each bearer token separately, for example with `openssl rand -hex 32`, and put the values in the local environment file. Each of `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN` and `EXPORT_TOKEN` is one shared secret: everyone you give it to holds the same value, the index cannot tell them apart, and taking access away from one means replacing the value for all ([known limitations](limitations.md#index-host)). Leave `SERVER_PRIVATE_KEY` empty.

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

The [Compose source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/deploy/compose.yml) fixes the local arrangement. The [host configuration](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/src/index.ts) defines the remaining options. Use the returned capability document when selecting clients; [contracts](../reference/contracts.md) identify its schema and the service interface.

Follow [broadcast and proofs](wallet-broadcast-proofs.md) and [export and recovery](export-import-recovery.md). Add [peer synchronisation](federation.md) if your operating model needs exchange or replication. From the beta.10 overlay package an index can find peers and advertise itself when configured, as the federation guide explains.

Stored records and resumable cursors have different lifetimes. Cursor secrets are per process; restarting invalidates existing cursors. The [export ledger entries](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) describe the tested scope.

## Place each component

The reference deployment contains an index and MongoDB. A client or application service supplies wallet operations, submits records and asks the index for evidence. An attestation registry is a separate service. A header source supplies the block-header evidence used for inclusion checks.

The index holds the publisher's public identity key. A writer's wallet holds signing access. An optional export key signs the archive produced by this operator; it does not sign passport states. Keep those roles separate when configuring a deployment.

## Deploy in steps

Start the index as [start and inspect](#start-and-inspect) shows, check its capabilities and make a lookup. Next connect a writer on the same network and under the expected publisher policy. Exercise admission, broadcast response and later proof ingestion before relying on the record being retrievable with inclusion evidence.

Add a registry only when the workflow needs stored claims. Add peers after one operator can admit, retrieve and export the intended records. [Federation](federation.md) covers the second instance and [recovery](export-import-recovery.md) covers the retained evidence needed to replace one.

The MongoDB volume is service storage; it is not itself an independently administered replica.

Before offering the service for real products, use [Prepare for production](production-readiness.md) to record access, retention, recovery and support responsibilities and the checks that support your release decision.

## Configuration sources

| Configure | Source |
|---|---|
| Index and database containers | [Compose preset](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/deploy/compose.yml) |
| Environment and policy files | [Environment example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/deploy/operator.env.example), [host configuration](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/src/index.ts) |
| Wallet, broadcast and proof retrieval | [Integration guide](wallet-broadcast-proofs.md) |
| Another operator | [Federation](federation.md) |
| Retention and replacement provider | [Recovery](export-import-recovery.md) |

Check health and capabilities after starting the service, then exercise submission and retrieval under the selected contract. Keep the observed results separate from the deployment's configuration.

Header-storage size, mining delay and synchronisation latency are unmeasured here. The [ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) records local tests and the remaining deployment evidence gaps. [Durable publication](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json#L3794) has ledger status `gap`.
