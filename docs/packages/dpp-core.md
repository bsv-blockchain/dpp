# @bsv/dpp-core

`@bsv/dpp-core` holds the rules every passport application shares: it decodes, builds and signs passport states and claims, and checks a passport's evidence into a verification report. Use it when you build a reader, a writer or a registry in JavaScript or TypeScript; it does not run an index, hold a wallet or decide whom your application trusts.

**Experimental prerelease:** `@bsv/dpp-core` 0.3.0-beta.5 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.5 @bsv/sdk@2.8.10
```

Name the exact versions: a bare `npm install @bsv/dpp-core` installs the `latest` tag, which is still 0.3.0-beta.1. Every example below also imports `@bsv/sdk`. Keep the application lockfile and review compatibility before upgrading. The [support table](support-table.md) says which entry points run where; browser use is untested.

The examples on this page are complete files. Save each one under the name given, as an `.mjs` file because they use top-level `await`, and run it with `node <name>.mjs` in that project.

## Check your setup

Save this as `check-setup.mjs`. It fetches the first state of the repository's version 2 test passport, at the reviewed commit, and decodes it:

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

A `Cannot find package` error means the install did not finish in this project. Decoding a state is not verifying it: nothing above checked a signature, a link between states or a block proof. The next section does all three.

## Gather a passport's evidence

A report is only as complete as the evidence and the policy it is given. This reader gathers everything the hosted reference holds for a version 2 passport with three anchored claims: its lineage from the index, its claims from the registry, their anchors from the index, and a second look at the index for a later state. The lineage is the passport's chain of states, genesis first; an anchor is a small transaction that commits to a claim's exact bytes.

You need network access to the hosted index, the hosted registry and WhatsOnChain, which supplies the block headers. A `WOC_API_KEY` environment variable is optional: without one the header source is paced and still answers. Save this as `gather.mjs`:

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

Two checks read `unknown`, and both are expected for this passport:

- `schema` reads `unknown` with `schema-unavailable` because the policy gives no `profileValidator`. A native claim names a profile but carries no product data, so there is nothing yet for one to check.
- `evidenceAvailability` reads `unknown` with `referenced-artefact-unavailable` because the passport's `TRANSFER` commits to a managed acceptance record that only the custodian keeps. No index or registry route serves it yet.

The report does not check a state's `payload_public`, the product data a state carries on chain, against the profile it declares; that is a gap in the package ([known limitations](../operate/limitations.md)). Check it yourself with the profiles package, as [check a payload against its profile](dpp-profiles.md#check-a-payload-against-its-profile) shows, or in a checkout with `node examples/sample-payload.mjs --check <profile@version> <file>`.

If `inclusion` reads `unknown` with `header-source-unavailable`, WhatsOnChain limited the header checks: run it again or set `WOC_API_KEY`. If the first lookup throws `the index holds nothing`, the index does not hold that passport; check the identifier character for character.

## What the report takes

**What the evidence holds and where a reader gets it**

| Field | Holds | Where it comes from |
|---|---|---|
| `tokenHistory` | The lineage's transactions, genesis first | `chainFromBeef` over the merged BEEFs of the index's `ls_dpp` lookup. BEEF is the transaction format that carries a transaction with its ancestors and block proofs |
| `nativeClaims` | Signed lifecycle claims, as objects | The registry: `GET /attestations?subject=<passportId>` lists them, and each one's `GET /attestations/{attestationId}/proof` carries the claim as `attestation` |
| `anchors` | `{ lockingScript, txid, outputIndex, securedBytes }` for each anchor output | The index's `ls_attestation` lookup with `{ subject: passportId }`; `securedBytes` is the anchored claim's `securedBytes` from its proof, matched by the anchor's transaction identifier |
| `acceptanceRecords` | The managed acceptance records version 2 transfers commit to | The custodian that wrote the transfer; no route serves them yet |
| `externalCredentials` | `{ representation, mediaType, bytes }`, the exact bytes of a credential in another format | Whoever issued the credential |
| `alternativeHistories` | Other lineages under the same identifier, such as a second genesis | The index, when it answers with more than one lineage |

The registry in the reader above is the one that holds this passport's claims. Registries do not exchange claims, an anchor does not name the registry that holds its claim, and no passport state or capability document names one either. Until the standard gives a reader a way to find it, a reader learns the registry from the passport's publisher ([known limitations](../operate/limitations.md), [the registry guide](../implement/roles/registry.md#the-minimum-a-registry-serves)).

When a reader has an anchor but neither its claim nor the claim's bytes, which is what happens when the registry it asks does not hold the claim, six checks change. Run on the repository's claim fixture, `fixtures/attestation-anchor-v1.json`, with and without the claim:

| Check | With the claim and its bytes | With the anchor alone |
|---|---|---|
| `nativeAttestationSignature` | `pass` | `unknown` `no-evidence` |
| `anchorDigestAndMetadataBinding` | `pass` | `unknown` `secured-bytes-absent` |
| `schema` | `unknown` `schema-unavailable` | `unknown` `no-evidence` |
| `credentialTime` | `pass` | `unknown` `no-evidence` |
| `credentialStatus` | `not-applicable` `format-defines-no-status` | `unknown` `no-evidence` |
| `evidenceAvailability` | `pass` | `unknown` `referenced-artefact-unavailable` |

`anchorSignature`, `anchorKeyDerivation`, `subjectBinding` and `issuerAuthority` still pass, because they need only the anchor; without the claim, `issuerAuthority` asks only about the anchoring service, not the claim's issuer. For the passport in the reader above, `evidenceAvailability` is already `unknown` for its acceptance record, so it does not visibly move there. Either the claim in `nativeClaims` or its exact bytes as the anchor's `securedBytes` lets the report bind the anchor to the claim; pass both, as the reader does, so the claim's own signature is checked too.

**What `expected` says**

`passportId` is the identifier you were asked about: from the scan, the label or the request, never from the evidence under test. `source` says where it came from:

| `source` | Meaning |
|---|---|
| `request-context` | The scan, label or request in hand, as in the reader above |
| `established-binding` | A binding you verified before reading this evidence, such as an earlier verified genesis |
| `none` | You took it from the evidence itself; `subjectBinding` then reads `unknown` with `subject-not-independent`, because evidence that names its own subject proves nothing about it |

`expected` can also name `productIdentifier`, `expectedIssuer`, `expectedGenesisOutpoint` and `expectedStateOutpoint`, and the report checks every artefact against each one given ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3).

**What the policy selects**

| Field | Selects | Check or finding it settles |
|---|---|---|
| `chainTracker` | A header source, or `'scripts only'` to skip header checks | `inclusion` |
| `publisherKeys`, or `publisherPolicy` with its operators' keys | The publishers whose countersignature is accepted | `publisherSignatures` |
| `authority` | `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`: the genesis state's actor key, each claim's issuer DID, each anchor's `anchoredBy` key and each acceptance record's custodian that you accept; `verify` answers any role the lists leave open. `{ required: false, reason }` selects no authority check | `issuerAuthority`, which reads `unknown` for any role a required policy does not list |
| `observers` | Sources asked whether the tip is still the latest state; each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting` | `report.observations.latestState`: `observed`, `superseded`, `conflicting`, or `unknown` when no observer is given |
| `managedAcceptance` | `{ required: true }` to demand an acceptance commitment on every version 2 `TRANSFER` | `linkage`, which fails with `acceptance-commitment-absent` for a transfer without one |
| `ownerConsent`, `controlAuthorities` | The owner-signed transfer for version 1 states, and the identity keys whose version 2 `UPDATE`, `TRANSFER` or `RETIRE` passes without a control proof, such as a recovery authority | `linkage` |
| `credentialVerifier` | A function that verifies an external credential's exact bytes, such as `externalCredentialVerifierFor(policy)` from `@bsv/vsc/exchange` ([external credentials](../interoperability/external-credentials.md)). Credential status is checked inside it | `externalCredentialProof`, and each credential's part of `schema`, `credentialTime`, `credentialStatus` and `issuerAuthority`; without it they read `unknown` with `verifier-not-supplied` for an external credential |
| `profileValidator` | A function that checks a native claim against its declared profile | `schema` for native claims |
| `policyId` | A name for this policy, recorded in the report | `report.policyId` |
| `checkedAt` | The report's time, for a reproducible report; defaults to now | The observation time, and the instant credential validity is judged at |

