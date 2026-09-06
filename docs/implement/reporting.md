# Claims and refusal reporting

**Audience:** an implementer preparing a conformance report; a reviewer reading one. **Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md) (conformance reporting), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §2, §4, §6, [`contracts/capabilities.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/capabilities.schema.json), [`conformance/selection.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/selection.schema.json).

## One sentence per check

Conformance checks answer separately, each in its own sentence, including the zeros. There is no aggregate verdict and no score: a report that says twelve of thirteen invites the argument a conformance suite exists to end. The reference surfaces print `ok:` and `FAIL:` (or `Holds:` and `FAILS:`) followed by the sentence; use whatever prefix you like, and keep the sentence.

A report over the fixtures therefore reads as a list: one line per vector, refusals included, saying what was reproduced or refused and where. A vector the harness did not execute is a line saying so. A check that needs evidence the harness was not given is `unknown` with its reason, never a pass.

## The capability document

Before a claim, a declaration. A capability document in the shape of `contracts/capabilities.schema.json` names the roles you fill, the protocol versions and exact profile identifiers with their artefact digests, the representations, proof suites and anchor formats you support (current, historical and refused), the topics and services and limits of a service, and by name what you do not support. It is a claim of support checkable against the ledger, never proof of conformance or of authority.

## The claim

A claim names rows of the ledger. For an independent implementer the claim is: this implementation, at this revision, fills these roles under this baseline and these profiles, and its predicates executed these rows' vectors with these results. The [requirements matrix](requirements-matrix.md) is the list to fill in; a row you did not implement stays visible as not implemented, and a role you did not claim is not in the report at all.

## What the ledger will and will not record

The ledger's statuses mean what they say. Your evidence lets the maintainers record the rows you passed as passed by a second implementation; it does not move a row to `independently-tested` unless you are an implementing party other than this programme and imported none of the reference code for the property. Say which you are in the report's provenance section, and the record will say the same.

## Refusals are findings

A refusal your implementation makes that the reference does not, or the reverse, is not a failure to hide: it is the most useful thing a second implementation produces. Report it with the vector, both outcomes and the clause each reading relies on, and raise it through [reporting a disagreement](../contribute/disagreements.md). The governance process settles it with a fixture, and an unresolved one blocks version 1.0 on purpose.
