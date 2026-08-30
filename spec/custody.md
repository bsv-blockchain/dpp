# Custody: where the keys may live

**Status: working draft, pre-1.0.** This document defines what the standard requires of the keys a record involves, and deliberately not where they are kept. It names the four keys a state touches and the role of each, states the one constraint the standard imposes on itself so that a person's own wallet can fill every role, pins the single convention self-custody needs in order to interoperate, and defines one optional invariant a profile may select when the lock is held by someone other than the owner. The arrangements a deployment may choose among, and what each costs, are described here as information, because a verifier cannot tell them apart and the standard prefers none of them.

## 1. Four keys, four roles

Every passport state involves four keys, and they answer four different questions.

| Key | Where it appears | What it controls | Who may hold it |
|---|---|---|---|
| The locking key | The first push of the output script ([`record-model.md`](record-model.md) §2) | Who may extend the chain: spending the tip is the only way to add a state | Anyone; custody-neutral, §3 |
| The actor key | Fields 7 and 8, verifying field 13 | Who asserts this state and is accountable for it | Whoever acts: a maker, a repairer, an owner |
| The owner key | Field 6 | Who the passport belongs to, and the root its owner tier is encrypted under ([`record-model.md`](record-model.md) §7) | The owner, or a custodian acting for them |
| The publisher key | Verifying field 14 | Which service admitted the state; admission policy, never truth | The publishing service, which may be the actor's own wallet |

A verifier cannot tell where any of the four lives and must not care: a state made with every key in one operator's treasury and a state made with every key in a person's own wallet are indistinguishable on chain, and both verify under the same rules. That indistinguishability is the flexibility this standard offers a deployment, and everything below is written to keep it.

**The constraint the standard imposes on itself.** No rule in this standard may require anything a BRC-100 wallet cannot do with one derivation from its root key and no export of a private key. The operations the four roles need are exactly the ones such a wallet exposes: `getPublicKey` for the identity key and for a derived key, `createSignature` for both record signatures and for the attestation signature, `encrypt` and `decrypt` for the owner tier, `revealSpecificKeyLinkage` for the proof §4 defines, and `createAction` with `signAction` for spending a tip through the PushDrop unlock. The constraint is the test that tells a flexible rule from a secretly custodial one: a key hierarchy deeper than one level can only be produced by software holding raw private keys, so any rule that needed one would make self-custody impossible while appearing neutral. A deployment that holds keys for its users is free to do so; a rule that could only be satisfied that way is a defect in this standard.

## 2. The owner key

Field 6 SHOULD be the BRC-42 child of the owner's identity key, which is the root key of the owner's wallet, for the BRC-43 protocol identifier `[1, 'dpp owner v1']`, key identifier `passport_id`, counterparty `self`, as [`record-model.md`](record-model.md) §3 states. The invoice number is `1-dpp owner v1-<passport_id>`, and a wallet produces the key with `getPublicKey` under that protocol, key identifier and counterparty, one derivation from its root.

What the derivation buys is unlinkable holdings. With counterparty `self` the shared secret behind the derivation is one only the owner's root can form, so no third party can compute the child from the identity key, and none can confirm a guess: a stranger reading a thousand passports sees a thousand unrelated keys, and so does a business that knows the owner's identity key. What it costs is stated as plainly. An owner who acts, signing a `TRANSFER` out of their hands for instance, puts their identity key in field 7, because the signing derivation of the record model's §5 is one level from the root and the root is what field 7 names; the owner's actions are therefore correlatable with one another even while their holdings are not. An owner who wants their actions uncorrelated too needs more than one root, which is a wallet's feature and not this standard's rule.

## 3. Where the lock sits

The locking key is custody-neutral, and the record model says so: whoever can spend the tip can extend the chain, and the standard does not care who that is. One convention is pinned all the same, because without it self-custody cannot interoperate. When the locking key is the owner's, it is the field-6 key itself, and spending the tip is the PushDrop unlock for `[1, 'dpp owner v1']`, key identifier `passport_id`, counterparty `self`, from the owner's wallet. A `TRANSFER` under this convention locks the new state to the new field 6, which the recipient supplies together with their owner key and nothing else; a wallet that receives a passport therefore knows which key spends it, and a wallet that hands one over knows which key to lock it to, however differently the two were built. The convention exists for that handshake, and a treasury that only ever talks to itself needs none, which is why the convention is pinned without being preferred.

