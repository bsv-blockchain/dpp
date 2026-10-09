# @bsv/dpp-core

Use `@bsv/dpp-core` to build a passport reader, writer or registry in JavaScript or TypeScript. It decodes, builds and signs passport states and claims, and checks a passport's evidence into a verification report. It does not run an index, hold a wallet or decide whom your application trusts.

**Experimental prerelease:** `@bsv/dpp-core` 0.3.0-beta.8 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.8 @bsv/sdk@2.8.10
```

Pin the exact version so an upgrade is your choice: a bare `npm install @bsv/dpp-core` installs the `latest` tag, the newest beta. Keep your lockfile and review compatibility before upgrading. The examples also import `@bsv/sdk`. The [support table](support-table.md) says which entry points run where; browser use is untested.

Each example below is a complete file to save in that project, as `.mjs` because it uses top-level `await`.

## Check your setup

Save this as `check-setup.mjs`. It decodes the first state of the repository's version 2 test passport:

```js
import { Transaction } from '@bsv/sdk'
import { findDppOutputs } from '@bsv/dpp-core'

// The first state of the repository's version 2 test passport, at the reviewed commit.
const fixture = await (await fetch('https://raw.githubusercontent.com/bsv-blockchain/dpp/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/chain-v2.json')).json()
const [output] = findDppOutputs(Transaction.fromHex(fixture.states[0].rawTx))
console.log(output.state.op, output.state.passportId, 'in output', output.outputIndex)
```

`node check-setup.mjs` prints:

```
ISSUE https://dpp.bsvb.net/01/09521000000018/21/V2-0001 in output 0
```

A `Cannot find package` error means the install did not finish in this project. Decoding is not verifying: nothing above checked a signature, a link between states or a block proof. The next section checks all three.

## Gather a passport's evidence

A report is only as complete as the evidence and policy you give it. This reader gathers everything the hosted reference holds for a version 2 passport with three anchored claims: its lineage (its chain of states, genesis first) and its claims' anchors from the index, the claims from the registry, and a second index lookup for a later state. An anchor is a small transaction that commits to a claim's exact bytes.

It needs network access to the hosted index, the hosted registry and WhatsOnChain, which supplies block headers. `WOC_API_KEY` is optional: without it the header source is paced and still answers. Save this as `gather.mjs`:

```js
import { Beef, WhatsOnChain } from '@bsv/sdk'
import { chainFromBeef, verifyPassportEvidence } from '@bsv/dpp-core'

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
    // On a registry proof, `anchor.recordId` is the anchor's own transaction identifier.
    // A claim's own `recordId` is different: it names the passport state the claim is about.
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

`node gather.mjs` takes about ten seconds and prints:

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

Both `unknown` checks are expected for this passport:

- `schema`: the policy gives no `profileValidator`. A native claim names a profile but carries no product data, so there is nothing yet for one to check.
- `evidenceAvailability`: the passport's `TRANSFER` commits to a managed acceptance record that only the custodian keeps, and no index or registry route serves it yet.

If `inclusion` reads `unknown` with `header-source-unavailable`, WhatsOnChain limited the header checks: run it again or set `WOC_API_KEY`. If the first lookup throws `the index holds nothing`, the index does not hold that passport; check the identifier character for character.

## What the report takes

**What `evidence` holds**

| Field | Holds | Where it comes from |
|---|---|---|
| `tokenHistory` | The lineage's transactions, genesis first | `chainFromBeef` over the merged BEEFs (transactions with their ancestors and block proofs) from the index's `ls_dpp` lookup |
| `nativeClaims` | Signed lifecycle claims, as objects | The registry: `GET /attestations?subject=<passportId>` lists them; each `GET /attestations/{attestationId}/proof` carries one as `attestation` |
| `anchors` | `{ lockingScript, txid, outputIndex, securedBytes }` for each anchor output | The index's `ls_attestation` lookup with `{ subject: passportId }`; `securedBytes` comes from the proof of the claim the anchor's `txid` matches |
| `acceptanceRecords` | The managed acceptance records version 2 transfers commit to | The custodian that wrote the transfer; no route serves them yet |
| `externalCredentials` | `{ representation, mediaType, bytes }`, the exact bytes of a credential in another format | Its issuer |
| `alternativeHistories` | Other lineages under the same identifier, such as a second genesis | The index, when it answers with more than one lineage |

Pass each claim in `nativeClaims` and its exact bytes as its anchor's `securedBytes`, as the reader does. Either one binds the anchor to the claim; the claim also lets the report check the claim's own signature.

