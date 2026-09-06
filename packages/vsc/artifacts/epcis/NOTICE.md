# GS1 EPCIS 2.0.1 artefacts

These files are the GS1 EPCIS 2.0.1 JSON Schema, JSON-LD context and query schema, retrieved unchanged from ref.gs1.org on 6 September 2026 and carried here so a source document can be validated against the exact published bytes without a network fetch. GS1 is the publisher and rights holder of these artefacts; they are used under GS1's terms for its published standards artefacts (https://www.gs1.org/standards/epcis) and are not part of this repository's licence. Only the files needed at run time are carried; the EPCIS REST binding (openapi.json, Apache-2.0 per its info block) is pinned by digest in the epcis-json@1 manifest and not redistributed.

| File | Source URI | SHA-256 | Bytes |
| --- | --- | --- | --- |
| epcis-json-schema-2.0.1.json | https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json | 0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af | 55680 |
| epcis-context-2.0.1.jsonld | https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld | 5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737 | 20690 |
| query-schema-2.0.1.json | https://ref.gs1.org/standards/epcis/2.0.1/query-schema.json | 4b5583c9a0a715324594617f3cf6744f4f930568484f7df8fb7aa81819355341 | 27229 |

A test holds each file to its digest. A changed upstream artefact is a new pinned version, never an edit of these bytes.
