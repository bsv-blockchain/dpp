# Contracts and schemas

This page lists every HTTP route of the index and the registry with what it takes and what it answers, and maps the JSON schemas to the documents they define. Implementers and operators can use it to make requests and interpret responses. The linked contracts take precedence where this page differs.

The index (overlay in the reference software) admits passport states and claim anchors and answers lookups. The registry validates and keeps signed claims. They are separate services; do not assume they share an address.

## Before you start

| Procedure | Input and source |
|---|---|
| Check a service | `curl` and its URL from the operator. Start a local index with [Run an index from source](../operate/README.md), or use `https://dpp-overlay.bsvb.net`. |
| Run JavaScript requests | Node.js 22 or later. Use the checkout root after `npm ci` and `npm run build`; the lookup also runs in a project with `@bsv/sdk@2.8.10` installed. |
| Look up records | Expected passport identifier from the caller, or its GTIN and serial. Select the index URL below. |
| Validate a claim | A registry URL, secured native claim and expected product identifier from the caller. The example uses the checkout fixture and hosted registry. Validation is open. |
| Submit, retract, ingest proofs or export | Obtain the tokens in the route table from the operator. Outside writers have none of the hosted index tokens. |
| Publisher admission windows | Operator's signed policy chain ([verification](../operate/federation.md#tell-operators-apart)) |

## Check a service

1. Request the two open routes every service answers. These commands target your local index:

```sh
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

2. Compare the answers with your client's requirements before submitting records or requesting an export.

| Response | What it provides |
|---|---|
| `/health` | Topics and lookup services the index runs |
| `/capabilities` | Roles, protocol versions, profiles, publisher policy, synchronisation, limits and unsupported functions, in the shape of [`contracts/capabilities.schema.json`](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/capabilities.schema.json) |

| Missing or unsettled fact | Source and stop condition |
|---|---|
| Publisher activation windows | `publisherPolicy.publisherKeys` lists only keys active at request time; the schema allows no other property there. Check the operator's signed policy chain before relying on a key's window. |
| Registry capability shape | The registry contract defines its own `Capabilities`, different from `capabilities.schema.json`; the hosted registry serves the contract's shape. Which document a registry's `GET /capabilities` must answer is unsettled. Follow the [registry guide](../implement/roles/registry.md) before assuming one shape. |

## Find passport records

1. Save this as `lookup.mjs` in the prepared checkout or SDK project. It requests every state the index holds for one passport and prints each transaction identifier.

```js
// Ask an index for every state it holds for one passport.
import { Transaction } from '@bsv/sdk'

const indexUrl = process.env.INDEX_URL ?? 'https://dpp-overlay.bsvb.net'
const passportId = process.env.PASSPORT_ID ?? 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'

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

2. Run `node lookup.mjs`. The default request returns this live version 2 passport under the demonstration prefix 952:

```
output-list with 3 outputs from https://dpp-overlay.bsvb.net
  debfc9c9125a490cb6642669fcc1da49ece52aff06ad52715abef1ca0c0091e2 output 0
  52d31ed5272b874f1036712f55e32e5a075d3278027ed9ea7df87f1a4d26161c output 0
  122bb72c201f115c81ab2313058ab164ba3ba7f4a09ecb360431afabc311221d output 0
```

