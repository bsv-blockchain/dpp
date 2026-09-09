# @bsv/dpp-overlay-topics

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

## Install

This is a pre-1.0 candidate. After publication, install the selected version from npm:

```sh
npm install --save-exact @bsv/dpp-overlay-topics@0.4.0-beta.1
```

This is a Node >=22 library for overlay operators and server integrations. Importing it does not start an HTTP service. Applications using a remote overlay do not need this package in their browser bundle. No repository checkout or package build is needed after installation.

The package serves native passport history (`tm_dpp`/`ls_dpp`), current complete-representation anchors (`tm_attestation`/`ls_attestation`) and historical UORA-named anchors (`tm_uora_dpp`/`ls_uora_dpp`). Native token admission checks `@bsv/dpp-core` rules. Anchor admission checks its own exact script and service signature; credential proof, authority and status require separate evidence.

The package is two things at once, and which one you get depends on how you
enter it.

**As a library.** `main` and the `exports` map point at `dist/lib.js`, so
`import ... from '@bsv/dpp-overlay-topics'` gets the topic manager, the lookup
service and the record stores, and nothing that listens on a port. This is how
the demonstration app uses it: both components run in process against
`InMemoryDppStorage`, which is what its offline mode and the tests are.

**As a service.** `src/index.ts` is an HTTP host for the same topic and lookup components, speaking the ecosystem's standard wire (BRC-22 `POST /submit`, BRC-24 `POST /lookup`, `POST /arc-ingest` for merkle proofs, plus `GET /health`), which is exactly the contract `contracts/overlay.yaml` in this repository pins, together with the five extension routes that contract documents beside them: `GET /capabilities`, `GET /history`, `GET /evidence-package`, `GET /evidence-export` and `POST /retract` (see [The extension routes](#the-extension-routes)), and the two GASP routes a synchronising peer reads. It is reached by path and never by specifier: `npm start` runs `node dist/index.js` and the Dockerfile's `CMD` names the same file. That is deliberate, so importing the package can never start a server.

The service boots only when node runs the file directly, which is how
`test/http.test.ts` drives `createRequestHandler` and `startOverlayService`
without a container.

**Proofs.** The host does not broadcast, so no broadcaster's callback reaches it unasked. A writer pushes each state's merkle path to `POST /arc-ingest` once its wallet has it, or points its broadcaster's callback URL here; the proof is checked to contain the transaction and validated against the header source before the stored BEEF is updated, and the lookup then serves the state proven (`spec/services.md` §2, `spec/writing.md` §7). Re-announcing a mined state does nothing: the engine skips a txid it already holds.

## Running it

```
npm run build      # tsc to dist/, needed before start and before the app imports it
npm run typecheck  # the same compile, emitting nothing
npm test           # admission policy, lookup indexing, engine wiring, the HTTP surface
npm start          # node dist/index.js
```

Configuration is environment only, and an unset variable switches its feature off or falls back; only a missing identity key, or a publisher policy file that does not verify, stops the boot. The image builds from the repository root, not from this directory, because the service depends on the `@bsv/dpp-core` workspace:

