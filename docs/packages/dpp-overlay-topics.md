# @bsv/dpp-overlay-topics

`@bsv/dpp-overlay-topics` is the index as a library: the components that decide which passport states and claim anchors to keep, and answer lookups for them. Use it to embed an index in your own application or tests; to run the index as a network service, use the HTTP host from a checkout or the Compose setup, as this page explains.

**Experimental prerelease:** `@bsv/dpp-overlay-topics` 0.4.0-beta.4 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Words on this page

| Word | Meaning |
|---|---|
| Index | The service that admits passport states and claim anchors and answers lookups for them. BSV software calls it an overlay, hence the package's name |
| Topic manager | The admission rule: offered a transaction, it says which outputs to keep. `DppTopicManager` (topic `tm_dpp`) admits passport states countersigned by a publisher key it accepts; `AttestationTopicManager` (`tm_attestation`) admits claim anchors |
| Lookup service | Answers queries over what was admitted: `DppLookupService` (`ls_dpp`) finds a passport's states by identifier or data carrier, and `AttestationLookupService` (`ls_attestation`) finds anchors by subject, issuer, digest or anchoring service |
| Store | Where admitted outputs are kept: `InMemoryOverlayStorage` and `InMemoryDppStorage` for tests, their `Mongo` counterparts for a service |
| Engine | The `Engine` from `@bsv/overlay`, the BSV overlay software, which wires topic managers, lookup services and a store together |

## Library or service

The npm package exports only the library, `@bsv/dpp-overlay-topics`. Importing it does not listen on a port. The HTTP host is not part of the package's exports: run it from a checkout of the repository, or through the Compose setup in [operate](../operate/README.md), which builds the same host into a container.

| Route | Use it when | Start here |
|---|---|---|
| Library | Your application or test holds the index in process | [Embed an index](#embed-an-index) below |
| Service | Writers and readers reach the index over the network | [Run it as a service](#run-it-as-a-service) below |

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-core@0.3.0-beta.4 @bsv/sdk@2.8.10 @bsv/overlay@2.3.1
```

The package depends on `@bsv/overlay` 2.3.1 already; install it by name because the examples import its `Engine`. Name the exact versions: a bare `npm install @bsv/dpp-overlay-topics` installs the `latest` tag, which is still 0.4.0-beta.1. Keep the lockfile. The [support table](support-table.md) lists versions and runtime dependencies.

## Embed an index

Save this as `embed-index.mjs`. It builds an index from a topic manager, a lookup service and two in-memory stores, stores one passport state in it and looks the passport up again. It needs no network, wallet or checkout:

```js
import { CachedKeyDeriver, LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
import { buildLockingScript, completeState, ownerBlobHash, ownerKeyFromDeriver } from '@bsv/dpp-core'
import { DppLookupService, DppTopicManager, InMemoryDppStorage, InMemoryOverlayStorage } from '@bsv/dpp-overlay-topics'

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

`node embed-index.mjs` prints:

```
admitted outputs [ 0 ]
lookup found 1 output: the state just stored
```

`engine.submit` answers with the outputs each topic admitted, and `engine.lookup` with each matching output and the BEEF it arrived in; BEEF is the transaction format that carries a transaction with its ancestors and their block proofs. The engine checks every input against its source transaction, which is why the example funds the state from an output it builds itself. A state the topic manager refuses, such as one countersigned by another publisher, comes back with `outputsToAdmit` empty and is not found. The package's [engine test](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/test/engine.test.ts) adds a second state that spends the first, and a repeated submission.

To embed the claim rail as well, add `tm_attestation: new AttestationTopicManager()` and `ls_attestation: new AttestationLookupService(new InMemoryAttestationStorage())` beside the passport pair. An empty list of anchoring services admits any well-formed anchor; name the services you accept on anything a stranger can reach.

### Admission on its own

To see the admission rules without an engine, offer the topic manager the repository's version 2 test passport, genesis first. This reads `fixtures/chain-v2.json`, so save it as `admit.mjs` at the root of a checkout on `main`, after `npm ci` and `npm run build`, and run `node admit.mjs` there:

```js
import { readFileSync } from 'node:fs'
import { Beef, Transaction } from '@bsv/sdk'
import { DppTopicManager } from '@bsv/dpp-overlay-topics'

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

It prints the five states admitting outputs `0`, `0`, `1`, `0` and `0`, the pinned indexes. The constructor's first argument is the publisher identity key the topic accepts; in this test passport the custodian also publishes, so its key is that publisher key. Admission decides which offered outputs the policy accepts; lookup returns what was kept, for a reader to verify itself.

Before you rely on an embedded index for evidence, keep its records across restarts (the in-memory stores do not), take in later block proofs as the next section describes, and plan [recovery](../operate/export-import-recovery.md). [The overlay role](../implement/roles/overlay.md) gives the implementation order and failure cases.

## Run it as a service

The host speaks the overlay contract: `POST /submit` and `POST /lookup`, `POST /arc-ingest` for block proofs, `GET /capabilities`, `GET /history`, the evidence exports, `POST /retract` and the synchronisation routes. Its configuration is all environment.

- **With Compose.** Follow [run a service](../operate/README.md): it explains the publisher key, the tokens, storage and the first health and capability checks. Then issue [a passport lookup](../reference/contracts.md#find-passport-records).
- **From a checkout.** At the root of a checkout on `main`, after `npm ci` and `npm run build`, `SERVICE_IDENTITY_KEY=<publisher key> npm start -w @bsv/dpp-overlay-topics` starts it on port 8080 with in-memory storage, and `GET /health` answers `"status":"ok"`. It warns at start for every protection left off; set `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN`, `MONGO_URL` and `ANCHOR_SERVICE_KEYS` on anything a stranger can reach. The [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md) lists every variable.

**Tokens.** `POST /submit` and `POST /retract` need the operator's submit token, and `POST /arc-ingest` its callback token, when the operator sets them, as the hosted reference does. A writer gets each token from that index's operator.

**Later block proofs.** A state usually arrives before it is mined, without its block proof. The proof reaches an index only when someone sends it to that index's own `POST /arc-ingest`: synchronisation between indexes does not carry a proof that arrives later, and no rule yet says who delivers it to an index that learned the state by synchronising ([federation](../operate/federation.md#when-a-record-does-not-arrive), [known limitations](../operate/limitations.md)).

## Sources

| Integration | Source |
|---|---|
| Embed passport and claim indexing | [Library exports](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/src/lib.ts) |
| Run the HTTP service | [Host and configuration](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/src/index.ts) |
| Serve or consume its interface | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) |
| Select storage and service adapters | [Package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md) |

## Next

| To | Go to |
|---|---|
| Run an index for your own writer | [Run a service](../operate/README.md) |
| Exchange records with another index | [Federation with static peers](../operate/federation.md) |
| Write passports to your index | [Build an application](build-an-application.md), steps 2 and 3 |
| Build an index without these packages | [The overlay role](../implement/roles/overlay.md) |
