# @bsv/dpp-profiles

Developers and data reviewers can use `@bsv/dpp-profiles` to build, validate and label passport product data. It publishes industry field lists and helpers to read them, find applicable fields and check payloads against their declared profiles.

**Experimental prerelease:** `@bsv/dpp-profiles` 0.3.0-beta.10 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Runtime and example prerequisites

| Procedure | Input and source |
|---|---|
| All module examples | Node 22 or later and this package installed in your project. |
| Candidate installation | A source checkout containing `packages/dpp-protocol`, from [source access](README.md#source-access). |
| Payload validation | `ajv@8.20.0` and `ajv-formats@3.0.1`, installed below. The package supplies no validator library. |
| Report fragment | `@bsv/dpp-protocol@0.3.0-beta.10`; your reader's `evidence`, `expected` and `policy` ([report reference](dpp-protocol.md#what-the-report-takes)). |
| Stored payload example | `@bsv/dpp-protocol@0.3.0-beta.10`, `@bsv/sdk@2.8.10` and access to the hosted index named in `show-payload.mjs`. |
| Commands naming `examples/` | Repository checkout after `npm ci` and `npm run build`; run from its root. |

## Install

**Publication pending:** this page describes the renamed source candidate. [Install its local archives](README.md#use-the-renamed-source-candidate) now:

1. At the checkout root, run `npm ci`, `node scripts/release-candidates.mjs` and `node scripts/consumer-check.mjs` to build, pack and test archives in a separate project. Nothing is published.
2. In your application, install profiles plus protocol/SDK for the stored-payload example below. Replace `/absolute/path/to/dpp` with the checkout's absolute path; retain archives and lockfile.

```sh
npm install --save-exact /absolute/path/to/dpp/release/candidates/bsv-dpp-protocol-0.3.0-beta.10.tgz /absolute/path/to/dpp/release/candidates/bsv-dpp-profiles-0.3.0-beta.10.tgz @bsv/sdk@2.8.10
```

The npm command below applies once these exact versions have been published. Run it in your project:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.10
```

Use 0.3.0-beta.4 or later: earlier readers accept identifiers the package does not publish. A bare `npm install @bsv/dpp-profiles` selects `latest`, the newest beta. Pin versions, keep the lockfile and review compatibility before upgrading. The [support table](support-table.md) distinguishes Node modules from data entry points.

Each JavaScript example below is a complete file: save it under the name given and run `node <name>.mjs` in that project. Only commands naming `examples/` need a repository checkout.

## Three versions you will meet

A manifest defines a profile's fields, labels, tiers, obligations and applicability.

| Version | Where you see it | What it means |
|---|---|---|
| Profile version | The number after `@` in `battery@2`, and a payload's `profile_version` | The edition of a profile's field list. Current: `battery@2`, `textile@2`, `general@2`. Draft: `battery@4`. Parked drafts, still readable: `battery@3`, `textile@3`, `textile@4`. Superseded: `textile@1`, `general@1` |
| Manifest format | A manifest's `manifestVersion`, `"1"` or `"2"` | The manifest file's layout. Current profiles use format 1; drafts use format 2, which adds value types and rules |
| Record version | A passport state's `version`, 1 or 2 | The passport record model, unrelated to profiles: a version 2 state can carry a `battery@2` payload |

## Inspect applicable fields

`fieldsFor` lists applicable fields; `missingRequired` lists missing required fields. Applicability is unconditional, category-specific or subject to the profile's review condition.

1. Save this as `inspect-fields.mjs`:

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

2. Run `node inspect-fields.mjs`. Expected output:

```
categories: lmt, ev, industrial, stationary
fields that apply to an industrial battery: 87 ; need review: 0
first three: passportId (Passport reference, public); serial (Serial number, public); modelName (Model name, public)
an empty payload lacks 63 required fields, starting with serial, modelName, manufacturer
```

| Finding | Interpretation |
|---|---|
| `category` | Must name one of the manifest's `applicability.categories`. |
| `missingRequired` | Checks presence of fields captured at registration only. It is neither schema validation nor product assessment. |
| `needsReview` | Show each field and its condition beside schema results. Never present it as satisfied. |

Format 2 drafts use `readManifestAny`, `fieldsForV2` and `missingRequiredV2` with richer applicability context. `compareProfiles(from, to)` reports version changes; `reviewProfileData` adds cross-field findings ([evaluate the battery@4 draft](../profiles/version-4-drafts.md)). [Authoring](../profiles/authoring.md) covers generation and freezing.

## Check a payload against its profile

Two readers return a profile's manifest:

| Function | Takes | Returns |
|---|---|---|
| `readManifest(profile)` | An identifier in `PROFILE_IDS`, drafts included, such as `battery@2` or `battery@4` | The frozen manifest as published, typed for format 1: a draft comes back in format 2 with keys the type does not name |
| `readManifestAny(profile)` | Any `id@version` identifier | The manifest in format 1 or 2, typed for both. It checks only the identifier's form, so check `PROFILE_IDS` first; an identifier the package does not hold fails with `ENOENT` |

Each manifest generates two JSON Schemas (2020-12):

| Function | Takes | Returns |
|---|---|---|
| `readPublicPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for a state's `payload_public`: every `public`-tier field |
| `readRestrictedPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for the `owner`, `legitimate` and `authority` tiers together, in one object |

Outside `PROFILE_IDS`, `readManifest` and both schema readers throw `"<identifier>" is not a published industry profile`. Check the declared `profile` against this list first.

Public schemas accept five additional properties:

| Property | What it carries |
|---|---|
| `profile`, `profile_version` | The profile the payload declares; required in every public payload |
| `notice` | Only on a demonstration record, one describing no real product, such as under the GS1 demonstration prefix 952: one sentence saying so, as the payload's first property, which a reader shows before the product data ([profiles](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) section 5) |
| `object_did` | An optional physical-object DID; carrying it does not bind the record to the object |
| `dataCarrier` | The data carrier's identifier, such as a chip UID; the index's lookup also finds the passport by it |

1. Install Ajv's 2020 build and formats. Validation needs JSON Schema 2020-12 with formats asserted; `strict: false` permits schema annotations Ajv does not know:

```sh
npm install --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

2. Save this as `check-payload.mjs`:

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

3. Run `node check-payload.mjs` and inspect each missing property:

| Expected output | Missing properties |
|---|---|
| One line per property: `(payload) must have required property '<name>'` | `careNote`, `category`, `manufacturer`, `manufacturerContact`, `materials`, `profile`, `profile_version` |

Stop before treating this payload as valid: supply the required values and validate again.

Reuse compiled schemas with `ajv.getSchema(schema.$id) ?? ajv.compile(schema)`. Every lineage state declares the same profile; `readPublicPayloadSchema` returns fresh copies, and Ajv refuses a second copy of an existing `$id`.

4. To include validation in a report, pass `profilePayloadValidator(ajv)` as the policy's `payloadValidator` to `verifyPassportEvidence`. Use the same Ajv instance.

| Token payload | Report's `schema` result |
|---|---|
| Declares a published profile and validates | `pass` |
| Declares a published profile and is invalid | `fail`, `schema-invalid`, with one sentence per problem |
| Declares a profile this package does not publish | `unknown`, `schema-unavailable` |
| Lacks the two profile stamps | `unknown`, `profile-undeclared` |

**Fragment, not runnable alone:** supply your reader's `evidence`, `expected` and `policy`. The [complete reader](dpp-protocol.md#gather-a-passports-evidence) shows their contents.

```js
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { verifyPassportEvidence } from '@bsv/dpp-protocol'
import { profilePayloadValidator } from '@bsv/dpp-profiles'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const report = await verifyPassportEvidence(evidence, expected, { ...policy, payloadValidator: profilePayloadValidator(ajv) })
```

| Checkout command or option | Expected result |
|---|---|
| `node examples/sample-payload.mjs general@2` | Passing payload |
| `--demonstration` | Starts the payload with a demonstration record's `notice` |
| `node examples/sample-payload.mjs --check <profile@version> <file>` | One sentence explaining each problem in the supplied payload file |

## Show a stored payload under its profile

Show data under the profile its record declares, including draft or superseded profiles, never a newer one.

1. Save this as `show-payload.mjs`:

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

2. Run `node show-payload.mjs`. Expected output:

```
battery@4 draft Battery passport
  Passport reference: "https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8"
  Serial number: "10000000122"
  Model name: "Hearth 10"
```

3. Apply these display rules:

| Condition | Required action |
|---|---|
| Any `notice` | Show it before product data. |
| `manifest.status` is `draft` | Label the data as draft. |
| Latest state decoded by this example | Verify it before relying on it; see [gather a passport's evidence](dpp-protocol.md#gather-a-passports-evidence). Decoding alone does not verify. |
| Profile outside `PROFILE_IDS` | Cannot label: show unlabelled values or no values. |

## Read a field

Each `manifest.fields` entry describes one value. All current profiles use these format 1 properties:

| Property | Values | What it tells an application |
|---|---|---|
| `key`, `pointer`, `label`, `semanticUri` | Strings | Name in the payload, JSON pointer, display label, and meaning where a vocabulary defines one |
| `valueType` | See the next table | The JSON value and the form input |
| `unit`, `codeList`, `constraints` | A unit symbol; `{ closed, options: [{ value, label }] }`; `minimum`, `maximum`, `step`, `pattern`, `patternHint`, `maxLength` | How to label, list and bound the input. A list that is not `closed` accepts other values |
| `cardinality` | `one`, `many` | `many` makes the value an array, a repeatable input, except for `multi`, already one |
| `granularity` | `model`, `batch`, `item` | Whether the value is entered per model, batch or item |
| `provenance.capture` | `form`, `brand`, `platform`, `event`, `derived`, `deferred` | Who supplies the value: `form`, `brand` and `platform` at registration, the only ones `missingRequired` counts; `event` a later lifecycle event; `derived` a calculation from others; `deferred` a later addition, such as a declaration of conformity |
| `provenance.kind` | `fact`, `declaration`, `calculation`, `assessment` | What kind of statement the value is |
| `accessTier` | `public`, `owner`, `legitimate`, `authority` | Who may read it. `public` is on chain in `payload_public`; the others form one object encrypted to the owner and held off chain, each tier described in the manifest's `accessTiers`, and a `legitimate` or `authority` reader receives its tier re-encrypted to its own key ([choose an industry profile](../profiles/README.md)) |
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

The package computes data-file paths in its own directory at call time; bundlers and file tracers cannot follow them.

| Next.js 16 production configuration | Result |
|---|---|
| Bundle the package | Every data file is left behind. |
| Mark external only | Manifests are traced, generated schemas are not. `readPublicPayloadSchema` fails with `ENOENT` only after deployment; the route answers 500. |
| Standalone build with the configuration above | Includes the data files and serves the schema. |

## Choose an entry point

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers, in Node |
| `@bsv/dpp-profiles/manifests/*` | Profile manifests, as JSON |
| `@bsv/dpp-profiles/schemas/*` | Manifest and supporting schemas |
| `@bsv/dpp-profiles/generated/*` | Generated payload schemas and profile documents |
| `@bsv/dpp-profiles/frozen.json` | Frozen file digests |

Other languages can read data files directly. Applicability and lifecycle-event mappings are outside the schemas; their rules are defined in [profiles](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md) and implemented in [`applicability.ts`](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-profiles/src/applicability.ts).

Sources: [packages/dpp-profiles/package.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/package.json), [packages/dpp-profiles/README.md](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/packages/dpp-profiles/README.md), [conformance/licences.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/licences.json).

Until profile versioning and canonical locations are decided, this package's frozen manifests are the definitions.

## Next

| To | Go to |
|---|---|
| Choose the profile for your product | [Industry profiles](../profiles/README.md) |
| Put the payload into a passport state | [Build an application](build-an-application.md), step 3 |
| Adopt a new profile version | [Update profiles and consuming applications](../profiles/updating-applications.md) |
| Evaluate a draft before it becomes current | [Evaluate the battery@4 draft](../profiles/version-4-drafts.md) |
