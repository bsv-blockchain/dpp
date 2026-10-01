# Federation with static peers

## Configure the second instance

First build and run the [initial operator](README.md). The second preset uses the image built by the first, and has a separate database and named volume.

Copy `deploy/operator.env.example` to `deploy/operator-b.env`. Set `OVERLAY_PORT` to any free port, `8081` in the commands below, so the published ports do not collide; the checks that follow use whichever port you chose. Set `SYNC_PEERS=http://host.docker.internal:8080` for the supplied same-machine arrangement; on separate hosts use an address reachable from the second container. Set `WOC_API_KEY`: a synchronising node asks the header source once per state it admits, and anonymous access is rate limited. Where the host cannot mount a file, `PUBLISHER_POLICY_JSON` carries the policy chain inline instead of `PUBLISHER_POLICY_FILE`.

`SYNC_PEERS` is the complete list of the other nodes this node reads from, and it is set on the node that reads: setting it replaces the list the node had, and it never names the node's own address, since a node given only itself learns nothing. For records to flow both ways, each node names the other. The node reads it when it starts, so a change takes effect after a restart or a redeploy. Then check the node's `GET /capabilities`: `synchronisation.peers` lists the peers it now reads from.

Use separate submit, callback and export secrets. For the first shared-record exercise, use the same publisher public key as the first instance, or a publisher policy accepting the relevant keys. An operator's own identity and its accepted publisher keys answer different questions.

After filling in the second file, start and inspect it:

```sh
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
curl --fail http://localhost:8081/health
curl --fail http://localhost:8081/capabilities
```

## Which way records flow

A node synchronises by pulling. Each round it asks the peers its own `SYNC_PEERS` names for what they hold, and admits what passes its topic managers and its publisher policy. Naming a peer gives that peer nothing: after the steps above the second instance holds what the first admitted, and the first holds nothing the second admitted.

For two operators to exchange records both ways:

1. Each sets `SYNC_PEERS` to the other's base URL.
2. Each publisher policy names the other's state-publisher keys, with an `activeFrom` that covers the states to exchange ([sign a publisher policy](#sign-a-publisher-policy)).
3. Each reads the other's `GET /capabilities`: `synchronisation.discovery` is `static-peers` and `synchronisation.peers` lists its own URL.
4. Each writes a state and looks it up on the other after the next round, a minute later by default (`SYNC_INTERVAL_MS`).

Nodes do not find each other. The [specification](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md) asks a public overlay to advertise through SHIP/SLAP in section 1, and the overlay package does not yet, so a node's only peers are the ones its operator names. To exchange records with the hosted reference, its operator has to name your node and your publisher keys; [the running overlays](../deployment.md#overlays-running-now) lists who runs what.

One known limit in `@bsv/dpp-overlay-topics` 0.4.0-beta.3: a passport state the writer's wallet funded from another passport's transaction does not reach a peer that lacks that other passport's history until the new state is mined. Walking back from the unproven state, the peer reaches the other passport's state through its change output and asks for that state's predecessor, which it cannot get, so it leaves the new state behind. Once the new state is mined, the next round takes it.

## Sign a publisher policy

An index that admits states from more than its own publisher key needs a publisher policy chain: which keys may publish, from when, authorised by the operator. Write the first version unsigned:

```json
{
  "policyFormat": "dpp-publisher-policy@1",
  "policyVersion": 1,
  "scope": { "operatorProfile": "single-operator@1", "operators": ["Example operator"], "topics": ["tm_dpp"] },
  "publishers": [
    { "key": "<writer identity key, 66 hex>", "role": "state-publisher", "activeFrom": "2026-07-26T14:20:00Z" }
  ]
}
```

Then sign it with the operator's identity key, which never goes into the index:

```sh
OPERATOR_PRIVATE_KEY=<64 hex> node examples/sign-publisher-policy.mjs policy.unsigned.json policy.json
```

The script checks the chain the way an index does at boot and writes it only if it verifies; `node examples/sign-publisher-policy.mjs --dry-run` shows the check and its refusals with a key made for the run. Give the index the written file as `PUBLISHER_POLICY_FILE`, or its text as `PUBLISHER_POLICY_JSON`, and the `OPERATOR_IDENTITY_KEYS` line the script prints.

