---
hidden: true
---

# Beta.5 publication receipt

> Archived release. For current package versions and setup guidance, use [Releases and compatibility](../release-sets.md). For other past releases, see [Release history](../release-history.md).

Release reviewers and consumers can check this beta.5 publication against its approved source and archive bytes here. All four packages in `dpp-release-2026-10-2` were published to public npm on **2 October 2026**, using GitHub OIDC trusted publishing with provenance. Every downloaded archive matched the approved bytes. This was the first set under Apache 2.0; no code changed since beta.4.

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
| Source commit | [`7292237376b8308ed67b11194fd7a00cbe313d82`](https://github.com/bsv-blockchain/dpp/commit/7292237376b8308ed67b11194fd7a00cbe313d82) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/7292237376b8308ed67b11194fd7a00cbe313d82/release/dpp-release-2026-10-2.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-5-publication-plan.json) |
| Plan SHA-256 | `f12f87d120d5cb42686bbeddef40da50fb895f39e6902c4c05f98122ae0c5d99` |
| Dry run | [36971910089](https://github.com/bsv-blockchain/dpp/actions/runs/36971910089) |
| Completed release | [36972312155, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/36972312155) |
| Completion time | 2 October 2026, 06:19:32 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The plan records each archive's SHA-256, SHA-512 npm integrity and byte length, plus release-set, selection and changelog digests. Dry run, release and clean-checkout reproduction produced the same plan. Later documentation or publication-tooling changes neither alter it nor identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.5) | `0.3.0-beta.5` | `0.3.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.5) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.5) | `0.4.0-beta.5` | `0.4.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.5) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.5) | `0.3.0-beta.5` | `0.3.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.5) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.4) | `0.2.0-beta.4` | `0.2.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.4) |

Tags record this publication and may move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test.

### Recorded outcomes

| Stage or time | Recorded outcome |
|---|---|
| Uploads | Four uploads in dependency order; each became available and passed archive integrity before the next began. All matched the plan; no resumption needed. |
| Final clean install of exact public versions, seconds later | `ETARGET` for `@bsv/vsc@0.2.0-beta.4`, uploaded seconds earlier. Its archive was served; the registry version list did not yet name it. |
| 06:20:28 UTC | `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes. |
| 06:20:52 UTC | `node scripts/consumer-check.mjs --registry` passed archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |

Those checks passed from a clean source-revision checkout under a minute after the failed install.

### Reproduce the checks

1. Run these commands in order. Require matching npm archive bytes and a passing public-registry consumer check.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-2.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Compare `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, the third command, with the [archived plan](beta-5-publication-plan.json). It is on the default branch, absent from the source revision. Require the same plan and digest.

Stop on mismatches or failed checks. These commands verify existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON retains `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the Apache 2.0 licence and their current package documentation; the code is that of beta.4. Earlier published versions keep the licence their archives contain. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](../publishing-profile-updates.md) covers future releases and recovery from delays. The [beta.4 receipt](beta-4-publication.md) records the preceding publication.
