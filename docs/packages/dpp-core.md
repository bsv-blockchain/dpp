# @bsv/dpp-core

**Experimental prerelease:** `@bsv/dpp-core` 0.3.0-beta.4 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

Install the exact published version:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.4
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
| `identityKeyFromDidKey(did)` | A `did:key` | The compressed public key it names |
| `signingPublicKeyFor(state)`, `signingDidFor(state)` | A state's `actorIdentityKey` and `actorKeyId` | The derived key that verifies the actor signature, and its `did:key`; it differs from the actor's identity key |
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

## Gather a passport's evidence

A report is only as complete as the evidence and policy it is given. This reader gathers everything the hosted reference holds for a version 2 passport with three anchored claims: its lineage from the index, its claims from the registry, their anchors from the index, and a second look at the index for a later state. Run it with Node 22 and the packages installed as the [walkthrough](build-an-application.md) shows:

```js
import { Beef, WhatsOnChain } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs, verifyPassportEvidence } from '@bsv/dpp-core'

// Ask the header source one question at a time, a little apart, and keep each
// answer for the run: WhatsOnChain answers only a few requests a second.
function pacedTracker(inner, gapMs = 400) {
  const answers = new Map()
  let queue = Promise.resolve()
  const ask = (key, question) => {
    if (!answers.has(key)) {
      const answer = queue.then(() => new Promise((wait) => setTimeout(wait, gapMs))).then(question)
      queue = answer.catch(() => {})
      answers.set(key, answer.catch((error) => { answers.delete(key); throw error }))
    }
    return answers.get(key)
  }
  return {
    isValidRootForHeight: (root, height) => ask(`${height}:${root}`, () => inner.isValidRootForHeight(root, height)),
    currentHeight: () => ask('height', () => inner.currentHeight()),
  }
}

const index = 'https://dpp-overlay.bsvb.net'
const registry = 'https://dpp-resolver.bsvb.net'
const passportId = 'https://id.gs1.org/01/09506000134352/21/345A8EAF501F'

// The parties you accept. These wrote this passport on the hosted reference;
// a reader of its own takes them from its own list, never from the evidence.
const trusted = {
  genesisIssuers: ['02f316d2efb06630406ce1765f254be19acb522c4df33710e8b1bd77bcdc4616b6'],
  claimIssuers: ['did:key:zQ3shnfXGt4rjzyJjK671B4PpRMqRYL7C5ueftenGtm5CL2Gq'],
  anchoringServices: ['036564081bb854af4d049245f775f48495a5c4ffae830db5d3f1dbc05f9bf403e2'],
}

const lookup = async (service, query) =>
  (await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, query }) })).json()).outputs
const lineage = async () => {
  const outputs = await lookup('ls_dpp', { passportId })
  if (outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
  const merged = Beef.fromBinary(outputs[0].beef)
  for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
  return chainFromBeef(merged, passportId)
}

// Claims: the registry lists them by subject, a page at a time, and each proof carries the claim and its exact bytes.
const items = []
for (let cursor; ; ) {
  const page = await (await fetch(`${registry}/attestations?subject=${encodeURIComponent(passportId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json()
  items.push(...page.items)
  if (page.nextCursor == null) break
  cursor = page.nextCursor
}
const proofs = await Promise.all(items.map(async ({ attestationId }) => (await fetch(`${registry}/attestations/${encodeURIComponent(attestationId)}/proof`)).json()))

// Anchors: the index finds them by subject, continuing after the last outpoint until a page is empty;
// each anchor is given the bytes of the claim it anchors.
const anchors = []
for (let after; ; ) {
  const page = await lookup('ls_attestation', { subject: passportId, ...(after ? { after } : {}) })
  if (page.length === 0) break
  for (const { beef, outputIndex } of page) {
    const tx = Beef.fromBinary(beef).txs.at(-1).tx
    const txid = tx.id('hex')
    const claim = proofs.find((proof) => proof.anchor?.recordId === txid)
    anchors.push({ lockingScript: tx.outputs[outputIndex].lockingScript, txid, outputIndex, securedBytes: claim?.securedBytes })
    after = { txid, outputIndex }
  }
}

// The latest state: ask the index again whether it holds a state after the tip checked here.
const indexObserver = {
  id: index,
  kind: 'overlay-lookup',
  observe: async ({ tip }) => {
    const states = await lineage()
    const at = states.findIndex((tx) => tx.id('hex') === tip?.txid)
    if (at === -1) return { result: 'not-found' }
    const next = states[at + 1]
    return next == null ? { result: 'unspent' } : { result: 'spent', spendingTxid: next.id('hex') }
  },
}

const { publisherPolicy } = await (await fetch(`${index}/capabilities`)).json()
const report = await verifyPassportEvidence(
  { tokenHistory: await lineage(), nativeClaims: proofs.map((proof) => proof.attestation), anchors },
  { passportId, source: 'request-context' },
  {
    chainTracker: pacedTracker(new WhatsOnChain('main', { apiKey: process.env.WOC_API_KEY })),
    publisherKeys: publisherPolicy.publisherKeys,
    authority: { required: true, ...trusted },
    observers: [indexObserver],
  }
)
for (const check of report.checks) console.log(check.name, check.status, check.reasonCode ?? '')
console.log('latest state', report.observations.latestState)
```

It takes about ten seconds and prints:

```
recordEncoding pass
actorSignatures pass
publisherSignatures pass
linkage pass
inclusion pass
nativeAttestationSignature pass
anchorSignature pass
anchorKeyDerivation pass
anchorDigestAndMetadataBinding pass
externalCredentialProof not-applicable no-external-credential
subjectBinding pass
issuerAuthority pass
schema unknown schema-unavailable
credentialTime pass
credentialStatus not-applicable format-defines-no-status
evidenceAvailability unknown referenced-artefact-unavailable
latest state observed
```

Two checks stay `unknown`, and both are honest. `schema` has no payload to check, because a native claim carries none. `evidenceAvailability` names the managed acceptance record the passport's `TRANSFER` commits to: the custodian keeps it, and no index or registry route serves it yet. The report also does not check a state's `payload_public` against the profile it declares; check that yourself with `node examples/sample-payload.mjs --check <profile@version> <file>`.

**What the evidence holds and where a reader gets it**

| Field | Holds | Where it comes from |
|---|---|---|
| `tokenHistory` | The lineage's transactions, genesis first | `chainFromBeef` over the merged BEEFs of the index's `ls_dpp` lookup |
| `nativeClaims` | Signed lifecycle claims, as objects | The registry: `GET /attestations?subject=<passportId>` lists them, and each one's `GET /attestations/{attestationId}/proof` carries the claim as `attestation` |
| `anchors` | `{ lockingScript, txid, outputIndex, securedBytes }` for each anchor output | The index's `ls_attestation` lookup with `{ subject: passportId }`; `securedBytes` is the anchored claim's `securedBytes` from its proof, matched by the anchor's transaction identifier |
| `acceptanceRecords` | The managed acceptance records version 2 transfers commit to | The custodian that wrote the transfer; no route serves them yet |
| `externalCredentials` | `{ representation, mediaType, bytes }`, the exact bytes of a credential in another format | Whoever issued the credential |
| `alternativeHistories` | Other lineages under the same identifier, such as a second genesis | The index, when it answers with more than one lineage |

The registry in the reader above is the one that holds this passport's claims. Registries do not exchange claims, and an anchor does not name the registry that holds its claim, so a reader asks the registries it knows ([the registry guide](../implement/roles/registry.md#the-minimum-a-registry-serves)). An anchor passed without `securedBytes` still has its signature and key derivation checked, and `anchorDigestAndMetadataBinding` stays `unknown` with `secured-bytes-absent`.

**What the policy selects**

| Field | Selects | Check or finding it settles |
|---|---|---|
| `chainTracker` | A header source, or `'scripts only'` | `inclusion` |
| `publisherKeys`, or `publisherPolicy` with its operators' keys | The publishers whose countersignature is accepted | `publisherSignatures` |
| `authority` | `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`: the genesis state's actor key, each claim's issuer DID, each anchor's `anchoredBy` key and each acceptance record's custodian that you accept; `verify` answers any role the lists leave open. `{ required: false, reason }` selects no authority check | `issuerAuthority`, which reads `unknown` for any role a required policy does not list |
| `observers` | Sources asked whether the tip is still the latest state; each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting` | `report.observations.latestState`: `observed`, `superseded`, `conflicting`, or `unknown` when no observer is given |
| `managedAcceptance` | `{ required: true }` to demand an acceptance commitment on every version 2 `TRANSFER` | `linkage`, which fails with `acceptance-commitment-absent` for a transfer without one |
| `profileValidator` | A function that checks a native claim against its declared profile | `schema` for native claims |
| `checkedAt` | The report's time, for a reproducible report; defaults to now | The observation time, and the instant credential validity is judged at |

`EVIDENCE_CHECK_NAMES` lists the sixteen checks in report order, and `EVIDENCE_CHECK_LABELS` gives each a short sentence a surface can show beside it, such as "Every entry is in a block" for `inclusion`.

The source is under [`packages/dpp-core/src`](https://github.com/bsv-blockchain/dpp/tree/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-core/src), and the [package guide](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-core/README.md) lists the remaining exports.

The caller supplies header, credential, status and authority adapters. Read the [report source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md) for the distinction between missing evidence and a check that does not apply. Source disagreements are listed in the [fixture guide](../implement/fixture-runner.md).
