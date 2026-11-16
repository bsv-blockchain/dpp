# @bsv/dpp-credentials

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

`@bsv/dpp-credentials` verifies W3C Verifiable Credentials that other parties issue in one supported profile (`ecdsa-rdfc-2019` over P-256, `did:web` issuers), reads and retains GS1 EPCIS 2.0.1 source documents as evidence beside a passport, and carries the EPCIS lifecycle claim, one EPCIS event signed and bound to its passports. Only the claim's entry point, `./epcis-lifecycle`, imports `@bsv/dpp-protocol` and `@bsv/sdk`; every other entry point loads neither. It does not claim W3C certification, completion of upstream conformance tests, or regulatory compliance.

| Entry point | What it is for |
|---|---|
| `@bsv/dpp-credentials/exchange` | Verify-only intake of external credentials under `vc-di-ecdsa-rdfc-2019@1`: `verifyExternalCredential`, strict parsing of the exact bytes (`parseExternalCredentialBytes`), authenticated Bitstring Status List checking (`verifyBitstringStatus`), bounded `did:web` resolution through `createExternalDocumentLoader`, and `externalCredentialVerifierFor` for the passport verification report. |
| `@bsv/dpp-credentials/epcis-source` | The EPCIS 2.0.1 source helpers of `epcis-json@1`, with the pinned schema and context. |
| `@bsv/dpp-credentials/epcis-exchange` | Durable EPCIS source exchange over storage you supply: `importEpcisSource`, `exportEpcisSource`, `resolveEpcisConflict`, `findEpcisAssociations`, `rebuildEpcisAssociations`, `recoverEpcisExchange`, the in-memory and file-system storage adapters, and `epcisStorageAdapterSuite`, the suite every adapter must pass; and `pullEpcisEvents`, one bounded run against a source's standard events query. |
| `@bsv/dpp-credentials/epcis-lifecycle` | The EPCIS lifecycle claim `dpp-epcis-lifecycle@1` (`spec/epcis-lifecycle-claim.md` of the standard): `buildEpcisLifecycleClaim`, `signEpcisLifecycleClaim`, `parseEpcisLifecycleClaim`, `verifyEpcisLifecycleClaim` with every finding kept separate, `buildEpcisLifecycleAnchors` for one anchor per bound passport, `epcisLifecycleCredentialVerifierFor` for the passport verification report, and the RFC 8785 functions the claim is signed over (`jcsBytes`, `parseCanonicalJcs`). |
| `@bsv/dpp-credentials` | Re-exports the EPCIS source helpers and the general `createDidWebResolver`, `parseStrictJsonBytes` and `verifyTemporal`, with the shared credential and check types. It loads no proof suite. |
| `@bsv/dpp-credentials/artifacts/*` | The pinned W3C, EPCIS and external passport artefacts, and the owned context and schemas of the parked VSC profile, as files. |

## Install

