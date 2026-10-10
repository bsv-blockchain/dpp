# Your DPP index

This project runs one index with persistent MongoDB. It admits and serves passport histories (`tm_dpp` / `ls_dpp`) and attestation anchors (`tm_attestation` / `ls_attestation`). Both topics share one service. Legacy UORA lookup remains available for compatibility.

The starter has already added `@bsv/dpp-overlay-topics` to this project's dependencies. Follow the project commands below to run it. There is no separate runtime installation or second index to set up, and the starter itself does not need to keep running.

The index is separate from your application. Your app owns its wallet, funds and broadcasts transactions, stores application data and delivers proofs. A registry stores claim bytes. An index does not replace either of those services.

## Start here

You need Node 22 or later, npm, and Docker with Compose v2 supporting `--wait`. Scaffolding already wrote `.env` with the publisher **public** key you supplied and fresh independent secrets. No publisher private key or funded wallet belongs on this index.

```sh
npm install --ignore-scripts  # omit if the generator already installed
npm test
npm run up
npm run doctor -- --online
npm run connection
```

`up` builds this project's image, starts MongoDB and waits for both services. The image uses the lockfile made by `npm install`; commit `package-lock.json` with your project. `doctor` checks the configured network, package version, topics, custody profile and publisher keys against the running service. It prints no secrets. `connection` writes `.app.env`, a private file for the application.

The HTTP service is at `http://localhost:8080` unless you chose another port. Compose publishes it on loopback and does not expose MongoDB's port. The database uses a dedicated user restricted to the index database; the separate maintenance credentials remain with MongoDB.

If installation fails before these package versions are published, use the repository's candidate check described in the generator README. Do not change pins at random to get an installation through.

## Connect your app

Copy the settings from `.app.env` into the app's server-side `.env`:

| App setting | Index source | Purpose |
| --- | --- | --- |
| `NETWORK` | `NETWORK` | Must match the application wallet |
| `INDEX_URL` | `PUBLIC_URL` | Address reachable from the app server |
| `INDEX_SUBMIT_TOKEN` | `SUBMIT_TOKEN` | Submit and retract transactions |
| `INDEX_CALLBACK_TOKEN` | `ARC_CALLBACK_TOKEN` | Deliver verified Merkle proofs |

These are the settings used by the app starter. Keep tokens out of browser environment variables and client code. The index public key must equal the application's **publisher wallet identity key**, which the app's `npm run wallet` prints. An end user's sign-in or brand identity is a different role.

An app in a container cannot use `localhost` to reach another container. Set the public HTTPS origin, or generate settings for an explicitly shared private Docker network:

```sh
npm run connection -- --url https://index.example.org
```

Do not copy MongoDB maintenance credentials or the export signing key to the app. Re-run `connection` after changing tokens; it replaces `.app.env`. Restart the app after applying its new settings. If the app already starts its own index in Compose, run that app's required services without its bundled index so ports and routing are unambiguous.

## Required and optional

| Component or choice | Default | When to change it |
| --- | --- | --- |
| Included index runtime | Pinned `@bsv/dpp-overlay-topics`, installed with this project's dependencies; it brings protocol and profiles | Upgrade as a compatible release set |
| Index storage | Authenticated MongoDB with a named volume | Use a managed MongoDB with credentials and TLS if preferred |
| Passport publisher | Your app's public key | Use a signed policy for multiple publishers or rotation |
| Anchor publishers | Same key as the app publisher | Add the registry's anchor publisher public key if it signs under a different key |
| Custody | Managed acceptance required | Select baseline deliberately if your app uses a different custody model |
| Header source | WhatsOnChain on the chosen network | Set `WOC_API_KEY` for your service quota |
| Evidence exports | Enabled with a separate signing key and complete-export token | Remove the signing key to disable both export routes |
| Peer synchronisation | Off | Set `SYNC_PEERS` and `SYNC_INTERVAL_MS` to pull compatible peers |
| SHIP discovery | Off | Set `SYNC_DISCOVERY=ship`, with optional `SLAP_TRACKERS` and `SYNC_MAX_DISCOVERED` |
| SHIP/SLAP advertising | Off | Set `ADVERTISE=1`, HTTPS `PUBLIC_URL`, and a separate funded advertiser wallet and storage URL |
| App auth, application database, claim registry | Outside this project | Configure them in the app or separate registry service |

The default custody profile matches the app starter. It does not create extra control or recovery authorities. Those lists stay empty until you deliberately name them. An anchor is a commitment to a claim; it does not establish the claim's truth or replace access to its bytes.

This starter keeps header verification on, including when it runs locally. It refuses `CHAIN_TRACKER=scripts-only`. The protocol's synthetic fixture tests use that setting in a separate test process and claim no blockchain inclusion. No part of scaffolding, `npm test`, or `doctor` broadcasts a transaction.

