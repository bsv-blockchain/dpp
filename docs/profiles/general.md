# General

Passport writers and readers can use `general@2` for products no sector profile covers, such as bicycles, watches or furniture. Start with a valid sample, choose a category and inspect the product fields before integrating them.

The profile claims no regulation. Choosing it does not mean battery or textile rules stop applying to a product they cover; for those products use [battery](battery.md) or [textile](textile.md).

## Before you start

| Task | Input and source |
|---|---|
| Run examples | Node.js 22 or later; see [runtime requirements](../start/for-agents.md#facts-to-rely-on) |
| Generate and check samples | [Repository checkout](../quick-start.md) at the reviewed example revision, prepared with `npm ci` and `npm run build`; run commands at its root |
| Inspect fields without a checkout | A project with `@bsv/dpp-profiles@0.3.0-beta.7` installed; alternatively use the checkout after `npm run build` |
| Replace sample data | Product data and a category from the list below |

## Versions

The number after `@` is the profile version declared by `profile_version`, separate from the record version and manifest format ([version names](README.md)).

| Version | Status | Use it to |
|---|---|---|
| `general@2` | `current` | Write new records |
| `general@1` | `superseded` | Read records that declare it. It defines no fields, so a reader has no labels to show for such a record's values |

Use the manifest's `status` as the version status in code.

## Categories

`category` identifies the object type. This open list accepts any non-empty text; choose a listed value so readers can label it. Every `general@2` field applies to every category.

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

1. Generate the sample with the first command:

```sh
node examples/sample-payload.mjs general@2 --demonstration > payload.json
node examples/sample-payload.mjs --check general@2 payload.json
```

Generated sample:

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

2. Replace every placeholder with product data and choose `category` from the list above.
3. Run the second command. Resolve every reported problem and check again before using the payload.

| Input or result | Rule |
|---|---|
| `--demonstration` | Adds `notice` as the sentence shown first; use it for tests or demonstrations with no real product and GS1 prefix 952 ([identifiers](../identifiers.md)) |
| Real product | Omit the flag; the record must not carry `notice` |
| `profile`, `profile_version` | Keep their generated values |
| Success | `ok: payload.json is a valid general@2 public payload.` |
| Failure | One `FAIL:` line per problem, such as a missing field; exit status 1 |


## What the profile defines

| What | Count |
|---|---|
| Fields in the `general@2` manifest | 40: 34 public and 6 restricted (4 `owner`, 2 `legitimate`) |
| Accepted public properties | 39: the 34 public fields, plus five public payload stamps (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Required public properties | 8: six fields (`careNote`, `category`, `manufacturer`, `manufacturerContact`, `materials`, `name`) plus `profile` and `profile_version`. The sample fills exactly these |
| Accepted restricted properties | 6, the restricted fields. It requires none |

## Inspect the fields

Inspect the fields:

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

Replace `'furniture'` with your category. Display `label` to the reader; `accessTier` identifies allowed readers, and `obligation` is `required`, `recommended` or `optional`. The [package field reference](../packages/dpp-profiles.md) explains every property.

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