`EVIDENCE_CHECK_NAMES` lists the sixteen checks in report order, and `EVIDENCE_CHECK_LABELS` gives each a short sentence a surface can show beside it, such as "Every entry is in a block" for `inclusion`. [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) defines each check and the difference between missing evidence (`unknown`) and a check that does not apply (`not-applicable`).

## Function reference

These tables list the functions an application calls, what each takes and what it returns. The [walkthrough](build-an-application.md) shows them in order.

**Read and verify**

| Function | Takes | Returns |
|---|---|---|
| `findDppOutputs(tx)` | A `Transaction` | The passport outputs it carries, each with its output index and decoded state |
| `chainFromBeef(beef, passportId?)` | A `Beef` holding a lineage, and the passport to follow | The lineage's transactions, genesis first |
| `verifyChain(txs, options?)` | The lineage; `chainTracker`, `serverIdentityKey`, `managedAcceptance`, `controlAuthorities`, `ownerConsent` | `{ valid, spv, states, error? }`: whether the lineage holds, whether inclusion is proved, and one finding per state |
| `verifyPassportEvidence(evidence, expected, policy?)` | `evidence` and `expected` as [above](#what-the-report-takes); `policy` with the fields in the policy table, among them `chainTracker`, `publisherKeys` or `publisherPolicy`, `authority`, `observers`, `managedAcceptance`, `credentialVerifier`, `profileValidator` and `checkedAt` | The verification report: sixteen named checks, each `pass`, `fail`, `unknown` or `not-applicable` with a reason |

**Write**

The controller key is the key in field 6 of every state: it names who controls the passport, and each state is locked to it. The control linkage is the scalar that proves your identity key derived that controller key; every state after the genesis carries it ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6). `[1, 'dpp owner v1']` is the BRC-100 wallet protocol, a security level and a name, under which the controller key is derived.

