# Managed custody: acceptance a stranger can check

**Profile `managed-custody@1`. Status: working draft, pre-1.0.** This document defines the first custody profile of record version 2: the arrangement in which a custodian holds a passport's locking and controller keys on behalf of the parties, a recipient needs no wallet, identifier scheme or funds to receive a passport, and every transfer still carries, on chain, a commitment to evidence that the recipient accepted it. It selects options that [`record-model-v2.md`](record-model-v2.md) leaves to a profile, the authorisation commitment of its §8 and the control authorities of its §6, and defines the acceptance record the commitment names. It replaces nothing: the owner-signed transfer of [`custody.md`](custody.md) §4 remains the profile for version 1 lineages, possession remains the arrangement in which the recipient's own wallet holds the keys, and a deployment declares which it runs.

## 1. Why a managed profile

Version 1's custody model offers three arrangements and lets a stranger check consent in one of them, possession, where the spend is the consent, and in a second, split custody, where the owner's wallet signs. In both the recipient of a transfer already has a BRC-100 wallet, because the new field-6 key is theirs. The consuming application found that most recipients do not: a buyer who scans a label, a repairer who takes delivery, a recycler who is handed a battery. Under operator custody, the third arrangement, nothing about their acceptance is checkable by anyone but the operator.

This profile is the arrangement between. The custodian holds the keys, so the recipient needs nothing; the custodian also writes down, signs and retains what the recipient accepted, and the `TRANSFER` commits to that document in field 15, so a stranger reading the chain sees that an acceptance was claimed, by which custodian, and can ask for the document and check that it is the one the state names. What the stranger learns is exactly that, and this document says so plainly rather than letting a commitment look like a signature: the evidence is custody-dependent. It proves that the custodian who published the state also attested to an acceptance that matches it in every particular. It does not prove that the recipient did anything, because the recipient holds no key. A profile that needs the latter is possession, and this one is written so that a passport can move to it later without a new lineage (§7).

## 2. The parties and their keys

| Party | Key on the wire | What they do |
|---|---|---|
| The holder | `actor_identity_key` of the `TRANSFER`, and the root the previous `controller_key` derives from | Offers the passport. Under this profile the holder's keys may themselves be managed by the custodian, in which case the holder is an identity the custodian keeps for them. |
| The custodian | `custodian` in the acceptance record, and the publisher key that verifies field 17 | Holds the lock and the controller keys, presents the offer's terms to the recipient, records the acceptance, signs the record, retains it, and writes and publishes the `TRANSFER` that commits to it. |
| The recipient | `recipientIdentityKey` in the record, and the root the new `controller_key` derives from | Accepts. Their identity key is either their own or one the custodian generates and keeps for them; the profile does not distinguish, and the record says which kind of evidence it is. |
| A control authority | `actor_identity_key` of a state that passes the control proof by authority | Moves control when the holder cannot; named in the deployment's policy and its capability document, and attested on the anchor rail. |

Four consequences follow. The record signature is the custodian's identity key directly, with no BRC-42 derivation, because the record is not a chain state and the custodian is a service with a published identity ([`identity.md`](identity.md)). The custodian and the publisher are one party in this profile, which is why the profile can promise that a state's commitment and its publisher signature come from the same hand. The `controller_key` is derived exactly as [`record-model-v2.md`](record-model-v2.md) §3 recommends, from the controlling identity's root under `[1, 'dpp owner v1']`, so the custodian proves control on the holder's behalf by linkage, or acts as a named authority, and never by holding a key that is not derived from the identity it acts for. And no application account, brand, claim code or session appears in anything signed or committed: the record names keys and digests, and the custodian's mapping from those to its accounts is the custodian's own.

## 3. The acceptance record

An acceptance record is a JSON object with exactly the following properties, `offer.recipientRef` being the only optional one. Unknown properties are refused.

