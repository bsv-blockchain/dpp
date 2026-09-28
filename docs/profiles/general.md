# General

The general profile supplies a versioned payload vocabulary when the integration has not selected a sector-specific profile. It does not imply that battery or textile obligations no longer apply to a product.

After [setup](../quick-start.md#get-the-code), inspect it with:

```sh
node --input-type=module <<'JS'
import { readManifest } from '@bsv/dpp-profiles'
const manifest = readManifest('general@2')
console.table(manifest.fields.map(({ key, label, accessTier }) => ({ key, label, accessTier })))
JS
```

Keep the selected version with the payload and validate against its generated schema. The [profile workflow](README.md) explains the additional applicability and evidence questions.

Use the [general manifest](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/manifests/general@2.json) and its [generated schema inventory](https://github.com/bsv-blockchain/dpp/tree/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/generated) for general product data. The [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/frozen.json) records the selected version's digests.

Read [profile selection](README.md) before choosing between general and sector data.
