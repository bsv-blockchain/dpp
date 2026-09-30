# General

The general profile supplies a versioned payload vocabulary when the integration has not selected a sector-specific profile. It does not imply that battery or textile obligations no longer apply to a product.

## Start from a sample payload

Print a minimal valid public payload, edit it, then check it before you write:

```sh
node examples/sample-payload.mjs general@2 > payload.json
node examples/sample-payload.mjs --check general@2 payload.json
```

The sample fills the 8 required fields, and nothing else, with placeholders of the right shape; replace every value with the product's own data. The profile defines 39 public fields in all, and the field inspection below lists them. The check names each problem, such as a missing field or a country that is not a two-letter code, and prints `ok:` when the payload is valid.

For `general@2` the sample is:

```json
{
  "careNote": "Example careNote",
  "category": "Example category",
  "manufacturer": "Example manufacturer",
  "manufacturerContact": "Example manufacturerContact",
  "materials": [
    {
      "part": "Example part",
      "material": "Example material"
    }
  ],
  "name": "Example name",
  "profile": "general",
  "profile_version": 2
}
```

## Inspect the fields

After [setup](../quick-start.md#get-the-code), inspect them with:

```sh
node --input-type=module <<'JS'
import { readManifest } from '@bsv/dpp-profiles'
const manifest = readManifest('general@2')
console.table(manifest.fields.map(({ key, label, accessTier }) => ({ key, label, accessTier })))
JS
```

Keep the selected version with the payload and validate against its generated schema. The [profile workflow](README.md) explains the additional applicability and evidence questions.

Use the [general manifest](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/manifests/general@2.json) and its [generated schema inventory](https://github.com/bsv-blockchain/dpp/tree/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/generated) for general product data. The [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/frozen.json) records the selected version's digests.

`general@2` is the current version and `general@1` is superseded but still readable; each manifest's `status` field says so.

Read [profile selection](README.md) before choosing between general and sector data.
