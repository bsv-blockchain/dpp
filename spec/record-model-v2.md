# The record model, version 2

**DPP Token Standard, record version 2. Status: working draft, pre-1.0.** This document defines the second version of the on-chain record: a seventeen-field layout that keeps everything version 1 established and adds what the first year of running version 1 showed a passport needs on the wire rather than in a policy. It is read beside [`record-model.md`](record-model.md), which remains the definition of version 1 and of every rule this document says it inherits; where this document is silent, version 1's rule applies to a version 2 state unchanged. Until version 1.0 is declared, the reference implementation in this repository is the tiebreaker where this text is ambiguous.

## 1. Overview

Version 2 changes five things and nothing else. The signature preimages are length-framed and domain-tagged, so the bytes a signature covers bind their own field boundaries and neither signature can stand in for the other. Every state names the outpoint it spends and the outpoint its lineage began at, so a state carries its own place in its lineage and a reader checks that place against the transaction rather than inferring it. Every state after the genesis proves control of the state it spends, on every operation and not only on a transfer, by one of three means evaluated in a fixed order. A lineage can be retired, after which nothing follows it. And a state can commit to an off-chain authorisation record, the SHA-256 of a document a profile defines, so that a transfer made by a custodian on someone's behalf points at the evidence under which it was made.

The operations are reduced to four, `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE`, because the seven names of version 1 were lifecycle vocabulary carried in the record, and the record's job is to fix what an operation may change, not what it means; [`rules.md`](rules.md) §2 carries the lifecycle meaning under both vocabularies. A version 1 lineage continues under version 2 through one transition, an `UPDATE` that keeps the controller key (§6), and no version 1 state ever follows a version 2 state. Version 1 states are read as version 1 forever: this document revives nothing, refuses nothing that version 1 accepted, and changes no byte of any existing record.

The property [`record-model.md`](record-model.md) §1 states is unchanged: native signatures, supplied-history linkage and transaction inclusion are verified from transaction bytes and public block-header evidence without an application account, and they do not establish current ownership, physical truth, issuer accreditation, complete history or credential validity.

## 2. The output script

A version 2 passport state is a single output whose locking script is:

```
<33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 17> OP_2DROP x8 OP_DROP
```

The shape is the BRC-48 PushDrop output of version 1 with seventeen fields instead of fourteen: one `OP_2DROP` for each pair of fields, eight for sixteen, and one `OP_DROP` for the seventeenth. A reader selects the version by the field count it finds between `OP_CHECKSIG` and the first drop opcode. Fourteen fields are read under [`record-model.md`](record-model.md); seventeen are read under this document; any other count is refused. The version field is then checked against the layout: a fourteen-field output carrying the version string `2`, or a seventeen-field output carrying `1`, is refused as a whole, because one version has one layout and a layout that admitted two versions would be two dialects. A version string a reader does not know is refused with the layout, and a transaction carrying it holds no DPP output to that reader.

Every reading rule of [`record-model.md`](record-model.md) §2 applies unchanged: the fields are minimal pushes when written, `OP_0` is the empty field and its only encoding, the single byte `0x00` is refused however it is pushed, non-minimal pushes of non-empty fields are accepted, a UTF-8 field must decode and re-encode to itself, the drop tail is checked exactly with nothing after it, the locking key is a canonical compressed key, and exactly one DPP output is permitted per transaction. A general-purpose PushDrop decoder is a discovery tool for this layout and not a conforming reader, for the reasons that section gives.

The locking key is custody-neutral, as in version 1. The convention of [`custody.md`](custody.md) §3 applies with field 6 read as the controller key: when the lock is the controller's own, it is the field-6 key itself.

## 3. The seventeen fields

