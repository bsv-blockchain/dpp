# Textile

Passport writers and readers can use this page to prepare a `textile@2` payload and inspect its categories and fields. The profile covers clothing, footwear, home textiles and textile accessories: composition, care, origin, supporting evidence and who may read each value.

A shared schema lets producers and readers use the same declared fields, but it does not turn an unassessed declaration into verified evidence. To compare the profile with the sources that apply to a product, use [the readiness review](reviewing-readiness.md).

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
| `textile@2` | `current` | Write new records |
| `textile@4` | `draft`, parked | Read records that declare it. Parked on 12 November 2026: no successor to `textile@2` is proposed, and it stays published and frozen ([parked drafts](version-4-drafts.md#parked-textile4-and-the-version-3-drafts)) |
| `textile@3` | `draft`, parked | Read records that declare it. Parked with `textile@4`, which succeeded it |
| `textile@1` | `superseded` | Read records that declare it. Its 13 fields carry names, labels, obligations and tiers only, with no types, units or constraints |

Use the manifest's `status` in code: `readManifestAny('textile@4').status` is `draft`. Never apply a draft silently to existing records.

## Categories

`category` identifies the product type. This open list accepts any non-empty text; choose a listed value so readers can label it. Every `textile@2` field applies to every category; two need human review ([inspect the fields](#inspect-the-fields)).

| Value | Label |
|---|---|
| `apparel` | Clothing |
| `footwear` | Footwear |
| `home` | Home textile |
| `accessory` | Accessory |

## Start from a sample payload

1. Generate the sample with the first command:

```sh
node examples/sample-payload.mjs textile@2 --demonstration > payload.json
node examples/sample-payload.mjs --check textile@2 payload.json
```

Generated sample:

```json
{
  "notice": "Demonstration record: no real product stands behind this passport.",
  "batch": "Example batch",
  "care": [
    "wash30"
  ],
  "category": "Example category",
  "collection": "Example collection",
  "fibres": [
    {
      "fibre": "Example fibre",
      "percent": 0
    }
  ],
  "manufacturer": "Example manufacturer",
  "manufacturerContact": "Example manufacturerContact",
  "manufacturingPlace": {
    "city": "Example city",
    "country": "DE"
  },
  "modelIdentifier": "Example modelIdentifier",
  "name": "Example name",
  "profile": "textile",
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
| Success | `ok: payload.json is a valid textile@2 public payload.` |
| Failure | One `FAIL:` line per problem and exit status 1 |

Example failures:

```
FAIL: the payload is missing the required field `name`.
FAIL: `manufacturingPlace.country` must match pattern "^[A-Z]{2}$".
```

## What the profile defines

| What | Count |
|---|---|
| Fields in the `textile@2` manifest | 49: 41 public and 8 restricted (4 `owner`, 3 `legitimate`, 1 `authority`) |
| Accepted public properties | 46: the 41 public fields, plus five public payload stamps (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Required public properties | 12: ten fields (`batch`, `care`, `category`, `collection`, `fibres`, `manufacturer`, `manufacturerContact`, `manufacturingPlace`, `modelIdentifier`, `name`) plus `profile` and `profile_version`. The sample fills exactly these |
| Accepted restricted properties | 8, the restricted fields. It requires none |

| Conditional field | Review needed |
|---|---|
| `nonTextileParts` | Whether the product contains non-textile parts of animal origin |
| `substancesOfConcern` | Whether a substance of concern exceeds the threshold the act will set |

The manifest marks both `required`, subject to human review, so the schema does not require them. Show them as open questions, never as satisfied or always required.

## Inspect the fields

Inspect the fields:

```sh
node --input-type=module <<'JS'
import { readManifest, fieldsFor } from '@bsv/dpp-profiles'
const manifest = readManifest('textile@2')
const { applies, needsReview, notApplicable } = fieldsFor(manifest, 'apparel')
console.table(applies.map(({ key, label, accessTier, obligation }) => ({ key, label, accessTier, obligation })))
const publicFields = manifest.fields.filter((field) => field.accessTier === 'public').length
console.log(`${manifest.fields.length} fields: ${publicFields} public, ${manifest.fields.length - publicFields} restricted`)
console.log(`apparel: ${applies.length} apply, ${notApplicable.length} do not, ${needsReview.length} need review`)
for (const field of needsReview) console.log(`review ${field.key}: ${field.applicability.condition}`)
JS
```

It prints a table of the 47 fields that apply, then:

```
49 fields: 41 public, 8 restricted
apparel: 47 apply, 0 do not, 2 need review
review nonTextileParts: the product contains non-textile parts of animal origin
review substancesOfConcern: a substance of concern is present above the threshold the act will set
```

Replace `'apparel'` with your category. Display `label` to the reader; `accessTier` identifies allowed readers, and `obligation` is `required`, `recommended` or `optional`. Start integration from these fields: schema checks establish structure, applicability needs evaluation, and source assessments remain unresolved where the ledger leaves them. The [package field reference](../packages/dpp-profiles.md) explains each property and why checking missing fields is not a complete assessment.

## If something fails

- `Cannot find module '@bsv/dpp-profiles'`: in a checkout, run `npm run build` again and read its first error; in your own project, install the package at the exact version above.
- `FAIL:` lines from `--check`: each names one field; fix it and check again.
- A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta. Name the exact version.

## Sources

| Material | Source |
|---|---|
| Current profile | [textile@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@2.json) |
| Parked drafts, still readable | [textile@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@3.json), [textile@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@4.json) |
| Superseded profile, still readable | [textile@1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@1.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/textile@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) defines version selection and applicability, and the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records assessment evidence. The parked drafts do not establish product qualification.

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md). When a profile change affects your forms, backend rules or new records, follow [update profiles and consuming applications](updating-applications.md). To propose a change, see [author and propose a profile](authoring.md).