Under the convention the spend is the owner's consent. Nobody but the owner's wallet can produce a valid spend of a tip locked to the owner key, so a `TRANSFER` out of their hands is impossible without them, and the network enforces it in the script rather than any reader in a rule. Every other placement of the lock is permitted and verifies identically, and under every other placement the spend proves nothing about the owner; §4 is how consent is proven then.

## 4. The owner-signed transfer

This section defines an optional chain invariant. A profile MAY select it; a verifier or index configured for such a profile enforces it; nothing changes for deployments whose profile does not. It exists because a lock held by anyone other than the owner cannot enforce the owner's consent, and a standard that lets a treasury hold the lock owes the owner a way for a stranger to check that the owner agreed.

**The predicate.** On a `TRANSFER`, the actor is the previous owner when either of two things holds. Equality: field 7 of the state equals field 6 of the previous state, so the owner is acting under the very key that names them. Linkage: `event_data` is a JSON object carrying the property `owner_linkage`, whose value is exactly 64 lower-case hexadecimal characters, a 32-byte scalar `s`, such that field 6 of the previous state equals field 7 of the state plus `s` times the generator point of secp256k1. That scalar is the BRC-69 specific key linkage of §2's derivation: BRC-42 derives a child as the parent plus the generator multiplied by an HMAC, `s` is that HMAC for the owner protocol, key identifier `passport_id` and counterparty `self`, and only the holder of the root can compute it, because the HMAC is keyed by a shared secret only the root forms. Revealing `s` therefore proves that the actor's root derived that owner key for that passport, and proves nothing about any other passport, whose scalar is a different HMAC output. A verifier checks it with one point addition and one comparison. The scalar is interpreted as a big-endian integer modulo the order of the curve, which is how BRC-42 derivation itself treats the HMAC.

**Evaluation order.** A conforming reader evaluates the predicate in a fixed order, so that two readers cannot differ on one state: equality first, then the transfer authorities below, then linkage. `owner_linkage` is read only when the first two do not settle the state. When it is read it must be present and exactly 64 lower-case hexadecimal characters; a `TRANSFER` that reaches the linkage step with the property absent, with `event_data` that is not a JSON object, or with a value of any other spelling is refused, because one value has one spelling in this standard and a scalar that admitted two would be two dialects. On every operation other than `TRANSFER` the property has no meaning and a reader does not read it.

**Transfer authorities.** A profile that selects the invariant names its transfer authorities, identity keys whose `TRANSFER` passes without the predicate, or names none. This is how a deployment that holds the lock can move ownership when an owner cannot: a lost wallet, a court order, a warranty replacement. A transfer by an authority SHOULD be attested on the anchor rail as a `Transfer` ([`rules.md`](rules.md) §2), so that the reason exists somewhere a stranger can find it, and the record shows that an authority acted without hiding that the owner did not.

**Where the scalar comes from.** A BRC-100 wallet reveals it with `revealSpecificKeyLinkage` for the owner protocol, key identifier `passport_id` and its own identity key as counterparty, encrypted to a verifier the caller names; the writing application decrypts it and carries it in `event_data` in the clear, because here the verifier is every stranger who reads the chain. The operation is one level from the root and exports nothing, so the constraint of §1 holds.

**Two costs, stated beside the rule.** The scalar is also the difference between the derived private key and the root private key. Under the convention of §3 the derived key spends satoshis, and a wallet that ever exported that private key would, together with the public scalar, hand its root to anyone who had read the chain; the one-level, no-export constraint of §1 is therefore a security requirement of this design and not a convenience. And revealing the linkage links that one passport to the root permanently: a passport transferred out of an owner's hands becomes correlatable with the owner's later actions, while the passports they still hold stay unlinkable, exactly as §2 describes.

## 5. Three arrangements

This section is informative. It describes the ways a deployment may distribute the four keys, as peers, with what each buys and what each costs, so that a business chooses with the consequences in front of it. The standard prefers none of them, and a verifier cannot tell which produced a record.

