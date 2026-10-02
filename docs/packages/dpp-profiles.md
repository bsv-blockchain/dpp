# @bsv/dpp-profiles

`@bsv/dpp-profiles` carries the industry profiles, the published lists of product fields a passport's payload holds, with the code to read them, find the fields that apply to a product and check a payload against its profile. Use it when your application builds the product data for a passport, or shows the product data of a passport someone else wrote.

**Experimental prerelease:** `@bsv/dpp-profiles` 0.3.0-beta.6 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.6
```

Use 0.3.0-beta.4 or later. Before 0.3.0-beta.4, `readManifest` and the schema readers did not check the identifier they were given; from 0.3.0-beta.4 they refuse any identifier the package does not publish. A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta; name the exact version all the same, so an upgrade is your choice. Keep the application lockfile and review compatibility before upgrading. The [support table](support-table.md) separates the Node module from the data entry points.

The JavaScript examples on this page are complete files: save each under the name given and run it with `node <name>.mjs` in that project. Only the commands that name `examples/` need a checkout of the repository.

## Three versions you will meet

| Version | Where you see it | What it means |
|---|---|---|
| Profile version | The number after `@` in `battery@2`, and a payload's `profile_version` | Which edition of a profile's field list a payload follows. `battery@2`, `textile@2` and `general@2` are current; `battery@3`, `battery@4`, `textile@3` and `textile@4` are drafts; `textile@1` and `general@1` are superseded |
| Manifest format | A manifest's `manifestVersion`, `"1"` or `"2"` | How the manifest file itself is laid out. The current profiles use format 1; the drafts use format 2, which adds value types and rules |
| Record version | A passport state's `version`, 1 or 2 | The passport record model a state follows. It is unrelated to profiles: a version 2 state can carry a `battery@2` payload |

A manifest is the profile's definition file: its fields, their labels, tiers and obligations, and when each applies.

## Inspect applicable fields

Schema validation checks a payload's shape; applicability asks which fields apply to this product. A field can apply always, only to some categories, or need review against a condition the profile states. Save this as `inspect-fields.mjs`:

```js
import { readManifest, fieldsFor, missingRequired } from '@bsv/dpp-profiles'

const manifest = readManifest('battery@2')
console.log('categories:', manifest.applicability.categories.map(({ value }) => value).join(', '))
const fields = fieldsFor(manifest, 'industrial')
console.log('fields that apply to an industrial battery:', fields.applies.length, '; need review:', fields.needsReview.length)
console.log('first three:', fields.applies.slice(0, 3).map(({ key, label, accessTier }) => `${key} (${label}, ${accessTier})`).join('; '))
const gaps = missingRequired(manifest, {}, 'industrial')
console.log('an empty payload lacks', gaps.missing.length, 'required fields, starting with', gaps.missing.slice(0, 3).map(({ key }) => key).join(', '))
```

`node inspect-fields.mjs` prints:

```
categories: lmt, ev, industrial, stationary
fields that apply to an industrial battery: 87 ; need review: 0
first three: passportId (Passport reference, public); serial (Serial number, public); modelName (Model name, public)
an empty payload lacks 63 required fields, starting with serial, modelName, manufacturer
```

A category is one of the values in the manifest's `applicability.categories`, and a payload names its own in its `category` field. `missingRequired` checks only that the fields captured when the passport is registered are present; it is not schema validation or a product assessment. Use the payload schema below for structure, and keep the `needsReview` list with those results: show those fields with their condition, never as satisfied.

The drafts, in manifest format 2, have their own helpers for the richer applicability context: `readManifestAny`, `fieldsForV2` and `missingRequiredV2`. The package also exports `compareProfiles(from, to)`, which reports what changes between two profile versions, and `reviewProfileData`, which adds cross-field findings; [evaluate the version 4 drafts](../profiles/version-4-drafts.md) shows both, and [authoring](../profiles/authoring.md) covers the generation and freeze workflow.

## Check a payload against its profile

Two readers return a profile's manifest:

| Function | Takes | Returns |
|---|---|---|
| `readManifest(profile)` | An identifier in `PROFILE_IDS`, drafts included, such as `battery@2` or `battery@4` | The frozen manifest as published. It is typed for manifest format 1, so a draft comes back in format 2 with keys the type does not name |
| `readManifestAny(profile)` | An identifier of the form `id@version` | The manifest in format 1 or 2, typed for both. It checks only the identifier's form, so check it against `PROFILE_IDS` first; an identifier the package does not hold fails with `ENOENT` |

Each profile also publishes two JSON Schemas (2020-12), generated from its manifest:

| Function | Takes | Returns |
|---|---|---|
| `readPublicPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for a state's `payload_public`: every field whose tier is `public` |
| `readRestrictedPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for the other tiers, `owner`, `legitimate` and `authority`, together in one object |

`readManifest` and both schema readers throw `"<identifier>" is not a published industry profile` for anything outside `PROFILE_IDS`. Check the `profile` a record declares against the list before you pass it, as the next section does.

Every public schema accepts five properties that are not manifest fields, so it has five more properties than the manifest has public fields:

| Property | What it carries |
|---|---|
| `profile`, `profile_version` | The profile the payload declares, required in every public payload |
| `notice` | Only on a demonstration record, one that describes no real product, such as one under the GS1 demonstration prefix 952: one sentence saying so, as the payload's first property. A record about a real product never carries it, and a reader shows it before the product data ([profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) section 5) |
| `object_did` | An optional physical-object DID; carrying it does not bind the record to the object |
| `dataCarrier` | The data carrier's identifier, such as a chip UID, which the index's lookup also finds the passport by |

Validate with a JSON Schema 2020-12 validator that asserts formats. Ajv's 2020 build with `ajv-formats` does, with `strict: false` because the schemas carry annotations Ajv does not know. The package does not install them for you; add them to your project:

```sh
npm install --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

