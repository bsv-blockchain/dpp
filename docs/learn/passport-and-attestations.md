# Passport states and attestations

A passport has two kinds of record: states, which change the product's record, and claims, which a party such as a repairer signs about the product. This page explains each one, when to write which, and what a reader can conclude from them.

## Passport states

A state is one signed record in a passport's history, carried in one small transaction output. Each state after the first spends the one before it, so the history has a single order. The first state is the genesis, the newest is the tip, and the chain from one to the other is the passport's lineage.

New passports are written as record version 2, which has four operations:

| Operation | What it may change |
|---|---|
| `ISSUE` | Opens the passport. It is the genesis and appears nowhere else |
| `UPDATE` | The public payload, the owner-tier hash and the event data, and nothing else |
| `TRANSFER` | The controller key, which says who controls the passport next, and the payload with it ([custody](custody.md)) |
| `RETIRE` | Nothing in the payload; its event data may give the reason. It ends the passport, and no state can follow it |

Record version 1 had seven operations named after lifecycle events: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT` and `TRANSFER`. Version 1 passports stay readable: the live passport in the [quick start](../quick-start.md) is one. Version 2 keeps in the record only what the record must enforce, and leaves the meaning, such as "this was a repair", to claims and to the event data a profile defines. A version 1 passport can continue as version 2 through one `UPDATE` ([versions and compatibility](versions-and-compatibility.md#record-versions-1-and-2)).

## What a state carries

| Part | What it is |
|---|---|
| Passport identifier | The product's web address, the same in every state ([identifiers](../identifiers.md)) |
| Public payload, `payload_public` | The product data anyone can read, as JSON, on chain. The industry profile, such as battery or textile, chooses its fields ([industry profiles](../profiles/README.md)) |
| Owner-tier hash, `payload_owner_hash` | The SHA-256 of the restricted data, which is encrypted and kept off chain. A reader uses the hash to check a copy; the hash itself reveals nothing and recovers nothing |
| Keys and signatures | The actor's key and signature, the controller key, and the publisher's countersignature ([custody](custody.md#the-four-keys)) |
| Links | The state this one spends, and the genesis of its lineage |
| Event data | Optional JSON whose properties the profile defines |

Each field of an industry profile has an access tier that says who may read it:

| Tier | Who reads it | Where it lives |
|---|---|---|
| `public` | Anyone with the identifier | On chain, in `payload_public` |
| `owner` | The passport's current holder | Off chain, encrypted; the state carries its hash |
| `legitimate` | Parties with a legitimate interest, as the profile defines them | Off chain, encrypted |
| `authority` | Notified bodies, market surveillance and other authorities | Off chain, encrypted |

[Build an application](../packages/build-an-application.md#3-write-a-passport), "Owner tier", shows how to encrypt the restricted fields with the wallet and put their hash in a state. How the `legitimate` and `authority` tiers reach their readers is not settled yet: a state commits to one ciphertext, which reaches whoever holds its key ([known limitations](../operate/limitations.md)).

## Claims and anchors

A claim is a statement a party signs about a product, kept apart from the passport's states. Four pieces make it checkable by anyone:

| Piece | What it is |
|---|---|
| Claim | A native lifecycle claim, format `dpp-lifecycle-v1`: the passport identifier, the state it refers to, one event type (`Origin`, `Transfer`, `Transformation` or `Disposition`), a time, the issuer and the issuer's signature |
| Issuer | The party that signs the claim, named by a DID. At Ring 0 a `did:key` of its identity key is enough ([BSV DIDs](dids.md)) |
| Registry | A service that validates claims, stores them and serves each one's exact bytes |
| Anchor | A small transaction output, format `bsv-attestation-anchor-v1`, that commits to the claim's exact bytes. The anchoring service that writes it signs it |

Writing a claim never spends the passport, and the passport's controller does not have to agree to it. A valid claim with a valid anchor shows who signed it and that its bytes are unchanged since anchoring. It does not show that the claim is true, or that the issuer may make it ([identity and authority](identity-and-authority.md)).

A native claim has no payload. Today it records the event type, the time, the issuer and the subject, but not what was done: a repair claim cannot say which part was replaced or who did the work. A mapping to an external event model therefore finds none of the evidence it asks for, and reports `insufficient-data` wherever the profile requires that evidence. Where such details belong is not settled in the standard yet ([known limitations](../operate/limitations.md)).

Partners that ask for W3C verifiable credentials get a third representation; a native build does not need one ([verifiable credentials](verifiable-credentials.md)).

## Choose which to create

Use a passport update when the product record itself changes. Use a claim when a party makes a statement that should be kept and checked independently, such as a repair assessment. One business event can produce both, but they have different signatures and verification paths.

For example, a repair can update the product's recorded condition and produce a signed repair claim. Finding the updated passport does not establish that the repair claim was retrieved or checked. The reader's report keeps those results separate ([evidence and its limits](evidence-and-freshness.md#the-sixteen-checks)).

## See it run

Run the offline exercises in the [quick start](../quick-start.md#check-the-test-passports-offline), from a checkout after `npm ci` and `npm run build`. What to look for:

- `node examples/lifecycle-v2.mjs`: the `step:` lines from `ISSUE` through `UPDATE` and `TRANSFER` to `RETIRE` are passport states. The offer and acceptance between them are managed custody ([custody](custody.md#how-a-managed-transfer-works)). The block that starts "A lifecycle claim after retirement, on the other rail" is a recycler's claim and its anchor, verifying after the passport has ended without spending it; "rail" there means the separate path claims and anchors travel on. The run ends `Every sentence above holds.`
- `node examples/verify-attestation-anchor.mjs`: checks one claim and its anchor on their own, and prints six lines starting `Holds:`.

Both use test data and need no network.

## Source definitions

| Implementing | Source |
|---|---|
| Passport encoding, signing and transitions | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| Native claims, their event types and their anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Access tiers and the owner tier | [Profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) section 3, [record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md#7-the-owner-tier-binding) section 7 |
| Historical anchor records | [Historical format](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md) |
| Credential representations | [VSC profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/vsc-profile.md), [external credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) |

A record's format selects the source to read. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists where the sources still disagree. Whether the historical anchor format admits issuers other than `did:key` is an [open decision](../start/status.md#open-decisions); new anchors are not affected.

## Next

| You are | Go to |
|---|---|
| Writing passports with the packages | [Build an application](../packages/build-an-application.md#3-write-a-passport), "Write a passport" |
| Signing claims with the packages | [Build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim" |
| Implementing the rules yourself | [Passport writer](../implement/roles/passport-writer.md) or [attestation issuer](../implement/roles/attestation-issuer.md) |
| Still learning the model | [Identifiers](../identifiers.md), then [identity and authority](identity-and-authority.md) |
