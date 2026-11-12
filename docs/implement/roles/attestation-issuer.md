# Attestation issuer

Assessment, repair and recycling systems can use this guide to act as an attestation issuer, or claim issuer. Sign a product's repair, test, certification or recycling claim with the packages or your own code, then prepare its bytes for storage and anchoring without changing passport control.

## Prerequisites and signing inputs

| Input or exercise | Requirement and source |
|---|---|
| Passport identifier | Read it from the assessed item or the request, not whichever record a lookup returned. |
| Claim details | The event and its time from the assessment; profile and profile version from the passport. |
| Issuer and signing key | Your issuer identity and authorised signing access. A `did:key` made from your identity key is enough today ([BSV DIDs](../../learn/dids.md)). |
| Both fixture exercises | Node.js 22 or later, npm and git; complete [setup](../../quick-start.md#get-the-code), including `npm ci` and `npm run build`, then work from the checkout root. Inputs and published test keys come from `fixtures/attestation-anchor-v1.json`. |
| Live signing | Your application's BRC-100 wallet or other authorised signing access. Never reuse the fixture key. |

Live identity assurance is Ring 0: the platform vouches only for the account and brand label. No higher ring binding an issuer to a legal entity or certifying its role is live ([identity and authority](../../learn/identity-and-authority.md)).

## Sign one claim with the packages

`signLifecycleClaim(unsignedClaim, wallet)` from `@bsv/dpp-protocol` needs BRC-100 `createSignature`: use your application's wallet or, for tests, `ProtoWallet` from `@bsv/sdk`. Sign the fixture claim:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { signLifecycleClaim, verifyLifecycleClaim } from '@bsv/dpp-protocol'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const wallet = new ProtoWallet(PrivateKey.fromHex(fixture.issuerPrivateKey))
const signed = await signLifecycleClaim(fixture.unsignedClaim, wallet)
assert.deepEqual(signed, fixture.claim)
assert.equal(verifyLifecycleClaim(signed).signature, 'verified')
console.log('The signed claim matches the fixture.')
JS
```

Expect `The signed claim matches the fixture.` Stop if either assertion fails.

## Sign one claim in your own code

[Rules](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/rules.md) sections 3 and 4 define the claim, and `fixtures/attestation-anchor-v1.json` gives a value to compare at each step:

| Field | Source or rule | Fixture comparison |
|---|---|---|
| `claimFormat` | `dpp-lifecycle-v1` | `unsignedClaim` |
| `passportId`, `recordId` | Expected passport identifier and the assessed state's outpoint | `unsignedClaim` |
| `eventType`, `timestamp` | The assessment's event and time | `unsignedClaim` |
| `issuer`, `issuerKeyId` | Issuer identity and signing-key identifier | `unsignedClaim` |
| `profile`, `profile_version` | The passport's declared product profile | `unsignedClaim` |
| `issuerKeyDid` | Include only when the issuer is not a `did:key` | Rules section 3 |

1. Build the claim with exactly the properties of rules section 3 except `signature`, using the table. Compare with `unsignedClaim`.
2. Serialise it as restricted canonical JSON: property names sorted, no whitespace, only string and safe-integer values. Compare with `canonicalUnsignedClaim`.
3. Sign the SHA-256 of those bytes with the BRC-42 child of your identity key for protocol `[1, 'dpp attestation v1']`, key identifier the claim's `passportId`, counterparty `anyone` (invoice number `1-dpp attestation v1-<passportId>`), using a deterministic RFC 6979 nonce. Encode the DER signature as lower-case hex and compare with `claim.signature`; the test private key is `issuerPrivateKey`. A BRC-100 wallet does this as `createSignature` with the canonical bytes as `data`.
4. Add `signature` and serialise the complete claim the same way. Those bytes are the secured representation `dpp-lifecycle-json-v1`: compare with `representationBytes`. Their SHA-256 is `digest`, the value an anchor commits to.

Run all four steps using only `@bsv/sdk`, a BSV SDK permitted for a second implementation:

```sh
node --input-type=module <<'JS'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrivateKey } from '@bsv/sdk'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const canonical = (claim) => '{' + Object.keys(claim).sort().map((key) => {
  const value = claim[key]
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) throw new Error(`${key} is not a string or a safe integer`)
  return `${JSON.stringify(key)}:${typeof value === 'string' ? JSON.stringify(value) : value}`
}).join(',') + '}'
const unsigned = canonical(fixture.unsignedClaim)
console.log('step 2', unsigned === fixture.canonicalUnsignedClaim)
const anyone = new PrivateKey(1).toPublicKey()
const child = PrivateKey.fromHex(fixture.issuerPrivateKey).deriveChild(anyone, `1-dpp attestation v1-${fixture.unsignedClaim.passportId}`)
const signature = child.sign(Array.from(new TextEncoder().encode(unsigned))).toDER('hex')
console.log('step 3', signature === fixture.claim.signature)
const secured = canonical({ ...fixture.unsignedClaim, signature })
console.log('step 4', secured === fixture.representationBytes, createHash('sha256').update(secured).digest('hex') === fixture.digest)
JS
```

It prints `step 2 true`, `step 3 true` and `step 4 true true`. `child.sign` hashes its input with SHA-256 before signing. The claim's property names are all ASCII, so the default sort gives the canonical order.

## Fields for a live claim

The fixture's values are test values. Replace them for a live claim:

| Field | Live value and limit | Fixture value |
|---|---|---|
| `recordId` | State outpoint, `<txid>:<outputIndex>` (rules section 3). Any other spelling is refused. | Genesis of `fixtures/chain-v1.json` |
| `profile`, `profile_version` | Product profile and version, such as `battery` and `2` for `battery@2` | `general@2` |
| Registry identifier | `urn:sha256:` followed by your claim's own `digest` (rules section 6) | The anchor's `attestationId` identifies the fixture claim. |
| No `evidence` | A claim carries the event type and time, not what was done: rules section 3 names no evidence property, and `signLifecycleClaim` refuses one. A mapping needing the facets of rules section 2 reads them from other evidence, such as a state's `event_data`. | The fixture claim carries none. |

These are open questions in the standard; [known limitations](../../operate/limitations.md) lists the reference service's limits. An issuer's identity and its authority to make the claim remain separate evidence questions for the verifier.

## Next: store and anchor it

Keep the secured bytes exactly as signed. Reformatting or removing content changes the bytes another component verifies or commits to. Then:

1. A registry validates the claim (`POST /validate` is open on the hosted registry) and stores it with `POST /attestations` if you run one or hold its write token ([registry](registry.md)).
2. An anchoring service builds a `bsv-attestation-anchor-v1` output over `digest` with `attestationId` `urn:sha256:<digest>`, and announces and sends it on topic `tm_attestation`, as step 4 of [build an application](../../packages/build-an-application.md#4-sign-and-anchor-a-lifecycle-claim) shows.
3. A [verifier](attestation-verifier.md) checks the claim and its anchor.

When the receiver needs a W3C credential instead, see [external credentials](../../interoperability/external-credentials.md): the packages verify that profile, but they do not issue it.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/fixtures/attestation-anchor-v1.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open.
