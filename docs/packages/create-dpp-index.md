# Create an index

Start here to operate your own index alongside your application. `@bsv/create-dpp-index` generates an editable project with persistent MongoDB, scoped tokens, deployment files and an app connection helper. One service handles passport history and attestation anchors.

**Use the starter once. It includes the index runtime.** You do not separately install `@bsv/dpp-overlay-topics` or create another service for it.

| Part | What it does | Your action |
| --- | --- | --- |
| `@bsv/create-dpp-index` | Creates your project | Run the setup command below |
| Your generated project | Holds configuration, deployment files and a pinned runtime dependency | Run its commands to start and maintain your index |
| `@bsv/dpp-overlay-topics` | Runs the index inside that project | Included automatically with the project's dependencies |

If your app uses an existing compatible index, obtain its URL and access settings from its operator. You need neither package just to connect over HTTP. Direct runtime installation is for [custom or embedded integrations](dpp-overlay-topics.md).

## Create your project

**Publication pending.** This starter and its pinned runtime are source candidates. The command below applies after their publication. From the current reviewed source checkout, `npm ci`, `npm run build` and `npm run index-starter:check` exercise the packed candidate outside the repository without publishing anything. Maintainers publish the runtime first, then the starter; the release workflow checks the public npm setup separately before a release is announced.

```sh
npm create @bsv/dpp-index@0.1.0-beta.1 my-index
```

You need Node 22 or later, npm, Docker with Compose v2, and the app wallet's publisher **public** key. The guided setup asks for that key, the network and custody profile. It generates fresh secrets without printing them. The default custody profile requires managed acceptance to match the app starter.

## Start and connect

Inside the generated project:

```sh
npm test
npm run up
npm run doctor -- --online
npm run connection
```

The generator installs dependencies unless you pass `--no-install`. `up` builds from your lockfile and starts the index and MongoDB. The HTTP port is published on loopback; MongoDB's port remains private. `doctor` checks the running network, version, topics, custody profile and publisher keys.

`connection` saves a private `.app.env` with `INDEX_URL`, `INDEX_SUBMIT_TOKEN`, `INDEX_CALLBACK_TOKEN` and `NETWORK`, using the app starter's existing settings. Copy those into the app's server environment and restart it. For separate hosts, use `npm run connection -- --url https://index.example.org`. An app in a container needs an address reachable from that container; its `localhost` is its own container.

## What is included

| Included | Your choice |
| --- | --- |
| Passport and attestation topics on one service | Publisher public keys and network |
| Persistent MongoDB with a dedicated user | Bundled Docker MongoDB or a managed database |
| Separate submit, proof-delivery and complete-export tokens | Which trusted service receives each scope |
| Managed custody admission by default | Deliberate baseline selection for a different app model |
| Header verification enabled | Header-source credentials and quota |
| Evidence export with a separate signing key | Disable exports if you do not provide them |
| Deployment, diagnostics and backup instructions | Hosting, TLS, monitoring and recovery rehearsal |

Peer synchronisation, SHIP discovery and funded SHIP/SLAP advertising are optional. No funded wallet is needed merely to run the index. The included runtime brings the compatible protocol, profiles, SDK and MongoDB driver dependencies automatically. Application auth, a wallet service, claim storage and a resolver are separate responsibilities. [Choose packages and services](../start/choose-components-and-services.md) explains when you need them.

## Automated setup

```sh
npx @bsv/create-dpp-index@0.1.0-beta.1 my-index --publisher-key "$PUBLISHER_PUBLIC_KEY" --network main --yes --no-install --json
```

Use `--config` for JSON settings or `--help` for every flag. Unknown options, missing required values and non-empty directories are refused. Inside the project, `node scripts/doctor.mjs --online --json` gives a structured result and returns non-zero on failure. No credentials appear in that result.

The generated README and `OPERATIONS.md` cover customisation, deployment and recovery. Continue in that project; the repository's source deployment is an alternative setup, not an additional step. Keep secrets private and header checks enabled. The starter refuses the synthetic fixture setting `scripts-only`; successful scaffolding is not evidence that application writes or blockchain settlement have been exercised. See [wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md), [evidence and freshness](../learn/evidence-and-freshness.md) and [prepare for production](../operate/production-readiness.md) for the next checks.
