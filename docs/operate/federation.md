# Federation with static peers

Use this page to make one index hold another's records: a second index of yours, another operator's, or the hosted reference. Part two, [when a record does not arrive](#when-a-record-does-not-arrive), finds out why a record did not reach a peer.

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

Indexes do not find each other. The [services specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) section 1 asks a public index to advertise itself through SHIP and SLAP, the BSV overlay protocols that tell a client which hosts carry a topic or answer a lookup service, but the overlay package does not do that yet.

## Part one: set up

### Before you start

- A first index running from the Compose preset at `http://localhost:8080` ([run a service](README.md)), started with `--build` at least once. The second preset has no build step and runs the first one's image, `dpp-overlay:local`.
- A checkout of the repository on `main`, after `npm ci` and `npm run build`. Run every command here from its root.
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

Expect `"discovery": "static-peers"`, `"gasp": true`, `peers` listing `http://host.docker.internal:8080`, and `publisherKeys` listing the keys the index admits now. Key windows are not shown: they are only in the operator's signed chain ([tell operators apart](#tell-operators-apart)).

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

### Peer with the hosted reference or another operator

**Pull from the hosted reference.** Set `SYNC_PEERS=https://dpp-overlay.bsvb.net` and use the step 3 policy, which names the two keys its `GET /capabilities` lists under `publisherPolicy.publisherKeys`. Expect a partial copy. On 1 October 2026 a fresh index under that policy received 80 of the 97 passport tips and 20 of the 61 anchors offered in its first round, and after five rounds left 16 tips and 41 anchors behind. The policy refused none. They failed with 404 because the hosted index serves some mined states without their merkle paths ([when a record does not arrive](#when-a-record-does-not-arrive)).

**Ask the hosted reference to pull from you.** Until its operator names your index and keys, records flow only from it to you. Ask through the [BSV Association contact form](https://bsvassociation.org/contact/) and send:

- your index's public HTTPS base URL;
- your publisher key, 66 hex characters, and the time of the oldest state it signed, so the reference's window for it refuses nothing;
- optionally, your operator identity key and signed chain, for the reference to check as [tell operators apart](#tell-operators-apart) describes.

Ask about proofs in the same message. A state the reference pulls from you reads `inclusion` pending there until its proof reaches the reference's own `POST /arc-ingest`, which needs the reference's callback token. Its operator decides whether and when to add you.

**Peer with another operator.** Exchange the same details directly. Each of you names the other's index in `SYNC_PEERS` and the other's keys in your policy.

### Tell operators apart

Before naming another operator's keys in your policy, compare the keys themselves, then ask the operator for its identity key and signed chain. An index with a policy serves its chain on `GET /publisher-policy`, and with an export key also as `authority/publisher-policy.json` in every evidence package. Take the identity key from the operator, never from the chain: the chain names its own signer, so checking it against itself proves nothing.

Capability documents cannot tell operators apart. The operator name is text bound to no key, and `publisherPolicy` has the policy version and keys but no chain digest or signer, so two indexes naming the same operator and keys may be one operator's two indexes or a copy.

Save this as `check-policy-chain.mjs` at the root of the checkout, or in a project with `@bsv/dpp-core@0.3.0-beta.7` installed:

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

An index claims `federated-operators@1` in its capability document only when it synchronises with peers and the newest version of its policy names two or more operators; otherwise it stays `single-operator@1`. That claims support, not independent operation. Two indexes under one administration, such as the two presets on one machine, demonstrate only the mechanism. Separately administered operation needs two organisations with their own administration, credentials, databases and infrastructure ([deploy README](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/README.md#a-second-operator)).

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

An output still missing after five rounds is named once, as `left behind after 5 rounds, offered by <peer> for tm_dpp and never admitted: <txid>.<output>`. It is never asked for again, even after a restart, which resumes from the stored checkpoint.

### Find the cause

| What the log shows | Cause | What to do |
|---|---|---|
| `tm_dpp refused <txid>: server_signature is not from a state-publisher key active at <time>` | The state's publisher key is not in your policy, or `<time>` is before the key's `activeFrom`. Without a policy there is no such line; the state shows only as did not arrive. | Correct the policy (step 3) or the key, restart, then [move the checkpoint back](#move-a-checkpoint-back). For a chain others rely on, issue a later version, not a new first one. |
| `tm_dpp refused <txid>: <another reason>` | The state breaks a record rule your index applies, such as a missing acceptance commitment under `ACCEPTANCE_COMMITMENT=required`. | Match the admission settings to the index you pull from, or accept that the two disagree. |
| `Failed to verify merkleroot for height <height>` | Your header source did not answer for that block, usually WhatsOnChain limiting anonymous requests, so the proven state was dropped for that round. | Set `WOC_API_KEY`; if an output was left behind, [move the checkpoint back](#move-a-checkpoint-back). |
| `Error with incoming UTXO <txid>.<output>: HTTP error! Status: 404` | The peer cannot serve the state's graph, usually because it holds a mined state without its merkle path, so your index asks for ancestors the peer lacks. The hosted reference does this for some states. | Ask the peer's operator to deliver the missing proofs to its own `POST /arc-ingest`, then move the checkpoint back. Or [take the record from the chain](#take-a-record-from-the-chain) yourself. |
| The state is unproven and its writer's wallet funded it from another passport's change | A known limit of `@bsv/dpp-overlay-topics@0.4.0-beta.9`: the peer reaches the other passport through the change output and asks for its predecessor, which it cannot get. The topic now asks only through the passport output, but `@bsv/overlay` up to 2.6.2 does not say which output a walk arrived by. | Wait for the first round after the state is mined ([known limitations](limitations.md)). |
| Nothing: the peer keeps the previous tip of a passport it holds | The new state is unproven. The overlay SDK needs an unproven state's parent in the graph it assembles but leaves out a parent the peer already holds, so the state cannot arrive; a new passport can. | Push the state's proof to the node the peer pulls from. The next round carries the state with its proof, and the peer admits it on the tip it holds. |
| Nothing: the state arrived, but readers of the peer see `inclusion` pending | A proof that arrives after a peer synchronised the state does not follow it. | Deliver the proof to the peer (below), or [take it from the chain](#take-a-record-from-the-chain) yourself. |

A proof reaches an index only through that index's own `POST /arc-ingest`, and a peer's `/arc-ingest` answers 404 until the state has arrived there. A writer that knows its index's peers can deliver each proof to them too, retrying that 404, with each peer's own callback token from that peer's operator ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). Nobody is named yet to do this: a writer offers each proof to the indexes it announced the state to ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 7), and the [overlay package](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md#running-two-operators-locally) expects a writer or gateway to push it to every operator it knows. The [federation test](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/test/federation.test.ts#L395-L419) shows a later proof staying on one index until it is pushed to the other.

How a retraction reaches a peer that already synchronised the withdrawn state is not specified yet ([known limitations](limitations.md)).

### Take a record from the chain

A mined transaction's proof does not depend on any peer. WhatsOnChain serves it as a BUMP at `https://api.whatsonchain.com/v1/bsv/main/tx/<txid>/proof/bump`, which `MerklePath.fromHex` from `@bsv/sdk` reads, and the transaction with its proof as a BEEF at `/tx/<txid>/beef`. Check the proof's root against the block header yourself before your index sees it, as `examples/check-registry.mjs` does.

- **A state your index holds unproven:** send the BUMP to your own `POST /arc-ingest` as `{ "txid", "merklePath", "blockHeight" }`, with your callback token.
- **An anchor your index never received:** send its BEEF to your own `POST /submit` with `X-Topics: ["tm_attestation"]` and your submit token. Your index's rules still apply, so an anchor from a service it does not accept is refused.
- **A passport state your index never received:** announce it the same way with `X-Topics: ["tm_dpp"]`, oldest state first, since each state is admitted only on top of its predecessor.

### Move a checkpoint back

Once the cause is fixed, delete that peer's checkpoints; no setting re-synchronises from a chosen point. The next round asks the peer for everything it holds again, and outputs already held are admitted as no-ops. Each checkpoint is a document `{ host, topic, since }` in the `overlayInteractions` collection, with `host` exactly as `SYNC_PEERS` names the peer, without a trailing slash. For the second preset, whose database is `dpp` unless `MONGO_DB` says otherwise:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env exec mongo-b mongosh dpp --quiet --eval 'db.overlayInteractions.deleteMany({ host: "http://host.docker.internal:8080" })'
```

Expect `{ acknowledged: true, deletedCount: 1 }` or more, one per topic the peer had delivered from. In a local test, the next round read the peer from the start (`since: 0`) and admitted nothing twice.

## Sources

- [Second-operator preset](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/compose.second-operator.yml) and the [preset README](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/README.md), including backup of a node's volume.
- [Peer configuration and reconciliation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/src/sync.ts) and every setting in the overlay package's [configuration table](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md#configuration).
- The [services specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md) for admission, publisher policy and synchronisation requirements, and the [publisher policy schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/publisher-policy.schema.json).
- The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records what local tests do not establish about independent operation.

Next: keep evidence you can restore elsewhere with [export, import and recovery](export-import-recovery.md), and read [known limitations](limitations.md) before relying on a peer.
