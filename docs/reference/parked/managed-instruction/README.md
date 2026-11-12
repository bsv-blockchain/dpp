# Parked: holder instruction records

**Out of the standard.** This folder keeps the `dpp-managed-instruction@1` record, a custodian-signed record of a managed holder's request that an `UPDATE` or `RETIRE` written for them after a committed `TRANSFER` commits to in field 15, and the rule under which an index or verifier refused such a state without one. It was parked on 12 November 2026. Nothing here is a requirement, no conformance claim covers it, its ledger rows are kept without a status in [the ledger archive](../ledger-archive.json), and no package in this repository reads or writes it.

What the standard says in its place is one sentence in `spec/managed-custody.md` §6: after a committed `TRANSFER`, a custodian's `UPDATE` or `RETIRE` for a managed holder depends on custody, and the chain cannot show that the holder asked. The verification report's limits say so.

## What is here

| File | What it pins |
|---|---|
| `managed-instruction-v1.json` | One instruction record with its canonical bytes, signature and commitment, the `UPDATE` that commits to it, and seven refusals, as last generated |
| `vectors-v1.json` | The same record in the stack's vector format, `dpp.managedinstruction.v1`, with the custodian's test key published |

Both were generated against the version 2 chain fixture as it stood when they were parked, and they are not regenerated.

## The last working revision

Commit [`d8b912e`](https://github.com/bsv-blockchain/dpp/tree/d8b912e5a311137163bdf958673bff3f4e10558b/packages/dpp-protocol/src), the last commit on `main` before the custody rulings of 12 November 2026, carries the instruction record working, and nothing after it changed its code, text or fixtures before they were parked: `packages/dpp-protocol/src/instruction.ts` (`signManagedInstruction`, `inspectManagedInstruction`, `bindInstructionToState`, `instructionCommitment`), its generators and tests under `packages/dpp-protocol/test/`, the instruction rule in `verifyChain` and `verifyPassportEvidence`, the `INSTRUCTION_COMMITMENT` setting and the `instruction-commitment-absent` refusal of the reference index, the four instruction cases of `fixtures/evidence-v2.json`, the `updateAfterTransferWithoutInstruction` refusal of `fixtures/chain-v2.json`, and the checks of the Python reader under `conformance/independent/`. A profile that brings the record back starts from that revision and from the text below, under a new version of the custody profile.

## The parked text

This is `spec/managed-custody.md` §6 as it stood at that revision, without its paragraphs on control authorities and recovery, which stay in the standard. Section numbers refer to that document.

After a `TRANSFER` has committed to an acceptance, the holder is a recipient whose keys the custodian keeps, and nothing on the chain distinguishes an `UPDATE` or `RETIRE` the holder asked for from one the custodian wrote on its own: both are made by linkage from the holder's managed identity, which the custodian holds. The profile therefore makes the custodian's authority to write for a holder a recorded thing, exactly as it made the recipient's acceptance one. A custodian writes an `UPDATE` or `RETIRE` for a holder only on the holder's instruction, records that instruction, signs it, retains it, and commits to it in field 15 of the state it writes.

**The instruction record.** An instruction record is a JSON object with exactly the following properties. Unknown properties are refused.

| Property | Requirement |
|---|---|
| `instructionFormat` | The literal `dpp-managed-instruction@1`. |
| `requestId` | The custodian's identifier for the request: non-empty printable text, at most 128 bytes, no C0, C1 or DEL controls. A retry names the same request and never a second one. |
| `passportId` | The passport's identifier, exactly as field 3 carries it, at most 512 bytes. |
| `lineageGenesis` | `{ txid, outputIndex }`: the lineage's genesis outpoint. |
| `expectedPredecessor` | `{ txid, outputIndex }`: the tip the request was made against, which the state must spend. A request names one tip; one made against a tip that has since moved cannot be executed and must be made again. |
| `operation` | `UPDATE` or `RETIRE`: what the holder asked for, which is the state's `op`. |
| `holderIdentityKey` | The key the holder acts under in the state, as field 7 carries it: the holder's identity key when control is proven by linkage, or the controller key itself when it is proven by equality. |
| `requestDigest` | 64 lower-case hexadecimal characters: the SHA-256 of the holder's request as the custodian received it, in the custodian's own canonical form. What the request says is the custodian's; that it cannot be changed afterwards is this field's. |
| `requestedAt` | An ISO 8601 date-time with a timezone. |
| `evidenceKind` | The literal `custodian-attested`, the only kind this version defines, written into the record so that a later kind cannot be mistaken for it. |
| `custodian` | The custodian's identity key, compressed, lower-case hexadecimal. |
| `signature` | The custodian's signature: canonical DER, lower-case hexadecimal, between 8 and 72 bytes. |

The canonical form, the signature and the commitment are those of the acceptance record (§3): the restricted canonical JSON extended to nested objects, the custodian's derived key for `[1, 'dpp managed record v1']`, this record's `requestId` and counterparty `anyone` signing SHA-256 of the canonical bytes without `signature`, verified against the child of `custodian`, and the commitment the state carries in field 15 being the SHA-256 of the canonical bytes of the complete signed record. The instruction record has one version and has only ever been signed this way. A reader reports a record's structure, its signature and its binding as separate findings: `format`, `signature-invalid`, `custodian-unexpected` when a policy names custodians and this one is not among them, and `state-mismatch` for the binding below.

**Binding.** An instruction record binds to a state when all of the following hold, and a reader reports each that does not as `state-mismatch` with the reason: the state's operation equals `operation`; its `passport_id` equals `passportId`; its `lineage_genesis` equals `lineageGenesis`; its `previous_outpoint` equals `expectedPredecessor`; its `actor_identity_key` equals `holderIdentityKey`; its `authorisation_commitment` equals the commitment of the record; and `requestedAt` is not after the state's `timestamp`. The binding is checked from the record and the state alone and needs no custodian online.

**The rule.** Under this profile, once a `TRANSFER` in a lineage has committed to an acceptance, every later `UPDATE` and `RETIRE` of that lineage MUST carry an instruction commitment, unless its actor is a control authority named below. A verifier or index that selects the rule refuses such a state whose field 15 is empty, reporting `instruction-commitment-absent` on `linkage`, while the same bytes are valid under the record model and under the acceptance rule alone; a verifier or index that does not select the rule reads the commitments it meets and demands none. Which a deployment does is declared in §7. Before the first committed `TRANSFER` the holder is the issuer, acting for itself through the custodian, and no instruction is required. What the rule establishes, and a reader does not infer more from it: that the custodian attested to a request matching the state it wrote. It does not prove that the holder made the request, because the holder holds no key; the evidence is custody-dependent, as the acceptance is, and the report's limits say so.

**How a record reaches a stranger.** As an acceptance record does (§5): the custodian includes every instruction record it signs in every evidence package it exports, under `authority` with `representation` `dpp-managed-instruction@1` and `represents` the commitment, and a reader supplies them to its verifier as the history's instruction records.