This is a pre-1.0 candidate. The published version is `@bsv/dpp-credentials@0.2.0-beta.5`, selected by the October set; this source tree is the November candidate, `0.2.0-beta.6`, which is not yet published. It no longer contains the parked VSC compatibility profile or the EPCIS-to-SEAL mappings ([parked code](#parked-the-vsc-compatibility-profile-and-the-epcis-to-seal-mappings)). Install the exact published version from npm:

```sh
npm install --save-exact @bsv/dpp-credentials@0.2.0-beta.5
```

[Install the local candidate archives](../../docs/packages/README.md#use-the-renamed-source-candidate) to test the candidate; after publication, `npm install --save-exact @bsv/dpp-credentials@0.2.0-beta.6` applies.

The runtime and its exchange and EPCIS subpaths require Node >=22 and ECMAScript modules. Browser runtime use is unsupported; artefact exports are plain data. No repository checkout or package build is needed after installation.

## External credential verification

`@bsv/dpp-credentials/exchange` is the entry point for the `vc-di-ecdsa-rdfc-2019@1` representation of `spec/external-credential-profile.md`: a W3C Verifiable Credentials 2.0 credential secured with a `DataIntegrityProof` under `ecdsa-rdfc-2019` over a P-256 Multikey whose `did:web` issuer lists the key for assertion. `verifyExternalCredential` reports parse, context set, payload schema, proof, issuer binding, subject binding, temporal, status, authority and availability as separate checks; a P-384 key, another cryptosuite, an inline context or a second credential subject is `unsupported`, never a pass and never a silent fail. The proof primitives are the maintained `@digitalbazaar/ecdsa-rdfc-2019-cryptosuite` and `@digitalbazaar/ecdsa-multikey`; no signature or canonicalisation code is written here. The document loader refuses the parked SEAL profile's owned context by name, so a foreign credential cannot borrow it. `externalCredentialVerifierFor` adapts the result to the verification report's credential checks, and a reformatted credential whose RDF proof still verifies is reported apart from the exact bytes an anchor commits to, which differ.

A worked call, with the policy mapped from the vector file, is on the [external credentials page](../../docs/interoperability/external-credentials.md).

## EPCIS source exchange

`@bsv/dpp-credentials/epcis-source` holds the helpers of the `epcis-json@1` source exchange profile (`spec/epcis-interoperability.md` of the standard) and pins the EPCIS 2.0.1 JSON Schema, JSON-LD context and query schema by address, SHA-256 and length (`EPCIS_ARTEFACTS`). The files themselves are not in the package; see [GS1 files](#gs1-files). `parseEpcisSource` reads exact bytes under the disclosed limits (2 MiB, depth 64, duplicate keys, malformed UTF-8 and inexact numbers refused before anything is retained) and answers with the envelope kind, every event's JSON pointer and identifier, and the context declarations as written; `validateEpcisDocument` validates against the pinned schema and checks claimed GS1 identifiers without mutating, coercing or stripping a field; `epcisEventBodyDigest` is the RFC 8785 digest of an event body without its `recordTime` and `errorDeclaration`, so equivalent formatting yields one digest and a changed body another; `classifyEventArrival` names a repeat `duplicate`, a changed record time or error declaration `new-observation` and a changed body `conflict`; `localEventIdentity` labels an event that carries no identifier. `epcisSourceReference` builds the source reference `urn:bsv:dpp:epcis-source:1` that a credential mapped from the event carries; the mappings themselves are parked and not part of this package.

## Durable EPCIS import

`@bsv/dpp-credentials/epcis-exchange` is the durable part of the same profile. Loading it starts nothing: it opens no database, reads no file and reaches no network. Storage is injected.

`importEpcisSource` takes the storage, a `sourceId`, the caller's `requestId`, the exact bytes, the media type, the receipt time, provenance and the policy in force. A transport that is unsafe to parse, over a limit or of another media type is refused and nothing is kept. So is any import while the pinned GS1 schema is not provisioned. A document that parses safely is retained exactly as received with an import record, valid or not; an invalid one keeps its findings and is left out of everything described as valid. The same `requestId` with the same bytes answers the same import and writes no second record; with other bytes it is a conflict.

Each event is classified against what its source already holds as `new`, `duplicate`, `new-observation` or `conflict`. Nothing overwrites a source: an error declaration or a changed body is a further observation beside the first. `resolveEpcisConflict` records a decision that names every competing observation and changes none. `findEpcisAssociations` answers which events an identifier takes part in and in which role, keeping class and quantity references apart from individual items, and `rebuildEpcisAssociations` rebuilds that index from the retained sources and records.

`exportEpcisSource` returns the retained original byte for byte. `deriveEpcisEventProjection` returns a generated view labelled `derived` with its own digest; it is never returned in place of an original.

`EpcisExchangeStorage` is six methods: exact bytes under their digest, and JSON records written in batches that apply completely or not at all. `createMemoryEpcisStorage` and `openFileEpcisStorage` ship with the package. The interface alone promises nothing about another database: an adapter is fit only when it passes `epcisStorageAdapterSuite`, which stops the store before and after every durable step and checks that no acknowledged source is lost and nothing is half recorded. `recoverEpcisExchange`, called when a store is opened, finishes or discards interrupted work and reports it.

The module is not an EPCIS repository. It does not capture events, subscribe to a source or crawl one. It signs, issues and anchors nothing. An import is data, and a valid document proves nothing about who observed an event. The [EPCIS guide](../../docs/interoperability/epcis.md#import-retain-and-export) has a runnable import and the durable steps.

## EPCIS query pull

`pullEpcisEvents` is a client of the standard events query of the GS1 EPCIS 2.0 REST binding, `GET /events`. Each call is one bounded run against a source you configure: an identifier, a base address, the origins its requests may go to, the limits in force and a function that obtains its credential. The transport is handed in as `fetch`.

Every page goes through `importEpcisSource`, and the checkpoint moves only after a page is retained, so a restart or a crash continues without losing, skipping or repeating a page. A cursor that has expired, was rejected or is missing leads to a bounded replay of the same query, which recognises what is already held. A result says whether the source's pages were exhausted, a limit stopped the run or it failed, and never reports a partial history as complete.

Every address, each redirect and each next page, is checked against the permitted origins before it is requested. A credential goes to the base address's origin only and is written nowhere. A body is counted as it arrives and abandoned at its limit. Plain `http` and private addresses are refused unless `localTest` is set, which every result records. The [EPCIS guide](../../docs/interoperability/epcis.md#pull-events-from-a-source) has the configuration, the outcomes, the limits and the leniencies.

## EPCIS recovery

`exportEpcisRecovery` takes everything a store holds out as a recovery snapshot, and `restoreEpcisRecovery` puts it into another store, behind a different adapter if you choose. A snapshot carries every retained original in its exact bytes and the records no source can rebuild: the import records with their request bindings and results, each observation, each conflict decision with the observations it names, and each pull with its query bounds, its checkpoint and the pages it acknowledged. The associations index is not carried; the destination rebuilds it.

A snapshot is files with one `dpp-evidence-package@1` inventory entry each, beside a descriptor, `epcis-recovery.json`, that names every file, the source scopes covered, the boundary and what was left out. It is not a second export format: you list the entries in the manifest of the package you assemble and sign. It is taken at a boundary, with no unfinished work journalled and every record read twice at the same revision, so it never holds a checkpoint without its imports or a decision without its observations. The export assumes one process writes to the store, and refuses when it cannot establish the boundary.

A restore checks the descriptor against the package's inventory, every file against its digest and the snapshot against the invariants of the exchange before it writes. It keeps every identity, receipt time, decision and query bound, and relocates only `bytesRef` through a checked mapping that the destination records. A retry of a request the old store acknowledged then answers the same import with no new receipt, and an interrupted pull continues or replays from its retained bounds. A destination record that differs from the snapshot's is never overwritten: the restore writes nothing and answers `reconciliation-required`. An incomplete or altered snapshot is refused by name, among them `checkpoint-imports-omitted`, `resolution-observations-omitted`, `original-missing`, `original-altered`, `descriptor-inventory-mismatch` and `record-version-unknown`.

No credential is in a snapshot, and by default no cursor or page token either. You configure credentials and endpoints again at the destination, and `remapEpcisSourceEndpoint` declares that the same source is reached at another address without changing an identity. `exportEpcisPublicEvidence` is the other path: the originals your access policy allows, with their import records and no provenance, and nothing operational. It cannot be restored. The [EPCIS guide](../../docs/interoperability/epcis.md#move-an-exchange-to-another-store) has the layout, the durable steps, every refusal and a runnable example.

## EPCIS lifecycle claim

`@bsv/dpp-credentials/epcis-lifecycle` is the reference implementation of `dpp-epcis-lifecycle@1` (`spec/epcis-lifecycle-claim.md` of the standard): one EPCIS 2.0.1 event in a signed envelope that binds it to the passports whose products it names. `buildEpcisLifecycleClaim` refuses an event that names no object, `signEpcisLifecycleClaim` signs the RFC 8785 bytes under `[1, 'dpp epcis lifecycle v1']` with key identifier `event`, and `verifyEpcisLifecycleClaim` reports structure, semantics, product binding, signature, authority, possession, ownership, anchor, inclusion and correction each on its own. It fetches nothing: the schema check, the extension rules, the authority resolver, the anchors and the header source come from the caller. `epcisLifecycleCredentialVerifierFor` returns the function a passport verification report takes as `credentialVerifier`.

The claim uses the generic anchor, the key helpers and the report types of `@bsv/dpp-protocol` and the signing primitives of `@bsv/sdk`, so the package declares both. Nothing of them is copied here, and no other entry point imports them: `test/epcis-lifecycle.test.ts` holds that. The code is in `src/epcis-lifecycle/`, with the GS1 identifier conversion and the strict JSON parser in `shared.ts`, which no entry point exports. The vectors are `fixtures/vectors/dpp/epcis-lifecycle/v1.json` in the repository.

`src/parked/epcis-event.ts` is the parked directly signed EPCIS event, `epcis-event-vc@1` (`spec/epcis-event-profile.md`). It is kept with its tests and vectors as the parked record, shares `shared.ts` with the claim, and no entry point exports it.

## GS1 files

GS1 publishes the EPCIS schemas and context under its own terms. This repository and its packages do not redistribute them. Each deployment obtains them from GS1 and the package checks every byte against a pinned digest.

Run `npx dpp-gs1-artefacts fetch` once per deployment, or call `await provisionGs1Artefacts()` from `@bsv/dpp-credentials` before the first validation. Both use a file already in the folder when it matches its digest, fetch any other from `https://ref.gs1.org/`, check its length and SHA-256, and store it. Validation then runs offline from the folder. Nothing is fetched at install or at import.

The folder is `--dir` or the `dir` option, else the environment variable `DPP_GS1_ARTEFACTS_DIR`, else `$XDG_CACHE_HOME/dpp/gs1`, else `~/.cache/dpp/gs1`. Without network access, download the files named by `npx dpp-gs1-artefacts verify` from the addresses it prints, place them in the folder and run `verify` again; `fetch --offline` and `provisionGs1Artefacts({ offline: true })` never fetch.

When the schema is absent or does not match its digest, `validateEpcisDocument` throws `Gs1ArtefactUnavailableError` (`code` `gs1-artefact-unavailable`) and returns no findings. A document is never passed, failed or skipped without the schema. The [package guide](../../docs/packages/dpp-credentials.md#gs1-files) lists the files and their digests.

## Parked: the VSC compatibility profile and the EPCIS-to-SEAL mappings

The `vsc-draft-compat/0.1.0` profile and the EPCIS-to-SEAL mappings `epcis-vsc@1` and `epcis-vsc@2` are parked: optional compatibility profiles that no release requires and that the programme does not currently develop. From `0.2.0-beta.6` their code is no longer part of this package: SEAL parsing, issuance and verification, the `Ed25519Signature2020` suite, `bbs-2023` derivation, custody chains and corrections, the owned context and schema loaders, and `mapEpcisEvent` and `mapEpcisEventWithReport`. `./epcis-source` also loses `readEpcisSourceReference` and `EPCIS_MAPPING_PROFILES`, which served only the mappings; the package guide lists [every removed name](../../docs/packages/dpp-credentials.md#removed-names). The package no longer depends on the Ed25519 and BBS suites those modules used.

What stays is what the parked manifests pin: `artifacts/context-0.1.0.jsonld`, `artifacts/seal-0.1.0.schema.json`, `artifacts/disclosure-0.1.0.schema.json` and the profile record `artifacts/profile-0.1.0.json` with their digests, as published, so the parked manifests stay verifiable. The vectors of both mappings stay as published in `fixtures/vectors/dpp/interoperability/epcis/`.

The code stays in the repository history: commit [`8c82c5e6ca31cd991e701d1051047153c7395eae`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials) on `main` carries it, with its tests and the generators of the mapping vectors, and its package guide there documents the calls. The published `@bsv/dpp-credentials@0.2.0-beta.5` still exports the profile and `epcis-vsc@1`. The `dpp-release-2026-11` candidate claims neither; earlier sets, including the published `dpp-release-2026-10-10`, claimed the implemented subset and `epcis-vsc@1`. New work that verifies credentials from other issuers belongs on `@bsv/dpp-credentials/exchange`.

## Licence

[Apache License 2.0](LICENSE). Third-party dependencies and artefacts retain their own terms and notices.
