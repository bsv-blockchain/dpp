# Identity and authority

This page explains who is who in a passport, what a signature proves about them, and what "Ring 0" means for what a reader can trust. Read it before you decide how your platform names brands and which signers your reader accepts.

## Ring 0

Ring 0 is the level of identity assurance that exists today, in the hosted reference and in any platform built on the current packages. At Ring 0, the application that registers a signer is the only party vouching for who that signer is. A signature proves which key signed a state or a claim. The name shown beside that key, such as a brand or a repairer, is the registering application's statement, and nothing outside that application certifies it.

What this means for your own platform:

- Your platform is at Ring 0 too. When it gives a brand an identity key and labels it with the brand's name, readers have only your platform's word for that label.
- Show brand and issuer names as your platform's statement, not as a checked fact. Keep your own record of whom you registered, on what evidence, and who may act for each brand.
- A reader on another platform decides for itself which keys it accepts (see [accept the parties you trust](#accept-the-parties-you-trust)). If you want such readers to accept your brands, tell them the identity keys you use, for example in your own documentation. An index advertises the publisher keys it admits, but the standard defines no directory of brand or issuer keys yet ([known limitations](../operate/limitations.md)).
- Nothing in the standard or the packages lets a platform raise its assurance above Ring 0 today. A DID, a verifiable credential or a passing proof does not do it.

Two higher rings are described but implemented nowhere yet:

| Ring | What it would add | Live |
|---|---|---|
| Ring 1 | An external instrument, such as a qualified electronic seal, binds a brand's DID to a legal entity | No |
| Ring 2 | A party's role for a type of claim is certified, such as a notified body for a conformity claim | No |

## Who is who

A passport involves several parties. One deployment can combine them, but keep them apart in your application's data and policy.

| Party | What it does |
|---|---|
| Subject | The product a record concerns, named by its passport identifier ([identifiers](../identifiers.md)) |
| Actor | The party that makes a passport state and signs it, such as a brand, a repairer or an owner |
| Owner, or controller | The party that controls the passport now, named by the controller key in field 6 of the newest state. Each later state must prove control of that key |
| Issuer | The party that signs a lifecycle claim or a credential about the product |
| Custodian | A service that holds keys for another party and acts for it ([custody](custody.md)) |
| Publisher | The service that countersigns each state it admits. An index admits only the publisher keys its publisher policy names ([federation](../operate/federation.md)) |
| Anchoring service | The service that writes a claim's anchor on chain and signs it |
| Operator | Whoever runs an index or a registry |

Each party signs with its own key: the actor key and the publisher key on every state, the controller key named in field 6 of a state, the issuer's key on a claim and the anchoring service's key on an anchor. [Custody](custody.md) explains the keys a state uses and who may hold them.

## What a signature proves

A valid signature attributes bytes to a key. It does not prove who holds the key, that the holder was entitled to make the statement, or that the statement is true. Keep three questions apart:

1. Which key signed? Your reader checks this from the bytes alone.
2. Who holds that key? At Ring 0, only the registering application's word.
3. May that party make this statement? Only a policy you choose answers this.

An application account sits outside all three. Knowing who signed in does not establish which key signed, and knowing which key signed does not establish the party's authority to make a particular claim.

## Accept the parties you trust

A reader names the parties it accepts in the `authority` option of `verifyPassportEvidence`: `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`. These are lists you keep: the genesis actor keys, claim issuer DIDs, anchoring service keys and acceptance custodians you accept. Never take them from the evidence under test. The `issuerAuthority` check reports the result. It reads `unknown` with `policy-missing` when you give no `authority` option, `unknown` with `authority-unconfirmed` for a role you give no list for, and `fail` with `authority-unconfirmed` for a party a list leaves out. [Gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence) shows a reader that passes one.

A repairer's signature establishes which key signed the repair claim. Accepting that party as a repairer is your policy's decision.

## Supply the expected subject

Tell your reader which passport you asked about, taken from the scan or the request, before it reads the evidence. [Evidence and its limits](evidence-and-freshness.md#supply-the-expected-subject) explains why and shows the call.

## Source definitions

| Question | Source |
|---|---|
| How are subjects, keys and roles separated? | [Identity](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md) |
| Which key signs a passport state? | [Record signatures](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [version 2 signatures](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| How is a native claim attributed? | [Claim verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Which publisher keys apply? | [Publisher policy](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) |
| Which authority evidence does the verifier need? | [Verification report](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) |

## Next

| You are | Go to |
|---|---|
| Building with the packages | [Build an application](../packages/build-an-application.md) for the calls in order, and [what a passport application offers](../packages/what-an-application-offers.md) for the account and brand screens |
| Implementing the rules yourself | [Attestation verifier](../implement/roles/attestation-verifier.md) and [passport reader](../implement/roles/passport-reader.md) |
| Still learning the model | [Custody](custody.md), then [evidence and its limits](evidence-and-freshness.md) |
