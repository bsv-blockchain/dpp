---
hidden: true
---

# Beta.10 publication receipt

Reviewers and maintainers can reproduce archive verification for `dpp-release-2026-10-7` with this receipt: all downloaded archives matched approved bytes, and consumer checks passed after publication availability delays.

> Archived release, superseded by a later set. This receipt records what beta.10 published. [Releases and compatibility](release-sets.md) names the current set and supplies package versions and setup guidance; [Release history](release-history.md) lists other past releases.

## Before reproducing the verification

For optional verification:

| Input | Source or requirement |
|---|---|
| Checkout | Recorded commit in [Exact source and approval](#exact-source-and-approval). |
| Toolchain | Recorded toolchain: Node 22, npm 11.19.0. |
| Registry access | Public `https://registry.npmjs.org/`. |
| Clean working tree | Any file written inside the checkout, including a log, sets `sourceState: working-tree` in the candidates record and changes the plan digest. Keep it clean. |

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

The archived plan records archive SHA-256, SHA-512 npm integrity and byte length; release-set, selection and changelog digests; and tag. The dry run, every publication run and local reproduction from a clean checkout with the same toolchain produced the same plan.

Three changed packages, `@bsv/dpp-core@0.3.0-beta.8`, `@bsv/dpp-profiles@0.3.0-beta.8` and `@bsv/dpp-overlay-topics@0.4.0-beta.10`, reached the public npm registry on **9 and 10 October 2026**, under `latest`, through GitHub OIDC trusted publishing with provenance. The fourth, `@bsv/vsc@0.2.0-beta.5`, was already published; its archive matched the approved bytes.

Publication took three runs of one approved plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.8) | `0.3.0-beta.8` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.8) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.8) | `0.3.0-beta.8` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.8) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.10) | `0.4.0-beta.10` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.10) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publication sets one tag, leaving `next` at the beta.5 set. Before version 1.0 every release publishes to `latest`; from 1.0, stable releases use `latest` and prereleases `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

Every run passed build, type checks, tests, candidate consumer checks and selected-claim qualification before the image smoke test.

| Run or time | Outcome |
|---|---|
| First publication run | Uploaded core, waited for availability and checked archive integrity; uploaded profiles, then stopped after npm had not exposed it within ten minutes. npm exposed the approved bytes fifteen minutes after upload. |
| Four following runs | Stopped at the image smoke test: the third-party registry supplying its base image reported a partial outage. The publisher did not run, so nothing partial reached npm. |
| Completed run | Dispatched on a branch at the same source revision after the default branch moved on. Downloaded and verified the two published archives against approved bytes, then uploaded overlay, waited for availability and checked its integrity. |
| Three seconds after that check | The final clean install of exact public versions failed with `ETARGET` for `@bsv/dpp-overlay-topics@0.4.0-beta.10`: npm did not yet list the version. |
| By 09:38 UTC, clean source checkout and same toolchain | `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching candidate bytes. `node scripts/consumer-check.mjs --registry` passed archive integrity, runtime entry points, the carried reader path over the version 3 chain fixture, packaged schemas and artefacts, and strict TypeScript declaration resolution. |

### Reproduce the checks

1. From the recorded checkout root, run:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-7.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Confirm every npm archive matches its candidate and the consumer checks pass.
3. Match `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, to the [archived plan](beta-10-publication-plan.json) on the default branch. The archived plan is absent from the source revision's tree.

Stop on any mismatch or failed check. These commands check existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON keeps `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

| Package | Released capability |
|---|---|
| `@bsv/dpp-core@0.3.0-beta.8` | Readers and writers read, build and verify record version 3, the token carrier, alongside versions 1 and 2: a seventeen-field body behind a BRC-162 token prefix, representing one token unit. |
| `@bsv/dpp-overlay-topics@0.4.0-beta.10` | Admits carried states under carrier rules, indexes the token id and declares `dpp-record` version 3 under index contract `0.11.0-draft`. When configured, finds peers through overlay discovery and advertises from a separate advertiser key. Asks again for outputs left behind; declares `single-operator@2` when one administration pulls from peers. |
| `@bsv/dpp-profiles@0.3.0-beta.8` | Carries operator profile `single-operator@2`. |

Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; the hosted index pulls from a static peer and does not yet advertise itself, and no wallet or index outside this repository has been seen to handle a carried state. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

For future releases and delay recovery, follow the [publication guide](publishing-profile-updates.md). The [beta.9 receipt](beta-9-publication.md) records the preceding publication.
