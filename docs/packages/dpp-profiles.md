# @bsv/dpp-profiles

**Audience:** writers validating product data, registries serving profile documents, readers projecting passports. **Version in the current set:** 0.3.0. **Runtime:** the code entry point needs Node 22 or later (`node:fs`, `node:crypto`); the data entry points are plain JSON and Markdown any runtime or language reads. **Runtime dependency:** `canonicalize` 4.0.0. **Canonical sources:** [`packages/dpp-profiles/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/README.md), [`spec/profiles.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/profiles.md), [`spec/gs1-discovery.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/gs1-discovery.md), [`spec/passport-projections.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/passport-projections.md).

Data first. The manifests are the canonical definition of each profile, frozen by digest; the schemas and consumer documents are generated from them deterministically; and the code beside them gives typed access plus the helpers a writer and a reader need. Nothing edits a frozen profile; a changed meaning is a new version.

## Entry points

| Entry point | Kind | What it gives |
|---|---|---|
| `@bsv/dpp-profiles` | Node module | `readManifest`, `readManifestAny`, `fieldsFor`, `missingRequired`, `mapNativeOperation`, `checkSelection`, the GS1 identifier helpers (`parseGs1DigitalLink`, check digit, GTIN-14, prefix 952), the discovery helpers (`parseGs1DigitalLinkUri`, `decompressGs1DigitalLink`, resolution records and linksets), the interoperability, exchange and operator profile readers, the evidence shapes, `evaluateApplicability` and `projectPassport` |
| `@bsv/dpp-profiles/manifests/*` | Data | `battery@2.json`, `textile@2.json`, `general@2.json`, the superseded `textile@1` and `general@1`, the draft `battery@3` and `textile@3`, and the `exchange/`, `operator/` and `interoperability/` manifests |
| `@bsv/dpp-profiles/schemas/*` | Data | The manifest schemas (versions 1 and 2), the product identity schema, the exchange, operator and interoperability profile schemas, and the pinned GS1 resolver schemas |
| `@bsv/dpp-profiles/generated/*` | Data | The public and restricted payload schemas, the legacy consumer documents, the row-level mapping inventories and the index with every digest |
| `@bsv/dpp-profiles/frozen.json` | Data | The digests every published manifest and generated file is held to |

A consumer in another language reads the data entry points directly and needs none of the code; a JSON Schema 2020-12 validator that asserts formats and refuses an unknown dialect is enough to validate a payload.

## The three results a consumer keeps apart

`fieldsFor` answers three lists for a product category: fields that apply, fields not applicable, and fields under review because no code can decide them. `missingRequired` answers which required fields a payload lacks, with the review list separate and never blocking. `mapNativeOperation` answers exactly one of `lossless`, `transformed`, `unsupported` or `insufficient-data` with the loss list on anything but the first. A consumer shows the review list to a person and never treats it as satisfied or as universally required, and it never reads a mapping result as a legal statement.

## Identifiers

A GTIN is allocated, never chosen. The helpers compute the check digit, spell the GTIN-14, parse a Digital Link and say whether a number is under the demonstration prefix 952; none of them says whether GS1 allocated the number to the brand the record describes, which is GS1's question. [Identifiers](../identifiers.md) is the full account.

## Independence note

The manifests, schemas and generated documents are immutable data an independent implementation may vendor and read; sharing them is sharing a profile, not sharing an implementation. The code helpers are reference logic: an independent implementer that wants the mapping, the applicability evaluator or the projection reproduces the rules from the specification and holds the result to the interoperability and projection vectors.
