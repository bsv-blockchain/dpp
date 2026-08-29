# The services

**Status: working draft, pre-1.0.** This document is the overview of the service layer: what runs around the records, what each service is for, and the boundary the whole standard rests on. The record model and the rules define truth; services affect findability and convenience, never truth.

## 1. The principle: no service is mandatory

A passport verifies from transaction bytes and public block headers alone, and an anchor re-checks against any public copy of its transaction plus the attestation it commits to. Every service described here can be down, wrong or hostile without changing what a verifier can believe, and a conforming implementation of the standard must not make record validity depend on any of them. Services exist so records are findable and convenient, and anyone may operate them: the interfaces are published exactly so that an operator's copy and a stranger's copy are interchangeable.

Interchangeable is only true if a stranger's copy can be found. A public index SHOULD advertise the topics it runs and the lookup services it answers through the ecosystem's overlay discovery protocols, SHIP for topics and SLAP for lookup services, so that a reader who knows only a service name finds every host that serves it and a writer who knows only a topic reaches every index that admits it; a reader MAY pin a known host instead. The discovery mechanism is the ecosystem's and is not redefined here.

## 2. The index

An overlay service watching the chain for outputs that follow this standard's rules and keeping them findable. It runs both rails: a passport topic admitting record states (admission applies the record model's decode rules and invariants) and an anchor topic admitting anchor outputs (admission applies the anchor's field rules, its signature over the length-delimited preimage, and the locking derivation). Its wire is the ecosystem's standard overlay contract, BRC-22 submission and BRC-24 lookup, and [`../contracts/overlay.yaml`](../contracts/overlay.yaml) is a profile of that contract rather than a restatement: it pins only what this standard adds, the two topics and their admission rules, the two lookup services and their queries, and which upstream options an index must, should or may implement. The canonical home of a first-class topic in this ecosystem is the stack's shared topics package, and that is where these four components are meant to live, so that any overlay operator mounts them with one import; a topic's documentation, which the contract exposes to operators, is its admission rules in Markdown.

Two properties are load-bearing. Answers come back as BEEF, so a caller verifies everything an index returns against block headers: a compromised index changes what can be found, never what can be believed. And anchor admission attributes each anchor from the output's own bytes, so a shared index can carry anchors from services it has never been configured to know, and still say whose each one is.

Announcing to an index is discoverability, never existence. A record that is broadcast but not announced is less findable and no less true, and a conforming writer must not fail a record over a failed announcement. A writer MAY instead announce before it broadcasts, holding the transaction unsent until an index admits it and abandoning it otherwise: admission applies the same checks a verifier applies, so this order keeps an invalid state off the chain altogether. A writer that does so still must not read an unreachable index as a refusal; only an answer refuses.

## 3. The attestation registry

The service that stores lifecycle attestations, answers what has been attested about a passport, and writes the anchor outputs. It is the only writer in the service layer, and the anchor format is what keeps it honest: it anchors digests only, so no attestation content, and no personal data, can reach the chain through it, and everything it writes is attributable and checkable by a stranger as [`rules.md`](rules.md) defines.

The registry's query interface is maintained jointly with a second implementing party and is not yet published here; it joins [`../contracts/`](../contracts/) when the implementing parties accept it together. Until then, the registry-facing behaviour a conforming implementation can rely on is what the rules document pins: the claim shape, the canonical bytes and the anchor.

## 4. Verification surfaces

A page or tool that runs the standard's checks where the reader is, in their own browser or their own process. A published verification surface is a courtesy, never an authority: the checks are the specification's, the inputs are public, and a reader who distrusts the surface can run the same checks from the documents in this repository. A conforming surface reports per-check results, separately, in sentences, and never an aggregate verdict, the same rule GOVERNANCE fixes for conformance reporting.

## 5. Identifier resolution

Records name parties by DIDs as [`identity.md`](identity.md) defines. The offline-decodable form needs no resolver at all. Where a resolvable method is used for its key history, resolution is a third-party concern by design: the method's resolver is operated independently of any passport service, which is itself a demonstration that the service layer is not one party's stack.

## 6. What conformance means for an operator

An operator conforms by serving the published interfaces over the published rules: admission that enforces the record model and the anchor rules, answers that carry the material a caller needs to verify for themselves, and refusals rather than lenient readings for superseded formats. An operator's private policy, who may submit, what gets rate-limited, what it costs, is an operator's own business, provided it never changes what an admitted record means or lets an invalid one in. Admitting an output the index already holds is a no-op, and an index's answers are the same after any replay of its inputs: synchronisation between indexes and reorganisations both re-present outputs, and an index that appends an entry per presentation double-counts.
