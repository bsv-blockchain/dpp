# Conformance: layers, roles, the baseline and the ledger

**Status: working draft, pre-1.0.** This document says how the standard is organised for the people who have to implement it: which of its statements are rules and which are one build's choices, which role each rule binds, what one complete recommended path looks like, how an implementation declares what it supports, and how a claim of conformance is made and checked. The other normative documents define the rules themselves; this one defines what it means to say a component follows them.

## 1. Four layers

Every statement in `spec/`, `contracts/` and `fixtures/` belongs to exactly one layer, and the ledger of §6 records which.

| Layer | What it fixes | Example |
|---|---|---|
| **Core** | Record encodings, signing and commitment rules, transition meaning, verification behaviour and refusal. Two conforming implementations given the same supplied evidence, declared policy, observation time and trust inputs MUST reach equivalent findings. | The fourteen fields and their bounds; the two signature preimages; the anchor's nine framed fields; the sixteen checks of the verification report |
| **Role** | What one implementation role owes: its inputs, outputs and duties, independent of the other roles. | A writer verifies before it sends; a registry stores exact secured bytes; an overlay's admission is idempotent |
| **Profile** | A named, versioned selection over the core: an industry data profile, a credential-exchange profile or an operator profile. | `battery@2`; `vsc-draft-compat/0.1.0`; the owner-signed transfer |
| **Reference** | How this repository's implementation and the deployment beside it happen to do it. Informative, replaceable, and never a requirement by virtue of being the default. | Wallet basket names, satoshi values, MongoDB, the hosted index's URL, managed signing with operator-paid fees |

BSV is the intentional native binding of the core: token states are BSV outputs and anchors are BSV outputs, and that is a scope decision, not a reference default. Hosting, database, user interface, account provider, funding source and key custody are reference or profile matters, and none becomes a universal requirement because the reference implementation made a choice.

## 2. Six roles

An implementation claims conformance role by role. One program may fill several; a claim for one says nothing about the others. Each role has a bounded contract, prerequisites, a smallest implementation path and a test target, and the ledger names the requirements that bind it.

| Role | Responsibility | Prerequisites | Smallest path | Test target |
|---|---|---|---|---|
| **Passport reader** | Decode and verify supplied token history and report the scope of the finding | Transaction bytes; a header source or the explicit decision to skip inclusion | `examples/verify-passport.mjs --fixture`: no account, no wallet, no other role | `fixtures/record-v1.json`, `fixtures/chain-v1.json`, the token checks of `fixtures/evidence-v1.json` |
| **Attestation verifier** | Verify supplied claim signatures, anchor attribution, digest and metadata binding, and the selected authority and status evidence, reporting what could not be checked | Claims and anchor bytes; the policy naming trust inputs | `examples/verify-attestation-anchor.mjs`; the anchor cases of the report fixture | `fixtures/attestation-anchor-v1.json`, the anchor and claim cases of `fixtures/evidence-v1.json` |
| **Passport writer** | Construct valid states and discharge the broadcast, serialisation, announcement, proof and retention duties of [`writing.md`](writing.md) | A BRC-100 wallet with funds, or a co-funding publisher; the selected service adapters | `examples/write-passport.mjs`: one wallet under possession | The dry run CI runs; writer conformance is self-reported one sentence per rule ([`../GOVERNANCE.md`](../GOVERNANCE.md)) |
| **Attestation issuer** | Sign attributable lifecycle claims under the declared format and profile | The signing capability the format requires, and retained evidence; never a passport token spend | `signLifecycleClaim` against the anchor fixture's claim | `fixtures/attestation-anchor-v1.json` |
| **Registry** | Apply declared intake and status policies; retain and return exact secured bytes and scoped verification reports | The registry contract; the anchoring and issuer roles declared separately when performed | [`../contracts/registry.yaml`](../contracts/registry.yaml) | The registry's contract suite and the shared anchor fixture |
| **Overlay** | Admit and serve evidence under published policy, including the selected synchronisation profile | The overlay contract; no requirement to provide the consumer application | [`../contracts/overlay.yaml`](../contracts/overlay.yaml) as `@bsv/dpp-overlay-topics` serves it | The overlay suite, the anchor fixture, the vector runner |

The reader quick start MUST work with the fixtures alone: no account, no personal wallet, no deployed role. Reading private evidence and making current online observations are separate capabilities with their own prerequisites, and a reader that lacks them reports `unknown`, not a pass.

## 3. The recommended baseline

[`../conformance/baseline-native-1.json`](../conformance/baseline-native-1.json) is `native-baseline@1`: one complete recommended selection of the current native formats, so an implementer has one path to follow and no format to guess. It names the exact wire versions (record `dpp`/`1`, native claim `dpp-lifecycle-v1`, anchor `bsv-attestation-anchor-v1`), the representations and media types, the four BRC-42 derivations, the refused and historical formats, the reason-code vocabulary the report uses, the fixtures with their digests, the requirement each role must satisfy, and the dependency versions the reference implementation was tested against. It is a conformance and documentation selection, not a new on-chain format: nothing in it changes a byte.

A component claiming a role under the baseline MUST implement that role's mandatory requirements as the baseline lists them. It need not implement any other role, and it need not implement an industry, exchange or operator profile to claim the baseline. Selecting the baseline never revives a refused format: `uora-anchor-v2` stays refused, and `uora-anchor-v3`, `tm_uora_dpp` and `ls_uora_dpp` stay historical.

## 4. Profiles and capabilities

