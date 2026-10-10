# Install the selected release

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

The source candidate uses **`@bsv/dpp-protocol`**, the new name for the library previously called `@bsv/dpp-core`. The candidate also includes a compatibility wrapper under the old name. Publication of the renamed packages is pending; use the source route below to run this documentation's current examples. See [migration](../migration.md#rename-dpp-core-to-dpp-protocol) for existing applications.

Use [choose packages and services](../start/choose-components-and-services.md) to select your components. The [release status](../reference/release-sets.md) distinguishes the source candidate from published releases, and the [support table](support-table.md) describes the candidate's entry points.

## Choose your starting point

| You want to | Start here | What to install |
| --- | --- | --- |
| Create a new application | [Application skeleton](build-an-application.md#start-with-an-application-skeleton) | Use `@bsv/create-dpp-app`. It includes the application files and selected dependencies |
| Run a new index | [Create an index](create-dpp-index.md) | Use `@bsv/create-dpp-index`. It includes `@bsv/dpp-overlay-topics` in the generated project's dependencies |
| Connect your app to an existing index | [Choose index access](../start/choose-components-and-services.md#decide-which-services-to-run-or-use) | Neither index package is needed just for HTTP access; obtain the URL and scoped access settings |
| Add DPP helpers to your own code | [Choose reference libraries](../start/choose-components-and-services.md#pick-only-the-packages-your-task-uses) | Select only the libraries your code uses, following the version instructions below |
| Embed an index or build a custom host | [Index runtime (advanced)](dpp-overlay-topics.md) | Install the runtime directly as an alternative to the starter |

Both starters are source candidates pending publication. Their guides explain how to check them today. A generated project already declares its dependencies and pins; follow its README rather than adding the packages below a second time. The remaining instructions are for selecting libraries directly or developing from source.

## Use the renamed source candidate

From a checkout containing `packages/dpp-protocol`, using Node 22 or later:

```sh
npm ci
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

This builds the packages, packs their archives and tests them in a separate project. It publishes nothing. To try the protocol library and profiles in your own application, replace `/absolute/path/to/dpp` with the checkout's absolute path:

```sh
npm install --save-exact /absolute/path/to/dpp/release/candidates/bsv-dpp-protocol-0.3.0-beta.9.tgz /absolute/path/to/dpp/release/candidates/bsv-dpp-profiles-0.3.0-beta.9.tgz @bsv/sdk@2.8.10
```

Install all selected DPP archives together so npm can satisfy their unpublished dependencies locally. To embed the index, add `bsv-dpp-overlay-topics-0.4.0-beta.11.tgz` from the same directory. To test existing `@bsv/dpp-core` imports, add `bsv-dpp-core-0.3.0-beta.9.tgz`. Preserve the archives and the resulting lockfile. An application that only calls an index over HTTP does not need the index package.

For a published release, use the exact packages below and keep `@bsv/dpp-core` in its imports. Those earlier versions do not provide the new package name. Change imports to `@bsv/dpp-protocol` when adopting the renamed candidate or its eventual published release.

## Install from npm

The latest complete publication with a receipt in this documentation is the earlier `dpp-release-2026-10-7`: overlay beta.10, core and profiles beta.8, and VSC beta.5. The following exact versions remain available; mutable npm tags may have moved. See the [beta.10 publication receipt](../reference/beta-10-publication.md).

A Node >=22 application can install only the packages its task uses, without cloning this repository. For passport records, verification and native lifecycle claims, start with core:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.8
```

| Add when needed | Exact package | Purpose |
|---|---|---|
| Your application uses the profile tooling | `@bsv/dpp-profiles@0.3.0-beta.8` | Profile manifests, payload schemas and supported projection/discovery helpers |
| Your code imports wallet or transaction APIs | `@bsv/sdk@2.8.10` | Declare direct imports as direct dependencies |
| Your selected credential or exchange feature uses VSC | `@bsv/vsc@0.2.0-beta.5` | Supported credential/exchange formats; not needed just to sign a native lifecycle claim |
| You embed index components in your own code | `@bsv/dpp-overlay-topics@0.4.0-beta.10` | Topic managers and lookup services; the starter handles its own runtime dependency, and HTTP clients do not need it |

For a published installation using the protocol helpers, profiles and the SDK:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.8 @bsv/dpp-profiles@0.3.0-beta.8 @bsv/sdk@2.8.10
```

A hosted writer's wallet toolbox must accept that SDK version, as [choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) explains. All four DPP packages use ECMAScript modules. Releases publish to the `latest` tag until version 1.0; exact versions and the consumer lockfile define the tested installation. An [independent implementation](../implement/README.md) need not use any of these packages.

A trial consumer is building a second stack, an index, a registry and an application, from this documentation and the published packages alone, and what it finds is fixed here. It is a reference consumer under the same administration, not an independent implementation.

## Application responsibilities and package boundaries

The table maps each workflow to the package functions it uses. For the order to call them in, from a first read to a published passport, follow [build an application](build-an-application.md).

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

The application service remains outside this release. Its existing implementation includes demo persistence and identity structures, so applications adopting the standard directly should supply their own adapters rather than inherit those structures. The reference packages own the shared protocol rules; they do not provide a hosted registry, an account system or durable operation scheduling.

Node runtime support does not imply browser runtime support. Keep server packages on the backend and use the [support table](support-table.md) when choosing browser-facing data exports. Missing proof, authority or status evidence remains `unknown`, and must not be treated as verified.

## Source access

The repository is public. The documentation examples use the current source candidate, as the [quick start](../quick-start.md) does:

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git switch --detach
git rev-parse HEAD
npm ci
npm run build
```

This source revision includes work after the selected published release, including opt-in index discovery and retry changes. Building it does not reproduce the npm archives, even when a package's version string is unchanged. For the exact source of a published package, use its [release set and publication receipt](../reference/release-sets.md).

The following is the retained historical beta.4 reproduction example. All four packages in that set, the beta.4 `@bsv/dpp-core`, `@bsv/dpp-overlay-topics` and `@bsv/dpp-profiles` and `@bsv/vsc@0.2.0-beta.3`, repack byte for byte from `f9d8e98658c7cf406702d49194ec5a8480cbca73`, the revision the [beta.4 publication receipt](../reference/beta-4-publication.md) records. Its examples are older than the current quick start. Use a separate checkout if you want to keep both revisions available.

```sh
git checkout --detach f9d8e98658c7cf406702d49194ec5a8480cbca73
npm ci
npm run build
```

Use Node 22 and npm 11.19.0 when reproducing archives; different compression implementations can change their digests. A single file at a revision can be read without a checkout:

```sh
git show f9d8e98658c7cf406702d49194ec5a8480cbca73:spec/record-model.md
```

Source links in these docs are pinned to the revision a page was written against, which can differ from both; use the path following the commit hash in each link. Links to another repository need access to that repository. The [BSV Association contact page](https://bsvassociation.org/contact/) handles access enquiries for other repositories.

## Pack and check

From the package revision's checkout:

```sh
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The [candidate tooling](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/scripts/release-candidates.mjs) writes the source revision and artefact digests to `release/candidates.json`. The [consumer check](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/scripts/consumer-check.mjs) installs and exercises those tarballs in a separate project.

To print the produced tarball paths, run:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const record = JSON.parse(readFileSync('release/candidates.json', 'utf8'))
for (const candidate of record.candidates) console.log(candidate.name, resolve('release/candidates', candidate.filename))
JS
```

In the consuming application's directory, run `npm install /absolute/path/to/the-produced-package.tgz` for the packages it needs, replacing the path with the corresponding output above. Preserve the resulting lockfile. Use [quick starts](../quick-start.md) from the repository checkout, or select a package:

| Task | Package |
|---|---|
| Passport records and shared evidence | [Protocol](dpp-protocol.md) |
| Product profiles and projections | [Profiles](dpp-profiles.md) |
| Credentials and source events | [VSC](vsc.md) |
| Index services | [Overlay](dpp-overlay-topics.md) |

The [application service](application-service.md) is maintained separately from this release set.
