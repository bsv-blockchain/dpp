# @bsv/dpp-profiles

Reference helpers and generated product-profile data. The [support table](support-table.md) separates the Node module from data entry points.

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers |
| `@bsv/dpp-profiles/manifests/*` | Selected profile manifests |
| `@bsv/dpp-profiles/schemas/*` | Manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | Generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | Frozen file digests |

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/licences.json).

A consumer in another language can read the data files. Schema validation covers structure; the [applicability](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/src/applicability.ts) and [mapping sources](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/profiles.md) identify the separate evaluations.

Use [industry profiles](../profiles/README.md), [identifiers](../identifiers.md) or [projections](../interoperability/projections.md) for the corresponding workflow.

The profile repository-home decision is open; see [D-CR5](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L182).
