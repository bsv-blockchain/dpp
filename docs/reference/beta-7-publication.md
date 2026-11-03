---
hidden: true
---

# Beta.7 publication receipt

Reviewers and maintainers can reproduce archive verification for `dpp-release-2026-10-4` with this receipt: all downloaded archives matched approved bytes, and consumer checks passed after a registry availability delay.

> Archived release, superseded by a later set. This receipt records what beta.7 published. [Releases and compatibility](release-sets.md) names the current set and supplies package versions and setup guidance; [Release history](release-history.md) lists other past releases.

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
| Source commit | [`25fabf755090442b98c6714abfae54ec48fee029`](https://github.com/bsv-blockchain/dpp/commit/25fabf755090442b98c6714abfae54ec48fee029) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/25fabf755090442b98c6714abfae54ec48fee029/release/dpp-release-2026-10-4.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-7-publication-plan.json) |
| Plan SHA-256 | `b430839fe34ac8e8e97e54563715e915794cfd2c833d88a02d602f6ebc946def` |
| npm tag | `latest`, bound into the plan |
| Dry run | [37012764706](https://github.com/bsv-blockchain/dpp/actions/runs/37012764706) |
| Completed release | [37040521863, attempt 1](https://github.com/bsv-blockchain/dpp/actions/runs/37040521863) |
| Completion time | 2 October 2026, 17:31:30 UTC |

The archived plan records archive SHA-256, SHA-512 npm integrity and byte length; release-set, selection and changelog digests; and tag. The dry run, release and local reproduction from a clean checkout produced the same plan.

Three changed packages reached the public npm registry on **2 October 2026**, under `latest`, through GitHub OIDC trusted publishing with provenance. The fourth, `@bsv/vsc@0.2.0-beta.5`, was already published; its archive matched the approved bytes.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.7) | `0.3.0-beta.7` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.7) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.7) | `0.4.0-beta.7` | `0.4.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.7) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.7) | `0.3.0-beta.7` | `0.3.0-beta.5` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.7) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.5) | `0.2.0-beta.5`, unchanged since beta.6 | `0.2.0-beta.4` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.5) |

Publication sets one tag, leaving `next` at the beta.5 set. Before version 1.0 every release publishes to `latest`; from 1.0, stable releases use `latest` and prereleases `next`. Pin exact versions and retain the consuming application's lockfile.

## Verification

| Check | Recorded result |
|---|---|
| Before publication | Build, type checks, tests, candidate consumer checks, selected-claim qualification and local operator-image smoke test passed. |
| Archives | Uploaded three new packages in dependency order, waiting for availability and checking each archive's integrity before the next began; confirmed the existing VSC archive against the plan. |
| Final clean install, seconds later | Exact public versions failed to resolve with `ETARGET` for `@bsv/dpp-profiles@0.3.0-beta.7`, uploaded seconds earlier: the registry did not yet list it. |
| By 17:32:46 UTC, about a minute later, clean source checkout | `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching candidate bytes. `node scripts/consumer-check.mjs --registry` passed archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled. |

### Reproduce the checks

1. From the recorded checkout root, run:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-4.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Confirm every npm archive matches its candidate and the consumer checks pass.
3. Match `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, to the [archived plan](beta-7-publication-plan.json) on the default branch. The archived plan is absent from the source revision's tree.

Stop on any mismatch or failed check. These commands check existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON keeps `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

| Package | Released change |
|---|---|
| `@bsv/dpp-overlay-topics@0.4.0-beta.7` | Says why it refused a passport state in the `X-Admission-Refusal` header, under index contract `0.8.0-draft`. |
| `@bsv/dpp-core@0.3.0-beta.7` | Exports `linkageReasonCode`. |
| `@bsv/dpp-profiles@0.3.0-beta.7` | Version change only. |

Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness; an index sends the refusal header only once it runs this release. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

For future releases and delay recovery, follow the [publication guide](publishing-profile-updates.md). The [beta.6 receipt](beta-6-publication.md) records the preceding publication.
