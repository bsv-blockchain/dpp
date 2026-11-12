# Publish a profile package update

Maintainers can use this procedure to publish all packages in a selected release set to npm and verify the registry result. Profile changes ship as release sets. Publication makes reviewed contents available; it does not change applications' dependencies, forms, backend rules or selected profiles. Follow [application adoption](../profiles/updating-applications.md) afterwards.

## Before you start

| Requirement | Source, scope and stop condition |
|---|---|
| Toolchain | Node 22 and npm 11.19.0, matching `.github/workflows/publish.yaml`. Compression differences can change archive digests for identical files. Investigate mismatches; never relax checks. |
| Test network and MongoDB | `npm test` runs overlay tests against MongoDB downloaded and cached by `mongodb-memory-server`. Downloads work on macOS and x64 Linux. Debian 12 Linux arm64 containers have no matching build and fail with `Status Code is 403 (MongoDB's 404)`. Use `--platform linux/amd64`, or an existing server via `MONGOMS_DISTRO` or `MONGOMS_SYSTEM_BINARY`. |
| Clean source and build | Any file written inside the checkout, including a log, causes `sourceState: working-tree` and changes the plan digest. Ignored generated files under `release/` do not count. Start with empty `dist` directories: stale files or executable bits change archive bytes despite clean `git status`. |
| Publication authority | Steps 2 to 5 require repository and npm-package maintainer rights. Outside contributors complete step 1 and open a pull request through [profile authoring](../profiles/authoring.md). |
| Trusted publisher | Configure each package's npm settings for organisation `bsv-blockchain`, repository `dpp`, workflow `publish.yaml`. The workflow has no named deployment environment and uses no `NPM_TOKEN`. It always publishes through OIDC with provenance, and this procedure has no hand-publication step; the app starter's own workflow, `publish-starter.yaml`, works the same way. npm configures a trusted publisher only on a package that already exists, so a set that introduces a new package name needs a maintainer decision on that name's first publication before its dry run. |

See npm's [prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites) and [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/). Keep credentials out of source and release notes.

## Rehearse step 1 without changing anything

