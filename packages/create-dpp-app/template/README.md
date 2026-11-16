# A Digital Product Passport application on BSV

Scaffolded by `@bsv/create-dpp-app`. Brands issue product passports as records on the BSV blockchain, hand them on along the supply chain, and anyone verifies a passport from its label. The records follow the open DPP standard; this application is one way of building what the standard requires, and every opinion it takes is yours to change.

The application uses `@bsv/dpp-protocol` directly and pins the `dpp-release-2026-11` runtime set, the set the DPP repository's index image builds. Keep the declared versions together. A project prepared from the repository before npm publication uses local candidate archives; those checks do not establish that a public npm installation is available.

## What you have

| Part | Where | What it does |
|---|---|---|
| Web app | `apps/web` | React single-page app: brand dashboard, passport pages, hand-on acceptance, public verification |
| API | `apps/api` | Express service that owns the platform wallet, writes and reads passports with the `@bsv/dpp` packages, validates product data against its profile, keeps the journal and runs the unattended duties |
| Application database | `deploy/compose.yml` | MongoDB for application records, journal and sign-in |

The API's routes are in [apps/api/API.md](apps/api/API.md).

For deployment, `npm run go-live` registers this app with the default hosted index; `npm run connect-index` takes another provider's or your own. The app's Compose file starts only its database. The index runtime is included for offline exercises; you do not install it separately or use the index in this process as persistent service storage.

## First run

No wallet, funds, Docker or network:

```sh
npm test
```

This runs a whole passport lifecycle against an index in this process and a test wallet with made-up funding: issue, update, hand on with a claim code, retire, and a lifecycle claim, with the reader's report at the end. It also writes and reads a battery passport and a textile passport under the two sector profiles, and registers a profile from a folder. Then:

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

This application runs managed custody: the platform wallet publishes every state and holds the lock on every passport, and every brand, recipient and member signs with a key the platform derives for them. Sign-in decides who may act for which brand; the signature itself is always made with a platform-held key. A recipient of a hand-on needs no wallet: they accept with a claim code, and that code is how they act on the passport from then on.

This is a choice, not a rule of the standard. The standard lets any role be filled by a person's own BRC-100 wallet, and `apps/api/src/parties.ts` is the seam: a party that signs from a user's wallet replaces a managed identity without changing the writer. A passport can also leave managed custody by a transfer to a key the recipient's own wallet derived.

Under managed custody a compromised platform can forge what it holds. Keep the root key, the two identity secrets and the acceptance records as the secrets they are.

## Identifiers

Passports are GS1 Digital Links, `https://<PASSPORT_HOST>/01/<GTIN>/21/<serial>`. The default GS1 prefix, 952, is GS1's demonstration prefix, never licensed to anyone; every payload written under it starts with a notice saying nothing real stands behind it. When you hold a licensed GS1 company prefix, set `GS1_PREFIX` and the notice switches off. The API refuses any identifier outside the configured prefix and host, because a state under someone else's GTIN is permanent.

## Product documents under a binding

Besides the manifest profile `general@2`, the application writes and reads passports under profiles held by a binding: a data model defined outside the DPP packages, as JSON-LD contexts and SHACL shapes or as a JSON Schema, that one immutable `binding.json` pins file by file. The profiles package ships two, `eu-battery@1` and `eu-textile@1`, for battery and textile data of one serialised item. Each name states which data model a product document uses. Neither claims that a passport or a product complies with any law.

The two bundled profiles replace the earlier manifest profiles `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4`, which are retired. The application offers none of them and refuses every write under one with `profile-retired`. A passport already in the journal under one is still shown, with its profile reported as retired and not checked, and it gets no further state, hand-on or claim. Nothing converts it: issue a new passport under the replacement.

Under such a profile a passport carries one product document, and the binding lists which of its top-level properties are public. The rest are restricted.

| Part | Where it goes | Who reads it |
|---|---|---|
| Public properties | The state's public payload, on chain | Anyone, for good. It cannot be withdrawn or redacted |
| Restricted properties | Encrypted to the holder's key and kept in the journal, as every owner tier is. Only the hash of the ciphertext is on chain | The holder |

