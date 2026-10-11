# @bsv/create-dpp-app

Scaffold a Digital Product Passport application on BSV in one command.

This starter and its renamed protocol dependency are source candidates pending publication. The npm command below applies after both are published; use the development commands below to test them from this checkout.

```sh
npm create @bsv/dpp-app@0.1.0 my-app
cd my-app
npm test
npm run dev
```

You get a working application: a React web app with a brand dashboard, passport pages, hand-on acceptance and public verification; an Express API that owns a platform wallet, writes and reads passports with the `@bsv/dpp` packages, keeps a journal and runs the unattended duties; and a Compose service for the application database. The first run is an offline test of a whole passport lifecycle, with no wallet, funds, Docker or network. The template's README explains the rest, including the route to writing real passports.

## Choose the index connection

| You want to | What to use |
| --- | --- |
| Build the application | `@bsv/create-dpp-app`, this starter |
| Connect to an existing compatible index | Its URL, network and scoped access settings; no index starter required |
| Operate your own index | A separate project created by `@bsv/create-dpp-index`, which includes its runtime |

The app's Compose file starts only its database, so connecting a separately operated index cannot start another index accidentally. The app includes overlay library components for its offline exercises; those components do not deploy a persistent index. Do not manually install another overlay package as part of app setup. See the generated README's **Connect an index** section and [service choices](../../docs/start/choose-components-and-services.md).

## What it decides for you

- TypeScript throughout, Node 22 or later, npm workspaces.
- Web: React, Vite, React Router, Tailwind CSS, shadcn/ui, built to static files the API serves.
- API: Express 5; MongoDB for records, journal and sign-in; Better Auth for sign-in with organisations as brands; a journal-driven worker loop for proofs and re-announcements.
- Wallet: `@bsv/wallet-toolbox` as a library, service-owned, keys in a SQLite file.
- Custody: managed, the platform signs for signed-in users; the party interface keeps self-custody open.
- Identifiers: GS1 Digital Links under the demonstration prefix 952 until you set a licensed one.

Every opinion is a file you can change. The standard itself prefers none of them.

## Versions

Each release of this package scaffolds one DPP release set, named under `dpp` in `package.json`, with the exact package versions it pins. This source candidate uses `dpp-release-2026-10-8`: protocol and profiles `0.3.0-beta.9`, overlay topics `0.4.0-beta.11` and SDK `2.8.10`, matching the index starter. The generated app imports `@bsv/dpp-protocol` directly. Once published, a new release set requires a new starter version.

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

## Licence

Apache 2.0.
