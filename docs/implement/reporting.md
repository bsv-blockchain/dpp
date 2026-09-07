# Requirements and evidence reporting

Start from the implementation's selected roles, baseline and profiles. Keep the implementation revision, source bundle and shared-dependency record with the results.

## Make the result reproducible

For each test, retain the requirement identifier, fixture or input digest, implementation revision, selected policy, command, expected result and actual result. A reviewer needs to rerun the same case and see which assertion supports the claimed behaviour.

For example, a passing native-signature test supplies evidence about that signature check. It does not establish issuer authority, inclusion or an independent deployment. If the run had no header source, record that absence alongside the successful checks.

Keep authored code and shared dependencies visible. Distinguish local fixture results from a fresh-record exchange with another implementation. When reporting an unresolved source conflict, include both readings and the input that makes the difference observable.

## Locate the requirements

1. Open the selected role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/baseline-native-2.json).
2. Follow its requirement identifiers into the [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json).
3. Follow each row's declared source, implementation, test and evidence references. Record the predicate the implementation actually executed. An absent assertion stays missing; a shared source document is not evidence that one fixture exercises every row.
4. Use the [conformance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) and [governance reporting source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md#conformance-reporting) to assemble the claim, capability declaration and results.

The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.schema.json) defines the status vocabulary. A reference ledger status is not the status of the implementation being reported.

Keep refusals and unresolved cases visible. For a disagreement, retain the input, both outcomes and their source references, then use [the reporting route](../contribute/disagreements.md).

[Conformance review](../reference/conformance.md) explains the diagnostic and selection gate. [The trial](demonstration.md) supplies the route for fresh-record exchange evidence.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
