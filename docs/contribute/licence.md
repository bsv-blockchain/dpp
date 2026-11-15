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
| Credential artefacts | The [notices beside the retained artefacts](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |
| Bundled profile bindings | The contexts and shapes under `packages/dpp-profiles/bindings/`, and the example documents under `packages/dpp-profiles/test/fixtures/sector-bindings/`, are unmodified files published by the OpenEPCIS DPP-Ready project under `Apache-2.0`. The `NOTICE.md` beside each binding names the source revision, lists every file with its SHA-256 and reproduces the GS1 Web Vocabulary notice that one context carries |
| Validator image | The `dpp-validator` image installs the three engine libraries and what they depend on, 413 packages, all under permissive licences. `packages/dpp-profiles/validator-image/licence-inventory.json` lists each with its version and licence, and the image carries the text of every licence and notice file those packages publish in `/app/THIRD-PARTY-NOTICES.txt`, beside this repository's `LICENSE`, `NOTICE` and `PATENTS`. Its base image keeps its own notices. No npm package of this repository depends on those libraries ([run the engines as a service](../packages/dpp-profiles.md#run-the-engines-as-a-service)) |
| Index image | The `dpp-overlay` image carries this repository's `LICENSE`, `NOTICE` and `PATENTS` in `/repo`, beside the built files of `@bsv/dpp-overlay`, `@bsv/dpp-protocol` and `@bsv/dpp-profiles` and their installed dependencies, each with the licence file its package publishes. Its base image keeps its own notices. `scripts/image-contents-check.mjs` reads every file of the built image and of each packed npm archive and holds them to this page |
| GS1 schema material | GS1's EPCIS and resolver schemas and contexts are not in the repository or its packages. GS1 publishes them under its own terms, and they are not redistributed here. The one file derived from GS1 material is the shortcuts context in the bundled bindings above, generated from the GS1 Web Vocabulary, which GS1 licenses under `Apache-2.0`. Each deployment obtains them from GS1 and the package checks every byte against a pinned digest ([GS1 files](../packages/dpp-credentials.md#gs1-files)). |

## The operator preset

The Docker Compose preset under `deploy/` runs three programs, and they are not under one licence. The repository's code is under Apache-2.0. A deployment made from the preset as a whole is not: it includes MongoDB Community Server, which has a licence of its own.

| Service | What it is | Licence | How it reaches a deployment |
|---|---|---|---|
| `overlay` | The index image, `dpp-overlay` | This repository's code under Apache-2.0; the base image and each installed dependency under its own terms | Built from this repository and, once published, pulled by digest |
| `validator` | The validator service image, `dpp-validator` | This repository's code under Apache-2.0; the base image and each engine library under its own terms, listed in the image's licence inventory | Built from this repository and, once published, pulled by digest |
| `mongo` | MongoDB Community Server 7.0, the index's database | The Server Side Public License (SSPL), version 1, which MongoDB, Inc. publishes. It is not Apache-2.0, and it is not among the licences the Open Source Initiative has approved | Named by the preset by version tag and digest and pulled by the operator's Docker from its publisher |

| Question | Answer |
|---|---|
| Does this repository distribute MongoDB? | No. No image, npm package, implementer bundle or mirror of this repository contains the MongoDB server. The preset names the publisher's image, and `scripts/image-contents-check.mjs` reads every file of both images and of each packed archive to hold that. |
| Does MongoDB's licence change the licence of this code? | No. The index is a separate program that reaches the database over the network through the `mongodb` driver, a separate library published under Apache-2.0. The code of this repository stays under Apache-2.0. |
| What does an operator take on? | An operator that runs the preset uses MongoDB Community Server under the SSPL and reads that licence for itself. Using it as the index's own database is one thing; offering the functionality of MongoDB to third parties as a service, or redistributing it, carries obligations under the SSPL that are the operator's own. This page is not legal advice. |
| Must the bundled database be used? | No. `MONGO_URL` points the index at a database run elsewhere, and the bundled one then holds nothing. |
| What about the MongoDB the tests download? | The test suites fetch a MongoDB server to run against, through a development dependency. It is a development dependency in every workspace, so it is never installed with a published package and is in neither image; `conformance/check.mjs` and the contents check hold both. |

The exact image, its digest and the day it was resolved are in the `images` member of the [release set](../reference/release-sets.md#images).

Read the applicable terms before reuse. For a reuse question these sources do not answer, use the [BSV Association contact page](https://bsvassociation.org/contact/).

Next: [how the standard changes](README.md) if you want to contribute your changes back.
