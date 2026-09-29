# Textile

Use [the readiness review](reviewing-readiness.md) to compare the selected profile with applicable sources and application evidence. Use [consumer adoption](updating-applications.md) when the resulting changes affect forms, backend rules or new records.

The textile profile organises product information such as composition and the evidence supporting it. A shared schema lets producers and readers use the same declared fields. It does not turn an unassessed declaration into verified evidence.

## Start from a sample payload

Print a minimal valid public payload, edit it, then check it before you write:

```sh
node examples/sample-payload.mjs textile@2 > payload.json
node examples/sample-payload.mjs --check textile@2 payload.json
```

The sample fills the 12 required fields, and nothing else, with placeholders of the right shape; replace every value with the product's own data. The profile defines 46 public fields in all, and the field inspection below lists them. The check names each problem, such as a missing field or a country that is not a two-letter code, and prints `ok:` when the payload is valid.

## Use the selected version

Start with `textile@2` for the current profile, keeping `textile@1` available when reading data that declares it. `textile@3` is a draft successor. Select it explicitly for draft evaluation rather than silently applying it to existing records.

After [setup](../quick-start.md#get-the-code), inspect the current field vocabulary:

```sh
node --input-type=module <<'JS'
import { readManifest } from '@bsv/dpp-profiles'
const manifest = readManifest('textile@2')
console.table(manifest.fields.map(({ key, label, accessTier, obligation }) => ({ key, label, accessTier, obligation })))
JS
```

The field list is the start of payload integration. Use its generated schema for structure, evaluate applicability and keep source assessments unresolved where the ledger does. [The profiles package](../packages/dpp-profiles.md) explains why a missing-field check is not a complete assessment.

## Version and source material

The `textile@4` draft included in the published `@bsv/dpp-profiles@0.3.0-beta.2` package corrects source-status mappings and component composition. See [the version 4 draft guide](version-4-drafts.md) for migration and assessment limits. The pinned definitions below remain available unchanged.

| Material | Source |
|---|---|
| Current profile | [textile@2](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/manifests/textile@2.json) |
| Draft successor | [textile@3](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/manifests/textile@3.json) |
| Earlier profile, still available | [textile@1](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/manifests/textile@1.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/generated/mapping/textile@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/generated) |

Read the manifest selected by the payload through [the profiles package](../packages/dpp-profiles.md). The [profile source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/profiles.md) defines version selection and applicability; the [ledger](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json) records assessment evidence. The draft successor does not establish product qualification.
