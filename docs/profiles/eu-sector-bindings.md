# EU battery and textile bindings

Passport writers and readers can use this page to write and check a payload under `eu-battery@1` or `eu-textile@1`. Each is a data model defined outside `@bsv/dpp-profiles`, as JSON-LD contexts and SHACL shapes, and held by a [binding](../packages/dpp-profiles.md#validate-a-profile-defined-outside-the-package) that the package ships.

The name of each profile states which data model the product document uses. It makes no claim that a passport or its product complies with Regulation (EU) 2023/1542, Regulation (EU) 2024/1781, Regulation (EU) No 1007/2011 or any other law. A `pass` says the document has the profile's shape and describes the passport's item, and nothing more.

The contexts and shapes of both profiles are unmodified files published by the OpenEPCIS DPP-Ready project under the Apache License, Version 2.0, pinned at its release 0.13.1, and the `NOTICE.md` beside each binding lists every file with its source path and digest.

## Before you start

| Task | Input and source |
|---|---|
| Run the example | Node.js 22 or later and a [repository checkout](../quick-start.md) prepared with `npm ci` and `npm run build`; run commands at its root |
| Validate in your own project | `@bsv/dpp-profiles` from a publication that carries `bindings/`, and the three engine libraries from [install the validation engines](../packages/dpp-profiles.md#install-the-validation-engines). The bindings are in the unpublished candidate `dpp-release-2026-11`; until it is published, use the checkout |
| Write a payload | A product document in the profile's data model, and the identifier of the passport that will carry it |

## The two profiles

| Profile | Product document | Binding digest |
|---|---|---|
| `eu-battery@1` | Battery passport data for one serialised item | `681c0e2b65ad2cf36a4d9477ec6942343a5c241405e44634a35caebbab3e0d1c` |
| `eu-textile@1` | Textile passport data for one serialised item | `4c35aa8dafd58d32884b4e6ef111514e48d9062a682e8854eedaf96663af1bee` |

| Both bindings | Value |
|---|---|
| Granularity | `item` only. A document about a model or a batch is refused |
| Files | Four contexts, one shapes file and one background file, in `bindings/<profile>/` inside the package, each held to the byte length and SHA-256 its `binding.json` records |
| Checks, in order | `json-ld-expand`, `shacl`, `passport-identity` |
| Engines required | `shacl-core` and `shacl-sparql-constraints`. An engine without SPARQL constraints answers `unknown`, never `pass` |
| Findings that block | Violations. Warnings and information findings are reported and do not block |
| Network | None. The contexts are read from the package, and a context the binding does not list is refused |

`battery@2` and `textile@2` stay the current manifest profiles ([choose an industry profile](README.md)). These bindings are separate profiles with their own identifiers, and a record is read under the one it declares.

## What a payload looks like

A state's `payload_public` under either profile is the [binding envelope](../packages/dpp-profiles.md#the-payload-under-a-binding) around one product document:

```json
{
  "profile": "eu-battery",
  "profile_version": 1,
  "profile_binding_sha256": "681c0e2b65ad2cf36a4d9477ec6942343a5c241405e44634a35caebbab3e0d1c",
  "product": {
    "@context": ["<core context URI>", "<battery context URI>"],
    "id": "https://id.example/01/09521234002000/21/STAX10-2026-000001",
    "type": ["gs1:Product", "eubat:Battery"],
    "oec:granularityLevel": "item",
    "gs1:gtin": "09521234002000",
    "gs1:hasSerialNumber": "STAX10-2026-000001",
    "eubat:batteryModelIdentifier": "AMP-STAX-10"
  }
}
```

| Rule | Detail |
|---|---|
| Contexts | `product` names its contexts by URI, and only by the URIs the binding lists: the `uri` of each `context` entry in `binding.json`. The example shows two as placeholders. A context written into the document, or any other URI, is refused |
| Members | Every member of `product` must be defined by the contexts it names. A member they do not define, such as a `_comment` note, is refused, so remove such notes before writing |
| `product` | The product document, unchanged otherwise. Product data never sits beside it in the envelope |
| `notice` | Optional, first, and only on a demonstration record |
| Size | A version 2 state holds at most 65,535 bytes of `payload_public`. The four documents the tests use are 727 to 28,157 bytes minified in the envelope |

This example is abbreviated: the shapes require more members than it shows. Print the context URIs of a registered binding with `registry.resolve('eu-battery', 1).binding.artefacts.filter((a) => a.role === 'context').map((a) => a.uri)`.

## Register the bindings and validate

`BUNDLED_BINDING_DIGESTS` is the list of digests the package publishes for its own bindings. A registry trusts the bundled bindings only when you give it that list. `registerBundledBindings(registry)` then reads each binding from the package folder, checks it against the pinned digest and registers it. Importing the package reads none of these files.

1. Save this as `check-sector-profile.mjs` at the root of the checkout:

```js
import { readFileSync } from 'node:fs'
import { BUNDLED_BINDING_DIGESTS, bindingPayloadValidator, buildGs1DigitalLink, createProfileRegistry, parseGs1DigitalLink, registerBundledBindings } from '@bsv/dpp-profiles'
import { createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

// Trust is a list of binding digests. This registry trusts the bindings the package ships, and no others.
const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
for (const registered of await registerBundledBindings(registry)) {
  if (!registered.ok) throw new Error(`${registered.code}: ${registered.detail}`)
  console.log('registered', registered.profile.profile, 'with', registered.profile.artefacts.length, 'artefacts')
}
const validate = bindingPayloadValidator({ registry, engines: await createValidationEngine() })

// The product document, less the note members its contexts do not define.
const document = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const product = Object.fromEntries(Object.entries(document).filter(([name]) => !name.startsWith('_comment')))
const { bindingDigest } = registry.resolve('eu-battery', 1)
const payloadPublic = JSON.stringify({ profile: 'eu-battery', profile_version: 1, profile_binding_sha256: bindingDigest, product })

// The passport's own identifier: the product's GTIN and serial under the writer's host. Then another item's.
const { gtin, serial } = parseGs1DigitalLink(product.id)
for (const passportId of [buildGs1DigitalLink('passports.example', gtin, serial), buildGs1DigitalLink('passports.example', gtin, 'ANOTHER-ITEM')]) {
  const result = await validate({ profile: 'eu-battery', profileVersion: 1, payloadPublic, passportId })
  console.log([passportId, '=>', result.status, result.reasonCode, result.detail.cause].filter(Boolean).join(' '))
  for (const step of result.detail.steps) console.log(['  ' + step.step, step.status, ...(step.messages ?? [])].join(' '))
}
```

2. Run it against one of the battery documents the tests use: `node check-sector-profile.mjs "packages/dpp-profiles/test/fixtures/sector-bindings/eu-battery@1/vectors/amperia-staxwall-item.jsonld"`. Expected output:

```
registered eu-battery@1 with 6 artefacts
registered eu-textile@1 with 6 artefacts
https://passports.example/01/09521234002000/21/STAX10-2026-000001 => pass
  envelope pass
  binding pass
  json-ld-expand pass
  shacl pass
  passport-identity pass
https://passports.example/01/09521234002000/21/ANOTHER-ITEM => fail schema-invalid product-identity-mismatch
  envelope pass
  binding pass
  json-ld-expand pass
  shacl pass
  passport-identity fail The product document describes a different product from the passport that carries it.
```

The second check uses the same valid document under another item's passport. It satisfies every rule of the data model, and the identity check refuses it.

3. To trust bindings of your own as well, pass their digests beside the list: `createProfileRegistry({ trustedBindingDigests: [...BUNDLED_BINDING_DIGESTS, ownDigest] })`.

4. To include the check in a report, pass the same function as the policy's `payloadValidator` to `verifyPassportEvidence`, which supplies each state's `passportId` ([read the answer](../packages/dpp-profiles.md#read-the-answer)).

| `registerBundledBindings` option | Effect |
|---|---|
| `profiles` | Registers only the named profiles, such as `['eu-textile@1']`. Default: both |
| `directory` | A `file:` URL of the folder that holds the binding folders. Default: the package's own `bindings/`. Name it when a bundler moved the data files |

It returns one result per profile and does not throw for a refusal. A refused profile stays unknown to the registry, so a payload under it answers `unknown`.

| `code` | Cause |
|---|---|
| `bundled-binding-unavailable` | `binding.json` could not be read from the folder |
| `bundled-binding-altered` | `binding.json` is not the file the package pins. It is refused even by a registry that trusts the changed file |
| `binding-untrusted` | The registry was not given the binding's digest |
| `artefact-unavailable`, `artefact-length-mismatch`, `artefact-digest-mismatch` | A context, shapes or background file is missing or is not the file the binding records. `artefact` names it |

With a bundler, keep the package external and include `bindings/**` with the other data files ([deploy it with a bundler](../packages/dpp-profiles.md#deploy-it-with-a-bundler)).

## What the identity check enforces

The expected identity is the `passportId` you supply, never anything in the payload ([how the product must match the passport](../packages/dpp-profiles.md#how-the-product-must-match-the-passport)). Under these two bindings it reads these members of `product`:

| Member | Rule |
|---|---|
| `id` or `@id` | The subject. A GS1 Digital Link with primary key 01 and a serial under 21. Its GTIN and serial must equal the passport's. The host is not compared. Both present must be the same text |
| `gs1:gtin` | Where present, must equal the subject's GTIN |
| `gs1:hasSerialNumber`, `schema:serialNumber` | Where present, each must equal the subject's serial |
| `oec:passportIdentifier`, `gs1:productID` | Where present, must not contradict the subject: the same GTIN, and the same serial if it carries one. A link at model level to the same product is accepted |
| `oec:granularityLevel` | Where present, must be `item` |
| `eubat:batteryModelIdentifier` | Batteries only. A related model identity, never compared as the subject |

| Case | Result |
|---|---|
| Another product's valid document under this passport | `fail`, `product-identity-mismatch` |
| A serial or a GTIN member that differs from the document's own identifier | `fail`, `product-identity-mismatch` |
| A document whose identifier names a model or a batch | `fail`, `product-identity-mismatch` |
| No `passportId` supplied | `unknown`, `product-identity-unavailable` |

The shapes check granularity as well, with a SPARQL constraint: the declared level must match the identifier the document states. That is why both bindings require `shacl-sparql-constraints`, and why an engine without it cannot give a `pass`.

## If something fails

- `fail` at `json-ld-expand` naming `_comment` or another property: the document carries a member its contexts do not define. Remove it or define it in a context the binding lists.
- `fail` at `json-ld-expand` naming a context: the document names a context outside the binding.
- `unknown` with `validator-unavailable`: an engine is missing, lacks SPARQL constraints, timed out or failed. Install the libraries and build the engine with `createValidationEngine()`.
- `unknown` with `profile-unknown`: the bindings were not registered, or a registration was refused. Read the results of `registerBundledBindings`.

## Sources

| Material | Where |
|---|---|
| Bindings, artefacts and notices | `packages/dpp-profiles/bindings/eu-battery@1/` and `packages/dpp-profiles/bindings/eu-textile@1/` in the repository; `bindings/` in the package |
| Licence and third-party terms | [Licence and reuse](../contribute/licence.md) |
| Test documents and the cases the tests refuse | `packages/dpp-profiles/test/fixtures/sector-bindings/` in the repository. They are not part of the package |
| Binding format, registry and validator | [Validate a profile defined outside the package](../packages/dpp-profiles.md#validate-a-profile-defined-outside-the-package) |

## Next

Put the payload in a passport with [build an application](../packages/build-an-application.md). To hold a data model of your own the same way, [write a binding](../packages/dpp-profiles.md#write-a-binding).
