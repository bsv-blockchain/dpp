# Run the interoperability trial

The trial is a defined exchange between the reference implementation, which the programme operates, and a second implementation written from the bundle: each writes fresh records, the other verifies them, and every scenario records what passes and what must be refused. This page is for an implementer whose components already pass the fixtures and who wants to run the trial, alone where a scenario allows and with the programme where it needs the reference to act.

The trial is defined in [`independent-implementation-2026-09`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/demonstrations/independent-implementation-2026-09.json) for release set `dpp-release-2026-10-4`, baseline `native-baseline@2` and custody profile `managed-custody@1`. It has not been completed. Evidence the programme produces itself is engineering evidence; the organisational independence that version 1.0 needs is recorded only when another implementing party runs the same scenarios.

## Take part

To take part, or to arrange a scenario that needs the reference, write to the programme through the [BSV Association contact form](https://bsvassociation.org/contact/). Say which scenarios you want to run, the roles and record versions you implement, your index and registry URLs, and the publisher keys your states are countersigned with. Before you ask, have:

- components that pass their fixtures, with your results and your authorship and dependency record kept as [reporting](reporting.md) describes;
- for a writer, a BRC-100 wallet with funds and your own index ([run a service](../operate/README.md)).

## The scenarios

"Alone" means you can run the scenario with your own components and the published material. A scenario that needs the reference to write, admit or peer needs the programme.

| Scenario | Roles | What it shows | Who you need |
|---|---|---|---|
| `vectors` | Reader, verifier, writer, issuer | Every fixture and vector reproduced or refused by your own code | Alone |
| `exchange-reference-writes` | Reader, verifier | Your reader and verifier give the reference reader's findings for fresh version 2 records and claims the reference writes | The programme, to write fresh records and claims for you. Meanwhile you can read what the [hosted reference](../deployment.md#the-hosted-reference) already holds through its open lookups. |
| `exchange-independent-writes` | Writer, issuer | The reference index admits your states, the reference reader verifies them, and the reference registry accepts your claims | The programme: the reference index admits only the publisher keys its policy names, its `POST /submit` and `POST /arc-ingest` need its tokens, and its registry stores only with its write token |
| `reader-equivalence` | Reader, verifier | Both readers give the same check statuses and reason codes for the same evidence | Alone: run the reference reader (`examples/verify-passport.mjs`) on the same evidence, policy, time and header source |
| `lifecycle-and-custody` | Writer, reader | Issue, update, offer, accept, transfer and retire under `managed-custody@1`, with the named invalid operations refused | Alone, with your own index |
| `retry-and-interruption` | Writer | A write interrupted after each step and resumed, with no duplicate state | Alone |
| `two-operators` | Index, registry | Two operators, one run by each party, each admitting what the other serves through its own rules | A second party. It counts only when the two operators are separate organisations; with the reference as the other operator, the programme has to peer with you |
| `partition-recovery-proof-delay` | Index | A partition between two operators, reconnection without duplicates, and a proof that reaches one operator only | A second party, as for `two-operators` |
| `publisher-policy-change` | Index, reader | A key rotation and a handover under a signed publisher policy, with unauthorised and expired keys refused | Alone |
| `complete-export` | Index, reader | An export of more than 500 states in parts over one snapshot, restored into another operator | Alone, with two operators of your own and one passport with more than 500 states |
| `malicious-export` | Reader | Incomplete, reordered and altered exports, each refused by name | Alone |
| `original-provider-unavailable` | Index, registry, writer, reader | A passport written under the reference provider is imported into yours, then verified and updated with the original switched off | The programme: the passport, its export and its signing authority come from the reference provider |
| `custodial-key-loss` | Writer, reader | Every update refused once spending authority is lost | Alone |
| `profiles` | Reader, writer | Profile results reported apart from core results, with an unknown profile version and a missing field refused | Alone |
| `stale-restricted-unavailable` | Reader, verifier | Missing claims, status, authority evidence and headers reported as `unknown`, pending or refused, never as a pass | Alone |

A scenario that needs mined inclusion needs an explicitly authorised, funded mainnet run, recorded with its transaction identifiers. Synthetic transactions under a scripts-only header setting prove admission and structure, never mining.

## Prepare an exchange

Agree the roles, record and profile versions, endpoint addresses and publisher policies with the other participant. Each implementation first runs its own fixture checks and keeps its authorship and dependency record.

Then exchange newly created records. One participant produces evidence; the other retrieves and verifies it with its own logic. Reverse the direction where both implement the role. Exercise missing evidence and an unavailable provider as well as the successful path. A recovery exercise needs retained exports and a replacement service, not merely a second view of the first service's database.

A driver that calls a service supplies data to your implementation; it does not replace your implementation's verification.

## Retain

Keep the requests and responses, the exact artefacts (transactions, BEEFs, proofs, claims and exports as received) and the per-check reports, so a disagreement can be reproduced. A successful local rehearsal is useful preparation and is reported as that.

| Preparation | Guide |
|---|---|
| Peer operation and its limits | [Federation](../operate/federation.md) |
| Export, replacement provider and key availability | [Recovery](../operate/export-import-recovery.md) |
| Wallet and proof handling | [Broadcast and proofs](../operate/wallet-broadcast-proofs.md) |
| Current delivery evidence | [Status](../start/status.md) |

## Known blockers

These are open questions in the standard and the reference deployment, not faults in your implementation; [known limitations](../operate/limitations.md) lists the reference service's limits.

- **Proofs for your states.** A state you write and the reference admits reads `pending` there until its merkle path reaches the reference's `POST /arc-ingest`, which needs the reference's callback token. No one is named yet to deliver a proof to an operator that learned a state by synchronisation ([federation](../operate/federation.md#when-a-record-does-not-arrive)).
- **Byte-identical evidence.** `two-operators` passes when both operators "serve byte-identical evidence for the same lineage", but the [overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) does not fix the form of a lookup's BEEF: one operator can wrap an unproven state as Atomic BEEF (a BEEF framed around one subject transaction) and another not, and a proven state can arrive with or without its ancestors. Keep both answers, compare the transactions and merkle paths inside them, and report a byte difference with this explanation.
- **The hosted page check.** The reference application's check at `https://dpp.bsvb.net/verify` reads only identifiers under `dpp.bsvb.net` and `id.gs1.org` ([hosted reference](../deployment.md#the-hosted-reference)). Verify your passports with a reader instead.

## What completion records

A completed scenario records its retained evidence and the ledger rows it bears on: each scenario lists them under `rows` in the definition. The trial's evidence bears on the claims `passport-reader-native-baseline-2`, `attestation-verifier-native-baseline-1`, `passport-writer-reference-example`, `managed-custody-1`, `managed-custody-1-writer`, `overlay-single-operator-1` and `registry-current-intake`. It cannot make `overlay-federated-operators-1`, which needs separately administered operators (`two-operators` provides them only when the parties are separate organisations), `version-1-0-readiness`, which needs another implementing party on record, or the European and battery claims, which need their own assessments. Local synthetic exchanges do not establish separately administered operation or mined inclusion, and the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records the remaining evidence gaps.

Next: [report the results](reporting.md#send-it).
