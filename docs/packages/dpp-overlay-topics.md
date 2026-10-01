# @bsv/dpp-overlay-topics

**Experimental prerelease:** `@bsv/dpp-overlay-topics` 0.4.0-beta.4 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

Install the exact published version:

```sh
npm install --save-exact @bsv/dpp-overlay-topics@0.4.0-beta.4
```

Keep the application lockfile and review compatibility before upgrading.

Reference topic managers, lookup services and an HTTP host. Use the [support table](support-table.md) for versions and runtime dependencies.

## Choose library or service use

Import the package to embed topic managers, lookup services and record stores in an application. The import does not listen on a port. Starting the HTTP host is a separate choice, useful when writers and readers connect over the network.

For the service route, use [the Compose setup](../operate/README.md). It explains publisher keys, authentication tokens, storage and the first health and capability checks. Then issue [a passport lookup](../reference/contracts.md#find-passport-records).

For library use, supply the storage and engine integration required by the host application. To see the admission rules on their own, offer the topic manager the version 2 fixture lineage, genesis first, from the repository root after [setup](../quick-start.md#get-the-code):

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

It prints the five states admitting outputs `0`, `0`, `1`, `0` and `0`, the pinned indexes. The custodian's key is the publisher key the topic accepts. An `Engine` from `@bsv/overlay` wires the topic manager, `DppLookupService` and a store together, as the package's [engine test](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/test/engine.test.ts) does with `InMemoryOverlayStorage` and `InMemoryDppStorage`. The engine checks every input against its source transaction, so it needs a BEEF that carries the whole ancestry, which the fixtures' raw transactions alone do not. Keep topic admission and lookup responsibilities separate: admission decides which offered outputs the policy accepts; lookup retrieves retained candidates for a reader to verify. An in-memory store is useful for a test but does not retain records across process loss.

Add proof ingestion and [recovery](../operate/export-import-recovery.md) before treating an embedded index as a retained evidence source. [The overlay role](../implement/roles/overlay.md) gives the implementation order and failure cases.

## Integration sources

| Integration | Source |
|---|---|
| Embed passport and attestation indexing | [Library exports](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/src/lib.ts) |
| Run the HTTP service | [Host and configuration](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/src/index.ts) |
| Serve or consume its interface | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/overlay.yaml) |
| Select storage and service adapters | [Package guide](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/README.md) |

Importing the library does not start the host. Begin service setup at [Operate](../operate/README.md); use the [overlay role](../implement/roles/overlay.md) when building an independent implementation.

Read [operating limitations](../operate/limitations.md) before relying on synchronisation or recovery. New proof-bearing states and later proof updates to already-held states follow different paths in the reference host.
