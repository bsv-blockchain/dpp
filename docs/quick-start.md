# Quick start

Developers and evaluators can verify a version 2 test passport here and learn to explain its report before using a live service. Start with the offline fixture, then optionally try a version 2 writer dry run, a historical live read and native claim validation.

## Before you start

| Exercise | Requirements and source |
|---|---|
| All exercises | Node.js 22 or later, npm and git. Download and build the checkout below with internet access |
| Offline fixture and dry runs | The completed build; no wallet, service token, funds, network or blockchain transaction |
| Live read and hosted validation | Internet access to the services named below. These exercises store no claims and spend no funds |
| Later live writing | Authorised signing, a funded BRC-100 wallet and an index that admits your publisher key and grants submission/proof access. [Build an application](packages/build-an-application.md) provides the own-index route; [choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) lists supported wallets |

Do not remove `--dry-run` until the live-write prerequisites and authority are established. A live run is a separate step and spends funds.

## Get the code

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git switch --detach
git rev-parse HEAD
npm ci
npm run build
```

The commands detach the current source checkout and print its exact revision. Retain it with the lockfile and test results. The examples use the checkout's builds of `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/dpp-overlay` and `@bsv/dpp-credentials`, their published names. [Source access](packages/README.md#source-access) gives each published release's recorded revision. For `Cannot find module`, the build did not finish: rerun `npm run build` and read its first error.

**How to read the output.** Every check prints one sentence.

| Output | Meaning |
|---|---|
| `ok:` or `Holds:` | The check held, including the expected refusal of a deliberately broken input |
| Failure and exit status | A line starting `FAIL:` or `FAILS:` means something is wrong, and the command then exits with a non-zero status. |

## Check the test passports offline

1. Run the first exercise from the checkout root:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

2. Check the result: a five-state version 2 passport, fixture refusal cases and a verification report. Success has no `FAIL:` or `FAILS:` lines and exits with status 0.
3. Explain the signature and linkage results, and why inclusion remains pending or `unknown`: the transactions are not on chain. This is missing evidence, not a failed signature check. [Read the report](learn/evidence-and-freshness.md) for `pass`, `fail`, `unknown` and `not-applicable`.

Stop on an unexpected failed check; never ignore the exit status. If the command fails before printing checks, confirm the runtime and build requirements above. No hosted service is required.

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

## Read a live passport

This optional network exercise reads a live record version 2 passport under the demonstration prefix 952: issued, repaired and then transferred under managed custody.

```sh
node examples/verify-passport.mjs https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180 https://dpp-overlay.bsvb.net
```

You should see:

```
The index returned 3 outputs; merged, their BEEFs reconstruct a chain of 3 states.
Operations, genesis to tip: ISSUE -> UPDATE -> TRANSFER.
State 1 (ISSUE, debfc9c9125a): user signature verifies; linkage holds; inclusion verified.
...
The chain as a whole is valid.
Inclusion across the chain: verified.
```

| Result or limit | Meaning and action |
|---|---|
| Verified history | The script obtains three states from the [hosted index](deployment.md#the-hosted-reference), rebuilds the history and checks every signature, link and block proof itself. It trusts none of the index's assertions about the bytes |
| Freshness | The script relies on the index to return the newest state |
| Full report | Add `--report` for one line per check; [reading the report](learn/evidence-and-freshness.md) explains the answers |
| `inclusion pending` | WhatsOnChain limited the header check. Retry, or set `WOC_API_KEY` to a WhatsOnChain API key |
| Node 26 warning | `ExperimentalWarning: localStorage is not available` is harmless |

This passport is record version 2, whose operations are `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE`, and its identifier is minted under `dpp.bsvb.net`, a host that resolves it, as a writer's own host should ([identifiers](identifiers.md)). Older version 1 lineages under GS1's documentation example number on `id.gs1.org` are listed as [legacy identifiers](deployment.md#legacy-identifiers), for testing a reader against historical records.

## Sign a claim

A native lifecycle claim is a signed statement about a product, such as a repair. Run this to sign and check the test claim with its published test key. The core helpers need no VSC package:

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

These exercises check signatures, history and block proofs. They establish neither the truth of product records, issuer accreditation nor today's holder ([evidence and its limits](learn/evidence-and-freshness.md)). Nobody checks a brand's legal identity yet. The hosting platform vouches for the account and brand name, the level called Ring 0 ([identity and authority](learn/identity-and-authority.md)).
