# Build an application with the packages

This page takes you from the [quick start](../quick-start.md) to an application that reads, writes and anchors passports with the published packages. Each step says what to call, which example already runs it, and which page holds the rules. Run the quick start first; it reads a live passport and checks your installation. To plan the screens first, see [what a passport application offers](what-an-application-offers.md).

## What you are building

| Part | What it does | Needed |
|---|---|---|
| Reader | Rebuilds a passport's history from an index and verifies it | Always |
| Writer | Issues a passport and writes each later state | To publish passports |
| Index | Admits states and answers lookups | Yours for writing; the hosted one for reading |
| Wallet | Holds the keys, signs, funds and broadcasts | For writing and anchoring |
| Journal | Your application's record of every operation, so a retry continues instead of repeating | For writing |
| Issuer and registry | Sign a lifecycle claim, store it and anchor it | Only for claims |

Write record version 2 under `managed-custody@1`, the custody profile the current release selects. Version 1 lineages still verify, and [custody](../learn/custody.md) explains the difference.

## Before you start

- Node 22 or later, and ECMAScript modules.
- The packages at exact versions:

  ```sh
  npm install --save-exact @bsv/dpp-core@0.3.0-beta.3 @bsv/dpp-profiles@0.3.0-beta.3 @bsv/sdk@2.8.10
  ```

- A BRC-100 wallet: a wallet application on your machine while you develop, or `@bsv/wallet-toolbox` in a hosted service. [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) names the versions that work with this release.
- A WhatsOnChain API key in `WOC_API_KEY`. Readers and indexes ask it for block headers, and anonymous access is limited to a few requests a second.
- A passport identifier: a GS1 Digital Link URI on a host you control, with a GTIN under the demonstration prefix 952 until you have your own ([identifiers](../identifiers.md)).

## 1. Read a passport

Ask an index for the passport's outputs, merge their BEEFs into one, rebuild the chain and verify it against the subject you asked about. The [hosted reference](../deployment.md#the-hosted-reference) serves lookups to anyone:

```js
import { Beef, WhatsOnChain } from '@bsv/sdk'
import { chainFromBeef, verifyPassportEvidence } from '@bsv/dpp-core'

// Ask the header source one question at a time, a little apart, and keep each
// answer for the run: WhatsOnChain answers only a few requests a second.
function pacedTracker(inner, gapMs = 400) {
  const answers = new Map()
  let queue = Promise.resolve()
  const ask = (key, question) => {
    if (!answers.has(key)) {
      const answer = queue.then(() => new Promise((wait) => setTimeout(wait, gapMs))).then(question)
      queue = answer.catch(() => {})
      answers.set(key, answer.catch((error) => { answers.delete(key); throw error }))
    }
    return answers.get(key)
  }
  return {
    isValidRootForHeight: (root, height) => ask(`${height}:${root}`, () => inner.isValidRootForHeight(root, height)),
    currentHeight: () => ask('height', () => inner.currentHeight()),
  }
}

const index = 'https://dpp-overlay.bsvb.net'
const passportId = 'https://id.gs1.org/01/09506000134352/21/7AC18477503A'

const { publisherPolicy } = await (await fetch(`${index}/capabilities`)).json()
const response = await fetch(`${index}/lookup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
})
const { outputs } = await response.json()
if (outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
const merged = Beef.fromBinary(outputs[0].beef)
for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)

