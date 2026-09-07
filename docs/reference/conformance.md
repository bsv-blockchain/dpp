# Conformance and the ledger

Use the [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) to trace a claim to its source, implementation, tests and retained evidence. The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.schema.json) defines its fields and statuses. The [conformance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) and [governance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md) define the assessment rules.

## What each check answers

The ledger connects a requirement to the source, code, tests and retained evidence supporting it. A baseline selects requirements for a role. A release selection chooses which claims the candidate requires and which it withholds.

`conformance/check.mjs` checks consistency of that material, including recorded source digests. `conformance/qualify.mjs` evaluates a named selection against the ledger. Neither command substitutes for running a new implementation's tests.

For example, a selected release gate can pass while independent operation remains withheld. Read the withheld list as part of the result. A source digest mismatch means the ledger and file differ; it does not by itself establish that the changed file is right or wrong.

## Run the checks

Use the commands below from the [prepared checkout](../quick-start.md#prepare-the-checkout). Each exits non-zero when its checks fail and prints the affected findings. Fix or explain those findings before reporting the selected claim. Keep the command, source revision and output with the [implementation evidence](../implement/reporting.md).

## Source material

| Review task | Source |
|---|---|
| Find a role's selected requirements | [Native baseline](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/baseline-native-2.json) |
| Inspect claims required or withheld by the release | [Release selection](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/selections/dpp-release-2026-09-3.json) |
| Check material consistency | [Diagnostic](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/check.mjs) |
| Evaluate a selection | [Qualification gate](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/qualify.mjs) |

From the repository root:

```sh
node conformance/check.mjs
node conformance/qualify.mjs conformance/selections/dpp-release-2026-09-3.json
```

A passing diagnostic and a passing selection answer different questions. Read each command's findings and the selection's withheld claims. Use [evidence reporting](../implement/reporting.md) for a new implementation and [status](../start/status.md) for the delivery overview.
