# The DPP standard

A digital product passport on the BSV blockchain is a chain of signed token states, one output spending the last, beside a separate rail of signed lifecycle claims anchored by digest. Anyone holding the transaction bytes, the proofs and a block header source can verify the history without an account with whoever published it. That is the whole proposition: the passport outlives its provider, and a stranger checks it from bytes.

This documentation is for the people who have to build against that: adopters consuming the reference packages, implementers reproducing the rules on their own, operators running the services, and industry contributors defining what a battery or a garment has to say about itself.

**Status: working draft, pre-1.0.** The record formats, contracts and fixtures are stable enough to implement against and are frozen into release sets, but breaking changes are still expected and recorded. No claim of European conformity, product qualification or version 1.0 readiness is made anywhere here; [where things stand](start/status.md) says what has been demonstrated, what is only implemented, and what is withheld by name.

## Choose where to start

| You want to | Start at |
|---|---|
| Understand what a passport is and how the two rails fit together | [The model in ten minutes](start/architecture.md) |
| Know which of the six roles you are implementing and what each owes | [Choose a role](start/choose-a-role.md) |
| Decide between consuming the reference packages and implementing independently | [Choose a journey](start/choose-a-journey.md) |
| Install and use the reference packages | [Use the reference packages](packages/README.md) |
| Implement the rules yourself, in any language, from the frozen bundle | [Implement independently](implement/README.md) |
| Run an index, a registry or a federation | [Operate services](operate/README.md) |
| Add or use an industry profile | [Industry profiles](profiles/README.md) |
| Discover passports through GS1, import EPCIS or verify external credentials | [Interoperability profiles](interoperability/README.md) |
| Find the normative text, a contract or a fixture | [Reference](reference/specifications.md) |

## What is where

The normative material lives in the source repository and nowhere else: `spec/` for the rules, `contracts/` for the HTTP contracts and JSON schemas, `fixtures/` for the bytes every implementation is held to, and `conformance/` for the requirement ledger and the claim gate. These pages explain, sequence and point; they do not restate a rule, and where a page and the normative text disagree the normative text wins. Every link to a normative file names the repository path, and the [reference index](reference/specifications.md) lists them all with the revision the current release set was cut from.

The reference implementation is four npm packages and one container image, released together as a [release set](reference/release-sets.md). The current set is a candidate: its packages are packed and checked but not yet published to a public registry, and the repository is private while the draft is prepared for publication.

## Two journeys, kept apart

An application that imports the reference packages is a **reference consumer**. Its success shows the packages are consumable and that compatible services can be deployed from the reference implementation. An **independent implementation** reproduces the rules from the specification, the contracts and the fixtures without importing, mirroring or calling the reference DPP logic; it may share a generic blockchain, cryptography or wallet library, and it may exchange records with a reference provider under test. Its success shows the standard works beyond its reference implementation, which is the outcome this programme still has to demonstrate. The two are documented separately because their evidence means different things, and a page in one journey never quietly borrows from the other.
