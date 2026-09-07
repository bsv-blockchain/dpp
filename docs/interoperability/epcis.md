# EPCIS source exchange

Electronic Product Code Information Services (EPCIS) documents supply source events. Retain the received document through the import workflow before mapping it into a passport or credential view.

## Parse before mapping

EPCIS carries event observations from systems such as manufacturing and logistics. Parsing establishes what was received and where each event occurs. Schema validation checks the document's structure. Mapping asks whether the event can be expressed in the selected credential profile without losing meaning.

Run this local fixture exercise after [setup](../quick-start.md#prepare-the-checkout):

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

Expect the document to pass schema validation and its event locations and types to print. The example encodes a synthetic fixture object. In an importer, retain the actual received bytes instead of serialising a parsed object and treating that as the original.

## Handle the mapping result

`lossless` means the selected mapping preserved the event's information under its rules. `transformed` carries an account of changed or unmapped semantics. `unsupported` means the selected event form cannot be expressed. `insufficient-data` names missing inputs. A valid source document can therefore remain retained evidence without producing a credential.

Keep the source reference and mapping findings with any resulting credential. Do not invent a custody event or a measurement to complete the output. Publication and ingestion checkpoints belong to the application workflow.

## Source definitions

| Task | Source |
|---|---|
| Select parsing, digest and mapping behaviour | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/epcis-import.schema.json) |
| Integrate the application service | [HTTP contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/interoperability.yaml) |
| Use reference parsing and mapping | [VSC package](../packages/vsc.md) |
| Run every selected case, including mapping outcomes | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/vectors/dpp/interoperability/epcis/v1.json) |

Use the source's digest preimage; a digest of the stripped event alone does not reproduce it. Imports do not establish custody or perform a passport transfer. The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records which import and pull outcomes have been exercised.
