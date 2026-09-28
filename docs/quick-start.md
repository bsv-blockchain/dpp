# Reference quick starts

Run a passport reader, a writer dry run and an attestation issuer locally. The exercises use synthetic fixtures so the first result does not depend on a wallet, an index, a registry or funds. Registry validation is a separate exercise at the end.

## Prepare the checkout

Install Node.js 22 or later and npm. Obtain the [source checkout](packages/README.md#source-access), open a terminal at its root, then run:

```sh
npm ci
npm run build
```

The build creates the package entry points that the examples import. A missing-module error usually means the build has not completed; rerun it and inspect the first build error.

These exercises use the reference packages. [Independent implementers](implement/README.md) build their own predicates from the linked sources and fixtures.

## Reader and verifier

The reader reconstructs a product's recorded history from fixture transactions. It checks signatures and transitions, then reproduces the expected reports, including cases with missing or contradictory evidence.

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

Expect the valid lineage to be accepted, the deliberately invalid cases to be refused and each report case to match its fixture. The command exits non-zero on a mismatch. Inclusion remains pending because these transactions are synthetic. A refusal printed with `ok:` means the negative test behaved as expected.

The lifecycle command shows the steps of a version 2 record history. The attestation command checks the separate signed-claim and anchor path. [Reading the report](learn/evidence-and-freshness.md) explains the status vocabulary and why a passing signature is not a complete verification result.

The [passport example](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/examples/verify-passport.mjs) and [attestation example](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/examples/verify-attestation-anchor.mjs) compare synthetic fixtures with reference results. They do not establish live inclusion, business authority or product truth. The [fixture guide](implement/fixture-runner.md) identifies source gaps.

To read a live passport instead, pass its identifier and an index, for example one of the [hosted reference's passports](deployment.md#the-hosted-reference): `node examples/verify-passport.mjs <passportId> https://dpp-overlay.bsvb.net --report`. The reader then checks every proof against block headers from WhatsOnChain. Anonymous WhatsOnChain access is limited to a few requests a second, so the example asks one question at a time and keeps each answer for the run; set `WOC_API_KEY` to raise the limit. Under Node 26 the SDK prints `ExperimentalWarning: localStorage is not available` when it loads; it is harmless.

## Writer

A writer constructs a signed state before it attempts admission or broadcast. This dry run reproduces a version 1 fixture and demonstrates refusal of an invalid state:

```sh
node examples/write-passport.mjs --dry-run
```

Expect the locking script and transaction to match the fixture, followed by the invalid-state refusal. Network steps are described but not executed. The version 2 lifecycle exercise above is separate from this version 1 writer recipe.

The [writer example](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/examples/write-passport.mjs) describes its live invocation. It talks to a BRC-100 wallet application running on the same machine; [choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) says which wallets satisfy that and what a hosted writer uses instead. The dry run creates and checks synthetic data. Continue with [wallet, broadcast and proofs](operate/wallet-broadcast-proofs.md) for service integration.

## Attestation issuer

An issuer signs a claim about a product without changing the passport's control key. This exercise signs the fixture's unsigned claim with its published test key, compares the complete result and verifies its signature. The key is for synthetic fixtures only.

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

Expect `The signed claim matches the fixture.` An assertion failure means either the secured claim or its signature differs. The output is a signed claim; it has not been stored in a registry or committed to a blockchain transaction.

Sources: [claim API](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-core/src/attestation.ts), [fixture](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/attestation-anchor-v1.json). The [issuer guide](implement/roles/attestation-issuer.md) links the independent exercise.

## Registry validation

A registry can evaluate a claim over HTTP. The request below sends the signed fixture and asks about its fixture subject. It does not start a registry.

Point `REGISTRY_URL` at a registry that serves the [validation contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml#L781-L831): the one you are building from the [registry guide](implement/roles/registry.md), or the hosted demonstration registry at `https://dpp-resolver.bsvb.net`, which answers this request without credentials and stores nothing. The example defaults to `http://localhost:4000`. The DPP checkout does not start a registry and no public reference registry is published; the guide sets out the [minimum to build](implement/roles/registry.md#the-minimum-a-registry-serves).

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
console.log(JSON.stringify(result.report ?? result, null, 2))
JS
```

Expect HTTP 200 and a report with separate checks. Inspect the native signature and subject-binding findings, then the unknown checks and their reasons. Connection refusal means no service is listening at `REGISTRY_URL`; an HTTP error needs inspection of that service response.

This request verifies without storing or anchoring. It supplies no token history or anchor evidence, so the returned report cannot establish those checks. See the [validation contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml#L781-L831) and [registry guide](implement/roles/registry.md) for the next exercise.

## Continue by task

| Task | Guide |
|---|---|
| Start the reference index | [Operate](operate/README.md) |
| Generate a profile | [Author a profile](profiles/authoring.md) |
| Select an exchange format | [Interoperability](interoperability/README.md) |
| Inspect the release gate | [Conformance review](reference/conformance.md) |

Brand self-custody: open. In the reference application the platform controls each brand's identity, so a brand cannot yet update or move it; nothing in the standard requires this.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
