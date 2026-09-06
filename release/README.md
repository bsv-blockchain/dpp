# The release set

A release of this standard is a set: the four packages at the versions that implement one set of wire contracts, the custody profile the reference selects, the runtime they were tested on, and the fixtures and schemas they were tested against. [`dpp-release-2026-09.json`](dpp-release-2026-09.json) is the current set, `candidate` until its packages are published under the versions it names; [`release-set.schema.json`](release-set.schema.json) is its shape, and `conformance/check.mjs` holds it to the repository: every package version to its manifest, every wire version to what the reference exports, the runtime to the root, every artefact digest to its file. A changed wire contract or profile is a new set with a new identifier, never an edit of a frozen one, and `conformance/pin-sources.mjs` re-records the artefact digests after a reviewed change.

## Candidates, the consumer and publication

```
node scripts/release-candidates.mjs      # builds, packs the four packages into release/candidates/, records digests in release/candidates.json
node scripts/consumer-check.mjs          # installs exactly those tarballs into a temporary project outside this checkout and checks them
```

The packer refuses a package whose manifest version differs from the set's, and records the source revision and whether the tree was clean, so an approval refers to concrete bytes: a tarball's SHA-256 and npm integrity, not a branch. The consumer check is the external consumer of `spec/conformance.md` §2: development dependencies omitted, no workspace links and no path back to this checkout; every entry point imported; the reader path run on the version 2 chain and the acceptance record; the profile manifests, generated schemas and VSC artefacts read from inside the packages; the declarations type-checked by a strict TypeScript project; and no private, test or environment file inside any tarball. CI runs both on every change (`consumer` job) and builds and smokes the image (`image` job).

Publication is `.github/workflows/publish.yml`, run by hand with the release set named and `dryRun` defaulting to `true`: it packs, checks, and prints what would be published; with `dryRun` set to `false` and an `NPM_TOKEN` secret it publishes the four tarballs with provenance and pushes the image tag. Nothing publishes on a merge. The approval that precedes a run is of the exact content: the set file, the candidate digests and the changelog entry.

## What a consumer does with it

The example consumer with sector workflows is the application ([bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app)), which today mirrors three of the packages verbatim by blob hash and will consume the published set instead; the registry ([bsv-blockchain-demos/uora-bsv](https://github.com/bsv-blockchain-demos/uora-bsv)) consumes the four as vendored tarballs and will do the same. The generic example with no brand, wallet or account prerequisite is `examples/lifecycle-v2.mjs` in this repository, and the recommended journey through the set is in [`../docs/quick-start.md`](../docs/quick-start.md).
