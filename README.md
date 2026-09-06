# The DPP Standard

A shared foundation for digital product passports on the BSV blockchain: a specification, service contracts, conformance fixtures and a reference implementation.

The objective is an **open, interoperable standard** that lets organisations build compatible passport applications, operate their own services and verify records independently. Manufacturers, owners, repairers and other participants should be able to exchange product information across providers while preserving its history and evidence.

**Status: working draft, pre-1.0.** The repository is currently private while the draft is developed for public release. Breaking changes are expected. The reference packages and examples are runnable; independent interoperability and provider portability remain outcomes to demonstrate before wider adoption. [Governance](GOVERNANCE.md) defines how the standard changes and the conditions for declaring version 1.0.

The adopter documentation is under [`docs/`](docs/README.md), organised for the GitBook site the maintainers prepare from it: where to start by role, the two supported journeys, the reference packages, the independent implementer contract, operation, industry profiles and the reference index. The normative material stays where it is: `spec/`, `contracts/` and `fixtures/`, with the conformance ledger under `conformance/` and the release sets under `release/`.

## What the standard enables

- **A verifiable product history.** Record a product's activation, sale, resale, repair, recycling, edits and ownership transfers in a linked sequence of signed states.
- **Independent operation.** Run compatible indexes, wallets, storage and verification tools using the published interfaces. No particular application or service provider is required by the standard.
- **Verification by the reader.** Check signatures, history links and blockchain inclusion using transaction bytes, mining proofs and public block headers, without an account with the publisher.
- **Separate public and restricted data.** Carry public product information in the record and commit to encrypted owner data stored off chain.
- **Compatibility across industries.** Keep the record and proof mechanisms common while industry profiles define the data needed for batteries, textiles and other sectors.

Developers can reuse the reference packages or implement the specification independently. Service operators can host compatible infrastructure. Industry contributors can define profiles, and implementers can use the fixtures to identify disagreements before records are published.

## Two journeys

| Journey | What it reuses | What its success shows |
|---|---|---|
| **Reference package consumer** | The four packages below and the documented application service interfaces | The packages are consumable outside this repository and compatible services can be deployed from the reference implementation |
| **Independent implementer** | The specifications, the contracts, the immutable profile data, the fixtures, and generic blockchain, cryptography and wallet libraries | Separately implemented DPP rules exchange and verify records with the reference for the roles the implementer declares |

An application that imports the reference DPP validation or writing logic is a reference consumer, however it is deployed. An independent implementation reproduces the specified rules without importing, mirroring or calling the reference DPP logic as its decision engine; it may share `@bsv/sdk` or another generic library and it may exchange records with a reference provider under test. [`docs/implement/`](docs/implement/README.md) is the frozen starting contract for that journey; [`docs/packages/`](docs/packages/README.md) is the route for the first.

## How it works

The standard defines two separate kinds of blockchain record:

| Record | Purpose | What is stored on chain |
|---|---|---|
| **Passport state** | Describe the product and record changes over its lifecycle | Public product data, event metadata, owner and actor keys, signatures, the previous transaction identifier and an optional hash of encrypted owner data |
| **Attestation anchor** | Bind a signed lifecycle claim to a blockchain record and identify the anchoring service | The claim's digest, identifiers, issuer and subject metadata, lifecycle type, representation and media type, and the anchoring service's key and signature |

Each new passport state spends the previous state's output. This links the history through blockchain transactions and makes conflicting updates detectable. Attestation anchors use separate outputs; the claims themselves remain off chain. Neither kind of record needs the other to verify its own checks.

Two record versions exist. Version 1 is the fourteen-field layout; version 2 is the seventeen-field layout with explicit lineage, a control proof on every operation, a terminal retirement and an authorisation commitment a custody profile can require. A reader selects the version by field count and a version 1 lineage continues under version 2 only through the single upgrade transition. The current anchor format is `bsv-attestation-anchor-v1`; the earlier `uora-anchor-v3` is historical, still decoded under its own rules and never aliased to the current one.

Four packages provide independently testable implementation roles:

- **`@bsv/dpp-core`** (`packages/dpp-core`) is the record model and what both rails share: the version 1 and version 2 codecs, the canonical signature preimages of both versions, chain verification including SPV, the owner-signed transfer of version 1 and the control proof, retirement and upgrade rules of version 2, the managed acceptance record a version 2 transfer commits to, the native lifecycle claim, the generic anchor's build and strict decode, the canonical bytes an attestation is signed and hashed over, `verifyPassportEvidence` and the one verification report of `spec/verification.md`, the publisher key policy chain a state is checked against at its own time, and the evidence package manifest that carries a passport's evidence between operators. Reference consumers reuse these functions; independent implementations reproduce the specified rules against the same fixtures.
- **`@bsv/dpp-overlay-topics`** (`packages/overlay-topics`) is the index: the `tm_dpp` and `tm_attestation` topic managers and the `ls_dpp` and `ls_attestation` lookup services, with the separately named historical UORA interfaces, usable as a library or as an HTTP service speaking exactly the wire `contracts/overlay.yaml` pins: the capability document, publisher key policy enforcement, history pages over a snapshot, the bounded signed evidence package, the complete resumable export, the guarded retraction and static-peer synchronisation through the overlay protocol's GASP routes. Its Dockerfile builds the deployable index node from this repository alone, so an adopter can run their own index.
- **`@bsv/dpp-profiles`** (`packages/dpp-profiles`) is the canonical home of the industry data profiles: `battery@2`, `textile@2` and `general@2`, their superseded predecessors and the draft `battery@3` and `textile@3` successors as immutable, digest-frozen manifests, the payload schemas and consumer documents generated from them, the conditional lifecycle mapping with its four-valued result, the GS1 identifier and discovery helpers, the interoperability manifests, the shared evidence shapes, the applicability evaluator and the deterministic passport projection. Applications and registries consume it; nothing edits it. See [the profiles specification](spec/profiles.md).
- **`@bsv/vsc`** (`packages/vsc`) implements the pinned VSC draft compatibility profile with owned context and schema artefacts, genuine Ed25519 and BBS credential proofs, scoped verification and EPCIS mappings, plus the `./epcis-source` helpers with the pinned EPCIS 2.0.1 artefacts and the `./exchange` verifier for the external `vc-di-ecdsa-rdfc-2019@1` credential representation. It verifies credentials independently of the additional BSV anchor. This is documented draft compatibility, not W3C certification. See [the profile](spec/vsc-profile.md).

The writer assembles and checks a state, has a wallet sign and submit it, obtains its mining proof and retains the evidence. The index makes records findable and serves their transaction bytes and available proofs. The verifier checks that evidence against the record rules and a configurable block header source. The [writing specification](spec/writing.md) and [service specification](spec/services.md) define these responsibilities.

Verification establishes who signed particular bytes and whether the supplied history and proofs check out. The physical product, the truth of a claim and the authority of its issuer require supporting evidence. A valid supplied history also does not establish that a provider returned the latest state or every claim.

Retaining transactions, proofs and off-chain content is part of operating a passport. Existing records can remain verifiable after a provider disappears when that evidence is available. Continuing to update a passport also requires access to its spending key; the [custody model](spec/custody.md) explains owner-held, split and operator-held arrangements, and the [managed custody profile](spec/managed-custody.md) the arrangement in which a custodian holds keys for parties without wallets.

The files in `fixtures/` are regenerated verbatim from modules inside these packages' test suites, and the suites hold the two identical: editing either side alone goes red in CI. CI runs the build, the type checks, all workspace suites, the conformance checks, the offline examples, the Python reader, the clean external consumer check and the container image on every change.

## Industry profiles

