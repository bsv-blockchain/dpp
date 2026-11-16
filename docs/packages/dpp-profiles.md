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
| Profile held by a binding | `ajv@8.20.0` and `ajv-formats@3.0.1` for its schema. For JSON-LD and SHACL steps, `jsonld@9.0.0`, `n3@2.13.12` and `shacl-engine@1.1.3`, installed [below](#install-the-validation-engines). The package depends on none of them. |
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
| Profile version | The number after `@` in `general@2`, and a payload's `profile_version` | The edition of a profile's field list. Supported manifest profiles: `general@2`, current, and `general@1`, superseded. Held by bundled bindings: `eu-battery@1`, `eu-textile@1`. Retired: `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4` ([retired profiles](#retired-profiles)) |
| Manifest format | A manifest's `manifestVersion`, `"1"` or `"2"` | The manifest file's layout. `general@1` and `general@2` use format 1. Format 2 adds value types and rules, and the only manifests published in it are retired drafts |
| Record version | A passport state's `version`, 1 or 2 | The passport record model, unrelated to profiles: a version 2 state can carry a `general@2` payload |

## Inspect applicable fields

`fieldsFor` lists applicable fields; `missingRequired` lists missing required fields. Applicability is unconditional, category-specific or subject to the profile's review condition.

1. Save this as `inspect-fields.mjs`:

```js
import { readManifest, fieldsFor, missingRequired } from '@bsv/dpp-profiles'

const manifest = readManifest('general@2')
console.log('categories:', manifest.applicability.categories.map(({ value }) => value).join(', '))
const fields = fieldsFor(manifest, 'furniture')
console.log('fields that apply to furniture:', fields.applies.length, '; need review:', fields.needsReview.length)
console.log('first three:', fields.applies.slice(0, 3).map(({ key, label, accessTier }) => `${key} (${label}, ${accessTier})`).join('; '))
const gaps = missingRequired(manifest, {}, 'furniture')
console.log('an empty payload lacks', gaps.missing.length, 'required fields, starting with', gaps.missing.slice(0, 3).map(({ key }) => key).join(', '))
```

2. Run `node inspect-fields.mjs`. Expected output:

```
categories: bicycle, watch, instrument, furniture, luggage, jewellery, appliance, sportsEquipment, artwork
fields that apply to furniture: 40 ; need review: 0
first three: name (Product name, public); category (Kind of object, public); manufacturer (Maker, public)
an empty payload lacks 6 required fields, starting with name, category, manufacturer
```

| Finding | Interpretation |
|---|---|
| `category` | Names one of the manifest's `applicability.categories`. The `general@2` list is open, so other text is accepted and cannot be labelled. |
| `missingRequired` | Checks presence of fields captured at registration only. It is neither schema validation nor product assessment. |
| `needsReview` | Show each field and its condition beside schema results. Never present it as satisfied. |

A format 2 manifest uses `readManifestAny`, `fieldsForV2` and `missingRequiredV2` with richer applicability context, and `compareProfiles(from, to)` reports version changes. `missingRequired`, `missingRequiredV2` and `reviewProfileData` throw `ProfileRetiredError` for a retired profile ([retired profiles](#retired-profiles)). [Authoring](../profiles/authoring.md) covers generation and freezing.

## Check a payload against its profile

Two readers return a profile's manifest:

| Function | Takes | Returns |
|---|---|---|
| `readManifest(profile)` | An identifier in `PROFILE_IDS`, such as `general@2`. The list holds every published manifest, the retired ones included, which are read as history | The frozen manifest as published, typed for format 1: a format 2 manifest comes back with keys the type does not name |
| `readManifestAny(profile)` | Any `id@version` identifier | The manifest in format 1 or 2, typed for both. It checks only the identifier's form, so check `PROFILE_IDS` first; an identifier the package does not hold fails with `ENOENT` |

Each manifest generates two JSON Schemas (2020-12):

| Function | Takes | Returns |
|---|---|---|
| `readPublicPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for a state's `payload_public`: every `public`-tier field |
| `readRestrictedPayloadSchema(profile)` | An identifier in `PROFILE_IDS` | The schema for the `owner`, `legitimate` and `authority` tiers together, in one object |

Outside `PROFILE_IDS`, `readManifest` and both schema readers throw `"<identifier>" is not a published industry profile`. `PROFILE_IDS` says what the package publishes, not what it validates: before you check a payload, hold its declared `profile` to `SUPPORTED_PROFILE_IDS`, and treat one in `RETIRED_PROFILE_IDS` as [retired](#retired-profiles).

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

4. To include validation in a report, pass `profilePayloadValidator(ajv)` as the policy's `payloadValidator` to `verifyPassportEvidence`. Use the same Ajv instance. The report hands the validator each state's `passportId` beside its payload, read from the decoded state. `profilePayloadValidator` takes it as an optional member of `PayloadToValidate` and ignores it, because a schema says nothing about which passport carries a payload; a validator of your own can use it to check that a product document inside the payload belongs to that passport.

| Token payload | Report's `schema` result |
|---|---|
| Declares a published profile and validates | `pass` |
| Declares a published profile and is invalid | `fail`, `schema-invalid`, with one sentence per problem |
| Declares a profile this package does not publish | `unknown`, `schema-unavailable` |
| Declares a retired profile | `unknown`, `schema-unavailable`, with `detail.cause` `profile-retired` and `detail.replacedBy`. Never `pass` and never `fail`, whatever the payload holds |
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
| Either command with a retired profile | `profile-retired`, the replacement, and exit status 2. Nothing is generated or checked |

## Validate a profile defined outside the package

A profile does not have to be one of the manifests this package publishes. A data model written elsewhere, as a JSON Schema, JSON-LD contexts or SHACL shapes, is held by a **binding**: one immutable JSON file per profile version. You register the binding and validate payloads against it without editing the package ([profiles](https://github.com/bsv-blockchain/dpp/blob/3f11c0b35300fe2169d7eb9f84d40c7b64a94c55/spec/profiles.md) section 7).

| Piece | What it is |
|---|---|
| Binding | A JSON file naming every file that defines the profile, the checks to run and how the product must match its passport. Schema: `@bsv/dpp-profiles/schemas/profile-binding-v1.schema.json` |
| Registry | `createProfileRegistry`: holds the bindings you trust and the supported manifest profiles, behind one `resolve(id, version)`. `status(id, version)` says whether an identifier is `registered`, `retired` or `unknown` |
| Validator | `bindingPayloadValidator`: the function a verifier passes as `payloadValidator`. It checks a public payload, which is what any reader has |
| Access split | A binding's optional `access` member: which top-level properties of the product document are public. `prepareBoundPayload` is the writer's call, and `authorisedPayloadValidator` checks both parts together ([split a product](#split-a-product-into-public-and-restricted-parts)) |
| Engine adapter | `@bsv/dpp-profiles/validation-engine`: JSON-LD and SHACL engines over libraries you install |
| Example profiles | `examples/custom-profile/` in the repository: `example-bottle@1` uses every step, `example-notebook@1` uses a schema only |
| Bundled bindings | `eu-battery@1` and `eu-textile@1`, shipped under `bindings/` with their artefacts and notices. `BUNDLED_BINDING_DIGESTS` is their trusted digest list and `registerBundledBindings(registry)` registers them from the package folder ([EU battery and textile bindings](../profiles/eu-sector-bindings.md)) |

### The payload under a binding

A state's `payload_public` under a binding is an envelope around one product document:

| Member | Value |
|---|---|
| `notice` | Optional, first, and only on a demonstration record: the sentence saying so |
| `profile`, `profile_version` | The binding's `id` and `version` |
| `profile_binding_sha256` | The binding digest: the SHA-256 of the binding file's exact bytes, in lower-case hexadecimal |
| `product` | The product document, unchanged. Under a binding with an `access` member, its public properties only |

No other member is allowed. Product data goes inside `product`. A payload that carries a member name twice, at any depth, is refused.

### Write a binding

A binding is format 1 when its `bindingVersion` is `"1"`. The file holds no digest of itself, and a changed binding is a new version.

| Member | What you write |
|---|---|
| `id`, `version`, `profile` | The identifier, a whole number from 1, and `id@version` |
| `title`, `scope` | A name, and one or more sentences saying what the name covers and what it does not claim |
| `publisher`, `source` | Who published the binding, and where the definitions come from with their licence and notice files |
| `granularity`, `payload` | `item`, and `{ "root": "/product", "mediaType": ..., "documents": "one-self-contained" }` |
| `artefacts` | One entry per file: `role` (`schema`, `context`, `shapes` or `background`), `path` relative to the binding, `mediaType`, `byteLength`, `sha256`, `licence`, and for a context the `uri` documents name it by |
| `validation.steps` | The checks in order, from `json-schema`, `json-ld-expand`, `shacl` and `passport-identity`. `passport-identity` is always listed, and `shacl` follows `json-ld-expand` |
| `validation.engine.requires` | Capabilities the engines must have: `json-schema-2020-12`, `shacl-core`, `shacl-sparql-constraints` |
| `validation.blockingSeverities` | Which SHACL severities fail the check, usually `["Violation"]`. Other findings are reported and do not block |
| `identity` | Where the product document states its identifier, its GTIN and serial, a coarser product link, its granularity and related model or batch identifiers |
| `access` | Optional. Which top-level properties are public; every other property is restricted ([split a product](#split-a-product-into-public-and-restricted-parts)). Without it the whole product document is public |
| `vectors` | The payloads your profile accepts and refuses, as files beside the binding |
| `baseline`, `roles` | The baseline the profile requires and the roles it binds |

`describeArtefact(bytes)` returns the `byteLength` and `sha256` an artefact entry records, and `profileBindingDigest(bytes)` returns the binding digest. In a checkout, `node examples/custom-profile.mjs --describe <file>...` prints the first for each file.

Give each binding's schema an `$id` of its own. A compiler holds one schema per `$id`, so a second binding that reuses one for other rules answers `unknown` on the compiler that already holds the first.

`readProfileBinding(bytes)` checks a binding without registering it: strict JSON, the format's structure (`profileBindingProblems`), then the rules that relate one member to another (`profileBindingInconsistencies`), such as a step with no artefact to read.

### Install the validation engines

The schema step uses the JSON Schema compiler you already supply. The `json-ld-expand` and `shacl` steps need three more libraries. Install them only where you validate such a profile:

```sh
npm install --save-exact jsonld@9.0.0 n3@2.13.12 shacl-engine@1.1.3
```

`VALIDATION_ENGINE_LIBRARIES` names these versions. The package lists none of them as a dependency, so a service that only reads token history installs nothing extra. Importing `@bsv/dpp-profiles/validation-engine` loads nothing. `createValidationEngine()` loads the libraries and rejects with `ValidationEngineUnavailableError`, naming the library, when one is missing.

| Option | Effect |
|---|---|
| `timeoutMs` | The limit for one expansion or one validation, 10 000 by default. A result that arrives after it is discarded and the step answers `unknown` |
| `sparql: false` | Builds the engine without SPARQL constraints. It declares `shacl-core` only, so a binding that requires `shacl-sparql-constraints` answers `unknown` |
| `load` | How a library is loaded by name. A bundler cannot follow the default dynamic import, so a bundled application passes a function that imports each name statically |

The adapter uses only the contexts the binding lists, refuses any other and never fetches. It keeps nothing between calls. The time limit is a deadline and cannot interrupt work that does not yield: run the engine in a worker you can stop if you must bound the time itself. To use another SHACL engine, implement `JsonLdEngine` and `ShaclEngine` and pass them in place of the adapter's.

### Register a profile and validate a payload

1. Save this as `check-custom-profile.mjs`:

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { bindingPayloadValidator, createProfileRegistry, profileBindingDigest } from '@bsv/dpp-profiles'
import { createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

const folder = process.argv[2]
const bindingBytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))

// Trust is a list of binding digests. This script trusts the one binding it was pointed at.
const registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(bindingBytes)] })
const registered = await registry.register({ bindingBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(folder, artefact.path))) })
if (!registered.ok) throw new Error(`${registered.code}: ${registered.detail}`)
console.log('registered', registered.profile.profile, 'with', registered.profile.artefacts.length, 'artefacts')

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = bindingPayloadValidator({ registry, engines: { jsonSchema: ajv, ...(await createValidationEngine()) } })

// The first vector the binding lists as accepted, and the first it lists as refused.
const { id, version, vectors } = registered.profile.binding
for (const path of [vectors.positive[0], vectors.negative[0]]) {
  const vector = JSON.parse(readFileSync(join(folder, path), 'utf8'))
  const result = await validate({ profile: id, profileVersion: version, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
  console.log([path, '=>', result.status, result.reasonCode, result.detail.cause].filter(Boolean).join(' '))
  for (const step of result.detail.steps) console.log(['  ' + step.step, step.status, ...(step.messages ?? [])].join(' '))
}
```

2. Run it against the example profile in a repository checkout, replacing `/absolute/path/to/dpp` with the checkout's absolute path: `node check-custom-profile.mjs /absolute/path/to/dpp/examples/custom-profile/example-bottle@1`. Expected output:

```
registered example-bottle@1 with 4 artefacts
vectors/item.json => pass
  envelope pass
  binding pass
  json-schema pass
  json-ld-expand pass
  shacl pass
  passport-identity pass
vectors/other-product.json => fail schema-invalid product-identity-mismatch
  envelope pass
  binding pass
  json-schema pass
  json-ld-expand pass
  shacl pass
  passport-identity fail The product document describes a different product from the passport that carries it.
```

The second payload satisfies every rule of the profile. It is another bottle's document, so the identity check refuses it.

3. In production, set `trustedBindingDigests` to the digests you reviewed and chose, never to whatever binding arrives. `resolveArtefact` is yours: read the files from disk, bundle them or fetch them. The registry checks every byte against the binding either way.

4. To include the check in a report, pass the same function as the policy's `payloadValidator` to `verifyPassportEvidence`. The report supplies each state's `passportId`. A manifest profile such as `general@2` resolves through the same registry, and the validator answers for it exactly as `profilePayloadValidator` does, so one function serves both formats.

| Checkout command | Expected result |
|---|---|
| `node examples/custom-profile.mjs` | Registers both example profiles from their folders and checks every vector they list, ending `Every sentence above holds.` |
| `node examples/custom-profile.mjs <folder>` | The same for a profile folder of your own that holds `binding.json` |

### Read the answer

A step that fails makes the answer `fail`. Otherwise a step that could not run makes it `unknown`. Only every step passing is `pass`. The report's vocabulary has two reason codes for a payload check, so `detail.cause` names the precise cause, and `detail.steps` lists every step with its messages and SHACL findings.

| `detail.cause` | Status and reason code | What happened |
|---|---|---|
| `envelope-invalid` | `fail`, `schema-invalid` | Not strict JSON, a member missing, or a member the envelope does not define |
| `profile-binding-mismatch` | `fail`, `schema-invalid` | The payload declares another binding digest. Nothing after it is checked |
| `schema-invalid` | `fail`, `schema-invalid` | The product does not validate against the binding's JSON Schema |
| `profile-rule-violation` | `fail`, `schema-invalid` | An unlisted context, a document its contexts do not define, or a SHACL finding of a blocking severity |
| `product-identity-mismatch` | `fail`, `schema-invalid` | The product document is not about the passport's item |
| `profile-unknown` | `unknown`, `schema-unavailable` | The registry holds no such profile |
| `profile-retired` | `unknown`, `schema-unavailable` | The payload declares a [retired profile](#retired-profiles). No step ran, `detail.steps` is empty and `detail.replacedBy` names the replacement |
| `validator-unavailable` | `unknown`, `schema-unavailable` | No engine, an engine without a required capability, a timeout or an engine error |
| `product-identity-unavailable` | `unknown`, `schema-unavailable` | No `passportId` was supplied, or an identifier is in a form the rules do not read |
| `restricted-property-disclosed` | `fail`, `schema-invalid` | The public payload carries a property the binding does not list as public. Nothing after it is checked |
| `product-assembly-refused` | `fail`, `schema-invalid` | The authorised view could not rejoin the two parts. The `assembly` step's `refusal` is the code |
| `restricted-tier-withheld` | `unknown`, `schema-unavailable` | A rule needs a restricted property, which a public payload does not carry. `detail.access.withheld` lists each such rule |

Each entry of a `shacl` step's `findings` carries `severity`, `constraint`, `focusNode`, `path`, `message` and `value`, where the engine reports them. A warning under a binding that blocks on violations only appears there and the step still passes.

Under a binding with an `access` member, `detail.access` carries the `policy`, the `view` that was checked (`public`, `authorised` or, for a writer, `whole`) and `withheld`, the rules that view could not decide.

### How the product must match the passport

The expected identity is the `passportId` you supply, never anything in the payload. `checkProductIdentity({ payload, identity, passportId })` applies the rules on their own.

| The product document | Result |
|---|---|
| Names the passport's GTIN and serial, at any host | `pass` |
| Writes the GTIN with 8, 12, 13 or 14 digits | Compared at fourteen digits |
| Names another serial or GTIN, or differs only in case or by a space | `fail` |
| States a GTIN or serial member that differs from its own identifier | `fail` |
| Carries a product link at model level with the same GTIN | Accepted: coarser is not a contradiction |
| Carries a product link to another product | `fail` |
| Identifies a model or a batch, or declares a granularity other than `item` | `fail` |
| Has a GTIN with a wrong check digit | `fail` |
| Uses a compressed link, another primary key or a non-GS1 identifier | `unknown` |
| Is checked with no `passportId` | `unknown` |

### Split a product into public and restricted parts

A state has a public payload, on chain and readable by anyone for good, and a restricted part that its owner encrypts and keeps off chain ([record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md#7-the-owner-tier-binding) section 7). A binding with an `access` member says which top-level properties of the product document are public ([profiles](https://github.com/bsv-blockchain/dpp/blob/3f11c0b35300fe2169d7eb9f84d40c7b64a94c55/spec/profiles.md) section 7):

```json
"access": {
  "policy": "example-access@1",
  "tierSplit": "top-level-property",
  "default": "restricted",
  "public": ["@context", "id", "@id", "type", "@type", "name", "gtin", "serialNumber"]
}
```

| Rule | Detail |
|---|---|
| Unit | A top-level property of the product document is wholly public or wholly restricted. Nothing is split inside a nested object or a list |
| Default | A property `public` does not list is restricted, one the binding has never heard of included |
| Names | A name matches exactly as a document writes it. List both spellings where a document may use either, such as `id` and `@id` |
| Required entries | Every property the identity rules read, and `@context` for a JSON-LD profile. A binding without them is refused as `binding-inconsistent`. List the node's type as well, so a reader's shapes still select the product |
| Commitment | The list is in the binding, so the `profile_binding_sha256` a payload declares also commits to which properties were public |
| No `access` | One tier: the whole product document is public, as before |

The two bundled bindings carry such a list ([which properties are public](../profiles/eu-sector-bindings.md#which-properties-are-public)), and that page has a complete script.

#### Prepare a payload

`prepareBoundPayload` is the writer's one call before a state is issued or updated. It validates the whole document, splits it, builds the public payload as the exact text to sign, holds that text to 65,535 bytes of UTF-8, and checks it once more the way any reader will. It issues, signs, encrypts and stores nothing.

**Fragment, not runnable alone:** supply a `registry` and `engines` as in [register a profile and validate a payload](#register-a-profile-and-validate-a-payload), the complete `product` document and the `passportId` of the passport that will carry it.

```js
import { prepareBoundPayload } from '@bsv/dpp-profiles'

const prepared = await prepareBoundPayload({ registry, engines, profile: 'eu-battery', profileVersion: 1, product, passportId })
if (!prepared.ok) throw new Error(`${prepared.code}: ${prepared.detail}`)
const { payloadPublic, restrictedProduct, validation, publicView } = prepared
```

| Member | What it is |
|---|---|
| `payloadPublic`, `byteLength` | The public payload: the exact text to write as `payload_public` and to sign, and its size in UTF-8 bytes |
| `restrictedProduct` | The restricted part, for you to encrypt and keep off chain: the product's identifier, then every restricted property. Absent when the document has none |
| `validation` | The check of the whole document. Its status is `pass` |
| `publicView` | The check any reader will make of `payloadPublic`: `pass`, or `unknown` with the rules it cannot decide |

Pass `notice` for a demonstration record, and it is written first. A refusal is returned, never thrown:

| `code` | Cause |
|---|---|
| `validation-failed` | The whole document fails a check. `validation` names it |
| `validation-unavailable` | A check could not run: no engine, a missing capability, a timeout, an unregistered profile or no `passportId`. A check that could not run is not a pass, so nothing is prepared |
| `public-payload-too-large` | The public payload is over 65,535 bytes. `byteLength` is its actual size. The restricted part does not count |
| `public-view-failed` | The whole document passes and its public part alone fails a rule, which every reader would see. `publicView` names it |
| `profile-not-bound` | The identifier names a manifest-format profile, which has no binding |
| `profile-retired` | The identifier names a [retired profile](#retired-profiles). Nothing is prepared under one |

#### Validate by view

| You hold | Call | It checks |
|---|---|---|
| The public payload | `bindingPayloadValidator({ registry, engines })` | The payload as a projection of the whole document. This is what a report runs |
| Both parts | `authorisedPayloadValidator({ registry, engines })`, with `restrictedProduct` beside the payload | The envelope and the binding digest, then the two parts rejoined, through every step and the identity check |

| Public view | Result |
|---|---|
| Carries a property the binding does not list as public | `fail`, `restricted-property-disclosed`. The answer names the property and does not repeat its value |
| A rule misses only a restricted property: a minimum count on the product itself, or a required top-level schema property | Withheld, not failed. The answer is `unknown`, `restricted-tier-withheld`, and lists the rule |
| Breaks any other rule, or leaves out a public property a rule requires | `fail`, as for any payload |
| Every rule could be evaluated and held | `pass` |

A public `pass` covers the rules the public payload could break. It says nothing about the restricted properties: a fault inside one is invisible to this view, and only the writer's check and the authorised view find it.

In the authorised view, omit `restrictedProduct` only for a state that has no restricted part. Parts that do not rejoin fail with `product-assembly-refused`, and the `assembly` step's `refusal` names the code below.

A `pass` in the authorised view says the rejoined document satisfies the profile. It is not evidence that the restricted part is the one the record commits to. Compare the stored blob with the record's `payload_owner_hash` first, as the [record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md#7-the-owner-tier-binding) requires. Nothing in this package makes or replaces that comparison.

#### Split and rejoin on their own

`splitProductByAccess({ binding, product })` returns `{ publicProduct, restrictedProduct }` and changes nothing it is given. It validates nothing, so validate first. It throws a `TypeError` for a product that is not an object, and for one with restricted properties and no identifier.

`assembleProduct({ binding, publicProduct, restrictedProduct })` returns `{ ok: true, product }`: the public properties in their order, then the restricted ones, so the same parts always give the same JSON text. The result is for validation and display. It is not what was signed. A refusal is `{ ok: false, code, detail }`:

| `code` | Cause |
|---|---|
| `part-not-an-object` | A part is not one JSON object. `part` says which |
| `join-key-missing` | A part does not carry the product's identifier. `part` says which |
| `restricted-part-names-another-product` | The restricted part carries another product's identifier |
| `property-in-both-parts` | A property other than the identifier sits in both parts |
| `restricted-property-in-public-part` | The public part carries a property the binding does not list as public |
| `public-property-in-restricted-part` | The restricted part carries a property the binding lists as public |

### When registration is refused

`register` returns `{ ok: false, code, detail }` with one code per cause, and never throws for these:

| `code` | Cause |
|---|---|
| `binding-untrusted` | The binding's digest is not on the trusted list. Nothing else about it was read |
| `binding-not-json`, `binding-invalid`, `binding-inconsistent` | Not strict JSON, not the format's structure, or members that contradict one another |
| `binding-conflict` | Another binding with a different digest already answers for this `id` and `version`. Registering the same bytes again succeeds with `alreadyRegistered: true` |
| `profile-held-by-manifest` | The identifier and version belong to a supported manifest this package publishes |
| `profile-retired` | The identifier and version belong to a [retired profile](#retired-profiles), whose identity is never given another definition |
| `artefact-unavailable`, `artefact-length-mismatch`, `artefact-digest-mismatch` | A listed file was not supplied, or is not the file the binding records. `artefact` names it |

## Retired profiles

The sector profiles first published as manifests are retired from 14 November 2026 ([profiles](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md), the section on versions, freezing, retirement and migration). Retiring a profile changes what the package does with it and nothing it says.

| Export | What it is |
|---|---|
| `RETIRED_PROFILE_IDS` | The one list: `battery@2`, `battery@3`, `battery@4`, `textile@1`, `textile@2`, `textile@3`, `textile@4` |
| `RETIRED_PROFILE_REPLACEMENTS` | The replacement of each: `eu-battery@1` or `eu-textile@1` |
| `SUPPORTED_PROFILE_IDS` | The manifest profiles a payload is written and validated under: `general@2` and `general@1` |
| `isRetiredProfile(profile)`, `assertProfileNotRetired(profile)` | The test, and the same test as a throw |
| `ProfileRetiredError` | What a helper throws: `code` is `profile-retired`, with `profile` and `replacedBy` |
| `PROFILE_RETIRED` | The string `profile-retired`: the refusal code and the validation cause |

| Asked to | These answer |
|---|---|
| Validate a payload that declares a retired profile: `profilePayloadValidator`, `bindingPayloadValidator`, `authorisedPayloadValidator` | `unknown`, `schema-unavailable`, with `detail` `{ profile, cause: 'profile-retired', replacedBy, steps: [] }`. The answer is the same for a payload the frozen schema would accept, one it would refuse and text that is not JSON |
| Prepare a payload: `prepareBoundPayload` | `{ ok: false, code: 'profile-retired' }` |
| Check or review data before writing: `missingRequired`, `missingRequiredV2`, `reviewProfileData` | Throw `ProfileRetiredError` |
| Project a passport: `projectPassport` | Throws `ProfileRetiredError` |
| Select it: `checkSelection` | The conflict `industry-retired`, for every purpose |
| Register a binding under its identifier: `registry.register` | `{ ok: false, code: 'profile-retired' }` |
| Resolve it: `registry.resolve`, `registry.list` | `undefined`, and not listed. `registry.status` answers `{ state: 'retired', profile, replacedBy }` |

These still read a retired profile. They are historical: each returns or describes a frozen definition and judges no payload.

| Function | Why it still reads |
|---|---|
| `readManifest`, `readManifestAny`, `readPublicPayloadSchema`, `readRestrictedPayloadSchema`, `readConsumerDocument`, `readFrozen` | Each returns a frozen file. The same files are data entry points of the package |
| `fieldsFor`, `fieldsForV2`, `evaluateFieldApplicability`, `categoryOf` | Each describes which fields a definition applies. None checks a payload for writing |
| `compareProfiles` | A structural difference between two frozen manifests |
| `mapNativeOperation` | Names the external event a native operation corresponds to under a manifest's event mappings. It reads no payload value and passes none |

A retired manifest keeps the `status` it was frozen with, such as `current` or `draft`, because the file is immutable. Read retirement from `RETIRED_PROFILE_IDS`, never from that member. There is no converter and no reader of the retired rules: a product moves to a replacement as a newly issued passport ([move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles)).

## Show a stored payload under its profile

Show data under the profile its record declares, a superseded one included, never a newer one. A record that declares a retired profile is shown as unsupported, without labels from the retired manifest.

1. Save this as `show-payload.mjs`:

```js
import { Beef } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs } from '@bsv/dpp-protocol'
import { SUPPORTED_PROFILE_IDS, describeRetiredProfile, isRetiredProfile, readManifestAny } from '@bsv/dpp-profiles'

const index = 'https://dpp-overlay.bsvb.net'
const passportId = 'https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8'

// Fetch the passport's states and take the latest one's public payload.
const { outputs } = await (await fetch(`${index}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })).json()
if (outputs.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
const merged = Beef.fromBinary(outputs[0].beef)
for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
const tip = chainFromBeef(merged, passportId).at(-1)
const payload = JSON.parse(findDppOutputs(tip)[0].state.payloadPublic)

// The profile the record declares is the record's word: check it is one this package supports before reading it.
const declared = `${payload.profile}@${payload.profile_version}`
if (isRetiredProfile(declared)) {
  // Unsupported: say so, and label nothing from the retired manifest.
  console.log(describeRetiredProfile(declared))
  process.exit(0)
}
if (!SUPPORTED_PROFILE_IDS.includes(declared)) throw new Error(`${declared} is not a profile this package supports`)
const manifest = readManifestAny(declared)
console.log(declared, manifest.status, manifest.title)

// Label each value with its field's label in that profile; the first three here.
for (const field of manifest.fields.filter(({ key }) => key in payload).slice(0, 3)) {
  console.log(`  ${field.label}: ${JSON.stringify(payload[field.key])}`)
}
```

2. Run `node show-payload.mjs`. This demonstration passport declares `battery@4`, which is retired, so the expected output is:

```
battery@4 is retired: nothing is issued or validated under it, and a record that declares it is reported as unsupported. eu-battery@1 replaces it, and there is no converter.
```

For a passport that declares `general@2`, the script prints the profile, its status and title, then three labelled values.

3. Apply these display rules:

| Condition | Required action |
|---|---|
| Any `notice` | Show it before product data. |
| Profile in `RETIRED_PROFILE_IDS` | Say that the profile is retired and name its replacement. Do not label the values. |
| `manifest.status` is `superseded` | Say so beside the data. |
| Latest state decoded by this example | Verify it before relying on it; see [gather a passport's evidence](dpp-protocol.md#gather-a-passports-evidence). Decoding alone does not verify. |
| Profile outside `SUPPORTED_PROFILE_IDS` and not retired | Cannot label: show unlabelled values or no values. |

## Read a field

Each `manifest.fields` entry describes one value. `general@2` uses these format 1 properties:

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
| `group`, `parts` | A group identifier; for a `record`, its parts | The form section, one of the manifest's `groups`, and a `record`'s inputs |

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

The package computes data-file paths in its own directory at call time; bundlers and file tracers cannot follow them. A deployment that registers the bundled bindings adds `bindings` to the folder list above, or names the folder it copied them to in the `directory` option of `registerBundledBindings`.

| Next.js 16 production configuration | Result |
|---|---|
| Bundle the package | Every data file is left behind. |
| Mark external only | Manifests are traced, generated schemas are not. `readPublicPayloadSchema` fails with `ENOENT` only after deployment; the route answers 500. |
| Standalone build with the configuration above | Includes the data files and serves the schema. |

## Choose an entry point

| Entry point | Use |
|---|---|
| `@bsv/dpp-profiles` | Manifest access, applicability, mapping, identifier and projection helpers, the profile registry and the binding validator, in Node |
| `@bsv/dpp-profiles/validation-engine` | JSON-LD and SHACL engines for profiles held by a binding, in Node. Loads its libraries only when `createValidationEngine` is called |
| `@bsv/dpp-profiles/manifests/*` | Profile manifests, as JSON |
| `@bsv/dpp-profiles/schemas/*` | Manifest, binding and supporting schemas |
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
| Move off a retired sector profile | [Move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles) |
