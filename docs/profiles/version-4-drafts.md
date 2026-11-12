# Evaluate the battery@4 draft

Application owners, readers and reviewers can use this page to generate a change report, evaluate a draft payload or label a stored payload correctly. `battery@4` succeeds the current `battery@2` as the one draft carried in `@bsv/dpp-profiles` 0.3.0-beta.10. The drafts `battery@3`, `textile@3` and `textile@4` are parked: no successor is proposed under them and no claim names them, and their manifests stay published and frozen because records may declare them ([parked drafts](#parked-textile4-and-the-version-3-drafts)).

The number after `@` is the profile version, separate from the record version and manifest format ([version names](README.md)). Drafts are published but never selected by default: name one explicitly. They cannot support conformance claims. Publishing them changed no current version: those bytes stay frozen.

Write new records under `battery@2` or `textile@2`. Draft evaluation prepares an application for cutover: the later reviewed step that makes a successor current. `textile@2` has no successor draft in progress.

## Before you start

| Task | Input and source |
|---|---|
| Generate reports and samples | Node.js 22 or later and a [checkout](../quick-start.md) at the reviewed example revision; prepare with `npm ci` and `npm run build`, then run commands at its root |
| Compare in your own application | The profile version it uses today and the `battery@4` draft |
| Read a live declared profile | The prepared checkout, or a project with `@bsv/sdk@2.8.10`, `@bsv/dpp-protocol@0.3.0-beta.10` and `@bsv/dpp-profiles@0.3.0-beta.10` installed; network access to the hosted reference index |
| Evaluate your product | Public and restricted fields together, category, jurisdiction and evaluation date |

**Install the exact version.** `npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.10`. A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta, which carries the drafts; name the exact version all the same.

## Try a draft in your application

### 1. Generate the change report

Compare the version your application uses today with the draft. Replace the first identifier if you use another version:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
```

The command prints JSON containing manifest statuses and SHA-256 digests, top-level changes such as identity rules, and added, changed or removed fields with their changed properties.

| Comparison | Field changes | Interpretation |
|---|---|---|
| `battery@2` to `battery@4` | 21 added, 105 changed | Current battery profile to draft |

Every current-profile field counts as changed because manifest format 2 adds `requirement`. Read each entry's `properties` to understand the change. In your own project, `compareProfiles(from, to)` returns the same report ([example](updating-applications.md#2-see-what-changed)). Attach it to the upgrade proposal; delivery to consumer owners is a separate workflow.

### 2. Check a sample payload against the draft

Make a sample, check it against the draft's public schema, then evaluate applicability and the draft's cross-field rules:

```sh
node examples/sample-payload.mjs battery@4 --demonstration > battery4.json
node examples/sample-payload.mjs --check battery@4 battery4.json
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { readManifestAny, categoryOf, missingRequiredV2, reviewProfileData } from '@bsv/dpp-profiles'

// An EV battery: the sample's category is the schema's first value, lmt.
const payload = { ...JSON.parse(readFileSync('battery4.json', 'utf8')), category: 'ev' }
const manifest = readManifestAny('battery@4')
const context = { category: categoryOf(manifest, payload), jurisdiction: 'EU', asOf: '2027-02-18' }
const registration = missingRequiredV2(manifest, payload, context)
const dataFindings = reviewProfileData('battery@4', payload)

const restricted = registration.missing.filter((field) => field.accessTier !== 'public').length
console.log(`missing ${registration.missing.length} (${restricted} restricted), unresolved ${registration.unresolved.length}, deferred ${registration.deferred.length}, findings ${dataFindings.length}`)
JS
```

It prints `ok: battery4.json is a valid battery@4 public payload.` and then:

```
missing 18 (11 restricted), unresolved 16, deferred 19, findings 0
```

| Result | Meaning and action |
|---|---|
| `missingRequiredV2`: `missing` | Applicable required fields captured at registration but absent; these block a write |
| `missingRequiredV2`: `unresolved` | Required fields with unsettled applicability; show them without blocking or counting them as satisfied |
| `missingRequiredV2`: `deferred` | Requirements anticipated, under review or not to be displayed; never count these as missing |
| `reviewProfileData`: `invalid` | Rejected data |
| `reviewProfileData`: `needs-review` | Retain for evidence review |

The sample contains only public fields, leaving 11 of 18 missing fields in the restricted `legitimate` tier. A real application's `payload` combines both parts. Validate the restricted part against `readRestrictedPayloadSchema('battery@4')` too; the sample check covers only the public part. Registration, applicability and cross-field findings are separate results.

| `context` input | Value and purpose |
|---|---|
| Category | Read from the payload with `categoryOf` |
| Jurisdiction | Where the evaluation applies |
| `asOf` | Evaluation date; `2027-02-18` is when battery passport obligations apply. Dated rules, including the due-diligence report's from 18 August 2027, use the evaluation date |

`reviewProfileData` checks manufacture-date consistency, individual measurement context and component declarations. It accepts only `battery@4` and the parked `textile@4`, which a stored record may still declare. An empty findings list does not certify readiness.

### 3. Update the application before enabling draft writes

Update its capture forms, adapters, backend checks and exports. [Update profiles and consuming applications](updating-applications.md) describes the rollout and the history requirements. None of this activates the draft in the reference application or any other consumer.

## Read a record that declares a draft

This reader checks that the package publishes a record's declared profile, then calls `readManifestAny` for the manifest and its current or draft status. The function types both manifest formats; the procedure works for any declared profile, including drafts written by other applications and the parked drafts, which stay published for that reason.

1. Save the following as `read-declared.mjs` in the prepared project or checkout. Run `node read-declared.mjs` to read a live passport from the hosted reference index.

```js
import { Beef } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs } from '@bsv/dpp-protocol'
import { PROFILE_IDS, readManifestAny } from '@bsv/dpp-profiles'

const index = 'https://dpp-overlay.bsvb.net'
const passportId = 'https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8'

const response = await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })
const { outputs } = await response.json()
if (!outputs?.length) throw new Error(`${index} holds no states for ${passportId}`)
const merged = Beef.fromBinary(outputs[0].beef)
for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
const tip = chainFromBeef(merged, passportId).at(-1)
const payload = JSON.parse(findDppOutputs(tip)[0].state.payloadPublic)

