# A deployment that follows the standard's defaults

**Status: informative, never normative.** This document is for an adopter who wants defaults rather than choices: one arrangement of the ecosystem's components that meets every duty [`../spec/writing.md`](../spec/writing.md) sets on a writer and every duty [`../spec/services.md`](../spec/services.md) sets on an index, with the environment variables and calls named. Nothing here is required by the standard, which depends on no service and names no vendor; where this document and the normative text disagree, the normative text wins, as [`../GOVERNANCE.md`](../GOVERNANCE.md) says of everything outside `spec/`, `contracts/` and `fixtures/`. Endpoints and versions below are those the ecosystem operated when this was written (2026-08-30) and will change; the standard does not.

## The pieces

| Piece | Default | Which duty it meets |
|---|---|---|
| The writer's wallet | `@bsv/wallet-toolbox`, as the wallet on a user's own device under possession or as the storage server a deployment runs for its own writes. Exactly one `Monitor` per storage, because two race and corrupt the state | [`writing.md`](../spec/writing.md) §5, §7, §8 |
| Broadcast | The toolbox's `Services` with `arcUrl` set to the association's ARC-compatible gateway, ARCADE: mainnet `https://arcade-v2-us-1.bsvblockchain.tech/`, teratestnet `https://arcade-v2-ttn-us-1.bsvblockchain.tech/`. Set `arcConfig.callbackUrl` and `callbackToken` so the gateway delivers each merkle path, and keep the toolbox's fallback list (GorillaPool ARC on mainnet, TAAL ARC, Bitails, WhatsOnChain) behind it, because one broadcaster is one point of failure. Fee policy comes from the gateway's `GET /policy`, in the ARC schema | §5 |
| A header source | For the index and for every verifier: WhatsOnChain (the SDK default, with `WOC_API_KEY` for the rate limit), a `BlockHeadersService` instance, or a self-hosted `chaintracks-server` from the stack's `infra/`, which holds the whole header chain in well under 100 MB and makes a verifier independent of everyone. Teratestnet serves ChainTracks at `https://arcade-v2-ttn-us-1.bsvblockchain.tech/chaintracks/` | [`record-model.md`](../spec/record-model.md) §8 |
| The index | This repository's image (`packages/overlay-topics/Dockerfile`) with `SERVICE_IDENTITY_KEY`, `MONGO_URL`, the default `CHAIN_TRACKER`, `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN` set, reachable over HTTPS, advertised through SHIP and SLAP when public. It does not broadcast; proofs reach it through `POST /arc-ingest`, pushed by the writer or by the gateway whose callback URL a writer pointed at it | [`services.md`](../spec/services.md) §1, §2 |
| The application | The code that assembles states and talks to the index: `createAction` with `acceptDelayedBroadcast: false`, built unsent and sent only on admission, one write at a time per passport with a compare-and-set on the tip, the proof pushed once the wallet has it | §2, §3, §4, §6, §7 |

## The lifecycle, in order

1. **Check** (§2). Reconstruct the chain from the tip's BEEF, append the candidate, and run `verifyChain` from `@bsv/dpp-core` with `chainTracker: 'scripts only'` and the service key. A genesis is checked alone. Nothing is sent if this fails.
2. **Build unsent** (§3). `createAction` with `options: { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false }` and the state's locking script as the one output, in a basket the application owns (`dpp` in the reference). The result is a complete, signed AtomicBEEF that spends nothing.
3. **Announce** (§3). `POST /submit` on the index with `X-Topics: ["tm_dpp"]` and that BEEF, or `TopicBroadcaster` from `@bsv/sdk`. Read the reference index's `X-Admission` header: `admitted` or `duplicate` proceeds, `none` stops with nothing sent, and an index that cannot be reached is not a refusal.
4. **Send** (§4, §5). `createAction({ description, options: { sendWith: [txid], acceptDelayedBroadcast: false } })`, the send-only action. Report `sendWithResults[].status` in the standard's words: `unproven` is accepted and pending, `sending` is not yet an answer, `failed` never existed. A thrown `WERR_REVIEW_ACTIONS` carries the review results and the competing transactions. Spend the same tip again only after this answer.
5. **Announce again if needed** (§6). An announcement that could not be made is retried; it is never a reason to rebuild the state.
6. **Prove** (§7). The wallet's `Monitor` attaches the merkle path once the block is a minute old, from the gateway's callback or SSE stream or from a header source. Read it back with `listOutputs({ basket, include: 'entire transactions' })` and `POST /arc-ingest` on the index with `{ txid, merklePath, blockHeight }` and the callback token, or let the gateway do it by pointing its callback URL at the index. Until a proof reaches the index, every verifier reads the state as `pending`.
7. **Keep** (§8). The wallet's storage holds the transaction, its BEEF and its proof for the passport's life; a deployment that writes through its own infrastructure keeps the same in its storage server beside its account records. Neither the gateway's status nor the index is the copy of record.

`examples/write-passport.mjs` in this repository runs steps 1 to 7 from one BRC-100 wallet, and its dry run shows steps 1 and 2 on the fixture's own bytes.

## Checking that it worked

`examples/verify-passport.mjs <passportId> <indexUrl>` asks the index for the bytes and verifies every signature, every link and every merkle path against public headers. When the lifecycle above has run to the end, inclusion reads `verified` for every mined state; `pending` on a state that has been mined for hours means step 6 did not happen, and the index's log will not say so, because from the index's side nothing is wrong.

## What changes and what does not

Gateway hosts, header services and package versions change, and this document is edited when they do. The standard does not depend on any of them: a verifier holding the bytes and a header source of its own verifies a record written through any of these pieces or none of them, which is the property [`../spec/record-model.md`](../spec/record-model.md) §1 states and everything else protects.
