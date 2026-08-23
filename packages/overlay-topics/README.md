# @bsv/dpp-overlay-topics

The DPP overlay: the `tm_dpp` topic manager and the `ls_dpp` lookup service.
It admits an output by asking `@bsv/dpp-core` whether the state is valid, then
indexes it so a passport identifier can be resolved back to its latest state.

The package is two things at once, and which one you get depends on how you
enter it.

**As a library.** `main` and the `exports` map point at `dist/lib.js`, so
`import ... from '@bsv/dpp-overlay-topics'` gets the topic manager, the lookup
service and the record stores, and nothing that listens on a port. This is how
the demonstration app uses it: both components run in process against
`InMemoryDppStorage`, which is what its offline mode and the tests are.

**As a service.** `src/index.ts` is an HTTP host for the same two components,
speaking the ecosystem's standard wire (BRC-22 `POST /submit`, BRC-24
`POST /lookup`, plus `GET /health`), which is exactly the contract
`contracts/overlay.yaml` in this repository pins. It is reached by path and
never by specifier: `npm start` runs `node dist/index.js` and the Dockerfile's
`CMD` names the same file. That is deliberate, so importing the package can
never start a server.

The service boots only when node runs the file directly, which is how
`test/http.test.ts` drives `createRequestHandler` and `startOverlayService`
without a container.

## Running it

```
npm run build      # tsc to dist/, needed before start and before the app imports it
npm run typecheck  # the same compile, emitting nothing
npm test           # admission policy, lookup indexing, engine wiring, the HTTP surface
npm start          # node dist/index.js
```

Configuration is environment only, and an unset variable switches its feature
off or falls back; only a missing identity key stops the boot. The image builds
from the repository root, not from this directory, because the service depends
on the `@bsv/dpp-core` workspace:

```
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

## Configuration

Everything is environment. An unset variable switches its feature off or falls
back; the only variable that can fail the boot is the identity key, because
admitting without one would admit anything.

| Variable | Effect when set | When unset |
|----------|-----------------|------------|
| `PORT` | Port to bind. Platforms inject it. | `8080` |
| `SERVICE_IDENTITY_KEY` | The public key `server_signature` is verified against (`spec/record-model.md` §5). 66 hex characters, compressed. | Falls back to deriving it from `SERVER_PRIVATE_KEY`, with a warning; if neither is set, the boot fails |
| `SERVER_PRIVATE_KEY` | Fallback source for the above. Set the public key instead: the service only ever needs the public half. | See above |
| `MONGO_URL` | Persist the engine's UTXO state and the `ls_dpp` index. | In memory, with a warning. Restart loses the index |
| `MONGO_DB` | Database name. | The connection string's default |
| `NETWORK` | `main` or `test`. | `main` |
| `WOC_API_KEY` | WhatsOnChain API key for header lookups. Raises the rate limit. | Anonymous access |
| `CHAIN_TRACKER` | `scripts-only` disables SPV verification of submissions. Local development only; hosted it would admit unproved ancestry. | WhatsOnChain on `NETWORK` |
| `SUBMIT_TOKEN` | Shared secret required as `Authorization: Bearer` on `POST /submit`. `/lookup` and `/health` stay open. | `/submit` is open to anyone, which is only acceptable on a local container. Set it on any reachable deployment |
| `ANCHOR_SERVICE_KEYS` | Comma-separated identity keys of the anchoring services this instance carries anchors for. Public keys only. A preference, not a security control: every admitted anchor names its own author either way. | Anchors from any treasury are carried, each still saying whose it is |
| `PUBLIC_URL` | Passed to the engine as its hosting URL. Only meaningful with peer discovery, which is off. | unset |
