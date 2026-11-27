# Running the reference index as an operator

One supported preset, on Docker Compose: the index node from this repository's image, a MongoDB beside it on a named volume, and the validator service an application calls, each from an image pinned by digest and configured from one env file. The index is the same node `packages/dpp-overlay/README.md` documents, with nothing added and nothing taken away; this directory only fixes an arrangement that persists. Everything here is informative, as [`../docs/deployment.md`](../docs/deployment.md) is: the standard requires no particular host.

This is how to run a new index. It replaces the retired index starter, `@bsv/create-dpp-index`, whose published `0.1.0-beta.1` stays on npm; [Index starter (retired)](../docs/packages/create-dpp-index.md) maps what that starter generated onto this preset. [Run an index from source](../docs/operate/README.md) is the step-by-step guide.

## What the preset is

| Piece | What it runs | Where its state lives |
|---|---|---|
| `overlay` | The `dpp-overlay` image, pinned by digest: the built files of `@bsv/dpp-overlay`, the same ones the npm package ships, serving `tm_dpp`, `tm_attestation`, the historical UORA topic, their lookup services and the HTTP routes of `contracts/overlay.yaml` | Nothing on disk of its own. Everything admitted is in MongoDB |
| `mongo` | MongoDB Community Server 7.0, the publisher's image pinned by tag and digest. It is under the Server Side Public License, not this repository's licence ([images and licences](#images-and-licences)) | The named volume `mongo-data`: the engine's outputs and transactions, the passport and anchor indexes, the sequences |
| `validator` | The `dpp-validator` image, pinned by digest: the JSON-LD and SHACL engines of `@bsv/dpp-profiles` behind the `dpp-validator/1` contract ([the validator service](#the-validator-service)) | Nothing. Every rule file arrives in a request, and nothing a request carries is logged or kept |
| `deploy/operator.env` | The configuration, copied from `operator.env.example` | Local file, never committed (`.gitignore`) |
| `deploy/app.env` | An application's connection, written by `dpp-index connection` | Local file, never committed; handed to the application's operator |
| `deploy/config/` | A publisher policy chain, when one is used as a file; `PUBLISHER_POLICY_JSON` carries the same chain inline where a host cannot mount one | Mounted read-only at `/config` |

The configuration carries the service identity's public key (the private half stays in the writer's wallet and is never given to the node) and these secrets: the exporter key (`EXPORTER_PRIVATE_KEY`, a key of its own, whose BRC-42 child for each passport signs that passport's evidence packages; leave it empty and both export routes answer 503), each writer's submit and callback tokens (per publisher, each bound to one key and one use, hashed in the preset's MongoDB and issued inside the container; until one is issued every write is refused, and the operator-wide `SUBMIT_TOKEN` and `ARC_CALLBACK_TOKEN` are optional) and the export bearer (`EXPORT_TOKEN`, for the complete export; leave it empty and `GET /evidence-export` is open to anyone). Three more appear only with the feature that needs them: the operator signing key (`OPERATOR_SIGNING_KEY`, for `REGISTRATION`), the advertiser's funded wallet key (`ADVERTISER_PRIVATE_KEY`, for `ADVERTISE`) and a managed database's credentials in `MONGO_URL`. Every one of them reaches the container only through the environment list in the Compose file, so a name the file does not forward is not set by putting it in the env file. The node holds no custody key: it cannot spend a passport, sign a state or countersign one, and a compromised index changes what can be found and never what can be believed.

## Start it

```
cp deploy/operator.env.example deploy/operator.env
# fill in SERVICE_IDENTITY_KEY, NETWORK and PUBLIC_URL; the rest may stay as the example has them
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d
curl -s http://localhost:8080/health
curl -s http://localhost:8080/capabilities
```

The preset builds nothing: it pulls three images, each by digest, so `compose.yml`, the env file and an empty `config/` folder beside them are all it needs. The env file's image block, rendered from the release set, carries the registry and the digest of each of the two images this repository publishes. The images of the current release set are **not published yet**, so that block has no digests and the command above stops with `required variable OVERLAY_IMAGE_DIGEST is missing a value`. Until they are published, [build from source](#build-from-source).

To run the index and its database without the validator service, name the index: `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d overlay` starts `overlay` and `mongo` and nothing else.

`/health` names the topics and services; `/capabilities` is the capability document (`contracts/capabilities.schema.json`), which says which custody profiles this node admits (`managed-custody@2` when `ACCEPTANCE_COMMITMENT=required` in this release, `managed-custody@1` in the October set, otherwise the record model's baseline), whether it exports, and whether it synchronises.

The header source is the trust boundary of the inclusion check. Left empty, `CHAIN_TRACKER` is WhatsOnChain on `NETWORK`, a third party's headers; the node has no setting for another header service yet, and `WOC_API_KEY` raises WhatsOnChain's rate limit. `CHAIN_TRACKER=scripts-only` is a local fixture and demonstration setting: it admits unproven ancestry, verifies no merkle path, and every state it serves reads `pending` to a verifier. It never claims inclusion, and a reachable deployment must not run it.

## Build from source

A contributor, or an operator before the images are published, builds both images from a checkout of the repository with the same preset:

```
docker compose -f deploy/compose.yml -f deploy/compose.build.yml --env-file deploy/operator.env --env-file deploy/build.env up -d --build
```

| File | What it adds |
|---|---|
| `compose.build.yml` | Replaces the two pinned references with images built from `packages/dpp-overlay/Dockerfile` and `packages/dpp-profiles/validator-image/Dockerfile`, under the local tags `dpp-overlay:local` and `dpp-validator:local`. Services, settings, networks and volumes are unchanged, and MongoDB is still pulled by digest |
| `build.env` | Two words that stand in for the digests `compose.yml` requires. They are not digests, so without `compose.build.yml` Docker refuses the reference and the pinned preset cannot be started from this file by mistake. It holds no secret and is committed |

Give every later `docker compose` command the same two `-f` and two `--env-file` options, so that Compose reads the same configuration. `compose.second-operator.build.yml` does the same for the second operator. `node scripts/release-images.mjs build` builds the two images outside Compose, labelled with the source revision, the release set and the package version, and `node scripts/release-images.mjs inspect dpp-overlay=dpp-overlay:local` reads the labels back.

## The validator service

The validator service answers two operations, JSON-LD expansion and SHACL validation with SPARQL constraints, over the files each request carries. It holds no profile, fetches nothing and decides nothing about a passport (`spec/services.md` section 7).

| Question | Answer |
|---|---|
| Who calls it? | An application, when it validates a product document under a profile held by a binding. It sets the service's address, and its token where one is set, on `createValidatorClient` from `@bsv/dpp-profiles/validator-client`, which takes the engine's place. |
| Does the index call it? | Never. The index admits and serves passport states and checks no industry rule. The two services are on separate Compose networks, and the index has no route to the validator. Running the validator in this preset moves no validation into the index. |
| How does an application in a container on this host reach it? | By joining the preset's `dpp-overlay_validation` network and calling `http://validator:8090`. MongoDB, which runs without authentication, is not on that network. |
| How does an application elsewhere reach it? | On purpose: add `-f deploy/compose.validator-port.yml` to the start command and set `VALIDATOR_TOKEN` in the env file. The port is then published on this machine's loopback address, or on the address `VALIDATOR_PUBLISH` names, behind the token. The contract has no transport security of its own, so put a TLS proxy in front for a caller on another host. Without the token Compose refuses to start. |
| What if it is stopped or missing? | Every step that needs the engine answers that it could not run, and the application's validation result is `unknown`. Nothing reads as a pass. |
| Can another engine take its place? | Yes: any service that answers the `dpp-validator/1` contract with the capabilities a binding requires and gives the same result for the binding's vectors. The application changes an address. |

It runs with the same restrictions as the index: the image's unprivileged `node` user, a read-only file system, no capabilities, no new privileges, an init, a health check, and no published port.

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

A restart keeps everything: `docker compose ... restart overlay` or a host reboot brings the node back over the same volume, and a lookup answers what it answered before. The volume is the backup unit: with the preset stopped, `docker run --rm -v dpp-overlay_mongo-data:/data -v "$PWD":/out "$(docker compose -f deploy/compose.yml --env-file deploy/operator.env config --images | grep '^mongo')" tar czf /out/mongo-data.tgz /data` copies it with the MongoDB image the preset already pinned and pulled, and restoring is the reverse into an empty volume before the first start.

The portable form is the evidence package (`spec/portable-evidence.md`): with `EXPORTER_PRIVATE_KEY` set, `GET /evidence-package?passportId=...` serves every retained state's transaction and BEEF, the publisher policy, the spend observations and a report, inventoried and signed by the exporter key's child for that passport, the identity the capability document names as `exporterIdentityKey`. A second operator restores a passport from it by submitting the `proofs/` BEEFs, genesis first, to its own `/submit`, which admits each through the same topic managers as a live announcement; the overlay suite's `evidenceExport.test.ts` does exactly that and then discards the first operator. That package is bounded to the newest 500 states and says so; a lineage longer than that is recovered through `GET /evidence-export?passportId=...`, this package's complete export, a reference feature outside the standard, which answers one bounded part per request over one snapshot with a cursor for the next, and which a second operator joins and restores exactly the same way (`evidenceExportParts.test.ts` does it with 505 states). Set `EXPORT_TOKEN` to put the complete export behind a bearer; the bounded package stays open. Restricted tiers are never in a package, and a package is never a recovery of a lost custody key.

## A second operator

`compose.second-operator.yml` is the second node: its own MongoDB, its own identity, tokens (including its own `EXPORT_TOKEN`) and exporter key, a second env file, and `SYNC_PEERS` pointing at the first (`http://host.docker.internal:8080` when both run on one machine). It pins the same index image and the same MongoDB image by digest, and runs no validator service of its own. It pulls the first operator's tips through GASP every `SYNC_INTERVAL_MS` and admits every offered output through its own topic managers, so a peer can make evidence findable and never make it admitted.

```
cp deploy/operator.env.example deploy/operator-b.env
# a different SUBMIT_TOKEN and EXPORTER_PRIVATE_KEY; the SAME SERVICE_IDENTITY_KEY, or a publisher policy naming both
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
```

Built from source, the second operator takes `-f deploy/compose.second-operator.build.yml` and `--env-file deploy/build.env` as well, exactly as the first does.

What the pair proves, and what it does not, is `packages/dpp-overlay/README.md`, Running two operators locally: the mechanism (initial synchronisation, restart and catch-up, admission during synchronisation, independent verification of the same bytes), never independence. Two containers on one machine under one administration are one operator twice; `federated-operators@1` is claimed only by two organisations with separate administrations, credentials, databases and infrastructure. Where the two nodes' policies differ, their answers differ and each capability document says so; a state one refuses and the other admits stays visible as a disagreement, and adding a third node settles nothing, because acceptance by an index is not finality and never was.

Set `WOC_API_KEY` on a synchronising node: a round asks the header source once per state, and anonymous access answers 429 past a few a second; the node paces and retries, but a key is what a full corpus needs. Three limits of synchronisation stand whatever the topology. A proof that reaches one operator does not travel to the other through GASP; each receives it through its own `/arc-ingest`. An unproven state announced during a partition arrives once its proof reaches the source. And synchronisation carries the current outputs and their lineages, not every historical artefact: an operator that needs the complete retained evidence restores from the evidence package.

## Images and licences

The release set is the one place the registry, the image names and the digests are written (`release/README.md`, Images). `node scripts/release-images.mjs render` writes them into this directory and `node scripts/release-images.mjs check` holds this directory to them; to use another registry, change `images.registry` in the set and render again.

| Image | Pinned by | Licence |
|---|---|---|
| `dpp-overlay` | `DPP_IMAGE_REGISTRY` and `OVERLAY_IMAGE_DIGEST` in the env file. A digest, never a tag | This repository's code under Apache-2.0, with `LICENSE`, `NOTICE` and `PATENTS` in the image; its base image and dependencies keep their own terms |
| `dpp-validator` | `DPP_IMAGE_REGISTRY` and `VALIDATOR_IMAGE_DIGEST` in the env file. A digest, never a tag | The same, with `licence-inventory.json` and `THIRD-PARTY-NOTICES.txt` for its engine libraries |
| `mongo` | Its version tag and digest, written in `compose.yml` and `compose.second-operator.yml` from the release set | The Server Side Public License, version 1, of MongoDB, Inc. |

The preset uses MongoDB Community Server under the Server Side Public License. That is MongoDB's licence, separate from the Apache-2.0 licence of this repository's code, and a deployment made from this preset is therefore not under one licence as a whole. MongoDB is not part of any image or package of this repository: Docker pulls it from its publisher. An operator that offers the functionality of MongoDB to others as a service, or redistributes it, has obligations of its own under that licence. `MONGO_URL` points the index at a database run elsewhere instead, and the bundled one then holds nothing. [Licence and reuse](../docs/contribute/licence.md) says the same at more length.

Both images of this repository are labelled with the source revision, the release set and the package version they were built from, which are the ones the npm packages of the same release carry. `deploy/evidence/` holds two recorded checks: `delivery-parity.json`, in which the index started from the npm package and the index started from this preset were given the same settings and asked the same things, and `image-contents.json`, a reading of every file in both images and in each packed npm archive. Each record says what was run, the limits it reached and what was not run. A third record, `exit-exercise.json`, is of another kind: it is the run of the application starter's exit exercise, in which one deployment of the generated application was exported and switched off and another, with a different store and a different source of profiles, was restored from the package and carried on. It involves no image of this preset. It is written by `npm run starter:check -- --exit-record deploy/evidence/exit-exercise.json`, and says what stood in for a real index, wallet and sign-in ([move an application to another provider](../docs/operate/export-import-recovery.md#move-an-application-to-another-provider)).
