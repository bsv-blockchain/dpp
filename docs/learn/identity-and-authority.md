# Identity and authority

Platform designers and reader implementers can use this page to distinguish passport roles, signature evidence and authority. Use the result to name brands accurately and choose which signers your reader accepts at Ring 0.

## Before you start

| Input | Source |
|---|---|
| Package or source version | Your selected [release set](../reference/release-sets.md) |
| Expected passport identifier | The scan or request, before reading evidence |
| Accepted keys and DIDs | Your independently maintained trust lists, never the evidence under test |
| Evidence and verification policy for the optional call | Your reader; see [gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence) |

## Ring 0

Ring 0 is today's identity assurance level in the hosted reference and platforms built on current packages. Only the application registering a signer vouches for its identity. A signature identifies a signing key; a displayed brand or repairer name is the application's uncertified statement.

For your platform:

1. Present brand and issuer names as your statement, not a checked fact. Assigning a brand an identity key gives readers only your word for its label.
2. Retain whom you registered, the evidence used and who may act for each brand.
3. Share identity keys with those readers, for example in your documentation, if you want other platforms' readers to accept them. Each reader [chooses its own trust](#accept-the-parties-you-trust). Indexes advertise admitted publisher keys, but there is no standard brand or issuer key directory ([limitations](../operate/limitations.md)).

Nothing in today's standard or packages raises assurance above Ring 0. A DID, verifiable credential or passing proof does not do so. Two higher rings are described but implemented nowhere:

| Ring | Proposed assurance | Live |
|---|---|---|
| Ring 1 | External instrument, such as a qualified electronic seal, binds a brand DID to a legal entity | No |
| Ring 2 | Certified role for a claim type, such as notified body for a conformity claim | No |

## Who is who

One deployment may combine parties. Keep their roles distinct in application data and policy.

| Party | Role |
|---|---|
| Subject | Product named by its [passport identifier](../identifiers.md) |
| Actor | Makes and signs a state; for example, a brand, repairer or owner |
| Controller (also called owner) | Controls the passport through the key in field 6 of the newest state. Every later state must prove control. Record control does not assert physical or legal ownership. |
| Issuer | Signs a lifecycle claim or credential about the product |
| Custodian | Holds keys and acts for another party ([custody](custody.md)) |
| Publisher | Countersigns each state it admits. An index admits only keys named in its publisher policy ([federation](../operate/federation.md)). |
| Anchoring service | Writes and signs a claim anchor on chain |
| Operator | Runs an index or registry |

Parties sign with their own keys: actor and publisher keys on every state, controller key named in field 6, issuer key on a claim and anchoring-service key on an anchor. [Custody](custody.md) explains the state keys and their holders.

## What a signature proves

A valid signature attributes bytes to a key. It does not establish the holder's identity or entitlement, or the statement's truth. Separate these questions:

| Question | Evidence or decision |
|---|---|
| Which key signed? | Reader checks the bytes |
| Who holds it? | At Ring 0, the registering application's word |
| May that party make this statement? | Your chosen policy |

An application account sits outside all three. Sign-in does not establish the signing key; the signing key does not establish authority for a claim.

## Accept the parties you trust

Pass accepted parties through the `authority` option of `verifyPassportEvidence`: `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`.

| List | Accepted parties |
|---|---|
| `genesisIssuers` | Genesis actor keys |
| `claimIssuers` | Claim issuer DIDs |
| `anchoringServices` | Anchoring-service keys |
| `acceptanceCustodians` | Acceptance custodians |

The `issuerAuthority` check reports:

| Policy input | Result |
|---|---|
| No `authority` option | `unknown` with `policy-missing` |
| No list for a role | `unknown` with `authority-unconfirmed` for a role you give no list for |
| Party excluded by its list | `fail` with `authority-unconfirmed` |

A repairer's signature establishes the signing key. Your policy decides whether to accept that party as a repairer.

## Supply the expected subject

1. Take the expected passport identifier from the scan or request before reading evidence.
2. Supply it as the second argument. This fragment shows the call, not a standalone reader:

   ```js
   const report = await verifyPassportEvidence(evidence, { passportId, source: 'request-context' }, policy)
   ```

3. Inspect `subjectBinding`, which compares every state, claim, anchor and credential with that identifier. Taking the identifier from the evidence would let another product's valid record verify against itself.

[Evidence and its limits](evidence-and-freshness.md#supply-the-expected-subject) explains other subject sources and optional constraints. With no independent expectation (`source: 'none'`), the result is `unknown` with `subject-not-independent`; other checks still run.

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
