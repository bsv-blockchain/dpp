# @bsv/vsc

**Audience:** registries and issuers exchanging credentials; readers of EPCIS documents; verifiers of external credentials. **Version in the current set:** 0.2.0. **Runtime:** Node 22 or later, server only (`node:crypto`, `node:zlib`, `node:fs`) on every code entry point. **Runtime dependencies:** the maintained Digital Bazaar Data Integrity suites and contexts, `jsonld-signatures`, `ajv`, `ajv-formats`, `did-context`; no BSV dependency. **Canonical sources:** [`packages/vsc/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/vsc/README.md), [`spec/vsc-profile.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/vsc-profile.md), [`spec/external-credential-profile.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/external-credential-profile.md), [`spec/epcis-interoperability.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/epcis-interoperability.md).

## Three entry points

| Entry point | What it does | Profile |
|---|---|---|
| `@bsv/vsc` | Strict SEAL parsing, the owned JSON-LD context and schema, Ed25519Signature2020 issuance and verification, BBS issuance and request-bound selective disclosure, authenticated status and authority checks, custody graph and correction evaluation, EPCIS event mapping | `vsc-draft-compat/0.1.0`, a pinned Community Group draft |
| `@bsv/vsc/epcis-source` | Exact-byte EPCIS 2.0.1 parsing under disclosed limits, schema validation without mutation, RFC 8785 event body digests, arrival classification, the signed source reference, and the mapping report with its four outcomes | `epcis-json@1`, `epcis-vsc@1` |
| `@bsv/vsc/exchange` | Verification of a W3C VC 2.0 credential secured with `ecdsa-rdfc-2019` over a P-256 Multikey under a `did:web` issuer, ten separate checks, and the adapter into the verification report | `vc-di-ecdsa-rdfc-2019@1` |
| `@bsv/vsc/artifacts/*` | The owned context and schemas, the pinned EPCIS artefacts, the W3C context and the external passport context and schema, each with its digest in a notice file | Data |

## What the verifiers refuse to assume

Resolvers return signed evidence, never a Boolean. A status list is authenticated, purpose-aware, bounded and held to a named freshness profile before a bit is read. Issuer authority is a signed authorisation from an operator-configured trust anchor, or an explicit policy that records authority is not required; a missing policy is indeterminate. A key that resolves is not thereby authorised to sign for an issuer. A P-384 key, another cryptosuite, an inline context or a second credential subject is `unsupported`, never a pass and never a silent fail. A reformatted credential whose RDF proof still verifies is reported apart from the exact bytes an anchor commits to, which differ.

## What this is not

Documented draft compatibility with a pinned revision, not W3C certification, not completion of the upstream conformance suite, and not regulatory compliance. The release selection claims the implemented subset and withholds full draft conformance by name because the upstream context and executable suite are unavailable at the pinned revision. The package verifies credentials; BSV tokenisation, wallet funding, token spend authority, inclusion and overlay discovery stay outside it, and a BSV adapter anchors exact credential bytes separately.

## Independence note

Credential verification under a W3C suite is generic cryptography; an independent implementation may use the same maintained suites, or any conforming implementation of them, without that being reference DPP logic. What is DPP-specific here is the profile selection, the report mapping, the exact-byte rule and the EPCIS mapping outcomes, and an independent implementer reproduces those from the specifications and the interoperability vectors.
