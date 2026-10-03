# Custody

Custody is who holds the keys a passport uses: the brand, your platform, the passport's holder, or a custodian acting for them. Read this before you decide who holds which key on your platform, because that choice decides who can transfer a passport, what a stranger can check about a transfer, and what is lost with a wallet.

## The four keys

Every passport state involves four keys, each answering a different question ([custody specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md#1-four-keys-four-roles) section 1):

| Key | Where it appears | What it decides |
|---|---|---|
| The lock | The output script of the state | Who can add the next state. Only a spend of the tip, the newest state, extends the passport |
| The actor key | The actor's identity key and signature | Who makes this state and answers for it: a brand, a repairer, an owner |
| The controller key | Field 6, `controller_key` (version 1 calls it the owner key, `owner_identity_key`) | Whom the passport belongs to now. Every later state must prove control of it, and the owner tier is encrypted under the same wallet |
| The publisher key | The countersignature | Which service admitted the state. It says nothing about whether the state is true |

The controller key is usually one derivation from the controlling party's wallet: `ownerKeyFor(passportId, wallet)` in `@bsv/dpp-core` derives it under the protocol `[1, 'dpp owner v1']`, with the passport identifier as key identifier, so one wallet holds a different, unlinkable controller key for each passport. When the actor of a state is not the controller, the state proves control with the control linkage: a public 32-byte value, revealed by the wallet with `revealOwnerLinkage`, that links the actor's identity key to the controller key ([keys](../packages/how-the-writer-works.md#keys) in how the writer example works).

A reader cannot tell where any of the four keys is kept, and does not need to: the same rules verify a state made in a person's own wallet and one made in an operator's systems. The standard binds itself to one rule so that a person's own wallet can always fill every role: nothing in it may require more than a BRC-100 wallet can do with one derivation from its root key and without exporting a private key.

## Choose an arrangement

The custody specification describes three ways to distribute the keys, and record version 2 adds a fourth, the `managed-custody@1` profile. The standard prefers none of them.

| | Possession | Split custody | Operator custody | `managed-custody@1` |
|---|---|---|---|---|
| Who holds the lock | The owner's wallet, as the controller key itself | An operator | An operator | The custodian |
| Who holds the controller key | The owner's wallet | The owner's wallet | The operator, for the owner | The custodian, for the holder |
| What a recipient needs | A BRC-100 wallet, with funds or a publisher that pays | A BRC-100 wallet | An account | Nothing: no wallet, identifier or funds |
| What a stranger can check about a transfer | The owner's spend, which the network enforces | The owner's linkage proof, when the profile asks for it | Nothing beyond the operator's word | That the custodian signed and kept a record of the recipient's acceptance, and that the transfer commits to it |
| A lost owner wallet | Freezes the passport at its tip, for good | Loses the owner's authority and owner tier; the operator moves ownership as a named authority | Is an account recovery | The custodian holds the keys; if it loses a managed identity's root, a named control authority moves control |

Under possession a compromised operator can forge nothing about the owner; under split custody it can move ownership, visibly; under operator custody it can forge everything ([section 5](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md#5-three-arrangements)). Under `managed-custody@1` the acceptance evidence is the custodian's own: the recipient holds no key, so the record shows what the custodian attests, not something the recipient signed.

**What the current release selects.** The current release writes record version 2 under `managed-custody@1`. Two things differ from version 1. Version 2 checks control on every state after the first, not only on transfers. And under `managed-custody@1` every version 2 `TRANSFER` must commit to an acceptance record, or a reader or index applying the profile refuses it. An index declares the profile in its `GET /capabilities` answer; the hosted index declares `managed-custody` version 1 with `acceptanceCommitment: required`.

Version 1 passports still verify. They use the owner-signed transfer of the custody specification ([section 4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md#4-the-owner-signed-transfer)) where a profile selects it, and continue as version 2 through one `UPDATE` that keeps the controller key and needs no acceptance ([migration](../migration.md#start-writing-version-2)).

**Brand keys.** Who holds a brand's identity key is your platform's choice: the brand's own wallet, or your platform on the brand's behalf. In the reference application the platform holds each brand's identity, so a brand cannot yet update or move it. Nothing in the standard requires this, and another application can let brands hold their own ([open decisions](../start/status.md#open-decisions)).

## How a managed transfer works

Under `managed-custody@1` a hand on, or transfer, takes three steps, and only the third touches the chain ([managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md#4-the-transfer) section 4):

1. **Offer.** The holder asks the custodian to offer the passport, to a named recipient's identity key or through a claim code. The custodian fixes the current tip, a digest of the exact terms shown to the recipient, and an expiry.
2. **Acceptance.** The recipient reads the terms and accepts, by redeeming the claim code or answering as the named identity. The custodian derives or receives the destination key, the controller key the passport moves to, records the acceptance with its time, signs the record with `signManagedAcceptance` (format `dpp-managed-acceptance@1`) and keeps it.
3. **Transfer.** The custodian writes the `TRANSFER`: it spends the tip the offer named, moves field 6 to the destination key, carries the holder as actor with the control proof, and carries `acceptanceCommitment(record)` in field 15, `authorisationCommitment`. Check that `bindAcceptanceToState(record, state)` returns no mismatches before you send it.

Then keep the record for the passport's life. A reader needs it to check the transfer, and the custodian holds the only copy.

An offer is accepted once, and one acceptance executes at most one `TRANSFER`. An offer made against a tip that has since moved must be made again. A declined or expired offer writes nothing on chain.

A reader that is given the record checks that it binds to the `TRANSFER`: `evidenceAvailability` passes, and `issuerAuthority` checks the custodian against the reader's own `acceptanceCustodians` list. Without the record, `evidenceAvailability` reads `unknown` with `referenced-artefact-unavailable` ([evidence and its limits](evidence-and-freshness.md#results-you-will-see-first)). Either way the report's limits say the commitment is custody-dependent evidence, not a signature made with a key the recipient controls. At [Ring 0](identity-and-authority.md#ring-0), who the recipient is remains the custodian's statement too.

`node examples/lifecycle-v2.mjs`, from a checkout after `npm ci` and `npm run build`, runs the offer, the acceptance and the transfer offline; the `ok:` lines after its Acceptance and TRANSFER steps show the record checked and bound to the transfer. [Transfer under managed custody](../packages/how-the-writer-works.md#transfer-under-managed-custody), in how the writer example works, shows the calls.

## After a hand on: the holder's side

For a recipient, being handed a passport under `managed-custody@1` goes like this:

1. **You receive an offer.** The platform sends you a claim code outside the passport, or addresses the offer to an identity of yours.
2. **You accept.** You read the terms and accept. You sign nothing: the custodian records your acceptance, signs that record and keeps it.
3. **You are the holder.** The custodian keeps the passport's keys for you, under an identity it holds on your behalf unless you gave it one of your own.
4. **Everything next goes through the custodian.** To change the passport, hand it on or retire it, you ask the platform. To hand it on, the platform makes a new offer and the same three steps follow.

A platform should answer these questions on its acceptance screen, so that a holder knows what comes next:

- How do I ask for a change or a further hand on, and how will you know the request is mine? A sign-in, a claim code or a message all work; the choice is the platform's.
- Can I see the owner tier, the passport's encrypted restricted data?
- Can I have a copy of the acceptance record?
- How do I take the passport into a wallet of my own?

**Take the passport into your own wallet.** Your BRC-100 wallet derives your controller key for the passport with `ownerKeyFor(passportId, wallet)`, and you give that key, with your identity key, to the custodian. The custodian offers the passport to you as a named recipient with that key as the destination, and writes the `TRANSFER`. For your wallet to spend the next state, that `TRANSFER` must be locked to the same key, as the [custody specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md#3-where-the-lock-sits) section 3 pins for an owner-held lock. From then on you prove control from your own root: that is possession ([managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md#7-what-a-deployment-declares-and-where-a-passport-can-go) section 7). To add a state yourself later, you also need a publisher whose countersignature an index admits: run your own index that names your wallet's key, or find a service that will countersign for you. The contracts define no route for asking a service to countersign.

## Rehearse recovery

Write down where transaction history, signed claims, acceptance records, restricted documents and signing access are kept. Recover each separately in a test environment. A restored account can still lack keys; a restored key can still lack evidence; an evidence archive stays readable after the access needed to update the passport is lost.

Two facts follow from the design. A lost lock freezes the passport at its tip, because the output script has one key and one path. A lost controller key, when the lock is held elsewhere, loses that party's authority and owner tier, and a named authority can move control with one more state ([custody specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md#6-recovery) section 6). [Export and recovery](../operate/export-import-recovery.md) covers the evidence; an export does not recover a missing private key.

## Not settled yet

These are open in the standard ([known limitations](../operate/limitations.md)). Each has a way to proceed meanwhile.

| Open question | What to do meanwhile |
|---|---|
| Whether a custodian may write a state for a holder without the holder's request, and how such a request is recorded | Decide it in your platform. If your staff can update or retire a passport you have handed on, tell the holder |
| The acceptance record is signed with the custodian's identity key itself, which a BRC-100 wallet does not expose, against the one-derivation rule above | Hold the custodian's identity key outside its wallet for now, as the walkthrough does |
| No index or registry route serves acceptance records, so a reader on another stack cannot fetch them | Keep every record for the passport's life and serve it yourself. Readers elsewhere see `evidenceAvailability` `unknown` for your managed transfers |
| Which key the lock sits on under `managed-custody@1` | The walkthrough locks each state to the controller key and spends it with the `[1, 'dpp owner v1']` unlock; the offline example locks every state to the custodian's identity key. Both verify, because a reader never checks who holds the lock. Choose a key your custodian's wallet can spend |

## Source definitions

| Design question | Source |
|---|---|
| Who may hold each key, and the three arrangements | [Custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) |
| How managed acceptance works and what it proves | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) |
| Which control proof a state needs | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md#6-chain-invariants) section 6 |
| What a replacement provider can restore | [Export, import and recovery](../operate/export-import-recovery.md) |

## Next

| You are | Go to |
|---|---|
| Building with the packages | [Keys](../packages/how-the-writer-works.md#keys) and [transfer under managed custody](../packages/how-the-writer-works.md#transfer-under-managed-custody) in how the writer example works, and [what a passport application offers](../packages/what-an-application-offers.md#after-a-hand-on) for the screens around a hand on |
| Implementing a writer yourself | [Passport writer](../implement/roles/passport-writer.md) |
| Still learning the model | [Evidence and its limits](evidence-and-freshness.md) |
