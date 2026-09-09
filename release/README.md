# The release set

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

A release of this standard is a set: the four packages at the versions that implement one set of wire contracts, the custody profile the reference selects, the runtime they were tested on, and the fixtures and schemas they were tested against. [`dpp-release-2026-09-3.json`](dpp-release-2026-09-3.json) is the current set, `candidate` until its packages are published under the versions it names; the two earlier September sets are kept as `superseded` history. [`release-set.schema.json`](release-set.schema.json) is its shape, and `conformance/check.mjs` holds it to the repository: every package version to its manifest, every wire version to what the reference exports, the runtime to the root, every artefact digest to its file, the support declaration of every entry point to the built package, and the selection it names to the ledger. A changed wire contract or profile is a new set with a new identifier, never an edit of a frozen one, and `conformance/pin-sources.mjs` re-records the artefact digests after a reviewed change.

The current set is the newest file under `release/` whose status is not `superseded`. Every script below selects it by that rule when no set is named, so a stale default cannot pack versions the tree has moved past.

## Candidates, the consumer and the bundle

```
node scripts/release-candidates.mjs      # builds, packs the four packages into release/candidates/, records digests in release/candidates.json
node scripts/consumer-check.mjs          # verifies the tarball bytes against the record, then installs exactly those tarballs into a temporary project outside this checkout and checks them
node scripts/implementer-bundle.mjs      # assembles the specifications, contracts, fixtures and conformance material as a portable archive with a digest manifest
```

The packer refuses a set that is not a candidate, a package whose manifest version differs from the set's, and a manifest that does not export an entry point the set names. It records the source revision and whether the tree was clean, the SHA-256 of the set file itself, the selection the set names as its qualification gate, the image tag the set declares, and for each tarball its SHA-256 and npm integrity, so an approval refers to concrete bytes rather than a branch. The consumer check first holds every tarball in `release/candidates/` to that record: a missing candidate, an unexpected file, a changed byte or a mismatched integrity is a refusal before anything is installed, and `conformance/test/release-scripts.test.mjs` exercises each refusal. It then installs the candidates into a fresh project as the external consumer of `spec/conformance.md` §2: development dependencies omitted, no workspace links and no path back to this checkout; every runtime entry point the set declares imported, including the `@bsv/vsc` subpaths; the reader path run on the version 2 chain and the acceptance record; the profile manifests, generated schemas, GS1 schemas, VSC artefacts and EPCIS artefacts read from inside the packages; the declarations of all four packages and the VSC subpaths type-checked by a strict TypeScript project; the licence file present in each tarball; and no private, test or environment file inside any tarball. Each sentence names the assertion it made, so a reader sees what was covered rather than a summary. CI runs both on every change (`consumer` job) and builds and smokes the image (`image` job).

The bundle is what an independent implementer receives: `spec/`, `contracts/`, `fixtures/`, the conformance baselines, ledger, schemas and selections, the licence and the implementer documentation, with a manifest naming the release set and its digest, the source revision, and the SHA-256 of every file. It carries no reference runtime code, and it is distributable without npm.

## Publication

The four npm candidates are published by `.github/workflows/publish.yml`, run manually with `dryRun` defaulting to `true`. Nothing publishes on merge. The workflow builds, type-checks, tests, packs, checks an external consumer, qualifies the selected claims, and builds and smokes the operator image before preparing publication.

The workflow publishes npm packages only. The operator image is exercised locally and its registry publication needs a separate reviewed operator release. A successful npm publication alone does not change the release set to `released` or establish deployment readiness.

### Review the exact plan

After packing and qualification:

```sh
node scripts/publish-candidates.mjs
```

This is read-only with respect to npm. It writes `release/publication-plan.json` locally and prints its SHA-256. The plan binds the source revision, source state, package versions and archive digests, release set digest, selected qualification file digest, changelog digest, public registry, `next` tag and provenance choice. The existing version numbers remain the unpublished candidate versions; publishing under `next` does not claim version 1.0 readiness. Consumers pin exact versions.

Review the source diff, qualification output, plan and tarball contents. Commit and push require separate approval before a GitHub Actions dry run can reproduce the committed revision. The approved publication digest must come from the final committed source: working-tree candidates are useful for testing but the publisher refuses to publish them. Packing the same committed source with the pinned toolchain must reproduce the plan before execution can proceed.

After explicit approval of that exact plan, rerun the workflow on the same revision with `dryRun: false`, `approval` set to its SHA-256 and the same `provenance` value. The publisher checks the digest before making an external write. It checks every existing npm version before publishing anything, then publishes in dependency order. Publication failure stops the run and is never silently interpreted as success.

### Authentication and provenance

The workflow uses Node 22 and npm 11.19.0. Configure an authorised publisher for the `@bsv` scope. The first publication may require an appropriately scoped `NPM_TOKEN` repository secret; where available, configure npm trusted publishing for the exact repository and `publish.yml` workflow. Do not put credentials in source files, plans or logs.

Provenance defaults to enabled and requires public source access and a supported hosted CI runner. A private source repository cannot produce npm provenance. Publishing public npm packages without provenance is a distinct choice represented by `--provenance=false` and a different plan digest; it must be reviewed explicitly. See the [npm provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/) and [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

### Partial publication and registry verification

If a publish fails, retain the plan and archives. Rerun the same approved plan and revision. An existing version is skipped only when both its registry integrity and downloaded archive match the approved SHA-256, SHA-512 integrity and size. A version with different bytes is a conflict, never a successful retry. Authentication, rate-limit, server and network errors stop the check; only a registry 404 means absent. Existing tags are not moved by recovery.

After publication, run:

```sh
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

The second command installs exact versions from public npm in a fresh directory with a fresh cache and checks lockfile integrity, runtime entry points, declaration resolution, carried artefacts and the offline lifecycle. It does not substitute local tarballs when a registry version is missing. The first trial consumer, `bsv-blockchain-demos/dpp-app-2`, additionally runs its own `npm run setup:registry`, `npm test` and `npm start` against those same versions and digests.

A partial publication is not announced as a complete release. Qualification still withholds European conformity, battery product qualification, federated operation and version 1.0 readiness. Package publication changes none of those claims.

## What a consumer does with it

The example consumer with sector workflows is the application ([bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app)), which today mirrors the four packages verbatim by blob hash from a named revision of this repository and will consume the published set instead; the registry ([bsv-blockchain-demos/uora-bsv](https://github.com/bsv-blockchain-demos/uora-bsv)) consumes the four as vendored tarballs packed from a named revision and will do the same. Both name the set they are aligned to and the revision it was packed from. The generic example with no brand, wallet or account prerequisite is `examples/lifecycle-v2.mjs` in this repository; the recommended journey through the set is in [`../docs/quick-start.md`](../docs/quick-start.md), and the support declaration of every entry point is in [`../docs/packages/support-table.md`](../docs/packages/support-table.md).
