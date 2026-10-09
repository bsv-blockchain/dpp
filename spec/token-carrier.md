# The token carrier: a passport state as a BRC-162 token output

**DPP Token Standard, record version 3. Status: working draft, pre-1.0.** This document defines the third version of the on-chain record: the seventeen-field body of version 2, carried as one output of a token of one unit under BRC-162, so that a reader of the token protocol follows the lineage by its token id while a reader of this standard verifies the body as it verifies version 2. It is read beside [`record-model-v2.md`](record-model-v2.md), which remains the definition of the body and of every rule this document says it inherits, and beside [`record-model.md`](record-model.md), from which version 2 inherits in turn; where this document is silent, version 2's rule applies to a version 3 state unchanged. Until version 1.0 is declared, the reference implementation in this repository is the tiebreaker where this text is ambiguous.

## 1. Overview

Version 3 changes the output and not the record. A version 2 body is a single PushDrop-shaped output that only a reader of this standard recognises. A version 3 body is the same seventeen fields behind a short token prefix, the prefix BRC-162 defines for a token output: a token id or an empty push, an amount, and an `OP_2DROP` that removes both before the locking script runs. A reader of the token protocol that knows nothing of passports sees a token deployed with a fixed supply of one unit and that unit moved from output to output, and follows the lineage by the token id. A reader of this standard reads past the prefix and verifies the body under the version 2 rules with three substitutions, the version string, the protocol identifier and the two domain tags, so that a carried body never verifies as an uncarried one. The property [`record-model.md`](record-model.md) §1 states is unchanged: native signatures, supplied-history linkage and transaction inclusion are verified from transaction bytes and public block-header evidence without an application account, and they do not establish current ownership, physical truth, issuer accreditation, complete history or credential validity. What a token reader adds is discovery, never verification: following the token id finds the outputs, and nothing a token reader shows establishes anything about the passport (§10).

The token protocol this document carries the body under is BRC-162 in the `bsv-blockchain/BRCs` repository at commit `8268c20` (5 October 2026). This document cites it by number and pins that revision, because the prefix layout, the token id's byte order and the roles the prefix encodes are that document's, and a later revision of it changes nothing here until this document is revised to say so. This document takes from BRC-162 only what §2 and §3 state; it takes no position on anything else the protocol defines, and it makes no claim about which readers, wallets or indexes handle the protocol (§12).

A version 3 lineage begins at its own deploy and stays carried: no version 1 or version 2 state precedes or follows a version 3 state, and there is no upgrade transition into version 3 (§6, §11). Version 1 and version 2 states are read under their own documents for as long as they exist: this document revives nothing, refuses nothing those documents accept, and changes no byte of any existing record.

## 2. The output script

A version 3 passport state is a single output whose locking script is, at the genesis:

```
OP_0 OP_1 OP_2DROP <33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 17> OP_2DROP x8 OP_DROP
```

and on every later state:

```
<32-byte token id> OP_1 OP_2DROP <33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 17> OP_2DROP x8 OP_DROP
```

The three chunks before the locking key are the prefix (§3); everything from the locking key on is the body (§4), which is the version 2 output script of [`record-model-v2.md`](record-model-v2.md) §2 except for the three substitutions §4 names. The prefix leaves nothing on the stack, so the script executes as the body alone and a spend of a carried state is the spend of a version 2 state: a plain signature against the locking key.

A reader recognises a carried state from the layout alone; there is no marker and no tag. A script whose first chunk is a 33-byte push is a bare body and is read under its field count, as [`record-model-v2.md`](record-model-v2.md) §2 says. A script whose first chunk is `OP_0` or a push of 32 or 36 bytes is an attempt at a prefix and is held to the rules of §3 as a whole: a prefix attempt that fails them is not a DPP output to this reader, not a body with a strange front. A first chunk of any other length is neither, and the script is read as a bare body and refused at the locking key (`not a DPP output: missing 33-byte locking key push`). Behind a well-formed prefix the reader expects the seventeen-field layout and nothing else: a carried body of fourteen fields is refused by count (`a carried body has 17 fields, found 14`), and the body's version field is then checked against its carriage (§4).

Exactly one carrier output is permitted per transaction, which is version 2's rule of exactly one DPP output applied to the carried form: a transaction carrying two is not a valid state of anything, and the reference reports `exactly one DPP output required, found 2`.

