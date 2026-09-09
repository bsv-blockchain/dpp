# @bsv/dpp-core

**Experimental prerelease:** `@bsv/dpp-core` 0.3.0-beta.1 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

After npm publication is verified, install the exact version:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.1
```

Until then, use the [candidate installation](README.md#pack-and-check). Keep the application lockfile and review compatibility before upgrading.

Reference functions for passport records and shared evidence. Use the [support table](support-table.md) for the selected version and runtime; browser use is untested.

## Use it in a reader or writer

Use this package when the application consumes the reference implementation. It handles record encoding, signing and evidence checks. It does not start an index, supply a wallet or decide which issuer an application should accept.

After [installation](README.md), run the [reader and issuer examples](../quick-start.md). The reader takes transaction evidence and a policy; the issuer takes an unsigned claim and a signing adapter. Read the individual verification findings before making an application decision.

For a first programmatic step, decode the record carried in the first fixture transaction:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { findDppOutputs } from '@bsv/dpp-core'
const fixture = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const transaction = Transaction.fromHex(fixture.states[0].rawTx)
const outputs = findDppOutputs(transaction)
assert.equal(outputs.length, 1)
console.log(outputs[0])
JS
```

Expect one decoded passport output. Finding and decoding it is not signature, linkage or inclusion verification. Continue with the [reader's verification sequence](../implement/roles/passport-reader.md).

## Choose an API

The candidate also exports `@bsv/dpp-core/schemas/*`. These are the standard JSON schemas, copied byte for byte into the package. A consumer can validate a verification report, capability document or evidence package without a repository checkout:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const schema = require('@bsv/dpp-core/schemas/verification-report.schema.json')
console.log(schema.$id)
```

Use a validator supporting the schema's declared dialect and asserting formats. Schema validity does not replace signature or evidence verification.

| Task | Entry points | Source |
|---|---|---|
| Read or construct a record | `parseDppOutput`, `findDppOutputs`, `buildLockingScript` | [Codec](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/src/codec.ts) |
| Evaluate history | `verifyChain`, `inspectChain`, `chainFromBeef` | [Chain verification](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/src/verifyChain.ts) |
| Produce a report | `verifyPassportEvidence` | [Evidence API](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/src/evidence.ts) |
| Sign or inspect a native claim | `signLifecycleClaim`, `verifyLifecycleClaim` | [Claim API](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/src/attestation.ts) |
| Inspect managed acceptance or exports | Acceptance and portable-evidence helpers | [Exports](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/src/index.ts) |

Start with the [reader and issuer examples](../quick-start.md). The [package guide](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-core/README.md) lists the remaining exports.

The caller supplies header, credential, status and authority adapters. Read the [report source](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/spec/verification.md) for the distinction between missing evidence and a check that does not apply. Source disagreements are listed in the [fixture guide](../implement/fixture-runner.md).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