Three rules decide what the policy admits:

- A key admits only states dated at or after its `activeFrom`. The first version governs the time before its own `issuedAt`, so a policy written late still admits earlier states inside each key's window ([services](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md) section 1).
- Keep `topics` at `["tm_dpp"]` unless the policy also names `anchor-publisher` keys: a policy whose scope covers `tm_attestation` admits anchors only from those keys.
- A later version names the digest of the one before in `supersedes` and is authorised by a key the chain already trusts; `policyDigest` computes the digest.

A node claims `federated-operators@1` only when it synchronises with peers and the newest version of its policy names two or more operators. Peers under a single-operator policy stay `single-operator@1`, and two nodes under one administration demonstrate the mechanism, not separately administered operation.

## Observe the exchange

Use the [same passport lookup](../reference/contracts.md#find-passport-records) against each operator by changing `INDEX_URL`. After the first has admitted records and synchronisation has run, inspect which records the second holds and verify them independently. Where each names the other, check the reverse direction too: a record written to the second arrives on the first.

Check an initially empty peer, a restarted peer catching up and a record the second policy refuses. Synchronisation makes candidates available; local admission still evaluates them. After each round the node checks what the peer offered against what arrived, holds its checkpoint where something did not so the next round offers it again, and leaves an output behind after five rounds, naming it in the log.

A left-behind output is not offered again once the checkpoint has moved past it, and no setting re-synchronises from a chosen point. Once its cause is fixed, clear that peer's checkpoint: the node keeps one document per peer and topic in the `overlayInteractions` collection, `{ host, topic, since }`, with `host` the peer's URL as `SYNC_PEERS` names it, without a trailing slash. Delete that peer's documents, for example `db.overlayInteractions.deleteMany({ host: "https://peer.example" })` in `mongosh`, and the next round asks the peer for everything it holds again; outputs the node already holds are admitted as no-ops. Two containers controlled by one administrator demonstrate the mechanism, not separately administered operation.

## When a record does not arrive

Only the synchronising node knows why. Its log says, round by round, how many offered outputs did not arrive and names each one it leaves behind; the offering node logs only the answer it gave, such as a 404 for a transaction it does not hold. No route serves either log, so a writer whose state has not reached a peer asks that peer's operator.

Once the node leaves an output behind, it does not ask for it again, not even after a restart, because a restart resumes from the stored checkpoint. When the cause is fixed, move that peer's checkpoint back as [observe the exchange](#observe-the-exchange) describes.

A proof that arrives after a peer synchronised the state does not follow it (see [preset sources](#preset-sources)), and no one is named to deliver it yet: a writer offers each proof to the indexes it announced the state to ([writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/writing.md) section 7), and a peer's `/arc-ingest` answers 404 until the state has arrived there. The [overlay package](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/README.md#running-two-operators-locally) expects a writer or a gateway to push the proof to every operator it knows. A writer that knows its index's peers can therefore offer each proof to them too, retrying a 404 until the state has arrived, but only with each peer's own callback token, which that peer's operator has to give it ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). Until someone delivers it, readers of the peer see `inclusion` pending.

## Tell operators apart

An operator name in a capability document is text bound to no key, and `publisherPolicy` gives the policy version and the keys but no digest of the chain and no signer. Two nodes that name the same operator and the same keys may be one operator's two nodes or a copy, and the documents alone cannot tell which. Before naming another operator's keys in your policy, compare the keys themselves, ask the operator for its signed chain and its identity key, and check the chain against that key with `verifyPolicyChain`.

## Preset sources

The reference host uses the Graph Aware Synchronisation Protocol (GASP) with configured peers.

Read the [second-operator preset](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/deploy/compose.second-operator.yml) and [peer configuration](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/src/sync.ts) before choosing keys, publisher policy and peer addresses. The [service source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md) holds admission and synchronisation requirements.

Newly synchronised states can carry proofs. A later proof update to an already-held output needs a separate ingestion path in this reference host. The [federation tests](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/test/federation.test.ts#L292-L337) exercise that distinction.

Use [recovery](export-import-recovery.md) for evidence outside the synchronised history. The [limitations](limitations.md) and [ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) identify what local tests do not establish about independent operation.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
