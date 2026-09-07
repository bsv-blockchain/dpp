# Passport projections

A projection combines selected source revisions into a product-data view. Start with the source records and policy the intended projection uses.

## Why a view needs provenance

A product view can combine a model's specification, a batch's declared origin and an item's later measurements. Those sources can disagree, be restricted or have several revisions. A projection records the selected sources and policy beside the values so the view can be reproduced.

Supply the subject, selected profile, source revisions and relationships, plus the precedence policy and disclosure scope. An optional historical cutoff selects the view at that point. A missing item measurement should remain missing rather than being manufactured from a model-level value.

## Reproduce a projection

After [setup](../quick-start.md#prepare-the-checkout), run:

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

Expect the digest to match the fixture. Read `values` with `fieldResults`: a field can be missing, withheld or in conflict even when the projection was produced. The diagnostic result does not turn every field into an established fact.

In an application, retain the selected source revisions with the projection. Recomputing against the newest available source would answer a different question. The commitment detects a changed view; it does not supply missing signatures or evidence.

## Source definitions

| Input or output | Source |
|---|---|
| Source revisions | [Source schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/passport-source.schema.json) |
| Projection identity and output | [Projection schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/passport-projection.schema.json) |
| Commitment and precedence rules | [Projection source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/passport-projections.md) |
| Reference implementation | [Projection helper](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/src/projections.ts) |
| Test cases | [Projection vectors](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/vectors/dpp/interoperability) |

The commitment has an explicit exclusion list in the source. Do not infer it from the projection identifier alone. A projection supplies no missing signature or custody evidence. [Source exchange](epcis.md) covers imported event data.