```
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

## Configuration

Everything is environment. An unset variable switches its feature off or falls back; the variables that can fail the boot are the identity key, because admitting without one would admit anything, and the publisher policy file, because admitting under a chain that does not verify would admit under whatever a file said.

| Variable | Effect when set | When unset |
|----------|-----------------|------------|
| `PORT` | Port to bind. Platforms inject it. | `8080` |
| `SERVICE_IDENTITY_KEY` | The public key `server_signature` is verified against (`spec/record-model.md` §5). 66 hex characters, compressed. Under `PUBLISHER_POLICY_FILE` it is optional and consulted only for a topic the policy's `scope.topics` leaves out. | Falls back to deriving it from `SERVER_PRIVATE_KEY`, with a warning; if neither is set and no policy file is, the boot fails |
| `SERVER_PRIVATE_KEY` | Fallback source for the above. Set the public key instead: the service only ever needs the public half. | See above |
| `MONGO_URL` | Persist the engine's UTXO state and the passport and both anchor indexes. | In memory, with a warning. Restart loses the index |
| `MONGO_DB` | Database name. | The connection string's default |
| `NETWORK` | `main` or `test`. | `main` |
| `WOC_API_KEY` | WhatsOnChain API key for header lookups. Raises the rate limit. | Anonymous access |
| `CHAIN_TRACKER` | `scripts-only` disables SPV verification of submissions. Local development only; hosted it would admit unproved ancestry. | WhatsOnChain on `NETWORK` |
| `SUBMIT_TOKEN` | Shared secret required as `Authorization: Bearer` on `POST /submit` and `POST /retract`, the two routes that change what the index holds. `/lookup`, `/history`, `/capabilities`, `/evidence-package` and `/health` stay open; `/evidence-export` has its own bearer, `EXPORT_TOKEN`. | `/submit` and `/retract` are open to anyone, which is only acceptable on a local container. Set it on any reachable deployment |
| `ARC_CALLBACK_TOKEN` | Shared secret required on `POST /arc-ingest`, as `Authorization: Bearer` or `X-Callback-Token`, the two ways an ARC-compatible broadcaster sends the token it was given at submission. | `/arc-ingest` is open to anyone. Every proof is still verified against block headers before it is stored, so the open route costs header quota, not truth; set it on any reachable deployment |
| `ANCHOR_SERVICE_KEYS` | Comma-separated identity keys of the anchoring services this instance carries anchors for. Public keys only. A preference, not a security control: every admitted anchor names its own author either way. Under `PUBLISHER_POLICY_FILE`, `tm_attestation` admits from the policy's anchor-publisher keys instead and this list applies to the historical `tm_uora_dpp` rail and to a topic the policy leaves out. | Anchors from any treasury are carried, each still saying whose it is |
| `OWNER_CONSENT` | `required`: `tm_dpp` also refuses a `TRANSFER` whose actor is neither the previous `owner_identity_key`, nor linked to it by `owner_linkage` in `event_data`, nor a transfer authority. This is the owner-signed transfer of `spec/custody.md` §4, a profile's choice; the topic documentation says it is on. Any other value fails the boot. | Off: any signed `TRANSFER` that spends the tip is admitted, the record model's baseline |
| `TRANSFER_AUTHORITIES` | Comma-separated identity keys permitted to `TRANSFER` without proving consent (recovery), named in the topic documentation. Public keys only, validated at boot; meaningful with `OWNER_CONSENT`, warned about without it. | None: every `TRANSFER` must prove consent when `OWNER_CONSENT` is set |
| `ACCEPTANCE_COMMITMENT` | `required`: `tm_dpp` refuses a version 2 `TRANSFER` whose `authorisation_commitment` is empty. This is the managed-custody profile of `spec/managed-custody.md`, declared in the capability document as the custody profile `managed-custody@1`; the topic documentation says it is on. Any other value fails the boot. | Off: a version 2 `TRANSFER` is admitted with or without a commitment, the record model's baseline, declared as `record-model-baseline@2` |
| `CONTROL_AUTHORITIES` | Comma-separated identity keys whose version 2 `UPDATE`, `TRANSFER` or `RETIRE` is admitted without a control proof (`spec/record-model-v2.md` §6, recovery). Public keys only, validated at boot; named in the topic documentation and the capability document. | `TRANSFER_AUTHORITIES` serves both versions: the same keys that may `TRANSFER` a version 1 passport without consent may act on a version 2 one without a proof |
| `PUBLIC_URL` | Passed to the engine as its hosting URL. Only meaningful with peer discovery, which is off. | unset |
| `PUBLISHER_POLICY_FILE` | Path to a JSON file holding the chain of `dpp-publisher-policy@1` documents, oldest first (`spec/services.md` §1, `contracts/publisher-policy.schema.json`). Verified at boot with `verifyPolicyChain`; a chain that does not verify stops the boot, naming the version and the reason. `tm_dpp` then accepts a state's countersignature only from a state-publisher key active at the state's own timestamp, so a retired key still admits the states it signed while active and a key admits nothing timestamped before its activation; `tm_attestation` accepts anchors only from anchor-publisher keys active at admission time, because an anchor carries no timestamp (announce a backlog before retiring its key). `GET /capabilities` names the keys active now and the version in force. | The single `SERVICE_IDENTITY_KEY` is an implicit single-operator policy with no rotation history, exactly as before, and the capability document says so |
| `OPERATOR_IDENTITY_KEYS` | Comma-separated `operator=compressedKey` pairs naming each operator's identity key, which the chain's genesis is signed by; the policy itself is never the source of the key that authorises it. Required with `PUBLISHER_POLICY_FILE`; malformed entries stop the boot. | Ignored with a warning when set alone |
| `EXPORT_SIGNING_KEY` | Private key, hex, that signs `dpp-evidence-package@1` manifests served by `GET /evidence-package` and by every part of `GET /evidence-export` (`spec/portable-evidence.md` §2). A key of its own, never the publisher key: it says which node assembled a package, nothing about admission. Malformed, it stops the boot. | Both routes answer 503 `export-unavailable` and the capability document lists the export as unsupported |
| `EXPORT_TOKEN` | Shared secret required as `Authorization: Bearer` on `GET /evidence-export`, the complete export, whose parts are each bounded but whose number is not. The bounded `GET /evidence-package` and `GET /history` stay open either way; the capability document reports `limits.evidenceExport` as `bearer`. | `GET /evidence-export` is open, as `GET /history` is, and the capability document reports `open`; set the token on any reachable deployment that serves long lineages |
| `SYNC_PEERS` | Comma-separated base URLs of the operators this node synchronises `tm_dpp` and `tm_attestation` from, through the overlay SDK's GASP over `POST /requestSyncResponse` and `POST /requestForeignGASPNode` (see [Running two operators locally](#running-two-operators-locally)). Static discovery: the peers are the ones named, never ones a lookup found, and a peer makes evidence findable and never admitted, because every offered output passes the same topic managers as `/submit`. Anything that is not an http or https URL stops the boot. | No synchronisation, exactly as before; the capability document says `discovery: none`, `gasp: false` |
| `SYNC_INTERVAL_MS` | Milliseconds between synchronisation rounds after the first, which runs once the socket is listening. `0` runs the startup round and no other. A failing peer is a log line and never stops the node or blocks a request. | `60000` |
| `SYNC_LEGACY` | `1` synchronises the historical `tm_uora_dpp` topic from the same peers as well. | Only the two current topics synchronise |

## The extension routes

Five routes the reference deployment serves beside the ecosystem's wire, each in the shape a contract under `contracts/` fixes and each documented in `contracts/overlay.yaml`, followed by the two GASP routes. None replaces the bounded lookup, which stays exactly what it is.

| Route | What it serves | Access |
|---|---|---|
| `GET /capabilities` | The capability document | Open |
| `GET /history` | Pages of one passport's history over a stable snapshot | Open |
| `GET /evidence-package` | The bounded signed package of the newest 500 states | Open; 503 without `EXPORT_SIGNING_KEY` |
| `GET /evidence-export` | The complete export as signed, resumable parts over one snapshot | Bearer `EXPORT_TOKEN` when set; 503 without `EXPORT_SIGNING_KEY` |
| `POST /retract` | Withdrawal of an admitted output the network refused | Bearer `SUBMIT_TOKEN` |
| `POST /requestSyncResponse`, `POST /requestForeignGASPNode` | The overlay protocol's synchronisation routes a peer reads | Open, bounded |

### `GET /capabilities`

The capability document of `spec/conformance.md` §4, in the shape of `contracts/capabilities.schema.json`, built from the constants the wire is built from and from the configuration the node runs with, never typed by hand: roles, protocol versions, the operator profile, representations, proof suites, anchor formats (current, historical and refused), topics and services, the publisher key policy in force (the keys active at the moment of the request, the owner-signed transfer and its transfer authorities), the synchronisation profile, the limits, and by name what the node does not do. A claim of support, checkable against the ledger; never proof of authority or of conformance. `conformance/examples/capabilities-reference-node.json` is what the reference configuration produces.

### `GET /history?passportId=|uid=&limit=&cursor=`

Pages of a passport's complete history over a stable snapshot (`spec/portable-evidence.md` §1, `contracts/paginated-history.schema.json`). The first page pins a snapshot at the highest record sequence the index had assigned; later pages read only records at or below it, in the index's own insertion order, so a state admitted mid-export appears in no page and shifts no boundary, and two readers of one snapshot receive the same pages. Each item carries the record's `txid`, `outputIndex`, `op`, `timestamp`, `previousTxid`, `spent`, `spendingTxid` and `sequence`; the bytes come from `POST /lookup` or `GET /evidence-package`. `scope.sequenceRange` is the span each page covers, so consecutive pages tile the snapshot and a reader detects a repeated or missing page from the ranges alone; `completeForSnapshot` is true only on the last page. `limit` defaults to 100 and is at most 500. Cursors are signed under a secret drawn at startup: a tampered, foreign or re-targeted cursor answers 400 `cursor-invalid`, and a snapshot older than ten minutes answers 410 `snapshot-expired` with the instruction to restart without a cursor. The secret is per process, so several replicas of one index behind one address must pin a client to one replica for the life of an export, or share the secret; otherwise a cursor minted by one replica is `cursor-invalid` on another. The record store numbers rows as they are inserted; a MongoDB store that predates the field numbers its rows at boot in `createdAt`, `txid`, `outputIndex` order before the first page is served.

### `GET /evidence-package?passportId=`

The `dpp-evidence-package@1` for one passport (`spec/portable-evidence.md` §2, `contracts/evidence-package.schema.json`): every retained state's raw transaction under `transactions/`, the BEEF it is held in under `proofs/` (with the merkle path once `/arc-ingest` delivered it), the publisher policy chain under `authority/` when one is configured, the index's spend observations under `status/` and a `spec/verification.md` report under `reports/`, inventoried by path, media type, length and SHA-256 in a manifest signed with `EXPORT_SIGNING_KEY`. The archive form is this build's own: a JSON envelope `{ manifest, files: { "<path>": "<base64>" } }`, which is exactly the map `inspectEvidencePackage` in `@bsv/dpp-core` takes. The disclosure scope is public and the package is never a recovery backup: the restricted tiers are withheld by name, and a state whose transaction or proof could not be produced is declared absent. A package carries at most 500 states, the newest by the index's sequence, as the bounded lookup keeps the newest; older states are declared absent by outpoint and the snapshot declaration says the package is not complete for its snapshot. The cap is in the capability document as `limits.maxEvidencePackageStates`, and it is what keeps an unauthenticated GET from parsing and signing an unbounded number of transactions. It applies after every record of the passport has been read from the record store, so the database read is proportional to the passport's length even though the BEEF parsing and the signing are capped; the rows are small and indexed by passport, and the read is what `GET /history` does page by page. A second operator restores a passport by submitting the `proofs/` BEEFs, genesis first, to its own `/submit`; `test/evidenceExport.test.ts` does exactly that and then discards the first operator. Without `EXPORT_SIGNING_KEY` the route answers 503 `export-unavailable`. A package cut at the cap names no genesis, because it does not hold one.

The complete export is `GET /evidence-export?passportId=...` (`contracts/evidence-export.schema.json`): the first request pins a snapshot and answers the first part, a package over the oldest states within it, holding at most `limits.maxEvidenceExportPartStates` states and closing earlier once their raw transactions and BEEFs exceed `limits.maxEvidenceExportPartBytes`, always with at least one; each part carries a coverage record (passport, snapshot, index, sequence range, number of states, final flag and the SHA-256 of its package manifest as signed) signed with `EXPORT_SIGNING_KEY` under the manifest's own preimage rule, carries that part's spend observations and the policy chain, and carries no report, because the report is the reader's to produce over the joined history; `nextCursor` stays outside the signed record and resumes the next part over the same snapshot under the same cursor rules as `GET /history` (400 `cursor-invalid`, 410 `snapshot-expired`, and a history cursor is refused here by name as an export cursor is there), and the final part ends at the snapshot's sequence with a null cursor. `joinEvidenceExport` in this package is the reader's join: first each part's coverage signature under the exporter's key and the digest binding of its package (`inspectEvidenceExportPart`), so no unsigned field establishes coverage or finality; then the same passport and snapshot, indexes with no repeat, ranges that tile with no gap or overlap, every package inspecting clean, no path repeated with different bytes, and the signed final flag on the last part; only then is the join complete, and `test/evidenceExportParts.test.ts` walks 505 connected states through two parts, joins them, restores them into a second operator and exports them again. With `EXPORT_TOKEN` set the route requires the bearer and answers 401 `export-unauthorised` without it.

### `POST /retract`

`{ "txid", "outputIndex", "reason" }`, behind the `/submit` bearer. A writer that announced a state before sending it (which `spec/writing.md` allows) may learn that the network refused the transaction; the index then holds a phantom tip that a later state cannot build on and a reader cannot order. Refused with 409 `retraction-refused` when the index holds a merkle path for the output, when the header source's operator knows the transaction, or when the output is spent (a history is never cut in the middle); 503 `chain-tracker-unavailable` when the network could not be asked. Otherwise the output leaves the engine's storage and the record store as an eviction removes it, the predecessor is unspent and the tip again, the transaction's applied mark is cleared so the same transaction is admitted if announced again, and the retraction is logged with its reason. With `CHAIN_TRACKER=scripts-only` the network cannot be asked; the answer carries `networkChecked: false` and a note saying so, and the capability document lists `retraction-network-check` as unsupported. The Engine's own eviction path is not called as a whole: it prunes the consumed lineage recursively, which on a history-retaining topic is the passport back to its genesis, so the retraction performs its first step and its predecessor repair and stops there (`src/retraction.ts` says why).

### `POST /requestSyncResponse` and `POST /requestForeignGASPNode`

The two upstream GASP routes a synchronising peer reads, exactly as the overlay protocol defines them: the first lists the unspent outputs this node holds for the topic in `X-BSV-Topic` since the peer's checkpoint (body: the SDK's `GASPInitialRequest`), the second serves one transaction of a graph with its merkle path when this node holds one (body: `graphID`, `txid`, `outputIndex`). Both are open, like `/lookup`, and bounded like every other POST route: the request body at 8 MiB, and the first route's page at 500 outputs, the request's `limit` defaulting to that and clamped to it (`limits.maxSyncPageSize` in the capability document), because the engine's storage applies no cap of its own and an anonymous peer would otherwise receive every unspent output of a topic in one answer. A peer holding more than 500 tips is synchronised 500 per round, continuing from the checkpoint. Nothing listed by them is trusted by being listed: the peer admits what it fetches through its own topic managers.

## Running two operators locally

Two nodes on two ports under one administration, sharing one publisher policy file that names both operators. This proves the mechanism, which is what `test/federation.test.ts` does end to end: the routes, the synchronisation, admission during synchronisation, partition recovery, operator loss and policy rotation. It proves nothing about independence. The operator manifest (`packages/dpp-profiles/manifests/operator/federated-operators@1.json`) says so in as many words: two processes under one administration prove only the mechanism, and `federated-operators@1` cannot be claimed by a deployment until two organisations with separate administrations, credentials, databases and infrastructure have run the exercises and observed the same results. The capability document of a node with a two-operator policy and peers configured therefore claims the profile as a claim of support, not of independence.

Build once from the repository root and write a policy file whose scope names both operators, with the operators' identity keys at hand (the chain must verify under `verifyPolicyChain`; `test/policy-fixture.ts` builds one for the tests):

```
npm run build -w @bsv/dpp-core -w @bsv/dpp-overlay-topics
```

Operator A, in one terminal:

```
PORT=18081 CHAIN_TRACKER=scripts-only SUBMIT_TOKEN=operator-a-secret \
PUBLISHER_POLICY_FILE=./publisher-policy.json \
OPERATOR_IDENTITY_KEYS='did:example:operator-a=02aa...,did:example:operator-b=03bb...' \
node packages/overlay-topics/dist/index.js
```

Operator B, in another, synchronising from A every ten seconds:

```
PORT=18082 CHAIN_TRACKER=scripts-only SUBMIT_TOKEN=operator-b-secret \
PUBLISHER_POLICY_FILE=./publisher-policy.json \
OPERATOR_IDENTITY_KEYS='did:example:operator-a=02aa...,did:example:operator-b=03bb...' \
SYNC_PEERS=http://127.0.0.1:18081 SYNC_INTERVAL_MS=10000 \
node packages/overlay-topics/dist/index.js
```

Announce states and anchors to A with its token (`POST http://127.0.0.1:18081/submit`), then ask both for the same passport (`POST /lookup` with `{"service":"ls_dpp","query":{"passportId":"..."}}`) and compare the BEEF bytes; `GET /history` on each shows the same items in the same order, and `GET /capabilities` on B says `synchronisation.profile` `federated-operators@1`, `discovery` `static-peers` and the peer list, while A, with no peers, says `single-operator@1`. `CHAIN_TRACKER=scripts-only` is the local setting; a hosted pair keeps the default header source, under which both nodes verify every offered graph against block headers before admitting it.