| Function | Takes | Returns |
|---|---|---|
| `ownerKeyFor(passportId, wallet)` | The passport and a BRC-100 wallet | The controller key, derived for `[1, 'dpp owner v1']` with the passport identifier as key identifier |
| `revealOwnerLinkage(passportId, wallet, verifierIdentityKey)`, then `decryptOwnerLinkage(revelation, wallet)` | The same wallet, with `verifierIdentityKey` set to the wallet's own identity key, so it reveals the linkage to itself | The control linkage, 64 hex characters, for every state after the genesis |
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
| `buildAttestationAnchor(metadata, signer)` | All eight metadata fields, as text: `digest` (the claim's digest), `attestationId` (`urn:sha256:` and that digest), `issuer` (the claim's issuer), `subject` (its `passportId`), `attestationType` (its `eventType`), `representation` (`LIFECYCLE_REPRESENTATION`), `mediaType` (`LIFECYCLE_MEDIA_TYPE`) and `anchoredBy` (the anchoring service's identity key); and that service's signer | The anchor's `LockingScript`. It throws `anchor metadata must be text` when a field is missing, and `signer does not match anchoredBy` when the signer holds another key |
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

The package also exports `@bsv/dpp-core/schemas/*`: the standard's JSON schemas, copied byte for byte. A consumer can validate a verification report, capability document or evidence package without a repository checkout. Save this as `schema-id.mjs`:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const schema = require('@bsv/dpp-core/schemas/verification-report.schema.json')
console.log(schema.$id)
```

`node schema-id.mjs` prints `https://bsv-blockchain.github.io/dpp/contracts/verification-report.schema.json`. Use a validator that supports the schema's declared dialect and asserts formats. A valid shape does not replace signature or evidence verification.

## Limits

- The report does not check a state's `payload_public` against its declared profile; check it with the profiles package, as above.
- A reader cannot find the registry that holds a passport's claims from the passport or its anchors; it learns the registry from the publisher.
- Identity is at Ring 0: a key identifies a party, and only the platform account vouches for who holds it. Nothing yet binds a key to a legal entity or certifies a party's role ([identity and authority](../learn/identity-and-authority.md)).

[Known limitations](../operate/limitations.md) collects the other open gaps of the reference services.

## Next

| To | Go to |
|---|---|
| Check a state's product data against its profile | [@bsv/dpp-profiles](dpp-profiles.md) |
| Write passports with these functions | [Build an application](build-an-application.md), step 3 |
| Add a claim to a passport you do not control | [Add a claim](add-a-claim.md) |
| Run an index of your own | [@bsv/dpp-overlay-topics](dpp-overlay-topics.md) |
