# The DPP Standard

A shared foundation for digital product passports on the BSV blockchain: a specification, service contracts, conformance fixtures and a reference implementation.

The objective is an **open, interoperable standard** that lets organisations build compatible passport applications, operate their own services and verify records independently. Manufacturers, owners, repairers and other participants should be able to exchange product information across providers while preserving its history and evidence.

**Status: working draft, pre-1.0.** The repository is currently private while the draft is developed for public release. Breaking changes are expected. The reference packages and examples are runnable; independent interoperability and provider portability remain outcomes to demonstrate before wider adoption. [Governance](GOVERNANCE.md) defines how the standard changes and the conditions for declaring version 1.0.

## What the standard enables

- **A verifiable product history.** Record a product's activation, sale, resale, repair, recycling, edits and ownership transfers in a linked sequence of signed states.
- **Independent operation.** Run compatible indexes, wallets, storage and verification tools using the published interfaces. No particular application or service provider is required by the standard.
- **Verification by the reader.** Check signatures, history links and blockchain inclusion using transaction bytes, mining proofs and public block headers, without an account with the publisher.
- **Separate public and restricted data.** Carry public product information in the record and commit to encrypted owner data stored off chain.
- **Compatibility across industries.** Keep the record and proof mechanisms common while industry profiles define the data needed for batteries, textiles and other sectors.

Developers can reuse the reference packages or implement the specification independently. Service operators can host compatible infrastructure. Industry contributors can define profiles, and implementers can use the fixtures to identify disagreements before records are published.

## How it works

The standard defines two separate kinds of blockchain record:

| Record | Purpose | What is stored on chain |
|---|---|---|
| **Passport state** | Describe the product and record changes over its lifecycle | Public product data, event metadata, owner and actor keys, signatures, the previous transaction identifier and an optional hash of encrypted owner data |
| **Attestation anchor** | Bind a signed lifecycle claim to a blockchain record and identify the anchoring service | The claim's digest, identifiers, issuer and subject metadata, lifecycle type, and the anchoring service's key and signature |

Each new passport state spends the previous state's output. This links the history through blockchain transactions and makes conflicting updates detectable. Attestation anchors use separate outputs; the claims themselves remain off chain. Neither kind of record needs the other to verify its own checks.

Four packages provide independently testable implementation roles:

- **`@bsv/dpp-core`** (`packages/dpp-core`) is the record model and what both rails share: the 14-field codec, the canonical signature preimages, chain verification including SPV and the optional owner-consent check, the native lifecycle claim, the generic anchor's build and strict decode, the canonical bytes an attestation is signed and hashed over, `verifyPassportEvidence`, the one verification report of `spec/verification.md`, the publisher key policy chain a state is checked against at its own time, and the evidence package manifest that carries a passport's evidence between operators. Reference consumers reuse these functions. Independent implementations reproduce the specified rules and portable fixtures.
- **`@bsv/dpp-overlay-topics`** (`packages/overlay-topics`) is the index: the `tm_dpp` and `tm_attestation` topic managers and the `ls_dpp` and `ls_attestation` lookup services, with separately named historical UORA interfaces, usable as a library or as an HTTP service speaking exactly the wire `contracts/overlay.yaml` pins, including the capability document, publisher key policy enforcement, history pages over a snapshot, the signed evidence package export and the guarded retraction. Its Dockerfile builds the deployable index node from this repository alone, so an adopter can run their own index:

- **`@bsv/dpp-profiles`** (`packages/dpp-profiles`) is the canonical home of the industry data profiles: `battery@2`, `textile@2` and `general@2` and their superseded predecessors as immutable, digest-frozen manifests, the payload schemas and consumer documents generated from them, the conditional lifecycle mapping with its four-valued result, and the GS1 identifier helpers a writer uses. Applications and registries consume it; nothing edits it. See [the profiles specification](spec/profiles.md).

- **`@bsv/vsc`** (`packages/vsc`) implements the pinned VSC draft compatibility profile with owned context/schema artefacts, genuine Ed25519 and BBS credential proofs, scoped verification and EPCIS mappings. It verifies credentials independently of the additional BSV anchor. This is documented draft compatibility, not W3C certification. See [the profile](spec/vsc-profile.md).
The writer assembles and checks a state, has a wallet sign and submit it, obtains its mining proof and retains the evidence. The index makes records findable and serves their transaction bytes and available proofs. The verifier checks that evidence against the record rules and a configurable block header source. The [writing specification](spec/writing.md) and [service specification](spec/services.md) define these responsibilities.

