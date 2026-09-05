# VSC draft compatibility profile

`@bsv/vsc` implements the local `vsc-draft-compat/0.1.0` profile against the VSC Community Group draft at revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It has no BSV runtime dependency. It does not claim W3C certification, completion of upstream conformance tests, or regulatory compliance.

The package includes strict secured SEAL parsing, an owned JSON-LD context and schema, Ed25519Signature2020 issuance and verification, BBS issuance and request-bound selective disclosure, authenticated status and issuer-authority checks, and custody DAG and correction evaluation. It preserves all five EPCIS event types in signed round-trip extensions. Unsupported or insufficient mappings fail instead of inventing event information.

## Issuance and verification

```ts
import {
  createDocumentLoader, issueSealEd25519, verifySeal, parseSealBytes,
} from '@bsv/vsc';

// Documents and trust anchors come from the operator's configured evidence policy.
// Do not accept a credential's own assertion that its issuer is trusted.
const documentLoader = createDocumentLoader(documents);
const credential = await issueSealEd25519({ credential: unsignedSeal, key, documentLoader });
const result = await verifySeal({
  credential,
  documentLoader,
  evaluationTime: new Date().toISOString(),
  statusPolicy: {
    id: 'urn:example:status-policy:1',
    maxAgeMs: 86_400_000,
    resolve: async url => {
      const evidence = statusCredentials.get(url);
      if (!evidence) throw new Error('Status evidence unavailable');
      return evidence;
    },
  },
  authorityPolicy: {
    id: 'urn:example:issuer-policy:1',
    required: true,
    trustAnchors: trustedAuthorityDids,
    resolve: async issuer => authorisationsByIssuer.get(issuer) ?? [],
  },
  resolveSeal: async id => historicalCredentials.get(id),
  corrections: discoveredCorrections,
});

// Retain the bytes supplied to parseSealBytes separately for exact-byte anchoring.
const received = parseSealBytes(originalBytes);
```

Resolvers return signed evidence, never a Boolean saying that verification passed. A status resolver must return a signed `BitstringStatusListCredential`. Its identifier, issuer authority, proof, status purpose, validity, signed freshness and bit index are checked before its contents are used. Decompression is bounded. Third-party list issuers require an explicit grant in `statusPolicy.delegatedListIssuers`. Configure at most 24 hours for pharmaceutical and food contexts; the generic upper bound is seven days.

Required issuer authority uses signed `VscEventAuthorisation` credentials. Their issuer must be an operator-configured trust anchor; `credentialSubject.id` identifies the authorised issuer, `permittedEventTypes` is required, and optional `permittedProductSchemes` and `permittedJurisdictions` restrict the grant. Grant proofs, validity and status are verified. An explicit `{id, required: false, reason}` policy records that external authority is not required by this verifier, and returns an `authority_not_required` warning. Missing policy remains indeterminate.

`createDocumentLoader` supplies pinned standard and local contexts. The optional `createDidWebResolver({allowedOrigins})` resolves permitted HTTPS origins, refusing redirects and bounding time and size. Other DID methods can be supplied through the document-loader interface. The loader must return the requested issuer DID document, its authorised assertion methods and associated public key material. Resolving a key does not by itself authorise that key to sign for an issuer.

## Proofs and selective disclosure

`issueSealEd25519` uses the maintained Ed25519Signature2020 suite with JSON-LD/RDF canonicalisation. It does not substitute an Ed25519 JWS or a signature over JSON text. `issueSealBbs` uses the maintained `bbs-2023` cryptosuite. These use different keys and produce independently secured representations; a key's DID relationship must authorise its actual proof purpose.

`deriveSealPresentation` produces a genuine BBS derived credential. Its `binding` contains a request identifier, unpredictable challenge, verifier DID, holder DID and expiry. `verifySealPresentation` checks that binding and the required disclosed fields. The cryptographic presentation header prevents moving the result to a different request or verifier. It does not prove possession of a holder authentication key; applications needing holder authentication must establish that separately.

The disclosure helper is a cryptographic primitive, not an access-control endpoint. The caller must authorise every optional JSON pointer before requesting disclosure. The package deliberately does not implement the draft's entire HTTPS presentation protocol or treat a caller-supplied authorisation level as a grant.

This profile always discloses the credential subject, including mirrored predecessor references. Optional custody fields, location details and domain extensions can be withheld. Empty/null RDF values do not produce statements; the original-record `correctionOf: null` marker is restored after derivation. Non-null correction references are mandatory signed disclosures. A disclosed credential is verified for its revealed claims and request binding, not mistaken for the complete originally anchored byte representation.

## Custody and corrections

Graph verification uses backward parent references, path-local cycle detection and a completed-node cache. Valid diamond graphs are permitted. Default limits are depth 64, 1,024 visited credentials, 256 parents and a 30-second graph resolution deadline. A limit or missing predecessor yields indeterminate verification.

Sequence numbers are branch heights: an origin is 1 and a subsequent custody event is one greater than its highest parent. Linear custody preserves the chain and product identifiers. Terminal states cannot re-enter that chain. A new VSC custody identity does not erase the persistent product or passport identity.

Fork issuers preallocate child identifiers before signing. Signed forward references are never filled in retrospectively. The package validates declared child membership when following a fork parent; it does not establish the global completeness or latest state of a distributed history.

Corrections retain the original credential and use a separate chain identifier with sequence 1. This profile permits exactly one correction parent, its correction target. The effective event data is projected during downstream state validation; the projection is not presented as another signed credential. Competing authorised corrections return a conflict. Cross-issuer corrections require `correctionPolicy.resolve(originalIssuer, delegate)` to supply a signed `VscCorrectionAuthorisation` from the original issuer, with subject `id` matching the delegate, `originalIssuer`, `permittedRecordIds` and `permittedActions: ['correct']`. Proof, validity and status are checked.

Results apply to the supplied/discovered evidence, recorded as `evidenceScope: 'provided-evidence'`. They do not establish global freshness, physical truth, legal ownership, or product-to-label binding.

## Identifiers and BSV integration

A VSC actor DID identifies the asserting actor. A physical product may separately use a UORA-style object DID in `eventVector.what.productIdentifiers`. Accounts, credential subjects, physical objects, controllers, custodians and signing keys are separate roles. No account-to-brand mapping or mandatory co-controller is inferred.

`extractSealMetadata` returns credential `id`, issuer, type and product identifier values as `subjects`. The credential subject ID is the attestation ID in this profile. When anchoring a multi-product record, select an explicit signed product identifier; do not silently use the attestation ID as a product ID.

BSV tokenisation, wallet funding, token spend authority, transaction inclusion and overlay discovery stay outside this package. A BSV adapter can anchor the exact complete secured credential bytes and report those additional guarantees separately. Reading or verifying a SEAL requires no blockchain access. Physical-object DID addressing and secure physical binding remain separate capabilities from actor identity and cryptographic credential verification.

## Artefacts and limits

The [manifest](artifacts/profile-0.1.0.json) records source revisions, implementation decisions and unresolved upstream conformance gates. The owned context uses `urn:bsv:vsc:context:0.1.0`; no invented bytes are served under the upstream draft's missing W3C context URL. Share the versioned artefacts through the package. General upstream interoperability without prior context distribution remains an explicit unmet gate.

Pharmaceutical/food regulatory profiles, a full presentation HTTP protocol, independent implementation interoperability certification, regulatory rule engines and secure physical binding are not claimed by this package. Its tests exercise actual suites and evidence checks. Direct upstream-suite verification is useful interoperability evidence, but does not count as an independent implementation certification.