The split is by property, not by value. A restricted value that you repeat inside a public property, such as a name in a description or a link to a private file, is published with that property. The form labels every property Public or Restricted before you submit and asks you to confirm the public list.

**Writing.** Choose `eu-battery@1` or `eu-textile@1` when you issue a passport. The form asks for the item reference and serial once, and writes the document's identifier, GTIN and serial from them, so they cannot disagree with the passport identifier. A field left empty is absent from the document: the form makes up no identifier, classification, date, unit or precision, and a number is written with the digits you typed. A measurement is a value with its unit. **Load example** fills the form with invented data under the demonstration prefix, and **Load a document from a file** takes a product document of your own in the profile's data model. A property the form has no field for is kept as JSON under **Other properties** and written unchanged.

The API validates the whole document against the passport identifier it is about to sign, splits it, and signs exactly the public payload the profiles package returns. A document that fails, that could not be checked, or whose public part is over 65,535 bytes is refused before anything is signed, and the form shows each finding at the field it concerns.

**Reading.** A passport page shows the product data as structure, each property with its tier, and two checks that are kept apart:

| Check | Who sees it | What it says |
|---|---|---|
| Public view | Anyone | The public payload carries public properties only, keeps every rule it could break, and describes this passport's item. It says nothing about restricted data |
| Authorised view | The holder | The public payload rejoined with the restricted part satisfies the profile |
| Owner-tier check | The holder | The stored ciphertext hashes to the state's `payload_owner_hash`. This is the protocol's check, and the only statement about the on-chain commitment |

A check that could not run is shown as **Not checked**, never as passed. After a hand-on the restricted part stays sealed to the holder who wrote it, so the new holder's authorised view is not checked until they write an update.

**The validation engine.** The API depends on `jsonld`, `n3` and `shacl-engine` at the versions `@bsv/dpp-profiles` is tested with, and builds the engine once at start. It reads every context from the binding's folder and fetches nothing. If the libraries are missing the API still starts and says so: a profile held by a binding then cannot be written, and its readings say not checked.

