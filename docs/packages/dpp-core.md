# @bsv/dpp-core

**Audience:** developers reading, verifying or building records. **Version in the current set:** 0.3.0. **Runtime:** Node 22 or later; no Node built-in imports, browser use untested. **Runtime dependency:** `@bsv/sdk` 2.4.2. **Canonical sources:** [`packages/dpp-core/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-core/README.md) and the specifications each module names.

The record model and everything both rails share, exported from one specifier. Every reference consumer builds and verifies records through it; the overlay's topic manager admits a state by asking it whether the state is valid.

## What it exports, by concern

| Concern | Functions and constants | Specification |
|---|---|---|
| Codec | `parseDppOutput`, `findDppOutputs`, `buildLockingScript`, `completeState`, `FIELD_COUNT`, `FIELD_COUNT_V2`, `STANDARD_VERSION`, `STANDARD_VERSION_V2`, `PROTOCOL_MARKER` | `spec/record-model.md` §2, §3; `spec/record-model-v2.md` §2, §3 |
| Signatures | The two preimages of each version, the derivations under `DPP_PROTOCOL_ID` and `DPP_PROTOCOL_ID_V2`, signing and verification helpers | §5 of each record document |
| Transitions and control | `checkTransition` with its link context, `checkControl`, the owner key and linkage helpers under `OWNER_PROTOCOL_ID` | `spec/record-model.md` §4, §6; `spec/record-model-v2.md` §4, §6; `spec/custody.md` §4 |
| Chain verification | `verifyChain`, `inspectChain`, `chainFromBeef`, with `chainTracker`, `serverIdentityKey`, `publisherKeys`, `controlAuthorities`, `ownerConsent` and `managedAcceptance` options | `spec/record-model.md` §8; `spec/record-model-v2.md` §9 |
| Managed acceptance | `inspectManagedAcceptance`, `signAcceptance`, `acceptanceCommitment`, `bindAcceptanceToState` | `spec/managed-custody.md` §3, §4 |
| The verification report | `verifyPassportEvidence`, `EVIDENCE_CHECK_NAMES`, `EVIDENCE_CHECK_LABELS`, `REPORT_VERSION` | `spec/verification.md` |
| Native claims | `signLifecycleClaim`, `verifyLifecycleClaim`, `lifecycleClaimBytes`, `lifecycleClaimDigest`, `LIFECYCLE_CLAIM_FORMAT` | `spec/rules.md` §3, §4 |
| The anchor | `buildAttestationAnchor`, `decodeAttestationAnchor`, `inspectAttestationAnchor`, `ATTESTATION_ANCHOR_PREFIX` | `spec/rules.md` §5 |
| Canonical bytes | `canonicalString` and the restricted canonical JSON helpers | `spec/rules.md` §4 |
| Identity | `did:key` encoding and decoding for compressed keys | `spec/identity.md` §2 |
| Owner tier | `ownerBlobHash` | `spec/record-model.md` §7 |
| Publisher policy | `verifyPolicyChain` and the keys active at an instant | `spec/services.md` §1 |
| Evidence package | `inspectEvidencePackage`, `signEvidenceManifest`, `inventoryEntry` | `spec/portable-evidence.md` §2 |

## The smallest useful call

```js
import { readFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { verifyChain, verifyPassportEvidence } from '@bsv/dpp-core'

const chain = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const txs = chain.states.map((s) => Transaction.fromHex(s.rawTx))
const result = await verifyChain(txs, { chainTracker: 'scripts only', serverIdentityKey: chain.custodianKey, managedAcceptance: true })
const report = await verifyPassportEvidence(
  { tokenHistory: txs },
  { passportId: chain.states[0].data.passportId, source: 'request-context' },
  { chainTracker: 'scripts only', publisherKeys: [chain.custodianKey] },
)
```

`chainTracker: 'scripts only'` skips inclusion, which the report then answers **unknown**; pass an SDK `ChainTracker` to verify merkle paths against headers. `verifyChain` answers supplied-history validity and nothing else; `verifyPassportEvidence` is the one report every surface produces, and is what to expose to a user.

## What it does not do

It talks to no network, no wallet and no database. Header lookups, status lists, credential suites and authority sources are supplied by the caller: a report produced with none of them answers those checks **unknown** with the reason that says why, which is the correct answer, not a defect. It does not implement a credential proof suite; `@bsv/vsc` supplies the verifiers the report accepts.

## Independence note

An implementation that imports this package is a reference consumer. The rules it implements are the specification's, and an independent implementation reproduces them against the same fixtures without importing it. The package's test modules generate every published fixture, so the fixture bytes and this code agree by construction; that agreement is the reference's, and an independent implementer's agreement is theirs to show.
