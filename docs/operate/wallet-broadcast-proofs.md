# Wallet, broadcast and proofs

**Audience:** whoever runs the writing side of a deployment. **Canonical sources:** [`spec/writing.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/writing.md), [`docs/deployment.md`](../deployment.md) (the pieces and the lifecycle), [`spec/custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/custody.md) §5.

## Who does what

| Responsibility | Whose | The standard's word |
|---|---|---|
| Hold the keys and sign | The wallet: a BRC-100 wallet on the owner's device under possession, or the deployment's storage server under managed custody | Signing and spending through the selected wallet, without requiring an account holder to operate one |
| Build the state unsent and verify it | The writer | `spec/writing.md` §2, §3 |
| Announce to the index while it is a draft | The writer | §3; `none` stops with nothing sent |
| Broadcast | The wallet, through its broadcaster, never the index | §5; the answer in the network's words |
| Obtain the merkle path | The wallet's monitor, from the broadcaster's callback or a header source | §7 |
| Push the proof to every index that holds the state | The writer, or the gateway whose callback the writer pointed at the index | §7; each operator receives its own |
| Retain transaction, BEEF and proof for the passport's life | The wallet's storage, or the deployment's storage server beside its records | §8; neither the gateway nor the index is the copy of record |

## The four states of a written record

A deployment keeps them apart and reports them in these words: **prepared** locally and verified; **admitted** by an index, which is discoverability and nothing else; **accepted** by the network, which the broadcast answer says and which is not yet inclusion; **included** in a block, verified from a merkle path against headers. A broadcaster that answers before the network has, or an index that answers before the network has, does not collapse these; the reference journal records the operation state and the mining state as separate words for exactly this reason.

## A state the network refused

A state announced before it was sent and then refused by the network leaves the index with a phantom tip. The writer withdraws it with `POST /retract` behind the submit bearer; the index refuses the retraction when it holds a proof, when the network knows the transaction, or when the output is spent, because a history is never cut in the middle.

## Reorganisations

A proof refuted by a reorganisation is a proof to replace, not a state to rewrite. The index re-verifies a pushed proof against its header source; a verifier reports `proof-refuted` until a valid proof arrives.

## What the deployment states

Its broadcaster and its fallbacks, its header source, its retention, and how long it waits for an answer before it reports one, because those are a build's own. The standard requires the duties, not the vendors.
