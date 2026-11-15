# EPCIS lifecycle claims: dpp-epcis-lifecycle@1

**Status: working draft, pre-1.0.** This document defines a lifecycle claim over actual EPCIS event data: one GS1 EPCIS 2.0.1 event, unchanged, inside a signed DPP envelope that binds it to the passports it concerns and states who signs it and in what role. It defines the envelope, the covered bytes and their canonicalisation, event identity, product binding, issuer authority, corrections, anchoring and the findings a verifier reports. It changes nothing about the native record, the native claim of [`rules.md`](rules.md) §3, the generic anchor of [`rules.md`](rules.md) §5 or the EPCIS source exchange of [`epcis-interoperability.md`](epcis-interoperability.md).

## 1. Scope and relation to other formats

The claim format is `dpp-epcis-lifecycle@1`, its representation identifier `dpp-epcis-lifecycle-json@1` and its media type `application/json`. A claim carries exactly one event of the five EPCIS 2.0.1 types `ObjectEvent`, `AggregationEvent`, `TransactionEvent`, `TransformationEvent` and `AssociationEvent`, selected from the facts observed and not from a workflow label or a token operation. One event per claim keeps the signature, the correction and the authority scope aligned: a claim that is withdrawn withdraws one event, and an authority that is refused is refused for one event.

The native claim `dpp-lifecycle-v1` ([`rules.md`](rules.md) §3) stays readable and verifiable under its own rules, byte for byte, and its four categories keep their historical meaning there. This format does not use them: nothing here maps a native operation or its category to an event, and a verifier dispatches by `claimFormat`, never by reinterpreting one format as the other. The parked directly signed event, `epcis-event-vc@1` ([`epcis-event-profile.md`](epcis-event-profile.md)), stays parked: this format is not a revival of it, needs no W3C Verifiable Credential, no JOSE serialisation and no CBV Event Hash ID, and shares only the strict JSON parser and the GS1 identifier helpers of its reference implementation. The envelope carries the event the way a UN Transparency Protocol traceability event would carry it in its subject, so that an adapter could later wrap the same event under a separate proof; the native signature defined here is not such a proof and is never reported as one.

A claim is not an EPCIS repository, not capture, not a statement that the event happened, and not a regulatory, conformity or sustainability declaration. A sensor observation may support an assessment and does not become one.

## 2. The envelope

A claim is one JSON object with exactly these members. A member not listed is refused. DPP members sit beside `event` and never inside it.

