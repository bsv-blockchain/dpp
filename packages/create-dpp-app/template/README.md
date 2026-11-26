# A Digital Product Passport application on BSV

Scaffolded by `@bsv/create-dpp-app`. Brands issue product passports as records on the BSV blockchain, hand them on along the supply chain, and anyone verifies a passport from its label. The records follow the open DPP standard; this application is one way of building what the standard requires, and every opinion it takes is yours to change.

The application uses `@bsv/dpp-protocol` directly and pins the `dpp-release-2026-11` runtime set, the set the DPP repository's index image builds. Keep the declared versions together. A project prepared from the repository before npm publication uses local candidate archives; those checks do not establish that a public npm installation is available.

## What you have

| Part | Where | What it does |
|---|---|---|
| Web app | `apps/web` | React single-page app: brand dashboard, passport pages, hand-on acceptance, public verification |
| API | `apps/api` | Express service that owns the platform wallet, writes and reads passports with the `@bsv/dpp` packages, validates product data against its profile, keeps the journal and runs the unattended duties. It answers each passport identifier as its GS1 resolver. It also imports, pulls and exports EPCIS events, as data kept apart from every passport |
| Application database | `deploy/compose.yml` | MongoDB for application records, journal and sign-in |

The API's routes are in [apps/api/API.md](apps/api/API.md).

For deployment, `npm run go-live` registers this app with the default hosted index; `npm run connect-index` takes another provider's or your own. The app's Compose file starts only its database. The index runtime is included for offline exercises; you do not install it separately or use the index in this process as persistent service storage.

## First run

No wallet, funds or Docker:

```sh
npm test
```

This runs a whole passport lifecycle against an index in this process and a test wallet with made-up funding: issue, update, hand on with a claim code, retire, and an EPCIS lifecycle claim, with the reader's report at the end. It also writes and reads a battery passport and a textile passport under the two sector profiles, and registers a profile from a folder.

The EPCIS tests need two things the project does not carry, and the first run fetches each once and keeps it:

| What | From | Kept in |
|---|---|---|
| The three EPCIS 2.0.1 files documents are checked against, which GS1 publishes under its own terms | `https://ref.gs1.org` | `node_modules/.cache/dpp-gs1`, or the folder `DPP_GS1_ARTEFACTS_DIR` names |
| A MongoDB server binary, for the tests of the EPCIS store on one MongoDB node in memory | MongoDB's download site, by `mongodb-memory-server` | That package's own cache |

Later runs use no network. A run that cannot obtain a GS1 file fails before any test and says which file. It never skips. Then:

```sh
npm run dev
```

The web app is on http://localhost:5173 and the API on http://localhost:3000. Without MongoDB the API keeps records in memory and signs you in as a developer with one development brand, so you can issue a passport, open its page, hand it on and accept it with the claim code, all without any service. The scaffold wrote `.env` with fresh secrets and the default testnet index; until `npm run go-live` has registered this app with it, the API runs an index in this process and the web app says so. Nothing reaches the chain: the wallet is a test wallet, and the index runs in-process with its header checks off.

## How a write works

Every state goes through six steps, in order, and the journal records each before it is acted on, so a retry continues and never builds a second transaction:

1. Build the state's transaction unsent, signed by the acting party and countersigned by the platform wallet.
2. Check it with the reader's own rules.
3. Announce it to the index. Send only if the index admits it; abort if it refuses. An unreachable index is not a refusal.
4. Send it, and report only the network's answer.
5. Push the merkle proof to the index once the wallet has it.
6. Keep the transaction, its BEEF and its proof for the passport's life.

Steps 3 and 5 can come later than the screen that caused them. The worker loop in the API does them from the journal; `npm run operations` shows what is still owed and runs one pass. Inside the container the same commands are `node apps/api/dist/cli.js operations` and `node apps/api/dist/cli.js wallet`.

## Custody: who signs

This application runs managed custody: the platform wallet funds and publishes each state. Each new passport output is locked to the controller key signed into that state. The platform manages the signing keys for brands, recipients and members. When updating an older passport that still carries the platform wallet’s per-passport lock, the writer spends that original output with the platform wallet and locks its successor to the signed controller. Sign-in decides who may act for which brand; the signature itself is always made with a platform-held key. A recipient of a hand-on needs no wallet: they accept with a claim code, and that code is how they act on the passport from then on.

This is a choice, not a rule of the standard. The standard lets any role be filled by a person's own BRC-100 wallet, and `apps/api/src/parties.ts` is the seam: a party that signs from a user's wallet replaces a managed identity without changing the writer. A passport can also leave managed custody by a transfer to a key the recipient's own wallet derived.

Under managed custody a compromised platform can forge what it holds. Keep the root key, the two identity secrets and the acceptance records as the secrets they are.

## Identifiers

Passports are GS1 Digital Links, `https://<PASSPORT_HOST>/01/<GTIN>/21/<serial>`. The default GS1 prefix, 952, is GS1's demonstration prefix, never licensed to anyone; every payload written under it starts with a notice saying nothing real stands behind it. When you hold a licensed GS1 company prefix, set `GS1_PREFIX` and the notice switches off. The API refuses any identifier outside the configured prefix and host, because a state under someone else's GTIN is permanent.

