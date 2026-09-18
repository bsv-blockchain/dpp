# Beta.2 publication receipt

All four packages selected by `dpp-release-2026-09-4` were published to the public npm registry on **18 September 2026**, using GitHub OIDC trusted publishing with provenance. Their downloaded archives matched the approved bytes, and the final public-registry consumer check passed.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`f54e750de4c7731a30563e5f1caad762adbfb737`](https://github.com/bsv-blockchain/dpp/commit/f54e750de4c7731a30563e5f1caad762adbfb737) |
| Release-set input | [Original candidate declaration](https://github.com/bsv-blockchain/dpp/blob/f54e750de4c7731a30563e5f1caad762adbfb737/release/dpp-release-2026-09-4.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-2-publication-plan.json) |
| Plan SHA-256 | `3d1d228ef4f6388beaa404e9f50e39a6c1febbdbe7bce4a7e140deb41a21b252` |
| Dry run | [35294394126](https://github.com/bsv-blockchain/dpp/actions/runs/35294394126) |
| Completed release | [35294618079, attempt 5](https://github.com/bsv-blockchain/dpp/actions/runs/35294618079/attempts/5) |
| Completion time | 18 September 2026, 01:31:14 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the original release-set, selection and changelog digests. Later changes to documentation or publication tooling do not alter this approved plan or identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.2) | `0.3.0-beta.2` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.2) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.2) | `0.4.0-beta.2` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.2) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.2) | `0.3.0-beta.2` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.2) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.2) | `0.2.0-beta.2` | `0.2.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.2) |

These tags record the outcome of this publication, not a promise that tags never move. Pin exact versions and retain the consuming application's lockfile.

## Verification and processing delays

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. After all packages became available, it installed the exact public npm versions into a clean consumer and checked archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled.

npm accepted each upload before making the version available to reads. The original publisher treated that temporary 404 as a failure, so attempts 1 through 4 each stopped after an accepted upload. Each resume verified already-published archives before skipping them. Attempt 5 completed registry verification and consumer installation. This was a processing delay after successful OIDC authentication. The subsequent publisher change adds bounded waiting; that change was not part of the source that produced these packages.

To reproduce verification, use the recorded source revision and toolchain from [package installation](../packages/README.md#source-access), then run:

```sh
node scripts/release-candidates.mjs release/dpp-release-2026-09-4.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the generated `release/publication-plan.json` with the archived plan. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The original release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence or changing the broader release-set lifecycle state.

`battery@2` and `textile@2` remain current. Versions 3 and 4 remain drafts, and existing frozen definitions remain unchanged. Publication does not upgrade dpp-app, activate new writers, publish an operator image, establish a deployed service's readiness or qualify a battery product. The release selection continues to withhold European conformity and version 1.0 readiness claims.

Continue with [consumer adoption](../profiles/updating-applications.md) and [version 4 review](../profiles/version-4-drafts.md). The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays.
