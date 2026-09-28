# How the standard changes

Use [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/GOVERNANCE.md) for change acceptance, version declarations and dispute resolution. The [conformance source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/conformance.md) defines how evidence supports a claim.

## Prepare a reviewable change

Describe the concrete input or workflow the current material cannot handle. For a behaviour change, include the existing result, intended result and affected source clauses. Add a reproducible case so reviewers can evaluate the difference.

Keep edits in the material that owns the change: rules in the specification, interfaces in contracts, expected bytes in fixtures, and evidence in the ledger. Update the guide that explains how the changed behaviour is used. A wording change should not silently select a different implementation rule.

Explain the operational consequences as well as the API change: what triggers the workflow, what the tooling handles, what an application owner must implement, how readiness is demonstrated and which limitations remain. For profile changes, use [the consumer adoption guide](../profiles/updating-applications.md) to cover notification, UI/backend changes, activation and history.

Run the checks relevant to the change. For documentation, `node scripts/docs-check.mjs` checks navigation and references. For implementation evidence, retain the actual test output and use [reporting](../implement/reporting.md). Submit the proposed diff through the repository's review process.

A change to a specification, contract or fixture makes `npm run conformance:check` fail on purpose: the ledger records the digest of every source an assessment was made against, and a moved source stops the check until a reviewer confirms the assessment still holds. Do not re-pin in your own change unless a reviewer asks; the reviewer runs `node conformance/pin-sources.mjs` after review.

## Choose the contribution route

| Contribution | Guide |
|---|---|
| Reuse or licence question | [Licence and reuse](licence.md) |
| Participate as an implementing party | [Implementing parties](implementing-parties.md) |
| Propose product or exchange data | [Author a profile](../profiles/authoring.md) |
| Report a contradictory result | [Disagreements](disagreements.md) |

Companion profile submission: open. Whether to propose the anchoring profile as a formal companion document is undecided; it does not affect implementations.

The [disagreement guide](disagreements.md) supplies the technical and private-contact routes. General participation enquiries can start at the [BSV Association contact page](https://bsvassociation.org/contact/).
