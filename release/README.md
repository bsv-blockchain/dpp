# The release set

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

A release of this standard is a set: the main packages and any compatibility packages at the versions that implement one set of wire contracts, the selected custody profile, the runtime and the fixtures and schemas checked against them. [`dpp-release-2026-10-8.json`](dpp-release-2026-10-8.json) is the current candidate. It introduces `@bsv/dpp-protocol@0.3.0-beta.9`, retains `@bsv/dpp-core@0.3.0-beta.9` as a compatibility wrapper, updates profiles to beta.9 and overlay topics to beta.11, and keeps VSC at beta.5. The new name and wrapper are not yet published. The superseded [`dpp-release-2026-10-7.json`](dpp-release-2026-10-7.json) records the preceding set with its original names and artefact digests. Its core and profiles beta.8 and overlay beta.10 packages were published on 9 and 10 October 2026, beside the unchanged VSC beta.5 package. The [beta.10 receipt](../docs/reference/beta-10-publication.md) preserves the approved plan and links to its original release-set input at the publication source revision. This rename keeps that set's wire formats and qualification claims. The beta.9 overlay package of [`dpp-release-2026-10-6.json`](dpp-release-2026-10-6.json) was published under `latest` on 3 October 2026 beside the published beta.7 packages; the [publication receipt](../docs/reference/beta-9-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.8 overlay package of [`dpp-release-2026-10-5.json`](dpp-release-2026-10-5.json) was published under `latest` on 2 October 2026 beside the published beta.7 packages; the [publication receipt](../docs/reference/beta-8-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.7 packages of [`dpp-release-2026-10-4.json`](dpp-release-2026-10-4.json) were published under `latest` on 2 October 2026; the [publication receipt](../docs/reference/beta-7-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.6 packages of [`dpp-release-2026-10-3.json`](dpp-release-2026-10-3.json) were published under `latest` on 2 October 2026, the first to `latest`; the [publication receipt](../docs/reference/beta-6-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.5 packages of [`dpp-release-2026-10-2.json`](dpp-release-2026-10-2.json) were published under `next` on 2 October 2026, the first under the Apache 2.0 licence; the [publication receipt](../docs/reference/beta-5-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.4 packages of [`dpp-release-2026-10.json`](dpp-release-2026-10.json) were published under `next` on 1 October 2026; the [publication receipt](../docs/reference/beta-4-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The beta.3 packages of [`dpp-release-2026-09-5.json`](dpp-release-2026-09-5.json) were published under `next` on 27 September 2026 with the unchanged VSC package at its published beta.2 version; the [publication receipt](../docs/reference/beta-3-publication.md) records the approved plan and verification evidence, and that plan bound the set's JSON at its source revision, where it is reproduced. The four beta.2 packages of `dpp-release-2026-09-4` were published under `next` on 18 September 2026, and the [publication receipt](../docs/reference/beta-2-publication.md) records the approved plan and verification evidence. That plan bound the set's JSON at its source revision, where it is reproduced. The September sets are kept as `superseded` history. [`release-set.schema.json`](release-set.schema.json) is its shape, and `conformance/check.mjs` holds it to the repository: every package version to its manifest, every wire version to what the reference exports, the runtime to the root, every artefact digest to its file, the support declaration of every entry point to the built package, and the selection it names to the ledger. A changed wire contract or profile is a new set with a new identifier, never an edit of a frozen one, and `conformance/pin-sources.mjs` re-records the artefact digests after a reviewed change.

Each publication is tagged in this repository as `v0.1.0-beta.N` at its source revision, where N is its receipt's number, with a GitHub pre-release that names the set and links the receipt. The `0.1.0` labels the repository before version 1.0; it is not a package, specification or wire version.

The current set is the newest file under `release/` whose status is not `superseded`. Every script below selects it by that rule when no set is named, so a stale default cannot pack versions the tree has moved past.

## Candidates, the consumer and the bundle

