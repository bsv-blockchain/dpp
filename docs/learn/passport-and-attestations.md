# Passport states and attestations

Readers and writers can use this page to choose between a passport state and a claim, and understand what each proves. States change the product's record; claims are separate signed statements, for example from a repairer.

## Before you start

| Task | Requirements and source |
|---|---|
| Understand or choose records | No software required |
| Run the optional offline exercises | Node.js 22 or later; a [quick-start checkout](../quick-start.md#check-the-test-passports-offline) prepared with `npm ci` and `npm run build`. Both exercises use test data and need no network. |

## Passport states

A state is a signed record in one small transaction output. Each state after the first spends its predecessor, giving history a single order. The first is the genesis, the newest is the tip, and their chain is the lineage.

New passports use record version 2, with four operations:

| Operation | Permitted change |
|---|---|
| `ISSUE` | Opens the passport; appears only at genesis |
| `UPDATE` | Public payload, owner-tier hash and event data only |
| `TRANSFER` | Controller key naming the next controller, and payload ([custody](custody.md)) |
| `RETIRE` | No payload change; event data may give the reason. Ends the passport; no state may follow. |

| Version | Behaviour |
|---|---|
| 1 | Seven lifecycle operations: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT`, `TRANSFER`. Still readable; the [quick-start live passport](../quick-start.md) is one. |
| 1 to 2 | One `UPDATE` can continue a version 1 passport as version 2 ([compatibility](versions-and-compatibility.md#record-versions-1-and-2)) |
| 2 | Records enforce record rules; claims and profile-defined event data carry meanings such as repair |
| 3 | Parked outside the standard: the token carrier, the version 2 body behind a token prefix ([parked material](../reference/parked/token-carrier/README.md)). Not read or written. |

## What a state carries

| Part | Contents |
|---|---|
| Passport identifier | Product web address, unchanged across states ([identifiers](../identifiers.md)) |
| Public payload, `payload_public` | Public JSON on chain; industry profiles such as battery or textile define fields ([profiles](../profiles/README.md)) |
| Owner-tier hash, `payload_owner_hash` | SHA-256 of restricted data encrypted off chain. Checks a copy; reveals and recovers nothing itself. |
| Keys and signatures | Actor key and signature, controller key, publisher countersignature ([four keys](custody.md#the-four-keys)) |
| Links | Previous state spent and lineage genesis |
| Event data | Optional JSON with profile-defined properties |

Industry profile fields each have an access tier:

| Tier | Readers | Storage |
|---|---|---|
| `public` | Anyone with the identifier | On chain in `payload_public` |
| `owner` | Current passport holder | Encrypted off chain; hash in state |
| `legitimate` | Profile-defined parties with a legitimate interest | Encrypted off chain |
| `authority` | Notified bodies, market surveillance and other authorities | Encrypted off chain |

[The owner tier](../packages/how-the-writer-works.md#the-owner-tier) shows wallet encryption of restricted fields and commitment of their hash. How the `legitimate` and `authority` tiers reach their readers is not settled yet: a state commits to one ciphertext, which reaches whoever holds its key ([known limitations](../operate/limitations.md)).

## Claims and anchors

A claim is a signed product statement separate from passport states. Four pieces make it checkable by anyone:

| Piece | Contents or role |
|---|---|
| Claim | Native format `dpp-lifecycle-v1`: passport identifier, referenced state, event type (`Origin`, `Transfer`, `Transformation` or `Disposition`), time, issuer and issuer signature |
| Issuer | Signer named by a DID. At Ring 0, `did:key` of its identity key suffices ([BSV DIDs](dids.md)). |
| Registry | Validates, stores and serves exact claim bytes |
| Anchor | Small output in format `bsv-attestation-anchor-v1`, committing to exact claim bytes and signed by the anchoring service |

A claim never spends the passport or requires its controller's agreement. A valid claim and anchor establish the signer and unchanged bytes since anchoring, not truth or issuer authority ([identity and authority](identity-and-authority.md)).

A native claim has no payload. Today it records the event type, the time, the issuer and the subject, but not what was done: a repair claim cannot say which part was replaced or who did the work. A mapping to an external event model therefore finds none of the evidence it asks for, and reports `insufficient-data` wherever the profile requires that evidence. Where such details belong is not settled in the standard yet ([known limitations](../operate/limitations.md)).

A W3C verifiable credential a partner issues is a third representation, which the packages verify beside the passport when it uses the supported external profile; native builds do not need it ([verifiable credentials](verifiable-credentials.md)).

## Choose which to create

| Need | Record to create |
|---|---|
| Change the product record | Passport update |
| Keep and check a party's statement independently, such as a repair assessment | Claim |
| Record a changed condition and a signed repair claim | Both, with different signatures and verification paths |

Retrieving an updated passport does not establish that its repair claim was retrieved or checked. Reports separate those results ([evidence and its limits](evidence-and-freshness.md#the-sixteen-checks)).

## See it run

1. Run `node examples/lifecycle-v2.mjs`:

   ```sh
   node examples/lifecycle-v2.mjs
   ```

2. Run `node examples/verify-attestation-anchor.mjs`:

   ```sh
   node examples/verify-attestation-anchor.mjs
   ```

| Exercise | Expected result |
|---|---|
| Lifecycle | `step:` lines show states from `ISSUE` through `UPDATE` and `TRANSFER` to `RETIRE`. Offer and acceptance between them show [managed custody](custody.md#how-a-managed-transfer-works). Ends `Every sentence above holds.` |
| Lifecycle's "A lifecycle claim after retirement, on the other rail" block | Recycler claim and anchor verify after retirement without spending the passport. Rail means their separate transaction path. |
| Anchor verification | Checks one claim and anchor independently; prints six `Holds:` lines |

## Source definitions

| Implementing | Source |
|---|---|
| Passport encoding, signing and transitions | [Record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md) |
| Native claims, their event types and their anchors | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Access tiers and the owner tier | [Profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) section 3, [record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md#7-the-owner-tier-binding) section 7 |
| Historical anchor records | [Historical format](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md) |
| Credential representations | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md), the parked [VSC profile](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/vsc-profile.md) |

The record format selects its source. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists source disagreements. Historical-anchor issuers beyond `did:key` remain an [open decision](../start/status.md#open-decisions); new anchors are unaffected.

## Next

| Task | Guide |
|---|---|
| Write with packages | [Write a passport](../packages/build-an-application.md#3-write-a-passport) |
| Sign claims with packages | [Add a claim](../packages/add-a-claim.md) |
| Implement rules independently | [Passport writer](../implement/roles/passport-writer.md) or [attestation issuer](../implement/roles/attestation-issuer.md) |
| Learn the model | [Identifiers](../identifiers.md), then [identity and authority](identity-and-authority.md) |