Industry profiles are a separate workstream built on the common DPP standard. They define product data and its meaning while preserving the core record, signature, history and anchoring rules. [Governance](GOVERNANCE.md#versioning) provides for profiles to version independently of the core, and each profile is assessed on its own evidence.

| Layer | Scope | Where it is |
|---|---|---|
| **Core DPP standard** | Record formats, signatures, identity, ownership transitions, anchoring, verification and service interfaces | `spec/`, `contracts/`, `fixtures/` |
| **Shared profile framework** | The manifest schema, digest freezing, generated payload schemas and consumer documents, obligation separate from legal basis, the `needs-review` applicability that is never read as satisfied, the four-valued lifecycle mapping, and separate reporting of core validity and profile results | [`spec/profiles.md`](spec/profiles.md), `packages/dpp-profiles/schemas/` |
| **Industry profiles** | Sector-specific fields, units, terminology, lifecycle meanings and evidence requirements; for example, battery chemistry and capacity, or textile fibre composition | `packages/dpp-profiles/manifests/`: `battery@2`, `textile@2`, `general@2` current; `battery@3` and `textile@3` draft successors under manifest version 2 |

A missing industry field is reported as a profile finding, distinguishable from an invalid signature or a broken history, because the verification report and the profile checks are separate results. A profile pass says nothing about legal compliance of a product: the conformance ledger keeps product qualification and regulatory conformity as withheld claims with their own evidence conditions.

## What is in this repository

| Component | Where to start | Current scope |
|---|---|---|
| Record, identity and custody rules | [Record model](spec/record-model.md), [record model version 2](spec/record-model-v2.md), [identity](spec/identity.md), [custody](spec/custody.md), [managed custody](spec/managed-custody.md) | Draft rules for passport states of both record versions, keys, signatures, transitions, the custodian-attested acceptance and verification |
| Attestations and anchors | [Attestation rules](spec/rules.md), [historical anchor](spec/legacy-uora-anchor-v3.md) | Claim shape, canonical bytes and the current `bsv-attestation-anchor-v1` format; `uora-anchor-v3` retained as a historical format under its own rules |
| Verification and portable evidence | [Verification](spec/verification.md), [portable evidence](spec/portable-evidence.md), [report schema](contracts/verification-report.schema.json), [evidence package](contracts/evidence-package.schema.json), [complete export](contracts/evidence-export.schema.json) | The one verification report every surface produces, pages over a snapshot, the signed evidence package and the resumable complete export |
| Writer and service behaviour | [Writing](spec/writing.md), [services](spec/services.md), [overlay API contract](contracts/overlay.yaml), [registry API contract](contracts/registry.yaml), [publisher policy](contracts/publisher-policy.schema.json), [capability document](contracts/capabilities.schema.json) | Writer duties, index and registry interfaces, the publisher key policy chain and the capability declaration |
| Reference protocol library | [`@bsv/dpp-core`](packages/dpp-core/README.md) | Record codecs for both versions, signature preimages and checks, chain verification including SPV, owner consent and control proofs, the acceptance record, identity encoding, blob hash binding, attestation canonicalisation, the anchor, the verification report, publisher policy and the evidence package manifest |
| Reference index | [`@bsv/dpp-overlay-topics`](packages/overlay-topics/README.md), [`deploy/`](deploy/README.md) | Passport and anchor admission, lookup, capabilities, history pages, bounded and complete export, retraction, static-peer synchronisation, storage adapters, a deployable HTTP service and the Docker Compose preset |
| Industry profiles | [`@bsv/dpp-profiles`](packages/dpp-profiles/README.md), [profiles specification](spec/profiles.md) | Frozen manifests, generated schemas and consumer documents, lifecycle mapping, GS1 identifier helpers, applicability and projections |
| Credential profiles | [`@bsv/vsc`](packages/vsc/README.md), [VSC profile](spec/vsc-profile.md), [exchange](spec/exchange.md) | The pinned VSC draft compatibility profile, its proof suites, and the named exchange representations |
| Interoperability profiles | [GS1 discovery](spec/gs1-discovery.md), [EPCIS interoperability](spec/epcis-interoperability.md), [external credential profile](spec/external-credential-profile.md), [passport projections](spec/passport-projections.md), [interoperability API](contracts/interoperability.yaml) | Resolving a GS1 Digital Link to passport and evidence services, importing and mapping EPCIS events with exact-byte retention, verifying an externally signed passport credential, and deriving deterministic passport projections from versioned sources; every one optional to adopt and fixed in behaviour when claimed |
| Conformance material | [Conformance](spec/conformance.md), [fixtures](fixtures/README.md), [the ledger](conformance/manifest.json), [baselines](conformance/baseline-native-2.json), [selections](conformance/selections/), [Python reader](conformance/independent/python/README.md) | Layers, roles, the recommended baselines, the requirement ledger with its checker and selected-claim gate, record, chain and anchor fixtures with refusal cases in bespoke JSON and cross-language vector formats, and a second reader in standard-library Python |
| Release sets | [`release/`](release/README.md) | The compatible sets of package versions, wire versions, custody profile, runtime and artefact digests; the packed candidates and the clean external consumer check |
| Runnable examples | [`examples/`](examples/) | Passport verification of both versions, a managed-custody lifecycle from fresh keys, anchor checks, a wallet-based writer and the four interoperability examples |
| Adoption guidance | [Documentation](docs/README.md), [quick starts by role](docs/quick-start.md), [deployment](docs/deployment.md), [migration](docs/migration.md), [stack map](docs/stack.md), [identifiers](docs/identifiers.md) | Starting routes by role, infrastructure choices, the move to record version 2 and the interoperability profiles, ecosystem dependencies and product identifier guidance |
| Decisions and change process | [Design rationale](spec/design-rationale.md), [governance](GOVERNANCE.md), [changelog](CHANGELOG.md) | Reasons for design choices, contribution rules and version history |

Within the reference implementation, consumers reuse the core package's DPP rules. An independent implementation reproduces those rules from the specification and fixtures without importing the reference DPP logic. General blockchain, cryptography and wallet libraries can still be shared.

The consuming application, attestation registry, wallet infrastructure and off-chain storage services have their own implementations and deployment lifecycles. The standard's reference packages are intended for npm publication when this repository opens; until then, build them from this checkout or install the packed candidates the release scripts produce.

## Try the reference implementation

From the repository root, using Node.js 22 or later and npm:

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
node examples/verify-passport.mjs --fixture --version=2 --report
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
node examples/verify-anchor.mjs
node examples/write-passport.mjs --dry-run
```

The passport fixture checks signatures and history links. Its blockchain inclusion remains `pending` because the transactions are synthetic. The owner-consent option also exercises refused transfers. The version 2 form replays the seventeen-field lineage fixture with its control proofs, refusals and the upgrade from version 1, and the lifecycle example builds a version 2 passport through a managed-custody transfer from fresh keys. The two anchor examples check the current generic anchor and the historical anchor with their refusal cases. The writer dry run reconstructs a fixture state and rejects an invalid update before anything is sent. [`docs/quick-start.md`](docs/quick-start.md) lists every maintained command by role, including the interoperability examples and the conformance commands.

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

The reference index can be embedded as a library or run as an HTTP service. It provides passport admission and lookup through `tm_dpp` and `ls_dpp`, and anchor admission and lookup through `tm_attestation` and `ls_attestation`; the historical `tm_uora_dpp` and `ls_uora_dpp` serve `uora-anchor-v3` anchors separately and are never a substitute for the current format.

Build the container from the repository root:

```sh
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

Configure the publisher's public identity key or a publisher key policy chain, persistent MongoDB storage, network, submission and proof-ingestion tokens, the export signing key and any custody policy using the [index configuration reference](packages/overlay-topics/README.md#configuration). [`deploy/`](deploy/README.md) is the supported preset on Docker Compose, with a second-operator overlay; the [deployment guide](docs/deployment.md) describes how the wallet, broadcaster, header source and index work together.

What the host does and does not do, stated plainly. It receives announcements and proofs; the writers' wallets broadcast, and the host never does. Publisher keys are either the single configured identity key, an implicit single-operator policy with no rotation history, or a signed, versioned `dpp-publisher-policy@1` chain under which every state is checked against the key active at its own time and a handover is a signed policy version rather than an edited list. A second operator synchronises both rails from the peers named in `SYNC_PEERS` through the overlay protocol's GASP routes and admits every offered output through its own topic managers; there is no automatic peer discovery and the host advertises nothing through SHIP or SLAP. Two nodes under one administration prove the synchronisation mechanism and never independence: `federated-operators@1` stays a proposed operator profile until separately administered operators have run its acceptance exercises, and the release selection withholds that claim by name.

## Implement, test and contribute

The first consuming application is [bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app), with a demonstration verification surface at [dpp.bsvb.net/verify](https://dpp.bsvb.net/verify), and the attestation registry is [bsv-blockchain-demos/uora-bsv](https://github.com/bsv-blockchain-demos/uora-bsv). Both consume the reference packages and their sources are currently private. Other applications can use the same rules and operate compatible services.

The next adoption milestone is to **validate the DPP standard through independent implementation and interoperability testing**. The work includes:

1. Reviewing each component's API, documentation, dependencies and operational behaviour for consumption by other teams.
2. Demonstrating that independently written DPP implementations pass the same fixtures, including every refusal case, for the roles they declare.
3. Exchanging and verifying records in both directions between independently operated applications.
4. Moving an existing passport between providers while preserving its history, and testing verification and authorised updates with the original provider unavailable under the selected custody arrangement.
5. Developing individual industry profiles as separately versioned and separately assessed contributions.

[`docs/implement/`](docs/implement/README.md) freezes the starting contract for that milestone: the roles to implement first, the permitted shared dependencies, the requirements-to-assertions matrix and the interoperability and portability demonstration each claim needs. Contributions should identify the rule, interface or behaviour being improved and provide reproducible evidence. Format changes include updated fixtures and refusal cases; implementation disagreements and missing requirements belong in the standard's review process. Reports describe each check separately, including failures and checks not performed. Passing byte fixtures alone does not establish writer behaviour or operational independence.

CI builds and type-checks the packages, runs every workspace suite and the conformance checks, the offline examples and the Python reader, packs the release candidates and installs them in a clean external project, and builds and smokes the index image. Fixture-consistency checks hold the published JSON files to the values generated by the reference tests. The [fixture guide](fixtures/README.md) explains how to consume the corpus.

[Governance](GOVERNANCE.md#declaring-version-10) sets the release criteria: agreement on shared formats, independent implementations passing the fixtures, resolution of known disagreements and defects, and maintainer approval. This README introduces the project and its goals; the specification, contracts, fixtures and governance define conformance and acceptance.

## Licence

The reference software and accompanying documentation, including the specifications, schemas, fixtures and examples in this repository, are provided under the [Open BSV License version 4](LICENSE). It permits use, modification and redistribution subject to its conditions, including that the software and anything derived from it be used only on the BSV blockchains the licence defines. [`docs/contribute/licence.md`](docs/contribute/licence.md) states what that condition means for each kind of material here and which reuse questions the maintainers have still to settle.
