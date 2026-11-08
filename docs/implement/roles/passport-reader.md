# Passport reader

Implementers can use this guide to build a passport reader that rebuilds history from transaction bytes and reports what each check establishes about the requested product. With the packages, use `chainFromBeef` and `verifyPassportEvidence` from `@bsv/dpp-protocol`, as [build an application](../../packages/build-an-application.md#1-read-a-passport), step 1, shows.

## Before you start

| Input or procedure | Source and requirement |
|---|---|
| Expected passport identifier | The request or item itself, including its host. Never derive it from the evidence being tested ([identifier rules](../../identifiers.md#use-the-identifier-throughout-the-request)). |
| Transactions | BEEF from an index or wallet, or raw transactions. BEEF (Background Evaluation Extended Format) carries transactions, ancestors and merkle proofs. |
| Trust policy | Publisher keys and profile options, such as `managed-custody@2`, selected by your caller |
| Inclusion check | Merkle proofs from transaction evidence and a header source |
| Reference exercises | Node.js 22 or later, npm and the [prepared checkout](../../quick-start.md#get-the-code) after `npm ci` and `npm run build`. Run commands from its root. |
| Optional live read | `curl`, network access, the selected index URL and header service. For more than a handful of passports, obtain a WhatsOnChain API key. |

Missing evidence stays visible in the result as `unknown`; it is never a pass. The [starting kit](../README.md#what-you-will-implement) lists the building blocks, such as BRC-42 key derivation, and where each rule is.

## See the reference answer

Run the version 2 fixture exercise:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

It verifies the five-state version 2 fixture passport, `ISSUE -> UPDATE -> TRANSFER -> UPDATE -> RETIRE`, and prints `The chain as a whole is valid.` Then it prints an `ok:` line for each of the 22 refusals, each refused, and for each of the 13 report cases, each reading `this verifier's report is the pinned one`. No line starts with `FAIL`. Inclusion reads pending, because the test transactions are not mined. [Reading a report](../../learn/evidence-and-freshness.md) explains the checks, observations and limits.

## Build the reader

Implement these rules and test each with its fixture:

1. **Find the passport output** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 2). Parse each transaction and find its one DPP output; keep the output index, because the passport output is not always the first (state 3 of `chain-v2.json` sits at index 1, behind an `OP_RETURN`). Two DPP outputs in one transaction is a refusal.
2. **Decode it under its own version** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) sections 2 and 3, [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) sections 2 and 3). Count the fields between `OP_CHECKSIG` and the first drop opcode: fourteen is version 1, seventeen is version 2, any other count is refused. Check the version field matches the layout. Apply the strict rules: `OP_0` is the empty field, the drop tail is exact with nothing after it, and the locking key is a compressed key. Test with `record-v1.json` and `record-v2.json` and their refusals.
3. **Check both signatures** (section 5 of each version). Rebuild the preimage. The actor's key is the BRC-42 child of field 7 for key identifier field 8, under protocol `[1, 'dpp token v1']` or `[1, 'dpp token v2']`, counterparty `anyone`. The publisher's key is the child of the publisher's identity key for key identifier `passport_id`. Your caller chooses trusted publisher keys. `GET /capabilities` lists the index's admitted keys under `publisherPolicy.publisherKeys`; this describes its trust choice, not your caller's.
4. **Build the history** (section 6 of each version, [custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 4, [managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) section 4). Order the states by the outputs each one actually spends, starting at the genesis. Check every transition: the predecessor and genesis outpoints a version 2 state names, which fields each operation may change, the control proof, nothing after a `RETIRE`, and, under the managed custody profile, the acceptance commitment on every version 2 `TRANSFER`. Test a broken link and a changed controller as well as a valid history, with `chain-v1.json`, `chain-v2.json`, `managed-acceptance-v2.json` and the frozen `managed-acceptance-v1.json`.
5. **Bind the subject** ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3). Compare every state with the identifier your caller expects. A valid record for product B is not evidence about product A.
6. **Check inclusion** ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 8). For each state with a merkle path (a BUMP, the BSV Unified Merkle Path format of [BRC-74](https://bsv.brc.dev/transactions/0074)), compute the root and ask the header source whether it is the root at that height. An unevaluated proof is pending, never a failure. Separate source observations about the latest state from what bytes prove (verification section 5).
7. **Return the report** (verification sections 2, 4, 5 and 6): sixteen checks in order, observations and limits. Run `evidence-v1.json` and `evidence-v2.json` before adding a user interface or an application decision; [what a matching report is](../fixture-runner.md#what-a-matching-report-is) says which parts must match.

### Apply the version 3 rules

Record version 3 carries the same seventeen-field body behind a BRC-162 token prefix (`spec/token-carrier.md`).

| Part | Rule |
|---|---|
| Recognition | Recognise the carrier from the first chunk |
| Prefix layout | Token id or `OP_0`, amount `OP_1`, then `OP_2DROP`, before the locking key |
| Prefix limits | 32-byte id in internal byte order; amount exactly one; no payload beyond an empty slot on the genesis |
| Body | Read as version 2 with version string `3`, protocol `[1, 'dpp token v3']` and version 3 tags |
| Lineage | Genesis is a deploy at output 0; every later state's token id names it |
| Added linkage reasons | `carrier-prefix-invalid` and `token-id-mismatch` |
| Burn | A tip spend with no carrier output: no state, reported as lineage ended without a `RETIRE` |
| Fixtures | `record-v3.json`, `chain-v3.json` and `evidence-v3.json` |

Run the reference against those fixtures:

```sh
node examples/verify-passport.mjs --fixture --version=3 --report
```

Expect one `ok:` line per refusal and report case.

[Run the fixtures](../fixture-runner.md) explains how to load each file and the policy each case runs under.

## Read a live passport

1. Request the passport's outputs with `POST /lookup` ([contracts](../../reference/contracts.md#find-passport-records)). This asks the hosted index:

   ```sh
   curl -s https://dpp-overlay.bsvb.net/lookup \
     -H 'Content-Type: application/json' \
     -d '{"service":"ls_dpp","query":{"passportId":"https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180"}}'
   ```

   It answers `{"type":"output-list","outputs":[...]}` with three outputs, each carrying `beef` (the BEEF as an array of byte values) and `outputIndex`. The index only supplies candidates; your reader verifies what it receives.
2. Merge the BEEFs into one and rebuild the history from it, as in steps 1 to 4 above.
3. Apply your publisher keys and profile options.
4. Ask the header source about each mined state's merkle root and height.
5. Return the report.

Step 1 of [build an application](../../packages/build-an-application.md#1-read-a-passport) does all five in JavaScript, and `node examples/verify-passport.mjs <passport identifier> <index URL>` is the reference reader with every option ([quick start](../../quick-start.md#read-a-live-passport)). Given a bare `01/<gtin>/21/<serial>` instead, it asks the index by GS1 key, names every passport found, and verifies the one it finds.

### Configure the header source

| Setting or behaviour | Requirement or result |
|---|---|
| Query | Is this merkle root the root at this block height? The source answers yes, no or no answer. It may also be asked for current height. |
| Anonymous WhatsOnChain access | Only a few requests a second |
| Pacing and cache | Ask one question at a time and a little apart; keep each answer for the rest of the check. No fixed interval is specified here. |
| API key | The reference uses `WOC_API_KEY`; use a key for more than a handful of passports ([quick start](../../quick-start.md#read-a-live-passport)). |
| Unavailable answer | Inclusion `unknown` with `header-source-unavailable`, never a failure |

## What a report on another party's passport cannot show yet

These are gaps in the standard and the reference package, not faults in your reader; [known limitations](../../operate/limitations.md) lists the reference service's limits.

- **Acceptance records.** A version 2 `TRANSFER` under managed custody commits to an acceptance record that only its custodian keeps, and no index or registry route serves one yet. For a transfer someone else wrote, `evidenceAvailability` therefore reads `unknown` with `referenced-artefact-unavailable`; the fixture case `v2-valid-lineage` shows it.
- **Payload against profile.** The reference report checks a state's `payload_public` against its declared profile through the `payloadValidator` its policy supplies; pass `profilePayloadValidator(ajv)` from the profiles package, as [check a payload against its profile](../../packages/dpp-profiles.md#check-a-payload-against-its-profile) shows. Without one, `schema` reads `unknown` with `schema-unavailable`, and the fixtures, whose payloads predate the `profile` stamp, pin `unknown` with `profile-undeclared`.

## Exact implementation sources

- [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md)
- [spec/managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/b9549475bc008de548ba2368d160dc1ce9ddebb5/fixtures/README.md)

Record results as [evidence reporting](../reporting.md) describes. Stop on an unexpected mismatch and record both results; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [attestation verifier](attestation-verifier.md), which adds claims and anchors to the same report.