const report = await verifyPassportEvidence(
  { tokenHistory: chainFromBeef(merged, passportId) },
  { passportId, source: 'request-context' },
  {
    chainTracker: pacedTracker(new WhatsOnChain('main', { apiKey: process.env.WOC_API_KEY })),
    publisherKeys: publisherPolicy.publisherKeys,
  }
)
for (const check of report.checks) console.log(check.name, check.status, check.reasonCode ?? '')
```

It prints one line per check and takes about four seconds. The first five lines and `subjectBinding` and `evidenceAvailability` read `pass`:

```
recordEncoding pass
actorSignatures pass
publisherSignatures pass
linkage pass
inclusion pass
```

The claim checks read `unknown` with `no-evidence` and `issuerAuthority` reads `unknown` with `policy-missing`, because this passport carries no claim. If `inclusion` reads `unknown` with `header-source-unavailable`, the header source refused a question: wait a few seconds and run it again, or set `WOC_API_KEY`. The paced tracker is what keeps a reader under that limit; the report asks about every state's block, and a tracker that asks as fast as it can is refused under load.

The index only finds the bytes; the report is your own. Each check answers `pass`, `fail`, `unknown` or `not-applicable` with a reason, and [reading the report](../learn/evidence-and-freshness.md) explains them. `examples/verify-passport.mjs` is the same reader with every option, and the [reader guide](../implement/roles/passport-reader.md) holds the rules. To add the passport's claims, their anchors, a check for a later state and the parties you accept, see [gather a passport's evidence](dpp-core.md#gather-a-passports-evidence).

## 2. Run your own index

The hosted index admits only states published under the keys its own policy names, and its `POST /submit` needs its operator's token. To publish your own passports, run your own index:

1. Start it with the Compose preset in the [operator start](../operate/README.md).
2. Set `SERVICE_IDENTITY_KEY` to your writer's identity key, the key that countersigns every state as publisher, or give the index a publisher policy naming it ([federation](../operate/federation.md) shows the policy variables).
3. Set `SUBMIT_TOKEN`, `ACCEPTANCE_COMMITMENT=required` and `WOC_API_KEY`.
4. Check `GET /capabilities` names your publisher key before you write.

## 3. Write a passport

Every state goes through the same six steps, in this order ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/writing.md)):

1. Build the state and its transaction unsent.
2. Check it with the reader's own rules.
3. Announce it to your index with `POST /submit`, and send it only if the index admits it. If the index refuses it, abort the unsent action. If the index cannot be reached, that is not a refusal: send anyway, and announce the same bytes again after the send.
4. Send it, and report only the network's answer. If the network refuses a state your index admitted, withdraw it from the index with `POST /retract`, behind the same token as `/submit`.
5. When the wallet has the merkle path, push it to the index's `POST /arc-ingest`, with that index's own callback token.
6. Keep the transaction, its BEEF and its proof in your journal for the passport's life.

**A refused draft is aborted.** An unsent action holds the wallet's inputs until it is sent or aborted, so a draft that fails your own check or that the index refuses must be given to `abortAction`, or its inputs stay out of use. Pass the action's reference: a state that spends the tip has one, `created.signableTransaction.reference`. An issue that needed no signature from you comes back signed with no reference, and `@bsv/wallet-toolbox` then accepts the transaction identifier in its place: `wallet.abortAction({ reference: created.txid })`.

`examples/write-passport.mjs` runs all six steps against a local wallet for a version 1 activation, and `examples/lifecycle-v2.mjs` builds a whole version 2 lifecycle without a network. The steps below join the two.

**Keys.** The wallet's identity key signs each state as actor and as publisher. The passport's controller key, field 6, is one derivation from the same wallet, and each state is locked to it:

```js
import { WalletClient } from '@bsv/sdk'
import { buildLockingScript, completeState, decryptOwnerLinkage, ownerBlobHash, ownerKeyFor, revealOwnerLinkage } from '@bsv/dpp-core'

const wallet = new WalletClient('auto', 'localhost')
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
const controllerKey = await ownerKeyFor(passportId, wallet)
const controlLinkage = await decryptOwnerLinkage(await revealOwnerLinkage(passportId, wallet, identityKey), wallet)
```

The second argument is the originator, the hostname your wallet knows your application by: `localhost` while you develop, your application's own domain once it is hosted. In Node, `@bsv/sdk` 2.8.10 reaches a local wallet only when it is given one; without it the client reports `No wallet available over any communication substrate` even while a wallet is running.

Because the actor's identity key is not the controller key, every state after the genesis proves control by carrying `controlLinkage`, the scalar that links the two ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model-v2.md) section 6). The wallet reveals it to itself and the application decrypts it once; it is public on chain from then on. A state without it is refused.

**Owner tier.** Your profile's restricted fields, every tier but `public`, never go on chain. Check them against the profile's restricted schema, as [check a payload against its profile](dpp-profiles.md#check-a-payload-against-its-profile) shows with `readRestrictedPayloadSchema`, encrypt them with the wallet under protocol `[2, 'dpp owner data v1']`, key identifier the passport identifier and counterparty `self`, and keep the ciphertext off chain; only its hash goes into the state ([record model](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md) section 7):

```js
const { ciphertext: ownerTierCiphertext } = await wallet.encrypt({
  plaintext: Array.from(new TextEncoder().encode(JSON.stringify(restrictedFields))),
  protocolID: [2, 'dpp owner data v1'],
  keyID: passportId,
  counterparty: 'self',
})
```

To read the tier back, check the ciphertext with `verifyOwnerBlob(ciphertext, state.payloadOwnerHash)` from `@bsv/dpp-core` before calling `wallet.decrypt` with the same protocol, key identifier and counterparty. On a `TRANSFER`, encrypt the tier again with the recipient's identity key as counterparty and put that ciphertext's hash in the `TRANSFER`; the recipient decrypts it with your identity key as counterparty. A passport with no restricted fields leaves `payloadOwnerHash` empty. How the `owner`, `legitimate` and `authority` tiers are each disclosed is not settled yet: one ciphertext reaches whoever holds its key.

**Issue.** Build the genesis state and ask the wallet for an unsent transaction holding it:

```js
const state = await completeState({
  version: '2', op: 'ISSUE', passportId,
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  actorIdentityKey: identityKey, actorKeyId: 'brand', ownerIdentityKey: controllerKey,
  eventData: '', payloadPublic: JSON.stringify(publicFields), payloadOwnerHash: ownerBlobHash(ownerTierCiphertext),
  previousTxid: '', previousOutputIndex: null, lineageGenesis: null,
  controlLinkage: '', authorisationCommitment: '',
}, wallet, wallet)

