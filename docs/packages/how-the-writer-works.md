# How the writer example works

This page takes `examples/write-passport-v2.mjs` apart step by step, so you can build the same writer into your own application. Run it first, as [write a passport](build-an-application.md#3-write-a-passport) shows; each block here is a fragment of it.

A passport is a lineage of states, from the genesis, the `ISSUE`, to the tip, the newest state, whose output nothing has spent yet. Every later state spends the tip.

## Check before you spend

Check these before you build anything, as the example does. A mistake costs nothing now and cannot be undone once a state is mined.

- **The identifier.** Parse it with `parseGs1DigitalLink` from `@bsv/dpp-profiles`, and refuse it if its check digit fails or its GTIN is not under prefix 952 (`identifierProblems`).
- **The payloads.** Check each public payload against its profile's schema and each owner-tier object against the restricted schema, as [check a payload against its profile](dpp-profiles.md#check-a-payload-against-its-profile) shows. The report never does this, so nothing else will. The example starts from `node examples/sample-payload.mjs general@2 --demonstration` and revises one field in the `UPDATE`. Check your own file with `node examples/sample-payload.mjs --check general@2 payload.json`.
- **The keys.** Read your keys and reveal the linkage before the first spend, so a refused approval costs nothing. Signing and spending approvals come with each transaction.
- **The index.** `GET /capabilities` must name your publisher key, and `POST /lookup` must find nothing for your identifier, so the `ISSUE` is the genesis and not a second one.

## Keys

All three values come from the wallet, and no key leaves it.

| Name | What it is | Where it appears |
|---|---|---|
| Identity key | The wallet's root public key. It signs each state as the actor, the party making the change, and as the publisher, the party that countersigns it | `actorIdentityKey`, field 7, and the publisher signature |
| Controller key | The identity key derived for this passport, in the same wallet, under `[1, 'dpp owner v1']` (`OWNER_PROTOCOL_ID` in `@bsv/dpp-protocol`), with the passport identifier as key identifier and counterparty `self` | `ownerIdentityKey` in the package's state data, field 6 of the record, and the key every state's output is locked to |
| Control linkage | The scalar that proves the controller key came from the identity key | `controlLinkage`, field 14, on every state after the genesis |

The actor's identity key is not the controller key, so every later state carries the linkage to prove control of the state it spends. A state without it is refused ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6). The wallet reveals the linkage to itself, your application decrypts it once, and it is then public on chain.

Fragment of `examples/write-passport-v2.mjs`, in `run`, where `wallet` is the `WalletClient` and `passportId` is your identifier:

```js
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
const controllerKey = await ownerKeyFor(passportId, wallet)
const controlLinkage = await decryptOwnerLinkage(await revealOwnerLinkage(passportId, wallet, identityKey), wallet)
```

`ownerKeyFor`, `revealOwnerLinkage` and `decryptOwnerLinkage` come from `@bsv/dpp-protocol`. Then check the result with `verifyOwnerLinkage(identityKey, controllerKey, controlLinkage)`, as the example does.

## The owner tier

A profile's restricted fields, every tier but `public`, form the owner tier and never go on chain. Encrypt them with the wallet, keep the ciphertext off chain, and put only its hash in the state ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 7). `@bsv/dpp-protocol` does not export the protocol `[2, 'dpp owner data v1']`, so copy it from that section.

Fragment of `examples/write-passport-v2.mjs`, in `sealOwnerTier`, where `restrictedFields` is an object that passes `readRestrictedPayloadSchema(profile)`, such as `{ serviceNotes: '...' }` for `general@2`:

```js
const { ciphertext } = await wallet.encrypt({
  plaintext: Utils.toArray(JSON.stringify(restrictedFields), 'utf8'),
  protocolID: [2, 'dpp owner data v1'],
  keyID: passportId,
  counterparty: 'self',
})
const payloadOwnerHash = ownerBlobHash(ciphertext)
```

Read the tier back before you build anything: `verifyOwnerBlob(ciphertext, payloadOwnerHash)`, then `wallet.decrypt` with the same protocol, key identifier and counterparty. With no restricted fields, `payloadOwnerHash` stays empty. On a `TRANSFER`, encrypt the tier again with the recipient's identity key as counterparty and commit that ciphertext's hash instead. The recipient decrypts it with your identity key as counterparty.

**Where the ciphertext lives.** Only where you store it. The chain holds only the hash, and the wallet only encrypts and decrypts. Lose it and the committed hash points at nothing: the tier cannot be read again, because encrypting the same text again gives different bytes. The example keeps it in the journal.

Record model section 7 recommends serving it at its UHRP (BRC-26) content address, which is the hash already in the state, so a reader needs no registry to find it. Any UHRP storage host may serve the bytes, or you may serve them yourself, as long as someone holds them. To print each state's address, save this as `uhrp-addresses.mjs` and run `node uhrp-addresses.mjs dpp-journal/passport-<digest>.json` on the file in your journal directory. `node examples/write-passport-v2.mjs --dry-run --journal=./dpp-journal` makes one to try it on:

```js
import { readFileSync } from 'node:fs'
import { StorageUtils, Utils } from '@bsv/sdk'

const journal = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const state of journal.states) {
  console.log(state.op, StorageUtils.getURLForHash(Utils.toArray(state.ownerTier.hash, 'hex')))
}
```

Restricted fields in more than one tier raise an open question, listed under [what is not settled](build-an-application.md#what-is-not-settled).

## Issue

Build the genesis state, then ask the wallet for an unsent transaction holding it. `completeState` signs the state as actor and as publisher, and `buildLockingScript` makes the output script that locks it to the controller key. On a genesis, `previousOutputIndex` and `lineageGenesis` are `null`. `actorKeyId` names the key the actor signature is derived under: any text of 1 to 256 bytes, the same for every state this writer makes (`writer` in the example). `eventData` is JSON or empty (empty in the example). Its properties are a profile's rule, and none is defined yet for an update or a retirement.

Fragment of `examples/write-passport-v2.mjs`, in `writeState` and `liveAdapter`, where `publicFields` is the public payload object, and `identityKey`, `controllerKey` and `payloadOwnerHash` are from above:

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

**Check.** Before the unsent transaction leaves your hands, run the verifier's own rules on it, with the lineage written so far in front of it. Fragment of `examples/write-passport-v2.mjs`, in `writeState`, where `earlierStates` is the list of transactions already written, oldest first (empty for a genesis), and `stateTx` is the new one, read with `Transaction.fromAtomicBEEF(created.tx)`:

```js
const checked = await verifyChain([...earlierStates, stateTx], {
  chainTracker: 'scripts only',
  serverIdentityKey: identityKey,
  managedAcceptance: true,
})
if (!checked.valid) console.log(checked.error) // then abort the unsent action and send nothing
```

`'scripts only'` skips the header check, since nothing is mined yet, but still checks the signatures, the link to the tip and the control proof.

**Announce.** `POST /submit` takes the BEEF, your submit token and the topic `tm_dpp`, the index's topic for passport states. Fragment of `examples/write-passport-v2.mjs`, in `announce`, simplified, where `beef` is `created.tx`:

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

Send on `admitted`, on `duplicate` (the index already holds those bytes) and on `unreachable`, which refuses nothing. On `refused` or `unauthorised`, abort the unsent action and stop while the draft has cost nothing; announcing after the send would not mend a wrong address or token. [What a refusal code means](build-an-application.md#when-the-index-refuses-a-state) explains each `X-Admission-Refusal` code.

**A refused draft is aborted.** An unsent action holds the wallet's inputs until it is sent or aborted, so pass a draft that fails your own check, or that the index refuses, to `abortAction`. Give it the action's reference, `created.signableTransaction.reference` for a state that spends the tip. An issue comes back with no reference, and `@bsv/wallet-toolbox` then accepts the transaction identifier: `wallet.abortAction({ reference: created.txid })`. Read the result. If the network already knows the transaction, the wallet answers `{ aborted: false }` rather than throwing, and you must not build again.

**Send.** Send with a second `createAction` that names the unsent transaction, and report only the wallet's answer for it. Fragment of `examples/write-passport-v2.mjs`, in `liveAdapter`, where `txid` is `created.txid`:

```js
const result = await wallet.createAction({ description: 'dpp send', options: { sendWith: [txid], acceptDelayedBroadcast: false } })
const status = result.sendWithResults?.find((r) => r.txid === txid)?.status
```

`unproven` means the network accepted the transaction and the state exists, pending until mined. `sending` is not yet an answer: wait, and do not rebuild. `failed` means the state never existed and nothing was spent. If the network refuses a state your index admitted, withdraw it with `POST /retract`, which takes `{ txid, outputIndex, reason }` behind the submit token.

## Prove

Once a state is mined, the wallet attaches its merkle path, the proof of inclusion, to the transaction it holds. Read the path from the wallet and push it to your index, because announcing the state again would leave the index's copy unproven.

Fragment of `examples/write-passport-v2.mjs`, in `waitForProof` and `pushProof`, where `txid` is the state's identifier and `callbackToken` is your index's `ARC_CALLBACK_TOKEN`:

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

The example polls until the path appears or `--wait-proof` runs out, and handles `outputs.BEEF` being absent when the basket holds nothing.

Prove each state before you write the next, as the example does with `--wait-proof`. `listOutputs` returns only spendable outputs, so once a state's output is spent, its path cannot be read through BRC-100 any more. A writer that cannot wait points its broadcaster's callback at the index's `/arc-ingest` instead. Also read the path from `beef.bumps`, as the fragment does: in `@bsv/sdk` 2.8.10 a parsed BEEF keeps a proven transaction's path there and not on the transaction, so `beef.findTxid(txid).tx.merklePath` is always `undefined`.

The index answers `{ "status": "applied" }` and from then on serves the state with its proof. Each index guards `/arc-ingest` with its own callback token, so never send one index's token to another.

## Keep

[Section 5](build-an-application.md#5-keep-what-you-wrote) says what to keep and why. The example writes its journal before acting on each step, and holds for each state the transaction, its BEEF, the owner tier's hash and ciphertext, the index's answer, the network's answer and the proof. Here the journal is a file; in your application it is a table.

## Update

Build the `UPDATE` as you built the issue, with three differences: the data names the tip, it carries the control linkage, and the wallet spends the tip's output.

- **The data.** `previousTxid` and `previousOutputIndex` name the tip, and `lineageGenesis` is the genesis outpoint as `{ txid, outputIndex }`. `op` is `'UPDATE'` and `controlLinkage` is the value from the keys step.
- **The tip's BEEF** is the one the wallet gave you for the previous state: `created.tx` for the issue, `signed.tx` after that. Keep it in the journal. Once that state has its merkle path, swap in the smaller BEEF: set `stateTx.merklePath = path` and use `stateTx.toAtomicBEEF()`. If you have lost it, `listOutputs` with `basket: 'dpp'` and `include: 'entire transactions'` returns a BEEF that holds the tip, the one output still spendable.
- **The unlock.** Every state's output is a PushDrop script locked to the controller key, so spending the tip takes a wallet signature under protocol `[1, 'dpp owner v1']`, key identifier the passport identifier and counterparty `self` ([custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 3). The unlock is 73 bytes.

Fragment of `examples/write-passport-v2.mjs`, in `liveAdapter`, where `tipBeef`, `tipTxid` and `tipOutputIndex` are the tip's BEEF, transaction identifier and output number from the journal, `nextState` is the signed `UPDATE`, and `controllerKey` is from above:

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

`PushDrop` and `Transaction` come from `@bsv/sdk`. The wallet usually adds its own funding input and change output. The tip keeps the input index you find, and the passport output stays first because outputs are not randomised. `signed.tx` is the signed transaction as BEEF, and `signed.txid` its identifier. Then check, announce, send and prove it as above. An index refuses a state whose tip it does not hold, so before announcing, the example also checks that the tip the index returns for the passport is the state this one spends.

## Transfer under managed custody

The custodian holds a passport's keys for holders and recipients with no wallet of their own. For a platform that gives its users passports without wallets, it is the platform's own service. The custodian offers the passport against the current tip, the recipient accepts, and the custodian signs the acceptance as a record with `signManagedAcceptance`.

The `TRANSFER` moves field 6 to the recipient's controller key and carries `acceptanceCommitment(record)` in `authorisationCommitment`. `bindAcceptanceToState(record, state)` must return no failures before you send. Keep the record: a reader needs it to check the transfer, and no index or registry route serves it yet.

Under `managed-custody@1` the custodian's identity key itself signs the record. A BRC-100 wallet does not expose that key, so for now the custodian holds it outside its wallet. `examples/lifecycle-v2.mjs` runs the offer, the acceptance and the transfer without a network, and [managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) holds the rules.

## Retire

A `RETIRE` spends the tip like any other state, and nothing can follow it. It keeps the previous state's public payload and owner-tier hash, and its `eventData` carries the reason if the profile asks for one.
