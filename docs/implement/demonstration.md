# The interoperability and portability demonstration

**Audience:** the trial's implementers and reviewers. **Status:** defined; nothing here has run. **Canonical source:** [`conformance/demonstrations/independent-implementation-2026-09.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/demonstrations/independent-implementation-2026-09.json), the machine-readable form of this page, held to the ledger by the checker.

Each scenario names its roles, its inputs, the evidence it retains, when it passes and when it must refuse, and the ledger rows its evidence bears on. A scenario passes as a whole or not at all; there is no partial credit and no score.

| Scenario | Required evidence and outcome |
|---|---|
| **Cross-implementation vectors** | Every applicable positive and refusal predicate executed by the independent code; exact bytes, digests and reason codes where specified; no fixtures-only shortcut in runtime logic. |
| **The reference writes, the independent implementation verifies** | Fresh records and claims beyond the fixtures, accepted with the same findings the reference reader produces for the same evidence, policy, time and header source; the protocol requests and responses retained. |
| **The independent implementation writes, the reference verifies** | Fresh records admitted by the reference index and verified by the reference reader; fresh claims verified by the reference verifier and accepted by the reference registry; the writer self-report beside them. |
| **Reader and report equivalence** | The same evidence, policy, evaluation time and header source produce the same check statuses and reason codes; differences confined to observations whose sources differed. |
| **Lifecycle and custody** | Issue, update, offer, accept, decline, retire and, where claimed, upgrade under `managed-custody@1`; invalid controller, replayed and expired acceptance, and post-retirement update refused by name by both implementations. |
| **Retry and interruption** | A stable operation identity, no duplicate state after a crash and retry, pending broadcast distinguished from admission and from mined inclusion at every step. |
| **Two operators** | Different endpoints, keys, databases and policy per party; each validates incoming evidence; service roles and operator ownership recorded; a disagreement between them visible as one. |
| **Partition, recovery and proof delay** | Reconnection converges without duplicates; a proof is ingested separately where it is missing; pending stays pending until a verified proof arrives. |
| **Publisher policy change** | A valid rotation or handover accepted at the correct time; historical states verify under the retired key; unauthorised, expired and incorrectly chained versions refused. |
| **Complete index export** | More than 500 states over multiple byte-bounded parts of one snapshot, resumed after interruption, joined from signed coverage records with the expected signer verified, restored and re-exported. |
| **Incomplete or malicious export** | A missing final part, repeated, reordered and substituted parts, an altered wrapper, a wrong passport, snapshot or signer, and a tampered inventory each refused by name before any state is trusted. |
| **Original provider unavailable** | Retained transactions, proofs, claims and permitted off-chain evidence imported into the replacement provider; source access and concealing caches disabled; verification and an authorised update succeed there; completeness pinned to a source and snapshot. |
| **Custodial key loss** | Missing spending authority prevents every update; the export verifies what it holds and never implies recovery of private signing access. |
| **Profiles** | Separate core and profile results; compatible `battery@2` and `textile@2` data validates; an unknown profile version and a missing sector field are profile refusals; no product or legal compliance claim. |
| **Stale, restricted or unavailable evidence** | Missing claims, status, authority or headers produce the specified unknown, pending or refused result with its reason; supplied history is never labelled globally latest. |

## Migration and loss, defined separately

**Authorised migration followed by shutdown**: the old provider exports everything it holds (the index's complete export, the registry's package, retained off-chain content and status evidence, policy snapshots); the new provider imports and verifies from bytes and headers; the signing authority appropriate to the custody arrangement is transferred or re-established; the publisher policy is handed over as a signed version; then the old provider is disabled and the demonstration runs against the new one alone. **Sudden loss**: whatever the writer's wallet, the deployment's storage and any second operator retained is what remains. Both pin a source and a snapshot before claiming completeness. Successful recovery from a public export never establishes recovery of private credentials, keys or all registry material.

## What the evidence bears on

The demonstration's evidence bears on the reader, verifier, writer, managed-custody, single-operator and registry claims of the current selection. It cannot by itself make the federated-operation claim (which needs separately administered operators, which two parties within one programme are not), the version 1.0 readiness claim (which needs another implementing party on record), or the European and battery claims (which need their own assessments). A scenario that requires mined inclusion needs an explicitly authorised, funded mainnet run recorded with its transaction identifiers; synthetic transactions prove admission and structure, never mining.

## Running it

Build the second application from [the implementer contract](README.md) first. Then run the scenarios in the order listed, retaining the evidence each names, and report one sentence per condition. The reference side is driven through its documented contracts; the driver is data to the independent decision engine and never its verdict.
