# Update profiles and consuming applications

A package release makes new profile definitions available. Each consuming application still needs to adopt them, demonstrate that its readers and writers support them, and select when new records use them. Installing a package does not update forms, migrate stored data or activate a successor profile.

This guide describes a recommended release and adoption process. The existing tooling supplies versioned manifests, generated schemas, frozen digests, succession metadata and package consumer checks. Cross-application notifications, a consumer ownership register and automated adoption tracking are proposed workflow additions, not services currently supplied by these packages. See the [release tooling](https://github.com/bsv-blockchain/dpp/blob/8f912f902f69898116052891f03cf4432c957307/release/README.md) and [consumer check](https://github.com/bsv-blockchain/dpp/blob/8f912f902f69898116052891f03cf4432c957307/scripts/consumer-check.mjs) for the implemented boundary.

## Keep the versions and dates separate

| Selection | What it changes |
|---|---|
| Package version | Installed code and available profile artefacts |
| Industry profile, such as `battery@2` | The declared meaning and validation rules for product data |
| Record format and service contract | How records are encoded and services communicate |
| Application revision and configuration | Which definitions the UI and backend actually support and select |

Record the package release date, profile status, applicable regulatory dates and application deployment date separately. A published draft is available for explicit evaluation. It does not become suitable for a conformance claim merely because a consumer has installed it. A future legal date does not automatically switch an application's profile selection.

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/8f912f902f69898116052891f03cf4432c957307/spec/profiles.md) defines freezing and succession. Preserve frozen historical definitions. Change their meaning through a reviewed successor, retaining a migration outcome for each predecessor field. Succession metadata describes the change; it is not an executable data migration.

## Notify consumers with an actionable change report

Maintain a list of consuming applications, their technical owners, installed release selections and supported read/write profile versions. This can begin as a maintained document. Package download counts cannot establish which deployments have adopted a change.

For each proposed release, the profile and release owners should prepare a report containing:

- The old and new package/profile versions, profile status and artefact digests.
- Added, renamed, retyped, split, withdrawn and relabelled fields, including changes to units, code lists, access, applicability, evidence and capture timing.
- The reason and source for each change, distinguishing enacted requirements, guidance and unresolved interpretation.
- UI, backend, storage, projection, export and migration work expected from consumers.
- Representative payloads, expected validation results, compatibility limits and any adoption deadline with its basis.

Notify registered consumer owners through the project's agreed release channel. A dependency bot or scheduled release-set check can prepare an upgrade proposal containing this report. Review the compatible package selection and lockfile together; a version bump alone is insufficient notification of a changed data contract.

The working checkout now provides `compareProfiles(from, to)` and a `changes` command to generate a structural report with manifest digests. [The version 4 guide](version-4-drafts.md) shows the commands. Reviewers still supply the operational impact and source interpretation. Automation for notifying owners and opening consumer upgrade proposals remains to be implemented. Use the report in a manually prepared release note and consumer change proposal. Record acknowledgement, integration results, deployed readers and enabled writers separately. Notification is complete when delivered; adoption is complete only when the consumer's evidence and deployed selection are recorded.

## Translate profile changes into application work

| Profile change | Application response |
|---|---|
| Add an optional field | Support its value shape, display, capture, access and export. Keep records without it readable. |
| Add or strengthen a required field | Identify the affected categories and workflow stage. Collect evidence before enabling the corresponding writes; do not manufacture a default to pass validation. |
| Rename or split a field | Read the old key under the old version. Document the mapping and any additional evidence needed for a new record. |
| Change a type, unit, code list or meaning | Update widgets, parsing, validation, calculations, storage and exports. Test conversions and record their provenance. |
| Change access or disclosure | Review server authorisation, public projections, cached views and exports before activation. Resolve unknown fields before assigning a disclosure tier. |
| Change applicability or effective-date treatment | Update the relevant classification and evaluation inputs. Show unresolved decisions separately from missing data or accepted exemptions. |
| Withdraw a field | Stop collecting it for the successor where appropriate. Retain its original meaning and evidence when reading historical records. |

A change from public to restricted does not remove already published bytes. Include that constraint in the impact review. Likewise, a label update can alter a user's understanding even when the JSON shape stays identical.

Generated definitions can supply field labels, help text and validation rules. Rich measurements, document evidence, conditional sections, access decisions and lifecycle actions still require application support. Review both server validation and the UI: hiding a field in a form does not enforce an access rule.

## Example: adopting a release in dpp-app

At [application revision `460664b`](https://github.com/bsv-blockchain-demos/dpp-app/tree/460664b9cbd347af759d9636c5a880723566d18a), the web application and service declare exact package dependencies. Its [profile mirror script](https://github.com/bsv-blockchain-demos/dpp-app/blob/460664b9cbd347af759d9636c5a880723566d18a/apps/web/scripts/mirror-profiles.ts) reads installed package artefacts and generates application profile documents and reference content. From that application's repository root:

```sh
npm run profiles:mirror -w web
npm run profiles:check -w web
```

Run the mirror after updating the reviewed package selection and lockfile, then inspect the generated diff. The check compares the application's generated copies with the installed package. Neither command establishes UI support or changes the active writer selection.

At this revision, the [service profile registry](https://github.com/bsv-blockchain-demos/dpp-app/blob/460664b9cbd347af759d9636c5a880723566d18a/packages/dpp-service/src/profiles.ts) selects version 2 battery and textile definitions. The [profile adapter](https://github.com/bsv-blockchain-demos/dpp-app/blob/460664b9cbd347af759d9636c5a880723566d18a/packages/dpp-service/src/profile-document.ts) also has explicit limits on the richer value shapes it can translate. Mirroring a draft therefore makes its documentation available without making every application workflow compatible with it.

The consumer change should include the adapters, forms, backend rules and tests needed for the selected successor. The package's generic consumer check verifies package integration in its own harness; it does not exercise dpp-app's actual forms, persistence or authorisation.

## Demonstrate readiness before enabling writes

Keep a readiness record per application and profile version: owner, application revision, installed package selection, supported reads, supported writes, test evidence, deployment and activation decision. These are suggested tracking fields, not a new API contract.

1. Review the profile's status and change report, then install and regenerate in a development branch.
2. Implement and test readers for both retained and proposed versions, including unsupported versions and richer value shapes. Do not validate an unknown version as the newest known profile.
3. Update writers, UI, server rules and exports together. Test public and restricted views, missing evidence, unresolved applicability and rejected unauthorised operations.
4. Rehearse migration, history, export and recovery with representative data. Keep registration checks separate from product qualification and lifecycle obligations.
5. Deploy compatible readers first. Verify them in the target environment before enabling the selected version for new writes.
6. Activate writers through an explicit, server-enforced selection for the affected workflow or product population. Record the decision and monitor results.

For batteries, include EV, LMT and relevant industrial cases with their distinct applicability decisions. For textiles, include the affected product categories and evidence workflows. A successful package build or schema validation is only part of this evidence.

## Preserve history and support rollback

Existing records retain their declared profile version. Where migration is appropriate, issue a new state or projection that identifies its sources and transformations. Do not rewrite anchored history, silently relabel old values or infer missing measurements from unrelated fields.

Keep readers for all versions present in retained data. If a rollout fails after new records have been written, disable the affected new writes while preserving the ability to read those records. Rolling back to software that cannot read the new version is not a complete recovery plan. Rehearse the transition using [migration](../migration.md) and [export and recovery](../operate/export-import-recovery.md).

Repeat this process for every successor. Publish deprecation and support decisions with a transition window; disabling a writer does not remove the need to interpret its historical records.