What synchronises, and what does not, with the SDK as it stands (`@bsv/overlay` 2.3.1, `@bsv/gasp` 1.3.6). The engine stores a proven state as the compact atomic BEEF of that state alone, so this node answers a peer's `POST /requestForeignGASPNode` from its own storage by the transaction the peer names (the engine's own walk from the graph's root would stop at the first unhydrated input of a proven tip), and a fresh peer fetches a proven lineage state by state through the tip's inputs:

- A peer offers the unspent outputs of a topic, the tips. The whole lineage behind an unproven tip arrives through the tip's inputs, so a node that knows nothing of a passport receives every retained state, spent ones included, and admits them genesis first through the same topic managers as `/submit`; a second round admits nothing and creates no duplicate.
- A state on top of a lineage the peer already holds synchronises once it is proven. The SDK's graph builder needs an unproven transaction's parent in its temporary graph, and its input stripping keeps a parent the peer already holds out of it, so an unproven state announced during a partition waits until its proof reaches the source node (`/arc-ingest`); on the next round it arrives with the proof and is admitted against the predecessor the peer holds. `tm_dpp` reads that predecessor from the engine's storage when the offered BEEF does not carry it, and remembers the states it inspected in one synchronisation pass, because the SDK hands it one state at a time.
- A proof that reaches one operator after another has synchronised the state does not travel through GASP: the SDK offers outpoints and never re-fetches one the peer holds. Proofs reach each operator through its own `/arc-ingest`, which is what the operator manifest means by proof updates being ingested separately from replaying held outputs; a writer or a gateway pushes the proof to every operator it knows, and a reader of either sees `inclusion` pending until it has.
- An offered state countersigned by a key outside the policy, or timestamped outside its key's window, is refused by the peer's own `tm_dpp` and the refusal is logged; the offering node changes what can be found, never what can be believed.

