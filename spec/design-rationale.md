# Design rationale

**Status: working draft, pre-1.0.** This document states why the standard's settled choices are what they are. It is deliberately short and deliberately present: a standard that publishes rules without reasons invites relitigating each rule as though it were an oversight. Nothing here is normative; the normative documents are [`record-model.md`](record-model.md), [`rules.md`](rules.md), [`services.md`](services.md) and [`identity.md`](identity.md). What this document defends is settled for version 1; challenges are welcome through the process `GOVERNANCE.md` describes, and are expected to engage the stated reason, not just the rule.

## One property above all the others

Every choice below serves one property: **a stranger can check a record with the transaction bytes and public block headers alone.** No account, no credential, no API key, and no service that has to stay online, stay honest or stay in business for the record to remain true. Where a choice traded convenience against that property, the property won, and this document records what was traded away.

## Why a spend chain, not a registry

A passport's history is ordered by the chain itself: each state spends the output of the state before it, so the ordering is enforced by the same consensus that orders every other transaction, and a rewrite requires spending an output that is already spent. The alternative, whether a registry, a log or a sequence number, makes some operator's database the arbiter of order, and the property above dies in that database. The spend chain also answers "which state is current" with no service at all: the tip is the one output not yet spent. What was traded away: extending a record requires the key that can spend its tip, so writing is custodial in a way an append-only log is not. The standard accepts that, and keeps the locking key custody-neutral so *who* holds it is a deployment's choice, not the format's. [`custody.md`](custody.md) lays out that choice and what each way of making it costs.

## Why two signatures on one state

The actor's signature makes the claim; the publishing service's countersignature says who published it. They are deliberately unequal: the user signature and the chain invariants are what make a record true, and the server signature is admission policy. An index admitting records for a named service checks it, and a verifier who does not care which service published may skip it without weakening anything. Folding the two into one signature would either make the publisher unaccountable or make the record's truth depend on the publisher, and both are worse than carrying two fields.

## Why key derivation is public

Both signatures verify against BRC-42 child keys derived with counterparty `anyone`. That choice is what makes verification open: any third party re-derives the verification key from on-chain data plus a published identity key, with no wallet, no secret and no request to anyone. A derivation the verifier cannot perform is a verification the operator performs on their behalf, which is the dependence this standard exists to remove. The same derivation idiom is used on both rails, record signatures and anchor attribution alike, so one verification recipe covers the whole standard.

## Why the preimage is plain concatenation

The signature preimages are concatenated raw field bytes: no JSON, no length prefixes, no serialisation format. A serialised preimage puts a serialiser on the verification path, and two serialisers that disagree about one edge case turn one record into two truths. Concatenation has a known cost, that the preimage bytes alone do not bind field boundaries, and the record model pays it openly: boundary uniqueness comes from the field rules themselves (the operation enumeration, the timestamp grammar, the fixed-width keys and hashes, the JSON rules), which conforming readers must enforce in full. The anchor rail, whose free-text fields cannot be bounded that way, uses a length-delimited preimage instead: the same trade, decided the other way, for stated reasons ([`rules.md`](rules.md) §5). The pair is deliberate: each rail binds its boundaries with the cheapest mechanism that actually closes the attack.

## Why the reader is strict

A conforming reader refuses non-canonical key encodings, non-minimal empty pushes, invalid UTF-8, rolled-over calendar dates and every other case where one value could be spelled two ways. Leniency in a reader is not kindness; it is a second dialect. Two readers that disagree about what decodes are two standards, and an index that admits what another refuses forks the record set silently. Every strictness rule in the record model exists to keep one value one spelling, so that byte equality, digest equality and record equality stay the same question.

## Why two rails, never one output

The record rail says what this thing is and what happened to it; the anchor rail says who claimed that, and when the claim existed. They never share an output, and stopping either leaves the other verifying. The rails stay separate because a merged output would couple the record's lifetime to the attestation service's availability and put attestation content a step away from the chain, and because the two rails have different privacy budgets, with the record carrying its public tier by design while the anchor rail is built so attestation content *structurally cannot* reach the chain, because only the digest is written.

## Why the anchor carries its query in the clear

An anchor carries the issuer's DID, the subject and the lifecycle type as plain fields, not hidden behind the digest. An indexer holding only the output can therefore answer "what has this party attested", which is the whole of a DID-keyed lookup, without holding any attestation. And the anchor attributes itself: the locking key must derive from the anchoring service's published identity key, so a shared index can carry anchors from services it has never been configured to know and still say, checkably, whose each one is. The two parties in an anchor are deliberately distinct: the issuer made the claim, the anchoring service wrote the output, and the format proves the second while merely repeating the first.

## Why the canonical bytes refuse instead of handling