Verification establishes who signed particular bytes and whether the supplied history and proofs check out. The physical product, the truth of a claim and the authority of its issuer require supporting evidence. A valid supplied history also does not establish that a provider returned the latest state or every claim.

Retaining transactions, proofs and off-chain content is part of operating a passport. Existing records can remain verifiable after a provider disappears when that evidence is available. Continuing to update a passport also requires access to its spending key; the [custody model](spec/custody.md) explains owner-held, split and operator-held arrangements.

The files in `fixtures/` are regenerated verbatim from modules inside these packages' test suites, and the suites hold the two identical: editing either side alone goes red in CI. CI runs the build, the type checks, all workspace suites and the container image on every change.
## Industry profiles

Industry profiles are a separate workstream built on the common DPP standard. They define product data and its meaning while preserving the core record, signature, history and anchoring rules. [Governance](GOVERNANCE.md#versioning) provides for profiles to version independently of the core.

| Layer | Scope |
|---|---|
| **Core DPP standard** | Record formats, signatures, identity, ownership transitions, anchoring, verification and service interfaces |
| **Shared profile framework** | Planned conventions for profile identification, schema validation, compatibility declarations and conformance reporting |
| **Industry profiles** | Sector-specific fields, units, terminology, lifecycle meanings and issuer requirements; for example, battery chemistry and capacity, or textile fibre composition |

The attestation format already carries `profile` and `profile_version`. Dedicated industry schemas and profile validation are not yet supplied in this repository. The intended review process gives each profile its own version, maintainer, supported core versions, examples and refusal fixtures. Core validity and profile compliance should be reported separately, so a missing industry field is distinguishable from an invalid signature or broken history.

## What is in this repository

| Component | Where to start | Current scope |
|---|---|---|
| Record, identity and custody rules | [Record model](spec/record-model.md), [identity](spec/identity.md), [custody](spec/custody.md) | Draft rules for passport states, keys, signatures, transitions and verification |
| Attestations and anchors | [Attestation rules](spec/rules.md) | Claim shape, canonical bytes and the `uora-anchor-v3` format |
| Writer and service behaviour | [Writing](spec/writing.md), [services](spec/services.md), [overlay API contract](contracts/overlay.yaml) | Writer duties and index interfaces; the registry query contract is pending agreement between implementing parties |
| Reference protocol library | [`@bsv/dpp-core`](packages/dpp-core/README.md) | Record codec, signature preimages and checks, chain verification including SPV, owner consent, identity encoding, blob hash binding and attestation canonicalisation |
| Reference index and anchor components | [`@bsv/dpp-overlay-topics`](packages/overlay-topics/README.md) | Passport and anchor admission, lookup, anchor encoding and validation, storage adapters and a deployable HTTP service |
| Conformance material | [Fixtures](fixtures/README.md) | Record, chain and anchor fixtures, including refusal cases, in bespoke JSON and cross-language vector formats |
| Runnable examples | [`examples/`](examples/) | Passport verification, anchor checks and a wallet-based passport writer |
| Adoption guidance | [Deployment](docs/deployment.md), [stack map](docs/stack.md), [identifiers](docs/identifiers.md) | Infrastructure choices, ecosystem dependencies and product identifier guidance |
| Decisions and change process | [Design rationale](spec/design-rationale.md), [governance](GOVERNANCE.md), [changelog](CHANGELOG.md) | Reasons for design choices, contribution rules and version history |

Within the reference implementation, consumers reuse the core package's DPP rules. An independent implementation reproduces those rules from the specification and fixtures without importing the reference DPP logic. General blockchain, cryptography and wallet libraries can still be shared.

The consuming application, attestation registry, wallet infrastructure and off-chain storage services have their own implementations and deployment lifecycles. The standard's reference packages are intended for npm publication when this repository opens; until then, build them from this checkout.

## Try the reference implementation

From the repository root, using Node.js 20 or later and npm:

```sh
npm ci
npm run build
npm run typecheck
npm test
```

Run the examples without a wallet or a live blockchain write:

```sh
node examples/verify-passport.mjs --fixture
node examples/verify-passport.mjs --fixture --owner-consent
node examples/verify-anchor.mjs
node examples/write-passport.mjs --dry-run
```

The passport fixture checks signatures and history links. Its blockchain inclusion remains `pending` because the transactions are synthetic. The owner-consent option also exercises refused transfers. The anchor example checks the pinned anchor and refusal cases. The writer dry run reconstructs a fixture state and rejects an invalid update before anything is sent.

To verify an existing passport, set `PASSPORT_ID` to its exact identifier and `INDEX_URL` to the index serving it, then run:

```sh
node examples/verify-passport.mjs "$PASSPORT_ID" "$INDEX_URL"
```

This example checks blockchain inclusion against WhatsOnChain's mainnet headers. Applications using the core library can provide their own header source. Results distinguish verified, failed and pending inclusion; absent proofs or an unavailable header source are not proof of inclusion.

For a live activation, the writer example uses a funded BRC-100 wallet on the local machine as actor, owner and publisher. Configure the target index to accept that wallet's publisher identity and supply submission and callback tokens where required:

```sh
node examples/write-passport.mjs "$PASSPORT_ID" "$INDEX_URL" --wait-proof=30
```

Use identifiers the writer is entitled to publish. The [record model](spec/record-model.md#3-the-fourteen-fields) defines the current GTIN rules, including GS1 prefix 952 for demonstration identifiers where the writer holds no suitable prefix; the [identifier guide](docs/identifiers.md) explains allocation and resolver hosts. Existing fixtures retain their pinned identifiers pending regeneration and should not be used as identifiers for new products.

## Run your own index

The reference index can be embedded as a library or run as an HTTP service. It provides passport admission and lookup through `tm_dpp` and `ls_dpp`, and anchor admission and lookup through `tm_uora_dpp` and `ls_uora_dpp`.

Build the container from the repository root:

```sh
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

Configure the publisher's public identity key, persistent MongoDB storage, network, submission and proof-ingestion tokens, and any owner-consent policy using the [index configuration reference](packages/overlay-topics/README.md#configuration). The [deployment guide](docs/deployment.md) describes how the wallet, broadcaster, header source and index work together.

The current host receives announcements and proofs; its wallet clients handle broadcasting. Automatic peer discovery, advertising and peer synchronisation are not enabled in this host. Passport admission uses a configured publisher key, so support for provider migration and changing publisher identities needs explicit interoperability testing. These boundaries are part of the readiness review for independent operation.

## Implement, test and contribute

The first consuming application is [bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app), with a demonstration verification surface at [dpp.bsvb.net/verify](https://dpp.bsvb.net/verify). Its source is currently private. Other applications can use the same rules and operate compatible services.

The next adoption milestone is to **validate the DPP standard through independent implementation and interoperability testing**. The work includes:

1. Reviewing each component's API, documentation, dependencies and operational behaviour for consumption by other teams.
2. Demonstrating that independently written DPP implementations pass the same fixtures, including every refusal case.
3. Exchanging and verifying records in both directions between independently operated applications.
4. Moving an existing passport between providers while preserving its history, and testing verification and authorised updates with the original provider unavailable under the selected custody arrangement.
5. Developing the profile framework and individual industry profiles as separately versioned contributions.

Contributions should identify the rule, interface or behaviour being improved and provide reproducible evidence. Format changes include updated fixtures and refusal cases; implementation disagreements and missing requirements belong in the standard's review process. Reports describe each check separately, including failures and checks not performed. Passing byte fixtures alone does not establish writer behaviour or operational independence.

CI builds and type-checks the packages, runs both test suites and the offline examples, and builds the index image. Fixture-consistency checks hold the published JSON files to the values generated by the reference tests. The [fixture guide](fixtures/README.md) explains how to consume the corpus.

[Governance](GOVERNANCE.md#declaring-version-10) sets the release criteria: agreement on shared formats, independent implementations passing the fixtures, resolution of known disagreements and defects, and maintainer approval. This README introduces the project and its goals; the specification, contracts, fixtures and governance define conformance and acceptance.

## Licence

The reference software and accompanying documentation are provided under the [Open BSV License version 4](LICENSE), which permits use, modification and redistribution subject to its conditions, including use on BSV blockchains only.
