# The rules: attestations, canonical bytes, and the anchor

**Status: working draft, pre-1.0.** This document defines the second proof rail: the signed lifecycle attestation, the canonical bytes both sides hash, and the on-chain anchor output that commits to it. The record model is defined in [`record-model.md`](record-model.md); the two rails never share an output, and stopping either leaves the other verifying. The attestation wire shape runs in production and remains a proposal between the two implementing workstreams until it is jointly accepted in writing, which is part of what pre-1.0 means here.

## 1. The two rails, briefly

The passport rail answers what this thing is and what has happened to it: the record itself, on chain, as `record-model.md` defines. The anchor rail answers who claimed that and when the claim existed: every lifecycle attestation is canonicalised, hashed, and its digest written to chain in an anchor output. The attestation itself never goes on chain, which is what makes it structurally impossible for personal data to reach the chain through this rail.

## 2. The lifecycle vocabulary

Every record operation maps to one of four lifecycle attestation types, drawn from the UORA vocabulary. The mapping is canonical and total:

| Operation | Attestation type |
|---|---|
| `ACTIVATE` | `Origin` |
| `SOLD` | `Transfer` |
| `RESOLD` | `Transfer` |
| `TRANSFER` | `Transfer` |
| `REPAIRED` | `Transformation` |
| `EDIT` | `Transformation` |
| `RECYCLED` | `Disposition` |

The operation set is the record's own vocabulary; the four types are how a record's history reads to lifecycle-attestation tooling. The type travels in the attestation as `uora_type`.

## 3. The attestation claim

A signed attestation is a JSON object with these properties, all covered by the signature and the digest; `signature` itself is not among them:

| Property | Type | Meaning |
|---|---|---|
| `passportId` | string | The record the claim is about. |
| `recordId` | string | The state within the record. |
| `uora_type` | string | One of the four types in §2. |
| `timestamp` | string | ISO 8601. |
| `issuer` | string | The party making the claim, as a DID. A `did:key` decodes with no network to the issuer's identity key, the parent from which the signing child is derived; a resolvable DID may be used instead, in which case an emitter must put the decodable name in `issuerKeyDid`. |
| `issuerKeyId` | string | The acting party's published identifier within the issuer, carried for attribution. It participates in no derivation: the signature's key identifier is `passportId`, as the signature paragraph below states. |
| `profile` | string | The industry data profile the record follows. |
| `profile_version` | integer | The profile's version. |
| `issuerKeyDid` | string, optional | The issuer's key as a `did:key`, emitted only when `issuer` is not itself one. A reader resolves the decodable name as: `issuer` when it is a `did:key`, else `issuerKeyDid` when present, else `issuer`. An emitter must never produce both a `did:key` issuer and this property; a reader meeting that shape prefers the `did:key` issuer rather than refusing, so the redundant property can never redirect verification to a key the named issuer does not hold. |

**The two-names rule.** A resolvable DID and a `did:key` are two names for one key, and each sits where its reader can use it: the resolvable name in `issuer` for tooling that can reach a resolver, the offline-decodable name in `issuerKeyDid` and in the anchor's issuer field for a reader holding one transaction and nothing else.

**The signature.** ECDSA in DER over the SHA-256 of the canonical bytes (§4), made with the BRC-42 child of the issuer's key for the BRC-43 protocol identifier `[1, 'dpp attestation v1']`, key identifier `passportId`, counterparty `anyone`. It travels in the JSON as `signature`, the DER bytes in lower-case hex. This mirrors the record's server signature idiom deliberately, so one verification recipe covers both rails: decode a key, derive the child, check DER. A verifier needs no wallet, no secret, and nothing from any operator beyond what is published.

**What a valid signature proves, exactly.** That the nominated key signed these bytes. When `issuer` is a resolvable DID, tying the key to the party named is a second step that needs the resolver; the claim's payload alone cannot settle it.

## 4. Canonical bytes

The bytes both sides sign and hash are a deliberate subset of RFC 8785 (JCS), not an implementation of it: keys sorted by code unit, no whitespace, string values JSON-escaped, integer values only when they are safe integers, and a refusal for everything else. The refusal is the feature. JCS is mostly a specification for hard cases this payload does not contain, and a partial implementation that silently mishandled one would let two implementations agree on every value they had tested and differ on the first they had not. Under this rule, two honest encoders of the same claim produce identical bytes or an error, never a second encoding.

An absent optional property and a present-but-empty one are different byte strings and therefore different digests; only one of them is a claim. Encoders must omit absent properties entirely, and the canonicaliser refuses an undefined value rather than skipping it.

