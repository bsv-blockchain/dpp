# Add a claim as a repairer, certifier or recycler

Repairers, test labs, certifiers, recyclers and other claimants can use this guide to sign a claim about a passport they do not control. Steps 1 and 2 sign and validate the claim and prepare its anchor without storing the claim or broadcasting a transaction. Continue through storage, optional separate anchoring and reader checks to publish a claim readers can find and verify.

A lifecycle claim states something about one passport, such as a repair or recycling, signed with your key. It never spends or changes the passport; its owner takes no part. A registry retains the exact bytes. A small anchor transaction commits to those bytes so readers can check the claim existed unchanged, and an index finds anchors by passport ([words you will meet](../README.md#words-you-will-meet)).

## Before you start

| You need | For | Where it comes from |
|---|---|---|
| Node 22 and the [published packages](README.md), including `@bsv/sdk@2.8.10` | Signing and checking | Exact versions from npm, or local candidate archives for unpublished source |
| Built source checkout | Optional offline exercises | [Get the code](../quick-start.md#get-the-code), then `npm ci` and `npm run build`; run from the checkout root |
| Network access to the hosted index and registry | Step 2 and the hosted reader example | The URLs in those examples |
| The passport identifier | The claim's subject | The product's label or data carrier, never a lookup result |
| An identity key in a BRC-100 wallet | Signing; its `did:key` is your issuer name | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
| A registry that will hold the claim | Readers get the claim from it | The hosted registry, which stores only with its write token ([ask the programme](../start/choose-your-path.md#contact-the-programme)), or your own ([registry guide](../implement/roles/registry.md)) |
| An anchoring service and an index that admits its anchors | The anchor | The hosted registry anchors what it stores. Otherwise your own funded wallet and an index whose `POST /submit` you may use: the hosted index needs its operator's token, and your own runs [@bsv/dpp-overlay](dpp-overlay.md) |

Signing and checking need only the runtime/packages, identifier and signing key. Storage and anchoring need the service arrangements in the last two rows. Nothing before step 3 spends money or stores anything.

Try the optional offline exercises first:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The first ends with a recycler's claim about a retired passport and its anchor, printing `Every sentence above holds.` The second checks the test claim and anchor with six `Holds:` lines. [Sign a claim](../quick-start.md#sign-a-claim) uses that claim's published test key.

## 1. Fill in the claim

Use exactly these fields. `signLifecycleClaim` refuses any other with `unsupported claim field <name>` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 3).

| Field | What to put |
|---|---|
| `claimFormat` | Always `dpp-lifecycle-v1` |
| `passportId` | The passport identifier exactly as the product carries it, at most 512 bytes |
| `recordId` | The outpoint of the passport state the claim is about, written `<txid>:<outputIndex>`: the transaction identifier, a colon and the output index, such as `4566f1de…6331:0`. `signLifecycleClaim` refuses any other spelling. The example below uses the latest state |
| `eventType` | One of `Origin`, `Transfer`, `Transformation` or `Disposition`. A repair is `Transformation` and a recycling `Disposition` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 2) |
| `timestamp` | When the event happened: an ISO date-time with a time zone, such as `2026-10-01T09:30:00Z` |
| `issuer` | Your DID. With a wallet key, `didKeyFromIdentityKey(identityKey)` |
| `issuerKeyId` | A label for the signing role, such as `repair bench 1`, at most 256 bytes. It does not select a key |
| `issuerKeyDid` | Omit it when `issuer` is a `did:key`. Otherwise, the `did:key` of the signing key |
| `profile`, `profile_version` | The product data profile, normally the one the passport's payload declares, such as `battery` and `2` |
| `evidence` | Optional. The references a mapping needs to read the event as more than a metadata change ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 2): for a repair `workDone`, `performedBy` and `performedAt`; for an origin `facility`, `time` and `responsibleParty`; for a transfer `source` and `destination` or a `custodyRecord`; for a disposition `dispositionKind` and, for a process, `outputs`. Each is a reference to a record, such as a document digest, a DID or an outpoint, never a bare flag. Leave it out when you have none; an empty object is refused |

## 2. Sign it, have a registry check it and prepare the anchor

Save this as `add-claim.mjs` and run `node add-claim.mjs` in your project. It signs a repair claim about the latest state, requests hosted registry validation and builds the anchor. It stores no claim and broadcasts no transaction:

```js
import { Beef, PrivateKey, ProtoWallet } from '@bsv/sdk'
import {
  LIFECYCLE_MEDIA_TYPE, LIFECYCLE_REPRESENTATION, buildAttestationAnchor, chainFromBeef, didKeyFromIdentityKey,
  findDppOutputs, inspectAttestationAnchor, lifecycleClaimDigest, signLifecycleClaim, verifyLifecycleClaim,
} from '@bsv/dpp-protocol'

const index = 'https://dpp-overlay.bsvb.net'
const registry = 'https://dpp-resolver.bsvb.net'
// The passport you worked on: take its identifier from the product's label, never from a lookup result.
const passportId = 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'

// Your signing key. A throwaway test key here; in production, your BRC-100 wallet.
const wallet = new ProtoWallet(PrivateKey.fromRandom())
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })

// The state the claim is about: the passport's latest state, and the profile its payload declares.
const lookup = await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })).json()
if (lookup.outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
const merged = Beef.fromBinary(lookup.outputs[0].beef)
for (const output of lookup.outputs.slice(1)) merged.mergeBeef(output.beef)
const tip = chainFromBeef(merged, passportId).at(-1)
const { state, outputIndex } = findDppOutputs(tip)[0]
const payload = JSON.parse(state.payloadPublic)

// 1. Fill in and sign the claim.
const claim = await signLifecycleClaim({
  claimFormat: 'dpp-lifecycle-v1',
  passportId,
  recordId: `${tip.id('hex')}:${outputIndex}`,
  eventType: 'Transformation',
  timestamp: new Date().toISOString(),
  issuer: didKeyFromIdentityKey(identityKey),
  issuerKeyId: 'repair bench 1',
  profile: payload.profile,
  profile_version: payload.profile_version,
  // What was done, by whom and when, each as a reference: here the digest of the job sheet, the bench's DID and the state itself.
  evidence: { workDone: 'sha256:<digest of the job sheet>', performedBy: didKeyFromIdentityKey(identityKey), performedAt: `${tip.id('hex')}:${outputIndex}` },
}, wallet)
console.log('signed by', claim.issuer, 'about state', claim.recordId)
console.log('signature', verifyLifecycleClaim(claim, { passportId }).signature)

// 2. Ask the registry to check it. Validation is open and stores nothing.
const url = new URL('/validate', registry)
url.searchParams.set('subject', passportId)
const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(claim) })
const result = await response.json()
console.log('registry answered', response.status, result.outcome)
for (const check of result.report.checks.filter(({ name }) => ['nativeAttestationSignature', 'subjectBinding', 'credentialTime'].includes(name))) console.log(' ', check.name, check.status)

// 3. Build the anchor an anchoring service sends: its key signs a commitment to the claim's exact bytes. Nothing is sent here.
const anchoringService = new ProtoWallet(PrivateKey.fromRandom())
const { publicKey: anchoredBy } = await anchoringService.getPublicKey({ identityKey: true })
const digest = lifecycleClaimDigest(claim)
const anchor = await buildAttestationAnchor({
  digest,
  attestationId: `urn:sha256:${digest}`,
  issuer: claim.issuer,
  subject: passportId,
  attestationType: claim.eventType,
  representation: LIFECYCLE_REPRESENTATION,
  mediaType: LIFECYCLE_MEDIA_TYPE,
  anchoredBy,
}, anchoringService)
const inspection = inspectAttestationAnchor(anchor)
console.log('anchor signature', inspection.signatureValid, '; key derivation', inspection.keyDerivationValid, '; commits to', inspection.metadata.attestationId.slice(0, 22) + '...')
```

It prints, with your own `did:key` and digest:

```
signed by did:key:zQ3sh... about state 122bb72c201f
signature verified
registry answered 200 verified
  nativeAttestationSignature pass
  subjectBinding pass
  credentialTime pass
anchor signature true ; key derivation true ; commits to urn:sha256:40a5b2499a2...
```

| Output | Meaning and next action |
|---|---|
| `122bb72c201f` | Beginning of the latest state's identifier when this page was written; your `did:key` and digest differ |
| `verified` | Signature only. Also check `subjectBinding` against the passport named in `subject` |
| `subjectBinding fail subject-mismatch` | A different passport's claim can still have a `verified` signature |
| `credentialTime` | Checks that the claim is within its time |
| Other checks: `unknown` | Missing evidence, such as passport history and the anchor, was not sent |
| `issuerAuthority`: `unknown`, `policy-missing` | The registry applies no accepted-issuer list |
| `invalid` | Read `issues`: altered bytes give `native claim signature does not verify`; extra fields give `unsupported claim field <name>` |

Stop on an invalid claim and sign again from unsigned fields. Never edit a signed claim: every byte change breaks its signature and anchor digest.

In production, replace the `ProtoWallet` with your BRC-100 wallet, for example `new WalletClient('auto', '<your application's domain>')` from `@bsv/sdk` ([build an application](build-an-application.md)). `signLifecycleClaim` asks it for one signature under protocol `[1, 'dpp attestation v1']`, with the passport identifier as key identifier.

## 3. Store it

Send the signed claim to the registry you arranged ([registry contract](https://github.com/bsv-blockchain/dpp/blob/b9549475bc008de548ba2368d160dc1ce9ddebb5/contracts/registry.yaml)).

| Request or response | Required content or meaning |
|---|---|
| Request | `POST /attestations`, with the signed claim as its JSON body |
| Hosted authentication | `Authorization: Bearer <token>` using the registry's write token; requests without it are refused |
| Verified claim | `202`, with `attestationId`, `anchored` and `anchorStatus` (`unanchored` or `broadcast`) |
| Native `attestationId` | `urn:sha256:` followed by the claim's digest |
| Same bytes sent twice | `409` `duplicate_attestation`; stores nothing |
| Invalid claim | `422`; stores nothing |
| Read back | `GET /attestations/{attestationId}/proof` returns the claim, exact `securedBytes` and, once anchored, the anchor's outpoint |

A registry that anchors, including the hosted one, builds and broadcasts the anchor itself. Skip step 4 in that case.

## 4. Anchor it, if your registry does not

The anchoring service uses its own BRC-100 wallet and follows the [writer order](build-an-application.md), step 3:

1. Confirm its identity key is `anchoredBy`; otherwise `buildAttestationAnchor` throws.
2. Put the step 2 anchor in a transaction output and build the transaction unsent.
3. Announce with `POST /submit` on topic `tm_attestation`.
4. Send only if the index admits it. Stop before broadcasting if admission is refused.
5. Once mined, push the block proof to `POST /arc-ingest`.

| Index condition | Effect |
|---|---|
| Operator names anchoring services | Only those keys are admitted; configure your index with `ANCHOR_SERVICE_KEYS` |
| No named anchoring services | Any anchoring service is admitted |
| Anchor stored only on your index | Only readers asking that index find it. The hosted index takes records only from its own peer |

## 5. Tell the passport's publisher, and check that readers find it

Tell the passport's publisher, and the readers you expect, which registry holds your claims and what your issuer DID is, because nothing in the passport or the anchor names the registry. A reader accepts your claims only if its policy lists your DID in `claimIssuers`; otherwise it reports `issuerAuthority` as `fail` with `authority-unconfirmed`.

Save this as `find-claims.mjs`; it reads the three anchored claims the hosted reference holds for its version 2 passport under the demonstration prefix 952:

```js
import { Beef } from '@bsv/sdk'
import { inspectAttestationAnchor } from '@bsv/dpp-protocol'

const index = 'https://dpp-overlay.bsvb.net'
const registry = 'https://dpp-resolver.bsvb.net'
const passportId = 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'

// The anchors: any index that holds them finds them by subject (one page here; continue with `after` for more).
const { outputs } = await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_attestation', query: { subject: passportId } }) })).json()
// The claims: only the registry that holds them can list them.
const { items } = await (await fetch(`${registry}/attestations?subject=${encodeURIComponent(passportId)}`)).json()
const held = new Set(items.map(({ attestationId }) => attestationId))

for (const { beef, outputIndex } of outputs) {
  const tx = Beef.fromBinary(beef).txs.at(-1).tx
  const { metadata } = inspectAttestationAnchor(tx.outputs[outputIndex].lockingScript)
  console.log(metadata.attestationType, metadata.issuer.slice(0, 20), held.has(metadata.attestationId) ? 'claim held by this registry' : 'claim not held by this registry')
}
```

`node find-claims.mjs` prints:

```
Transformation did:key:zQ3shueJ69UR claim held by this registry
Transfer did:key:zQ3shueJ69UR claim held by this registry
Origin did:key:zQ3shueJ69UR claim held by this registry
```

For your claim, select your passport, submission index and registry. Run [the full reader](dpp-protocol.md#gather-a-passports-evidence) with your DID in `claimIssuers` and anchoring key in `anchoringServices`. Expect `nativeAttestationSignature`, all three anchor checks and `issuerAuthority` to pass. An anchor without claim bytes leaves six checks `unknown`, listed on that page.

## What is not settled

- **Finding the registry.** No anchor, passport state, capability document or GS1 link names it, so a reader learns it from the passport's publisher, outside the standard.
- **The `recordId` spelling.** The specification calls it the exact state reference without fixing its form.
- **What was done.** A claim carries no payload, only the event's type and time, so it cannot say what was repaired, by whom or where, or hold the evidence a profile's event mapping asks for.
- **Which types exist.** None of the four lifecycle event types is for a test or certification as such. A certifier needing its own vocabulary can issue a W3C credential with [@bsv/dpp-credentials](dpp-credentials.md) instead.
- **Being accepted.** Identity is at Ring 0: your key identifies you, and only the platform account vouches for who holds it. No route yet puts a claimant on readers' lists, and a role such as a notified body for conformity claims would need an identity ring that is not live ([identity and authority](../learn/identity-and-authority.md)).
- **Writing to the hosted services.** Storing on the hosted registry and announcing to the hosted index need tokens the programme holds.

[Known limitations](../operate/limitations.md) lists the reference services' other open gaps.

## Next

| To | Go to |
|---|---|
| Decide between a claim and a passport update | [Passport states and attestations](../learn/passport-and-attestations.md) |
| See how readers decide whom to accept | [Identity and authority](../learn/identity-and-authority.md) |
| Issue a claim as a W3C credential instead | [Verifiable credentials](../learn/verifiable-credentials.md), [external credential verification](../interoperability/external-credentials.md) |
| Hold claims yourself | [Registry](../implement/roles/registry.md) |
| Read the report a reader makes of your claim | [Gather a passport's evidence](dpp-protocol.md#gather-a-passports-evidence) |
