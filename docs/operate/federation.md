# Federation with static peers

Use this page to make one index hold another's records: a second index of yours, another operator's, or the hosted reference. Part one sets up a named peer. [Find peers automatically](#find-peers-automatically) and [advertise your index](#advertise-your-index) add the indexes that advertise themselves, and the last part, [when a record does not arrive](#when-a-record-does-not-arrive), finds out why a record did not reach a peer.

Peer exchange is a choice for your operating model, not a prerequisite for every passport reader or writer. This page's setup names its peers, which every release supports. Overlay `0.4.0-beta.10` adds three things an index on beta.9 lacks: finding advertised indexes, advertising its own, and asking again for an output it left behind. Read an index's `GET /capabilities`, which names its package version, before relying on any of the three.

| Word | Meaning on this page |
|---|---|
| Peer | Another index this index reads records from. |
| Round | One synchronisation pass: the index asks each peer what it holds and admits what passes its own rules. Rounds run at start, then every `SYNC_INTERVAL_MS`, a minute by default. |
| GASP | The Graph Aware Synchronisation Protocol, the BSV overlay protocol a round uses. |
| Tip | A passport's newest state, the unspent output a peer offers. |
| Publisher policy | A signed list of the [publisher keys](../README.md#words-you-will-meet) an index admits states from, each with a key window. An index loads a chain of versions, oldest first. |
| Key window | When a key admits states: from its `activeFrom`, until its `retiredAt` if retired. |
| Checkpoint | How far an index has read a peer, stored per peer and topic. |

## Which way records flow

An index only pulls. Each round it asks the peers its own `SYNC_PEERS` names what they hold, and admits only what passes its own topic managers and publisher policy. Naming a peer gives that peer nothing, so records flow both ways only when each operator names the other.

Each index pulls `tm_dpp` and `tm_attestation`, and the historical `tm_uora_dpp` only when `SYNC_LEGACY=1`. Two indexes that pull from each other hold the same records only when their settings admit the same things: the publisher policy for passport states, `ANCHOR_SERVICE_KEYS` for anchors (or the policy's anchor-publisher keys when it covers `tm_attestation`), and `SYNC_LEGACY` for the historical topic. An index that names fewer anchoring services than its peer refuses the anchors the peer took from the others, and the two differ for as long as that holds. A peer's `GET /capabilities` names the anchoring services it admits under `publisherPolicy.anchoringServices`; an empty list means it admits any, as its `anchoring-service-restriction` entry under `unsupported` says.

Named peers are not the only source. The [services specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/services.md) section 1 asks a public index to advertise itself through SHIP and SLAP, the BSV overlay protocols that tell a client which hosts carry a topic or answer a lookup service. With `SYNC_DISCOVERY=ship` an index also pulls from the indexes that advertise its topics ([find peers automatically](#find-peers-automatically)), and with `ADVERTISE=1` it advertises itself ([advertise your index](#advertise-your-index)). Both are off unless set, and neither changes what is admitted.

### Discovery in the reviewed source

Discovery, advertising and the retry for outputs left behind entered the source between 7 and 9 October 2026 and are published in overlay `0.4.0-beta.10`, so this page describes them as released: [find peers automatically](#find-peers-automatically) and [advertise your index](#advertise-your-index) are the parts to read. The recipe below names its peers and works without either.

## Part one: set up

### Before you start

- A first index running from the Compose preset at `http://localhost:8080` ([run a service](README.md)), started with `--build` at least once. The second preset has no build step and runs the first one's image, `dpp-overlay:local`.
- The [reviewed source checkout](../quick-start.md#get-the-code), after `npm ci` and `npm run build`. Run every command here from its root, with discovery left off for this static-peer recipe.
- A WhatsOnChain API key. A synchronising index asks the header source once per state it admits, and without a key paces itself to about three requests a second.
- A choice of admission: the first index's single publisher key (steps 1, 2 and 4), or a publisher policy naming each key with its window (add step 3). Only a policy admits more than one key, which you need to pull from the hosted reference or another operator.

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
| `EXPORT_SIGNING_KEY`, `EXPORT_TOKEN` | Optional. If set, use the second index's own values, never the first's ([export, import and recovery](export-import-recovery.md)). |

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

Set each `activeFrom` at or before the oldest state you want from that key. A key admits no state dated earlier, even one the index you pull from holds. If you do not know that time, use an instant before the key could have signed anything, as `2026-01-01T00:00:00Z` does here; an earlier instant admits nothing the key did not sign. Do not copy another operator's window for its key: an index keeps states it admitted before loading its policy, so its window can start after states it still serves.

Three more rules:

- Keep `topics` at `["tm_dpp"]` unless the policy also names `anchor-publisher` keys: a scope covering `tm_attestation` admits anchors only from those keys.
- The first version also governs the time before its own `issuedAt`, so a policy written late still admits earlier states inside each key's window ([services](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) section 1).
- A later version names the previous one's digest in `supersedes` (`policyDigest` in `@bsv/dpp-core` computes it) and is authorised by a key the chain already trusts. The script below writes only a first version.

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

Give each index's chain its own file name, since both presets mount the same `deploy/config/`. The checkout path `deploy/config/policy-b.json` does not exist inside the container and stops the boot with `PUBLISHER_POLICY_FILE deploy/config/policy-b.json could not be read: ENOENT`. Without `OPERATOR_IDENTITY_KEYS` the boot stops with `policy version 1 refused, genesis-signer-not-operator`.

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

If your writer already announces to the first index, look one of its passports up on both indexes (item 3). To rehearse without a wallet, copy a live passport from the hosted reference into the first index:

1. Make both indexes admit the hosted reference application's publisher key. On a rehearsal first index, set `SERVICE_IDENTITY_KEY=0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24` in `deploy/operator.env` and apply it with `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d`. The second needs the same key or the step 3 policy.
2. Run the [package restore](export-import-recovery.md#restore-a-passport-from-the-bounded-package) with `REPLACEMENT_INDEX=http://localhost:8080` and the first index's `SUBMIT_TOKEN`. Expect five lines ending `200 tm_dpp=admitted`.
3. After the second index's next round, a minute at most, run the [passport lookup](../reference/contracts.md#find-passport-records) against each index:

   ```sh
   INDEX_URL=http://localhost:8080 node lookup.mjs
   INDEX_URL=http://localhost:8081 node lookup.mjs
   ```

   Both print `output-list with 5 outputs from ...` and the same five transaction identifiers (checked with two local indexes, the second under the step 3 policy).
4. Check the copy independently with `node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/7AC18477503A http://localhost:8081`, which ends `Inclusion across the chain: verified.`

The copy stays in both indexes until `down -v` on a preset removes everything that index holds. Use that only on rehearsal indexes, then set your own key again.

### 6. Exchange records both ways

1. Each operator sets `SYNC_PEERS` to the other's base URL. On one machine, only the second preset maps `host.docker.internal` to the host. Docker Desktop provides the name anyway; on Linux, give the first index a host address its container can reach.
2. Each publisher policy names the other's state-publisher keys, with windows that cover the states to exchange.
3. Each reads the other's `GET /capabilities`: `synchronisation.discovery` is `static-peers` and `synchronisation.peers` lists its own URL.
4. Each writes a state and looks it up on the other after the next round.

### 7. Confirm both hold the same records

Each index lists what it holds for a topic on `POST /requestSyncResponse`, the route its peers pull from: at most 500 outputs a page, each with a score, and the next page starts at the last score, which it repeats. That route lists current outputs only, so a passport counts once, by its newest state; the script below also compares each passport's whole history from `GET /history`, spent states included. Save this as `compare-indexes.mjs` at the root of the checkout, or in a project with `@bsv/dpp-core@0.3.0-beta.8` installed:

```js
// Compare what two indexes hold on every topic, and each passport's whole history, and fail on a difference older than the grace period:
// node compare-indexes.mjs <first index URL> <second index URL>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { tryParseDppOutput } from '@bsv/dpp-core'

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

A difference prints as `pending` until it has been seen for longer than `GRACE_MINUTES`, 120 by default, because a new state reaches a peer only once its proof arrives, up to about an hour after it was written. The time each difference was first seen is kept in `compare-indexes-state.json` (or the file `STATE_FILE` names), so run the script from the same directory each time. A difference older than that prints as `DIFFERENT` and the script exits with 1. An index that does not answer stops it with `not compared:` and exit code 2, so a silent peer never reads as agreement. Run it on a schedule, hourly for example, to notice a peer that stopped or fell behind. A difference that stays has its cause in the receiving index's log ([when a record does not arrive](#when-a-record-does-not-arrive)) or in settings that admit different things ([which way records flow](#which-way-records-flow)). An index that does not serve a topic answers 400 for it, which the script reports as a difference.

### Peer with the hosted reference or another operator

**Pull from the hosted reference.** Set `SYNC_PEERS=https://dpp-overlay.bsvb.net` and use the step 3 policy, which names the two keys its `GET /capabilities` lists under `publisherPolicy.publisherKeys`. The hosted index serves every passport state and anchor it holds with its merkle path (checked on 6 October 2026), so none fails for a missing proof; [when a record does not arrive](#when-a-record-does-not-arrive) covers other causes.

**Ask the hosted reference to pull from you.** Until its operator names your index and keys, records flow only from it to you. Ask through the [BSV Association contact form](https://bsvassociation.org/contact/) and send:

- your index's public HTTPS base URL;
- your publisher key, 66 hex characters, and the time of the oldest state it signed, so the reference's window for it refuses nothing;
- optionally, your operator identity key and signed chain, for the reference to check as [tell operators apart](#tell-operators-apart) describes.

Ask about proofs in the same message. A state the reference pulls from you reads `inclusion` pending there until its proof reaches the reference's own `POST /arc-ingest`, which needs the reference's callback token. Its operator decides whether and when to add you.

**Peer with another operator.** Exchange the same details directly. Each of you names the other's index in `SYNC_PEERS` and the other's keys in your policy.

### Tell operators apart

Before naming another operator's keys in your policy, compare the keys themselves, then ask the operator for its identity key and signed chain. An index with a policy serves its chain on `GET /publisher-policy`, and with an export key also as `authority/publisher-policy.json` in every evidence package. Take the identity key from the operator, never from the chain: the chain names its own signer, so checking it against itself proves nothing.

Capability documents cannot tell operators apart. The operator name is text bound to no key, and `publisherPolicy` has the policy version and keys but no chain digest or signer, so two indexes naming the same operator and keys may be one operator's two indexes or a copy.

Save this as `check-policy-chain.mjs` at the root of the checkout, or in a project with `@bsv/dpp-core@0.3.0-beta.8` installed:

```js
// Check another operator's signed publisher policy chain against the identity key the operator gave you.
import { readFileSync } from 'node:fs'
import { verifyPolicyChain } from '@bsv/dpp-core'

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

An index declares one of three operator profiles in its capability document and its evidence packages. `single-operator@1` means it neither pulls from peers nor discovers them. `single-operator@2` means one administration whose index pulls from peers it names or discovers: it exchanges records and claims nothing about independent replication, however many peers it has, which its `unsupported` list says as `independent-replication`. `federated-operators@1` is declared only when the index synchronises and the newest version of its publisher policy names two or more operators. That claims support, not independent operation. Two indexes under one administration, such as the two presets on one machine, demonstrate only the mechanism. Separately administered operation needs two organisations with their own administration, credentials, databases and infrastructure ([deploy README](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/deploy/README.md#a-second-operator)).

A publisher policy's own `scope.operatorProfile` names the administration the policy governs, `single-operator@1` or `federated-operators@1`, and does not change when the index adds peers or turns discovery on. The step 3 policy stays as written while the index it governs declares `single-operator@2` ([services specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/services.md) section 6).

## Find peers automatically

With `SYNC_DISCOVERY=ship`, an index pulls from the indexes that advertise its topics as well as from the peers `SYNC_PEERS` names, and it works with `SYNC_PEERS` empty. Nothing else changes: a discovered index's records pass the same topic managers and publisher policy as a named peer's, so match the admission settings first ([which way records flow](#which-way-records-flow)).

### Turn it on

Add to the index's environment file:

| Setting | Value |
|---|---|
| `SYNC_DISCOVERY` | `ship`. Unset leaves discovery off; any other value stops the boot. |
| `SLAP_TRACKERS` | Optional. Comma-separated base URLs of the SLAP trackers to ask. Unset uses the overlay SDK's defaults for `NETWORK`: on `main`, `https://overlay-us-1.bsvb.tech`, `https://overlay-eu-1.bsvb.tech`, `https://overlay-ap-1.bsvb.tech` and `https://users.bapp.dev`; on `test`, `https://testnet-users.bapp.dev`. An entry that is not an http or https URL stops the boot. |
| `SYNC_MAX_DISCOVERED` | Optional. The most discovered hosts a round pulls from, a positive integer; `16` when unset. |
| `PUBLIC_URL` | Your index's own base URL, so that it is left out of the hosts it discovers. |

`SLAP_TRACKERS` or `SYNC_MAX_DISCOVERED` without `SYNC_DISCOVERY` is a warning at start and discovers nothing. Apply the change with `up -d`; the start log then reads `synchronising tm_dpp and tm_attestation from <named peers> and at most 16 hosts found from SHIP adverts through <trackers> every 60000 ms`.

### What a round does

Before its first round, and before any round once ten minutes have passed since the last look, the index asks the trackers for the SHIP adverts of each topic it synchronises: `tm_dpp`, `tm_attestation`, and `tm_uora_dpp` with `SYNC_LEGACY=1`. An advert counts only when the SDK's `OverlayAdminTokenTemplate.decodeAndVerify` accepts its token, when it names the topic asked about, and when its address starts with `https://`; a tracker's answer is read 1,000 adverts a topic at most. The index's own `PUBLIC_URL` and every `SYNC_PEERS` entry are left out of the discovered hosts. When the trackers cannot be asked, the last answer stands. A look logs `peer discovery: hosts advertising tm_dpp: <hosts>; tm_attestation: <hosts>` when the answer changed, and counts the adverts it ignored.

The named peers are asked every round. Of the discovered hosts, at most `SYNC_MAX_DISCOVERED` are asked in a round; when more advertise, they are taken in turn round by round, so each is asked in time.

Before a discovered host is asked for anything, the index reads its `GET /capabilities`, ten seconds and 1 MiB at most, and keeps the answer ten minutes. The host is not asked for `tm_dpp` when both documents name publisher keys and share none, and not for `tm_attestation` when both restrict anchoring services and share none; an index whose `anchoringServices` is empty beside an `anchoring-service-restriction` entry under `unsupported` restricts nothing and is asked. Only a certain mismatch excludes a host, so a document without a readable `publisherPolicy` excludes nothing. Each exclusion is logged once per host and topic as `peer discovery: <host> admits nothing this index admits for tm_dpp, so it is not asked for tm_dpp`. Asking anyway would cost a header check for every graph and end in refusals.

A host whose capability document could not be read, or whose offered outputs could not be read during the round, sits out: one round the first time, then twice as many each time it fails again, up to a day of rounds, 1,440 at the default interval. A host that answers again is forgiven. The log says `peer discovery: <host> could not be read this round; it sits out 2 rounds`.

A discovered address is a lead, never trust. The token proves that the key it names signed the advert and nothing about who runs the host, and discovery authorises no publisher: a state a discovered index offers is admitted only under your publisher policy, and an anchor only under your anchoring settings, exactly as from a named peer. [When a record does not arrive](#when-a-record-does-not-arrive) applies to a discovered peer as to a named one, and its checkpoint is stored under the address the advert names, without a trailing slash, which is what [move a checkpoint back](#move-a-checkpoint-back) deletes.

### The capability document with discovery on

`synchronisation.discovery` is `ship-slap`, `gasp` is `true` from the start, before any host is found, and `peers` lists every peer the last round asked, the named ones first; the operator profile entry under `profiles` carries the same values. With discovery on and advertising off, `unsupported` carries `ship-slap-advertising`: this node finds peers from SHIP adverts but advertises nothing of its own, and other indexes reach it only by naming it. The profile is `single-operator@2` under a one-operator policy and `federated-operators@1` under a policy naming two or more ([what two indexes demonstrate](#what-two-indexes-demonstrate)).

### What it does not bound

The index sets no page or time budget of its own on a discovered peer: a round reads what the overlay SDK's synchronisation asks for and fetches every graph behind it with no time limit, and rounds do not overlap, so a large or slow discovered peer lengthens every round ([known limitations](limitations.md#synchronisation)). Lower `SYNC_MAX_DISCOVERED`, or name trackers you choose in `SLAP_TRACKERS`, to narrow who is asked. The [discovery source](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/discovery.ts) defines every rule above.

## Advertise your index

With `ADVERTISE=1`, an index creates the SHIP and SLAP adverts that let an index with discovery on find it: one advert per topic and lookup service, each a 1-satoshi token the SDK's `OverlayAdminTokenTemplate` builds, signed by an advertiser key of its own and naming `PUBLIC_URL`. An advert says where your index is. It makes nobody admit your records: an index that finds you still admits only the publisher keys its own policy names, so ask its operator to name yours, as [peer with the hosted reference or another operator](#peer-with-the-hosted-reference-or-another-operator) describes.

### Turn it on

| Setting | Value |
|---|---|
| `ADVERTISE` | `1`. Unset leaves advertising off; any other value stops the boot. |
| `PUBLIC_URL` | Your index's base URL as other indexes reach it, starting with `https://`; trailing slashes are dropped. |
| `ADVERTISER_PRIVATE_KEY` | A private key in hex for advertising alone, never the operator identity key, the export key or the publisher key. Its public key signs the adverts, and its wallet pays for them. |
| `ADVERTISER_STORAGE_URL` | The `https://` address of the wallet storage server holding that key's coins. |

A missing or malformed value stops the boot with a message naming the variable. `ADVERTISER_PRIVATE_KEY` or `ADVERTISER_STORAGE_URL` without `ADVERTISE` is a warning at start and advertises nothing.

Fund the advertiser's wallet at that storage server before the first start. A start creates at most six tokens, one each for `tm_dpp`, `tm_attestation`, `tm_uora_dpp`, `ls_dpp`, `ls_attestation` and `ls_uora_dpp`, of one satoshi each plus the transaction fee, so a small balance is enough, and a start with every advert present spends nothing.

### What a start does

Once the socket listens, the index asks the overlay SDK's default trackers for `NETWORK`, whatever `SLAP_TRACKERS` says, which SHIP and SLAP adverts its advertiser key already has at `PUBLIC_URL`, and creates only the missing ones, in one transaction its wallet funds and hands to the hosts of `tm_ship` and `tm_slap`. The log then reads `advertising: SHIP tm_dpp, SHIP tm_attestation, ... at <PUBLIC_URL> under <identity key>, in <txid>`, or `advertising: every topic and lookup service is already advertised at <PUBLIC_URL> under <identity key>`. When the trackers cannot say which adverts exist, nothing is created.

A failure after the boot is a log line, `advertising failed, so other indexes find this one only if they name it: <reason>`, and the index keeps serving and pulling. Advertising is tried once per start, so fix the cause and restart.

Nothing revokes an advert. An index that moves host, or stops for good, leaves its old adverts in place; the trackers keep returning them, and indexes that discover the old address find nothing there and back off. To take them down, spend the tokens with the advertiser's wallet; the index never does ([known limitations](limitations.md#index-host)).

### The wallet library

The wallet comes from `@bsv/wallet-toolbox-client` 2.11.0, an optional dependency of the package. `npm install` installs it; `npm install --omit=optional` leaves it out, and `ADVERTISE=1` then logs `advertising failed, so other indexes find this one only if they name it: ADVERTISE=1 needs @bsv/wallet-toolbox-client installed beside this package (npm install @bsv/wallet-toolbox-client)` and serves without advertising. The image the [Dockerfile](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/Dockerfile) builds includes it. The library is loaded only when an index with `ADVERTISE=1` starts; importing the package loads nothing of it.

### The capability document with advertising on

With advertising on, `unsupported` no longer carries `ship-slap-advertising`. With advertising on and discovery off, it carries `ship-slap-discovery` with the reason `This node advertises itself but finds no peers from adverts; it pulls only from the peers it names.` Advertising changes neither `synchronisation.discovery`, which stays `static-peers` with named peers and `none` without, nor the operator profile. The [advertising source](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/advertise.ts) defines the rules above.

## When a record does not arrive

Only the synchronising index knows why a record did not arrive. The index that offered it logs only its answer, such as a 404 for a transaction it does not hold. No route serves either log, so a writer whose state has not reached a peer asks that peer's operator.

### Read the synchronising index's log

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env logs --since 1h overlay-b | grep -E 'did not arrive|left behind|refused|Status: 404'
```

After each round the index compares what each peer offered with what arrived, and holds its checkpoint for anything missing:

```
peer synchronisation round 1: 17 of 97 outputs offered by https://dpp-overlay.bsvb.net for tm_dpp did not arrive; checkpoint held at 1787744549666 so they are offered again
```

An output still missing after five rounds is left behind and named: `left behind after 5 rounds, offered by <peer> for tm_dpp and never admitted: <txid>.<output>; asked for again in 60 rounds`. The checkpoint moves past it, so the rounds in between do not offer it. After about an hour of rounds, 60 at the default interval, the index holds the checkpoint at it once more and logs `asking <peer> again for 1 output left behind for tm_dpp`; each time the output is left behind again the wait doubles, up to about a day of rounds. The retry fixes nothing by itself: a state your own admission refused is refused again, and a graph the peer could not serve stays missing until the peer can serve it. The schedule lives in memory, at most 10,000 outputs per peer and topic, and a restart forgets it and resumes from the stored checkpoint. After fixing the cause, [move the checkpoint back](#move-a-checkpoint-back) rather than waiting; [the synchroniser](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/sync.ts) defines the schedule. An index on beta.9 names the output once and never asks again, so there the checkpoint procedure is the only way.

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

A proof reaches an index only through that index's own `POST /arc-ingest`, and a peer's `/arc-ingest` answers 404 until the state has arrived there. A writer that knows its index's peers can deliver each proof to them too, retrying that 404, with each peer's own callback token from that peer's operator ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). Nobody is named yet to do this: a writer offers each proof to the indexes it announced the state to ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 7), and the [overlay package](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md#running-two-operators-locally) expects a writer or gateway to push it to every operator it knows. The [federation test](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/test/federation.test.ts#L395-L419) shows a later proof staying on one index until it is pushed to the other.

How a retraction reaches a peer that already synchronised the withdrawn state is not specified yet ([known limitations](limitations.md)).

### Take a record from the chain

A mined transaction's proof does not depend on any peer. WhatsOnChain serves it as a BUMP at `https://api.whatsonchain.com/v1/bsv/main/tx/<txid>/proof/bump`, which `MerklePath.fromHex` from `@bsv/sdk` reads, and the transaction with its proof as a BEEF at `/tx/<txid>/beef`. Check the proof's root against the block header yourself before your index sees it, as `examples/check-registry.mjs` does.

- **A state your index holds unproven:** send the BUMP to your own `POST /arc-ingest` as `{ "txid", "merklePath", "blockHeight" }`, with your callback token.
- **An anchor your index never received:** send its BEEF to your own `POST /submit` with `X-Topics: ["tm_attestation"]`, or `["tm_uora_dpp"]` for a historical anchor, and your submit token. Your index's rules still apply, so an anchor from a service it does not accept is refused.
- **A passport state your index never received:** announce it the same way with `X-Topics: ["tm_dpp"]`, oldest state first, since each state is admitted only on top of its predecessor.

### Move a checkpoint back

Once the cause is fixed, delete that peer's checkpoints; no setting re-synchronises from a chosen point. The next round asks the peer for everything it holds again, and outputs already held are admitted as no-ops. Each checkpoint is a document `{ host, topic, since }` in the `overlayInteractions` collection, with `host` exactly as `SYNC_PEERS` names the peer, without a trailing slash. For the second preset, whose database is `dpp` unless `MONGO_DB` says otherwise:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env exec mongo-b mongosh dpp --quiet --eval 'db.overlayInteractions.deleteMany({ host: "http://host.docker.internal:8080" })'
```

Expect `{ acknowledged: true, deletedCount: 1 }` or more, one per topic the peer had delivered from. In a local test, the next round read the peer from the start (`since: 0`) and admitted nothing twice.

## Sources

- [Second-operator preset](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/compose.second-operator.yml) and the [preset README](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/README.md), including backup of a node's volume.
- [Peer configuration, reconciliation and the left-behind retry](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/sync.ts), [peer discovery](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/discovery.ts), [advertising](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/src/advertise.ts) and every setting in the overlay package's [configuration table](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/packages/overlay-topics/README.md#configuration).
- The [services specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) for admission, publisher policy and synchronisation requirements, and the [publisher policy schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json).
- The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records what local tests do not establish about independent operation.

Next: keep evidence you can restore elsewhere with [export, import and recovery](export-import-recovery.md), and read [known limitations](limitations.md) before relying on a peer.