## 5. The anchor output: `uora-anchor-v3`

One anchor is one output whose locking script is:

```
<33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 8> OP_2DROP x4
```

Fields 1 to 7 are UTF-8, and each must be non-empty printable text: control characters (C0, `0x7F` and the C1 range) are refused, and a field that fails a UTF-8 round trip refuses the anchor. Field 8 is raw bytes, never UTF-8. Three fields carry length bounds, and they are part of the format: an index admits from whoever can reach it, so a field a stranger controls must not be a field a stranger can make expensive.

| # | Field | Rule |
|---|---|---|
| 1 | prefix | The string `uora-anchor-v3`. The prefix versions the layout: a change of layout is a change of prefix. |
| 2 | digest | 64 lower-case hex characters: the SHA-256 of the attestation's canonical bytes (§4). |
| 3 | attestation id | The writing service's identifier for the attestation. At most 256 characters. |
| 4 | issuer | The claiming party's key as a `did:key`. Carried, not proved: the anchor repeats what the attestation says, and the attestation's own signature is what proves it. |
| 5 | subject | What the claim is about: a passport identifier. At most 512 characters. |
| 6 | type | The lifecycle type, verbatim. At most 64 characters. |
| 7 | anchored by | The anchoring service's published identity key, in canonical compressed lower-case hex. Proved, not merely carried: see the locking rule. |
| 8 | signature | Raw ECDSA DER bytes, over the SHA-256 of the signing preimage of fields 1 to 7. |

**The signing preimage puts every field behind its own length.** Fields 1 to 7 are serialised as varint length followed by field bytes, concatenated, and field 8 signs that. Any other split of the same bytes is a different preimage, so a reader that rebuilds the preimage from the parsed fields gets boundary integrity from the signature itself. This is the lesson the previous layout taught: a signature over the bare concatenation authenticates the total byte string and says nothing about where one field ends and the next begins, and the two adjacent free-text fields could be re-cut into a different subject and type with the signature copied across unchanged. A conforming reader refuses the superseded `uora-anchor-v2` prefix outright.

**The locking rule is what attributes the anchor.** The output's locking key must be the BRC-42 child of the field-7 identity key, for the BRC-43 protocol identifier `[1, 'uora anchor v3']`, key identifier equal to the attestation id, counterparty `anyone`. Counterparty `anyone` is what makes the attribution checkable by a stranger: reproducing the child key needs only the published identity key, and producing a valid output needs its private half. An index can therefore admit anchors from a service it has never been configured to know, and still say whose each one is.

**An anchor is a leaf.** It is never spent, and it never carries the attestation, only the digest.

**The locking push and the tail are exact.** A conforming writer emits the 33-byte compressed push and the exact `OP_2DROP x4` tail, and a conforming reader refuses anything else, as the record rail's reader does for its own layout. The reference reader once accepted a 65-byte uncompressed push and stopped at the first drop opcode without validating the tail; both leniencies were recorded here as defects rather than licence, both have been removed, and the fixture's `uncompressedKey` and `malformedTail` vectors are what keeps them removed.

**Two parties appear in an anchor and they are not the same one.** The issuer (field 4) made the claim; the anchoring service (field 7) wrote the output. The anchor proves the second and merely repeats the first. Conflating them is the one misreading this format invites.

## 6. Verifying an anchor

A verifier holding an attestation and any public copy of the anchoring transaction checks: the canonical bytes of the attestation hash to field 2; the attestation's own signature verifies as §3 describes; the anchor's field-8 signature verifies over the SHA-256 of the length-delimited preimage against the field-7 service's derived key; and the locking key equals the derived child. No call to the writing service is required at any step.

## 7. Conformance fixtures

The reference fixture pins one complete anchor byte for byte, from claim JSON through canonical bytes, digest, derived locking key and full locking script, together with re-cut variants that every conforming reader must refuse. It is maintained as a verbatim copy in each implementing repository, because the implementations deliberately cannot import one another; the fixtures in [`../fixtures/`](../fixtures/) are the same bytes. A fixture with only positive vectors certifies that a format accepts what it should, never that it refuses what it must, which is why the refusal vectors are part of the fixture and not an appendix.

## 8. Normative and implementation

What any conforming implementation must reproduce: the claim properties and their signature rule, the canonical bytes, the eight-field anchor layout, the length-delimited signing preimage, the locking derivation, and verification against any public transaction source plus the attestation. What is a build's own choice: the wallet basket name, the output's satoshi value, how attestations are stored and served, and which index makes anchors findable.
