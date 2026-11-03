# Create an index

Application operators can use `@bsv/create-dpp-index` to create, start and connect an editable index project: persistent MongoDB, access tokens, deployment files and an app connection helper. One service handles passport history and attestation anchors.

**Use the starter once. It includes the index runtime.** You do not separately install `@bsv/dpp-overlay` or create another service for it.

| Part | What it does | Your action |
| --- | --- | --- |
| `@bsv/create-dpp-index` | Creates your project | Run the setup command below |
| Your generated project | Holds configuration, deployment files and a pinned runtime dependency | Run its commands to start and maintain your index |
| `@bsv/dpp-overlay` | Runs the index inside that project | Included automatically with the project's dependencies |

For an existing compatible index, obtain its URL and access settings from the operator; HTTP connections need neither package. Direct runtime installation supports [custom or embedded integrations](dpp-overlay.md).

## Before creation

| Required input | Source |
|---|---|
| Node 22 or later, npm, Docker with Compose v2 | Install on the machine running the generated project. |
| Publisher key | Run `npm run wallet` in the app and use the public key it prints. |
| Network | Select the network your application uses. |

## Create your project

| Selection | Version boundary |
|---|---|
| Published, installed by the command below | The published starter, `0.1.0-beta.1`, pins the published index runtime `@bsv/dpp-overlay@0.4.0-beta.12` of the superseded `dpp-release-2026-10-10`. |
| Source candidate, not yet published | Starter `0.1.0-beta.2` pins `@bsv/dpp-overlay@0.4.0-beta.13` of current `dpp-release-2026-11`. |

From the reviewed source checkout, `npm ci`, `npm run build` and `npm run index-starter:check` exercise the packed candidate outside the repository without publishing. Maintainers publish the runtime before the starter; the release workflow separately checks public npm setup before announcing a release.

1. Create the project from npm:

```sh
npm create @bsv/dpp-index@0.1.0-beta.1 my-index
```

The guided setup explains the index, asks for the publisher key and network, and generates fresh secrets without printing them. It uses the app starter's managed custody without prompting; admitting self-custody states is an environment setting.

## Start and connect

2. Change into the generated `my-index` directory, then run:

```sh
npm test
npm run up
npm run doctor -- --online
npm run connection
```

The generator installs dependencies unless you pass `--no-install`.

| Command | Expected result |
|---|---|
| `npm test` | Generated-project checks pass. |
| `up` | Builds from your lockfile and starts the index and MongoDB. HTTP binds to loopback; MongoDB's port stays private. |
| `doctor` | Checks the running network, version, topics, custody profile and publisher keys. Resolve failures before connecting. |
| `connection` | Writes the private `.app.env` described below. |

3. Copy the connection settings into the app's server environment and restart it.

| Connection input or location | Published starter (`0.1.0-beta.1`) behaviour |
|---|---|
| `.app.env` | Holds `INDEX_URL`, `NETWORK`, `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN`. |
| Token source | Copies the operator-wide `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN`. It issues no per-publisher tokens and creates no `config/publisher-tokens.json`. |
| Separate hosts | Use `npm run connection -- --url https://index.example.org`. |
| Container app | Use an address reachable from that container; its `localhost` is the container itself. |

## What is included

| Included | Your choice |
| --- | --- |
| Passport and attestation topics on one service | Publisher public keys and network |
| Persistent MongoDB with a dedicated user | Bundled Docker MongoDB or a managed database |
| Published starter: separate operator-wide submit, callback and complete-export tokens | Which applications receive each shared secret; rotate it for every application using it |
| Managed custody admission, as the app starter writes | Admitting self-custody states, by environment setting; no starter app writes them yet |
| Header verification enabled | Header-source credentials and quota |
| Evidence export with a separate signing key | Disable exports if you do not provide them |
| Deployment, diagnostics and backup instructions | Hosting, TLS, monitoring and recovery rehearsal |

Peer synchronisation, SHIP discovery and funded SHIP/SLAP advertising are optional. No funded wallet is needed merely to run the index. The included runtime brings the compatible protocol, profiles, SDK and MongoDB driver dependencies automatically. Application auth, a wallet service, claim storage and a resolver are separate responsibilities. [Choose packages and services](../start/choose-components-and-services.md) explains when you need them.

## Testing the source candidate

The unpublished `0.1.0-beta.2` starter pins the November runtime candidate and uses per-publisher write tokens. Its `npm run connection` issues submit and callback tokens bound to the configured publisher key, stores hashes in `config/publisher-tokens.json` and app settings in `.app.env`. Reruns retain those tokens. The runtime reads file changes without restarting; operators can revoke one writer without changing another's token. Complete-export access remains operator-wide.

Use the packed candidate check above. npm beta.1 lacks these changes; upgrading only a generated project's runtime leaves its helper scripts unchanged. Read [migration](../migration.md#test-the-november-source-candidate) before upgrading.

## Automated setup

```sh
npx @bsv/create-dpp-index@0.1.0-beta.1 my-index --publisher-key "$PUBLISHER_PUBLIC_KEY" --network main --yes --no-install --json
```

Use `--config` for JSON settings or `--help` for every flag. Unknown options, missing required values and non-empty directories are refused. Inside the project, `node scripts/doctor.mjs --online --json` gives a structured result and returns non-zero on failure. No credentials appear in that result.

The generated README and `OPERATIONS.md` cover customisation, deployment and recovery. Continue in that project; the repository's source deployment is an alternative setup, not an additional step. Keep secrets private and header checks enabled. The starter refuses the synthetic fixture setting `scripts-only`; successful scaffolding is not evidence that application writes or blockchain settlement have been exercised. See [wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md), [evidence and freshness](../learn/evidence-and-freshness.md) and [prepare for production](../operate/production-readiness.md) for the next checks.
