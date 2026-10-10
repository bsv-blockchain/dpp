# Quick start

Verify a version 2 test passport and understand its report before using a live service. The first exercise needs no wallet, service token or blockchain transaction. The later exercises are optional: a version 2 writer dry run, a historical live read and native claim validation.

You need Node.js 22 or later, npm and git. Downloading and building the checkout needs internet access; the fixture and dry-run commands then work offline. Live reading and hosted validation need internet access but do not store claims or spend funds.

## Get the code

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git switch --detach
git rev-parse HEAD
npm ci
npm run build
```

These commands detach the current source checkout and print its exact revision. Keep that revision with your lockfile and test results so you can reproduce the run. The examples use the packages that checkout builds, including the candidate rename to `@bsv/dpp-protocol`; the new name is not yet published to npm. Use [source access](packages/README.md#source-access) for a published release's recorded revision. A `Cannot find module` error means the build did not finish: run `npm run build` again and read its first error.

**How to read the output.** Every check prints one sentence. A line starting `ok:` or `Holds:` is a check that held, including where a deliberately broken input is refused, as it should be. A line starting `FAIL:` or `FAILS:` means something is wrong, and the command then exits with a non-zero status.

## Check the test passports offline

Run the first exercise:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

It checks a five-state version 2 passport and the refusal cases in the fixture, then prints the verification report. A successful run has no `FAIL:` or `FAILS:` lines and exits with status 0. The transactions are not on chain, so inclusion is pending or `unknown`; that is expected missing evidence, not a failed signature check. [Read the report](learn/evidence-and-freshness.md) to distinguish `pass`, `fail`, `unknown` and `not-applicable`.

You have completed the first exercise when you can explain the signature and linkage results and why inclusion is not established. No hosted service is required. If a command fails before printing checks, confirm Node 22 or later and the completed build. An unexpected failed check needs investigation; do not turn it into a success by ignoring the exit status.

For a complete lifecycle and a separate claim anchor, continue with these optional offline exercises:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The first walks from issue through a transfer to retirement; the second checks a signed claim and its anchor. Both use repository fixtures and no network, and should finish without `FAIL:` or `FAILS:` lines. A claim has its own anchor and does not change the passport's spend history.

## Write a passport without spending anything

Use the version 2 writer that the application guide uses:

```sh
node examples/write-passport-v2.mjs --dry-run
```

It constructs and checks the issue/update workflow without a wallet, funds or network. It exercises the writer's operation journal and refusal handling; a successful run exits with status 0. The [writer guide](packages/build-an-application.md#run-the-dry-run) explains the expected output and the later live-write prerequisites.

The historical version 1 dry run remains available for compatibility work:

```sh
node examples/write-passport.mjs --dry-run
```

That example matches the first state to its fixture byte for byte, refuses an invalid state before sending and shows what it would announce, send and retain. Use version 2 for new passports.

To write live, first arrange authorised signing, a funded BRC-100 wallet and an index that admits your publisher key and grants submission/proof access. [Build an application](packages/build-an-application.md) supplies the own-index route, and [choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) explains the supported wallets. A live run is a separate step and spends funds; do not remove `--dry-run` until those prerequisites and authority are established.

## Read a live passport

This optional network exercise reads an existing version 1 passport for compatibility. It is not the template for a new version 2 write.

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

## Sign a claim

A native lifecycle claim is a signed statement about a product, such as a repair. These core helpers do not require the VSC package. This signs the test claim with its published test key and checks the result:

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

Return to [Build or integrate](start/build-and-integrate.md) to choose your next feature. To plan a complete service, use [Plan your platform](start/plan-your-platform.md) and [Prepare for production](operate/production-readiness.md).

| Next | Page |
|---|---|
| Build an application that issues and updates passports | [Build an application](packages/build-an-application.md) |
| Run your own index | [Create an index](packages/create-dpp-index.md) |
| Choose the product data a passport carries | [Industry profiles](profiles/README.md) |
| Write your own implementation instead of using the packages | [Implementer start](implement/README.md) |

These exercises check signatures, history and block proofs. They do not show that a product is what its record says, that an issuer is accredited, or who holds the product today; [evidence and its limits](learn/evidence-and-freshness.md) explains why. Nobody checks a brand's legal identity yet: the platform that hosts an account vouches for it and its brand name, the level these pages call Ring 0 ([identity and authority](learn/identity-and-authority.md)).
