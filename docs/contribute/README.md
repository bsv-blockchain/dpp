# How the standard changes

This page is for anyone who wants to change the standard: a rule, an interface, a fixture, a profile or the documentation. It gives the steps from an issue to a merged pull request, what reviewers need from you and how a change is accepted; [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md) is the governing text.

**A security problem is never a public issue or pull request.** Report it privately through a [GitHub security advisory](https://github.com/bsv-blockchain/dpp/security/advisories/new) or by email to `security@bsvassociation.org`, as the [security policy](https://github.com/bsv-blockchain/dpp/security/policy) describes. If you are unsure whether something counts, report it privately.

## Propose a change

1. **Open an issue** in the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues) describing the gap or the defect: what an implementer cannot do, or what two conforming implementations would disagree about. A GitHub account is enough. For a result that contradicts a fixture or the specification, use [report a disagreement](disagreements.md).
2. **Fork the repository and branch from `main`.** Edit the material that owns the change: rules in `spec/`, interfaces in `contracts/`, expected bytes in `fixtures/`, evidence in the ledger, and the guide in `docs/` that explains the changed behaviour. Put the rationale in the document where the rule lives, not only in the pull request. A change to a settled design decision answers the reason [`spec/design-rationale.md`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/design-rationale.md) records.
3. **Change the fixtures with any wire change.** A change to a wire format or an on-chain layout updates the fixtures in the same pull request, in both their forms, and adds the refusal vectors the new rule implies. A change to what an already-published record means is not an edit: it is a new version identifier, and the old records keep verifying under the old one.
4. **Run the checks** from the root of your checkout, after `npm ci` and `npm run build`: `npm run typecheck` and `npm test`. `npm test` runs the package suites, the conformance tests, the conformance check and the documentation check. For a documentation-only change, run `npm run docs:check` and `npm run conformance:check`: the ledger also pins `docs/quick-start.md`. A change to a pinned source makes the conformance check fail on purpose: the ledger records the digest of every source an assessment was made against, and a moved source stops the check until a reviewer confirms the assessment still holds. Do not re-pin in your own change unless a reviewer asks; the reviewer runs `node conformance/pin-sources.mjs` after review. Until then, `npm run test --workspaces` and `npm run docs:check` check package behaviour and documentation links; the conformance tests also enforce the source pins.
5. **Open a pull request against `main`** on [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp), linking the issue and carrying what reviewers need, below.

## What reviewers need

- The concrete input or workflow the current material cannot handle. For a behaviour change, the existing result, the intended result and the affected clauses, with a reproducible case.
- Edits kept in the material that owns them. A wording change must not silently select a different implementation rule.
- The operational consequences as well as the API change: what triggers the workflow, what the tooling handles, what an application owner must implement, how readiness is shown and which limitations remain. For a profile change, cover notification, interface and backend changes, activation and history, as [the consumer adoption guide](../profiles/updating-applications.md) describes.
- For implementation evidence, the actual test output, kept as [reporting](../implement/reporting.md) describes.

## How a change is accepted

- An editorial change, one that alters no rule, needs one maintainer.
- A normative change needs one maintainer and, where it touches a wire shape both implementing parties produce, the written acceptance of each implementing party, recorded in the pull request ([implementing parties](implementing-parties.md)).
- A change to GOVERNANCE.md needs every maintainer.
- Continuous integration must pass: the reference suites, the fixture-consistency checks and the image build. A red suite is a veto no reviewer can override.
- Silence is not acceptance. A pull request with no maintainer response in thirty days is closed with a note saying so, and may be reopened.

GOVERNANCE.md says the maintainers are the people named in `MAINTAINERS.md`. The repository is public, but that file does not exist yet, so no list of maintainers is published; address maintainers through the issue or pull request itself. Before version 1.0, where the specification and the reference implementation disagree, the reference implementation breaks the tie, except for a defect the specification names.

## Other routes

| You want to | Go to |
|---|---|
| Report a result that contradicts a fixture or the specification | [Report a disagreement](disagreements.md) |
| Propose product or exchange data | [Author a profile](../profiles/authoring.md) |
| Take part as an implementing party, or exchange records with the hosted reference | [Implementing parties](implementing-parties.md) |
| Ask about reuse or the licence | [Licence and reuse](licence.md) |
| Ask the programme anything else | The [BSV Association contact form](https://bsvassociation.org/contact/) |

The [conformance specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) defines how evidence supports a claim, and [conformance and the ledger](../reference/conformance.md) shows how to check one.
