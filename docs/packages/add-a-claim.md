# Add a claim as a repairer, certifier or recycler

This page is for a repairer, test lab, certifier, recycler or any other party that wants to attach a signed claim to a passport it does not control. It shows what you need, how to sign the claim, how to have a registry check it, how it is stored and anchored, and how a reader then finds it.

A claim, in full a lifecycle claim, is a signed statement about one passport, such as a repair or a recycling. You sign it with your own key: it does not spend or change the passport, and the passport's owner does not take part. A registry is the service that holds the claim's exact bytes; an anchor is a small transaction that commits to those bytes, so any reader can check that the claim existed unchanged, and an index finds anchors by the passport they concern ([words you will meet](../README.md#words-you-will-meet)).

## Before you start

| You need | For | Where it comes from |
|---|---|---|
| Node 22 and the packages: `npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/sdk@2.8.10` in your project | Signing and checking | npm; name the exact versions, because the `latest` tag is still beta.1 |
| The passport identifier | The claim's subject | The product's label or data carrier, never a lookup result |
| An identity key in a BRC-100 wallet | Signing; its `did:key` is your name as issuer | [Choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |
| A registry that will hold the claim | Readers get the claim from it | The hosted registry stores a claim only with its write token. To ask the programme for one, use the contact route on the Choose your path page (`start/choose-your-path.md`). Otherwise run your own, as the [registry guide](../implement/roles/registry.md) describes |
| An anchoring service and an index that admits its anchors | The anchor | The hosted registry anchors what it stores. Otherwise your own funded wallet and an index whose `POST /submit` you may use: the hosted index's needs its operator's token, and your own index is [@bsv/dpp-overlay-topics](dpp-overlay-topics.md) |

The first three are enough to sign a claim and have it checked; storing and anchoring need the last two. Nothing on this page before step 3 spends money or stores anything.

To try the whole shape offline first, run these at the root of a checkout on `main`, after `npm ci` and `npm run build`:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The first ends with a recycler signing a claim about a retired passport and an anchoring service building its anchor, and prints `Every sentence above holds.` The second checks the repository's test claim and its anchor and prints six lines starting `Holds:`. The quick start's [sign a claim](../quick-start.md#sign-a-claim) signs the same test claim with its published test key.

## 1. Fill in the claim

A claim has exactly these fields, and `signLifecycleClaim` refuses any other with `unsupported claim field <name>` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 3):

| Field | What to put |
|---|---|
| `claimFormat` | Always `dpp-lifecycle-v1` |
| `passportId` | The passport identifier exactly as the product carries it, at most 512 bytes |
| `recordId` | The passport state the claim is about. The specification does not fix its spelling yet; the reference application puts that state's transaction identifier here, 64 hex characters, and the example below uses the passport's latest state. Do not copy the test fixture's `state-1` |
| `eventType` | One of `Origin`, `Transfer`, `Transformation` or `Disposition`. A repair is `Transformation` and a recycling `Disposition` ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 2) |
| `timestamp` | When the event happened: an ISO date-time with a time zone, such as `2026-10-01T09:30:00Z` |
| `issuer` | Your DID. With a wallet key, `didKeyFromIdentityKey(identityKey)` |
| `issuerKeyId` | A label for the signing role, such as `repair bench 1`, at most 256 bytes. It names the role; it does not select a key |
| `issuerKeyDid` | Leave it out when `issuer` is a `did:key`. When `issuer` is another DID, the `did:key` of the key that signs |
| `profile`, `profile_version` | The product data profile, normally the one the passport's payload declares, such as `battery` and `2` |

## 2. Sign it, have a registry check it and prepare the anchor

Save this as `add-claim.mjs` in your project and run `node add-claim.mjs`. It needs network access to the hosted index and registry. It looks up the passport's latest state, signs a repair claim about it with a throwaway key, asks the hosted registry to check it, and builds the anchor an anchoring service would send. Validation is open and stores nothing, and the anchor is not sent:

```js
import { Beef, PrivateKey, ProtoWallet } from '@bsv/sdk'
import {
  LIFECYCLE_MEDIA_TYPE, LIFECYCLE_REPRESENTATION, buildAttestationAnchor, chainFromBeef, didKeyFromIdentityKey,
  findDppOutputs, inspectAttestationAnchor, lifecycleClaimDigest, signLifecycleClaim, verifyLifecycleClaim,
} from '@bsv/dpp-core'

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

`ead4346e0571` begins the identifier of the passport's latest state when this page was written; a later state changes it. `verified` is the registry's outcome for the claim's signature. Its report also says the claim concerns the passport you named in `subject` and is within its time; read `subjectBinding` as well as the outcome, because a claim about another passport is still `verified` but reads `subjectBinding fail subject-mismatch`. The report's other checks need evidence the request did not send, such as the passport's history and the anchor, and read `unknown`; `issuerAuthority` reads `unknown` with `policy-missing` because the registry applies no list of accepted issuers.

If the registry answers `invalid`, its `issues` say why: an altered claim gives `native claim signature does not verify`, and an extra field `unsupported claim field <name>`. Sign again from the unsigned fields; never edit a signed claim, because any change to its bytes breaks the signature and the anchor's digest.

In production, use your BRC-100 wallet in place of the `ProtoWallet`, for example `new WalletClient('auto', '<your application's domain>')` from `@bsv/sdk`, as [build an application](build-an-application.md) shows. `signLifecycleClaim` asks it for one signature under protocol `[1, 'dpp attestation v1']` with the passport identifier as key identifier. Keep the signed claim exactly as returned.

## 3. Store it

Send the same signed claim as the JSON body of `POST /attestations` to the registry that will hold it. On the hosted registry this needs its write token as `Authorization: Bearer <token>`; a request without it is refused. A registry accepts a verified claim with `202`. Its answer carries `attestationId` (for a native claim, `urn:sha256:` followed by the claim's digest), `anchored`, and `anchorStatus`, which is `unanchored` or `broadcast`. The same bytes sent twice answer `409` `duplicate_attestation`, and an invalid claim `422`; neither stores anything ([the registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml)).

Once stored, `GET /attestations/{attestationId}/proof` on that registry returns the claim, its exact bytes as `securedBytes`, and the anchor's outpoint once it is anchored. A registry that anchors, as the hosted one does, builds and broadcasts the anchor itself, and step 4 is done for you.

## 4. Anchor it, if your registry does not

The anchoring service sends the anchor built in step 2 as an output of a transaction from its own BRC-100 wallet, and announces it to an index on topic `tm_attestation`. It follows the same order a writer uses for a passport state: build the transaction unsent, announce it with `POST /submit`, send it only if the index admits it, then push its block proof to the index's `POST /arc-ingest` once mined ([build an application](build-an-application.md), step 3). `anchoredBy` must be that wallet's identity key, or `buildAttestationAnchor` throws.

An index admits anchors only from the anchoring services its operator names, or from any service when it names none. Your own index names them in `ANCHOR_SERVICE_KEYS`; the hosted index's `POST /submit` needs its operator's token. Readers find the anchor only at indexes that hold it, and the hosted index takes records only from its own peer, so an anchor on your own index is found by the readers who ask your index.

## 5. Tell the passport's publisher, and check that readers find it

Nothing in the passport or in the anchor names the registry that holds your claim. Tell the passport's publisher, and the readers you expect, which registry holds your claims and what your issuer DID is. A reader accepts your claims only if its own policy lists your DID in `claimIssuers`; a reader whose list leaves you out reports `issuerAuthority` as `fail` with `authority-unconfirmed`.

A reader finds anchors by asking an index for the passport's subject, and the claims by asking the registry. Save this as `find-claims.mjs`; it reads the three anchored claims the hosted reference holds for its version 2 passport:

```js
import { Beef } from '@bsv/sdk'
import { inspectAttestationAnchor } from '@bsv/dpp-core'

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

For your own claim, use your passport, the index you announced to and the registry that holds it. Then run the full reader in [gather a passport's evidence](dpp-core.md#gather-a-passports-evidence) with your DID in `claimIssuers` and your anchoring service's key in `anchoringServices`: `nativeAttestationSignature`, the three anchor checks and `issuerAuthority` should pass. A reader that finds your anchor but not your claim gets six checks `unknown`, as that page lists.

## What is not settled

- **Finding the registry.** No anchor, passport state, capability document or GS1 link names the registry that holds a claim, so a reader learns it from the passport's publisher, outside the standard.
- **The `recordId` spelling.** The specification calls it the exact state reference without fixing its form; until it does, use the state's transaction identifier, as the reference application does.
- **What was done.** A claim carries no payload, so it cannot say what was repaired, by whom or where; it records the event's type and time only. The evidence a profile's event mapping asks for, such as the work done in a repair, has no place in a claim yet.
- **Which types exist.** The four event types classify lifecycle events; there is no type for a test or certification as such. A certifier whose statement needs its own vocabulary can issue a W3C credential with [@bsv/vsc](vsc.md) instead.
- **Being accepted.** Identity is at Ring 0: your key identifies you, and only the platform account vouches for who holds it. No route yet puts a claimant on readers' lists, and a role such as a notified body for conformity claims would need an identity ring that is not live ([identity and authority](../learn/identity-and-authority.md)).
- **The identifier form in the test data.** The repository's anchor fixture uses a `urn:uuid:` identifier for its native claim; for your own, follow the specification's `urn:sha256:` and the digest.
- **Writing to the hosted services.** Storing on the hosted registry and announcing to the hosted index need tokens the programme holds.

[Known limitations](../operate/limitations.md) collects the other open gaps of the reference services.

## Next

| To | Go to |
|---|---|
| Decide between a claim and a passport update | [Passport states and attestations](../learn/passport-and-attestations.md) |
| See how readers decide whom to accept | [Identity and authority](../learn/identity-and-authority.md) |
| Issue a claim as a W3C credential instead | [Verifiable credentials](../learn/verifiable-credentials.md), [external credential verification](../interoperability/external-credentials.md) |
| Hold claims yourself | [Registry](../implement/roles/registry.md) |
| Read the report a reader makes of your claim | [Gather a passport's evidence](dpp-core.md#gather-a-passports-evidence) |