**The identifier host.** An identifier is a web address, and the code printed on a product carries the identifier itself, never the address of a page. The API answers every identifier it issued at the identifier's own path, as the standard's GS1 discovery profile asks of the host an identifier is minted under (`spec/gs1-discovery.md` §1): it is a GS1-Conformant Resolver for GTINs, made of the resolver helpers of `@bsv/dpp-profiles` in `apps/api/src/resolver.ts`. The passport page is at a path of its own, one redirect away.

| Request | Answer |
|---|---|
| `GET /01/<gtin>/21/<serial>` from a browser or a scanner | 307 to the passport page, `/passport/01/<gtin>/21/<serial>`, with the query string passed on |
| The same with `Accept: application/linkset+json`, or with `?linkType=linkset` | 200 with the linkset: the passport page under `gs1:dpp` as the item's default link, and the product page under `gs1:pip` as the default link of its GTIN |
| `GET /01/<gtin>`, or a serial nobody issued under a GTIN that has passports | 307 to the product page, `/passport/01/<gtin>`. It holds no passport and says so: it names the product and says where an item's passport is found |
| A compressed identifier, `/eh...` or `/ex...` | Decompressed, then answered as the identifier it spells |
| A malformed identifier | 400 `identifier-malformed`, with the reason |
| A GTIN no passport was issued under | 404 `identifier-unknown` |
| `GET /.well-known/gs1resolver` | The resolver description file |

The links are made from the journal, so an identifier resolves from the moment its passport is issued, and nothing is registered by hand. Only pages this application serves are listed. It lists no evidence package, because it serves none at an address of its own. Every answer allows any origin, and the host answers `GET`, `HEAD` and `OPTIONS`. `npm run dev` answers the same at http://localhost:5173, because Vite passes these paths to the API; only an `OPTIONS` request is answered by Vite itself. `apps/api/test/identifier-host.test.ts` asks each of these over HTTP and walks from an identifier to the verification of its passport.

Serve the application over HTTPS at `PASSPORT_HOST`: the identifier is an address under that host, and a scan goes there.

## Product documents under a binding

Besides the manifest profile `general@2`, the application writes and reads passports under profiles held by a binding: a data model defined outside the DPP packages, as JSON-LD contexts and SHACL shapes or as a JSON Schema, that one immutable `binding.json` pins file by file. The profiles package ships two editions each for the battery and textile data of one serialised item. New sector passports use `eu-battery@2` and `eu-textile@2`. Existing version 1 passports keep the binding named in their signed state. Each name states which data model a product document uses. Neither claims that a passport or a product complies with any law.

The original sector bindings replaced the earlier manifest profiles `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4`, which are retired. The application offers none of them and refuses every write under one with `profile-retired`. A passport already in the journal under one is still shown, with its profile reported as retired and not checked, and it gets no further state, hand-on or claim. Nothing converts it: issue a new passport under the replacement.

Under such a profile a passport carries one product document, and the binding lists which of its top-level properties are public. The rest are restricted.

| Part | Where it goes | Who reads it |
|---|---|---|
| Public properties | The state's public payload, on chain | Anyone, for good. It cannot be withdrawn or redacted |
| Restricted properties | Encrypted to the holder's key and kept in the journal, as every owner tier is. Only the hash of the ciphertext is on chain | The holder |

The split is by property, not by value. A restricted value that you repeat inside a public property, such as a name in a description or a link to a private file, is published with that property. The form labels every property Public or Restricted before you submit and asks you to confirm the public list.

**Writing.** Choose `eu-battery@2` or `eu-textile@2` when you issue a passport. The form asks for the item reference and serial once, and writes the document's identifier, GTIN and serial from them, so they cannot disagree with the passport identifier. A field left empty is absent from the document: the form makes up no identifier, classification, date, unit or precision, and a number is written with the digits you typed. A measurement is a value with its unit. **Load example** fills the form with invented data under the demonstration prefix, and **Load a document from a file** takes a product document of your own in the profile's data model. A property the form has no field for is kept as JSON under **Other properties** and written unchanged.

The API validates the whole document against the passport identifier it is about to sign, splits it, and signs exactly the public payload the profiles package returns. A document that fails, that could not be checked, or whose public part is over 65,535 bytes is refused before anything is signed, and the form shows each finding at the field it concerns.

**Reading.** A passport page shows the product data as structure, each property with its tier, and two checks that are kept apart:

| Check | Who sees it | What it says |
|---|---|---|
| Public view | Anyone | The public payload carries public properties only, keeps every rule it could break, and describes this passport's item. It says nothing about restricted data |
| Authorised view | The holder | The public payload rejoined with the restricted part satisfies the profile |
| Owner-tier check | The holder | The stored ciphertext hashes to the state's `payload_owner_hash`. This is the protocol's check, and the only statement about the on-chain commitment |

A check that could not run is shown as **Not checked**, never as passed. On a managed transfer the giver checks the restricted bytes against the signed predecessor, encrypts their contents to the recipient and commits the new ciphertext. The recipient can open it immediately. An older transfer that kept the original ciphertext still needs the key used for that ciphertext.

**The validation engine.** The engine that checks a product document is a setting, and the application is the same either way (`apps/api/src/validation-engine.ts`).