No state carries a payload. BRC-162 lets a token output carry one push and an `OP_DROP` directly after the prefix's `OP_2DROP`; this document forbids a payload on every value output and admits on the genesis only an empty payload slot, `OP_0 OP_DROP`, which the token protocol's encoder rule allows a writer to emit and which carries nothing. A payload is where a token's display fields live, and a passport's display is its body: a reader of this standard takes nothing from a payload, so admitting one would admit bytes nobody verifies.

The body is never misread as a payload. A payload is one push followed by `OP_DROP`; the body's first chunk is the 33-byte locking key push and its second is `OP_CHECKSIG`, not `OP_DROP`, so a reader applying the token protocol's own payload rule to a carried state finds no payload and starts the locking script at the key. The same holds in the other direction: the token protocol's encoder rule, that a script which would otherwise begin with a push and an `OP_DROP` must be preceded by an empty payload slot, never fires for a body, because no body begins that way.

## 3. The prefix

| Chunk | Encoding | Rule |
|---|---|---|
| 1 | `OP_0`, or a 32-byte push | The token id. `OP_0` on the genesis, which is the token's deploy. On every later state, the 32-byte transaction id of the deploy in internal byte order, the order a txid has inside a transaction and inside an outpoint, which is the reverse of the display order a txid is printed in. A push of 36 bytes, the token protocol's form for a token deployed at an output other than 0, is refused with `the token id is the 32-byte deploy txid`, because no carried lineage is deployed anywhere but output 0 (§6). |
| 2 | `OP_1` | The amount: one unit, written as the minimal script number for one, which is the opcode `OP_1`. A one-byte data push of `0x01` is the same number non-minimally encoded, refused with `the token amount is a minimally encoded script number`; any other amount, `OP_0` and `OP_2` among them, is refused with `the token amount is 1`. |
| 3 | `OP_2DROP` | Removes the two pushes above. A prefix attempt without it is refused with `not a DPP output: malformed token prefix`. |
| 4, 5 | Absent, or `OP_0 OP_DROP` on the genesis only | The payload slot. A value output carrying one is refused with `a value output carries no payload`; a genesis carrying anything but the empty slot is refused with `a genesis carries no payload beyond an empty slot`. |

BRC-162 derives an output's role from the prefix: an empty id with a positive amount is a fixed-supply deploy, an id with a positive amount is a value output, and a zero amount in either position is an authority, which this document never writes and always refuses by the amount rule. This document uses two roles, and checks each against the state's position in the lineage rather than reading it from the prefix as a fact about the state. The deploy is the genesis and nothing else: a genesis whose prefix names a token id is refused (`a genesis carries an empty token id`), and a state after the genesis whose prefix is empty is refused (`a state after genesis carries the lineage token id`). A prefix the token protocol would accept in some other token is refused here when it does not say what the position requires.

The amount is one on every output, so the token is deployed with a supply of one unit and that unit is carried from each state to the next. The token protocol does not require this, and a lineage could not be read under this document if it were otherwise: the body is one record, and a unit that split or merged would be two records or none.

## 4. The body: record version 3

The body is the seventeen-field output of [`record-model-v2.md`](record-model-v2.md) §2 and §3 with three substitutions and no other change:

| Where | Version 2 | Version 3 |
|---|---|---|
| Field 2, `version` | The string `2` | The string `3` |
| The BRC-43 protocol identifier of both signatures ([`record-model-v2.md`](record-model-v2.md) §5) | `[1, 'dpp token v2']` | `[1, 'dpp token v3']` |
| The domain tags that open the two preimages | `dpp-record-v2/actor-signature`, `dpp-record-v2/publisher-signature` | `dpp-record-v3/actor-signature`, `dpp-record-v3/publisher-signature` |

Everything else is version 2's by reference: the field rules and bounds of its §3, the four operations of its §4, the framing of its §5 with the tags above in place of its own, the two signatures and the keys they verify under, the owner tier and the controller key of its §7, and the commitments of its §8. The invoice number of a version 3 signature is therefore `1-dpp token v3-<key identifier>`, so a key derived for version 2 signs nothing under version 3 and the reverse, and a version 3 preimage shares no bytes with a version 2 preimage over the same fields, because the tags differ and the version field differs. The prefix is not part of either preimage: the token id it names is checked against field 12 by the reader (§5), not signed again.

