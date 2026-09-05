# @bsv/dpp-profiles

The canonical industry data profiles of the DPP standard, as `spec/profiles.md` defines them: immutable manifests, the artefacts generated from them, the digests they are frozen at, and the GS1 identifier helpers a writer uses to mint an identifier it can stand behind. Data first, no runtime dependency.

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

Five profiles are published: `battery@2`, `textile@2` and `general@2` (current) and `textile@1` and `general@1` (superseded, and served for as long as any state declares them). They were inventoried from the application's attribute registries in full, including the fields captured over life or derived rather than at registration, and frozen.

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
import { readManifest, fieldsFor, missingRequired, parseGs1DigitalLink } from '@bsv/dpp-profiles'

const battery = readManifest('battery@2')
const { applies, needsReview } = fieldsFor(battery, 'ev')
const gaps = missingRequired(battery, payload, 'ev') // gaps.missing blocks; gaps.needsReview is shown, never assumed
const link = parseGs1DigitalLink(passportId)         // link.checkDigitValid, link.demonstration, never allocation authority
```

A consumer validates a public payload against the generated schema with a validator that asserts formats and refuses an unknown dialect, and reads `needs-review` as a list to show a person, never as satisfied and never as universally required. Syntax and a correct check digit never prove that GS1 allocated a number to the brand a record describes.