| `VALIDATOR_URL` | Where the JSON-LD and SHACL engines run | What it needs |
|---|---|---|
| Unset, the default | In the API's own process | `jsonld`, `n3` and `shacl-engine`, which `apps/api` depends on at the versions `@bsv/dpp-profiles` is tested with |
| The address of a validator service | In that service, asked through the client of `@bsv/dpp-profiles/validator-client` | The service's address, and `VALIDATOR_TOKEN` when it requires a token |

The service is an engine and nothing more. The registry, the binding digests you trust, the split into public and restricted parts and the comparison with the passport identifier all stay in the API. The service is sent the product document and the rule files of its binding, so point `VALIDATOR_URL` only at a service you would show a restricted product document to. The token is sent to that address and nowhere else, and is never logged or returned.

Three ways to have a service: the validator of the DPP repository's operator preset, which an index operator runs; `npx dpp-validator` in this project, which starts the same code on `127.0.0.1:8090` and reads `VALIDATOR_HOST`, `VALIDATOR_PORT` and `VALIDATOR_TOKEN`; or any other service that keeps the `dpp-validator/1` contract.

Whichever engine is chosen, one rule holds: an engine that cannot be used is never a pass. Libraries that did not load, and a service that is stopped, slow, behind a wrong token or answering something else, all give the same result. A profile held by a binding cannot be written, the form says so with the reason, and every reading says **Not checked**. The API asks a service again whenever the health answer, the form or the Operations page is loaded, so a service that comes back is used without restarting the API. Libraries that did not load need a restart. `apps/api/test/validation-engine.test.ts` runs the same passports through both engines, then stops the service.

In both modes every context and rule file is read from the binding, and nothing is fetched.

