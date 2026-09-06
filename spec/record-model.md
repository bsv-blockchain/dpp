# The record model

**DPP Token Standard, version 1. Status: working draft, pre-1.0.** This document defines the on-chain record: what one passport state is, how states form a chain, and what a verifier checks. The services around records, the industry data profiles and the attestation anchoring rail are defined in their own documents. Until version 1.0 is declared, the reference implementation in this repository is the tiebreaker where this text is ambiguous.

## 1. Overview

A digital product passport is a chain of token states on the BSV blockchain. Each state is one transaction output carrying the full record; each new state spends the output of the state before it. The history is therefore ordered by the chain itself: a rewrite requires spending an output that is already spent, so tampering is structurally detectable rather than detectable by policy.

Native signatures, supplied-history linkage and transaction inclusion can be verified from transaction bytes and public block-header evidence without an application account. These checks do not establish current ownership, physical truth, issuer accreditation, complete history or VSC credential validity. Restricted owner-tier content lives off chain, encrypted, with its ciphertext hash committed in the record. Public payloads, actor keys and other on-chain metadata remain visible and may be identifying or correlatable.

Record version 2 is defined in [`record-model-v2.md`](record-model-v2.md): a seventeen-field layout with framed, domain-tagged preimages, explicit lineage and predecessor outpoints, a control proof on every operation, a terminal retirement and an authorisation commitment. A reader selects the version by the field count of the output, a version 1 lineage continues under version 2 through the single upgrade transition that document defines, and no version 1 state follows a version 2 state. Nothing in this document changes for a version 1 state, which is read under it for as long as the state exists.

## 2. The output script

A passport state is a single output whose locking script is:

```
<33-byte compressed public key> OP_CHECKSIG <field 1> ... <field 14> OP_2DROP x7
```

The shape is a BRC-48 PushDrop output with the locking key first: the key, `OP_CHECKSIG`, the fields as minimal pushes, then one `OP_2DROP` for each pair of fields, which for fourteen is seven. The two signatures in fields 13 and 14 are ordinary fields, and the template's own appended signature is not used: this record carries two signatures by two parties over two preimages (§5), and a template signature would be one signature by whoever holds the locking key. Naming the shape is for recognition, not for reading. A general-purpose PushDrop decoder is a discovery tool for this layout and not a conforming reader: it decodes `OP_0` as the single byte `0x00` where this document reads the empty field, it stops at the first drop opcode without checking that the tail is exactly seven `OP_2DROP`, and it accepts a 65-byte uncompressed key push where this document requires the compressed one. A conforming reader applies the rules of this section and §3, and the refusal vectors in the fixture are what tell the two apart.

The locking key is custody-neutral: the standard does not care whether it is held by an operator's treasury or by the product's owner. Spending the output is what supersedes the state, whoever holds the key. One convention is pinned so that owners' wallets can hand passports to one another: when the locking key is the owner's, it is the field-6 key itself, spent with the PushDrop unlock for the owner protocol named in §3, and a `TRANSFER` locks the new state to the new field 6. [`custody.md`](custody.md) §3 states the convention and why it is pinned without being preferred.

The fourteen fields are pushed with minimal-push encoding when writing, and minimal-push has three special cases a reader must decode as data, not only accept: `OP_0` for the zero-length field, `OP_1` to `OP_16` for a single byte `0x01` to `0x10`, and `OP_1NEGATE` for the single byte `0x81`. On reading, `OP_0` decodes to the empty field, never to a single `0x00` byte; the small-integer and negative-one opcodes decode to their byte values. The single byte `0x00` is not a valid field value at all, and a reader refuses it however it is pushed: minimal writing encodes it as `OP_0`, which reads back as the empty field, so admitting it through a non-minimal push would give one value two spellings. Readers must accept non-minimal pushes of non-empty fields, because field bytes, and therefore signature preimages, are unaffected by push encoding; the empty field has exactly one accepted encoding, `OP_0`, and a zero-length `PUSHDATA` is refused. A field the table in §3 declares UTF-8 must be valid UTF-8, refused at decode when its bytes do not decode and re-encode to themselves; for accepted states, decoded text and wire bytes are therefore one thing, which is what lets §5 compute preimages from either.

Exactly one DPP output is permitted per transaction. A transaction carrying two is not a valid state of anything.

## 3. The fourteen fields

