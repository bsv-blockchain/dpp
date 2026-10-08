# Battery

The battery profile, `battery@2`, is the product data for a battery passport: identity, chemistry and composition, performance and durability, carbon and due-diligence declarations, and who may read each value. Use this page to start a payload from a sample that passes, see the categories and fields the profile defines, inspect them for your category and see how lifecycle events map.

Choosing the profile and passing its schema check do not establish that a battery meets Regulation (EU) 2023/1542 or that every required document exists. To compare the profile with the regulation, a standard or an external validator, use [the readiness review](reviewing-readiness.md).

## Versions

A version on this page is the profile version, the number after `@`, which a payload declares in `profile_version`. It is not the record version of the passport format or the manifest format ([choose an industry profile](README.md) explains all three).

| Version | Status | Use it to |
|---|---|---|
| `battery@2` | `current` | Write new records |
| `battery@4` | `draft` | Evaluate the next version before it becomes current ([evaluate the version 4 drafts](version-4-drafts.md)). An application uses it only by naming it |
| `battery@3` | `draft` | Skip it: `battery@4` succeeds it. It stays published and frozen as the step between the two |

Each manifest's `status` field says which version is which, and it is the answer to trust in code: `readManifestAny('battery@4').status` is `draft`.

## Categories

The payload's `category` field says what kind of battery the passport describes, and it decides which fields apply: 18 of the 105 fields apply to some categories only. The list is closed, so the schema accepts only these four values.

| Value | Label |
|---|---|
| `lmt` | Light transport |
| `ev` | Vehicle |
| `industrial` | Industrial |
| `stationary` | Stationary storage |

## Start from a sample payload

Run these in the root of a checkout of this repository at the reviewed example revision, after `npm ci` and `npm run build` ([quick start](../quick-start.md)):

```sh
node examples/sample-payload.mjs battery@2 --demonstration > payload.json
node examples/sample-payload.mjs --check battery@2 payload.json
```

The first command writes a sample that starts with `"notice": "Demonstration record: no real product stands behind this passport."` and then holds the 53 properties the public schema requires, each with a placeholder of the right shape.

`--demonstration` adds that `notice`, the sentence a person reads first on a test or demonstration record, one that describes no real product and uses the GS1 demonstration prefix 952 ([identifiers](../identifiers.md)). Leave the flag out for a real product: a record about a real product must not carry `notice`.

Replace every placeholder with the battery's own data. The sample's `category` is `lmt`, the first value of the list; set your own. Keep `profile` and `profile_version` (`"battery"` and `2`). The second command then prints `ok: payload.json is a valid battery@2 public payload.` If anything is wrong it prints one `FAIL:` line per problem, such as a missing field or a country that is not a two-letter code, and exits with status 1.

## What the profile defines

| What | Count |
|---|---|
| Fields in the `battery@2` manifest | 105: 64 public and 41 restricted (40 `legitimate`, 1 `authority`) |
| Properties the public schema accepts | 69: the 64 public fields, plus the five stamps every public payload may carry (`notice`, `profile`, `profile_version`, `object_did`, `dataCarrier`) |
| Properties the public schema requires | 53: 51 fields plus `profile` and `profile_version`. The sample fills exactly these |
| Properties the restricted schema accepts | 41, the restricted fields. It requires 12: `capacityFade`, `dismantlingManual`, `electrodeMaterials`, `expectedYears`, `partNumbersUrl`, `powerFade`, `resistanceIncreasePack`, `roundTripFade`, `safetyMeasures`, `sparePartsAddress`, `sparePartsEmail` and `sparePartsUrl` |

The manifest marks six more public fields `required` than the schema requires. Five are calculated from other values or added later (`elementSymbols`, `carbonFootprintLabel`, `carbonGeneralInfo`, `recycledShareTotal`, `declarationOfConformity`), and `exhaustionThreshold` applies to `ev` batteries only. So a payload can pass the schema and still lack a field that applies to it. `missingRequired(manifest, payload, category)` lists the required fields, public and restricted, that are captured at registration, apply to the category and are absent; pass it the public and restricted fields together. The five calculated or later fields are filled in after registration.

## Inspect the fields

Run this in a project with `@bsv/dpp-profiles@0.3.0-beta.7` installed, or in the root of a checkout after `npm run build`:

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

Put your own category in place of `'ev'`: `lmt` gives 97 fields, `industrial` 87 and `stationary` 100. In the table, `label` is what to show a person, `accessTier` says who may read the value and `obligation` says whether to insist on it (`required`, `recommended` or `optional`). The field reference on [@bsv/dpp-profiles](../packages/dpp-profiles.md) explains every field property.

## See how lifecycle events map

A passport records operations, such as a transfer of control. The profile maps each operation to an external lifecycle event type only when the evidence it asks for is present, and the result is one of four outcomes: `lossless` (every fact has an external counterpart), `transformed` (mapped, with what was lost listed), `insufficient-data` (the evidence is missing) or `unsupported` (the profile declares no mapping). The synthetic battery fixture shows each state's result. Run this in the root of a checkout:

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

The `TRANSFER` moved control of the record, but no custody record was put forward, so it maps as `insufficient-data`. Changing control of a record does not establish delivery of a battery: keep that finding beside the event when you show it.

The fixture uses record version 1 operations. Record version 2 operations, which new writers use, map under the same rules: `ISSUE` as `ACTIVATE`, `UPDATE` as `EDIT`, `TRANSFER` as itself and `RETIRE` as `RECYCLED`. For example, `mapNativeOperation(readManifest('battery@2'), { nativeOperation: 'TRANSFER' })` with no evidence returns `outcome: 'insufficient-data'` and `missingEvidence: ['custodyRecord']`. Where that evidence comes from is partly open: a native claim has no payload, so it cannot carry these evidence facets ([known limitations](../operate/limitations.md)).

## If something fails

- `Cannot find module '@bsv/dpp-profiles'`: in a checkout, run `npm run build` again and read its first error; in your own project, install the package at the exact version above.
- `FAIL:` lines from `--check`: each names one field; fix it and check again.
- A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta. Name the exact version.

## Assessment status

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) marks the battery Annex XIII mapping `unassessed` and withholds the battery passport qualification claim. `battery@2` uses manifest format 1, so its fields carry no requirement status (enacted, anticipated, under review) of the kind the drafts add, and none of its fields is assigned to the groups it lists. The drafts do not close those assessments or establish legal adequacy.

## Sources

| Material | Source |
|---|---|
| Current profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@2.json) |
| Drafts | [battery@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@3.json), [battery@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@4.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated) |
| Synthetic lifecycle | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/battery-lifecycle-v1.json). Its product data is invented; no such battery exists |

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md), and check the restricted fields against `readRestrictedPayloadSchema('battery@2')` before you encrypt them. To prepare for the next version, [evaluate the version 4 drafts](version-4-drafts.md). To propose a change, see [author and propose a profile](authoring.md).
