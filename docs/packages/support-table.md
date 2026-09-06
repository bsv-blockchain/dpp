# Support table by entry point

**Generated** from [`release/dpp-release-2026-09-3.json`](https://github.com/bsv-blockchain/dpp/blob/main/release/dpp-release-2026-09-3.json) by `node scripts/render-support-table.mjs`; edit the release set, not this page. **Release:** `dpp-release-2026-09-3` (candidate). **Runtime baseline:** Node >=22, `@bsv/sdk` 2.4.2, `@bsv/overlay` 2.3.1, `mongodb` 7.5.0, `@bsv/wallet-toolbox-client` 2.11.0.

Every entry point the four packages export, with what it needs and what it carries. A module entry point ships TypeScript declarations and is exercised by the clean consumer check from its packed tarball; a data entry point is plain files any runtime or language reads. "Unsupported" in a browser means the code imports Node built-ins or server-only dependencies; "untested, not promised" means nothing known prevents it and no browser route is tested. The checker holds the declared Node built-ins to a scan of each package's built code.

| Package | Entry point | Kind | Runtime | Browser | Types | Side effects | Node built-ins | Carries |
|---|---|---|---|---|---|---|---|---|
| `@bsv/dpp-core` 0.3.0 | `.` | module | Node >=22 | Untested, not promised | Yes | None | none | `dist/` |
| `@bsv/dpp-overlay-topics` 0.4.0 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:http`, `node:url` | `dist/` |
| `@bsv/dpp-profiles` 0.3.0 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs` | `dist/`, `manifests/`, `schemas/`, `generated/`, `frozen.json` |
| `@bsv/dpp-profiles` 0.3.0 | `./manifests/*` | data | Any | Plain data | No | None | none | `manifests/<id>@<version>.json`, `manifests/exchange/*.json`, `manifests/operator/*.json`, `manifests/interoperability/*.json` |
| `@bsv/dpp-profiles` 0.3.0 | `./schemas/*` | data | Any | Plain data | No | None | none | `schemas/*.schema.json`, `schemas/gs1/*` |
| `@bsv/dpp-profiles` 0.3.0 | `./generated/*` | data | Any | Plain data | No | None | none | `generated/payload-schema/*.schema.json`, `generated/consumer/*.json`, `generated/mapping/*.md`, `generated/index.json` |
| `@bsv/dpp-profiles` 0.3.0 | `./frozen.json` | data | Any | Plain data | No | None | none | `frozen.json` |
| `@bsv/vsc` 0.2.0 | `.` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0 | `./exchange` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0 | `./epcis-source` | module | Node >=22 | Unsupported | Yes | None | `node:crypto`, `node:fs`, `node:zlib` | `dist/`, `artifacts/` |
| `@bsv/vsc` 0.2.0 | `./artifacts/*` | data | Any | Plain data | No | None | none | `artifacts/context-0.1.0.jsonld`, `artifacts/seal-0.1.0.schema.json`, `artifacts/disclosure-0.1.0.schema.json`, `artifacts/profile-0.1.0.json`, `artifacts/epcis/*`, `artifacts/external/*`, `artifacts/w3c/*` |

## Runtime dependencies per package

Read from `conformance/licences.json`, which the checker holds to what is installed.

- `@bsv/dpp-core` 0.3.0: `@bsv/sdk` 2.4.2
- `@bsv/dpp-overlay-topics` 0.4.0: `@bsv/dpp-core` ^0.3.0, `@bsv/overlay` 2.3.1, `@bsv/sdk` 2.4.2, `mongodb` ^7.0.0
- `@bsv/dpp-profiles` 0.3.0: `canonicalize` 4.0.0
- `@bsv/vsc` 0.2.0: `@digitalbazaar/bbs-2023-cryptosuite` 2.0.1, `@digitalbazaar/bls12-381-multikey` 2.2.0, `@digitalbazaar/credentials-context` 3.2.0, `@digitalbazaar/data-integrity` 2.5.0, `@digitalbazaar/data-integrity-context` 2.0.1, `@digitalbazaar/ecdsa-multikey` 1.8.0, `@digitalbazaar/ecdsa-rdfc-2019-cryptosuite` 1.3.0, `@digitalbazaar/ed25519-signature-2020` 5.4.0, `@digitalbazaar/ed25519-verification-key-2020` 4.2.0, `@digitalbazaar/multikey-context` 2.0.1, `ajv` 8.20.0, `ajv-formats` 3.0.1, `did-context` 3.1.1, `jsonld-signatures` 11.6.0

## Notes per entry point

- `@bsv/dpp-core` `.`: Depends on @bsv/sdk only and imports no Node built-in; a browser bundle is not tested and not promised.
- `@bsv/dpp-overlay-topics` `.`: Server only: Node built-ins, the overlay engine and the MongoDB driver. Importing never starts the HTTP host, which is reached by path as dist/index.js.
- `@bsv/dpp-profiles` `.`: Reads its data files through the Node file system; the one runtime dependency is the RFC 8785 canonicaliser.
- `@bsv/dpp-profiles` `./manifests/*`: Frozen profile manifests, plain JSON.
- `@bsv/dpp-profiles` `./schemas/*`: The manifest, identity, exchange, operator and interoperability schemas and the pinned GS1 resolver schemas.
- `@bsv/dpp-profiles` `./generated/*`: Generated payload schemas, consumer documents and mapping inventories.
- `@bsv/dpp-profiles` `./frozen.json`: The digests every published file is held to.
- `@bsv/vsc` `.`: Server only: reads its artefacts through the file system and decompresses status lists with node:zlib.
- `@bsv/vsc` `./exchange`: The external ecdsa-rdfc-2019 credential verifier; server only for the same reasons.
- `@bsv/vsc` `./epcis-source`: The EPCIS source helpers; server only for the same reasons.
- `@bsv/vsc` `./artifacts/*`: The owned context and schemas, the pinned EPCIS and W3C artefacts and the external passport context and schema, each with a notice file naming its digest.

## Version compatibility

The four packages are tested together as one set on the runtime baseline above. `@bsv/dpp-overlay-topics` depends on `@bsv/dpp-core` by a caret range on its minor version; every other cross-package relation is by the set. `@bsv/dpp-overlay-topics` is server-only by declaration in the set. A consumer pins the versions the set names; a caret range across a pre-1.0 minor is not a compatibility promise, the set is.

