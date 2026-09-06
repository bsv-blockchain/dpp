# Export, import and recovery

**Audience:** operators planning migration, backup or provider replacement. **Canonical sources:** [`spec/portable-evidence.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/portable-evidence.md), [`contracts/evidence-package.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/evidence-package.schema.json), [`contracts/evidence-export.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/evidence-export.schema.json), [`deploy/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/deploy/README.md), [`spec/custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/custody.md) §6.

## Three forms of leaving

| Form | Route | Carries | Bound |
|---|---|---|---|
| History pages | `GET /history` | The records' identities, operations, timestamps, spend observations and sequences over a stable snapshot; the bytes come from lookup or a package | 500 per page, no cap on pages |
| The bounded package | `GET /evidence-package` | Every retained state's transaction and BEEF, the publisher policy, the spend observations and a report, inventoried and signed | The newest 500 states; older ones declared absent by outpoint |
| The complete export | `GET /evidence-export` | The same as packages over contiguous ranges of one snapshot, each part with a signed coverage record; no report | Parts bounded by states and bytes; resumed by cursor; the final part ends at the snapshot's sequence |

The registry has its own package per passport covering the claims, credentials, anchors, status observations, authority records and reports it holds.

## Importing

A second operator restores a passport by submitting the package's BEEFs, genesis first, to its own `/submit`, which admits each through the same topic managers as a live announcement; it does not copy a database. A reader joins a complete export from the signed coverage records alone, refusing by name a repeated, missing, foreign or substituted part, and then verifies every transaction, proof and claim inside. The reference suite exports 505 states as two parts, joins them, restores them into a second operator and exports them again.

## What a package never does

It never carries a private key, a spending credential or restricted content under a public disclosure scope, and its manifest says it is not a recovery backup. Public export therefore does not recover the ability to update a passport: a lost locking key freezes a chain at its tip forever, and a custodian that migrates providers migrates its keys through its own governed process, not through an export.

## Authorised migration and sudden loss

An **authorised migration** is planned: the old provider exports everything it holds (index packages or the complete export, the registry package, the retained off-chain content and status evidence, the policy snapshots), the new provider imports it and verifies it from bytes and headers, the signing authority appropriate to the custody arrangement is transferred or re-established, the publisher policy is handed over as a signed version, and only then is the old provider disabled. **Sudden loss** is what the retention duties exist for: whatever the writer's wallet, the deployment's storage and any second operator retained is what remains, and the demonstration pins a source and a snapshot before it claims completeness of what was recovered.

## What completeness means

Complete for the snapshot of the source that produced it. An export can be complete for what one operator held and still miss what another holds; snapshot completeness is not global freshness, and a reader holding a complete export still asks whether a later state exists somewhere else and reports the answer as an observation.
