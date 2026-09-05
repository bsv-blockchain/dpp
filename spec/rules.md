# Attestations and complete-representation anchors

**Status: working draft, pre-1.0.** This document defines native lifecycle claims and the versioned BSV anchor shared by native claims and VSC credentials. [The VSC compatibility profile](vsc-profile.md) defines the separate credential rules. [Historical native claims and anchor v3](legacy-uora-anchor-v3.md) retain their original verification rules. A format name MUST select one exact byte contract.

## 1. Independent evidence

The passport token records native state transitions under [record-model.md](record-model.md). A lifecycle issuer signs a claim about an identified subject. An anchoring service commits to the complete secured representation. These roles MAY be performed by different parties. An attestation need not spend a passport token; an anchor never shares the token output.

A valid BSV anchor establishes its service's signature over a commitment and metadata. A mining proof establishes inclusion at a chain position. Neither establishes the credential issuer's authority, the truth of an event, current credential status, availability of undisclosed evidence or the absence of later events. Implementations MUST report those checks separately.

## 2. Native lifecycle vocabulary

The native claim records the token operation's classification. These labels are not a complete UORA credential or VSC event model.

| Native operation | eventType |
|---|---|
| ACTIVATE | Origin |
| SOLD, RESOLD, TRANSFER | Transfer |
| REPAIRED, EDIT | Transformation |
| RECYCLED | Disposition |

An EDIT is a native metadata operation, not evidence that a physical transformation occurred. A transfer of token control does not by itself establish physical movement, custody or legal ownership. A VSC mapping MUST use actual event evidence and report insufficient data where required fields or authority are unavailable. It MUST NOT manufacture locations, actors, serial identities or predecessor events.

A mapping from a native operation to an external lifecycle semantics is conditional, and every profile states its conditions ([`profiles.md`](profiles.md) §2, `eventMappings`; [`exchange.md`](exchange.md) §2). ACTIVATE maps to a manufacture or commissioning event only with manufacturing evidence; SOLD, RESOLD and TRANSFER map to a physical move or change of custody only with actual source, destination or custody evidence; REPAIRED maps to a modification only with repair evidence; EDIT remains a metadata revision; RECYCLED distinguishes disposition of the item from a process whose outputs carry new identities. A mapping result is exactly one of `lossless`, `transformed`, `unsupported` or `insufficient-data`, and a result other than `lossless` carries the list of what was lost or missing. No field is dropped silently. The evidence a mapping asks for is named by facet, and each facet is a reference to a record (a claim digest, an outpoint, a document digest), never a bare flag: `facility`, `time` and `responsibleParty` for an origin; `source` and `destination`, or a `custodyRecord`, for a transfer; `workDone`, `performedBy` and `performedAt` for a repair; `dispositionKind` and, for a process, `outputs` for a disposition. A lifecycle claim that carries these facets under these names in its payload is the evidence; a claim that does not is not.

## 3. Native signed claim

A current native claim has exactly the following properties; issuerKeyDid is optional only under the stated rule. Unknown fields and ambiguous legacy/current mixtures MUST be rejected.

| Property | Requirement |
|---|---|
| claimFormat | Literal `dpp-lifecycle-v1` |
| passportId | Nonempty printable UTF-8, at most 512 bytes; the subject identifier |
| recordId | Nonempty printable UTF-8, at most 512 bytes; exact native state reference |
| eventType | One of Origin, Transfer, Transformation, Disposition |
| timestamp | ISO date-time with a timezone and valid calendar date |
| issuer | DID of the claiming entity, at most 512 UTF-8 bytes |
| issuerKeyId | Attribution label for the signing role, at most 256 UTF-8 bytes |
| issuerKeyDid | A compressed secp256k1 did:key, required when issuer is not did:key; forbidden when issuer is did:key |
| profile | Selected product data profile, at most 256 UTF-8 bytes |
| profile_version | Positive safe integer; independent of claimFormat and VSC profile versions |
| signature | Canonical ECDSA DER, encoded as lowercase hex |

String fields MUST reject C0/C1/DEL controls and malformed UTF-8. The signature signs SHA-256 of the restricted canonical JSON of every property except signature. It uses the issuer identity key's BRC-42 child for `[1, 'dpp attestation v1']`, key identifier passportId, counterparty anyone. issuerKeyId is an attribution field, not the derivation key identifier. A BRC-100 createSignature call supplies the canonical bytes as data.

A did:key issuer identifies the native signing root directly. When issuer is resolvable, issuerKeyDid establishes only which key signed. A verifier MUST separately authenticate that key's relationship to the named issuer and applicable signing authority. It MUST NOT treat a key nominated by the payload as proof of that relationship. Application accounts, brands and operator hosting roles confer no authority through this encoding.

