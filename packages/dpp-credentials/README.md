# @bsv/dpp-credentials

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

`@bsv/dpp-credentials` verifies W3C Verifiable Credentials that other parties issue in one supported profile (`ecdsa-rdfc-2019` over P-256, `did:web` issuers), and reads GS1 EPCIS 2.0.1 source documents as evidence beside a passport. It has no BSV runtime dependency. It does not claim W3C certification, completion of upstream conformance tests, or regulatory compliance.

| Entry point | What it is for |
|---|---|
| `@bsv/dpp-credentials/exchange` | Verify-only intake of external credentials under `vc-di-ecdsa-rdfc-2019@1`: `verifyExternalCredential`, strict parsing of the exact bytes (`parseExternalCredentialBytes`), authenticated Bitstring Status List checking (`verifyBitstringStatus`), bounded `did:web` resolution through `createExternalDocumentLoader`, and `externalCredentialVerifierFor` for the passport verification report. |
| `@bsv/dpp-credentials/epcis-source` | The EPCIS 2.0.1 source helpers of `epcis-json@1`, with the pinned schema and context. |
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

`@bsv/dpp-credentials/epcis-source` carries the pinned EPCIS 2.0.1 JSON Schema and JSON-LD context (`artifacts/epcis/`, with their digests in `NOTICE.md`) and the helpers of the `epcis-json@1` source exchange profile (`spec/epcis-interoperability.md` of the standard). `parseEpcisSource` reads exact bytes under the disclosed limits (2 MiB, depth 64, duplicate keys, malformed UTF-8 and inexact numbers refused before anything is retained) and answers with the envelope kind, every event's JSON pointer and identifier, and the context declarations as written; `validateEpcisDocument` validates against the pinned schema and checks claimed GS1 identifiers without mutating, coercing or stripping a field; `epcisEventBodyDigest` is the RFC 8785 digest of an event body without its `recordTime` and `errorDeclaration`, so equivalent formatting yields one digest and a changed body another; `classifyEventArrival` names a repeat `duplicate`, a changed record time or error declaration `new-observation` and a changed body `conflict`; `localEventIdentity` labels an event that carries no identifier. `epcisSourceReference` builds the source reference `urn:bsv:dpp:epcis-source:1` that a credential mapped from the event carries; the mappings themselves are parked and not part of this package.

## Parked: the VSC compatibility profile and the EPCIS-to-SEAL mappings

The `vsc-draft-compat/0.1.0` profile and the EPCIS-to-SEAL mappings `epcis-vsc@1` and `epcis-vsc@2` are parked: optional compatibility profiles that no release requires and that the programme does not currently develop. From `0.2.0-beta.6` their code is no longer part of this package: SEAL parsing, issuance and verification, the `Ed25519Signature2020` suite, `bbs-2023` derivation, custody chains and corrections, the owned context and schema loaders, and `mapEpcisEvent` and `mapEpcisEventWithReport`. `./epcis-source` also loses `readEpcisSourceReference` and `EPCIS_MAPPING_PROFILES`, which served only the mappings; the package guide lists [every removed name](../../docs/packages/dpp-credentials.md#removed-names). The package no longer depends on the Ed25519 and BBS suites those modules used.

What stays is what the parked manifests pin: `artifacts/context-0.1.0.jsonld`, `artifacts/seal-0.1.0.schema.json`, `artifacts/disclosure-0.1.0.schema.json` and the profile record `artifacts/profile-0.1.0.json` with their digests, as published, so the parked manifests stay verifiable. The vectors of both mappings stay as published in `fixtures/vectors/dpp/interoperability/epcis/`.

The code stays in the repository history: commit [`8c82c5e6ca31cd991e701d1051047153c7395eae`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials) on `main` carries it, with its tests and the generators of the mapping vectors, and its package guide there documents the calls. The published `@bsv/dpp-credentials@0.2.0-beta.5` still exports the profile and `epcis-vsc@1`. The `dpp-release-2026-11` candidate claims neither; earlier sets, including the published `dpp-release-2026-10-10`, claimed the implemented subset and `epcis-vsc@1`. New work that verifies credentials from other issuers belongs on `@bsv/dpp-credentials/exchange`.

## Licence

[Apache License 2.0](LICENSE). Third-party dependencies and artefacts retain their own terms and notices.
