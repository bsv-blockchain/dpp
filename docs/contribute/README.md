# How the standard changes

Use [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md) for change acceptance, version declarations and dispute resolution. The [conformance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) defines how evidence supports a claim.

## Prepare a reviewable change

Describe the concrete input or workflow the current material cannot handle. For a behaviour change, include the existing result, intended result and affected source clauses. Add a reproducible case so reviewers can evaluate the difference.

Keep edits in the material that owns the change: rules in the specification, interfaces in contracts, expected bytes in fixtures, and evidence in the ledger. Update the guide that explains how the changed behaviour is used. A wording change should not silently select a different implementation rule.

Run the checks relevant to the change. For documentation, `node scripts/docs-check.mjs` checks navigation and references. For implementation evidence, retain the actual test output and use [reporting](../implement/reporting.md). Submit the proposed diff through the repository's review process.

## Choose the contribution route

| Contribution | Guide |
|---|---|
| Reuse or licence question | [Licence and reuse](licence.md) |
| Participate as an implementing party | [Implementing parties](implementing-parties.md) |
| Propose product or exchange data | [Author a profile](../profiles/authoring.md) |
| Report a contradictory result | [Disagreements](disagreements.md) |

Companion profile submission: open; see [D-CG1](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L184).

The [disagreement guide](disagreements.md) supplies the technical and private-contact routes. General participation enquiries can start at the [BSV Association contact page](https://bsvassociation.org/contact/).
