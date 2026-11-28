# Beta.12 publication receipt

The four runtime packages in `dpp-release-2026-11` were published to public npm under `latest` on 27 November 2026. All four downloaded archives match the approved bytes. Their signed provenance identifies the same GitHub Actions workflow, source commit and publication attempt.

| Package | Version | Published at (UTC) | Provenance |
|---|---|---|---|
| `@bsv/dpp-protocol` | `0.3.0-beta.10` | 18:10:59.264 | [npm attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-protocol@0.3.0-beta.10) |
| `@bsv/dpp-profiles` | `0.3.0-beta.10` | 18:14:25.835 | [npm attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-profiles@0.3.0-beta.10) |
| `@bsv/dpp-overlay` | `0.4.0-beta.13` | 18:16:15.498 | [npm attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-overlay@0.4.0-beta.13) |
| `@bsv/dpp-credentials` | `0.2.0-beta.6` | 18:18:06.159 | [npm attestation](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fdpp-credentials@0.2.0-beta.6) |

## Publication record

| Evidence | Value |
|---|---|
| Source | [`7b697a385c13890768cea5c8b2c36029671b8291`](https://github.com/bsv-blockchain/dpp/commit/7b697a385c13890768cea5c8b2c36029671b8291) |
| Inputs | [Release set](https://github.com/bsv-blockchain/dpp/blob/7b697a385c13890768cea5c8b2c36029671b8291/release/dpp-release-2026-11.json) and [conformance selection](https://github.com/bsv-blockchain/dpp/blob/7b697a385c13890768cea5c8b2c36029671b8291/conformance/selections/dpp-release-2026-11.json) |
| Approved plan | [Original JSON](beta-12-publication-plan.json) with SHA-256 `d8c1841602670a495e674bc52d8a678cd6d375cfb9a9941e75e620c8a8554f21` |
| Toolchain | Node `22.23.4` and npm `11.19.0` |
| GitHub Actions | [Dry run](https://github.com/bsv-blockchain/dpp/actions/runs/46041827973), [publication, attempt 3](https://github.com/bsv-blockchain/dpp/actions/runs/46045259413/attempts/3) and [registry consumer verification, attempt 4](https://github.com/bsv-blockchain/dpp/actions/runs/46045259413/attempts/4) |

The dry run, the publication artefact and a clean local checkout produced the same plan. It records each archive's byte length, SHA-256 and npm SHA-512 integrity. Attempt 3 uploaded all four archives. Its immediate install reported `ETARGET` for credentials. Attempt 4 recognised the four published archives and passed the public consumer checks. A separate local install also verified runtime entry points, packaged artefacts and TypeScript declarations. Verification against each downloaded archive covered the npm registry signature, the npm publish attestation and the SLSA provenance signature.

## Verification

Use the recorded Node and npm versions. Set the file creation mask before cloning so that file modes in the packed archives match the publication build.

```sh
umask 022
git clone https://github.com/bsv-blockchain/dpp.git dpp-beta-12
cd dpp-beta-12
git switch --detach 7b697a385c13890768cea5c8b2c36029671b8291
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-11.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

The archive check ends with `Every npm tarball matches the candidate bytes.` and the consumer check ends with `Every sentence above holds.` Compare the generated `release/publication-plan.json` with the [archived plan](beta-12-publication-plan.json). Keep logs outside the checkout so the plan records a clean source tree.

The [installation guide](../../packages/README.md#install-from-npm) lists the four runtime dependencies. The application starter `@bsv/create-dpp-app@0.1.0-beta.2` was published separately on 27 November 2026 from `d725269144d202c37d3bb7f362219f3c02509fef`. It pins the four versions above. [Starter publication](https://github.com/bsv-blockchain/dpp/actions/runs/46050225749) · [Signed starter provenance](https://registry.npmjs.org/-/npm/v1/attestations/@bsv%2fcreate-dpp-app@0.1.0-beta.2)

The [release guide](../release-sets.md) records the operator images and their publication status.
