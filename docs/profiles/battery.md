# Battery

**Audience:** implementers handling battery passports. **Versions:** `battery@2` current and frozen; `battery@3` draft under manifest version 2, opt-in. **Canonical sources:** [`packages/dpp-profiles/manifests/battery@2.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/manifests/battery@2.json), [`packages/dpp-profiles/manifests/battery@3.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/manifests/battery@3.json), [`packages/dpp-profiles/generated/mapping/battery@2.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/generated/mapping/battery@2.md), [`fixtures/battery-lifecycle-v1.json`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/battery-lifecycle-v1.json).

## What the current profile covers

`battery@2` inventories the fields the consuming application's battery registry captured, in full, including those captured over life or derived rather than at registration: identity and manufacturer data, chemistry and composition, performance and durability, state-of-health companions, carbon and due-diligence declarations, and the access tiers each sits in. Every field carries its pointer, semantic reference, value type, unit or code list, constraints, cardinality, granularity, provenance, access tier, obligation, legal basis and applicability. The generated public schema validates the on-chain payload; the restricted schema validates the off-chain tiers.

## The draft successor

`battery@3` applies the Commission's guidance of 15 August 2026 on data points by category: carbon, due diligence and recycled content fields are marked anticipated rather than required, industrial applicability the guidance leaves conditional is `unresolved` rather than passed or failed, the state-of-health fields carry the guidance's category sets, and item-level dynamic companions exist for rated capacity, resistance, temperature and state of charge. Every field carries a requirement status and a migration outcome from its predecessor. It is a draft: a writer selects it by explicit version, the application default stays `battery@2`, and the cutover that marks the predecessor superseded is a later reviewed re-freeze.

## The demonstration lifecycle

`fixtures/battery-lifecycle-v1.json` is a synthetic industrial-battery passport under the GS1 demonstration prefix 952 carried through activation, sale with dispatch and receipt evidence, a transfer of token control with no custody evidence, repair by a service party, an edit recording a measured value, and recycling into outputs with new identities. Each state carries its raw transaction, its signed native claim, the evidence facets put forward and the conditional mapping result, and the file ends with the verification report over the chain and the claims. The transfer maps to `insufficient-data` with `custodyRecord` missing, because a token transfer never implies delivery. No product exists; every value is invented and the payload says so.

## What is withheld

Battery passport qualification under Regulation (EU) 2023/1542 is a product claim the release selection withholds: the Annex XIII mapping is unassessed, `battery@3` is a draft, and product-data compliance is a separate qualification from any release of the core. A payload that validates against `battery@2` is well-formed under the profile; it is not thereby compliant with anything.
