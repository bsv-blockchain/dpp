# Publish a profile package update

This is the maintainer procedure for publishing a new release of the packages to npm, from preparing a candidate to checking the registry. It covers all four packages, since a profile change ships as a release set like any other; steps 2 to 5 need maintainer rights on the repository and on the npm packages, and an outside contributor runs step 1 and then opens a pull request, as [authoring a profile](../profiles/authoring.md) describes.

Publishing makes reviewed package contents available from npm. It does not change a consuming application's installed dependencies, forms, backend rules or selected profile versions; the [application update guide](../profiles/updating-applications.md) covers adoption after publication.

## Before you start

- **Toolchain.** Node 22 and npm 11.19.0, matching `.github/workflows/publish.yaml`. Different compression implementations can produce different archive digests from identical files. A digest mismatch needs investigation, never a relaxed publication check.
- **Network access for the tests.** `npm test` runs the overlay package's tests against a MongoDB server that `mongodb-memory-server` downloads at run time and caches. On macOS and on x64 Linux the download works. In a Linux arm64 container on Debian 12, MongoDB publishes no matching build and the download fails with `Status Code is 403 (MongoDB's 404)`; run that container with `--platform linux/amd64`, or point `mongodb-memory-server` at a server that exists with its `MONGOMS_DISTRO` or `MONGOMS_SYSTEM_BINARY` setting.
- **A clean checkout.** Every file written inside it, a log included, makes the candidate record `sourceState: working-tree` and changes the plan's digest. The generated files under `release/` are ignored by git and do not count.
- **Trusted publishing, once per package (maintainers).** npm's package settings must authorise GitHub organisation `bsv-blockchain`, repository `dpp` and workflow filename `publish.yaml`, matching the filename npm already records for `@bsv/dpp-core`. The workflow has no named deployment environment and uses no `NPM_TOKEN`. Configure the same trusted publisher on each of the four packages; the npm [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) describes how. Credentials do not belong in source files or release notes.

## Rehearse step 1 without changing anything

To see every step 1 command pass before you edit anything, run them at the source revision of the current set, which its [publication receipt](beta-4-publication.md) records. From the root of a clean checkout:

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

Each command exits 0. The last prints the plan, `Publication plan SHA-256: ecf6151b4f4dfaba47f9579426fcc3dcb58324b3517cbd36cc4be52c6dff3b51`, `already-published` for each of the four packages and `Read-only preparation. No package or dist-tag was written.` Return to `main` afterwards with `git checkout main`, then run `npm ci` and `npm run build` again.

On `main` itself the same commands pack the set, but the last one stops with `@bsv/dpp-core@0.3.0-beta.4: published integrity differs; never overwrite or skip different bytes`. The packages on `main` have changed since beta.4 was published (they now carry the Apache 2.0 licence files), so the next release needs new versions and a new set, which step 1 prepares.

## 1. Prepare a candidate

Change the files below on a branch from `main`. The [beta.4 preparation commit](https://github.com/bsv-blockchain/dpp/commit/90de42c6ed9509be465ddb418eccd233fb134e8f) is a complete worked example of every one.

1. **Versions.** In each changed package's `package.json`, raise `version` to a new prerelease, never one already on npm, and update the exact pins other packages hold on it (`@bsv/dpp-overlay-topics` and `@bsv/dpp-profiles` pin `@bsv/dpp-core`). Keep a package whose contents have not changed at its version. Run `npm install` to update `package-lock.json`.
2. **The set.** Copy `release/dpp-release-2026-10.json` to `release/<set>.json`, give it the new name, versions and selection, and keep `status: candidate`; set the previous set's `status` to `superseded`. [`release/release-set.schema.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/release-set.schema.json) is its shape. A changed wire contract or profile is always a new set, never an edit of a frozen one.
3. **The selection.** Copy `conformance/selections/dpp-release-2026-10.json` to `conformance/selections/<set>.json` and name the new set in it.
4. **Everything that names a version.** `conformance/licences.json`, `conformance/examples/capabilities-reference-node.json`, the package READMEs and the docs pages; `node scripts/docs-check.mjs` names each page that still names an old version, and `npm run docs:render` regenerates the support table.
5. **Notes.** Write the changelog entry and the consumer impact notes. Never overwrite a published npm version or edit an earlier profile's meaning.
6. **Digests.** After review, `node conformance/pin-sources.mjs` re-records the digests of the sources and artefacts the change moved.

