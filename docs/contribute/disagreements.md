# Report a disagreement

Retain the source revision, selected role and profile, input, actual result, expected result and the clause supporting each reading. Link an existing fixture where possible; keep a new failing case with the report.

## Make the report actionable

Include the command needed to reproduce the result and the smallest input that still shows the disagreement. For a fixture case, name the file and case identifier rather than pasting a large transaction into prose. For new evidence, retain its original bytes and digest with the report.

State what the result affects: decoding, signatures, subject binding, a transition, a service response or an evidence claim. Distinguish an implementation failure from an ambiguity in the source. An unresolved ambiguity stays open even if one implementation currently accepts the input.

Use the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues) for a non-sensitive technical report. Repository access may be required. The [BSV Association contact page](https://bsvassociation.org/contact/) provides technical support links and a general contact form if repository access is unavailable.

For a security problem, or anything you are unsure about, report privately and never in an issue. The [security policy](https://github.com/bsv-blockchain/dpp/security/policy) names the two private routes, a GitHub security advisory and the security email address, and says what to include.

The [fixture guide](../implement/fixture-runner.md#source-gaps) lists source questions still open. The [pre-1.0 governance text](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/GOVERNANCE.md) and [record-model status](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md#L3) remain the references for precedence. Their interpretation remains open.