| # | Field | Encoding | Rule |
|---|---|---|---|
| 1 | `protocol_marker` | UTF-8 | The string `dpp`. |
| 2 | `version` | UTF-8 | The string `2`. A seventeen-field output carrying any other value is refused. |
| 3 | `passport_id` | UTF-8 | As version 1 field 3: non-empty, at most 512 bytes, immutable across the chain, the key identifier of the publisher signature, and subject to the GS1 allocation rule of [`record-model.md`](record-model.md) §3 when it is a GS1 Digital Link. |
| 4 | `op` | UTF-8 | One of the four operations in §4. |
| 5 | `timestamp` | UTF-8 | As version 1 field 5: ISO 8601 extended format with an explicit timezone, naming a real calendar instant. |
| 6 | `controller_key` | 33 raw bytes | The compressed public key that currently controls the passport, in canonical SEC1 encoding. Version 1 called this field `owner_identity_key`; the rename says what the field proves, which is control, and not what a profile may let it mean. It SHOULD be the BRC-42 child of the controlling party's identity key for the protocol identifier `[1, 'dpp owner v1']`, key identifier `passport_id`, counterparty `self`, exactly as [`custody.md`](custody.md) §2 describes, so that a lineage upgraded from version 1 keeps its key and its linkage scalar. |
| 7 | `actor_identity_key` | 33 raw bytes | As version 1 field 7: the BRC-42 parent key of the party making this state; the key that verifies field 16 is derived from it (§5). |
| 8 | `actor_keyID` | UTF-8 | As version 1 field 8: non-empty, at most 256 bytes, the key identifier of the actor signature. |
| 9 | `event_data` | UTF-8 | Valid JSON or empty, at most 4096 bytes, on every operation. The version 1 rule that it must be empty on the genesis and on an edit is not carried over: which properties an operation's event data carries is a profile's rule, and a bound is what the record needs. `owner_linkage` has no meaning here; control is proven in field 14. |
| 10 | `payload_public` | UTF-8 | Valid JSON, non-empty on every state, at most 65535 bytes. The bound is new; a version 1 state has none, and none is imposed on one. |
| 11 | `payload_owner_hash` | 32 raw bytes | As version 1 field 11: SHA-256 of the off-chain encrypted owner-tier blob, or empty when there is none (§7). |
| 12 | `lineage_genesis` | 36 raw bytes | Empty at genesis, required afterwards: the outpoint of the lineage's genesis state, as the 32-byte txid in big-endian display order followed by the output index as a big-endian unsigned 32-bit integer. Any other length is refused at decode. |
| 13 | `previous_outpoint` | 36 raw bytes | Empty at genesis, required afterwards: the outpoint of the state this one spends, in the same encoding. Version 1 carried the txid alone and left the index to the input; version 2 names both, so the field and the input are checked against each other (§6). |
| 14 | `control_linkage` | 32 raw bytes | Empty, or the 32-byte scalar that links field 7 to the previous state's field 6 (§6). Must be empty on `ISSUE`, refused at decode otherwise; on every other operation its presence is governed by the control proof's evaluation order, checked at verification. |
| 15 | `authorisation_commitment` | 32 raw bytes | Empty, or the SHA-256 of an authorisation record under which the actor acted (§8). Which operations must carry one is a profile's rule; the record model accepts it on any. |
| 16 | `actor_signature` | DER ECDSA | Required. The actor's signature over the framed preimage of fields 1 to 15 (§5). |
| 17 | `publisher_signature` | DER ECDSA | Required. The publishing service's signature over the framed preimage of fields 1 to 16 (§5). |

A reader validates the rules in this table at decode time and refuses the output as a whole on any violation, with the same two exceptions as version 1: the rules that span more than one state (the genesis emptiness of fields 12 and 13 beyond their length, the control proof of field 14 beyond its emptiness on `ISSUE`, the requirement of field 15 under a profile) are chain rules checked at verification, and the signature fields are checked for presence at decode and for validity at verification.

## 4. Operations

Four operations: `ISSUE`, `UPDATE`, `TRANSFER`, `RETIRE`.