**Possession.** The owner's wallet holds the owner key and, under §3, the lock; the owner signs as actor when they act; a publisher countersigns, which may be a service or the owner's own wallet. Consent is the spend. An operator that is compromised can forge nothing about the owner. A lost wallet freezes the passport at its tip, permanently: no repair, no transfer and no `RECYCLED` can be recorded, because the single-key script has no second path. The owner's wallet funds its own transactions unless a publisher co-funds them, which is a fee arrangement and a build's choice ([`record-model.md`](record-model.md) §9).

**Split custody.** The owner's wallet holds the owner key and signs as actor; an operator holds the lock and the publisher key. The owner cannot write without the operator, and the operator cannot forge the owner's assertion, because the user signature verifies against the owner's key. Consent comes from §4 when the profile selects it, and from nowhere when it does not. A lost owner wallet loses the owner's authority and owner tier, never the chain: the operator moves ownership as a transfer authority. An operator compromise can move ownership too, visibly, which is what the attestation of §4 is for.

**Operator custody.** An operator holds all four keys, generating and storing owner and actor keys on its users' behalf. Nothing about the owner is verifiable by a stranger beyond what the operator asserts, and an operator compromise forges everything, consent included. The owner tier's encryption protects against third parties, not against the operator. Recovery is account recovery. The user experience is that of any hosted account, and no wallet is required of anyone.

| | Possession | Split custody | Operator custody |
|---|---|---|---|
| Lock | Owner's wallet, the field-6 key | Operator | Operator |
| Actor key when the owner acts | Owner's wallet | Owner's wallet | Operator, for the owner |
| Owner key | Owner's wallet | Owner's wallet | Operator, for the owner |
| Publisher key | A service, or the owner | Operator | Operator |
| Consent to a `TRANSFER` | The spend, enforced by the network | §4, when the profile selects it | Nothing a stranger can check |
| A compromised operator can | Forge nothing about the owner | Move ownership as an authority, visibly | Forge everything |
| A lost owner wallet | Freezes the passport at its tip | Loses authority and owner tier; the chain continues | Is an account recovery |
| The owner needs | A BRC-100 wallet with funds, or a co-funding publisher | A BRC-100 wallet | An account |

## 6. Recovery

Two facts follow from the design and are stated so that no deployment discovers them late. A lost locking key freezes the chain at its tip forever, because the output script is one key with one path. A lost owner key, when the lock is held elsewhere, loses the owner's authority and their owner tier, and the chain continues.

Recovery of ownership is therefore a `TRANSFER` by a transfer authority (§4), attested on the anchor rail; which parties are authorities, and what evidence they require before acting, is the profile's and the business's to decide, and the standard provides the mechanism without prescribing the policy. Recovery of a key is the wallet's business: how a BRC-100 wallet backs up and restores its root is decided by the wallet, and nothing in this standard depends on how.

The owner tier follows the owner key. On a `TRANSFER` the giver encrypts the tier to the recipient, with the recipient's identity key as counterparty, as [`record-model.md`](record-model.md) §7 allows, and the recipient may re-encrypt to `self` afterwards; a lost owner key therefore loses the tier unless its plaintext is held elsewhere, and whether anyone holds an escrowed copy is a profile matter.

## 7. Identity

This section is informative; [`identity.md`](identity.md) is normative. Businesses that act as issuers, publishers or repairers have a stable published identity key, rotate it through a resolvable DID's key history, and bind the legal entity to it with a credential; their custody is ordinary enterprise key management, and the standard asks nothing of it beyond the BRC-100 surface. For an owner the wallet root is the identity, and the chain shows a pseudonymous per-passport key derived from it (§2). Identity attaches to a passport off chain and only when the owner chooses: by signing a challenge with `createSignature` under the identity key, or by revealing the specific key linkage of one passport to the party asking, under BRC-69 and encrypted to that party alone. Identity is never authority. A credential says who a key belongs to; only the chain says what the key did.

## 8. Normative and implementation

What a conforming implementation reproduces: the predicate of §4, in its evaluation order and with its refusals, whenever it claims to enforce the owner-signed transfer; the derivation of §2 whenever it claims to follow the SHOULD for field 6; the convention of §3 whenever it locks a state to the owner. What is a build's own choice: where each wallet runs, how a wallet backs up its root, who funds a transaction, and which of the arrangements in §5 a deployment offers its users. Which arrangement produced a record is not a question a verifier can answer, and this document keeps it that way.
