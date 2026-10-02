# Run the fixtures

This page is for implementers writing a test harness, in their own language, that runs the pinned fixtures against their own code. It says what each file gives you as input, what your code must reproduce, and which parts of a result must match; set up the checkout first, as [start an independent implementation](README.md#before-you-start) shows.

A fixture is a JSON file of inputs and expected results, including inputs a conforming implementation must refuse. A signing preimage is the exact byte sequence a signature is made over; reproducing it catches errors that decoding the fields alone cannot reveal.

## Build a small test loop

1. Load one case from a file in `fixtures/`.
2. Pass its input to your code. Never call the reference packages or a reference service to decide what the answer should be, and keep any driver that calls a service apart from your assertions.
3. Compare your result with the case's expected result, on the parts the next section names.
4. Record the file, the case, the expected result and your result. A mismatch names the case, the field and both values.

Start with the native path: record, chain, acceptance record, report. Add historical, mixed-version and interoperability cases after it works.

## What each file gives you

| File | Input | Your code must reproduce or refuse |
|---|---|---|
| `fixtures/record-v2.json` | `lockingScript`; `custodianKey`, the publisher's identity key | `state` (the fifteen data fields), `actorPreimage` and `publisherPreimage` byte for byte, `actorVerificationKey` and `publisherVerificationKey`, and both signatures verifying under them. Refuse the nine scripts in `refusals`; each `reason` names the rule broken. |
| `fixtures/record-v1.json` | `lockingScript`; `serverKey`, the publisher's identity key | `state`, `userPreimage`, `serverPreimage`, both verification keys and signatures. Refuse `uncompressedKey`, the three `malformedTail` scripts, `rolledTimestamp`, `mangledUtf8`, `nulPassportId`, `emptyPushdata` and `overlongPassportId`. |
| `fixtures/chain-v2.json` | `states[].rawTx`, oldest first; `custodianKey` as the publisher key | Accept the five states. Refuse the 22 `refusals`, accept `boundaryControl` (a valid alternative successor of the second state), accept `upgrade` after the six states of `chain-v1.json`, and refuse its three `refusals`. The policy rules are below the table. |
| `fixtures/chain-v1.json` | `states[].rawTx`; `serverKey` as the publisher key | Accept the six states; refuse the 16 `refusals`. |
| `fixtures/managed-acceptance-v1.json` | `record`; `transfer` | `canonicalUnsigned` and `signingPreimageHex`, the custodian's signature, `commitment`, and the record binding to `transfer`. Each of the six `refusals` has three separate verdicts in `expected`: structure, signature and binding. |
| `fixtures/attestation-anchor-v1.json` | `unsignedClaim`, `issuerPrivateKey`, `anchoringPrivateKey` | `claim`, `canonicalUnsignedClaim`, `representationBytes`, `digest`, the nine `fields`, `signingPreimage`, `signature`, `lockingKey` and `lockingScript`. Its refusals are in the vector form: [attestation verifier](roles/attestation-verifier.md#the-cases-to-run) lists them. |
| `fixtures/evidence-v2.json` and `fixtures/evidence-v1.json` | Each case's `evidence`, `expectedSubject`, `policy` and `observers`, and the file's `checkedAt` | Each case's `report`, on the parts [what a matching report is](#what-a-matching-report-is) lists |

**Chain refusals.** Each refusal extends a prefix of the valid chain. `appendAfter` is a zero-based index into `states`: keep `states[0]` to `states[appendAfter]` and add the refusal's `rawTx`. `-1` means the refusal stands alone as a genesis. The default policy names no publisher key (the publisher signature is admission policy and may be skipped; with the file's publisher key the valid chain passes too), selects no custody profile and names no control authorities. Three kinds of case change that, and each must be run both ways:

- `managedAcceptance: true` (the version 2 `transferWithoutCommitment`): refused with `managed-custody@1` selected, valid with it off.
- `ownerConsent: true` (seven version 1 cases): refused with the owner-signed transfer selected, valid with it off.
- `acceptedUnder` (`recoveryWithoutAuthority` in both files): valid when the keys it names are the control or transfer authorities.

These control cases keep a harness that refuses everything from passing.

**Evidence cases.** `evidence.tokenHistory` is the passport's transactions as raw hex, oldest first. Optional parts sit beside it: `merklePaths` (a merkle path per state in BUMP form, as hex), `alternativeHistories`, `nativeClaims` as posted, `anchors` (locking scripts as hex, with the secured bytes when supplied) and `acceptanceRecords`. `policy` names the publisher keys, the profile options (`managedAcceptance`, `ownerConsent`), any `authority` lists and `policyId`. `chainTracker` is `scripts-only` for no header source, or `header-source` with `headerSource` mapping each height to the merkle root the source holds, or to `unavailable` for an outage. `observers` are latest-state sources that answer exactly as written: `unspent`, `spent` with its `spendingTxid`, `not-found` or `unavailable`. Inject the file's `checkedAt` as the observation time: `2026-09-05T12:00:00Z` in `evidence-v1.json` and `2027-06-01T12:00:00Z` in `evidence-v2.json`. The second is a future date on purpose; it is synthetic test input, not a delivery date.

## What a matching report is

Do not compare whole reports as JSON. Parts of a report are free text or each build's own vocabulary: `limits` are sentences, a check's `detail` is optional and its shape is the build's own (the reference's carries names such as `userSignatureValid` and `spv`), `queryScope` is words, and `evidenceRefs` mixes forms the specification fixes with the reference's own labels such as `anchor:0`.