| Property | Requirement |
|---|---|
| `acceptanceFormat` | The literal `dpp-managed-acceptance@1`. |
| `requestId` | The custodian's identifier for the offer: non-empty printable text, at most 128 bytes, no C0, C1 or DEL controls. |
| `passportId` | The passport's identifier, exactly as field 3 carries it, at most 512 bytes. |
| `lineageGenesis` | `{ txid, outputIndex }`: the lineage's genesis outpoint, txid as 64 lower-case hexadecimal characters, index a non-negative integer. |
| `expectedPredecessor` | `{ txid, outputIndex }`: the tip the offer was made against, which the `TRANSFER` must spend. An acceptance names one tip, so an acceptance made against a tip that has since moved cannot be executed and must be offered again. |
| `termsDigest` | 64 lower-case hexadecimal characters: the SHA-256 of the terms the custodian presented to the recipient, in the exact bytes presented. What the terms say is the custodian's; that they cannot be changed after acceptance is this field's. |
| `offer` | An object: `holderIdentityKey`, the holder's identity key as 66 lower-case hexadecimal characters of a compressed key; `createdAt` and `expiresAt`, ISO 8601 date-times with a timezone; `mechanism`, either `claim-code` or `named-recipient`; and optionally `recipientRef`, which for `claim-code` is the SHA-256 of the code as 64 hexadecimal characters and never the code, and for `named-recipient` is the recipient's identity key. |
| `acceptance` | An object: `recipientIdentityKey`, the accepting identity's key; `destinationKey`, the controller key the passport moves to, which is the new field 6; `acceptedAt`, an ISO 8601 date-time with a timezone; and `evidenceKind`, the literal `custodian-attested`, which is the only kind this version defines and is written into the record so that a later kind cannot be mistaken for it. |
| `custodian` | The custodian's identity key, compressed, lower-case hexadecimal. |
| `signature` | The custodian's signature: canonical DER, lower-case hexadecimal, between 8 and 72 bytes. |

**Canonical form.** The record's canonical bytes are the restricted canonical JSON of [`rules.md`](rules.md) §4 extended to nested objects: property names sorted by code unit at every level, no whitespace, string values and safe integers only, and nothing else. An omitted optional property is absent from the bytes, not present as null.

**The signature.** The custodian signs SHA-256 of the canonical bytes of the record without its `signature` property, with its identity key directly, and the signature is verified against the `custodian` property. The record is not a chain state and carries no derivation.

**The commitment.** The commitment a `TRANSFER` carries in field 15 is the SHA-256 of the canonical bytes of the complete signed record, `signature` included, so the commitment binds who attested as well as what was attested.

**Time order and consistency.** `offer.createdAt` is not after `acceptance.acceptedAt`, which is not after `offer.expiresAt`: an acceptance recorded after expiry is refused, and the custodian that recorded one has written a document its own state cannot commit to. Under `named-recipient`, `recipientRef` when present equals `acceptance.recipientIdentityKey`. A reader that inspects a record reports its structure, its signature and its time order as separate findings, each with the reason it failed: `format`, `time-order`, `signature-invalid`, `custodian-unexpected` when a policy names custodians and this one is not among them, and `state-mismatch` for the binding of §4.

The claim code, where the mechanism is one, is presented to the recipient out of band and never written anywhere signed; its SHA-256 in `recipientRef` lets the custodian show that the code it issued is the code that was redeemed, without the record disclosing a secret that a reader could replay. What the code is, how long it lives and how it reaches the recipient are the custodian's.

## 4. The transfer

A transfer under this profile is three steps, and only the last touches the chain.

1. **Offer.** The holder asks the custodian to offer the passport, naming the recipient by identity key or asking for a claim code, and the terms. The custodian fixes `expectedPredecessor` as the tip at that moment, computes `termsDigest`, sets `expiresAt`, and holds the offer. An offer is idempotent by `requestId`: asking again with the same identifier returns the same offer.
2. **Acceptance.** The recipient, presented with the terms, accepts, redeeming the claim code or answering as the named identity. The custodian derives or receives `destinationKey`, records the acceptance with its time, signs the record and retains it. An offer accepts once: a second acceptance of the same offer is the first, returned again, and never a second record. An offer may be declined, which the custodian records for itself and which produces no chain state; and an offer that expires unaccepted produces none either.
3. **The `TRANSFER`.** The custodian builds the version 2 `TRANSFER` that spends `expectedPredecessor`, moves `controller_key` to `destinationKey`, carries the holder as actor with the control proof of [`record-model-v2.md`](record-model-v2.md) §6, carries the commitment of §3 in field 15, is timestamped no earlier than `acceptedAt`, and publishes it under the writer's duties of [`writing.md`](writing.md). One acceptance executes at most one `TRANSFER`, because the tip it names spends once; a `TRANSFER` that could not be sent is retried under §6 of the writing rules, never rebuilt against a different tip without a new acceptance.

**Binding.** An acceptance record binds to a `TRANSFER` when all of the following hold, and a reader reports each that does not as `state-mismatch` with the reason: the state's operation is `TRANSFER`; the state's `passport_id` equals `passportId`; its `lineage_genesis` equals `lineageGenesis`; its `previous_outpoint` equals `expectedPredecessor`; its `controller_key` equals `acceptance.destinationKey`; its `actor_identity_key` equals `offer.holderIdentityKey`; its `authorisation_commitment` equals the commitment of the record; and `acceptance.acceptedAt` is not after the state's `timestamp`. The binding is checked from the record and the state alone, needs no custodian online, and fails if any one particular differs, which is what makes a record tampered after signing, a record for another destination or a record for another tip each refusable by a stranger.