One version has one layout, and version 3's layout is the carried one. A seventeen-field body behind a prefix whose version field reads `2` is refused with `version "2" is not carried behind a token prefix`; a bare seventeen-field body whose version field reads `3` is refused with `version "3" is carried behind a token prefix`. Both refusals name the version so that a reader of one document meeting the other's state fails clearly rather than guessing. A version field that is none of `1`, `2` and `3` is refused as `unsupported standard version "<value>"`, as before.

## 5. The token id and the lineage

The token id of a carried lineage is the outpoint of its genesis, the deploy: the genesis transaction's id and output index 0. On the wire it is the 32 bytes of that transaction id in internal byte order, with the index implied, since a deploy under this document is always output 0 (§6). Its display form is `<txid>_0`, the transaction id in display order, an underscore and the index, which is the display form BRC-162 gives a token id. [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) pins both forms of one token id as `tokenId` and `tokenIdWire`. A writer that puts the display order onto the wire names a different token to every reader, and the fixture's `tokenIdDisplayOrder` is refused for it.

Field 12, `lineage_genesis`, names the same outpoint under the version 2 encoding: the 32-byte transaction id in display order followed by the output index as four big-endian bytes, which for a carried lineage is always `00000000`. A reader checks that the two agree: the token id in the prefix of every state after the genesis is held to the genesis the reader saw (§6), and field 12 is held to the same genesis under version 2's invariant 5, so the prefix and the field name one outpoint in two byte orders or the state fails. The field is kept because the body is signed and the prefix is not: field 12 is the lineage binding the signatures cover, and the prefix is the binding a token reader follows. §13 records the alternative.

`passport_id` (field 3) is unchanged in meaning and remains the record's identifier and primary lookup key. The token id is a second key for the same lineage, one that a reader of the token protocol can produce without decoding a body, and an index serves both (§9). Two keys name one lineage; neither replaces the other.

## 6. Chain invariants

A version 3 lineage is the ordered sequence of carried states from the genesis to the tip. A conforming verifier checks, for every version 3 state, every invariant of [`record-model-v2.md`](record-model-v2.md) §6 with the version 3 preimages and protocol identifier of §4 substituted, including the control proof in its evaluation order, the control authorities, retirement, forks and rival geneses as that section defines them, and in addition:

1. The genesis is a deploy at output 0 of its transaction: its prefix is `OP_0 OP_1 OP_2DROP` and it is the first output. A genesis at any other index is refused with `a genesis is a deploy at output 0`; a genesis whose prefix names a token id is refused with `a genesis carries an empty token id`.
2. Every later state is a value output naming the lineage genesis: its prefix carries a 32-byte token id, and that id is the genesis transaction's id. A later state with an empty id is refused with `a state after genesis carries the lineage token id`; one naming any other transaction, or the right transaction in the wrong byte order, is refused with `the token id names the lineage genesis`. A verifier that cannot see the genesis cannot check this and refuses the link with `the token id cannot be checked without the chain genesis`, never passing it.
3. The amount is one on every state (§3), and no state carries a payload beyond the genesis's empty slot (§2). Both are decode rules: an output breaking either is no DPP output to this reader.
4. Exactly one carrier output per transaction (§2).
5. A `RETIRE` is terminal, as in version 2, and it is written as a value output of one unit like any other state: nothing the record recognises may spend it, and a state that does is refused with `the lineage is retired: no state may follow RETIRE`. To a reader of the token protocol the retired tip is a live unit; to a reader of this standard the lineage has ended. The two do not conflict, because the token reader was never verifying the record. §7 says what a spend of the tip by something other than a state looks like.
6. A version 3 lineage begins at its own deploy, and no version crosses into or out of it. A version 3 state that spends a version 1 or version 2 state is refused with `a version 3 state follows only a version 3 state`; a version 2 state that spends a version 3 state is refused with `a version 2 state cannot follow a version 3 state`; a version 1 state that spends a version 3 state is refused under version 1's own rule with `a version 1 state cannot follow a version 3 state`. There is therefore no upgrade transition from version 1 or version 2 into version 3, and §11 says why.

Rules 1 and 2 are the carrier's own and need the transaction and the lineage rather than the body alone. The reference checks them before the transition rules of version 2 for every state after the genesis; at the genesis it checks the `ISSUE` rules of version 2 first and the carrier's second. The five sentences rules 1 and 2 quote are `CARRIER_REFUSALS` in the reference, and [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) pins each but the last, which needs a history with no genesis in it.

## 7. Burn

