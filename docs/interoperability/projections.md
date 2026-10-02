# Passport projections

A projection combines selected source revisions of a model, a batch and an item into one reproducible product view, such as the facts a passport page shows. This page is for applications whose product data already lives in a product-information or ERP system split that way, and who need the same view every time from the same sources.

A projection is a data document with its own identity and digest. It is not written on chain and it is not a credential: it is the view a passport page shows, and it supplies no missing signature, evidence or custody record.

## Why a view needs provenance

A product view can combine a model's specification, a batch's declared origin and an item's later measurements. Those sources can disagree, be restricted or have several revisions. A projection records the selected sources and policy beside the values, so the view can be reproduced and a model-level value is never shown as an item measurement.

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

At the root of a checkout, after [setup](../quick-start.md#get-the-code):

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

[`examples/project-passport.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/project-passport.mjs) derives a projection twice with the inputs in reverse order and shows the same digest both times. Run `node examples/project-passport.mjs`, or name another vector, such as `node examples/project-passport.mjs item-public`. It prints `Holds:` for the pinned digest, the reversed order, the projection identity, the field results and the values, then one line per field with where its value came from.

## In an application

Keep the selected source revisions with the projection. Recomputing against the newest source answers a different question. The commitment detects a changed view, and its exclusion list is set out in the projection source: do not infer it from the projection identifier alone. [Source exchange](epcis.md) covers imported event data.

## Source definitions

| Input or output | Source |
|---|---|
| Source revisions | [Source schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-source.schema.json) |
| Projection identity and output | [Projection schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/passport-projection.schema.json) |
| Commitment and precedence rules | [Projection source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/passport-projections.md) |
| Reference implementation | [Projection helper](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/projections.ts) |
| Test cases | [Projection vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability) |

Next: [industry profiles](../profiles/README.md), for the fields a profile defines and which tier each belongs to.
