# How the writer example works

This page walks through `examples/write-passport-v2.mjs` one step at a time, for when you want to build the same writer into your own application. Run the example first, as [write a passport](build-an-application.md#3-write-a-passport) shows; each block here is a fragment of it.

Each step names the package call behind it. A passport is a lineage: a chain of states from the first, called the genesis, to the tip, the newest state, whose output nothing has spent yet. The `ISSUE` is the genesis, and every state after it spends the tip.

## Check before you spend

The example does these checks before it builds anything. Do the same in your application: a mistake costs nothing now and cannot be undone after a state is mined.

- **The identifier.** Parse it with `parseGs1DigitalLink` from `@bsv/dpp-profiles` and refuse one whose check digit fails or whose GTIN is not under prefix 952 (`identifierProblems`).
- **The payloads.** Check each public payload against its profile's schema, and each owner-tier object against the restricted schema, as [check a payload against its profile](dpp-profiles.md#check-a-payload-against-its-profile) shows. The report never checks a payload against its profile, so nothing else will. The example starts from `node examples/sample-payload.mjs general@2 --demonstration` and revises one field in the `UPDATE`. For your own file, run `node examples/sample-payload.mjs --check general@2 payload.json`.
- **The keys.** The calls that read your keys and reveal the linkage come before the first spend, so a refused approval costs nothing. Signing and spending approvals come with each transaction.
- **The index.** Its `GET /capabilities` names your publisher key, and `POST /lookup` returns nothing for your identifier yet, so the `ISSUE` will be the genesis and not a second one.

## Keys

The wallet's identity key signs each state as the actor, the party making the change, and as the publisher, the party that countersigns it. The passport's controller key is a second key, one derivation below the identity key in the same wallet, and every state is locked to it. The control linkage is a number that proves the controller key came from that identity key. All three come from the wallet, and no key leaves it:

| Name | What it is | Where it appears |
|---|---|---|
| Identity key | The wallet's root public key | `actorIdentityKey`, field 7, and the publisher signature |
| Controller key | The identity key derived for this passport under `[1, 'dpp owner v1']`, with the passport identifier as key identifier and counterparty `self`. `OWNER_PROTOCOL_ID` in `@bsv/dpp-core` is that protocol | `ownerIdentityKey` in the package's state data, field 6 of the record, and the key every state's output is locked to |
| Control linkage | The scalar that links the identity key to the controller key | `controlLinkage`, field 14, on every state after the genesis |

A state after the genesis proves control of the state it spends by carrying the linkage, because the actor's identity key is not the controller key, and a state without it is refused ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6). The wallet reveals the linkage to itself and the application decrypts it once; it is public on chain from then on.

Fragment of `examples/write-passport-v2.mjs`, in `run`, where `wallet` is the `WalletClient` and `passportId` is your identifier:

```js
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
const controllerKey = await ownerKeyFor(passportId, wallet)
const controlLinkage = await decryptOwnerLinkage(await revealOwnerLinkage(passportId, wallet, identityKey), wallet)
```

`ownerKeyFor`, `revealOwnerLinkage` and `decryptOwnerLinkage` come from `@bsv/dpp-core`. The example then checks the result with `verifyOwnerLinkage(identityKey, controllerKey, controlLinkage)` before it goes on.

## The owner tier

A profile's restricted fields, every tier but `public`, never go on chain. They are the owner tier. Check them against the profile's restricted schema, encrypt them with the wallet, keep the ciphertext off chain, and put only its hash in the state ([record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 7). The protocol constant `[2, 'dpp owner data v1']` is not exported by `@bsv/dpp-core`: the example defines it, and you copy it from section 7 of the record model. The constant `[1, 'dpp owner v1']` that derives the controller key is exported, as `OWNER_PROTOCOL_ID`.

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

The example then reads the tier back before anything is built: `verifyOwnerBlob(ciphertext, payloadOwnerHash)` first, then `wallet.decrypt` with the same protocol, key identifier and counterparty. A passport with no restricted fields leaves `payloadOwnerHash` empty. On a `TRANSFER`, encrypt the tier again with the recipient's identity key as counterparty and put that ciphertext's hash in the `TRANSFER`; the recipient decrypts it with your identity key as counterparty.

**Where the ciphertext lives.** Neither the chain nor the wallet keeps it. The chain holds only the hash, and the wallet only encrypts and decrypts, so the ciphertext exists nowhere unless you store it. If you lose it, the committed hash points at nothing and the tier cannot be read again, because encrypting the same text a second time gives different bytes. The example writes it into the journal.

Record model section 7 recommends serving it by its UHRP content address. UHRP (BRC-26) names a file by the SHA-256 of its bytes, so the hash already in the state is the address: any host may serve the bytes, and the hash check is what makes the host irrelevant. A reader then needs no registry to find the blob. Which UHRP storage host you use, or whether you serve the bytes yourself, is your choice; what matters is that someone holds them. This reads a journal the example wrote and prints each state's address. Save it as `uhrp-addresses.mjs` and run `node uhrp-addresses.mjs dpp-journal/passport-<digest>.json`, using the file in your journal directory. `node examples/write-passport-v2.mjs --dry-run --journal=./dpp-journal` makes one to try it on:

```js
import { readFileSync } from 'node:fs'
import { StorageUtils, Utils } from '@bsv/sdk'

const journal = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const state of journal.states) {
  console.log(state.op, StorageUtils.getURLForHash(Utils.toArray(state.ownerTier.hash, 'hex')))
}
```

A passport with restricted fields in more than one tier meets an open question, listed under [what is not settled](build-an-application.md#what-is-not-settled).

## Issue

Build the genesis state, then ask the wallet for an unsent transaction holding it. `completeState` signs the state as actor and as publisher, and `buildLockingScript` makes the output script that locks it to the controller key. `previousOutputIndex` and `lineageGenesis` are `null` on a genesis because nothing comes before it. `actorKeyId` names the key the actor signature is derived under: any text of 1 to 256 bytes, the same for every state this writer makes, and `writer` in the example. `eventData` is JSON or empty, and the example leaves it empty; which properties it carries is a profile's rule, and none is defined yet for an update or a retirement.

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

`created.tx` is the unsent transaction as BEEF, and `created.txid` is its identifier. An issue needs no signature from your application, so the wallet returns it already signed, with no `signableTransaction`.

## Check, announce, send

**Check.** Run the verifier's own rules on the unsent transaction, with the lineage written so far in front of it, before it leaves your hands. Fragment of `examples/write-passport-v2.mjs`, in `writeState`, where `earlierStates` is the list of transactions already written, oldest first (empty for a genesis), and `stateTx` is the new transaction, read from the wallet's BEEF with `Transaction.fromAtomicBEEF(created.tx)`:

```js
const checked = await verifyChain([...earlierStates, stateTx], {
  chainTracker: 'scripts only',
  serverIdentityKey: identityKey,
  managedAcceptance: true,
})
if (!checked.valid) console.log(checked.error) // then abort the unsent action and send nothing
```

`'scripts only'` skips the header check, because nothing is mined yet. The signatures, the link to the tip and the control proof are all checked.

**Announce.** `POST /submit` takes the BEEF as the body with `Content-Type: application/octet-stream`, the topic in `X-Topics` and your submit token as a bearer. `tm_dpp` is the index's topic for passport states. Fragment of `examples/write-passport-v2.mjs`, in `announce`, simplified, where `beef` is `created.tx`:

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

Send when the answer is `admitted` or `duplicate`, and also when it is `unreachable`, which refuses nothing. On `refused` or `unauthorised`, abort the unsent action and stop. A refusal's `X-Admission-Refusal` header names the check that failed ([what a refusal code means](build-an-application.md#when-the-index-refuses-a-state)). A 401 or 403 means the address or the token is wrong, which announcing after the send would not mend, so the example stops while the state is still a draft and has cost nothing. `tm_dpp=duplicate` is not a refusal: the index already holds those bytes.

**A refused draft is aborted.** An unsent action holds the wallet's inputs until it is sent or aborted, so a draft that fails your own check or that the index refuses must be given to `abortAction`, or its inputs stay out of use. Pass the action's reference: a state that spends the tip has one, `created.signableTransaction.reference`. An issue that needed no signature from you comes back signed with no reference, and `@bsv/wallet-toolbox` then accepts the transaction identifier in its place: `wallet.abortAction({ reference: created.txid })`. Read the result. The wallet answers `{ aborted: false }`, and does not throw, when the network already knows the transaction, and then you must not build again.

**Send.** Sending is a second `createAction` that names the unsent transaction, and the wallet's answer for that transaction is the only thing you may report. Fragment of `examples/write-passport-v2.mjs`, in `liveAdapter`, where `txid` is `created.txid`:

```js
const result = await wallet.createAction({ description: 'dpp send', options: { sendWith: [txid], acceptDelayedBroadcast: false } })
const status = result.sendWithResults?.find((r) => r.txid === txid)?.status
```

`unproven` means the network accepted the transaction and the state exists, pending until mined. `sending` is not yet an answer: wait, and do not rebuild. `failed` means the state never existed and nothing was spent. If the network refuses a state your index admitted, withdraw it from the index with `POST /retract`, which takes `{ txid, outputIndex, reason }` behind the submit token.

## Prove

A mined transaction's merkle path is the proof of its inclusion. The wallet obtains it as part of being a wallet and attaches it to the transaction it holds. Your application reads it from the wallet and pushes it to your index, because announcing the state again would do nothing and the index's stored bytes would stay unproven.

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

The example polls until the path appears or `--wait-proof` runs out. `outputs.BEEF` is absent when the basket holds nothing, and the example handles that.

There are two traps. A parsed BEEF keeps a proven transaction's path in `beef.bumps`, not on the transaction, so `beef.findTxid(txid).tx.merklePath` is always `undefined` in `@bsv/sdk` 2.8.10. And `listOutputs` returns only spendable outputs, so once a later state spends a state's output, that state's path cannot be read through BRC-100 any more. Prove each state before you write the next, as the example does with `--wait-proof`. A writer that cannot wait points its broadcaster's callback at the index's `/arc-ingest` instead.

The index answers `{ "status": "applied" }` and from then on serves the state with its proof. Each index guards `/arc-ingest` with its own callback token: send an index only its own, never one index's token to another.

## Keep

Section 5 says what to keep and why. The example writes its journal before each step is acted on, and for each state it holds the transaction, its BEEF, the owner tier's hash and ciphertext, the index's answer, the network's answer and the proof. The journal is a file here; in your application it is a table.

## Update

Every state after the genesis spends the tip. The example builds the `UPDATE` as it built the issue, with three differences: the data names the tip, it carries the control linkage, and the wallet is told to spend the tip's output.

- **The data.** `previousTxid` and `previousOutputIndex` name the tip, and `lineageGenesis` is the genesis outpoint, a transaction identifier and an output number, as `{ txid, outputIndex }`. `op` is `'UPDATE'` and `controlLinkage` is the value from the keys step.
- **The tip's BEEF** is the one the wallet gave you when you built the previous state: `created.tx` for the issue, `signed.tx` for a later state. Keep it in the journal. Once you have that state's merkle path, replace it with the smaller one: set `stateTx.merklePath = path` and use `stateTx.toAtomicBEEF()`. If you have lost it, `listOutputs` with `basket: 'dpp'` and `include: 'entire transactions'` returns a BEEF that holds the tip, because the tip is the one output still spendable.
- **The unlock.** The tip's output is locked to the controller key with a PushDrop script, the script template every state uses, so spending it takes a signature from the wallet under protocol `[1, 'dpp owner v1']`, key identifier the passport identifier and counterparty `self` ([custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 3). The unlock is 73 bytes.

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

`PushDrop` and `Transaction` come from `@bsv/sdk`. The wallet usually adds its own funding input and change output; the tip keeps the index you find, and the passport output stays first because outputs are not randomised. `signed.tx` is the signed transaction as BEEF, and `signed.txid` is its identifier. Then check, announce, send and prove it as above. An index refuses a state whose tip it does not hold, so before announcing, the example asks the index for the passport and checks that the tip it returns is the state this one spends.

## Transfer under managed custody

Under managed custody the custodian is the service that holds a passport's keys for holders and recipients who have no wallet of their own; for a platform that gives its users passports without wallets, that is the platform's own service. The custodian offers the passport against the current tip, the recipient accepts, and the custodian writes the acceptance down as a signed record with `signManagedAcceptance`. The `TRANSFER` moves field 6 to the recipient's controller key and carries `acceptanceCommitment(record)` in `authorisationCommitment`; `bindAcceptanceToState(record, state)` must return no failures before you send. Keep the record: a reader needs it to check the transfer, and no index or registry route serves it yet. `examples/lifecycle-v2.mjs` runs the offer, the acceptance and the transfer without a network, and [managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) holds the rules. Under `managed-custody@1` the record is signed by the custodian's identity key itself, which a BRC-100 wallet does not expose, so a custodian holds that key outside its wallet for now.

## Retire

A `RETIRE` spends the tip like any other state, and nothing can follow it. Its public payload and owner-tier hash are the same as the previous state's, and its `eventData` carries the reason if the profile asks for one.
