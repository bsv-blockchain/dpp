# Textile

**Audience:** implementers handling textile passports. **Versions:** `textile@2` current and frozen; `textile@1` superseded and still served; `textile@3` draft under manifest version 2, opt-in. **Canonical sources:** [`packages/dpp-profiles/manifests/textile@2.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/manifests/textile@2.json), [`packages/dpp-profiles/manifests/textile@3.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/manifests/textile@3.json), [`packages/dpp-profiles/generated/mapping/textile@2.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/generated/mapping/textile@2.md).

## What the current profile covers

`textile@2` inventories the fields of the consuming application's textile registry: identity and brand data, fibre composition, care and durability, origin and manufacturing, certifications and the access tier of each. The generated public and restricted schemas validate the on-chain and off-chain payloads. `textile@1` remains served for states that declare it and is never reinterpreted.

## The draft successor

`textile@3` adds component-scoped composition, method-qualified assessments, certification evidence, related documents and language-tagged companions, using the shared evidence shapes of `contracts/profile-evidence.schema.json`, without mandating an unadopted score or scheme. Every field carries a requirement status and a migration outcome from its predecessor. It is opt-in by explicit version and changes no byte of `textile@2`.

## Reading a textile payload

Validate against the generated public schema with a validator that asserts formats and refuses an unknown dialect. Use `fieldsFor` for the category to separate what applies, what does not and what needs review; show the review list rather than assuming it. Report the profile result apart from the core checks. A textile passport's legal adequacy under any delegated act is not established by the profile and is not claimed by any release.
