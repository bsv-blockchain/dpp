# @bsv/dpp-profiles

**Experimental prerelease:** `@bsv/dpp-profiles` 0.3.0-beta.4 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

Install the exact published version:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.4
```

Keep the application lockfile and review compatibility before upgrading.

Reference helpers and generated product-profile data. The [support table](support-table.md) separates the Node module from data entry points.

## Inspect applicable fields

An industry manifest describes the fields of a product payload. Schema validation checks its shape; applicability asks which fields apply to this product. Some applicability questions remain unresolved and need to be shown separately.

After [setup](../quick-start.md#get-the-code), run:

```sh
node --input-type=module <<'JS'
import { readManifest, fieldsFor, missingRequired } from '@bsv/dpp-profiles'
const manifest = readManifest('battery@2')
const fields = fieldsFor(manifest, 'industrial')
const gaps = missingRequired(manifest, {}, 'industrial')
console.table(fields.applies.map(({ key, label, accessTier }) => ({ key, label, accessTier })))
console.log('Missing captured fields:', gaps.missing.map(field => field.key))
console.log('Review needed:', gaps.needsReview.map(field => field.key))
JS
```

The empty payload deliberately exposes missing fields. This helper checks presence for the manifest's captured required fields; it is not complete schema validation or a product assessment. Use the generated payload schema for structural validation and retain the review list alongside those results.

For draft manifest version 2 profiles, the package provides `readManifestAny`, `fieldsForV2` and `missingRequiredV2` for the richer applicability context. [Authoring](../profiles/authoring.md) covers the generation and freeze workflow.

For an upgrade, follow [updates and consumer adoption](../profiles/updating-applications.md). Generated artefacts do not automatically update application forms, backend policy or the profile selected for new records.

Since 0.3.0-beta.2 the package carries the version 4 drafts, `compareProfiles` for consumer impact reports and `reviewProfileData` for additional cross-field findings. [The draft integration guide](../profiles/version-4-drafts.md) explains their use and limitations.

## Check a payload against its profile

Each profile publishes two JSON Schemas (2020-12), generated from its manifest:

| Function | Takes | Returns |
|---|---|---|
| `readManifest(profile)` | A published identifier such as `battery@2` | The frozen manifest |
| `readManifestAny(profile)` | Any published identifier, drafts included | The manifest under version 1 or 2 |
| `readPublicPayloadSchema(profile)` | The same identifier | The schema for a state's `payload_public`: every field whose tier is `public` |
| `readRestrictedPayloadSchema(profile)` | The same identifier | The schema for the other tiers, `owner`, `legitimate` and `authority`, together in one object |

Pass these readers only an identifier from `PROFILE_IDS`: check the `profile` a record declares against the list before you pass it.

Validate with a JSON Schema 2020-12 validator that asserts formats. Ajv's 2020 build with `ajv-formats` does, with `strict: false` because the schemas carry annotations Ajv does not know. The package does not install them for you:

```sh
npm install --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

```js
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { readPublicPayloadSchema } from '@bsv/dpp-profiles'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(readPublicPayloadSchema('general@2'))
if (!validate({ name: 'Example chair' })) {
  for (const error of validate.errors) console.log(error.instancePath || '(payload)', error.message)
}
```

It prints one line for each required property the payload lacks: `careNote`, `category`, `manufacturer`, `manufacturerContact`, `materials`, `profile` and `profile_version`. The last two name the profile, and every public payload carries them. `node examples/sample-payload.mjs general@2` prints a payload that passes, and `--check <profile@version> <file>` explains each problem in a payload file in a sentence.

Compile each profile's schema once and reuse the validator. `readPublicPayloadSchema` returns a fresh copy on every call, Ajv refuses to compile a second copy of a schema whose `$id` it already holds, and every state of a lineage declares the same profile, so a reader that checks each state uses `ajv.getSchema(schema.$id) ?? ajv.compile(schema)`.

## Read a field

Every current profile uses manifest version 1. Each field in `manifest.fields` describes one value:

| Property | Values | What it tells an application |
|---|---|---|
| `key`, `pointer`, `label`, `semanticUri` | Strings | The field's name in the payload, its JSON pointer, the label to show, and its meaning where a vocabulary defines one |
| `valueType` | See the next table | The JSON value and the input a form shows |
| `unit`, `codeList`, `constraints` | A unit symbol; `{ closed, options: [{ value, label }] }`; `minimum`, `maximum`, `step`, `pattern`, `patternHint`, `maxLength` | How to label, list and bound the input. A list that is not `closed` accepts other values |
| `cardinality` | `one`, `many` | `many` makes the value an array, a repeatable input, except for `multi`, which is one already |
| `granularity` | `model`, `batch`, `item` | Whether the value is entered once per model, per batch or per item |
| `provenance.capture` | `form`, `brand`, `platform`, `event`, `derived`, `deferred` | Who supplies the value. `form`, `brand` and `platform` are supplied when the passport is registered, and `missingRequired` counts only these. `event` values come from a later lifecycle event, `derived` values are calculated from others, and `deferred` values, such as a declaration of conformity, are added later |
| `provenance.kind` | `fact`, `declaration`, `calculation`, `assessment` | What kind of statement the value is |
| `accessTier` | `public`, `owner`, `legitimate`, `authority` | Who may read it. `public` is on chain in `payload_public`; the other three are encrypted and held off chain, and the manifest's `accessTiers` describes each. How each restricted tier is encrypted, and to whom, is not yet settled by the standard |
| `obligation`, `legalBasis` | `required`, `recommended`, `optional`; a citation or the statement that none applies | Whether to insist on the value, and why. They are separate: a field can be required with no legal basis |
| `applicability` | `{ rule: 'always' }`, `{ rule: 'category-in', categories }`, `{ rule: 'needs-review', condition }` | When the field applies. `fieldsFor(manifest, category)` evaluates it. Show `needs-review` fields with their condition, and never treat one as satisfied or as always required |
| `group`, `parts` | A group identifier; for a `record`, its parts | The form section, one of the manifest's `groups`, and the inputs a `record` is made of. `battery@2` lists groups but assigns none to its fields |

| `valueType` | JSON value | A form shows |
|---|---|---|
| `id`, `text` | A non-empty string, bounded by `maxLength` and `pattern` | A text input |
| `enum` | One of the code list's values when the list is closed, otherwise any non-empty string | A select, with free text when the list is open |
| `multi` | An array of distinct values from the code list | A multi-select |
| `decimal`, `integer` | A number, or a whole number, within `minimum` and `maximum` | A number input with its unit |
| `percent` | A number from 0 to 100 unless the constraints say otherwise | A number input marked as a percentage |
| `monthYear` | `YYYY-MM` | A month picker |
| `date` | `YYYY-MM-DD` | A date picker |
| `url` | An absolute URI | A URL input |
| `document` | A URI, or an object describing a file | A file upload or a link; the file itself is held off chain |
| `graphic` | A non-empty string naming an image | An image reference |
| `country` | Two upper-case letters, unless `pattern` says otherwise | A country select |
| `record` | An object whose properties are the field's `parts`, each with its own value type | A group of inputs |
| `any` | Any JSON value | Whatever the application decides |

The draft manifests under version 2 add value types and rules; read them with `readManifestAny`, `fieldsForV2` and `missingRequiredV2`.

## Deploy it with a bundler

The package reads its manifests and schemas from its own directory when a function is called, by a path computed from the identifier, and a bundler or file tracer cannot follow such a read. In a Next.js 16 production build, bundling the package leaves every data file behind, and marking it external alone traces some manifests and no generated schema, so `readPublicPayloadSchema` fails with `ENOENT` only once deployed. Keep the package external and include its data files:

```js
// next.config.mjs
export default {
  serverExternalPackages: ['@bsv/dpp-profiles'],
  outputFileTracingIncludes: {
    '/**': ['./node_modules/@bsv/dpp-profiles/{manifests,generated,schemas}/**', './node_modules/@bsv/dpp-profiles/frozen.json'],
  },
}
```

A standalone build with this configuration serves the schema; without the include, the same route answers 500.

## Choose an entry point

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers |
| `@bsv/dpp-profiles/manifests/*` | Selected profile manifests |
| `@bsv/dpp-profiles/schemas/*` | Manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | Generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | Frozen file digests |

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/licences.json).

A consumer in another language can read the data files. Schema validation covers structure; the [applicability](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-profiles/src/applicability.ts) and [mapping sources](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/profiles.md) identify the separate evaluations.

Use [industry profiles](../profiles/README.md), [identifiers](../identifiers.md) or [projections](../interoperability/projections.md) for the corresponding workflow.

Profile governance: open. Who versions a profile and where its canonical definition lives is undecided; until it is settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions.
