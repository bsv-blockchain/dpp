# Beta.7 publication receipt

The three packages that changed in `dpp-release-2026-10-4` were published to the public npm registry on **2 October 2026**, using GitHub OIDC trusted publishing with provenance, under the `latest` tag; the fourth, `@bsv/vsc@0.2.0-beta.5`, was already published and its archive matched the approved bytes. With them an index says why it refused a passport state, in an `X-Admission-Refusal` header. Every downloaded archive matched the approved bytes. The workflow's final clean install from the public registry could not yet resolve `@bsv/dpp-profiles@0.3.0-beta.7`, uploaded seconds earlier; the same registry checks, run from a clean checkout of the source revision about a minute later, passed.

## Exact source and approval

| Evidence | Recorded value |
|---|---|
| Source commit | [`25fabf755090442b98c6714abfae54ec48fee029`](https://github.com/bsv-blockchain/dpp/commit/25fabf755090442b98c6714abfae54ec48fee029) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/25fabf755090442b98c6714abfae54ec48fee029/release/dpp-release-2026-10-4.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-7-publication-plan.json) |
| Plan SHA-256 | `b430839fe34ac8e8e97e54563715e915794cfd2c833d88a02d602f6ebc946def` |
| npm tag | `latest`, bound into the plan |
| Dry run | [37012764706](https://github.com/bsv-blockchain/dpp/actions/runs/37012764706) |
| Completed release | [37040521863, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/37040521863) |
| Completion time | 2 October 2026, 17:31:30 UTC |
| Toolchain | Node 22, npm 11.19.0 |
| Registry and access | `https://registry.npmjs.org/`, public |

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests and the tag. The dry run, the release and a local reproduction from a clean checkout produced the same plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.7) | `0.3.0-beta.7` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.7) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.7) | `0.4.0-beta.7` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.7) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.7) | `0.3.0-beta.7` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.7) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publishing sets one tag, so `next` stays at the beta.5 set. Until version 1.0 every release publishes to `latest`; from 1.0, `latest` carries stable releases only and prereleases publish to `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. It uploaded the three new packages in dependency order, waited for each to become available and checked its archive integrity before the next began, and confirmed the already-published VSC archive against the plan. Its last step, a clean install of the exact public versions, ran seconds after that and failed with `ETARGET` for `@bsv/dpp-profiles@0.3.0-beta.7`: the registry did not yet list the version. By 17:32:46 UTC, from a clean checkout of the source revision, `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes and `node scripts/consumer-check.mjs --registry` passed: archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-4.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-7-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

`@bsv/dpp-overlay-topics@0.4.0-beta.7` answers a refused passport state with `X-Admission-Refusal` under index contract `0.8.0-draft`, `@bsv/dpp-core@0.3.0-beta.7` exports `linkageReasonCode`, and `@bsv/dpp-profiles@0.3.0-beta.7` changes only its version. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; an index sends the refusal header only once it runs this release. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.6 receipt](beta-6-publication.md) records the preceding publication.
