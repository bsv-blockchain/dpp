# @bsv/create-dpp

Scaffold a Digital Product Passport application on BSV in one command.

```sh
npm create @bsv/dpp my-app
cd my-app
npm test
npm run dev
```

You get a working application: a React web app with a brand dashboard, passport pages, hand-on acceptance and public verification; an Express API that owns a platform wallet, writes and reads passports with the `@bsv/dpp` packages, keeps a journal and runs the unattended duties; and Compose services for MongoDB and the reference DPP index. The first run is an offline test of a whole passport lifecycle, with no wallet, funds, Docker or network. The template's README explains the rest, including the route to writing real passports.

## What it decides for you

- TypeScript throughout, Node 22 or later, npm workspaces.
- Web: React, Vite, React Router, Tailwind CSS, shadcn/ui, built to static files the API serves.
- API: Express 5; MongoDB for records, journal and sign-in; Better Auth for sign-in with organisations as brands; a journal-driven worker loop for proofs and re-announcements.
- Wallet: `@bsv/wallet-toolbox` as a library, service-owned, keys in a SQLite file.
- Custody: managed, the platform signs for signed-in users; the party interface keeps self-custody open.
- Identifiers: GS1 Digital Links under the demonstration prefix 952 until you set a licensed one.

Every opinion is a file you can change. The standard itself prefers none of them.

## Versions

Each release of this package scaffolds one DPP release set, named under `dpp` in `package.json`, with the exact package versions it pins. A new release set means a new version here.

## Development

This package is a workspace of the DPP standard's repository, published separately from the four protocol packages: it consumes a published release set and follows it. From the repository root:

```sh
npm ci
npm run build -w @bsv/create-dpp   # the CLI
npm test -w @bsv/create-dpp        # the CLI's own tests
npm run starter:check              # scaffold into a temporary directory, install from the registry, build and run the template's tests
```

The template lives in `template/`; files that tooling treats specially ship with a leading underscore (`_gitignore`, `_env.example`) and are renamed when scaffolded. To work on the template itself, run `npm install` inside `template/`; that install never enters the repository or the package.

## Licence

Apache 2.0.
