# Overlay

Index implementers can use this guide to build the standard's overlay role or add DPP topics to an existing overlay. An index admits passport and anchor transactions under topic rules, retains them and answers lookups so readers can find records without scanning the blockchain. A lookup answer is never verification: readers check everything received.

## Prerequisites and implementation target

| Work | Input and source |
|---|---|
| Implementation | Choose the runtime or contract route below, and record the package set or contract revision. |
| Admission and lookup | Persistent storage and your operator's publisher policy or single publisher key. |
| Offline checks | Repository fixtures and predecessor states for their BEEFs. These raw transactions are not mined. |
| Proof checks | A mined transaction's merkle path and header source, or a stub header source in your own tests. |
| End-to-end service checks | Your index URL and its configured submission and callback tokens; the selected transaction's BEEF and passport identifier. |

| Term | Meaning and fixed names |
|---|---|
| Topic | Named admission rules: `tm_dpp` for passport states, `tm_attestation` for claim anchors. |
| Lookup service | Queries admitted records: `ls_dpp` and `ls_attestation`. |
| BEEF | Background Evaluation Extended Format ([BRC-62](https://bsv.brc.dev/transactions/0062)), the binary form carrying a transaction, its ancestors and merkle proofs, submitted by writers and returned by lookups. |

## Two ways to build one

To operate the reference index, start with [Run an index from source](../../operate/README.md). Its Compose preset builds the runtime. Continue here when customising an integration or implementing the role yourself.

- **Reuse the runtime in your own integration.** `@bsv/dpp-overlay` provides `DppTopicManager` and `DppLookupService` for an `Engine` from `@bsv/overlay`, as the [runtime reference](../../packages/dpp-overlay.md) shows, and an HTTP host you can [run from source](../../operate/README.md). These are advanced alternatives to the Compose preset.
- **Write your own** against the [overlay contract](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/contracts/overlay.yaml). It extends the ecosystem's [overlay HTTP contract](https://bsv-blockchain.github.io/ts-stack/specs/overlay-http/), BRC-22 submission and BRC-24 lookup, which defines the `/submit` and `/lookup` shapes; the DPP contract adds only the topics, their admission rules, the lookup queries and the extensions below.

Use the build order below for either route.

## What an index must serve

The contract has a core and extensions. The core, `x-dpp-core-version` 1, is what every index serves, and its `x-dpp-profile` sorts it into must, should and may; the core version changes only when the record versions the topics admit change or a must changes. Every other feature is an optional extension under `x-dpp-extensions`, each with its own version, marked on its operations with `x-dpp-extension`. The last column names the [baseline](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/conformance/baseline-native-2.json)'s required rows for the overlay role that each line meets.

| Level | What | Ledger rows |
|---|---|---|
| Must | `POST /submit` and `POST /lookup` as the upstream contract defines them | `OVL-contract-must` |
| Must | `GET /listTopicManagers`, `GET /listLookupServiceProviders`, `GET /getDocumentationForTopicManager` and `GET /getDocumentationForLookupServiceProvider`, the last two returning each DPP topic's and service's rules as Markdown | `OVL-contract-must` |
| Must | `/lookup` answers in the JSON `output-list` form when `x-aggregation` is absent | `OVL-contract-must` |
| Must | Admitting an output already held is a no-op | `OVL-contract-must`, `SVC-6-idempotent-admission` |
| Must | `tm_dpp` admits version 1 and version 2 states under the record rules, the publisher policy and the selected custody profile, and keeps each state after a later state spends it; `ls_dpp` answers by passport identifier | `SVC-2-passport-admission`, `SVC-2-version-2-admission` |
| Must | `tm_attestation` admits anchors on their exact script, framed signature and derived key; `ls_attestation` answers exact metadata selectors with an exact outpoint cursor | `SVC-2-anchor-admission`, `SVC-2-cursor-lookup` |
| Should | `POST /arc-ingest`, accepting a merkle proof only after checking it contains the transaction and validating it against the index's header source | `SVC-2-proof-ingest` |
| Should | HTTPS; the `X-Admission` header on `/submit`, one outcome per topic; `GET /health/live` and `GET /health/ready` | |
| May | The historical `tm_uora_dpp` and `ls_uora_dpp`, for anchors in the format before the current one, which the conformance baseline lists as historical rather than required; the binary aggregated lookup; a bearer token on `/submit`; treating a missing `X-Topics` header as `tm_dpp`; the acceptance commitment under the managed custody profile | |
| Extension, version 1 each | `discovery`, advertising through SHIP and SLAP, parked outside the standard; `admission-refusal`, the `X-Admission-Refusal` header, whose codes are informative; `health`, the fields on `GET /health`; `capabilities`, `GET /capabilities`; `publisher-policy`; `registration`, `POST /register`; `retraction`, `POST /retract`; `gs1-key-lookup`, the `gs1Key` query; `evidence-package`, `GET /evidence-package`; `sync`, synchronisation with peers through GASP, the Graph Aware Synchronisation Protocol (`POST /requestSyncResponse`, `POST /requestForeignGASPNode`) | |
| Reference package only | `GET /history` and `GET /evidence-export`, outside the contract | |

The baseline requires proof ingestion (`SVC-2-proof-ingest`) for the overlay role although the contract lists it as should, so an index claiming the role under the baseline serves it. It requires no extension, and an extension fixes a wire shape, not a requirement: the behaviour behind the publisher policy route, registration and synchronisation is the reference package's, documented in its [package guide](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md). The standard keeps the flat publisher key list of the capability document and the signed registration request. The ledger rows `OVL-2-retraction` and `OVL-2-gs1-key-lookup` assess the reference index's retraction and GS1 key lookup, the reference-layer row `OVL-2-publisher-policy-route` its publisher policy route, and the evidence package needs the capabilities extension, whose document names the key its signer derives from.

## Build order

1. **Admission and storage.** Implement `tm_dpp` and `tm_attestation` with persistent storage before anything else. Keep the admission decision apart from the HTTP status and from the transaction's network status.
2. **Start offline with the fixtures.** Wrap each unmined raw transaction in a BEEF with its predecessors, then check topic admission ([version 2 lineage](../../packages/dpp-overlay.md)). The reference host's `CHAIN_TRACKER=scripts-only` setting omits a header source for local development only. Proof updates need the proof inputs listed above.
3. **Lookup.** Serve `ls_dpp` and `ls_attestation` over what was admitted ([find passport records](../../reference/contracts.md#find-passport-records)).
4. **One transaction end to end.** Exercise submission, lookup and proof ingestion with the same admitted transaction. A later proof must stay with the right record. Test duplicates and refused records, then restart the service and repeat the lookup.
5. **Evidence package.** Add `GET /evidence-package`, the `dpp-evidence-package@1` for one passport, naming your exporter identity key and signed by its BRC-42 child for `[1, 'dpp evidence package v1']` and the passport identifier ([portable evidence](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/portable-evidence.md) section 2), and name that identity key as `exporterIdentityKey` in your capability document. History pages and a multi-part export are your own choice; the reference package's are outside the contract.
6. **Retraction.** Add `POST /retract`, which withdraws a state the network refused after it was announced, behind the `/submit` token.
7. **Federation, optional.** Synchronisation is not part of the standard. To exchange records the way the reference package does, synchronise with a peer ([federation](../../operate/federation.md)), including a record a peer offers but local policy refuses. A peer having a record is never a reason to bypass local admission.

For step 4, use the same index and admitted state throughout this sequence from the [HTTP guide](../../reference/contracts.md):

| Order | Request | Expected result and stop point |
|---|---|---|
| 1. Submit | `POST /submit`: BEEF including the predecessor, `Content-Type: application/octet-stream`, `X-Topics: ["tm_dpp"]`; bearer `SUBMIT_TOKEN` when set. | HTTP 200 carries a STEAK. Check `X-Admission`: `tm_dpp=admitted` confirms admission; 200 alone does not. Stop on refusal and inspect `X-Admission-Refusal`. |
| 2. Look up | `POST /lookup`: `{ "service": "ls_dpp", "query": { "passportId": "..." } }`. | HTTP 200 JSON `output-list` containing the admitted output. |
| 3. Ingest proof | `POST /arc-ingest`: JSON fields `txid`, `merklePath`, `blockHeight`; BRC-74 BUMP hex for the path. Supply `ARC_CALLBACK_TOKEN` when set, as bearer or `X-Callback-Token`. | HTTP 200 `{ "status": "applied" }`. Stop on a refused proof. |

Repeat lookup, then restart and look up again. Confirm the proof remains with its record. Fixtures need a mined proof or a stub header source to complete this step.

## Publisher policy

An index admits a state only when its publisher signature verifies under a key named by its policy. The standard asks for the flat list of those keys in the capability document's `publisherPolicy`; a signed chain of their activity windows is a feature of the reference package, documented in its package guide, not a requirement.

| Configuration | Keys and evidence to inspect |
|---|---|
| `SERVICE_IDENTITY_KEY` | One publisher key. |
| Signed publisher policy chain, a reference package feature | Several keys, each with `activeFrom`, authorised by the operator's identity key. Inspect the signed chain for activity windows. |

Use [sign a publisher policy](../../operate/federation.md#3-sign-a-publisher-policy), the [schema](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/contracts/publisher-policy.schema.json) and `fixtures/vectors/dpp/publisher-policy/v1.json`. The capability document's `publisherPolicy` lists keys without their windows. It shows membership, not whether a key was active at a state's time.

## Known gaps for a new operator

Each applies to any new index, whatever its code. [Known limitations](../../operate/limitations.md) and [federation](../../operate/federation.md#when-a-record-does-not-arrive) give the detail.

- Only `tm_dpp` says why it refused: `X-Admission-Refusal` names the check for a passport state, and a refused anchor on `tm_attestation` answers `none` with the reason only in your own log.
- No one is named to deliver a later proof to a peer that synchronised a state; its readers see `inclusion` pending until someone does.
- An output your node left behind while synchronising is visible only in its log, and it is not asked for again until you move that peer's checkpoint back; no setting re-synchronises from a chosen point.
- A state funded from another passport's transaction does not reach a peer that lacks that other passport's history until the new state is mined.
- From the beta.10 overlay package an index can [find advertised peers and advertise itself](../../operate/federation.md#parked-find-peers-automatically) when configured, options parked outside the standard; the hosted reference index pulls from a static peer and does not yet advertise itself through SHIP and SLAP. To have the hosted reference pull and admit your records, its operator must agree your node and publisher keys; ask through the [BSV Association contact form](https://bsvassociation.org/contact/) with your index URL and publisher keys ([overlays running now](../../deployment.md#overlays-running-now)).

## Exact implementation sources

- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/contracts/overlay.yaml)
- [The upstream overlay HTTP contract](https://bsv-blockchain.github.io/ts-stack/specs/overlay-http/)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/services.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md)
- [spec/exchange.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/exchange.md)
- [contracts/capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/capabilities.schema.json) and the [reference index's capability document](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/conformance/examples/capabilities-reference-node.json)
- [contracts/publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/contracts/publisher-policy.schema.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: [federation](../../operate/federation.md), to synchronise with a second index.
