# @bsv/dpp-profiles

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

## Install

This is a pre-1.0 candidate. The published version is `@bsv/dpp-profiles@0.3.0-beta.9`, selected by the October set. Install it from npm:

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.9
```

**Publication pending:** this source tree is the November candidate, `0.3.0-beta.10`. [Install the local candidate archives](../../docs/packages/README.md#use-the-renamed-source-candidate) to test it. The following npm command applies after publication.

```sh
npm install --save-exact @bsv/dpp-profiles@0.3.0-beta.10
```

The runtime requires Node >=22 and ECMAScript modules. The JSON data exports can be read in other runtimes. No repository checkout or package build is needed after installation.

The canonical industry data profiles of the DPP standard, as `spec/profiles.md` defines them: immutable manifests, the artefacts generated from them, the digests they are frozen at, and the GS1 identifier helpers a writer uses to mint an identifier it can stand behind. Data first: the manifests, schemas and generated documents are plain files any language reads, and the one runtime dependency of the code beside them is the RFC 8785 canonicaliser (`canonicalize`) the projection digest uses. The code reads its data files through the Node file system, so the root entry point is a Node module; a browser or another language reads the data files directly through the `./manifests/*`, `./schemas/*`, `./generated/*` and `./frozen.json` entry points.

## What is in it

| Path | What it is |
|---|---|
| `manifests/<id>@<version>.json` | The canonical definition of one profile: every field with its pointer, semantic URI, value type, unit or code list, resolved constraints, cardinality, granularity, provenance, access tier, obligation, legal basis and applicability; the stamps, event mappings, access tiers, sources and identity model. Immutable once published. |
| `schemas/profile-manifest.schema.json` | The JSON Schema (2020-12) every manifest validates against. |
| `schemas/product-identity.schema.json` | The model, batch and item identity document a passport may relate. |
| `schemas/profile-binding-v1.schema.json` | The JSON Schema (2020-12) of a profile binding, format 1: the immutable file that holds a profile defined outside this package (`spec/profiles.md` §7). |
| `generated/payload-schema/<profile>.public.schema.json` | The JSON Schema for the public payload carried on chain, generated from the manifest. |
| `generated/payload-schema/<profile>.restricted.schema.json` | The same for the off-chain restricted tiers. |
| `generated/consumer/<id>-v<version>.json` | The legacy consumer document the registry serves and the application publishes, generated from the manifest. |
| `generated/mapping/<profile>.md` | The row-level field mapping inventory of each current profile, generated from the manifest; `needs review` where no generator can decide. |
| `generated/index.json` | Every file with its digest. |
| `frozen.json` | The digests every published manifest and generated file is held to. |
| `bindings/<profile>/` | The bindings the package ships, `eu-battery@1` and `eu-textile@1`: `binding.json`, the contexts, shapes and background file it pins by length and SHA-256, and a `NOTICE.md` that names the source and licence of each file. |
| `src/bundled-bindings.ts` | `BUNDLED_BINDINGS` and `BUNDLED_BINDING_DIGESTS`, the trusted digest list for those bindings, and `registerBundledBindings`, which reads them from the package folder into a registry. Nothing is read at import. |
| `src/retired-profiles.ts` | `RETIRED_PROFILE_IDS`, the one list of retired profiles, with `RETIRED_PROFILE_REPLACEMENTS`, `isRetiredProfile` and `ProfileRetiredError`. Every refusal to write under a retired profile and every `unknown` answer about one starts here ([retired profiles](#retired-profiles)). |
| `src/profile-binding.ts`, `src/profile-registry.ts` | `readProfileBinding` and its hand-written structural check, held to the same verdict as the schema, and `createProfileRegistry`: a binding registers only when its digest is trusted and every artefact it names matches its recorded length and SHA-256. The manifest profiles resolve through the same registry. |
| `src/binding-validator.ts`, `src/product-identity.ts`, `src/strict-json.ts` | `bindingPayloadValidator`: the envelope, the binding digest, the binding's steps and the product-to-passport identity rules. A step that could not run is `unknown`, never `pass`. |
| `src/access-tiers.ts`, `src/bound-payload.ts` | The split a binding's `access` member states, by top-level property and restricted unless listed: `splitProductByAccess`, `assembleProduct` with its typed refusals, and `prepareBoundPayload`, which validates the whole document, splits it and returns the public payload as the text to sign. `authorisedPayloadValidator` checks both parts rejoined. |
| `src/validation-engine.ts` | The `@bsv/dpp-profiles/validation-engine` entry point: JSON-LD and SHACL engines over `jsonld`, `n3` and `shacl-engine`, which the caller installs. Nothing else in the package imports it. |
| `src/identifiers.ts` | GS1 check digit, GTIN-14 spelling, the demonstration prefix 952 and the Digital Link path parser and builder. |
| `src/combinations.ts` | `checkSelection`: supported combinations of baseline, industry, exchange and operator profiles pass, and contradictory selections are refused by name (a retired industry profile, a write under a superseded version, a claim on a proposed profile, a single operator with peers, a federation of one). A parked exchange profile is refused for no purpose and named parked in a note, because a claim on it rests on its own ledger rows. |
| `src/mapping.ts` | `mapNativeOperation`: the conditional lifecycle mapping of `spec/rules.md` §2, one of four outcomes with a loss list on every outcome that is not lossless. |
| `src/gs1-resolution.ts`, `src/gs1-epc-binary.ts` | Reference code for the `gs1-digital-link@1` discovery profile, which reads GS1-Conformant Resolver 1.2.1 and GS1 Digital Link URI Syntax 1.7.0 for resolution, link types and linksets; `spec/gs1-discovery.md` keeps only the DPP identifier rules. The helpers cover the full grammar for primary key 01 with its qualifiers and data attributes, key-tuple equivalence across hosts, EPC-binary decompression for SGTIN-96 and SGTIN-198, resolution records, the linkset hierarchy and selection, and the resolver description file. The GS1 resolver schemas and context are pinned by address, SHA-256 and length in `GS1_RESOLVER_ARTEFACTS` and are not in this package: GS1 publishes them under its own terms, and a party that validates against them obtains them from GS1 and checks them against those digests, for which `provisionGs1Artefacts` of `@bsv/dpp-credentials` accepts the table. |
| `manifests/interoperability/*.json`, `schemas/interoperability-profile.schema.json` | The interoperability profiles: discovery (`gs1-digital-link@1`), source exchange (`epcis-json@1`) and the parked mapping to VSC SEALs (`epcis-vsc@1`, and `epcis-vsc@2` with its CBV 2.0 disposition crosswalk), which no release requires, each recording its standards, pinned artefacts, formats, limits and what it cannot map. |
| `src/evidence-shapes.ts`, `src/applicability.ts`, `src/projections.ts` | The shared evidence, measurement, certification, document and language shapes of `contracts/profile-evidence.schema.json`, the declarative applicability evaluator of manifest version 2 (`schemas/profile-manifest-v2.schema.json`) whose `unresolved` outcome is never a pass, and `projectPassport`, the pure deterministic `passport-projection@1` over versioned model, batch and item sources, digested under RFC 8785. Projections are a reference feature of this package, not part of the standard: their schemas are `schemas/passport-source.schema.json` and `schemas/passport-projection.schema.json`, and their specification is parked under `docs/reference/parked/passport-projections/`. |

Two manifest profiles are supported: `general@2`, current, and `general@1`, superseded and served for as long as any state declares it (`SUPPORTED_PROFILE_IDS`). They were inventoried from the application's attribute registries in full, including the fields captured over life or derived rather than at registration, and frozen.

## Retired profiles

The sector profiles first published as manifests are retired (`spec/profiles.md` §4): `battery@2`, `battery@3`, `battery@4`, `textile@1`, `textile@2`, `textile@3` and `textile@4`. `RETIRED_PROFILE_IDS` is the one list, and `RETIRED_PROFILE_REPLACEMENTS` names what replaces each: the bundled bindings `eu-battery@1` and `eu-textile@1`.

Retiring a profile changes what the package does with it and nothing it says. The manifests, generated schemas, consumer documents and mapping inventories stay in the package byte for byte, `frozen.json` still holds every one to its digest, and the identifiers are never given another definition.

| Asked to | The package answers |
|---|---|
| Validate a payload that declares one (`profilePayloadValidator`, `bindingPayloadValidator`, `authorisedPayloadValidator`) | `unknown` with `schema-unavailable`, and `detail` `{ profile, cause: 'profile-retired', replacedBy, steps: [] }`. Never `pass` and never `fail`, whatever the payload holds |
| Prepare or check a payload for writing (`prepareBoundPayload`, `missingRequired`, `missingRequiredV2`, `reviewProfileData`), or project a passport (`projectPassport`) | A refusal named `profile-retired`: returned by `prepareBoundPayload`, thrown as `ProfileRetiredError` by the others |
| Select it (`checkSelection`) or register a binding under it (`registry.register`) | The conflict `industry-retired`, and the refusal `profile-retired` |
| Resolve it (`registry.resolve`, `registry.list`) | `undefined`, and not listed. `registry.status` says `retired`, with the replacement, which is a different answer from `unknown` |

These still read a retired profile, as history, because each returns or describes a frozen definition and judges no payload: `readManifest`, `readManifestAny`, `readPublicPayloadSchema`, `readRestrictedPayloadSchema`, `readConsumerDocument`, `readFrozen`, `fieldsFor`, `fieldsForV2`, `evaluateFieldApplicability`, `categoryOf`, `compareProfiles` and `mapNativeOperation`. A retired manifest keeps the `status` it was frozen with, so read retirement from the list and never from that member.

There is no converter and no reader of the retired rules. `reviewProfileData` had rules for `battery@4` and `textile@4` only, so it has no profile left to review: it refuses a retired one as `profile-retired` and any other as not implemented.

## Review a profile update

After building this checkout, generate a deterministic consumer impact report for two versions of one profile:

```sh
npm run changes -w @bsv/dpp-profiles -- general@1 general@2
```

The Node API is `compareProfiles(from, to)`. It reports added, changed and removed fields, all changed field properties, top-level metadata changes, source/target status and manifest byte digests. It does not infer safe conversions, send notifications or activate a writer. Include the report in the consumer upgrade proposal, then review the application's UI, backend and export changes.

## Working on it

```
npm run build      # tsc, then the generator: regenerates generated/ and refuses drift from frozen.json
npm run generate   # the generator alone
npm run freeze-new # records a new manifest's digests and generated files; refuses to move any existing digest
npm run refreeze   # writes the current digests into the manifests and frozen.json; review that diff
npm test           # schema validity, uniqueness, freezing, deterministic generation, payload validation, identifiers, lifecycle mapping
```

A frozen profile changes only by publishing a new version. A corrected mandatory field, a changed meaning or an incompatible validation rule is a new version; a state decodes under the version it declares and is never reinterpreted under a newer one. `--refreeze` exists for a reviewed change to the generator's output for an existing version, and the diff it produces is the review.

## Using it

```ts
import { readManifest, fieldsFor, missingRequired, parseGs1DigitalLink, parseGs1DigitalLinkUri, decompressGs1DigitalLink, projectPassport } from '@bsv/dpp-profiles'

const general = readManifest('general@2')
const { applies, needsReview } = fieldsFor(general, 'furniture')
const gaps = missingRequired(general, payload, 'furniture') // gaps.missing blocks; gaps.needsReview is shown, never assumed
const link = parseGs1DigitalLink(passportId)         // link.checkDigitValid, link.demonstration, never allocation authority
const request = parseGs1DigitalLinkUri(uri)          // key 01 with 22, 10 and 21, data attributes, linkType; never an exception
const plain = decompressGs1DigitalLink(compressed)   // eh and ex forms carrying SGTIN-96 or SGTIN-198; other schemes refused by name
const { projection } = projectPassport(input)        // one digest for one set of pinned sources, policy, cutoff and disclosure
```

A consumer validates a public payload against the generated schema with a validator that asserts formats and refuses an unknown dialect, and reads `needs-review` as a list to show a person, never as satisfied and never as universally required. Syntax and a correct check digit never prove that GS1 allocated a number to the brand a record describes.

## Licence

[Apache License 2.0](LICENSE). Third-party dependencies and artefacts retain their own terms and notices.