- `ISSUE` is the genesis operation and is allowed at genesis only. Its `previous_outpoint`, `lineage_genesis` and `control_linkage` are empty.
- `UPDATE` changes `payload_public`, `payload_owner_hash` and `event_data` as the actor sees fit, and changes nothing else. It is also the one transition by which a version 1 lineage becomes a version 2 lineage (§6).
- `TRANSFER` is the only operation on which `controller_key` may change. It may change the payload too, as a version 1 `TRANSFER` may, because a change of control often comes with a re-encrypted owner tier.
- `RETIRE` ends the lineage. `payload_public` and `payload_owner_hash` are byte-identical to the previous state; `event_data` carries the reason, if the profile asks for one; no state of any version may spend a `RETIRE`.

`event_data` is JSON or empty on every operation. The lifecycle meaning of an operation, what a repair or a sale is, belongs to the profiles and to [`rules.md`](rules.md) §2, which maps the four operations to the same event types the seven version 1 operations map to: `ISSUE` as `Origin`, `TRANSFER` as `Transfer`, `UPDATE` as `Transformation` and `RETIRE` as `Disposition`, under the same evidence conditions. A profile that needs the finer version 1 vocabulary carries it as a property of `event_data`, where a reader that does not know the profile can ignore it and a reader that does can check it.

## 5. The two signatures

Both signatures are ECDSA over SHA-256 of a framed preimage, made with keys derived under BRC-42 with the BRC-43 protocol identifier `[1, 'dpp token v2']` and counterparty `anyone`, and the derivation is otherwise exactly [`record-model.md`](record-model.md) §5: the child of a parent key for the invoice number `1-dpp token v2-<key identifier>`, computable by any third party from on-chain data alone. The protocol identifier is new so that a signature made under version 1 verifies under nothing in version 2 and the reverse, which keeps the two preimage formats from ever being confused for one another.

**Framing.** A preimage is the concatenation, for each item in order, of the item's byte length as a Bitcoin VarInt followed by the item's bytes: the framing the anchor rail has used since [`rules.md`](rules.md) §5. The first item is a domain tag, a fixed UTF-8 string that names which of the two signatures the preimage is for; the remaining items are the fields. Because every item carries its length, two field tuples that share their concatenation have different preimages, and the framing note of version 1, that boundary uniqueness comes from field validation and the chain rules rather than from the signature, does not apply here: a version 2 signature binds its field boundaries by itself. Because the tag comes first and differs between the two, neither signature is a valid signature over the other's preimage, so a publisher's signature placed in the actor's slot, or the reverse, fails at the signature and not only at the derivation.

**The actor signature (field 16).** Preimage: the tag `dpp-record-v2/actor-signature`, then fields 1 to 15, each framed. Verification key: the BRC-42 child of `actor_identity_key` (field 7) for key identifier `actor_keyID` (field 8), counterparty `anyone`.

**The publisher signature (field 17).** Preimage: the tag `dpp-record-v2/publisher-signature`, then fields 1 to 15, then `actor_signature` (field 16), each framed. Verification key: the BRC-42 child of the publishing service's published identity key for key identifier `passport_id` (field 3), counterparty `anyone`. As in version 1 the publisher signature is admission policy and not token validity: it says which service published the state, and a verifier that does not care may skip it.

Making either signature is the BRC-100 `createSignature` operation with `data` set to the framed preimage, the protocol identifier above, the key identifier named for that signature and counterparty `anyone`, so the custody constraint of [`custody.md`](custody.md) §1 holds: one derivation from a root key, no key exported. Spending a state is a plain signature against the locking key, as before.

## 6. Chain invariants

A version 2 lineage is the ordered sequence of states from genesis to tip, and it may begin under version 1. A conforming verifier checks, for every version 2 state:

1. Exactly one DPP output in the transaction.
2. At genesis: the operation is `ISSUE`, and `previous_outpoint`, `lineage_genesis` and `control_linkage` are empty. A genesis spends no passport state: an `ISSUE` that spends the output of an admitted state is refused, whatever its fields say, because it would end the lineage it spends without a `RETIRE` and without naming it.
3. After genesis: the operation is not `ISSUE`; the previous state is not a `RETIRE` of version 2; and if the previous state is version 1, this state is an `UPDATE` (the upgrade, below).
4. `previous_outpoint` is non-empty and names the spent tip: its txid equals the previous transaction's txid, its index equals the index of the previous state's DPP output, and the transaction spends that output, checked structurally on its inputs. All three, not any.
5. `lineage_genesis` is non-empty and equals the outpoint of the lineage's genesis state, the first state of the supplied history. A verifier that cannot see the genesis cannot check this and reports the link as not established, never as held.
6. `passport_id` never changes.
7. `controller_key` changes only on `TRANSFER`, and does not change on the upgrade.
8. `payload_public` and `payload_owner_hash` do not change on `RETIRE`.
9. Control of the previous state is proven, by the predicate below.

**The control proof.** On every `UPDATE`, `TRANSFER` and `RETIRE`, the actor proves control of the state it spends in one of three ways, evaluated in this order and no other. Equality: field 7 of the state equals field 6 of the previous state, so the controller is acting under the very key that names them, and `control_linkage` must be empty. Authority: field 7 is one of the control authorities the verifier's policy names, and `control_linkage` must be empty. Linkage: `control_linkage` is a 32-byte scalar `s` such that field 6 of the previous state equals field 7 of the state plus `s` times the generator of secp256k1, the scalar being the BRC-69 specific key linkage of the derivation in §3, exactly as [`custody.md`](custody.md) §4 defines it for version 1 transfers, interpreted as a big-endian integer modulo the curve order. A state that reaches the linkage step with the field empty is refused as control not proven; a state that carries a scalar when equality or authority already settled it is refused as carrying a redundant linkage, because one state has one proof; a scalar that does not link is refused. The order is fixed so that two readers cannot differ on one state, and it is the order of version 1's owner-signed transfer with one difference: version 1 ran it on `TRANSFER` under a profile's selection, and version 2 runs it on every non-genesis operation for every reader.

**Control authorities.** A verifier's policy MAY name control authorities, identity keys whose non-genesis states pass the proof without equality or linkage. This is how a custodian that holds the lock moves control when a controller cannot: a lost key, a court order, a warranty replacement. It is the same list as version 1's transfer authorities, applied to every operation rather than to transfers alone, and a state made by an authority SHOULD be attested on the anchor rail so that the reason exists where a stranger can find it. A verifier that names no authorities accepts only equality and linkage, which is the record model's baseline.

**Retirement.** A `RETIRE` is terminal. A state of any version that spends a version 2 `RETIRE` fails the link, however well it satisfies everything else, and an index refuses to admit it while keeping the retired tip in place. A retired tip is a valid tip: an observation that reports it unspent reports the lineage as ended, not as stale.

**The upgrade.** A version 2 state may spend a version 1 tip, and exactly one shape does so: an `UPDATE` whose `controller_key` equals the version 1 state's `owner_identity_key`, whose `previous_outpoint` names the version 1 tip, whose `lineage_genesis` names the version 1 genesis, and whose control proof is evaluated against that owner key like any other. From that state on the lineage is version 2, and the version 1 invariants stop applying to new states while every version 1 state in the history is still verified under [`record-model.md`](record-model.md) §6 and signed under its own preimage. A version 1 state that spends a version 2 state fails the link, and a `TRANSFER` or `RETIRE` that spends a version 1 tip fails it too: the upgrade keeps the key so that a reader can check it without knowing the custody arrangement, and the first transfer under version 2 then carries its proof and, under a profile, its commitment. A lineage never downgrades.

**Forks and rival geneses.** Two valid successors of one state are a fork, and which continuation is recognised is decided by accepted-chain spending evidence, never by a reader. Two valid geneses under one `passport_id` are rival records, as in version 1, and are two candidates until an authority policy resolves them. A verifier keeps the two situations apart in its report, because a fork is a question about one lineage and a rival genesis is a question about which lineage is meant ([`verification.md`](verification.md) §3, §5).

The tip is the one output not yet spent, and spending the tip is the only way to extend the record, as in version 1, with the one addition that a retired tip can be spent by nothing the record recognises.

