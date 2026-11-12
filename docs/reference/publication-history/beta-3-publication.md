---
hidden: true
---

# Beta.3 publication receipt

> Archived release. For current package versions and setup guidance, use [Releases and compatibility](../release-sets.md). For other past releases, see [Release history](../release-history.md).

Release reviewers and consumers can check this beta.3 publication against its approved source and archive bytes here. Three packages in `dpp-release-2026-09-5` were published to public npm on **27 September 2026**, using GitHub OIDC trusted publishing with provenance; the fourth was reused, as recorded below. Every downloaded archive matched the approved bytes, and the final public-registry consumer check passed. The set was superseded by `dpp-release-2026-10`; this receipt preserves the publication record.

## Before reproducing the verification

For optional reproduction:

| Input | Source and requirement |
|---|---|
| Checkout | Source commit recorded below; run from its checkout root. |
| Toolchain | git, Node 22 and npm 11.19.0, matching the recorded toolchain. |
| Verification inputs | Public access to `https://registry.npmjs.org/` and the approved plan below. |

Keep the checkout clean. Any file written inside it, including a log, makes candidates record `sourceState: working-tree` and changes the plan digest.

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

The plan records each archive's SHA-256, SHA-512 npm integrity and byte length, plus release-set, selection and changelog digests. Dry run and release produced the same plan. Later documentation or publication-tooling changes neither alter it nor identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.3) | `0.3.0-beta.3` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.3) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.3) | `0.4.0-beta.3` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.3) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.3) | `0.3.0-beta.3` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.3) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.2) | `0.2.0-beta.2`, unchanged | `0.2.0-beta.1` | [Attestation of the beta.2 publication](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.2) |

Tags record this publication and may move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test.

### Recorded outcomes

| Stage | Recorded outcome |
|---|---|
| Changed packages | Three uploads became available, each verified before the next began; no resumption needed. |
| Unchanged package | `@bsv/vsc@0.2.0-beta.2` repacked byte for byte. The publisher verified the existing registry version instead of uploading it. |
| Clean consumer | After uploads became available, installed the exact public npm versions and passed archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |

### Reproduce the checks

1. Run these commands in order. Require matching npm archive bytes and a passing public-registry consumer check.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-09-5.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Compare `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, the third command, with the [archived plan](beta-3-publication-plan.json). It is on the default branch, absent from the source revision. Require the same plan and digest.

Stop on mismatches or failed checks. These commands verify existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON retains `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the index synchronisation and publisher policy changes of 27 September 2026 and move to `@bsv/sdk` 2.8.10. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](../publishing-profile-updates.md) covers future releases and recovery from delays. The [beta.2 receipt](beta-2-publication.md) records the preceding publication.
