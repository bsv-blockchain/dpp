# Beta.11 publication receipt

The four packages of `dpp-release-2026-10-10` are on the public npm registry under their new names, under the `latest` tag: `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/dpp-credentials@0.2.0-beta.5` and `@bsv/dpp-overlay@0.4.0-beta.12`. The first three were published by hand by an npm maintainer of the `@bsv` organisation on **16 October 2026** from the archives of the approved dry run of the superseded `dpp-release-2026-10-9`, without provenance; their archives match the approved bytes of both plans, which are the same bytes. The overlay package was published by the workflow on **16 October 2026**, using GitHub OIDC trusted publishing with provenance, after the archive published by hand as `@bsv/dpp-overlay@0.4.0-beta.11` was found to differ from its approved bytes. Every downloaded archive of this set matched the approved bytes, and the registry consumer check passed.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`0e45ac32da351c1e877431d55e2e9c0c41f54c33`](https://github.com/bsv-blockchain/dpp/commit/0e45ac32da351c1e877431d55e2e9c0c41f54c33) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/0e45ac32da351c1e877431d55e2e9c0c41f54c33/release/dpp-release-2026-10-10.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-11-publication-plan.json) |
| Plan SHA-256 | `12f11e5b9cfad28a5fca7f37df43844269a3b1a222791bc254a7928106b78ab4` |
| npm tag | `latest`, bound into the plan |
| Dry run | [38979290693](https://github.com/bsv-blockchain/dpp/actions/runs/38979290693) |
| Publication run | [38979554713](https://github.com/bsv-blockchain/dpp/actions/runs/38979554713): verified the three packages published by hand, published the overlay package |
| Completion time | 16 October 2026, 23:09:41 UTC, when the overlay archive was verified; the run ended at 23:10:00 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests and the tag. The dry run, the publication run and a local reproduction from a clean checkout under the same toolchain produced the same plan. The three archives published by hand carry the digests the [approved plan of `dpp-release-2026-10-9`](https://github.com/bsv-blockchain/dpp/actions/runs/38726681034) recorded, which this plan repeats unchanged.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Published | Provenance |
|---|---|---|---|---|---|
| [@bsv/dpp-protocol](https://www.npmjs.com/package/@bsv/dpp-protocol/v/0.3.0-beta.9) | `0.3.0-beta.9` | none | Apache 2.0 | By hand, 16 October 2026, 14:25 UTC | None |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.9) | `0.3.0-beta.9` | `0.3.0-beta.5` | Apache 2.0 | By hand, 16 October 2026, 16:04 UTC | None |
| [@bsv/dpp-overlay](https://www.npmjs.com/package/@bsv/dpp-overlay/v/0.4.0-beta.12) | `0.4.0-beta.12` | none | Apache 2.0 | Workflow, 16 October 2026, 23:09 UTC | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay@0.4.0-beta.12) |
| [@bsv/dpp-credentials](https://www.npmjs.com/package/@bsv/dpp-credentials/v/0.2.0-beta.5) | `0.2.0-beta.5` | none | Apache 2.0 | By hand, 16 October 2026, 16:08 UTC | None |

Publishing sets one tag, so `next` stays where it was. Until version 1.0 every release publishes to `latest`; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Pin exact versions and retain the consuming application's lockfile.

The former names stay on npm at their historical versions: `@bsv/dpp-core` up to `0.3.0-beta.8`, `@bsv/dpp-overlay-topics` up to `0.4.0-beta.10` and `@bsv/vsc` at `0.2.0-beta.5`. The [migration guide](../migration.md) maps each to its new name. A deprecation notice on the former names, on `@bsv/dpp-overlay@0.4.0-beta.11` and on the `0.0.0-stage` placeholder versions that the manual publication created on the three renamed packages is pending; none of those versions is named by any release set.

## Verification

The publication run passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the image smoke test before reaching the publisher. The publisher checked the plan digest, downloaded the archives of the three packages already on npm and matched each to the approved SHA-256, SHA-512 integrity and size, uploaded the overlay package with provenance, waited for npm to expose it, and matched the downloaded archive to the approved bytes at 23:09:41 UTC. Its last step, a clean install of the exact public versions, passed: archive integrity, runtime entry points, the carried reader path over the version 3 chain fixture, packaged schemas and artefacts, and strict TypeScript declaration resolution. From a clean checkout of the source revision under the same toolchain, `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes and `node scripts/consumer-check.mjs --registry` ended `Every sentence above holds.`

The overlay archive published by hand as `0.4.0-beta.11` had the same file contents as the approved archive but recorded `dist/cli.js` with an executable file mode, which the approved archive does not; the archive bytes and integrity therefore differed, and the verifier refused it as different bytes, which is its rule. No release set names beta.11. The same source publishes as beta.12 with the approved bytes.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-11-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

This set changes package names only. `@bsv/dpp-protocol@0.3.0-beta.9` is the shared protocol library formerly published as `@bsv/dpp-core`, `@bsv/dpp-overlay@0.4.0-beta.12` the index runtime formerly published as `@bsv/dpp-overlay-topics`, and `@bsv/dpp-credentials@0.2.0-beta.5` the credentials package formerly published as `@bsv/vsc`; the record versions, wire formats, custody rules, profiles, index contract `0.11.0-draft` and conformance claims are those of the [beta.10 publication](beta-10-publication.md). Both starters pin this set, and the generated projects install these public versions. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.10 receipt](beta-10-publication.md) records the preceding publication.
