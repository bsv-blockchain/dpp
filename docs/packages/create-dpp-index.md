# Index starter (retired)

The index starter, `@bsv/create-dpp-index`, is retired. Run a new index from the overlay image and the repository's Docker Compose preset: [Run an index from source](../operate/README.md) is the whole procedure, from configuration to the application's connection file. One service handles passport history and attestation anchors, and no separate runtime installation is needed.

Most of what the starter set up has a place in the preset. The rows marked as differences are not carried over, or not by default; decide on each before you rely on the preset:

| The starter gave you | The preset gives you |
| --- | --- |
| `npm create @bsv/dpp-index` | A [source checkout](README.md#source-access) with `deploy/compose.yml`, which builds `packages/dpp-overlay/Dockerfile` |
| A generated `.env` | `deploy/operator.env`, copied from `deploy/operator.env.example` and filled in |
| Persistent MongoDB | The bundled MongoDB on a named volume, private to the Compose network, or a managed database through `MONGO_URL` |
| Operator-wide `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN`, copied into `.app.env` | The same settings, now optional, or per-publisher tokens that `dpp-index connection` issues, stored hashed in the preset's MongoDB |
| `npm run connection` and `.app.env` | `dpp-index connection`, run in the index container, which prints the same four settings; a generated application takes the file with `npm run connect-index -- --from <file>` |
| `npm run doctor -- --online` | `GET /health` and `GET /capabilities`, compared with the configuration as the operator guide shows |
| A read-only index container, run as the `node` user without capabilities | The same container settings on the preset's `overlay` service |
| Backup and recovery instructions | [Export and recovery](../operate/export-import-recovery.md) |
| Difference: a dedicated, authenticated MongoDB user | The bundled MongoDB has no credentials and publishes no port; for authentication, set `MONGO_URL` to a managed database |
| Difference: HTTP published on loopback only | The preset publishes on every interface; set `OVERLAY_PORT=127.0.0.1:8080` behind a TLS proxy on the same host |
| Difference: `ANCHOR_SERVICE_KEYS` defaulted to the publisher key | Empty carries every treasury's anchors; set it to the publisher key to carry only that application's |
| Difference: generated `EXPORT_TOKEN` and `EXPORT_SIGNING_KEY` | `EXPORT_TOKEN` and `EXPORTER_PRIVATE_KEY` are empty, so both export routes answer 503 until you [enable exports](../operate/export-import-recovery.md#enable-exports-on-your-index); the index refuses to boot with the starter's `EXPORT_SIGNING_KEY`, which it no longer reads; move its value to `EXPORTER_PRIVATE_KEY` |
| Difference: startup refused `CHAIN_TRACKER=scripts-only` | Nothing refuses it; leave `CHAIN_TRACKER` empty on any reachable index |

## The published starter

`@bsv/create-dpp-index@0.1.0-beta.1` stays on npm and still creates the project it always did, pinned to the superseded `dpp-release-2026-10-10` runtime. It receives no further versions, and its unpublished source candidate is withdrawn. Marking the package deprecated on npm, with a message pointing here, is a maintainer action.

## Move a generated project

A project the published starter generated keeps running as it is. To move it to the preset:

1. Copy every non-empty setting from the project's `.env` into `deploy/operator.env`, except `PORT`, `HOST`, `MONGO_URL`, `MONGO_INDEX_PASSWORD` and `MONGO_ROOT_PASSWORD`. That carries `MONGO_DB`, the keys, the tokens, `PUBLIC_URL` and every admission and synchronisation setting. Copy the project's `config/` into `deploy/config/` and change `PUBLISHER_POLICY_FILE` from `config/<file>` to `/config/<file>`, where the preset mounts it.
2. Back up its index database with the project's own `mongodump` instructions. Before the preset's index first starts, restore that archive into the preset's MongoDB; it keeps the database name `MONGO_DB` now carries:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --wait mongo
docker compose -f deploy/compose.yml --env-file deploy/operator.env exec -T mongo mongorestore --archive --gzip < index.archive.gz
```

3. Start the preset, check it as [Run an index from source](../operate/README.md#start-and-inspect) shows, and [issue the application a new connection](../operate/README.md#connect-an-application). The carried `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN` keep the application writing until it holds its own; then empty them.
