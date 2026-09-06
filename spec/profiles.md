# Profiles and identifiers

**Status: working draft, pre-1.0.** This document defines what a profile is, how one is published, versioned and selected, how a payload is checked against it, and how the identifiers a passport carries relate the model, the batch and the item. It binds the industry data profiles this repository publishes in `packages/dpp-profiles`, and it is the rule an application or registry follows when it consumes them. The record model fixes what a state is; this document fixes what its public payload is expected to say under a named profile.

## 1. What a profile is

A profile is a named, versioned selection over the core. Three kinds exist, and a profile is exactly one of them. An **industry profile** selects the fields a passport's public and restricted tiers carry for one kind of product, their meaning, units, code lists, granularity, provenance and access, and the obligation source behind each. An **exchange profile** selects a credential format, its schemas, contexts and proof suites, and the mapping to and from native evidence. An **operator profile** selects admission, discovery, synchronisation and retention behaviour for a service. The three are distinct selections and a deployment declares each it makes; none implies another.

A profile MUST name its use case, the baseline it requires, the roles it binds, its dependencies, the combinations it is incompatible with, the options it selects and the acceptance vectors that exercise it. Where one named, tested choice would do, a profile makes the choice rather than adding a switch.

## 2. The profile manifest

An industry profile is published as a manifest conforming to `packages/dpp-profiles/schemas/profile-manifest.schema.json`. The manifest is the canonical definition; every form, validator, consumer document and registry endpoint is generated from it, and nothing that consumes it edits it.

| Property | Requirement |
|---|---|
| `id`, `version` | The profile identifier and a positive integer version; together `battery@2`. Once published under a version, a manifest is immutable. |
| `status` | `draft`, `current` or `superseded`, with `supersededBy` on a superseded manifest. A superseded manifest remains published and served for as long as any state declares its version. |
| `schemaUri`, `schemaDigest`, `schemaDialect` | The JSON Schema generated for the profile's public payload, its SHA-256 and its dialect, which for every artefact published under this document is JSON Schema 2020-12. A consumer refuses a dialect it does not implement and never infers one. |
| `contextRefs` | Semantic contexts and vocabularies the field meanings resolve into, each pinned by identifier and version. |
| `extends` | The manifest this one extends, if any; a field the extension does not restate is inherited unchanged. |
| `fields` | §3. |
| `eventMappings` | The conditional mappings from native operations to lifecycle event semantics under this profile ([`rules.md`](rules.md) §2), each with its evidence condition. |
| `accessPolicyRef` | The access policy the tiers refer to. |
| `sourceRefs` | Every regulation, standard, vocabulary and register the manifest cites, with version, licence and how it is used; licensed texts are cited by clause and never reproduced. |
| `applicability` | The product categories, jurisdictions and dates the profile is intended for, with each legal statement marked `enacted`, `anticipated` or `needs-review`. |

## 3. Fields

Each field states a JSON pointer into the public or restricted payload, a semantic URI where one exists, a value type, its unit or code list, its cardinality, the granularity it describes (`model`, `batch` or `item`), the provenance the value must carry, and its access tier. Its `obligation` is `required`, `recommended` or `optional`, and is a separate property from `legalBasis`, which cites the instrument that asks for the value or says plainly that none does. Where an obligation holds only under a condition a form cannot decide, the field carries a machine-evaluable `applicability` expression where one can be written, and otherwise the word `needs-review`; a consumer MUST NOT read `needs-review` as satisfied or as universally required. Under manifest version 2 the expression is one of the composable rules of [`passport-projections.md`](passport-projections.md) §6 (`always`, `category-in`, `jurisdiction-in`, `effective`, `threshold`, `all`, `any`, `needs-review` and `unresolved`), and a field the rule leaves `unresolved` is neither passed nor failed until the record supplies the value or declares it inapplicable under `inapplicableFields`.

Constraints are resolved, never implied: a percentage carries its bounds, a country carries its pattern, a closed list says it is closed. A list the source has not closed is `open`, and a value outside it is valid. A value whose permitted form waits on an act not yet adopted says so under `awaitingAct` and states no list or pattern; a consumer does not reject a value for such a field. A field marked `prose` is one a person writes for a person to read, by decision.

JSON Schema validity is one check. Unit conversion, role evidence, provenance and legal applicability are separate checks and a report names them separately ([`verification.md`](verification.md) §4, `schema`). A payload that carries a field the manifest does not declare is preserved in the archived original and excluded from a public projection unless the selected profile permits unknown fields; it is never silently deleted from what was signed.

## 4. Versions, freezing and migration

