# Beta.4 publication receipt

The four packages selected by `dpp-release-2026-10` were published to the public npm registry on **1 October 2026**, using GitHub OIDC trusted publishing with provenance. Every downloaded archive matched the approved bytes. The workflow's final clean install from the public registry could not yet resolve `@bsv/vsc@0.2.0-beta.3`, uploaded seconds earlier; the same registry checks, run from a clean checkout of the source revision 40 seconds later, passed.

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

The archived plan includes each archive's SHA-256, SHA-512 npm integrity and byte length, as well as the release-set, selection and changelog digests. The dry run, the release and a local reproduction from a clean checkout produced the same plan. Later changes to documentation or publication tooling do not alter this approved plan or identify a new package publication.

## Published packages

| Package | Version at `next` | `latest` left unchanged | Provenance |
|---|---|---|---|
| [@bsv/dpp-core](https://www.npmjs.com/package/@bsv/dpp-core/v/0.3.0-beta.4) | `0.3.0-beta.4` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-core@0.3.0-beta.4) |
| [@bsv/dpp-overlay-topics](https://www.npmjs.com/package/@bsv/dpp-overlay-topics/v/0.4.0-beta.4) | `0.4.0-beta.4` | `0.4.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay-topics@0.4.0-beta.4) |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.4) | `0.3.0-beta.4` | `0.3.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.4) |
| [@bsv/vsc](https://www.npmjs.com/package/@bsv/vsc/v/0.2.0-beta.3) | `0.2.0-beta.3` | `0.2.0-beta.1` | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fvsc@0.2.0-beta.3) |

These tags record the outcome of this publication, not a promise that tags never move. Pin exact versions and retain the consuming application's lockfile.

## Verification

The workflow passed build, type checks, tests, candidate consumer checks, selected-claim qualification and the local operator-image smoke test. It uploaded the four packages in dependency order, waited for each to become available and checked its archive integrity before the next began, and confirmed all four archives against the plan; no resumption was needed. Its last step, a clean install of the exact public versions, ran seconds after that and failed with `ETARGET` for `@bsv/vsc@0.2.0-beta.3`: the registry served the archive but its version list did not yet name the version. At 08:05:51 UTC, `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes, and at 08:06:15 UTC `node scripts/consumer-check.mjs --registry` passed: archive integrity, runtime entry points, packaged schemas and artefacts, and strict TypeScript declaration resolution with `skipLibCheck` disabled.

To reproduce verification, check out the recorded source revision with the same toolchain, then run the commands below. Keep the checkout clean: any file written inside it, a log included, makes the candidates record `sourceState: working-tree` and changes the plan's digest.

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

Compare the `release/publication-plan.json` that the second command writes with the [archived plan](beta-4-publication-plan.json) on the default branch; it is not in the source revision's tree. These commands check existing registry packages and do not publish or change tags.

## What publication does and does not change

The release-set JSON retains `status: candidate` because it is an input whose exact digest was approved. This receipt records completed npm publication without rewriting that evidence.

The packages carry the topic's check of the output a synchronising peer reached and the profile readers' refusal of identifiers the package does not publish. Every package's documentation changed since beta.3, so all four took new versions; core and VSC change nothing else. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

The [publication guide](publishing-profile-updates.md) describes the process for future releases and recovery from delays. The [beta.3 receipt](beta-3-publication.md) records the preceding publication.
