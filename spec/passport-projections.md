# Passport sources, projections and publication

**Status: working draft, pre-1.0.** This document defines how the facts a passport shows are derived: the immutable source revisions of a model, a batch and an item, the typed relationships between them, the deterministic projection that reads them under a named policy, the shared shapes a value takes when it is more than a scalar, the second version of the industry profile manifest that declares those shapes and rules, and the publication policy that says which representation of a passport is current. It changes nothing about the record model, the native claim, the generic anchor or any signed credential. A projection is a data document with its own identity and digest; it is not a token format, not a credential, and it never carries a proof copied from a source. Contracts: [`../contracts/passport-source.schema.json`](../contracts/passport-source.schema.json), [`../contracts/passport-projection.schema.json`](../contracts/passport-projection.schema.json), [`../contracts/profile-evidence.schema.json`](../contracts/profile-evidence.schema.json) and `packages/dpp-profiles/schemas/profile-manifest-v2.schema.json`.

## 1. Why a projection

An item passport shows model facts, batch facts and item facts on one page. The model's declaration of a rated capacity, the batch's month of manufacture and the item's measured state of health are three facts of three subjects, recorded by three sources at three times, and a page that flattens them into one object loses which was which. The failures this document prevents are concrete: a model specification shown as an item measurement; a value read from whichever model revision happened to be newest rather than the one the item was registered against; two sources disagreeing and the later arrival winning; a restricted field leaking into a public rendering because a template forgot a tier; and a rendering that differs from another rendering of the same evidence because arrival order or template code decided a fact. A projection makes the derivation explicit, deterministic and committed: the same pinned sources, relationships, policy, cutoff and audience produce the same bytes and the same digest, whatever order the inputs arrived in and whatever template shows them.

## 2. Source revisions

A source revision is one immutable record of what a source said about one subject at one time, conforming to `sourceRevision` in the passport source contract.

| Property | Requirement |
|---|---|
| `recordId`, `revisionId` | The stable record and a revision unique within it. A revision is never edited or deleted. A change is a new revision that names the one it `supersedes`. |
| `subject` | The identifier and granularity (`model`, `batch`, `item` or `component`) the facts describe. The same serial under a different GTIN is a different subject. |
| `profileRef` | The industry profile and version the payload is written under. A payload is read under that version and never reinterpreted under a newer one. |
| `recordedAt`, `effective` | When the revision was recorded, and, where the source says so, when its facts hold. The two are different facts. |
| `payloadDigest`, `payload` or `payloadRef` | SHA-256 of the exact retained bytes, with the payload inline or by reference. An inline payload's digest is over its RFC 8785 canonical form. |
| `authorisation` | Who was entitled to write the revision and under which policy: a registration, an import, an operator action, or `migration-unknown-ancestry` for a legacy copy whose provenance is not known. Unknown ancestry is recorded as unknown and never invented. |
| `disclosure` | The policy and the widest audience the payload may be shown to. |

A record has a current pointer, the revision a new registration or a default view reads. The pointer moves only by compare-and-swap against the revision the caller last read: a caller that names a stale expected revision is refused and re-reads, so two concurrent edits cannot silently overwrite each other. Moving the pointer changes no revision.

A new item registered against a model carries the model's identifier and the exact revision it was registered against, so the item's projection reads that revision and not the model's later ones. An item may still materialise a public payload for existing consumers; that payload records, per inherited value, the revision it came from. Existing issued payloads are unchanged and receive no fabricated model link.

## 3. Relationships

A relationship is an accepted assertion under a named policy that one subject stands in a typed relation to another, conforming to `relationship` in the passport source contract. The initial kinds are `instance-of-model` (an item or a batch of a model), `member-of-batch` (an item of a batch), `component-of` (a component of an item, whether or not the component has a token) and `successor-of` (a passport that replaces another). Each names its source and target subjects, the evidence it rests on (a source revision, a credential or a retained source event), an effective interval where supplied, and its policy. A `component-of` relationship may carry the quantities the assertion covers; a source event's own input and output quantities stay on the event and are never copied into the relationship. An association is an assertion under a policy, not proof that a physical component is present.

## 4. The projection

`passport-projection@1` is the derivation of one subject's fields from pinned inputs.

### 4.1 Identity and commitment

The commitment body is the projection without `projectionId`, `projectionDigest`, `diagnostics` and `template`: the version, passport and subject identifiers, granularity, profile reference, the source references (record, revision and digest of every source read, sorted by record then revision), the relationship references (sorted by identifier), the policy reference, the cutoff or `null`, the disclosure scope, the values, the field results, the evidence references and the validation references. The body is canonicalised under RFC 8785 and digested with SHA-256; `projectionDigest` is that digest and `projectionId` is `urn:bsv:dpp:projection:sha256:` followed by it. Retrieval time and the rendering preset are outside the body, so a projection served twice has one identity. A number that is not finite has no canonical form and is refused before derivation. The digest commits to the derivation and to nothing else: it is not a secured-source digest, it is not an anchor, and a source's proof is never copied into a projection.

