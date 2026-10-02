# Textile

The textile profile, `textile@2`, is the product data for clothing, footwear, home textiles and textile accessories: composition, care, origin and the evidence behind them, and who may read each value. Use this page to start a payload from a sample that passes, see the categories and fields the profile defines, and inspect them in code.

A shared schema lets producers and readers use the same declared fields, but it does not turn an unassessed declaration into verified evidence. To compare the profile with the sources that apply to a product, use [the readiness review](reviewing-readiness.md).

## Versions

A version on this page is the profile version, the number after `@`, which a payload declares in `profile_version`. It is not the record version of the passport format or the manifest format ([choose an industry profile](README.md) explains all three).

| Version | Status | Use it to |
|---|---|---|
| `textile@2` | `current` | Write new records |
| `textile@4` | `draft` | Evaluate the next version before it becomes current. It corrects source-status mappings and component composition ([evaluate the version 4 drafts](version-4-drafts.md)). An application uses it only by naming it |
| `textile@3` | `draft` | Skip it: `textile@4` succeeds it. It stays published and frozen as the step between the two |
| `textile@1` | `superseded` | Read records that declare it. Its 13 fields carry names, labels, obligations and tiers only, with no types, units or constraints |

Each manifest's `status` field says which version is which, and it is the answer to trust in code: `readManifestAny('textile@4').status` is `draft`. Select a draft explicitly for evaluation; never apply it silently to existing records.

## Categories

The payload's `category` field says what kind of product the passport describes. The list is open: the schema accepts any non-empty text, but use one of these values so that other readers can label it. Every `textile@2` field applies to every category, and two need a person's review (see [inspect the fields](#inspect-the-fields)).

| Value | Label |
|---|---|
| `apparel` | Clothing |
| `footwear` | Footwear |
| `home` | Home textile |
| `accessory` | Accessory |

## Start from a sample payload

Run these in the root of a checkout of this repository on `main`, after `npm ci` and `npm run build` ([quick start](../quick-start.md)):

```sh
node examples/sample-payload.mjs textile@2 --demonstration > payload.json
node examples/sample-payload.mjs --check textile@2 payload.json
```

The first command writes this sample:

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

`--demonstration` adds `notice`, the sentence a person reads first on a test or demonstration record, one that describes no real product and uses the GS1 demonstration prefix 952 ([identifiers](../identifiers.md)). Leave the flag out for a real product: a record about a real product must not carry `notice`.

Replace every placeholder with the product's own data and set `category` to one of the values above. Keep `profile` and `profile_version` as they are. The second command then prints `ok: payload.json is a valid textile@2 public payload.` If anything is wrong it prints one `FAIL:` line per problem and exits with status 1, for example:

```
FAIL: the payload is missing the required field `name`.
FAIL: `manufacturingPlace.country` must match pattern "^[A-Z]{2}$".
```

## What the profile defines

| What | Count |
|---|---|
| Fields in the `textile@2` manifest | 49: 41 public and 8 restricted (4 `owner`, 3 `legitimate`, 1 `authority`) |
| Properties the public schema accepts | 46: the 41 public fields, plus the five stamps every public payload may carry (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Properties the public schema requires | 12: ten fields (`batch`, `care`, `category`, `collection`, `fibres`, `manufacturer`, `manufacturerContact`, `manufacturingPlace`, `modelIdentifier`, `name`) plus `profile` and `profile_version`. The sample fills exactly these |
| Properties the restricted schema accepts | 8, the restricted fields. It requires none |

The manifest also marks `nonTextileParts` and `substancesOfConcern` `required`, but only under a condition a person must review, so the schema does not require them. Show them as open questions, never as satisfied or as always required.

## Inspect the fields

Run this in a project with `@bsv/dpp-profiles@0.3.0-beta.6` installed, or in the root of a checkout after `npm run build`:

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

Put your own category in place of `'apparel'`. In the table, `label` is what to show a person, `accessTier` says who may read the value and `obligation` says whether to insist on it (`required`, `recommended` or `optional`). The field list is where payload integration starts: the generated schema checks structure, applicability needs evaluating, and source assessments stay unresolved where the ledger leaves them so. The field reference on [@bsv/dpp-profiles](../packages/dpp-profiles.md) explains every field property, and why a missing-field check is not a complete assessment.

## If something fails

- `Cannot find module '@bsv/dpp-profiles'`: in a checkout, run `npm run build` again and read its first error; in your own project, install the package at the exact version above.
- `FAIL:` lines from `--check`: each names one field; fix it and check again.
- A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta. Name the exact version.

## Sources

| Material | Source |
|---|---|
| Current profile | [textile@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@2.json) |
| Drafts | [textile@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@3.json), [textile@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@4.json) |
| Superseded profile, still readable | [textile@1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@1.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/textile@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) defines version selection and applicability, and the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records assessment evidence. The drafts do not establish product qualification.

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md). When a profile change affects your forms, backend rules or new records, follow [update profiles and consuming applications](updating-applications.md). To propose a change, see [author and propose a profile](authoring.md).
