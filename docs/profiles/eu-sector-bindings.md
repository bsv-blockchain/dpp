# EU battery and textile bindings

Passport writers and readers can use this page to write and check a payload under `eu-battery@1` or `eu-textile@1`. Each is a data model defined outside `@bsv/dpp-profiles`, as JSON-LD contexts and SHACL shapes, and held by a [binding](../packages/dpp-profiles.md#validate-a-profile-defined-outside-the-package) that the package ships.

The name of each profile states which data model the product document uses. It makes no claim that a passport or its product complies with Regulation (EU) 2023/1542, Regulation (EU) 2024/1781, Regulation (EU) No 1007/2011 or any other law. A `pass` says the document has the profile's shape and describes the passport's item, and nothing more.

Both bindings split the product document in two. The properties each lists as public go in the public payload, on chain, where anyone can read them for good. Every other property is restricted: you encrypt it and keep it off chain for authorised readers ([which properties are public](#which-properties-are-public)).

The contexts and shapes of both profiles are unmodified files published by the OpenEPCIS DPP-Ready project under the Apache License, Version 2.0, pinned at its release 0.13.1, and the `NOTICE.md` beside each binding lists every file with its source path and digest.

## Before you start

| Task | Input and source |
|---|---|
| Run the example | Node.js 22 or later and a [repository checkout](../quick-start.md) prepared with `npm ci` and `npm run build`; run commands at its root |
| Validate in your own project | `@bsv/dpp-profiles` from a publication that carries `bindings/`, and the three engine libraries from [install the validation engines](../packages/dpp-profiles.md#install-the-validation-engines). The bindings are in the unpublished candidate `dpp-release-2026-11`; until it is published, use the checkout |
| Write a payload | A complete product document in the profile's data model, and the identifier of the passport that will carry it |
| Try both profiles in an application | The application starter's source candidate, which has a form for each and reads them back ([product documents under a binding](../packages/create-dpp-app.md#product-documents-under-a-binding)) |

## The two profiles

| Profile | Product document | Binding digest |
|---|---|---|
| `eu-battery@1` | Battery passport data for one serialised item | `89c5687f441926e8af37696a8f703342364e060f71d817badf3e1366043010b4` |
| `eu-textile@1` | Textile passport data for one serialised item | `8bccb7952d24180327a318772a2462141c4b84a37f1b16f0b9eee131e362d994` |

| Both bindings | Value |
|---|---|
| Granularity | `item` only. A document about a model or a batch is refused |
| Files | Four contexts, one shapes file and one background file, in `bindings/<profile>/` inside the package, each held to the byte length and SHA-256 its `binding.json` records |
| Checks, in order | `json-ld-expand`, `shacl`, `passport-identity` |
| Tiers | Public and restricted, split by top-level property. A property the binding does not list as public is restricted |
| Engines required | `shacl-core` and `shacl-sparql-constraints`. An engine without SPARQL constraints answers `unknown`, never `pass` |
| Findings that block | Violations. Warnings and information findings are reported and do not block |
| Network | None. The contexts are read from the package, and a context the binding does not list is refused |

`battery@2` and `textile@2` stay the current manifest profiles ([choose an industry profile](README.md)). These bindings are separate profiles with their own identifiers, and a record is read under the one it declares.

## What a payload looks like

A state's `payload_public` under either profile is the [binding envelope](../packages/dpp-profiles.md#the-payload-under-a-binding) around the public properties of one product document:

```json
{
  "profile": "eu-battery",
  "profile_version": 1,
  "profile_binding_sha256": "89c5687f441926e8af37696a8f703342364e060f71d817badf3e1366043010b4",
  "product": {
    "@context": ["<core context URI>", "<battery context URI>"],
    "id": "https://id.example/01/09521234002000/21/STAX10-2026-000001",
    "type": ["gs1:Product", "eubat:Battery"],
    "oec:granularityLevel": "item",
    "schema:schemaVersion": "1.3",
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
| `product` | The public properties of the product document, in the document's order and unchanged otherwise. A property the binding does not list as public is refused here as a disclosure. Product data never sits beside `product` in the envelope |
| `notice` | Optional, first, and only on a demonstration record |
| Size | A version 2 state holds at most 65,535 bytes of `payload_public`. The public payloads of the four documents the tests use are 727 to 19,632 bytes minified, with the notice. The whole documents would be 727 to 28,157 |

This example is abbreviated: the shapes require more members than it shows. Do not build the payload by hand. `prepareBoundPayload` validates the whole document, splits it and returns the exact text, as the next section shows. Print the context URIs of a registered binding with `registry.resolve('eu-battery', 1).binding.artefacts.filter((a) => a.role === 'context').map((a) => a.uri)`.

## Register the bindings, prepare a payload and validate

`BUNDLED_BINDING_DIGESTS` is the list of digests the package publishes for its own bindings. A registry trusts the bundled bindings only when you give it that list. `registerBundledBindings(registry)` then reads each binding from the package folder, checks it against the pinned digest and registers it. Importing the package reads none of these files.

1. Save this as `check-sector-profile.mjs` at the root of the checkout:

```js
import { readFileSync } from 'node:fs'
import { BUNDLED_BINDING_DIGESTS, authorisedPayloadValidator, bindingPayloadValidator, buildGs1DigitalLink, createProfileRegistry, parseGs1DigitalLink, prepareBoundPayload, registerBundledBindings } from '@bsv/dpp-profiles'
import { createValidationEngine } from '@bsv/dpp-profiles/validation-engine'

// Trust is a list of binding digests. This registry trusts the bindings the package ships, and no others.
const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
for (const registered of await registerBundledBindings(registry)) {
  if (!registered.ok) throw new Error(`${registered.code}: ${registered.detail}`)
  console.log('registered', registered.profile.profile, 'with', registered.profile.artefacts.length, 'artefacts')
}
const engines = await createValidationEngine()

// The product document, less the note members its contexts do not define.
const document = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const product = Object.fromEntries(Object.entries(document).filter(([name]) => !name.startsWith('_comment')))
// The passport's own identifier: the product's GTIN and serial under the writer's host.
const { gtin, serial } = parseGs1DigitalLink(product.id)
const passportId = buildGs1DigitalLink('passports.example', gtin, serial)

// The writer validates the whole document, splits it and builds the public payload.
const prepared = await prepareBoundPayload({ registry, engines, profile: 'eu-battery', profileVersion: 1, product, passportId })
if (!prepared.ok) throw new Error(`${prepared.code}: ${prepared.detail}`)
console.log('whole document', prepared.validation.status)
console.log('public payload', prepared.byteLength, 'bytes:', Object.keys(JSON.parse(prepared.payloadPublic).product).join(', '))
console.log('restricted part:', Object.keys(prepared.restrictedProduct ?? {}).join(', '))

const show = (label, result) => {
  console.log([label, '=>', result.status, result.reasonCode, result.detail.cause].filter(Boolean).join(' '))
  for (const step of result.detail.steps) console.log(['  ' + step.step, step.status, ...(step.messages ?? [])].join(' '))
}
const payload = { profile: 'eu-battery', profileVersion: 1, payloadPublic: prepared.payloadPublic }

// Any reader has the public payload alone. Checked under this passport, then under another item's.
const validate = bindingPayloadValidator({ registry, engines })
show('public view', await validate({ ...payload, passportId }))
show('public view, another passport', await validate({ ...payload, passportId: buildGs1DigitalLink('passports.example', gtin, 'ANOTHER-ITEM') }))

// An authorised reader holds the restricted part as well, and checks the two rejoined.
show('authorised view', await authorisedPayloadValidator({ registry, engines })({ ...payload, passportId, restrictedProduct: prepared.restrictedProduct }))
```

2. Run it against one of the battery documents the tests use: `node check-sector-profile.mjs "packages/dpp-profiles/test/fixtures/sector-bindings/eu-battery@1/vectors/amperia-staxwall-item.jsonld"`. Expected output:

```
registered eu-battery@1 with 6 artefacts
registered eu-textile@1 with 6 artefacts
whole document pass
public payload 756 bytes: @context, id, type, oec:granularityLevel, schema:schemaVersion, oec:hasReportingGranularity, eubat:batteryModelIdentifier, gs1:hasSerialNumber, oec:lastUpdated, gs1:gtin, schema:serialNumber, oec:passportStatus
restricted part: id, schema:status, eubat:puttingIntoService, eubat:hasBatteryState
public view => pass
  envelope pass
  binding pass
  access pass
  json-ld-expand pass
  shacl pass
  passport-identity pass
public view, another passport => fail schema-invalid product-identity-mismatch
  envelope pass
  binding pass
  access pass
  json-ld-expand pass
  shacl pass
  passport-identity fail The product document describes a different product from the passport that carries it.
authorised view => pass
  envelope pass
  binding pass
  assembly pass
  json-ld-expand pass
  shacl pass
  passport-identity pass
```

| Line | What it shows |
|---|---|
| `whole document pass` | The writer's check, on the complete document. Nothing is prepared from a document that fails or that could not be checked |
| `public payload` | The exact text to write as `payload_public` and to sign, and the public properties it carries |
| `restricted part` | The product's identifier, then every restricted property. Encrypting and storing it is yours |
| `public view` | What any reader decides from the public payload alone. `access` is the check that it carries no restricted property |
| `another passport` | The same payload under another item's passport. It satisfies every rule of the data model, and the identity check refuses it |
| `authorised view` | What a reader with both parts decides. `assembly` is the rejoin, and every other step runs on the whole document |

3. To trust bindings of your own as well, pass their digests beside the list: `createProfileRegistry({ trustedBindingDigests: [...BUNDLED_BINDING_DIGESTS, ownDigest] })`.

4. To include the check in a report, pass `bindingPayloadValidator({ registry, engines })` as the policy's `payloadValidator` to `verifyPassportEvidence`, which supplies each state's `passportId` ([read the answer](../packages/dpp-profiles.md#read-the-answer)). That is the public view, which is all a report has.

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

## Which properties are public

The split is by top-level property of the product document. A property is wholly public or wholly restricted, and nothing is split inside a nested object or a list. The list is part of each binding, so the binding digest a payload declares also commits to which properties were public.

| Profile | Public properties | Restricted properties the test documents carry |
|---|---|---|
| `eu-battery@1` | 46 | 23 |
| `eu-textile@1` | 54 | 13 |

A property in this table is public in the profiles that say so. A property that is not in the table is restricted in both, one the binding has never heard of included.

| Property | `eu-battery@1` | `eu-textile@1` |
|---|---|---|
| `@context` | public | public |
| `id` | public | public |
| `@id` | public | public |
| `type` | public | public |
| `@type` | public | public |
| `oec:granularityLevel` | public | public |
| `oec:hasReportingGranularity` | public | restricted |
| `eubat:batteryModelIdentifier` | public | restricted |
| `gs1:hasSerialNumber` | public | public |
| `oec:lastUpdated` | public | public |
| `gs1:gtin` | public | public |
| `schema:serialNumber` | public | public |
| `oec:passportIdentifier` | public | public |
| `gs1:productID` | public | public |
| `oec:passportStatus` | public | public |
| `schema:schemaVersion` | public | restricted |
| `gs1:productName` | public | public |
| `gs1:productDescription` | public | public |
| `schema:category` | public | public |
| `gs1:additionalProductClassification` | public | restricted |
| `schema:model` | public | restricted |
| `eubat:hasCellType` | public | restricted |
| `eubat:numberOfCells` | public | restricted |
| `eubat:numberOfModules` | public | restricted |
| `gs1:manufacturer` | public | public |
| `gs1:countryOfOrigin` | public | public |
| `gs1:productionDate` | public | public |
| `gs1:netWeight` | public | public |
| `gs1:grossWeight` | public | restricted |
| `eubat:hasRecycledContent` | public | restricted |
| `eubat:hasCarbonFootprintDeclaration` | public | restricted |
| `gs1:manufacturersWarranty` | public | public |
| `eubat:warrantyConditions` | public | restricted |
| `eubat:extendedWarrantyAvailable` | public | restricted |
| `schema:contactPoint` | public | restricted |
| `eubat:transportationSafetyClass` | public | restricted |
| `eubat:dangerousGoodsPackingInstructions` | public | restricted |
| `eubat:shippingName` | public | restricted |
| `eubat:ceMarkingIndicator` | public | restricted |
| `gs1:certification` | public | public |
| `eubat:hasEuDeclarationOfConformity` | public | restricted |
| `eubat:hasComplianceStatus` | public | restricted |
| `eubat:separateCollectionSymbolUrl` | public | restricted |
| `eubat:cadmiumSymbolRequired` | public | restricted |
| `eubat:leadSymbolRequired` | public | restricted |
| `eubat:hasLabels` | public | restricted |
| `oec:passportVersion` | restricted | public |
| `oec:passportIssueDate` | restricted | public |
| `oec:hasProductCategory` | restricted | public |
| `eutex:garmentType` | restricted | public |
| `eutex:hasApparelSubcategory` | restricted | public |
| `gs1:targetConsumerGender` | restricted | public |
| `eutex:sizeRange` | restricted | public |
| `eutex:seasonCollection` | restricted | public |
| `eutex:hasFabricType` | restricted | public |
| `gs1:textileMaterial` | restricted | public |
| `eutex:hasCareInstructions` | restricted | public |
| `eutex:hasDurabilityInfo` | restricted | public |
| `eutex:hasMicroplasticInfo` | restricted | public |
| `eutex:hasRobustnessAssessment` | restricted | public |
| `eutex:hasRecyclabilityAssessment` | restricted | public |
| `oec:hasRecycledContentDetails` | restricted | public |
| `oec:carbonFootprintTotal` | restricted | public |
| `oec:declaredUnit` | restricted | public |
| `oec:carbonFootprintStudyUrl` | restricted | public |
| `eutex:pfasFree` | restricted | public |
| `eutex:biodegradable` | restricted | public |
| `eutex:takeBackProgramAvailable` | restricted | public |
| `eutex:hasTakeBackProgram` | restricted | public |
| `gs1:consumerRecyclingInstructions` | restricted | public |
| `eutex:isRepairable` | restricted | public |
| `eutex:repairGuideUrl` | restricted | public |
| `eutex:sparePartsAvailable` | restricted | public |
| `eutex:sparePartsUrl` | restricted | public |
| `eutex:hasRepairServices` | restricted | public |
| `oec:hasRepairabilityInfo` | restricted | public |
| `oec:tradeItemPieceCount` | restricted | public |
| `oec:hasTradeItemPieces` | restricted | public |

Every member the identity check reads is public, so a reader of the public payload makes the same comparison as the writer. `id` and `@id`, and `type` and `@type`, are listed under both spellings a document may use.

These are the restricted properties the test documents carry. They are examples of the default, not a list the bindings hold:

| Profile | Restricted in the test documents |
|---|---|
| `eu-battery@1` | `schema:status`, `eubat:puttingIntoService`, `eubat:hasBatteryState`, `eubat:hasManufacturingPlace`, `eubat:hasOperatorInformation`, `eubat:hasBatteryChemistry`, `eubat:hasTechnicalSpecifications`, `eubat:hasMaterialComposition`, `eubat:hasHazardousSubstances`, `eubat:authorizedServiceCenters`, `eubat:repurposingPotential`, `eubat:repurposingGuidelines`, `eubat:dataQualityAssessment`, `eubat:dataProviderCertification`, `eubat:criticalRawMaterialsStatement`, `eubat:resultOfTestReport`, `eubat:testReportNumber`, `gs1:regulatoryInformation`, `eubat:hasSupplyChainDueDiligence`, `eubat:hasSparePartSources`, `eubat:hasDismantlingAndRemovalInformation`, `eubat:hasEndOfLifeInfo`, `gs1:referencedFile` |
| `eu-textile@1` | `oec:hasOperatorInformation`, `eutex:hasRecycledContentDeclaration`, `eutex:hasEnvironmentalFootprint`, `eutex:hasSubstancesOfConcern`, `eutex:hasWaterUsage`, `eutex:hasEnergyUsage`, `eutex:productionWastePercentage`, `eutex:hasCutAndSewFacility`, `eutex:hasDyeingFacility`, `oec:hasDocuments`, `gs1:referencedFile`, `oec:hasAccessRights`, `oec:dataQualityAssessment` |

| Before you publish | Why |
|---|---|
| Treat every public property as permanent | The public payload is written to a public chain. It cannot be withdrawn or redacted later |
| Do not repeat a restricted value in a public property | The split is by property name. A value you also state in a public property is public. The test documents do this: an operator's name and location number are restricted in the operator record and public again in `gs1:manufacturer` |
| Check free text and links in public properties | A description or a certificate link is public whole, whatever it says or points to |

## What a public reader can and cannot conclude

A reader of the public payload runs the same contexts and shapes on the public properties alone. The result names its view in `detail.access.view`.

| Public view result | What it means |
|---|---|
| `pass` | The public payload carries only public properties, every rule it could break was evaluated and held, and it describes the passport's item |
| `unknown`, `restricted-tier-withheld` | A rule needs a restricted property, so this reader could not decide it. `detail.access.withheld` lists each such rule. It is never reported as a pass or as a failure |
| `fail`, `restricted-property-disclosed` | The public payload carries a property the binding does not list as public. Nothing else is checked |
| `fail`, any other cause | The public payload breaks a rule, or is not about this passport's item |

| A public `pass` does not say | Why |
|---|---|
| That the whole document is valid | The rules on restricted properties were never evaluated. A fault inside a restricted property is invisible here |
| That a restricted part exists, or what it holds | The public payload does not say |
| That a restricted part someone presents is the one the record commits to | That is the comparison of the stored blob with the record's `payload_owner_hash`, which the protocol defines ([record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md#7-the-owner-tier-binding) section 7). Neither a `pass` in the authorised view nor a successful rejoin replaces it |
| That the product complies with any law | The profile names a data model and claims no compliance |

With the four test documents every public payload passes: the battery shapes require six properties of every item, all of them public, and the textile shapes require nothing of the item itself. A battery payload that leaves one of the six out fails, because nothing was withheld there.

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

- `validation-failed` from `prepareBoundPayload`: the whole document fails a check, and `validation.detail` names the step. Nothing was prepared.
- `fail` at `access` with `restricted-property-disclosed`: the public payload carries a property the binding does not list as public. Build the payload with `prepareBoundPayload`, not by hand.
- `unknown` with `restricted-tier-withheld`: a rule needs a restricted property. Hold both parts and use `authorisedPayloadValidator` to decide it.
- `fail` at `assembly`: the two parts do not belong together, and `refusal` on that step names why ([rejoin refusals](../packages/dpp-profiles.md#split-and-rejoin-on-their-own)).
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
