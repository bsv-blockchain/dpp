# Textile

The textile profile organises product information such as composition and the evidence supporting it. A shared schema lets producers and readers use the same declared fields. It does not turn an unassessed declaration into verified evidence.

## Use the selected version

Start with `textile@2` for the current profile, keeping `textile@1` available when reading data that declares it. `textile@3` is a draft successor. Select it explicitly for draft evaluation rather than silently applying it to existing records.

After [setup](../quick-start.md#prepare-the-checkout), inspect the current field vocabulary:

```sh
node --input-type=module <<'JS'
import { readManifest } from '@bsv/dpp-profiles'
const manifest = readManifest('textile@2')
console.table(manifest.fields.map(({ key, label, accessTier, obligation }) => ({ key, label, accessTier, obligation })))
JS
```

The field list is the start of payload integration. Use its generated schema for structure, evaluate applicability and keep source assessments unresolved where the ledger does. [The profiles package](../packages/dpp-profiles.md) explains why a missing-field check is not a complete assessment.

## Version and source material

| Material | Source |
|---|---|
| Current profile | [textile@2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/textile@2.json) |
| Draft successor | [textile@3](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/textile@3.json) |
| Earlier profile, still available | [textile@1](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/textile@1.json) |
| Mapping and generated schemas | [Mapping inventory](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/generated/mapping/textile@2.md), [generated files](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/generated) |

Read the manifest selected by the payload through [the profiles package](../packages/dpp-profiles.md). The [profile source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/profiles.md) defines version selection and applicability; the [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records assessment evidence. The draft successor does not establish product qualification.
