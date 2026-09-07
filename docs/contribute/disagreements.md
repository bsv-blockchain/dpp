# Report a disagreement

Retain the source revision, selected role and profile, input, actual result, expected result and the clause supporting each reading. Link an existing fixture where possible; keep a new failing case with the report.

## Make the report actionable

Include the command needed to reproduce the result and the smallest input that still shows the disagreement. For a fixture case, name the file and case identifier rather than pasting a large transaction into prose. For new evidence, retain its original bytes and digest with the report.

State what the result affects: decoding, signatures, subject binding, a transition, a service response or an evidence claim. Distinguish an implementation failure from an ambiguity in the source. An unresolved ambiguity stays open even if one implementation currently accepts the input.

Use the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues) for a non-sensitive technical report. Repository access may be required. The [BSV Association contact page](https://bsvassociation.org/contact/) provides technical support links and a general contact form if repository access is unavailable.

For a security-sensitive disagreement, the [governance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md#reporting-a-security-problem) calls for private reporting. Use the contact form to request a private security-reporting channel without including exploit details. A dedicated DPP security address is not supplied by the repository.

The [fixture guide](../implement/fixture-runner.md#source-gaps) lists source questions still open. The [pre-1.0 governance text](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md) and [record-model status](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md#L3) remain the references for precedence. Their interpretation remains open.
