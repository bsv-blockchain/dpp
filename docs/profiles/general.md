# General

The general profile, `general@2`, is the product data for a product that no sector profile covers, such as a bicycle, a watch or a piece of furniture. Use this page to start a payload from a sample that passes, see the categories and fields the profile defines, and inspect them in code.

The profile claims no regulation. Choosing it does not mean battery or textile rules stop applying to a product they cover; for those products use [battery](battery.md) or [textile](textile.md).

## Versions

A version on this page is the profile version, the number after `@`, which a payload declares in `profile_version`. It is not the record version of the passport format or the manifest format ([choose an industry profile](README.md) explains all three).

| Version | Status | Use it to |
|---|---|---|
| `general@2` | `current` | Write new records |
| `general@1` | `superseded` | Read records that declare it. It defines no fields, so a reader has no labels to show for such a record's values |

Each manifest's `status` field says which version is which, and it is the answer to trust in code.

## Categories

The payload's `category` field says what kind of object the passport describes. The list is open: the schema accepts any non-empty text, but use one of these values so that other readers can label it. Every `general@2` field applies to every category.

| Value | Label |
|---|---|
| `bicycle` | Bicycle |
| `watch` | Watch or clock |
| `instrument` | Musical instrument |
| `furniture` | Furniture |
| `luggage` | Luggage or leather goods |
| `jewellery` | Jewellery |
| `appliance` | Appliance or tool |
| `sportsEquipment` | Sports equipment |
| `artwork` | Artwork or object |

## Start from a sample payload

Run these in the root of a checkout of this repository on `main`, after `npm ci` and `npm run build` ([quick start](../quick-start.md)):

```sh
node examples/sample-payload.mjs general@2 --demonstration > payload.json
node examples/sample-payload.mjs --check general@2 payload.json
```

The first command writes this sample:

```json
{
  "notice": "Demonstration record: no real product stands behind this passport.",
  "careNote": "Example careNote",
  "category": "Example category",
  "manufacturer": "Example manufacturer",
  "manufacturerContact": "Example manufacturerContact",
  "materials": [
    {
      "part": "Example part",
      "material": "Example material"
    }
  ],
  "name": "Example name",
  "profile": "general",
  "profile_version": 2
}
```

`--demonstration` adds `notice`, the sentence a person reads first on a test or demonstration record, one that describes no real product and uses the GS1 demonstration prefix 952 ([identifiers](../identifiers.md)). Leave the flag out for a real product: a record about a real product must not carry `notice`.

Replace every placeholder with the product's own data and set `category` to one of the values above. Keep `profile` and `profile_version` as they are. The second command then prints `ok: payload.json is a valid general@2 public payload.` If anything is wrong it prints one `FAIL:` line per problem, such as a missing field, and exits with status 1.

## What the profile defines

| What | Count |
|---|---|
| Fields in the `general@2` manifest | 40: 34 public and 6 restricted (4 `owner`, 2 `legitimate`) |
| Properties the public schema accepts | 39: the 34 public fields, plus the five stamps every public payload may carry (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Properties the public schema requires | 8: six fields (`careNote`, `category`, `manufacturer`, `manufacturerContact`, `materials`, `name`) plus `profile` and `profile_version`. The sample fills exactly these |
| Properties the restricted schema accepts | 6, the restricted fields. It requires none |

## Inspect the fields

Run this in a project with `@bsv/dpp-profiles@0.3.0-beta.6` installed, or in the root of a checkout after `npm run build`:

```sh
node --input-type=module <<'JS'
import { readManifest, fieldsFor } from '@bsv/dpp-profiles'
const manifest = readManifest('general@2')
const { applies, needsReview, notApplicable } = fieldsFor(manifest, 'furniture')
console.table(applies.map(({ key, label, accessTier, obligation }) => ({ key, label, accessTier, obligation })))
const publicFields = manifest.fields.filter((field) => field.accessTier === 'public').length
console.log(`${manifest.fields.length} fields: ${publicFields} public, ${manifest.fields.length - publicFields} restricted`)
console.log(`furniture: ${applies.length} apply, ${notApplicable.length} do not, ${needsReview.length} need review`)
for (const field of needsReview) console.log(`review ${field.key}: ${field.applicability.condition}`)
JS
```

It prints a table of the 40 fields, then:

```
40 fields: 34 public, 6 restricted
furniture: 40 apply, 0 do not, 0 need review
```

Put your own category in place of `'furniture'`. In the table, `label` is what to show a person, `accessTier` says who may read the value and `obligation` says whether to insist on it (`required`, `recommended` or `optional`). The field reference on [@bsv/dpp-profiles](../packages/dpp-profiles.md) explains every field property.

## If something fails

- `Cannot find module '@bsv/dpp-profiles'`: in a checkout, run `npm run build` again and read its first error; in your own project, install the package at the exact version above.
- `"general@3" is not a published industry profile`: the identifier is not in the package's `PROFILE_IDS` list. Check its spelling.
- A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta. Name the exact version.

## Sources

| Material | Source |
|---|---|
| Current profile | [general@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/general@2.json) |
| Superseded profile | [general@1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/general@1.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/general@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |
| Digests of every version | [Frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) |

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md). If you read passports, [choose an industry profile](README.md#read-a-stored-payload-under-its-profile) says how to show a stored payload under the profile it declares.
