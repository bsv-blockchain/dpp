# The shared profile framework

**Audience:** industry contributors and consumers of profile data. **Canonical sources:** [`spec/profiles.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/profiles.md), [`packages/dpp-profiles/schemas/profile-manifest.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/schemas/profile-manifest.schema.json), [`packages/dpp-profiles/schemas/profile-manifest-v2.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/schemas/profile-manifest-v2.schema.json), [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md) §2.

Industry profiles are a separate workstream on the common core. They say what a product of a sector has to say about itself: fields, units, code lists, cardinality, granularity (model, batch or item), provenance, access tier, obligation, legal basis and applicability. They change none of the record, signature, history or anchoring rules, and each one versions and is assessed on its own.

## What a profile is

A manifest, frozen by digest, from which everything else is generated deterministically: the public payload schema (what goes on chain), the restricted payload schema (the off-chain tiers), the consumer document the registry serves, and a row-level mapping inventory. Five profiles are published: `battery@2`, `textile@2` and `general@2` current; `textile@1` and `general@1` superseded and still served for as long as a state declares them. `battery@3` and `textile@3` are draft successors under manifest version 2, opt-in by explicit version and leaving every byte of the current versions unchanged until a reviewed cutover.

## The rules every profile follows

- **Obligation is separate from legal basis.** A field can be required by the profile without a law requiring it, and a law can be recorded as anticipated rather than enacted.
- **Applicability is three-valued.** A field applies always, applies to named categories, or needs review because no code can decide it. A consumer shows the review list to a person and never treats it as satisfied or as universally required. Manifest version 2 adds a declarative evaluator whose `unresolved` outcome is never a pass.
- **A value's kind is never upgraded by a signature.** A fact, a declaration, a calculation and an assessment stay what they are; accreditation is a separately confirmed authority.
- **The lifecycle mapping is conditional.** An operation maps to an external event only with the evidence the profile names, and the result is `lossless`, `transformed`, `unsupported` or `insufficient-data` with what was lost or missing listed. Nothing is dropped silently.
- **A state is read under the version it declares.** A changed meaning, a corrected mandatory field or an incompatible rule is a new version; nothing reinterprets an existing state under a newer one.
- **Core validity and profile results are reported apart.** A missing industry field is distinguishable from an invalid signature or a broken history, and a profile pass is not a legal statement.

## What a profile is assessed on

Its own evidence: manifest validity, uniqueness, freezing, deterministic generation, payload validation, the mapping inventory, and the demonstration lifecycle where one exists. The ledger carries profile rows separately from core rows, and the claims that mention a product category (`battery-passport-qualification`) are withheld until the regulatory mapping is assessed, which no release of the core changes.

## The profiles

- [Battery](battery.md): `battery@2` current, `battery@3` draft, the demonstration lifecycle fixture.
- [Textile](textile.md): `textile@2` current, `textile@3` draft.
- [General](general.md): `general@2`, the profile for products no sector profile covers.
- [Authoring and governance](authoring.md): how a profile is proposed, frozen, generated and versioned.
