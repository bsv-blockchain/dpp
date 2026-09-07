# Battery

The battery profile provides a shared vocabulary for battery product data and lifecycle evidence. Use it to describe and validate a payload; selecting it alone does not establish a product assessment or that every required document has been obtained.

## Try the current profile

Run [the field inspection example](../packages/dpp-profiles.md#inspect-applicable-fields), which selects `battery@2` and the `industrial` category. It lists applicable fields, missing captured fields and questions requiring review. Replace the empty payload with application data only after choosing the relevant product category.

To see how product events and evidence differ, inspect the synthetic battery lifecycle:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/battery-lifecycle-v1.json', 'utf8'))
for (const state of fixture.states) console.log(state.op, state.mapping)
JS
```

The output includes a token transfer with insufficient evidence for physical custody. Changing control of a record does not establish delivery of a battery. Retain that missing-evidence finding when presenting the event.

## Version and source material

| Material | Source |
|---|---|
| Current profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/battery@2.json) |
| Draft successor | [battery@3](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/battery@3.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/generated) |
| Synthetic lifecycle | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/battery-lifecycle-v1.json) |

The fixture uses invented product data; no product exists. Its mapping results illustrate missing evidence as well as supported cases.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records the profile's source assessments and withheld product claim. Some field metadata remains absent from the current manifest. The draft successor does not close those assessments or establish legal adequacy.

Use [the profiles package](../packages/dpp-profiles.md) to read the data and [authoring](authoring.md) to propose a revision.
