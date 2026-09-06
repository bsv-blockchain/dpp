# Overlay

**Audience:** an implementer of an index service. **Baseline:** `native-baseline@2`; operator profile `single-operator@1`, then `federated-operators@1` when synchronising. **Prerequisites:** the overlay contract; a header source; storage. **Network:** a service; a header source; peers when federating. **Canonical sources:** [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §1, §2, §6, [`contracts/overlay.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/overlay.yaml) 0.7.0-draft, [`contracts/capabilities.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/capabilities.schema.json), [`contracts/publisher-policy.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/publisher-policy.schema.json), [`spec/portable-evidence.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/portable-evidence.md).

## Inputs and outputs

| Input | Output |
|---|---|
| Announcements as BEEF on `POST /submit` with topics; lookups on `POST /lookup`; proofs on `POST /arc-ingest`; retractions; peer synchronisation requests; the operator's configuration and publisher policy | Admission answers (`admitted`, `duplicate`, `none`); lookup answers carrying each state's own bytes and proof; the capability document; history pages; the bounded package and the complete export; the synchronisation answers |

## What you reproduce

1. **Passport admission** under the record rules of the state's own version and the selected custody policy: the lineage genesis traced through the submitted bytes or the index's own history and never assumed; nothing admitted after a `RETIRE`; a genesis that spends an admitted output refused; under `managed-custody@1` a version 2 `TRANSFER` without its commitment refused.
2. **Anchor admission** by exact script, framed signature and key derivation, without validating a credential that is not in the transaction.
3. **Publisher policy**: a state's countersignature accepted only from a key active at the state's own time, an anchor only from a key active at admission; the chain verified at boot and refused if it does not hold.
4. **Idempotent admission**: replay of an admitted outpoint is a no-op; a transaction refused earlier is re-evaluated when announced again rather than read as a duplicate.
5. **Proof ingestion**: every pushed proof checked to contain the transaction and validated against the header source before storage; unavailable headers defer acceptance.
6. **Lookup and cursors**: exact selectors, bounded pages, an outpoint cursor, and no truncated result described as complete.
7. **The capability document**: roles, protocol versions, profiles with artefact digests, representations, anchor formats current and historical and refused, topics and services, the publisher policy in force, the synchronisation profile, the limits, and what the node explicitly does not do.
8. **History, package and export**: pages over a stable snapshot with signed cursors and named restart; the bounded package with absence declared; the complete export tiling one snapshot with signed coverage records.
9. **Retraction**: withdrawal of an admitted output the network refused, refused when a proof is held, the network knows the transaction or the output is spent.
10. **A refused spend of the tip** keeps the tip and its lineage.
11. **Synchronisation** from declared peers only, every offered output admitted through your own topic managers, and the answers to a peer's requests bounded.

## The minimal runnable path

Serve the contract. Announce the six states of `chain-v1.json` in order and then again, and answer `admitted` six times and `duplicate` six times. Announce each refusal vector after its prefix and answer `none` with the reason logged. Announce the five states of `chain-v2.json` under `ACCEPTANCE_COMMITMENT=required` with the acceptance record's transfer, then the uncommitted transfer refusal, and answer accordingly. Serve the capability document and validate it against its schema. Page the history and check the sequence ranges tile. Export the package and the complete export, restore them into a second instance of your own index and export again. Validate the publisher policy vectors (2 valid chains, 11 refusals) at boot.

## Expected results

The same admission answers as the reference index for the same bytes; a capability document that validates; pages and parts a reader joins; refusals named as the contract names them.

## What an overlay never claims

That its answer is the latest state, the whole history or network acceptance. That it verified a credential's content. That two nodes under one administration are independent operators.