```
node scripts/release-candidates.mjs      # builds, packs the selected packages into release/candidates/, records digests in release/candidates.json
node scripts/consumer-check.mjs          # verifies the tarball bytes against the record, then installs exactly those tarballs into a temporary project outside this checkout and checks them
node scripts/implementer-bundle.mjs      # assembles the specifications, contracts, fixtures and conformance material as a portable archive with a digest manifest
```

The packer refuses a set that is not a candidate, a package whose manifest version differs from the set's, and a manifest that does not export an entry point the set names. It records the source revision and whether the tree was clean, the SHA-256 of the set file itself, the selection the set names as its qualification gate, the image tag the set declares, and for each tarball its SHA-256 and npm integrity, so an approval refers to concrete bytes rather than a branch. The consumer check first holds every tarball in `release/candidates/` to that record: a missing candidate, an unexpected file, a changed byte or a mismatched integrity is a refusal before anything is installed, and `conformance/test/release-scripts.test.mjs` exercises each refusal. It then installs the candidates into a fresh project as the external consumer of `spec/conformance.md` §2: development dependencies omitted, no workspace links and no path back to this checkout; every runtime entry point the set declares imported, including the `@bsv/vsc` subpaths; the reader path run on the version 2 chain and the acceptance record; the profile manifests, generated schemas, GS1 schemas, VSC artefacts and EPCIS artefacts read from inside the packages; the declarations of all packages and the VSC subpaths type-checked by a strict TypeScript project; the licence file present in each tarball; and no private, test or environment file inside any tarball. Each sentence names the assertion it made, so a reader sees what was covered rather than a summary. CI runs both on every change (`consumer` job) and builds and smokes the image (`image` job).

The bundle is what an independent implementer receives: `spec/`, `contracts/`, `fixtures/`, the conformance baselines, ledger, schemas and selections, the licence and the implementer documentation, with a manifest naming the release set and its digest, the source revision, and the SHA-256 of every file. It carries no reference runtime code, and it is distributable without npm.

## Publication

The selected npm candidates are published by `.github/workflows/publish.yaml`, run manually with `dryRun` defaulting to `true`. Nothing publishes on merge. The workflow builds, type-checks, tests, packs, checks an external consumer, qualifies the selected claims, and builds and smokes the operator image before preparing publication.

The workflow publishes npm packages only. The operator image is exercised locally and its registry publication needs a separate reviewed operator release. A successful npm publication alone does not change the release set to `released` or establish deployment readiness.

### Review the exact plan

After packing and qualification:

```sh
node scripts/publish-candidates.mjs
```

This is read-only with respect to npm. It writes `release/publication-plan.json` locally and prints its SHA-256. The plan binds the source revision, source state, package versions and archive digests, release set digest, selected qualification file digest, changelog digest, public registry, npm tag and provenance choice. The approved beta.2 plan is archived with the publication receipt; reproduce it from its original source revision rather than overwriting it with a plan from a later documentation or tooling change. The tag is the set's `distTag`: before version 1.0 every set publishes to `latest`, so a plain install gets the newest beta; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Sets published before this field existed went to `next`. Publishing to `latest` does not claim version 1.0 readiness. Consumers pin exact versions.

Review the source diff, qualification output, plan and tarball contents. Commit and push require separate approval before a GitHub Actions dry run can reproduce the committed revision. The approved publication digest must come from the final committed source: working-tree candidates are useful for testing but the publisher refuses to publish them. Packing the same committed source with the pinned toolchain must reproduce the plan before execution can proceed.

After explicit approval of that exact plan, rerun the workflow on the same revision with `dryRun: false`, `approval` set to its SHA-256 and the same `provenance` value. The publisher checks the digest before making an external write. It checks every existing npm version before publishing anything, then publishes in dependency order. Publication failure stops the run and is never silently interpreted as success.

### Authentication and provenance

The workflow uses Node 22 and npm 11.19.0. Use the same toolchain for local packing: compression differences across Node versions can change archive digests even when every packaged file is identical. Do not weaken the archive comparison to bypass a mismatch. Publication authenticates with GitHub OIDC trusted publishing for organisation `bsv-blockchain`, repository `dpp` and workflow filename `publish.yaml`, with no named deployment environment and no `NPM_TOKEN`. Configure that trusted publisher on each package, including the new `@bsv/dpp-protocol` name before its first approved publication. Do not put credentials in source files, plans or logs.

