# Battery (retired)

The manifest profiles `battery@2`, `battery@3` and `battery@4` are retired from 14 November 2026. Teams that wrote or read them can use this page to see what changed and what to use instead. Nothing here teaches how to write them: the application starter writes nothing under them, and `@bsv/dpp-profiles` prepares and validates nothing under them. An index does not judge profiles, so a state another writer issues under one is still indexed, and reads as unsupported.

For battery passport data, use `eu-battery@2` on the [EU battery and textile bindings](eu-sector-bindings.md) page.

## What is retired

| Profile | What it was | Now |
|---|---|---|
| `battery@2` | The manifest profile new records were written under | Retired |
| `battery@4` | The draft that was to succeed it | Retired |
| `battery@3` | An earlier draft, parked on 12 November 2026 | Retired |

Each identifier keeps its one meaning. It is never reused, and no other definition is published or registered under it.

## What to use instead

| Need | Use |
|---|---|
| Battery passport data for one serialised item | `eu-battery@2`, a profile held by a binding the package ships: a JSON-LD product document, checked by SHACL shapes and split into a public and a restricted part ([EU battery and textile bindings](eu-sector-bindings.md)) |
| A product no sector profile covers | `general@2` ([general](general.md)) |
| A data model of your own | A binding you write and trust by digest ([validate a profile defined outside the package](../packages/dpp-profiles.md#validate-a-profile-defined-outside-the-package)) |

`eu-battery@2` is another data model under its own identifier. It is not a later version of `battery@2`, and nothing converts a payload from one to the other. A product moves by a newly issued passport, written from the product's own data ([move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles)).

## What the software does now

| You do this | You get this |
|---|---|
| Issue, update, hand on or retire a passport under a retired profile in the application starter | A refusal with the code `profile-retired`, before anything is signed |
| Ask the starter for the profile, its form or its sample | `410` with `profile-retired`. The profile is not in the list of choices |
| Call `prepareBoundPayload`, `missingRequired`, `missingRequiredV2`, `reviewProfileData` or `projectPassport` | A refusal named `profile-retired`: a returned refusal from the first, a `ProfileRetiredError` from the others |
| Run `node examples/sample-payload.mjs battery@2` | `profile-retired`, the replacement, and exit status 2 |
| Verify a passport whose states declare a retired profile | Every check as before, except `schema`: `unknown` with `schema-unavailable` and the cause `profile-retired`. The payload is neither passed nor failed |
| Ask a profile registry about the identifier | `retired`, with the replacement. It does not resolve, and a binding that claims the identifier is refused |
| Name it in `checkSelection` | The conflict `industry-retired`, for reading, writing and a claim alike |

## What stays

The definitions stay published, byte for byte. The manifests, the generated schemas, the consumer documents and the mapping inventories are in `@bsv/dpp-profiles` at the digests its [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) records. `readManifest`, `readManifestAny`, the schema readers, `fieldsFor`, `fieldsForV2` and `compareProfiles` still read them, as history ([retired profiles in the package](../packages/dpp-profiles.md#retired-profiles)).

Signed records stay as they were signed. A state or a claim that declares `battery@2` keeps its bytes, its signatures still verify, and a record on the blockchain cannot be erased. The synthetic battery lifecycle fixture is such a record: it is kept unchanged and is no longer generated.

To clear demonstration records from your own deployment, follow [clear retired-profile demonstration records](../operate/retired-profile-records.md).

## Sources

| Material | Source |
|---|---|
| Retired profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@2.json) |
| Retired drafts | [battery@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@3.json), [battery@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@4.json) |
| Mapping and generated schemas, as frozen | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |
| Historical lifecycle fixture | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/battery-lifecycle-v1.json). Its product data is invented; no such battery exists |

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) states the retirement rule in its section on versions, freezing, retirement and migration.

## Next

Write battery data under `eu-battery@2` with the [EU battery and textile bindings](eu-sector-bindings.md), and move an existing application with [move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles).