## 4. Secured representation bytes

Signing and commitment preimages are different:

| representation | mediaType | Bytes hashed by the anchor |
|---|---|---|
| dpp-lifecycle-json-v1 | application/json | Restricted canonical JSON of the complete signed native claim, INCLUDING signature |
| vsc-seal-json-v1 | application/vc+ld+json | Exact UTF-8 bytes of the complete issued VSC compatibility credential, INCLUDING its Data Integrity proof |

Restricted canonical JSON sorts property names by code unit, uses JSON string escaping, no whitespace, and only string values or safe integers. Other values are rejected. An omitted optional property differs from an empty value. This rule applies to the native flat claim only. VSC Data Integrity signatures use their selected suite's JSON-LD/RDF canonicalisation; they MUST NOT use the native canonicaliser.

For a VSC credential, even whitespace changes produce different committed representation bytes. Store and return the original bytes. A projection, corrected credential or selectively disclosed presentation is a different representation with its own verification; it cannot inherit an exact-byte anchor merely because some visible claims match. An implementation MUST reject duplicate JSON keys before accepting a secured JSON representation.

## 5. BSV anchor v1

The prefix is `bsv-attestation-anchor-v1`. The locking script is exactly:

```text
<33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 10> OP_2DROP x5
```

| Field | Name | Rule |
|---|---|---|
| 1 | prefix | bsv-attestation-anchor-v1 |
| 2 | digest | Lowercase 64-hex SHA-256 of the complete secured representation |
| 3 | attestationId | At most 256 UTF-8 bytes |
| 4 | issuer | Carried identifier, at most 512 UTF-8 bytes; no secp256k1 restriction |
| 5 | subject | Carried product/passport identifier, at most 512 UTF-8 bytes |
| 6 | attestationType | At most 128 UTF-8 bytes; native eventType or VSC-SEAL |
| 7 | representation | Versioned representation identifier, at most 128 UTF-8 bytes |
| 8 | mediaType | At most 128 UTF-8 bytes |
| 9 | anchoredBy | Anchoring service identity key, canonical lowercase compressed secp256k1 hex |
| 10 | signature | Raw canonical ECDSA DER |

Fields 1-9 MUST be nonempty printable text, round-trip UTF-8 and exclude C0/C1/DEL controls. The signature preimage is the concatenation of each field's Bitcoin VarInt byte length and its bytes. The service signs SHA-256 of that preimage using its BRC-42 child for `[1, 'bsv attestation anchor v1']`, key identifier attestationId, counterparty anyone. The locking key MUST equal that same openly derived child.

Readers MUST reject incorrect field counts, prefixes, bounds, UTF-8, keys, signatures or drop tails, including trailing script content. A signature over unframed concatenation is invalid. Unknown representation identifiers may be indexed as opaque commitments, but content verification MUST return unsupported until their rules are known.

The anchor carries searchable metadata publicly as well as a digest. Issuers and operators MUST consider disclosure and correlation when selecting identifiers. Keeping the credential body off chain does not make all anchor metadata anonymous.

## 6. Verification and discovery

A reader checks the exact script, service signature and key derivation, then checks the supplied secured bytes against the digest. It verifies the representation using its own rules and compares the verified issuer, subject, identifier and type with all carried metadata. For native claims, the registry identifier is `urn:sha256:` followed by the complete-representation digest. For VSC, attestationId is the credential id; subject MUST be one of its signed product identifiers. An unsupported or unavailable content check remains distinct from a verified anchor.

Mining proof and block-header validation are separate. The new topic is tm_attestation and the lookup service is ls_attestation. They return anchor transaction evidence, not a credential-validity assertion. [The overlay contract](../contracts/overlay.yaml) defines bounded cursor queries. One or multiple operators may serve the same evidence under these rules.

## 7. Compatibility and fixtures

Existing uora-anchor-v3 outputs remain historical native commitments over the old unsigned canonical claim. They MUST NOT be interpreted under the new signature-inclusive digest rule. The old uora_type field, prefixes and BRC derivations are preserved only for historical decoding; new native writes use eventType and claimFormat. Superseded uora-anchor-v2 remains refused.

Legacy topics tm_uora_dpp and ls_uora_dpp are separate historical interfaces, not aliases for new-format evidence. Migration adds new stores and indexes, retains original bytes and uses explicit format selection. It never rewrites an old anchor or silently re-ranks historical claims under another policy.

[The portable anchor fixture](../fixtures/attestation-anchor-v1.json) fixes the signed claim, complete representation bytes, digest, nine framed fields, derived key, signature and script. Independent readers and writers MUST agree on these bytes and reject the mutation cases in the reference tests.
