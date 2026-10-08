# Overlay

An index, the component the standard's overlay role describes, admits passport and anchor transactions under its topic rules, keeps what it admitted and answers lookups, so a reader can find a passport's records without scanning the blockchain. This page is for anyone building one, or adding the DPP topics to an overlay they already run; a lookup answer is never a verification result, because the reader checks everything it receives.

Three terms recur. A topic is a named set of admission rules: `tm_dpp` for passport states and `tm_attestation` for claim anchors. A lookup service answers queries over what a topic admitted: `ls_dpp` and `ls_attestation`. BEEF (Background Evaluation Extended Format, [BRC-62](https://bsv.brc.dev/transactions/0062)) is the binary form that carries a transaction with its ancestors and merkle proofs, and it is what writers submit and lookups return.

## Two ways to build one

- **Embed or run the package.** `@bsv/dpp-overlay-topics` provides `DppTopicManager` and `DppLookupService` for an `Engine` from `@bsv/overlay`, as the [package page](../../packages/dpp-overlay-topics.md) shows, and an HTTP host you can run with Docker ([run a service](../../operate/README.md)).
- **Write your own** against the [overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml). It extends the ecosystem's [overlay HTTP contract](https://bsv-blockchain.github.io/ts-stack/specs/overlay-http/), BRC-22 submission and BRC-24 lookup, which defines the `/submit` and `/lookup` shapes; the DPP contract adds only the topics, their admission rules, the lookup queries and the extensions below.

Either way, the steps below are the order to build and test in.

## What an index must serve

The contract's `x-dpp-profile` sorts every route into must, should and may. The last column names the [baseline](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json)'s required rows for the overlay role that each line meets.

| Level | What | Ledger rows |
|---|---|---|
| Must | `POST /submit` and `POST /lookup` as the upstream contract defines them | `OVL-contract-must` |
| Must | `GET /listTopicManagers`, `GET /listLookupServiceProviders`, `GET /getDocumentationForTopicManager` and `GET /getDocumentationForLookupServiceProvider`, the last two returning each DPP topic's and service's rules as Markdown | `OVL-contract-must` |
| Must | `/lookup` answers in the JSON `output-list` form when `x-aggregation` is absent | `OVL-contract-must` |
| Must | Admitting an output already held is a no-op | `OVL-contract-must`, `SVC-6-idempotent-admission` |
| Must | `tm_dpp` admits version 1 and version 2 states under the record rules, the publisher policy and the selected custody profile, and keeps each state after a later state spends it; `ls_dpp` answers by passport identifier | `SVC-2-passport-admission`, `SVC-2-version-2-admission` |
| Must | `tm_attestation` admits anchors on their exact script, framed signature and derived key; `ls_attestation` answers exact metadata selectors with an exact outpoint cursor | `SVC-2-anchor-admission`, `SVC-2-cursor-lookup` |
| Should | `POST /arc-ingest`, accepting a merkle proof only after checking it contains the transaction and validating it against the index's header source | `SVC-2-proof-ingest` |
| Should | HTTPS; advertising through SHIP and SLAP, the ecosystem's protocols for announcing which topics and lookup services an index hosts, when public; `GET /health/live` and `GET /health/ready` | |
| May | The historical `tm_uora_dpp` and `ls_uora_dpp`, for anchors in the format before the current one, which the conformance baseline lists as historical rather than required; the binary aggregated lookup; synchronisation with peers through GASP, the Graph Aware Synchronisation Protocol (`POST /requestSyncResponse`, `POST /requestForeignGASPNode`); a bearer token on `/submit`; treating a missing `X-Topics` header as `tm_dpp`; the owner-signed transfer; the acceptance commitment under `managed-custody@1` | |
| Extension the reference serves | The `X-Admission` and `X-Admission-Refusal` headers on `/submit`; `GET /capabilities`; `GET /history`; `GET /evidence-package`; `GET /evidence-export`; `POST /retract` | |

The baseline requires proof ingestion (`SVC-2-proof-ingest`) for the overlay role although the contract lists it as should, so an index claiming the role under the baseline serves it.

## Build order

1. **Admission and storage.** Implement `tm_dpp` and `tm_attestation` with persistent storage before anything else. Keep the admission decision apart from the HTTP status and from the transaction's network status.
2. **Start offline with the fixtures.** Their states are raw transactions that are not mined, so wrap each in a BEEF with the states before it and check admission against the topic rules first, as the [overlay package page](../../packages/dpp-overlay-topics.md) shows for the version 2 lineage. The reference host runs without a header source when `CHAIN_TRACKER=scripts-only`, for local development only; a proof update needs a merkle path from a mined transaction, or a stub header source in your own tests.
3. **Lookup.** Serve `ls_dpp` and `ls_attestation` over what was admitted ([find passport records](../../reference/contracts.md#find-passport-records)).
4. **One transaction end to end.** Exercise submission, lookup and proof ingestion with the same admitted transaction. A later proof must stay with the right record. Test duplicates and refused records, then restart the service and repeat the lookup.
5. **History and export.** Add `GET /history`, pages of a passport's complete history over a stable snapshot ([paginated history schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/paginated-history.schema.json)), then `GET /evidence-package` and `GET /evidence-export`. Check pagination, a resumed request and an expired cursor.
6. **Retraction.** Add `POST /retract`, which withdraws a state the network refused after it was announced, behind the `/submit` token.
7. **Federation.** Synchronise with a peer ([federation](../../operate/federation.md)), including a record a peer offers but local policy refuses. A peer having a record is never a reason to bypass local admission.

The [HTTP guide](../../reference/contracts.md) gives the request sequence.

## Publisher policy

An index admits a passport state only when its publisher signature verifies under a key the index's policy names. The keys enter in one of two ways: `SERVICE_IDENTITY_KEY`, one key, or a signed publisher policy chain that names several keys, each with an `activeFrom` time and authorised by the operator's identity key ([sign a publisher policy](../../operate/federation.md#3-sign-a-publisher-policy); [schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json); vectors in `fixtures/vectors/dpp/publisher-policy/v1.json`). The capability document's `publisherPolicy` lists the keys but not their windows, so a writer can see that a key is listed but not that it is active at a state's time; the windows are in the operator's signed chain.

## Known gaps for a new operator

Each applies to any new index, whatever its code. [Known limitations](../../operate/limitations.md) and [federation](../../operate/federation.md#when-a-record-does-not-arrive) give the detail.

- Only `tm_dpp` says why it refused: `X-Admission-Refusal` names the check for a passport state, and a refused anchor on `tm_attestation` answers `none` with the reason only in your own log.
- No one is named to deliver a later proof to a peer that synchronised a state; its readers see `inclusion` pending until someone does.
- An output your node left behind while synchronising is visible only in its log, and it is not asked for again until you move that peer's checkpoint back; no setting re-synchronises from a chosen point.
- A state funded from another passport's transaction does not reach a peer that lacks that other passport's history until the new state is mined.
- Published beta.9 uses static peers. The later [reviewed source](../../operate/federation.md#discovery-in-the-reviewed-source) can discover advertised peers when configured, but the reference host still does not advertise itself through SHIP and SLAP. To have the hosted reference pull and admit your records, its operator must agree your node and publisher keys; ask through the [BSV Association contact form](https://bsvassociation.org/contact/) with your index URL and publisher keys ([overlays running now](../../deployment.md#overlays-running-now)).

## Exact implementation sources

- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml)
- [The upstream overlay HTTP contract](https://bsv-blockchain.github.io/ts-stack/specs/overlay-http/)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md)
- [spec/exchange.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md)
- [contracts/capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/capabilities.schema.json) and the [reference index's capability document](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/examples/capabilities-reference-node.json)
- [contracts/publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: [federation](../../operate/federation.md), to synchronise with a second index.
