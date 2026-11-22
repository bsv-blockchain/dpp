# What the ledger adds

Platform planners deciding whether a passport needs a public ledger at all can use this page to compare the standard with a signed, audited database, see which threats each answers, estimate what the ledger costs and find where supply-chain event data lives. It makes no case that every passport needs one.

## Before you start

No software or credentials are required. [The passport model](architecture.md) explains states, claims and anchors; [known limitations](../operate/limitations.md) lists what is not settled.

## What a signed database already gives you

A product database whose operator signs each record, keeps an append-only log and is audited answers most questions a passport is asked. A reader who trusts the operator gets signed data, a history and a named party to hold to account. That is enough when all of these hold:

| Condition | Why it matters |
|---|---|
| Every reader accepts one operator's word | The operator's signature and its audit are the evidence. Nothing has to be checked without it. |
| The operator will be there for the product's whole life | The history is the operator's to serve. If it stops, the history stops with it. |
| A dispute over what was recorded, and when, is settled by contract or by the auditor | No reader needs to show a third party that a record existed before a given date. |
| Only parties the operator admits add evidence | A repairer or recycler writes through the operator's accounts, under its rules. |
| The product never changes platform | No second system has to continue the same history. |

If they hold for your products, a ledger adds cost and permanence you do not need. The standard's data profiles, identifiers and signed claims are usable without it only in part: the passport's history is defined as a chain of transactions, so a build that drops the ledger is not an implementation of this standard.

## What the ledger adds

Each row is a property a reader can check from public material, with the limit that applies to it.

| Property | How it holds | Its limit |
|---|---|---|
| One order of states that its writer cannot quietly replace | Each state spends the output of the one before it, so a passport has one successor per state. A second history from the same state is a second spend, which a reader's sources report as `conflicting`. | Holds for states in a block. A state the network has not accepted can still be withdrawn ([proofs and retraction](../operate/limitations.md#proofs-and-retraction)). |
| A record existed no later than a block | A state's merkle path checks against block headers, so the block's place in the chain bounds when the state was written. The timestamp inside a state is its writer's statement and is not that bound. | Needs the merkle path and a header source. Without them the `inclusion` check reads `unknown`, never `pass`. |
| Checking without the operator | A reader verifies signatures, links, the subject and inclusion itself, from transaction bytes and block headers obtained from sources it chooses. A service's answer is never the proof. | The reader still has to obtain the bytes. No discovery maps a passport to the indexes that hold it ([finding records](../operate/limitations.md#finding-records)). |
| Evidence from parties the passport's holder does not control | A claim is signed by its issuer and anchored on a separate rail. The issuer needs no account with the passport's writer and no control of the passport. | An anchor shows that a claim's exact bytes were committed. Whether the issuer had authority to make the claim is a separate finding. |
| A history that outlives its first platform | The identifier, the genesis and the history stay as they are when the provider changes. Several independently run indexes can serve the same records. | Someone must keep the bytes. Writers retain transactions, proofs and claims ([export and recovery](../operate/export-import-recovery.md)). |
| Custody that a key proves | Under record version 2 every state after the first proves control, and the controlling key changes only on a transfer. | It proves which key acted. Who holds that key, and on whose behalf, is the application's record. |

## What it does not add

A valid history says who signed what, in which order, and by when. It does not say that:

- The data is true, or the product is authentic. A signature attributes a statement; it does not test it.
- The signer was entitled to sign. Authority is checked against a policy the reader chooses.
- The data will stay available. The ledger holds states and commitments, and claim bytes, restricted evidence and photographs are held off chain by whoever retains them.
- Anything is private. A state's public payload, its keys, its timestamps and the links between transactions are public and permanent. Per-passport keys reduce correlation and promise no anonymity.
- A regulation is met. The standard claims no conformity with any regulation and qualifies no product ([what it does not claim](../README.md#what-it-does-not-claim)). Where a regulation asks the responsible operator for a back-up copy of a passport held by an independent provider, a ledger entry is not that copy: keep the exports the regulation asks for.
- The state you were given is the latest. An index answers for what it holds, and an observation of the latest state is never proof that no later one exists ([is this the latest state](../learn/evidence-and-freshness.md#is-this-the-latest-state)).

## Threats compared

| Threat | Signed, audited database | This standard | What remains |
|---|---|---|---|
| The operator rewrites a past record and signs it again | Found only if an auditor kept an earlier copy | The rewritten state is a second spend of the same output; the mined one stands | A state not yet in a block |
| The operator claims a record was made earlier than it was | Rests on the operator's clock and its auditor | Nobody can show a state existed before its block | The interval between writing and mining |
| The operator stops trading or switches the service off | The history goes with it unless escrowed | Any holder of the bytes can serve and verify the same history | Bytes nobody kept |
| The operator denies a record existed | The reader's own copy against the operator's word | A copy with its merkle path is checked against block headers | A copy kept without its proof |
| A stranger forges a repair or recycling claim | Prevented by the operator's access control | The claim fails its signature, or names an issuer the reader's policy does not accept | A reader that applies no issuer policy |
| The writer publishes false product data | Not prevented | Not prevented | Liability, audits and market surveillance, in both cases |
| An index withholds or serves stale records | The operator is the only source, so undetectable | Another index, or the reader's own copy, shows a later state | A reader that asks one source |
| A signing key is stolen | The operator revokes it in its own system | Signatures under the stolen key still verify; a publisher policy's window and the record's control authorities limit what they are accepted for | Depends on the custody policy in force ([custody](../learn/custody.md)) |

## What it costs

The ledger's own cost is the miner fee, which is a rate times the size of each transaction. Sizes below are from this repository's pinned fixtures, so you can reproduce them; the rate is the `@bsv/wallet-toolbox` default of 100 satoshis per kilobyte, and your wallet's rate may differ.

| Item | Size | Fee at 100 satoshis per kilobyte |
|---|---|---|
| One passport state (`fixtures/chain-v2.json`) | An output script of 0.46 to 0.70 kilobytes, about 0.2 kilobytes more for the funding input and change. Payload size moves it: the worked example's states are about one kilobyte each. | About 70 to 100 satoshis |
| One claim anchor (`fixtures/attestation-anchor-v1.json`) | An output script of 0.50 kilobytes per passport the claim is bound to, in one transaction, plus the same funding overhead | About 70 satoshis for a claim bound to one passport |
| The passport's current output | Holds one satoshi, which the next state spends and re-creates | No fee; one satoshi stays locked per live passport |

To estimate a product line, count transactions: one per state (issue, each update, each transfer, retire) and one per anchored claim.

| Example over a product's life | Transactions | Fees at 100 satoshis per kilobyte |
|---|---|---|
| One passport: issued, updated twice, transferred once, three anchored claims | 7 | About 600 satoshis |
| One million such passports | 7,000,000 | About 6 BSV, since a million one-kilobyte transactions cost about one BSV |

These are miner fees only. Development, hosting, storage, recovery, support and identifier licences are usually the larger part ([plan your platform](plan-your-platform.md)). Three points decide whether the fee model fits your volume:

- **Event data stays off chain.** An EPCIS event is never written to the ledger. A signed claim over one event is anchored by its digest, and only if someone chooses to sign it; an import anchors nothing.
- **One claim, one anchor.** The standard defines no format that commits to many claims under one anchor, such as a merkle root over a batch. A claim bound to several passports is anchored with one output for each, in a single transaction. A deployment that batches commitments is using a format a reader of this standard cannot verify today.
- **Passports do not wait on each other.** Each passport's states form their own chain, so writes to one passport are ordered and writes to different passports are independent. Funding and wallet throughput are the writer's to size.

## Where supply-chain events live

The standard is not an event repository. Events about making, packing, shipping and repairing stay in the systems that recorded them: each party's own EPCIS repository or traceability platform.

| What | Where it lives | What the standard does with it |
|---|---|---|
| EPCIS events as their source recorded them | The source's repository | [Imports and retains](../interoperability/epcis.md) the exact bytes beside a passport, on request. It captures nothing, subscribes to nothing and crawls nothing. |
| A statement that one event concerns a passport | A signed [EPCIS lifecycle claim](../packages/add-a-claim.md#the-epcis-lifecycle-claim), kept by a registry | Carries the event unchanged, binds it to the passports whose products it names, and is anchored once per bound passport. |
| The commitment to that claim | The claim rail on the ledger | A digest, the issuer, the subject and the anchoring service's signature. Never the event. |
| The links between products across the supply chain | The events themselves: aggregations, transformations and transactions | Not derived. A reader who has a passport gets the claims bound to it, and does not get the events of that product's inputs or components unless they are bound to it as well. |

So a reader follows a supply chain by asking each party's repository, as with any EPCIS deployment. The standard adds, for the events someone chose to sign, proof of who signed them and by when.

## Where next

| To | Read |
|---|---|
| See how states, claims and anchors fit together | [The passport model](architecture.md) |
| Scope a platform and its costs | [Plan your platform](plan-your-platform.md) |
| Read what a verification report establishes | [Evidence and its limits](../learn/evidence-and-freshness.md) |
| Know what is not settled | [Known limitations](../operate/limitations.md) |

Sources: [design rationale](https://github.com/bsv-blockchain/dpp/blob/e727a3602857cb084c7358a8f500489553642bf6/spec/design-rationale.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/e727a3602857cb084c7358a8f500489553642bf6/spec/record-model-v2.md), [verification](https://github.com/bsv-blockchain/dpp/blob/e727a3602857cb084c7358a8f500489553642bf6/spec/verification.md), [writing](https://github.com/bsv-blockchain/dpp/blob/e727a3602857cb084c7358a8f500489553642bf6/spec/writing.md), [EPCIS lifecycle claims](https://github.com/bsv-blockchain/dpp/blob/e727a3602857cb084c7358a8f500489553642bf6/spec/epcis-lifecycle-claim.md).
