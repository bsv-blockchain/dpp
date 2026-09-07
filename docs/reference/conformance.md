# Conformance and the ledger

Use the [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) to trace a claim to its source, implementation, tests and retained evidence. The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.schema.json) defines its fields and statuses. The [conformance source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md) and [governance source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md) define the assessment rules.

| Review task | Source |
|---|---|
| Find a role's selected requirements | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) |
| Inspect claims required or withheld by the release | [Release selection](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/selections/dpp-release-2026-09-3.json) |
| Check material consistency | [Diagnostic](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/check.mjs) |
| Evaluate a selection | [Qualification gate](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/qualify.mjs) |

From the repository root:

```sh
node conformance/check.mjs
node conformance/qualify.mjs conformance/selections/dpp-release-2026-09-3.json
```

A passing diagnostic and a passing selection answer different questions. Read each command's findings and the selection's withheld claims. Use [evidence reporting](../implement/reporting.md) for a new implementation and [status](../start/status.md) for the delivery overview.
