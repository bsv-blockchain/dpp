# EPCIS source exchange

Use this page if you hold EPCIS 2.0 supply-chain events, from a manufacturing, logistics or traceability system, and want them as evidence beside a passport. It shows how to take a document in without changing it and how to map each event to a credential view; an import never writes a passport state.

Electronic Product Code Information Services (EPCIS) is the GS1 standard for event observations, such as an item made, packed or shipped. Two profiles apply: `epcis-json@1` takes an EPCIS 2.0.1 JSON or JSON-LD document in and keeps it exactly as received, and `epcis-vsc@1` maps each event to an unsigned SEAL credential, the event credential of the Verifiable Supply Chain (VSC) profile, which a separately authorised issuer may then sign. Both are implemented in `@bsv/vsc`.

## Parse before mapping

Parsing establishes what was received and where each event sits. Schema validation checks the document's structure against the pinned EPCIS 2.0.1 schema. Mapping then asks whether each event can be expressed in the credential profile without losing meaning.

Run this local fixture exercise at the root of a checkout, after [setup](../quick-start.md#get-the-code):

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEpcisSource, validateEpcisDocument } from '@bsv/vsc/epcis-source'
const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/epcis/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'five-event-document')
const bytes = new TextEncoder().encode(JSON.stringify(vector.input.document))
const parsed = parseEpcisSource(bytes, { mediaType: vector.input.media_type })
assert.equal(parsed.ok, true)
const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
assert.equal(validation.schema, 'pass')
console.table(parsed.events.map(({ pointer, type }) => ({ pointer, type })))
JS
```

The document passes schema validation, and a table prints seven events with their JSON pointers and types, from `/epcisBody/eventList/0`, a `TransformationEvent`, to `/epcisBody/eventList/6`, an `ObjectEvent`. Seven is the expected count, although the vector is named `five-event-document`. The example encodes a synthetic fixture object. In an importer, keep the actual received bytes instead of serialising a parsed object and treating that as the original.

## Map the events

`mapEpcisEventWithReport(event, options, { sourceReference, validation })` from the root `@bsv/vsc` maps one event, and returns one of four outcomes:

- `lossless`: the mapping keeps all of the event's information; the report carries an unsigned SEAL.
- `transformed`: the SEAL carries the event, but some of its meaning survives only in the round-trip extension, and `unmapped` names what.
- `unsupported`: the profile cannot express the event, or a mapping decision is missing, and `missing` names it.
- `insufficient-data`: the source lacks an input the mapping never invents, and `missing` names it.

A valid source document can therefore remain retained evidence without producing a credential. `mapEpcisEvent` is the plain mapping without the report; both are exported from the root `@bsv/vsc`, not from `@bsv/vsc/epcis-source`, which carries the parsing functions and artefacts.

This maps every event of the same fixture, at the root of the checkout:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { mapEpcisEventWithReport } from '@bsv/vsc'
import { epcisSourceReference, parseEpcisSource, pinnedContextDigests, validateEpcisDocument } from '@bsv/vsc/epcis-source'
const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/epcis/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'five-event-document')
const parsed = parseEpcisSource(new TextEncoder().encode(JSON.stringify(vector.input.document)), { mediaType: vector.input.media_type })
const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
const contexts = pinnedContextDigests(parsed.context.document).digests
const issuer = 'did:web:issuer.example'
const options = {
  issuer, assertionMethod: `${issuer}#key-1`, actorRole: 'importer', jurisdiction: 'AU', issuedAt: '2026-10-01T00:00:00Z',
  credentialStatus: { id: 'https://issuer.example/status/1#0', type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '0', statusListCredential: 'https://issuer.example/status/1' },
  chainOfCustody: { chainId: 'urn:uuid:00000000-0000-4000-8000-00000000c0de', sequenceNumber: 1, parentSeals: [], topology: 'linear' },
}
for (const { pointer, type, index, eventId } of parsed.events) {
  const event = parsed.document.epcisBody.eventList[index]
  const sourceReference = epcisSourceReference({ sourceSha256: parsed.sha256, mediaType: parsed.mediaType, pointer, contextDigests: contexts, ...(eventId ? { eventId } : {}) })
  const report = mapEpcisEventWithReport(event, { ...options, id: `urn:uuid:example-${index}` }, { sourceReference, validation })
  console.log(pointer, type, report.mapping, [...report.missing, ...report.unmapped].join(', '))
}
JS
```

It prints one line per event. The two `TransformationEvent`s read `unsupported`, because a transformation has no EPCIS action and these options make no `transformationAction` decision; the first `ObjectEvent` reads `lossless`; the others read `transformed`, naming what only the round-trip extension keeps, such as `multi-product-event` or `business-transactions, source-destination-parties`. The issuer, status entry and custody chain are synthetic; nothing is signed or issued.

[`examples/import-epcis.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/import-epcis.mjs) does the whole import in one sentence per finding, with a `transformationAction` of `ADD`: the source digest, the contexts, schema validation, each event's identity and body digest, and its mapping outcome. Run `node examples/import-epcis.mjs`, or `node examples/import-epcis.mjs <document.json>` for any EPCIS 2.0.1 document; it ends with `Nothing was retained, issued, anchored or written to a token by this example.` The package's own mapping tests run with `npm run test -w @bsv/vsc -- test/epcis.test.ts test/epcis-source.test.ts test/epcis-report.test.ts` (49 tests, all passing).

## Keep the source with the result

Keep the source reference and the mapping findings with any credential that results. Do not invent a custody event or a measurement to complete the output. An import establishes no custody and performs no passport transfer: no import, pull, mapping or export writes `ISSUE`, `UPDATE`, `TRANSFER` or `RETIRE`. A later business workflow may cite the retained source when it asks the passport service for a state, and that service checks the tip, the actor's authority and the recipient's acceptance on its own.

Each event has a body digest: the SHA-256 of the RFC 8785 canonical JSON of the event without its `recordTime` and `errorDeclaration`, taken together with the sorted digests of the contexts it was read under ([EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/epcis-interoperability.md) section 2). A digest of the stripped event alone does not reproduce it.

## The application's HTTP routes

[`contracts/interoperability.yaml`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/interoperability.yaml) describes the import and pull routes the reference application exposes under `/api/interoperability/epcis`. That application's source is not public ([the application service](../packages/application-service.md)), and these routes are not a requirement of any conformance role. Use the contract as a model if your own application offers EPCIS import over HTTP.

## Source definitions

| Task | Source |
|---|---|
| Select parsing, digest and mapping behaviour | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/epcis-import.schema.json) |
| Model an HTTP import service | [Interoperability HTTP contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/interoperability.yaml) |
| Use reference parsing and mapping | [VSC package](../packages/vsc.md) |
| Run every selected case, including mapping outcomes | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/epcis/v1.json) |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records which import and pull outcomes have been exercised. Next: [verifiable credentials](../learn/verifiable-credentials.md), to issue and anchor a mapped SEAL.
