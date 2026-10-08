---
hidden: true
---

# Beta.6 publication receipt

> Archived release. For current package versions and setup guidance, use [Releases and compatibility](release-sets.md). For other past releases, see [Release history](release-history.md).

The four packages selected by `dpp-release-2026-10-3` were published to the public npm registry on **2 October 2026**, using GitHub OIDC trusted publishing with provenance. They are the first published to the `latest` tag, so a plain `npm install` now gets them; no code changed since beta.4. Every downloaded archive matched the approved bytes, and the workflow's final public-registry consumer check passed.

The set is now superseded by a later one, which [release sets](release-sets.md) names; this receipt stays the record of what beta.6 published.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`77d53611d884f7d9aa058fe063acb187f77ec9c7`](https://github.com/bsv-blockchain/dpp/commit/77d53611d884f7d9aa058fe063acb187f77ec9c7) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/77d53611d884f7d9aa058fe063acb187f77ec9c7/release/dpp-release-2026-10-3.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-6-publication-plan.json) |
| Plan SHA-256 | `3d2819dc69dfb7f9508b4dbe3be223990acfedd631add26a4167055809db726e` |
| npm tag | `latest`, bound into the plan |
| Dry run | [36997028043](https://github.com/bsv-blockchain/dpp/actions/runs/36997028043) |
| Completed release | [36997301201, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/36997301201) |
| Completion time | 2 October 2026, 10:55:23 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests and the tag. The dry run, the release and a local reproduction from a clean checkout produced the same plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.6) | `0.3.0-beta.6` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.6) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.6) | `0.4.0-beta.6` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.6) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.6) | `0.3.0-beta.6` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.6) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5` | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publishing sets one tag, so `next` stays at the beta.5 set. Until version 1.0 every release publishes to `latest`; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. It uploaded the four packages in dependency order, waited for each to become available and checked its archive integrity before the next began, then installed the exact public versions into a clean consumer and checked archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. The same `node scripts/publish-candidates.mjs --verify-registry` and `node scripts/consumer-check.mjs --registry` passed again from a clean checkout of the source revision at 10:56 UTC.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-3.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-6-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the Apache 2.0 licence, their current package documentation and the `latest` publish tag; the code is that of beta.4. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.5 receipt](beta-5-publication.md) records the preceding publication.
