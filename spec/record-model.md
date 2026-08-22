# The record model

**DPP Token Standard, version 1. Status: working draft, pre-1.0.** This document defines the on-chain record: what one passport state is, how states form a chain, and what a verifier checks. The services around records, the industry data profiles and the attestation anchoring rail are defined in their own documents. Until version 1.0 is declared, the reference implementation in this repository is the tiebreaker where this text is ambiguous.

## 1. Overview

A digital product passport is a chain of token states on the BSV blockchain. Each state is one transaction output carrying the full record; each new state spends the output of the state before it. The history is therefore ordered by the chain itself: a rewrite requires spending an output that is already spent, so tampering is structurally detectable rather than detectable by policy.

Two properties follow, and the standard exists to protect them. A passport verifies from transaction bytes and public block headers alone: no account, no credential from any operator, and no service that must stay online for the record to remain true. And nothing personal is ever on chain: private content lives off chain, encrypted, with only its hash committed in the record.

## 2. The output script

A passport state is a single output whose locking script is:

```
<33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 14> OP_2DROP x7
```

The locking key is custody-neutral: the standard does not care whether it is held by an operator's treasury or by the product's owner. Spending the output is what supersedes the state, whoever holds the key.

The fourteen fields are pushed with minimal-push encoding when writing, and minimal-push has three special cases a reader must decode as data, not only accept: `OP_0` for the zero-length field, `OP_1` to `OP_16` for a single byte `0x01` to `0x10`, and `OP_1NEGATE` for the single byte `0x81`. On reading, `OP_0` decodes to the empty field, never to a single `0x00` byte; the small-integer and negative-one opcodes decode to their byte values. The single byte `0x00` is not a valid field value at all, and a reader refuses it however it is pushed: minimal writing encodes it as `OP_0`, which reads back as the empty field, so admitting it through a non-minimal push would give one value two spellings. Readers must accept non-minimal pushes of non-empty fields, because field bytes, and therefore signature preimages, are unaffected by push encoding; the empty field has exactly one accepted encoding, `OP_0`, and a zero-length `PUSHDATA` is refused. A field the table in §3 declares UTF-8 must be valid UTF-8, refused at decode when its bytes do not decode and re-encode to themselves; for accepted states, decoded text and wire bytes are therefore one thing, which is what lets §5 compute preimages from either.

Exactly one DPP output is permitted per transaction. A transaction carrying two is not a valid state of anything.

## 3. The fourteen fields

| # | Field | Encoding | Rule |
|---|---|---|---|
| 1 | `protocol_marker` | UTF-8 | The string `dpp`. |
| 2 | `version` | UTF-8 | The string `1`. A reader refuses any other value. |
| 3 | `passport_id` | UTF-8 | Non-empty. The record's stable identifier and primary lookup key; immutable across the chain. In practice a GS1 Digital Link URI, so the identifier and the product's web address are one thing. |
| 4 | `op` | UTF-8 | One of the seven operations in §4. |
| 5 | `timestamp` | UTF-8 | ISO 8601, extended format only, with an explicit timezone: `YYYY-MM-DDThh:mm:ss`, optional fractional seconds after a dot, then `Z` or `±hh:mm`, all separators literal and upper case. Basic format, lower-case markers, space separators, comma decimals and colon-less offsets are refused, and the value must name a real calendar instant: a rolled-over date such as 30 February or 29 February outside a leap year is refused even where a host parser would carry it into the next month, and the legacy `24:00` spelling of midnight is refused with it. Actor-asserted; its honesty is bounded by the timestamps of the neighbouring blocks. |
| 6 | `owner_identity_key` | 33 raw bytes | The current owner's compressed public key, in canonical SEC1 encoding. A reader refuses a non-canonical encoding, so the on-chain bytes are the unique representation of the key. |
| 7 | `actor_identity_key` | 33 raw bytes | The compressed public key of the party performing this state change, same canonical rule. This is a BRC-42 parent key; the key that verifies field 13 is derived from it (§5). |
| 8 | `actor_keyID` | UTF-8 | Non-empty. The published key identifier for the actor signature, enabling open verification. |
| 9 | `event_data` | UTF-8 | Valid JSON, or empty. Must be empty on `ACTIVATE` and `EDIT`. |
| 10 | `payload_public` | UTF-8 | Valid JSON. Required, non-empty, on every state: a passport always carries its public tier. |
| 11 | `payload_owner_hash` | 32 raw bytes | SHA-256 of the off-chain encrypted owner-tier blob, or empty when there is none (§7). |
| 12 | `previous_txid` | 32 raw bytes | The txid of the previous state's transaction, big-endian display order. Empty at genesis, required afterwards. |
| 13 | `user_signature` | DER ECDSA | Required. The actor's signature over fields 1 to 12 (§5). |
| 14 | `server_signature` | DER ECDSA | Required. The publishing service's signature over fields 1 to 13 (§5). |

A reader validates the rules in this table at decode time and refuses the output as a whole on any violation, with two deliberate exceptions that span more than one state or stage: field 12's genesis rule is a chain rule checked at verification (§6), so a lone output decodes whatever field 12 holds; and the two signature fields are checked for presence at decode and for validity at verification (§5, §8), so bytes that are not DER decode and then fail to verify.

## 4. Operations