| Setting or selector | Value and result |
|---|---|
| `INDEX_URL` | Default `https://dpp-overlay.bsvb.net`; use `INDEX_URL=http://localhost:8080 node lookup.mjs` for a local index |
| `PASSPORT_ID` | Select another passport; [hosted references](../deployment.md#passports-to-try) lists live ones |
| Empty result | `output-list with 0 outputs`, including from a new index holding no states for this passport |
| GTIN and serial only | `query: { gs1Key: '01/09529530005688/21/E18E296BB180' }` |

The tuple `01:09529530005688|21:E18E296BB180` is another GS1-key selector. A GS1-key query returns states for every matching passport under any host, each under its exact identifier. Verify those identifiers as [identifier handling](../identifiers.md#use-the-identifier-throughout-the-request) describes. An index on an earlier release refuses the query.

3. Verify the returned outputs with a [reader](../implement/roles/passport-reader.md), or `node examples/verify-passport.mjs <passportId> <indexUrl>`. Each output carries BEEF, which bundles a transaction, its ancestors and merkle proofs. HTTP 200 does not establish a valid history or inclusion.

Compare indexes by transaction identifiers and proofs. The contract leaves lookup BEEF form open. For the passport above, the hosted index and a local index restored from its package returned the same three transactions, each 36 bytes apart.

## Index routes

[`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/overlay.yaml) is a profile of the BSV ecosystem's overlay HTTP contract: BRC-22 submission and BRC-24 lookup as upstream defines them, plus the standard's additions. It has a core, `x-dpp-core-version` 1, which every index serves: `POST /submit` with `X-Admission`, `POST /lookup` with the passport identifier and data carrier queries, `POST /arc-ingest`, and the listing and documentation routes. Everything else is an optional extension with its own version under `x-dpp-extensions`, marked on its operations with `x-dpp-extension`: `discovery`, `admission-refusal`, `health`, `capabilities`, `publisher-policy`, `registration`, `retraction`, `gs1-key-lookup`, `evidence-package` and `sync`. The core version changes only when the record versions the topics admit change or a must changes. `GET /history` and `GET /evidence-export` are routes of the reference package, outside the contract. The route table gives each token setting.

| Route | Access | Request | Success | Errors |
|---|---|---|---|---|
| `POST /submit` | Bearer `SUBMIT_TOKEN` when set | The transaction as BEEF, `Content-Type: application/octet-stream`; `X-Topics: ["tm_dpp"]` for a state or `["tm_attestation"]` for an anchor. A state's BEEF must carry its predecessor | 200 with the STEAK, `X-Admission` and, for a refused state, `X-Admission-Refusal`, described below | 400 for an empty body or bad `X-Topics`, 401, 413 beyond 8 MiB |
| `POST /lookup` | Open | JSON `{ "service": "ls_dpp", "query": { "passportId": "..." } }`, or `ls_attestation` with an anchor query | 200 `{ "type": "output-list", "outputs": [{ "beef", "outputIndex" }] }` | 400 |
| `POST /arc-ingest` | `ARC_CALLBACK_TOKEN` when set, as a bearer or `X-Callback-Token` | JSON `{ "txid", "merklePath", "blockHeight" }`, the merkle path as BRC-74 BUMP hex: the shape an ARC-compatible broadcaster's callback carries | 200 `{ "status": "applied" }`, or `"ignored"` with `"reason": "no merkle path"` when none was sent | 400 when the proof does not contain the transaction or fails against headers, 401, 404 when the index does not hold the transaction, 503 when the header source cannot evaluate it |
| `POST /retract` | Bearer `SUBMIT_TOKEN` | JSON `{ "txid", "outputIndex", "reason" }`, for a state the network refused after it was announced | 200 | 401, 404, 409 `retraction-refused` when the index holds a proof for the output, the network knows the transaction or the output is spent, 503 `chain-tracker-unavailable` |
| `GET /evidence-package?passportId=` | Open | Query string | 200, the package of the newest 500 states, signed by the child of `EXPORTER_PRIVATE_KEY` for the passport | 503 `export-unavailable` without `EXPORTER_PRIVATE_KEY` |
| `GET /history?passportId=` (or `uid=`), `&limit=&cursor=`, reference package only | Open | Query string | 200, one page of a passport's history over a snapshot | 400 `cursor-invalid`, 410 `snapshot-expired` after ten minutes |
| `GET /evidence-export?passportId=&cursor=`, reference package only | Bearer `EXPORT_TOKEN` when set | Query string | 200, one signed part of the complete export | 401 `export-unauthorised`, 400, 410, 503 |
| `GET /publisher-policy` | Open | | 200, the signed publisher policy chain the index admits under, oldest first | 404 `no-publisher-policy` on an index under one identity key |
| `GET /capabilities`, `GET /health` | Open | | 200 | |
| `POST /requestSyncResponse`, `POST /requestForeignGASPNode` | Open, bounded | The synchronisation protocol's bodies | 200 | 404 for a transaction the index does not hold |

[Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md) covers `/submit`, `/arc-ingest` and `/retract` in a writer's flow, and [export, import and recovery](../operate/export-import-recovery.md) the two export routes.

### What `POST /submit` answers

A well-formed, authorised `/submit` answers 200 even when nothing was admitted. Read `X-Admission` per topic, comma-separated. The body is the STEAK, the BRC-22 acknowledgement: `outputsToAdmit` lists admitted outputs; `coinsToRetain` and `coinsRemoved` list inputs kept or removed. A reference index gave these three answers for the genesis above:

| `X-Admission` | Body | Meaning |
|---|---|---|
| `tm_dpp=admitted` | `{"tm_dpp":{"outputsToAdmit":[0],"coinsToRetain":[],"coinsRemoved":[]}}` | The index admitted the state. |
| `tm_dpp=duplicate` | `{"tm_dpp":{"outputsToAdmit":[],"coinsToRetain":[]}}` | The index already held it; announcing it again changes nothing. The body has no `coinsRemoved`, which is how a duplicate is told from a refusal. |
| `tm_dpp=none` | `{"tm_dpp":{"outputsToAdmit":[],"coinsToRetain":[],"coinsRemoved":[]}}` | The index refused it. |

A refusal also carries `X-Admission-Refusal`, naming the failed check per topic. For the `none` answer above, the index's publisher key differed from the state's. An index on this release adds `X-Admission-Refusal: tm_dpp=publisher-not-authorised`.

The header is the contract's `admission-refusal` extension, and its codes are informative: `x-refusal-codes` lists the words the reference index sends, and [when the index refuses a state](../packages/build-an-application.md#when-the-index-refuses-a-state) says what each asks of a writer. Read any code, listed or not, as a refusal. Writers and readers see the same code where a verification report names the same failure. Only `tm_dpp` records reasons: an anchor refused on `tm_attestation`, or a state refused by an index on an earlier release, comes back without the header, and then only the operator's log says why ([known limitations](../operate/limitations.md)).

## Validate a claim

1. Send the secured native claim as JSON to `POST /validate?subject=...`. Set the query value to the product identifier the caller expects. This [runnable request](../quick-start.md#ask-a-registry-to-check-the-claim) reads the fixture and handles URL encoding:

```sh
REGISTRY_URL=https://dpp-resolver.bsvb.net node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const url = new URL('/validate', process.env.REGISTRY_URL ?? 'http://localhost:4000')
url.searchParams.set('subject', fixture.unsignedClaim.passportId)
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fixture.claim),
})
assert.equal(response.status, 200)
const result = await response.json()
console.log(JSON.stringify(result.report ?? result, null, 2))
JS
```

2. Expect HTTP 200 and a report whose claim signature, subject, validity period and evidence checks pass. Checks needing omitted evidence, such as passport history, read `unknown` with a reason. Set `REGISTRY_URL` to use your own registry.

The answer names its contract and checks, with a shared `report` when the subject can be determined. Read its checks and limits; transport success or a registry-level outcome does not establish each check. A body naming no current representation, a [historical claim](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md) among them, answers with outcome `invalid` and the issue `unsupported representation; an explicit claimFormat or representation is required`: the contract has no legacy intake, and historical records are only read.

| Condition | Interpretation |
|---|---|
| Validation only | Does not store or anchor the claim |
| Optional `tokenHistory` | BEEF-encoded request context, removed before claim verification ([operation](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml#L267-L301)) |
| HTTP 400 | A malformed or ambiguous request, including unreadable token history; resolve it before interpreting verification |
| Refused connection | No registry runs at the chosen URL |

## Registry routes

[`contracts/registry.yaml`](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml) defines the minimum every attestation registry serves, these seven operations. No public reference registry is published; the [registry guide](../implement/roles/registry.md) says what one must serve. A registry may serve more, and the reference registry documents its own further routes, such as a record's report, a passport's history, its GS1 resolver and its health.

| Route | Access | What it does |
|---|---|---|
| `POST /validate?subject=` | Open | Verifies a claim without storing or anchoring it |
| `POST /attestations` | Bearer write token when the registry sets one | Verifies and stores a claim, then reports its anchor; 422 when verification fails, the representation is unsupported, such as a parked `vsc-seal-json-v1` SEAL, or the body names no current representation, such as a historical UORA body, with nothing stored |
| `GET /attestations`, `GET /attestations/{id}/proof` | Open | The stored claims in pages, and everything a third party needs to check one claim's anchor |
| `GET /chain`, `GET /passports/{passportId}/evidence-package` | Open | A passport's custody timeline, and its evidence package, signed by the child of the registry's anchoring identity for the passport |
| `GET /capabilities` | Open | The registry's own capability document, which may name its anchoring key as `anchoredBy`, the identity its evidence packages name as exporter |

The GS1 resolver a registry may run is the [GS1 discovery](../interoperability/gs1-discovery.md) profile's, outside the registry contract. EPCIS import and passport projection routes are the reference application's own, not a contract of the standard ([interoperability](../interoperability/README.md)).

## Schemas

| Schema | Defines |
|---|---|
| [capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/capabilities.schema.json) | An index's or implementation's capability document |
| [publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json) | One version of a publisher policy, `dpp-publisher-policy@1` |
| [verification-report.schema.json](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/contracts/verification-report.schema.json) | The report a reader produces for one passport |
| `contracts/verification-report-v1.schema.json` | Report version 1, for validating a stored version 1 report |
| [paginated-history.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/paginated-history.schema.json) | One page of a snapshot, such as a registry's `GET /attestations` |
| [evidence-package.schema.json](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/evidence-package.schema.json) | The signed manifest of an evidence package, `dpp-evidence-package@1`, the one export format |
| [native-evidence-extension.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/native-evidence-extension.schema.json) | A reference, carried inside a credential in another representation, to evidence already on chain in the native records |
| [epcis-import.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/epcis-import.schema.json) | The record of one retained EPCIS import and its per-event results |
| [passport-source.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-source.schema.json) | A source revision of a model, batch, item or component record, and a typed relationship between subjects |
| [passport-projection.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-projection.schema.json) | A passport projection, `passport-projection@1`: one passport's fields derived from pinned sources under a named policy |
| [profile-evidence.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/profile-evidence.schema.json) | The shapes a profile field takes when its value is more than a scalar: a claim's evidence, a certification, a measurement |
| [release-set.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/release-set.schema.json) | A [release set](release-sets.md) |
| [manifest.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.schema.json), [baseline.schema.json](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/conformance/baseline.schema.json), [selection.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selection.schema.json) | The [conformance](conformance.md) ledger, a recommended baseline and a release's claim selection |
| [packages/dpp-profiles/schemas](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas) | The industry profiles' payload schemas |

For how to build each service, see the [registry](../implement/roles/registry.md) and [overlay](../implement/roles/overlay.md) role guides. Next: read the [specification index](specifications.md) for the rules these shapes carry.
