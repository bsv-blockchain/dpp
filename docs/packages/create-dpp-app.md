# Create an application

Application developers can generate an editable passport app with `@bsv/create-dpp-app` and check its lifecycle offline. It includes React and Vite, an Express API, MongoDB configuration, Better Auth sign-in and passport workflows.

## Before you start

| Step | Requirements and source |
|---|---|
| Create a project | Node 22 or later, npm, network access to install dependencies and a new or empty destination; non-empty directories are refused |
| Check a source candidate | A DPP repository checkout and a new app directory; run the source commands below from the repository root |
| Offline lifecycle exercise | The generated project and installed dependencies; no wallet, funds, Docker or network |
| Activate live writes | Use the generated README to arrange wallet, funds and index admission. Stop before `npm run go-live` until these and write authority are established |

**Run the starter once.** It already declares and pins `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/sdk` and, for the offline exercise only, `@bsv/dpp-overlay`. The source candidate also declares the three validation libraries a profile held by a binding needs, `jsonld@9.0.0`, `n3@2.13.12` and `shacl-engine@1.1.3`. Do not add any of them again.

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
| In the source candidate: forms, validation and structured display for `eu-battery@1` and `eu-textile@1`, and registration of a bound profile from a folder | Your own forms, and the profiles you trust |

**The starter's passport host is not yet a resolver.** It answers each identifier's own path, `/01/<gtin>/21/<serial>`, with the passport page, so it does not meet the rule in [GS1 discovery](../interoperability/gs1-discovery.md#do-you-need-a-resolver) that the host a GS1 Digital Link identifier is minted under be a GS1-Conformant Resolver or redirect every `/01/` request to one. The generated README's next steps say what to change.

Change any of these files; the standard prefers none of these choices. [Issue and update passports](build-an-application.md) explains the included writer; [choose packages and services](../start/choose-components-and-services.md) identifies remaining services.

## Product documents under a binding

This section describes the source candidate `0.1.0-beta.2`. The published `0.1.0-beta.1` writes manifest profiles only.

The generated application writes and reads passports under the two bindings `@bsv/dpp-profiles` ships, `eu-battery@1` and `eu-textile@1` ([EU battery and textile bindings](../profiles/eu-sector-bindings.md)), and under a bound profile of your own. Each name states a data model. Neither claims that a product complies with any law.

| Step | What the application does |
|---|---|
| Start | Builds the validation engine once, registers the two bundled bindings under the shipped digest list and any folder you trust. It fetches nothing. Without the engine it still starts: a bound profile then cannot be written, and readings say not checked |
| Write | Takes the complete product document and the passport identifier it is about to sign, calls `prepareBoundPayload`, signs exactly the public payload returned and seals the restricted part as an owner tier. A document that fails, that could not be checked, or whose public part is over 65,535 bytes is refused before anything is signed |
| Read | Passes `bindingPayloadValidator` to the report as `payloadValidator`, so each state's payload is checked against that state's own passport identifier. For the holder it also opens the restricted part, after the owner-tier check, and runs the authorised view on the rejoined document |
| Show | Reports the public view and the authorised view apart, with each property's tier and the findings. A check that could not run is shown as not checked, never as passed |

1. Run `npm run dev` in the generated project and open the web app.
2. Issue a passport and choose `eu-battery@1` or `eu-textile@1`.
3. Select **Load example** for a document of invented data under the demonstration prefix, or enter your own. The item reference and serial you enter make the passport identifier, and the form writes the document's own identifier, GTIN and serial from them.
4. Read the **Public** and **Restricted** label on every property, then the two lists under **Before you write it**. Public data is on chain for good. A restricted value you repeat inside a public property is published with it.
5. Confirm the public list and issue. If the API refuses the document, each finding appears at the field it concerns.
6. Open the passport. The page shows the product data as structure, the public view, and for the holder the owner-tier check and the authorised view.

To try a product document of your own, select **Load a document from a file**. The form removes any member whose name starts with `_comment`, which the profiles' contexts do not define, and keeps a property it has no field for as JSON, unchanged. The examples the application ships were written for it. It carries no third-party product document.

### Register a profile of your own

A bound profile is a folder: `binding.json` and the files it names ([write a binding](dpp-profiles.md#write-a-binding)). Name the folder and the digest of its binding in the generated project's `.env`:

```sh
CUSTOM_PROFILE_DIRS=profiles/example-bottle@1
TRUSTED_BINDING_DIGESTS=<SHA-256 of that folder's binding.json>
```

| Setting | Value |
|---|---|
| `CUSTOM_PROFILE_DIRS` | Folders, comma-separated. A relative folder is read from the project root |
| `TRUSTED_BINDING_DIGESTS` | The SHA-256 of each `binding.json` you reviewed, 64 lower-case hexadecimal characters, comma-separated. A value in any other form stops the start and names the setting |

The folder is registered at start with no source change. A folder whose digest is not listed, or whose files changed since you trusted it, is refused in the start-up log and on the Operations page with its code, and the application runs without it. An untrusted folder's refusal names the digest of the file it found, so you can review that file and then trust it. The generated project holds the repository's two example profiles under `apps/api/test/fixtures/custom-profile/` to try this with. A profile with no form in the web app is written as a JSON document.

### What the candidate does not do

- It imports, pulls and exports no EPCIS events.
- It retires no profile: `battery@2`, `textile@2` and `general@2` work as before.
- After a hand-on the restricted part stays sealed to the holder who wrote it. The new holder's authorised view is not checked until they write an update.
- The web app has no test runner. Its form logic is tested by the API's tests, and its pages are type-checked by the build.

## Automated setup

```sh
npx @bsv/create-dpp-app@0.1.0-beta.1 my-app --yes --no-install
```

Use `--help` for every flag. A successful offline exercise does not establish readiness for production; complete the generated guide and [prepare for production](../operate/production-readiness.md).