Seven operations: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT`, `TRANSFER`.

- `ACTIVATE` is the genesis operation and is allowed at genesis only.
- `payload_public` and `payload_owner_hash` may change only on `ACTIVATE`, `EDIT` and `TRANSFER`. On every other operation both must be byte-identical to the previous state.
- `owner_identity_key` may change only on `TRANSFER`.
- `event_data` must be empty on `ACTIVATE` and `EDIT`; on every other operation it carries the operation's JSON metadata when there is any, and empty remains legal.

The semantics of an operation (what a repair means, who may assert it) belong to the profiles and services documents; this document fixes only what each operation may change in the record.

## 5. The two signatures

Both signatures are ECDSA over SHA-256 of a preimage of concatenated raw field bytes, made with keys derived under BRC-42 with the BRC-43 protocol identifier `[1, 'dpp token v1']` and counterparty `anyone`. Counterparty `anyone` is what makes verification open: any third party re-derives the verification key from on-chain data alone, with no wallet, no secret and no request to the operator.

**The user signature (field 13)** is the actor's. Preimage: the raw bytes of fields 1 to 12, concatenated in field order, with no delimiters and no serialisation format. Verification key: the BRC-42 child of `actor_identity_key` (field 7) for key identifier `actor_keyID` (field 8), counterparty `anyone`.

**The server signature (field 14)** is the publishing service's countersignature. Preimage: the user preimage followed by the bytes of `user_signature`. Verification key: the BRC-42 child of the service's published identity key for key identifier `passport_id` (field 3), counterparty `anyone`, so a verifier can re-derive the service child key from on-chain data plus the service's published identity.

The server signature is admission policy, not token validity: it says which service published the state, and a verifier that does not care may skip it. The user signature and the chain invariants are what make the record true.

**Framing note.** The preimage is plain concatenation, so the preimage bytes alone do not bind field boundaries. Boundary uniqueness comes from field validation (the operation enumeration, the ISO timestamp, the fixed-width keys and hashes, the JSON rules) together with the chain invariants, which together prevent a re-split state from verifying in any conforming reader. Conformance here means the whole of §3 and §6, not the signature check alone.

## 6. Chain invariants

A passport chain is the ordered sequence of states from genesis to tip. A conforming verifier checks, for every link:

1. Exactly one DPP output in the transaction.
2. The genesis state's operation is `ACTIVATE` and its `previous_txid` is empty.
3. No later state's operation is `ACTIVATE`: the genesis operation at any other position fails the link, however well it satisfies everything below.
4. Every later state's `previous_txid` is non-empty, spends the previous state's DPP output, checked structurally on the transaction's inputs, and equals that transaction's txid. All three checks, not any.
5. `passport_id` never changes.
6. `owner_identity_key` changes only on `TRANSFER`.
7. `payload_public` and `payload_owner_hash` change only on `ACTIVATE`, `EDIT` or `TRANSFER`.

The tip is the one output not yet spent. Spending the tip is the only way to extend the record, which is why the chain needs no registry to order it.

## 7. The owner-tier binding

Restricted content never goes on chain. The owner tier is an encrypted blob held off chain; its SHA-256 digest is committed on chain as `payload_owner_hash`. A reader fetching the blob must hash the ciphertext and compare against field 11 before attempting decryption; a mismatch renders the record unverified. Presenting any blob against a record whose field 11 is empty is a refusal, not a vacuous pass: an empty commitment binds nothing, so nothing can verify against it. Disclosure is cryptographic, not interface-gated: a reader without the key receives nothing decryptable, never hidden fields.

## 8. What a verifier checks

"Verified" means three checks:

1. **Signatures**: the user signature of every state verifies as §5 describes, starting from genesis.
2. **Linkage**: every link satisfies the invariants of §6.
3. **Inclusion**: every mined transaction's merkle path validates against public block headers.

A fourth check is optional and is admission policy rather than record truth: a verifier configured with a publishing service's identity key also verifies every state's server signature (§5), and a chain failing that check reports invalid to that verifier. An index admitting records for a named service runs it; a reader who does not care which service published may omit it, and the record's truth is unchanged either way.

Inclusion has three outcomes, not two. `verified` means the proof validated against the header source. `failed` means the proof was refuted, and refutation comes two ways: the source answered against it, because the root it holds for that height is a different root or the proof fails the source's own acceptance rules; or the proof refuted itself before any source was asked, because it does not contain the transaction it is presented for, a deterministic local finding no outage explains. A proof the verifier cannot evaluate at all, an unreachable source included, is evidence of nothing: the state reports `pending`, the chain does not fail, and the reason travels with the result so an operator can tell an outage from a refutation. A verifier must never let a header service's downtime make a genuine record read as unverifiable.

A chain that fails any check reports invalid as a whole, with the failing state and reason identified. Script execution of the spends is enforced by the network and is not re-evaluated by the verifier.

## 9. Normative and implementation

What any conforming implementation must reproduce: the output script shape, the fourteen fields and their rules, the two signature preimages and derivations, the chain invariants, the owner-tier binding, and verification from transaction bytes and public block headers with nothing else. What is merely a build's own choice, this repository's reference implementation included: wallet basket names, output satoshi values, fee and broadcast arrangements, and which index or lookup service makes records findable. Findability is a service concern; truth is not.
