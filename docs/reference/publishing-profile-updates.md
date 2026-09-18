# Publish a profile package update

Publishing makes reviewed package contents available from npm. It does not change a consuming application's installed dependencies, forms, backend rules or selected profile versions. The [application update guide](../profiles/updating-applications.md) covers adoption after publication.

## This release

The packages selected by `dpp-release-2026-09-4` were published on 18 September 2026:

| Package | Published version | Publication result |
|---|---|---|
| `@bsv/dpp-profiles` | `0.3.0-beta.2` | Available under `next`, with provenance |
| `@bsv/dpp-core` | `0.3.0-beta.2` | Available under `next`, with provenance |
| `@bsv/dpp-overlay-topics` | `0.4.0-beta.2` | Available under `next`, with provenance |
| `@bsv/vsc` | `0.2.0-beta.2` | Available under `next`, with provenance |

The [publication receipt](beta-2-publication.md) preserves the approved plan, package digests and verification results. Package versions are separate from the industry versions inside them: battery@2 and textile@2 remain current, versions 3 and 4 remain drafts, and historical definitions remain available. The publication left `latest` at beta.1. This release also upgrades the SDK to 2.7.1, canonicalize to 5.0.0, MongoDB to 7.6.0, TypeScript to 7.0.2, Vitest to 5.0.1 and Node types to 22.20.3.

The commands below use this release as a worked example. To reproduce its plan, use its recorded source revision and toolchain. For a new package change, create new versions and a new release set; never reuse the published beta.2 versions for changed bytes.

## 1. Prepare a candidate

Change the affected package version and workspace lockfile, create a new release-set record and qualification selection, and write the changelog and consumer impact notes. Never overwrite a published npm version or edit an earlier profile's meaning. Retain the other package versions when their contents have not changed.

Use Node 22 and npm 11.19.0, matching `.github/workflows/publish.yaml`. Different compression implementations can produce different archive digests from identical files. A digest mismatch requires investigation, not a relaxed publication check.

From the candidate checkout:

```sh
npm ci
npm run build
npm run typecheck
npm test
node scripts/release-candidates.mjs release/dpp-release-2026-09-4.json
node scripts/consumer-check.mjs
node scripts/implementer-bundle.mjs release/dpp-release-2026-09-4.json
node conformance/qualify.mjs conformance/selections/dpp-release-2026-09-4.json
node scripts/publish-candidates.mjs
```

The consumer check installs the archives into a separate temporary project. It checks runtime imports, types, retained profiles, new draft schemas and review helpers. It does not exercise dpp-app's UI or persistence.

The last command checks npm without publishing and writes `release/publication-plan.json`. A working-tree plan is useful for review but cannot authorise publication: the publisher requires a clean, committed source revision.

## 2. Review and commit the source

Review the source diff, changelog, profile impact notes, test results and package contents. Obtain approval for the exact commit content and message before committing and pushing. Keep the source revision for the next step. A push alone publishes nothing.

Do not interpret package qualification as battery product qualification, European conformity or application readiness. Those claims remain separate and are withheld in this release selection.

## 3. Run the GitHub dry run

In the `bsv-blockchain/dpp` repository, open Actions, select **Publish npm candidates**, and run the workflow against the reviewed source with:

| Input | Value |
|---|---|
| `releaseSet` | `dpp-release-2026-09-4.json` |
| `dryRun` | `true` |
| `approval` | Empty |
| `provenance` | `true` |

The workflow repeats the checks, builds and smokes the operator image locally, and uploads the candidate archives and publication plan. It does not publish an operator image. Review the workflow's actual source revision, package actions and printed **Publication plan SHA-256**. This digest identifies the exact publication proposal, including package bytes, versions, registry, tag and provenance setting.

Trusted publishing must authorise GitHub organisation `bsv-blockchain`, repository `dpp`, and workflow filename `publish.yaml` in npm's package settings, matching the filename npm already records for `@bsv/dpp-core`. The workflow has no named deployment environment and does not use an `NPM_TOKEN`. Repeat the same trusted publisher on each of the four packages. The npm [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) describes the configuration. Credentials do not belong in source files or release notes.

## 4. Publish the approved plan

After approval of the exact plan, run the workflow again on the same source revision with `dryRun` set to `false`, `approval` set to the reviewed SHA-256, and the other inputs unchanged. Confirm the branch still resolves to that revision before dispatching it. A changed revision or archive changes the digest and requires a new dry run and review.

The publisher checks every selected version before making a write. Already-published packages are reused only when their downloaded archives match the approved bytes exactly. A conflicting version stops publication. A partial failure is not a completed release: retain the plan and archives, inspect what reached npm, and retry only the same approved plan.

After a successful upload, the publisher waits up to ten minutes per package, polling every 15 seconds, for npm to expose matching metadata and archive bytes. A metadata or archive 404 during this wait means processing may still be underway. Authentication, network and server errors, unexpected archive hosts, or identity and integrity mismatches still stop the run immediately. The publisher never repeats an upload inside this wait, and does not start the next package until verification succeeds.

If the wait times out, the upload may still complete. Keep the approved plan and archives, check registry availability and digests, then resume the same approved workflow revision. Do not bump a version just to bypass a delay or assume a failed run means nothing was published. The beta.2 release exposed this delay; its original workflow required resumptions before the final public-registry consumer check passed.

## 5. Verify and hand over to consumers

The workflow installs the exact public npm versions into a fresh project and checks their integrity and behaviour. These checks can also be run from the checkout holding the approved candidate record and archives:

```sh
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
npm view @bsv/dpp-profiles@0.3.0-beta.2 version dist.integrity
npm view @bsv/dpp-profiles dist-tags --json
```

Record the source revision, successful publication run, plan digest, package integrities and registry verification result. Update release documentation to distinguish verified npm availability from application adoption. The workflow does not automatically mark the release-set record as released or notify consumer owners.

The handover to dpp-app includes the exact package selection, release notes and a field-change report for each proposed profile transition. That separate application change must preserve readers for existing versions, implement and test the new field shapes, and explicitly select any successor writes. See [version 4 changes](../profiles/version-4-drafts.md) and [consumer adoption](../profiles/updating-applications.md).