A spend of the tip by a transaction with no carrier output is a burn to a reader of the token protocol: the unit left the token's history and nothing continues it. To a reader of this standard the transaction holds no state, so it refuses the transaction at encoding with `exactly one DPP output required, found 0`, keeps every state before it, and reports the lineage as ended without a `RETIRE` and the tip as spent. The difference from a `RETIRE` is that a retirement is a state, signed by an actor who proved control, with a reason in its event data where a profile asks for one, while a burn is a spend by whoever held the locking key and says nothing. A burn is not a refusal of the lineage: the states before it stand, verified, and what the report says is that the record stopped where the bytes stopped.

Under the vocabulary of [`verification.md`](verification.md) §5, a source that saw the burning transaction reports the tip as spent, and the observation is `superseded`, a spend of the tip having been seen. With the burning transaction in the supplied history, `recordEncoding` fails on it with `decode-failed` at that state index, every token check after it reads `unknown` for the same reason, and the states before it stand in the detail. [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) pins one burn as `burn`, and [`../fixtures/evidence-v3.json`](../fixtures/evidence-v3.json) pins its report as `v3-burn-without-retire`. A writer under [`writing.md`](writing.md) §2 never produces one on purpose; a wallet that treats the unit as a token it may send can, and §8 says what a writer owes against that.

## 8. Writing

The duties of [`writing.md`](writing.md) apply to a carried state unchanged, and this document adds two rules for the writer whose wallet makes the transaction.

The genesis is output 0. A deploy under BRC-162 is output 0 of its transaction, and §6 refuses a genesis anywhere else, so a writer MUST place the genesis's carrier output first. The BRC-100 action interface randomises output order unless the action says otherwise, so that a change output is not identifiable by position; a writer sets that randomisation off for the genesis action and leaves it on for every later one, where a value output may sit at any index, as the third state of [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) sits at index 1 behind an `OP_RETURN`.

Every carried output holds one satoshi. Version 2 left satoshi values to the build; version 3 makes one satoshi a rule for every carried state, genesis and later, so that a carried state is the smallest output the network accepts and the unit's value never says anything a reader might take for a fact about the passport. The fixtures pin every carried output at one satoshi.

Ordinality is not a rule of this document. A lineage whose carried outputs each hold one satoshi, and whose every spend places that satoshi at the same running position among the transaction's input and output values, would also be one satoshi's lineage under an ordinal numbering scheme, and a reader of such a scheme would then follow the passport by the satoshi as a token reader follows it by the token id; this document neither requires nor forbids that alignment, and §13 keeps the question open.

## 9. Admission and lookup

An index admitting a carried state ([`services.md`](services.md) §2) applies the carrier's rules before the body's, in this order: the prefix's shape (§3, chunks 1, 3 and the payload slot), the amount (chunk 2), the role against the state's position (§6 rules 1 and 2, the role), the token id against the lineage genesis the index can trace (§6 rule 2, the id), and then every version 2 rule under the version 3 preimages, lineage tracing included. A state whose genesis the index cannot trace is refused, as a version 2 state is, never admitted on the strength of the token id alone, because the token id is a claim the prefix makes and the trace is what checks it.

The lookup indexes the token id beside `passport_id` and the data carrier reference, so that a caller holding a token id a wallet or a token reader showed it asks for the lineage without decoding a body, and a caller holding the passport identifier gets the same lineage. The index answers by whichever key it is asked with the same BEEF; the overlay contract names the query key. An index declares the capability `dpp-record` at version `3` beside versions `1` and `2`.

What a generic reader of the token protocol accepts and this document refuses, and what both refuse:

| Output | A BRC-162 reader | This document |
|---|---|---|
| A value output with an amount other than one, or a zero amount in either position | Accepted, as a value of that amount or as an authority | Refused: `the token amount is 1` |
| A payload on a value output, or a non-empty payload on a deploy | Accepted; the payload is not validated | Refused: `a value output carries no payload`, `a genesis carries no payload beyond an empty slot` |
| A first state whose prefix names a token id | Accepted, as a value output of that token | Refused: `a genesis carries an empty token id` |
| A state after the genesis with an empty id | Accepted, as a new deploy | Refused: `a state after genesis carries the lineage token id` |
| A value output naming another deploy, or the genesis in display byte order | Accepted, as a value output of whatever token the id names | Refused: `the token id names the lineage genesis` |
| A spend of a `RETIRE` | Accepted, as a move of a live unit | Refused: `the lineage is retired: no state may follow RETIRE` |
| Two carrier outputs in one transaction | Judged by the protocol's accounting of units | Refused whatever the accounting says: `exactly one DPP output required, found 2` |
| A 36-byte token id | Accepted only for a token deployed at an output other than 0; refused with index 0 | Refused in every form: `the token id is the 32-byte deploy txid` |
| An amount of one as a one-byte data push | Refused: not minimally encoded | Refused: `the token amount is a minimally encoded script number` |
| A prefix without its `OP_2DROP` | Not a token output | Refused: `not a DPP output: malformed token prefix` |

