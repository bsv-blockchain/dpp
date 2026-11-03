# How the standard changes

Anyone proposing a rule, interface, fixture, profile or documentation change can use this page to prepare an issue and pull request for review. Follow the steps and acceptance rules below; [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/GOVERNANCE.md) is the governing text.

## Prerequisites and reporting route

| Work | Required input and source |
|---|---|
| Public issue or pull request | A GitHub account and a concrete gap or defect from your implementation or reading. |
| Local changes and checks | Your fork of the repository, a branch from `main`, Node.js 22 or later, npm and git. Use the [source-access instructions](../packages/README.md#source-access); install and build with `npm ci` and `npm run build` before checking. |
| Disagreement | Reproducing input and both results, prepared through [report a disagreement](disagreements.md). |

**A security problem is never a public issue or pull request.** Report it privately through a [GitHub security advisory](https://github.com/bsv-blockchain/dpp/security/advisories/new) or by email to `security@bsvassociation.org`, as the [security policy](https://github.com/bsv-blockchain/dpp/security/policy) describes. If unsure, report privately.

## Propose a change

1. **Open an issue** in the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues). Describe what an implementer cannot do, or what two conforming implementations would disagree about.
2. **Fork the repository and branch from `main`.** In your local fork, use `git checkout main`, record the starting revision with `git rev-parse HEAD`, then create your working branch from that revision. Edit the material that owns the change:

| Material | Location |
|---|---|
| Rules and rationale | `spec/`; put rationale beside the rule, not only in the pull request. A settled design change must answer the reason in [`spec/design-rationale.md`](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/design-rationale.md). |
| Interfaces | `contracts/` |
| Expected bytes | `fixtures/` |
| Evidence | The ledger |
| Changed behaviour guide | `docs/` |

3. **Update fixtures with any wire-format or on-chain layout change.** Include both fixture forms and the refusal vectors the rule implies in the same pull request. Changing an already-published record's meaning requires a new version identifier; old records keep verifying under the old one.
4. **Run the checks** below from the checkout root.
5. **Open a pull request against `main`** on [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp). Link the issue and include the review evidence below.

### Run the checks for the change type

| Change or check | Command | Expected result |
|---|---|---|
| Implementation | `npm run typecheck` and `npm test` | Passing type checks, package suites, conformance tests, conformance check and documentation check. |
| Documentation only | `npm run docs:check` and `npm run conformance:check` | Passing documentation and ledger checks. The ledger also pins `docs/quick-start.md`. |
| While a changed source pin awaits review | `npm run test --workspaces` and `npm run docs:check` | Checks of package behaviour and documentation links. Conformance tests still enforce source pins. |

A changed pinned source deliberately fails the conformance check: the ledger records every assessed source's digest. Stop for a reviewer to confirm the assessment still holds. Do not re-pin your own change unless asked; the reviewer runs `node conformance/pin-sources.mjs` after review.

## What reviewers need

- Concrete input or workflow the current material cannot handle. For behaviour changes, include the existing and intended results, affected clauses and a reproducible case.
- Edits in the material that owns them. Wording changes must not silently choose a different implementation rule.
- Operational consequences alongside API changes: workflow trigger, tooling responsibilities, application-owner work, readiness evidence and remaining limits. Profile changes cover notification, interface and backend changes, activation and history ([consumer adoption](../profiles/updating-applications.md)).
- Actual implementation test output retained as [reporting](../implement/reporting.md) describes.

## How a change is accepted

| Change or condition | Required acceptance or outcome |
|---|---|
| Editorial, altering no rule | One maintainer. |
| Normative | One maintainer; where it touches a wire shape both implementing parties produce, each party's written acceptance in the pull request ([implementing parties](implementing-parties.md)). |
| GOVERNANCE.md | Every maintainer. |
| Continuous integration | Reference suites, fixture-consistency checks and image build must pass. A red suite is a veto no reviewer can override. |
| No maintainer response in thirty days | Close with a note; the pull request may be reopened. Silence is not acceptance. |

GOVERNANCE.md names the BSV Association as maintainer. Address maintainers through the issue or pull request; adding one follows the governance change process. Before version 1.0, the reference implementation breaks a tie with the specification, except for a defect the specification names.

## Other routes

| You want to | Go to |
|---|---|
| Report a result that contradicts a fixture or the specification | [Report a disagreement](disagreements.md) |
| Propose product or exchange data | [Author a profile](../profiles/authoring.md) |
| Take part as an implementing party, or exchange records with the hosted reference | [Implementing parties](implementing-parties.md) |
| Ask about reuse or the licence | [Licence and reuse](licence.md) |
| Ask the programme anything else | The [BSV Association contact form](https://bsvassociation.org/contact/) |

The [conformance specification](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/conformance.md) defines how evidence supports a claim; [conformance and the ledger](../reference/conformance.md) shows how to check one.
