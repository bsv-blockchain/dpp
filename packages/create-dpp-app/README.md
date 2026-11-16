# @bsv/create-dpp-app

Scaffold a Digital Product Passport application on BSV in one command.

This starter and its renamed protocol dependency are source candidates pending publication. The npm command below applies after both are published; use the development commands below to test them from this checkout.

```sh
npm create @bsv/dpp-app@0.1.0-beta.2 my-app
cd my-app
npm test
npm run dev
```

You get a working application: a React web app with a brand dashboard, passport pages, hand-on acceptance and public verification; an Express API that owns a platform wallet, writes and reads passports with the `@bsv/dpp` packages, keeps a journal and runs the unattended duties; and a Compose service for the application database. The first run is a test of a whole passport lifecycle, with no wallet, funds or Docker. The template's README explains the rest, including the route to writing real passports.

In this source candidate the application also imports EPCIS 2.0 documents, pulls events from a configured source and exports what it received, byte for byte, by calling `@bsv/dpp-credentials/epcis-exchange`. Its tests of that fetch two things once and keep them: the three EPCIS files GS1 publishes, from `https://ref.gs1.org`, and a MongoDB server binary for the storage tests. The generated README's **EPCIS exchange** section covers the pages, the settings and the store.

It writes and reads passports under the manifest profile `general@2` and under profiles held by a binding: the two the profiles package ships, `eu-battery@1` and `eu-textile@1`, each with a form for its nested product data, and a profile of your own registered from a folder whose binding digest you trust. Under a binding the product document is split into a public part, on chain for good, and a restricted part, sealed off chain. The earlier sector manifest profiles are retired: the application offers none of them and refuses a write under one with `profile-retired`. The generated README's **Product documents under a binding** section covers the forms, the two views a reader is shown and the validation engine.

## Choose the index connection

| You want to | What to use |
| --- | --- |
| Build the application | `@bsv/create-dpp-app`, this starter |
| Connect to an existing compatible index | Its URL, network and scoped access settings |
| Operate your own index | The repository's operator preset, [`deploy/`](../../deploy/README.md): the index image and MongoDB on Docker Compose, whose `dpp-index connection` writes the file `npm run connect-index -- --from <file>` reads |

The app's Compose file starts only its database, so connecting a separately operated index cannot start another index accidentally. The app includes overlay library components for its offline exercises; those components do not deploy a persistent index. Do not manually install another overlay package as part of app setup. See the generated README's **Connect an index** section and [service choices](../../docs/start/choose-components-and-services.md).

## What it decides for you

- TypeScript throughout, Node 22 or later, npm workspaces.
- Web: React, Vite, React Router, Tailwind CSS, shadcn/ui, built to static files the API serves.
- API: Express 5; MongoDB for records, journal and sign-in; Better Auth for sign-in with organisations as brands; a journal-driven worker loop for proofs and re-announcements.
- Wallet: `@bsv/wallet-toolbox` as a library, service-owned, keys in a SQLite file.
- Custody: managed, the platform signs for signed-in users; the party interface keeps self-custody open.
- Identifiers: GS1 Digital Links under the demonstration prefix 952 until you set a licensed one.
- Validation: Ajv for manifest profiles; `jsonld`, `n3` and `shacl-engine`, at the versions `@bsv/dpp-profiles` is tested with, for profiles held by a binding. Nothing is fetched while validating. With `VALIDATOR_URL` set, the same two engines are asked of a validator service through `@bsv/dpp-profiles/validator-client` instead, and a service that does not answer blocks a write as missing libraries do.
- EPCIS: `@bsv/dpp-credentials/epcis-exchange` for import, pull and export, over a MongoDB storage adapter the template carries. An event is supplied data, kept apart from every passport: an import signs nothing and never reaches the wallet.
- Lifecycle claims: EPCIS lifecycle claims, `dpp-epcis-lifecycle@1` from `@bsv/dpp-credentials/epcis-lifecycle`, signed from an event a member enters or one the exchange retained, bound to the passports the event names and verified one finding at a time; native `dpp-lifecycle-v1` claims issued before are read and labelled historical, and no new one is issued.

