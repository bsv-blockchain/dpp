# General

The general profile supplies a versioned payload vocabulary when the integration has not selected a sector-specific profile. It does not imply that battery or textile obligations no longer apply to a product.

After [setup](../quick-start.md#prepare-the-checkout), inspect it with:

```sh
node --input-type=module <<'JS'
import { readManifest } from '@bsv/dpp-profiles'
const manifest = readManifest('general@2')
console.table(manifest.fields.map(({ key, label, accessTier }) => ({ key, label, accessTier })))
JS
```

Keep the selected version with the payload and validate against its generated schema. The [profile workflow](README.md) explains the additional applicability and evidence questions.

Use the [general manifest](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/general@2.json) and its [generated schema inventory](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/generated) for general product data. The [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/frozen.json) records the selected version's digests.

Read [profile selection](README.md) before choosing between general and sector data.