// The profile a record declares is the record's word: check that this package publishes it before reading it.
const declared = `${payload.profile}@${payload.profile_version}`
if (!PROFILE_IDS.includes(declared)) throw new Error(`${declared} is not a profile this package publishes`)
const manifest = readManifestAny(declared)
console.log(declared, manifest.status, manifest.title)
if (payload.notice) console.log('notice:', payload.notice)
```

2. Expect:

```
battery@4 draft Battery passport
notice: SAMPLE RECORD: demonstration data, not a real product. dpp.bsvb.net
```

3. Show the draft's own field labels and its draft status. Never substitute the current version. Show `notice` before product data.

| Failure | Action or meaning |
|---|---|
| Timeout | Retry; the hosted index is a single service |
| `holds no states` | This index does not hold the passport |

## What the draft changes

Review these reasons beside the complete field change report from step 1.

### Battery

| Change | Migration and application work |
|---|---|
| `manufacturingMonth` becomes required; `manufacturingDate` becomes optional | Derive the month from a valid recorded day when available. Accept a month-only source without inventing a day. If both are present, check they agree. |
| `manufacturerAddress.addressLine` becomes required | Obtain the actual postal delivery address or post-office box. City and country alone cannot supply it. A successful shape check does not verify deliverability. |
| `originalPowerCapability` captures power at 20% and 80% state of charge for EV and industrial categories | Capture both measurements, conditions, method and evidence. The legacy scalar remains the LMT representation. Never duplicate one scalar into both measurements. |
| New `*AtStatusChange` measurement arrays | Record individual power, resistance, efficiency and fade values with their item, method, time and evidence. Keep model baselines and state-of-health applicability separate. |
| `relatedDocuments` carries supporting metadata in the restricted payload | Resolve document content, media type, retention and audience before constructing external exports. This optional field does not satisfy all document obligations. |
| Due-diligence and proposal provenance corrected | The enacted future due-diligence date is distinct from an unadopted act. Scope and exemptions remain unresolved. Instructions-for-use proposal provenance does not establish enactment. |

The paired power measurements use the reference conditions in DIN DKE SPEC 99100:2025-02 clause 6.7.3.2. Their JSON representation is a profile choice. The measurement additions separate Annex XIII 4(a) individual performance from Article 14 state-of-health data. Neither addition proves that an operator has supplied all legally applicable lifecycle evidence.

## Assessment work still open

Before considering promotion of `battery@4`, collect the evidence described in [the readiness review](reviewing-readiness.md). These items remain open:

| Missing evidence or work | Status |
|---|---|
| Complete external-format export adapter; hosted readiness-test result; full current-law reconciliation; licensed-standard assessment; deployed actor and access evidence | Not included in the drafts |
| Additional identity context; category classification; evidence qualification; measurement semantics | Still need review |

## History

The version 4 drafts were first published in 0.3.0-beta.2; the [beta.2 publication receipt](../reference/publication-history/beta-2-publication.md) records the source and package bytes that first carried them. Installing `0.3.0-beta.1` does not obtain them. Version 2 remains current, and every version 3 manifest and generated artefact remains unchanged. Package publication does not activate the drafts in an application. On 12 November 2026 `battery@3`, `textile@3` and `textile@4` were parked, with no byte of their manifests or generated files changed.

## Parked: textile@4 and the version 3 drafts

`battery@3`, `textile@3` and `textile@4` were parked on 12 November 2026. They stay published in `@bsv/dpp-profiles` byte for byte at their frozen digests, so a record that declares one is still read under it, and `reviewProfileData` still accepts `textile@4`. No successor is proposed under them, no conformance claim names them, and a new application evaluates `battery@4` alone. The hosted reference holds a live passport that declares `textile@4` ([hosted reference](../deployment.md)).

| Comparison | Field changes | Interpretation |
|---|---|---|
| `textile@2` to `textile@4` | 11 added, 49 changed | Current textile profile to the parked draft |
| `battery@3 battery@4` | 9 added, 9 changed | Corrections since the parked battery draft |
| `textile@3 textile@4` | 17 changed | Corrections between the two parked textile drafts |

### What textile@4 changed

| Change | Application work and limits |
|---|---|
| Anticipated passport requirements separated from existing labelling duties and application choices | Framework provisions do not make every named passport field legally mandatory. Care codes, origin, expected lifetime, collection instructions and chemical documents retain their application purpose without claiming the cited provision mandates each exact field |
| `componentFibres` cites Article 11 of Regulation (EU) 1007/2011 as its existing basis | Assess components and exceptions before settling applicability. Never replace required component declarations with a whole-product average |
| Cross-field component checks | Review unresolved component references and reconcile component share totals. The helper decides neither legal exemptions nor analytical tolerances |
| Sustainability-label metadata | Records certification-scheme and public-authority alternatives, consumer-directive provisions and their application date. It does not require every textile to obtain certification |
| Guarantee information | Remains conditional on the actual offer and applicable national measures |
| Model identity references `modelIdentifier` | A display name is not an identifier |

## Next

Application owners continue with [update profiles and consuming applications](updating-applications.md) for the rollout. Reviewers continue with [the readiness review](reviewing-readiness.md).
