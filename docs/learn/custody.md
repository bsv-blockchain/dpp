# Custody

Platform designers and operators can use this page to choose who holds passport keys: the brand, platform, holder or custodian. That choice determines who can transfer a passport, what outsiders can verify and what wallet loss removes.

## Before you start

The transfer walkthrough follows the unpublished November source candidate. Package publication and hosted upgrades are separate ([release sets](../reference/release-sets.md)). Choose the rules for your release before configuring a writer.

| Release or deployment | Custody profile | Acceptance signature and format |
|---|---|---|
| Published October set and hosted index's current declaration | `managed-custody@1` | Directly under custodian identity key; `dpp-managed-acceptance@1` |
| November source candidate | `managed-custody@2` | BRC-42 derived key through a BRC-100 wallet; `dpp-managed-acceptance@2` |

| Task | Required input and source |
|---|---|
| Connect or change writers | Index `GET /capabilities`; follow [candidate migration](../migration.md#test-the-november-source-candidate) |
| Follow the managed transfer | Custodian's BRC-100 wallet, holder's request, recipient acceptance and retained acceptance record |
| Check acceptance authority | Reader's own `acceptanceCustodians` list and the retained record |
| Run the optional offline exercise | Node.js 22 or later; checkout prepared with `npm ci` and `npm run build` |
| Leave managed custody | Recipient's BRC-100 wallet and the deployment/publisher arrangements below |

Record version 2 checks control on every state after the first. Both custody versions require a transfer acceptance commitment. The November reader verifies older records using their own signature rule; its writer produces only version 2 acceptance records. Custody and passport record versions are separate. The second implementing party's written acceptance of the version 2 signed shape remains outstanding.

## The four keys

Each state involves four keys with separate roles ([custody specification](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md#1-four-keys-four-roles) section 1):

| Key | Location | Role |
|---|---|---|
| Lock | State output script | Controls the next state. Only spending the tip, the newest state, extends the passport. |
| Actor | Actor identity key and signature | Names who makes and answers for this state: brand, repairer or owner |
| Controller | Field 6, `controller_key`; version 1 uses `owner_identity_key`, the owner key | Says whom the passport belongs to now. Later states must prove control; the same wallet encrypts the owner tier. |
| Publisher | Countersignature | Names the admitting service; says nothing about truth |

| Controller-key mechanism | Value or behaviour |
|---|---|
| Usual derivation, one step from the controlling wallet | `ownerKeyFor(passportId, wallet)` in `@bsv/dpp-protocol` |
| Protocol | `[1, 'dpp owner v1']` |
| Key identifier | Passport identifier; one wallet gets a different, unlinkable controller key per passport |
| Actor differs from controller | State proves control using the wallet's `revealOwnerLinkage`: a public 32-byte control linkage from actor identity key to controller key ([keys](../packages/how-the-writer-works.md#keys)) |

Readers cannot and need not locate the keys: the same rules verify personal wallets and operator systems. The standard must let a person's wallet fill every role. Nothing may require more than a BRC-100 wallet can do with one derivation from its root key, without exporting a private key.

## Choose an arrangement

The custody specification describes three arrangements; record version 2 adds `managed-custody@2`. The standard prefers none.

| | Possession | Split custody | Operator custody | `managed-custody@2` |
|---|---|---|---|---|
| Lock holder | Owner's wallet, using controller key | Operator | Operator | Controller key; custodian spends for managed identity, recipient spends if they supplied their own key |
| Controller-key holder | Owner's wallet | Owner's wallet | Operator for owner | Custodian for holder |
| Recipient needs | BRC-100 wallet, with funds or a paying publisher | BRC-100 wallet | Account | No wallet, identifier or funds |
| Outsider can check transfer | Network-enforced owner spend | Owner linkage proof where profile requires | Operator's word only | Custodian signed and retained recipient acceptance; transfer commits to it |
| Lost owner wallet | Passport freezes at tip permanently | Owner authority and owner tier lost; operator moves ownership as named authority | Account recovery | Custodian holds keys; named control authority moves control if managed identity root is lost |

A compromised operator can forge nothing about the owner under possession, move ownership visibly under split custody, and forge everything under operator custody ([section 5](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md#5-three-arrangements)). Managed acceptance is the custodian's evidence: the recipient holds no key and signs nothing.

Version 1 passports still verify, but version 1 proves no control: a version 1 transfer that spends the tip is valid whoever signs it. One `UPDATE` continues them as version 2, retaining the controller key without acceptance ([migration](../migration.md#start-writing-version-2)).

**Brand keys:** your platform chooses whether a brand or platform holds its identity key. The reference application holds each brand identity, so brands cannot yet update or move it. The standard does not require this; another application can allow brand-held keys ([open decisions](../start/status.md#open-decisions)).

## How a managed transfer works

A transfer, also called a hand on, has three steps under `managed-custody@2`. Only step 3 touches the chain ([managed custody](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md#4-the-transfer) section 4).

1. **Offer.** The holder requests an offer to a named recipient identity key or through a claim code. The custodian fixes the current tip, expiry and digest of the exact terms shown to the recipient.
2. **Acceptance.** The recipient reads and accepts the terms by redeeming the code or answering as the named identity. The custodian derives or receives the destination controller key, records acceptance and time, signs through its wallet and retains the record.
3. **Transfer.** The custodian writes `TRANSFER`, spending the offered tip and moving field 6 to the destination key. It carries the holder as actor with control proof, plus `acceptanceCommitment(record)` in field 15, `authorisationCommitment`. Before sending, check that `bindAcceptanceToState(record, state)` returns no mismatches.

| Acceptance signing input | Value |
|---|---|
| Helper and format | `signManagedAcceptance`; `dpp-managed-acceptance@2` |
| Wallet | BRC-100; identity private key need not be exported |
| Child-key protocol | `[1, 'dpp managed record v1']` |
| Key identifier | Record's `requestId` |
| Counterparty | `anyone` |

Retain the record for the passport's life so readers can check the transfer. The November candidate carries acceptance records in evidence packages under `authority`; `acceptanceRecordsInPackage` retrieves them for the reader. Retain and share packages under deployment access policy. No dedicated index or registry route serves acceptance records alone.

| Condition | Outcome or stop point |
|---|---|
| Acceptance binding has mismatches | Do not send the transfer until `bindAcceptanceToState(record, state)` returns none |
| Offer already accepted | Cannot accept again; one acceptance executes at most one `TRANSFER` |
| Offered tip moved | Make a new offer |
| Offer declined or expired | No chain write |
| Record supplied and bound to transfer | `evidenceAvailability` passes; `issuerAuthority` checks the custodian against `acceptanceCustodians` |
| Record absent | `evidenceAvailability` is `unknown`, reason `referenced-artefact-unavailable` ([evidence limits](evidence-and-freshness.md#results-you-will-see-first)) |

In either evidence outcome, report limits describe custody-dependent evidence, not a signature from a recipient-controlled key. At [Ring 0](identity-and-authority.md#ring-0), recipient identity is also the custodian's statement.

Run `node examples/lifecycle-v2.mjs` for the offline offer, acceptance and transfer. Its `ok:` lines after Acceptance and TRANSFER show the record checked and bound. [Transfer under managed custody](../packages/how-the-writer-works.md#transfer-under-managed-custody) shows the calls.

## After a hand on: the holder's side

For a recipient under `managed-custody@2`:

1. **Receive an offer.** The platform sends a claim code outside the passport or addresses your identity.
2. **Accept the terms.** You sign nothing. The custodian records, signs and retains your acceptance.
3. **Become the holder.** The custodian keeps the keys under an identity held for you, unless you supplied your own.
4. **Ask for later changes.** Ask the platform to update, transfer or retire. While the custodian keeps your keys, an update or retirement it writes for you depends on custody: the chain shows that the custodian acted, not that you asked, and a verification report says so. Transferring again starts a new offer and the same three transfer steps.

The acceptance screen should answer:

| Holder question | What the platform should explain |
|---|---|
| How do I request another change or transfer? | How it recognises your request. Sign-in, claim code or message can work; the platform chooses. |
| Can I see the owner tier? | Access to encrypted restricted data |
| Can I get the acceptance record? | How to obtain a copy |
| Can I use my own wallet? | The exit process below |

### Leave managed custody

1. Derive your controller key with `ownerKeyFor(passportId, wallet)` in your BRC-100 wallet. Give it and your identity key to the custodian.
2. Have the custodian offer the passport to you as a named recipient, with that destination key, and write `TRANSFER`.
3. Require the transfer lock to use the same key so your wallet can spend the next state ([custody specification](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md#3-where-the-lock-sits) section 3). You then prove control from your own root: possession ([managed custody](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md#7-what-a-deployment-declares-and-where-a-passport-can-go) section 7).
4. Arrange the conditions for later writes before relying on the exit:

| Condition | Required arrangement |
|---|---|
| Admitted publisher countersignature | Run an index naming your wallet key, or find a service that countersigns. Contracts define no countersigning-request route. |

## Rehearse recovery

Record each storage location and recover each input separately in a test environment:

| Retained input | Observable recovery result |
|---|---|
| Transaction history | Restored history remains readable |
| Signed claims and acceptance records | Records are available for verification |
| Restricted documents | Retained documents are recovered |
| Signing access | Access to the keys needed to act is restored, separately from accounts and evidence |

A restored account may lack keys; restored keys may lack evidence. Evidence archives remain readable after update access is lost. [Export and recovery](../operate/export-import-recovery.md) covers evidence; exports do not recover missing private keys.

| Loss | Consequence |
|---|---|
| Lock key | Passport freezes at its tip: the output script has one key and one path |
| Controller key with lock held elsewhere | Party loses authority and owner tier; a named authority can move control with one more state ([custody specification](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md#6-recovery) section 6) |

## Not settled yet

The November candidate specifies the locking key and derived-key signatures. The remaining deployment questions are how to obtain retained evidence and how an application offers key portability ([known limitations](../operate/limitations.md)).

| Remaining question | What to do now |
|---|---|
| No dedicated index or registry route serves acceptance records | Retain the records and carry them in evidence packages. A reader without the referenced record still reports missing evidence |
| How a platform lets a holder take control through their own wallet | Implement the offer, destination-key and access workflow, and explain which index will accept subsequent writes. The standard defines the records, not those screens |
| Whether records and signing access survive the custodian's loss | Rehearse evidence export, recovery and key portability separately; restoring public history does not recover private keys |

## Source definitions

| Design question | Source |
|---|---|
| Who may hold each key, and the three arrangements | [Custody](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md) |
| How managed acceptance works and what it proves | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md) |
| Which control proof a state needs | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/record-model-v2.md#6-chain-invariants) section 6 |
| What a replacement provider can restore | [Export, import and recovery](../operate/export-import-recovery.md) |

## Next

| You are | Go to |
|---|---|
| Building with the packages | [Keys](../packages/how-the-writer-works.md#keys) and [transfer under managed custody](../packages/how-the-writer-works.md#transfer-under-managed-custody) in how the writer example works, and [what a passport application offers](../packages/what-an-application-offers.md#after-a-hand-on) for the screens around a hand on |
| Implementing a writer yourself | [Passport writer](../implement/roles/passport-writer.md) |
| Still learning the model | [Evidence and its limits](evidence-and-freshness.md) |