The first five rows are the outputs [`../fixtures/record-v3.json`](../fixtures/record-v3.json) and [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) pin as accepted by the token protocol and refused here; the chain fixture marks its four with `brc162Accepts`.

## 10. Verification

"Verified" means the checks of [`record-model-v2.md`](record-model-v2.md) §9 with the version 3 preimages and protocol identifier substituted and the carrier invariants of §6 added to the linkage, reported in the one shape of [`verification.md`](verification.md): the same sixteen checks, four answers each, and no new check. `recordEncoding` covers the prefix and the body together: a state whose prefix fails §3, whose body fails §4, or whose transaction holds two carrier outputs or none, is no DPP output to this reader, and the check fails on that transaction with `decode-failed`. `linkage` gains two shared reason codes: `carrier-prefix-invalid` for a genesis away from output 0, a genesis naming a token id and a later state with an empty id (§6 rule 1 and the role of rule 2), and `token-id-mismatch` for a token id that names another deploy or that cannot be checked without the genesis (the id of rule 2). Every other refusal keeps the code version 2 gave it: `lineage-retired`, `control-not-proven`, `version-transition-invalid` for a state that crosses versions, `acceptance-commitment-absent` and `link-broken`. The per-state detail of the token checks carries each state's `version`, `3`, and its `tokenId` in display form, on the genesis as on every later state.

Every report over a history holding a version 3 state carries, in `limits`, this sentence: "Version 3 states are carried as token outputs; a reader that follows the token id alone verifies neither the body's signatures nor its control proof, and a wallet's display of the token says nothing about the passport." It is there because the prefix is the one part of a carried state another protocol's reader will show a person, and what that reader shows is a unit moving, not a record verified.

[`../fixtures/evidence-v3.json`](../fixtures/evidence-v3.json) pins the report for nine cases (§12).

## 11. Migration

Version 3 is for new lineages. A lineage that began under version 1 or version 2 continues under its own document: a version 1 lineage upgrades to version 2 through the single transition [`record-model-v2.md`](record-model-v2.md) §6 defines, or stays version 1, and a version 2 lineage stays version 2. Nothing in either document changes, no existing state is reread, and a writer that wants a passport carried starts a new lineage with a new deploy, which is a new lineage under this standard: the token id is the deploy's outpoint, and a token id is a lineage.

There is no adoption transition in this version, and the reason is the agreement rule of §5. A deploy is a new token whose id is its own outpoint, and the token protocol has no form for a value output whose token id is an earlier passport state, because that state was no deploy. A version 3 state that spent a version 2 tip would therefore be either a deploy, whose prefix names no lineage while its field 12 names the version 2 genesis, or a value output naming a token id that no deploy issued; in both cases the token id and field 12 disagree and §6 rule 2 fails. Making adoption possible means choosing between a prefix that names something other than a deploy, a field 12 that names the deploy rather than the lineage's first state, and a third field; this document chooses none of them, and §13 records the open point.

## 12. Conformance

Three fixtures and two vector files pin this document, generated by the reference's tests and never edited by hand ([`../fixtures/README.md`](../fixtures/README.md)):

