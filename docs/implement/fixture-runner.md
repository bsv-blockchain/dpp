# Run the fixtures

A fixture records inputs and expected results. Load the selected files through a harness written for the implementation under test. Keep its assertions separate from any driver that calls a reference service.

## Build a small test loop

A signing preimage is the exact byte sequence supplied to the signing operation. Reproducing it catches errors that decoding fields alone cannot reveal.

Start with the JSON fixtures at the repository root. The harness reads an input, calls the implementation under test and compares its output with the fixture expectation. It does not call the reference verifier to decide what the answer should be.

| Fixture | First comparison |
|---|---|
| `record-v2.json` | Decode the locking script, reproduce the actor and publisher preimages, and verify the signatures. |
| `chain-v2.json` | Read `states[].rawTx`, construct the history and evaluate each refusal with the prefix and policy it names. |
| `attestation-anchor-v1.json` | Compare the signed claim, exact secured bytes, digest and anchor checks. |
| `evidence-v2.json` | Materialise each case's evidence, subject and policy, inject the fixture's `checkedAt`, then compare the report. |

For chain refusals, `appendAfter` identifies the last retained valid state before the refusal transaction. Preserve each case's policy options; some inputs are accepted under a different profile or authority selection. Include those control cases so the harness does not merely reject everything.

## Inspect the report cases

This lists the cases without executing verification:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
for (const item of fixture.cases) console.log(item.id, item.description)
JS
```

Run the [reference reader exercise](../quick-start.md#reader-and-verifier) to see the reference's results. Use the fixture's expected report in the independent harness. A field mismatch should identify the case, JSON path and both values, with unknown checks retained.

Add historical, mixed-version and selected interoperability cases after the native path works. Keep the fixture time fixed; it is synthetic test input, not a delivery date.

## Source definitions

| Need | Source |
|---|---|
| Fixture inventory and generation policy | [Fixture guide](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/README.md) |
| Baseline role and test selection | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/baseline-native-2.json) |
| Cross-language vector format | [Vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md) |
| Interoperability vectors | [Interoperability fixture guide](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/vectors/dpp/interoperability/README.md) |
| Record bytes and signing | [Record model](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md), [version 2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md) |
| Native claims and anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md) |
| Acceptance and portable evidence | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/managed-custody.md), [portable evidence](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/portable-evidence.md) |

Read each fixture's own inventory. The top-level and vector forms do not have a one-to-one file mapping. Report each executed case, including refusals; [reporting](reporting.md) links the result back to the selected requirements.

## Source gaps

| Gap | Sources requiring reconciliation |
|---|---|
| The native mapping paragraph mentions a payload absent from the allowed claim fields | [Rules](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md#L33-L66), [validator](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-core/src/attestation.ts#L35-L54) |
| Canonical key ordering differs between text and implementation | [Native text](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md#L66), [managed-custody text](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/managed-custody.md#L39), [canonicaliser](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-core/src/canonicalJson.ts#L24-L36) |
| Pre-1.0 precedence needs a consistent reading | [Governance](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md), [record-model status](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md#L3) |
| Expected-subject prose forbids evidence-derived identifiers; its table includes a `none` fallback | [Report source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md#L27-L34), [registry fallback](https://github.com/bsv-blockchain-demos/uora-bsv/blob/07236cf753a238ab7ae3f5dd0c12efe236d6e9f1/src/credentials/report.ts#L270-L274) |

These gaps remain open. Record an affected case as unresolved and use [the disagreement route](../contribute/disagreements.md); a passing reference result does not close the question.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