`battery@2`, `textile@2` and `general@2` are frozen at the digests `packages/dpp-profiles/frozen.json` records, together with the superseded `textile@1` and `general@1`. A frozen manifest changes only by publishing a new version. Every field declares what its value is: a recorded `fact`, the maker's `declaration`, a `calculation` from other fields, or a third party's `assessment`; a consumer never upgrades a declaration to a fact or an assessment to an accreditation by the presence of a signature, because a signature proves who said a thing, and accreditation is a separate, named authority the field's profile or the applicable exchange profile requires and a verifier confirms under `issuerAuthority`. A corrected mandatory field, a changed meaning or an incompatible validation rule is a new version; a state decodes under the profile version it declares and is never reinterpreted under a newer one. Migration is a newly issued state or projection that names its sources; anchored history is never rewritten.

Industry profiles version independently of the core standard and of each other, and a profile's canonical definition lives in this repository from the moment it joins. A profile that depends on another names the exact version it depends on.

A successor to a frozen profile is published first as a draft under manifest version 2 (`packages/dpp-profiles/schemas/profile-manifest-v2.schema.json`): `battery@3` succeeds `battery@2` and `textile@3` succeeds `textile@2`. A draft is frozen at its own digest beside the version it succeeds, is selected only by its explicit version, and is never what a deployment gets by asking for the current version; a conformance claim rests on the current version, and a combination check refuses a claim on a draft (`industry-draft`). Every field of a draft carries a `requirement` whose `status` says what asks for the value (`enacted`, `guidance`, `anticipated`, `needs-review`, `not-to-be-displayed` or `none`) and names the source that does, and only an `enacted`, `guidance` or `none` requirement that is `required`, always applicable and captured at registration is required by the generated schema; an `anticipated` requirement never blocks a record. The draft's `succession` block names the version it succeeds and gives one migration outcome per predecessor field (`unchanged`, `renamed`, `retyped`, `split`, `new`, `withdrawn` or `relabelled`) with the reason, so a reader knows what changed and what did not. The cutover is a later, reviewed refreeze that records the successor as current and marks the predecessor `superseded`; until then the predecessor's digest, generated schemas and contexts stay exactly as frozen.

## 5. Identifiers

A passport identifier names the enduring product record and never changes across the chain ([`record-model.md`](record-model.md) §3). Around it a profile distinguishes three granularities: the **model** a manufacturer designs, the **batch** or lot a production run produces, and the **item** one physical unit is. A field says which it describes, and a manifest may declare the parent relation between an item's identifier and its model's, and between a batch and its model, so a reader can find the model facts an item inherits without those facts being repeated in every item state. The historical passport identifier and the genesis outpoint are preserved through every migration.

Where the identifier is a GS1 Digital Link, the rules of the record model and the GS1 general specifications apply: the GTIN under application identifier 01 is written at fourteen digits with a correct check digit, allocated under a prefix the writer holds or, for a record describing no real object, under the demonstration prefix 952, and the serial under application identifier 21 identifies the item. `packages/dpp-profiles` provides the check-digit and grammar helpers a writer uses to keep that promise. Syntax and a correct check digit never prove allocation authority, which GS1 settles at allocation and a reader cannot see from the digits.

The resolver location, the host a Digital Link is minted under and any link set a resolver answers are mutable service metadata. A provider change alters where the identifier is answered, never the identifier, the genesis or the history; a profile's data-carrier tests exercise persistent identity across such a change.

## 6. Generated consumers

An application's field registry, its forms and its payload validators, and a registry's profile endpoint are generated from the manifest by a deterministic generator, and a test in each consumer holds the generated artefacts identical to what the generator produces from the pinned manifest digest. Two consumers of one manifest therefore agree field by field, and drift is a red test rather than a support case. The legacy consumer document shape (`contracts/registry.yaml`, `ProfileDocument`) is one such generated projection. So is the field mapping inventory of each current profile (`packages/dpp-profiles/generated/mapping/`): one row per field with its external semantic field or `not mapped`, type and unit or list, granularity, obligation, legal basis, applicability, access tier, capturing party and required evidence, with `needs review` wherever no generator can decide and no legal conclusion drawn.

## 7. Normative and implementation

What a conforming party reproduces: the manifest shape and its immutability (§2), the field rules and the `needs-review` semantics (§3), the versioning and freezing discipline (§4), the three granularities and the GS1 rules where selected (§5), and generated rather than hand-kept consumers (§6). What is a build's own: which profiles it offers, how it renders a form, where it stores the restricted tier, and which resolver hosts its identifiers.
