# Supported entry points

Generated from `release/dpp-release-2026-11.json` in the documentation build for `dpp-release-2026-11` (candidate). The [release guide](../reference/release-sets.md) explains how a consumer selects and verifies the matching artefacts.

| Package | Entry point | Kind | Runtime | Browser | Types | Side effects | Node built-ins | Carries |
|---|---|---|---|---|---|---|---|---|
| `@bsv/dpp-protocol` 0.3.0-beta.10 | `.` | module | Node >=22 | Untested | Yes | None | none | `dist/`, `schemas/` |
| `@bsv/dpp-protocol` 0.3.0-beta.10 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json` |
| `@bsv/dpp-overlay` 0.4.0-beta.13 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:process`, `node:util`, `node:url` | `dist/`, `schemas/` |
| `@bsv/dpp-overlay` 0.4.0-beta.13 | `./server` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:process`, `node:util`, `node:url` | `dist/`, `schemas/` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:url`, `node:worker_threads` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json`, `bindings/` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./validation-engine` | module | Node >=22 | Untested | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:url`, `node:worker_threads` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json`, `bindings/` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./validator-client` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:url`, `node:worker_threads` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json`, `bindings/` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./validator-service` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:url`, `node:worker_threads` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json`, `bindings/` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./manifests/*` | data | Any | Plain data | No | None | none | `manifests/<id>@<version>.json`, `manifests/exchange/*.json`, `manifests/operator/*.json`, `manifests/interoperability/*.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./generated/*` | data | Any | Plain data | No | None | none | `generated/payload-schema/*.schema.json`, `generated/consumer/*.json`, `generated/mapping/*.md`, `generated/index.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.10 | `./frozen.json` | data | Any | Plain data | No | None | none | `frozen.json` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:assert/strict`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `./exchange` | module | Node >=22 | Unsupported | Yes | None | `node:assert/strict`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `./epcis-source` | module | Node >=22 | Unsupported | Yes | None | `node:assert/strict`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `./epcis-exchange` | module | Node >=22 | Unsupported | Yes | None | `node:assert/strict`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `./epcis-lifecycle` | module | Node >=22 | Untested | Yes | None | `node:assert/strict`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/dpp-credentials` 0.2.0-beta.6 | `./artifacts/*` | data | Any | Plain data | No | None | none | `artifacts/context-0.1.0.jsonld`, `artifacts/seal-0.1.0.schema.json`, `artifacts/disclosure-0.1.0.schema.json`, `artifacts/profile-0.1.0.json`, `artifacts/external/*`, `artifacts/w3c/*` |

`@bsv/dpp-profiles` reads its manifests and schemas from its own directory at run time, by a path computed from the profile identifier. A bundler or file tracer cannot see those reads, so a bundled deployment must include the data files, as [deploy it with a bundler](dpp-profiles.md#deploy-it-with-a-bundler) shows.

## Runtime dependencies per package

Source: `conformance/licences.json` in the same source checkout. See the [licence guide](../contribute/licence.md).

- `@bsv/dpp-protocol` 0.3.0-beta.10: `@bsv/sdk` 2.8.10
- `@bsv/dpp-overlay` 0.4.0-beta.13: `@bsv/dpp-protocol` 0.3.0-beta.10, `@bsv/dpp-profiles` 0.3.0-beta.10, `@bsv/overlay` 2.3.1, `@bsv/sdk` 2.8.10, `mongodb` 7.6.0
- `@bsv/dpp-profiles` 0.3.0-beta.10: `canonicalize` 5.0.0
- `@bsv/dpp-credentials` 0.2.0-beta.6: `@bsv/dpp-protocol` 0.3.0-beta.10, `@bsv/sdk` 2.8.10, `@digitalbazaar/credentials-context` 3.2.0, `@digitalbazaar/data-integrity` 2.5.0, `@digitalbazaar/data-integrity-context` 2.0.1, `@digitalbazaar/ecdsa-multikey` 1.8.0, `@digitalbazaar/ecdsa-rdfc-2019-cryptosuite` 1.3.0, `@digitalbazaar/multikey-context` 2.0.1, `ajv` 8.20.0, `ajv-formats` 3.0.1, `did-context` 3.1.1, `jsonld-signatures` 11.6.0

## Images

The index and the validator service are also delivered as images, run by the [operator preset](../operate/README.md). Registry: `ghcr.io/bsv-blockchain`. An image is pinned by its digest and by nothing else; `unpublished` means the image has not been published and has no digest yet.

| Image | Runs | Dockerfile | Node | Platforms | Digest |
|---|---|---|---|---|---|
| `dpp-overlay` | `@bsv/dpp-overlay` 0.4.0-beta.13 | `packages/dpp-overlay/Dockerfile` | 22.23.4 | linux/amd64, linux/arm64 | `unpublished` |
| `dpp-validator` | `@bsv/dpp-profiles` 0.3.0-beta.10 | `packages/dpp-profiles/validator-image/Dockerfile` | 22.23.4 | linux/amd64, linux/arm64 | `unpublished` |

The preset also runs images this repository does not build or contain, each under its publisher's own licence:

| Image | Version | Licence | Digest | Resolved |
|---|---|---|---|---|
| `mongo` | 7.0.48 | SSPL-1.0 | `sha256:9896df581dfd0718b7abe112f4c37598d0986c54060e4ec1384997e6503c8c71` | 2026-11-15 |

See [release sets](../reference/release-sets.md) for the compatibility declaration and [package installation](README.md) for candidate checks.

