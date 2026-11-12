# Licence and reuse

Anyone copying, modifying or redistributing DPP code, specifications or documentation can use this page to identify the applicable licence and notices, including third-party terms.

## The repository and its packages

The repository's software, specifications, schemas, fixtures, examples and documentation, its packages included, use the Apache License, Version 2.0 (`Apache-2.0`), copyright BSV Association. The full text is in the root [`LICENSE`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/LICENSE), and each package carries the same text in its own `LICENSE`, for example [the protocol library's licence at the recorded revision](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/LICENSE).

The licence text governs. This table summarises Apache 2.0:

| Topic | Terms |
|---|---|
| Permitted use | Use, modify and redistribute the material |
| Patents | Patent licence from contributors |
| Trademarks and warranty | No trademark rights; no warranty |

### Apply the redistribution duties

When redistributing:

1. Give recipients a copy of the licence.
2. Keep copyright and attribution notices.
3. Mark the files you changed.

## Versions already on npm

| Scope | Recorded rule or publication |
|---|---|
| Source change | The licence change applies to the current source tree, from commit [`dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d`](https://github.com/bsv-blockchain/dpp/commit/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d) on 1 October 2026. |
| First Apache publication | The beta.5 set published on 2 October 2026, `@bsv/dpp-core@0.3.0-beta.5`, `@bsv/dpp-overlay-topics@0.4.0-beta.5`, `@bsv/dpp-profiles@0.3.0-beta.5` and `@bsv/vsc@0.2.0-beta.4` (the overlay and credentials packages under the names they were published with at the time), is the first under Apache 2.0 ([receipt](../reference/publication-history/beta-5-publication.md)). |
| Earlier publications | Every earlier version, up to `@bsv/dpp-core@0.3.0-beta.4`, `@bsv/dpp-overlay-topics@0.4.0-beta.4`, `@bsv/dpp-profiles@0.3.0-beta.4` and `@bsv/vsc@0.2.0-beta.3`, was published before the change. |
| Earlier archives | Published archives cannot change. Each earlier version keeps the Open BSV License Version 6 it contains, which among other conditions limits use to the BSV blockchains it defines. |
| Installed version | Read the `LICENSE` file inside the version you install. |

## Third-party material

Third-party dependencies and artefacts keep their own terms and notices; the repository's licence does not replace them.

| Material | Terms and notices |
|---|---|
| Package dependencies | The [licence ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/licences.json) records the licence each direct dependency declares, and `conformance/check.mjs` notices when one changes |
| Credential and event artefacts | The [notices beside the retained artefacts](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |
| GS1 schema material | The [GS1 schema notice](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/gs1/NOTICE.md) |

Read the applicable terms before reuse. For a reuse question these sources do not answer, use the [BSV Association contact page](https://bsvassociation.org/contact/).

Next: [how the standard changes](README.md) if you want to contribute your changes back.