| File | What it pins |
|---|---|
| [`../fixtures/record-v3.json`](../fixtures/record-v3.json) | One carried output of each role: the genesis behind `OP_0 OP_1 OP_2DROP` and a value output behind the token id, each with its fifteen posted fields, its two framed preimages under the version 3 tags, both signatures under `[1, 'dpp token v3']`, the derived verification keys and the whole locking script; the token id in both forms; one accepted variant, the genesis with an empty payload slot; and twelve refusals, one leniency each, from a prefix without its `OP_2DROP` to the locking key in its uncompressed spelling. |
| [`../fixtures/chain-v3.json`](../fixtures/chain-v3.json) | One carried lineage of five states, `ISSUE`, `UPDATE`, `TRANSFER`, `UPDATE`, `RETIRE`, with the `TRANSFER`'s carrier output at index 1 behind an `OP_RETURN`; the lineage's token id in both forms; twelve refusals, each extending a prefix of the valid chain and breaking one rule, four of them marked `brc162Accepts` because a generic reader of the token protocol accepts the output and the refusal is this document's own; and one burn. |
| [`../fixtures/evidence-v3.json`](../fixtures/evidence-v3.json) | The report of [`verification.md`](verification.md) for nine cases under report version 1: the valid lineage, the retired tip observed, a state after the `RETIRE`, a token id naming another deploy, a genesis away from output 0, a value output behind a deploy prefix, a failed control proof, a version 2 body behind the prefix, and the burn. |
| [`../fixtures/vectors/dpp/record/v3.json`](../fixtures/vectors/dpp/record/v3.json), [`../fixtures/vectors/dpp/chain/v3.json`](../fixtures/vectors/dpp/chain/v3.json) | The same bytes in the stack's vector form, `dpp.record.v3` (sixteen vectors) and `dpp.chain.v3` (twenty-two), with the test private keys published so that a writer in any language reproduces every pinned byte, and the token id as a vector of its own. |

Every pinned script was decoded with the token protocol's published reference codec at the date of writing: the outputs this document accepts read there as the deploy and value outputs §3 describes, and the refusals marked `brc162Accepts` read there as valid token outputs, which is what the mark means. No indexer or wallet has been seen to admit, display or spend a carried state, and this document claims nothing about any: that a generic token reader could follow a lineage is a property of the layout, checked against the codec, and not an observation of a deployment.

A conforming reader decodes every accepted script in the three fixtures to its state and its prefix, reproduces both preimages byte for byte, verifies both signatures under the derived children, finds that neither signature verifies under anything derived for version 2, accepts the five-state chain with its token id, refuses every refusal for the pinned reason, and produces the pinned report for every evidence case on the parts [`verification.md`](verification.md) §8 names. A conforming writer reproduces every locking script and transaction from the posted fields and the published test keys, prefix included.

## 13. Open points

The decisions this version takes and the alternatives it leaves:

| Decision | Taken | Alternative |
|---|---|---|
| Retirement | `RETIRE` is a value output of one unit; a token reader sees a live unit that nothing in this standard may spend | A `RETIRE` that burns the unit, so that both readers see the lineage end; the last state would then carry no unit, and a token reader would not find it |
| Field 12 | Kept in the version 2 encoding, display order and a four-byte index, beside the prefix's internal-order id; the reader checks agreement | Re-encode field 12 in the prefix's order, or drop it and bind the token id into the signed fields another way; either changes the body and what version 2 inherits |
| Existing lineages | No adoption of a version 1 or version 2 lineage (§11) | An adoption transition, which needs a prefix form or a field this document does not define |
| Output 0 | A writer's rule, with the wallet's output randomisation off for the genesis (§8) | The token protocol's 36-byte id, which would let a deploy sit at any index and which this document refuses |
| Payloads | None, beyond the empty slot on a deploy | A payload carrying display fields for token readers; nothing in it would be verified |
| The token id as a lookup key | Indexed beside `passport_id` and the data carrier (§9) | `passport_id` alone, which a token reader cannot produce without decoding the body |
| Ordinality | Not a rule (§8) | Require the one-satoshi alignment that would make the lineage one satoshi's, so that a third kind of reader follows it |

## 14. Normative and implementation

What any conforming implementation must reproduce: the two prefix forms and their recognition from the layout alone (§2), the prefix rules of §3 with their refusals, the three substitutions of §4 and the refusal of a version 2 body behind a prefix and of a version 3 body without one, the token id in both its forms and its agreement with field 12 (§5), the carrier invariants of §6 beside every version 2 invariant, the reading of a burn (§7), the admission order and the token id lookup (§9), the two reason codes and the limits sentence of §10, and the fixtures of §12. What is a build's own, as in version 2: basket names, fees, broadcast and index arrangements within the duties [`writing.md`](writing.md) sets and the two rules §8 adds, which wallet makes the transaction, and whether the build also follows the lineage with a token reader. Where the keys are kept is invisible here, and [`custody.md`](custody.md) and [`managed-custody.md`](managed-custody.md) say what the standard requires of them.