const created = await wallet.createAction({
  description: 'dpp issue',
  outputs: [{ lockingScript: buildLockingScript(state, controllerKey).toHex(), satoshis: 1, outputDescription: 'dpp passport state', basket: 'dpp' }],
  options: { noSend: true, randomizeOutputs: false },
})
```

`payloadPublic` holds the public fields of your industry profile. Start from `node examples/sample-payload.mjs general@2`, or the profile you use, and check your payload with `--check` before you write ([industry profiles](../profiles/README.md)). `payloadOwnerHash` commits to the owner-tier ciphertext from the step above. Then check, announce, send and prove `created.tx` as `examples/write-passport.mjs` does.

**Every later state spends the tip.** Give the wallet the tip's BEEF and outpoint, then unlock the tip with the PushDrop unlock for protocol `[1, 'dpp owner v1']`, key identifier the passport identifier and counterparty `self` ([custody](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/custody.md) section 3). The unlock is 73 bytes:

```js
import { PushDrop, Transaction } from '@bsv/sdk'
import { OWNER_PROTOCOL_ID } from '@bsv/dpp-core'

const created = await wallet.createAction({
  description: 'dpp update',
  inputBEEF: tipBeef,
  inputs: [{ outpoint: `${tipTxid}.${tipOutputIndex}`, unlockingScriptLength: 73, inputDescription: 'dpp passport tip' }],
  outputs: [{ lockingScript: buildLockingScript(nextState, controllerKey).toHex(), satoshis: 1, outputDescription: 'dpp passport state', basket: 'dpp' }],
  options: { noSend: true, randomizeOutputs: false },
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

`nextState` is built as the genesis was, with `op: 'UPDATE'`, `previousTxid` and `previousOutputIndex` naming the tip, `lineageGenesis` naming the genesis outpoint as `{ txid, outputIndex }`, and `controlLinkage` from the keys step. The wallet usually adds its own funding input and change output; the tip keeps the index you find, and the passport output stays first because outputs are not randomised.

**Transfer under managed custody.** The custodian offers the passport against the current tip, the recipient accepts, and the custodian writes the acceptance down as a signed record with `signManagedAcceptance`. The `TRANSFER` moves field 6 to the recipient's controller key and carries `acceptanceCommitment(record)` in `authorisationCommitment`; `bindAcceptanceToState(record, state)` must return no failures before you send. Keep the record: a reader needs it to check the transfer, and no index or registry route serves it yet. `examples/lifecycle-v2.mjs` runs the offer, the acceptance and the transfer, and [managed custody](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/managed-custody.md) holds the rules. Under `managed-custody@1` the record is signed by the custodian's identity key itself, which a BRC-100 wallet does not expose, so a custodian holds that key outside its wallet for now.

**Retire.** A `RETIRE` spends the tip like any other state, and nothing can follow it.

## 4. Sign and anchor a lifecycle claim

A claim about a passport, such as a repair or a recycling, travels on its own rail and never spends the passport:

1. The issuer signs it with `signLifecycleClaim`, naming itself as `issuer`, for example as `didKeyFromIdentityKey(identityKey)`. At Ring 0 a `did:key` is enough.
2. A registry validates it (`POST /validate` is open on the hosted registry) and, if you run one or hold its write token, stores it.
3. An anchoring service builds `buildAttestationAnchor` over `lifecycleClaimDigest(claim)` with `attestationId` `urn:sha256:<digest>`, and announces and sends it like a passport state, on topic `tm_attestation`.

`examples/lifecycle-v2.mjs` ends with this claim and anchor, `examples/verify-attestation-anchor.mjs` checks one, and the [registry guide](../implement/roles/registry.md) covers running a registry.

## 5. Keep what you wrote

Record each operation in your journal before you act on it: the state, the unsent transaction, the index's answer, the network's answer and the proof. A retry reads the journal and continues; it never builds a second transaction for the same step. Keep every transaction, BEEF and proof, the owner-tier ciphertext and every acceptance record for the passport's life, because a reader or a replacement index needs them. [Export and recovery](../operate/export-import-recovery.md) covers taking them elsewhere.

## Where each rule lives

| Question | Page |
|---|---|
| What each field of a version 2 state means | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model-v2.md) |
| What a writer must do, step by step | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/writing.md) |
| Where the lock sits and who may spend it | [Custody](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/custody.md) |
| What a reader checks | [Verification](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/verification.md) |
| What the index admits and serves | [Services](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/services.md) and the [HTTP contracts](../reference/contracts.md) |
| Which wallet to use | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
