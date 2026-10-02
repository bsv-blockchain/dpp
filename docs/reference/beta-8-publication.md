# Beta.8 publication receipt

The one package that changed in `dpp-release-2026-10-5`, `@bsv/dpp-overlay-topics@0.4.0-beta.8`, was published to the public npm registry on **2 October 2026**, using GitHub OIDC trusted publishing with provenance, under the `latest` tag. The other three, `@bsv/dpp-core@0.3.0-beta.7`, `@bsv/dpp-profiles@0.3.0-beta.7` and `@bsv/vsc@0.2.0-beta.5`, were already published, and their archives matched the approved bytes. With it an index finds a passport from a GS1 key without a host. Every downloaded archive matched the approved bytes, and the workflow's final public-registry consumer check passed.

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
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests and the tag. The dry run, the release and a local reproduction from a clean checkout produced the same plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.8) | `0.4.0-beta.8` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.8) |
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.7) | `0.3.0-beta.7`, unchanged since beta.7 | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.7) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.7) | `0.3.0-beta.7`, unchanged since beta.7 | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.7) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publishing sets one tag, so `next` stays at the beta.5 set. Until version 1.0 every release publishes to `latest`; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. It uploaded the one new package, waited for it to become available and checked its archive integrity, and confirmed the three already-published archives against the plan. Its last step installed the exact public versions into a clean consumer and checked archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-5.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-8-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

`@bsv/dpp-overlay-topics@0.4.0-beta.8` answers an `ls_dpp` lookup by `gs1Key` under index contract `0.9.0-draft`, and depends on `@bsv/dpp-profiles@0.3.0-beta.7` for the GS1 parse. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; an index answers `gs1Key` only once it runs this release. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.7 receipt](beta-7-publication.md) records the preceding publication.
