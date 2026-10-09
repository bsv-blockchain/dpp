# Passport writer

A passport writer builds each new state of a passport, checks it with the reader's own rules, has an index admit it, sends it, obtains its proof and keeps everything it wrote. This page is for anyone adding a writer to a system, in their own code or with the packages.

## Two ways to build a writer

- **With the packages.** `@bsv/dpp-core` builds and checks each state, and a BRC-100 wallet signs, funds and sends it. [Build an application](../../packages/build-an-application.md#3-write-a-passport), step 3, demonstrates a version 2 `ISSUE` and `UPDATE`. The offline lifecycle example below also covers managed transfer and retirement.
- **In your own code.** You build the seventeen fields, both preimages and both signatures yourself (the [starting kit](../README.md#what-you-will-implement) lists the building blocks), and follow the steps below with any BRC-100 wallet.

In both cases, passing the fixture recipe leaves live wallet and service integration to exercise. [What a passport application offers](../../packages/what-an-application-offers.md) describes the screens and scheduled duties around the writer.

## Before you start

These prerequisites apply to live writes. The offline exercises below need only the [reviewed checkout and build](../../quick-start.md#get-the-code).

- **A passport identifier**: a GS1 Digital Link on a host you control, under the demonstration prefix 952 until you have your own ([identifiers](../../identifiers.md)).
- **A BRC-100 wallet with funds** ([choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet)).
- **A publisher key the index admits.** Every version 2 state must carry a publisher countersignature: field 17, `publisher_signature`, the publishing service's signature over the framed fields 1 to 16, verified under the BRC-42 child of the publisher's identity key for key identifier `passport_id` ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 5). An index admits a state only when that key is in its policy, so check that the index's `GET /capabilities` lists your publisher key under `publisherPolicy.publisherKeys`. Writing through your own wallet, its identity key can be the publisher, as step 2 of [build an application](../../packages/build-an-application.md#2-run-your-own-index) sets up.
- **An index URL and its two tokens**: the submit token for `POST /submit` and `POST /retract`, and the callback token for `POST /arc-ingest`. Use [your own index](../../operate/README.md) or a provider that has agreed to admit your key and provide the required access. The hosted reference does not offer general write credentials ([service choices](../../start/choose-components-and-services.md)).
- **An industry profile** for the payload ([industry profiles](../../profiles/README.md)).

## Reproduce the bytes offline

At the root of a checkout, after [setup](../../quick-start.md#get-the-code):

```sh
node examples/write-passport-v2.mjs --dry-run
node examples/lifecycle-v2.mjs
```

The first runs the version 2 issue/update workflow against an in-process index with synthetic funding and proofs, including a refused update without its control proof. The second walks a whole version 2 lifecycle, issue, update, offer, acceptance, transfer and retirement, plus its refusals and a claim after retirement. Both end with `Every sentence above holds.` Neither spends real funds nor broadcasts a transaction.

For the historical version 1 byte target, run:

```sh
node examples/write-passport.mjs --dry-run
```

It prints `ok:` lines showing that the locking script and transaction equal state 1 of `fixtures/chain-v1.json` byte for byte, that the writer's own check accepts the state, and that the same check refuses a forbidden state before anything would be sent. It then prints what it would announce, send, prove and retain.

The [version 2 writer](https://github.com/bsv-blockchain/dpp/blob/aea0afb775c88ecb72bcb1ef83c1c2f03cf7b6c7/examples/write-passport-v2.mjs) is the complete issue/update example used by [build an application](../../packages/build-an-application.md#3-write-a-passport). The [version 1 writer](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/write-passport.mjs) remains for compatibility. Removing `--dry-run` selects a live wallet/service workflow; first establish the required access, network and authority to spend. The usage at the top of each file identifies its arguments.

The version 2 byte targets are `fixtures/record-v2.json` (one state) and `fixtures/chain-v2.json` (five states). Their vector forms, `fixtures/vectors/dpp/record/v2.json` and `fixtures/vectors/dpp/chain/v2.json`, publish the synthetic test private keys in their positive vectors, so a writer in any language reproduces every pinned byte ([run the fixtures](../fixture-runner.md#the-vector-form)).

For a carried passport, record version 3 (`spec/token-carrier.md`), the byte targets are `fixtures/record-v3.json` and `fixtures/chain-v3.json` with their vector forms, `fixtures/vectors/dpp/record/v3.json` and `fixtures/vectors/dpp/chain/v3.json`. A carried state is the version 2 body behind a BRC-162 token prefix, signed under `[1, 'dpp token v3']` and the version 3 tags, and the writer owes two things beyond the lifecycle below: the genesis's carrier output is output 0, so the wallet's output randomisation is off for that one action, and every carried output holds one satoshi. `node examples/lifecycle-v3.mjs` walks a carried lifecycle from fresh keys, issue, update, transfer and retirement, then the carrier's refusals and the burn, offline; it ends with `Every sentence above holds.`

## The write, step by step

The order is the [writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md). Record each step in an operation journal, your own record of every operation, so a retry continues instead of repeating.

1. **Build the state and its transaction, unsent** (section 3). Validate the payload under its profile. Build against the tip you mean to spend, the passport's newest state, which the index's `ls_dpp` lookup returns.
2. **Check it with the reader's rules** (section 2). Decode the locking script you built, check the chain invariants against the tip it spends, verify both signatures, and under `managed-custody@1` bind the acceptance record to the `TRANSFER`. A state that fails is never sent.
3. **Announce it** (sections 3 and 6). `POST /submit` the BEEF, with the predecessor's transaction in the same BEEF and `X-Topics: ["tm_dpp"]`, and send only when the `X-Admission` header reads `tm_dpp=admitted`. `tm_dpp=duplicate` means the index already holds those bytes. A refused state comes back as HTTP 200 with `X-Admission: tm_dpp=none`, nothing admitted, and `X-Admission-Refusal` naming the check that failed ([the codes](../../packages/build-an-application.md#when-the-index-refuses-a-state)). If the index refuses the state, abort the unsent action so the wallet gets its inputs back. An index that cannot be reached is not a refusal: send anyway, and announce the same bytes again later; never build a second state.
4. **Send it, and report only the network's answer** (sections 4 and 5): accepted, rejected, or competing with another spend of the same tip. Spend a tip a second time only after you know the fate of the first spend, and never report a queued broadcast as a written state.
5. **Withdraw a state the network refused.** If the index admitted a state that the network then refused, `POST /retract` the JSON body `{"txid": "...", "outputIndex": 0, "reason": "..."}` behind the submit token ([overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml)).
6. **Prove it** (section 7). When the state is mined, get its merkle path, attach it to the BEEF you keep, and offer it to every index you announced to: `POST /arc-ingest` a JSON body of `txid`, `merklePath` (the path in BRC-74 form) and `blockHeight`, with that index's own callback token.
7. **Keep it** (section 8): the raw transaction, the BEEF it was sent as and the proof, for the passport's life. [Wallet, broadcast and proofs](../../operate/wallet-broadcast-proofs.md) explains the service sequence, and [custody](../../learn/custody.md) explains signing access and managed acceptance.

## Prove it: the writer's self-report

No fixture can show that a state was checked before it was sent or that its proof was kept, so writer conformance is self-reported: one sentence per rule that [writing](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 11 lists, in the style [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) sets. A report that passes every fixture says nothing about a writer until these sentences stand beside it. The six rules are:

1. Section 2: the reader's check runs before any send or announcement.
2. Section 3: the order, announce before send, where you claim to follow it.
3. Section 4: the tip rule (one writer per passport, a tip spent again only once the first spend's fate is known) and the not-yet-written rule (nothing reported as written before the network or the broadcaster has answered).
4. Section 6: a failed announcement never fails a record, and is retried, never rebuilt.
5. Section 7: the proof is obtained, attached and offered.
6. Section 8: the transaction, its BEEF and its proof are retained.

Two sentences in that style, for a fictional writer:

- Section 2: `example-writer` decodes every state it builds, checks it against the tip it spends and verifies both signatures before it calls `POST /submit`; its test `refuses_controller_change_on_update` shows such a state stopped there.
- Section 7: `example-writer` takes each merkle path from its wallet after mining, stores it with the BEEF and posts it to every index it announced to; on its test passport it did so for all four states.

[Evidence reporting](../reporting.md) says how to present them with the rest of your results.

## Known gaps for a writer

These are open questions in the standard and the reference deployment; [known limitations](../../operate/limitations.md) lists the reference service's limits.

- **An older index gives no reason.** An index on an earlier release, or another implementation, may refuse without `X-Admission-Refusal`. Before you announce to one, check the causes you can see yourself: your publisher key is listed in the index's `GET /capabilities`, and your state spends the tip the index's `ls_dpp` lookup returns.
- **Key windows are not published.** The capability document lists publisher keys without the times each is active, and a listed key outside its window is refused the same way as an unlisted one. The windows are in the operator's signed policy chain ([tell operators apart](../../operate/federation.md#tell-operators-apart)).
- **Proofs to peers.** A peer that synchronised your state from your index does not receive its later proof that way, and no one is named yet to deliver it. You can offer each proof to the peers you know as well, with each peer's own callback token, retrying a 404 until the state has arrived there ([when a record does not arrive](../../operate/federation.md#when-a-record-does-not-arrive)).
- **Retraction is not in the self-report list.** The contract's `POST /retract` duty in step 5 is not among the rules writing section 11 lists.
- **Acceptance records have no route.** Keep every acceptance record a `TRANSFER` commits to: a reader needs it, and no index or registry route serves it yet.

## Exact implementation sources

- [spec/writing.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md)
- [spec/managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md)
- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md)

The [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [attestation issuer](attestation-issuer.md) if you also sign claims, or [the trial](../demonstration.md) to have the reference verify what you write.
