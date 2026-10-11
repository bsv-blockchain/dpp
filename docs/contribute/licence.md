# Licence and reuse

This page says under which terms you may reuse the repository, its packages and the third-party material inside them. It is for anyone copying, modifying or redistributing the code, specifications or documentation.

## The repository and its packages

The repository's software, specifications, schemas, fixtures, examples and documentation, its packages included, use the Apache License, Version 2.0 (`Apache-2.0`), copyright BSV Association. The full text is in the root [`LICENSE`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/LICENSE), and each package carries the same text in its own `LICENSE`, for example [the protocol library's licence at the recorded revision](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/LICENSE).

In short, and the licence text governs: Apache 2.0 lets you use, modify and redistribute the material, and grants a patent licence from its contributors. When you redistribute it, give recipients a copy of the licence, keep the copyright and attribution notices, and mark the files you changed. It grants no trademark rights and comes without warranty.

## Versions already on npm

The licence change applies to the current source tree, from commit [`dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d`](https://github.com/bsv-blockchain/dpp/commit/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d) on 1 October 2026. The beta.5 set published on 2 October 2026, `@bsv/dpp-core@0.3.0-beta.5`, `@bsv/dpp-overlay-topics@0.4.0-beta.5`, `@bsv/dpp-profiles@0.3.0-beta.5` and `@bsv/vsc@0.2.0-beta.4`, is the first under Apache 2.0 ([receipt](../reference/beta-5-publication.md)). Every earlier version, up to `@bsv/dpp-core@0.3.0-beta.4`, `@bsv/dpp-overlay-topics@0.4.0-beta.4`, `@bsv/dpp-profiles@0.3.0-beta.4` and `@bsv/vsc@0.2.0-beta.3`, was published before the change. Published archives cannot change, so each keeps the licence file it contains: the Open BSV License Version 6, which among other conditions limits use to the BSV blockchains it defines. Read the `LICENSE` file inside the version you install.

## Third-party material

Third-party dependencies and artefacts keep their own terms and notices; the repository's licence does not replace them.

| Material | Terms and notices |
|---|---|
| Package dependencies | The [licence ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/licences.json) records the licence each direct dependency declares, and `conformance/check.mjs` notices when one changes |
| Credential and event artefacts | The [notices beside the retained artefacts](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/vsc/artifacts) |
| GS1 schema material | The [GS1 schema notice](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/gs1/NOTICE.md) |

Read the applicable terms before reuse. For a reuse question these sources do not answer, use the [BSV Association contact page](https://bsvassociation.org/contact/).

Next: [how the standard changes](README.md) if you want to contribute your changes back.
