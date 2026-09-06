# Passport writer

**Audience:** an implementer of the writer role. **Baseline:** `native-baseline@2`, writing version 2. **Prerequisites:** a BRC-100 wallet with funds, or a co-funding publisher; the index and header source you announce to and prove against. **Network:** none for the byte vectors; a wallet, a broadcaster, an index and a header source for a live write. **Canonical sources:** [`spec/writing.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/writing.md), [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md), [`spec/managed-custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/managed-custody.md) §4, [`spec/profiles.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/profiles.md) §5.

## Inputs and outputs

| Input | Output |
|---|---|
| The operation, the payload, the actor's and publisher's signing capability, the tip's outpoint and bytes, the custody arrangement, the target index and the proof source | A signed transaction with one DPP output; the announcement, the broadcast answer in the network's own words, the proof once obtained, and the retained evidence; one sentence per rule for the self-report |

## What you reproduce

1. **The bytes**: the same layout, preimages, derivations and signatures the reader verifies. The positive vectors publish their synthetic private keys (`11`, `22`, `33`, `44`, `55` repeated to 32 bytes) so your writer rebuilds the pinned locking scripts exactly; a differing byte is a defect in your serialiser, not a stylistic choice. RFC 6979 nonces make the signatures reproducible.
2. **Verify before sending** (§2): reconstruct the chain from the tip, append the candidate and run your own reader over it; nothing is sent when that fails.
3. **Announce before sending** (§3) where you follow that order: the index admits or refuses while the state is a draft, and `none` stops with nothing sent.
4. **One writer per passport** (§4): a tip is spent once; a second candidate is not built while the first spend's fate is unknown.
5. **Broadcast** (§5) through the wallet, reporting the answer in the network's three words: accepted and pending, not yet an answer, never existed.
6. **Announce and retry** (§6): a failed announcement never fails a record and is retried, never rebuilt.
7. **The proof** (§7): obtain the merkle path, attach it, offer it to the index.
8. **Retain** (§8): the transaction, its BEEF and its proof for the passport's life.
9. **Under `managed-custody@1`**: the offer against the current tip, the custodian-signed acceptance record, the transfer's commitment to its digest, and refusal of an expired, declined or mismatched acceptance.
10. **Identifier discipline**: a GTIN under a prefix licensed to the brand, or under 952 for a record that describes no real object, with a correct check digit written.

## The minimal runnable path

Rebuild the genesis of `fixtures/chain-v2.json` from `states[0].data` and the test keys and compare the locking script and the transaction with the pinned bytes. Rebuild every later state, including the transfer's commitment from `fixtures/managed-acceptance-v1.json`. Then build a state the record model forbids (a payload change on a `TRANSFER`, a second `ISSUE`) and show your own verification refusing it before anything would be sent. Then, live, write one `ISSUE` under possession from one wallet against a reference index and walk the seven steps, one sentence each.

## Expected results

Byte-identical positive vectors; your reader's refusal of the forbidden state; a live state admitted by the reference index, accepted by the network, proven within the expected window and read as `verified` by the reference reader.

## The self-report

No byte vector certifies behaviour. Writer conformance is self-reported against `spec/writing.md` §11, one sentence per rule and in the fixture style, beside the vector results. A report that passes every fixture says nothing about the writer until those sentences stand next to it.
