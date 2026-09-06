# Passport reader

**Audience:** an implementer of the reader role, in any language. **Baseline:** `native-baseline@2`. **Prerequisites:** transaction bytes; a header source, or the explicit decision to report inclusion unknown. **Network:** none for the fixtures; a header source for live inclusion. **Canonical sources:** [`spec/record-model.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model.md), [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md), [`spec/custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/custody.md) §4, [`spec/managed-custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/managed-custody.md), [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md), [`fixtures/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/README.md).

## Inputs and outputs

| Input | Output |
|---|---|
| Raw transactions of a token history, oldest first, or a BEEF from which they are taken; optional merkle paths; a policy naming the publisher keys, the custody options and the authorities; the subject the caller expects and where that expectation came from; a header source or none; an observation time | The verification report of `spec/verification.md`: sixteen checks in order with reason codes, the observations, the limits. Or, for the plain chain check, the validity of the supplied history with the first invariant broken named |

## What you reproduce

1. **The script layout of both versions**, selected by push count: fourteen or seventeen minimal pushes, the exact drop tail, compressed key push, strict UTF-8, ISO 8601 timestamps the calendar contains, field bounds. Anything else is `decode-failed`.
2. **Both signature preimages and the derivations** under `[1, 'dpp token v1']` and `[1, 'dpp token v2']` with the passport identifier as key identifier and counterparty `anyone`; the publisher's countersignature over the same bytes plus the actor's signature; verification under the derived children and refusal of a signature made over the other version's preimage.
3. **The chain invariants**: the genesis rules, the spend of exactly the predecessor's output, one DPP output per transaction, the immutable passport identifier, the transition rules per operation and version, the version 2 control proof in the order equality, authority, linkage, the terminal `RETIRE`, and the single upgrade from a version 1 tip.
4. **The optional profiles a reader may select**: the owner-signed transfer of version 1 and the acceptance commitment of `managed-custody@1`, each refusable by name and each accepted again with the option off.
5. **Inclusion** from a merkle path against the header source you were given, reported `proof-absent`, `proof-refuted` or `header-source-unavailable` when it cannot pass.
6. **The report**: the fixed check order, four answers, the shared reason codes, the expected subject rule, the observations as observations, and the limit sentences.

## The minimal runnable path

Load `fixtures/chain-v2.json`, rebuild every `rawTx`, verify the five states as a chain with the custodian key as publisher and the managed acceptance option on, then load `fixtures/managed-acceptance-v1.json` and bind the record to the transfer. Then run every entry in `refusals[]` after the prefix its `appendAfter` names and check that your verifier reports the pinned `error` under the option the vector names, and accepts the same bytes with the option off where the vector says so. Then do the same for `chain-v1.json`. Then produce a report for every case of `evidence-v1.json` and `evidence-v2.json` from its hex, answering the declared observers and header source as written and injecting `checkedAt`, and compare it with the pinned report byte for byte.

## Expected results

| Fixture | Positive | Refusals |
|---|---|---|
| `record-v1.json` (vectors 2 positive, 9 refusal) | The state decodes, both signatures verify under the derived keys, the locking script is reproduced | Uncompressed key, three malformed tails, rolled timestamp, mangled UTF-8, non-minimal NUL, empty PUSHDATA, overlong identifier |
| `record-v2.json` (2 positive, 9 refusal) | As above under the framed preimage; the actor signature verifies under nothing derived for version 1 | Field count against version, unsupported version, short tail, missing odd drop, wrong outpoint length, wrong linkage length, linkage on `ISSUE`, event data over bound |
| `chain-v1.json` (9 positive, 16 refusal) | Six states valid; owner-signed transfer holds on the three transfers when selected | Nine invariant breaks, seven consent refusals, one of which is accepted under named authorities |
| `chain-v2.json` (10 positive, 25 refusal) | Five states valid under `managed-custody@1`; the upgrade over the version 1 chain valid | Twenty-two lineage refusals and three upgrade refusals, each naming its reason |
| `managed-acceptance-v1.json` (2 positive, 6 refusal) | Structure, signature and binding all hold | Each refusal answers the three verdicts separately |
| `evidence-v1.json` (21 cases), `evidence-v2.json` (13 cases) | Every report equal to the pinned one | The refusal cases are among them: refuted proof, stale prefix, missing middle, substitution, duplicate genesis, retired tip, failed control, unknown version |

## What a reader never does

Trust an index's answer as validity, freshness or completeness. Pass a check it did not run. Guess at a version it does not know. Show a single verdict where the contract has sixteen.