**Under the profile, a `TRANSFER` without a commitment is refused.** A verifier or index configured for `managed-custody@1` refuses a version 2 `TRANSFER` whose field 15 is empty, reporting `acceptance-commitment-absent` on `linkage`, while the same bytes are valid under the record model alone. `UPDATE` and `RETIRE` need no commitment under this version of the profile, and may carry one.

## 5. Verification

The one verification contract of [`verification.md`](verification.md) reports this profile in three places, and nowhere as a single word.

On `linkage`, a `TRANSFER` under the profile that carries no commitment fails with `acceptance-commitment-absent`, and every other chain rule is reported as [`record-model-v2.md`](record-model-v2.md) §9 says. On `evidenceAvailability`, every `TRANSFER` that carries a commitment references an artefact: when the record is supplied and binds, the reference passes; when it is supplied and does not bind, or is supplied by nobody's `TRANSFER`, the reference fails with `referenced-artefact-mismatch` and the reasons; when it is not supplied, the reference is `unknown` with `referenced-artefact-unavailable`, and the report says which record was missing. On `issuerAuthority`, a policy that requires authority names the custodians whose records it accepts as `acceptanceCustodians`, and a record signed by a custodian the policy does not name fails there under the role `acceptance-custodian`, separately from whether the record binds.

Every report over a lineage that carries a commitment states in its limits that an acceptance commitment binds a transfer to acceptance evidence the custodian retained and signed, that it is custody-dependent evidence, and that it is not a signature made with a key the recipient controls. That sentence is the profile's honesty, and a surface that shows the check MUST keep it beside the finding.

What the profile does not establish, and a reader does not infer from it: that the recipient is who the custodian says, which is an identity question ([`identity.md`](identity.md)); that the terms were fair or lawful; that the physical item moved ([`rules.md`](rules.md) §2); or that no later state exists ([`verification.md`](verification.md) §5).

## 6. Control authorities and recovery

A deployment under this profile names its control authorities: the identity keys whose `UPDATE`, `TRANSFER` or `RETIRE` passes the control proof by authority rather than by equality or linkage. In the ordinary case the custodian needs none, because it acts for the holder by linkage from the holder's own identity, managed or not. An authority exists for the case where no holder can act: a managed identity whose root the custodian has lost, a court order, a warranty replacement, a recipient who accepted and then could not be reached. A state made by authority carries no commitment unless a profile requires one, is visible on the chain as a state whose actor was not the controller, and SHOULD be attested on the anchor rail as [`custody.md`](custody.md) §4 asks of a version 1 recovery.

A recovery does not retire a lineage, does not create a new one, and does not rewrite anything: it is one more state, with its own reason where a stranger can find it.

## 7. What a deployment declares, and where a passport can go

An index or verifier running this profile declares it in its capability document as a profile entry of kind `custody` with identifier `managed-custody@1`, and its options: `acceptanceCommitment` as `required`, and `controlAuthorities` as the keys it names. An index that admits version 2 states without requiring the commitment declares `record-model-baseline@2` in the same place, so that a client can tell the two apart before it offers a transfer. The reference index selects the profile with `ACCEPTANCE_COMMITMENT=required` and names authorities with `CONTROL_AUTHORITIES`; unset, it admits the record model's baseline and says so.

The profile coexists with the others. A version 1 lineage under the owner-signed transfer keeps that profile until it is upgraded, and the upgrade transition of [`record-model-v2.md`](record-model-v2.md) §6 needs no acceptance, because it changes no controller. A passport under this profile can leave it: a `TRANSFER` to a `destinationKey` the recipient's own wallet derived is a valid transfer under this profile, and from then on the recipient proves control from their own root, which is possession. Nothing in the acceptance record prevents that, and nothing in this document defines the user experience of it, which is a later profile's work.

## 8. Normative and implementation

What a conforming implementation reproduces, whenever it claims this profile: the record shape, canonical form, signature and commitment of §3; the binding predicate of §4 and the refusal of an uncommitted `TRANSFER`; the three report places and the limits sentence of §5; and the declaration of §7. What is a build's own: how offers are presented, how claim codes are made and delivered, how long an offer lives, how the custodian stores its records and maps keys to its accounts, and whether it lets a recipient take their keys with them. [`../fixtures/managed-acceptance-v1.json`](../fixtures/managed-acceptance-v1.json) pins one record with its canonical bytes, signature and commitment, the `TRANSFER` that commits to it, and six refusals; [`../fixtures/vectors/dpp/managed-acceptance/v1.json`](../fixtures/vectors/dpp/managed-acceptance/v1.json) is the same in the stack's vector format with the custodian's test key published, so a writer in any language reproduces the signature.