### 4.2 Values and results

`values` carries, per field key, the derived value with the record, revision and pointer it was read from, the granularity of the fact, the language returned for a localised text, and an explicit conversion record when a unit was converted. `fieldResults` carries, for every field the profile declares, three separate answers: availability (`present`, `missing`, `unknown` or `withheld`), applicability (`applies`, `not-applicable` or `unresolved`) and any finding (`conflict`, `unsupported`, `limit`, `cycle` or `missing-source`) with the sources in conflict and what was set aside. Zero and false are values and are present. An absent value is missing; a value that could not be read because its source was not supplied is unknown; a value outside the audience is withheld; and none of these is a statement about applicability, which is decided separately from the profile's rule. A field can be present and not applicable, or present and unresolved, and the projection says both.

### 4.3 Precedence

1. Only field locations and granularities the selected profile declares are read. A model field is read from the model's revision, a batch field from the batch's, an item field from the item's. A model-only value for an item field is reported as missing with the reason that only model information exists; it never becomes an item value. A value carried at a finer granularity than the field declares, with no declared override, is reported as unsupported.
2. The pinned revisions are read: the revision a relationship's evidence names, and for the subject itself the revision the caller resolved. A record supplied at two revisions that nothing pins is refused by name, never chosen by timestamp. A source recorded after the cutoff is excluded and listed. Later model changes do not alter an existing projection.
3. A batch or item value takes precedence over the model's only where the field declares `overridable` at that granularity and the policy's precedence lists the field. Otherwise the two are a conflict, reported with both sources and no value.
4. A dynamic field is derived from measurements that match the subject, the property, the method and the unit exactly. Under `latest-observed` the newest observation time is selected; under `latest-effective` the newest effective time. Observations at the same instant with different values are a conflict under `tie: conflict`. Observations under different methods are not compared and are a conflict. Arrival order is never authority: the same accepted observations in any order replay to the same result.
5. Invalid, revoked and correction-unresolved measurements are excluded from the derivation and listed under the field's `excluded` with the reason, so the history stays inspectable. An EPCIS error declaration and a credential status are separate facts and neither silently becomes a current value.
6. Availability, applicability and findings are separate axes, as §4.2 defines.
7. Traversal from the subject follows `instance-of-model` and `member-of-batch` outward, records `component-of` inward and `successor-of` outward without entering them, and is bounded: depth 8 and 100 source and relationship references by default. A cycle, a missing source and an exceeded limit are findings; the projection is then partial and says so, and never wrong.

### 4.4 Cutoff, audience and language

The cutoff `asOf` excludes sources recorded and measurements observed after it and is committed, so a historical projection is its own document. The disclosure scope selects the audience: `public` reads public fields; `owner` adds the owner tier; `legitimate` adds the legitimate-interest tier; `authority` adds the legitimate-interest and authority tiers. A field outside the audience is withheld and its value is absent from the document, so two audiences produce two digests and no rendering can show a value the document does not carry. A localised text is returned in the exact language asked for, else the base language, else the declared default, and the selection is recorded; a text in none of them is present and unsupported, never rewritten.

### 4.5 Surfaces

The shared package exposes the pure `projectPassport`, `projectionCommitment`, `projectionDigest` and `verifyProjectionCommitment`. A service exposes `getPassportProjection`, `getPassportSourceRevision` and a scoped `registerPassportSourceRevision`; network access, current-pointer selection, storage and authorisation belong to the service and its adapters. The server derives the subject's authorisation, disclosure scope and profile from trusted records; a locale or a historical revision in a query grants no right. An imported observation updates retained evidence and a separately identified projection under its policy; it does not mutate a published credential or a token, and publishing a new secured passport or native state remains a separately authorised operation.

## 5. Shared shapes

The profile evidence contract defines the shapes a value takes when it is more than a scalar, reused by manifest version 2 value types and by projections.

| Shape | What it fixes |
|---|---|
| `claimEvidence` | Which field, which subject, which source revision, credential or document, who reported it, when it is relevant and in which report it was evaluated. |
| `certification` | The scheme and version, certificate identifier, issuer, subject, validity with its precision, the document or credential, and a verification result whose `unknown` is not a pass. A scheme homepage or an issuer signature alone never proves a certification valid. |
| `measurement` | The property, value, unit, basis, functional unit or denominator, method and version, boundary, conditions, time with its precision and subject. A textual value carries a basis. A fraction is not a percent; a mass-balance share is not a physical share. A conversion, where made, is recorded with its source unit and rule and is never implied. |
| `relatedDocument` | A reference, purpose, URL, media type, language, revision, date with precision, and, only for retained bytes, a digest and length. A URL is where a document was seen, not a commitment to its content. |
| `localisedText` | Values by BCP 47 tag with the returned language and selection recorded. |
| `datePrecision` | `day`, `month` or `year`, each with its own pattern. A month is never given a day. |
| `warrantyTerms`, `warrantyExpiry` | A model's duration and calendar rule; an item's derived expiry from an evidenced start at the start's precision. Terms alone yield no expiry. |

