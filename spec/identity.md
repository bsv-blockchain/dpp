# Identity, control and application boundaries

**Status: working draft, pre-1.0.** This document separates product identity, credential identity, signing keys and control authority. Native BSV encodings remain explicit; VSC and physical-object capabilities select additional rules.

## 1. Identified entities and roles

An identifier names an entity. The subject of a passport, the subject of a credential, the issuer asserting an event, the signing verification method, the DID controller, the key custodian and the anchoring/overlay operator are distinct concepts. Implementations MAY combine roles but MUST establish authority for each operation independently.

The standard MUST NOT define an application account as a brand, person, organisation, DID, wallet or controller. One account may administer several identities, several authorised accounts may access one identity, and automated actors may operate without an account. These are application mappings, not mandatory product features. Account administration, fee payment and hosting do not confer DID control or credential authority.

A selected DID method and authority profile define update, rotation, recovery and delegation. Sole control, shared control and custody arrangements MUST be described accurately; none is inferred from an account relationship. A DID document listing several controllers does not by itself establish a threshold-signature rule. Token spending authority follows the native script and [custody rules](custody.md), independently of document control.

## 2. Native BSV keys and derivation

For a compressed secp256k1 key, prepend the unsigned-varint multicodec 0xe7, encode the resulting bytes in base58btc and prepend did:key:z. Only canonical 33-byte SEC1 keys are accepted; decoding and re-encoding MUST round-trip exactly. Native key decoders reject other curves without treating their DIDs as malformed in general.

A native record's actor_identity_key is a BRC-42 parent. The user_signature key is its child for `[1, 'dpp token v1']`, actor_keyID, counterparty anyone. A verifier MUST distinguish the parent identity key from this signing child. Both may be represented as did:key. A matching derivation establishes a key relationship, not an accredited organisational identity or authority to make a physical claim.

Native lifecycle claims use the separate derivation in [rules.md](rules.md). When a resolvable issuer DID is paired with issuerKeyDid, verification of the native signature is insufficient to authenticate the issuer. Resolve the DID and verify the relevant key/authority binding or report it as unresolved.

## 3. VSC actor identity and physical-object identity

The pinned [VSC draft compatibility profile](vsc-profile.md) requires DID-based actor identity and did:web support. Additional methods, including did:bsv where implemented, are separate capabilities. The credential issuer and event actor must agree, and the proof verification method must be authorised for assertion under the issuer's DID document. A did:web document is an identity source, not evidence of accreditation by itself.

UORA's [physical-object addressing rules](https://w3c-cg.github.io/uora/#did-method-for-physical-objects) describe another role: a resolvable DID for the physical object, with verification material, discovery service and physical-binding metadata. That object DID is distinct from the issuer, credential identifier, controller and application account. VSC permits product identifier scheme/value pairs; it does not turn every product identifier into an issuer DID.

An implementation selecting UORA physical-object compatibility MUST assess its object addressing, discovery and physical-binding requirements explicitly. A QR label or a DID document alone does not demonstrate possession or a tamper-evident physical binding. Such a capability MUST remain unclaimed until its selected requirements are implemented and tested. Object identifier aliases require authenticated binding; matching text or an account association is insufficient.

A persistent product/passport identifier is independent of a VSC custody-chain identifier and a SEAL credential id. Starting a new custody chain after a terminal event must not silently replace the product identity. A mapping must identify the custody scope and serial identity it actually represents, retaining links to the enduring product.

## 4. Wallets and privacy

A public reader needs neither an application account nor a signing wallet. An issuer needs the signing capability required by the selected representation. A native BSV writer needs a compatible transaction-signing capability and funding; these may be operated on its behalf under a declared custody arrangement. A VSC Data Integrity signer is not assumed to use the native BRC wallet or curve.

The standard does not require every account holder to manage a wallet or DID. Managed signing is an implementation choice, as are independently controlled signing and supported recovery arrangements. Custody claims must describe who can actually sign, recover and change keys.

Native owner keys may be derived per passport under counterparty self as [record-model.md](record-model.md) specifies. This limits direct key correlation, but publishing an actor root or a linkage proof may reveal relationships. Anchor and credential identifiers may also be correlatable. Key pseudonymity does not establish anonymity.
