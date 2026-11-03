# How the writer example works

Application developers can use this walkthrough of `examples/write-passport-v2.mjs` to integrate its state construction, checks, submission and retention into their own writer. Run the complete example first; the implementation blocks below are fragments, not standalone programs ([write a passport](build-an-application.md#3-write-a-passport)).

A passport is a lineage of states, from the genesis, the `ISSUE`, to the tip, the newest state, whose output nothing has spent yet. Every later state spends the tip.

## Before you start

| Task | Required inputs and source |
|---|---|
| Run the complete example offline | Node.js 22 or later, npm and git; use [Get the code](../quick-start.md#get-the-code) to download and build the checkout with `npm ci` and `npm run build`. Run the command below from its root |
| Read the fragments | Use the variables listed below and the complete `examples/write-passport-v2.mjs` for their surrounding code |
| Run live | Complete the wallet, identifier and index setup in [write a passport](build-an-application.md#3-write-a-passport), including authorised signing, funds and submission/proof access |

```sh
node examples/write-passport-v2.mjs --dry-run
```

The dry run needs no wallet, funds or network. Success ends with `Every sentence above holds.` and exit code 0. Stop on `FAIL:` and investigate before writing live.

## Fragment inputs

| Variable | Source |
|---|---|
| `wallet`, `passportId` | The complete example's `WalletClient` and the identifier you supply |
| `identityKey`, `controllerKey`, `controlLinkage` | Wallet calls in the keys fragment |
| `profile`, `publicFields`, `restrictedFields` | The selected product profile and your payload objects, checked against its public and restricted schemas |
| `payloadOwnerHash`, `ciphertext` | The owner-tier encryption fragment |
| `authorityKey` | The identity key of the authority receiving a disclosure |
| `created`, `created.tx`, `stateTx`, `earlierStates` | The wallet's draft action, its BEEF, the transaction read from that BEEF, and previously written transactions oldest first |
| `indexUrl`, `submitToken`, `callbackToken` | Your index's URL, submit token and `ARC_CALLBACK_TOKEN` |
| `beef`, `txid` | The action's `created.tx` and `created.txid` |
| `tipBeef`, `tipTxid`, `tipOutputIndex` | The journal's tip BEEF, transaction identifier and output number |
| `nextState` | The signed `UPDATE` built from the new data and tip |

## Check before you spend

Check these before building anything. Refused inputs cost nothing at this point; a mined state cannot be undone.

- **The identifier.** Parse it with `parseGs1DigitalLink` from `@bsv/dpp-profiles`, and refuse it if its check digit fails or its GTIN is not under prefix 952 (`identifierProblems`).
- **The payloads.** Check each public payload against its profile's schema and each owner-tier object against the restricted schema, as [check a payload against its profile](dpp-profiles.md#check-a-payload-against-its-profile) shows. A reader's report checks the public payload only when it is given the profiles package's validator, so check before you write. The example starts from `node examples/sample-payload.mjs general@2 --demonstration` and revises one field in the `UPDATE`. Check your own file with `node examples/sample-payload.mjs --check general@2 payload.json`.
- **The keys.** Read keys and reveal linkage before the first spend so a refused approval costs nothing. Obtain signing and spending approvals for each transaction.
- **The index.** `GET /capabilities` must name your publisher key, and `POST /lookup` must find nothing for your identifier, so the `ISSUE` is the genesis and not a second one.

## Keys

All three values come from the wallet, and no key leaves it.

| Name | What it is | Where it appears |
|---|---|---|
| Identity key | The wallet's root public key. It signs each state as the actor, the party making the change, and as the publisher, the party that countersigns it | `actorIdentityKey`, field 7, and the publisher signature |
| Controller key | The identity key derived for this passport, in the same wallet, under `[1, 'dpp owner v1']` (`OWNER_PROTOCOL_ID` in `@bsv/dpp-protocol`), with the passport identifier as key identifier and counterparty `self` | `ownerIdentityKey` in the package's state data, field 6 of the record, and the key every state's output is locked to |
| Control linkage | The scalar that proves the controller key came from the identity key | `controlLinkage`, field 14, on every state after the genesis |

The actor's identity key is not the controller key, so every later state carries the linkage to prove control of the state it spends. A state without it is refused ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6). The wallet reveals the linkage to itself, your application decrypts it once, and it is then public on chain.

Fragment from `run` in `examples/write-passport-v2.mjs`:

```js
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
const controllerKey = await ownerKeyFor(passportId, wallet)
const controlLinkage = await decryptOwnerLinkage(await revealOwnerLinkage(passportId, wallet, identityKey), wallet)
```

`ownerKeyFor`, `revealOwnerLinkage` and `decryptOwnerLinkage` come from `@bsv/dpp-protocol`. Then check the result with `verifyOwnerLinkage(identityKey, controllerKey, controlLinkage)`, as the example does.

## The owner tier

A profile's restricted fields, every tier but `public`, form the owner tier and never go on chain. Encrypt them with the wallet, keep the ciphertext off chain, and put only its hash in the state ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 7). `@bsv/dpp-protocol` does not export the protocol `[2, 'dpp owner data v1']`, so copy it from that section.

Fragment from `sealOwnerTier`. `restrictedFields` must pass `readRestrictedPayloadSchema(profile)`, such as `{ serviceNotes: '...' }` for `general@2`:

```js
const { ciphertext } = await wallet.encrypt({
  plaintext: Utils.toArray(JSON.stringify(restrictedFields), 'utf8'),
  protocolID: [2, 'dpp owner data v1'],
  keyID: passportId,
  counterparty: 'self',
})
const payloadOwnerHash = ownerBlobHash(ciphertext)
```

1. Before building a state, check `verifyOwnerBlob(ciphertext, payloadOwnerHash)` and use `wallet.decrypt` with the same protocol, key identifier and counterparty.
2. Keep `payloadOwnerHash` empty when there are no restricted fields.
3. For a `TRANSFER`, encrypt again with the recipient's identity key as counterparty and commit the new ciphertext's hash. The recipient decrypts with your identity key as counterparty.
4. Retain the ciphertext; the example uses its journal. The chain holds only the hash and the wallet only encrypts and decrypts. Lost ciphertext cannot be reconstructed: encrypting identical text produces different bytes.

Record model section 7 recommends the UHRP (BRC-26) content address, the hash already in the state, so readers need no registry. Serve the retained bytes yourself or through any UHRP host. To print each state's address, save this as `uhrp-addresses.mjs` and run `node uhrp-addresses.mjs dpp-journal/passport-<digest>.json`. Create a sample journal with `node examples/write-passport-v2.mjs --dry-run --journal=./dpp-journal`:

```js
import { readFileSync } from 'node:fs'
import { StorageUtils, Utils } from '@bsv/sdk'

const journal = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const state of journal.states) {
  console.log(state.op, StorageUtils.getURLForHash(Utils.toArray(state.ownerTier.hash, 'hex')))
}
```

**Disclose to another party.** The `legitimate` and `authority` fields belong to the object encrypted to yourself. Disclose only the entitled party's fields with the same `encrypt` call, using that party's identity key as counterparty ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 7). For a market-surveillance authority with `authorityKey` and the sealed `restrictedFields`:

```js
const manifest = readManifest(profile)
const tiersFor = new Set(['legitimate', 'authority'])
const disclosed = Object.fromEntries(
  Object.entries(restrictedFields).filter(([key]) => tiersFor.has(manifest.fields.find((f) => f.pointer === `/${key}`)?.accessTier)),
)
const { ciphertext: disclosure } = await wallet.encrypt({
  plaintext: Utils.toArray(JSON.stringify(disclosed), 'utf8'),
  protocolID: [2, 'dpp owner data v1'],
  keyID: passportId,
  counterparty: authorityKey,
})
```

Deliver `disclosure` off chain; the authority decrypts with your identity key as counterparty. A legitimate-interest recipient gets only `legitimate` fields. The disclosure has no on-chain commitment. It states what the committed tier holds, attributed to you by derivation. Your deployment decides entitlement and how recipients prove it ([what is not settled](build-an-application.md#what-is-not-settled)).

## Issue

Build the genesis with `completeState`, which signs as actor and publisher. Use `buildLockingScript` to lock its output to the controller key, then ask the wallet for an unsent transaction.

| Field | Construction rule |
|---|---|
| `previousOutputIndex`, `lineageGenesis` | `null` for genesis |
| `actorKeyId` | Key identifier for deriving the actor signature: any text of 1 to 256 bytes, unchanged across this writer's states; `writer` in the example |
| `eventData` | JSON or empty; empty in the example. Profiles define its properties, but none is defined yet for an update or retirement |

Fragment from `writeState` and `liveAdapter`:

```js
const state = await completeState({
  version: '2', op: 'ISSUE', passportId,
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  actorIdentityKey: identityKey, actorKeyId: 'writer', ownerIdentityKey: controllerKey,
  eventData: '', payloadPublic: JSON.stringify(publicFields), payloadOwnerHash,
  previousTxid: '', previousOutputIndex: null, lineageGenesis: null,
  controlLinkage: '', authorisationCommitment: '',
}, wallet, wallet)

const created = await wallet.createAction({
  description: 'dpp issue',
  outputs: [{ lockingScript: buildLockingScript(state, controllerKey).toHex(), satoshis: 1, outputDescription: 'dpp passport state', basket: 'dpp' }],
  options: { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false },
})
```

`created.tx` is the unsent transaction as BEEF, and `created.txid` its identifier. An issue needs no signature from your application, so the wallet returns it already signed, with no `signableTransaction`.

## Check, announce, send

1. **Check the draft.** Run the verifier's rules over `earlierStates`, empty for genesis, followed by `stateTx`, read with `Transaction.fromAtomicBEEF(created.tx)`. Fragment from `writeState`:

```js
const checked = await verifyChain([...earlierStates, stateTx], {
  chainTracker: 'scripts only',
  serverIdentityKey: identityKey,
  managedAcceptance: true,
})
if (!checked.valid) console.log(checked.error) // then abort the unsent action and send nothing
```

`'scripts only'` skips the header check, since nothing is mined yet, but still checks the signatures, the link to the tip and the control proof.

2. **Announce.** `POST /submit` takes the BEEF, submit token and passport-state topic `tm_dpp`. Simplified fragment from `announce`:

```js
async function announce(indexUrl, submitToken, beef) {
  let response
  try {
    response = await fetch(`${indexUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': JSON.stringify(['tm_dpp']), Authorization: `Bearer ${submitToken}` },
      body: new Uint8Array(beef),
    })
  } catch {
    return 'unreachable' // no answer is not a refusal: send anyway, and announce again after the send
  }
  if (response.status === 401 || response.status === 403) return 'unauthorised' // the token or the address is wrong
  if (response.status === 400) return 'refused'
  const admission = response.headers.get('x-admission') ?? ''
  if (admission.includes('tm_dpp=none')) return 'refused' // X-Admission-Refusal says why
  return admission.includes('duplicate') ? 'duplicate' : 'admitted'
}
```

| Admission outcome | Required action |
|---|---|
| `admitted` | Send |
| `duplicate` | Send; the index already holds those bytes |
| `unreachable` | Send, then announce again; no answer is not a refusal |
| `refused` or `unauthorised` | Abort and stop while the draft has cost nothing. Announcing after sending cannot fix the address or token |

[Refusal codes](build-an-application.md#when-the-index-refuses-a-state) explain `X-Admission-Refusal`.

An unsent action holds wallet inputs until sent or aborted. Pass drafts that fail your own check or index admission to `abortAction`:

| Draft or result | Handling |
|---|---|
| State spending the tip | Pass `created.signableTransaction.reference` |
| Issue, which has no reference | `@bsv/wallet-toolbox` accepts `wallet.abortAction({ reference: created.txid })` |
| `{ aborted: false }` | The network already knows the transaction. The wallet returns this instead of throwing; do not build again |

3. **Send.** A second `createAction` names the unsent transaction. Report only the wallet's answer. Fragment from `liveAdapter`:

```js
const result = await wallet.createAction({ description: 'dpp send', options: { sendWith: [txid], acceptDelayedBroadcast: false } })
const status = result.sendWithResults?.find((r) => r.txid === txid)?.status
```

| Network result | Meaning and action |
|---|---|
| `unproven` | Accepted; the state exists, pending mining |
| `sending` | No answer yet. Wait; do not rebuild |
| `failed` | The state never existed and nothing was spent. If the index admitted it, withdraw it with `POST /retract`, passing `{ txid, outputIndex, reason }` behind the submit token |

## Prove

1. Wait for mining and for the wallet to attach the merkle path, its proof of inclusion.
2. Read the path and push it to the index. Announcing the state again leaves the index's copy unproven.

Fragment from `waitForProof` and `pushProof`:

```js
const outputs = await wallet.listOutputs({ basket: 'dpp', include: 'entire transactions', limit: 10000 })
const beef = Beef.fromBinary(outputs.BEEF)
const held = beef.findTxid(txid)
const path = held?.bumpIndex == null ? held?.tx?.merklePath : beef.bumps[held.bumpIndex]
// path is undefined until the transaction is mined and the wallet has attached it
await fetch(`${indexUrl}/arc-ingest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Callback-Token': callbackToken },
  body: JSON.stringify({ txid, merklePath: path.toHex(), blockHeight: path.blockHeight }),
})
```

3. Confirm `{ "status": "applied" }`. The index then serves the state with its proof.
4. Prove each state before writing the next, as the example does with `--wait-proof`.

| Condition | Handling and limit |
|---|---|
| Path absent | The example polls until it appears or `--wait-proof` expires; do not use an absent path |
| Empty basket | `outputs.BEEF` may be absent; the example handles this |
| Tip about to be spent | `listOutputs` returns only spendable outputs. After spending, BRC-100 cannot return that state's path this way |
| Writer cannot wait | Point the broadcaster's callback at the index's `/arc-ingest` instead |
| Parsed BEEF in `@bsv/sdk` 2.8.10 | Read `beef.bumps`. The path is stored there, so `beef.findTxid(txid).tx.merklePath` is always `undefined` |
| Callback token | Use each index's own token for `/arc-ingest`; never send one index's token to another |

## Keep

Journal before each action. Retain each state's transaction, BEEF, owner-tier hash and ciphertext, index answer, network answer and proof ([section 5](build-an-application.md#5-keep-what-you-wrote)). The example uses a file; your application uses a table.

## Update

Build the `UPDATE` as you built the issue, with three differences: the data names the tip, it carries the control linkage, and the wallet spends the tip's output.

- **The data.** `previousTxid` and `previousOutputIndex` name the tip, and `lineageGenesis` is the genesis outpoint as `{ txid, outputIndex }`. `op` is `'UPDATE'` and `controlLinkage` is the value from the keys step.
- **The tip's BEEF** is the one the wallet gave you for the previous state: `created.tx` for the issue, `signed.tx` after that. Keep it in the journal. Once that state has its merkle path, swap in the smaller BEEF: set `stateTx.merklePath = path` and use `stateTx.toAtomicBEEF()`. If you have lost it, `listOutputs` with `basket: 'dpp'` and `include: 'entire transactions'` returns a BEEF that holds the tip, the one output still spendable. The raw transaction alone cannot stand in for it: raw hex carries neither the tip's merkle path nor its unmined ancestors, so a BEEF built from it does not verify.
- **The unlock.** Every state's output is a PushDrop script locked to the controller key, so spending the tip takes a wallet signature under protocol `[1, 'dpp owner v1']`, key identifier the passport identifier and counterparty `self` ([custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 3). The unlock is 73 bytes.

Fragment from `liveAdapter`, using the tip and signed `nextState` listed in the input table:

```js
const created = await wallet.createAction({
  description: 'dpp update',
  inputBEEF: tipBeef,
  inputs: [{ outpoint: `${tipTxid}.${tipOutputIndex}`, unlockingScriptLength: 73, inputDescription: 'dpp passport tip' }],
  outputs: [{ lockingScript: buildLockingScript(nextState, controllerKey).toHex(), satoshis: 1, outputDescription: 'dpp passport state', basket: 'dpp' }],
  options: { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false },
})
const tx = Transaction.fromAtomicBEEF(created.signableTransaction.tx)
const at = tx.inputs.findIndex((input) => (input.sourceTXID ?? input.sourceTransaction?.id('hex')) === tipTxid && input.sourceOutputIndex === tipOutputIndex)
const unlockingScript = await new PushDrop(wallet).unlock(OWNER_PROTOCOL_ID, passportId, 'self').sign(tx, at)
const signed = await wallet.signAction({
  reference: created.signableTransaction.reference,
  spends: { [at]: { unlockingScript: unlockingScript.toHex() } },
  options: { noSend: true },
})
```

`PushDrop` and `Transaction` come from `@bsv/sdk`. The wallet usually adds funding and change. The tip retains the input index you found; without output randomisation, the passport output stays first. `signed.tx` is the signed BEEF and `signed.txid` its identifier. Check, announce, send and prove it as above. Before announcing, confirm the index's tip is the state being spent; it refuses a state whose tip it does not hold.

## Transfer under managed custody

The custodian holds a passport's keys for holders and recipients with no wallet of their own. For a platform that gives its users passports without wallets, it is the platform's own service. The custodian offers the passport against the current tip, the recipient accepts, and the custodian signs the acceptance as a record with `signManagedAcceptance`.

The `TRANSFER` moves field 6 to the recipient's controller key, locks the new output to that same key, the `destinationKey` of the acceptance, and carries `acceptanceCommitment(record)` in `authorisationCommitment`. From then on the wallet that holds the recipient's root spends the tip: yours for a managed identity, the recipient's own when they supplied a key their wallet derived ([managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) section 2). `bindAcceptanceToState(record, state)` must return no failures before you send. Keep the record: a reader needs it to check the transfer, and no index or registry route serves it yet.

Under `managed-custody@2` the custodian signs the record through its BRC-100 wallet, with the child of its identity key for `[1, 'dpp managed record v1']`, the record's `requestId` and counterparty `anyone`, the same `createSignature` operation that signs a state; no key is held outside the wallet. A reader derives the verification key from the record's `custodian` property. Records in the superseded `dpp-managed-acceptance@1` format, signed with the identity key directly, are read under their own rule and never written. `examples/lifecycle-v2.mjs` runs the offer, the acceptance and the transfer without a network, and [managed custody](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md) holds the rules.

## Retire

A `RETIRE` spends the tip like any other state, and nothing can follow it.

| Check | Required value or result |
|---|---|
| Predecessor | Spend the current tip and prove control, as for every post-genesis state |
| Public payload and owner-tier hash | Keep the previous state's values |
| `eventData` | Carry the reason if the profile asks for one |
| Following state | None; the passport is retired |
