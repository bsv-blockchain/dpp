# Create an application

Application developers can generate an editable passport app with `@bsv/create-dpp-app` and check its lifecycle offline. It includes React and Vite, an Express API, MongoDB configuration, Better Auth sign-in and passport workflows.

## Before you start

| Step | Requirements and source |
|---|---|
| Create a project | Node 22 or later, npm, network access to install dependencies and a new or empty destination; non-empty directories are refused |
| Check a source candidate | A DPP repository checkout and a new app directory; run the source commands below from the repository root |
| Offline lifecycle exercise | The generated project and installed dependencies; no wallet, funds, Docker or network |
| Activate live writes | Use the generated README to arrange wallet, funds and index admission. Stop before `npm run go-live` until these and write authority are established |

**Run the starter once.** It already declares and pins `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/sdk` and, for the offline exercise only, `@bsv/dpp-overlay`. Do not add them again.

| Part | What it does | Your action |
| --- | --- | --- |
| `@bsv/create-dpp-app` | Creates your project | Run the setup command below |
| Your generated project | Holds the web app, the API, its wallet, configuration and deployment files | Run its commands to develop, test and deploy |
| `@bsv/dpp-protocol` and `@bsv/dpp-profiles` | Write and read passports inside that project | Included automatically with the project's dependencies |

Connect over HTTP to a compatible index, or [run your own](../operate/README.md) from the repository's Compose preset. The app's Compose file starts only its database, never an index.

## Create your project

| Starter route | Pinned release | Runtime versions |
|---|---|---|
| Published `0.1.0-beta.1` | `dpp-release-2026-10-10`, superseded as the source target but the last published set; also used by the published, now retired, index starter | Protocol and profiles `0.3.0-beta.9`, overlay `0.4.0-beta.12`, SDK `2.8.10` |
| Source | Current candidate `dpp-release-2026-11`, not yet published | Protocol and profiles `0.3.0-beta.10`, overlay `0.4.0-beta.13` |

### Create and check offline

Run the following sequence one step at a time:

1. Create the project and enter `my-app`.
2. Run `npm test` for the offline lifecycle exercise.
3. Run `npm run dev` to serve the app with an index in this process.
4. Stop before the final command until you have met the live requirements below.

```sh
npm create @bsv/dpp-app@0.1.0-beta.1 my-app
cd my-app
npm test
npm run dev
npm run go-live
```

To test a source candidate instead, run these commands from the DPP repository root, choosing a new directory for the app:

```sh
npm ci
npm run build
npm run starter:check -- --directory ../my-app
```

The source check installs the packed generator, creates the app, installs local runtime archives, then builds, typechecks and tests it. It publishes nothing.

### Stop before activating live writes

`npm run go-live` registers the app's publisher key with the default testnet index, checks the wallet, funds and admission, and switches real writes on. Use the generated README for each check's inputs and mainnet settings. Its `connect-index` command connects another provider's index or your own: with `--from`, it takes the connection file an index operator writes with `dpp-index connection` ([connect an application](../operate/README.md#connect-an-application)). It then runs the same checks and, when all pass, switches real writes on as `go-live` does.

## What is included

| Included | Your choice |
| --- | --- |
| Brand dashboard, passport pages, hand-on acceptance and public verification | Branding, routes and screens |
| A service-owned wallet using `@bsv/wallet-toolbox` as a library, keys in a SQLite file | Funding, backup and the move to a production wallet |
| Managed custody, the platform signs for signed-in users | Self-custody, through the party interface |
| MongoDB for records, journal and sign-in, started by the app's Compose file | A managed database |
| A journal-driven worker for proofs and re-announcements | Scheduling and monitoring |
| GS1 Digital Link identifiers under the demonstration prefix 952 | A licensed GS1 prefix |

**The starter's passport host is not yet a resolver.** It answers each identifier's own path, `/01/<gtin>/21/<serial>`, with the passport page, so it does not meet the rule in [GS1 discovery](../interoperability/gs1-discovery.md#do-you-need-a-resolver) that the host a GS1 Digital Link identifier is minted under be a GS1-Conformant Resolver or redirect every `/01/` request to one. The generated README's next steps say what to change.

Change any of these files; the standard prefers none of these choices. [Issue and update passports](build-an-application.md) explains the included writer; [choose packages and services](../start/choose-components-and-services.md) identifies remaining services.

## Automated setup

```sh
npx @bsv/create-dpp-app@0.1.0-beta.1 my-app --yes --no-install
```

Use `--help` for every flag. A successful offline exercise does not establish readiness for production; complete the generated guide and [prepare for production](../operate/production-readiness.md).
