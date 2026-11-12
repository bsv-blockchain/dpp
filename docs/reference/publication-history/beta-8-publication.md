---
hidden: true
---

# Beta.8 publication receipt

Reviewers and maintainers can reproduce archive verification for `dpp-release-2026-10-5` with this receipt: all downloaded archives matched approved bytes, and the final public-registry consumer check passed.

> Archived release, superseded by a later set. This receipt records what beta.8 published. [Releases and compatibility](../release-sets.md) names the current set and supplies package versions and setup guidance; [Release history](../release-history.md) lists other past releases.

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
| Source commit | [`a8db9b6018c61d933596e21797ce2d67ddb5a33e`](https://github.com/bsv-blockchain/dpp/commit/a8db9b6018c61d933596e21797ce2d67ddb5a33e) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/a8db9b6018c61d933596e21797ce2d67ddb5a33e/release/dpp-release-2026-10-5.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-8-publication-plan.json) |
| Plan SHA-256 | `834671b139ce09b408df593846bb45b8ccf90254200699b6a1e4787685f086c6` |
| npm tag | `latest`, bound into the plan |
| Dry run | [37050295287](https://github.com/bsv-blockchain/dpp/actions/runs/37050295287) |
| Completed release | [37051441638, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/37051441638) |
| Completion time | 2 October 2026, 19:06:34 UTC |

The archived plan records archive SHA-256, SHA-512 npm integrity and byte length; release-set, selection and changelog digests; and tag. The dry run, release and local reproduction from a clean checkout produced the same plan.

| Publication on 2 October 2026 | Recorded result |
|---|---|
| Changed package | `@bsv/dpp-overlay-topics@0.4.0-beta.8`, published to the public npm registry under `latest` through GitHub OIDC trusted publishing with provenance. |
| Already published | `@bsv/dpp-core@0.3.0-beta.7`, `@bsv/dpp-profiles@0.3.0-beta.7` and `@bsv/vsc@0.2.0-beta.5`; all archives matched approved bytes. |

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.8) | `0.4.0-beta.8` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.8) |
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.7) | `0.3.0-beta.7`, unchanged since beta.7 | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.7) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.7) | `0.3.0-beta.7`, unchanged since beta.7 | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.7) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publication sets one tag, leaving `next` at the beta.5 set. Before version 1.0 every release publishes to `latest`; from 1.0, stable releases use `latest` and prereleases `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

| Check | Recorded result |
|---|---|
| Before publication | Build, type checks, tests, candidate consumer checks, selected-claim qualification and local operator-image smoke test passed. |
| Archives | Uploaded the one new package, waited for availability and checked integrity; confirmed the three existing archives against the plan. |
| Final clean consumer | Installed exact public versions; checked archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |

### Reproduce the checks

1. From the recorded checkout root, run:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-5.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Confirm every npm archive matches its candidate and the consumer checks pass.
3. Match `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, to the [archived plan](beta-8-publication-plan.json) on the default branch. The archived plan is absent from the source revision's tree.

Stop on any mismatch or failed check. These commands check existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON keeps `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

| Capability in `@bsv/dpp-overlay-topics@0.4.0-beta.8` | Detail |
|---|---|
| Lookup | Finds a passport from a GS1 key without a host: answers an `ls_dpp` lookup by `gs1Key`. |
| Contract | Index contract `0.9.0-draft`. |
| Dependency | `@bsv/dpp-profiles@0.3.0-beta.7` for the GS1 parse. |

Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; an index answers `gs1Key` only once it runs this release. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

For future releases and delay recovery, follow the [publication guide](../publishing-profile-updates.md). The [beta.7 receipt](beta-7-publication.md) records the preceding publication.
