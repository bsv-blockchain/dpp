# A single operator

**Audience:** whoever runs an index for a deployment. **Release:** the image `dpp-overlay:0.4.0` built from `packages/overlay-topics/Dockerfile`. **Prerequisites:** Docker Compose, a MongoDB volume, the operator's identity key, tokens. **Canonical sources:** [`deploy/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/deploy/README.md), [`packages/overlay-topics/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/overlay-topics/README.md) (configuration), [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §2, §6.

## What an operator runs

One index node and one MongoDB, on named volumes, from one env file. The node admits states and anchors under the record rules and the operator's policy, serves lookups, history, the capability document and the exports, ingests proofs and, if told to, synchronises from named peers. It holds no custody key: it cannot spend, sign or countersign a passport, and a compromised index changes what can be found and never what can be believed.

```sh
cp deploy/operator.env.example deploy/operator.env
# fill in SERVICE_IDENTITY_KEY, SUBMIT_TOKEN, ARC_CALLBACK_TOKEN; the rest may stay empty
docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d --build
curl -s http://localhost:8080/health
curl -s http://localhost:8080/capabilities
```

## The decisions an operator states

| Decision | Setting | What the capability document then says |
|---|---|---|
| Whose countersignature is accepted | `SERVICE_IDENTITY_KEY`, or `PUBLISHER_POLICY_FILE` with `OPERATOR_IDENTITY_KEYS` | The keys active now and the policy version in force, or that the single key is an implicit policy with no rotation history |
| Which custody profile is admitted | `ACCEPTANCE_COMMITMENT=required` for `managed-custody@1`, unset for the record model's baseline | The custody profile entry |
| Whether owner consent is required on version 1 transfers | `OWNER_CONSENT=required`, `TRANSFER_AUTHORITIES` | The owner-signed transfer and its authorities |
| Who may act without a control proof | `CONTROL_AUTHORITIES` | The named authorities |
| Which header source is trusted | `CHAIN_TRACKER`, `NETWORK`, `WOC_API_KEY` | `retraction-network-check` unsupported under `scripts-only` |
| Whether the node exports | `EXPORT_SIGNING_KEY`, `EXPORT_TOKEN` | The export limits and access, or export unsupported |
| Whether the node synchronises | `SYNC_PEERS`, `SYNC_INTERVAL_MS`, `SYNC_LEGACY` | `single-operator@1` or `federated-operators@1` with the peer list |
| Who may announce, retract and push proofs | `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN` | |

`CHAIN_TRACKER=scripts-only` admits unproven ancestry and verifies no merkle path; it is a fixture and demonstration setting and a reachable deployment must not run it.

## What the node says, and what it does not

`X-Admission: admitted` means the topic manager accepted the draft under the rules and the policy. It is not broadcast, not network acceptance and not inclusion. A state reads `pending` to every verifier until its merkle path reaches the node through `POST /arc-ingest`; only then does a lookup carry the proof. Nothing the node answers is a claim about the network, the latest state or the whole history, and the capability document lists by name what the node does not do.

## Restart, back up, restore

A restart keeps everything on the volume. The volume is the backup unit. The portable form is the evidence package and, for lineages longer than 500 states, the complete export; a second operator restores by submitting the package's BEEFs, genesis first, to its own `/submit`, through the same admission as a live announcement. [Export, import and recovery](export-import-recovery.md) says what a package carries and what it never does.

## What one operator proves

That the mechanism works under one administration. `single-operator@1` is the profile the reference configuration claims, and the capability document says discovery is off and there are no peers, so the node does not claim to be independently replicated. Independence is [federation](federation.md), and it is not proved on one machine.
