# Battery

For a regulatory, standards or external-validator comparison, use [the readiness review](reviewing-readiness.md). It separates field mappings and export transformations from applicability, evidence and system testing.

The battery profile provides a shared vocabulary for battery product data and lifecycle evidence. Use it to describe and validate a payload; selecting it alone does not establish a product assessment or that every required document has been obtained.

## Start from a sample payload

Print a minimal valid public payload, edit it, then check it before you write:

```sh
node examples/sample-payload.mjs battery@2 > payload.json
node examples/sample-payload.mjs --check battery@2 payload.json
```

The sample fills the 53 required fields, and nothing else, with placeholders of the right shape; replace every value with the product's own data. The profile defines 69 public fields in all, and the field inspection below lists them. The check names each problem, such as a missing field or a country that is not a two-letter code, and prints `ok:` when the payload is valid.

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

`battery@2` is the current version. `@bsv/dpp-profiles` 0.3.0-beta.4 also carries two drafts, `battery@3` and `battery@4`, which an application uses only when it names one; [evaluate the version 4 drafts](version-4-drafts.md) explains the corrections, migration and remaining assessment work. Each manifest's `status` field says which version is which, `current`, `draft` or `superseded`, and is the answer to trust in code: `readManifestAny('battery@4').status` is `draft`. The pinned sources below describe the earlier released definitions.

| Material | Source |
|---|---|
| Current profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/manifests/battery@2.json) |
| Draft successors | [battery@3](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/manifests/battery@3.json), [battery@4](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/manifests/battery@4.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/generated) |
| Synthetic lifecycle | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/fixtures/battery-lifecycle-v1.json) |

The fixture uses invented product data; no product exists. Its mapping results illustrate missing evidence as well as supported cases.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) records the profile's source assessments and withheld product claim. Some field metadata remains absent from the current manifest. The draft successor does not close those assessments or establish legal adequacy.

Use [the profiles package](../packages/dpp-profiles.md) to read the data and [authoring](authoring.md) to propose a revision.