**A profile of your own.** Put its `binding.json` and the files it names in a folder ([how to write a binding](https://github.com/bsv-blockchain/dpp/blob/main/docs/packages/dpp-profiles.md#write-a-binding)), then name the folder and trust its binding in `.env`:

```sh
CUSTOM_PROFILE_DIRS=profiles/example-bottle@1
TRUSTED_BINDING_DIGESTS=<the SHA-256 of that folder's binding.json>
```

`shasum -a 256 profiles/example-bottle@1/binding.json` prints the digest. Trust is that digest: the API registers the folder at start only when its `binding.json` has a listed digest and every file it names matches the length and SHA-256 the binding records. A folder that is not trusted, or that changed since you trusted it, is refused by name in the start-up log and on the Operations page, and the application runs without it. No source file changes. `apps/api/test/fixtures/custom-profile/` holds two example profiles to try this with, and `apps/api/test/custom-profile.test.ts` shows them trusted, untrusted and altered. A profile with no form in the web app is written as a JSON document, with the same labels and the same warning.

Restricted values never reach the application's logs, its listings, the index or any public export: `apps/api/test/bound-http.test.ts` issues passports carrying a value that appears nowhere else and searches all of them for it.

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

Then `LIVE_PUBLISHING=true` is written and the next write spends real satoshis. Until then, a write is built, checked and admitted as a draft, and aborted before the send, which is the dry run you can rehearse with. `SPEND_CAP_SATOSHIS` refuses writes once the platform has spent that much in a day.

Mainnet needs MongoDB (`docker compose -f deploy/compose.yml --env-file .env up -d mongo`, or a hosted one, in `MONGO_URL`) for sign-in and persistence, a WhatsOnChain API key in `WOC_API_KEY` for the wallet's monitor and the reader, `NETWORK=main` with `INDEX_URL=https://dpp-overlay.bsvb.net`, and your own `PASSPORT_HOST` and `GS1_PREFIX`. Changing an identity secret changes every key derived from it, so decide `BRAND_ROOT_SECRET` and `MANAGED_IDENTITY_SECRET` once.

## Connect an index

An index is where your passports become findable: the app announces every state to it before sending, and readers, including other platforms, look states and their evidence up there. The technology behind it is a BSV overlay service. It admits only states countersigned by a publisher key it names, and it follows this app's custody model. Three routes; this app's Compose file starts only the application database.

**The default index.** `.env` names the hosted testnet index, and `npm run go-live` registers this app with it. Mainnet is `INDEX_URL=https://dpp-overlay.bsvb.net` with `NETWORK=main`, where the operator approves each registration.

**Another provider's index.** `npm run connect-index -- --url https://index.example` writes the address and runs the checks; `go-live` then registers if the index registers publishers. A provider that hands out tokens itself: `npm run connect-index -- --url https://index.example --submit-token <t> --callback-token <t>`. Match the wallet's network and the managed custody profile; public lookup access alone is insufficient.

**Your own index.** Run it from the DPP repository's operator preset, `deploy/` in [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp): the index image and a persistent MongoDB on Docker Compose, configured from one env file. Give it this app's publisher key as `SERVICE_IDENTITY_KEY`, and this app's `NETWORK`: `npm run wallet` prints the key, and its first run generates `WALLET_ROOT_KEY` into `.env` (back the file up). Once the index runs, its `dpp-index connection` command writes the connection file; `npm run connect-index -- --from <that file>` here writes the address and both tokens to `.env` and runs the go-live checks, and when every check passes it switches live publishing on. After fixing a failed check, such as funds, run `npm run go-live`. The preset's README covers hosting, backup and recovery.

| App setting | Meaning |
| --- | --- |
| `INDEX_URL` | Index address reachable from the API |
| `INDEX_SUBMIT_TOKEN` | Submission and retraction access, from registration or the operator |
| `INDEX_CALLBACK_TOKEN` | Proof-delivery access, from registration or the operator |
| `NETWORK` | The same network as the wallet and index |

Restart the app after changing its settings. Keep the tokens out of browser code. For an API running in Docker, use an index address reachable from that container; `localhost` refers to the API container itself. The app announces to `INDEX_URL` once it holds both tokens; before that it runs an index in this process, and a connection failure does not cause another index to start.

## Deploy

If `.candidate.Dockerfile` is present, build with `docker build -f .candidate.Dockerfile -t my-dpp .` to include the local dependency archives. For projects generated by the published starter, build and run with the normal Dockerfile:

```sh
docker build -t my-dpp .
docker run -p 3000:3000 --env-file .env -v dpp-local:/app/local my-dpp
```

One container serves the API and the web app. Run one instance with `WORKER=with-api` (the default), or several API instances with `WORKER=off` and exactly one with `WORKER=only`, so the unattended duties run once.

## Next steps

Things this starter leaves to you, each a known path:

- **A registry of your own.** Claims are sent to `REGISTRY_URL`; the hosted reference validates without credentials and stores with permission. Running your own is the registry role of the standard.
- **A GS1 resolver at `PASSPORT_HOST`.** This starter answers each identifier's own path, `/01/<gtin>/21/<serial>`, with the passport page, so its host does not yet meet the standard's GS1 discovery profile (`spec/gs1-discovery.md` §1): the host a GS1 Digital Link identifier is minted under should be a GS1-Conformant Resolver for GTINs, and one that is not must redirect every `/01/` path with 307 to a resolver that is. To meet it, move the page to a path of its own and answer `/01/` paths with the resolver helpers in `@bsv/dpp-profiles`, naming the page under `gs1:dpp` as the item's default, or redirect them to a resolver that holds those records. Printed codes keep working either way, because the identifier does not change.
- **Server-rendered passport pages.** The public page renders in the browser. If crawlers or no-JavaScript readers matter, serve a plain HTML view of it from the API at the page's own path, not at the identifier's.
- **Self-custody.** Let a brand or a holder sign from their own BRC-100 wallet: implement a `Party` backed by a wallet connection in the browser, and let a transfer go to a key the holder's wallet derived.
- **Credentials, EPCIS, federation.** The `@bsv/dpp-credentials` package, the interoperability profiles and a second index that synchronises with yours are all documented in the standard.
- **A wallet storage server.** For several API instances, replace the SQLite file with the toolbox client against a wallet storage server.

## Versions

The DPP packages are pinned to one release set, named in `package.json` under `dpp`. Move them together, and read the standard's changelog first: they are prereleases.
