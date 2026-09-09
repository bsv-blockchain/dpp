# @bsv/dpp-profiles

**Experimental prerelease:** `@bsv/dpp-profiles` 0.3.0-beta.1 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

After npm publication is verified, install the exact version:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.1
```

Until then, use the [candidate installation](README.md#pack-and-check). Keep the application lockfile and review compatibility before upgrading.

Reference helpers and generated product-profile data. The [support table](support-table.md) separates the Node module from data entry points.

## Inspect applicable fields

An industry manifest describes the fields of a product payload. Schema validation checks its shape; applicability asks which fields apply to this product. Some applicability questions remain unresolved and need to be shown separately.

After [setup](../quick-start.md#prepare-the-checkout), run:

```sh
node --input-type=module <<'JS'
import { readManifest, fieldsFor, missingRequired } from '@bsv/dpp-profiles'
const manifest = readManifest('battery@2')
const fields = fieldsFor(manifest, 'industrial')
const gaps = missingRequired(manifest, {}, 'industrial')
console.table(fields.applies.map(({ key, label, accessTier }) => ({ key, label, accessTier })))
console.log('Missing captured fields:', gaps.missing.map(field => field.key))
console.log('Review needed:', gaps.needsReview.map(field => field.key))
```

The empty payload deliberately exposes missing fields. This helper checks presence for the manifest's captured required fields; it is not complete schema validation or a product assessment. Use the generated payload schema for structural validation and retain the review list alongside those results.

For draft manifest version 2 profiles, the package provides `readManifestAny`, `fieldsForV2` and `missingRequiredV2` for the richer applicability context. [Authoring](../profiles/authoring.md) covers the generation and freeze workflow.

## Choose an entry point

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers |
| `@bsv/dpp-profiles/manifests/*` | Selected profile manifests |
| `@bsv/dpp-profiles/schemas/*` | Manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | Generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | Frozen file digests |

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/conformance/licences.json).

A consumer in another language can read the data files. Schema validation covers structure; the [applicability](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/packages/dpp-profiles/src/applicability.ts) and [mapping sources](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/spec/profiles.md) identify the separate evaluations.

Use [industry profiles](../profiles/README.md), [identifiers](../identifiers.md) or [projections](../interoperability/projections.md) for the corresponding workflow.

The profile repository-home decision is open; see [D-CR5](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L182).