Peer addresses alone do not establish federation or independent operation. Follow the standard's publisher policy and trust rules when configuring multiple operators. Public read access does not grant submit permission.

## Files you can change

```text
.env.example           Setting names and explanations, without secrets
.env                   Your private configuration, ignored by git
.app.env               Generated private app connection file
compose.yml            MongoDB and index services
Dockerfile             Image built from your installed package lock
config/                Optional signed publisher policy history
scripts/start.mjs      Configuration checks and the supported runtime entry point
scripts/doctor.mjs     Configuration and HTTP capability checks, with JSON output
scripts/connection.mjs App settings writer, with JSON output
test/                  Offline configuration checks
OPERATIONS.md          Automation commands and operating boundaries
```

The server implementation stays in the maintained overlay package. For deeper customisation, `@bsv/dpp-overlay-topics/server` exports the HTTP host and `runFromEnvironment`. Importing it starts nothing. `dpp-index --env-file .env` is also a supported runtime command, but `npm start` adds this project's configuration checks.

To run Node directly with an existing MongoDB, set `MONGO_URL` to the address reachable from your machine, keep `HOST=127.0.0.1`, and run `npm start`. The generated URI's `mongo` hostname belongs to Compose and will not resolve on the host.

## Deploy and maintain

Use the same image and lockfile in a deployment with a TLS reverse proxy. Set `PUBLIC_URL` to the HTTPS origin and route it to the index. A proxy on the host can reach the loopback port; a proxy in Docker must share the index network. Keep the MongoDB port private. Apply request and connection limits at the proxy, monitor storage and header-source quota, and keep the three bearer tokens scoped to their intended callers. Public reads include passport history and bounded evidence, so only submit material appropriate for that public surface.

For a managed database, replace `MONGO_URL` with its authenticated TLS URI, remove the bundled `mongo` service and the index's `depends_on`, then start the index. Keep the index database distinct from the app database. Environment variables provided by the process take precedence over `.env` when running Node; Compose passes `.env` plus its explicit service overrides.

```sh
npm run logs
docker compose restart index
npm run doctor -- --online
npm run down
```

Stopping or recreating services preserves the named database volume. `docker compose down -v` deletes it. Do not use that command on data you intend to keep. MongoDB's initial users are created only on the first start of a new volume; editing password fields later does not rotate existing database users. Rotate them in MongoDB and update the matching URI together.

The health endpoint is process liveness, not continuous proof of database availability or blockchain settlement. Monitor database health, failed submissions, proof lag and synchronisation logs as separate signals. Before taking production traffic, exercise your app's issue, update, transfer, proof delivery and recovery flows on the configured network and keys.

## Back up and restore

Back up the **whole index database**, `.env` in encrypted secret storage, the signed policy history in `config/`, `package-lock.json` and your deployment configuration. All overlay collections matter, including spent outputs and synchronisation state. Peer sync and a wallet root key are not complete database backups. The application, wallet and registry require their own backups.

For the bundled database, stop the index to take a consistent dump, leaving MongoDB running:

```sh
mkdir -p backups
chmod 700 backups
docker compose stop index
umask 077
docker compose exec -T mongo sh -c 'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$MONGO_DB" --archive --gzip' > backups/index.archive.gz
docker compose start index
```

Check the dump command's exit status before treating the archive as a backup. Copy successful backups to separate encrypted storage with your retention policy. A failed dump must not replace the last good backup.

Practise recovery in a **new project directory with a separate Compose project name, fresh volume and unused HTTP port**. Restore the matching configuration, initialise that project's MongoDB with `docker compose up -d --wait mongo`, then:

```sh
docker compose exec -T mongo sh -c 'exec mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' < backups/index.archive.gz
npm run up
npm run doctor -- --online
```

Check known passport histories and anchors against saved expectations, including spent states, before directing traffic to the restored service. Test proof updates and authenticated writes with the app. Keep the old deployment available until those checks pass. Do not run the restore commands against the production database as a recovery rehearsal.

## When something fails

| Symptom | Check |
| --- | --- |
| `npm install` cannot find a version | This starter pins one release set. Confirm that set is published or use the candidate check |
| MongoDB never becomes healthy | `docker compose logs mongo`; check whether credentials belong to an existing volume |
| Index fails startup | `npm run doctor` and `npm run logs`; required settings fail before the HTTP listener starts |
| App cannot connect | Test the URL from the app's host/container; check TLS, proxy and port |
| 401 on submit or proof delivery | Copy the right scope from a fresh `.app.env`, then restart the app |
| Admission refusal | Compare publisher keys, network and custody in `/capabilities`; inspect the refusal reason |
| Anchors absent | Confirm the actual anchor publisher key is in `ANCHOR_SERVICE_KEYS`; a registry URL is not a key |
| Pending or unknown evidence | Check broadcast/proof delivery and header-source quota; admission alone is not settlement |

Further operator guidance: [Open DPP documentation](https://dpp.bsvb.net/docs).
