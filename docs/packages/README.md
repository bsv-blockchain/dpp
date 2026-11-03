# Install the selected release

Application developers can use this guide to install an exact DPP package selection and check its archives. Choose the npm release for a published installation or local archives to test the source candidate.

**Experimental prerelease:** These packages support implementation and interoperability testing; they are not declared production-ready. APIs may change significantly before stability. Package, specification, wire-format and frozen-profile versions are separate. Pin exact packages and retain the lockfile.

The published release uses **`@bsv/dpp-protocol`**, the new name for the library previously called `@bsv/dpp-core`. The active release uses only the new name; existing consumers must [migrate imports and schema paths](../migration.md#rename-dpp-core-to-dpp-protocol). Earlier pinned installations keep their names and bytes.

## Installation prerequisites

| Context | Input and source |
|---|---|
| All consumers | Select components with [choose packages and services](../start/choose-components-and-services.md), then use [release status](../reference/release-sets.md) to distinguish published and candidate versions. |
| Application installation | Node >=22 and a project using ECMAScript modules. All four DPP packages use ECMAScript modules; npm installation needs no repository clone. |
| Candidate packing | Source checkout containing `packages/dpp-protocol`; Node 22 or later. |
| Archive reproduction | Node 22, npm 11.19.0 and the receipt's exact revision. Different compression implementations can change archive digests. Keep a separate checkout to retain both current and historical revisions. |
| Hosted writer | A wallet toolbox accepting the selected SDK ([choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet)). |
| Runtime/deployment | Check the candidate's [supported entry points](support-table.md). Node support does not establish browser support. |

## Choose your starting point

| You want to | Start here | What to install |
| --- | --- | --- |
| Create a new application | [Create an application](create-dpp-app.md) | Use `@bsv/create-dpp-app`. It includes the application files and selected dependencies |
| Run a new index | [Create an index](create-dpp-index.md) | Use `@bsv/create-dpp-index`. It includes `@bsv/dpp-overlay` in the generated project's dependencies |
| Connect your app to an existing index | [Choose index access](../start/choose-components-and-services.md#decide-which-services-to-run-or-use) | Neither index package is needed just for HTTP access; obtain the URL and scoped access settings |
| Add DPP helpers to your own code | [Choose reference libraries](../start/choose-components-and-services.md#pick-only-the-packages-your-task-uses) | Select only the libraries your code uses, following the version instructions below |
| Embed an index or build a custom host | [Index runtime (advanced)](dpp-overlay.md) | Install the runtime directly as an alternative to the starter |

Both starters are published at `0.1.0-beta.1`; unpublished source `0.1.0-beta.2` pins the candidate. Their guides cover npm creation and source checks. Generated projects already declare dependencies and pins: follow their README. Continue below for direct library selection or source development.

## Use the renamed source candidate

1. From the candidate checkout root, build, pack and check:

```sh
npm ci
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The commands publish nothing. Expect archives in `release/candidates/`, source revision and digests in `release/candidates.json`, and a consumer check in a separate project ending `Every sentence above holds.` Stop if packing or checking fails.

2. In your application directory, install the selected archives together so npm resolves unpublished dependencies locally. Replace `/absolute/path/to/dpp` with the checkout path:

```sh
npm install --save-exact /absolute/path/to/dpp/release/candidates/bsv-dpp-protocol-0.3.0-beta.10.tgz /absolute/path/to/dpp/release/candidates/bsv-dpp-profiles-0.3.0-beta.10.tgz @bsv/sdk@2.8.10
```

3. To embed an index, include `bsv-dpp-overlay-0.4.0-beta.13.tgz` from the same directory. HTTP-only clients need no index package. Retain the selected archives and resulting lockfile.

Use the exact npm versions below for published installations.

## Install from npm

The latest complete publication with a receipt here is `dpp-release-2026-10-10` ([beta.11 receipt](../reference/beta-11-publication.md)); candidate `dpp-release-2026-11` supersedes it for source development. Exact published versions remain available even if mutable tags move.

| Library | Published npm version | Candidate archive version | Select for |
|---|---|---|---|
| Protocol | `@bsv/dpp-protocol@0.3.0-beta.9` | `0.3.0-beta.10` | Passport records, verification and native lifecycle claims |
| Profiles | `@bsv/dpp-profiles@0.3.0-beta.9` | `0.3.0-beta.10` | Manifests, payload schemas and supported projection/discovery helpers |
| Credentials | `@bsv/dpp-credentials@0.2.0-beta.5` | `0.2.0-beta.6` | Selected VSC credential/exchange features; unnecessary for native lifecycle-claim signing |
| Overlay | `@bsv/dpp-overlay@0.4.0-beta.12` | `0.4.0-beta.13` | Embedded topic managers/lookup services; starters declare it, HTTP clients need none |
| SDK | `@bsv/sdk@2.8.10` | `2.8.10` | Declare directly when importing wallet or transaction APIs |

Install only what your code uses. Start with protocol:

```sh
npm install --save-exact @bsv/dpp-protocol@0.3.0-beta.9
```

For a published installation using the protocol helpers, profiles and the SDK:

```sh
npm install --save-exact @bsv/dpp-protocol@0.3.0-beta.9 @bsv/dpp-profiles@0.3.0-beta.9 @bsv/sdk@2.8.10
```

Releases publish to `latest` until version 1.0; exact versions and the lockfile define the tested installation. An [independent implementation](../implement/README.md) needs none of these packages.

A trial consumer builds a second index, registry and application from these docs and published packages; its findings lead to fixes here. Shared administration makes it a reference consumer, not an independent implementation.

## Application responsibilities and package boundaries

Use this workflow map, then follow [build an application](build-an-application.md) for call order from first read to publication.

| Workflow | Public package API | Application responsibility | Specification |
|---|---|---|---|
| Issue, update and retire a passport | Protocol `completeState`, `buildLockingScript`, `verifyChain` | Supply authorised signers and a funded BRC-100 wallet; verify before sending; serialise writes, retain evidence and obtain proofs | Record models and writing lifecycle |
| Offer, accept and transfer custody | Protocol `signManagedAcceptance`, `acceptanceCommitment`, `bindAcceptanceToState` | Record offers, expiry, recipient evidence, access policy, idempotency and operation outcomes | Managed custody |
| Decline an offer or query an operation | Application orchestration | Persist the workflow without inventing another token operation | Managed custody and writing lifecycle |
| Read and verify a passport | Protocol `findDppOutputs`, `verifyPassportEvidence` | Supply expected subject, history, header source, latest-state observations and authority policy | Verification |
| Sign, anchor and verify lifecycle claims | Protocol `signLifecycleClaim`, `buildAttestationAnchor`, `verifyLifecycleClaim` | Retain exact secured bytes; fund and broadcast the separate anchor; configure authority and status evidence | Rules and services |
| Find passport states and anchors | Overlay topic managers and lookup services, or the BRC-24 HTTP contract | Choose an operator; retrieve and verify the returned evidence; retry announcement using the same transaction | Overlay services |
| Validate profiles and project data | Profiles `readManifest`, `missingRequired`, `projectPassport` and data exports | Select exact profile versions; supply sources, policy and a format-asserting schema validator | Profiles and projections |
| Credentials and source exchange | VSC `verifySeal`, `./exchange`, `./epcis-source` | Supply selected suites, authority/status evidence and durable source retention | Credential and interoperability profiles |
| Export and import evidence | Protocol `signEvidenceManifest`, `inspectEvidencePackage`; overlay `buildEvidenceExportPart`, `joinEvidenceExport` | Retain and transport files; check digests and reverify under the reader's own policy | Portable evidence |

The application service is outside this release. Supply application adapters rather than inheriting its demonstration persistence and identities. Reference packages supply shared protocol rules, excluding a hosted registry, accounts and durable operation scheduling.

Keep server packages on the backend; use the [support table](support-table.md) for browser-facing data exports. Missing proof, authority or status evidence stays `unknown`; never treat it as verified.

## Source access

The public repository supplies the current source candidate used by the examples and [quick start](../quick-start.md):

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git switch --detach
git rev-parse HEAD
npm ci
npm run build
```

Source includes later work, including opt-in index discovery and retries. Building it does not reproduce npm archives, even with unchanged version strings. Reproduce published packages at their [receipt's revision](../reference/release-sets.md).

This historical beta.4 example reproduces all four packages: the beta.4 `@bsv/dpp-core`, `@bsv/dpp-overlay` and `@bsv/dpp-profiles` and `@bsv/dpp-credentials@0.2.0-beta.3`. They repack byte for byte from `f9d8e98658c7cf406702d49194ec5a8480cbca73`, recorded in the [beta.4 receipt](../reference/beta-4-publication.md). Its examples predate the current quick start.

```sh
git checkout --detach f9d8e98658c7cf406702d49194ec5a8480cbca73
npm ci
npm run build
```

Read one file at a revision without a checkout:

```sh
git show f9d8e98658c7cf406702d49194ec5a8480cbca73:spec/record-model.md
```

Source links pin the revision each page was written against, which can differ from current and published source. Use the path after the hash. Other repositories require their own access; direct enquiries to the [BSV Association contact page](https://bsvassociation.org/contact/).

## Pack and check

To check a selected package revision, run from its checkout:

```sh
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The [candidate tooling](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/scripts/release-candidates.mjs) records revision and digests in `release/candidates.json`. The [consumer check](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/scripts/consumer-check.mjs) installs and exercises the tarballs in a separate project. Require `Every sentence above holds.` before using them; stop on failure.

To print the produced tarball paths, run:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const record = JSON.parse(readFileSync('release/candidates.json', 'utf8'))
for (const candidate of record.candidates) console.log(candidate.name, resolve('release/candidates', candidate.filename))
JS
```

In the application directory, use `npm install /absolute/path/to/the-produced-package.tgz` with the printed paths for selected packages, installing candidate archives together as above. Retain the lockfile. Run [quick starts](../quick-start.md) from the checkout or select a guide:

| Task | Package |
|---|---|
| Passport records and shared evidence | [Protocol](dpp-protocol.md) |
| Product profiles and projections | [Profiles](dpp-profiles.md) |
| Credentials and source events | [DPP credentials](dpp-credentials.md) |
| Index services | [Overlay](dpp-overlay.md) |

The [application service](application-service.md) is maintained separately from this release set.