The attestation's canonical form is a deliberate subset of JCS that refuses everything outside it, rather than an implementation of JCS. Canonicalisation bugs are agreement bugs: two implementations that silently mishandle the same rare case agree with each other and disagree with the third implementation that got it right. Under a refusing canonicaliser, two honest encoders of one claim produce identical bytes or an error, never a second encoding. The cost is that some legal JSON cannot be attested; that JSON was never needed, and admitting it would buy expressiveness with divergence.

## Why nothing personal is on chain

Public payloads are public forever; a blockchain deletes nothing. So the standard's privacy posture is structural, not policy: the owner tier is an encrypted blob held off chain with only its hash committed, disclosure is cryptographic rather than interface-gated (a reader without the key receives nothing decryptable, never hidden fields), and the anchor rail commits digests only. Owner keys derive per passport from the owner's own root with counterparty `self` ([`record-model.md`](record-model.md) §3), so a holder cannot be correlated across the records they own, a property that quietly disappears the moment one stable owner key is reused, which is why the derivation is a rule of the record model and not an implementation nicety. The rule has a stated limit: an owner who acts names their root in field 7, so their actions correlate where their holdings do not, and a passport whose owner proved consent by linkage is tied to that root for good ([`custody.md`](custody.md) §2 and §4).

## Why the lock is one key

A state is locked to one compressed key and `OP_CHECKSIG`, and nothing else: no multisig, no timelocked recovery path, no issuer override in the script. That is a version-1 trade, made for a shape every scanner and every PushDrop-aware wallet already recognises, and it has a cost this document names rather than hides: joint custody cannot live in the script, and a lost key that holds the lock freezes the passport at its tip. Version 1 handles consent without touching the script, by the spend when the owner holds the lock and by the optional owner-signed transfer when anyone else does ([`custody.md`](custody.md) §3 and §4); recovery is a transfer by a named authority, never a second path in the output. Whether a later layout should carry a richer lock is a version-2 question, and it is recorded here so that the single key is read as a decision and not an oversight.

## Why no service is mandatory

Every service, the index, the registry and a verification page alike, affects findability and convenience, never truth. Announcing to an index is discoverability, not existence: a record broadcast but never announced is less findable and no less true, and a conforming writer must not fail a record over a failed announcement. This is the property that makes the service layer competitive rather than custodial: an operator's copy and a stranger's copy of any service are interchangeable, because neither is load-bearing for what a record means.

## Why the writer has duties

The property protects a verifier who holds transaction bytes and merkle proofs; it says nothing about how those came to exist, and a record nobody proved or kept is true and gone. [`writing.md`](writing.md) answers that gap, and it is deliberately a document about outcomes rather than infrastructure: a state is checked before it is sent, a tip is spent once and its fate learnt before it is spent again, a state is not called written until the network has answered, the proof is obtained and kept and offered to the index, the bytes are retained for the passport's life. Every one of those can be met with any wallet, any broadcaster and any index, which is why none is named. The reference application, which met none of them and whose index answers read `pending` for life, is the evidence that stating them was necessary; stating them as outcomes is what keeps the standard neutral about the stack beneath.

## Why the trade item number comes from GS1

The identifier and the product's web address are one string, which is the whole convenience of a GS1 Digital Link, and it has a consequence the record model states rather than assumes: the GTIN inside that string is not the writer's to invent. A company prefix is licensed to one company by its GS1 Member Organisation, so a plausible number under a prefix a brand does not hold is either somebody else's product or nobody's, and a state published under it is a permanent claim about the wrong object. The reference demonstration is the evidence. Until 2026-09-05 it minted every record under GS1's own published example, `09506000134352`, on the reasoning that GS1's number was the honest choice for data nobody had registered anywhere; an external review that day pointed out that the number is a live GTIN registered to GS1 Global Office for its fictional Dal Giardino brand, with complete product data in the GS1 Registry, and that GS1's resolver redirects the demonstration's own paths to a risotto page. A confident redirect to someone else's product is worse than no answer at all. GS1 reserves prefix 952 for demonstrations and examples of its system and never licenses it, so a number under it resolves nowhere at GS1 by design and says what it is to anyone who reads the prefix. That is why [`record-model.md`](record-model.md) §3 requires it of any record that describes no real object and is not published under a prefix the writer holds, and why a record should be minted under a host that answers for it. A licensed prefix belongs to the first real product, not to a demonstration dressed as one.

## Why pre-1.0 says so

Everything publishes as a working draft because parts of the standard are still proposals between implementing parties, and a standard that hides that invites building on sand. Until 1.0, the reference implementation in this repository is the tiebreaker where the text is ambiguous, with the recorded exception that a named implementation defect is a defect, not licence. Declaring 1.0 is a governance act, not a milestone of enthusiasm, and it belongs to the change process `GOVERNANCE.md` describes.
