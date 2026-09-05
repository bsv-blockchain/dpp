# Exchange profiles: credential representations beside the native record

**Status: working draft, pre-1.0.** This document defines how a passport's evidence is carried in a credential format other than the native record and claim: which representations exist, how a representation is selected and versioned, what a signer must and must not do, how the original secured bytes, their decoded form and any projection are kept apart, how a credential may reference native evidence and how exact credential bytes may be anchored. It changes nothing about the native record, the native claim or the generic anchor; those keep their byte contracts under [`record-model.md`](record-model.md) and [`rules.md`](rules.md).

## 1. Representations are named and versioned

A representation is one exact byte contract for one credential format, identified by a versioned string a reader dispatches on. The current registry is:

| Representation | Media type | Bytes committed by an anchor | Proof | Defined by |
|---|---|---|---|---|
| `dpp-lifecycle-json-v1` | `application/json` | Restricted canonical JSON of the complete signed native claim | Native secp256k1 under `[1, 'dpp attestation v1']` | [`rules.md`](rules.md) §3, §4 |
| `vsc-seal-json-v1` | `application/vc+ld+json` | Exact UTF-8 bytes of the issued credential including its Data Integrity proof | Ed25519Signature2020 or bbs-2023 | [`vsc-profile.md`](vsc-profile.md) |
| `untp-0.7.0-jose@1` (proposed) | `application/vc+jwt` | Exact compact JWS bytes as issued | ES256K, and where a consumer requires it a separately keyed ES256 | §5 and the exchange profile manifest |

A reader that meets a representation it does not implement indexes the commitment and reports content verification `unsupported` (`representation-unsupported` in [`verification.md`](verification.md)); it never guesses, never downgrades to a weaker check and never reads one representation's bytes under another's rules. Adding a representation is a new profile manifest and a new row here, never a change to an existing row.

## 2. Exchange profile manifests

An exchange profile is published as a manifest conforming to `packages/dpp-profiles/schemas/exchange-profile.schema.json`: its representation, data model, the schemas and contexts it validates against with their versions and, once retrieved, their digests, the proof suites it supports and what a consumer must confirm, the native evidence extension it may carry, the anchoring rule for its exact bytes, the mapping to and from native operations with the evidence each mapping requires, and what it does not support. An artefact recorded without a digest is recorded as not yet retrieved, and no conformance claim rests on it until it is pinned; a manifest never carries a digest it did not compute over the bytes.

## 3. Four artefacts, kept apart

Wherever a credential is stored or served, four things are distinct and none is presented as another:

1. **The native claim**, if the event also has one: the signed `dpp-lifecycle-v1` object.
2. **The original secured credential**: the exact bytes as issued, retrievable identical, with their `mediaType`, `byteLength`, `sha256`, `credentialId`, `issuer`, `receivedAt`, `schemaRefs` and a reference to the validation report made at intake.
3. **The decoded credential**: the parsed value, for reading, never re-serialised as if it were the original.
4. **A projection**: a document derived from the credential in another shape or format. A projection has its own identity and, if signed, its own signature by the party that made it, which names itself as exporter and names its source. The original issuer's signature is never attached to transformed bytes, and a projection never inherits the original's anchor.

## 4. Signers

A signer takes exact signing bytes, an algorithm identifier and a key identifier, and returns a signature. It never exposes a private key and never chooses the algorithm from the bytes. ES256K over secp256k1 is a supported suite; a consumer MUST advertise or confirm it, because a JOSE library that omits ES256K is a compatibility limit and not a signature defect. Where a consumer requires ES256, an implementation MAY add a P-256 suite under a dedicated, separately authorised credential key whose relationship to the issuer and to the BSV actor is published; it MUST NOT derive a P-256 key by the secp256k1 BRC-42 rule and MUST NOT relabel an ES256K signature as ES256. Native BSV signing stays independent of any such key.

## 5. The native evidence extension

A credential in an external representation may reference evidence that already exists on the native rails. It does so with the extension defined by [`../contracts/native-evidence-extension.schema.json`](../contracts/native-evidence-extension.schema.json), version 1, under its own identifier outside any external namespace: the exact `passportId`, the state's `txid` and `outputIndex`, the native claim digest, the anchor's `txid` and `outputIndex`, the native profile and version and the mapping version. A verifier resolves and verifies each reference independently: the state under the record model, the claim under `rules.md` §3, the anchor under `rules.md` §5, and the binding between them under [`verification.md`](verification.md). The direction avoids any circular digest: the native evidence exists first, then the external credential is signed over references to it. Such a credential is described as a signed external representation linked to anchored native evidence, never as a native anchor of the external credential.

## 6. Anchoring exact credential bytes

The separate capability of committing to an external credential on chain uses the generic anchor of `rules.md` §5 over the credential's exact secured bytes, with `representation` and `mediaType` naming the format, `attestationId` the credential's own identifier, `issuer` its issuer and `subject` one product identifier it signs. The anchoring service need not be the issuer. A verifier compares every carried field against the verified credential, and a single changed byte fails the digest. This is the route selected in place of any wrapper claim that would place a digest of the credential inside a second signed object.

## 7. Verification of external credentials

Verification checks the proof under the representation's own suite and canonicalisation, then issuer and controller binding of the verification method for the assertion purpose, validity times, status through an authenticated status list, the expected subject, the declared schema and the mapping's semantic rules, each reported separately in the verification report. Context, key and schema loaders are bounded and cached, serve pinned artefacts, and return `unsupported` for anything they do not hold rather than fetching arbitrary URLs. Read and verify support for the `ecdsa-jcs-2019` Data Integrity suite may be selected for external credentials that use it; it adds no issuance. Holder-presented SD-JWT and derived Data Integrity disclosure suites are selected only when a real restricted-disclosure use case names one, because ordinary filtering of JSON is not cryptographic selective disclosure.

## 8. Normative and implementation

What a conforming party reproduces: the representation registry and its dispatch rule (§1), the manifest and its honesty about unretrieved artefacts (§2), the separation of the four artefacts (§3), the signer rules (§4), the native evidence extension (§5), the exact-byte anchoring rule (§6) and separate reporting of each verification finding (§7). What is a build's own: which representations it implements, which libraries verify them, and where it stores the four artefacts.
