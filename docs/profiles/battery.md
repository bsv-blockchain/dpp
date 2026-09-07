# Battery

| Material | Source |
|---|---|
| Current profile | [battery@2](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/manifests/battery@2.json) |
| Draft successor | [battery@3](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/manifests/battery@3.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/generated/mapping/battery@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/generated) |
| Synthetic lifecycle | [Battery fixture](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/battery-lifecycle-v1.json) |

The fixture uses invented product data; no product exists. Its mapping results illustrate missing evidence as well as supported cases.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) records the profile's source assessments and withheld product claim. Some field metadata remains absent from the current manifest. The draft successor does not close those assessments or establish legal adequacy.

Use [the profiles package](../packages/dpp-profiles.md) to read the data and [authoring](authoring.md) to propose a revision.