If the registry you ask does not hold a claim ([limits](#limits)), you have its anchor alone and six checks change. On the repository's claim fixture, `fixtures/attestation-anchor-v1.json`:

| Check | With the claim and its bytes | With the anchor alone |
|---|---|---|
| `nativeAttestationSignature` | `pass` | `unknown` `no-evidence` |
| `anchorDigestAndMetadataBinding` | `pass` | `unknown` `secured-bytes-absent` |
| `schema` | `unknown` `schema-unavailable` | `unknown` `no-evidence` |
| `credentialTime` | `pass` | `unknown` `no-evidence` |
| `credentialStatus` | `not-applicable` `format-defines-no-status` | `unknown` `no-evidence` |
| `evidenceAvailability` | `pass` | `unknown` `referenced-artefact-unavailable` |

`anchorSignature`, `anchorKeyDerivation`, `subjectBinding` and `issuerAuthority` still pass because they need only the anchor; `issuerAuthority` then asks only about the anchoring service, not the claim's issuer. In the reader above, `evidenceAvailability` is already `unknown` for the acceptance record, so it does not visibly move.

**What `expected` says**

Set `passportId` to the identifier you were asked about, from the scan, label or request, never from the evidence under test. `source` says where it came from:

| `source` | Meaning |
|---|---|
| `request-context` | The scan, label or request in hand, as in the reader above |
| `established-binding` | A binding you verified before reading this evidence, such as an earlier verified genesis |
| `none` | You took it from the evidence itself; `subjectBinding` reads `unknown` with `subject-not-independent`, because evidence that names its own subject proves nothing about it |

`expected` can also name `productIdentifier`, `expectedIssuer`, `expectedGenesisOutpoint` and `expectedStateOutpoint`; the report checks every artefact against each one given ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3).

**What the policy selects**

| Field | Selects | Check or finding it settles |
|---|---|---|
| `chainTracker` | A header source, or `'scripts only'` to skip header checks | `inclusion` |
| `publisherKeys`, or `publisherPolicy` with its operators' keys (the chain from an index's `GET /publisher-policy`) | Publishers whose countersignature you accept | `publisherSignatures` |
| `authority` | `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`: the genesis actor keys, claim issuer DIDs, anchor `anchoredBy` keys and acceptance custodians you accept; `verify` answers any role the lists leave open. `{ required: false, reason }` skips the check | `issuerAuthority`; `unknown` for any role a required policy does not list |
| `observers` | Sources asked whether the tip is still the latest state; each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting` | `report.observations.latestState`: `observed`, `superseded`, `conflicting`, or `unknown` with no observer |
| `managedAcceptance` | `{ required: true }` demands an acceptance commitment on every version 2 `TRANSFER` | `linkage`; fails with `acceptance-commitment-absent` for a transfer without one |
| `ownerConsent`, `controlAuthorities` | The owner-signed transfer for version 1 states, and the identity keys whose version 2 `UPDATE`, `TRANSFER` or `RETIRE` passes without a control proof, such as a recovery authority | `linkage` |
| `credentialVerifier` | Verifies an external credential's exact bytes and its status, such as `externalCredentialVerifierFor(policy)` from `@bsv/vsc/exchange` ([external credentials](../interoperability/external-credentials.md)) | `externalCredentialProof` and each credential's part of `schema`, `credentialTime`, `credentialStatus` and `issuerAuthority`, which read `unknown` with `verifier-not-supplied` without it |
| `profileValidator` | Checks a native claim against its declared profile | `schema` for native claims |
| `policyId` | A name for this policy | `report.policyId` |
| `checkedAt` | The report's time, for a reproducible report; defaults to now | The observation time, and the instant credential validity is judged at |

`EVIDENCE_CHECK_NAMES` lists the sixteen checks in report order. `EVIDENCE_CHECK_LABELS` gives each a short sentence to show beside it, such as "Every entry is in a block" for `inclusion`. [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) defines each check and the difference between missing evidence (`unknown`) and a check that does not apply (`not-applicable`).

## Function reference

The [walkthrough](build-an-application.md) calls these functions in order.

**Read and verify**

| Function | Takes | Returns |
|---|---|---|
| `findDppOutputs(tx)` | A `Transaction` | The passport outputs it carries, each with its output index and decoded state |
| `chainFromBeef(beef, passportId?)` | A `Beef` holding a lineage, and the passport to follow | The lineage's transactions, genesis first |
| `verifyChain(txs, options?)` | The lineage; `chainTracker`, `serverIdentityKey`, `managedAcceptance`, `controlAuthorities`, `ownerConsent` | `{ valid, spv, states, error? }`: whether the lineage holds, whether inclusion is proved, and one finding per state |
| `verifyPassportEvidence(evidence, expected, policy?)` | `evidence`, `expected` and `policy` as [above](#what-the-report-takes) | The verification report: sixteen named checks, each `pass`, `fail`, `unknown` or `not-applicable` with a reason |

**Write**

The controller key, in field 6 of every state, names who controls the passport and locks each state. Every later state carries the control linkage, the scalar proving your identity key derived it ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6).

| Function | Takes | Returns |
|---|---|---|
| `ownerKeyFor(passportId, wallet)` | The passport and a BRC-100 wallet | The controller key, derived under the BRC-100 protocol `[1, 'dpp owner v1']` (a security level and a name) with the passport identifier as key identifier |
| `revealOwnerLinkage(passportId, wallet, verifierIdentityKey)`, then `decryptOwnerLinkage(revelation, wallet)` | The same wallet, with `verifierIdentityKey` set to the wallet's own identity key, so it reveals the linkage to itself | The control linkage, 64 hex characters |
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
| `signLifecycleClaim(claim, signer)` | An unsigned claim with exactly `claimFormat`, `passportId`, `recordId`, `eventType`, `timestamp`, `issuer`, `issuerKeyId`, `profile` and `profile_version` (plus `issuerKeyDid` when the issuer is not a `did:key`), and the issuer's BRC-100 wallet; [add a claim](add-a-claim.md) explains each field | The signed claim; it throws on an unknown field or a signer that is not the issuer's key |
| `verifyLifecycleClaim(claim, { passportId, recordId })` | A signed claim and what it should be about | Its signature and subject findings |
| `lifecycleClaimDigest(claim)` | A signed claim | The digest an anchor commits to |
| `buildAttestationAnchor(metadata, signer)` | All eight metadata fields, as text: `digest` (the claim's digest), `attestationId` (`urn:sha256:` and that digest), the claim's `issuer`, `subject` (its `passportId`), `attestationType` (its `eventType`), `representation` (`LIFECYCLE_REPRESENTATION`), `mediaType` (`LIFECYCLE_MEDIA_TYPE`) and `anchoredBy` (the anchoring service's identity key); and that service's signer | The anchor's `LockingScript`; it throws `anchor metadata must be text` for a missing field and `signer does not match anchoredBy` when the signer holds another key |
| `inspectAttestationAnchor(script)` | An anchor output's script | Its metadata, key derivation and signature findings |

**Publisher policy and evidence packages**

| Function | Takes | Returns |
|---|---|---|
| `policySigningPreimage(policy)` | A policy version | The bytes its authorisation signs |
| `policyDigest(policy)` | A signed policy version | The digest the next version names in `supersedes` |
| `verifyPolicyChain(chain, operatorIdentityKeys)` | The chain, oldest first, and each operator's identity key | `{ ok, versions, failure? }`, the same check an index makes at boot |
| `policyInForceAt(chain, at)`, `publisherKeysAt(chain, at, role?)` | The chain and an instant | The version in force then, and the keys it admits |
| `inspectEvidencePackage(manifest, files, { expectedPassportId, expectedSigner })` | A package's manifest and its files by path | Structure, inventory and signature findings; check that `failures` is empty |

The source is under [`packages/dpp-core/src`](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/src), and the [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/README.md) lists the remaining exports. Source disagreements are listed in the [fixture guide](../implement/fixture-runner.md).

## The standard's schemas

To validate a verification report, capability document or evidence package without a repository checkout, import the standard's JSON schemas from `@bsv/dpp-core/schemas/*`, copied byte for byte. Save this as `schema-id.mjs`:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const schema = require('@bsv/dpp-core/schemas/verification-report.schema.json')
console.log(schema.$id)
```

`node schema-id.mjs` prints `https://bsv-blockchain.github.io/dpp/contracts/verification-report.schema.json`. Use a validator that supports the schema's declared dialect and asserts formats. A valid shape does not replace signature or evidence verification.

## Limits

- The report does not check a state's `payload_public`, the product data it carries on chain, against its declared profile. Check it with [the profiles package](dpp-profiles.md#check-a-payload-against-its-profile), or in a checkout with `node examples/sample-payload.mjs --check <profile@version> <file>`.
- Registries do not exchange claims, and no passport state, anchor or capability document names the registry that holds a claim. Learn it from the passport's publisher ([the registry guide](../implement/roles/registry.md#the-minimum-a-registry-serves)).
- Identity is at Ring 0: a key identifies a party, and only the platform account vouches for who holds it. Nothing yet binds a key to a legal entity or certifies a party's role ([identity and authority](../learn/identity-and-authority.md)).

[Known limitations](../operate/limitations.md) collects the other open gaps of the reference services.

## Next

| To | Go to |
|---|---|
| Check a state's product data against its profile | [@bsv/dpp-profiles](dpp-profiles.md) |
| Write passports with these functions | [Build an application](build-an-application.md), step 3 |
| Add a claim to a passport you do not control | [Add a claim](add-a-claim.md) |
| Run an index of your own | [@bsv/dpp-overlay-topics](dpp-overlay-topics.md) |
