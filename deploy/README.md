# Running the reference index as an operator

One supported preset, on Docker Compose: the index node from this repository's image and a MongoDB beside it, both on named volumes, configured from one env file. It is the same node `packages/dpp-overlay/README.md` documents, with nothing added and nothing taken away; this directory only fixes an arrangement that persists. Everything here is informative, as [`../docs/deployment.md`](../docs/deployment.md) is: the standard requires no particular host.

This is how to run a new index. It replaces the retired index starter, `@bsv/create-dpp-index`, whose published `0.1.0-beta.1` stays on npm; [Index starter (retired)](../docs/packages/create-dpp-index.md) maps what that starter generated onto this preset. [Run an index from source](../docs/operate/README.md) is the step-by-step guide.

## What the preset is

| Piece | What it runs | Where its state lives |
|---|---|---|
| `overlay` | `packages/dpp-overlay/Dockerfile`, built from the repository root: `tm_dpp`, `tm_attestation`, the historical UORA topic, their lookup services, the HTTP routes of `contracts/overlay.yaml` | Nothing on disk of its own. Everything admitted is in MongoDB |
| `mongo` | MongoDB 7 | The named volume `mongo-data`: the engine's outputs and transactions, the passport and anchor indexes, the sequences |
| `deploy/operator.env` | The configuration, copied from `operator.env.example` | Local file, never committed (`.gitignore`) |
| `deploy/app.env` | An application's connection, written by `dpp-index connection` | Local file, never committed; handed to the application's operator |
| `deploy/config/` | A publisher policy chain, when one is used as a file; `PUBLISHER_POLICY_JSON` carries the same chain inline where a host cannot mount one | Mounted read-only at `/config` |

The configuration carries the service identity's public key (the private half stays in the writer's wallet and is never given to the node) and these secrets: the export signing key (a key of its own, for signed evidence packages; leave it empty and both export routes answer 503), each writer's submit and callback tokens (per publisher, each bound to one key and one use, hashed in the preset's MongoDB and issued inside the container; until one is issued every write is refused, and the operator-wide `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN` are optional) and the export bearer (`EXPORT_TOKEN`, for the complete export; leave it empty and `GET /evidence-export` is open to anyone). Three more appear only with the feature that needs them: the operator signing key (`OPERATOR_SIGNING_KEY`, for `REGISTRATION`), the advertiser's funded wallet key (`ADVERTISER_PRIVATE_KEY`, for `ADVERTISE`) and a managed database's credentials in `MONGO_URL`. Every one of them reaches the container only through the environment list in the Compose file, so a name the file does not forward is not set by putting it in the env file. The node holds no custody key: it cannot spend a passport, sign a state or countersign one, and a compromised index changes what can be found and never what can be believed.

## Start it

```
cp deploy/operator.env.example deploy/operator.env
# fill in SERVICE_IDENTITY_KEY, NETWORK and PUBLIC_URL; the rest may stay as the example has them
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl -s http://localhost:8080/health
curl -s http://localhost:8080/capabilities
```

