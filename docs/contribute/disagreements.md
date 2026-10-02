# Report a disagreement

Use this page when your implementation and the reference implementation, a fixture or the specification give different results for the same input. It says what to record, where to send the report and what happens to an ambiguity; a security problem goes by a private route instead, below.

## What to record

Copy this into the issue and fill in every line:

```
Source revision: <commit hash of the specification and fixtures you read>
Role and profile: <for example passport reader, native-baseline@2, battery@2>
Input: <fixture file and case identifier, or the smallest input that still shows the disagreement>
Command: <the command that reproduces your result>
Actual result: <what your implementation produced>
Expected result: <what the reference, the fixture or the text says>
Clauses: <the clause supporting each reading>
Affects: <decoding, signatures, subject binding, a transition, a service response or an evidence claim>
Kind: <an implementation failure, or an ambiguity in the source>
```

For a fixture case, name the file and case identifier rather than pasting a large transaction into prose. For new evidence, keep its original bytes and their digest with the report, and keep any new failing case beside it. An unresolved ambiguity stays open even if one implementation currently accepts the input.

## Where to send it

- **A technical report** goes to the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues). A GitHub account is enough: the repository is public and its issues are open.
- **A security problem, or anything you are unsure about,** is reported privately and never in an issue: through a [GitHub security advisory](https://github.com/bsv-blockchain/dpp/security/advisories/new) or by email to `security@bsvassociation.org`. The [security policy](https://github.com/bsv-blockchain/dpp/security/policy) says what to include and what not to send.
- **Without repository access**, the [BSV Association contact page](https://bsvassociation.org/contact/) has technical support links and a general contact form.

## Which reading wins

Before version 1.0, where the specification and the reference implementation disagree, the reference implementation breaks the tie, except for a defect the specification itself names as a defect ([governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#what-is-normative), and the [record model's status line](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md#L3)). How that rule applies to a particular disagreement is still open, so a report records both readings and does not assume either. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists the source questions already known to be open.

Next: if the disagreement comes from running the fixtures against your own implementation, keep the evidence as [reporting](../implement/reporting.md) describes.