| Member | Requirement |
|---|---|
| `claimFormat` | Literal `dpp-epcis-lifecycle@1` |
| `event` | One EPCIS 2.0.1 event object, faithful to its source, under §4 |
| `eventContext` | The JSON-LD context the event is read under: a nonempty array whose first entry is `{ "iri": "https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld", "sha256": "5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737" }`, the pinned EPCIS 2.0.1 context and its digest, and whose other entries are `{ "inline": { prefix: namespace IRI, ... }, "sha256": ... }`, an inline prefix declaration with the SHA-256 of its RFC 8785 bytes. No other context is named by IRI, and nothing is fetched |
| `eventSchema` | The event profile: `{ "uri": "https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json", "sha256": "0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af" }`, the pinned EPCIS 2.0.1 JSON schema the event is held to |
| `bindings` | A nonempty array of bindings under §5, no two with the same passport, field and identifier |
| `issuer` | The DID of the signing party, at most 512 UTF-8 bytes, without a path, query or fragment |
| `issuerKeyDid` | A compressed secp256k1 `did:key`, required when `issuer` is not a `did:key` and forbidden when it is, as for the native claim ([`rules.md`](rules.md) §3) |
| `issuerParty` | Optional. The EPCIS party identifier the issuer is, written as the event's source and destination roles write parties, at most 512 UTF-8 bytes |
| `assertedRole` | One of `observer`, `owner`, `custodian` or `authorised-reporter` |
| `authorityScope` | A nonempty array of distinct passport identifiers the issuer claims the asserted role for |
| `issuedAt` | An ISO 8601 date-time with a timezone and a valid calendar date, not before the event's `eventTime` |
| `requiredExtensions` | Optional. A nonempty array of distinct absolute URIs, each naming an owned extension rule a verifier must hold to check the event's semantics (§4) |
| `source` | Optional. The link to where the event came from: `relation` (`imported` from a repository or another party, or `captured` by the issuer's own system), `sourceDigest` (the SHA-256 of the original source bytes), `mediaType` (`application/json` or `application/ld+json`), `eventPointer` (the JSON Pointer of the event in the source), and optionally `localEventIdentity` (a source-scoped import identity) and `sourceParty` (the party the source was received from) |
| `signature` | Canonical ECDSA DER, lower-case hex, over the bytes of §3 |

Text members reject C0 and C1 controls and DEL. Bounds: a passport identifier 512 UTF-8 bytes, a bound identifier 1024, a complete claim 2 MiB, nesting 64 levels.

## 3. Covered bytes and canonicalisation

The covered bytes are the RFC 8785 (JSON Canonicalization Scheme) canonical form, as UTF-8, of the envelope without `signature`. The exported, stored and anchored bytes are the RFC 8785 form of the complete signed envelope, signature included. RFC 8785 is used here, not the canonical JSON of [`rules.md`](rules.md) §4, because EPCIS events carry decimal readings and the native rule refuses every number that is not a safe integer; no valid value is coerced to fit.

The issuer signs the SHA-256 of the covered bytes with the BRC-42 child of its identity key for `[1, 'dpp epcis lifecycle v1']`, key identifier `event`, counterparty `anyone`. A BRC-100 `createSignature` call supplies the covered bytes as data. The protocol identifier is the domain separation: a signature made for the native claim, the anchor or any other protocol does not verify here. The key that signs is named by `issuerKeyDid`, or by `issuer` when that is a `did:key`.

A verifier reads exported bytes strictly. It refuses malformed UTF-8, a duplicate member name, nesting past the bound, a number literal a double cannot carry exactly, an integral number outside the range -(2^53 - 1) to 2^53 - 1, a string or member name with a lone surrogate, and a member named `__proto__`. It then refuses any bytes that are not exactly the RFC 8785 form of their own parse: insignificant white space, another member order, another number spelling and another string escape are each a different byte string and each refused. One claim therefore has one byte string, and the exported bytes verify without the issuer.

The claim's identity is `urn:sha256:` followed by the lower-case hex SHA-256 of the complete signed bytes, as for native claims ([`rules.md`](rules.md) §6). Identical bytes are the same claim.

## 4. The event

The event MUST be exactly one of the five types and MUST satisfy the pinned EPCIS 2.0.1 rules for its type. Every implementation checks the structural rules below; the pinned JSON schema is GS1's, is never carried by this repository or its packages, and is applied by a verifier that holds it. A verifier without it reports the structure `unknown`, never `pass`.

- Every event has `eventTime` and `eventTimeZoneOffset`, and MUST carry its own `eventID`, a URI.
- An `ObjectEvent`, `AggregationEvent`, `TransactionEvent` or `AssociationEvent` has `action` `ADD`, `OBSERVE` or `DELETE`. A `TransformationEvent` has no `action`, and names inputs and outputs, or one of them with a `transformationID`.
- An `AggregationEvent` names its `parentID` when its action is `ADD` or `DELETE`. An `AssociationEvent` always names its `parentID`. Both name children unless they delete every child.
- A `TransactionEvent` names at least one business transaction.
- An `ObjectEvent` names `epcList`, a quantity list or sensor elements at a read point, and carries `ilmd` only with `ADD`.
- Vocabulary values are a CBV 2.0 term, bare or as its `https://ref.gs1.org/cbv/` Web URI, or an extension URI. A URN or `ns.gs1.org` spelling of a CBV term, and a bare word that is not a CBV term, are refused.

**An observed object.** The event MUST name at least one object: an identifier in `epcList`, `parentID`, `childEPCs`, `inputEPCList` or `outputEPCList`, or a quantity element. A business step, a disposition, a sale label, a metadata edit or a token operation alone is not an observation, and no event is built from one. No movement, custody, ownership or transformation is manufactured to satisfy a token operation: a ledger update with no physical event has no claim under this format.

**Event identity.** The event's `eventID` is the event's own identifier, issued by whoever captured the event, and is compared exactly. The claim never mints, infers or rewrites it. No CBV Event Hash ID is selected: an `eventID` in the `ni:///sha-256;…?ver=CBV2.0` form is carried as an identifier whose hash this format does not check, and it is refused when its digest is one the claim also carries, the source digest, the local import identity or a digest of the event itself, because a local or source digest is never relabelled as a CBV hash. A source-scoped import identity travels in `source.localEventIdentity` and is refused as an `eventID`. A verifier given an expected `eventID` fails the structure when the event carries another.

**Extensions.** A member outside the EPCIS 2.0.1 members of the event's type, of a read point or business location, of an error declaration, of a sensor element, report or metadata, or any member of `ilmd`, is an extension. Its name is an absolute URI, or a prefixed name whose prefix the pinned EPCIS context or an inline declaration of `eventContext` or of the event's own `@context` declares; anything else is refused. Extensions are kept byte for byte and reported by path, name and namespace; vocabulary values are reported as `standard` or `extension` terms, so the two are never confused. An extension is owned by whoever names its namespace and is never presented as a GS1 term. When the issuer lists a rule in `requiredExtensions`, a verifier that does not hold that rule reports the event semantics `unavailable`, and an issuer cannot claim the semantics checked by skipping it.

## 5. Product binding

Each binding names one passport and the event field it relies on, with the identifier exactly as the event carries it:

| Member | Requirement |
|---|---|
| `passportId` | The passport the event concerns |
| `field` | One of `epcList`, `parentID`, `childEPCs`, `inputEPCList`, `outputEPCList` (individual objects), or `quantityList`, `childQuantityList`, `inputQuantityList`, `outputQuantityList` (a class, through a quantity element's `epcClass`) |
| `identifier` | The identifier exactly as it appears in that field; nothing is trimmed, case-folded or re-encoded |
| `level` | `instance` for the first five fields, `class` for the quantity lists |

A verifier checks that the field belongs to the event's type, that the identifier is in that field exactly as written, and that the level matches the field. A class-level reference never establishes an individual item's participation: an `instance` binding through a quantity list is refused, and so is an `instance` binding whose identifier itself names a model, a lot or a pattern, such as an LGTIN, an SGTIN pattern or a GS1 Digital Link with a GTIN and no serial. Whether the identifier denotes the passport's product is decided under the identity rules of [`profiles.md`](profiles.md) §7 by a comparison the caller supplies, built from the GS1 identifier helpers of `@bsv/dpp-profiles` (the application starter has one); without one, the binding is `unknown`. The passports whose item a verified claim names are those with an `instance` binding whose comparison passed. A signer may describe a multi-product event, keeping every role the event states, without claiming authority over every product or party.

## 6. Issuer authority, possession and ownership

A valid signature establishes which key signed the bytes. It does not establish that its holder observed the event, owns or holds the product, or may speak for the passport. The claim states the role it asserts and the passports it asserts it for, and the verifier reports authority separately from the signature:

- `supported` only when the caller's authority resolver confirms the asserted role for every passport in `authorityScope` at the event's time. Receipt of an event, possession of a controller key and an application account are not such evidence.
- `unavailable` when no resolver was supplied, when it holds no evidence, when the signature or event identity did not hold, or when an `owner` or `custodian` asserts a role the event's party roles name without declaring `issuerParty`.
- `refused` when the resolver says the role is not held, and without asking it when the claim contradicts itself: an `observer` whose source link says the event was imported from another party (an importer signs as `authorised-reporter`, keeping the source link and its digest); an `owner` or a `custodian` whose `issuerParty` is not among the event's `owning_party` or `possessing_party` source and destination roles respectively; and a passport in `authorityScope` that no binding names.

Possession and ownership are two further findings, each `asserted` when the event names `possessing_party` or `owning_party` sources or destinations, with the parties it names, and `not-asserted` otherwise. They report what the signed event states, never what the verifier established. A possession change is not an ownership change, a business step or disposition such as a retail sale asserts neither, and a token transfer asserts neither. Party identifiers are compared in their canonical GS1 Digital Link form where they are GS1 keys, and as written otherwise.

## 7. Replay, conflicts and corrections

Two verified claims stand to one another as follows. Identical bytes are the same claim. Under one issuer and one `eventID`, two different event bodies are a conflict: both are reported, neither is merged and neither wins. The body is the event without its repository `recordTime` and its `errorDeclaration`. One body in other bytes is a restatement. A claim by another issuer about the same `eventID` is that issuer's own attestation.

A correction uses EPCIS's own model (EPCIS 2.0.1 §7.4.1). It is a new claim whose event is the original event with an `errorDeclaration` added, naming the original `eventID`, its declaration time and optionally a reason and `correctiveEventIDs`, each corrective event being its own claim. The original claim is never altered. A verifier reports the correction state of a claim as `declared-in-error` when such a declaration was made by the original's issuer, or by an issuer the caller's authority resolver supports for every passport the original binds; a declaration claim's own state is `declared-in-error`. The state is `none` only when the caller supplied the related claims and said they are complete and none declares the event in error, and `unknown` otherwise, including when another issuer's declaration is not supported.

## 8. Anchoring and retrieval

A claim is anchored with the generic anchor `bsv-attestation-anchor-v1` ([`rules.md`](rules.md) §5) over its complete signed bytes, with `attestationId` the claim's identity of §3, `issuer` the claim's issuer, `attestationType` the event's type, `representation` `dpp-epcis-lifecycle-json@1` and `mediaType` `application/json`. There is one anchor output per bound passport, each with that passport as `subject` and the same digest and attestation identifier, all in one transaction. `tm_attestation` admits them as it admits any generic anchor, unchanged, and a lookup by passport finds the claim's anchor for that passport.

Which passports an event concerns, and whether an item took part in it, is decided by verifying the claim, never by an anchor's subject or by any unsigned lookup metadata. A verifier given anchors checks each one decodes, that its digest and identifier are the claim's, that its issuer, type, representation and media type are the claim's, and that its subject is a bound passport, and reports the bound passports no supplied anchor covers. Given the anchor's transaction with a merkle path and a header source, it checks inclusion; without them, inclusion is `unknown`.

## 9. Verification findings

A verifier reports these findings, each with its own state and reason, and never folds one into another or into a single verdict.

| Finding | States | What `pass` or its equivalent means |
|---|---|---|
| Event structure | `pass`, `fail`, `unknown` | The envelope's context and profile digests are the pinned ones, the event satisfies §4 and its identity rules, and the pinned schema accepted it. `unknown` with `schema-unavailable` when the structural rules held and no schema check was supplied |
| Event semantics | `pass`, `fail`, `unavailable`, `unknown` | The event names an observed object and every required extension rule held. `unavailable` when a required rule is not held |
| Product binding | `pass`, `fail`, `unknown` | Every binding's identifier is where and at the level it says, and the caller's comparison matched it to its passport |
| Signature | `pass`, `fail`, `unknown` | The signature verifies under §3 against the named key. `unknown` only when the bytes were refused before it could be read |
| Authority | `supported`, `unavailable`, `refused` | Under §6 |
| Possession, ownership | `asserted`, `not-asserted`, `unknown` | Under §6 |
| Anchor commitment | `pass`, `fail`, `unknown` | Every supplied anchor commits to these bytes with matching metadata; `unknown` when none was supplied |
| Inclusion | `pass`, `fail`, `unknown` | Every supplied anchor transaction's merkle path reaches a root the header source holds; `unknown` when no proof or header source was supplied |
| Correction | `none`, `declared-in-error`, `unknown` | Under §7 |

Bytes that are not a canonical claim fail the structure, with the reason, and leave every other finding `unknown` or `unavailable`: nothing they say is read. The reason codes are those of the verification report where one fits and `x-` codes otherwise, such as `x-not-canonical`, `x-context-digest-mismatch`, `x-profile-digest-mismatch`, `x-event-id-missing`, `x-digest-relabelled`, `x-no-observation`, `x-extension-rule-unavailable`, `x-binding-identifier-absent`, `x-class-as-item`, `x-importer-not-observer`, `x-party-role-contradicted`, `x-scope-without-binding` and `x-declaration-unauthorised`.

In the verification report of [`verification.md`](verification.md), whose check names are fixed, a claim is a credential in a non-native representation: the signature is `externalCredentialProof`; event structure, event semantics and product binding are `schema`; the event and issue times are `credentialTime`; the correction state is `credentialStatus`, `declared-in-error` failing it; and authority is `issuerAuthority`. Each carries the precise finding in its `detail`. The credential's subjects are its bound passports, so an anchor's subject is compared with them; item participation is in the detail.

## 10. What a claim and an anchor do not prove

A verified claim proves that the holder of the named key signed this event, these bindings and this role at or after the event's time. It does not prove that the event happened, that the issuer held the role unless authority is `supported`, that the product named is the passport's product unless the binding comparison passed, or that the event complies with any regulation. A valid anchor proves its anchoring service's commitment to the bytes and, with a merkle path, their inclusion at a chain position. It does not prove physical truth, legal ownership, regulatory compliance, the issuer's authority or the absence of later corrections.

## 11. Vectors and implementation

[`../fixtures/vectors/dpp/epcis-lifecycle/v1.json`](../fixtures/vectors/dpp/epcis-lifecycle/v1.json) pins claims and their findings: all five event types; creation, manufacturing as a transformation without action, shipping and receiving, packing and unpacking, assembly, identity-preserving repair, reversible component association, inspection with linked results, a business-transaction association, separate ownership and possession, a sensor observation, a four-step recycling chain with an extension business step under a required rule, possession without ownership and a sale that asserts no ownership; and the refusals of this document, each by its reason. Every positive event is held to the pinned EPCIS 2.0.1 schema. The reference implementation is `packages/dpp-protocol/src/lifecycleEvent.ts`, exported from `@bsv/dpp-protocol`, with RFC 8785 in `jcs.ts`; it depends on `@bsv/sdk` alone, fetches nothing and takes the schema check, the extension rules, the product comparison, the authority resolver, the anchors, the header source and the related claims from its caller.

What a conforming implementation reproduces: the envelope of §2, the bytes and refusals of §3, the event rules of §4, the binding rules of §5, the authority, possession and ownership findings of §6, the relations and correction states of §7, the anchor metadata of §8 and the findings of §9 for every vector. What is its own: where it obtains the schema, which authority evidence its resolver accepts, which identity comparison it supplies, and how it presents the findings.