`/health` names the topics and services; `/capabilities` is the capability document (`contracts/capabilities.schema.json`), which says which custody profiles this node admits (`managed-custody@2` when `ACCEPTANCE_COMMITMENT=required` in this source candidate, `managed-custody@1` in the published October set, otherwise the record model's baseline), whether it exports, and whether it synchronises.

The header source is the trust boundary of the inclusion check. Left empty, `CHAIN_TRACKER` is WhatsOnChain on `NETWORK`, a third party's headers; the node has no setting for another header service yet, and `WOC_API_KEY` raises WhatsOnChain's rate limit. `CHAIN_TRACKER=scripts-only` is a local fixture and demonstration setting: it admits unproven ancestry, verifies no merkle path, and every state it serves reads `pending` to a verifier. It never claims inclusion, and a reachable deployment must not run it.

## Connect an application

The node's own command line issues an application its submit and callback tokens, bound to the publisher key (`SERVICE_IDENTITY_KEY` unless `--publisher` names another), and prints the connection file the application starter reads: `NETWORK`, `INDEX_URL` (`PUBLIC_URL` unless `--url` names another address), `INDEX_SUBMIT_TOKEN` and `INDEX_CALLBACK_TOKEN`.

```
umask 077
docker compose -f deploy/compose.yml --env-file deploy/operator.env exec -T overlay node packages/dpp-overlay/dist/cli.js connection > deploy/app.env
```

The tokens are printed once and only their SHA-256 is stored, so keep `deploy/app.env` private and hand it over privately. A generated application takes it with `npm run connect-index -- --from <path>`; any other application copies the four lines into its server-side environment. Running the command again rotates the pair: it revokes the tokens the same `--label` (default `app`) issued that key before. `... cli.js tokens list` shows what is held and `tokens revoke --sha256 <digest>` withdraws one.

Behind a TLS proxy on the same host, set `OVERLAY_PORT=127.0.0.1:8080` so the plain HTTP port is published on loopback only, and `PUBLIC_URL` to the proxy's https origin. The bundled MongoDB publishes no port and is reachable only on the Compose network; `MONGO_URL` replaces it with a managed, authenticated database.

## What the node says at each step

A writer announcing a state gets the `X-Admission` header: `admitted` means the topic manager accepted the draft under the record rules and this node's policy, `duplicate` that it already held the state, `none` that it refused. Admission is not broadcast: the node does not send transactions, the writer's wallet does (`spec/writing.md` §5), and an admitted state that the network then refuses is withdrawn with `POST /retract`. A state is `pending` to every verifier until its merkle path reaches the node through `POST /arc-ingest`, pushed by the writer or by the gateway whose callback the writer pointed here; only then does a lookup answer carry the proof and a verifier read `verified`. Nothing this node answers is a claim about the network; `spec/verification.md` §5 is what a reader makes of an index's word.

## Restart, back up, restore

A restart keeps everything: `docker compose ... restart overlay` or a host reboot brings the node back over the same volume, and a lookup answers what it answered before. The volume is the backup unit: `docker run --rm -v dpp-overlay_mongo-data:/data -v "$PWD":/out mongo:7 tar czf /out/mongo-data.tgz /data` copies it, and restoring is the reverse into an empty volume before the first start.

The portable form is the evidence package (`spec/portable-evidence.md`): with `EXPORT_SIGNING_KEY` set, `GET /evidence-package?passportId=...` serves every retained state's transaction and BEEF, the publisher policy, the spend observations and a report, inventoried and signed. A second operator restores a passport from it by submitting the `proofs/` BEEFs, genesis first, to its own `/submit`, which admits each through the same topic managers as a live announcement; the overlay suite's `evidenceExport.test.ts` does exactly that and then discards the first operator. That package is bounded to the newest 500 states and says so; a lineage longer than that is recovered through `GET /evidence-export?passportId=...`, the complete export, which answers one bounded part per request over one snapshot with a cursor for the next, and which a second operator joins and restores exactly the same way (`evidenceExportParts.test.ts` does it with 505 states). Set `EXPORT_TOKEN` to put the complete export behind a bearer; the bounded package stays open. Restricted tiers are never in a package, and a package is never a recovery of a lost custody key.

## A second operator

`compose.second-operator.yml` is the second node: its own MongoDB, its own identity, tokens (including its own `EXPORT_TOKEN`) and export key, a second env file, and `SYNC_PEERS` pointing at the first (`http://host.docker.internal:8080` when both run on one machine). It pulls the first operator's tips through GASP every `SYNC_INTERVAL_MS` and admits every offered output through its own topic managers, so a peer can make evidence findable and never make it admitted.

```
cp deploy/operator.env.example deploy/operator-b.env
# a different SUBMIT_TOKEN and EXPORT_SIGNING_KEY; the SAME SERVICE_IDENTITY_KEY, or a publisher policy naming both
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
```

What the pair proves, and what it does not, is `packages/dpp-overlay/README.md`, Running two operators locally: the mechanism (initial synchronisation, restart and catch-up, admission during synchronisation, independent verification of the same bytes), never independence. Two containers on one machine under one administration are one operator twice; `federated-operators@1` is claimed only by two organisations with separate administrations, credentials, databases and infrastructure. Where the two nodes' policies differ, their answers differ and each capability document says so; a state one refuses and the other admits stays visible as a disagreement, and adding a third node settles nothing, because acceptance by an index is not finality and never was.

Set `WOC_API_KEY` on a synchronising node: a round asks the header source once per state, and anonymous access answers 429 past a few a second; the node paces and retries, but a key is what a full corpus needs. Three limits of synchronisation stand whatever the topology. A proof that reaches one operator does not travel to the other through GASP; each receives it through its own `/arc-ingest`. An unproven state announced during a partition arrives once its proof reaches the source. And synchronisation carries the current outputs and their lineages, not every historical artefact: an operator that needs the complete retained evidence restores from the evidence package.
