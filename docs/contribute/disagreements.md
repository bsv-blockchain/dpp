# Report a disagreement

Implementers can use this page to report different results for the same input from their code, the reference, a fixture or the specification. Record reproducible evidence, choose the reporting route and retain both readings of any ambiguity.

## Before reporting

| Input | Source |
|---|---|
| Revision, role, profile and smallest reproducing input | The specification, fixtures and implementation you tested |
| Command, actual result, expected result and supporting clauses | Your reproducible run and the competing source readings |
| Public-report access | A GitHub account; the repository is public and its issues are open |
| Sensitive or uncertain report | Use the private route below; never post a security problem in an issue |

## What to record

For a public report, copy this into the issue and fill in every line:

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

| Report | Destination and boundary |
|---|---|
| Technical disagreement | [Repository issue tracker](https://github.com/bsv-blockchain/dpp/issues) |
| Security problem, or anything you are unsure about | Private [GitHub security advisory](https://github.com/bsv-blockchain/dpp/security/advisories/new) or `security@bsvassociation.org`; never a public issue |
| No repository access | [BSV Association contact page](https://bsvassociation.org/contact/), with technical support links and a general contact form |

The [security policy](https://github.com/bsv-blockchain/dpp/security/policy) specifies what to include and what not to send.

## Which reading wins

Before version 1.0, where the specification and the reference implementation disagree, the reference implementation breaks the tie, except for a defect the specification itself names as a defect ([governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#what-is-normative), and the [record model's status line](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md#L3)). How that rule applies to a particular disagreement is still open, so a report records both readings and does not assume either. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists the source questions already known to be open.

Next: if the disagreement comes from running the fixtures against your own implementation, keep the evidence as [reporting](../implement/reporting.md) describes.
