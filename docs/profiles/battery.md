# Battery

Battery passport writers and readers can use this page to prepare a `battery@2` payload, inspect fields for a category and interpret lifecycle mappings. The profile defines identity, chemistry, composition, performance, durability, carbon and due-diligence declarations, including who may read each value.

Profile selection and schema validation establish neither conformity with Regulation (EU) 2023/1542 nor document completeness. Use [the readiness review](reviewing-readiness.md) to compare the profile with the regulation, a standard or an external validator.

## Before you start

| Task | Input and source |
|---|---|
| Run examples | Node.js 22 or later; see [runtime requirements](../start/for-agents.md#facts-to-rely-on) |
| Generate and check samples or inspect the lifecycle fixture | [Repository checkout](../quick-start.md) at the reviewed example revision, prepared with `npm ci` and `npm run build`; run commands at its root |
| Inspect fields without a checkout | A project with `@bsv/dpp-profiles@0.3.0-beta.7` installed; alternatively use the checkout after `npm run build` |
| Replace sample data | Product data and a category from the list below; public and restricted fields together for the registration check |

## Versions

The number after `@` is the profile version declared by `profile_version`, separate from the record version and manifest format ([version names](README.md)).

| Version | Status | Use it to |
|---|---|---|
| `battery@2` | `current` | Write new records |
| `battery@4` | `draft` | Evaluate the next version before it becomes current ([evaluate the battery@4 draft](version-4-drafts.md)). An application uses it only by naming it |
| `battery@3` | `draft`, parked | Skip it: `battery@4` succeeds it. Parked on 12 November 2026, it stays published and frozen so a record that declares it is still read ([parked drafts](version-4-drafts.md#parked-textile4-and-the-version-3-drafts)) |

Use the manifest's `status` in code: `readManifestAny('battery@4').status` is `draft`.

## Categories

Set `category` to one of these four values; the list is closed. Category determines applicability: 18 of the 105 fields apply only to some categories.

| Value | Label | Applicable fields |
|---|---|---|
| `lmt` | Light transport | 97 |
| `ev` | Vehicle | 91 |
| `industrial` | Industrial | 87 |
| `stationary` | Stationary storage | 100 |

## Start from a sample payload

1. Generate the sample with the first command:

```sh
node examples/sample-payload.mjs battery@2 --demonstration > payload.json
node examples/sample-payload.mjs --check battery@2 payload.json
```

2. Replace every placeholder with battery data. Change the sample's `category` from `lmt`, the first listed value, to your category. Keep `profile` and `profile_version` (`"battery"` and `2`).
3. Run the second command and resolve every failure before using the payload.

| Input or result | Value |
|---|---|
| Generated public data | The 53 required properties, with correctly shaped placeholders |
| `--demonstration` | Adds `"notice": "Demonstration record: no real product stands behind this passport."` first |
| Demonstration scope | Tests or demonstrations with no real product, using GS1 prefix 952 ([identifiers](../identifiers.md)); show `notice` first |
| Real product | Omit the flag; the record must not carry `notice` |
| Success | `ok: payload.json is a valid battery@2 public payload.` |
| Failure | One `FAIL:` line per problem, such as a missing field or country code other than two letters; exit status 1 |

## What the profile defines

| What | Count |
|---|---|
| Fields in the `battery@2` manifest | 105: 64 public and 41 restricted (40 `legitimate`, 1 `authority`) |
| Accepted public properties | 69: the 64 public fields, plus five public payload stamps (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Required public properties | 53: 51 fields plus `profile` and `profile_version`. The sample fills exactly these |
| Accepted restricted properties | 41, the restricted fields. It requires 12: `capacityFade`, `dismantlingManual`, `electrodeMaterials`, `expectedYears`, `partNumbersUrl`, `powerFade`, `resistanceIncreasePack`, `roundTripFade`, `safetyMeasures`, `sparePartsAddress`, `sparePartsEmail` and `sparePartsUrl` |

### Schema and registration requirements

The manifest marks six more public fields `required` than the schema requires:

| Fields | When to supply them |
|---|---|
| `exhaustionThreshold` | At registration for `ev` batteries only |
| `elementSymbols`, `carbonFootprintLabel`, `carbonGeneralInfo`, `recycledShareTotal`, `declarationOfConformity` | Calculated from other values or added later; fill these five after registration |

A schema-valid payload can still lack applicable fields. Call `missingRequired(manifest, payload, category)` with public and restricted fields together. It lists absent, required fields captured at registration that apply to the category; it does not establish schema validity or assess the product.

Save this [completeness example](../packages/dpp-profiles.md) as `inspect-fields.mjs` and run `node inspect-fields.mjs` in the prepared checkout or installed project:

```js
import { readManifest, fieldsFor, missingRequired } from '@bsv/dpp-profiles'

const manifest = readManifest('battery@2')
const gaps = missingRequired(manifest, {}, 'industrial')
console.log('an empty payload lacks', gaps.missing.length, 'required fields, starting with', gaps.missing.slice(0, 3).map(({ key }) => key).join(', '))
```

Expected result:

```
an empty payload lacks 63 required fields, starting with serial, modelName, manufacturer
```

Substitute your combined fields and category for the empty object and `industrial`. Resolve applicable registration gaps before writing.

## Inspect the fields

Inspect the fields:

```sh
node --input-type=module <<'JS'
import { readManifest, fieldsFor } from '@bsv/dpp-profiles'
const manifest = readManifest('battery@2')
const { applies, needsReview, notApplicable } = fieldsFor(manifest, 'ev')
console.table(applies.map(({ key, label, accessTier, obligation }) => ({ key, label, accessTier, obligation })))
const publicFields = manifest.fields.filter((field) => field.accessTier === 'public').length
console.log(`${manifest.fields.length} fields: ${publicFields} public, ${manifest.fields.length - publicFields} restricted`)
console.log(`ev: ${applies.length} apply, ${notApplicable.length} do not, ${needsReview.length} need review`)
for (const field of needsReview) console.log(`review ${field.key}: ${field.applicability.condition}`)
JS
```

It prints a table of the 91 fields that apply to a vehicle battery, then:

```
105 fields: 64 public, 41 restricted
ev: 91 apply, 14 do not, 0 need review
```

Replace `'ev'` with your category; expected counts are listed above. Display `label` to the reader; `accessTier` identifies allowed readers, and `obligation` is `required`, `recommended` or `optional`. The [package field reference](../packages/dpp-profiles.md) explains every property.

## See how lifecycle events map

A passport operation, such as a transfer of control, maps to an external lifecycle event type only with the required evidence.

| Outcome | Meaning |
|---|---|
| `lossless` | Every fact has an external counterpart |
| `transformed` | Mapped, with losses listed |
| `insufficient-data` | Required evidence missing |
| `unsupported` | Profile defines no mapping |

Run this to inspect each state's result in the synthetic battery fixture:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/battery-lifecycle-v1.json', 'utf8'))
for (const { op, mapping } of fixture.states) console.log(op, mapping.eventType, mapping.outcome, mapping.missingEvidence.join(', '))
JS
```

It prints:

```
ACTIVATE Origin transformed
SOLD Transfer lossless
TRANSFER Transfer insufficient-data custodyRecord
REPAIRED Transformation lossless
EDIT Transformation transformed
RECYCLED Disposition lossless
```

`TRANSFER` changed record control without a custody record, so its mapping is `insufficient-data`. Record control does not establish battery delivery; show that finding beside the event.

The fixture uses record version 1. New writers use version 2, with the same mapping rules: `ISSUE` as `ACTIVATE`, `UPDATE` as `EDIT`, `TRANSFER` as itself and `RETIRE` as `RECYCLED`. `mapNativeOperation(readManifest('battery@2'), { nativeOperation: 'TRANSFER' })` with no evidence returns `outcome: 'insufficient-data'` and `missingEvidence: ['custodyRecord']`. Where that evidence comes from is partly open: a native claim has no payload, so it cannot carry these evidence facets ([known limitations](../operate/limitations.md)).

## If something fails

- `Cannot find module '@bsv/dpp-profiles'`: in a checkout, run `npm run build` again and read its first error; in your own project, install the package at the exact version above.
- `FAIL:` lines from `--check`: each names one field; fix it and check again.
- A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta. Name the exact version.

## Assessment status

The standard makes no product-compliance claim: the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) carries no battery Annex XIII qualification row or battery passport qualification claim, and the Annex XIII citations in the profile data name legal bases without assessing them. `battery@2` uses manifest format 1, so its fields carry no requirement status (enacted, anticipated, under review) of the kind the drafts add, and none of its fields is assigned to the groups it lists. The drafts do not establish legal adequacy.

## Sources

| Material | Source |
|---|---|
| Current profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@2.json) |
| Draft, and the parked earlier draft | [battery@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@3.json), [battery@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@4.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |
| Synthetic lifecycle | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/battery-lifecycle-v1.json). Its product data is invented; no such battery exists |

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md), and check the restricted fields against `readRestrictedPayloadSchema('battery@2')` before you encrypt them. To prepare for the next version, [evaluate the battery@4 draft](version-4-drafts.md). To propose a change, see [author and propose a profile](authoring.md).
