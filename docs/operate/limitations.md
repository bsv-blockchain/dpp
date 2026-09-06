# Known limitations

**Audience:** operators and reviewers. Each limitation below is disclosed by the implementation that has it; this page collects them. **Canonical sources:** [`packages/overlay-topics/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/overlay-topics/README.md), [`deploy/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/deploy/README.md), [`docs/stack.md`](../stack.md), [`conformance/examples/capabilities-reference-node.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/examples/capabilities-reference-node.json).

| Limitation | Consequence | Where it is stated |
|---|---|---|
| Proofs do not travel through GASP | Each operator ingests proofs through its own `/arc-ingest`; a state read from a peer stays `pending` until the peer has the proof | Overlay README, deploy README, the operator manifest |
| An unproven state on a held lineage waits for its proof | A state announced during a partition synchronises on the round after its proof reaches the source | Overlay README |
| Synchronisation carries current outputs and lineages | Not every historical artefact; complete evidence comes from the package or the complete export | Deploy README |
| History and export cursors are per process | Replicas behind one address pin a client to one replica or share the secret; otherwise a cursor answers `cursor-invalid` | Overlay README |
| The bounded package holds the newest 500 states | Older states declared absent; the complete export exists for the rest | Overlay README, capability document limits |
| The engine's tip-availability limitation after a refused spend | The engine marks the tip spent in its own storage, so it is not offered to peers until a valid successor is admitted; the record store and every route read correctly | Overlay README, a refused spend of the tip |
| `CHAIN_TRACKER=scripts-only` verifies no merkle path | Every state reads `pending`; retraction cannot ask the network; a reachable deployment must not run it | Deploy README, capability document `unsupported` |
| No SHIP/SLAP advertising | A public deployment configures discovery separately | Capability document `unsupported`, stack map |
| No publisher policy means an implicit single-operator policy | No rotation history; every state checked against one key whatever its timestamp | Capability document `unsupported` |
| Retirement is not revocation of a publisher key | A key compromised after retirement can still countersign a state dated inside its window; an operator bounds timestamp lag or revokes the window in a policy version | `spec/services.md` §1 |
| Durable publication is a gap | No independently administered replica has been demonstrated; the ledger row is `gap` and the federation claim is withheld | The ledger, the release selection |
| Two nodes under one administration prove the mechanism only | `federated-operators@1` is claimed by two organisations or not at all | Operator manifest, deploy README |
| The registry's package is a scoped archive | No token history, no restricted evidence, no key; a migration assembles the index's export and the registry's separately | Registry source, the registry role guide |
| The shared overlay host was evaluated and not adopted | Its SQL engine storage wrote behind the answer and split a lineage; its maintenance evicts unproven history; the DPP routes would remain an adapter | `docs/deployment.md` |
