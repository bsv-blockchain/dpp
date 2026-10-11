# @bsv/dpp-profiles

`@bsv/dpp-profiles` holds the industry profiles, the published lists of product fields a passport's payload carries, with code to read them, find the fields that apply to a product and check a payload against its profile. Use it to build a passport's product data, or to show someone else's.

**Experimental prerelease:** `@bsv/dpp-profiles` 0.3.0-beta.9 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Install

**Publication pending:** this page describes the renamed source candidate. [Install its local archives](README.md#use-the-renamed-source-candidate) now. The npm command below applies once these exact versions have been published.

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.9
```

Use 0.3.0-beta.4 or later; earlier readers accept identifiers the package does not publish. A bare `npm install @bsv/dpp-profiles` installs the `latest` tag, the newest beta; pin the exact version anyway so upgrades are your choice, keep the lockfile, and review compatibility before upgrading. The [support table](support-table.md) separates the Node module from the data entry points.

Each JavaScript example below is a complete file: save it under the name given and run `node <name>.mjs` in that project. Only commands naming `examples/` need a repository checkout.

## Three versions you will meet

A manifest is a profile's definition file: its fields, their labels, tiers and obligations, and when each applies.

| Version | Where you see it | What it means |
|---|---|---|
| Profile version | The number after `@` in `battery@2`, and a payload's `profile_version` | The edition of a profile's field list. Current: `battery@2`, `textile@2`, `general@2`. Drafts: `battery@3`, `battery@4`, `textile@3`, `textile@4`. Superseded: `textile@1`, `general@1` |
| Manifest format | A manifest's `manifestVersion`, `"1"` or `"2"` | The manifest file's layout. Current profiles use format 1; drafts use format 2, which adds value types and rules |
| Record version | A passport state's `version`, 1 or 2 | The passport record model, unrelated to profiles: a version 2 state can carry a `battery@2` payload |

## Inspect applicable fields

`fieldsFor` lists the fields that apply to a product's category, and `missingRequired` the required ones a payload lacks. A field applies always, to some categories only, or after review against a condition the profile states. Save this as `inspect-fields.mjs`:

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

A payload names its category, one of the manifest's `applicability.categories`, in its `category` field. `missingRequired` checks only that the fields captured at registration are present; it is neither schema validation nor a product assessment. Show the `needsReview` fields beside your schema results, with their condition, never as satisfied.

For drafts, in manifest format 2, use `readManifestAny`, `fieldsForV2` and `missingRequiredV2`, which take a richer applicability context. `compareProfiles(from, to)` reports what changes between two profile versions and `reviewProfileData` adds cross-field findings, as [evaluate the version 4 drafts](../profiles/version-4-drafts.md) shows. [Authoring](../profiles/authoring.md) covers the generation and freeze workflow.

## Check a payload against its profile

Two readers return a profile's manifest:

| Function | Takes | Returns |
|---|---|---|
| `readManifest(profile)` | An identifier in `PROFILE_IDS`, drafts included, such as `battery@2` or `battery@4` | The frozen manifest as published, typed for format 1: a draft comes back in format 2 with keys the type does not name |
| `readManifestAny(profile)` | Any `id@version` identifier | The manifest in format 1 or 2, typed for both. It checks only the identifier's form, so check `PROFILE_IDS` first; an identifier the package does not hold fails with `ENOENT` |

Each profile also publishes two JSON Schemas (2020-12), generated from its manifest:

| Function | Takes | Returns |
|---|---|---|
| `readPublicPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for a state's `payload_public`: every `public`-tier field |
| `readRestrictedPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for the `owner`, `legitimate` and `authority` tiers together, in one object |

Outside `PROFILE_IDS`, `readManifest` and both schema readers throw `"<identifier>" is not a published industry profile`, so check a record's declared `profile` against the list first, as the next section does.

Every public schema accepts five properties beyond the manifest's public fields:

| Property | What it carries |
|---|---|
| `profile`, `profile_version` | The profile the payload declares; required in every public payload |
| `notice` | Only on a demonstration record, one describing no real product, such as under the GS1 demonstration prefix 952: one sentence saying so, as the payload's first property, which a reader shows before the product data ([profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) section 5) |
| `object_did` | An optional physical-object DID; carrying it does not bind the record to the object |
| `dataCarrier` | The data carrier's identifier, such as a chip UID; the index's lookup also finds the passport by it |

Validate with a JSON Schema 2020-12 validator that asserts formats, such as Ajv's 2020 build with `ajv-formats` and `strict: false`, since the schemas carry annotations Ajv does not know. Install them yourself, as the package does not:

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

Compile each profile's schema once and reuse it, with `ajv.getSchema(schema.$id) ?? ajv.compile(schema)`. Every state of a lineage declares the same profile, `readPublicPayloadSchema` returns a fresh copy on every call, and Ajv refuses to compile a second copy of an `$id` it already holds.

In a repository checkout, `node examples/sample-payload.mjs general@2` prints a passing payload, `--demonstration` starts it with a demonstration record's `notice`, and `node examples/sample-payload.mjs --check <profile@version> <file>` explains each problem in a payload file in a sentence.

## Show a stored payload under its profile

Show a passport's product data under the profile its record declares, even a draft or superseded one, never under a newer one. This example also needs `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/sdk@2.8.10` and network access to the hosted index. Save it as `show-payload.mjs`:

```js
import { Beef } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs } from '@bsv/dpp-protocol'
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