The helpers `datePrecisionOf`, `selectLanguage`, `deriveWarrantyExpiry` and `convertMeasurement` in `@bsv/dpp-profiles` implement these rules and refuse, with a reason, everything they cannot decide.

## 6. Manifest version 2

A profile that needs the shapes or the rules above publishes its manifest under version 2. Everything version 1 declares survives unchanged. Version 2 adds, per field, a `requirement` status (`enacted`, `guidance`, `anticipated`, `needs-review` or `not-to-be-displayed`, with its source, clause and effective date) separate from the profile's `obligation` and from `legalBasis`; a composable `applicability` rule over `always`, `category-in`, `needs-review`, `all`, `any`, `jurisdiction-in`, `effective`, `threshold` and `unresolved`; a `precision` for date fields; a `scope` and `componentScoped` for component facts; and an `overridable` declaration naming the granularity and policy under which a finer source may take precedence. The five shape value types `measurement`, `certification`, `claimEvidence`, `localisedText` and `relatedDocument` join the value types. A manifest may carry `succession`: the version it follows and, for every changed field, the migration outcome (`unchanged`, `renamed`, `retyped`, `split`, `new`, `withdrawn` or `relabelled`) with a note.

The evaluator answers `applies`, `not-applicable` or `unresolved` and never a fourth word. `unresolved` is never satisfied and never a failure: an unresolved required field is shown, does not block a draft, and cannot pass as settled compliance. A field whose requirement status is `anticipated`, `needs-review` or `not-to-be-displayed` is never schema-required and never counted as missing, because a validator must not demand what guidance says not to fill. The generator embeds the shape definitions into every payload schema that uses one, patterns a month-precision date as a month, carries the version 2 keys in the consumer document, and records a new manifest additively: `--freeze-new` records new entries and refuses to move any digest already frozen. A successor manifest is published as `draft`, opt-in by explicit version; the cutover that marks the preceding version superseded is a separate reviewed change.

## 7. Publication, succession and retention

`publication-policy@1` is a named policy, separate from token state, that identifies which representation of a passport is current and who is responsible for it: `current.representationRef` names the current representation; `successor`, where required, names the passport that replaces this one and the `successor-of` relationship that evidences it; `responsibility` lists the parties, their roles and the evidence of each assertion; and `cessation`, where an active publication is withdrawn, records when, why and on what evidence. Administrative responsibility does not follow a token transfer automatically. A referenced successor never rewrites or revives the original lineage: the original's states, claims and anchors keep their meaning, and a retired token stays retired whatever later evidence arrives. An authorised cessation withdraws the active publication while historical evidence stays accurately represented as historical. Whether particular underlying bytes are retained or removed follows the applicable legal and access policy; a source deleted under policy becomes unavailable for later verification, and the digests and anchors that referenced it retain their actual meaning. Nothing here erases blockchain history or puts restricted raw data on chain.

## 8. Rendering

A public view is rendered from the record's pinned profile groups; sections and layout are the renderer's. A template changes presentation only: subject, profile and version, values, field results and disclosure come from the projection, and two rendering presets of one projection show the same facts with the same findings. A renderer shows completeness and applicability, schema and mapping validity, proof, authority and source availability, and any external regulatory or registration assessment as distinct things, and invents no all-purpose compliance score. A profile a renderer does not know is shown as unsupported with the permitted data and no claim of validation. The disclosure scope applies alike to HTML, JSON, downloads, evidence packages and caches: a cache key carries the subject, the profile and source revisions, the audience and the locale, or the response is private and not stored; a hidden section is not an access control. Public viewing needs no wallet.

## 9. Normative and implementation

What a conforming party reproduces: the source revision and relationship records and the append-only and compare-and-swap rules (§2, §3); the commitment body, canonicalisation and identity of a projection (§4.1); the separate axes of availability, applicability and findings (§4.2); the seven precedence rules (§4.3); the cutoff, audience and language rules (§4.4); the shapes and the refusals their helpers make (§5); the version 2 manifest rules, the three-valued evaluator and the additive freeze (§6); the publication policy's boundaries (§7); and the rendering requirements (§8). What is a build's own: how revisions are stored, how the current pointer is implemented, which sources it resolves for a subject, how it renders, and which cache it uses.