- Moving: `export` and `restore` commands that carry the whole application as one signed `dpp-evidence-package@1` and restore it into another deployment, calling the profile bundle of `@bsv/dpp-profiles` and the recovery snapshot of `@bsv/dpp-credentials/epcis-exchange`. No package carries a key or a credential.

Every opinion is a file you can change. The standard itself prefers none of them.

## Versions

Each release of this package scaffolds one DPP release set, named under `dpp` in `package.json`, with the exact package versions it pins. This source candidate uses `dpp-release-2026-11`: protocol and profiles `0.3.0-beta.10`, overlay `0.4.0-beta.13`, credentials `0.2.0-beta.6` and SDK `2.8.10`, the runtime the repository's index image builds. The generated app imports `@bsv/dpp-protocol` directly. Once published, a new release set requires a new starter version.

## Development

This package is a workspace of the DPP standard's repository, published separately from its four runtime packages. Publish the pinned runtime set before the starter. From the repository root, test the source candidate:

```sh
npm ci
npm run build
npm test -w @bsv/create-dpp-app
npm run starter:check
```

The check installs the packed generator outside the repository, creates an app and uses local archives for the pinned DPP runtime. It then installs dependencies, builds, typechecks and runs the generated app's tests, including a check that `@bsv/dpp-core` is absent. The template keeps exact npm versions; archive paths are written only into the local test project.

To retain an editable app at a new directory, use:

```sh
npm run starter:check -- --directory ../my-app
```

Before publication, run the separate registry prerequisite check after the runtime packages are available:

```sh
npm run starter:check -- --registry-dependencies
```

This mode uses a fresh npm cache, installs the template's exact versions from public npm, and refuses missing dependencies without substituting local archives. The starter publication workflow requires it. Candidate checks establish neither registry availability nor blockchain inclusion.

For the CI image check, `--prepare-only --directory /tmp/my-app` creates the app and candidate archives without installing or testing. Its `.candidate.Dockerfile` adds the archive copy before the template's existing dependency installation; the bundled Dockerfile is unchanged. The image check builds that file and checks the API health endpoint.

The template lives in `template/`; files that tooling treats specially ship with a leading underscore (`_gitignore`, `_env.example`) and are renamed when scaffolded. Make template changes there, then regenerate and check a fresh app.

Two things in the template are copies or inventions, and the package's tests hold them to their sources:

- `template/apps/api/test/fixtures/custom-profile/` is a byte-for-byte copy of the repository's `examples/custom-profile/`, so a generated app can test a profile registered from a folder with no checkout beside it.
- The battery and textile examples in `template/apps/api/src/sector-examples.ts` were written for the starter: invented organisations and values, under the GS1 demonstration prefix 952. The template carries no third-party product document.

The web app has no test runner. The modules that decide what a form writes and where a finding is shown, under `template/apps/web/src/lib/bound/`, touch neither the page nor the network, and the API's tests exercise them (`apps/api/test/sector-forms.test.ts`). The same holds for the words the events page puts on an import, a pull and an event, in `template/apps/web/src/lib/epcis.ts` (`apps/api/test/epcis-web.test.ts`). The pages themselves are type-checked by the build.

The generated app's exit exercise, `apps/api/test/exit-exercise.test.ts`, builds one deployment, exports it, stops its database and its index, and restores into a second deployment with another store and another source of profiles. `npm run starter:check -- --exit-record deploy/evidence/exit-exercise.json` writes the record of that run. Both deployments are in one test process, with the reference index's code, the test wallet and the development session standing in for an index, a wallet and sign-in: the record says so.

The generated app's EPCIS tests need the pinned GS1 files and one MongoDB node in memory. `npm run starter:check` hands the generated app the repository's own GS1 cache, `node_modules/.cache/dpp-gs1`, when a test run has filled it; otherwise the app's test set-up fetches the files from `https://ref.gs1.org`. The MongoDB binary is the one the `@bsv/dpp-overlay` tests use, from the same cache.

## Licence

Apache 2.0.
