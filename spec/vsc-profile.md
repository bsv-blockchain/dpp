# VSC draft compatibility profile

**Profile: vsc-draft-compat/0.1.0. Status: implementation draft.** This profile selects and implements a documented subset of the Verifiable Supply Chain Community Group drafts. It is not a W3C Standard or certification. It is separate from native BSV token validity and the generic anchor format.

## 1. Sources, precedence and scope

The source revision is [w3c-cg/vsc c279de3debcd6eab94a77034584d1750f5d65e6a](https://github.com/w3c-cg/vsc/tree/c279de3debcd6eab94a77034584d1750f5d65e6a). The [Core draft](https://w3c-cg.github.io/vsc/specs/vsc-core.html) specifies SEALs, custody chains, corrections and proof support. The [Requirements draft](https://w3c-cg.github.io/vsc/specs/vsc-requirements.html) takes precedence where Core explicitly defers to it. Industry and trust-framework documents apply only when selected by a named capability.

The UORA Community Group merged into VSC, but UORA and VSC documents are not interchangeable. The UORA copy in VSC predates the authority-first published UORA text, despite both being labelled v1.0. Native historical UORA-named records retain their selected historical policy. This profile uses VSC custody and correction rules; it does not silently import either UORA conflict cascade.

Profile version and upstream sealVersion are independent. Verification results MUST identify the implementation profile and source revision. The credential carries sealVersion and the profile manifest records the supported value. A future source change requires explicit review and new compatibility evidence. Sharing the VSC-SEAL type alone is insufficient to claim conformance.

## 2. Credential structure and identities

A SEAL contains its contexts, VerifiableCredential/VSC-SEAL types, stable credential id, issuer DID, issuanceDate, validFrom, sealVersion 1.0, sealTimestamp, eventVector, extensions, chainOfCustody, correctionOf, credentialSubject, credentialStatus and a supported proof. validUntil is optional and enforced when present. The packaged schema and context define the selected field meanings and types.

The event vector contains what, when, where, who and how. Product identifier scheme/value/authority entries belong in what; eventTime and recording information belong in when; jurisdiction and optional locations belong in where; actor DID, role and assertion method belong in who; event vocabulary, business step, disposition and action belong in how. Actor DID MUST equal issuer. Unknown required vocabularies cannot inherit a verified industry claim.

The credential id identifies the attestation, not the product. Product identity is distinct from custody chainId, a native passport identifier and application account identity. The [identity specification](identity.md) defines these boundaries and the separate optional UORA physical-object addressing capability. Issuer assertion authority must be checked using the selected DID document and authority evidence; a nominated signing key or matching account is insufficient.

A parser MUST preserve secured bytes, reject duplicate JSON keys, malformed UTF-8, unsupported versions and unsafe JSON values, and validate the selected schema without silently deleting fields. Original signed data must survive storage and export.

## 3. Contexts and proofs

The upstream example context was unavailable at the reviewed revision. This implementation therefore uses the owned, versioned context `urn:bsv:vsc:context:0.1.0`, distributed with @bsv/vsc, together with pinned VC and proof-suite contexts. It does not invent content under a W3C URL. This difference is an explicit compatibility limitation, and prevents an unqualified claim of exact upstream-context conformance.

The package supports the actual Ed25519Signature2020 Data Integrity suite, using its maintained implementation and suite-defined JSON-LD/RDF canonicalisation. Native secp256k1 DER signatures and Ed25519 JWS are not substitutes. A verified key must be authorised for assertion by the credential issuer's DID document. Unsupported or substituted contexts and proof suites cannot pass the relevant check.

BBS base credentials and derived disclosures use the selected maintained bbs-2023 cryptosuite. The presentation challenge is verified. Required disclosure fields must remain present. The derivation API is a cryptographic primitive: its caller MUST authorise each optional disclosure pointer before invoking it. A requester-supplied access level is not an authorisation grant. The signed presentation header binds the supplied request, challenge, verifier, holder and expiry; it does not establish possession of a holder authentication key. A service requiring holder authentication MUST establish that separately. Ed25519 credentials cannot acquire selective disclosure by deleting signed properties.

Credential cryptography does not depend on BSV access. The additional BSV binding commits to the complete issued bytes under [rules.md](rules.md). Derived disclosure bytes differ from the issued bytes and MUST NOT be compared as though they were the same anchored representation. A source relationship alone does not establish exact-byte identity.

## 4. Status, authority and time

Credential status is required for accepted SEALs. Verify the status-list credential's proof, issuer or explicitly authorised list issuer, identity, purpose, index, temporal validity and freshness before reading its bit. Apply bounded decompression and the selected status-list specification's bit numbering. A freshly fetched old signed list remains old. Missing, malformed, revoked, suspended and unavailable status are distinct outcomes.

Trust policy is explicit and named. Where authority is required, validate signed grants from permitted trust anchors, their scope, issuer/subject relationships, time and status. An issuer cannot establish its own accreditation by selecting an arbitrary registry or adding a trust-anchor label to its credential. A policy that does not require accreditation must state that limit; signature verification alone does not become an authority check.

Event time and issuance time are different facts. Validate their formats and the selected temporal rules without assuming equality. Retained status and identity observations support historical evaluation only within their recorded scope; they do not establish current permission or global latest state.

## 5. Custody, transformations and corrections

Custody validation distinguishes origin, transit, destination and terminal states. Validate permitted transitions, predecessor references and sequence numbers under the declared custody scope. Native token operations do not automatically supply these states. An EDIT or control transfer may have no lossless VSC physical-event mapping.

Backward parent references define traversal. Use path-local cycle detection and memoisation so a shared ancestor in a diamond remains valid. Depth, width, node and time limits are explicit resource policy; an unavailable ancestor or exhausted budget cannot produce a complete-chain result.

The draft's immutable signed SEAL requirement takes precedence over descriptions of retrospective child mutation. Fork batches can allocate child ids before signing. Later forward indexes are derived metadata, not modifications to the signed parent. Sequence numbers advance within the selected chain; a merge follows the greatest parent sequence. A terminal custody chain does not silently invalidate or rename the enduring product passport.

Correction is an explicit topology, following the correction section over the incomplete general enumeration. Retain the original credential and issue a separate correction referencing it. In this local profile a correction has exactly one parent, its correction target, and starts a separate correction chain at sequence 1. Additional custody parents are rejected. The original issuer or a verified, scoped delegate must authorise correction. Evaluate correction references separately from physical custody transitions. Multiple authorised correction termini produce conflict or indeterminate state; this profile does not invent a timestamp-based winner. Missing correction discovery cannot prove that no correction exists.

## 6. EPCIS and industry extensions

The reference mapping handles the five EPCIS event types and retains the source event in a signed, versioned extension for lossless round trips. Mapping requires actual issuer, status, location, product, time and chain inputs. Missing semantic data is an error or an explicit unsupported/insufficient-data result. Source event preservation does not by itself validate an industry regulation.

Extensions are preserved with their signed meaning. An unknown optional vocabulary can remain uninterpreted without invalidating unrelated core evidence. A required industry profile with unknown or undisclosed fields remains unverified. Battery, textile, pharmaceutical and food rules belong in independently selected profile manifests, not the account model or generic token codec.

## 7. Roles, reports and qualification

The reference package provides parsing, structure validation, genuine issuance/proof verification, BBS derivation, status/authority checks, graph/correction checks and EPCIS mapping. [Its capability manifest and README](../packages/vsc/README.md) record implemented APIs and limits. [The registry contract](../contracts/registry.yaml) selects those capabilities for intake and retrieval. It does not claim to implement every upstream presentation exchange or industry conformance class.

Report structure, proof, temporal, status, authority, chain and correction findings separately. Overall acceptance depends on the explicitly required checks. Results are scoped to supplied/discovered evidence and do not prove global completeness. The implementation profile, test fixtures and local resolutions are independently versioned artefacts. A project test pass must not be labelled an upstream conformance-suite pass when that suite is unavailable.

Before claiming a broader VSC class, map every required clause, including presentation authorisation, disclosure, transport and selected industry rules, to implemented and independently verified behaviour. Unsupported requirements remain visible and prevent that broader claim.
