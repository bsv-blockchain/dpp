# Attestation issuer

An issuer signs a lifecycle claim about a product, such as a repair, a test, a certification or a recycling, without touching the passport's control. This page is for an assessment, repair or recycling system adding claim issuance, in its own code or with the packages.

An issuer needs:

- the passport identifier of the product actually assessed, read from the item or the request, not from whichever record a lookup happened to return;
- the event, its time, and the passport's profile and profile version;
- an issuer identity and a key to sign with. A `did:key` made from your identity key is enough today ([BSV DIDs](../../learn/dids.md)). Live identity assurance is Ring 0, where the platform vouches only for the account and brand label, and no higher ring that binds an issuer to a legal entity or certifies its role is live yet ([identity and authority](../../learn/identity-and-authority.md)).

## Sign one claim with the packages

`signLifecycleClaim(unsignedClaim, wallet)` from `@bsv/dpp-core` signs a claim with anything that offers the BRC-100 `createSignature` call: your BRC-100 wallet in an application, or `ProtoWallet` from `@bsv/sdk` in a test. This signs the fixture's claim with its published test key, at the root of a checkout after [setup](../../quick-start.md#get-the-code):

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { signLifecycleClaim, verifyLifecycleClaim } from '@bsv/dpp-core'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const wallet = new ProtoWallet(PrivateKey.fromHex(fixture.issuerPrivateKey))
const signed = await signLifecycleClaim(fixture.unsignedClaim, wallet)
assert.deepEqual(signed, fixture.claim)
assert.equal(verifyLifecycleClaim(signed).signature, 'verified')
console.log('The signed claim matches the fixture.')
JS
```

It prints `The signed claim matches the fixture.` An application supplies its own authorised signing access and never reuses the fixture key.

## Sign one claim in your own code

[Rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) sections 3 and 4 define the claim, and `fixtures/attestation-anchor-v1.json` gives a value to compare at each step:

1. Build the claim with exactly the properties of rules section 3 except `signature`: `claimFormat` (`dpp-lifecycle-v1`), `passportId`, `recordId`, `eventType`, `timestamp`, `issuer`, `issuerKeyId`, `profile`, `profile_version`, and `issuerKeyDid` only when the issuer is not a `did:key`. Compare with `unsignedClaim`.
2. Serialise it as restricted canonical JSON: property names sorted, no whitespace, only string and safe-integer values. Compare with `canonicalUnsignedClaim`.
3. Sign the SHA-256 of those bytes with the BRC-42 child of your identity key for protocol `[1, 'dpp attestation v1']`, key identifier the claim's `passportId`, counterparty `anyone` (invoice number `1-dpp attestation v1-<passportId>`), using a deterministic RFC 6979 nonce. Encode the DER signature as lower-case hex and compare with `claim.signature`; the test private key is `issuerPrivateKey`. A BRC-100 wallet does this as `createSignature` with the canonical bytes as `data`.
4. Add `signature` and serialise the complete claim the same way. Those bytes are the secured representation `dpp-lifecycle-json-v1`: compare with `representationBytes`. Their SHA-256 is `digest`, the value an anchor commits to.

This runs the four steps with only `@bsv/sdk`, a BSV SDK that a second implementation may use, at the root of the checkout:

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

The fixture's values are test values. Do not copy these into a live claim:

- **`recordId`** must be the "exact native state reference" (rules section 3), and its spelling is not settled: the fixture's `state-1` is no live form, and the repository's own examples use two others, the transaction identifier alone in `examples/lifecycle-v2.mjs` and `txid:outputIndex` in `fixtures/battery-lifecycle-v1.json`. Record which form you use.
- **`profile`** names the passport's product data profile and **`profile_version`** its version, such as `battery` and `2` for a `battery@2` passport. The fixture's `generic` is no live profile.
- **The registry identifier** of a native claim is `urn:sha256:` followed by your claim's own `digest` (rules section 6); the fixture anchor's `attestationId` is the fixture claim's.
- **A native claim has no payload**: it carries the event type and time, not what was done, so a mapping that needs evidence facets cannot find them in it.

These are open questions in the standard; [known limitations](../../operate/limitations.md) lists the reference service's limits. An issuer's identity and its authority to make the claim remain separate evidence questions for the verifier.

## Next: store and anchor it

Keep the secured bytes exactly as signed: reformatting or removing content after signing changes the bytes another component verifies or commits to. Then:

1. A registry validates the claim (`POST /validate` is open on the hosted registry) and stores it with `POST /attestations` if you run one or hold its write token ([registry](registry.md)).
2. An anchoring service builds a `bsv-attestation-anchor-v1` output over `digest` with `attestationId` `urn:sha256:<digest>`, and announces and sends it on topic `tm_attestation`, as step 4 of [build an application](../../packages/build-an-application.md#4-sign-and-anchor-a-lifecycle-claim) shows.
3. A [verifier](attestation-verifier.md) checks the claim and its anchor.

When the receiver needs a W3C credential instead, see [external credentials](../../interoperability/external-credentials.md): the packages verify that profile, but they do not issue it.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/attestation-anchor-v1.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open.
