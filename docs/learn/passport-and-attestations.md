# Passport states and attestations

**Audience:** implementers of any role. **Canonical sources:** [`spec/record-model.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model.md), [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md), [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md), [`spec/legacy-uora-anchor-v3.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/legacy-uora-anchor-v3.md). This page explains; the rules are there.

## The passport state

A state is one output whose locking script is a public key, `OP_CHECKSIG`, and a fixed number of minimal data pushes followed by an exact tail of drop opcodes. The pushes are the record: a protocol marker and a version, the passport identifier (a GS1 Digital Link URI), the operation, a timestamp, the actor's identity key, the owner's key, the public payload and the event data as restricted canonical JSON, the hash of the encrypted owner-tier blob, the previous transaction identifier, and two signatures. Version 1 has fourteen pushes; version 2 has seventeen, adding the lineage genesis, the predecessor outpoint, a control linkage and an authorisation commitment.

Two signatures sign each state. The actor's signature is made under a BRC-42 child of the actor's identity key for the record's protocol and the passport identifier; the publisher's countersignature is made under the publisher's key over the same bytes plus the actor's signature. Version 1 signs the raw concatenation of the fields; version 2 signs a length-framed, domain-tagged preimage, which is what makes a boundary substitution refusable from the bytes alone. A reader derives the verification keys from on-chain data plus the published publisher identity; nothing is looked up.

The operation vocabulary differs by version. Version 1 has `ACTIVATE`, `SOLD`, `RESOLD`, `TRANSFER`, `REPAIRED`, `EDIT` and `RECYCLED`; version 2 has `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE`, and each version 2 operation is read on the attestation rail as the version 1 operation it stands for. Which operation may change which field, state by state, is the transition rule, and it is where most refusals come from: a payload change off an editing operation, an owner change off a transfer, a second genesis, a state after a retirement.

The chain invariants are what a verifier holds a whole history to: the genesis carries no predecessor, every later state spends exactly the previous state's output and names it, one DPP output per transaction, the passport identifier never changes, and under version 2 every non-genesis state proves control of the one it spends by equality, by a named authority, or by a linkage scalar, in that fixed order.

## The attestation rail

A lifecycle claim is a JSON object an issuer signs: the passport it is about, the event type (Origin, Transfer, Transformation or Disposition), the issuer's `did:key`, a timestamp, the payload, and a signature made under the claim's own BRC-42 derivation. Its canonical bytes are a refusing subset of JCS: keys sorted, no whitespace, strings and safe integers only, and anything else refused rather than coerced. The complete signed claim, signature included, is the secured representation, and its SHA-256 is what the anchor commits to.

The anchor is a separate output: a prefix naming the format (`bsv-attestation-anchor-v1`), the digest, the attestation identifier, the issuer, the subject, the attestation type, the representation and media type, the anchoring service's identity key, and the service's signature over the length-framed preimage of the nine fields before it, then exactly five drop opcodes. The output locks to a BRC-42 child of the service key for the attestation identifier, so attribution is checked by derivation. A reader decodes strictly: a shifted boundary, an uncompressed key, a wrong tail or an oversize field is a refusal.

Version 1 of the rail, `uora-anchor-v3`, is historical. It is still decoded under its own document by its own topic and lookup service, and it is never aliased to the current format or admitted through the current topic. `uora-anchor-v2` is refused outright.

## What one rail says about the other

Nothing, by itself. A native state records a token operation; an anchor records that a named service committed to a claim an issuer signed. A transfer of token control does not establish physical movement, a repair operation does not establish that work was done, and an anchored claim does not establish that its content is true or that its issuer had authority. The conditional lifecycle mapping states what evidence turns an operation into an external event and answers `lossless`, `transformed`, `unsupported` or `insufficient-data` with what was lost or missing, and it never manufactures a location, an actor or a predecessor.
