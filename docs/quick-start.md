# Reference quick starts

Use the [pinned checkout](packages/README.md#source-access), then run these commands from its root:

```sh
npm ci
npm run build
```

These exercises use the reference packages. [Independent implementers](implement/README.md) build their own predicates from the linked sources and fixtures.

## Reader and verifier

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The [passport example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/examples/verify-passport.mjs) and [attestation example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/examples/verify-attestation-anchor.mjs) compare synthetic fixtures with reference results. They do not establish live inclusion, business authority or product truth. The [fixture guide](implement/fixture-runner.md) identifies source gaps.

## Writer

```sh
node examples/write-passport.mjs --dry-run
```

The [writer example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/examples/write-passport.mjs) describes wallet configuration and its live invocation. The dry run creates and checks synthetic data. Continue with [wallet, broadcast and proofs](operate/wallet-broadcast-proofs.md) for service integration.

## Attestation issuer

Sign the fixture's unsigned claim with its published test key.

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

Sources: [claim API](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/attestation.ts), [fixture](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/attestation-anchor-v1.json). The [issuer guide](implement/roles/attestation-issuer.md) links the independent exercise.

## Registry validation

Choose a running registry that implements the [validation contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml#L781-L831). Set `REGISTRY_URL` to its base URL; the example defaults to `http://localhost:4000`. The [reference registry](https://github.com/bsv-blockchain-demos/uora-bsv/blob/07236cf753a238ab7ae3f5dd0c12efe236d6e9f1/README.md) is maintained in a separate repository that requires access. An independent registry can use the [local contract and role guide](implement/roles/registry.md). Run the request from the DPP checkout:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(readFileSync('fixtures/attestation-anchor-v1.json', 'utf8'))
const url = new URL('/validate', process.env.REGISTRY_URL ?? 'http://localhost:4000')
url.searchParams.set('subject', fixture.unsignedClaim.passportId)
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fixture.claim),
})
assert.equal(response.status, 200)
const result = await response.json()
console.log(JSON.stringify(result, null, 2))
JS
```

This request verifies without storing or anchoring. It supplies no token history or anchor evidence, so the returned report cannot establish those checks. See the [validation contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml#L781-L831) and [registry guide](implement/roles/registry.md) for the next exercise.

## Continue by task

| Task | Guide |
|---|---|
| Start the reference index | [Operate](operate/README.md) |
| Generate a profile | [Author a profile](profiles/authoring.md) |
| Select an exchange format | [Interoperability](interoperability/README.md) |
| Inspect the release gate | [Conformance review](reference/conformance.md) |

Brand self-custody: open; see [G-28](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L171).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