| Part of the report | How to compare |
|---|---|
| `checks`: `name`, `status` and `reasonCode` | Must match. Sixteen entries, in the order of [verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 4. A pass may carry no `reasonCode`. |
| `checks[].scope` | Must match where the fixture gives one, such as `{"stateIndex":2}` |
| `reportVersion`, `checkedAt`, `expectedSubject`, `suppliedTip`, `policyId` | Must match |
| `observations.latestState` and `observations.candidateOutpoints` | Must match |
| `checks[].evidenceRefs` | Compare the outpoints (`txid:outputIndex`) and digests (`sha256:<hex>`); other labels may differ |
| `limits` | Check that the sentences verification section 6 requires are present, in your own words; do not compare the text |
| `checks[].detail`, `observations.queryScope`, `observations.sources[].id` | Not compared |

This is the equivalence the [trial](demonstration.md) asks for in its `reader-equivalence` scenario: "the same check statuses and reason codes". Verification section 8 asks a conforming verifier for "equivalent reports for the pinned fixture cases"; the [fixture guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md)'s "equal to `report`" is what the reference itself meets.

To see the parts that must match for one case, run this at the root of the checkout:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const { cases } = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
const { report } = cases.find((item) => item.id === 'v2-control-not-proven')
for (const check of report.checks) console.log([check.name, check.status, check.reasonCode ?? '', check.scope ? JSON.stringify(check.scope) : ''].join(' ').trim())
console.log('latestState', report.observations.latestState, JSON.stringify(report.observations.candidateOutpoints))
JS
```

It prints sixteen lines, from `recordEncoding pass` to `evidenceAvailability pass`, among them `linkage fail control-not-proven {"stateIndex":2}` and `inclusion unknown proof-absent`, then `latestState unknown` with one candidate outpoint. Your harness compares those values for every case.

To list every report case without running anything:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
for (const item of fixture.cases) console.log(item.id, item.description)
JS
```

It prints thirteen lines, from `v2-valid-lineage` to `unknown-version`, each with its description. The [reference reader exercise](../quick-start.md#check-the-test-passports-offline) shows the reference reproducing every case.

## What a matching refusal is

A refusal passes when your code refuses the input. The vector form also names the stage, such as `decode` or `chain`; the trial's `vectors` scenario asks for each refusal "at the point the vector names", and for reason codes only "where the vector specifies them". The record and chain refusals carry a sentence (`error` in the top-level files, `reason` in the vectors), not a reason code: it is the reference's wording of the rule the case breaks. Map your own error to that rule and keep both sentences in your results, as the Python reader does when it prints `pinned reason:` beside its own.

## The vector form

The same bytes are also published in the BSV stack's cross-language vector format under `fixtures/vectors/dpp/`. A runner written for another language may find this form easier:

- Each file, such as `fixtures/vectors/dpp/record/v2.json`, has an `id` (`dpp.record.v2`), a `parity_class` and a `vectors` array.
- Each vector has `id`, `description`, `input`, `expected` and `tags`. Positive vectors are tagged `happy-path` and refusals `error-case`; the publisher policy and evidence package files tag them `valid` and `refusal`.
- Binary values are lower-case hex under keys ending `_hex`. The positive record and chain vectors publish the synthetic test private keys and `signature_nonce: "rfc6979"`, so a writer reproduces every pinned byte.
- A record, chain or historical anchor refusal expects `{ "accepted": false, "stage": ..., "reason": ... }`; a current anchor refusal expects `{ "accepted": false }`.
- Vector identifiers are permanent: a corrected expectation is a new vector, and the old one is marked skipped with a reason.

The two forms do not map one file to one file:

| Vector file | Top-level file |
|---|---|
| `record/v1.json`, `record/v2.json`, `chain/v1.json`, `chain/v2.json`, `managed-acceptance/v1.json` | The record, chain and acceptance files of the same name |
| `attestation-anchor/v1.json` | `attestation-anchor-v1.json`, plus six refusals only the vector file has |
| `anchor/v3.json` | `anchor-v3.json`, plus four refusals only the vector file has |
| `publisher-policy/v1.json`, `evidence-package/v1.json`, everything under `interoperability/` | None: vector form only |
| None: top-level form only | `evidence-v1.json`, `evidence-v2.json`, `battery-lifecycle-v1.json` |

The stack's structural runner validates the vector files: from a checkout of `ts-stack` with its runner's dependencies installed, `node conformance/runner/src/runner.js --validate-only --vectors <this repository>/fixtures/vectors` exits 0 when they are well formed ([vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md)).

## The worked example

The [independent Python reader](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/independent/python/README.md) runs most of these files from a reader written from the specification: the record, chain, anchor and acceptance fixtures and the record, chain, anchor, acceptance, publisher policy and evidence package vectors. It does not produce the reports of `evidence-v1.json` and `evidence-v2.json`, so it is no example of the report comparison. Run it at the root of the checkout with `python3 conformance/independent/python/dpp_verify.py` (or `npm run conformance:independent`, which needs `python3` on the path); it ends with `Every sentence above holds.`

## Source definitions

| Need | Source |
|---|---|
| Fixture inventory and generation policy | [Fixture guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md) |
| Baseline role and test selection | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json) |
| Cross-language vector format | [Vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md) |
| Interoperability vectors | [Interoperability fixture guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/README.md) |
| Record bytes and signing | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| Native claims and anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Acceptance and portable evidence | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md), [portable evidence](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md) |
| The report | [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/verification-report.schema.json) |

