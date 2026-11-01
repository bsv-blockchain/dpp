# Create an application

Start here to build a passport application. `@bsv/create-dpp-app` generates an editable application with a React and Vite web app, an Express API, MongoDB configuration and Better Auth sign-in. It includes passport workflows and an offline lifecycle exercise that runs without a wallet, funds, Docker or network.

**Use the starter once. It includes the runtime packages.** The generated application already declares and pins `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/sdk` and, for its offline exercise only, `@bsv/dpp-overlay`; do not add them a second time.

| Part | What it does | Your action |
| --- | --- | --- |
| `@bsv/create-dpp-app` | Creates your project | Run the setup command below |
| Your generated project | Holds the web app, the API, its wallet, configuration and deployment files | Run its commands to develop, test and deploy |
| `@bsv/dpp-protocol` and `@bsv/dpp-profiles` | Write and read passports inside that project | Included automatically with the project's dependencies |

The application connects to an index over HTTP. Use an existing compatible index, or create a separate project with [the index starter](create-dpp-index.md), which includes its own runtime. The app's Compose file starts only its database and never an index.

## Create your project

The published starter, `0.1.0-beta.1`, pins the superseded `dpp-release-2026-10-10`, the last published set: protocol and profiles `0.3.0-beta.9`, overlay `0.4.0-beta.12` and SDK `2.8.10`, the same set as the index starter. The source starter pins the current candidate `dpp-release-2026-11`, protocol and profiles `0.3.0-beta.10` and overlay `0.4.0-beta.13`, not yet published. With Node 22 or later:

```sh
npm create @bsv/dpp-app@0.1.0-beta.1 my-app
cd my-app
npm test
npm run dev
```

The first run is an offline test of a whole passport lifecycle. The generated README explains the rest, including the route to writing real passports, connecting an index and deploying.

To test a source candidate instead, run these commands from the DPP repository root, choosing a new directory for the app:

```sh
npm ci
npm run build
npm run starter:check -- --directory ../my-app
```

This installs the packed generator, creates the app, installs local runtime archives, then builds, typechecks and tests it. It publishes nothing.

## What is included

| Included | Your choice |
| --- | --- |
| Brand dashboard, passport pages, hand-on acceptance and public verification | Branding, routes and screens |
| A service-owned wallet using `@bsv/wallet-toolbox` as a library, keys in a SQLite file | Funding, backup and the move to a production wallet |
| Managed custody, the platform signs for signed-in users | Self-custody, through the party interface |
| MongoDB for records, journal and sign-in, started by the app's Compose file | A managed database |
| A journal-driven worker for proofs and re-announcements | Scheduling and monitoring |
| GS1 Digital Link identifiers under the demonstration prefix 952 | A licensed GS1 prefix |

Every opinion is a file you can change. The standard itself prefers none of them. [Issue and update passports](build-an-application.md) explains the writer the generated application runs, and [choose packages and services](../start/choose-components-and-services.md) explains which services you still need.

## Automated setup

```sh
npx @bsv/create-dpp-app@0.1.0-beta.1 my-app --yes --no-install
```

Use `--help` for every flag. Non-empty directories are refused. A successful offline exercise does not establish readiness for production; complete the generated guide and [prepare for production](../operate/production-readiness.md).