This historical rehearsal uses the published beta.4 set and its [receipt's source revision](publication-history/beta-4-publication.md). The [latest published set](publication-history/beta-11-publication.md) has separate verification steps. From a clean checkout root:

```sh
git checkout --detach f9d8e98658c7cf406702d49194ec5a8480cbca73
npm ci
npm run build
npm run typecheck
npm test
node scripts/release-candidates.mjs release/dpp-release-2026-10.json
node scripts/consumer-check.mjs
node scripts/implementer-bundle.mjs release/dpp-release-2026-10.json
node conformance/qualify.mjs conformance/selections/dpp-release-2026-10.json
node scripts/publish-candidates.mjs
```

| Check | Expected result |
|---|---|
| Every command | Exit 0 |
| Final command | Plan, `Publication plan SHA-256: ecf6151b4f4dfaba47f9579426fcc3dcb58324b3517cbd36cc4be52c6dff3b51`, `already-published` for all four packages, then `Read-only preparation. No package or dist-tag was written.` |

Return with `git checkout main`, then rerun `npm ci` and `npm run build`. On `main`, the superseded `dpp-release-2026-10` is kept under `release/archive/` and the packer refuses it; reproduce it only at the recorded beta.4 revision. New publications start from `main` with a new set.

## 1. Prepare a candidate

Work on a branch from `main`. The [beta.4 preparation commit](https://github.com/bsv-blockchain/dpp/commit/90de42c6ed9509be465ddb418eccd233fb134e8f) demonstrates all these changes.

1. In changed packages' `package.json`, raise `version` to an unpublished prerelease and update exact dependent pins. `@bsv/dpp-overlay` and tests in `@bsv/dpp-profiles` pin `@bsv/dpp-protocol`. Unchanged packages retain their versions. Match each `publishConfig.tag` to the set's `distTag`; mismatches are refused. Run `npm install` to update `package-lock.json`.
2. Copy the current set under `release/` to `release/<set>.json`. Set new name, versions and selection, `"distTag": "latest"` before 1.0, and `status: candidate`. Set the previous set's `status` to `superseded` and move it to `release/archive/`, where it is not edited again. Follow [release-set.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/release-set.schema.json). Changed wire contracts or profiles always need new sets, never edits to frozen sets.
3. Copy the current selection under `conformance/selections/` to `conformance/selections/<set>.json`, naming the new set, and move the previous selection, bytes unchanged, to `release/archive/selections/`. `conformance/check.mjs` refuses a superseded set or selection left beside the current one.
4. Update version references in `conformance/licences.json`, `conformance/examples/capabilities-reference-node.json`, package READMEs and documentation. `node scripts/docs-check.mjs` identifies old-version pages; `npm run docs:render` regenerates the support table.
5. Write changelog and consumer-impact notes. Never overwrite published npm versions or change earlier profile meanings.
6. After review, use `node conformance/pin-sources.mjs` to re-record affected source and artefact digests.

Run the rehearsal checks with your set replacing `dpp-release-2026-10`:

```sh
npm ci
npm run build
npm run typecheck
npm test
node scripts/release-candidates.mjs release/<set>.json
node scripts/consumer-check.mjs
node scripts/implementer-bundle.mjs release/<set>.json
node conformance/qualify.mjs conformance/selections/<set>.json
node scripts/publish-candidates.mjs
```

| Check | Result and limit |
|---|---|
| Consumer check | Installs archives in a temporary project; checks runtime imports, types, retained profiles, new draft schemas and review helpers. Does not exercise the reference application's interface or persistence. |
| Final command | Reads npm without publishing, writes `release/publication-plan.json` and lists `publish` per new version. |
| Working-tree plan | Supports review only. Publication requires a clean, committed source revision. |

## 2. Review and commit the source

Review source diff, changelog, impact notes, tests and package contents. Stop before committing or pushing until the exact commit content and message are approved. Retain the source revision; a push alone publishes nothing.

Package qualification is separate from battery product qualification, European conformity and application readiness, none of which a release selection claims.

## 3. Run the GitHub dry run

In `bsv-blockchain/dpp`, open Actions, select **Publish npm candidates**, and run against the reviewed source:

| Input | Value |
|---|---|
| `releaseSet` | `<set>.json` |
| `dryRun` | `true` |
| `approval` | Empty |

The workflow repeats checks, builds and smokes the operator image locally, then uploads archives and the plan. It publishes no operator image. Review its actual source revision, package actions and **Publication plan SHA-256**. The digest binds the source revision, package bytes and versions, the set and selection digests, registry, tag and provenance. It does not bind the changelog, so release notes can still be corrected after approval without a new dry run.

## 4. Publish the approved plan

Obtain approval for the exact plan. Confirm the branch still resolves to the reviewed revision, then rerun the workflow on that same revision:

| Input | Approved-run value |
|---|---|
| `releaseSet` | `<set>.json`, unchanged |
| `dryRun` | `false` |
| `approval` | Reviewed SHA-256 |

A changed revision or archive changes the digest and requires a new dry run and review.

| Publication check | Behaviour and stop condition |
|---|---|
| Before any write | Checks every selected version. Reuses a published package only if its downloaded archive exactly matches approved bytes; conflicts stop publication. |
| Partial failure | Release is incomplete. Retain plan and archives, inspect npm and retry only the approved plan. |
| After upload | Polls every 15 seconds for up to ten minutes per package for matching metadata and bytes. A metadata/archive 404 can mean processing continues. |
| Immediate failure | Authentication, network/server errors, unexpected archive hosts, identity or integrity mismatches stop the run. |
| Upload sequencing | Never repeats an upload during the wait; verifies before starting the next package. |

### If the wait times out

The upload may still complete. Keep approved plan and archives, check registry availability and digests, then resume the same approved workflow revision. Never bump a version to bypass delay or assume a failed run published nothing. Beta.2 needed workflow resumptions before its final public-registry consumer check passed.

## 5. Verify and hand over to consumers

The workflow installs exact public npm versions in a fresh project and checks integrity and behaviour. Run the same checks in the checkout holding approved candidate records and archives:

```sh
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
npm view @bsv/dpp-profiles@<version> version dist.integrity
npm view @bsv/dpp-profiles dist-tags --json
```

1. Record source revision, successful publication run, plan digest, package integrities and registry verification in a receipt under `docs/reference/publication-history/`, beside the approved plan copied byte for byte, following the [beta.4 receipt](publication-history/beta-4-publication.md).
2. Prepare release documentation distinguishing verified npm availability from application adoption. After the receipt reaches the default branch, prepare tag `v0.1.0-beta.N` on the source revision, with N matching the receipt number, and a GitHub pre-release under that tag naming the set, listing package versions and linking the receipt. Obtain approval for the exact external-write content, then tag and publish.
3. Hand the reference application, whose source is private, the exact package selection, release notes and field-change report per proposed transition. Its separate change must preserve readers, implement and test new field shapes and explicitly select successor writes ([version 4 changes](../profiles/version-4-drafts.md), [consumer adoption](../profiles/updating-applications.md)).

The workflow does not mark the set released, tag the repository or notify owners. Anyone can follow [release verification](release-sets.md#verify-a-published-release).

### Keep release navigation current

After publication and registry verification, update documentation in one change:

1. Update [Releases and compatibility](release-sets.md) with package combination, receipt and verification link. Package versions can differ within a set.
2. List the new receipt first under Release history in `docs/SUMMARY.md`, with the `Latest publication` title. Preserve every existing receipt's address.
3. Add `hidden: true` front matter and an archive notice to the previous receipt; remove its `Latest publication` title. Preserve evidence and approved JSON plan.
4. Add the superseded set to [Release history](release-history.md) with its date, what it published and its receipt. Release history is the one page that records publications; the release README and the changelog point to it.
5. Run `node scripts/docs-check.mjs`. In GitBook preview, confirm the latest receipt is visible, archives are hidden from the sidebar and history links open them.

## Earlier publications

[Release history](release-history.md) lists every earlier set, its date, what it published and its receipt; each receipt records any exception to this procedure and how to reproduce its plan at its recorded revision. Package versions differ from industry profile versions: battery@2 and textile@2 remain current, versions 3 and 4 remain drafts, and historical definitions remain available.
