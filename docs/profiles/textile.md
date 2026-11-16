# Textile (retired)

The manifest profiles `textile@1`, `textile@2`, `textile@3` and `textile@4` are retired from 14 November 2026. Teams that wrote or read them can use this page to see what changed and what to use instead. Nothing here teaches how to write them, because nothing is written under them any more.

For textile passport data, use `eu-textile@1` on the [EU battery and textile bindings](eu-sector-bindings.md) page.

## What is retired

| Profile | What it was | Now |
|---|---|---|
| `textile@2` | The manifest profile new records were written under | Retired |
| `textile@4` | A draft, parked on 12 November 2026 | Retired |
| `textile@3` | An earlier draft, parked with `textile@4` | Retired |
| `textile@1` | The first version, superseded by `textile@2` | Retired |

Each identifier keeps its one meaning. It is never reused, and no other definition is published or registered under it.

## What to use instead

| Need | Use |
|---|---|
| Textile passport data for one serialised item | `eu-textile@1`, a profile held by a binding the package ships: a JSON-LD product document, checked by SHACL shapes and split into a public and a restricted part ([EU battery and textile bindings](eu-sector-bindings.md)) |
| A product no sector profile covers | `general@2` ([general](general.md)) |
| A data model of your own | A binding you write and trust by digest ([validate a profile defined outside the package](../packages/dpp-profiles.md#validate-a-profile-defined-outside-the-package)) |

`eu-textile@1` is another data model under its own identifier. It is not a later version of `textile@2`, and nothing converts a payload from one to the other. A product moves by a newly issued passport, written from the product's own data ([move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles)).

## What the software does now

| You do this | You get this |
|---|---|
| Issue, update, hand on or retire a passport under a retired profile in the application starter | A refusal with the code `profile-retired`, before anything is signed |
| Ask the starter for the profile, its form or its sample | `410` with `profile-retired`. The profile is not in the list of choices |
| Call `prepareBoundPayload`, `missingRequired`, `missingRequiredV2`, `reviewProfileData` or `projectPassport` | A refusal named `profile-retired`: a returned refusal from the first, a `ProfileRetiredError` from the others |
| Run `node examples/sample-payload.mjs textile@2` | `profile-retired`, the replacement, and exit status 2 |
| Verify a passport whose states declare a retired profile | Every check as before, except `schema`: `unknown` with `schema-unavailable` and the cause `profile-retired`. The payload is neither passed nor failed |
| Ask a profile registry about the identifier | `retired`, with the replacement. It does not resolve, and a binding that claims the identifier is refused |
| Name it in `checkSelection` | The conflict `industry-retired`, for reading, writing and a claim alike |

## What stays

The definitions stay published, byte for byte. The manifests, the generated schemas, the consumer documents and the mapping inventories are in `@bsv/dpp-profiles` at the digests its [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) records. `readManifest`, `readManifestAny`, the schema readers, `fieldsFor`, `fieldsForV2` and `compareProfiles` still read them, as history ([retired profiles in the package](../packages/dpp-profiles.md#retired-profiles)).

Signed records stay as they were signed. A state or a claim that declares `textile@2` keeps its bytes, its signatures still verify, and a record on the blockchain cannot be erased.

To clear demonstration records from your own deployment, follow [clear retired-profile demonstration records](../operate/retired-profile-records.md).

## Sources

| Material | Source |
|---|---|
| Retired profile | [textile@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@2.json) |
| Retired drafts | [textile@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@3.json), [textile@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@4.json) |
| Retired first version | [textile@1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@1.json) |
| Mapping and generated schemas, as frozen | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/textile@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) states the retirement rule in its section on versions, freezing, retirement and migration.

## Next

Write textile data under `eu-textile@1` with the [EU battery and textile bindings](eu-sector-bindings.md), and move an existing application with [move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles).
