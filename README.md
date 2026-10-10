# The DPP Standard

A draft standard for digital product passports on the BSV blockchain, with specifications, service interfaces, test fixtures and a reference implementation.

A digital product passport records information about a product and its history, such as manufacture, ownership transfers, repairs and recycling. This project defines how to sign, store, exchange and verify those records so that different applications and service providers can work with the same passport.

**Status: working draft, pre-1.0.** Breaking changes are expected. The reference packages and examples are runnable, but independent interoperability and provider portability still need to be demonstrated. See [project status](docs/start/status.md) and the [version 1.0 criteria](GOVERNANCE.md#declaring-version-10).

## Start here

| You want to | Read |
|---|---|
| Understand the design | [Architecture](docs/start/architecture.md) |
| Build with the reference packages | [Package guide](docs/packages/README.md) |
| Implement the standard independently | [Implementer guide](docs/implement/README.md) |
| Run your own index | [Create an index](docs/packages/create-dpp-index.md) |
| Define product data for an industry | [Industry profiles](docs/profiles/README.md) |
| Browse all documentation | [Documentation index](docs/README.md) |

## Try it locally

Requires **Node.js 22 or later** and npm. From the repository root:

```sh
npm ci
npm run build
```

Verify a sample passport and print its verification report:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

This checks signatures, history links and control proofs without a wallet or network connection. Blockchain inclusion is reported as `pending` because the fixture transactions are synthetic.

Other offline examples:

```sh
# Create a passport, update it, transfer it through managed custody and retire it
node examples/lifecycle-v2.mjs

# Verify a signed lifecycle claim and its blockchain anchor
node examples/verify-attestation-anchor.mjs

# Build, check and announce version 2 passport states to an in-process index, with nothing sent
node examples/write-passport-v2.mjs --dry-run
```

The [quick-start guide](docs/quick-start.md) covers live reads and writes, version 1 records, interoperability examples and conformance checks. Live writes require a funded BRC-100 wallet and a configured index.

## How it works

The standard uses two kinds of record:

| Record | What it does | Where the data lives |
|---|---|---|
| **Passport state** | Records product data and lifecycle changes. Each update spends the previous state's blockchain output, linking the history and making conflicting updates detectable. | Public data, keys, signatures and history links are on chain. Restricted owner data can be encrypted off chain, with its hash recorded on chain. |
| **Attestation anchor** | Connects a separately signed claim, such as a repair or inspection, to a blockchain record without updating the passport state. | The signed claim stays off chain. Its digest and identifying metadata are anchored on chain. |

Passport states and attestation anchors can be verified independently.

A **writer** prepares a record, asks a wallet to sign and broadcast it, then retains the transaction and proof. An **index** makes records discoverable and serves their transaction bytes and available proofs. A **verifier** checks signatures, history and blockchain inclusion against a block header source.

Verification shows who signed particular bytes and whether the supplied evidence checks out. It does not establish that a physical product or claim is genuine, that an issuer is authorised, or that a provider returned the latest state and every claim. Industry profile checks are reported separately from record validity and do not establish legal compliance.

Records can remain verifiable after a provider disappears if their transactions, proofs and off-chain content have been retained. Further updates also require access to the spending key. See [portable evidence](spec/portable-evidence.md) and the [custody model](spec/custody.md).

## Reference packages

For a new application, use [`@bsv/create-dpp-app`](packages/create-dpp-app/README.md). It creates the web app, API and application database configuration. Connect to an existing compatible index or create a separate index project.

For a new index, use [`@bsv/create-dpp-index`](packages/create-dpp-index/README.md). It creates your project and includes `@bsv/dpp-overlay-topics` as its runtime dependency. There is no separate runtime installation step. Both starters are source candidates pending publication.

The packages below are reusable components. Select them directly when integrating their APIs into your own code. An application using an existing index over HTTP needs neither the index starter nor the hosting runtime.

| Package | Purpose |
|---|---|
| [`@bsv/dpp-protocol`](packages/dpp-protocol/README.md) | Read, write and verify passport records, signatures, history, attestations and portable evidence. Supports record versions 1, 2 and 3. |
| [`@bsv/dpp-overlay-topics`](packages/overlay-topics/README.md) | Included index runtime for the starter. Direct installation is for custom or embedded indexes; it admits and retrieves records, exports evidence and synchronises with configured peers. |
| [`@bsv/dpp-profiles`](packages/dpp-profiles/README.md) | Versioned product-data schemas for batteries, textiles and general products, plus identifier, mapping and projection helpers. |
| [`@bsv/vsc`](packages/vsc/README.md) | Sign and verify credentials under the supported draft compatibility profile, map EPCIS events and verify supported external credentials. |

The source candidate names the shared library `@bsv/dpp-protocol`. The new name is not yet published; [install local candidate archives](docs/packages/README.md#use-the-renamed-source-candidate) to test it. `@bsv/dpp-core` is retained as a compatibility wrapper for existing imports and JSON schema paths. See [migration](docs/migration.md#rename-dpp-core-to-dpp-protocol).

Build from this checkout or use the packed candidates described in the [release guide](release/README.md), which records compatible package and protocol versions.

Applications can reuse these packages or implement the standard from the specifications and fixtures. An independent implementation must reproduce the DPP rules without importing, copying or calling the reference DPP logic. Generic blockchain, cryptography and wallet libraries may be shared.

### Industry and interoperability profiles

Industry profiles define sector-specific fields, terminology and evidence requirements while sharing the core record and verification rules. Profiles are versioned separately from the core standard.

Optional interoperability profiles cover GS1 Digital Link discovery, EPCIS event import, external credentials and deterministic passport projections. See the [industry profile guide](docs/profiles/README.md) and [interoperability guide](docs/interoperability/README.md) for supported versions and limitations.

## Run an index

Start with [Create an index](docs/packages/create-dpp-index.md). The starter includes the runtime, persistent MongoDB configuration, deployment files, checks and application connection settings. Follow the generated project's README for startup and maintenance. It is a source candidate; its guide explains how to test the packed packages before publication.

### Advanced alternative: run from source

The [repository's Docker Compose deployment](deploy/README.md) builds the index directly from this checkout, with MongoDB storage and an optional second node. Choose this instead of the starter when you need a source deployment. To build the index image directly:

```sh
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

Before running it, configure publisher keys, persistent storage, the network, access tokens and an export signing key using the [configuration reference](packages/overlay-topics/README.md#configuration).

The index receives records and proofs; writers' wallets broadcast transactions. Peer synchronisation uses explicitly configured peers, with no automatic discovery. Running two nodes demonstrates synchronisation, but does not establish independent operation. The [deployment guide](docs/deployment.md) explains the supporting services and operational limits.

## Specifications and conformance

The specifications, contracts, fixtures and governance define the standard. This README and the guides explain how to use it.

| Location | Contents |
|---|---|
| [`spec/`](spec/) | Record formats, identity, custody, writing, verification and profile rules |
| [`contracts/`](contracts/) | Service API contracts and JSON schemas |
| [`fixtures/`](fixtures/README.md) | Shared test inputs and expected results, including invalid cases |
| [`conformance/`](conformance/) | Requirements, baselines, claim evidence and an independent Python reader |
| [`release/`](release/README.md) | Compatible release sets and packaging tools |
| [`examples/`](examples/) | Runnable verification, writing and interoperability examples |

Use the [specification index](docs/reference/specifications.md) to find a particular rule or interface.

## Test and contribute

After installing dependencies and building the packages:

```sh
npm run typecheck
npm test
```

The test command runs the workspace suites, conformance checks and documentation checks. CI also exercises the offline examples, Python reader, package installation in a clean external project and the index container.

Contributions should identify the rule, interface or behaviour being changed and include reproducible evidence. Format changes need updated fixtures, including invalid cases. Passing fixtures alone does not demonstrate operational independence or portability between providers.

See the [contribution guide](docs/contribute/README.md), [governance](GOVERNANCE.md) and [changelog](CHANGELOG.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) describes, never in an issue. The next adoption milestone is independent implementations exchanging and verifying records, followed by provider migration tests that preserve history and authorised updates.

## Licence

The software, specifications, schemas, fixtures, examples and documentation use the [Apache License 2.0](LICENSE) (`Apache-2.0`). Third-party dependencies and artefacts retain their own terms and notices. See the [licence guide](docs/contribute/licence.md) for details.
