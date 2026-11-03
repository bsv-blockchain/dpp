# Beta.11 publication receipt

Reviewers and maintainers can reproduce the successful archive and consumer checks for `dpp-release-2026-10-10` with this receipt. Its four packages are publicly available under their new names and `latest`.

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
| Source commit | [`0e45ac32da351c1e877431d55e2e9c0c41f54c33`](https://github.com/bsv-blockchain/dpp/commit/0e45ac32da351c1e877431d55e2e9c0c41f54c33) |
| Release-set input | [Candidate declaration](https://github.com/bsv-blockchain/dpp/blob/0e45ac32da351c1e877431d55e2e9c0c41f54c33/release/dpp-release-2026-10-10.json) |
| Approved plan | [Original JSON, preserved byte for byte](beta-11-publication-plan.json) |
| Plan SHA-256 | `12f11e5b9cfad28a5fca7f37df43844269a3b1a222791bc254a7928106b78ab4` |
| npm tag | `latest`, bound into the plan |
| Dry run | [38979290693](https://github.com/bsv-blockchain/dpp/actions/runs/38979290693) |
| Publication run | [38979554713](https://github.com/bsv-blockchain/dpp/actions/runs/38979554713): verified the three packages published by hand, published the overlay package |
| Completion time | 16 October 2026, 23:09:41 UTC, when the overlay archive was verified; the run ended at 23:10:00 UTC |

The archived plan records archive SHA-256, SHA-512 npm integrity and byte length; release-set, selection and changelog digests; and tag. The dry run, publication run and local reproduction from a clean checkout with the same toolchain produced the same plan.

| Publication on 16 October 2026 | Method and evidence |
|---|---|
| Protocol, profiles and credentials | An npm maintainer of the `@bsv` organisation published these three packages by hand, without provenance, from the approved dry-run archives of superseded `dpp-release-2026-10-9`. Their archives match both plans, which approve the same bytes. |
| Overlay | The workflow published beta.12 through GitHub OIDC trusted publishing with provenance after the hand-published `@bsv/dpp-overlay@0.4.0-beta.11` archive differed from its approved bytes. |

The three hand-published archives carry the digests in the [approved plan of `dpp-release-2026-10-9`](https://github.com/bsv-blockchain/dpp/actions/runs/38726681034), repeated unchanged in this plan.

## Published packages

| Package | Version at `latest` | `next` left at | Licence | Published | Provenance |
|---|---|---|---|---|---|
| [@bsv/dpp-protocol](https://www.npmjs.com/package/@bsv/dpp-protocol/v/0.3.0-beta.9) | `0.3.0-beta.9` | none | Apache 2.0 | By hand, 16 October 2026, 14:25 UTC | None |
| [@bsv/dpp-profiles](https://www.npmjs.com/package/@bsv/dpp-profiles/v/0.3.0-beta.9) | `0.3.0-beta.9` | `0.3.0-beta.5` | Apache 2.0 | By hand, 16 October 2026, 16:04 UTC | None |
| [@bsv/dpp-overlay](https://www.npmjs.com/package/@bsv/dpp-overlay/v/0.4.0-beta.12) | `0.4.0-beta.12` | none | Apache 2.0 | Workflow, 16 October 2026, 23:09 UTC | [Attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay@0.4.0-beta.12) |
| [@bsv/dpp-credentials](https://www.npmjs.com/package/@bsv/dpp-credentials/v/0.2.0-beta.5) | `0.2.0-beta.5` | none | Apache 2.0 | By hand, 16 October 2026, 16:08 UTC | None |

Publication sets one tag, leaving `next` where it was. Before version 1.0 every release publishes to `latest`; from 1.0, stable releases use `latest` and prereleases `next`. Pin exact versions and retain the consuming application's lockfile.

| Former name | Historical version retained on npm |
|---|---|
| `@bsv/dpp-core` | Up to `0.3.0-beta.8` |
| `@bsv/dpp-overlay-topics` | Up to `0.4.0-beta.10` |
| `@bsv/vsc` | `0.2.0-beta.5` |

The [migration guide](../migration.md) maps the names. Verified against npm on 21 October 2026: former names carry rename notices; `@bsv/dpp-overlay@0.4.0-beta.11` directs consumers to beta.12; and the three renamed packages' `0.0.0-stage` versions carry placeholder notices. Neither overlay beta.11 nor the placeholders is named by a release set.

## Verification

Every downloaded archive matched the approved bytes.

| Check | Recorded result |
|---|---|
| Before publication | Build, type checks, tests, candidate consumer checks, selected-claim qualification and image smoke test passed. |
| Publisher | Checked the plan digest; downloaded the three existing npm archives and matched their SHA-256, SHA-512 integrity and size; uploaded the overlay with provenance; waited for npm availability; matched its downloaded archive to the approved bytes at 23:09:41 UTC. |
| Final clean install of exact public versions | Passed archive integrity, runtime entry points, the carried reader path over the version 3 chain fixture, packaged schemas and artefacts, and strict TypeScript declaration resolution. |
| Clean checkout, same source and toolchain | `node scripts/publish-candidates.mjs --verify-registry` found every npm tarball matching the candidate bytes; `node scripts/consumer-check.mjs --registry` ended `Every sentence above holds.` |

| Overlay archive | Contents and outcome |
|---|---|
| Hand-published `0.4.0-beta.11` | Same file contents as the approved archive, but `dist/cli.js` had an executable file mode absent from the approved archive. Archive bytes and integrity differed, so the verifier refused it because its rule requires matching bytes. No release set names beta.11. |
| Replacement beta.12 | Same source, published with the approved bytes. |

### Reproduce the checks

1. From the recorded checkout root, run:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

2. Confirm every npm archive matches its candidate and the consumer checks pass.
3. Match `release/publication-plan.json`, written by `publish-candidates.mjs --verify-registry`, to the [archived plan](beta-11-publication-plan.json) on the default branch. The archived plan is absent from the source revision's tree.

Stop on any mismatch or failed check. These commands check existing registry packages without publishing or changing tags.

## What publication does and does not change

The release-set JSON keeps `status: candidate`: its exact input digest was approved. This receipt records completed npm publication without rewriting that evidence.

This set changes package names only:

| Published package | Former name and role |
|---|---|
| `@bsv/dpp-protocol@0.3.0-beta.9` | `@bsv/dpp-core`, shared protocol library |
| `@bsv/dpp-overlay@0.4.0-beta.12` | `@bsv/dpp-overlay-topics`, index runtime |
| `@bsv/dpp-credentials@0.2.0-beta.5` | `@bsv/vsc`, credentials package |
| `@bsv/dpp-profiles@0.3.0-beta.9` | Profiles package in this set |

Record versions, wire formats, custody rules, profiles, index contract `0.11.0-draft` and conformance claims remain those of the [beta.10 publication](beta-10-publication.md). Both starters pin this set; generated projects install these public versions. Publication does not upgrade the reference application or registry, redeploy the hosted index, publish an operator image or establish a deployed service's readiness. The release selection continues to withhold federated operation, European conformity, battery product qualification and version 1.0 readiness.

For future releases and delay recovery, follow the [publication guide](publishing-profile-updates.md). The [beta.10 receipt](beta-10-publication.md) records the preceding publication.
