# Run an index from source

Operators can use this guide to run an index from the overlay image and the repository's Docker Compose preset, check its admission and access settings, and hand an application its connection file. The preset runs an index and a persistent MongoDB, not a complete passport platform. It is the supported way to run a new index; the retired index starter's projects [move to it](../packages/create-dpp-index.md#move-a-generated-project).

Read [limitations](limitations.md) and [the hosted reference](../deployment.md) first. [Choose packages and services](../start/choose-components-and-services.md) covers an arranged provider and other capabilities your task may need. The [environment example](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/deploy/operator.env.example) lists this preset's configuration.

## What to prepare

| Input | Source or preparation |
|---|---|
| Container tools | Install Docker with Docker Compose. |
| Repository | Obtain the [source checkout](../packages/README.md#source-access); run commands from its root. |
| Publisher key | Publisher's compressed public identity key: for a generated application, the key its `npm run wallet` prints; that command's first run generates the application's wallet root key into its `.env`. Use the fixture lookup only for an empty local rehearsal. |
| Access and custody settings | Operator's policy and writer arrangements, entered below before startup. |

The preset builds from this repository and keeps admitted records in a named MongoDB volume. It starts no writer, wallet or attestation registry.

1. Create the local environment file once. If it exists, edit it without overwriting its values:

```sh
cp deploy/operator.env.example deploy/operator.env
```

2. Fill in these settings before starting the containers:

| Setting | Value to supply and why |
|---|---|
| `SERVICE_IDENTITY_KEY` | Publisher's compressed public identity key for checking admitted passport signatures. No private key needed. |
| `PUBLIC_URL` | The address applications reach this index at: the HTTPS origin of your proxy when hosted. The connection command writes it as the application's `INDEX_URL`. |
| `PUBLISHER_TOKENS_FILE` | Leave empty: write tokens, each bound to one publisher or anchoring key and one use (submit or callback), are stored hashed in the preset's MongoDB and issued after startup. Until one is issued, every write is refused. A mounted JSON file is the alternative. |
| `SUBMIT_TOKEN` | An optional operator-wide secret for submission and retraction, accepted for any publisher beside the per-publisher tokens. |
| `REGISTRATION` | `open` or `approval`: `POST /register` lets an application register its publisher key from its own wallet, appending a policy version the index serves at once; `approval` holds each request for `registrations approve`. Needs a publisher policy, `OPERATOR_SIGNING_KEY` and `PUBLIC_URL`. Empty: the route answers 404. |
| `OPERATOR_SIGNING_KEY` | Operator's hex identity private key signing registration's appended policy versions. Only with `REGISTRATION`; its public key must match the operator in `OPERATOR_IDENTITY_KEYS`. |
| `ARC_CALLBACK_TOKEN` | An optional operator-wide secret for the proof-ingestion caller or broadcaster callback. |
| `NETWORK` | The blockchain network used by the wallet and header lookups. The preset defaults to `main`. |
| `WOC_API_KEY` | A WhatsOnChain API key for the header source's quota. |
| `ANCHOR_SERVICE_KEYS` | Optional. The publisher key carries only that application's anchors; empty carries every treasury's. |
| `ACCEPTANCE_COMMITMENT` | The preset selects `required`, so clients need the managed-custody acceptance commitment for version 2 transfers. |
| `OWNER_CONSENT`, `TRANSFER_AUTHORITIES`, `INSTRUCTION_COMMITMENT` | Unset. No longer read: the node refuses to boot with any of them set. Name recovery keys in `CONTROL_AUTHORITIES`; where it was unset, the `TRANSFER_AUTHORITIES` keys were also the control authorities, so move them there. |

3. For an empty local fixture rehearsal only, obtain the fixture publisher public key:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
console.log(fixture.custodianKey)
JS
```

That key belongs to synthetic data; use the actual publisher key for a deployment.

4. Generate any operator-wide secret with `openssl rand -hex 32` ([known limitations](limitations.md#index-host)). `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN` are optional and shared by everyone receiving them, so leave them empty when each application gets its own tokens below; `EXPORT_TOKEN` is the complete-export secret. Leave `SERVER_PRIVATE_KEY` empty.

To publish the HTTP port on loopback only, behind a TLS proxy on the same host, set `OVERLAY_PORT=127.0.0.1:8080`. To use a managed MongoDB, set `MONGO_URL` to its authenticated URI; the bundled MongoDB is reachable only on the Compose network and publishes no port.

## Start and inspect

1. Start the preset and query both open inspection routes:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

2. Compare the responses with this configuration:

| Response field | Expected value or check |
|---|---|
| `/health`: `status` | `ok` |
| `/health`: `topic`, `service` | `tm_dpp`, `ls_dpp` |
| `/health`: `topics`, `services` | `tm_dpp`, `tm_attestation`, `tm_uora_dpp`; and `ls_dpp`, `ls_attestation`, `ls_uora_dpp` |
| `/health`: `legacyTopics`, `legacyServices` | `tm_uora_dpp`, `ls_uora_dpp` |
| `/health`: `network`, `startedAt` | Configured network, default `main`, and startup time |
| `/capabilities`: `protocols`, `profiles`, `publisherPolicy` | Declared interfaces, profile selection and publisher settings must match the selected clients and configuration. |

Stop before connecting writers if these disagree. A healthy empty index still returns no passport records. Keep observed results separate from configuration.

If startup fails, inspect the service logs:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env logs --tail=100 overlay mongo
```

| Failure | Interpretation |
|---|---|
| Host stops | A missing identity key or invalid policy can prevent startup. |
| Connection refused | Host may be starting, failed or exposed on another `OVERLAY_PORT`. |
| Export answers 503 | Export unavailable, commonly without `EXPORTER_PRIVATE_KEY`. It does not mean the passport has no history. |
| Host refuses to start naming `EXPORT_SIGNING_KEY` | An earlier release signed packages with that raw key; move its value to `EXPORTER_PRIVATE_KEY` and unset it ([enable exports](export-import-recovery.md#enable-exports-on-your-index)). |

3. Make [your first lookup](../reference/contracts.md#find-passport-records), then follow the writer and proof flow. To stop while retaining the named volume:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env down
```

The [Compose source](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/deploy/compose.yml) fixes the local arrangement. The [host configuration](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/packages/dpp-overlay/src/index.ts) defines the remaining options. Use the returned capability document when selecting clients; [contracts](../reference/contracts.md) identify its schema and the service interface.

Follow [broadcast and proofs](wallet-broadcast-proofs.md), [export and recovery](export-import-recovery.md), and [peer synchronisation](federation.md) for exchange or replication. Overlay beta.10 onwards can discover peers and advertise when configured; see the federation guide.

Stored records and cursors have different lifetimes: per-process cursor secrets invalidate existing resumable cursors on restart. The [export ledger entries](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) describe the tested scope.

### Connect an application

The index's `connection` command issues one application a submit and a callback token, bound to its publisher key, and prints the application's connection file: `NETWORK`, `INDEX_URL`, `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN`, the settings the application starter reads.

1. Write the file once the index is running. The publisher defaults to `SERVICE_IDENTITY_KEY` and the address to `PUBLIC_URL`; add `--publisher <key>` or `--url <address>` to choose others:

```sh
umask 077
docker compose -f deploy/compose.yml --env-file deploy/operator.env exec -T overlay node packages/dpp-overlay/dist/cli.js connection > deploy/app.env
```

2. Hand `deploy/app.env` to the application's operator over a private channel. Git ignores it; the tokens in it are printed once and only their SHA-256 is stored.
3. In a generated application, run `npm run connect-index -- --from <path to app.env>`. It writes the connection to `.env`, runs the go-live checks and, when every check passes, switches live publishing on; after fixing a failed check, such as funds, run `npm run go-live`. Another application copies the four settings into its server-side environment.

Run the command again to rotate: it issues a new pair and revokes the pair the same `--label` (default `app`) issued that key before. Give a second application on the same key its own `--label`.

### Issue writer access after startup

1. Give any other writer its own tokens inside the running container: `docker compose -f deploy/compose.yml --env-file deploy/operator.env exec overlay node packages/dpp-overlay/dist/cli.js tokens issue --publisher <key> --use submit`, and the same with `--use callback`.
2. Retain the token when printed; it is shown once. The preset stores its SHA-256 in MongoDB, or in the mounted file named by `PUBLISHER_TOKENS_FILE` if selected.
3. Use `tokens list` and `tokens revoke` to see and remove one writer's access without affecting others.

| Result | Meaning |
|---|---|
| Token accepted | State is countersigned by its bound key, or anchor names that key. |
| `403 token-publisher-mismatch` | State or anchor names another key; stop and check the writer's token and publisher selection. |

## Place each component

| Component | Responsibility |
|---|---|
| Index and MongoDB | Admit and retain records; index holds the publisher's public identity key. |
| Client or application service | Supply wallet operations, submit records and request evidence. |
| Writer's wallet | Hold signing access. |
| Separate attestation registry | Store claims when needed. |
| Header source | Supply block-header evidence for inclusion checks. |
| Optional operator signing key | Its per-passport child signs this operator's evidence packages, never passport states. |

Keep these roles separate in deployment configuration.

## Deploy in steps

1. Complete [start and inspect](#start-and-inspect), including capabilities and lookup checks.
2. [Connect an application](#connect-an-application) or another writer on the same network under the expected publisher policy. Exercise admission, broadcast response and later proof ingestion before relying on retrieval with inclusion evidence.
3. Add a registry only if the workflow needs stored claims.
4. Add peers after one operator admits, retrieves and exports the intended records. [Federation](federation.md) covers the second instance; [recovery](export-import-recovery.md) covers retained evidence for replacing one. The MongoDB volume is service storage, not an independently administered replica.
5. Before serving real products, use [Prepare for production](production-readiness.md) to record access, retention, recovery and support responsibilities, and the checks supporting your release decision.

## Configuration sources

| Configure | Source |
|---|---|
| Index and database containers | [Compose preset](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/deploy/compose.yml) |
| Environment and policy files | [Environment example](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/deploy/operator.env.example), [host configuration](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/packages/dpp-overlay/src/index.ts) |
| Wallet, broadcast and proof retrieval | [Integration guide](wallet-broadcast-proofs.md) |
| Another operator | [Federation](federation.md) |
| Retention and replacement provider | [Recovery](export-import-recovery.md) |

Header-storage size, mining delay and synchronisation latency are unmeasured here. The [ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) records local tests and the remaining deployment evidence gaps. [Durable publication](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json#L3794) has ledger status `gap`.