Save this as `check-payload.mjs`:

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

`node check-payload.mjs` prints one line for each required property the payload lacks: `careNote`, `category`, `manufacturer`, `manufacturerContact`, `materials`, `profile` and `profile_version`, each as `(payload) must have required property '<name>'`.

Compile each profile's schema once and reuse the validator. `readPublicPayloadSchema` returns a fresh copy on every call, Ajv refuses to compile a second copy of a schema whose `$id` it already holds, and every state of a lineage declares the same profile, so a reader that checks each state uses `ajv.getSchema(schema.$id) ?? ajv.compile(schema)`.

In a checkout of the repository, `node examples/sample-payload.mjs general@2` prints a payload that passes, `--demonstration` starts it with the `notice` a demonstration record carries, and `node examples/sample-payload.mjs --check <profile@version> <file>` explains each problem in a payload file in a sentence.

## Show a stored payload under its profile

A reader shows a passport's product data under the profile the record declares, which may be a draft or a superseded version, never under a newer one. Check the declared identifier against `PROFILE_IDS`, read the manifest with `readManifestAny`, say when the profile is a draft, and label each value with its field's label. This also needs `@bsv/dpp-core@0.3.0-beta.6` and `@bsv/sdk@2.8.10`, and network access to the hosted index. Save this as `show-payload.mjs`:

```js
import { Beef } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs } from '@bsv/dpp-core'
import { PROFILE_IDS, readManifestAny } from '@bsv/dpp-profiles'

const index = 'https://dpp-overlay.bsvb.net'
const passportId = 'https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8'

// Fetch the passport's states and take the latest one's public payload.
const { outputs } = await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })).json()
if (outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
const merged = Beef.fromBinary(outputs[0].beef)
for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
const tip = chainFromBeef(merged, passportId).at(-1)
const payload = JSON.parse(findDppOutputs(tip)[0].state.payloadPublic)

// The profile the record declares is the record's word: check it is one this package publishes before reading it.
const declared = `${payload.profile}@${payload.profile_version}`
if (!PROFILE_IDS.includes(declared)) throw new Error(`${declared} is not a profile this package publishes`)
const manifest = readManifestAny(declared)
console.log(declared, manifest.status, manifest.title)

// Label each value with its field's label in that profile; the first three here.
for (const field of manifest.fields.filter(({ key }) => key in payload).slice(0, 3)) {
  console.log(`  ${field.label}: ${JSON.stringify(payload[field.key])}`)
}
```

