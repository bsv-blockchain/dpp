# Release sets

Installers, implementers and reviewers can use this page to select a release set and reproduce its checks. A set declares package versions, wire and contract versions, profiles and a conformance selection as one compatibility target. Use the current candidate for source development, or a publication receipt to reproduce a published set.

## Prerequisites and choice of target

| Procedure | Inputs and source |
|---|---|
| Source development | Candidate declaration and package versions below; local archive instructions in the installation step. |
| Published verification | The selected receipt, approved plan and recorded source revision. Use Node 22, npm 11.19.0 and git, with npm registry access. |
| Historical beta.4 signature check | An empty directory. |
| Historical beta.4 integrity comparison | Checkout root on `main`, containing the archived approved plan. |
| Source reproduction | A fresh, clean checkout at the receipt's exact revision. Keep generated logs and other extra files outside it; files written inside change the plan. |

## The current set

| | `dpp-release-2026-11` |
|---|---|
| Declaration | `release/dpp-release-2026-11.json`; its source revision is recorded when a publication plan binds it |
| Status | Candidate. Nothing of it is published; the last published set is `dpp-release-2026-10-10`, under `latest` since 16 October 2026 ([beta.11 receipt](publication-history/beta-11-publication.md)) |
| Main packages | `@bsv/dpp-protocol@0.3.0-beta.10`, `@bsv/dpp-overlay@0.4.0-beta.13`, `@bsv/dpp-profiles@0.3.0-beta.10`, `@bsv/dpp-credentials@0.2.0-beta.6`, on `@bsv/sdk@2.8.10` and Node 22 |
| Licence | Apache 2.0 for the packages and for this repository's code in both images. The operator preset also runs MongoDB Community Server, which is under the Server Side Public License ([the operator preset](../contribute/licence.md#the-operator-preset)) |
| Images | `dpp-overlay` and `dpp-validator`, unpublished: the set records each with the word `unpublished` in place of a digest ([images](#images)) |
| npm tag | `latest`; install exact versions and retain the lockfile |
| Receipt | None yet; the [beta.11 receipt](publication-history/beta-11-publication.md) covers the last published set |
| Selection | `conformance/selections/dpp-release-2026-11.json`. From 12 November 2026 it requires one claim per role under `native-baseline@2`, the one baseline a claim names, with `gs1-identifier-discipline` and `profile-governance`, and withholds every other claim with its reason ([conformance](conformance.md)) |

Compared with the superseded `dpp-release-2026-10-10`, this set carries the seven decisions of bsv-blockchain/dpp#177:

| Change | Fields, interfaces and effect |
|---|---|
| Token payload validation | The verification report checks every token payload against its declared profile through a caller-supplied validator. The profiles package provides `profilePayloadValidator(ajv)`; missing profile stamps produce `profile-undeclared`. The validator is handed each state's `passportId` beside its payload, read from the decoded state. |
| Restricted disclosure | `legitimate` and `authority` tiers reach each reader re-encrypted to that reader's key under the one owner commitment. |
| Acceptance evidence | Evidence packages carry acceptance records under `authority`; read them with `acceptanceRecordsInPackage`. |
| Managed custody | Each state locks to its controller key. `managed-custody@2` is the one custody profile; after a committed transfer, a custodian's update or retirement for a managed holder depends on custody, and the report's limits say so. The holder instruction record is parked and the owner-signed transfer for version 1 lineages is removed. |
| Native claim | Names its state by outpoint in `recordId`; the anchor fixture is regenerated around the chain-v1 genesis. From 12 November 2026 a claim carries no evidence facets, and the fixture keeps the one claim's exact bytes. |
| Contracts | Index contract `0.14.0-draft` adds the refusal and `POST /register` for self-service publisher-key registration from the application's wallet, and separates a core, version 1, from versioned extensions, with informative refusal codes; `GET /history` and the complete export are reference features of the overlay package. Registry contract `0.6.0` adds the claim schema and the envelope of the directly signed EPCIS event, the parked `epcis-event-vc@1` representation; it refuses a submission of the parked `vsc-seal-json-v1` as `unsupported`, defines no status list publication, lists only the seven operations every registry serves, and has no legacy intake: a historical UORA body is refused as `invalid`, and stored historical records stay readable. Every evidence package is signed by the child of its exporter's identity key for the passport. The application interoperability contract is the reference application's own. |
| Starters | The application starter pins the new set and signs claims with the outpoint. The index starter is retired; the index runs from the [Compose preset](../operate/README.md). |
| Specification scope | From 12 November 2026 passport projections and the publication policy are reference features of the profiles package ([parked material](parked/passport-projections/README.md)), the GS1 discovery specification keeps only the DPP identifier rules, the publisher policy chain, write tokens, registration operations and synchronisation are reference features of the overlay package with SHIP/SLAP discovery and `federated-operators@1` parked, the drafts `battery@3`, `textile@3` and `textile@4` are parked, and since retired with the other sector profiles, and `spec/rules.md` §4 is the one definition of the canonical JSON the native documents use. No wire byte changes. |
| Record version 3 | Parked outside the standard ([parked material](parked/token-carrier/README.md)): the packages read and write versions 1 and 2, the index declares no `dpp-record` version `3` and has no token id lookup, and the verification report is version 2, without the carrier's two reason codes. |
| Directly signed EPCIS events | Parked on 14 November 2026 while the representation is reconsidered: the `epcis-event-vc@1` module stays in the repository and `@bsv/dpp-protocol` no longer exports it ([parked: sign an event](../interoperability/epcis.md#parked-sign-an-event)). Its manifest reads `parked`, its vectors stay as published, and its rows and claim are in the ledger archive. No published set exported it. |
| Sector profiles | Retired on 14 November 2026: `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4`. Their manifests and generated files stay in the profiles package byte for byte. The application starter writes nothing under them, `@bsv/dpp-profiles` prepares and validates nothing under them, and a payload that declares one reads `unknown` with the cause `profile-retired`. An index does not judge profiles, so a state another writer issues under one is still indexed, and still reads as unsupported. `eu-battery@1` and `eu-textile@1`, held by bundled bindings, replace them with no converter ([move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles)). `general@1` and `general@2` are unaffected. The battery demonstration row is in the ledger archive, and `profile-governance` requires the retirement rule. No published set retired a profile. |
| Durable EPCIS import | From 14 November 2026 `@bsv/dpp-credentials` has the `./epcis-exchange` entry point: file import into storage the application supplies, with exact-byte retention, idempotent requests, arrival records, conflict decisions, a rebuildable associations index, original-byte export and recovery ([durable EPCIS import](../packages/dpp-credentials.md#durable-epcis-import)). The import record contract is version 2, which requires the request digest, with version 1 kept as `contracts/epcis-import-v1.schema.json`, and `contracts/epcis-exchange-records.schema.json` defines the other durable records. It is no EPCIS repository. |
| Validator service | From 15 November 2026 `@bsv/dpp-profiles` has the `./validator-service` and `./validator-client` entry points and the `dpp-validator` executable: the JSON-LD and SHACL engines in another process under the `dpp-validator/1` contract, `contracts/validator.schema.json`, with an image of their own built from `packages/dpp-profiles/validator-image/Dockerfile`. An application chooses between the service and the engines in its own process by configuration, and a service it cannot use reads `unknown`, never `pass` ([run the engines as a service](../packages/dpp-profiles.md#run-the-engines-as-a-service)). The image is built and checked here and is not published |
| Images and the operator preset | From 15 November 2026 the set names its images in an `images` member: `dpp-overlay` and `dpp-validator`, each with its Dockerfile, the exact Node version it runs and its digest, and the MongoDB image the preset runs, by tag and digest. The preset pulls each image by digest, includes the validator service, and builds nothing; `deploy/compose.build.yml` builds from source. Both images are labelled with the source revision, the release set and the package version, and the index image carries `NOTICE` and `PATENTS` beside `LICENSE`. The index and the validator service were held to their npm deliveries by `scripts/delivery-parity.mjs` ([images](#images)). `@bsv/dpp-overlay` now names the `mongodb` driver at exactly 7.6.0, the version the image installs. |
| EPCIS query pull | From 14 November 2026 the same entry point has `pullEpcisEvents`: one bounded run against a source's standard events query, over a transport and storage the application supplies. Every page goes through the import, the checkpoint moves only after a page is retained, an unusable cursor leads to a bounded replay, and a result says whether the source's pages were exhausted, a limit stopped the run or it failed ([EPCIS query pull](../packages/dpp-credentials.md#epcis-query-pull)). `contracts/epcis-exchange-records.schema.json` gains the pull record and the page record, and the import record may carry `query` provenance. It is a client of the query interface, not a repository, and promises no complete history. |
| EPCIS recovery | From 15 November 2026 the same entry point moves an exchange to another store: `exportEpcisRecovery` takes every retained original and every durable record of the covered source scopes out as a recovery snapshot at one boundary, and `restoreEpcisRecovery` checks a snapshot and puts it into a store behind any adapter, keeping every identity and relocating only where the bytes are kept ([EPCIS recovery](../packages/dpp-credentials.md#epcis-recovery)). A snapshot is files with one `dpp-evidence-package@1` inventory entry each beside a descriptor, `contracts/epcis-recovery.schema.json`; the package manifest and its schema are unchanged. `contracts/epcis-exchange-records.schema.json` gains the record of a restore, the record of where each original was placed, the journal entry of an unfinished restore and the optional `endpointRemaps` of a pull record. It carries no credential, it is an authorised path apart from public evidence, and it moves an exchange between stores of this module only. |

The preceding published set introduced record version 3, the token carrier: a seventeen-field body behind a BRC-162 token prefix, representing one unit ([the specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/token-carrier.md)), which this candidate parks. It also added optional index discovery, advertising and retries ([federation](../operate/federation.md)), and the `single-operator@2` operator profile. Those remain part of this candidate; neither the package renames nor the overlay republication adds a wire-format change.

## Use the current set

1. Install the exact public versions, or [build and install the local candidate archives](../packages/README.md#use-the-renamed-source-candidate) to test unpublished source.
2. Record package versions, source revision and lockfile alongside the configuration of each service you run or use.
3. Review the [migration guide](../migration.md) before upgrading an existing deployment. Installing a new profile package does not activate a new writer profile ([updating applications](../profiles/updating-applications.md)).

These are experimental prereleases: APIs may change during testing. Package versions are separate from specification, wire-format and frozen profile versions. Publication and installation establish neither deployed interoperability nor production readiness.

## Verify a published release

The last published set is `dpp-release-2026-10-10`: protocol and profiles beta.9, overlay beta.12 and credentials beta.5 under their new names, on `latest` since 16 October 2026. Its [beta.11 receipt](publication-history/beta-11-publication.md) records the approved source revision `0e45ac32da351c1e877431d55e2e9c0c41f54c33`, original release-set input, archive digests and verification results.

Reproduce the published packages with the receipt's [verification steps](publication-history/beta-11-publication.md#verification):

1. Use a clean checkout at `0e45ac32da351c1e877431d55e2e9c0c41f54c33` with the toolchain above.
2. Run the receipt's commands from that checkout's root:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

3. Expect `Every npm tarball matches the candidate bytes.` and `Every sentence above holds.` Compare the generated `release/publication-plan.json` with the receipt's archived plan on the default branch; it is absent from the source revision's tree. Stop on differing bytes or a failed check. These commands neither publish nor change tags.

### Historical beta.4 reproduction

The worked example below reproduces the historical beta.4 publication. Its package versions and source revision belong to that archived set.

These steps check npm bytes against the approved plan and public source revision, then inspect ledger claims. Each step can be run alone with the historical prerequisites above.

1. **Check registry signatures and provenance.** Run:

   ```sh
   npm init -y
   npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3
   npm audit signatures
   ```

   It printed `87 packages have verified registry signatures` and `17 packages have verified attestations`; the four DPP packages are among the attested ones, and nothing was reported invalid or missing.

2. **Compare each archive with the approved plan.** Print the registry's integrity for each package and the [approved plan](publication-history/beta-4-publication-plan.json)'s recorded integrity:

   ```sh
   for p in @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3; do echo "$p $(npm view "$p" dist.integrity)"; done
   node -e "for (const c of require('./docs/reference/publication-history/beta-4-publication-plan.json').candidates) console.log(c.name + '@' + c.version, c.integrity)"
   ```

   The two lists must match line for line, starting `@bsv/dpp-core@0.3.0-beta.4 sha512-bSOxqRghWrxsrPY7…`.

3. **Rebuild the plan from the source revision.** Repack from the recorded revision, never from `main`: its packages have changed since publication, so their archives differ. Use the checkout prerequisites above:

   ```sh
   git clone https://github.com/bsv-blockchain/dpp.git dpp-beta-4
   cd dpp-beta-4
   git checkout --detach f9d8e98658c7cf406702d49194ec5a8480cbca73
   npm ci
   node scripts/release-candidates.mjs release/dpp-release-2026-10.json
   node scripts/publish-candidates.mjs --verify-registry
   node scripts/consumer-check.mjs --registry
   ```

   `publish-candidates.mjs --verify-registry` writes `release/publication-plan.json` and prints `Publication plan SHA-256: ecf6151b4f4dfaba47f9579426fcc3dcb58324b3517cbd36cc4be52c6dff3b51`, the digest the receipt records, then `already-published` for each package and `Every npm tarball matches the candidate bytes.` The written plan is byte-identical to the archived one. `consumer-check.mjs --registry` installs the public versions into a separate project and ends `Every sentence above holds.` None of these commands publishes anything or moves a tag.

4. **Read what the ledger claims.** Run the two checks on [conformance](conformance.md). The selection qualifies and withholds seven claims, among them federated operation, European conformity, battery product qualification and version 1.0 readiness.

The steps above use the values of the published beta.4 set, `dpp-release-2026-10`; to verify another published set, use its receipt, plan and source revision. The receipts of earlier publications have their own verification sections with the same commands at their own revisions.

## Images

The index and the validator service are each one runtime delivered two ways: as an npm package with a command, and as an image. The set's `images` member is the one place the registry, each image's name and each digest are written.

| Image | Runs | Dockerfile | Node | Digest |
|---|---|---|---|---|
| `dpp-overlay` | `@bsv/dpp-overlay@0.4.0-beta.13`, the files of the npm package, started by the same entry point as `dpp-index` | `packages/dpp-overlay/Dockerfile` | 22.23.4 | `unpublished` |
| `dpp-validator` | The validator service of `@bsv/dpp-profiles@0.3.0-beta.10`, the files of the npm package, with the engine libraries from the image's own lockfile | `packages/dpp-profiles/validator-image/Dockerfile` | 22.23.4 | `unpublished` |
| `mongo` | MongoDB Community Server 7.0.48, published by its maker under the Server Side Public License; not built here and not contained in anything this repository publishes | none | not applicable | `sha256:9896df581dfd0718b7abe112f4c37598d0986c54060e4ec1384997e6503c8c71`, the multi-platform index the tag named on 15 November 2026 |

| Question | Answer |
|---|---|
| Where is the registry named? | `images.registry` in the set, `ghcr.io/bsv-blockchain` in this candidate. It is a name until the images are published, and it is changed there and nowhere else: `node scripts/release-images.mjs render` writes it into `deploy/operator.env.example`, and `node scripts/release-images.mjs check` and the conformance checker hold the preset to the set. |
| What pins an image? | Its digest. The preset has no setting that takes a tag, and refuses to start with a digest missing. |
| What are the images built on? | The Docker Official Image `node:22.23.4-slim` at `sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d`, the multi-platform index the tag named on 15 November 2026. Each Dockerfile's default and the set's `runtime.baseImage` name it by that digest, and the contents check holds a built image's lowest layers to it. |
| What does an image say about itself? | Its labels name the source revision, whether that source was committed, the release set, the package and its version, and the Node version. `node scripts/release-images.mjs inspect dpp-overlay=<image>` reads them back and holds them to the set and to the package manifest inside the image. |
| How are the images published? | By the workflow `publish-images.yaml`, started by hand, under the same approved publication plan digest as the npm packages. It builds for `linux/amd64` and `linux/arm64`, pushes by digest and uploads the digests; recording them in the set is a reviewed change made with `node scripts/release-images.mjs pin`. It has never run. |
| What was compared? | `deploy/evidence/delivery-parity.json` records the run of `scripts/delivery-parity.mjs` and `deploy/evidence/image-contents.json` the run of `scripts/image-contents-check.mjs`, both against images built on one machine for its own platform. They record what was run and the limits it reached, and what was not run. |
| What is a deployment made of? | `conformance/deployment-inventory.json` lists the packages, files, images and services with the terms each is under and the disposition recorded for it ([the whole deployment](../contribute/licence.md#the-whole-deployment)). |

## Earlier sets

[Release history](release-history.md) is the one record of earlier sets: each with its date, what it published, its publication receipt and approved plan, and its recorded source revision. Superseded sets and their selections are kept, byte for byte, under `release/archive/`. Use those records when checking an older installation or reproducing an earlier publication.

## How a set is made

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/44cc49926042466f5a01074d5b0ef0eed7ebdf29/release/README.md) packs a set into candidate archives and writes a candidate record, `release/candidates.json`, with the source revision and each archive's digest; a set's name alone is not that revision. [Publish a package update](publishing-profile-updates.md) is the maintainer procedure from candidate to npm.

Next: install the current set with [install the selected release](../packages/README.md), or check what it claims on [conformance](conformance.md).
