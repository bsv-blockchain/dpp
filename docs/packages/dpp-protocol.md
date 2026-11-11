# @bsv/dpp-protocol

JavaScript and TypeScript application builders can use `@bsv/dpp-protocol` to build readers, writers and registries. It decodes, builds and signs passport states and claims, and produces verification reports from passport evidence. It does not run an index, hold a wallet or decide whom your application trusts.

**Experimental prerelease:** `@bsv/dpp-protocol` 0.3.0-beta.10 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Runtime and evidence prerequisites

| Procedure | Input and source |
|---|---|
| All scripts | Node 22 or later; packages from Install, including directly imported `@bsv/sdk`. Save complete files as `.mjs` for top-level `await`. |
| Candidate installation | A source checkout containing `packages/dpp-protocol`, from [source access](README.md#source-access). |
| Setup decoding | Network access to the repository fixture URL embedded in `check-setup.mjs`. |
| Live gathering | Network access to the hosted index, registry and WhatsOnChain block headers; sample addresses and passport identifier are in `gather.mjs`. |
| Live trust policy | Genesis issuer, claim issuer and anchoring-service keys from your trusted list, never the evidence. The script names its sample's writers. |
| Header requests | Optional WhatsOnChain `WOC_API_KEY`; without it, paced requests still receive answers. |
| Schema validation | A validator supporting the schema's declared dialect and asserting formats. Shape validation does not replace signature or evidence checks. |

## Install

**Publication pending:** this page describes the renamed source candidate. [Install its local archives](README.md#use-the-renamed-source-candidate) now:

1. At the checkout root, run `npm ci`, `node scripts/release-candidates.mjs` and `node scripts/consumer-check.mjs` to build, pack and test archives in a separate project. Nothing is published.
2. In your application, install protocol, profiles and SDK together below. Replace `/absolute/path/to/dpp` with the checkout's absolute path; retain archives and lockfile.

```sh
npm install --save-exact /absolute/path/to/dpp/release/candidates/bsv-dpp-protocol-0.3.0-beta.10.tgz /absolute/path/to/dpp/release/candidates/bsv-dpp-profiles-0.3.0-beta.10.tgz @bsv/sdk@2.8.10
```

The npm command below applies once these exact versions have been published. Run it in your project:

```sh
npm install --save-exact @bsv/dpp-protocol@0.3.0-beta.10 @bsv/sdk@2.8.10
```

Pin versions, keep the lockfile and review compatibility before upgrading. After publication, a bare `npm install @bsv/dpp-protocol` selects `latest`, the newest beta. The [support table](support-table.md) lists entry-point support; browser use is untested.

| Complete file | Run in the installed project | Data source | Expected result |
|---|---|---|---|
| `check-setup.mjs` | `node check-setup.mjs` | Pinned version 2 fixture | `ISSUE` and the sample passport identifier, in output 0 |
| `gather.mjs` | `node gather.mjs` | Hosted index, registry and block headers | Sixteen checks and `latest state observed`, shown below; about ten seconds |
| `schema-id.mjs` | `node schema-id.mjs` | Installed standard schema | `https://bsv-blockchain.github.io/dpp/contracts/verification-report.schema.json` |

## Check your setup

1. Save this complete file as `check-setup.mjs`. It decodes the first state of the repository's version 2 test passport:

```js
import { Transaction } from '@bsv/sdk'
import { findDppOutputs } from '@bsv/dpp-protocol'

// The first state of the repository's version 2 test passport, at the reviewed commit.
const fixture = await (await fetch('https://raw.githubusercontent.com/bsv-blockchain/dpp/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/chain-v2.json')).json()
const [output] = findDppOutputs(Transaction.fromHex(fixture.states[0].rawTx))
console.log(output.state.op, output.state.passportId, 'in output', output.outputIndex)
```

2. Run `node check-setup.mjs`. Expected output:

```
ISSUE https://dpp.bsvb.net/01/09521000000018/21/V2-0001 in output 0
```

Stop on `Cannot find package`: the install did not finish in this project. Decoding checks no signature, state linkage or block proof. Continue below to check all three.

## Gather a passport's evidence

A report is only as complete as its evidence and policy. This reader gathers everything the hosted reference holds for a version 2 passport under the demonstration prefix 952 with three anchored claims:

| Evidence | Source |
|---|---|
| Lineage, the chain of states with genesis first | Index |
| Claim anchors, small transactions committing to exact claim bytes | Index |
| Claims | Registry |
| Observation of a later state | Second index lookup |

1. Save this complete file as `gather.mjs`:

```js
import { Beef, WhatsOnChain } from '@bsv/sdk'
import { chainFromBeef, verifyPassportEvidence } from '@bsv/dpp-protocol'

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
const passportId = 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'

// The parties you accept. These wrote this passport on the hosted reference;
// a reader of its own takes them from its own list, never from the evidence.
const trusted = {
  genesisIssuers: ['02f316d2efb06630406ce1765f254be19acb522c4df33710e8b1bd77bcdc4616b6'],
  claimIssuers: ['did:key:zQ3shueJ69URDxEmBkyJjUnkrQtCSv3pRTb4Nb4UVcNPDmqFb'],
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

2. Run `node gather.mjs`. It takes about ten seconds and prints:

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

- `schema`: the policy gives no `payloadValidator` and no `profileValidator`. A token state's payload is checked only through the former, and the fixture payloads declare no profile, so the check reads `unknown` with `profile-undeclared`.
- `evidenceAvailability`: the passport's `TRANSFER` commits to a managed acceptance record that only the custodian keeps; it reaches a reader in the custodian's evidence package, and no index or registry route serves it on its own.

3. Handle unavailable evidence before relying on the report:

| Result | Meaning and next step |
|---|---|
| `inclusion` is `unknown` with `header-source-unavailable` | WhatsOnChain limited header checks. Run again or set `WOC_API_KEY`. |
| First lookup throws `the index holds nothing` | The index holds no such passport. Stop and check the identifier character for character. |

## What the report takes

### Supply evidence

| Field | Holds | Where it comes from |
|---|---|---|
| `tokenHistory` | Lineage transactions, genesis first | `chainFromBeef` over merged BEEFs from the index's `ls_dpp` lookup; BEEF carries ancestors and block proofs. |
| `nativeClaims` | Signed lifecycle claims, as objects | The registry: `GET /attestations?subject=<passportId>` lists them; each `GET /attestations/{attestationId}/proof` carries one as `attestation` |
| `anchors` | `{ lockingScript, txid, outputIndex, securedBytes }` for each anchor output | The index's `ls_attestation` lookup with `{ subject: passportId }`; `securedBytes` comes from the proof of the claim the anchor's `txid` matches |
| `acceptanceRecords` | Managed acceptance records committed by version 2 transfers | Custodian's evidence package under `authority`, read by `acceptanceRecordsInPackage(manifest, files)`. No standalone record route. |
| `instructionRecords` | Managed instructions committed by version 2 updates and retirements after a hand on | Custodian's evidence package under `authority` as `dpp-managed-instruction@1` |
| `externalCredentials` | `{ representation, mediaType, bytes }`, the exact bytes of a credential in another format | Its issuer |
| `alternativeHistories` | Other lineages under the same identifier, such as a second genesis | The index, when it answers with more than one lineage |

Supply each claim in `nativeClaims` and its exact bytes in the anchor's `securedBytes`. Either binds anchor to claim; the claim also enables its signature check.

If the registry lacks a claim ([limits](#limits)), six checks change with its anchor alone. For `fixtures/attestation-anchor-v1.json`:

| Check | With the claim and its bytes | With the anchor alone |
|---|---|---|
| `nativeAttestationSignature` | `pass` | `unknown` `no-evidence` |
| `anchorDigestAndMetadataBinding` | `pass` | `unknown` `secured-bytes-absent` |
| `schema` | `unknown` `schema-unavailable` | `unknown` `no-evidence` |
| `credentialTime` | `pass` | `unknown` `no-evidence` |
| `credentialStatus` | `not-applicable` `format-defines-no-status` | `unknown` `no-evidence` |
| `evidenceAvailability` | `pass` | `unknown` `referenced-artefact-unavailable` |

`anchorSignature`, `anchorKeyDerivation`, `subjectBinding` and `issuerAuthority` still pass using the anchor alone; authority then covers only the anchoring service, not the claim issuer. The reader above already has `evidenceAvailability` `unknown` for the acceptance record, so that result stays unchanged.

### Supply the expected subject

Take `passportId` from the requested scan, label or request, never the evidence under test. Record its `source`:

| `source` | Meaning |
|---|---|
| `request-context` | The scan, label or request in hand, as in the reader above |
| `established-binding` | A binding you verified before reading this evidence, such as an earlier verified genesis |
| `none` | You took it from the evidence itself; `subjectBinding` reads `unknown` with `subject-not-independent`, because evidence that names its own subject proves nothing about it |

`expected` also accepts `productIdentifier`, `expectedIssuer`, `expectedGenesisOutpoint` and `expectedStateOutpoint`. Every artefact is checked against each supplied value ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3).

### Select the verification policy

| Field | Selects | Check or finding it settles |
|---|---|---|
| `chainTracker` | A header source, or `'scripts only'` to skip header checks | `inclusion` |
| `publisherKeys`, or `publisherPolicy` with its operators' keys (the chain from an index's `GET /publisher-policy`) | Publishers whose countersignature you accept | `publisherSignatures` |
| `authority` | `{ required: true, genesisIssuers, claimIssuers, anchoringServices, acceptanceCustodians }`: the genesis actor keys, claim issuer DIDs, anchor `anchoredBy` keys and acceptance custodians you accept; `verify` answers any role the lists leave open. `{ required: false, reason }` skips the check | `issuerAuthority`; `unknown` for any role a required policy does not list |
| `observers` | Sources asked whether the tip is still the latest state; each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting` | `report.observations.latestState`: `observed`, `superseded`, `conflicting`, or `unknown` with no observer |
| `managedAcceptance` | `{ required: true }` demands an acceptance commitment on every version 2 `TRANSFER` | `linkage`; fails with `acceptance-commitment-absent` for a transfer without one |
| `managedInstruction` | `{ required: true }` demands an instruction commitment on every version 2 `UPDATE` or `RETIRE` after a committed `TRANSFER`, unless a control authority made it | `linkage`; fails with `instruction-commitment-absent` for a state without one |
| `ownerConsent`, `controlAuthorities` | The owner-signed transfer for version 1 states, and the identity keys whose version 2 `UPDATE`, `TRANSFER` or `RETIRE` passes without a control proof, such as a recovery authority | `linkage` |
| `credentialVerifier` | Verifies an external credential's exact bytes and its status, such as `externalCredentialVerifierFor(policy)` from `@bsv/dpp-credentials/exchange` ([external credentials](../interoperability/external-credentials.md)) | `externalCredentialProof` and each credential's part of `schema`, `credentialTime`, `credentialStatus` and `issuerAuthority`, which read `unknown` with `verifier-not-supplied` without it |
| `payloadValidator` | Checks a token state's `payload_public` against the profile it declares; `profilePayloadValidator(ajv)` from `@bsv/dpp-profiles` is one | `schema` for token states |
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
| `verifyChain(txs, options?)` | The lineage; `chainTracker`, `serverIdentityKey`, `managedAcceptance`, `managedInstruction`, `controlAuthorities`, `ownerConsent` | `{ valid, spv, states, error? }`: whether the lineage holds, whether inclusion is proved, and one finding per state |
| `verifyPassportEvidence(evidence, expected, policy?)` | `evidence`, `expected` and `policy` as [above](#what-the-report-takes) | The verification report: sixteen named checks, each `pass`, `fail`, `unknown` or `not-applicable` with a reason |

**Write**

Field 6's controller key names the passport controller and locks each state. Later states carry control linkage, the scalar proving derivation from your identity key ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6).

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
| `signManagedInstruction(claim, signer)` | The holder's request as recorded, and the custodian's signer | The signed instruction record ([managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) section 6) |
| `inspectManagedInstruction(record, { custodians })` | A record, and the custodians the policy names | Its structure, signature, commitment and failures, named apart |
| `bindInstructionToState(record, state)` | The record and the `UPDATE` or `RETIRE` | Every way the state differs from the request, or none |
| `instructionCommitment(record)` | The record | The digest the `UPDATE` or `RETIRE` carries in `authorisationCommitment` |
| `bindAcceptanceToState(record, state)` | The record and the `TRANSFER` state | The mismatches; empty when they agree |

**Claims and anchors**

| Function | Takes | Returns |
|---|---|---|
| `didKeyFromIdentityKey(identityKey)` | A compressed public key | Its `did:key` |
| `identityKeyFromDidKey(did)` | A `did:key` | The compressed public key it names |
| `signingPublicKeyFor(state)`, `signingDidFor(state)` | A state's `actorIdentityKey` and `actorKeyId` | The derived key that verifies the actor signature, and its `did:key`; it differs from the actor's identity key |
| `signLifecycleClaim(claim, signer)` | An unsigned claim with exactly `claimFormat`, `passportId`, `recordId` as `<txid>:<outputIndex>`, `eventType`, `timestamp`, `issuer`, `issuerKeyId`, `profile` and `profile_version` (plus `issuerKeyDid` when the issuer is not a `did:key`, and `evidence` when it carries facets), and the issuer's BRC-100 wallet; [add a claim](add-a-claim.md) explains each field | Signed claim; throws for unknown fields or a signer differing from the issuer's key |
| `verifyLifecycleClaim(claim, { passportId, recordId })` | A signed claim and what it should be about | Its signature and subject findings |
| `lifecycleClaimDigest(claim)` | A signed claim | The digest an anchor commits to |
| `buildAttestationAnchor(metadata, signer)` | All eight metadata fields, as text: `digest` (the claim's digest), `attestationId` (`urn:sha256:` and that digest), the claim's `issuer`, `subject` (its `passportId`), `attestationType` (its `eventType`), `representation` (`LIFECYCLE_REPRESENTATION`), `mediaType` (`LIFECYCLE_MEDIA_TYPE`) and `anchoredBy` (the anchoring service's identity key); and that service's signer | Anchor `LockingScript`; missing field throws `anchor metadata must be text`, another signing key throws `signer does not match anchoredBy` |
| `inspectAttestationAnchor(script)` | An anchor output's script | Its metadata, key derivation and signature findings |

**Signed EPCIS events** (`epcis-event-vc@1`, proposed; [sign an event](../interoperability/epcis.md#sign-an-event))

| Function | Takes | Returns |
|---|---|---|
| `epcisEventHashId(event, context?)` | One EPCIS 2.0.1 event, and the contexts it travels under (the pinned EPCIS context and inline prefix objects) | `{ hashId, preHash }`: the CBV 2.0 Event Hash ID and the string it hashes; throws `EpcisEventHashError` with `code` and `path` for what the profile refuses |
| `epcisEventCredentialKey(identityKey)` | A party's compressed identity key | Its one published credential key, the BRC-42 child under `[1, 'dpp epcis event v1']` with key identifier `credential` |
| `buildEpcisEventCredential({ event, issuer, validFrom, extensionContexts?, credentialStatus? })` | The event, the party's DID and the signing time | The credential before enveloping, its `id` the hash ID; refuses what the hash refuses |
| `signEpcisEventCredential(credential, { kid, signer })` | The credential, the DID URL of the party's credential key and a BRC-100 wallet or `ProtoWallet` | The compact JWS, whose exact bytes are the committed representation |
| `verifyEpcisEventCredential(jws, { checkedAt, resolveKey?, statusVerifier?, eventSchemaValidator?, authorityVerifier? })` | The JWS and the caller's resolvers | Findings for proof, schema, time, status and authority, with the hash ID, the subjects and the digest |
| `epcisEventAnchorMetadata(verification)` | A verification whose proof held | The eight anchor fields but `anchoredBy`: digest, hash ID, issuer, first subject, event type, representation, media type |
| `epcisEventCredentialVerifierFor(options)` | The same resolvers | The `credentialVerifier` the report takes; any other representation is `representation-unsupported` |

**Publisher policy and evidence packages**

| Function | Takes | Returns |
|---|---|---|
| `policySigningPreimage(policy)` | A policy version | The bytes its authorisation signs |
| `policyDigest(policy)` | A signed policy version | The digest the next version names in `supersedes` |
| `verifyPolicyChain(chain, operatorIdentityKeys)` | The chain, oldest first, and each operator's identity key | `{ ok, versions, failure? }`, the same check an index makes at boot |
| `policyInForceAt(chain, at)`, `publisherKeysAt(chain, at, role?)` | The chain and an instant | The version in force then, and the keys it admits |
| `inspectEvidencePackage(manifest, files, { expectedPassportId, expectedSigner })` | A package's manifest and its files by path | Structure, inventory and signature findings; check that `failures` is empty |

Current source is in `packages/dpp-protocol/src`. The [implementation](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/src) and the [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-core/README.md) show pre-rename source. The [fixture guide](../implement/fixture-runner.md) lists source disagreements.

## The standard's schemas

Import byte-for-byte copies of the standard's JSON schemas from `@bsv/dpp-protocol/schemas/*` to validate reports, capability documents and evidence packages without a checkout.

1. Save this complete file as `schema-id.mjs`:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const schema = require('@bsv/dpp-protocol/schemas/verification-report.schema.json')
console.log(schema.$id)
```

2. Run `node schema-id.mjs`. It prints `https://bsv-blockchain.github.io/dpp/contracts/verification-report.schema.json`.

## Limits

| Limit | Consequence |
|---|---|
| No profile schemas in this package | A state's on-chain product data, `payload_public`, is checked against its declared profile only through the policy's `payloadValidator`. Pass `profilePayloadValidator(ajv)` from [the profiles package](dpp-profiles.md#check-a-payload-against-its-profile). |
| No payload validator | `schema` is `unknown` with `schema-unavailable`. Without both `profile` and `profile_version`, it is `unknown` with `profile-undeclared` either way. |
| No registry discovery or claim exchange | No state, anchor or capability document names the registry holding a claim. Ask the passport's publisher ([registry guide](../implement/roles/registry.md#the-minimum-a-registry-serves)). |
| Ring 0 identity | A key identifies a party; only the platform account vouches for its holder. Nothing yet binds it to a legal entity or certifies the party's role ([identity and authority](../learn/identity-and-authority.md)). |

[Known limitations](../operate/limitations.md) collects the other open gaps of the reference services.

## Next

| To | Go to |
|---|---|
| Check a state's product data against its profile | [@bsv/dpp-profiles](dpp-profiles.md) |
| Write passports with these functions | [Build an application](build-an-application.md), step 3 |
| Add a claim to a passport you do not control | [Add a claim](add-a-claim.md) |
| Run an index of your own | [Run an index from source](../operate/README.md), with the runtime built in |