`node show-payload.mjs` prints:

```
battery@4 draft Battery passport
  Passport reference: "https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8"
  Serial number: "10000000122"
  Model name: "Hearth 10"
```

When `manifest.status` is `draft`, say so beside the data. If the payload carries `notice`, show it first. This decodes the latest state without verifying it; verify the passport first, as [gather a passport's evidence](dpp-core.md#gather-a-passports-evidence) shows. A record that declares a profile outside `PROFILE_IDS` cannot be labelled by this package: show its values as unlabelled data, or not at all.

## Read a field

Every field in `manifest.fields` describes one value. These are the properties of manifest format 1, which every current profile uses:

| Property | Values | What it tells an application |
|---|---|---|
| `key`, `pointer`, `label`, `semanticUri` | Strings | The field's name in the payload, its JSON pointer, the label to show, and its meaning where a vocabulary defines one |
| `valueType` | See the next table | The JSON value and the input a form shows |
| `unit`, `codeList`, `constraints` | A unit symbol; `{ closed, options: [{ value, label }] }`; `minimum`, `maximum`, `step`, `pattern`, `patternHint`, `maxLength` | How to label, list and bound the input. A list that is not `closed` accepts other values |
| `cardinality` | `one`, `many` | `many` makes the value an array, a repeatable input, except for `multi`, which is one already |
| `granularity` | `model`, `batch`, `item` | Whether the value is entered once per model, per batch or per item |
| `provenance.capture` | `form`, `brand`, `platform`, `event`, `derived`, `deferred` | Who supplies the value. `form`, `brand` and `platform` are supplied when the passport is registered, and `missingRequired` counts only these. `event` values come from a later lifecycle event, `derived` values are calculated from others, and `deferred` values, such as a declaration of conformity, are added later |
| `provenance.kind` | `fact`, `declaration`, `calculation`, `assessment` | What kind of statement the value is |
| `accessTier` | `public`, `owner`, `legitimate`, `authority` | Who may read it. `public` is on chain in `payload_public`; the other three are encrypted and held off chain, and the manifest's `accessTiers` describes each. How each restricted tier is encrypted, and to whom, is not yet settled by the standard ([known limitations](../operate/limitations.md)) |
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

The drafts' manifest format 2 adds value types and rules; read those manifests with `readManifestAny`, `fieldsForV2` and `missingRequiredV2`.

## Deploy it with a bundler

The package reads its manifests and schemas from its own directory when a function is called, by a path computed from the identifier, and a bundler or file tracer cannot follow such a read. In a Next.js 16 production build, bundling the package leaves every data file behind, and marking it external alone traces the manifests but no generated schema, so `readPublicPayloadSchema` fails with `ENOENT` only once deployed. Keep the package external and include its data files, in your Next.js project's `next.config.mjs`:

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
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers, in Node |
| `@bsv/dpp-profiles/manifests/*` | The profile manifests, as JSON |
| `@bsv/dpp-profiles/schemas/*` | The manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | The generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | The frozen file digests |

A consumer in another language can read the data files directly. Schema validation covers structure only; applicability and the mapping to lifecycle events are separate evaluations, defined in [profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) and implemented in [`applicability.ts`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/applicability.ts).

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/licences.json).

Who versions a profile and where its canonical definition lives is not decided yet; until it is, the frozen manifests in this package are the definitions.

## Next

| To | Go to |
|---|---|
| Choose the profile for your product | [Industry profiles](../profiles/README.md) |
| Put the payload into a passport state | [Build an application](build-an-application.md), step 3 |
| Adopt a new profile version | [Update profiles and consuming applications](../profiles/updating-applications.md) |
| Evaluate a draft before it becomes current | [Evaluate the version 4 drafts](../profiles/version-4-drafts.md) |
