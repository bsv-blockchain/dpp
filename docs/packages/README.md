# Install the selected release

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

The [selected release](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09-3.json) is a candidate. Use its packed artefacts; npm publication remains pending. The [support table](support-table.md) identifies entry points and runtimes.

The first examples run from a source checkout. Packing is needed when another application will install these local candidate packages. No public package publication is implied.

## After npm publication

Until registry publication is verified, use the candidate installation below. Once published, a Node >=22 application can install the packages it needs without cloning this repository:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.1 @bsv/dpp-profiles@0.3.0-beta.1 @bsv/vsc@0.2.0-beta.1
```

Add `@bsv/sdk@2.4.2` if the application directly imports wallet or transaction types. Add `@bsv/dpp-overlay-topics@0.4.0-beta.1` only for an application that embeds index components or operates an overlay. All four packages use ECMAScript modules. The release uses the `next` tag while the standard is a working draft; exact versions and the consumer lockfile define the tested installation.

The first trial consumer is [bsv-blockchain-demos/dpp-app-2](https://github.com/bsv-blockchain-demos/dpp-app-2), maintained in a separate repository that currently requires access. Its initial integration is an offline Node/TypeScript programme using the public package entry points, with synthetic transactions and temporary keys. It demonstrates package integration, not a deployed writer, independent implementation or product qualification.

## Application responsibilities and package boundaries

| Workflow | Public package API | Application responsibility | Specification |
|---|---|---|---|
| Issue, update and retire a passport | Core `completeState`, `buildLockingScript`, `verifyChain` | Supply authorised signers and a funded BRC-100 wallet; verify before sending; serialise writes, retain evidence and obtain proofs | Record models and writing lifecycle |
| Offer, accept and transfer custody | Core `signManagedAcceptance`, `acceptanceCommitment`, `bindAcceptanceToState` | Record offers, expiry, recipient evidence, access policy, idempotency and operation outcomes | Managed custody |
| Decline an offer or query an operation | Application orchestration | Persist the workflow without inventing another token operation | Managed custody and writing lifecycle |
| Read and verify a passport | Core `findDppOutputs`, `verifyPassportEvidence` | Supply expected subject, history, header source, latest-state observations and authority policy | Verification |
| Sign, anchor and verify lifecycle claims | Core `signLifecycleClaim`, `buildAttestationAnchor`, `verifyLifecycleClaim` | Retain exact secured bytes; fund and broadcast the separate anchor; configure authority and status evidence | Rules and services |
| Find passport states and anchors | Overlay topic managers and lookup services, or the BRC-24 HTTP contract | Choose an operator; retrieve and verify the returned evidence; retry announcement using the same transaction | Overlay services |
| Validate profiles and project data | Profiles `readManifest`, `missingRequired`, `projectPassport` and data exports | Select exact profile versions; supply sources, policy and a format-asserting schema validator | Profiles and projections |
| Credentials and source exchange | VSC `verifySeal`, `./exchange`, `./epcis-source` | Supply selected suites, authority/status evidence and durable source retention | Credential and interoperability profiles |
| Export and import evidence | Core `signEvidenceManifest`, `inspectEvidencePackage`; overlay `buildEvidenceExportPart`, `joinEvidenceExport` | Retain and transport files; check digests and reverify under the reader's own policy | Portable evidence |

The application service remains outside this release. Its existing implementation includes demo persistence and identity structures, so applications adopting the standard directly should supply their own adapters rather than inherit those structures. The four packages own the shared protocol rules; they do not provide a hosted registry, an account system or durable operation scheduling.

Node runtime support does not imply browser runtime support. Keep server packages on the backend and use the [support table](support-table.md) when choosing browser-facing data exports. Missing proof, authority or status evidence remains `unknown`, and must not be treated as verified.

## Source access

The experimental package checkout uses source revision `a85a695e584eae6c2b159ccbb542e8ecc7a28f48`. The repository is public:

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git checkout --detach a85a695e584eae6c2b159ccbb542e8ecc7a28f48
npm ci
npm run build
```

Once the build succeeds, go directly to the [offline quick start](../quick-start.md). Keep the terminal at the repository root.

For source inspection when needed, a pinned file can also be read locally:

```sh
git show a85a695e584eae6c2b159ccbb542e8ecc7a28f48:spec/record-model.md
```

Use the path following the commit hash in each source URL. Links to another repository need access to that repository. The [BSV Association contact page](https://bsvassociation.org/contact/) handles access enquiries for other repositories.

## Pack and check

From that checkout:

```sh
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The [candidate tooling](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/scripts/release-candidates.mjs) writes the source revision and artefact digests to `release/candidates.json`. The [consumer check](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/scripts/consumer-check.mjs) installs and exercises those tarballs in a separate project.

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
| Passport records and shared evidence | [Core](dpp-core.md) |
| Product profiles and projections | [Profiles](dpp-profiles.md) |
| Credentials and source events | [VSC](vsc.md) |
| Index services | [Overlay](dpp-overlay-topics.md) |

The [application service](application-service.md) is maintained separately from this release set.
