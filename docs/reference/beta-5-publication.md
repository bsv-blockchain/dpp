# Beta.5 publication receipt

The four packages selected by `dpp-release-2026-10-2` were published to the public npm registry on **2 October 2026**, using GitHub OIDC trusted publishing with provenance. They are the first under the Apache 2.0 licence; no code changed since beta.4. Every downloaded archive matched the approved bytes. The workflow's final clean install from the public registry could not yet resolve `@bsv/vsc@0.2.0-beta.4`, uploaded seconds earlier; the same registry checks, run from a clean checkout of the source revision under a minute later, passed.

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

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests. The dry run, the release and a local reproduction from a clean checkout produced the same plan. Later changes to documentation or publication tooling do not alter this approved plan or identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Licence | Provenance |
|---|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.5) | `0.3.0-beta.5` | `0.3.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.5) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.5) | `0.4.0-beta.5` | `0.4.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.5) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.5) | `0.3.0-beta.5` | `0.3.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.5) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.4) | `0.2.0-beta.4` | `0.2.0-beta.1` | Apache 2.0 | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.4) |

These tags record the outcome of this publication, not a promise that tags never move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. It uploaded the four packages in dependency order, waited for each to become available and checked its archive integrity before the next began, and confirmed all four archives against the plan; no resumption was needed. Its last step, a clean install of the exact public versions, ran seconds after that and failed with `ETARGET` for `@bsv/vsc@0.2.0-beta.4`: the registry served the archive but its version list did not yet name the version. At 06:20:28 UTC, `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes, and at 06:20:52 UTC `node scripts/consumer-check.mjs --registry` passed: archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-2.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that `publish-candidates.mjs --verify-registry` writes with the [archived plan](beta-5-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the Apache 2.0 licence and their current package documentation; the code is that of beta.4. Earlier published versions keep the licence their archives contain. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.4 receipt](beta-4-publication.md) records the preceding publication.
