# Requirements and evidence reporting

Start from the implementation's selected roles, baseline and profiles. Keep the implementation revision, source bundle and shared-dependency record with the results.

## Locate the requirements

1. Open the selected role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json).
2. Follow its requirement identifiers into the [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json).
3. Follow each row's declared source, implementation, test and evidence references. Record the predicate the implementation actually executed. An absent assertion stays missing; a shared source document is not evidence that one fixture exercises every row.
4. Use the [conformance source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md) and [governance reporting source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md#conformance-reporting) to assemble the claim, capability declaration and results.

The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.schema.json) defines the status vocabulary. A reference ledger status is not the status of the implementation being reported.

Keep refusals and unresolved cases visible. For a disagreement, retain the input, both outcomes and their source references, then use [the reporting route](../contribute/disagreements.md).

[Conformance review](../reference/conformance.md) explains the diagnostic and selection gate. [The trial](demonstration.md) supplies the route for fresh-record exchange evidence.
