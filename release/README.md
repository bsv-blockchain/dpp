# The release set

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

A release of this standard is a set: the four runtime packages at the versions that implement one set of wire contracts, the selected custody profile, the runtime and the fixtures and schemas checked against them. This directory holds the current set, [`dpp-release-2026-11.json`](dpp-release-2026-11.json), a candidate of which nothing is published yet; the [release guide](../docs/reference/release-sets.md#the-current-set) says what it carries. Every superseded set is kept, byte for byte, under [`archive/`](archive/), with the selection that qualified it under [`archive/selections/`](archive/selections/). [Release history](../docs/reference/release-history.md) is the one record of earlier sets and their publications: when each was published, what it published, and its receipt and approved plan. [`release-set.schema.json`](release-set.schema.json) is a set's shape, and `conformance/check.mjs` holds the current set to the repository: every package version to its manifest, every wire version to what the reference exports, the runtime to the root, every artefact digest to its file, the support declaration of every entry point to the built package, and the selection it names to the ledger. It notes each archived set and selection as history, and refuses a superseded set or selection left outside the archive. A changed wire contract or profile is a new set with a new identifier, never an edit of a frozen one, and `conformance/pin-sources.mjs` re-records the current set's artefact digests after a reviewed change.

Each publication is tagged in this repository as `v0.1.0-beta.N` at its source revision, where N is its receipt's number, with a GitHub pre-release that names the set and links the receipt. The `0.1.0` labels the repository before version 1.0; it is not a package, specification or wire version.

When no set is named, every script below selects the current set, the newest file in this directory whose status is not `superseded`. None reads `archive/`, so a stale default cannot pack versions the tree has moved past.

## Candidates, the consumer and the bundle

```
node scripts/release-candidates.mjs      # builds from an empty dist/, packs the selected packages into release/candidates/, records digests in release/candidates.json
node scripts/consumer-check.mjs          # verifies the tarball bytes against the record, then installs exactly those tarballs into a temporary project outside this checkout and checks them
node scripts/implementer-bundle.mjs      # assembles the specifications, contracts, fixtures and conformance material as a portable archive with a digest manifest
```

The packer refuses a set that is not a candidate, a package whose manifest version differs from the set's, and a manifest that does not export an entry point the set names. It records the source revision and whether the tree was clean, the SHA-256 of the set file itself, the selection the set names as its qualification gate, the image tag the set declares, and for each tarball its SHA-256 and npm integrity, so an approval refers to concrete bytes rather than a branch. The consumer check first holds every tarball in `release/candidates/` to that record: a missing candidate, an unexpected file, a changed byte or a mismatched integrity is a refusal before anything is installed, and `conformance/test/release-scripts.test.mjs` exercises each refusal. It then installs the candidates into a fresh project as the external consumer of `spec/conformance.md` §2: development dependencies omitted, no workspace links and no path back to this checkout; every runtime entry point the set declares imported, including the `@bsv/dpp-credentials` subpaths; the reader path run on the version 2 chain and the acceptance record; the profile manifests, generated schemas, GS1 schemas, VSC artefacts and EPCIS artefacts read from inside the packages; the declarations of all packages and the `@bsv/dpp-credentials` subpaths type-checked by a strict TypeScript project; the licence file present in each tarball; and no private, test or environment file inside any tarball. Each sentence names the assertion it made, so a reader sees what was covered rather than a summary. CI runs both on every change (`consumer` job) and builds and smokes the image (`image` job).

The bundle is what an independent implementer receives: `spec/`, `contracts/`, `fixtures/`, the conformance baselines, ledger, schemas and selections, the licence and the implementer documentation, with a manifest naming the release set and its digest, the source revision, and the SHA-256 of every file. It carries no reference runtime code, and it is distributable without npm.

## Publication

The selected npm candidates are published by `.github/workflows/publish.yaml`, run manually with `dryRun` defaulting to `true`. It publishes through npm trusted publishing with GitHub OIDC, always with provenance, and no package is published by hand. The app starter, which pins a set, has its own workflow, `publish-starter.yaml`, on the same terms. Nothing publishes on merge. The workflow builds, type-checks, tests, packs, checks an external consumer, qualifies the selected claims, and builds and smokes the operator image before preparing publication.

The workflow publishes npm packages only. The operator image is exercised locally and its registry publication needs a separate reviewed operator release. A successful npm publication alone does not change the release set to `released` or establish deployment readiness.

### Review the exact plan

After packing and qualification:

```sh
node scripts/publish-candidates.mjs
```

This is read-only with respect to npm. It writes `release/publication-plan.json` locally and prints its SHA-256. The plan binds the source revision, source state, package versions and archive digests, release set digest, selected qualification file digest, public registry, npm tag and provenance. It does not bind the changelog, so release notes can be corrected after approval without voiding the plan. Each approved plan is archived byte for byte with its receipt under `docs/reference/publication-history/`; reproduce an earlier plan from its original source revision, never from a later one. The tag is the set's `distTag`: before version 1.0 every set publishes to `latest`, so a plain install gets the newest beta; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Sets published before this field existed went to `next`. Publishing to `latest` does not claim version 1.0 readiness. Consumers pin exact versions.

Review the source diff, qualification output, plan and tarball contents. Commit and push require separate approval before a GitHub Actions dry run can reproduce the committed revision. The approved publication digest must come from the final committed source: working-tree candidates are useful for testing but the publisher refuses to publish them. Packing the same committed source with the pinned toolchain must reproduce the plan before execution can proceed.

After explicit approval of that exact plan, rerun the workflow on the same revision with `dryRun: false` and `approval` set to its SHA-256. The publisher checks the digest before making an external write. It checks every existing npm version before publishing anything, then publishes in dependency order. Publication failure stops the run and is never silently interpreted as success.

### Authentication and provenance

The workflow uses Node 22 and npm 11.19.0. Use the same toolchain for local packing: compression differences across Node versions can change archive digests even when every packaged file is identical. Do not weaken the archive comparison to bypass a mismatch. Publication authenticates with GitHub OIDC trusted publishing for organisation `bsv-blockchain`, repository `dpp` and workflow filename `publish.yaml`, with no named deployment environment and no `NPM_TOKEN`. Configure that trusted publisher on each package. npm configures one only on a package that already exists, so a set that introduces a new package name needs a maintainer decision on that name's first publication before its dry run. Do not put credentials in source files, plans or logs.

Every publication carries npm provenance, which requires public source access and a supported hosted CI runner; the publisher refuses to execute outside the workflow on the public repository. See the [npm provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/) and [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

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

A partial publication is not announced as a complete release. Qualification still withholds federated operation and version 1.0 readiness, and the standard makes no European system conformance or product-compliance claim. Package publication changes none of that.

## What a consumer does with it

The hosted reference application consumes exact npm package versions, and the hosted registry consumes the packages as vendored tarballs packed from a named revision; each names the set it is aligned to and the revision it was packed from. The generic example with no brand, wallet or account prerequisite is `examples/lifecycle-v2.mjs` in this repository; the recommended journey through the set is in [`../docs/quick-start.md`](../docs/quick-start.md), and the support declaration of every entry point is in [`../docs/packages/support-table.md`](../docs/packages/support-table.md).

For a step-by-step walkthrough of this profile release, see [publishing a profile package update](../docs/reference/publishing-profile-updates.md).

## Index starter, retired

`@bsv/create-dpp-index` is no longer released from this repository. Its published `0.1.0-beta.1` stays on npm, pinned to the superseded `dpp-release-2026-10-10`; marking it deprecated there is a maintainer action. An operator runs the index this set's image builds, `packages/dpp-overlay/Dockerfile`, with the Compose preset in [`../deploy/`](../deploy/README.md), whose `dpp-index connection` writes an application's connection file.
