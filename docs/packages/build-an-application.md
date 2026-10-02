# Build an application with the packages

This page takes you from an empty checkout to a first passport you have written yourself: a demonstration passport with an issue and an update, written through your own index with a funded wallet, then read back and checked. Use it if you are adding passports to an application or building a platform, because it also shows which package call does each step; to only look at a passport, use the [quick start](../quick-start.md), and to see one written with no setup, use the [hosted application](../deployment.md), where anyone can sign up and issue for its sample brands.

## What you are building

| Part | What it does | Needed |
|---|---|---|
| Reader | Rebuilds a passport's history from an index and verifies it | Always |
| Writer | Issues a passport and writes each later state | To publish passports |
| Index | Admits states and answers lookups | Yours for writing; the hosted one for reading |
| Wallet | Holds the keys, signs, funds and broadcasts | For writing and anchoring |
| Journal | Your application's record of every operation, so a retry continues instead of repeating | For writing |
| Issuer and registry | Sign a lifecycle claim, store it and anchor it | Only for claims |

[Words you will meet](../README.md#words-you-will-meet) defines passport identifier, state, index, publisher key, registry, anchor, wallet and proof. This page defines every other term where it first appears.

You write record version 2 under `managed-custody@1`, the custody profile the current release selects. Version 1 lineages still verify, and [custody](../learn/custody.md) explains the difference.

The steps run one program, `examples/write-passport-v2.mjs`, from the checkout. It issues a passport and updates it, and section 3 names the function of that file that does each part. Every code block says whether it is a whole file you can save and run, or a fragment of that example.

## Before you start

| You need | Why | How to get it or check it |
|---|---|---|
| Node 22 or later | Everything here is ECMAScript modules | `node --version` prints `v22` or higher |
| A built checkout of the repository | Your own index builds from it, and the examples run from it | `git clone https://github.com/bsv-blockchain/dpp.git`, then `cd dpp`, `npm ci` and `npm run build` ([source access](README.md#source-access)). Run every command below from this directory |
| Docker with Compose | Runs your own index and its database | `docker compose version` |
| A BRC-100 wallet (a wallet that answers the standard BRC-100 interface), unlocked on this machine and funded | Signs and sends every state | See "Fund the wallet" below |
| A WhatsOnChain API key | Your index asks WhatsOnChain for block headers each time it admits a state, and anonymous access allows only a few requests a second | Get one from WhatsOnChain; you put it in the index's settings in step 2 |
| A passport identifier under GS1 prefix 952, on a host you control | It is written into every state and cannot change afterwards | See "Make an identifier" below |
| Two secrets for your index, a submit token and a callback token | The index refuses writes and proofs without them | Step 2 has you generate them |

To build your own application beside the checkout, install the packages at exact versions. They are published under npm's `next` tag, so an install without a version does not give you these:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.5 @bsv/dpp-profiles@0.3.0-beta.5 @bsv/sdk@2.8.10
```

The checkout already links these packages, so the commands on this page need no install of their own.

### Fund the wallet

Every live write is a real transaction on BSV mainnet, the live network. It pays a miner fee and it is permanent. The programme runs no test network, and the example says so in its first line.

Each state is about one kilobyte. At 100 satoshis per kilobyte, the default fee rate of `@bsv/wallet-toolbox`, the two states of the example cost a little over 200 satoshis in fees together, and one satoshi stays in the passport's current output. Put at least 1,000 satoshis in the wallet, through the wallet's own receive flow, so a change in fee rate or in the wallet's change handling cannot stop a run halfway. Your wallet's rate may differ.

[Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) says which wallets work. On a developer machine that is a wallet application such as BSV Desktop, running and unlocked. The example does not choose a network: it writes to whichever chain your wallet is on, and your index's `NETWORK` setting must be the same chain. A wallet on the test network with an index started with `NETWORK=test` should rehearse the same run without real money, but the example has not been run that way.

### Make an identifier

A passport identifier is the product's web address, `https://<host>/01/<GTIN>/21/<serial>`. Until you hold GTINs of your own, use the GS1 demonstration prefix 952, which GS1 never licenses, and a host you control ([identifiers](../identifiers.md) explains each part). This builds one; replace `passports.example.com` with your host and `DEMO0001` with a serial you have not used:

```sh
node --input-type=module <<'JS'
import { buildGs1DigitalLink, gs1CheckDigit } from '@bsv/dpp-profiles'
const data = '0952' + '123456789' // 0, the prefix 952, then a nine-digit item reference of your choosing
console.log(buildGs1DigitalLink('passports.example.com', data + gs1CheckDigit(data), 'DEMO0001'))
JS
```

It prints `https://passports.example.com/01/09521234567899/21/DEMO0001`. Never use a GTIN you did not allocate yourself: a state published under someone else's GTIN cannot be withdrawn. The example refuses any identifier outside prefix 952 on a live run.

## 1. Read a passport

Reading comes first because you will use the same reader to check what you write. A reader asks an index for a passport's states, rebuilds the history and verifies it. Save this as `read-passport.mjs` in the checkout root and run `node read-passport.mjs`. With no settings it reads a version 1 demonstration passport from the [hosted reference](../deployment.md#the-hosted-reference), which serves lookups to anyone:

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

BEEF (Background Evaluation Extended Format) is the byte format in which an index and a wallet exchange a transaction together with the proofs of its ancestors. `Beef.fromBinary` reads it, and `chainFromBeef` puts a passport's states in order, oldest first.

It prints one line per check and takes about four seconds. The first five lines read `pass`, and so do `subjectBinding` and `evidenceAvailability`:

```
recordEncoding pass
actorSignatures pass
publisherSignatures pass
linkage pass
inclusion pass
```

The claim checks read `unknown` with `no-evidence`, and `issuerAuthority` reads `unknown` with `policy-missing`, because this passport carries no claim. If `inclusion` reads `unknown` with `header-source-unavailable`, the header source refused a question: wait a few seconds and run it again, or put `WOC_API_KEY=<your key>` in front of the command. The paced tracker is what keeps a reader under that limit, since the report asks about every state's block.

The index only finds the bytes; the report is your own. Each check answers `pass`, `fail`, `unknown` or `not-applicable` with a reason, and [reading the report](../learn/evidence-and-freshness.md) explains them. `examples/verify-passport.mjs` is the same reader with every option, and the [reader guide](../implement/roles/passport-reader.md) holds the rules. To add the passport's claims, their anchors, a check for a later state and the parties you accept, see [gather a passport's evidence](dpp-core.md#gather-a-passports-evidence).

## 2. Run your own index

The hosted index cannot take your writes. It admits only states countersigned by the two publisher keys its own policy names, both run by the programme, and its `POST /submit` and `POST /arc-ingest` need tokens that belong to its operator and are not handed out ([what is open and what needs a token](../deployment.md#what-is-open-and-what-needs-a-token)). To publish a passport you run an index of your own.

A passport written to your index is found there and nowhere else. The hosted index does not hold it, and the check at `dpp.bsvb.net/verify` reads only identifiers under its own host and `id.gs1.org`, so read your passport back with the reader above. Records reach another index only if that index's operator names yours as a peer ([federation](../operate/federation.md)).

### 2.1 Find your wallet's identity key

The index admits only states countersigned by a publisher key you name. In this example the wallet signs as publisher, so the key is the wallet's identity key. Save this as `identity-key.mjs` in the checkout root and run `node identity-key.mjs` with the wallet unlocked; the wallet may ask you to approve the program first.

```js
import { WalletClient } from '@bsv/sdk'

const wallet = new WalletClient('auto', 'localhost')
const { publicKey } = await wallet.getPublicKey({ identityKey: true })
console.log(publicKey)
```

It prints 66 hexadecimal characters. `localhost` is the originator, the hostname your wallet knows the program by. In Node, `@bsv/sdk` 2.8.10 finds a local wallet only when it is given an originator, and without one it reports `No wallet available over any communication substrate` even while a wallet is running.

### 2.2 Create the settings file and two secrets

From the checkout root:

```sh
cp deploy/operator.env.example deploy/operator.env
openssl rand -hex 32
openssl rand -hex 32
```

If `deploy/operator.env` already exists, edit it instead of overwriting it. Keep the two secrets for the next step; they must differ.

### 2.3 Fill in the settings

Set these in `deploy/operator.env` and leave the rest as the example has them:

| Setting | Value | Why |
|---|---|---|
| `SERVICE_IDENTITY_KEY` | The 66 characters from 2.1 | The publisher key the index admits. It is a public key; leave `SERVER_PRIVATE_KEY` empty |
| `SUBMIT_TOKEN` | The first secret | Guards `POST /submit` and `POST /retract`. The example sends it as `--submit-token`. Compose refuses to start without it |
| `ARC_CALLBACK_TOKEN` | The second secret | Guards `POST /arc-ingest`, where a writer pushes the merkle path of a mined state. The example sends it as `--callback-token`. Compose refuses to start without it |
| `WOC_API_KEY` | Your WhatsOnChain key | The header source for every state the index admits |
| `NETWORK` | `main`, the default | The chain the index checks headers on. It must be the chain your wallet is on |
| `ACCEPTANCE_COMMITMENT` | `required`, the default | Selects `managed-custody@1`: a version 2 `TRANSFER` is admitted only with its acceptance commitment |
| `CHAIN_TRACKER` | Empty | `scripts-only` is a fixture setting that admits unproven history and claims no inclusion |

`SERVICE_IDENTITY_KEY` alone is an implicit policy with no activation windows: every state is checked against that key whatever its date. To admit several keys, or to retire one, give the index a signed publisher policy instead ([sign a publisher policy](../operate/federation.md#3-sign-a-publisher-policy)). [Run a service](../operate/README.md) explains the other settings.

### 2.4 Start the index

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl --fail http://localhost:8080/health
```

The first run builds the image, so it takes longer than later ones. Your index's address is `http://localhost:8080`, or the `OVERLAY_PORT` you set. If `curl` is refused, the index may still be starting; wait a few seconds and run it again, and read the logs as [run a service](../operate/README.md) shows if it stays down.

### 2.5 Confirm it names your key

Run this and check that the key from 2.1 is in the list:

```sh
node --input-type=module <<'JS'
const { publisherPolicy, profiles } = await (await fetch('http://localhost:8080/capabilities')).json()
console.log('publisher keys:', publisherPolicy.publisherKeys)
console.log('custody profile:', profiles.find((profile) => profile.kind === 'custody'))
JS
```

You should see your key under `publisher keys`, and the custody profile `managed-custody` version `1`. If the list is empty or holds another key, the index will refuse every state you send: fix `SERVICE_IDENTITY_KEY`, run the `docker compose ... up -d --build` command again and recheck. The example repeats this check before it builds anything.

## 3. Write a passport

Every state goes through the same six steps, in this order ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md)):

1. Build the state and its transaction unsent: a transaction the wallet has built and signed but not sent, so it spends nothing yet.
2. Check it with the reader's own rules.
3. Announce it to your index with `POST /submit`, and send it only if the index admits it. If the index refuses it, abort the unsent action. If the index cannot be reached, that is not a refusal: send anyway, and announce the same bytes again after the send.
4. Send it, and report only the network's answer. If the network refuses a state your index admitted, withdraw it from the index with `POST /retract`, behind the same token as `/submit`.
5. When the wallet has the merkle path, the proof that the transaction is in a block, push it to the index's `POST /arc-ingest`, with that index's own callback token.
6. Keep the transaction, its BEEF and its proof in your journal for the passport's life.

`examples/write-passport-v2.mjs` does all six for an `ISSUE`, a passport's first state, and then for an `UPDATE`, a later state that changes its data and spends the one before. Run it as a dry run first, then live.

### Run the dry run

```sh
node examples/write-passport-v2.mjs --dry-run
```

A dry run needs no wallet, no funds and no network. A test wallet with fixed keys stands in for yours, the two transactions are built from made-up funding, and an index starts inside the program on a loopback port, with the real index's admission rules except that it does not check block headers. Nothing is broadcast and no hosted service is called. It takes about a second and exits 0. These are the lines to look for; the transaction ids and the port differ each run:

```
ok: the index's capability document names this wallet's identity key 034f355bdcb7... as a state publisher, so it can admit what this wallet countersigns.
ok: the writer's own check accepts the unsent ISSUE (spec/writing.md section 2): ...
The index admitted 3228f527837d... while it was still a draft (X-Admission: tm_dpp=admitted) (section 3).
ok: the writer's own check accepts the unsent UPDATE (spec/writing.md section 2): ...
The index admitted 37a258343c26... while it was still a draft (X-Admission: tm_dpp=admitted) (section 3).
ok: the index's lookup returns the lineage as written: ISSUE 3228f527837d... -> UPDATE 37a258343c26....
ok: the token rail passes: encoding, both signatures on both states, and linkage with control proven on the UPDATE.
...
ok: the index refuses it too, and its answer carries no reason.
...
Every sentence above holds.
```

The program then shows a state the record model forbids, an `UPDATE` without its control proof, refused by the writer's own check and by the index. A line starting `FAIL:` means a step did not hold, and the exit code is not 0. The network steps print as what they would do (`Would send`, `Would prove`), and the proofs it pushes to its in-process index are made up, which is the only kind an index with header checks off could take.

### Run it live

Before you spend anything, check that the index from step 2 is running and names your key, that the wallet is unlocked and funded, and that you have an identifier you have not written before. Then, from the checkout root:

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
| `--wait-proof=<minutes>` | How long to wait, for each state, for the wallet's merkle path. Default 0. Use 30: a state is proven when a block holds it, which takes about ten minutes on average |
| `--originator=<host>` | The hostname your wallet knows the program by. Default `localhost` |
| `--journal=<dir>` | Where the journal goes. Default `./dpp-journal` |

A token on a command line stays in your shell history, so use secrets you can replace. The first line the program prints says it spends real satoshis on mainnet. Your wallet may ask you to approve the program, each key protocol it uses (`dpp token v2`, `dpp owner v1` and `dpp owner data v1`) and each transaction, so stay at the machine; a prompt left unanswered stops the run, and the journal records how far it got. With `--wait-proof=30` a full run takes about as long as two blocks, because each state is proven before the next is written.

Success is the last line, `Every sentence above holds.`, and an exit code of 0. The journal is in `dpp-journal/`, in a file named for a digest of your identifier. Once both states are mined and their proofs pushed, read your passport back with section 1's reader, with your index and identifier set:

```sh
INDEX_URL=http://localhost:8080 PASSPORT_ID=<passportId> WOC_API_KEY=<your key> node read-passport.mjs
```

`inclusion` now reads `pass`. The program's own report reads `unknown` for inclusion, because it runs with header checks off.

If a live run stops, read [when something goes wrong](#when-something-goes-wrong) and the journal before you run again, and never build a state a second time that the journal records as sent.

### How the example works

[How the writer example works](how-the-writer-works.md) takes the example apart one step at a time, for building the same writer into your own application: check before you spend, keys, the owner tier, issue, check, announce and send, prove, keep, update, transfer under managed custody, and retire.

## 4. Sign and anchor a lifecycle claim

A lifecycle claim is a signed statement about a passport, such as a repair or a recycling. It travels on its own track and never spends the passport:

1. The issuer signs it with `signLifecycleClaim`, naming itself as `issuer`, for example as `didKeyFromIdentityKey(identityKey)`. At Ring 0 a `did:key` is enough. Ring 0 means nobody checks the issuer's real-world identity; the platform vouches for the account ([identity and authority](../learn/identity-and-authority.md)).
2. A registry validates it (`POST /validate` is open on the hosted registry) and, if you run one or hold its write token, stores it.
3. An anchoring service builds `buildAttestationAnchor` over `lifecycleClaimDigest(claim)` with `attestationId` `urn:sha256:<digest>`, and announces and sends it like a passport state, on topic `tm_attestation`, the index's topic for anchors. An anchor is a small transaction that commits to the claim's exact bytes. The anchoring service is the party whose wallet makes that transaction, and `anchoredBy` names its key.

`examples/lifecycle-v2.mjs` ends with this claim and anchor, `examples/verify-attestation-anchor.mjs` checks one, and the [registry guide](../implement/roles/registry.md) covers running a registry. A reader on another stack learns which registry holds a claim out of band, since an anchor does not name it.

## 5. Keep what you wrote

Record each operation in your journal before you act on it: the state, the unsent transaction, the index's answer, the network's answer and the proof. A retry reads the journal and continues; it never builds a second transaction for the same step. Keep every transaction, BEEF and proof, the owner-tier ciphertext and every acceptance record for the passport's life, because a reader or a replacement index needs them. [Export and recovery](../operate/export-import-recovery.md) covers taking them elsewhere.

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `No wallet available over any communication substrate` | The SDK found no wallet. In Node it needs an originator | Start and unlock the wallet and pass `--originator=<host>`; nothing was built |
| The index's publisher keys do not include yours | The index would refuse every state | Fix `SERVICE_IDENTITY_KEY` or the policy and restart the index; the example builds nothing |
| The index already holds states for the identifier | A second genesis would be a rival record | Use a serial you have not written |
| HTTP 401 or 403 on `/submit` | The submit token or the address is wrong | Fix it and run again; the example aborts the draft and sends nothing |
| `X-Admission: tm_dpp=none` | The index refused the state | The draft is aborted; see "A refusal carries no reason" below |
| The index could not be reached | An unreachable index refuses nothing | The state is sent and then announced again, and never rebuilt |
| The wallet answers `sending` | Not yet an answer from the network | Wait for the wallet. Do not rebuild |
| The network refuses a state the index admitted | The index holds a tip that never existed | `POST /retract` withdraws it, and the example does so |
| No merkle path yet | Not mined, or the wallet has not attached it | Run with `--wait-proof`, or push it later; readers see the state as pending until then |
| `inclusion` reads `pending` in a report | No proof has reached the index, or the header source could not be asked | Push the proof, and set `WOC_API_KEY` |

### A refusal carries no reason

The index answers a state it refuses with 200, `X-Admission: tm_dpp=none` and nothing admitted; why is in its operator's log, not in the answer. Before you announce, check the causes you can see yourself. The state's `server_signature` comes from a key listed under `publisherPolicy.publisherKeys` in the index's `GET /capabilities`, and that key is active at the state's own timestamp. `GET /capabilities` lists the keys but not when each is active, so you can check that your key is listed and take its window from the operator's signed publisher policy ([tell operators apart](../operate/federation.md#tell-operators-apart)); an index with only `SERVICE_IDENTITY_KEY` has no windows. A state after the genesis spends the tip that the index's `ls_dpp` lookup, its passport lookup, returns for the passport. `tm_dpp=duplicate` is not a refusal: the index already holds those bytes. The dry run shows the operator's log line for a refused state.

## What is not settled

These are open in the standard, and a writer must not guess them. The [known limitations](../operate/limitations.md) list the rest.

- How the `owner`, `legitimate` and `authority` tiers are each disclosed. One ciphertext reaches whoever holds its key, so a passport that needs more than one audience has no agreed answer yet.
- Whether a custodian may write a state for a holder without the holder's request.
- Which `eventData` properties an `UPDATE` or a `RETIRE` carries.
- How an acceptance record reaches a reader, since no index or registry serves it yet.

## Where to go next

To run a second index and exchange records with it, see [federation](../operate/federation.md). To plan the screens and the keys of a whole application, see [what a passport application offers](what-an-application-offers.md). To take a passport's evidence elsewhere, see [export and recovery](../operate/export-import-recovery.md).

## Where each rule lives

| Question | Page |
|---|---|
| What each field of a version 2 state means | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| What a writer must do, step by step | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) |
| Where the lock sits and who may spend it | [Custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) |
| What a reader checks | [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) |
| What the index admits and serves | [Services](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) and the [HTTP contracts](../reference/contracts.md) |
| Which wallet to use | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
