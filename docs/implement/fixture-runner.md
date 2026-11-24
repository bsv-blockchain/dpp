# Run the fixtures

Implementers can use this page to build a test harness in their own language and compare their code with the pinned fixtures. It defines each file's inputs, required results and comparison rules.

A fixture is a JSON file of inputs and expected results, including required refusals. A signing preimage is the exact signed byte sequence; reproducing it catches errors that field decoding alone misses.

## Before you start

| Procedure | Input and source |
|---|---|
| Run your harness | Your implementation and a reviewed checkout with unchanged fixtures, as [start an independent implementation](README.md#before-you-start) describes. Retain the revision with your results. |
| Run reference commands | Node 22 and npm; run `npm ci` and `npm run build` in that checkout. Run page commands from its root. |
| Optional structural check | A separate `ts-stack` checkout with its runner dependencies installed, and the path to this repository. |

## Select cases from the implementer bundle

The bundle includes `fixture-catalogue.json`. Its `files` object lists every JSON file under `fixtures/`, the SHA-256 of its exact bytes and an array of case IDs and JSON Pointers. An empty pointer selects the whole fixture. Retain the containing file when resolving a pointer because cases can use shared keys, predecessor states or observations. For policy controls, apply the listed `policy` as described below. Source fixtures with explicit case identifiers keep those identifiers. A superseded case retains its pointer and carries `skip` and `skipReason`. Record the skip and run the replacement case.

Record the bundle's release set, the fixture path and digest, the case ID, the implementation revision and its actual result. Count a case only after comparing the required outputs. The catalogue includes historical and parked formats distributed in `fixtures/`. Reconcile their individual results with the claimed role and the declaration rules. The bundle manifest separately lists archived materials under `docs/reference/parked/`.

## Build a small test loop

1. Load one case from a file in `fixtures/`.
2. Pass its input to your code. Never call the reference packages or a reference service to decide what the answer should be, and keep any driver that calls a service apart from your assertions.
3. Compare your result with the case's expected result, on the parts the next section names.
4. Record the file, the case, the expected result and your result. A mismatch names the case, the field and both values.

Start with the native path: record, chain, acceptance record, report. Add historical, mixed-version and interoperability cases after it works.

## What each file gives you

| File | Input | Your code must reproduce or refuse |
|---|---|---|
| `fixtures/record-v2.json` | `lockingScript`; `custodianKey`, the publisher's identity key | `state` (the fifteen data fields), `actorPreimage` and `publisherPreimage` byte for byte, `actorVerificationKey` and `publisherVerificationKey`, and both signatures verifying under them. Refuse the ten scripts in `refusals`; each `reason` names the rule broken. |
| `fixtures/record-v1.json` | `lockingScript`; `serverKey`, the publisher's identity key | `state`, `userPreimage`, `serverPreimage`, both verification keys and signatures. Refuse `uncompressedKey`, the three `malformedTail` scripts, `rolledTimestamp`, `mangledUtf8`, `nulPassportId`, `emptyPushdata` and `overlongPassportId`. |
| `fixtures/chain-v2.json` | `states[].rawTx`, oldest first; `custodianKey` as the publisher key | Accept the five states. Refuse the 22 `refusals`, accept `boundaryControl` (a valid alternative successor of the second state), accept `upgrade` after the six states of `chain-v1.json`, and refuse its three `refusals`. The policy rules are below the table. |
| `fixtures/chain-v1.json` | `states[].rawTx`; `serverKey` as the publisher key | Accept the six states; refuse the nine `refusals`. |
| `fixtures/managed-acceptance-v2.json` | `record`; `transfer`; `custodianKey` | `canonicalUnsigned` and `signingPreimageHex`, the custodian's signature under the derived key `signing` names, `canonicalSigned`, `commitment`, and the record binding to `transfer`. Each of the seven `refusals` has three separate verdicts in `expected`: structure, signature and binding. |
| `fixtures/managed-acceptance-v1.json` | `record`; `transfer` | `canonicalUnsigned` and `signingPreimageHex`, the custodian's signature, `commitment`, and the record binding to `transfer`. Each of the six `refusals` has three separate verdicts in `expected`: structure, signature and binding. |
| `fixtures/attestation-anchor-v1.json` | `unsignedClaim`, `issuerPrivateKey`, `anchoringPrivateKey` | `claim`, `canonicalUnsignedClaim`, `representationBytes`, `digest`, the nine `fields`, `signingPreimage`, `signature`, `lockingKey` and `lockingScript`. Its refusals are in the vector form: [attestation verifier](roles/attestation-verifier.md#the-cases-to-run) lists them. |
| `fixtures/index-registration-v1.json` | `request`; `expectations` | `canonicalUnsigned` and `signingPreimageHex`, the publisher's signature under the derived key `signing` names, and `expected`. Refuse the seven `refusals`, each with the `reasons` its `expected` lists. |
| `fixtures/evidence-v2.json` and `fixtures/evidence-v1.json` | Each case's `evidence`, `expectedSubject`, `policy` and `observers`, and the file's `checkedAt` | Each case's `report`, on the parts [what a matching report is](#what-a-matching-report-is) lists |

### Policy switches and observation inputs

Each chain refusal extends a prefix of the valid chain. Run all policy variants below; the valid controls prevent a harness that refuses everything from passing.

| Chain input or policy | How to run it |
|---|---|
| `appendAfter` | Zero-based index in `states`: retain `states[0]` to `states[appendAfter]`, then append the refusal's `rawTx` |
| `-1` | Refusal stands alone as a genesis |
| Default policy | No publisher key, custody profile or control authorities. Publisher signature verification is admission policy and may be skipped; the valid chain also passes with the file's publisher key. |
| `managedAcceptance: true` | Version 2 `transferWithoutCommitment`: refused with managed custody selected, valid with it off |
| `acceptedUnder` | `recoveryWithoutAuthority` in `chain-v2.json`: valid when the named keys are control authorities; run both ways |

| Evidence input | Meaning |
|---|---|
| `evidence.tokenHistory` | Passport transactions as raw hex, oldest first |
| Optional `merklePaths` | Merkle path per state, BUMP hex |
| Optional `alternativeHistories` | Alternative histories beside the token history |
| Optional `nativeClaims` | Claims as posted |
| Optional `anchors` | Locking scripts as hex, with secured bytes when supplied |
| Optional `acceptanceRecords` | Acceptance records beside the token history |
| `policy` | Publisher keys, the profile option `managedAcceptance`, any `controlAuthorities` and `authority` lists, and `policyId` |
| `chainTracker` | `scripts-only` means no header source; `header-source` uses `headerSource`, mapping each height to its merkle root or `unavailable` for an outage |
| `observers` | Latest-state sources. Use each declared result (`unspent`, `spent`, `not-found`, `unavailable` or `conflicting`) and retain any supplied `spendingTxid`. |
| `checkedAt` | Inject the file's observation time: `2026-09-05T12:00:00Z` in `evidence-v1.json`; `2027-06-01T12:00:00Z` in `evidence-v2.json`. The future date is deliberate synthetic input, not a delivery date. |

## What a matching report is

Do not compare whole reports as JSON. Some fields are free text or implementation-specific:

| Field | Why whole-value equality is unsuitable |
|---|---|
| `limits` | Sentences whose required meaning must survive |
| `detail` | Optional, implementation-defined shape; the reference uses names such as `userSignatureValid` and `spv` |
| `queryScope` | Words |
| `evidenceRefs` | Mixes specified forms with reference labels such as `anchor:0` |

For each evidence case, check `skip` before running the comparison. Record a skipped case with its `skip_reason` and run the replacement named there. The archived report belongs to its original case. Every report your verifier produces must include the credential-status limit required by verification section 6.

| Part of the report | How to compare |
|---|---|
| `checks`: `name`, `status` and `reasonCode` | Must match. Sixteen entries, in the order of [verification](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/verification.md) section 4. A pass may carry no `reasonCode`. |
| `checks[].scope` | Must match where the fixture gives one, such as `{"stateIndex":2}` |
| `reportVersion`, `checkedAt`, `expectedSubject`, `suppliedTip`, `policyId` | Must match |
| `observations.latestState` and `observations.candidateOutpoints` | Must match |
| `checks[].evidenceRefs` | Compare the outpoints (`txid:outputIndex`) and digests (`sha256:<hex>`); other labels may differ |
| `limits` | Check that the sentences verification section 6 requires are present, in your own words; do not compare the text |
| `checks[].detail`, `observations.queryScope`, `observations.sources[].id` | Not compared |

A history-wide result covers the chain inspection. In the version 1 cases `proof-refuted` and `missing-middle`, inspection stops at state index 2. The first case fails inclusion and the second fails linkage. The report gives `unknown` with `not-inspected` for record encoding and both selected signature checks because later supplied states were never inspected. In `wrong-publisher`, publisher verification fails at index 0 and the encoding and actor checks likewise remain unknown. If decoding itself fails, use `decode-failed`; if the policy selected no publisher, its signature check remains `not-applicable` with `publisher-not-selected`. A separate signature calculation on an individual transaction can still be retained in per-state detail.

This is the equivalence the parked [interoperability trial](../reference/parked/interoperability-trial/README.md) asks for in its `reader-equivalence` scenario: "the same check statuses and reason codes". Verification section 8 asks a conforming verifier for "equivalent reports for the pinned fixture cases"; the [fixture guide](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/fixtures/README.md)'s "equal to `report`" is what the reference itself meets.

To check a caller's genesis selection, use the two histories from `duplicate-genesis` in `fixtures/evidence-v1.json` as alternatives and omit the primary history. Add the signed native claim from `anchor-and-claim`. With an independently expected genesis from one of the histories, the reader can identify that lineage. Repeat with the second outpoint of the six-state history as the expected genesis. The subject check must report a mismatch, even though the claim names the correct passport. With no selected genesis, the two distinct genesis records leave the subject ambiguous.

Inspect the required comparison fields for one case:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const { cases } = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
const { report } = cases.find((item) => item.id === 'v2-control-not-proven')
for (const check of report.checks) console.log([check.name, check.status, check.reasonCode ?? '', check.scope ? JSON.stringify(check.scope) : ''].join(' ').trim())
console.log('latestState', report.observations.latestState, JSON.stringify(report.observations.candidateOutpoints))
JS
```

Expect sixteen check lines, from `recordEncoding pass` to `evidenceAvailability pass`, including `linkage fail control-not-proven {"stateIndex":2}` and `inclusion unknown proof-absent`. Then comes `latestState unknown` with one candidate outpoint. Compare those values for every case.

To list every report case without running anything:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
for (const item of fixture.cases) console.log(item.id, item.description)
JS
```

It prints one line per case, from `v2-valid-lineage` to `v2-tip-competing-spenders`, each with its description. The [reference reader exercise](../quick-start.md#check-the-test-passports-offline) shows the reference reproducing every case.

## What a matching refusal is

A refusal passes when your code refuses the input. Match reason codes only where specified.

Record and chain refusals give a sentence, not a reason code: `reason` in `record-v2.json` and `error` in the chain files, while each refusal of `record-v1.json` is named by its property. Map your error to the rule that sentence identifies. Keep both sentences.

## The vector form

The formats that have no top-level file are published in the BSV stack's cross-language vector format under `fixtures/vectors/dpp/`. Each format is published in one form only, except the current anchor:

| Form | Files |
|---|---|
| Top-level only | The record, chain, historical anchor, acceptance and registration files, `evidence-v1.json`, `evidence-v2.json` and `battery-lifecycle-v1.json`, a historical fixture under the retired `battery@2` |
| Both | `attestation-anchor-v1.json` and `attestation-anchor/v1.json`, which adds six refusals. `attestation-anchor/native-binding-v1.json` exercises the relationship between the native identifier, signed metadata and exact secured bytes |
| Vector form only | `epcis-lifecycle/v1.json`, `publisher-policy/v1.json`, `evidence-package/v1.json`, `exchange/epcis-event-vc/v1.json` and everything under `interoperability/` |

- Each file, such as `fixtures/vectors/dpp/publisher-policy/v1.json`, has an `id` (`dpp.publisherpolicy.v1`), a `parity_class` and a `vectors` array.
- Each vector has `id`, `description`, `input`, `expected` and `tags`. Most files tag positive cases `happy-path` and refusals `error-case`. Publisher policy and evidence packages use `valid` and `refusal`. Some earlier files omit tags, including the EPCIS event hash and parked event credential. Read the expected result for every case.
- Binary values are lower-case hex under keys ending `_hex`.
- A refusal in `attestation-anchor/v1.json` expects `{ "accepted": false }`.
- Vector identifiers are permanent while their file is published: a corrected expectation is a new vector, and the old one is marked skipped with a reason. A runner runs no skipped vector. A file retired whole takes its identifiers with it, and they are not reused.

Until 12 November 2026 the record, chain, historical anchor, acceptance and registration files were also published in the vector form. Those copies restated the top-level files and were removed. The [fixture guide](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/fixtures/README.md) lists the synthetic test private keys they published, so that a writer reproduces every pinned byte, and says how to build the four historical anchor refusals only `anchor/v3.json` carried.

Optionally check the vector structure with the stack runner:

1. From the prepared `ts-stack` checkout, run `node conformance/runner/src/runner.js --validate-only --vectors <this repository>/fixtures/vectors`, substituting this repository's path.
2. Expect exit 0 for well-formed vector files ([vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md)). This checks structure, not your implementation's answers. Run your harness separately.

## Parked: the worked example

The programme's Python reader, written from the specification, was parked on 12 November 2026 with its last passing revision: [parked material](../reference/parked/python-reader/README.md). It reads the fixtures as they stood at that revision, so use it as an example of rules becoming code, not as a check of your results.

## Source definitions

| Need | Source |
|---|---|
| Fixture inventory and generation policy | [Fixture guide](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/fixtures/README.md) |
| Baseline role and test selection | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/conformance/baseline-native-2.json) |
| Cross-language vector format | [Vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md) |
| Interoperability vectors | [Interoperability fixture guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/README.md) |
| Record bytes and signing | [Record model](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/record-model.md), [version 2](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md) |
| Native claims and anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/rules.md) |
| Acceptance and portable evidence | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/managed-custody.md), [portable evidence](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md) |
| The report | [Verification](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/contracts/verification-report.schema.json) |

## Source gaps

Record the input, both readings and each observed outcome when the text, a fixture and an implementation disagree. The pre-1.0 rule in governance gives the reference implementation precedence unless the specification identifies the behaviour as a defect. After publication the normative specification, contracts and fixtures govern. Record unresolved cases and follow the disagreement process. [Governance](https://github.com/bsv-blockchain/dpp/blob/155a71df1132e53ef78ce9e4f8f77f25f76a8eea/GOVERNANCE.md#what-is-normative), [reporting a disagreement](../contribute/disagreements.md), [known limitations](../operate/limitations.md).

Next: the [passport reader](roles/passport-reader.md) guide, then [report your results](reporting.md).
