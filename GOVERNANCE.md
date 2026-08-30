# How this standard changes

**Status: second draft.** This file exists because a standard without a written change process is an implementation with ambitions. It grew from a first draft that named only the maintainer; this draft names the roles, the acceptance rules, and what declaring version 1.0 requires, while staying deliberately modest: the process is sized for the contributor base that exists, and it is written down so that growing it is an edit here rather than an argument elsewhere.

## What is normative

Once published, the contents of `spec/`, `contracts/` and `fixtures/` are normative: an implementation conforms to them or it does not. Everything else in this repository, the reference implementation included, is one way of building what the specification requires, and where the two disagree the specification wins once it is published. While the draft is pre-1.0, the reference implementation is the tiebreaker, because it is the thing that runs; the one exception is a defect the specification names as a defect, which is a defect and not licence.

## Roles

- **Maintainers** accept changes. While the repository is private, the maintainer is the BSV Association. When the repository opens, the maintainers are the people named in `MAINTAINERS.md`, and adding one is itself a change under this process.
- **Implementing parties** run a conforming implementation against real records. Today there are two: the reference implementation in this repository and the attestation registry maintained by a second party. A wire shape that both must produce identically is not settled until both have accepted it in writing, and the specification says so where it applies.
- **Contributors** propose changes. Anyone may.

## Versioning

The core standard versions as a whole and is pre-1.0: breaking changes are expected, recorded in `CHANGELOG.md`, and not apologised for until 1.0 is declared. Wire formats also carry their own version identifiers (the record's `version` field, the anchor's prefix), and a layout change is a version change of that identifier, never a silent revision: a reader meeting an identifier it does not know refuses rather than guesses. Industry data profiles version independently of the core standard (a profile change does not bump the standard, and the reverse), and a profile's canonical definition lives in this repository from the moment it joins.

## Proposing a change

1. Open an issue describing the gap or the defect: what an implementer cannot do, or what two conforming implementations would disagree about.
2. A change lands as a pull request against the normative text, carrying its rationale in the document where the rule lives, not only in the request. A change to a settled design decision engages the reason `spec/design-rationale.md` records, not just the rule.
3. A change to a wire format or an on-chain layout must update the fixtures in the same request, in both their forms, so the suite and the text cannot drift apart, and it must add the refusal vectors the new rule implies, because a fixture that only accepts certifies nothing.
4. A change that alters what an already-published record means is not a change; it is a new version identifier, and the old records keep verifying under the old one.

## Accepting a change

- Editorial changes (wording, structure, corrections that alter no rule) need one maintainer.
- Normative changes need one maintainer and, where the change touches a wire shape both implementing parties produce, the written acceptance of each implementing party, recorded in the pull request.
- Changes to this file need every maintainer.
- Continuous integration must pass: the reference suites, the fixture-consistency checks, and the image build. A red suite is a veto no reviewer can override.
- Silence is not acceptance. A request with no maintainer response in thirty days is closed with a note saying so, and may be reopened.

## Declaring version 1.0

Version 1.0 is declared when all of the following hold, checked in the open and recorded in the changelog:

1. Every wire shape the specification defines has been accepted in writing by every implementing party.
2. At least two independent implementations, neither importing the other, pass every fixture in `fixtures/` including every refusal vector.
3. No open issue names a disagreement between two conforming implementations.
4. The specification records no known defect in the reference implementation under the pre-1.0 tiebreaker.
5. The maintainers say so, unanimously, in a pull request that changes the status line of every normative document.

After 1.0, a breaking change to a wire format is a new version identifier and a changelog entry under a new major version; the old identifier is never reused and its rules are never edited.

## Reporting a security problem

A defect that lets a non-conforming record verify, a forged anchor be attributed, or private content reach the chain is reported privately to the maintainers before it is filed publicly, and is fixed with a fixture that refuses it. The report and the fix are made public together.

## Conformance reporting

Conformance checks answer separately, each in its own sentence, including the zeros. There is no aggregate verdict and no score: a report that says "12 of 13" invites exactly the argument a conformance suite exists to end.

A writer's behaviour has no byte vector: nothing in `fixtures/` can certify that a state was checked before it was sent or that its proof was kept. Writer conformance is therefore self-reported against the rules `spec/writing.md` §11 lists, one sentence per rule and in the same style, and a report that passes every fixture says nothing about the writer until those sentences stand beside it.
