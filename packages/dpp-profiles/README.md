# @bsv/dpp-profiles

The canonical industry data profiles of the DPP standard, as `spec/profiles.md` defines them: immutable manifests, the artefacts generated from them, the digests they are frozen at, and the GS1 identifier helpers a writer uses to mint an identifier it can stand behind. Data first: the manifests, schemas and generated documents are plain files any language reads, and the one runtime dependency of the code beside them is the RFC 8785 canonicaliser (`canonicalize`) the projection digest uses. The code reads its data files through the Node file system, so the root entry point is a Node module; a browser or another language reads the data files directly through the `./manifests/*`, `./schemas/*`, `./generated/*` and `./frozen.json` entry points.

## What is in it

| Path | What it is |
|---|---|
| `manifests/<id>@<version>.json` | The canonical definition of one profile: every field with its pointer, semantic URI, value type, unit or code list, resolved constraints, cardinality, granularity, provenance, access tier, obligation, legal basis and applicability; the stamps, event mappings, access tiers, sources and identity model. Immutable once published. |
| `schemas/profile-manifest.schema.json` | The JSON Schema (2020-12) every manifest validates against. |
| `schemas/product-identity.schema.json` | The model, batch and item identity document a passport may relate. |
| `generated/payload-schema/<profile>.public.schema.json` | The JSON Schema for the public payload carried on chain, generated from the manifest. |
| `generated/payload-schema/<profile>.restricted.schema.json` | The same for the off-chain restricted tiers. |
| `generated/consumer/<id>-v<version>.json` | The legacy consumer document the registry serves and the application publishes, generated from the manifest. |
| `generated/mapping/<profile>.md` | The row-level field mapping inventory of each current profile, generated from the manifest; `needs review` where no generator can decide. |
| `generated/index.json` | Every file with its digest. |
| `frozen.json` | The digests every published manifest and generated file is held to. |
| `src/identifiers.ts` | GS1 check digit, GTIN-14 spelling, the demonstration prefix 952 and the Digital Link path parser and builder. |
| `src/combinations.ts` | `checkSelection`: supported combinations of baseline, industry, exchange and operator profiles pass, and contradictory selections are refused by name (a write under a superseded version, a claim on a proposed profile, a single operator with peers, a federation of one). |
| `src/mapping.ts` | `mapNativeOperation`: the conditional lifecycle mapping of `spec/rules.md` §2, one of four outcomes with a loss list on every outcome that is not lossless. |
| `src/gs1-resolution.ts`, `src/gs1-epc-binary.ts` | The `gs1-digital-link@1` discovery profile (`spec/gs1-discovery.md`): the full grammar for primary key 01 with its qualifiers and data attributes, key-tuple equivalence across hosts, EPC-binary decompression for SGTIN-96 and SGTIN-198, resolution records, the linkset hierarchy and selection, and the resolver description file; `schemas/gs1/` carries the pinned GS1 resolver schemas. |
| `manifests/interoperability/*.json`, `schemas/interoperability-profile.schema.json` | The interoperability profiles: discovery (`gs1-digital-link@1`), source exchange (`epcis-json@1`) and mapping (`epcis-vsc@1`), each recording its standards, pinned artefacts, formats, limits and what it cannot map. |
| `src/evidence-shapes.ts`, `src/applicability.ts`, `src/projections.ts` | The shared evidence, measurement, certification, document and language shapes of `contracts/profile-evidence.schema.json`, the declarative applicability evaluator of manifest version 2 (`schemas/profile-manifest-v2.schema.json`) whose `unresolved` outcome is never a pass, and `projectPassport`, the pure deterministic `passport-projection@1` of `spec/passport-projections.md` over versioned model, batch and item sources, digested under RFC 8785. |

Five profiles are published: `battery@2`, `textile@2` and `general@2` (current) and `textile@1` and `general@1` (superseded, and served for as long as any state declares them). They were inventoried from the application's attribute registries in full, including the fields captured over life or derived rather than at registration, and frozen. `battery@3` and `textile@3` are draft successors under manifest version 2: opt-in by explicit version, carrying a requirement status per field and a migration outcome per field, and leaving every byte of the two current versions unchanged until a reviewed cutover.

## Working on it

```
npm run build      # tsc, then the generator: regenerates generated/ and refuses drift from frozen.json
npm run generate   # the generator alone
npm run refreeze   # writes the current digests into the manifests and frozen.json; review that diff
npm test           # schema validity, uniqueness, freezing, deterministic generation, payload validation, identifiers, lifecycle mapping
```

A frozen profile changes only by publishing a new version. A corrected mandatory field, a changed meaning or an incompatible validation rule is a new version; a state decodes under the version it declares and is never reinterpreted under a newer one. `--refreeze` exists for a reviewed change to the generator's output for an existing version, and the diff it produces is the review.

## Using it

```ts
import { readManifest, fieldsFor, missingRequired, parseGs1DigitalLink, parseGs1DigitalLinkUri, decompressGs1DigitalLink, projectPassport } from '@bsv/dpp-profiles'

const battery = readManifest('battery@2')
const { applies, needsReview } = fieldsFor(battery, 'ev')
const gaps = missingRequired(battery, payload, 'ev') // gaps.missing blocks; gaps.needsReview is shown, never assumed
const link = parseGs1DigitalLink(passportId)         // link.checkDigitValid, link.demonstration, never allocation authority
const request = parseGs1DigitalLinkUri(uri)          // key 01 with 22, 10 and 21, data attributes, linkType; never an exception
const plain = decompressGs1DigitalLink(compressed)   // eh and ex forms carrying SGTIN-96 or SGTIN-198; other schemes refused by name
const { projection } = projectPassport(input)        // one digest for one set of pinned sources, policy, cutoff and disclosure
```

A consumer validates a public payload against the generated schema with a validator that asserts formats and refuses an unknown dialect, and reads `needs-review` as a list to show a person, never as satisfied and never as universally required. Syntax and a correct check digit never prove that GS1 allocated a number to the brand a record describes.
