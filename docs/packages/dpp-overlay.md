# Index runtime (advanced)

Developers and operators building custom integrations can use `@bsv/dpp-overlay` to embed an index or run one over HTTP. Its library components and server admit passport states and claim anchors, then answer lookups for those records.

For a new index, follow [Run an index from source](../operate/README.md): the repository's Docker Compose preset builds this runtime's image and runs it with MongoDB, so no installation is needed.

An app connecting to an existing index over HTTP needs its URL and access settings; it does not need this hosting package.

**Experimental prerelease:** `@bsv/dpp-overlay` 0.4.0-beta.13 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established. Do not use 0.4.0-beta.11: its archive differed from the approved bytes in one file mode, no release set names it, and beta.12 is the same source with the approved bytes.

## Runtime and example prerequisites

| Procedure | Input and source |
|---|---|
| Direct installation | Node 22 or later; the exact packages listed in Install. Candidate archives come from a checkout containing `packages/dpp-protocol`. |
| Embedded example | Installed project; the script supplies synthetic keys and funding. No network, wallet or checkout needed. |
| Admission-only example | `fixtures/chain-v2.json` in the [reviewed source checkout](../quick-start.md#get-the-code), after `npm ci` and `npm run build`. Save and run `admit.mjs` at its root. |
| Source service | The same built checkout; publisher public key, route tokens, storage and accepted anchoring-service keys from the operator. |

## Words on this page

| Word | Meaning |
|---|---|
| Index | The service that admits passport states and claim anchors and answers lookups for them. BSV software calls it an overlay, hence the package's name |
| Topic manager | The admission rule: offered a transaction, it says which outputs to keep. `DppTopicManager` (topic `tm_dpp`) admits passport states countersigned by a publisher key it accepts; `AttestationTopicManager` (`tm_attestation`) admits claim anchors |
| Lookup service | Answers queries over what was admitted: `DppLookupService` (`ls_dpp`) finds a passport's states by identifier, data carrier or GS1 key, and `AttestationLookupService` (`ls_attestation`) finds anchors by subject, issuer, digest or anchoring service |
| Store | Where admitted outputs are kept: `InMemoryOverlayStorage` and `InMemoryDppStorage` for tests, their `Mongo` counterparts for a service |
| Engine | The `Engine` from `@bsv/overlay`, the BSV overlay software, which wires topic managers, lookup services and a store together |

## Library or service

The source candidate exports its library at `@bsv/dpp-overlay` and HTTP host at `@bsv/dpp-overlay/server`; neither starts on import. `dpp-index` runs the configured operator process; `dpp-index connection` writes an application's connection file. Earlier published versions need repository or container startup.

| Route | Use it when | Start here |
|---|---|---|
| Library | Your application or test holds the index in process | [Embed an index](#embed-an-index) below |
| Service | Writers and readers reach the index over the network | [Run it as a service](#run-it-as-a-service) below |

## Install

Install directly for custom embedding or configuration. The Compose preset builds the runtime from source and needs no installation.

**Publication pending:** this page describes the renamed source candidate. [Install its local archives](README.md#use-the-renamed-source-candidate) now:

1. At the checkout root, run `npm ci`, `node scripts/release-candidates.mjs` and `node scripts/consumer-check.mjs` to build, pack and test archives in a separate project. Nothing is published.
2. In your application, use `npm install /absolute/path/to/the-produced-package.tgz` with protocol, profiles and overlay archive paths together to resolve unpublished dependencies locally. Find `bsv-dpp-overlay-0.4.0-beta.13.tgz` in `release/candidates`; retain archives and lockfile.
3. Declare direct imports of the SDK and upstream overlay package at the versions below.

The npm command below applies once these exact versions have been published. Run it in your project:

```sh
npm install --save-exact @bsv/dpp-overlay@0.4.0-beta.13 @bsv/dpp-protocol@0.3.0-beta.10 @bsv/sdk@2.8.10 @bsv/overlay@2.3.1
```

The package already depends on `@bsv/overlay` 2.3.1; declare it directly because the examples import its `Engine`. A bare `npm install @bsv/dpp-overlay` selects `latest`, the newest beta. Pin versions so upgrades are your choice, and keep the lockfile. The [support table](support-table.md) lists versions and runtime dependencies.

## Embed an index

1. Save this complete file as `embed-index.mjs`. It combines a topic manager, lookup service and two in-memory stores, stores one passport state and looks it up again:

```js
import { CachedKeyDeriver, LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
import { buildLockingScript, completeState, ownerBlobHash, ownerKeyFromDeriver } from '@bsv/dpp-protocol'
import { DppLookupService, DppTopicManager, InMemoryDppStorage, InMemoryOverlayStorage } from '@bsv/dpp-overlay'

// Two test keys: the writer who signs the state, and the publisher whose countersignature the index accepts.
const writer = PrivateKey.fromHex('11'.repeat(32))
const publisher = PrivateKey.fromHex('22'.repeat(32))
const passportId = 'https://dpp.bsvb.net/01/09521000000018/21/EMBED-1'

// The index: the passport topic manager and its lookup service over in-memory stores.
const engine = new Engine(
  { tm_dpp: new DppTopicManager(publisher.toPublicKey().toString()) },
  { ls_dpp: new DppLookupService(new InMemoryDppStorage()) },
  new InMemoryOverlayStorage(),
  'scripts only', // no header source: inclusion is not checked
)

// A version 2 genesis state, signed by the writer and countersigned by the publisher.
const state = await completeState({
  version: '2', op: 'ISSUE', passportId, timestamp: '2026-10-01T09:00:00Z',
  ownerIdentityKey: ownerKeyFromDeriver(passportId, new CachedKeyDeriver(writer)),
  actorIdentityKey: writer.toPublicKey().toString(), actorKeyId: 'embed example',
  eventData: '', payloadPublic: JSON.stringify({ name: 'Example chair' }), payloadOwnerHash: ownerBlobHash([1, 2, 3]),
  previousTxid: '', previousOutputIndex: null, lineageGenesis: null, controlLinkage: '', authorisationCommitment: '',
}, new ProtoWallet(writer), new ProtoWallet(publisher))

// Fund it from a made-up mined output anyone can spend, so the BEEF carries its whole ancestry.
const funding = new Transaction()
funding.addOutput({ satoshis: 10, lockingScript: new LockingScript([{ op: 0x51 }]) })
funding.merklePath = MerklePath.fromCoinbaseTxidAndHeight(funding.id('hex'), 800_000)
const tx = new Transaction()
tx.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, writer.toPublicKey()) })

// Store: submit the transaction to the topic. Look up: ask the lookup service for the passport.
const steak = await engine.submit({ beef: tx.toBEEF(), topics: ['tm_dpp'] })
console.log('admitted outputs', steak.tm_dpp.outputsToAdmit)
const answer = await engine.lookup({ service: 'ls_dpp', query: { passportId } })
console.log('lookup found', answer.outputs.length, 'output:', Transaction.fromBEEF(answer.outputs[0].beef).id('hex') === tx.id('hex') ? 'the state just stored' : 'another state')
```

2. Run `node embed-index.mjs`. Expected output:

```
admitted outputs [ 0 ]
lookup found 1 output: the state just stored
```

| Call or check | Result |
|---|---|
| `engine.submit` | Outputs admitted by each topic |
| `engine.lookup` | Each matching output and its incoming BEEF, which carries the transaction, ancestors and block proofs |
| Input validation | Checks every input against its source transaction; the example therefore builds its own funding output. |
| Refused state, such as another publisher's countersignature | Empty `outputsToAdmit`; lookup does not find it. |

The [engine test](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/test/engine.test.ts) adds a second state spending the first and a repeated submission.

3. For the claim rail, add `tm_attestation: new AttestationTopicManager()` and `ls_attestation: new AttestationLookupService(new InMemoryAttestationStorage())` beside the passport pair. An empty anchoring-service list admits any well-formed anchor. Name accepted services before exposing the index to strangers.

### Admission on its own

1. Save this complete file as `admit.mjs` at the checkout root. It reads `fixtures/chain-v2.json` and offers its version 2 test passport to the topic manager, genesis first, without an engine:

```js
import { readFileSync } from 'node:fs'
import { Beef, Transaction } from '@bsv/sdk'
import { DppTopicManager } from '@bsv/dpp-overlay'

const chain = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const topic = new DppTopicManager(chain.custodianKey, { managedAcceptance: true })
const beef = new Beef()
let previousTxid
for (const state of chain.states) {
  const tx = Transaction.fromHex(state.rawTx)
  beef.mergeRawTx(tx.toBinary())
  // The inputs that spend an output the topic already admitted: here, the previous state.
  const previousCoins = tx.inputs.flatMap((input, i) => (input.sourceTXID === previousTxid ? [i] : []))
  const { outputsToAdmit } = await topic.identifyAdmissibleOutputs(beef.toBinaryAtomic(state.txid), previousCoins)
  console.log(state.txid.slice(0, 12), 'admits output', outputsToAdmit.join(', ') || 'none')
  previousTxid = state.txid
}
```

2. Run `node admit.mjs`.

| Result or input | Meaning |
|---|---|
| Five states admit outputs `0`, `0`, `1`, `0`, `0` | The pinned output indexes. |
| Constructor's first argument | Accepted publisher identity key; the fixture custodian also publishes, so it supplies that key. |
| Admission | Decides which offered outputs the policy accepts. |
| Lookup | Returns retained outputs for the reader to verify itself. |

Before relying on an embedded index, persist records across restarts, ingest later block proofs as below and plan [recovery](../operate/export-import-recovery.md). In-memory stores do not persist. [The overlay role](../implement/roles/overlay.md) gives implementation order and failure cases.

## Run it as a service

The repository's Compose preset runs this host with persistent storage from one environment file. [Run an index from source](../operate/README.md) covers its startup, checks and an application's connection file; it is the route for a new index.

The host speaks the overlay contract: `POST /submit` and `POST /lookup`, `POST /arc-ingest` for block proofs, `GET /capabilities`, `GET /history`, the evidence exports, `POST /retract` and the synchronisation routes. Its configuration is all environment.

### Other routes from source

- **With the repository's Compose preset.** Follow [run an index from source](../operate/README.md): it explains the publisher key, the tokens, storage, the first health and capability checks and the application's connection. Then issue [a passport lookup](../reference/contracts.md#find-passport-records).
- **From a checkout.** Run `SERVICE_IDENTITY_KEY=<publisher key> npm start -w @bsv/dpp-overlay` at the built checkout root: port 8080, in-memory storage, `GET /health` returns `"status":"ok"`. Startup warns for every disabled protection. Before exposing it to strangers, set `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN`, `MONGO_URL` and `ANCHOR_SERVICE_KEYS`. The [package guide](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/README.md) lists every variable.

### Check access and registration outcomes

| Token use | Route and binding |
|---|---|
| Submit | `POST /submit` and `POST /retract` |
| Callback | `POST /arc-ingest` |
| Per-publisher binding | A token belongs to one publisher key and one use: only states countersigned by that key or anchors naming it as anchoring service are accepted. |
| Operator-wide alternative | One shared token per route may coexist. |

Tokens are required when configured, as on the hosted reference. Writers obtain both tokens from the operator, who uses `dpp-index connection` for an application's pair and its connection file, or `dpp-index tokens issue` for one token, and can revoke each separately.

| Refusal | Meaning |
|---|---|
| `403 token-publisher-mismatch` | State or anchor names another key. |
| `401` | Token is unknown, revoked or for the wrong use. |

For self-service registration:

1. The operator sets `REGISTRATION=open` or `REGISTRATION=approval`, and supplies `OPERATOR_SIGNING_KEY` to sign appended policy versions.
2. The application sends `POST /register` with a `dpp-index-registration@1` request signed by its own wallet through `createSignature`.

| Request field | Source |
|---|---|
| Publisher key | Application wallet |
| Index address and network | Selected index |
| Custody profile | Index's declared profile |
| Label | Application |

3. The index verifies the request from itself. On acceptance it appends the operator-signed policy version, serves it immediately on `GET /publisher-policy` and returns the key's two tokens, shown once. A key registers once.

| Mode or result | Next step |
|---|---|
| `REGISTRATION=approval`, `202 pending` | Wait for `dpp-index registrations approve`; then the application re-sends a fresh request to collect tokens. |
| No `REGISTRATION`, `404 registration-unavailable` | Stop registration. The capability document lists `self-service-registration` as unsupported. |

**Later block proofs.** States usually arrive before mining, without proofs. Someone must send each later proof to that index's own `POST /arc-ingest`; synchronisation does not carry it. No rule yet assigns delivery to an index that learned the state by synchronising ([federation](../operate/federation.md#when-a-record-does-not-arrive), [known limitations](../operate/limitations.md)).

## Sources

| Integration | Source |
|---|---|
| Embed passport and claim indexing | [Library exports](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/src/lib.ts) |
| Run the HTTP service | [Host and configuration](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/src/index.ts) |
| Read a historical UORA anchor | `tryParseUoraAnchor` and `expectedLockingKey`, as [`examples/verify-anchor.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-anchor.mjs) shows for `uora-anchor-v3`; it refuses `uora-anchor-v2` and does not read `uora-anchor-v1` ([legacy UORA anchors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md)) |
| Serve or consume its interface | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) |
| Select storage and service adapters | [Package guide](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/README.md) |

## Next

| To | Go to |
|---|---|
| Run an index for your own writer | [Run an index from source](../operate/README.md) |
| Exchange records with another index | [Federation with static peers](../operate/federation.md) |
| Write passports to your index | [Build an application](build-an-application.md), steps 2 and 3 |
| Build an index without these packages | [The overlay role](../implement/roles/overlay.md) |
