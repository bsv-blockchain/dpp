# Passport writer

Implementers adding a passport writer can use this guide with the packages or their own code. A writer builds each state, checks it with the reader's rules, has an index admit it, sends it, obtains its proof and retains everything it wrote.

## Before you start

| Procedure | Input and source |
|---|---|
| Offline exercises | Node.js 22 or later, npm and the [reviewed checkout and build](../../quick-start.md#get-the-code). Run `npm ci` and `npm run build`, then run examples from the checkout root. |
| Live writes: passport identifier | GS1 Digital Link on a host you control, using demonstration prefix 952 until you have your own ([identifiers](../../identifiers.md)) |
| Live writes: wallet | Funded BRC-100 wallet ([choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet)) |
| Live writes: publisher | A key the index admits under `publisherPolicy.publisherKeys` in `GET /capabilities`. Your wallet's identity key can be the publisher ([application setup](../../packages/build-an-application.md#2-run-your-own-index), step 2). |
| Live writes: index access | URL, submit token for `POST /submit` and `POST /retract`, callback token for `POST /arc-ingest`. Use [your own index](../../operate/README.md) or an agreed provider that admits your key and grants access. The hosted reference offers no general write credentials ([service choices](../../start/choose-components-and-services.md)). |
| Live writes: payload | An [industry profile](../../profiles/README.md) |
| Live example below | Unused prefix-952 identifier, running index naming your key, unlocked funded wallet, network access and authority to spend. Stop until these are established. |

## Two ways to build a writer

- **With the packages.** `@bsv/dpp-protocol` builds and checks each state, and a BRC-100 wallet signs, funds and sends it. [Build an application](../../packages/build-an-application.md#3-write-a-passport), step 3, demonstrates a version 2 `ISSUE` and `UPDATE`. The offline lifecycle example below also covers managed transfer and retirement.
- **In your own code.** You build the seventeen fields, both preimages and both signatures yourself (the [starting kit](../README.md#what-you-will-implement) lists the building blocks), and follow the steps below with any BRC-100 wallet.

In both cases, passing the fixture recipe leaves live wallet and service integration to exercise. [What a passport application offers](../../packages/what-an-application-offers.md) describes the screens and scheduled duties around the writer.

| Version 2 signing rule | Value |
|---|---|
| Required countersignature | Every state carries field 17, `publisher_signature`; an index admits it only when the publisher key is in its policy |
| Signed bytes | Publishing service's signature over framed fields 1 to 16 |
| Verification key | BRC-42 child of the publisher's identity key for key identifier `passport_id` ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md), section 5) |

## Reproduce the bytes offline

Run the version 2 issue/update and lifecycle exercises:

```sh
node examples/write-passport-v2.mjs --dry-run
node examples/lifecycle-v2.mjs
```

| Exercise | Expected result |
|---|---|
| Issue/update | In-process index, synthetic funding and proofs; refuses an update without its control proof |
| Lifecycle | Issue, update, offer, acceptance, transfer and retirement, plus refusals and a claim after retirement |
| Both | End with `Every sentence above holds.`; no real spending or broadcast |

For the historical version 1 byte target, run:

```sh
node examples/write-passport.mjs --dry-run
```

It prints `ok:` lines showing that the locking script and transaction equal state 1 of `fixtures/chain-v1.json` byte for byte, that the writer's own check accepts the state, and that the same check refuses a forbidden state before anything would be sent. It then prints what it would announce, send, prove and retain.

The [version 2 writer](https://github.com/bsv-blockchain/dpp/blob/aea0afb775c88ecb72bcb1ef83c1c2f03cf7b6c7/examples/write-passport-v2.mjs) is the complete issue/update example used by [build an application](../../packages/build-an-application.md#3-write-a-passport). The [version 1 writer](https://github.com/bsv-blockchain/dpp/blob/5bf77e7a858d7b380a0ebcd0f46d2d5eea6393cf/examples/write-passport.mjs) remains as a dry run only: a writer must not start a new lineage at version 1, so without `--dry-run` it refuses and names the version 2 writer. Removing `--dry-run` from the version 2 writer selects a live wallet/service workflow. The invocation below maps the version 2 inputs; each file's usage lists its arguments.

The version 2 byte targets are `fixtures/record-v2.json` (one state) and `fixtures/chain-v2.json` (five states). Their vector forms, `fixtures/vectors/dpp/record/v2.json` and `fixtures/vectors/dpp/chain/v2.json`, publish the synthetic test private keys in their positive vectors, so a writer in any language reproduces every pinned byte ([run the fixtures](../fixture-runner.md#the-vector-form)).

Record version 3, the token carrier, is parked outside the standard ([parked material](../../reference/parked/token-carrier/README.md)), and a writer writes no version 3 state.

## The write, step by step

Follow the [writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/5bf77e7a858d7b380a0ebcd0f46d2d5eea6393cf/spec/writing.md). Record each step in an operation journal so retries continue the same operation.

1. **Build the state and its transaction, unsent** (section 3). Validate the payload under its profile. Build against the tip you mean to spend, the passport's newest state, which the index's `ls_dpp` lookup returns.
2. **Check it with the reader's rules** (section 2). Decode the locking script you built, check the chain invariants against the tip it spends, verify both signatures, and under the managed custody profile bind the acceptance record to the `TRANSFER`. A state that fails is never sent.
3. **Announce it** (sections 3 and 6). `POST /submit` the BEEF, including the predecessor's transaction, with `X-Topics: ["tm_dpp"]`. Follow the announcement table below before sending.
4. **Send it, and report only the network's answer** (sections 4 and 5): accepted, rejected, or competing with another spend of the same tip. Spend a tip a second time only after you know the fate of the first spend, and never report a queued broadcast as a written state.
5. **Withdraw a state the network refused.** If an index admitted a state that the network then refused, `POST /retract` the JSON body `{"txid": "...", "outputIndex": 0, "reason": "..."}` behind the submit token, on every index you announced it to, before you build on the same tip again ([overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml)). A peer that pulled the state from your index keeps it until that peer's operator withdraws it ([federation](../../operate/federation.md#when-a-record-does-not-arrive)).
6. **Prove it** (section 7). When the state is mined, get its merkle path, attach it to the BEEF you keep, and offer it to every index you announced to: `POST /arc-ingest` a JSON body of `txid`, `merklePath` (the path in BRC-74 form) and `blockHeight`, with that index's own callback token.
7. **Keep it** (section 8): the raw transaction, the BEEF it was sent as and the proof, for the passport's life. [Wallet, broadcast and proofs](../../operate/wallet-broadcast-proofs.md) explains the service sequence, and [custody](../../learn/custody.md) explains signing access and managed acceptance.

### Handle announcement outcomes

| Response | Required handling |
|---|---|
| `X-Admission` reads `tm_dpp=admitted` | Send only when admitted |
| `tm_dpp=duplicate` | Index already holds those bytes |
| HTTP 200, `X-Admission: tm_dpp=none` | Nothing admitted; `X-Admission-Refusal` names the failed check ([codes](../../packages/build-an-application.md#when-the-index-refuses-a-state)). Abort the unsent action so the wallet gets its inputs back. |
| Unreachable index | An index that cannot be reached is not a refusal: send anyway, and announce the same bytes again later; never build a second state. |

### Run the version 2 writer live

After the live prerequisites above, use the [application example](../../packages/build-an-application.md#3-write-a-passport). It spends real mainnet satoshis for an `ISSUE` and an `UPDATE`:

```sh
node examples/write-passport-v2.mjs <passportId> http://localhost:8080 \
  --submit-token=<SUBMIT_TOKEN> --callback-token=<ARC_CALLBACK_TOKEN> \
  --wait-proof=30 --journal=./dpp-journal
```

| Argument | Source or meaning |
|---|---|
| `<passportId>` | Your unused identifier; the demonstration writer refuses identifiers outside prefix 952 |
| `<indexUrl>` | Your own index, shown as `http://localhost:8080`; required, never defaulted to the hosted reference |
| `--submit-token=<t>` | Index operator's submit token for your publisher key, or its operator-wide `SUBMIT_TOKEN`; 401 or 403 stops the run |
| `--callback-token=<t>` | Index operator's callback token for your key, or its `ARC_CALLBACK_TOKEN`, sent as `X-Callback-Token` for proofs |
| `--wait-proof=<minutes>` | Wait for each wallet merkle path; default 0. With 30, prove each state before writing the next, about two blocks in total. |
| `--originator=<host>` | Hostname the wallet knows the program by; default `localhost` |
| `--journal=<dir>` | Journal directory; default `./dpp-journal` |

An operator running the Compose preset hands you a connection file from `dpp-index connection`: its `INDEX_URL`, `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN` supply these three. Command-line tokens remain in shell history; use replaceable secrets. Stay for wallet prompts: an unanswered prompt stops the run and the journal records progress. Success ends `Every sentence above holds.` with exit code 0 and a journal file in `dpp-journal/` named for the identifier's digest.

## Prove it: the writer's self-report

Fixtures cannot show that a state was checked before sending or its proof retained. Writer conformance therefore needs one sentence per rule in [writing](https://github.com/bsv-blockchain/dpp/blob/5bf77e7a858d7b380a0ebcd0f46d2d5eea6393cf/spec/writing.md) section 11, in the [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) style. Passing every fixture says nothing about a writer without these seven sentences:

1. Section 1: no new lineage starts with a version 1 genesis, and a version 1 lineage continues through the version 2 upgrade.
2. Section 2: the reader's check runs before any send or announcement.
3. Section 3: the order, announce before send, where you claim to follow it.
4. Section 4: the tip rule (one writer per passport, a tip spent again only once the first spend's fate is known) and the not-yet-written rule (nothing reported as written before the network or the broadcaster has answered).
5. Section 6: a failed announcement never fails a record, and is retried, never rebuilt.
6. Section 7: the proof is obtained, attached and offered.
7. Section 8: the transaction, its BEEF and its proof are retained.

Two sentences in that style, for a fictional writer:

- Section 2: `example-writer` decodes every state it builds, checks it against the tip it spends and verifies both signatures before it calls `POST /submit`; its test `refuses_controller_change_on_update` shows such a state stopped there.
- Section 7: `example-writer` takes each merkle path from its wallet after mining, stores it with the BEEF and posts it to every index it announced to; on its test passport it did so for all four states.

[Evidence reporting](../reporting.md) says how to present them with the rest of your results.

## Known gaps for a writer

These standard and deployment questions remain open. [Known limitations](../../operate/limitations.md) lists the reference service limits.

- **An older index gives no reason.** An index on an earlier release, or another implementation, may refuse without `X-Admission-Refusal`. Before you announce to one, check the causes you can see yourself: your publisher key is listed in the index's `GET /capabilities`, and your state spends the tip the index's `ls_dpp` lookup returns.
- **Key windows are not published.** The capability document lists publisher keys without the times each is active, and a listed key outside its window is refused the same way as an unlisted one. The windows are in the operator's signed policy chain ([tell operators apart](../../operate/federation.md#tell-operators-apart)).
- **Proofs to peers.** A peer that synchronised your state from your index does not receive its later proof that way, and no one is named yet to deliver it. You can offer each proof to the peers you know as well, with each peer's own callback token, retrying a 404 until the state has arrived there ([when a record does not arrive](../../operate/federation.md#when-a-record-does-not-arrive)).
- **Acceptance records have no route.** Keep every acceptance record a `TRANSFER` commits to: a reader needs it, and no index or registry route serves it yet.

## Exact implementation sources

- [spec/writing.md](https://github.com/bsv-blockchain/dpp/blob/5bf77e7a858d7b380a0ebcd0f46d2d5eea6393cf/spec/writing.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md)
- [spec/managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md)
- [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md)

The [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [attestation issuer](attestation-issuer.md) if you also sign claims, or [the trial](../demonstration.md) to have the reference verify what you write.
