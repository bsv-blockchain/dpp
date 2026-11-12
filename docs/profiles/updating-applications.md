# Update profiles and consuming applications

Application owners can use this procedure to adopt a profile version; profile and release owners can prepare its change report and track adoption. Installing a package makes definitions available. It does not update forms, migrate stored data or switch the profile for new records. Complete those application changes and record reader deployment and writer activation separately.

## Adoption inputs

| Input | Source |
|---|---|
| Old and proposed profile identifiers | Your application's selection and the proposed release. |
| Built source checkout | Checkout containing both versions; record its commit and run `npm ci` and `npm run build`. The [reviewed example checkout](../quick-start.md#get-the-code) contains the examples below. |
| Installed package selection | Application dependencies and lockfile. The own-project comparison below uses `@bsv/dpp-profiles@0.3.0-beta.7`. |
| Application owner and baseline | Consuming application's technical owner, revision, supported reads and writes, and deployment configuration. |

See [versions and dates](#keep-the-versions-and-dates-separate) before comparing selections.

## For application owners

### 1. Know when a new profile version lands

| Source | What to check |
|---|---|
| Package | `npm view @bsv/dpp-profiles dist-tags` shows the newest prerelease under `latest` (0.3.0-beta.7 today). Install an exact version. |
| Release | [Release sets](../reference/release-sets.md) names the current set and packages; the repository's `CHANGELOG.md` records release changes. |
| Profile | Manifest `status` is `current`, `draft` or `superseded`. New versions arrive as `draft` and become `current` only at a later reviewed cutover. |

### 2. See what changed

Compare your version with the proposal in the built checkout:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
```

In your own project, `compareProfiles(from, to)` returns the same report:

```sh
node --input-type=module <<'JS'
import { compareProfiles } from '@bsv/dpp-profiles'
const report = compareProfiles('battery@2', 'battery@4')
const count = (kind) => report.fields.filter((field) => field.kind === kind).length
console.log(`${report.from.profile} (${report.from.status}) to ${report.to.profile} (${report.to.status}): ${count('added')} fields added, ${count('changed')} changed, ${count('removed')} removed`)
console.log('Other changes:', report.profileChanges.map((change) => change.property).join(', '))
JS
```

Expected output:

```
battery@2 (current) to battery@4 (draft): 21 fields added, 105 changed, 0 removed
Other changes: applicability, baseline, description, manifestVersion, profile, regulatoryLine, restrictedSchemaUri, schemaUri, sourceRefs, stamps, status, succession, version
```

| Report content | Interpretation |
|---|---|
| Manifest status, SHA-256 digest and top-level changes | Identify the compared definitions. |
| Added, changed and removed fields with changed properties | Every field changes here because format 2 adds `requirement`. Read each entry's `properties`. |
| Structural comparison | Does not infer safe conversions, notify consumers or activate writers. Reviewers supply operational impact and source interpretation. |

### 3. Adopt it, step by step

Copy this suggested readiness record for each application and profile version. It is not a new API contract.

| Record | Value or evidence to retain |
|---|---|
| Ownership and baseline | Owner, application revision, installed package selection and profile version |
| Supported reads and writes | Versions supported by each |
| Test evidence | Integration, migration, history, export and recovery results |
| Reader deployment | Target deployment and compatible-reader verification result |
| Writer activation | Explicit activation decision, selected workflow or product population and monitored results |

1. Review status and change report. Install and regenerate in a development branch. If you keep copies of profile files, generated documents or reference content, pin exact package versions, regenerate from the installed package, inspect the diff and check the copies match it. This checks copies; UI support and writer selection still need application work.
2. Implement and test readers for retained and proposed versions, unsupported versions and richer value shapes. Never validate an unknown version as the newest known profile.
3. Update writers, UI, server rules and exports together. Test public/restricted views, missing evidence, unresolved applicability and rejected unauthorised operations.
4. Rehearse migration, history, export and recovery with representative data. Keep registration checks separate from product qualification and lifecycle obligations.
5. Deploy compatible readers first and verify them in the target environment. Stop before enabling new-version writes until this passes.
6. Activate writers with an explicit, server-enforced selection for the affected workflow or product population. Record the decision and monitor results.

| Product | Required scenario scope |
|---|---|
| Batteries | EV, LMT and relevant industrial cases, each with its applicability decisions |
| Textiles | Affected product categories and evidence workflows |

A package build or schema pass supplies only part of this evidence. The package consumer check tests integration in its own harness, not your forms, persistence or authorisation.

### 4. Turn each change into application work

| Profile change | Application response |
|---|---|
| Add an optional field | Support value shape, display, capture, access and export. Keep records without it readable. |
| Add or strengthen a required field | Identify affected categories and workflow stage. Collect evidence before enabling writes; never manufacture a validation default. |
| Rename or split a field | Read the old key under its old version. Document the mapping and additional evidence for new records. |
| Change type, unit, code list or meaning | Update widgets, parsing, validation, calculations, storage and exports. Test conversions and retain provenance. |
| Change access or disclosure | Review server authorisation, public projections, cached views and exports before activation. Resolve unknown fields before assigning disclosure tiers. |
| Change applicability or effective-date treatment | Update classification and evaluation inputs. Separate unresolved decisions from missing data and accepted exemptions. |
| Withdraw a field | Stop collecting it for the successor where appropriate. Preserve historical meaning and evidence. |

Include two constraints in impact reviews: making a field restricted cannot remove bytes already published on chain; label changes can alter understanding without changing JSON shape.

Generated definitions can supply labels, help text and validation rules. Applications still need support for rich measurements, document evidence, conditional sections, access decisions and lifecycle actions. Review server validation and UI together: hiding a form field does not enforce access.

### 5. Keep history and support rollback

Existing records retain their declared profile version. If migration is appropriate, issue a new state or projection identifying sources and transformations. Never rewrite anchored history, silently relabel old values or infer missing measurements from unrelated fields.

Keep readers for every version in retained data. After failed rollout with new records written, disable affected new writes and retain readers for those records. Software rollback without those readers is incomplete recovery. Rehearse using [migration](../migration.md) and [export and recovery](../operate/export-import-recovery.md). Repeat for every successor: disabling writers does not remove historical interpretation duties.

## For profile and release owners

### Keep a list of consuming applications

Maintain a document or register of consuming applications, technical owners, installed release selections, and read/write profile versions. Download counts do not establish deployment adoption.

### Prepare a change report

Start with [step 2's structural report](#2-see-what-changed), then supply operational impact and source interpretation:

| Include | Detail |
|---|---|
| Baseline | Old/new package and profile versions, status and artefact digests |
| Field changes | Added, renamed, retyped, split, withdrawn and relabelled fields; units, code lists, access, applicability, evidence and capture timing |
| Reasons and sources | Distinguish enacted requirements, guidance and unresolved interpretation |
| Consumer work | UI, backend, storage, projection, export and migration |
| Acceptance and timing | Representative payloads, expected validation, compatibility limits and any adoption deadline with its basis |

### Notify consumers, then track adoption

1. Publish the report with release notes and send it to registered owners. No notification channel is defined yet. A dependency bot or scheduled release-set check can prepare an upgrade proposal containing the report.
2. Review compatible package selections and lockfile together. A version bump alone does not communicate a data-contract change.
3. Track acknowledgement, integration results, deployed readers and enabled writers separately. Notification finishes at delivery; adoption finishes when consumer evidence and deployed selection are recorded.
4. Publish deprecation and support decisions with a transition window.

| Supplied today | Proposed additions, not supplied services |
|---|---|
| Versioned manifests, generated schemas, frozen digests, succession metadata, change report and package consumer check ([release tooling](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/README.md), [consumer check](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/scripts/consumer-check.mjs)) | Cross-application notifications, consumer ownership register, automated adoption tracking and automatically opened upgrade proposals |

Follow [publish a profile package update](../reference/publishing-profile-updates.md) for publication itself.

## Background

### Keep the versions and dates separate

| Selection | What it changes |
|---|---|
| Package version, such as `0.3.0-beta.4` | Installed code and available profile artefacts |
| Industry profile and version, such as `battery@2` | Product data's declared meaning and validation rules; version is the number after `@` |
| Record format version and service contract | Record encoding and service communication; separate from package and profile versions |
| Application revision and configuration | Definitions the UI and backend support and select |

Record package release date, profile status, regulatory dates and application deployment date separately. A published draft permits explicit evaluation; installation does not make it suitable for a conformance claim. A future legal date cannot switch application selection.

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) defines freezing and succession. Preserve frozen historical definitions. Meaning changes require a reviewed successor with a migration outcome for each predecessor field. Succession metadata describes changes; it does not execute migration.

### How the reference application adopts a release

The reference application's source is not public. It follows step 3, declaring exact dependencies in its web application and service. After updating the reviewed selection and lockfile, it runs a mirror script to generate profile documents and reference content from installed artefacts, inspects the diff and checks the copies against the package. Those steps establish neither UI support nor writer activation.

Its service selects `battery@2` and `textile@2`. Its adapter has explicit limits on richer value shapes, so mirrored draft documentation does not establish workflow compatibility. Successor adoption includes the required adapters, forms, backend rules and tests.

## Next

[Evaluate the battery@4 draft](version-4-drafts.md), follow [migration](../migration.md) for a whole release, or [publish a profile package update](../reference/publishing-profile-updates.md) as a profile owner.