**Where the profiles are read from.** By default all four sector bindings are read from the folder the profiles package ships. With `PROFILE_BUNDLE_DIR` set they are read from a profile bundle in that folder, which is where a [restore](#export-and-restore) installs the profiles a package carries, and the package's own folder is not read. Trust does not change with the source: a sector profile is accepted only under the digest your installed profiles package publishes for it, and any other binding only when its digest is in `TRUSTED_BINDING_DIGESTS`.

**Sector editions.** The issue form offers `eu-battery@2` and `eu-textile@2`. Each checks the signed subject's product type, including subclasses declared in its pinned ontology. Asking the API to issue explicitly under `eu-battery@1` or `eu-textile@1` returns HTTP 409 with `profile-superseded` and the current profile in `replacedBy`. A holder can still read, update and hand on an existing version 1 passport under its original binding.

To exercise the current editions locally, run `npm run dev` with `LIVE_PUBLISHING=false`, select the version 2 profile by name in the issue form and load its example. The public reading shows its public properties. The holder's authorised reading also opens the sealed restricted properties. An application that reads bindings from `PROFILE_BUNDLE_DIR` needs the current edition there to issue under it, and the historical edition there to read and maintain an existing version 1 passport.

**A profile of your own.** Put its `binding.json` and the files it names in a folder ([how to write a binding](https://github.com/bsv-blockchain/dpp/blob/main/docs/packages/dpp-profiles.md#write-a-binding)), then name the folder and trust its binding in `.env`:

```sh
CUSTOM_PROFILE_DIRS=profiles/example-bottle@1
TRUSTED_BINDING_DIGESTS=<the SHA-256 of that folder's binding.json>
```

`shasum -a 256 profiles/example-bottle@1/binding.json` prints the digest. Trust is that digest: the API registers the folder at start only when its `binding.json` has a listed digest and every file it names matches the length and SHA-256 the binding records. A folder that is not trusted, or that changed since you trusted it, is refused by name in the start-up log and on the Operations page, and the application runs without it. No source file changes. `apps/api/test/fixtures/custom-profile/` holds two example profiles to try this with, and `apps/api/test/custom-profile.test.ts` shows them trusted, untrusted and altered. A profile with no form in the web app is written as a JSON document, with the same labels and the same warning.

Restricted values never reach the application's logs, its listings, the index or any public export: `apps/api/test/bound-http.test.ts` issues passports carrying a value that appears nowhere else and searches all of them for it.

## Lifecycle claims

A lifecycle claim is a signed statement of something that happened to a product, on its own rail: it never spends a passport. This application issues EPCIS lifecycle claims, `dpp-epcis-lifecycle@1`. Each one is one EPCIS 2.0.1 event, of the five types (`ObjectEvent`, `AggregationEvent`, `TransactionEvent`, `TransformationEvent`, `AssociationEvent`), in a signed envelope that binds it to the passports whose products it names and says in which role the signer signs: `observer`, `owner`, `custodian` or `authorised-reporter`. On a passport's page, **Sign a lifecycle claim** takes the event in one of two ways:

- **Enter the event.** The form asks for what EPCIS records: the event type, the action where the type has one (a transformation has none), the business step, the disposition, the identifiers in each role (objects, a parent and its contents, inputs and outputs, quantities of a class), the read point and business location, the source and destination parties and places, business transactions, and sensor elements as EPCIS JSON.
- **A retained event.** An event the EPCIS exchange retained is signed exactly as it was received, with a `source` link to its import and the import's digest. Whoever supplied it observed it, not you, so it is never signed as `observer`.

The bindings come from the event's own identifiers, matched to this platform's passports under the identity rules of `@bsv/dpp-profiles`: an item identifier binds that item's passport, written as a GS1 Digital Link or an EPC URN, and a quantity element's class binds every passport of that class at class level only, which never says an item took part. Nothing is made from a passport operation, a metadata edit or a sale: an event that names none of this platform's passports binds nothing and is refused. The pinned EPCIS 2.0.1 schema is applied before anything is signed, from the GS1 files the EPCIS exchange obtained.

**Configure signing authority.** The operator records a grant after checking the member's authority for a role and passport. The API requires a matching issuer DID, compressed identity key, passport identifier, role, purpose and event time for every passport the event binds. Its wallet signs only after those checks pass. Keep the grant file in operator-controlled configuration outside the served web directory. Set `LIFECYCLE_AUTHORITY_GRANTS_FILE` to its absolute path and restart the API with that configuration.

To prepare one entry from the generated project's root, use the same managed identity configuration as the running API. Set `MEMBER_ID` to the verified member's application user ID and `PASSPORT_ID` to the exact passport identifier. The member's own signed-in `GET /api/me` response identifies their `userId`. This example prints the complete JSON document for one `observer` grant on the sample dates. Review its contents and dates before saving it to the configured file.

```sh
node --import tsx --input-type=module <<'JS'
import './apps/api/src/env.ts'
import { loadConfig } from './apps/api/src/config.ts'
import { managedParties } from './apps/api/src/parties.ts'

const { MEMBER_ID, PASSPORT_ID } = process.env
if (!MEMBER_ID || !PASSPORT_ID) throw new Error('Set MEMBER_ID and PASSPORT_ID.')
const issuer = managedParties(loadConfig()).member(MEMBER_ID)
console.log(JSON.stringify({ grants: [{
  issuer: issuer.did, issuerKey: issuer.identityKey, passportId: PASSPORT_ID,
  role: 'observer', purpose: 'claim',
  validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z',
}] }, null, 2))
JS
```

The interval includes `validFrom` and ends immediately before `validUntil`. It applies to the EPCIS event's `eventTime`. Supported roles are `observer`, `owner`, `custodian` and `authorised-reporter`. Imported events are reported in an allowed non-observer role. An issuer declaring its own event in error still needs its ordinary role grant. To correct another issuer's original, it also needs a matching grant with purpose `error-declaration`. An unreadable or malformed configured file stops the API at startup. Leaving the setting unset allows the API to start, and signing returns `authority-unavailable`. A configured source with no matching grant returns `authority-unconfirmed`. A two-product event requires a grant for each bound passport. A request that supplies only part of that scope returns `authority-scope-incomplete`. The caller cannot add a grant through the claim request.

The member's managed wallet signs the claim's RFC 8785 bytes. Sending it to `REGISTRY_URL` is a separate step the member ticks: the registry verifies it, keeps the exact bytes and anchors them once for each bound passport, all in one transaction on the index's `tm_attestation`. Check the configured registry’s advertised representation before requesting submission. Its intake response records whether it accepted the claim.

**Reading.** A passport's page, public or not, lists the claims that concern it: those whose anchors name it as their subject, and those this application holds that bind it. Each is verified, and only a verified binding says whether this passport took part, its item or only its class. An anchor that names a passport the claim does not bind is listed as found and not established. Every finding is shown on its own line: event structure, event semantics, product binding, signature, authority, possession, ownership, anchor, inclusion and correction. What was not checked reads unknown. The authority result reports what the configured evidence establishes for the issuer, role and event time within the original signed scope. A historical or external claim can bind two products and declare a role for only one. Each product page lists that scope and states whether it includes the current passport. Signature, possession and ownership remain distinct findings. An anchor proves an anchoring service's commitment to the bytes, not that the event happened, who owns the product or that anything complies with a rule.

**Corrections.** **Declare in error** signs a new claim that carries the same event with an EPCIS error declaration. The original signed bytes are retained. The reader reports a verified declaration by the original issuer.

**Historical native claims.** Native claims with one of four event types, `dpp-lifecycle-v1`, are no longer issued here. Those this application issued before are kept exactly as they were signed, still verify under their own rules, and are shown apart, labelled as historical native claims. Their category is not read as an EPCIS event. Other producers of native claims, including any deployed application built from an earlier version of this starter, still issue that format until they change, so a reader keeps verifying it.

`GET /api/lifecycle-claims/:id` returns a claim's exact bytes, and an export carries every claim this application holds as those bytes, which the restoring deployment verifies before it writes anything.

## EPCIS exchange

The application imports EPCIS 2.0 documents, pulls events from a source you configure, and gives back exactly what it received. All of it is `@bsv/dpp-credentials/epcis-exchange`: the application supplies the storage, the routes and the pages, and does none of the module's work a second time.

**What an event here is.** Data a source supplied. An import or a pull changes no custody, signs nothing, writes nothing on chain and never calls the wallet. A document that is **valid** passed a check of its format. It is not signed, and nothing verifies who observed an event or that it happened. The pages label every event that way, and a passport's page lists the events that name its product in a section of their own, apart from the states and claims that are the passport's own record.

| You want to | Where |
|---|---|
| Upload a document and see whether it was refused or retained, with its findings | **Events**, then **Upload a document** |
| Pull events from a configured source | **Events**, then **Pull from a source** |
| Find the events that name an identifier | **Events**, or the section at the foot of a passport's page |
| Download a document as it was received | **Download** beside an import or an event |
| Do the same from a script | The routes under `/api/epcis` in [apps/api/API.md](apps/api/API.md#epcis-exchange) |

**The GS1 files.** A document is checked against three files GS1 publishes under its own terms, which this project does not contain. The API obtains them at start, once, from `https://ref.gs1.org` into `DPP_GS1_ARTEFACTS_DIR` (`local/gs1`), checks every byte against a pinned digest, and logs one line saying whether they were present, fetched or unavailable. If they are unavailable the API still starts, and every import and pull is refused with how to provide them: start again with network access, run `npx dpp-gs1-artefacts fetch --dir <folder>`, or place the files in the folder yourself. With `DPP_GS1_ARTEFACTS_OFFLINE=true` the API never fetches.

**Uploading.** The page sends the file as the bytes it is, with a request identifier it chose for that file. The API digests and keeps those bytes and never writes them out again from a parsed form, so an export is the original, byte for byte, under the media type it arrived with. Sending the same file again under the same identifier is the same request and keeps one import. The same identifier with other bytes is refused, and the first import stands. A transport that cannot be kept, such as a body that is not JSON, is over the size limit or has the wrong media type, is refused with a status that says why, and nothing of it is kept. A document that parses and fails validation is kept, with its findings, and reads **Invalid format**.

**A source to pull from.** A source is configuration on the server. Nothing about it comes from a request. Name it in `.env`, then set its address and, if it needs one, its credential:

```sh
EPCIS_SOURCES=supplier-a
EPCIS_SOURCE_SUPPLIER_A_URL=https://events.example.org/epcis
EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN=<the token the source gave you>
```

| Setting, after `EPCIS_SOURCE_<NAME>_` | Meaning |
|---|---|
| `URL` | The base address of the source's query interface. Events are asked for at `<URL>/events` |
| `ORIGINS` | Every origin a request may go to, comma-separated. Empty permits the address's own origin only. A redirect or a next page anywhere else is refused before it is requested |
| `BEARER_TOKEN`, or `BASIC_USER` with `BASIC_PASSWORD`, or `HEADER_NAME` with `HEADER_VALUE` | The credential, when the source needs one. At most one kind |
| `LOCAL_TEST` | `true` permits plain `http` and private addresses. Off unless you set it, for a source on your own machine only. The API's description of the source and every result of a pull say when it is on |
| `REPEAT_LISTS` | `true` sends each value of a list as its own parameter, for a source that does not read the pipe-delimited form. Recorded with each pull as a leniency |

The credential stays in `.env` and the API's memory. It is sent to the address's own origin and to no other. It is never written to the database, an answer, a log line or the web app: `GET /api/epcis/sources` says that a credential is set and which kind, and `apps/api/test/bound-http.test.ts` pulls with a credential that appears nowhere else and searches everything the application answers, stores, exports and prints for it.

**Pulling.** One pull is one bounded run: it reads a limited number of pages and stops. Give the query a name. Running it again under that name continues from where it stopped, also after a restart, and no page is lost or kept twice. The outcome is shown in the module's own words: its outcome, its reason and whether the source's pages were exhausted. A run that ended early says the history is partial, and no run says a source's history is complete.

**The store.** With MongoDB the application keeps imports in four collections of the application database, through `apps/api/src/epcis/mongo-storage.ts`. Without MongoDB they are held in memory and are gone when the API stops. The module asks one hard thing of a store: a batch of records is written whole or not at all, also across a crash. One MongoDB node has no multi-document transaction, so the adapter does not use one:

1. It checks what the batch expects, then replaces one log document with the whole batch, on the condition that no other batch was committed meanwhile. That one conditional update of one document is the commit, acknowledged from the journal.
2. It applies the batch record by record and marks the log document idle.
3. A store that stopped in between finds the committed batch when it is next opened and applies it again. That is safe: each write sets a whole value, and only on a record an earlier batch wrote last. A deleted record leaves a small marker so that an old batch applied late cannot bring it back.

A reader takes its answer between two looks at the log document, and takes it again if a batch moved meanwhile, so it never sees part of a batch. `apps/api/test/epcis-mongo-storage.test.ts` runs the module's own adapter suite against one MongoDB node in memory, then stops the adapter at every step it takes in the database.

Two things to know about that store. A batch is one MongoDB document until it is applied, so a single record or batch past 15 MiB is refused, with nothing written. The limits in force, 2 MiB a document and 100 events a page, keep an ordinary document far below that. A document made of hundreds of thousands of very short identifiers can pass it, and its import is then refused as `record-too-large`. And the markers deleted records leave are not removed: there is one small one for each finished import.

**Another store.** `EPCIS_STORAGE=file` keeps the exchange in a folder, `EPCIS_STORAGE_DIR` (`local/epcis-store`), through the file-system adapter that `@bsv/dpp-credentials/epcis-exchange` ships. It passes the same adapter suite and is handed to the module as the same six methods. It is here to show that the store is a boundary you can replace, and it is what the exit exercise restores into. It is one process on one machine's disk, with no replication: MongoDB is the store this application is built and tested on, and the file adapter is not offered as a second production database. An adapter for another database is yours to write against the same suite.

**At start.** Before it accepts a request the API runs the module's recovery, which finishes or discards whatever a stopped process left, and logs what it did. Recovery assumes nothing else is writing to the store. Start one API process at a time, so that one is not importing while another recovers.

## Export and restore

The whole application can be exported as one signed evidence package and restored into another deployment: another host, another database, another provider. Both are operator commands, run on the host with the API and its worker stopped. There is no route for either. The API has no operator role, and a signed-in member of a brand is not the operator of the deployment, so the authorisation is the one the deployment already rests on: whoever can run a command with its settings.

```sh
npm run export -- --out ../my-dpp-export            # everything, for your own recovery or a move
npm run export -- --out ../my-dpp-public --public    # only what anyone may hold
npm run restore -- --from ../my-dpp-export --exporter-key <publisher key of the deployment that exported>
```

To exercise the proposed custody export profile, add `--custody-profile managed-custody@3` to the public or authorised export command. A public package identifies withheld and missing acceptances by commitment. A recovery package carries completed acceptances held in the journal or in a retained offer. A signed handover awaiting transfer stays with its offer. Add `--require-custody-profile managed-custody@3` to restore when the replacement requires these rules. Earlier packages can still be read under their original edition.

An export is one `dpp-evidence-package@1`: a folder of files under a manifest, `manifest.json`, that this application signs with a key derived from its publisher key. Every file is listed once in the manifest, with its length and SHA-256.

| In the folder | What it is | Authorised export | Public export |
|---|---|---|---|
| `passports/<n>/index/` | The index's own signed evidence for the passport, exactly as the index exported it: transactions, proofs, its publisher policy and its report | Carried | Carried |
| `passports/<n>/reading.json` | How the passport verified here when it was exported: each check and each finding, no values | Carried | Carried |
| `passports/<n>/journal.json` | This application's journal: each state's bytes, its sealed owner tier, who holds the passport | Carried | Left out |
| `passports/<n>/authority/` | Each acceptance record a hand-on commits to | Carried | Left out |
| `application/brands/`, `offers/`, `claims/` | The brands, hand-on offers and lifecycle claims that belong to those passports | Carried | Left out |
| `application/lifecycle-claims/` | Each EPCIS lifecycle claim's exact signed bytes, once however many carried passports it binds | Carried | Left out |
| `profiles/` | The profile bundle of `@bsv/dpp-profiles`: each binding the passports declare, every file it lists, its notices and licence text | Carried | Carried |
| `epcis/` | The EPCIS exchange, from `@bsv/dpp-credentials/epcis-exchange` | The recovery snapshot of every source scope: originals, import records, observations, conflict decisions and pull state | The public form, and only of the source scopes you name with `--public-source` |
| `application/application-export.json` | The descriptor: what the export covers, what it names without carrying, and what it leaves out | Carried | Carried |

Neither export holds a key, a wallet file, a secret or a credential, and before a folder is written every byte is searched for each secret this deployment was configured with. The files GS1 publishes are named in the manifest by address and digest and are never carried. An authorised export does hold restricted records, sealed as they were: treat the folder as you treat the database. A public export is not a backup, and a restore refuses it.

**Restoring.** Configure the new deployment first: its own `MONGO_URL`, its index, and whichever store and profile source it is to use. Then run `restore`. In order, it:

1. Verifies the package before it writes anything: the manifest's signature under the exporter key you gave, every file against the manifest, each journal as a lineage that verifies, the index's signature on its evidence, the profile bundle against the digests this deployment trusts, and the EPCIS snapshot by the module's own checks.
2. Compares the package with what the deployment already holds. An equal record is left alone. A different record under the same identity stops the restore with nothing written: a restore never overwrites.
3. Restores the exchange into the configured store, installs the profile bundle into `PROFILE_BUNDLE_DIR` when that is set, and writes the journals, brands, offers and claims.
4. Rebuilds what is derived: the exchange's index of identifiers, and the index's records of each passport, by announcing each state's own bytes to the index this deployment has joined.
5. Reads every passport again here and compares the result with `reading.json`, check for check.

It ends with a report of what it wrote, what it left, what you still have to provide and anything that needs attention. Run twice, it changes nothing the second time.

| A package that | Is refused as |
|---|---|
| Is signed by another key than the one you gave | `exporter-unexpected` |
| Lacks a file its manifest lists, or a record its descriptor counts | `package-incomplete`, naming what is missing |
| Holds a file that is not the bytes the manifest lists, or one the manifest does not list | `file-altered`, `file-unlisted` |
| Carries another definition under a profile's name, whoever signed it | `profile-refused` (`bundle-binding-substituted` or `bundle-binding-untrusted`) |
| Carries a pull checkpoint without its imports, a conflict decision without its observations, or an altered original | `epcis-refused`, with the module's own code |
| Is a public export | `not-a-recovery-package` |

**What an export does not carry, and you provide at the new deployment.**

| What | How it gets there |
|---|---|
| The wallet's root key and file | The wallet's own recovery. Set `WALLET_ROOT_KEY` to the same key, and restore or rebuild the wallet file |
| `BRAND_ROOT_SECRET` and `MANAGED_IDENTITY_SECRET` | Your own handling of secrets. Brand, recipient and member keys are derived from them, so they must be the same |
| The index's address and this application's tokens | `npm run connect-index` or `npm run go-live`. The index must admit the same publisher key |
| Each EPCIS source's credential | The `EPCIS_SOURCE_<NAME>_` settings. The restore's report names each source and says whether its credential is set |
| The GS1 files | The API obtains them at start, or you place them |
| Sign-in accounts, sessions and brand memberships | Not carried. See below |

Without the keys the new deployment reads every passport and can write none of them. It verifies each as before, except for the issuer's authority, which it reports as `authority-unconfirmed`: it takes the issuer's key from its own `BRAND_ROOT_SECRET`, never from the package. That is the custody rule and no export changes it: continuing to sign needs the authorised keys, and they travel by the wallet's own recovery, never in a package.

**After a restore.** An unfinished pull continues once its source's credential is set. A cursor is left out of an export unless you pass `--cursors include`, so the pull asks again from its retained bounds and recognises what it already holds: no page is skipped and no event is kept twice. If the source is now reached at another address, set that address in `.env` and run `npm run epcis-remap -- --source <name>` once, which binds every pull of the source to it and keeps the source's identity. A request a client sends again answers the import it made before, with no new receipt.

**What cannot be recovered this way.** A lost key. Sign-in: accounts, sessions and memberships are not exported, and a brand is tied to its sign-in organisation by its identifier, so a deployment that uses sign-in must move the sign-in collections of its database by its own means or attach members to the restored brands again. The index's own state beyond these passports. The daily spend counter. Anything the first deployment never retained.

`apps/api/test/exit-exercise.test.ts` is the whole of this as a test: it builds a deployment on MongoDB with a battery and a textile passport and an EPCIS exchange, exports it, switches it off, restores into a deployment that keeps the exchange in the file adapter and reads profiles from the bundle, with every upstream host out of reach, and continues there. It runs `npm run export` and `npm run restore` as you would, and restores the same package into a deployment without the keys, which reads both passports and refuses an `UPDATE` by name.

## Going live

```sh
npm run go-live
```

One command checks everything a real write needs and names the fix for each failure; nothing reaches the chain until every check passes. In order:

1. **Configuration.** The secrets in `.env` are not placeholders; `INDEX_URL` is set and a hosted index matches `NETWORK` (`https://dpp-overlay-testnet.bsvb.net` is `test`, `https://dpp-overlay.bsvb.net` is `main`); on mainnet, `GS1_PREFIX` is a prefix licensed to you and `PASSPORT_HOST` a host you serve.
2. **Wallet.** The first run generates `WALLET_ROOT_KEY` into `.env` and prints the publisher key. Back the file up: a root key alone is not a full wallet backup, so read the wallet toolbox's recovery guidance and keep the SQLite file in `local/` on a persistent volume.
3. **Index.** The index answers, serves the same network, and admits under the managed custody profile this app writes.
4. **Registration.** The app signs a registration request with its wallet and sends it to the index's `POST /register`; the index names the publisher key in its policy and answers with the app's two write tokens, which go into `.env`. An index whose operator approves registrations holds the request; run `go-live` again once approved. An index that does not register publishers says so and names `connect-index`.
5. **Funds.** The wallet holds enough for a few states. If not, the command prints a funding address and the `wallet fund` command that takes the payment in. A state costs a little over a hundred satoshis and leaves one satoshi in the passport output.
6. **Admission.** The index now names the key.

Then `LIVE_PUBLISHING=true` is written and the next write spends real satoshis. With a funded wallet and live publishing off, the writer checks the draft and aborts it before sending. It requests draft admission only at an index that supports retraction. `SPEND_CAP_SATOSHIS` refuses writes once the platform has spent that much in a day.

Mainnet needs MongoDB (`docker compose -f deploy/compose.yml --env-file .env up -d mongo`, or a hosted one, in `MONGO_URL`) for sign-in and persistence, a WhatsOnChain API key in `WOC_API_KEY` for the wallet's monitor and the reader, `NETWORK=main` with `INDEX_URL=https://dpp-overlay.bsvb.net`, and your own `PASSPORT_HOST` and `GS1_PREFIX`. Changing an identity secret changes every key derived from it, so decide `BRAND_ROOT_SECRET` and `MANAGED_IDENTITY_SECRET` once.

## Connect an index

Readers use the index to find passports and their evidence. The starter announces drafts to its in-process index and to the two hosted reference index base URLs before sending them. If the wallet refuses a draft, the starter asks that index to withdraw it. The technology behind it is a BSV overlay service. It admits only states countersigned by a publisher key it names, and it follows this app's custody model. Three routes; this app's Compose file starts only the application database.

**The default index.** `.env` names the hosted testnet index, and `npm run go-live` registers this app with it. Mainnet is `INDEX_URL=https://dpp-overlay.bsvb.net` with `NETWORK=main`, where the operator approves each registration.

**Another provider's index.** `npm run connect-index -- --url https://index.example` writes the address and runs the checks; `go-live` then registers if the index registers publishers. A provider that hands out tokens itself: `npm run connect-index -- --url https://index.example --submit-token <t> --callback-token <t>`. Match the wallet's network and the managed custody profile; public lookup access alone is insufficient.

**Your own index.** Run it from the DPP repository's operator preset, `deploy/` in [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp): the index image and a persistent MongoDB on Docker Compose, configured from one env file. Give it this app's publisher key as `SERVICE_IDENTITY_KEY`, and this app's `NETWORK`: `npm run wallet` prints the key, and its first run generates `WALLET_ROOT_KEY` into `.env` (back the file up). Once the index runs, its `dpp-index connection` command writes the connection file; `npm run connect-index -- --from <that file>` here writes the address and both tokens to `.env` and runs the go-live checks, and when every check passes it switches live publishing on. After fixing a failed check, such as funds, run `npm run go-live`. The preset's README covers hosting, backup and recovery.

| App setting | Meaning |
| --- | --- |
| `INDEX_URL` | Index address reachable from the API |
| `INDEX_RETRACTION_URL` | For a custom index that supports `POST /retract`, set this to its exact `INDEX_URL` to enable draft admission. |
| `INDEX_SUBMIT_TOKEN` | Submission and retraction access, from registration or the operator |
| `INDEX_CALLBACK_TOKEN` | Proof-delivery access, from registration or the operator |
| `NETWORK` | The same network as the wallet and index |

For other indexes the starter sends the transaction first by default. If admission then fails, the journal keeps the completed write and the worker retries the original BEEF in spend order. Confirm custom retraction support with the index operator before setting `INDEX_RETRACTION_URL`. Its value only enables draft admission for that base URL.

Before changing index, settle outstanding drafts and deliver pending proofs to the original index. An interrupted draft records which index may hold it. A withdrawal from a different index leaves the draft pending until the original index reconciles it. For journals created by older starter versions, the operator must reconnect the original index. The in-process development index forgets its outputs and changes address at restart. Use a persistent external index for recoverable deployments. The worker offers proofs to its currently configured index.

Restart the app after changing its settings. Keep the tokens out of browser code. For an API running in Docker, use an index address reachable from that container; `localhost` refers to the API container itself. The app announces to `INDEX_URL` once it holds both tokens; before that it runs an index in this process, and a connection failure does not cause another index to start.

## Deploy

If `.candidate.Dockerfile` is present, build with `docker build -f .candidate.Dockerfile -t my-dpp .` to include the local dependency archives. For projects generated by the published starter, build and run with the normal Dockerfile:

```sh
docker build -t my-dpp .
docker run -p 3000:3000 --env-file .env -v dpp-local:/app/local my-dpp
```

One container serves the API and the web app. Run one instance with `WORKER=with-api` (the default), or several API instances with `WORKER=off` and exactly one with `WORKER=only`, so the unattended duties run once. Each API instance runs the EPCIS recovery when it starts, which assumes no other instance is importing at that moment: start them one at a time. The volume at `/app/local` holds the wallet file and the GS1 files, and with `EPCIS_STORAGE=file` or `PROFILE_BUNDLE_DIR` their folders too.

`deploy/compose.yml` starts MongoDB for the application, named by tag and digest so that every machine runs the same image. MongoDB Community Server is its publisher's program under the Server Side Public License. It is pulled from its publisher and is not part of this project.

## Next steps

Things this starter leaves to you, each a known path:

- **A registry of your own.** Claims are sent to `REGISTRY_URL`, which anchors each one once per bound passport. Check the configured registry’s advertised EPCIS lifecycle representation and the intake response before recording acceptance. Running your own is the registry role of the standard.
- **Authority evidence.** Maintain the operator grants described under [Lifecycle claims](#lifecycle-claims). A deployment with its own source of evidence can supply a resolver for the same issuer, passport, role, purpose and event-time questions.
- **More links at the identifier host.** The resolver lists two links: the passport page of an item, and a plain product page for its GTIN. Your own product page as the GTIN's default, a link at lot level, or an evidence package once you serve one at a stable address, are records to add where `apps/api/src/resolver.ts` makes them, and the checks of `@bsv/dpp-profiles` it applies refuse a set that breaks a rule. It answers a linkset request with JSON whatever the `Accept`, with no page for a person, and it answers only for identifiers under its own `PASSPORT_HOST`.
- **Server-rendered passport pages.** The public page renders in the browser. If crawlers or no-JavaScript readers matter, serve a plain HTML view of it from the API at the page's own path, not at the identifier's.
- **Self-custody.** Let a brand or a holder sign from their own BRC-100 wallet: implement a `Party` backed by a wallet connection in the browser, and let a transfer go to a key the holder's wallet derived.
- **Who sees which events.** Every signed-in user sees every import and may start a pull, as with the wallet and operations pages. Scope them to a brand if your users should not see each other's.
- **An operator role.** Export and restore are commands on the host because the API has no operator to authorise. If you want them over HTTP, add the role first.
- **Moving sign-in.** An export carries no account, session or membership. Moving them with a deployment is yours to do.
- **More of EPCIS.** This starter imports files, pulls from the standard query interface and exports originals. It captures nothing, subscribes to nothing, reads no XML and maps no event to a passport state. A page for recording a decision on two bodies under one event identifier is yours to add: the route is `POST /api/epcis/conflicts/:conflictId/resolutions`.
- **Credentials and federation.** The rest of `@bsv/dpp-credentials` and a second index that synchronises with yours are documented in the standard.
- **A wallet storage server.** For several API instances, replace the SQLite file with the toolbox client against a wallet storage server.

## Versions

The DPP packages are pinned to one release set, named in `package.json` under `dpp`. Move them together, and read the standard's changelog first: they are prereleases.
