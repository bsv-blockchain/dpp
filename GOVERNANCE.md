# How this standard changes

**Status: first draft.** This file exists because a standard without a written change process is an implementation with ambitions. It is deliberately modest and will grow with the contributor base rather than ahead of it.

## What is normative

Once published, the contents of `spec/`, `contracts/` and `fixtures/` are normative: an implementation conforms to them or it does not. Everything else in this repository, the reference implementation included, is one way of building what the specification requires, and where the two disagree the specification wins once it is published. While the draft is pre-1.0, the reference implementation is the tiebreaker, because it is the thing that runs.

## Versioning

The core standard versions as a whole and is pre-1.0: breaking changes are expected, recorded in the changelog, and not apologised for until 1.0 is declared. Industry data profiles version independently of the core standard (a profile change does not bump the standard, and the reverse), and a profile's canonical definition lives in this repository from the moment it joins.

## Proposing a change

1. Open an issue describing the gap or the defect: what an implementer cannot do, or what two conforming implementations would disagree about.
2. A change lands as a pull request against the normative text, carrying its rationale in the document where the rule lives, not only in the request.
3. A change to a wire format or an on-chain layout must update the fixtures in the same request, so the suite and the text cannot drift apart.
4. Acceptance is by the maintainers. While the repository is private, the maintainer is the BSV Association; the intent is a broader acceptance process as implementers join, and this file is where that process will be written down.

## Conformance reporting

Conformance checks answer separately, each in its own sentence, including the zeros. There is no aggregate verdict and no score: a report that says "12 of 13" invites exactly the argument a conformance suite exists to end.
