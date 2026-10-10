# Supported entry points

Generated from `release/dpp-release-2026-10-8.json` in the documentation build for `dpp-release-2026-10-8` (candidate). The [release guide](../reference/release-sets.md) explains how a consumer selects and verifies the matching artefacts.

| Package | Entry point | Kind | Runtime | Browser | Types | Side effects | Node built-ins | Carries |
|---|---|---|---|---|---|---|---|---|
| `@bsv/dpp-protocol` 0.3.0-beta.9 | `.` | module | Node >=22 | Untested | Yes | None | none | `dist/`, `schemas/` |
| `@bsv/dpp-protocol` 0.3.0-beta.9 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json` |
| `@bsv/dpp-core` 0.3.0-beta.9 | `.` | module | Node >=22 | Untested | Yes | None | none | `dist/`, `schemas/` |
| `@bsv/dpp-core` 0.3.0-beta.9 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json` |
| `@bsv/dpp-overlay-topics` 0.4.0-beta.11 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:process`, `node:util`, `node:url` | `dist/` |
| `@bsv/dpp-overlay-topics` 0.4.0-beta.11 | `./server` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:process`, `node:util`, `node:url` | `dist/` |
| `@bsv/dpp-profiles` 0.3.0-beta.9 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.9 | `./manifests/*` | data | Any | Plain data | No | None | none | `manifests/<id>@<version>.json`, `manifests/exchange/*.json`, `manifests/operator/*.json`, `manifests/interoperability/*.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.9 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json`, `schemas/gs1/*` |
| `@bsv/dpp-profiles` 0.3.0-beta.9 | `./generated/*` | data | Any | Plain data | No | None | none | `generated/payload-schema/*.schema.json`, `generated/consumer/*.json`, `generated/mapping/*.md`, `generated/index.json` |
| `@bsv/dpp-profiles` 0.3.0-beta.9 | `./frozen.json` | data | Any | Plain data | No | None | none | `frozen.json` |
| `@bsv/vsc` 0.2.0-beta.5 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0-beta.5 | `./exchange` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0-beta.5 | `./epcis-source` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0-beta.5 | `./artifacts/*` | data | Any | Plain data | No | None | none | `artifacts/context-0.1.0.jsonld`, `artifacts/seal-0.1.0.schema.json`, `artifacts/disclosure-0.1.0.schema.json`, `artifacts/profile-0.1.0.json`, `artifacts/epcis/*`, `artifacts/external/*`, `artifacts/w3c/*` |

`@bsv/dpp-profiles` reads its manifests and schemas from its own directory at run time, by a path computed from the profile identifier. A bundler or file tracer cannot see those reads, so a bundled deployment must include the data files, as [deploy it with a bundler](dpp-profiles.md#deploy-it-with-a-bundler) shows.

## Runtime dependencies per package

Source: `conformance/licences.json` in the same source checkout. See the [licence guide](../contribute/licence.md).

- `@bsv/dpp-protocol` 0.3.0-beta.9: `@bsv/sdk` 2.8.10
- `@bsv/dpp-core` 0.3.0-beta.9: `@bsv/dpp-protocol` 0.3.0-beta.9
- `@bsv/dpp-overlay-topics` 0.4.0-beta.11: `@bsv/dpp-protocol` 0.3.0-beta.9, `@bsv/dpp-profiles` 0.3.0-beta.9, `@bsv/overlay` 2.3.1, `@bsv/sdk` 2.8.10, `mongodb` ^7.6.0
- `@bsv/dpp-profiles` 0.3.0-beta.9: `canonicalize` 5.0.0
- `@bsv/vsc` 0.2.0-beta.5: `@digitalbazaar/bbs-2023-cryptosuite` 2.0.1, `@digitalbazaar/bls12-381-multikey` 2.2.0, `@digitalbazaar/credentials-context` 3.2.0, `@digitalbazaar/data-integrity` 2.5.0, `@digitalbazaar/data-integrity-context` 2.0.1, `@digitalbazaar/ecdsa-multikey` 1.8.0, `@digitalbazaar/ecdsa-rdfc-2019-cryptosuite` 1.3.0, `@digitalbazaar/ed25519-signature-2020` 5.4.0, `@digitalbazaar/ed25519-verification-key-2020` 4.2.0, `@digitalbazaar/multikey-context` 2.0.1, `ajv` 8.20.0, `ajv-formats` 3.0.1, `did-context` 3.1.1, `jsonld-signatures` 11.6.0

See [release sets](../reference/release-sets.md) for the compatibility declaration and [package installation](README.md) for candidate checks.

