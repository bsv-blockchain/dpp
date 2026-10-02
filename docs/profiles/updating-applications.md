# Update profiles and consuming applications

This page is for two audiences: application owners adopting a new profile version, and the profile and release owners who tell them about it. Installing a package makes new profile definitions available, but it does not update your forms, migrate stored data or switch the profile that new records use; this page covers those steps.

A profile version is the number after `@` in a profile identifier, such as `battery@2`. The package version (such as `0.3.0-beta.4`) and the record version of the passport format are separate numbers; [keep the versions and dates separate](#keep-the-versions-and-dates-separate) explains each.

## For application owners

### 1. Know when a new profile version lands

- **The package.** `npm view @bsv/dpp-profiles dist-tags` shows the newest prerelease under `next` (0.3.0-beta.4 today). The `latest` tag is still beta.1, so always install an exact version.
- **The release.** [Release sets](../reference/release-sets.md) names the current set and its packages, and the repository's `CHANGELOG.md` says what each release changed.
- **The profile.** Each manifest's `status` says whether a version is `current`, `draft` or `superseded`. A new version arrives as a `draft`; it becomes `current` only at a later, reviewed cutover.

### 2. See what changed

In a checkout of this repository on `main`, after `npm ci` and `npm run build`, compare the version you use with the new one:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
```

In your own project, with `@bsv/dpp-profiles@0.3.0-beta.5` installed, `compareProfiles(from, to)` returns the same report:

```sh
node --input-type=module <<'JS'
import { compareProfiles } from '@bsv/dpp-profiles'
const report = compareProfiles('battery@2', 'battery@4')
const count = (kind) => report.fields.filter((field) => field.kind === kind).length
console.log(`${report.from.profile} (${report.from.status}) to ${report.to.profile} (${report.to.status}): ${count('added')} fields added, ${count('changed')} changed, ${count('removed')} removed`)
console.log('Other changes:', report.profileChanges.map((change) => change.property).join(', '))
JS
```

It prints:

```
battery@2 (current) to battery@4 (draft): 21 fields added, 105 changed, 0 removed
Other changes: applicability, baseline, description, manifestVersion, profile, regulatoryLine, restrictedSchemaUri, schemaUri, sourceRefs, stamps, status, succession, version
```

The report gives each manifest's status and SHA-256 digest, the top-level changes, and one entry per added, changed or removed field with the properties that changed. Every field shows as changed here because manifest format 2 adds a `requirement` to each field, so read each entry's `properties`. The report is structural: it does not infer safe conversions, send notifications or activate a writer, and reviewers still supply the operational impact and the source interpretation.

### 3. Adopt it, step by step

Keep a readiness record per application and profile version: owner, application revision, installed package selection, supported reads, supported writes, test evidence, deployment and activation decision. These are suggested tracking fields, not a new API contract.

1. Review the profile's status and change report, then install and regenerate in a development branch.
2. Implement and test readers for both retained and proposed versions, including unsupported versions and richer value shapes. Do not validate an unknown version as the newest known profile.
3. Update writers, UI, server rules and exports together. Test public and restricted views, missing evidence, unresolved applicability and rejected unauthorised operations.
4. Rehearse migration, history, export and recovery with representative data. Keep registration checks separate from product qualification and lifecycle obligations.
5. Deploy compatible readers first. Verify them in the target environment before enabling the selected version for new writes.
6. Activate writers through an explicit, server-enforced selection for the affected workflow or product population. Record the decision and monitor results.

For batteries, include EV, LMT and relevant industrial cases with their distinct applicability decisions. For textiles, include the affected product categories and evidence workflows. A successful package build or schema validation is only part of this evidence.

If your application keeps its own copies of profile files, such as generated documents or reference content, add a short loop to step 1: pin exact package versions, regenerate the copies from the installed package, inspect the diff, and check that the copies match the installed package. Neither the regeneration nor the check establishes that your UI supports the new version or changes which version your writers select. The package's own consumer check tests package integration in its own harness; it does not exercise your forms, persistence or authorisation.

### 4. Turn each change into application work

| Profile change | Application response |
|---|---|
| Add an optional field | Support its value shape, display, capture, access and export. Keep records without it readable. |
| Add or strengthen a required field | Identify the affected categories and workflow stage. Collect evidence before enabling the corresponding writes; do not manufacture a default to pass validation. |
| Rename or split a field | Read the old key under the old version. Document the mapping and any additional evidence needed for a new record. |
| Change a type, unit, code list or meaning | Update widgets, parsing, validation, calculations, storage and exports. Test conversions and record their provenance. |
| Change access or disclosure | Review server authorisation, public projections, cached views and exports before activation. Resolve unknown fields before assigning a disclosure tier. |
| Change applicability or effective-date treatment | Update the relevant classification and evaluation inputs. Show unresolved decisions separately from missing data or accepted exemptions. |
| Withdraw a field | Stop collecting it for the successor where appropriate. Retain its original meaning and evidence when reading historical records. |

A change from public to restricted does not remove bytes already published on chain; include that constraint in the impact review. A label update can alter what a person understands even when the JSON shape stays identical.

Generated definitions can supply field labels, help text and validation rules. Rich measurements, document evidence, conditional sections, access decisions and lifecycle actions still need application support. Review both server validation and the UI: hiding a field in a form does not enforce an access rule.

### 5. Keep history and support rollback

Existing records keep the profile version they declare. Where migration is appropriate, issue a new state or projection that identifies its sources and transformations. Do not rewrite anchored history, silently relabel old values or infer missing measurements from unrelated fields.

Keep readers for every version present in retained data. If a rollout fails after new records have been written, disable the affected new writes while keeping the ability to read those records. Rolling back to software that cannot read the new version is not a complete recovery plan. Rehearse the transition using [migration](../migration.md) and [export and recovery](../operate/export-import-recovery.md).

Repeat this process for every successor. Disabling a writer does not remove the need to interpret its historical records.

## For profile and release owners

### Keep a list of consuming applications

Maintain a list of consuming applications, their technical owners, their installed release selections and the profile versions each reads and writes. This can begin as a maintained document. Package download counts cannot establish which deployments have adopted a change.

### Prepare a change report

For each proposed release, prepare a report containing:

- The old and new package and profile versions, profile status and artefact digests.
- Added, renamed, retyped, split, withdrawn and relabelled fields, including changes to units, code lists, access, applicability, evidence and capture timing.
- The reason and source for each change, distinguishing enacted requirements, guidance and unresolved interpretation.
- UI, backend, storage, projection, export and migration work expected from consumers.
- Representative payloads, expected validation results, compatibility limits and any adoption deadline with its basis.

Start from the structural report of [step 2](#2-see-what-changed), then add the operational impact and source interpretation yourself.

### Notify consumers, then track adoption

No notification channel is defined yet. Publish the report with the release notes and send it to each registered owner. A dependency bot or a scheduled release-set check can prepare an upgrade proposal containing the report. Review the compatible package selection and the lockfile together; a version bump alone does not tell anyone that a data contract changed.

Record acknowledgement, integration results, deployed readers and enabled writers separately. Notification is complete when it is delivered; adoption is complete only when the consumer's evidence and deployed selection are recorded. Publish deprecation and support decisions with a transition window.

The tooling supplies versioned manifests, generated schemas, frozen digests, succession metadata, the change report and the package consumer check ([release tooling](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/README.md), [consumer check](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/scripts/consumer-check.mjs)). Cross-application notification, a consumer ownership register, automated adoption tracking and opening upgrade proposals automatically are proposed additions, not services these packages supply. The publication steps themselves are on [publish a profile package update](../reference/publishing-profile-updates.md).

## Background

### Keep the versions and dates separate

| Selection | What it changes |
|---|---|
| Package version, such as `0.3.0-beta.4` | Installed code and available profile artefacts |
| Industry profile and its profile version, such as `battery@2` | The declared meaning and validation rules for product data |
| Record format version and service contract | How records are encoded and how services communicate |
| Application revision and configuration | Which definitions the UI and backend actually support and select |

Record the package release date, profile status, applicable regulatory dates and application deployment date separately. A published draft is available for explicit evaluation; installing it does not make it suitable for a conformance claim. A future legal date does not switch an application's profile selection by itself.

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) defines freezing and succession. Frozen historical definitions are preserved, and a meaning changes only through a reviewed successor that keeps a migration outcome for each predecessor field. Succession metadata describes the change; it is not an executable data migration.

### How the reference application adopts a release

The reference application, whose source is not public, follows the loop in step 3. It declares exact package dependencies in its web application and its service. A mirror script reads the installed package artefacts and generates the application's own profile documents and reference content, and a check compares those copies with the installed package. It runs the mirror after updating the reviewed package selection and lockfile, then inspects the generated diff. Neither step establishes UI support or changes the active writer selection.

Its service selects `battery@2` and `textile@2`, and its profile adapter has explicit limits on the richer value shapes it can translate. Mirroring a draft therefore makes the draft's documentation available without making every application workflow compatible with it. Its consumer change for a successor includes the adapters, forms, backend rules and tests that successor needs.

## Next

To try the current drafts, follow [evaluate the version 4 drafts](version-4-drafts.md). To roll out a whole release, follow [migration](../migration.md). Profile owners publishing a package follow [publish a profile package update](../reference/publishing-profile-updates.md).
