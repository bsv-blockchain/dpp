# Create an application

Application developers can generate an editable passport app with `@bsv/create-dpp-app` and check its lifecycle offline. It includes React and Vite, an Express API, MongoDB configuration, Better Auth sign-in and passport workflows.

## Before you start

| Step | Requirements and source |
|---|---|
| Create a project | Node 22 or later, npm, network access to install dependencies and a new or empty destination; non-empty directories are refused |
| Check a source candidate | A DPP repository checkout and a new app directory; run the source commands below from the repository root |
| Offline lifecycle exercise | The generated project and installed dependencies; no wallet, funds, Docker or network. In the source candidate `npm test` also tests EPCIS exchange, and its first run fetches the three pinned GS1 files and a MongoDB test binary once ([EPCIS exchange](#epcis-exchange)) |
| Activate live writes | Set up the wallet, funds and index admission for the selected network. [Testnet and mainnet setup](#run-the-published-starter-on-testnet-or-mainnet) |

**Run the starter once.** It already declares and pins `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/sdk` and, for the offline exercise only, `@bsv/dpp-overlay`. The source candidate also declares the three validation libraries a profile held by a binding needs, `jsonld@9.0.0`, `n3@2.13.12` and `shacl-engine@1.1.3`, and `@bsv/dpp-credentials` for EPCIS exchange. Do not add any of them again.

| Part | What it does | Your action |
| --- | --- | --- |
| `@bsv/create-dpp-app` | Creates your project | Run the setup command below |
| Your generated project | Holds the web app, the API, its wallet, configuration and deployment files | Run its commands to develop, test and deploy |
| `@bsv/dpp-protocol` and `@bsv/dpp-profiles` | Write and read passports inside that project | Included automatically with the project's dependencies |

The app’s Compose file starts its database. For live writes, connect over HTTP to an index compatible with your starter version. The [network setup guide](#run-the-published-starter-on-testnet-or-mainnet) covers hosted and self-hosted indexes for the published starter.

## Create your project

| Starter route | Pinned release | Runtime versions |
|---|---|---|
| Published `0.1.0-beta.1` | `dpp-release-2026-10-10`, superseded as the source target but the last published set; also used by the published, now retired, index starter | Protocol and profiles `0.3.0-beta.9`, overlay `0.4.0-beta.12`, SDK `2.8.10` |
| Source | Current candidate `dpp-release-2026-11`, not yet published | Protocol and profiles `0.3.0-beta.10`, overlay `0.4.0-beta.13` |

### Create and check offline

The published starter installs its dependencies when it creates the project. Run its offline lifecycle exercise, then start the development server.

```sh
npm create @bsv/dpp-app@0.1.0-beta.1 my-app
cd my-app
npm test
npm run dev
```

Open the **Local** URL. To issue a first test passport with the development defaults, choose **Your brands**, **Development brand**, then **Issue a passport**. Select `general@2`, enter `000000001` for **Item reference** and `DEMO-001` for **Serial**, keep the sample product details and click **Issue the passport**.

If another service uses port `3000`, stop the starter with `Ctrl+C`. On macOS or Linux, run `PORT=3001 API_URL=http://127.0.0.1:3001 npm run dev` from the generated app folder to use port `3001` for the API.

To test a source candidate instead, run these commands from the DPP repository root, choosing a new directory for the app:

```sh
npm ci
npm run build
npm run starter:check -- --directory ../my-app
```

The source check installs the packed generator, creates the app, installs local runtime archives, then builds, typechecks and tests it. It publishes nothing.

For release qualification, use the four archives written by `npm run release:candidates`. The checker verifies the release set and the recorded size, SHA-256 and npm integrity of each archive before creating the app. To retain the generator that the check actually installs, supply an output file alongside the exit and dependency records.

```sh
npm run starter:check -- --candidate-record release/candidates.json \
  --starter-archive ../create-dpp-app-candidate.tgz \
  --exit-record ../starter-exit.json --dependency-record ../starter-dependencies.json
```

The dependency record identifies the generator and all four installed runtime archives by SHA-256 and npm integrity. For a project with the same archives ready for a separate install, use `--prepare-only --directory ../my-app`.

### Stop before activating live writes

Choose the instructions for the starter you installed. The published starter uses manual network configuration. The November source candidate adds a go-live command.

### Run the published starter on testnet or mainnet

The passport format and verification rules are the same on both networks. The published starter (`0.1.0-beta.1`) reads its network from the generated app’s `.env`. Copy `.env.example` to `.env` for a new installation. The example defaults to `NETWORK=main`, so set the network explicitly before creating or funding the wallet.

| Setting | Testnet | Mainnet |
|---|---|---|
| Network | `NETWORK=test` | `NETWORK=main` |
| Wallet funding | Free testnet BSV from the [BSV faucet](https://bsvfaucet.com/) | A payment from a funded mainnet BSV wallet |
| Index access | Arrange a testnet index with an operator or [run your own matching index](#run-your-own-matching-index). | The hosted mainnet index allows public reads. Arrange write access with an operator or run your own index. [Hosted services and access](../deployment.md) |

1. **Configure one app per network.** Give each its own `.env`, `WALLET_ROOT_KEY`, `WALLET_FILE` and `MONGO_DB`. Generate each wallet root key with `openssl rand -hex 32`. Keep `LIVE_PUBLISHING=false` while you set up MongoDB, the identity secrets and the WhatsOnChain header service (`WOC_API_KEY`). [Published starter setup](https://github.com/bsv-blockchain/dpp/blob/0e45ac32da351c1e877431d55e2e9c0c41f54c33/packages/create-dpp-app/template/README.md#going-live)
2. Run `npm run wallet` from the generated app. Check for **Wallet: toolbox on test** or **Wallet: toolbox on main** before sending funds. Save the funding command it prints. It contains the receiving address and its derivation prefix and suffix. Give the index operator the **public publisher key** printed separately.
3. On testnet, open the faucet, choose **Get testnet BSV**, sign in and paste the funding address as the destination. On mainnet, pay the mainnet funding address from your own wallet. Keep the payment transaction ID. Run the command below with that ID and the address, prefix and suffix from step 2. Run `npm run wallet` again to confirm the balance.

   ```sh
   npm run wallet -- fund <txid> <address> <prefix> <suffix>
   ```

4. **Connect the index.** Ask its operator to admit your public publisher key and provide the server-side settings `INDEX_URL`, `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN`. Check the index’s `/health` for the selected network and `/capabilities` for your publisher key and the published starter’s `managed-custody@1` profile.
5. **Enable publishing.** For real products, set `GS1_PREFIX` to your licensed GS1 company prefix and `PASSPORT_HOST` to a domain you control. Once you have confirmed the wallet balance and index access, set `LIVE_PUBLISHING=true` and restart the app. Testnet writes use test coins. Mainnet writes spend real BSV.

#### Run your own matching index

From the parent directory of your app, run the command below. At the prompts, supply the public publisher key from `npm run wallet` and choose `test` or `main` to match the app. This generator provides the `managed-custody@1` profile used by the published starter.

```sh
npm create @bsv/dpp-index@0.1.0-beta.1 my-index
```

Start Docker with Compose v2, then run these commands. The online check verifies the index’s network, custody profile and publisher key. The last command writes the four connection settings to `my-index/.app.env`. Copy them into the app’s server-side `.env`, then complete step 5 above.

```sh
cd my-index
npm run up
npm run doctor -- --online
npm run connection
```

### Run the November source candidate

The source candidate adds `npm run go-live` to request publisher registration and check wallet funding and index admission. Its go-live check requires `managed-custody@2`. To use another compatible index, run `npm run connect-index -- --from <file>` with the connection file from its operator. Both commands enable publishing when all checks pass. [Connect an application](../operate/README.md#connect-an-application)

## What is included

| Included | Your choice |
| --- | --- |
| Brand dashboard, passport pages, hand-on acceptance and public verification | Branding, routes and screens |
| A service-owned wallet using `@bsv/wallet-toolbox` as a library, keys in a SQLite file | Funding, backup and the move to a production wallet |
| Managed custody, the platform signs for signed-in users | Self-custody, through the party interface |
| MongoDB for records, journal and sign-in, started by the app's Compose file | A managed database |
| A journal-driven worker for proofs and re-announcements | Scheduling and monitoring |
| GS1 Digital Link identifiers under the demonstration prefix 952 | A licensed GS1 prefix |
| In the source candidate: a GS1 resolver for those identifiers at the passport host, with the passport page as each item's default link | Further links, such as your own product page |
| In the source candidate: forms, validation and structured display for current and historical battery and textile passports, and registration of a bound profile from a folder | Your own forms, and the profiles you trust |
| In the source candidate: EPCIS file import, a configured pull and exact export, over a MongoDB storage adapter | Your sources, and what you do with the events |
| In the source candidate: a choice of validation engine by setting, in the API's process or in a validator service | Which service, and who runs it |
| In the source candidate: `export` and `restore` commands that move the whole application as one signed evidence package | Where the package is kept, and the keys and credentials you carry separately |

**The starter's passport host resolves its identifiers.** In the source candidate the API answers each identifier it issued at the identifier's own path, as [GS1 discovery](../interoperability/gs1-discovery.md#do-you-need-a-resolver) asks of the host a GS1 Digital Link identifier is minted under. The published `0.1.0-beta.1` answers that path with the passport page and is not a resolver.

| Request to the generated application | Answer |
|---|---|
| `/01/<gtin>/21/<serial>` | 307 to the passport page at `/passport/01/<gtin>/21/<serial>`, the item's `gs1:dpp` default link, with the query string passed on |
| The same with `Accept: application/linkset+json` or `?linkType=linkset` | The JSON linkset, never a redirect: the item's links, then its GTIN's |
| `/01/<gtin>`, or a serial no passport was issued for under a GTIN that has passports | 307 to a product page at `/passport/01/<gtin>`, the GTIN's `gs1:pip` default link. The page holds no passport and says so |
| A compressed identifier that carries an EPC binary string | Decompressed, then answered as the identifier it spells |
| A malformed identifier; a GTIN no passport was issued under | 400; 404 |
| `/.well-known/gs1resolver` | The resolver description file |

The application makes the records from its journal for each request and answers with `describeResolver`, `resolveLinks` and `linksetDocument` of `@bsv/dpp-profiles`, after `resolutionRecordProblems` and `resolutionSetProblems`. It lists only pages it serves, so no evidence package and no master data. The generated project's `apps/api/test/identifier-host.test.ts` asks each of these over HTTP. It answers a linkset request with JSON whatever the `Accept`, and only for identifiers under its own `PASSPORT_HOST`.

Change any of these files; the standard prefers none of these choices. [Issue and update passports](build-an-application.md) explains the included writer; [choose packages and services](../start/choose-components-and-services.md) identifies remaining services.

## Product documents under a binding

This section describes the source candidate `0.1.0-beta.2`. The published `0.1.0-beta.1` writes manifest profiles only.

The generated application offers `eu-battery@2` and `eu-textile@2` for new sector passports. The version 2 bindings check the identified product's type against their pinned ontology. An existing `eu-battery@1` or `eu-textile@1` passport retains its signed binding and can be read, updated or handed on. Each profile names a data model. [EU battery and textile bindings](../profiles/eu-sector-bindings.md)

The starter trusts the four packaged binding digests by default. `GET /api/profiles` lists every registered edition and includes `issueSuccessor` on its two historical entries. An explicit new ISSUE under a version 1 sector binding returns HTTP 409 with `profile-superseded` and its successor in `replacedBy`. An application-owned binding requires the operator's explicit digest. If `PROFILE_BUNDLE_DIR` contains an older bundle with only version 1, install a reviewed offline bundle containing both editions or use the installed package as the binding source before issuing under version 2.

| Step | What the application does |
|---|---|
| Start | Builds the validation engine once, registers the four bundled bindings under the shipped digest list and any folder you trust. It fetches nothing. Without the engine it still starts: a bound profile then cannot be written, and readings say not checked |
| Write | Takes the complete product document and the passport identifier it is about to sign, calls `prepareBoundPayload`, signs exactly the public payload returned and seals the restricted part as an owner tier. A document that fails, that could not be checked, or whose public part is over 65,535 bytes is refused before anything is signed |
| Read | Passes `bindingPayloadValidator` to the report as `payloadValidator`, so each state's payload is checked against that state's own passport identifier. For the holder it also opens the restricted part, after the owner-tier check, and runs the authorised view on the rejoined document |
| Show | Reports the public view and the authorised view apart, with each property's tier and the findings. A check that could not run is shown as not checked, never as passed |

1. Set `LIVE_PUBLISHING=false` in the generated project, run `npm run dev` and open the web app.
2. Choose **Issue a passport** and select `eu-battery@2` or `eu-textile@2`.
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

On a managed transfer the giver checks the restricted bytes against the signed predecessor, encrypts their contents to the recipient and commits the new ciphertext. The recipient can open it immediately. An older transfer that kept the original ciphertext still needs the key used for that ciphertext.

### What the candidate does not do

- It captures no EPCIS events, subscribes to none, reads no EPCIS XML and maps no event to a passport state ([EPCIS exchange](#epcis-exchange)).
- It writes nothing under a retired profile. `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4` are not offered, a write under one is refused with `profile-retired`, and a record that declares one reads as not checked, with the replacement named. `general@2` works as before ([move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles)).
- It converts nothing. A passport already in the journal under a retired profile stays there as written, and it gets no further state, hand-on or claim.
- The web app has no test runner. Its form logic is tested by the API's tests, and its pages are type-checked by the build.
- An export carries no key, credential, sign-in account, session or brand membership, and the API serves neither command over HTTP ([export and restore](#export-and-restore)).

## Lifecycle claims

This section describes the source candidate `0.1.0-beta.2`. The published `0.1.0-beta.1` issues native `dpp-lifecycle-v1` claims with one of four event types.

The generated application issues lifecycle claims only as EPCIS lifecycle claims, `dpp-epcis-lifecycle@1` ([the EPCIS lifecycle claim](add-a-claim.md#the-epcis-lifecycle-claim)). A signed-in member signs one EPCIS 2.0.1 event of the five types, either one they enter on the passport's page or one the EPCIS exchange retained. A retained event is signed exactly as received, with a link back to its import, and never as the observer. Nothing is made from a passport operation, a metadata edit or a sale.

Before the member signs, set `LIFECYCLE_AUTHORITY_GRANTS_FILE` to the absolute path of an operator-managed JSON file and restart the API. The file contains a `grants` array. Each entry names the issuer DID, compressed `issuerKey`, exact `passportId`, `role`, `purpose`, and UTC `validFrom` and `validUntil`. The EPCIS event time must fall within that interval, including the start and excluding the end. A multi-product event needs a matching grant for every passport it binds.

Use `purpose: "claim"` for an ordinary grant. A correction requires the original signed claim and the issuer's applicable role grant. A corrector acting for another issuer additionally needs `purpose: "error-declaration"` for each affected passport. The generated README's **Lifecycle claims** section shows how to derive the public DID and identity key from the intended member's configured identity and prepare an entry. Missing authority evidence returns `authority-unavailable`. A configured file without a matching grant returns `authority-unconfirmed`.

| Part | What the application does |
|---|---|
| Bindings | Matches the event's own identifiers to the application's passports under the identity rules of `@bsv/dpp-profiles`. An item identifier binds that item's passport, written as a GS1 Digital Link or an EPC URN; a quantity element's class binds at class level only, which never says an item took part. An event that names none of the passports is refused |
| Signing | Checks the pinned EPCIS 2.0.1 schema and the operator’s role, purpose and event-time grant for every bound passport before the member’s managed wallet signs. Keeps the exact signed bytes |
| Anchoring | Only when the member asks: the exact bytes go to the configured registry, which anchors them once per bound passport in one transaction on the index's `tm_attestation`. Check the receiving registry’s advertised representation before requesting submission |
| Reading | A passport lists the claims whose anchors name it and those the application holds that bind it. Each is verified, and only a verified binding makes the passport part of the event, as an item or by its class. Each finding is shown on its own: event structure, semantics, product binding, signature, authority, possession, ownership, anchor, inclusion and correction. The reader checks the operator’s independent evidence for the issuer’s role on each bound passport at the event time. An anchor is never shown as proof of the event, of ownership or of compliance |
| Corrections | A correction records the referenced event in a new signed claim. Readers verify the original, the declaration and the corrector’s authority |
| Historical claims | The native claims the application issued before are kept as they were signed, verify under their own rules and are shown apart, labelled historical. No new one is issued, and a request for one is refused |
| Export | Carries each EPCIS lifecycle claim once, as its exact bytes, and the restoring deployment verifies them before it writes anything |

This replaces lifecycle issuance in the starter only. Other producers of native claims, including any application already deployed from an earlier version of the starter, still issue `dpp-lifecycle-v1` until they change, and a reader keeps verifying that format.

## EPCIS exchange

This section describes the source candidate `0.1.0-beta.2`. The published `0.1.0-beta.1` has no EPCIS exchange.

The generated application imports EPCIS 2.0 documents, pulls events from a source you configure and exports what it received, byte for byte. It does this by calling `@bsv/dpp-credentials/epcis-exchange` ([durable EPCIS import](dpp-credentials.md#durable-epcis-import) and [EPCIS query pull](dpp-credentials.md#epcis-query-pull)). The application supplies the storage, the routes and the pages. It holds no second import, pull or export of its own.

**An event is supplied data.** An import or a pull changes no custody, signs nothing, writes nothing on chain and never calls the wallet. A document that is valid passed a check of its format. It is not signed, and nothing verifies who observed an event or that it happened.

| Part | What the application does |
|---|---|
| Start | Obtains the three pinned GS1 files into `DPP_GS1_ARTEFACTS_DIR`, checks each against its digest, and logs one line: present, fetched or unavailable. Without them it still starts, and refuses every import and pull with how to provide them. It then runs the module's recovery and logs what it did, before it accepts a request |
| Import | Takes an uploaded document as the exact bytes that arrived, under a request identifier the client chose. The same identifier with the same bytes is the same request and keeps one import. With other bytes it is refused, and the first import stands |
| Refusal | A transport that cannot be kept is answered with a status that says why, and nothing of it is kept. A document that parses and fails validation is kept, with its findings |
| Export | Answers the retained bytes under the media type they arrived with. Never a document the application wrote |
| Pull | One bounded run against a source configured on the server. A later run under the same query name continues from the checkpoint, also after a restart |
| Sources | An identifier, a base address, permitted origins and a credential, all from the environment. The credential is never in the database, an answer, a log line or the web client. Plain `http` and private addresses need `LOCAL_TEST=true` for that source, and the API's description of the source says when it is on |
| Store | MongoDB, through a storage adapter the template carries. Without MongoDB, memory |
| Pages | An events page to upload, pull, search and download. A passport's page lists the events that name its product in a section of their own, labelled as supplied data and kept apart from the passport's record |

1. Run `npm run dev` in the generated project and open **Events**.
2. Choose an EPCIS 2.0 JSON or JSON-LD document and select **Upload**. The page says whether it was refused or retained, and lists its findings.
3. Select **Download** beside the import. The file is the one you uploaded, byte for byte.
4. Enter an identifier exactly as an event writes it under **Events that name an identifier**.
5. To pull, name a source in the project's `.env` and start the API again:

```sh
EPCIS_SOURCES=supplier-a
EPCIS_SOURCE_SUPPLIER_A_URL=https://events.example.org/epcis
EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN=<the token the source gave you>
```

6. Under **Pull from a source**, give the query a name and select **Run one pull**. The outcome is shown in the module's own words. A run that ended before the source named a last page says the history is partial.

The generated README lists every setting of a source and every route under `/api/epcis`.

### The MongoDB storage adapter

The exchange asks one hard thing of a store: a batch of records is written whole or not at all, also across a crash. The reference deployment runs one MongoDB node, which has no multi-document transaction. The adapter, `apps/api/src/epcis/mongo-storage.ts` in the generated project, makes a batch atomic without one.

| Step | What happens |
|---|---|
| Commit | The adapter checks what the batch expects, then replaces one log document with the whole batch, on the condition that no other batch was committed meanwhile. That conditional update of one document is the commit, and it is acknowledged from the journal |
| Apply | Each record is written as a whole value, stamped with the batch's sequence number, and the log document is marked idle |
| Reopen | A store that stopped between the two finds the committed batch and applies it again. A write lands only on a record an earlier batch wrote last, so applying twice, or late, changes nothing. A deleted record leaves a small marker, so an old batch cannot bring it back |
| Read | An answer is taken between two looks at the log document, and taken again if a batch moved meanwhile. A reader in another process never sees part of a batch |

The generated project's tests run `epcisStorageAdapterSuite`, the suite the module ships for any adapter, against one MongoDB node in memory. They then stop the adapter before every step it takes in the database, and run two writers over one store.

| Limit | What it means |
|---|---|
| A batch is one MongoDB document until it is applied | A record or batch past 15 MiB is refused with nothing written. An ordinary document stays far below that. The file-system adapter has no such limit |
| Markers of deleted records are kept | One small document for each finished import |
| Recovery runs alone | The module's recovery assumes nothing else is writing. Start API instances one at a time |
| A database that stops answering | The client waits 2 seconds to reach the server (`MONGO_SERVER_SELECTION_TIMEOUT_MS` in `apps/api/src/platform.ts`). Sign-in is kept in the same database and looked up first, so a signed-in request under `/api/epcis` then answers 503 `sign-in-unavailable`, and a call that does reach the EPCIS store answers 503 `storage-unavailable`, both with `retryable: true`. `/api/epcis/status` and `/api/epcis/sources` read no store. The generated tests stop the database under a running API that opened it with its own client, with sign-in on it and without, and hold the answer to an upload and to a pull to within four times that wait. The same request sent again once the database is back is answered as one request |

### Another store

`EPCIS_STORAGE=file` keeps the exchange in a folder through the file-system adapter the module ships, which passes the same suite. It exists to show that the store is a boundary you can replace and is what the exit exercise restores into. It is one process on one disk with no replication. MongoDB is the store the application is built and tested on, and the file adapter is not offered as a second production database.

## The validation engine

In the source candidate the engine that checks a product document under a binding is chosen by two settings.

| `VALIDATOR_URL` | Where the JSON-LD and SHACL engines run |
|---|---|
| Unset | In the API's process, from the three libraries the API depends on |
| The address of a validator service | In that service, through `createValidatorClient` of `@bsv/dpp-profiles/validator-client`. `VALIDATOR_TOKEN` is its bearer token, when it requires one |

The registry, the trusted binding digests, the access split and the identity comparison stay in the API either way. The service is sent the product document and its binding's rule files, so use only a service you would show a restricted product document to. A service can be the validator of the [operator preset](../operate/README.md), `npx dpp-validator` in the project, or any service that keeps the `dpp-validator/1` contract ([run the engines as a service](dpp-profiles.md#run-the-engines-as-a-service)).

An engine that cannot be used is never a pass, in either mode. Libraries that did not load and a service that is stopped, slow, behind a wrong token or answering something else all block a write under a bound profile and make every reading say not checked. The API asks a service again when the health answer, the form or the Operations page is loaded, so a service that comes back is used with no restart. The generated project's `apps/api/test/validation-engine.test.ts` runs the same passports through both engines, then stops the service. `scripts/delivery-parity.mjs` runs the module that makes this choice, as the template holds it, against the operator preset's validator.

## Export and restore

In the source candidate the whole application can be exported as one `dpp-evidence-package@1` and restored into another deployment. Both are operator commands, run on the host with the API stopped. The API serves neither: it has no operator role, and a signed-in member of a brand is not the operator of the deployment.

| Command | What it does |
|---|---|
| `npm run export -- --out <folder>` | Writes the authorised export: the index's signed evidence and the application's journal for each passport, the brands, offers and claims that belong to them, each EPCIS lifecycle claim as its exact bytes, the profile bundle and the EPCIS recovery snapshot, under one manifest signed with a key derived from the publisher key |
| `npm run export -- --out <folder> --public` | Writes the public form: the index's evidence, the readings, the profile files and the public form of the EPCIS source scopes named with `--public-source`. No journal, no owner tier, no operational record |
| `npm run restore -- --from <folder> --exporter-key <key>` | Verifies the whole package before it writes anything, restores it, rebuilds what is derived and reports what it did. A second run changes nothing |
| `npm run epcis-remap -- --source <name>` | Declares that a configured source is now reached at its configured address, keeping its identity and each pull's checkpoint |

Neither form carries a key, a wallet file, a secret or a credential, and the files GS1 publishes are named by address and digest. A restore is a data operation: it writes no state and moves no custody. Continuing to write at the new deployment needs the wallet's keys, which travel by the wallet's own recovery, and the secrets brand and recipient keys are derived from. The restore accepts a profile only under the binding digests the new deployment trusts, so a correctly signed package that carries another definition under a profile's name is refused.

The new deployment can keep the exchange in another store and read its profiles from the bundle the restore installs (`PROFILE_BUNDLE_DIR`) in place of the folder the profiles package ships. The generated project's `apps/api/test/exit-exercise.test.ts` does exactly that with the first deployment switched off, and [move an application to another provider](../operate/export-import-recovery.md#move-an-application-to-another-provider) is the operator's procedure, with what a package carries, every refusal and what cannot be recovered.

## Automated setup

```sh
npx @bsv/create-dpp-app@0.1.0-beta.1 my-app --yes --no-install
```

Use `--help` for every flag. A successful offline exercise does not establish readiness for production; complete the generated guide and [prepare for production](../operate/production-readiness.md).
