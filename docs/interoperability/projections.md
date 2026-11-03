# Passport projections

Application teams whose product data lives in model, batch and item records in a product-information or ERP system can use this page to reproduce one product view. A projection combines selected source revisions into the facts a passport page shows, giving the same view from the same sources.

A projection is an off-chain data document with its own identity and digest. It is not a credential and supplies no missing signature, evidence or custody record.

## Prerequisites

| To run the example | Source |
|---|---|
| Node 22 or later and a built checkout | Follow [setup](../quick-start.md#get-the-code): `npm ci`, then `npm run build`. Run commands from the checkout root. |
| Example inputs | `fixtures/vectors/dpp/interoperability/projection/v1.json`: `item-public` supplies the vector's `input`; `shared.profile` supplies its profile. |

## Why a view needs provenance

A view can combine model specifications, declared batch origin and later item measurements. Sources can disagree, be restricted or have several revisions. The projection records selected sources and policy beside values, making the view reproducible without presenting model values as item measurements.

Its inputs, and the keys they have in each vector's `input`:

| Input | Key |
|---|---|
| The passport and the subject the view is about | `passportId`, `subject` |
| The selected industry profile | `profile` (the vector file's `shared.profile`) |
| The source revisions | `sources` |
| How the model, batch and item relate | `relationships` |
| Item measurements | `measurements` |
| The precedence policy | `policy` |
| The audience and its disclosure tier | `disclosureScope` |
| Locale and jurisdiction | `locale`, `jurisdiction` |
| An optional historical cutoff | `asOf` |

A missing item measurement stays missing rather than being filled in from a model-level value.

## Reproduce a projection

1. Derive the fixture's `item-public` projection and compare its digest:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectPassport } from '@bsv/dpp-profiles'
const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/projection/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'item-public')
const { projection, validation } = projectPassport({ ...vector.input, profile: fixture.shared.profile })
assert.equal(projection.projectionDigest, vector.expected.projectionDigest)
console.log(projection.values)
console.log(projection.fieldResults)
console.log(validation)
JS
```

The digest assertion holds, `values` and `fieldResults` print, and the last line is `{ ok: true, findings: [] }`. Read `values` with `fieldResults`: a field can be missing, withheld or in conflict even when the projection was produced, so the result does not turn every field into an established fact.

[`examples/project-passport.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/project-passport.mjs) derives a projection twice with the inputs in reverse order and shows the same digest both times. Run the default example or select another vector:

```sh
node examples/project-passport.mjs
node examples/project-passport.mjs item-public
```

Each invocation prints `Holds:` for the pinned digest, the reversed order, the projection identity, the field results and the values, then one line per field with where its value came from.

## In an application

Keep the selected source revisions. Recomputing against the newest source answers a different question. The commitment detects changes to the view: it excludes `projectionId`, `projectionDigest`, `diagnostics` and `template`, then canonicalises the remaining body under RFC 8785 and hashes it with SHA-256. Retrieval time and the rendering preset are outside that body. Do not infer the commitment from the projection identifier alone; it supplies neither an anchor nor a source's proof. [Source exchange](epcis.md) covers imported event data.

## Source definitions

| Input or output | Source |
|---|---|
| Source revisions | [Source schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-source.schema.json) |
| Projection identity and output | [Projection schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-projection.schema.json) |
| Commitment and precedence rules | [Projection source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/passport-projections.md) |
| Reference implementation | [Projection helper](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/projections.ts) |
| Test cases | [Projection vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability) |

Next: [industry profiles](../profiles/README.md), for the fields a profile defines and which tier each belongs to.
