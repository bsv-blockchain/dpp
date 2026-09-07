# Run the fixtures

A fixture records inputs and expected results. Load the selected files through a harness written for the implementation under test. Keep its assertions separate from any driver that calls a reference service.

| Need | Source |
|---|---|
| Fixture inventory and generation policy | [Fixture guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/README.md) |
| Baseline role and test selection | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) |
| Cross-language vector format | [Vector format](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/conformance/VECTOR-FORMAT.md) |
| Interoperability vectors | [Interoperability fixture guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/vectors/dpp/interoperability/README.md) |
| Record bytes and signing | [Record model](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md), [version 2](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md) |
| Native claims and anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md) |
| Acceptance and portable evidence | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/managed-custody.md), [portable evidence](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/portable-evidence.md) |

Read each fixture's own inventory. The top-level and vector forms do not have a one-to-one file mapping. Report each executed case, including refusals; [reporting](reporting.md) links the result back to the selected requirements.

## Source gaps

| Gap | Sources requiring reconciliation |
|---|---|
| The native mapping paragraph mentions a payload absent from the allowed claim fields | [Rules](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md#L33-L66), [validator](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/attestation.ts#L35-L54) |
| Canonical key ordering differs between text and implementation | [Native text](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md#L66), [managed-custody text](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/managed-custody.md#L39), [canonicaliser](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/canonicalJson.ts#L24-L36) |
| Pre-1.0 precedence needs a consistent reading | [Governance](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md), [record-model status](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md#L3) |
| Expected-subject prose forbids evidence-derived identifiers; its table includes a `none` fallback | [Report source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md#L27-L34), [registry fallback](https://github.com/bsv-blockchain-demos/uora-bsv/blob/07236cf753a238ab7ae3f5dd0c12efe236d6e9f1/src/credentials/report.ts#L270-L274) |

These gaps remain open. Record an affected case as unresolved and use [the disagreement route](../contribute/disagreements.md); a passing reference result does not close the question.
