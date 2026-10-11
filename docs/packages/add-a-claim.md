# Add a claim as a repairer, certifier or recycler

Attach a signed claim to a passport you do not control, as a repairer, test lab, certifier, recycler or anyone else.

A claim, in full a lifecycle claim, is a statement about one passport, such as a repair or a recycling, signed with your own key. It neither spends nor changes the passport, and the owner takes no part. A registry holds the claim's exact bytes. An anchor, a small transaction committing to them, lets any reader check the claim existed unchanged, and an index finds anchors by passport ([words you will meet](../README.md#words-you-will-meet)).

## Before you start

| You need | For | Where it comes from |
|---|---|---|
| Node 22 and the [renamed candidate packages](README.md#use-the-renamed-source-candidate), including `@bsv/sdk@2.8.10` | Signing and checking | Local candidate archives; publication is pending |
| The passport identifier | The claim's subject | The product's label or data carrier, never a lookup result |
| An identity key in a BRC-100 wallet | Signing; its `did:key` is your issuer name | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
| A registry that will hold the claim | Readers get the claim from it | The hosted registry, which stores only with its write token ([ask the programme](../start/choose-your-path.md#contact-the-programme)), or your own ([registry guide](../implement/roles/registry.md)) |
| An anchoring service and an index that admits its anchors | The anchor | The hosted registry anchors what it stores. Otherwise your own funded wallet and an index whose `POST /submit` you may use: the hosted index's needs its operator's token, and your own runs [@bsv/dpp-overlay-topics](dpp-overlay-topics.md) |

The first three are enough to sign and check a claim; storing and anchoring need the last two. Nothing before step 3 spends money or stores anything.

To try it offline first, run these at the root of the [source checkout](../quick-start.md#get-the-code), after `npm ci` and `npm run build`:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The first ends with a recycler's claim about a retired passport and its anchor, and prints `Every sentence above holds.` The second checks the repository's test claim and anchor and prints six lines starting `Holds:`; the quick start's [sign a claim](../quick-start.md#sign-a-claim) signs that claim with its published test key.

## 1. Fill in the claim

Use exactly these fields. `signLifecycleClaim` refuses any other with `unsupported claim field <name>` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 3).

| Field | What to put |
|---|---|
| `claimFormat` | Always `dpp-lifecycle-v1` |
| `passportId` | The passport identifier exactly as the product carries it, at most 512 bytes |
| `recordId` | The passport state the claim is about. Until the specification fixes the spelling, use that state's transaction identifier, 64 hex characters, as the reference application does. The example below uses the latest state. Do not copy the test fixture's `state-1` |
| `eventType` | One of `Origin`, `Transfer`, `Transformation` or `Disposition`. A repair is `Transformation` and a recycling `Disposition` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 2) |
| `timestamp` | When the event happened: an ISO date-time with a time zone, such as `2026-10-01T09:30:00Z` |
| `issuer` | Your DID. With a wallet key, `didKeyFromIdentityKey(identityKey)` |
| `issuerKeyId` | A label for the signing role, such as `repair bench 1`, at most 256 bytes. It does not select a key |
| `issuerKeyDid` | Omit it when `issuer` is a `did:key`. Otherwise, the `did:key` of the signing key |
| `profile`, `profile_version` | The product data profile, normally the one the passport's payload declares, such as `battery` and `2` |

## 2. Sign it, have a registry check it and prepare the anchor

Save this as `add-claim.mjs` in your project and run `node add-claim.mjs`, with network access to the hosted index and registry. It signs a repair claim about the passport's latest state, has the hosted registry check it and builds its anchor, storing and sending nothing:

```js
import { Beef, PrivateKey, ProtoWallet } from '@bsv/sdk'
import {
  LIFECYCLE_MEDIA_TYPE, LIFECYCLE_REPRESENTATION, buildAttestationAnchor, chainFromBeef, didKeyFromIdentityKey,
  findDppOutputs, inspectAttestationAnchor, lifecycleClaimDigest, signLifecycleClaim, verifyLifecycleClaim,
} from '@bsv/dpp-protocol'

const index = 'https://dpp-overlay.bsvb.net'
const registry = 'https://dpp-resolver.bsvb.net'
// The passport you worked on: take its identifier from the product's label, never from a lookup result.
const passportId = 'https://id.gs1.org/01/09506000134352/21/345A8EAF501F'

// Your signing key. A throwaway test key here; in production, your BRC-100 wallet.
const wallet = new ProtoWallet(PrivateKey.fromRandom())
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })

// The state the claim is about: the passport's latest state, and the profile its payload declares.
const lookup = await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })).json()
if (lookup.outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
const merged = Beef.fromBinary(lookup.outputs[0].beef)
for (const output of lookup.outputs.slice(1)) merged.mergeBeef(output.beef)
const tip = chainFromBeef(merged, passportId).at(-1)
const payload = JSON.parse(findDppOutputs(tip)[0].state.payloadPublic)

// 1. Fill in and sign the claim.
const claim = await signLifecycleClaim({
  claimFormat: 'dpp-lifecycle-v1',
  passportId,
  recordId: tip.id('hex'),
  eventType: 'Transformation',
  timestamp: new Date().toISOString(),
  issuer: didKeyFromIdentityKey(identityKey),
  issuerKeyId: 'repair bench 1',
  profile: payload.profile,
  profile_version: payload.profile_version,
}, wallet)
console.log('signed by', claim.issuer, 'about state', claim.recordId.slice(0, 12))
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
signed by did:key:zQ3sh... about state ead4346e0571
signature verified
registry answered 200 verified
  nativeAttestationSignature pass
  subjectBinding pass
  credentialTime pass
anchor signature true ; key derivation true ; commits to urn:sha256:40a5b2499a2...
```

`ead4346e0571` began the latest state's identifier when this page was written. `verified` covers the signature only, so also read `subjectBinding`, which checks the claim concerns the passport named in `subject`: a claim about another passport is still `verified` but reads `subjectBinding fail subject-mismatch`. `credentialTime` checks the claim is within its time. Other checks read `unknown`, as they need evidence the request did not send, such as the passport's history and the anchor. `issuerAuthority` reads `unknown` with `policy-missing` because the registry applies no list of accepted issuers.

If the registry answers `invalid`, its `issues` say why: an altered claim gives `native claim signature does not verify`, and an extra field `unsupported claim field <name>`. Sign again from the unsigned fields. Never edit a signed claim: any change to its bytes breaks the signature and the anchor's digest.

In production, replace the `ProtoWallet` with your BRC-100 wallet, for example `new WalletClient('auto', '<your application's domain>')` from `@bsv/sdk` ([build an application](build-an-application.md)). `signLifecycleClaim` asks it for one signature under protocol `[1, 'dpp attestation v1']`, with the passport identifier as key identifier.

## 3. Store it

Send the signed claim as the JSON body of `POST /attestations` to the registry that will hold it. The hosted registry refuses a request without its write token as `Authorization: Bearer <token>`. A verified claim gets `202`, with `attestationId` (for a native claim, `urn:sha256:` followed by the claim's digest), `anchored` and `anchorStatus` (`unanchored` or `broadcast`). The same bytes sent twice answer `409` `duplicate_attestation`, and an invalid claim `422`; neither stores anything ([the registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml)).

`GET /attestations/{attestationId}/proof` on that registry then returns the claim, its exact bytes as `securedBytes`, and, once anchored, the anchor's outpoint. A registry that anchors, as the hosted one does, builds and broadcasts the anchor itself, so you skip step 4.

## 4. Anchor it, if your registry does not

The anchoring service puts the step 2 anchor in an output of a transaction from its own BRC-100 wallet, whose identity key must be `anchoredBy` or `buildAttestationAnchor` throws. It follows a writer's order for a passport state ([build an application](build-an-application.md), step 3): build the transaction unsent, announce it to an index on topic `tm_attestation` with `POST /submit`, send it only if the index admits it, then push its block proof to the index's `POST /arc-ingest` once mined.

An index admits anchors only from the anchoring services its operator names, or from any when it names none; your own index lists them in `ANCHOR_SERVICE_KEYS`. Readers find an anchor only at indexes that hold it, and the hosted index takes records only from its own peer, so only readers who ask your index find an anchor on it.

## 5. Tell the passport's publisher, and check that readers find it

Tell the passport's publisher, and the readers you expect, which registry holds your claims and what your issuer DID is, because nothing in the passport or the anchor names the registry. A reader accepts your claims only if its policy lists your DID in `claimIssuers`; otherwise it reports `issuerAuthority` as `fail` with `authority-unconfirmed`.

Save this as `find-claims.mjs`; it reads the three anchored claims the hosted reference holds for its version 2 passport:

```js
import { Beef } from '@bsv/sdk'
import { inspectAttestationAnchor } from '@bsv/dpp-protocol'

const index = 'https://dpp-overlay.bsvb.net'
const registry = 'https://dpp-resolver.bsvb.net'
const passportId = 'https://id.gs1.org/01/09506000134352/21/345A8EAF501F'

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
Transformation did:key:zQ3shnfXGt4r claim held by this registry
Transfer did:key:zQ3shnfXGt4r claim held by this registry
Origin did:key:zQ3shnfXGt4r claim held by this registry
```

For your own claim, use your passport, the index you announced to and your registry. Then run the full reader in [gather a passport's evidence](dpp-protocol.md#gather-a-passports-evidence) with your DID in `claimIssuers` and your anchoring service's key in `anchoringServices`: `nativeAttestationSignature`, the three anchor checks and `issuerAuthority` should pass. If it finds your anchor but not your claim, six checks read `unknown`, as that page lists.

## What is not settled

- **Finding the registry.** No anchor, passport state, capability document or GS1 link names it, so a reader learns it from the passport's publisher, outside the standard.
- **The `recordId` spelling.** The specification calls it the exact state reference without fixing its form.
- **What was done.** A claim carries no payload, only the event's type and time, so it cannot say what was repaired, by whom or where, or hold the evidence a profile's event mapping asks for.
- **Which types exist.** None of the four lifecycle event types is for a test or certification as such. A certifier needing its own vocabulary can issue a W3C credential with [@bsv/vsc](vsc.md) instead.
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