Provenance defaults to enabled and requires public source access and a supported hosted CI runner. A private source repository cannot produce npm provenance. Publishing public npm packages without provenance is a distinct choice represented by `--provenance=false` and a different plan digest; it must be reviewed explicitly. See the [npm provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/) and [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

### Partial publication and registry verification

After an upload succeeds, the publisher waits up to ten minutes per package for verified registry availability, with 15-second polling and progress messages. Only metadata or archive 404 responses are retried in this post-upload wait. The full identity, npm integrity, SHA-256 and archive-size checks still apply. Other HTTP failures, network errors and byte mismatches stop the release. Prepublication checks remain strict, including an existing version whose archive cannot be retrieved.

A timeout means publication may still be processing. Retain the plan and archives, verify the registry result and resume the same approved revision once matching bytes are available. The wait does not upload again or advance to dependent packages before verification. This handles the propagation delay observed during beta.2 publication, whose original workflow needed four resumptions.

If a publish fails, retain the plan and archives. Rerun the same approved plan and revision. An existing version is skipped only when both its registry integrity and downloaded archive match the approved SHA-256, SHA-512 integrity and size. A version with different bytes is a conflict, never a successful retry. Authentication, rate-limit, server and network errors stop the check; only a registry 404 means absent. Existing tags are not moved by recovery.

After publication, run:

```sh
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

The second command installs exact versions from public npm in a fresh directory with a fresh cache and checks lockfile integrity, runtime entry points, declaration resolution, carried artefacts and the offline lifecycle. It does not substitute local tarballs when a registry version is missing. A trial consumer can additionally run its own setup, tests and start against those same versions and digests.

A partial publication is not announced as a complete release. Qualification still withholds European conformity, battery product qualification, federated operation and version 1.0 readiness. Package publication changes none of those claims.

## What a consumer does with it

The index starter has a separate publication workflow, described below. It consumes this release set but is not itself a protocol conformance artefact.

The hosted reference application consumes exact npm package versions, and the hosted registry consumes the packages as vendored tarballs packed from a named revision; each names the set it is aligned to and the revision it was packed from. The generic example with no brand, wallet or account prerequisite is `examples/lifecycle-v2.mjs` in this repository; the recommended journey through the set is in [`../docs/quick-start.md`](../docs/quick-start.md), and the support declaration of every entry point is in [`../docs/packages/support-table.md`](../docs/packages/support-table.md).

For a step-by-step walkthrough of this profile release, see [publishing a profile package update](../docs/reference/publishing-profile-updates.md).

## Index starter publication

`@bsv/create-dpp-index` is released independently by `.github/workflows/publish-index-starter.yaml`. The runtime publication above must finish first. The starter workflow verifies the already published archives for the exact overlay, protocol and profiles versions pinned in its manifest before testing or publishing the starter. It never republishes the runtime packages.

Use `npm run index-starter:release` for local preparation, then `npm run index-starter:release -- --check-registry` once the runtime is available. The ignored `release/index-starter/publication-plan.json` binds the starter and prerequisite archive digests, runtime release set, source revision, tag, authentication method and provenance choice. The generator publishes under `next`, and the setup guides use its exact version. A working-tree plan cannot authorise publication.

The [starter release instructions](../packages/create-dpp-index/README.md#prepare-a-release) cover the trusted publisher configuration, the separately approved interactive route for establishing a new npm package, recovery after interruption, and the fresh-cache registry checks. Commit and push the reviewed changes before preparing the final committed plan; publication requires approval of that exact plan.

The workflow tests the packed starter against public runtime dependencies before publishing. After publication, `npm run index-starter:check -- --registry` exercises the actual npm create command and installed project without local archive substitutions. A source candidate check alone does not establish that a public npm installation works.
