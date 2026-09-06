# Canonical bytes and signatures

**Audience:** anyone serialising or signing anything the standard defines. **Canonical sources:** the sections named in each row; the vector files publish the bytes.

Every signature and every digest in the standard is over bytes the specification fixes exactly. This page is the index of those rules and where the pinned bytes are; it restates none of them.

| What is signed or hashed | Preimage rule | Derivation | Where it is pinned |
|---|---|---|---|
| Version 1 state, actor signature | Fields 1 to 12 concatenated raw, no framing (`spec/record-model.md` §5) | `[1, 'dpp token v1']`, key identifier the passport identifier, counterparty `anyone`, from the actor's identity key | `fixtures/record-v1.json` `userPreimage`, `userSignature`, `userVerificationKey` |
| Version 1 state, publisher signature | The same followed by the actor signature bytes | The same protocol from the publisher's key | `serverPreimage`, `serverSignature`, `serverVerificationKey` |
| Version 2 state, both signatures | Length-framed fields with a domain tag (`spec/record-model-v2.md` §5) | `[1, 'dpp token v2']` | `fixtures/record-v2.json` `actorPreimage`, `publisherPreimage` |
| Owner key and control linkage | The owner's root derived under the owner protocol with the passport identifier; the linkage scalar relates root to derived key (`spec/custody.md` §4, `spec/record-model-v2.md` §6) | `[1, 'dpp owner v1']`, counterparty `self` | `fixtures/chain-v1.json` `owner3OwnerLinkage`; `chain-v2.json` control states |
| Native claim | Restricted canonical JSON of the claim without `signature`; the secured representation is the complete signed claim (`spec/rules.md` §3, §4) | The claim's own protocol from the issuer's identity key | `fixtures/attestation-anchor-v1.json` `representationBytes`, `digest` |
| Anchor | The nine fields each prefixed by its VarInt length (`spec/rules.md` §5) | `[1, 'bsv attestation anchor v1']`, key identifier the attestation identifier, counterparty `anyone`, from the service key; the locking key is the same child | `fieldHex`, `lockingScript` |
| Historical anchor | Its own preimage and digest contract (`spec/legacy-uora-anchor-v3.md` §4, §5) | Its own protocol | `fixtures/anchor-v3.json` |
| Managed acceptance record | Canonical JSON of the record without `signature`; the commitment is the SHA-256 of the signed form (`spec/managed-custody.md` §3) | The custodian's key, ECDSA over the SHA-256 | `fixtures/managed-acceptance-v1.json` `canonicalUnsigned`, `canonicalSigned`, `commitment` |
| Publisher policy version | Canonical JSON without the signature values; each version names the digest of the one it supersedes (`spec/services.md` §1) | An operator identity key, or a key active under the superseded version, with a countersignature in a federation | `fixtures/vectors/dpp/publisher-policy/v1.json` |
| Evidence package manifest and coverage record | Canonical JSON without the signature value (`spec/portable-evidence.md` §2) | The exporter's key; the coverage record under the same rule | `fixtures/vectors/dpp/evidence-package/v1.json` |
| Owner-tier blob | SHA-256 of the ciphertext (`spec/record-model.md` §7) | | `fixtures/record-v1.json` `ownerBlob` |
| EPCIS event body, passport projection | RFC 8785 without `recordTime` and `errorDeclaration`; RFC 8785 of the projection excluding its own identity | | The interoperability vectors |

## Canonical JSON, two dialects

The native claim and the anchor rail use a **refusing subset of JCS**: keys sorted by UTF-16 code unit, no whitespace, values limited to strings, booleans, safe integers, arrays and objects, and anything else refused rather than coerced. The acceptance record, the publisher policy and the evidence package manifest use the same rule. The EPCIS body digest and the passport projection use **RFC 8785** in full, because those documents are not the standard's to restrict. An implementation that produces a different byte for the same object under the rule the document names has a defect, and the vectors are how it finds out.

## Keys in the vectors

The positive vectors publish their synthetic private keys so that a writer in any language reproduces the pinned bytes rather than only checking them: `11`, `22` and `33` repeated to 32 bytes for the record, `44` and `55` for the chain, `77` and `88` for the anchor. Signatures use RFC 6979 nonces and are therefore reproducible on any machine. Nothing derived from these keys will ever hold value.

## Reading the vector files

The vector files under `fixtures/vectors/` are in the cross-language conformance vector format the BSV stack uses: a stable dotted identifier, a version, the reference implementation that produced the file, a parity class, and vectors that each carry an identifier, an input, an expected result and tags (`happy-path` or `error-case`; the policy and package files use `<name>/valid` and `<name>/refusal`). Binary is lower-case hex under keys ending `_hex`. Identifiers are permanent and files are append-only: a corrected expectation is a new vector and the old one is marked skipped with a reason.
