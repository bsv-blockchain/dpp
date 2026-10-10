# A Digital Product Passport application on BSV

Scaffolded by `@bsv/create-dpp-app`. Brands issue product passports as records on the BSV blockchain, hand them on along the supply chain, and anyone verifies a passport from its label. The records follow the open DPP standard; this application is one way of building what the standard requires, and every opinion it takes is yours to change.

## What you have

| Part | Where | What it does |
|---|---|---|
| Web app | `apps/web` | React single-page app: brand dashboard, passport pages, hand-on acceptance, public verification |
| API | `apps/api` | Express service that owns the platform wallet, writes and reads passports with the `@bsv/dpp` packages, keeps the journal and runs the unattended duties |
| Services | `deploy/compose.yml` | MongoDB for the application, and the reference DPP index with its own MongoDB |

The API's routes are in [apps/api/API.md](apps/api/API.md).

## First run

No wallet, funds, Docker or network:

```sh
npm test
```

This runs a whole passport lifecycle against an index in-process and a test wallet with made-up funding: issue, update, hand on with a claim code, retire, and a lifecycle claim, with the reader's report at the end. Then:

```sh
cp .env.example .env
npm run dev
```

The web app is on http://localhost:5173 and the API on http://localhost:3000. Without MongoDB the API keeps records in memory and signs you in as a developer with one development brand, so you can issue a passport, open its page, hand it on and accept it with the claim code, all without any service. Nothing reaches the chain: the wallet is a test wallet, and the index runs in-process with its header checks off.

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

## Going live

Writing a real passport spends real satoshis on BSV mainnet and is permanent. Before `LIVE_PUBLISHING=true`:

1. **MongoDB.** `docker compose -f deploy/compose.yml --env-file .env up -d mongo`, or a hosted MongoDB. Set `MONGO_URL`. Sign-in and persistence need it.
2. **A root key.** `openssl rand -hex 32` into `WALLET_ROOT_KEY`. Back it up: a root key alone is not a full wallet backup, so read the wallet toolbox's recovery guidance and keep the SQLite file in `local/` on a persistent volume.
3. **Secrets.** `AUTH_SECRET`, `BRAND_ROOT_SECRET` and `MANAGED_IDENTITY_SECRET`, each `openssl rand -hex 32`. Changing an identity secret changes every key derived from it, so decide them once.
4. **A header source.** A WhatsOnChain API key in `WOC_API_KEY`, for the wallet's monitor and the reader.
5. **An index that admits your publisher key.** `npm run wallet` prints the identity key. Run the reference index with `deploy/compose.yml` with that key as `INDEX_PUBLISHER_KEY`, two secrets as `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN`, and set `INDEX_URL`. The index image is built from the DPP standard's repository; the compose file says how.
6. **Funds.** `npm run wallet` prints a funding address. Pay it from any wallet, then take the payment in with the `wallet fund` command it prints, or from the Wallet page. A state costs a little over a hundred satoshis and leaves one satoshi in the passport output.
7. **Your identifier host and prefix.** `PASSPORT_HOST` must be a host you control and serve this application from, so a label's QR code opens the passport page.

Then set `LIVE_PUBLISHING=true`. Until then, a write is built, checked and admitted as a draft, and aborted before the send, which is the dry run you can rehearse with.

`SPEND_CAP_SATOSHIS` refuses writes once the platform has spent that much in a day.

## Deploy

```sh
docker build -t my-dpp .
docker run -p 3000:3000 --env-file .env -v dpp-local:/app/local my-dpp
```

One container serves the API and the web app. Run one instance with `WORKER=with-api` (the default), or several API instances with `WORKER=off` and exactly one with `WORKER=only`, so the unattended duties run once.

## Next steps

Things this starter leaves to you, each a known path:

- **A registry of your own.** Claims are sent to `REGISTRY_URL`; the hosted reference validates without credentials and stores with permission. Running your own is the registry role of the standard.
- **Server-rendered passport pages.** The public page renders in the browser. If crawlers or no-JavaScript readers matter, serve a plain HTML view at the identifier route from the API.
- **Self-custody.** Let a brand or a holder sign from their own BRC-100 wallet: implement a `Party` backed by a wallet connection in the browser, and let a transfer go to a key the holder's wallet derived.
- **Credentials, EPCIS, federation.** The `@bsv/vsc` package, the interoperability profiles and a second index that synchronises with yours are all documented in the standard.
- **A wallet storage server.** For several API instances, replace the SQLite file with the toolbox client against a wallet storage server.

## Versions

The DPP packages are pinned to one release set, named in `package.json` under `dpp`. Move them together, and read the standard's changelog first: they are prereleases.
