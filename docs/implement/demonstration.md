# Run the interoperability trial

Implementers whose components pass the fixtures can use this guide to exchange fresh records with the reference implementation and retain reproducible per-check results. Run scenarios alone where permitted; arrange programme participation where the reference must act.

## Prerequisites and trial target

| Input or scenario | Requirement and source |
|---|---|
| All scenarios | Passing fixture results, authorship and dependency records kept as [reporting](reporting.md) describes. |
| Writer | Your funded BRC-100 wallet and index. [Create an index](../packages/create-dpp-index.md) includes the reference runtime; use your own implementation to claim the independent overlay role. |
| Mined inclusion | Explicitly authorised, funded mainnet run, with transaction identifiers retained. Synthetic transactions under a scripts-only header setting prove admission and structure, never mining. |
| Reference participation | Agree scenarios, endpoints and publisher keys with the programme below. |

The trial definition is [`independent-implementation-2026-09`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/demonstrations/independent-implementation-2026-09.json):

| Target or gate | Value |
|---|---|
| Release set | `dpp-release-2026-11` |
| Baseline | `native-baseline@2` |
| Custody profile | `managed-custody@1`, demonstrated in September. It moves to `managed-custody@2` with the second implementing party's written acceptance of the derived-key signature. |
| Completion | Not completed. Programme-produced evidence is engineering evidence. Version 1.0's organisational independence is recorded only when another implementing party runs the same scenarios. |

## Take part

1. Select scenarios from the table below.
2. For participation or reference actions, use the [BSV Association contact form](https://bsvassociation.org/contact/). Include your scenarios, implemented roles and record versions, index and registry URLs, and publisher keys countersigning your states.
3. Agree the exchange below before running a scenario that needs the reference.

## The scenarios

The trial exchanges records between the programme-operated reference implementation and a second implementation written from the bundle. Each writes fresh records for the other to verify; each scenario records passes and required refusals. "Alone" means your components and the published material suffice. Reference writing, admission or peering needs the programme.

| Scenario | Roles | What it shows | Who you need |
|---|---|---|---|
| `vectors` | Reader, verifier, writer, issuer | Every fixture and vector reproduced or refused by your own code | Alone |
| `exchange-reference-writes` | Reader, verifier | Your reader and verifier give the reference reader's findings for fresh version 2 records and claims the reference writes | The programme, to write fresh records and claims for you. Meanwhile you can read what the [hosted reference](../deployment.md#the-hosted-reference) already holds through its open lookups. |
| `exchange-independent-writes` | Writer, issuer | The reference index admits your states, the reference reader verifies them, and the reference registry accepts your claims | The programme: the reference index admits only the publisher keys its policy names, its `POST /submit` and `POST /arc-ingest` need its tokens, and its registry stores only with its write token |
| `reader-equivalence` | Reader, verifier | Both readers give the same check statuses and reason codes for the same evidence | Alone: run the reference reader (`examples/verify-passport.mjs`) on the same evidence, policy, time and header source |
| `lifecycle-and-custody` | Writer, reader | Issue, update, offer, accept, transfer and retire under the managed custody profile, with the named invalid operations refused | Alone, with your own index |
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

## Prepare an exchange

1. Agree roles, record and profile versions, endpoint addresses and publisher policies with the other participant.
2. Run each implementation's fixture checks first. Keep results, authorship and dependency records.
3. Produce fresh records. The other participant retrieves and verifies them with its own logic; reverse direction where both implement the role. Retain exact requests, responses, artefacts and reports.
4. Exercise missing evidence and an unavailable provider as well as success. For recovery, retain exports and use a replacement service; a second view of the first service's database is insufficient.

A driver calling a service supplies inputs. It does not replace your implementation's verification.

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
- **The same evidence, not the same bytes.** `two-operators` passes when both operators serve the same transactions and merkle paths for the lineage, as `spec/services.md` section 1 defines. The [overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) does not fix the form of a lookup's BEEF: one operator can wrap an unproven state as Atomic BEEF (a BEEF framed around one subject transaction) and another not, and a proven state can arrive with or without its ancestors. Keep both answers and compare the transactions and merkle paths inside them; a difference in the BEEF bytes alone is not a failure.
- **The hosted page check.** The reference application's check at `https://dpp.bsvb.net/verify` finds only what the hosted index holds ([hosted reference](../deployment.md#the-hosted-reference)). Verify your passports with a reader of your own until the hosted index pulls from yours.

## What completion records

For each completed scenario, retain its evidence and the ledger rows listed under `rows` in the definition.

| Claim or conclusion | What the trial records or still needs |
|---|---|
| `passport-reader-native-baseline-2`, `attestation-verifier-native-baseline-1`, `passport-writer-reference-example`, `managed-custody-1`, `managed-custody-1-writer`, `overlay-single-operator-1`, `registry-current-intake` | Trial evidence bears on these claims. |
| `overlay-federated-operators-1` | Cannot be made by the trial alone. Requires separately administered operators; `two-operators` provides them only when the parties are separate organisations. |
| `version-1-0-readiness` | Cannot be made by the trial alone. Requires another implementing party on record. |
| European and battery claims | Need their own assessments. |
| Local synthetic exchange | Establishes neither separately administered operation nor mined inclusion. |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records remaining evidence gaps.

Next: [report the results](reporting.md#send-it).