## 7. The owner tier and the controller key

The owner-tier binding of [`record-model.md`](record-model.md) §7 applies unchanged: restricted content lives off chain encrypted, field 11 commits to its ciphertext, a blob is hashed before it is decrypted, and a blob against an empty commitment is a refusal. The recommended hosting and encryption are the same, with the controller key's root as the key the tier is encrypted under: on a `TRANSFER` the giver encrypts the tier to the party that will control the passport, and that party may re-encrypt to `self`.

The controller key SHOULD be derived exactly as version 1's owner key ([`custody.md`](custody.md) §2), under the same protocol identifier, so that the upgrade of §6 carries the key across unchanged and the linkage scalar a wallet reveals for a version 1 transfer is the scalar it reveals for a version 2 control proof. What the key means beyond control, ownership, custody on someone's behalf, or an operator's own treasury, is a profile's statement and not the record's: [`custody.md`](custody.md) §5 describes the arrangements for version 1 and [`managed-custody.md`](managed-custody.md) defines the one that version 2's commitment field exists for.

## 8. Authorisation commitments

Field 15, when present, is the SHA-256 of an authorisation record: a document, defined by a profile, that says under what authority the actor made this state. The record model fixes only that the field is a commitment, that its bytes are the SHA-256 of the record's complete secured bytes as the profile defines them, and that a verifier which cannot obtain the record reports the referenced artefact as unavailable and not the state as invalid. Which operations must carry a commitment, what the record contains, who signs it and what it proves are the profile's, and [`managed-custody.md`](managed-custody.md) defines the first such profile: a custodian-signed acceptance record that a `TRANSFER` made on a recipient's behalf commits to. The distinction the field keeps is between control and authorisation. The control proof of §6 says the actor could make the state; the commitment says under what authority they did, and a stranger reading the chain sees that an authority was claimed and where its evidence is, without the record model deciding whether the claim is good.

## 9. What a verifier checks

"Verified" means the three checks of [`record-model.md`](record-model.md) §8, signatures, linkage and inclusion, with the version 2 preimages and invariants substituted for a version 2 state, and the optional fourth check, the publisher signature against a configured key, as before. A verifier reading a mixed history applies each state's own version: version 1 preimages and invariants to version 1 states, version 2 to version 2, and the upgrade rule at the boundary. Inclusion is unchanged, with its three outcomes and its rule that an unreachable header source is evidence of nothing.

Under the one verification contract of [`verification.md`](verification.md), a version 2 finding is reported in the same sixteen checks with four new shared reason codes on `linkage`: `lineage-retired` for a state that spends a `RETIRE`, `control-not-proven` for a failed control proof, `version-transition-invalid` for a state that follows its predecessor under the wrong version rule, and `acceptance-commitment-absent` for a `TRANSFER` that a profile requires a commitment on and that carries none. The per-state detail of the token checks carries each state's version and whether its control was proven. [`../fixtures/evidence-v2.json`](../fixtures/evidence-v2.json) pins the report for the version 2 cases, [`../fixtures/record-v2.json`](../fixtures/record-v2.json) pins one output with its framed preimages and refusals, and [`../fixtures/chain-v2.json`](../fixtures/chain-v2.json) pins a five-state lineage with its refusals and the upgrade over the version 1 chain fixture.

## 10. Normative and implementation

What any conforming implementation must reproduce: the seventeen-field layout and its selection by field count, the field rules and bounds of §3, the four operations and what each may change, the framed and tagged preimages and the version 2 derivation of §5, the nine invariants and the control proof in its evaluation order, the terminal `RETIRE`, the single upgrade transition and the refusal of every other version transition, the commitment semantics of §8, and verification from transaction bytes and public block headers with nothing else. What is a build's own, as in version 1: basket names, satoshi values, fees, broadcast and index arrangements within the duties [`writing.md`](writing.md) sets, and which profile's authorisation record a commitment names. Where the keys are kept is invisible here, and [`custody.md`](custody.md) and [`managed-custody.md`](managed-custody.md) say what the standard requires of them.