When `manifest.status` is `draft`, say so beside the data, and show any `notice` first. The example decodes the latest state without verifying it; verify the passport first, as [gather a passport's evidence](dpp-protocol.md#gather-a-passports-evidence) shows. This package cannot label a record whose profile is outside `PROFILE_IDS`: show its values as unlabelled data, or not at all.

## Read a field

Each entry in `manifest.fields` describes one value, with these properties in manifest format 1, which every current profile uses:

| Property | Values | What it tells an application |
|---|---|---|
| `key`, `pointer`, `label`, `semanticUri` | Strings | Name in the payload, JSON pointer, display label, and meaning where a vocabulary defines one |
| `valueType` | See the next table | The JSON value and the form input |
| `unit`, `codeList`, `constraints` | A unit symbol; `{ closed, options: [{ value, label }] }`; `minimum`, `maximum`, `step`, `pattern`, `patternHint`, `maxLength` | How to label, list and bound the input. A list that is not `closed` accepts other values |
| `cardinality` | `one`, `many` | `many` makes the value an array, a repeatable input, except for `multi`, already one |
| `granularity` | `model`, `batch`, `item` | Whether the value is entered per model, batch or item |
| `provenance.capture` | `form`, `brand`, `platform`, `event`, `derived`, `deferred` | Who supplies the value: `form`, `brand` and `platform` at registration, the only ones `missingRequired` counts; `event` a later lifecycle event; `derived` a calculation from others; `deferred` a later addition, such as a declaration of conformity |
| `provenance.kind` | `fact`, `declaration`, `calculation`, `assessment` | What kind of statement the value is |
| `accessTier` | `public`, `owner`, `legitimate`, `authority` | Who may read it. `public` is on chain in `payload_public`; the others are encrypted and held off chain, each described in the manifest's `accessTiers`. The standard has not yet settled how each restricted tier is encrypted, or to whom ([known limitations](../operate/limitations.md)) |
| `obligation`, `legalBasis` | `required`, `recommended`, `optional`; a citation or the statement that none applies | Whether to insist on the value, and why. A field can be required with no legal basis |
| `applicability` | `{ rule: 'always' }`, `{ rule: 'category-in', categories }`, `{ rule: 'needs-review', condition }` | When the field applies, as `fieldsFor(manifest, category)` evaluates it. Never treat a `needs-review` field as satisfied or always required |
| `group`, `parts` | A group identifier; for a `record`, its parts | The form section, one of the manifest's `groups`, and a `record`'s inputs. `battery@2` lists groups but assigns none to its fields |

| `valueType` | JSON value | A form shows |
|---|---|---|
| `id`, `text` | A non-empty string, bounded by `maxLength` and `pattern` | A text input |
| `enum` | A code-list value if the list is closed, otherwise any non-empty string | A select, with free text if the list is open |
| `multi` | An array of distinct code-list values | A multi-select |
| `decimal`, `integer` | A number or whole number within `minimum` and `maximum` | A number input with its unit |
| `percent` | A number from 0 to 100 unless the constraints say otherwise | A percentage input |
| `monthYear` | `YYYY-MM` | A month picker |
| `date` | `YYYY-MM-DD` | A date picker |
| `url` | An absolute URI | A URL input |
| `document` | A URI or an object describing a file | A file upload or link; the file is held off chain |
| `graphic` | A non-empty string naming an image | An image reference |
| `country` | Two upper-case letters, unless `pattern` says otherwise | A country select |
| `record` | An object of the field's `parts`, each with its own value type | A group of inputs |
| `any` | Any JSON value | The application's choice |

## Deploy it with a bundler

Keep the package external and include its data files. In a Next.js project, set this in `next.config.mjs`:

```js
// next.config.mjs
export default {
  serverExternalPackages: ['@bsv/dpp-profiles'],
  outputFileTracingIncludes: {
    '/**': ['./node_modules/@bsv/dpp-profiles/{manifests,generated,schemas}/**', './node_modules/@bsv/dpp-profiles/frozen.json'],
  },
}
```

The package reads its data files from its own directory at call time, by a computed path that bundlers and file tracers cannot follow. In a Next.js 16 production build, bundling the package leaves every data file behind, and marking it external alone traces the manifests but no generated schema, so `readPublicPayloadSchema` fails with `ENOENT` only once deployed. A standalone build with this configuration serves the schema; without the include, the same route answers 500.

## Choose an entry point

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers, in Node |
| `@bsv/dpp-profiles/manifests/*` | Profile manifests, as JSON |
| `@bsv/dpp-profiles/schemas/*` | Manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | Generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | Frozen file digests |

A consumer in another language can read the data files directly; applicability and the mapping to lifecycle events, which the schemas do not cover, are defined in [profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) and implemented in [`applicability.ts`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/applicability.ts).

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/licences.json).

Until it is decided who versions a profile and where its canonical definition lives, the frozen manifests in this package are the definitions.

## Next

| To | Go to |
|---|---|
| Choose the profile for your product | [Industry profiles](../profiles/README.md) |
| Put the payload into a passport state | [Build an application](build-an-application.md), step 3 |
| Adopt a new profile version | [Update profiles and consuming applications](../profiles/updating-applications.md) |
| Evaluate a draft before it becomes current | [Evaluate the version 4 drafts](../profiles/version-4-drafts.md) |