## A refused spend of the tip

The Engine reads a spend of an admitted output that the topic did not retain as that output's consumption, and its stale-output eviction removes the output and, recursively, every predecessor nothing else consumes. Before it does, it marks the spent output in its own storage and tells every lookup service of the spend, whether or not the spending transaction was admitted. On a history-retaining topic that meant one refused announcement spending the tip (a wrong publisher key, a broken invariant) emptied the passport's index entry, which the 2026-08-12 rehearsal met. Two guards now stand where the topic manager and the lookup service can stand:

- `tm_dpp` returns the coins the Engine offered as `coinsToRetain` on every refusal, so the Engine keeps the tip and its lineage.
- `ls_dpp` records a spend only once the admission of the spending transaction follows, which in `Engine.submit` is the same call when it happens at all; a spend nobody confirms names a state this index never held, and the record keeps the tip unspent.

After a refused spend, `/lookup`, `/history` and the record store read exactly as before it, and a valid later state is admitted against the tip (`test/refusedSpend.test.ts`). What the Engine still does with the refused transaction: it marks the tip spent in its own storage, so the tip is not offered to synchronising peers until a valid successor is admitted (the successor is then the offered tip and the lineage arrives through it), and it records the refused transaction as applied to the topic, which on its own would make the same bytes announced again a duplicate no-op that the Engine never re-evaluates. The host reads that record for what it is. When a submission reads as a duplicate for a topic and the engine's storage holds no admitted output of the transaction for that topic, the transaction was refused earlier: the host clears the applied record and submits it again for that topic, so the answer is what the topic managers say today. A state refused for a transient reason (its predecessor announced after it, a policy version not yet loaded, a stranger announcing a successor before the writer could announce its predecessor) is admitted once the reason is gone; one refused for good answers `none` again, with the log saying it was announced and refused before; `duplicate` is answered only for a transaction this index admitted. The spent mark on the tip needs the Engine to distinguish a refused spend from an unretained one, which is an upstream change and not this package's to make.

## Current and historical anchors

`AttestationTopicManager`, `AttestationLookupService`, `InMemoryAttestationStorage` and `MongoAttestationStorage` implement the current generic format. `buildAttestationAnchor` and `decodeAttestationAnchor` expose its writer and exact reader. The MongoDB collection is `attestationAnchorsV1`; historical indexes remain separate.

The current lookup requires an exact issuer, subject, attestationId, digest or anchoredBy selector. Optional attestationType, representation and mediaType narrow it. `limit` is 1 to 500, default 100. Results sort by txid then outputIndex; pass the final returned `{txid, outputIndex}` as `after` until an empty page. This queries a live local index and does not establish global completeness.

The current format includes representation and mediaType and commits to the complete signed representation. The historical decoder retains the original `uora-anchor-v3` digest contract. A service name or format prefix is never silently aliased between these contracts. See [the rules](../../spec/rules.md) and [registry contract](../../contracts/registry.yaml) for credential verification and exact-byte retrieval.

The HTTP host exposes documentation, submission, lookup, proof ingestion, the extension routes above and the two GASP routes. SHIP/SLAP advertising is not enabled by this host; peer synchronisation is, from the static peers `SYNC_PEERS` names and from nowhere else.
