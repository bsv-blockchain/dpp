# Beta.10 publication receipt

The three packages that changed in `dpp-release-2026-10-7`, `@bsv/dpp-core@0.3.0-beta.8`, `@bsv/dpp-profiles@0.3.0-beta.8` and `@bsv/dpp-overlay-topics@0.4.0-beta.10`, were published to the public npm registry on **9 and 10 October 2026**, using GitHub OIDC trusted publishing with provenance, under the `latest` tag. The fourth, `@bsv/vsc@0.2.0-beta.5`, was already published, and its archive matched the approved bytes. With them a reader, a writer and an index handle record version 3, the token carrier, and an index finds peers through the overlay discovery protocols, advertises itself and declares `single-operator@2` when configured. Every downloaded archive matched the approved bytes. Publication took three runs of one approved plan: the first published the core package and stopped on its ten-minute wait for npm to expose the profiles package; four further runs stopped before publishing while the image registry the smoke step pulls its base image from was in a partial outage; the run that completed, dispatched on a branch pointing at the same source revision after the default branch had moved on, published the overlay package.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`1b7a922616f5943f884ec07a39e8b966ecc8a42d`](https://github.com/bsv-blockchain/dpp/commit/1b7a922616f5943f884ec07a39e8b966ecc8a42d) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/1b7a922616f5943f884ec07a39e8b966ecc8a42d/release/dpp-release-2026-10-7.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-10-publication-plan.json) |
| Plan SHA-256 | `3b5903294d0ca8234dc619ac7a0a7a5d0317a47a0093c158223bc84226903672` |
| npm tag | `latest`, bound into the plan |
| Dry run | [37986571157](https://github.com/bsv-blockchain/dpp/actions/runs/37986571157) |
| First publication run | [37989193594](https://github.com/bsv-blockchain/dpp/actions/runs/37989193594): published the core package, uploaded the profiles package, stopped on the availability wait |
| Completed release | [38041777769, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/38041777769), on branch `release/beta-10-source` at the source commit |
| Completion time | 10 October 2026, 09:36:05 UTC, when the overlay archive was verified; the run ended at 09:36:10 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests and the tag. The dry run, every publication run and a local reproduction from a clean checkout under the same toolchain produced the same plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.8) | `0.3.0-beta.8` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.8) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.8) | `0.3.0-beta.8` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.8) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.10) | `0.4.0-beta.10` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.10) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publishing sets one tag, so `next` stays at the beta.5 set. Until version 1.0 every release publishes to `latest`; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

Every run passed build, type checks, tests, candidate consumer checks and selected-claim qualification before reaching the image smoke test. The first publication run uploaded the core package, waited for it to become available, checked its archive integrity, uploaded the profiles package and stopped when npm had not exposed that version within ten minutes; npm exposed it with the approved bytes fifteen minutes after the upload. The four runs that followed stopped at the image smoke test, which pulls its base image from a third-party registry that was reporting a partial outage; the publisher step did not run in any of them, so nothing partial reached npm. The completed run reused the two published packages after downloading their archives and matching them to the approved bytes, uploaded the overlay package, waited for it to become available and checked its archive integrity. Its last step, a clean install of the exact public versions, ran three seconds after that check and failed with `ETARGET` for `@bsv/dpp-overlay-topics@0.4.0-beta.10`: the registry did not yet list the version. By 09:38 UTC, from a clean checkout of the source revision under the same toolchain, `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes and `node scripts/consumer-check.mjs --registry` passed: archive integrity, runtime entry points, the carried reader path over the version 3 chain fixture, packaged schemas and artefacts, and strict TypeScript declaration resolution.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-7.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-10-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

`@bsv/dpp-core@0.3.0-beta.8` reads, builds and verifies record version 3, the seventeen-field body carried behind a BRC-162 token prefix as a token of one unit, beside versions 1 and 2. `@bsv/dpp-overlay-topics@0.4.0-beta.10` admits carried states under the carrier rules, indexes the token id, declares `dpp-record` version 3 under index contract `0.11.0-draft`, finds peers through the overlay discovery protocols when configured, advertises itself from a separate advertiser key when configured, asks again for outputs it left behind, and declares `single-operator@2` when one administration pulls from peers. `@bsv/dpp-profiles@0.3.0-beta.8` carries the operator profile `single-operator@2`. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; the hosted index pulls from a static peer and does not yet advertise itself, and no wallet or index outside this repository has been seen to handle a carried state. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.9 receipt](beta-9-publication.md) records the preceding publication.
