# @bsv/dpp-core

**Experimental prerelease:** `@bsv/dpp-core` 0.3.0-beta.3 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

Install the exact published version:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.3
```

Keep the application lockfile and review compatibility before upgrading.

Reference functions for passport records and shared evidence. Use the [support table](support-table.md) for the selected version and runtime; browser use is untested.

## Use it in a reader or writer

Use this package when the application consumes the reference implementation. It handles record encoding, signing and evidence checks. It does not start an index, supply a wallet or decide which issuer an application should accept.

After [installation](README.md), run the [reader and issuer examples](../quick-start.md). The reader takes transaction evidence and a policy; the issuer takes an unsigned claim and a signing adapter. Read the individual verification findings before making an application decision.

For a first programmatic step, decode the record carried in the first fixture transaction:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { findDppOutputs } from '@bsv/dpp-core'
const fixture = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const transaction = Transaction.fromHex(fixture.states[0].rawTx)
const outputs = findDppOutputs(transaction)
assert.equal(outputs.length, 1)
console.log(outputs[0])
JS
```

Expect one decoded passport output. Finding and decoding it is not signature, linkage or inclusion verification. Continue with the [reader's verification sequence](../implement/roles/passport-reader.md).

## Choose an API

The candidate also exports `@bsv/dpp-core/schemas/*`. These are the standard JSON schemas, copied byte for byte into the package. A consumer can validate a verification report, capability document or evidence package without a repository checkout:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const schema = require('@bsv/dpp-core/schemas/verification-report.schema.json')
console.log(schema.$id)
```

Use a validator supporting the schema's declared dialect and asserting formats. Schema validity does not replace signature or evidence verification.

The functions an application calls, what each takes and what it returns. The [walkthrough](build-an-application.md) shows them in order.

**Read and verify**

| Function | Takes | Returns |
|---|---|---|
| `findDppOutputs(tx)` | A `Transaction` | The passport outputs it carries, each with its output index and decoded state |
| `chainFromBeef(beef, passportId?)` | A `Beef` holding a lineage, and the passport to follow | The lineage's transactions, genesis first |
| `verifyChain(txs, options?)` | The lineage; `chainTracker`, `serverIdentityKey`, `managedAcceptance`, `controlAuthorities`, `ownerConsent` | `{ valid, spv, states, error? }`: whether the lineage holds, whether inclusion is proved, and one finding per state |
| `verifyPassportEvidence(evidence, expected, policy?)` | `evidence`: `tokenHistory`, `nativeClaims`, `anchors`, `acceptanceRecords`, `externalCredentials`; `expected`: `passportId` and `source`; `policy`: `chainTracker`, `publisherKeys` or `publisherPolicy`, `authority`, `managedAcceptance`, `checkedAt` | The verification report: sixteen named checks, each `pass`, `fail`, `unknown` or `not-applicable` with a reason |

**Write**

| Function | Takes | Returns |
|---|---|---|
| `ownerKeyFor(passportId, wallet)` | The passport and a BRC-100 wallet | The controller key, field 6, derived for `[1, 'dpp owner v1']` |
| `revealOwnerLinkage(passportId, wallet, verifierIdentityKey)`, then `decryptOwnerLinkage(revelation, wallet)` | The same wallet, revealing to itself | The control linkage, 64 hex characters, for every state after the genesis |
| `ownerBlobHash(ciphertext)` | The encrypted owner tier as bytes | The hash a state carries |
| `completeState(data, actorWallet, publisherWallet)` | The state's fields, and the wallets that sign as actor and as publisher | The signed state |
| `buildLockingScript(state, lockKey)` | The signed state and the key that locks it | The output's `LockingScript` |

**Transfer under managed custody**

| Function | Takes | Returns |
|---|---|---|
| `signManagedAcceptance(claim, signer)` | The offer and acceptance, and the custodian's signer | The signed acceptance record |
| `inspectManagedAcceptance(record, { custodians })` | A record and the custodians you accept | Structure, signature and time-order findings, and the commitment |
| `acceptanceCommitment(record)` | The record | The digest the `TRANSFER` carries in `authorisationCommitment` |
| `bindAcceptanceToState(record, state)` | The record and the `TRANSFER` state | The mismatches; empty when they agree |

**Claims and anchors**

| Function | Takes | Returns |
|---|---|---|
| `didKeyFromIdentityKey(identityKey)` | A compressed public key | Its `did:key` |
| `signLifecycleClaim(claim, signer)` | An unsigned native claim and the issuer's signer | The signed claim |
| `verifyLifecycleClaim(claim, { passportId, recordId })` | A signed claim and what it should be about | Its signature and subject findings |
| `lifecycleClaimDigest(claim)` | A signed claim | The digest an anchor commits to |
| `buildAttestationAnchor(metadata, signer)` | The digest, `attestationId`, issuer, subject and type, and the anchoring service's signer | The anchor's `LockingScript` |
| `inspectAttestationAnchor(script)` | An anchor output's script | Its metadata, key derivation and signature findings |

**Publisher policy and evidence packages**

| Function | Takes | Returns |
|---|---|---|
| `policySigningPreimage(policy)` | A policy version | The bytes its authorisation signs |
| `policyDigest(policy)` | A signed policy version | The digest the next version names in `supersedes` |
| `verifyPolicyChain(chain, operatorIdentityKeys)` | The chain, oldest first, and each operator's identity key | `{ ok, versions, failure? }`, the same check an index makes at boot |
| `policyInForceAt(chain, at)`, `publisherKeysAt(chain, at, role?)` | The chain and an instant | The version in force then, and the keys it admits |
| `inspectEvidencePackage(manifest, files, { expectedPassportId, expectedSigner })` | A package's manifest and its files by path | Structure, inventory and signature findings; check that `failures` is empty |

The source is under [`packages/dpp-core/src`](https://github.com/bsv-blockchain/dpp/tree/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-core/src), and the [package guide](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-core/README.md) lists the remaining exports.

The caller supplies header, credential, status and authority adapters. Read the [report source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/verification.md) for the distinction between missing evidence and a check that does not apply. Source disagreements are listed in the [fixture guide](../implement/fixture-runner.md).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