| # | Field | Encoding | Rule |
|---|---|---|---|
| 1 | `protocol_marker` | UTF-8 | The string `dpp`. |
| 2 | `version` | UTF-8 | The string `1`. A reader refuses any other value. |
| 3 | `passport_id` | UTF-8 | Non-empty, at most 512 bytes. The record's stable identifier and primary lookup key; immutable across the chain. In practice a GS1 Digital Link URI, so the identifier and the product's web address are one thing; when it is, the trade item number inside it is allocated, never chosen, and the paragraph below this table says by whom. The bound exists because this field is also the key identifier of the server signature (§5), and a conforming wallet refuses a BRC-42 key identifier above 800 characters: a field a stranger controls must never be one a stranger can make unsignable, and 512 matches the anchor's subject bound in [`rules.md`](rules.md). |
| 4 | `op` | UTF-8 | One of the seven operations in §4. |
| 5 | `timestamp` | UTF-8 | ISO 8601, extended format only, with an explicit timezone: `YYYY-MM-DDThh:mm:ss`, optional fractional seconds after a dot, then `Z` or `±hh:mm`, all separators literal and upper case. Basic format, lower-case markers, space separators, comma decimals and colon-less offsets are refused, and the value must name a real calendar instant: a rolled-over date such as 30 February or 29 February outside a leap year is refused even where a host parser would carry it into the next month, and the legacy `24:00` spelling of midnight is refused with it. Actor-asserted; its honesty is bounded by the timestamps of the neighbouring blocks. |
| 6 | `owner_identity_key` | 33 raw bytes | The current owner's compressed public key, in canonical SEC1 encoding. A reader refuses a non-canonical encoding, so the on-chain bytes are the unique representation of the key. It SHOULD be the BRC-42 child of the owner's identity key, the root key of the owner's wallet, for the protocol identifier `[1, 'dpp owner v1']`, key identifier `passport_id`, counterparty `self`, so that the invoice number is `1-dpp owner v1-<passport_id>` and a wallet produces the key with `getPublicKey` in one derivation. With counterparty `self` no third party can compute or confirm the child, to reduce direct correlation through owner-key reuse, subject to the disclosure limits [`design-rationale.md`](design-rationale.md) asks of this field; [`custody.md`](custody.md) §2 states what the derivation costs. |
| 7 | `actor_identity_key` | 33 raw bytes | The compressed public key of the party performing this state change, same canonical rule. This is a BRC-42 parent key; the key that verifies field 13 is derived from it (§5). |
| 8 | `actor_keyID` | UTF-8 | Non-empty, at most 256 bytes. The published key identifier for the actor signature, enabling open verification. It is the BRC-42 key identifier of the user signature (§5), bounded for the same reason as field 3. |
| 9 | `event_data` | UTF-8 | Valid JSON, or empty. Must be empty on `ACTIVATE` and `EDIT`. On `TRANSFER` the property name `owner_linkage` is reserved by [`custody.md`](custody.md) §4 and carries nothing else. |
| 10 | `payload_public` | UTF-8 | Valid JSON. Required, non-empty, on every state: a passport always carries its public tier. |
| 11 | `payload_owner_hash` | 32 raw bytes | SHA-256 of the off-chain encrypted owner-tier blob, or empty when there is none (§7). |
| 12 | `previous_txid` | 32 raw bytes | The txid of the previous state's transaction, big-endian display order. Empty at genesis, required afterwards. |
| 13 | `user_signature` | DER ECDSA | Required. The actor's signature over fields 1 to 12 (§5). |
| 14 | `server_signature` | DER ECDSA | Required. The publishing service's signature over fields 1 to 13 (§5). |

A reader validates the rules in this table at decode time and refuses the output as a whole on any violation, with two deliberate exceptions that span more than one state or stage: field 12's genesis rule is a chain rule checked at verification (§6), so a lone output decodes whatever field 12 holds; and the two signature fields are checked for presence at decode and for validity at verification (§5, §8), so bytes that are not DER decode and then fail to verify.

**The trade item number inside a GS1 Digital Link identifier is allocated, never chosen.** When `passport_id` is a GS1 Digital Link URI, the GTIN it carries under application identifier `01` is one the writer is entitled to publish: allocated under a GS1 Company Prefix licensed to the brand the record describes, or allocated to that brand by its GS1 Member Organisation. The company prefix inside a GTIN names one licensee, so a plausible number under a prefix the brand does not hold identifies either somebody else's product or nobody's, and a state published under it is a permanent claim about the wrong object that no later state can retract. A writer MUST NOT publish a state under a GTIN whose prefix is not licensed to the brand the state describes. A record that describes no real object, a demonstration, an example or a test, MUST carry either a GTIN under a prefix the writer holds or one under GS1 prefix 952, the prefix GS1 reserves for demonstrations and examples of its system and never licenses. A number under 952 resolves nowhere at GS1 by design, and a reader MAY read the prefix as the statement that nothing real stands behind the record. The GTIN is written at fourteen digits with leading zeros, as the Digital Link syntax requires, and its check digit MUST be correct when written; a reader is not required to verify it, because whether a number is real was GS1's question at allocation and is not one a reader can answer from the digits. The host in the URI is the writer's to choose. The GS1 Digital Link standard permits any domain, and `id.gs1.org`, the canonical host, answers only for GTINs whose licensee has registered link targets with GS1; a writer therefore SHOULD mint under a host that answers for the identifier it publishes, its own resolver or GS1's once that registration exists, which for a record under prefix 952 is never GS1's. [`../docs/identifiers.md`](../docs/identifiers.md) is the informative account of how a brand obtains a prefix and what each host answers; it names vendors and fees, which this document does not.

