# Beta.3 publication receipt

Three packages selected by `dpp-release-2026-09-5` were published to the public npm registry on **27 September 2026**, using GitHub OIDC trusted publishing with provenance. The fourth, `@bsv/vsc@0.2.0-beta.2`, is unchanged: its archive repacked byte for byte and the publisher verified the existing registry version instead of uploading it. Every downloaded archive matched the approved bytes, and the final public-registry consumer check passed. The set has since been superseded by `dpp-release-2026-10`; this receipt records the beta.3 publication as it happened.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`921a1d36e6a1888ef0d1b08aaf2cf7df54525d81`](https://github.com/bsv-blockchain/dpp/commit/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/release/dpp-release-2026-09-5.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-3-publication-plan.json) |
| Plan SHA-256 | `094a989c2daec7f7a2c6bea3218430d5678fa1d99b82e728ef401958172b21e0` |
| Dry run | [36338067816](https://github.com/bsv-blockchain/dpp/actions/runs/36338067816) |
| Completed release | [36339024181, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/36339024181) |
| Completion time | 27 September 2026, 18:06:17 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests. The dry run and the release produced the same plan. Later changes to documentation or publication tooling do not alter this approved plan or identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.3) | `0.3.0-beta.3` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.3) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.3) | `0.4.0-beta.3` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.3) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.3) | `0.3.0-beta.3` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.3) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.2) | `0.2.0-beta.2`, unchanged | `0.2.0-beta.1` | [Attestation of the beta.2 publication](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.2) |

These tags record the outcome of this publication, not a promise that tags never move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. After the three uploads became available, it installed the exact public npm versions into a clean consumer and checked archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. Each upload was verified before the next began, and no resumption was needed.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-09-5.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that the second command writes with the [archived plan](beta-3-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the index synchronisation and publisher policy changes of 27 September 2026 and move to `@bsv/sdk` 2.8.10. Publication does not upgrade dpp-app or the registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.2 receipt](beta-2-publication.md) records the preceding publication.
