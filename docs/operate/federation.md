# Federation with static peers

**Audience:** operators running two or more indexes. **Profile:** `federated-operators@1`, proposed. **Canonical sources:** [`packages/overlay-topics/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/overlay-topics/README.md) (running two operators), [`packages/dpp-profiles/manifests/operator/federated-operators@1.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/manifests/operator/federated-operators@1.json), [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §1, [`deploy/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/deploy/README.md) (a second operator).

## How it works

A second node names the first in `SYNC_PEERS`, pulls its unspent outputs through the overlay protocol's GASP routes every `SYNC_INTERVAL_MS`, and admits every offered output through its own topic managers, genesis first, so a peer can make evidence findable and never make it admitted. Discovery is static: the peers are the ones named, never ones a lookup found, and the host advertises nothing through SHIP or SLAP. Both nodes share one publisher policy scope naming both operators, or the same identity key; where their policies differ, their answers differ and each capability document says so.

```sh
cp deploy/operator.env.example deploy/operator-b.env
# a different SUBMIT_TOKEN and EXPORT_SIGNING_KEY; the SAME SERVICE_IDENTITY_KEY, or a publisher policy naming both
docker compose -f deploy/compose.second-operator.yml --env-file deploy/operator-b.env up -d
```

## What synchronises, and what does not

- A fresh peer receives a whole lineage through its tip's inputs, spent states included, and a second round admits nothing and creates no duplicate.
- A state on top of a lineage the peer already holds synchronises once it is proven; an unproven state announced during a partition waits until its proof reaches the source node.
- A proof that reaches one operator does not travel to the other through GASP. Each operator receives proofs through its own `/arc-ingest`, pushed by the writer or the gateway it named. A reader of either sees inclusion pending until it has.
- Synchronisation carries current outputs and their lineages, not every historical artefact. An operator that needs the complete retained evidence restores from the package or the complete export.
- An offered state a peer's policy refuses is refused and logged; the offering node changes what can be found, never what can be believed.

## The acceptance exercises

The operator manifest names seven: two operators synchronise and serve byte-identical evidence; a peer recovers from a partition without duplicates; a refuted proof is repaired and converges; one operator stops and the other serves complete retained evidence a reader verifies from bytes and headers; a publisher key is rotated and handed over under a signed authorisation with historical states still verifying under the retired key and an unauthorised third publisher refused; a stale or malicious peer's history is detected by local verification, not by counting peers; and the same exercises run by two organisations with separate credentials, databases and infrastructure. The reference federation suite runs the first six end to end under one administration. The seventh has not run, and the manifest says a local federation is not it.

## What a local federation proves

The mechanism. Two containers on one machine under one administration are one operator twice, and `federated-operators@1` is claimed only when two organisations have run the exercises and observed the same results. The release selection withholds the claim by name, the capability document of a node with peers configured claims the profile as support and not as independence, and acceptance by an index is not finality however many indexes agree.