An application account is not a GS1 licensee, brand or issuer by definition. Allocation authority attaches to the relevant identified entity and must be established independently of the account used to publish. The GS1 requirements above apply only when a GS1 identifier is selected.

## 4. Operations

Seven operations: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT`, `TRANSFER`.

- `ACTIVATE` is the genesis operation and is allowed at genesis only.
- `payload_public` and `payload_owner_hash` may change only on `ACTIVATE`, `EDIT` and `TRANSFER`. On every other operation both must be byte-identical to the previous state.
- `owner_identity_key` may change only on `TRANSFER`.
- `event_data` must be empty on `ACTIVATE` and `EDIT`; on every other operation it carries the operation's JSON metadata when there is any, and empty remains legal.
- A profile MAY select the owner-signed transfer invariant of [`custody.md`](custody.md) §4, under which a `TRANSFER` must prove that its actor is the previous owner, or be made by a transfer authority the profile names.

The semantics of an operation (what a repair means, who may assert it) belong to the profiles and services documents; this document fixes only what each operation may change in the record.

## 5. The two signatures

Both signatures are ECDSA over SHA-256 of a preimage of concatenated raw field bytes, made with keys derived under BRC-42 with the BRC-43 protocol identifier `[1, 'dpp token v1']` and counterparty `anyone`. Counterparty `anyone` is what makes verification open: any third party re-derives the verification key from on-chain data alone, with no wallet, no secret and no request to the operator.

Concretely, BRC-43 turns a protocol identifier and a key identifier into an invoice number, here `1-dpp token v1-<key identifier>`, and BRC-42 derives the child of a parent public key for that invoice number: the child is the parent plus the generator multiplied by the HMAC-SHA256 of the invoice number under the ECDH shared secret between the deriving private key and the parent. Counterparty `anyone` is the public key of the secp256k1 private key `1`, so a verifier holds the deriving private key by definition and computes the child from the parent, the invoice number and the number one. The signer computes the matching private child from its own root key and the `anyone` public key, and the two agree by the symmetry of ECDH, which is what BRC-42 is for.

**The user signature (field 13)** is the actor's. Preimage: the raw bytes of fields 1 to 12, concatenated in field order, with no delimiters and no serialisation format. Verification key: the BRC-42 child of `actor_identity_key` (field 7) for key identifier `actor_keyID` (field 8), counterparty `anyone`, so the invoice number is `1-dpp token v1-<actor_keyID>`.

**The server signature (field 14)** is the publishing service's countersignature. Preimage: the user preimage followed by the bytes of `user_signature`. Verification key: the BRC-42 child of the service's published identity key for key identifier `passport_id` (field 3), counterparty `anyone`, so the invoice number is `1-dpp token v1-<passport_id>` and a verifier re-derives the service child key from on-chain data plus the service's published identity.

The server signature is admission policy, not token validity: it says which service published the state, and a verifier that does not care may skip it. The user signature and the chain invariants are what make the record true.

Making either signature is the BRC-100 `createSignature` operation with `data` set to the preimage, the protocol identifier above, the key identifier named for that signature and counterparty `anyone`: a conforming wallet hashes the data with SHA-256 and signs with the derived private child, so an actor signs a state from their own wallet and no key leaves it, and a service holding a root key does exactly the same thing. Spending a state is a plain signature against the locking key, which a wallet that derived that key produces with the PushDrop template's unlock. This is where interoperability is measured: a state made by any conforming wallet and a state made by the reference are indistinguishable on chain.

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

An eighth invariant is optional and profile-selected: the owner-signed transfer of [`custody.md`](custody.md) §4, checked by a verifier or index configured for a profile that selects it and by nobody else. It is defined there rather than here because the seven above are what every conforming verifier checks, and it is what a deployment whose lock is not the owner's checks in place of the spend.

The tip is the one output not yet spent. Spending the tip is the only way to extend the record, which is why the chain needs no registry to order it.

## 7. The owner-tier binding

Restricted content never goes on chain. The owner tier is an encrypted blob held off chain; its SHA-256 digest is committed on chain as `payload_owner_hash`. A reader fetching the blob must hash the ciphertext and compare against field 11 before attempting decryption; a mismatch renders the record unverified. Presenting any blob against a record whose field 11 is empty is a refusal, not a vacuous pass: an empty commitment binds nothing, so nothing can verify against it. Disclosure is cryptographic, not interface-gated: a reader without the key receives nothing decryptable, never hidden fields.

Where the ciphertext lives is not fixed, and one arrangement is recommended because it makes field 11 do a second job. An owner-tier blob SHOULD be retrievable by its UHRP content address (BRC-26): UHRP names a file by the SHA-256 of its bytes, so field 11 is already the address, any host may serve the bytes, and the hash check above is what makes the host irrelevant. A reader then needs no registry to find the blob and no trust in whoever served it.

How the blob was encrypted is likewise not fixed, and one scheme is recommended because it keeps the key inside a wallet. The blob SHOULD be AES-256-GCM ciphertext under a BRC-42 symmetric key derived from the owner's identity key with the protocol identifier `[2, 'dpp owner data v1']` and `passport_id` as the key identifier, which is the BRC-2 construction and the BRC-100 `encrypt` and `decrypt` operations behind a wallet boundary; the counterparty is the profile's choice, `self` for a tier only the owner reads, a reader's identity key to share it. The owner's identity key here is the same root the owner key of field 6 derives from (§3), so one wallet holds both with one derivation each; on a `TRANSFER` the giver encrypts the tier to the recipient, with the recipient's identity key as counterparty, and the recipient may re-encrypt to `self` afterwards ([`custody.md`](custody.md) §6). A profile that departs from this scheme states its own, and the binding rule above applies to it unchanged.

## 8. What a verifier checks

"Verified" means three checks:

1. **Signatures**: the user signature of every state verifies as §5 describes, starting from genesis.
2. **Linkage**: every link satisfies the invariants of §6.
3. **Inclusion**: every mined transaction's merkle path validates against public block headers.

A fourth check is optional and is admission policy rather than record truth: a verifier configured with a publishing service's identity key also verifies every state's server signature (§5), and a chain failing that check reports invalid to that verifier. An index admitting records for a named service runs it; a reader who does not care which service published may omit it, and the native signature and linkage results are unchanged either way.

The merkle path is a BRC-74 BUMP, and a chain travels with its proofs and ancestors as BEEF (BRC-62), so one BEEF from an index or a wallet is the whole input to this check. The header source is any function from a merkle root and a block height to one of three answers: that root is the one at that height, it is not, or no answer could be had. Those are the three outcomes below, in that order. A verifier may run its own header source rather than ask a third party's, which is what keeps this check inside the property §1 states: nothing has to stay online for the record to remain true, block headers included. Two consequences follow. A conforming verifier's header source is a configuration and never a fixed party, so the choice to run one's own is the reader's and not the implementer's. And the merkle path is obtained once, by the writer or by an index, from whoever saw the block, and thereafter travels with the record inside its BEEF, so the verifier's one live dependency is the headers themselves, which it may hold; [`writing.md`](writing.md) §7 is where the duty to obtain it lives.

Inclusion has three outcomes, not two. `verified` means the proof validated against the header source. `failed` means the proof was refuted, and refutation comes two ways: the source answered against it, because the root it holds for that height is a different root or the proof fails the source's own acceptance rules; or the proof refuted itself before any source was asked, because it does not contain the transaction it is presented for, a deterministic local finding no outage explains. A proof the verifier cannot evaluate at all, an unreachable source included, is evidence of nothing: the state reports `pending`, the chain does not fail, and the reason travels with the result so an operator can tell an outage from a refutation. A verifier must never let a header service's downtime make a genuine record read as unverifiable. Caching an agreement is safe, because the root at a height changes only in a reorganisation; caching a disagreement is not, because a disagreement is either that reorganisation or a bad proof, and neither is news worth repeating from memory.

A chain that fails any check reports invalid as a whole, with the failing state and reason identified. Script execution of the spends is enforced by the network and is not re-evaluated by the verifier.

## 9. Normative and implementation

What any conforming implementation must reproduce: the output script shape, the fourteen fields and their rules, the two signature preimages and derivations, the chain invariants, the owner-tier binding, and verification from transaction bytes and public block headers with nothing else. An implementation that claims to enforce the owner-signed transfer reproduces the predicate of [`custody.md`](custody.md) §4 exactly, and one that claims the field-6 derivation of §3 reproduces that. What is merely a build's own choice, this repository's reference implementation included: wallet basket names, output satoshi values, fee and broadcast arrangements within the duties [`writing.md`](writing.md) sets on a writer, and which index or lookup service makes records findable. Findability is a service concern; truth is not. Which wallet made a state's signatures is not a choice this document can see: any BRC-100 wallet produces them (§5), and that interface is where a second implementation is measured against the first. Where the keys are kept is likewise invisible here; [`custody.md`](custody.md) defines what the standard requires of them and what it deliberately leaves to a deployment.
