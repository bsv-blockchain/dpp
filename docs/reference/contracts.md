# Contracts and schemas

This page lists every HTTP route of the index and the registry with what it takes and what it answers, and maps the JSON schemas to the documents they define. It is for implementers and operators who need the exact shapes; the contract files linked at the end are the authority where this page and they differ.

The index (the reference package and its software call it an overlay) admits passport states and claim anchors and answers lookups. The registry validates and keeps signed claims. They are separate services: a route on one does not mean the other runs at the same address.

## Check a service

Every service answers two open routes. Against your own index, started as [run a service](../operate/README.md) describes, or against the hosted index at `https://dpp-overlay.bsvb.net`:

```sh
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

`/health` names the topics and lookup services the index runs. `/capabilities` is its capability document, in the shape of [`contracts/capabilities.schema.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/capabilities.schema.json): roles, protocol versions, profiles, the publisher policy, synchronisation, limits and what the service does not do. Compare it with what your client needs before you submit records or request an export.

Two things the capability document does not tell you:

- `publisherPolicy.publisherKeys` lists the publisher keys active at the moment of the request, without their activation windows; the schema allows no other property there. A key's window is only in the operator's signed policy chain, which [tell operators apart](../operate/federation.md#tell-operators-apart) shows how to check.
- The registry contract defines its own `Capabilities` document, a different shape from `capabilities.schema.json`, and the hosted registry serves the contract's. Which one a registry's `GET /capabilities` must answer is not settled; the [registry guide](../implement/roles/registry.md) explains.

## Find passport records

This asks an index for every state it holds for one passport and prints each state's transaction identifier. Save it as `lookup.mjs` at the root of the checkout, after `npm ci` and `npm run build`, or in a project with `@bsv/sdk@2.8.10` installed:

```js
// Ask an index for every state it holds for one passport.
import { Transaction } from '@bsv/sdk'

const indexUrl = process.env.INDEX_URL ?? 'https://dpp-overlay.bsvb.net'
const passportId = process.env.PASSPORT_ID ?? 'https://id.gs1.org/01/09506000134352/21/7AC18477503A'

const response = await fetch(new URL('/lookup', indexUrl), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
})
if (!response.ok) throw new Error(`POST /lookup answered ${response.status}: ${await response.text()}`)
const answer = await response.json()
console.log(`${answer.type} with ${answer.outputs.length} outputs from ${indexUrl}`)
for (const output of answer.outputs) console.log(`  ${Transaction.fromBEEF(output.beef).id('hex')} output ${output.outputIndex}`)
```

Run `node lookup.mjs`. By default it asks the hosted index for a live version 1 passport and prints:

```
output-list with 5 outputs from https://dpp-overlay.bsvb.net
  1730153134890f8c1223d92850ec5a9d4c9cc84242fdf56d05e08e407aadaada output 0
  79d3f93d3b6c517ea67c411f775887f489ac5f915b0b5e92e494f59184b6fab4 output 0
  1dea31ba2fdf78aedc6ce0692485e6309b38f8116703081d371939319461154c output 0
  2a2693e6fa39bad3f2cf9d2acd21e161111759cba9f5aad86140d45f811ce528 output 0
  1947027e0cd40613795bc2ec005defff03ada9695c1f1e323da26797b9bf4150 output 0
```

Set `INDEX_URL` to ask another index, such as `INDEX_URL=http://localhost:8080 node lookup.mjs`, and `PASSPORT_ID` to ask for another passport; [the hosted reference page](../deployment.md) lists three live ones. An index that holds nothing for the passport, such as a new index, prints `output-list with 0 outputs`. Each output carries its transaction evidence as BEEF, the encoding that bundles a transaction with its ancestors and merkle proofs. A 200 answer does not establish a valid history or inclusion: pass the outputs to a [reader](../implement/roles/passport-reader.md), or run `node examples/verify-passport.mjs <passportId> <indexUrl>`, which verifies them.

Holding only a GTIN and serial, ask by GS1 key instead: `query: { gs1Key: '01/09506000134352/21/7AC18477503A' }`, or the tuple `01:09506000134352|21:7AC18477503A`, answers the states of every passport the index holds for that key under any host, each under its exact identifier, which you then verify ([identifiers](../identifiers.md#use-the-identifier-throughout-the-request)). An index on an earlier release refuses the query.

To compare two indexes, compare transaction identifiers and proofs, not bytes. The contract does not fix the form of a lookup's BEEF, so two indexes can serve the same states differently: for the passport above, the hosted index and a local index restored from its package returned the same five transactions, each 36 bytes apart.

## Index routes

[`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) is a profile of the BSV ecosystem's overlay HTTP contract: BRC-22 submission and BRC-24 lookup as upstream defines them, plus the extensions below. The tokens are the operator's settings; on the hosted index, outside writers have none of them.

| Route | Access | Request | Success | Errors |
|---|---|---|---|---|
| `POST /submit` | Bearer `SUBMIT_TOKEN` when set | The transaction as BEEF, `Content-Type: application/octet-stream`; `X-Topics: ["tm_dpp"]` for a state or `["tm_attestation"]` for an anchor. A state's BEEF must carry its predecessor | 200 with the STEAK, `X-Admission` and, for a refused state, `X-Admission-Refusal`, described below | 400 for an empty body or bad `X-Topics`, 401, 413 beyond 8 MiB |
| `POST /lookup` | Open | JSON `{ "service": "ls_dpp", "query": { "passportId": "..." } }`, or `ls_attestation` with an anchor query | 200 `{ "type": "output-list", "outputs": [{ "beef", "outputIndex" }] }` | 400 |
| `POST /arc-ingest` | `ARC_CALLBACK_TOKEN` when set, as a bearer or `X-Callback-Token` | JSON `{ "txid", "merklePath", "blockHeight" }`, the merkle path as BRC-74 BUMP hex: the shape an ARC-compatible broadcaster's callback carries | 200 `{ "status": "applied" }`, or `"ignored"` with `"reason": "no merkle path"` when none was sent | 400 when the proof does not contain the transaction or fails against headers, 401, 404 when the index does not hold the transaction, 503 when the header source cannot evaluate it |
| `POST /retract` | Bearer `SUBMIT_TOKEN` | JSON `{ "txid", "outputIndex", "reason" }`, for a state the network refused after it was announced | 200 | 401, 404, 409 `retraction-refused` when the index holds a proof for the output, the network knows the transaction or the output is spent, 503 `chain-tracker-unavailable` |
| `GET /history?passportId=` (or `uid=`), `&limit=&cursor=` | Open | Query string | 200, one page of a passport's history over a snapshot | 400 `cursor-invalid`, 410 `snapshot-expired` after ten minutes |
| `GET /evidence-package?passportId=` | Open | Query string | 200, the signed package of the newest 500 states | 503 `export-unavailable` without `EXPORT_SIGNING_KEY` |
| `GET /evidence-export?passportId=&cursor=` | Bearer `EXPORT_TOKEN` when set | Query string | 200, one signed part of the complete export | 401 `export-unauthorised`, 400, 410, 503 |
| `GET /publisher-policy` | Open | | 200, the signed publisher policy chain the index admits under, oldest first | 404 `no-publisher-policy` on an index under one identity key |
| `GET /capabilities`, `GET /health` | Open | | 200 | |
| `POST /requestSyncResponse`, `POST /requestForeignGASPNode` | Open, bounded | The synchronisation protocol's bodies | 200 | 404 for a transaction the index does not hold |

[Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md) covers `/submit`, `/arc-ingest` and `/retract` in a writer's flow, and [export, import and recovery](../operate/export-import-recovery.md) the two export routes.

### What `POST /submit` answers

A well-formed, authorised `/submit` answers 200 whether or not anything was admitted. The body is the STEAK, the BRC-22 acknowledgement: for each topic, `outputsToAdmit` lists the outputs the index admitted, and `coinsToRetain` and `coinsRemoved` the inputs it kept or removed. The `X-Admission` header says per topic, comma-separated, which of three things happened. These are the answers a reference index gave for the genesis of the passport above:

| `X-Admission` | Body | Meaning |
|---|---|---|
| `tm_dpp=admitted` | `{"tm_dpp":{"outputsToAdmit":[0],"coinsToRetain":[],"coinsRemoved":[]}}` | The index admitted the state. |
| `tm_dpp=duplicate` | `{"tm_dpp":{"outputsToAdmit":[],"coinsToRetain":[]}}` | The index already held it; announcing it again changes nothing. The body has no `coinsRemoved`, which is how a duplicate is told from a refusal. |
| `tm_dpp=none` | `{"tm_dpp":{"outputsToAdmit":[],"coinsToRetain":[],"coinsRemoved":[]}}` | The index refused it. |

A refusal also carries `X-Admission-Refusal`, which names per topic the check that failed. For the `none` answer above, from an index whose publisher key was not the state's, an index on this release adds `X-Admission-Refusal: tm_dpp=publisher-not-authorised`. The contract lists every code under `x-refusal-codes`, and [when the index refuses a state](../packages/build-an-application.md#when-the-index-refuses-a-state) says what each asks of a writer. Where a verification report names the same failure, the code is the report's own word, so a writer and a reader see the same one. Only `tm_dpp` records reasons: an anchor refused on `tm_attestation`, or a state refused by an index on an earlier release, comes back without the header, and then only the operator's log says why ([known limitations](../operate/limitations.md)).

## Validate a claim

Send the secured native claim as JSON to `POST /validate?subject=...` on a registry. The query value is the product identifier the caller expects the claim to be about. The [runnable request](../quick-start.md#ask-a-registry-to-check-the-claim) reads the claim from a fixture and handles the URL encoding.

The answer names its contract and carries named checks, with a shared `report` when a subject can be determined. Read that report's checks and limits: a transport success or a registry-level outcome is not evidence about each check. Claims in the historical representation answer under a different response contract ([historical claims](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md)).

The operation does not store or anchor the claim. The optional `tokenHistory` field supplies BEEF-encoded history as request context and is removed before the claim is verified ([the operation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml#L773-L823)). A malformed or ambiguous request, unreadable token history included, can answer 400. A refused connection means no registry runs at the chosen URL.

## Registry routes

[`contracts/registry.yaml`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml) defines the attestation registry. No public reference registry is published; the [registry guide](../implement/roles/registry.md) says what one must serve. The main routes:

| Route | Access | What it does |
|---|---|---|
| `POST /validate?subject=` | Open | Verifies a claim without storing or anchoring it |
| `POST /attestations` | Bearer write token when the registry sets one | Verifies and stores a claim, then reports its anchor; 422 when verification fails, with nothing stored |
| `GET /attestations`, `GET /attestations/{id}/proof`, `GET /attestations/{id}/report` | Open | The stored claims in pages, everything a third party needs to check one claim's anchor, and its verification report |
| `GET /history`, `GET /chain`, `GET /passports/{passportId}/evidence-package` | Open | A passport's lifecycle history and custody timeline, and its evidence package |
| `POST /status`, `POST /status/{listId}/allocate`, `/revoke`, `/suspend`, `/clear`; `GET /status/{listId}` | Write routes need the write token; reading a list is open | Status lists for issued credentials |
| `GET /capabilities`, `GET /health` | Open | The registry's own capability document, which may name its anchoring key as `anchoredBy`, and its health |

The registry contract also defines GS1 resolver routes; [GS1 discovery](../interoperability/gs1-discovery.md) covers them. The [interoperability contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/interoperability.yaml) defines EPCIS import and passport projection routes ([interoperability](../interoperability/README.md)).

## Schemas

| Schema | Defines |
|---|---|
| [capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/capabilities.schema.json) | An index's or implementation's capability document |
| [publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json) | One version of a publisher policy, `dpp-publisher-policy@1` |
| [verification-report.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/verification-report.schema.json) | The report a reader produces for one passport |
| [paginated-history.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/paginated-history.schema.json) | One page of `GET /history` |
| [evidence-package.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-package.schema.json) | The signed manifest of an evidence package, `dpp-evidence-package@1` |
| [evidence-export.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-export.schema.json) | One part of the complete export, with its coverage record |
| [native-evidence-extension.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/native-evidence-extension.schema.json) | A reference, carried inside a credential in another representation, to evidence already on chain in the native records |
| [epcis-import.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/epcis-import.schema.json) | The record of one retained EPCIS import and its per-event results |
| [passport-source.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-source.schema.json) | A source revision of a model, batch, item or component record, and a typed relationship between subjects |
| [passport-projection.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-projection.schema.json) | A passport projection, `passport-projection@1`: one passport's fields derived from pinned sources under a named policy |
| [profile-evidence.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/profile-evidence.schema.json) | The shapes a profile field takes when its value is more than a scalar: a claim's evidence, a certification, a measurement |
| [release-set.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/release-set.schema.json) | A [release set](release-sets.md) |
| [manifest.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.schema.json), [baseline.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline.schema.json), [selection.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selection.schema.json) | The [conformance](conformance.md) ledger, a recommended baseline and a release's claim selection |
| [packages/dpp-profiles/schemas](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas) | The industry profiles' payload schemas |

For how to build each service, see the [registry](../implement/roles/registry.md) and [overlay](../implement/roles/overlay.md) role guides. Next: read the [specification index](specifications.md) for the rules these shapes carry.