## Source gaps

These are open questions in the standard's own texts, where two sources do not yet give one answer. Record an affected case as unresolved and use [the disagreement route](../contribute/disagreements.md); a passing reference result does not close the question. [Known limitations](../operate/limitations.md) lists the limits of the reference service.

| Gap | Sources requiring reconciliation | Meanwhile |
|---|---|---|
| The native mapping paragraph mentions a payload absent from the allowed claim fields | [Rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#L33-L66), [validator](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/src/attestation.ts#L35-L54) | Implement the claim with exactly the properties of rules section 3, which has no payload. A mapping that needs evidence facets cannot find them in a native claim. |
| Canonical key ordering differs between text and implementation | [Native text](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#L66), [managed-custody text](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md#L39), [canonicaliser](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/src/canonicalJson.ts#L24-L36) | The texts say code-unit order; the reference sorts by Unicode code point. Every key in every fixture is ASCII, where the two orders agree, so the gap changes no fixture result today. |
| Pre-1.0 precedence needs a consistent reading | [Governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md), [record-model status](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md#L3) | Where two sources disagree, record both readings and the input that shows the difference. |
| Expected-subject prose forbids evidence-derived identifiers; its table includes a `none` fallback | [Report source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md#L27-L34); when a request names no subject, the reference registry uses the evidence's own identifier with `source: none` | Always pass the subject your caller expects. With `source: none`, every subject-dependent check reads `unknown` with `subject-not-independent`. |

Next: the [passport reader](roles/passport-reader.md) guide, then [report your results](reporting.md).
