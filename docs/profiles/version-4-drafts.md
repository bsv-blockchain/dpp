# Evaluate the version 4 drafts

`battery@4` and `textile@4` are draft successors to the current `battery@2` and `textile@2`, carried in `@bsv/dpp-profiles` 0.3.0-beta.6. This page is for application owners who want to try a draft before it becomes current, readers who meet records that declare one, and reviewers checking what the drafts change; each has its own section.

A version on this page is the profile version, the number after `@`; it is not the record version of the passport format or the manifest format ([choose an industry profile](README.md) explains all three). A draft is published but never selected by default: an application uses one only by naming it, a conformance claim cannot rest on it, and publishing it changed nothing in the current versions, whose bytes stay frozen. Each version 4 draft succeeds a version 3 draft (`battery@3`, `textile@3`), which stays published and frozen; evaluate version 4.

**Do you need them?** To write new records, no: write under `battery@2` or `textile@2`. Evaluate a draft to prepare your application for the cutover, the later, reviewed step that makes a successor current.

**Install the exact version.** `npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.6`. A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, which is still beta.1 and does not carry the drafts.

## Try a draft in your application

Run these in the root of a checkout of this repository on `main`, after `npm ci` and `npm run build` ([quick start](../quick-start.md)).

### 1. Generate the change report

Compare the version your application uses today with the draft. Replace the first identifier if you use another version:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
npm run changes -w @bsv/dpp-profiles -- textile@2 textile@4
```

Each prints a JSON report: each manifest's status and SHA-256 digest, the top-level changes such as identity rules, and one entry per added, changed or removed field with the properties that changed. `battery@2` to `battery@4` lists 21 fields added and 105 changed, and `textile@2` to `textile@4` 11 added and 49 changed. Every field counts as changed because manifest format 2 adds a `requirement` to each, so read each entry's `properties`. To see only what version 4 corrected in the version 3 draft, compare `battery@3 battery@4` (9 added, 9 changed) or `textile@3 textile@4` (17 changed). In your own project, `compareProfiles(from, to)` returns the same report ([update profiles and consuming applications](updating-applications.md#2-see-what-changed) shows the call). Attach the report to the upgrade proposal; delivering it to consumer owners is a separate workflow.

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

- `missingRequiredV2` returns three lists. `missing` holds required fields that apply, are captured at registration and are absent: these block a write. `unresolved` holds required fields whose applicability is not settled: show them, and never block on them or count them as satisfied. `deferred` holds fields whose requirement is anticipated, under review or not to be displayed: never count them as missing.
- In a real application, `payload` holds the public and restricted fields together in one object. Here 11 of the 18 missing fields are restricted (`legitimate` tier), because the sample holds only public fields.
- `context` is what the evaluation is for: the category, read from the payload with `categoryOf`, the jurisdiction, and `asOf`, the date of the evaluation. `2027-02-18` is the date from which the battery passport obligations apply; rules with dates, such as the due-diligence report's from 18 August 2027, read it.
- `reviewProfileData` returns `invalid` findings, which are rejected data, and `needs-review` findings, which are kept for evidence review, for manufacture-date consistency, individual measurement context and component declarations. An empty list does not certify readiness, and the helper refuses any profile other than `battery@4` and `textile@4`.

Validate the restricted payload against `readRestrictedPayloadSchema('battery@4')` as well; the sample check covers only the public one. Registration, applicability and cross-field results are separate results.

### 3. Update the application before enabling draft writes

Update its capture forms, adapters, backend checks and exports. [Update profiles and consuming applications](updating-applications.md) describes the rollout and the history requirements. None of this activates the draft in the reference application or any other consumer.

## Read a record that declares a draft

A reader meets drafts in records other applications wrote. Read the profile a state declares, check that the package publishes it, then read its manifest with `readManifestAny`, which types both manifest formats and says whether the profile is current. The same steps work for any declared profile.

Save this as `read-declared.mjs` in a project with `@bsv/sdk@2.8.10`, `@bsv/dpp-core@0.3.0-beta.6` and `@bsv/dpp-profiles@0.3.0-beta.6` installed, or in the root of a checkout, and run `node read-declared.mjs`. It reads a live passport from the hosted reference index, so it needs network access.

```js
import { Beef } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs } from '@bsv/dpp-core'
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

It prints:

```
battery@4 draft Battery passport
notice: SAMPLE RECORD: demonstration data, not a real product. dpp.bsvb.net
```

Show a draft's fields under the draft's own labels and say that it is a draft; never read the payload under the current version instead. Show `notice` before the product data. If the request times out, run it again: the hosted index is a single service. If it throws `holds no states`, the index does not hold that passport.

## What the drafts change

These sections are for reviewers. The change report in step 1 lists every field change; these summarise why.

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

### Textile

The draft separates anticipated textile passport requirements from existing labelling duties and application field choices. Framework provisions no longer imply that every named passport field is already legally mandatory. Care codes, origin information, expected lifetime, collection instructions and supporting chemical documents keep their application purpose without an unsupported claim that the cited provision mandates that exact field.

`componentFibres` now identifies Article 11 of Regulation (EU) 1007/2011 as its existing basis. Its applicability remains unresolved until the product's components and exceptions have been assessed. Do not replace required component declarations with a whole-product average. The cross-field helper reports unresolved component references and component share totals needing reconciliation; it does not decide legal exemptions or analytical tolerances.

Sustainability-label metadata records the certification-scheme and public-authority alternatives, the relevant consumer-directive provisions and their application date. It does not require every textile to obtain certification. Guarantee information remains conditional on the actual offer and applicable national measures. The model identity now references `modelIdentifier`; a display name is not an identifier.

## Assessment work still open

The drafts do not include a complete external-format export adapter, hosted readiness-test result, full current-law reconciliation, licensed-standard assessment or deployed actor and access evidence. Additional identity context, category classification, evidence qualification and measurement semantics still need review. [The readiness review](reviewing-readiness.md) explains how to collect that evidence before considering promotion.

## History

The version 4 drafts were first published in 0.3.0-beta.2; the [beta.2 publication receipt](../reference/beta-2-publication.md) records the source and package bytes that first carried them. Installing `0.3.0-beta.1` does not obtain them. Version 2 remains current, and every version 3 manifest and generated artefact remains unchanged. Package publication does not activate the drafts in an application.

## Next

Application owners continue with [update profiles and consuming applications](updating-applications.md) for the rollout. Reviewers continue with [the readiness review](reviewing-readiness.md).
