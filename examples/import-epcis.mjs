#!/usr/bin/env node
/**
 * Import one EPCIS document under the epcis-json@1 profile, printing one
 * sentence per finding and no score (spec/epcis-interoperability.md). Runs
 * from the packed packages: the only import is the ./epcis-source entry
 * point of @bsv/dpp-credentials.
 *
 *   node examples/import-epcis.mjs                        # the five-event-document fixture, seven events
 *   node examples/import-epcis.mjs path/to/document.json  # any EPCIS 2.0.1 JSON or JSON-LD document
 *
 * What it does: parses the bytes strictly under the disclosed limits,
 * validates against the pinned 2.0.1 schema without repairing anything, and
 * computes each event's body digest and identity. What it does not do: map
 * an event to a SEAL (the epcis-vsc mappings are parked and are not part of
 * the package), retain anything, issue or sign a credential, anchor, or
 * touch a token.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EPCIS_DEFAULT_LIMITS, epcisEventBodyDigest, parseEpcisSource, pinnedContextDigests, unresolvedCorrections, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = (sentence) => console.log(sentence)

const args = process.argv.slice(2)
const unknown = args.filter((a) => a.startsWith('--'))
if (unknown.length > 0) {
  console.error(`usage: node examples/import-epcis.mjs [document.json]; unknown option ${unknown.join(', ')}`)
  process.exit(2)
}

let bytes
let mediaType = 'application/ld+json'
const file = args.find((a) => !a.startsWith('--'))
if (file != null) {
  bytes = readFileSync(file)
  mediaType = file.endsWith('.jsonld') ? 'application/ld+json' : 'application/json'
} else {
  const vectors = JSON.parse(readFileSync(join(root, 'fixtures/vectors/dpp/interoperability/epcis/v1.json'), 'utf8'))
  const vector = vectors.vectors.find((v) => v.id === 'five-event-document')
  bytes = new TextEncoder().encode(JSON.stringify(vector.input.document, null, 2) + '\n')
  say(`Reading the ${vector.id} fixture (${bytes.byteLength} bytes) under the profile's default limits: ${EPCIS_DEFAULT_LIMITS.maxDocumentBytes} bytes, ${EPCIS_DEFAULT_LIMITS.maxEventsPerPage} events, depth ${EPCIS_DEFAULT_LIMITS.maxJsonDepth}.`)
}

const parsed = parseEpcisSource(new Uint8Array(bytes), { mediaType })
if (!parsed.ok) {
  say(`Refused before retention: ${parsed.reason}: ${parsed.detail}.`)
  process.exit(1)
}
say(`Parsed ${parsed.byteLength} bytes as ${parsed.mediaType} with digest ${parsed.sha256}; the source would be retained exactly as received.`)
if (parsed.envelope == null) say('The document is not an EPCIS envelope; it is retained as bytes and nothing in it is interpreted.')
else say(`The envelope is an ${parsed.envelope.type}${parsed.envelope.schemaVersion == null ? '' : ` at schemaVersion ${parsed.envelope.schemaVersion}`} carrying ${parsed.events.length} event${parsed.events.length === 1 ? '' : 's'}.`)
for (const finding of parsed.findings) say(`${finding.severity}: ${finding.path || '/'}: ${finding.message}.`)

const contexts = pinnedContextDigests(parsed.context.document)
for (const iri of contexts.unpinned) say(`Context ${iri} is not pinned by this profile; a claim that depends on its terms cannot pass.`)
say(`${contexts.digests.length} pinned context digest${contexts.digests.length === 1 ? '' : 's'} enter${contexts.digests.length === 1 ? 's' : ''} every event-body digest.`)

const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
say(`The pinned EPCIS 2.0.1 schema ${validation.schema === 'pass' ? 'accepts' : 'rejects'} the document${validation.schema === 'pass' ? '' : ', which is retained with its findings and is publishable on no basis'}.`)
for (const finding of validation.findings) say(`${finding.severity}: ${finding.path}: ${finding.message}.`)
for (const key of validation.preservedExtensions) say(`Document member ${key} is outside the schema and is preserved without interpretation.`)

const held = new Set(parsed.events.map((e) => e.eventId ?? e.localIdentity))
for (const unresolved of unresolvedCorrections(validation, held)) {
  say(`The error declaration at ${unresolved.pointer} names corrective events this source does not hold (${unresolved.missing.join(', ') || 'none named'}); it stays unresolved and is not a VSC correction.`)
}

for (const pointer of parsed.events) {
  const event = pointer.pointer === '' ? parsed.document : pointer.pointer.split('/').slice(1).reduce((v, part) => v[part], parsed.document)
  const digest = epcisEventBodyDigest(event, contexts.digests)
  const identity = pointer.eventId ?? `${pointer.localIdentity} (local, not in the source)`
  const entry = validation.events.find((v) => v.pointer === pointer.pointer)
  const ids = (entry?.identifiers ?? []).map((i) => `${i.scheme}${i.gtin == null ? '' : ` GTIN ${i.gtin}`}${i.serial == null ? '' : ` serial ${i.serial}`}${i.lot == null ? '' : ` lot ${i.lot}`}${i.problem == null ? '' : ` (${i.problem})`}`)
  say(`Event ${pointer.pointer || '/'} is a ${pointer.type} with identity ${identity} and body digest ${digest}; identifiers: ${ids.join('; ') || 'none'}.`)
}
say('No event was mapped: the epcis-vsc mappings are parked, and an import record records each event\'s mapping outcome as not-attempted.')
say('Nothing was retained, issued, anchored or written to a token by this example.')
