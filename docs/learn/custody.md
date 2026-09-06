# Custody

**Audience:** application designers, custodians and anyone planning provider migration. **Canonical sources:** [`spec/custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/custody.md), [`spec/managed-custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/managed-custody.md), [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md) §6 and §8.

## Four keys

A passport state involves four keys with four roles: the **lock**, which the output script names and whose holder can spend the state; the **actor key**, which signs the assertion; the **owner key**, the per-passport derivation that names who owns the object; and the **publisher key**, which countersigns admission. A verifier cannot tell from the bytes which party held which key; that is the custody arrangement, and the standard prefers none.

## Three arrangements

| | Possession | Split custody | Operator custody |
|---|---|---|---|
| Lock | The owner's wallet | An operator | An operator |
| Owner and actor keys | The owner's wallet | The owner's wallet | The operator, for the owner |
| Consent to a transfer | The spend itself, enforced by the network | The owner-signed transfer, when the profile selects it | Nothing a stranger can check |
| A compromised operator can | Forge nothing about the owner | Move ownership as an authority, visibly | Forge everything |
| A lost owner wallet | Freezes the passport at its tip, permanently | Loses the owner's authority and owner tier; the chain continues | Is an account recovery |
| The owner needs | A funded BRC-100 wallet, or a co-funding publisher | A BRC-100 wallet | An account |

The **managed-custody profile** (`managed-custody@1`) is operator custody made checkable by a stranger where it can be: a custodian holds the lock and derives every party's keys, a recipient who needs no wallet accepts an offer, the custodian records and signs that acceptance as a `dpp-managed-acceptance@1` record, and the version 2 transfer commits to the record's digest in its authorisation commitment field. A reader holding the record and the transfer checks the binding from the two alone. What the evidence establishes is stated exactly: that the custodian retained and signed an acceptance the transfer commits to, custody-dependent evidence and not a signature made with a key the recipient controls.

## Control under version 2

Every non-genesis version 2 state proves control of the state it spends, in a fixed order: the actor key equals the previous controller key, or the actor is a control authority the deployment names, or the state carries a linkage scalar that relates the actor key to the previous controller key. A state that proves none is refused with `control-not-proven`. Recovery is therefore a transfer or update by a named authority, attested on the anchor rail, and which parties are authorities is the profile's and the business's to decide.

## What cannot be recovered

A lost locking key freezes a chain at its tip forever; the output script is one key with one path. A lost owner key, where the lock is held elsewhere, loses the owner's authority and their owner tier, and the chain continues under an authority's recovery. No evidence package, export or index carries a private key, and none ever will: an evidence package under a public disclosure scope says in its manifest that it is not a recovery backup. Provider migration therefore needs two things a public export cannot supply: the retained off-chain content and status evidence, and the signing access appropriate to the custody arrangement. A custodian that migrates providers migrates its keys through its own governed process; a possession owner needs nothing from the old provider but the bytes.
