---
hidden: true
---

# Beta.4 publication receipt

> Archived release. For current package versions and setup guidance, use [Releases and compatibility](../release-sets.md). For other past releases, see [Release history](../release-history.md).

Release reviewers and consumers can check this beta.4 publication against its approved source and archive bytes here. All four packages in `dpp-release-2026-10` were published to public npm on **1 October 2026**, using GitHub OIDC trusted publishing with provenance. Every downloaded archive matched the approved bytes.

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
| Source commit | [`f9d8e98658c7cf406702d49194ec5a8480cbca73`](https://github.com/bsv-blockchain/dpp/commit/f9d8e98658c7cf406702d49194ec5a8480cbca73) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/release/dpp-release-2026-10.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-4-publication-plan.json) |
| Plan SHA-256 | `ecf6151b4f4dfaba47f9579426fcc3dcb58324b3517cbd36cc4be52c6dff3b51` |
| Dry run | [36832689443](https://github.com/bsv-blockchain/dpp/actions/runs/36832689443) |
| Completed release | [36833051000, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/36833051000) |
| Completion time | 1 October 2026, 08:05:09 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The plan records each archive's SHA-256, SHA-512 npm integrity and byte length, plus release-set, selection and changelog digests. Dry run, release and clean-checkout reproduction produced the same plan. Later documentation or publication-tooling changes neither alter it nor identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.4) | `0.3.0-beta.4` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.4) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.4) | `0.4.0-beta.4` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.4) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.4) | `0.3.0-beta.4` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.4) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.3) | `0.2.0-beta.3` | `0.2.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.3) |

Tags record this publication and may move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test.

### Recorded outcomes

| Stage or time | Recorded outcome |
|---|---|
| Uploads | Four uploads in dependency order; each became available and passed archive integrity before the next began. All matched the plan; no resumption needed. |
| Final clean install of exact public versions, seconds later | `ETARGET` for `@bsv/vsc@0.2.0-beta.3`, uploaded seconds earlier. Its archive was served; the registry version list did not yet name it. |
| 08:05:51 UTC | `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes. |
| 08:06:15 UTC | `node scripts/consumer-check.mjs --registry` passed archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |

Those checks passed from a clean source-revision checkout 40 seconds after the failed install.

### Reproduce the checks

1. Run these commands in order. Require matching npm archive bytes and a passing public-registry consumer check.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Compare `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, the third command, with the [archived plan](beta-4-publication-plan.json). It is on the default branch, absent from the source revision. Require the same plan and digest.

Stop on mismatches or failed checks. These commands verify existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON retains `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the topic's check of the output a synchronising peer reached and the profile readers' refusal of identifiers the package does not publish. Every package's documentation changed since beta.3, so all four took new versions; core and VSC change nothing else. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](../publishing-profile-updates.md) covers future releases and recovery from delays. The [beta.3 receipt](beta-3-publication.md) records the preceding publication.
