# Identity: keys as DIDs, and the derivation between them

**Status: working draft, pre-1.0.** This document defines how the keys the record model already carries are represented as decentralised identifiers, and the one derivation step a verifier needs to move between a party's name and the key that signs for it. It adds nothing to the record layout: every byte involved is already on chain, and every key here is re-derivable from published data.

## 1. The `did:key` encoding

A compressed secp256k1 public key is represented as a `did:key` by prefixing the 33 key bytes with the multicodec identifier for that key type (the unsigned varint `0xe7`, two bytes once encoded), encoding the result in base58btc, and prefixing the multibase marker `z`. A secp256k1 `did:key` therefore always begins `did:key:zQ3s`.

The encoding is pure, offline and bidirectional: no registry, no network call, and the DID document is computable from the string alone. That property is the reason this representation is used wherever a reader may hold nothing but a transaction.

The ecosystem implements this encoding as `@bsv/did`, and its output is byte-identical to the rule above: the same multicodec prefix, the same base58btc marker. It does not apply the first refusal rule below. It normalises a key by decoding and re-encoding it, and the decoder it uses reduces an out-of-range coordinate rather than refusing it, so a non-canonical input becomes the DID of a different key without an error. A conforming implementation built on that library adds the round-trip check itself, before encoding and after decoding. The encoding is small enough to reproduce where the dependency is unwanted, and the reference implementation does so.

Two refusal rules make the mapping exact:

- **Canonical keys only.** A key must round-trip through its canonical SEC1 compressed encoding. Accepting a non-canonical encoding would produce a DID that resolves to a key nobody else computes, because common libraries reduce out-of-range values instead of refusing them.
- **This curve only.** A `did:key` carrying any other multicodec prefix is a well-formed DID and a meaningless secp256k1 key; a decoder refuses it rather than returning bytes that fail later.

## 2. Two keys per actor, and the step between

The record's `actor_identity_key` (field 7 of the record model) is a BRC-42 **parent** key: the actor's stable name. The key that actually signs `user_signature` is that parent's **child** at the protocol identifier `[1, 'dpp token v1']`, key identifier `actor_keyID` (field 8), counterparty `anyone`. The invoice number is `1-dpp token v1-<actor_keyID>`, counterparty `anyone` is the public key of the secp256k1 private key `1`, and the construction is the one [`record-model.md`](record-model.md) §5 spells out.

Each of those keys has a `did:key`, so every actor has two, and they answer different questions:

- **The parent's DID names the actor.** A credential issued about the party behind a record names this one.
- **The child's DID names the signature.** The key a state's `user_signature` actually verifies against is this one.

A verifier moving between them needs exactly one step, in one direction: derive the child from the parent under the protocol, key identifier and counterparty above. Counterparty `anyone` is what makes the step public: it needs no wallet and no secret. The reverse direction is not a derivation at all: to find which actor signed a state, read fields 7 and 8 and derive the child; if it matches the signing key, the actor named in field 7 is the signer.

A verifier holding a credential whose issuer is the parent's DID, and a chain state signed by the child, proves they are the same party by performing this derivation. Handing such a verifier only the parent leaves them unable to verify a signature; handing them only the child leaves them unable to find the actor. Conforming tooling must therefore expose both, and the derivation between them.

A credential about the actor, in this ecosystem, is one of two things, and the step serves both. A BRC-52 identity certificate names its subject as the compressed identity key, is signed by a certifier, and carries an outpoint whose spend revokes it; the identity overlay and its stack client resolve it. An SD-JWT verifiable credential, as `@bsv/did` issues it, names its issuer and binds its holder as a `did:key` of the same kind of key. Either way the credential names the parent, and this section's single step reaches the child that signed.

## 3. Where each name is used

The offline-decodable `did:key` is used wherever the reader may hold a single transaction and nothing else: the anchor output's issuer field, and any context where verification must not require a network. A resolvable DID method may name the same party where its properties are wanted, a key history above all, which a `did:key` structurally cannot carry; when it does, the two-names rule of [`rules.md`](rules.md) applies, and the offline-decodable name travels beside the resolvable one so neither reader is stranded.

Which resolvable method is a deployment's choice, and the reference implementation has exercised two, each for a property `did:key` structurally lacks. `did:bsv` keeps a versioned document on chain and is answered by a universal resolver, which gives a key history that survives rotation. `did:web` is a document a deployment serves itself, listing the keys it has held and when, and is also what the UN Transparency Protocol's implementer register asks a vendor to publish. One thing in the ecosystem is easily mistaken for a third: the stack's DID overlay topic and its client mint, find and revoke DID tokens by serial number. That is a registry of tokens, not a DID method a resolver answers, and the name is the whole of the resemblance.