Then run the commands from the rehearsal with your set's name in place of `dpp-release-2026-10`:

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

The consumer check installs the archives into a separate temporary project. It checks runtime imports, types, retained profiles, new draft schemas and review helpers; it does not exercise the reference application's interface or persistence. The last command checks npm without publishing, writes `release/publication-plan.json` and lists `publish` for each new version. A working-tree plan is useful for review but cannot authorise publication: the publisher requires a clean, committed source revision.

## 2. Review and commit the source

Review the source diff, changelog, profile impact notes, test results and package contents. Obtain approval for the exact commit content and message before committing and pushing, and keep the source revision for the next step. A push alone publishes nothing.

Do not read package qualification as battery product qualification, European conformity or application readiness. Those claims stay separate and are withheld in the release selection.

## 3. Run the GitHub dry run

In the `bsv-blockchain/dpp` repository, open Actions, select **Publish npm candidates**, and run the workflow against the reviewed source with:

| Input | Value |
|---|---|
| `releaseSet` | `<set>.json` |
| `dryRun` | `true` |
| `approval` | Empty |
| `provenance` | `true` |

The workflow repeats the checks, builds and smokes the operator image locally, and uploads the candidate archives and publication plan. It does not publish an operator image. Review the workflow's actual source revision, package actions and printed **Publication plan SHA-256**. This digest identifies the exact publication proposal: package bytes, versions, registry, tag and provenance setting.

## 4. Publish the approved plan

After approval of the exact plan, run the workflow again on the same source revision with `dryRun` set to `false`, `approval` set to the reviewed SHA-256, and the other inputs unchanged. Confirm the branch still resolves to that revision before dispatching it. A changed revision or archive changes the digest and needs a new dry run and review.

The publisher checks every selected version before making a write. An already-published package is reused only when its downloaded archive matches the approved bytes exactly; a conflicting version stops publication. A partial failure is not a completed release: keep the plan and archives, inspect what reached npm, and retry only the same approved plan.

After a successful upload, the publisher waits up to ten minutes per package, polling every 15 seconds, for npm to expose matching metadata and archive bytes. A metadata or archive 404 during this wait means processing may still be under way. Authentication, network and server errors, unexpected archive hosts, and identity or integrity mismatches still stop the run immediately. The publisher never repeats an upload inside this wait, and does not start the next package until verification succeeds.

### If the wait times out

The upload may still complete. Keep the approved plan and archives, check registry availability and digests, then resume the same approved workflow revision. Do not bump a version just to get past a delay, and do not assume a failed run published nothing. The beta.2 release exposed this delay: its original workflow needed resumptions before the final public-registry consumer check passed.

## 5. Verify and hand over to consumers

The workflow installs the exact public npm versions into a fresh project and checks their integrity and behaviour. The same checks run from the checkout holding the approved candidate record and archives:

```sh
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
npm view @bsv/dpp-profiles@<version> version dist.integrity
npm view @bsv/dpp-profiles dist-tags --json
```

Record the source revision, the successful publication run, the plan digest, package integrities and the registry verification result in a publication receipt, as the [beta.4 receipt](beta-4-publication.md) does, and update the release documentation to tell verified npm availability apart from application adoption. The workflow does not mark the release set as released or notify consumer owners. [Release sets](release-sets.md#verify-a-published-release) shows how anyone can verify the result afterwards.

The handover to the reference application, whose source is not public, includes the exact package selection, release notes and a field-change report for each proposed profile transition. That separate application change must keep readers for existing versions, implement and test the new field shapes, and explicitly select any successor writes. See [version 4 changes](../profiles/version-4-drafts.md) and [consumer adoption](../profiles/updating-applications.md).

## Earlier publications

Every publication so far followed these steps: beta.2 of `dpp-release-2026-09-4` on 18 September 2026, beta.3 of `dpp-release-2026-09-5` on 27 September 2026 and beta.4 of `dpp-release-2026-10` on 1 October 2026, each under `next` with `latest` left at beta.1. Both earlier sets are superseded. Their receipts, the [beta.2 receipt](beta-2-publication.md) and the [beta.3 receipt](beta-3-publication.md), preserve each approved plan; to reproduce one, use its recorded source revision and toolchain. Dependency changes per release are in the [changelog](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/CHANGELOG.md). Package versions are separate from the industry profile versions inside them: battery@2 and textile@2 remain current, versions 3 and 4 remain drafts, and historical definitions remain available.