A profile is bounded and versioned. It MUST name its use case, the baseline and roles it requires, its dependencies, the combinations it is incompatible with, the options it selects and the acceptance vectors that exercise them. Industry profiles select fields, units, evidence and access rules; exchange profiles select credential formats, schemas and proof suites; operator profiles select admission, discovery, synchronisation and retention. A change that alters interoperability or the meaning of a verification is a new profile version; a state issued under a version is read under that version for as long as it exists. Where one named, tested choice would do, a profile makes it rather than adding a switch, because every switch multiplies the combinations nobody tested.

An implementation declares what it supports in a capability document conforming to [`../contracts/capabilities.schema.json`](../contracts/capabilities.schema.json): its roles, protocol versions, exact profile identifiers with the digests of their artefacts, representations, proof suites, anchor formats, topics and services, service limits, and what it explicitly does not support. A capability document is a claim of support, checkable against the ledger; it is not proof of authority or of conformance. Two parties select a profile only where both support it and policy permits it. An unsupported required proof, profile or interpretation-changing extension produces a named result (`representation-unsupported`, `suite-unsupported`, `not-selected`) and blocks whatever depended on it; it never silently degrades to a weaker check.

## 5. Identity vocabulary

The standard does not define an application account as a person, brand, organisation, wallet, DID or controller, and does not require a one-to-one mapping among any of them. Normative text uses the following terms, scoped to the operation at hand, and a verifier MUST NOT infer authority from an account name, brand label or administrator role.

| Term | Meaning | Boundary |
|---|---|---|
| Identified entity | What an identifier names | No universal person, organisation or brand assumption; a profile may constrain the entity type |
| Record or claim subject | What a particular record or assertion is about | Not thereby the signer, the controller or an application account |
| Actor or issuer | The entity acting or asserting, as bound to the signing evidence | Permission, and any represented party, need the selected authorisation evidence |
| Signing key | The key a signature verifies against, including its required derivation | A key's existence or account association proves neither legal identity nor authority |
| DID controller | The entity authorised to control a DID under its method | Method-specific powers; not automatically the subject, the account administrator, the token owner or the platform |
| Key custodian | The party holding or operating a role's signing keys | Custody and the identity the key represents are separate facts |
| Service operator | The party running a wallet service, registry, overlay or other component | Hosting or funding grants no control of other identities and no permission to issue for them |

Sole control, shared control, joint approval and recovery are defined by the selected method or profile's explicit authorisation rules: who can create, update, rotate, deactivate, sign, delegate and recover, with thresholds and effective times. A list of controllers is not a threshold. No rule mandates platform co-control, and no deployment claims sole control while a platform retains independent update authority. One account administering several identities, one identity reached through several authorised accounts, and an automated actor with no account at all are all permitted application arrangements, and none of them supplies a missing normative identity rule.

## 6. The ledger and the claim gate

[`../conformance/manifest.json`](../conformance/manifest.json), validated by [`manifest.schema.json`](../conformance/manifest.schema.json), is the requirement ledger. Every row names a requirement by `id`, its `sourceUri`, `sourceVersion` and `sourceDigest` where an artefact exists, its `clause`, its `layer` (§1) and the `roles` it binds (§2), its `applicability` and `profileId`, the `implementationRefs`, `testRefs` and `evidenceRefs` that show it met, its `status`, and `reviewedAt` and `reviewOwner`. `status` is exactly one of `unassessed`, `not-applicable`, `gap`, `implemented`, `tested` or `independently-tested`, and it means what it says: `tested` is this repository's suite; `independently-tested` is an implementation by another implementing party that imports none of this repository's code for the property. A second implementation written within this programme, such as the Python reader under `conformance/independent/`, is engineering evidence that the specification suffices to reproduce the bytes, and it is recorded as such; it does not move a row to `independently-tested`.

A claim is a named set of rows. A claim can be made only when none of its required rows is `unassessed`, and the checker at [`../conformance/check.mjs`](../conformance/check.mjs) refuses otherwise, one sentence per blocked row and never a score. A source whose recorded digest no longer matches its artefact invalidates every row that cites it until the mapping is reviewed again, so a moved file or a revised upstream document can never carry an old assessment forward silently.

Standards conformance, implementation conformance, deployed operation and product-data compliance are separate claims with separate rows. The reference application may truthfully demonstrate an exchange format before it qualifies a regulated product, and the ledger keeps the two apart. Licensed texts are not reproduced: a requirement whose source clause could not be read is `unassessed` with the reason recorded, and no clause number is invented from a catalogue summary. The Commission's harmonised-reference marker attaches only to the standards its decision actually cites, and product-category applicability is a separate row reviewed against the legal instrument and its date.

## 7. Sources, names and formats

Every external document the ledger cites is pinned by version and, where an artefact can be retrieved, by digest. Group attribution is recorded separately from protocol identity: a Community Group's merger or a moved page changes neither a wire contract nor a conformance meaning. Where two upstream documents conflict, the ledger records both and the interpretation selected here, and any claim whose required semantics remain unresolved is withheld. A human-readable name may explain a function; it never renames a format, and optional support for a specification still requires every mandatory rule of the selected clauses.

## 8. Normative and implementation

What a conforming party reproduces: the layer of every rule it claims (§1); the role contract it claims (§2), including the fixture-only reader quick start; the baseline's mandatory subset for the role, where it claims the baseline (§3); a capability document that says what it supports and what it does not (§4); the identity vocabulary in its own normative material (§5); and a claim that names its rows and passes the gate (§6). What is a build's own: how it organises its code, which of the other roles it also fills, which profiles it selects, and how it presents the ledger to its readers.
