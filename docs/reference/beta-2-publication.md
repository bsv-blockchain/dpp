---
hidden: true
---

# Beta.2 publication receipt

> Archived release. For current package versions and setup guidance, use [Releases and compatibility](release-sets.md). For other past releases, see [Release history](release-history.md).

Release reviewers and consumers can check this beta.2 publication against its approved source and archive bytes here. All four packages in `dpp-release-2026-09-4` were published to public npm on **18 September 2026**, using GitHub OIDC trusted publishing with provenance. Their downloaded archives matched the approved bytes, and the final public-registry consumer check passed. The set was superseded by `dpp-release-2026-09-5`; this receipt preserves the publication record.

## Before reproducing the verification

For optional reproduction:

| Input | Source and requirement |
|---|---|
| Checkout | Source commit recorded below; run from its checkout root. |
| Toolchain | git, Node 22 and npm 11.19.0, matching the recorded toolchain. |
| Verification inputs | Public access to `https://registry.npmjs.org/` and the approved plan below. |

Prepare dependencies and build at that revision through [package installation](../packages/README.md#source-access).

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

The plan records each archive's SHA-256, SHA-512 npm integrity and byte length, plus original release-set, selection and changelog digests. Later documentation or publication-tooling changes neither alter it nor identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.2) | `0.3.0-beta.2` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.2) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.2) | `0.4.0-beta.2` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.2) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.2) | `0.3.0-beta.2` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.2) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.2) | `0.2.0-beta.2` | `0.2.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.2) |

Tags record this publication and may move. Pin exact versions and retain the consuming application's lockfile.

## Verification and processing delays

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test.

### Recorded outcomes

| Stage | Recorded outcome |
|---|---|
| Attempts 1 through 4 | npm accepted each upload before exposing the version to reads. The original publisher treated the temporary 404 as failure, so each attempt stopped after an accepted upload. |
| Each resume | Verified already-published archives before skipping them. |
| Attempt 5 | Completed registry verification and installed the exact public npm versions into a clean consumer after all packages became available. Checks passed for archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |
| Subsequent tooling change | Added bounded waiting; it was not part of the source that produced these packages. |

This was a processing delay after successful OIDC authentication.

### Reproduce the checks

1. Run these commands in order. Require matching npm archive bytes and a passing public-registry consumer check.

```sh
node scripts/release-candidates.mjs release/dpp-release-2026-09-4.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Compare the generated `release/publication-plan.json` with the archived plan; they must match.

Stop on mismatches or failed checks. These commands verify existing registry packages without publishing or changing tags.

## What publication does and does not change

The original release-set JSON retains `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting evidence or changing the broader release-set lifecycle state.

`battery@2` and `textile@2` remain current. Versions 3 and 4 remain drafts, and existing frozen definitions remain unchanged. Publication does not upgrade the reference application, activate new writers, publish an operator image, establish a deployed service's readiness or qualify a battery product. The release selection continues to withhold European conformity and version 1.0 readiness claims.

Continue with [consumer adoption](../profiles/updating-applications.md) and [version 4 review](../profiles/version-4-drafts.md). The [publication guide](publishing-profile-updates.md) covers future releases and recovery from delays.
