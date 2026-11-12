# Federation with static peers

Index operators can use this page to replicate and compare records with a second index, another operator or the hosted reference. Start with a named peer. Synchronisation is a feature of the overlay package, not of the standard, and its [package guide](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md#operator-features) states its rules. Finding peers through SHIP and SLAP and advertising an index there are parked outside the standard: the package keeps them as options, described under [parked: find peers automatically](#parked-find-peers-automatically) and [parked: advertise your index](#parked-advertise-your-index). Diagnose missing records under [when a record does not arrive](#when-a-record-does-not-arrive).

Peer exchange is optional for readers and writers. Every release supports the named-peer setup below. Overlay `0.4.0-beta.10` adds discovery, advertising and retry of outputs left behind, which beta.9 lacks. Check the package version in `GET /capabilities` before relying on those features.

| Word | Meaning on this page |
|---|---|
| Peer | Another index this index reads records from. |
| Round | One synchronisation pass: the index asks each peer what it holds and admits what passes its own rules. Rounds run at start, then every `SYNC_INTERVAL_MS`, a minute by default. |
| GASP | The Graph Aware Synchronisation Protocol, the BSV overlay protocol a round uses. |
| Tip | A passport's newest state, the unspent output a peer offers. |
| Publisher policy | A signed list of the [publisher keys](../README.md#words-you-will-meet) an index admits states from, each with a key window. An index loads a chain of versions, oldest first. |
| Key window | When a key admits states: from its `activeFrom`, until its `retiredAt` if retired. |
| Checkpoint | How far an index has read a peer, stored per peer and topic. |

## Prerequisites by operating mode

| Mode | Inputs and source |
|---|---|
| All checkout procedures | [Reviewed source checkout](../quick-start.md#get-the-code), after `npm ci` and `npm run build`. Run every command from its root. |
| Static-peer rehearsal | First index from the Compose preset at `http://localhost:8080` ([run a service](README.md)), started with `--build` at least once. The second preset has no build step and uses the first's `dpp-overlay:local` image. Obtain the first index's admission settings and publisher keys from its operator. |
| Header checks | Your WhatsOnChain API key. Synchronisation asks the header source once per admitted state; without a key it paces itself to about three requests a second. |
| Another operator | Its reachable base URL, publisher keys and their oldest state times; independently obtain its identity key to check a signed policy. |
| Optional discovery, parked | A release supporting discovery, your `PUBLIC_URL`, and optionally chosen tracker URLs and a host limit. |
| Optional advertising, parked | Public HTTPS URL, separate advertiser private key and HTTPS wallet-storage address. Fund that key's wallet at that storage server before the first start: at most six one-satoshi tokens plus the transaction fee. A small balance is enough; a start with all adverts present spends nothing. |

## Which way records flow

An index pulls from its `SYNC_PEERS` and admits records through its own topic managers and publisher policy. Naming a peer sends it nothing. For two-way exchange, each operator must name the other.

Both indexes must admit the same records to agree:

| Topic | Selection or admission rule |
|---|---|
| `tm_dpp` | Always pulled; passport states must pass the publisher policy. |
| `tm_attestation` | Always pulled; anchors must pass `ANCHOR_SERVICE_KEYS`, or the policy's anchor-publisher keys if its scope covers this topic. |
| Historical `tm_uora_dpp` | Pulled only with `SYNC_LEGACY=1`. |

An index admitting fewer anchoring services refuses the others' anchors and keeps differing. Check `publisherPolicy.anchoringServices` in the peer's `GET /capabilities`: an empty list admits any, as `anchoring-service-restriction` under `unsupported` confirms.

SHIP and SLAP are the BSV overlay protocols identifying topic hosts and lookup services. Discovery through them is parked outside the standard: `SYNC_DISCOVERY=ship` adds advertised peers and `ADVERTISE=1` advertises this index, both default off and neither changes admission.

### Discovery in the reviewed source

Discovery, advertising and retry entered source between 7 and 9 October 2026 and were published in overlay `0.4.0-beta.10`. This page therefore describes them as released. The named-peer recipe works without discovery or advertising.

## Part one: set up

### Before you start

Use the static-peer inputs above and leave discovery off for this recipe. Choose the first index's single publisher key for steps 1, 2 and 4, or add step 3 for a signed publisher policy. Only a policy admits multiple keys, needed when pulling from the hosted reference or another operator.

### 1. Create the second environment file

```sh
cp deploy/operator.env.example deploy/operator-b.env
```

Git ignores filled-in `deploy/*.env` files, so they stay local.

### 2. Fill in the second index's settings

Edit `deploy/operator-b.env`:

| Setting | Value |
|---|---|
| `OVERLAY_PORT` | `8081` (used below), or any free port other than the first index's. |
| `SERVICE_IDENTITY_KEY` | The first index's value, so the second admits what the first admitted. Can stay empty under a publisher policy (step 3), which decides instead. |
| `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN` | New secrets, not the first index's. Make each with `openssl rand -hex 32`. |
| `SYNC_PEERS` | `http://host.docker.internal:8080` when both indexes run on this machine. On separate hosts, the first index's base URL as the second container reaches it. |
| `WOC_API_KEY` | Your WhatsOnChain API key. |
| `ACCEPTANCE_COMMITMENT` | The first index's value, `required` in the example file. A stricter one refuses version 2 transfers the first admitted. |
| `ANCHOR_SERVICE_KEYS` | The first index's value, so the second admits the anchors the first admitted. Empty admits a well-formed anchor from any anchoring service, as the hosted reference does. |
| `SYNC_LEGACY` | `1` to pull the historical `tm_uora_dpp` topic as well, which the hosted reference holds. Empty pulls only `tm_dpp` and `tm_attestation`. |
| `EXPORTER_PRIVATE_KEY`, `EXPORT_TOKEN` | Optional. If set, use the second index's own values, never the first's ([export, import and recovery](export-import-recovery.md)). |

`SYNC_PEERS` is the complete list of peers, never the index's own address. It is read at start, so a change applies after the next `up -d`.

### 3. Sign a publisher policy

Skip this step if the second index uses the first index's `SERVICE_IDENTITY_KEY`. Otherwise make an operator identity key, which signs the policy and never goes into the index:

```sh
node --input-type=module -e "import { PrivateKey } from '@bsv/sdk'; const key = PrivateKey.fromRandom(); console.log('private:', key.toHex()); console.log('public: ', key.toPublicKey().toString())"
```

Keep the private value secret, outside the repository. Save the unsigned policy below as `policy.unsigned.json` at the root of the checkout. It names the hosted reference's two publisher keys, for the step 5 rehearsal and for pulling from the hosted reference. For your own records, add your writer's key or use it instead:

```json
{
  "policyFormat": "dpp-publisher-policy@1",
  "policyVersion": 1,
  "scope": { "operatorProfile": "single-operator@1", "operators": ["example-operator"], "topics": ["tm_dpp"] },
  "publishers": [
    { "key": "0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24", "role": "state-publisher", "activeFrom": "2026-01-01T00:00:00Z" },
    { "key": "03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f", "role": "state-publisher", "activeFrom": "2026-01-01T00:00:00Z" }
  ]
}
```

Set `activeFrom` no later than the oldest wanted state; earlier states are refused even if the peer holds them. If that time is unknown, choose an instant before the key could have signed anything, as `2026-01-01T00:00:00Z` does here. An earlier instant admits nothing unsigned by that key. Do not copy another operator's window: it may start after states that index admitted before loading its policy and still serves.

Three more rules:

- Keep `topics` at `["tm_dpp"]` unless the policy also names `anchor-publisher` keys: a scope covering `tm_attestation` admits anchors only from those keys.
- The first version also governs the time before its own `issuedAt`, so a policy written late still admits earlier states inside each key's window ([the publisher key policy](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md#the-publisher-key-policy)).
- A later version names the previous one's digest in `supersedes` (`policyDigest` in `@bsv/dpp-protocol` computes it) and is authorised by a key the chain already trusts. The script below writes only a first version.

Sign the policy into `deploy/config/`, which the Compose presets mount read-only at `/config` inside the container:

```sh
OPERATOR_PRIVATE_KEY=<the private value> node examples/sign-publisher-policy.mjs policy.unsigned.json deploy/config/policy-b.json
```

The script writes the chain only if it verifies as an index checks it at boot, and prints:

```
ok: the genesis for "example-operator", issued <the time now>, verifies as the whole chain; its digest is <64 hex>.
The chain is written to deploy/config/policy-b.json. Give an index that file as PUBLISHER_POLICY_FILE, or its text as PUBLISHER_POLICY_JSON, and: OPERATOR_IDENTITY_KEYS=example-operator=<the public value>
```

`node examples/sign-publisher-policy.mjs --dry-run` shows the same check, and two refusals, with a key made for the run.

Add two lines to `deploy/operator-b.env`, naming the file by its path inside the container:

```
PUBLISHER_POLICY_FILE=/config/policy-b.json
OPERATOR_IDENTITY_KEYS=example-operator=<the public value>
```

| Configuration check | Expected result or stop |
|---|---|
| One chain file per index | Both presets mount `deploy/config/`, so use different file names. |
| Container path | Use `/config/policy-b.json`. The checkout path stops boot with `PUBLISHER_POLICY_FILE deploy/config/policy-b.json could not be read: ENOENT`. |
| Trusted operator key | Without `OPERATOR_IDENTITY_KEYS`, boot stops with `policy version 1 refused, genesis-signer-not-operator`. |

Where a host cannot mount a file, set `PUBLISHER_POLICY_JSON` instead of `PUBLISHER_POLICY_FILE`, never both. An env file value is one line, so print the chain on one line and paste it as `PUBLISHER_POLICY_JSON='<the line>'`:

```sh
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('deploy/config/policy-b.json', 'utf8'))))"
```

### 4. Start the second index and check it

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
curl --fail http://localhost:8081/health
curl --fail -s http://localhost:8081/capabilities | node -e "const c = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ synchronisation: c.synchronisation, publisherKeys: c.publisherPolicy.publisherKeys }, null, 2))"
```

Expect `"profile": "single-operator@2"`, `"discovery": "static-peers"`, `"gasp": true`, `peers` listing `http://host.docker.internal:8080`, and `publisherKeys` listing the keys the index admits now. An index on beta.9 says `single-operator@1` here. Key windows are not shown: they are only in the operator's signed chain ([tell operators apart](#tell-operators-apart)).

If the index does not start, read its log:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env logs --tail=100 overlay-b
```

### 5. Put a passport on the first index and watch it arrive

If your writer announces to the first index, look up one of its passports on both indexes (item 3). For a wallet-free rehearsal, save the following files at the built checkout root. They select the hosted reference's three-state passport under the demonstration prefix 952; the bounded package is suitable only for passports with no more than 500 states.

Save as `restore-package.mjs`. Its source URL, passport and expected export signer default to the hosted reference. It stops on inspection failures or incomplete coverage before submitting anything:

```js
// Copy one passport from an index's bounded evidence package into another index.
import { evidencePackageSigner, inspectEvidencePackage } from '@bsv/dpp-protocol'

const source = process.env.SOURCE_INDEX ?? 'https://dpp-overlay.bsvb.net'
const replacement = process.env.REPLACEMENT_INDEX ?? 'http://localhost:8080'
const passportId = process.env.PASSPORT_ID ?? 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'
// The key this passport's package is signed by: the child of the exporter identity key the source operator gives you
// (EXPORTER_IDENTITY_KEY), or for an index on an earlier release its raw export key (EXPORT_SIGNER), by default the hosted reference's.
const expectedSigner = process.env.EXPORTER_IDENTITY_KEY
  ? evidencePackageSigner(process.env.EXPORTER_IDENTITY_KEY, passportId)
  : process.env.EXPORT_SIGNER ?? '02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116'

const response = await fetch(`${source}/evidence-package?${new URLSearchParams({ passportId })}`)
if (!response.ok) throw new Error(`GET /evidence-package answered ${response.status}: ${await response.text()}`)
const envelope = await response.json()
const files = new Map(Object.entries(envelope.files).map(([path, b64]) => [path, [...Buffer.from(b64, 'base64')]]))

const inspection = inspectEvidencePackage(envelope.manifest, files, { expectedPassportId: passportId, expectedSigner })
if (inspection.failures.length > 0) throw new Error(`package refused: ${inspection.failures.map((f) => f.reason).join(', ')}`)
if (!envelope.manifest.completeness.snapshots[0].completeForSnapshot) {
  throw new Error('the package stops at its 500-state bound and lacks the oldest states: use the complete export instead')
}
console.log(`package checked: signed by ${expectedSigner}, complete for its snapshot`)

for (const [path, bytes] of files) {
  if (!path.startsWith('proofs/')) continue
  const answer = await fetch(`${replacement}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': '["tm_dpp"]', Authorization: `Bearer ${process.env.SUBMIT_TOKEN}` },
    body: new Uint8Array(bytes),
  })
  if (!answer.ok) throw new Error(`POST /submit answered ${answer.status} for ${path}: ${await answer.text()}`)
  console.log(path, answer.status, answer.headers.get('x-admission'))
}
```

Save as `lookup.mjs`:

```js
// Ask an index for every state it holds for one passport.
import { Transaction } from '@bsv/sdk'

const indexUrl = process.env.INDEX_URL ?? 'https://dpp-overlay.bsvb.net'
const passportId = process.env.PASSPORT_ID ?? 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'

const response = await fetch(new URL('/lookup', indexUrl), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
})
if (!response.ok) throw new Error(`POST /lookup answered ${response.status}: ${await response.text()}`)
const answer = await response.json()
console.log(`${answer.type} with ${answer.outputs.length} outputs from ${indexUrl}`)
for (const output of answer.outputs) console.log(`  ${Transaction.fromBEEF(output.beef).id('hex')} output ${output.outputIndex}`)
```

Then copy the live passport into the first index:

1. Make both indexes admit the hosted reference application's publisher key. On a rehearsal first index, set `SERVICE_IDENTITY_KEY=0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24` in `deploy/operator.env` and apply it with `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d`. The second needs the same key or the step 3 policy.
2. Run the [package restore](export-import-recovery.md#restore-a-passport-from-the-bounded-package) with a submit token for the first index: its `SUBMIT_TOKEN` if set, otherwise one issued for the step 1 key with `docker compose -f deploy/compose.yml --env-file deploy/operator.env exec overlay node packages/dpp-overlay/dist/cli.js tokens issue --publisher 0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24 --use submit`. Its default is `REPLACEMENT_INDEX=http://localhost:8080`:

   ```sh
   SUBMIT_TOKEN=<replacement submit token> node restore-package.mjs
   ```

   Expect a checked package and three lines ending `200 tm_dpp=admitted`. Stop on a failure before comparing indexes.
3. After the second index's next round, a minute at most, run the [passport lookup](../reference/contracts.md#find-passport-records) against each index:

   ```sh
   INDEX_URL=http://localhost:8080 node lookup.mjs
   INDEX_URL=http://localhost:8081 node lookup.mjs
   ```

   Both print `output-list with 3 outputs from ...` and the same three transaction identifiers (checked with two local indexes, the second under the step 3 policy).
4. Check the copy independently with `node examples/verify-passport.mjs https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180 http://localhost:8081`, which ends `Inclusion across the chain: verified.`

The copy stays in both indexes until `down -v` on a preset removes everything that index holds. Use that only on rehearsal indexes, then set your own key again.

### 6. Exchange records both ways

1. Each operator sets `SYNC_PEERS` to the other's base URL and applies the environment change by rerunning that index's `up -d` command. On one machine, only the second preset maps `host.docker.internal` to the host. Docker Desktop supplies it anyway; on Linux, give the first container a reachable host address.
2. Each publisher policy names the other's state-publisher keys, with windows that cover the states to exchange.
3. Each reads the other's `GET /capabilities`: `synchronisation.discovery` is `static-peers` and `synchronisation.peers` lists its own URL.
4. Each writes a state and looks it up on the other after the next round.

### 7. Confirm both hold the same records

`POST /requestSyncResponse` lists current outputs by topic: at most 500 per page, each with a score; the next page repeats the last score. A passport counts once by its tip. This script also compares whole histories from `GET /history`, including spent states. Save it as `compare-indexes.mjs` at the checkout root, or in a project with `@bsv/dpp-protocol@0.3.0-beta.9` installed:

```js
// Compare what two indexes hold on every topic, and each passport's whole history, and fail on a difference older than the grace period:
// node compare-indexes.mjs <first index URL> <second index URL>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { tryParseDppOutput } from '@bsv/dpp-protocol'

const [first, second] = process.argv.slice(2)
if (!first || !second) throw new Error('usage: node compare-indexes.mjs <first index URL> <second index URL>')
// A state reaches a peer only once it is proven, up to about an hour after it was written, so a difference counts only once it is older than this.
const graceMs = Number(process.env.GRACE_MINUTES ?? 120) * 60_000
const stateFile = process.env.STATE_FILE ?? 'compare-indexes-state.json'
const firstSeen = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}

// A request that names the index when it does not answer at all.
async function request(index, path, init) {
  try {
    return await fetch(`${index}${path}`, init)
  } catch (cause) {
    throw new Error(`${index} did not answer ${path}: ${cause.cause?.message ?? cause.message}`)
  }
}

async function post(index, path, topic, body) {
  const answer = await request(index, path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BSV-Topic': topic }, body: JSON.stringify(body) })
  if (answer.status === 400 && path === '/requestSyncResponse') return null
  if (!answer.ok) throw new Error(`${index}${path} answered ${answer.status} for ${topic}`)
  return answer.json()
}

// Every output an index lists for a topic, as txid.outputIndex, or null when it does not serve the topic.
async function holdings(index, topic) {
  const held = new Set()
  let since = 0
  for (;;) {
    const page = await post(index, '/requestSyncResponse', topic, { version: 1, since })
    if (page == null) return null
    const before = held.size
    for (const { txid, outputIndex } of page.UTXOList) held.add(`${txid}.${outputIndex}`)
    // A page holds at most 500, and the next one starts at the last score, which it repeats.
    if (page.UTXOList.length < 500 || held.size === before) return held
    since = page.UTXOList.at(-1).score
  }
}

// The passport a current output belongs to, read from its own transaction.
async function passportOf(index, outpoint) {
  const [txid, outputIndex] = [outpoint.slice(0, 64), Number(outpoint.slice(65))]
  const node = await post(index, '/requestForeignGASPNode', 'tm_dpp', { graphID: outpoint, txid, outputIndex, metadata: false })
  return tryParseDppOutput(Transaction.fromHex(node.rawTx).outputs[outputIndex].lockingScript)?.state.passportId
}

// Every state an index holds for a passport, oldest first.
async function history(index, passportId) {
  const txids = []
  let cursor = null
  do {
    const query = new URLSearchParams({ passportId, limit: '500', ...(cursor ? { cursor } : {}) })
    const answer = await request(index, `/history?${query}`)
    if (answer.status === 404) return []
    if (!answer.ok) throw new Error(`${index}/history answered ${answer.status} for ${passportId}`)
    const page = await answer.json()
    txids.push(...page.items.map((item) => item.txid))
    cursor = page.nextCursor
  } while (cursor)
  return txids
}

const differences = []
const tips = { first: new Set(), second: new Set() }
try {
for (const topic of ['tm_dpp', 'tm_attestation', 'tm_uora_dpp']) {
  const [a, b] = await Promise.all([holdings(first, topic), holdings(second, topic)])
  if (a == null || b == null) {
    differences.push(`${topic}: not served by ${a == null ? first : second}`)
    continue
  }
  console.log(`${topic}: ${a.size} and ${b.size} current outputs`)
  for (const o of a) if (!b.has(o)) differences.push(`${topic}: ${o} only on the first`)
  for (const o of b) if (!a.has(o)) differences.push(`${topic}: ${o} only on the second`)
  if (topic === 'tm_dpp') [tips.first, tips.second] = [a, b]
}

// Each passport's whole history, spent states included, which the current outputs above do not show.
const passports = new Set()
for (const [index, held] of [[first, tips.first], [second, tips.second]]) {
  for (const outpoint of held) passports.add(await passportOf(index, outpoint))
}
passports.delete(undefined)
for (const passportId of passports) {
  const [a, b] = await Promise.all([history(first, passportId), history(second, passportId)])
  if (a.join() !== b.join()) differences.push(`history of ${passportId}: ${a.length} states on the first, ${b.length} on the second`)
}
console.log(`histories: ${passports.size} passports compared`)
} catch (error) {
  // Nothing is compared against an index that did not answer: the check fails rather than reporting agreement.
  console.log(`not compared: ${error.message}`)
  process.exit(2)
}

// Report each difference with how long it has been seen; only those older than the grace period fail the check.
const now = Date.now()
const seen = {}
let failing = 0
for (const difference of differences) {
  seen[difference] = firstSeen[difference] ?? new Date(now).toISOString()
  const ageMinutes = Math.round((now - Date.parse(seen[difference])) / 60_000)
  const fails = now - Date.parse(seen[difference]) >= graceMs
  if (fails) failing++
  console.log(`${fails ? 'DIFFERENT' : 'pending'} for ${ageMinutes} min: ${difference}`)
}
writeFileSync(stateFile, JSON.stringify(seen, null, 1))
console.log(failing === 0 ? `the two indexes agree${differences.length > 0 ? `, apart from ${differences.length} difference(s) younger than the grace period` : ''}` : `${failing} difference(s) older than the grace period`)
process.exitCode = failing === 0 ? 0 : 1
```

```sh
node compare-indexes.mjs https://dpp-overlay.bsvb.net http://localhost:8081
```

Against the hosted index and a second index that pulls from it, on 7 October 2026 it printed:

```
tm_dpp: 103 and 103 current outputs
tm_attestation: 68 and 68 current outputs
tm_uora_dpp: 26 and 26 current outputs
histories: 103 passports compared
the two indexes agree
```

#### Read comparison outcomes

A difference prints as `pending` until it has been seen for longer than `GRACE_MINUTES`, 120 by default, because a new state reaches a peer only once its proof arrives, up to about an hour after it was written.

| Result or setting | Meaning |
|---|---|
| `pending` | Difference is within the grace period. |
| `DIFFERENT`, exit 1 | Difference is older than the grace period. |
| `not compared:`, exit code 2 | An index did not answer. A silent peer never counts as agreement. |
| Topic returns 400 | Index does not serve it; reported as a difference. |
| `compare-indexes-state.json`, or `STATE_FILE` | Records when each difference first appeared. Run from the same directory each time. |

Schedule the script, hourly for example, to detect stopped or lagging peers. Investigate persistent differences in the receiving index's log ([when a record does not arrive](#when-a-record-does-not-arrive)) or mismatched admission settings ([which way records flow](#which-way-records-flow)).

### Peer with the hosted reference or another operator

**Pull from the hosted reference.** Set `SYNC_PEERS=https://dpp-overlay.bsvb.net` and use the step 3 policy, which names the two keys its `GET /capabilities` lists under `publisherPolicy.publisherKeys`. The hosted index serves every passport state and anchor it holds with its merkle path (checked on 6 October 2026), so none fails for a missing proof; [when a record does not arrive](#when-a-record-does-not-arrive) covers other causes.

**Ask the hosted reference to pull from you.** Until its operator names your index and keys, records flow only from it to you. Ask through the [BSV Association contact form](https://bsvassociation.org/contact/) and send:

- your index's public HTTPS base URL;
- your publisher key, 66 hex characters, and the time of the oldest state it signed, so the reference's window for it refuses nothing;
- optionally, your operator identity key and signed chain, for the reference to check as [tell operators apart](#tell-operators-apart) describes.

Ask about proofs in the same message. A state the reference pulls from you reads `inclusion` pending there until its proof reaches the reference's own `POST /arc-ingest`, which needs the reference's callback token. Its operator decides whether and when to add you.

**Peer with another operator.** Exchange the same details directly. Each of you names the other's index in `SYNC_PEERS` and the other's keys in your policy.

### Tell operators apart

Before adding another operator's keys, compare them and obtain its identity key and signed chain. An index with a policy serves the chain at `GET /publisher-policy` and, with an export key, as `authority/publisher-policy.json` in every evidence package. Obtain the trusted identity key from the operator, never the chain: checking the chain against its own signer proves nothing.

Capabilities cannot distinguish operators: the operator name is unbound text, and `publisherPolicy` gives the version and keys without a chain digest or signer. Matching names and keys may mean two indexes under one operator, or a copy.

Save this as `check-policy-chain.mjs` at the root of the checkout, or in a project with `@bsv/dpp-protocol@0.3.0-beta.9` installed:

```js
// Check another operator's signed publisher policy chain against the identity key the operator gave you.
import { readFileSync } from 'node:fs'
import { verifyPolicyChain } from '@bsv/dpp-protocol'

const [file, operator, identityKey] = process.argv.slice(2)
if (!file || !operator || !identityKey) throw new Error('usage: node check-policy-chain.mjs <chain.json> <operator name> <operator identity key>')

const chain = JSON.parse(readFileSync(file, 'utf8'))
const result = verifyPolicyChain(chain, { [operator]: identityKey })
if (!result.ok) throw new Error(`the chain does not verify: version ${result.failure.version}, ${result.failure.reason}: ${result.failure.detail}`)
console.log(`the chain verifies under ${operator}'s key (versions ${result.versions.join(', ')})`)
const newest = chain[chain.length - 1]
for (const p of newest.publishers) console.log(`  ${p.role} ${p.key} active from ${p.activeFrom}${p.retiredAt ? ` until ${p.retiredAt}` : ''}`)
```

Run `node check-policy-chain.mjs <chain file> <operator name as the chain's scope names it> <identity key>`. For the step 3 chain it prints `the chain verifies under example-operator's key (versions 1)` and each key with its window. Under any other key it stops with `genesis-signer-not-operator`.

### What two indexes demonstrate

Capability documents and evidence packages declare one of three operator profiles, labels of the overlay package and not of the standard:

| Profile | Declaration and evidence boundary |
|---|---|
| `single-operator@1` | Neither pulls from peers nor discovers them. |
| `single-operator@2` | One administration; pulls from named or discovered peers. However many peers it has, it claims no independent replication: `unsupported` includes `independent-replication`. |
| `federated-operators@1` | Parked outside the standard. Declared only when synchronising and the newest publisher policy names at least two operators. Claims support, not independent operation. |

Two indexes under one administration, including the local presets, demonstrate only the mechanism. Separately administered operation needs two organisations with their own administration, credentials, databases and infrastructure ([deploy README](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/deploy/README.md#a-second-operator)).

A publisher policy's own `scope.operatorProfile` names the administration the policy governs, `single-operator@1` or `federated-operators@1`, and does not change when the index adds peers or turns discovery on. The step 3 policy stays as written while the index it governs declares `single-operator@2` ([package guide](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md)).

## Parked: find peers automatically

Parked outside the standard on 12 November 2026, with the SHIP/SLAP discovery extension of the overlay contract. The overlay package keeps it as an option.

`SYNC_DISCOVERY=ship` adds hosts advertising the index's topics to its named peers; `SYNC_PEERS` may be empty. Match admission settings first ([which way records flow](#which-way-records-flow)): discovered records pass the same topic managers and publisher policy.

### Turn it on

Add to the index's environment file:

| Setting | Value |
|---|---|
| `SYNC_DISCOVERY` | `ship`. Unset leaves discovery off; any other value stops the boot. |
| `SLAP_TRACKERS` | Optional. Comma-separated base URLs of the SLAP trackers to ask. Unset uses the overlay SDK's defaults for `NETWORK`: on `main`, `https://overlay-us-1.bsvb.tech`, `https://overlay-eu-1.bsvb.tech`, `https://overlay-ap-1.bsvb.tech` and `https://users.bapp.dev`; on `test`, `https://testnet-users.bapp.dev`. An entry that is not an http or https URL stops the boot. |
| `SYNC_MAX_DISCOVERED` | Optional. The most discovered hosts a round pulls from, a positive integer; `16` when unset. |
| `PUBLIC_URL` | Your index's own base URL, so that it is left out of the hosts it discovers. |

`SLAP_TRACKERS` or `SYNC_MAX_DISCOVERED` without `SYNC_DISCOVERY` warns at start and discovers nothing. Apply the change with the same `up -d` command used to start that index (step 4 for the second preset). Expect `synchronisation.discovery: ship-slap` and `gasp: true`; the start log reads `synchronising tm_dpp and tm_attestation from <named peers> and at most 16 hosts found from SHIP adverts through <trackers> every 60000 ms`.

### What a round does

| Discovery stage | Timing, limits and outcome |
|---|---|
| Tracker lookup | Before the first round, then before a round once ten minutes have passed since the last lookup. Ask for `tm_dpp`, `tm_attestation` and, with `SYNC_LEGACY=1`, `tm_uora_dpp`. |
| Accepted adverts | `OverlayAdminTokenTemplate.decodeAndVerify` must accept the token; it must name the requested topic and an `https://` address. Read at most 1,000 adverts per topic from a tracker answer. |
| Excluded addresses | Leave out this index's `PUBLIC_URL` and every `SYNC_PEERS` entry. |
| Tracker unavailable | Keep the last answer. |
| Changed answer | Log `peer discovery: hosts advertising tm_dpp: <hosts>; tm_attestation: <hosts>` and count ignored adverts. |
| Named peers | Ask every round. |
| Discovered peers | Ask at most `SYNC_MAX_DISCOVERED` per round. Rotate through excess hosts so each is asked in time. |
| Capability fetch | Before asking a discovered host for anything, read `GET /capabilities`, bounded to ten seconds and 1 MiB. Cache for ten minutes. |

Exclude only definite admission mismatches:

| Topic or document | Rule |
|---|---|
| `tm_dpp` | Do not ask when both documents name publisher keys and share none. |
| `tm_attestation` | Do not ask when both restrict anchoring services and share none. Empty `anchoringServices` with `anchoring-service-restriction` under `unsupported` means unrestricted, so ask. |
| Unreadable or absent `publisherPolicy` | Excludes nothing. |

Each exclusion logs once per host and topic: `peer discovery: <host> admits nothing this index admits for tm_dpp, so it is not asked for tm_dpp`. Asking would otherwise cost a header check per graph before refusal.

| Host failure | Back-off |
|---|---|
| Cannot read capabilities or offered outputs | Sit out one round, doubling on each repeated failure up to a day of rounds: 1,440 at the default interval. |
| Host answers again | Forgive previous failures. |
| Example log | `peer discovery: <host> could not be read this round; it sits out 2 rounds` |

A discovered address is only a lead. Its token proves the named key signed the advert, not who runs the host. Discovery authorises no publisher: your policy still governs states and your anchoring settings govern anchors. [Missing-record diagnosis](#when-a-record-does-not-arrive) applies equally. Checkpoints use the advertised address without a trailing slash; [move a checkpoint back](#move-a-checkpoint-back) deletes that entry.

### The capability document with discovery on

| Capability | Value with discovery on |
|---|---|
| `synchronisation.discovery` | `ship-slap` |
| `gasp` | `true` from start, before any host is found |
| `peers` | Every peer the last round asked, named peers first; the operator entry under `profiles` carries the same values |
| `unsupported` with advertising off | `ship-slap-advertising`: finds peers but advertises nothing; other indexes must name it |
| Operator profile | `single-operator@2` for one operator; `federated-operators@1` for two or more in the policy ([what two indexes demonstrate](#what-two-indexes-demonstrate)) |

### What it does not bound

The index adds no page or time budget to the overlay SDK's synchronisation: it fetches every requested graph without a time limit. Rounds cannot overlap, so a large or slow peer lengthens every round ([known limitations](limitations.md#synchronisation)). Lower `SYNC_MAX_DISCOVERED` or choose `SLAP_TRACKERS` to narrow the hosts asked. The [discovery source](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/discovery.ts) defines these rules.

## Parked: advertise your index

Parked outside the standard on 12 November 2026, with discovery. The overlay package keeps it as an option.

With `ADVERTISE=1`, an index creates the SHIP and SLAP adverts that let an index with discovery on find it: one advert per topic and lookup service, each a 1-satoshi token the SDK's `OverlayAdminTokenTemplate` builds, signed by an advertiser key of its own and naming `PUBLIC_URL`. An advert says where your index is. It makes nobody admit your records: an index that finds you still admits only the publisher keys its own policy names, so ask its operator to name yours, as [peer with the hosted reference or another operator](#peer-with-the-hosted-reference-or-another-operator) describes.

### Turn it on

| Setting | Value |
|---|---|
| `ADVERTISE` | `1`. Unset leaves advertising off; any other value stops the boot. |
| `PUBLIC_URL` | Your index's base URL as other indexes reach it, starting with `https://`; trailing slashes are dropped. |
| `ADVERTISER_PRIVATE_KEY` | A private key in hex for advertising alone, never the operator identity key, the export key or the publisher key. Its public key signs the adverts, and its wallet pays for them. |
| `ADVERTISER_STORAGE_URL` | The `https://` address of the wallet storage server holding that key's coins. |

A missing or malformed value stops the boot with a message naming the variable. `ADVERTISER_PRIVATE_KEY` or `ADVERTISER_STORAGE_URL` without `ADVERTISE` is a warning at start and advertises nothing.

The funded-wallet prerequisite covers at most one token each for `tm_dpp`, `tm_attestation`, `tm_uora_dpp`, `ls_dpp`, `ls_attestation` and `ls_uora_dpp`. Apply the settings with the same `up -d` command used to start this index (step 4 for the second preset). With advertising on, `unsupported` no longer carries `ship-slap-advertising`; check the start log for the actual advertising result.

### What a start does

1. After the socket listens, the index asks the overlay SDK's default trackers for `NETWORK`, regardless of `SLAP_TRACKERS`, which SHIP and SLAP adverts this key holds at `PUBLIC_URL`.
2. It creates missing adverts in one wallet-funded transaction handed to `tm_ship` and `tm_slap` hosts. If trackers cannot establish existing adverts, it creates nothing.
3. Check the log:

| Result | Log |
|---|---|
| Created adverts | `advertising: SHIP tm_dpp, SHIP tm_attestation, ... at <PUBLIC_URL> under <identity key>, in <txid>` |
| All present | `advertising: every topic and lookup service is already advertised at <PUBLIC_URL> under <identity key>` |

Failure logs `advertising failed, so other indexes find this one only if they name it: <reason>`; serving and pulling continue. Advertising runs once per start: fix the cause and restart.

The index never revokes adverts. After a move or shutdown, trackers still return the old address; discovered peers find nothing and back off. Remove adverts by spending their tokens with the advertiser's wallet ([known limitations](limitations.md#index-host)).

### The wallet library

The wallet comes from `@bsv/wallet-toolbox-client` 2.11.0, an optional dependency of the package. `npm install` installs it; `npm install --omit=optional` leaves it out, and `ADVERTISE=1` then logs `advertising failed, so other indexes find this one only if they name it: ADVERTISE=1 needs @bsv/wallet-toolbox-client installed beside this package (npm install @bsv/wallet-toolbox-client)` and serves without advertising. The image the [Dockerfile](https://github.com/bsv-blockchain/dpp/blob/b98ddef8904aa3edb60af2e0dd7605f410c287e8/packages/dpp-overlay/Dockerfile) builds includes it. The library is loaded only when an index with `ADVERTISE=1` starts; importing the package loads nothing of it.

### The capability document with advertising on

With advertising on, `unsupported` no longer carries `ship-slap-advertising`. With advertising on and discovery off, it carries `ship-slap-discovery` with the reason `This node advertises itself but finds no peers from adverts; it pulls only from the peers it names.` Advertising changes neither `synchronisation.discovery`, which stays `static-peers` with named peers and `none` without, nor the operator profile. The [advertising source](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/advertise.ts) defines the rules above.

## When a record does not arrive

Only the receiving index logs why a record failed to arrive. The sender logs its response, such as 404 for an absent transaction. Neither log has a route; ask the receiving operator.

### Read the synchronising index's log

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env logs --since 1h overlay-b | grep -E 'did not arrive|left behind|refused|Status: 404'
```

After each round the index compares what each peer offered with what arrived, and holds its checkpoint for anything missing:

```
peer synchronisation round 1: 17 of 97 outputs offered by https://dpp-overlay.bsvb.net for tm_dpp did not arrive; checkpoint held at 1787744549666 so they are offered again
```

| Retry stage | Behaviour |
|---|---|
| Missing after five rounds | Log `left behind after 5 rounds, offered by <peer> for tm_dpp and never admitted: <txid>.<output>; asked for again in 60 rounds`. Move the checkpoint past it; intervening rounds do not offer it. |
| After about an hour, 60 rounds at the default interval | Hold the checkpoint there again and log `asking <peer> again for 1 output left behind for tm_dpp`. |
| Left behind again | Double the wait, up to about a day of rounds. |
| Schedule storage | Memory only, at most 10,000 outputs per peer and topic. Restart forgets it and resumes from the stored checkpoint. |
| beta.9 | Logs the output once and never retries; moving the checkpoint is the only recovery procedure. |

Retry repairs nothing: admission still refuses an unacceptable state, and a graph stays missing until its peer can serve it. After fixing the cause, [move the checkpoint back](#move-a-checkpoint-back) instead of waiting. The [synchroniser](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/sync.ts) defines the schedule.

### Find the cause

| What the log shows | Cause | What to do |
|---|---|---|
| `tm_dpp refused <txid>: server_signature is not from a state-publisher key active at <time>` | The state's publisher key is not in your policy, or `<time>` is before the key's `activeFrom`. Without a policy there is no such line; the state shows only as did not arrive. | Correct the policy (step 3) or the key, restart, then [move the checkpoint back](#move-a-checkpoint-back). For a chain others rely on, issue a later version, not a new first one. |
| `tm_dpp refused <txid>: <another reason>` | The state breaks a record rule your index applies, such as a missing acceptance commitment under `ACCEPTANCE_COMMITMENT=required`. | Match the admission settings to the index you pull from, or accept that the two disagree. |
| `Failed to verify merkleroot for height <height>` | Your header source did not answer for that block, usually WhatsOnChain limiting anonymous requests, so the proven state was dropped for that round. | Set `WOC_API_KEY`; if an output was left behind, [move the checkpoint back](#move-a-checkpoint-back). |
| `Error with incoming UTXO <txid>.<output>: HTTP error! Status: 404` | The peer cannot serve the state's graph, usually because it holds a mined state without its merkle path, so your index asks for ancestors the peer lacks. | Ask the peer's operator to deliver the missing proofs to its own `POST /arc-ingest`, then move the checkpoint back. Or [take the record from the chain](#take-a-record-from-the-chain) yourself. |
| The state is unproven and its writer's wallet funded it from another passport's change | A known limit of the overlay package: the peer reaches the other passport through the change output and asks for its predecessor, which it cannot get. The topic now asks only through the passport output, but `@bsv/overlay` up to 2.6.2 does not say which output a walk arrived by. | Wait for the first round after the state is mined ([known limitations](limitations.md)). |
| Nothing: the peer keeps the previous tip of a passport it holds | The new state is unproven. The overlay SDK needs an unproven state's parent in the graph it assembles but leaves out a parent the peer already holds, so the state cannot arrive; a new passport can. | Push the state's proof to the node the peer pulls from. The next round carries the state with its proof, and the peer admits it on the tip it holds. |
| Nothing: the state arrived, but readers of the peer see `inclusion` pending | A proof that arrives after a peer synchronised the state does not follow it. | Deliver the proof to the peer (below), or [take it from the chain](#take-a-record-from-the-chain) yourself. |

A proof reaches an index only through that index's own `POST /arc-ingest`, and a peer's `/arc-ingest` answers 404 until the state has arrived there. A writer that knows its index's peers can deliver each proof to them too, retrying that 404, with each peer's own callback token from that peer's operator ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). Nobody is named yet to do this: a writer offers each proof to the indexes it announced the state to ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/writing.md) section 7), and the [overlay package](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md#running-two-operators-locally) expects a writer or gateway to push it to every operator it knows. The [federation test](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/test/federation.test.ts#L395-L419) shows a later proof staying on one index until it is pushed to the other.

A retraction does not reach a peer either. Synchronisation carries admissions only: when a writer withdraws a refused draft from the index it announced it to, that index stops offering the output, and a peer that already pulled it keeps serving it as the tip, with nothing in a later round saying it is gone. The peer's operator withdraws it with the same request on their own index, `POST /retract` with the outpoint and the reason behind their submit token ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). The same checks apply there, so a state the peer has since proven, or whose transaction the peer's header source knows, is refused, which is the case where the retraction was wrong. Agree with peer operators who tells whom, as for proofs.

### Take a record from the chain

A mined transaction's proof does not depend on any peer. WhatsOnChain serves it as a BUMP at `https://api.whatsonchain.com/v1/bsv/main/tx/<txid>/proof/bump`, which `MerklePath.fromHex` from `@bsv/sdk` reads, and the transaction with its proof as a BEEF at `/tx/<txid>/beef`. Check the proof's root against the block header yourself before your index sees it, as `examples/check-registry.mjs` does.

- **A state your index holds unproven:** send the BUMP to your own `POST /arc-ingest` as `{ "txid", "merklePath", "blockHeight" }`, with your callback token.
- **An anchor your index never received:** send its BEEF to your own `POST /submit` with `X-Topics: ["tm_attestation"]`, or `["tm_uora_dpp"]` for a historical anchor, and your submit token. Your index's rules still apply, so an anchor from a service it does not accept is refused.
- **A passport state your index never received:** announce it the same way with `X-Topics: ["tm_dpp"]`, oldest state first, since each state is admitted only on top of its predecessor.

### Move a checkpoint back

After fixing the cause, delete the peer's checkpoints. No setting selects a restart point. Next round asks for everything again; existing outputs are admitted as no-ops. Each `{ host, topic, since }` document is in `overlayInteractions`; `host` matches `SYNC_PEERS` without a trailing slash. For the second preset, using database `dpp` unless `MONGO_DB` overrides it:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env exec mongo-b mongosh dpp --quiet --eval 'db.overlayInteractions.deleteMany({ host: "http://host.docker.internal:8080" })'
```

Expect `{ acknowledged: true, deletedCount: 1 }` or more, one per topic the peer had delivered from. In a local test, the next round read the peer from the start (`since: 0`) and admitted nothing twice.

## Sources

- [Second-operator preset](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/deploy/compose.second-operator.yml) and the [preset README](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/deploy/README.md), including backup of a node's volume.
- [Peer configuration, reconciliation and the left-behind retry](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/sync.ts), [peer discovery](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/discovery.ts), [advertising](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/src/advertise.ts) and every setting in the overlay package's [configuration table](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md#configuration).
- The [services specification](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/services.md) for admission and the flat publisher key list, the [overlay package guide](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-overlay/README.md#operator-features) for the publisher policy chain and synchronisation, and the [publisher policy schema](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/contracts/publisher-policy.schema.json).
- The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records what local tests do not establish about independent operation.

Next: keep evidence you can restore elsewhere with [export, import and recovery](export-import-recovery.md), and read [known limitations](limitations.md) before relying on a peer.
