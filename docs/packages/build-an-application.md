# Build an application with the packages

Use this page to add passports to an application or build a platform: from an empty checkout, you issue and update a demonstration passport through your own index and a funded wallet, then read it back and check it. To only look at a passport, use the [quick start](../quick-start.md). To see one written with no setup, use the [hosted application](../deployment.md), where anyone can sign up and issue for its sample brands.

## What you are building

| Part | What it does | Needed |
|---|---|---|
| Reader | Rebuilds a passport's history from an index and verifies it | Always |
| Writer | Issues a passport and writes each later state | To publish passports |
| Index | Admits states and answers lookups | Yours for writing; the hosted one for reading |
| Wallet | Holds the keys, signs, funds and broadcasts | For writing and anchoring |
| Journal | Your record of every operation, so a retry continues instead of repeating | For writing |
| Issuer and registry | Sign a lifecycle claim, store it and anchor it | Only for claims |

[Words you will meet](../README.md#words-you-will-meet) defines the core terms; this page defines the rest as they appear. You write record version 2 under `managed-custody@1`, the custody profile the current release selects. Version 1 lineages still verify ([custody](../learn/custody.md) explains the difference).

## Before you start

| You need | Why | How to get it or check it |
|---|---|---|
| Node 22 or later | Everything here is ECMAScript modules | `node --version` prints `v22` or higher |
| A built checkout of the repository | Builds your index and runs the examples | `git clone https://github.com/bsv-blockchain/dpp.git`, then `cd dpp`, `npm ci` and `npm run build` ([source access](README.md#source-access)). Run every command below from this directory |
| Docker with Compose | Runs your index and its database | `docker compose version` |
| A wallet that answers the BRC-100 interface, unlocked on this machine and funded | Signs and sends every state | "Fund the wallet", below |
| A WhatsOnChain API key | Your index's source of block headers. Anonymous access allows only a few requests a second | From WhatsOnChain. It goes in your index's settings in step 2 |
| A passport identifier under GS1 prefix 952, on a host you control | It is written into every state and cannot change afterwards | "Make an identifier", below |
| Two secrets for your index, a submit token and a callback token | The index refuses writes and proofs without them | Generated in step 2 |

Commands on this page use the packages the checkout links. In your own application, install these exact versions, so an upgrade is your choice:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.7 @bsv/dpp-profiles@0.3.0-beta.7 @bsv/sdk@2.8.10
```

### Fund the wallet

Put at least 1,000 satoshis in the wallet through its own receive flow, so a different fee rate or change handling cannot stop a run halfway. Every live write is a real, permanent transaction on BSV mainnet, the live network, and pays a miner fee, as the example's first line warns. Its two states, about one kilobyte each, cost a little over 200 satoshis at the `@bsv/wallet-toolbox` default of 100 satoshis per kilobyte, and one satoshi stays in the passport's current output. [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) says which wallets work.

The programme runs no test network, and the example writes to whichever chain your wallet is on. A test-network wallet with an index on `NETWORK=test` should rehearse the run without real money, but the example has not been run that way.

### Make an identifier

A passport identifier has the form `https://<host>/01/<GTIN>/21/<serial>` ([identifiers](../identifiers.md) explains each part). Until you hold your own GTINs, use the GS1 demonstration prefix 952, which GS1 never licenses, on a host you control. Replace `passports.example.com` with your host and `DEMO0001` with an unused serial:

```sh
node --input-type=module <<'JS'
import { buildGs1DigitalLink, gs1CheckDigit } from '@bsv/dpp-profiles'
const data = '0952' + '123456789' // 0, the prefix 952, then a nine-digit item reference of your choosing
console.log(buildGs1DigitalLink('passports.example.com', data + gs1CheckDigit(data), 'DEMO0001'))
JS
```

It prints `https://passports.example.com/01/09521234567899/21/DEMO0001`. Never use a GTIN you did not allocate yourself: a state published under someone else's cannot be withdrawn. On a live run the example refuses any identifier outside prefix 952.

## 1. Read a passport

Save this as `read-passport.mjs` in the checkout root and run `node read-passport.mjs`. With no settings it reads a version 1 demonstration passport from the [hosted reference](../deployment.md#the-hosted-reference), which serves lookups to anyone. Later it checks what you write.

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

// Which index to ask, and about which passport. Section 3 sets both to read your own back.
const index = process.env.INDEX_URL ?? 'https://dpp-overlay.bsvb.net'
const passportId = process.env.PASSPORT_ID ?? 'https://id.gs1.org/01/09506000134352/21/7AC18477503A'

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

BEEF (Background Evaluation Extended Format) is the byte format an index and a wallet use to exchange a transaction with its ancestors' proofs. `Beef.fromBinary` reads it, and `chainFromBeef` orders a passport's states, oldest first. The reader takes the index's publisher keys from `GET /capabilities` on the index's word; to check them and their windows yourself, fetch the signed chain from `GET /publisher-policy` and pass `publisherPolicy: { chain, operatorIdentityKeys }` in place of `publisherKeys`, with operator keys you got from the operator ([tell operators apart](../operate/federation.md#tell-operators-apart)).

In about four seconds it prints one line per check. These five read `pass`, as do `subjectBinding` and `evidenceAvailability`:

```
recordEncoding pass
actorSignatures pass
publisherSignatures pass
linkage pass
inclusion pass
```

This passport carries no claim, so the claim checks read `unknown` with `no-evidence`, and `issuerAuthority` reads `unknown` with `policy-missing`. If `inclusion` reads `unknown` with `header-source-unavailable`, the header source refused a question: retry after a few seconds, or put `WOC_API_KEY=<your key>` in front of the command.

The index only finds the bytes; the report is your own. Each check answers `pass`, `fail`, `unknown` or `not-applicable` with a reason ([reading the report](../learn/evidence-and-freshness.md)). `examples/verify-passport.mjs` is the same reader with every option, the [reader guide](../implement/roles/passport-reader.md) holds the rules, and [gather a passport's evidence](dpp-core.md#gather-a-passports-evidence) adds claims, their anchors, a check for a later state and the parties you accept.

## 2. Run your own index

To publish a passport, run your own index. The hosted one admits only states countersigned by its policy's two publisher keys, both run by the programme, and does not hand out the tokens for its `POST /submit` and `POST /arc-ingest` ([what is open and what needs a token](../deployment.md#what-is-open-and-what-needs-a-token)).

What you write is found only on your index, so read it back with your own reader. The hosted index does not hold it, so the check at `dpp.bsvb.net/verify`, which reads the hosted index, does not find it either. Another index gets your records only if its operator names yours as a peer ([federation](../operate/federation.md)).

### 2.1 Find your wallet's identity key

Your index admits only states countersigned by a publisher key you name. Here the wallet signs as publisher, so name its identity key. With the wallet unlocked, save this as `identity-key.mjs` in the checkout root and run `node identity-key.mjs`. Approve the program if the wallet asks.

```js
import { WalletClient } from '@bsv/sdk'

const wallet = new WalletClient('auto', 'localhost')
const { publicKey } = await wallet.getPublicKey({ identityKey: true })
console.log(publicKey)
```

It prints 66 hexadecimal characters. `localhost` is the originator, the hostname your wallet knows the program by. In Node, `@bsv/sdk` 2.8.10 needs an originator to find a local wallet, and without one reports no wallet even while one is running.

### 2.2 Create the settings file and two secrets

If `deploy/operator.env` already exists, edit it instead of overwriting it. The two secrets must differ.

```sh
cp deploy/operator.env.example deploy/operator.env
openssl rand -hex 32
openssl rand -hex 32
```

### 2.3 Fill in the settings

Set these in `deploy/operator.env` and leave the rest as the example has them:

| Setting | Value | Why |
|---|---|---|
| `SERVICE_IDENTITY_KEY` | The 66 characters from 2.1 | The publisher key the index admits. It is a public key; leave `SERVER_PRIVATE_KEY` empty |
| `SUBMIT_TOKEN` | The first secret | Guards `POST /submit` and `POST /retract`. Compose will not start without it |
| `ARC_CALLBACK_TOKEN` | The second secret | Guards `POST /arc-ingest`, where a writer pushes a mined state's merkle path. Compose will not start without it |
| `WOC_API_KEY` | Your WhatsOnChain key | The header source for every state the index admits |
| `NETWORK` | `main`, the default | The chain the index checks headers on. It must be your wallet's chain |
| `ACCEPTANCE_COMMITMENT` | `required`, the default | Selects `managed-custody@1`: a version 2 `TRANSFER` is admitted only with its acceptance commitment |
| `CHAIN_TRACKER` | Empty | `scripts-only` is a fixture setting that admits unproven history and claims no inclusion |

`SERVICE_IDENTITY_KEY` alone is an implicit policy with no activation windows: every state is checked against that key whatever its date. To admit several keys or retire one, give the index a signed publisher policy ([sign a publisher policy](../operate/federation.md#3-sign-a-publisher-policy)). [Run a service](../operate/README.md) explains the other settings.

### 2.4 Start the index

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl --fail http://localhost:8080/health
```

Your index is at `http://localhost:8080`, or the `OVERLAY_PORT` you set. The first run builds the image, so it is slower. If `curl` is refused, the index may still be starting: retry after a few seconds, and if it stays down, read the logs as [run a service](../operate/README.md) shows.

### 2.5 Confirm it names your key

```sh
node --input-type=module <<'JS'
const { publisherPolicy, profiles } = await (await fetch('http://localhost:8080/capabilities')).json()
console.log('publisher keys:', publisherPolicy.publisherKeys)
console.log('custody profile:', profiles.find((profile) => profile.kind === 'custody'))
JS
```

You should see the key from 2.1 under `publisher keys`, and the custody profile `managed-custody` version `1`. If the list is empty or holds another key, the index will refuse every state you send: fix `SERVICE_IDENTITY_KEY`, rerun the `docker compose ... up -d --build` command and check again. The example repeats this check before it builds anything.

## 3. Write a passport

Every state goes through six steps, in this order ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md)):

1. Build the state and its transaction unsent: signed by the wallet but not sent, so it spends nothing yet.
2. Check it with the reader's own rules.
3. Announce it to your index with `POST /submit`. Send it only if the index admits it, and abort the unsent action if the index refuses it. An unreachable index is not a refusal: send anyway, then announce the same bytes again.
4. Send it, and report only the network's answer. If the network refuses a state your index admitted, withdraw it with `POST /retract`, behind the submit token.
5. Once the wallet has the merkle path, the proof that the transaction is in a block, push it to the index's `POST /arc-ingest` with that index's own callback token.
6. Keep the transaction, its BEEF and its proof in your journal for the passport's life.

`examples/write-passport-v2.mjs` does all six for an `ISSUE`, a passport's first state, then an `UPDATE`, a later state that changes its data and spends the one before. Run it dry first, then live.

### Run the dry run

```sh
node examples/write-passport-v2.mjs --dry-run
```

A dry run needs no wallet, funds or network, broadcasts nothing and calls no hosted service. A test wallet with fixed keys and made-up funding stands in for yours, and an index with the real admission rules, except the block-header check, runs inside the program on a loopback port. It takes about a second and exits 0. Look for these lines; the transaction ids and the port differ each run:

```
ok: the index's capability document names this wallet's identity key 034f355bdcb7... as a state publisher, so it can admit what this wallet countersigns.
ok: the writer's own check accepts the unsent ISSUE (spec/writing.md section 2): ...
The index admitted 3228f527837d... while it was still a draft (X-Admission: tm_dpp=admitted) (section 3).
ok: the writer's own check accepts the unsent UPDATE (spec/writing.md section 2): ...
The index admitted 37a258343c26... while it was still a draft (X-Admission: tm_dpp=admitted) (section 3).
ok: the index's lookup returns the lineage as written: ISSUE 3228f527837d... -> UPDATE 37a258343c26....
ok: the token rail passes: encoding, both signatures on both states, and linkage with control proven on the UPDATE.
...
ok: the index refuses it too, and says why: control-not-proven, the code a verification report gives the same failure.
...
Every sentence above holds.
```

It also shows an `UPDATE` without its control proof, which the record model forbids, refused by the writer's own check and by the index. Network steps print what they would do (`Would send`, `Would prove`). The proofs it pushes are made up, which only an index with header checks off could take. A line starting `FAIL:` means a step did not hold, and the exit code is not 0.

### Run it live

Before you spend anything, check that your index is running and names your key, the wallet is unlocked and funded, and the identifier is unused. Then run:

```sh
node examples/write-passport-v2.mjs <passportId> http://localhost:8080 \
  --submit-token=<SUBMIT_TOKEN> --callback-token=<ARC_CALLBACK_TOKEN> \
  --wait-proof=30 --journal=./dpp-journal
```

| Argument | Meaning |
|---|---|
| `<passportId>` | Your identifier. Required, and refused unless it is under prefix 952 |
| `<indexUrl>` | Your own index. Required, and never defaulted to the hosted reference |
| `--submit-token=<t>` | The index's `SUBMIT_TOKEN`. A 401 or 403 from the index stops the run |
| `--callback-token=<t>` | The index's `ARC_CALLBACK_TOKEN`, sent as `X-Callback-Token` when a proof is pushed |
| `--wait-proof=<minutes>` | How long to wait for each state's merkle path from the wallet. Default 0. Use 30: a state is proven once a block holds it, about ten minutes on average |
| `--originator=<host>` | The hostname your wallet knows the program by. Default `localhost` |
| `--journal=<dir>` | Where the journal goes. Default `./dpp-journal` |

A token on a command line stays in your shell history, so use secrets you can replace. Stay at the machine: your wallet may ask you to approve the program, each key protocol it uses (`dpp token v2`, `dpp owner v1` and `dpp owner data v1`) and each transaction. An unanswered prompt stops the run, and the journal records how far it got. With `--wait-proof=30` a run takes about two blocks, because each state is proven before the next is written.

Success is the last line, `Every sentence above holds.`, and exit code 0. The journal is a file in `dpp-journal/` named for a digest of your identifier. Once both states are mined and their proofs pushed, read the passport back with the section 1 reader:

```sh
INDEX_URL=http://localhost:8080 PASSPORT_ID=<passportId> WOC_API_KEY=<your key> node read-passport.mjs
```

`inclusion` now reads `pass`. The program's own report reads `unknown` for inclusion, because it runs with header checks off.

If a live run stops, read [when something goes wrong](#when-something-goes-wrong) and the journal before you run again. Never rebuild a state the journal records as sent.

### How the example works

To build the same writer into your own application, follow [how the writer example works](how-the-writer-works.md): check before you spend, keys, the owner tier, issue, check, announce and send, prove, keep, update, transfer under managed custody, and retire.

## 4. Sign and anchor a lifecycle claim

A lifecycle claim is a signed statement about a passport, such as a repair or a recycling. It travels on its own track and never spends the passport:

1. The issuer signs it with `signLifecycleClaim`, naming itself as `issuer`, for example as `didKeyFromIdentityKey(identityKey)`. A `did:key` is enough at Ring 0, where the platform vouches for the account and nobody checks the issuer's real-world identity ([identity and authority](../learn/identity-and-authority.md)).
2. A registry validates it (`POST /validate` is open on the hosted registry) and, if you run one or hold its write token, stores it.
3. An anchoring service builds `buildAttestationAnchor` over `lifecycleClaimDigest(claim)` with `attestationId` `urn:sha256:<digest>`, and announces and sends it like a passport state on `tm_attestation`, the index's topic for anchors. The anchor transaction comes from the service's own wallet, and `anchoredBy` names its key.

`examples/lifecycle-v2.mjs` ends with this claim and anchor, `examples/verify-attestation-anchor.mjs` checks one, and the [registry guide](../implement/roles/registry.md) covers running a registry. An anchor does not name its registry, so a reader on another stack learns which registry holds a claim out of band.

## 5. Keep what you wrote

Record each operation in your journal before you act on it: the state, the unsent transaction, the index's answer, the network's answer and the proof. A retry reads the journal and continues, and never builds a second transaction for the same step. Keep every transaction, BEEF and proof, the owner-tier ciphertext and every acceptance record for the passport's life, because a reader or a replacement index needs them. [Export and recovery](../operate/export-import-recovery.md) covers taking them elsewhere.

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `No wallet available over any communication substrate` | The SDK found no wallet, even if one is running. In Node it needs an originator | Start and unlock the wallet and pass `--originator=<host>`; nothing was built |
| The index's publisher keys do not include yours | The index would refuse every state | Fix `SERVICE_IDENTITY_KEY` or the policy and restart the index; the example builds nothing |
| The index already holds states for the identifier | A second genesis would be a rival record | Use a serial you have not written |
| HTTP 401 or 403 on `/submit` | The submit token or the address is wrong | Fix it and run again; the example aborts the draft and sends nothing |
| `X-Admission: tm_dpp=none` | The index refused the state | The draft is aborted. `X-Admission-Refusal` says why; [when the index refuses a state](#when-the-index-refuses-a-state) says what to do |
| The index could not be reached | An unreachable index refuses nothing | The state is sent, then announced again, never rebuilt |
| The wallet answers `sending` | Not yet an answer from the network | Wait for the wallet. Do not rebuild |
| The network refuses a state the index admitted | The index holds a tip that never existed | `POST /retract` withdraws it, as the example does |
| No merkle path yet | Not mined, or the wallet has not attached it | Run with `--wait-proof`, or push it later; until then readers see the state as pending |
| `inclusion` reads `pending` in a report | No proof has reached the index, or the header source could not be asked | Push the proof, and set `WOC_API_KEY` |

### When the index refuses a state

A refused state gets HTTP 200, `X-Admission: tm_dpp=none` and nothing admitted. `X-Admission-Refusal` names the failed check, for example `X-Admission-Refusal: tm_dpp=predecessor-not-admitted`, using the verification report's own code where the report names the same failure. The dry run shows one.

| Code | What failed | What to do |
|---|---|---|
| `decode-failed` | The transaction has no well-formed DPP output, or more than one | Build exactly one DPP output per transaction with `buildLockingScript` |
| `actor-signature-invalid` | The actor signature does not verify against `actor_identity_key` and `actor_keyID` | Sign with the key and key identifier the state names |
| `publisher-not-authorised` | The server signature is not from a publisher key the index accepts at the state's own timestamp | Check that your key is under `publisherPolicy.publisherKeys` in the index's `GET /capabilities`, and take its window from the operator's signed publisher policy ([tell operators apart](../operate/federation.md#tell-operators-apart)); an index with only `SERVICE_IDENTITY_KEY` has no windows |
| `link-broken` | A genesis rule or a chain rule does not hold | Run `verifyChain` from `@bsv/dpp-core` over your states and this one; its error names the rule |
| `control-not-proven` | A version 2 `UPDATE`, `TRANSFER` or `RETIRE` does not prove control of the predecessor | Act as the controller, or carry `control_linkage` |
| `lineage-retired` | The passport ended with a `RETIRE` | Nothing may follow it |
| `version-transition-invalid` | The version changed other than by the one upgrade, a version 2 `UPDATE` that spends a version 1 tip | Keep the predecessor's version, or upgrade with that `UPDATE` |
| `consent-not-proven` | The index runs the owner-signed transfer, and the `TRANSFER`'s actor does not prove it is the previous owner | Act as the previous owner, or carry `owner_linkage` |
| `acceptance-commitment-absent` | The index runs managed custody, and the version 2 `TRANSFER` has no `authorisation_commitment` | Commit to the acceptance record the custodian keeps |
| `genesis-spends-passport-output` | A genesis spends a passport state's DPP output | Fund the genesis from other outputs; change from another passport's transaction is fine |
| `predecessor-not-admitted` | The state does not spend the tip the index holds | Announce the predecessor first, oldest state first, and compare your tip with the index's `ls_dpp` lookup |
| `predecessor-unavailable` | The state spends the tip, but neither the BEEF nor the index holds the predecessor's bytes | Put the predecessor's transaction in the same BEEF |
| `lineage-untraceable` | The index cannot trace a version 2 state's lineage back to its genesis | Announce the lineage from its genesis, oldest state first |

An index on an earlier release, or another implementation, may answer `none` without `X-Admission-Refusal`, leaving the reason only in its operator's log. Then check the two causes you can see, the publisher key and the tip, as the `publisher-not-authorised` and `predecessor-not-admitted` rows say. `tm_dpp=duplicate` is not a refusal: the index already holds those bytes.

## What is not settled

These are open in the standard, and a writer must not guess them. The [known limitations](../operate/limitations.md) list the rest.

- How the `owner`, `legitimate` and `authority` tiers are each disclosed. One ciphertext reaches whoever holds its key, so a passport with several audiences has no agreed answer yet.
- Whether a custodian may write a state for a holder without the holder's request.
- Which `eventData` properties an `UPDATE` or a `RETIRE` carries.
- How an acceptance record reaches a reader, since no index or registry serves it yet.

## Where to go next

To run a second index and exchange records with it, see [federation](../operate/federation.md). To plan a whole application's screens and keys, see [what a passport application offers](what-an-application-offers.md). To take a passport's evidence elsewhere, see [export and recovery](../operate/export-import-recovery.md).

## Where each rule lives

| Question | Page |
|---|---|
| What each field of a version 2 state means | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| What a writer must do, step by step | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) |
| Where the lock sits and who may spend it | [Custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) |
| What a reader checks | [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) |
| What the index admits and serves | [Services](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) and the [HTTP contracts](../reference/contracts.md) |
| Which wallet to use | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
