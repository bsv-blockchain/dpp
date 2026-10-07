# Quick start

Five short exercises, from reading a live passport to asking a registry to check a claim. You need Node.js 22 or later, npm and git. Nothing here needs a wallet or spends money.

## Get the code

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
npm ci
npm run build
```

The examples live in the repository and use the packages it builds. A `Cannot find module` error means the build did not finish: run `npm run build` again and read its first error.

**How to read the output.** Every check prints one sentence. A line starting `ok:` or `Holds:` is a check that held, including where a deliberately broken input is refused, as it should be. A line starting `FAIL:` or `FAILS:` means something is wrong, and the command then exits with a non-zero status.

## Read a live passport

```sh
node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/7AC18477503A https://dpp-overlay.bsvb.net
```

You should see:

```
The index returned 5 outputs; merged, their BEEFs reconstruct a chain of 5 states.
Operations, genesis to tip: ACTIVATE -> REPAIRED -> TRANSFER -> TRANSFER -> TRANSFER.
State 1 (ACTIVATE, 173015313489): user signature verifies; linkage holds; inclusion verified.
...
The chain as a whole is valid.
Inclusion across the chain: verified.
```

The script asked the [hosted index](deployment.md#the-hosted-reference) for the passport's five states, rebuilt the history and checked every signature, every link and every block proof itself. The index only found the bytes; the script trusted nothing it said about them, though it relies on the index to return the newest state. Add `--report` to see the full report, one line per check, and [reading the report](learn/evidence-and-freshness.md) explains each answer.

If a state says `inclusion pending`, WhatsOnChain limited the header check: run the command again, or set `WOC_API_KEY` to a WhatsOnChain API key. Under Node 26 you may see `ExperimentalWarning: localStorage is not available`; it is harmless.

This passport is an older record version 1 lineage under GS1's own example number on `id.gs1.org`. New passports are record version 2, with the operations `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE`, minted under a host the writer controls ([identifiers](identifiers.md)).

## Check the test passports offline

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

These use test data in the repository and no network. The first checks a five-state passport and every refusal case the test data defines; the second walks a whole lifecycle, from issue through a transfer to retirement; the third checks a signed claim and its anchor. No line should start with `FAIL:` or `FAILS:`, and each command should end without an error. Inclusion says pending, because the test transactions are not on chain.

## Write a passport without spending anything

```sh
node examples/write-passport.mjs --dry-run
```

It builds a passport's first state, shows that it matches the test data byte for byte, shows an invalid state refused before anything would be sent, then prints what it would announce, send and keep. To write for real you need a BRC-100 wallet and your own index; [build an application](packages/build-an-application.md) takes you there step by step, and [choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) says which wallets work.

## Sign a claim

A claim is a signed statement about a product, such as a repair. This signs the test claim with its published test key and checks the result:

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

You should see `The signed claim matches the fixture.` The claim is signed but not yet stored or anchored; the [issuer guide](implement/roles/attestation-issuer.md) covers the rest.

## Ask a registry to check the claim

The hosted registry checks a claim without credentials and stores nothing:

```sh
REGISTRY_URL=https://dpp-resolver.bsvb.net node --input-type=module <<'JS'
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

You should see HTTP 200 and a report in which the claim's signature, subject, validity period and evidence pass, and every check that needs evidence this request did not send, such as the passport's history, says `unknown` with the reason. Point `REGISTRY_URL` at your own registry once you run one; the [registry guide](implement/roles/registry.md) says what it must serve.

## What next

| Next | Page |
|---|---|
| Build an application that issues and updates passports | [Build an application](packages/build-an-application.md) |
| Run your own index | [Operate](operate/README.md) |
| Choose the product data a passport carries | [Industry profiles](profiles/README.md) |
| Write your own implementation instead of using the packages | [Implementer start](implement/README.md) |

These exercises check signatures, history and block proofs. They do not show that a product is what its record says, that an issuer is accredited, or who holds the product today; [evidence and its limits](learn/evidence-and-freshness.md) explains why. Nobody checks a brand's legal identity yet: the platform that hosts an account vouches for it and its brand name, the level these pages call Ring 0 ([identity and authority](learn/identity-and-authority.md)).
