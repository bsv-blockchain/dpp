# Passport reader

A passport reader rebuilds a passport's history from transaction bytes and reports, check by check, what that history establishes about the product the caller asked about. This page is for anyone building one in their own code; with the packages, a reader is `chainFromBeef` and `verifyPassportEvidence` from `@bsv/dpp-core`, as step 1 of [build an application](../../packages/build-an-application.md#1-read-a-passport) shows.

A reader needs:

- the passport identifier the caller expects, host included, from the request or the item itself, never from the evidence being tested ([a path alone is not a passport identifier](../../identifiers.md#use-the-identifier-throughout-the-request));
- the passport's transactions, as BEEF from an index or a wallet, or as raw transactions (BEEF, Background Evaluation Extended Format, carries transactions with their ancestors and merkle proofs);
- the publisher keys it accepts and the profile options it applies, such as `managed-custody@1`;
- for the inclusion check, merkle proofs and a header source.

Missing evidence stays visible in the result as `unknown`; it is never a pass. The [starting kit](../README.md#what-you-will-implement) lists the building blocks, such as BRC-42 key derivation, and where each rule is.

## See the reference answer

At the root of a checkout, after [setup](../../quick-start.md#get-the-code):

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

It verifies the five-state version 2 fixture passport, `ISSUE -> UPDATE -> TRANSFER -> UPDATE -> RETIRE`, and prints `The chain as a whole is valid.` Then it prints an `ok:` line for each of the 22 refusals, each refused, and for each of the 13 report cases, each reading `this verifier's report is the pinned one`. No line starts with `FAIL`. Inclusion reads pending, because the test transactions are not mined. [Reading a report](../../learn/evidence-and-freshness.md) explains the checks, observations and limits.

## Build the reader

Each step names the rule it implements and the fixture that tests it.

1. **Find the passport output** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 2). Parse each transaction and find its one DPP output; keep the output index, because the passport output is not always the first (state 3 of `chain-v2.json` sits at index 1, behind an `OP_RETURN`). Two DPP outputs in one transaction is a refusal.
2. **Decode it under its own version** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) sections 2 and 3, [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) sections 2 and 3). Count the fields between `OP_CHECKSIG` and the first drop opcode: fourteen is version 1, seventeen is version 2, any other count is refused. Then check that the version field matches the layout, and apply the strict reading rules: `OP_0` is the empty field, the drop tail is exact with nothing after it, and the locking key is a compressed key. Test with `record-v1.json` and `record-v2.json` and their refusals.
3. **Check both signatures** (section 5 of each version). Rebuild the preimage. The actor's key is the BRC-42 child of field 7 for key identifier field 8, under protocol `[1, 'dpp token v1']` or `[1, 'dpp token v2']`, counterparty `anyone`. The publisher's key is the child of the publisher's identity key for key identifier `passport_id`. Which publisher keys to accept is your caller's trust choice: an index's `GET /capabilities` lists, under `publisherPolicy.publisherKeys`, the keys that index admits, which tells you whom that index trusts, not whom you should.
4. **Build the history** (section 6 of each version, [custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 4, [managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) section 4). Order the states by the outputs each one actually spends, starting at the genesis. Check every transition: the predecessor and genesis outpoints a version 2 state names, which fields each operation may change, the control proof, nothing after a `RETIRE`, and, under `managed-custody@1`, the acceptance commitment on every version 2 `TRANSFER`. Test a broken link and a changed controller as well as a valid history, with `chain-v1.json`, `chain-v2.json` and `managed-acceptance-v1.json`.
5. **Bind the subject** ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3). Compare every state with the identifier your caller expects. A valid record for product B is not evidence about product A.
6. **Check inclusion** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 8). For each state with a merkle path (a BUMP, the BSV Unified Merkle Path format of [BRC-74](https://bsv.brc.dev/transactions/0074)), compute the root and ask the header source whether it is the root at that height. A proof that could not be evaluated is pending, never a failure. Keep what sources say about the latest state apart from what the bytes prove (verification section 5).
7. **Return the report** (verification sections 2, 4, 5 and 6): sixteen checks in order, observations and limits. Run `evidence-v1.json` and `evidence-v2.json` before adding a user interface or an application decision; [what a matching report is](../fixture-runner.md#what-a-matching-report-is) says which parts must match.

A carried state, record version 3 (`spec/token-carrier.md`), is the same seventeen-field body behind a BRC-162 token prefix: a token id or `OP_0`, the amount `OP_1` and `OP_2DROP` before the locking key. Recognise it from the first chunk, hold the prefix to its rules (a 32-byte id in internal byte order, an amount of exactly one, no payload beyond an empty slot on the genesis), read the body as version 2 with the version string `3`, the protocol `[1, 'dpp token v3']` and the version 3 tags, and check that the genesis is a deploy at output 0 and that every later state's token id names it. `carrier-prefix-invalid` and `token-id-mismatch` are the two linkage reason codes this adds, and a spend of the tip by a transaction with no carrier output is a burn: no state, reported as the lineage ended without a `RETIRE`. Test with `record-v3.json`, `chain-v3.json` and `evidence-v3.json`; `node examples/verify-passport.mjs --fixture --version=3 --report` is the reference doing the same, one `ok:` line per refusal and per report case.

[Run the fixtures](../fixture-runner.md) explains how to load each file and the policy each case runs under.

## Read a live passport

1. Ask an index for the passport's outputs with `POST /lookup` ([contracts](../../reference/contracts.md#find-passport-records)). This asks the hosted index from any machine with `curl`:

   ```sh
   curl -s https://dpp-overlay.bsvb.net/lookup \
     -H 'Content-Type: application/json' \
     -d '{"service":"ls_dpp","query":{"passportId":"https://id.gs1.org/01/09506000134352/21/7AC18477503A"}}'
   ```

   It answers `{"type":"output-list","outputs":[...]}` with five outputs, each carrying `beef` (the BEEF as an array of byte values) and `outputIndex`. The index only supplies candidates; your reader verifies what it receives.
2. Merge the BEEFs into one and rebuild the history from it, as in steps 1 to 4 above.
3. Apply your publisher keys and profile options.
4. Ask the header source about each mined state's merkle root and height.
5. Return the report.

Step 1 of [build an application](../../packages/build-an-application.md#1-read-a-passport) does all five in JavaScript, and `node examples/verify-passport.mjs <passport identifier> <index URL>` is the reference reader with every option ([quick start](../../quick-start.md#read-a-live-passport)). Given a bare `01/<gtin>/21/<serial>` instead, it asks the index by GS1 key, names every passport found, and verifies the one it finds.

**The header source.** A header source answers one question, whether a merkle root is the one at a block height, with yes, no or no answer, and it may be asked the current height. WhatsOnChain limits anonymous callers to a few requests a second, so ask one question at a time and a little apart, keep each answer for the rest of the check, and use an API key for more than a handful of passports. An answer that could not be obtained reports inclusion `unknown` with `header-source-unavailable`, never a failure.

## What a report on another party's passport cannot show yet

These are gaps in the standard and the reference package, not faults in your reader; [known limitations](../../operate/limitations.md) lists the reference service's limits.

- **Acceptance records.** A version 2 `TRANSFER` under `managed-custody@1` commits to an acceptance record that only its custodian keeps, and no index or registry route serves one yet. For a transfer someone else wrote, `evidenceAvailability` therefore reads `unknown` with `referenced-artefact-unavailable`; the fixture case `v2-valid-lineage` shows it.
- **Payload against profile.** The reference report does not check a state's `payload_public` against its declared profile: `schema` reads `unknown` with `no-evidence`, and the fixtures pin that. Check the payload separately against the profile's published schema, as [check a payload against its profile](../../packages/dpp-profiles.md#check-a-payload-against-its-profile) shows, and report that result beside the report.

## Exact implementation sources

- [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md)
- [spec/managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [attestation verifier](attestation-verifier.md), which adds claims and anchors to the same report.
