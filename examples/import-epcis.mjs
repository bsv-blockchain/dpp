#!/usr/bin/env node
/**
 * Import one EPCIS document under the epcis-json@1 profile and export it
 * again, printing one sentence per finding and no score
 * (spec/epcis-interoperability.md). Runs from the packed packages: the only
 * imports are @bsv/dpp-credentials and its ./epcis-exchange entry point.
 *
 *   node examples/import-epcis.mjs                        # the five-event-document fixture, seven events
 *   node examples/import-epcis.mjs path/to/document.json  # any EPCIS 2.0.1 JSON or JSON-LD document
 *   node examples/import-epcis.mjs --store ./epcis-store  # keep the import in a folder; run it twice to see the second answered from the first
 *   node examples/import-epcis.mjs --offline              # use the provisioned GS1 files and fetch nothing
 *
 * GS1 publishes the EPCIS schema under its own terms and the package does
 * not contain it. The first run obtains the three pinned EPCIS files from
 * https://ref.gs1.org/ into the artefacts folder (DPP_GS1_ARTEFACTS_DIR, or
 * the per-user cache folder) and checks every byte against a pinned digest.
 * Later runs find them there and use no network.
 *
 * What it does: retains the exact bytes and an import record in storage it
 * is given (memory, or the folder --store names), classifies each event
 * against what that storage already holds, answers a repeated request with
 * the first import, exports the original bytes and shows that they are
 * unchanged. What it does not do: capture or query events, map an event to a
 * SEAL (the epcis-vsc mappings are parked and are not part of the package),
 * issue or sign a credential, anchor, or touch a token. An import is data:
 * a document that passes validation says nothing about who observed an event.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EPCIS_DEFAULT_LIMITS, provisionGs1Artefacts } from '@bsv/dpp-credentials'
import { createMemoryEpcisStorage, deriveEpcisEventProjection, exportEpcisSource, findEpcisAssociations, importEpcisSource, openFileEpcisStorage, recoverEpcisExchange } from '@bsv/dpp-credentials/epcis-exchange'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = (sentence) => console.log(sentence)
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const args = process.argv.slice(2)
const storeAt = args.indexOf('--store')
const storeDir = storeAt === -1 ? undefined : args[storeAt + 1]
const rest = args.filter((_, index) => storeAt === -1 || (index !== storeAt && index !== storeAt + 1))
const unknown = rest.filter((a) => a.startsWith('--') && a !== '--offline')
if (unknown.length > 0 || (storeAt !== -1 && (storeDir == null || storeDir.startsWith('--')))) {
  console.error(`usage: node examples/import-epcis.mjs [--offline] [--store <folder>] [document.json]${unknown.length > 0 ? `; unknown option ${unknown.join(', ')}` : '; --store names a folder'}`)
  process.exit(2)
}

// Provisioning is explicit and comes first: an import is refused without the pinned schema, and nothing fetches by itself.
const artefacts = await provisionGs1Artefacts({ offline: rest.includes('--offline') })
for (const file of artefacts.files.filter((f) => f.outcome === 'fetched')) say(`Obtained ${file.fileName} from GS1 and checked it against its pinned digest.`)
if (!artefacts.ok) {
  for (const file of artefacts.files.filter((f) => f.outcome === 'failed')) say(`The pinned GS1 file ${file.fileName} is not available in ${artefacts.dir}: ${file.reason}: ${file.detail}.`)
  say('Nothing is validated without the pinned schema. Run dpp-gs1-artefacts fetch with network access, or place the files GS1 publishes in that folder.')
  process.exit(1)
}

let bytes
let mediaType = 'application/ld+json'
let filename = 'five-event-document.jsonld'
const file = rest.find((a) => !a.startsWith('--'))
if (file != null) {
  bytes = new Uint8Array(readFileSync(file))
  mediaType = file.endsWith('.jsonld') ? 'application/ld+json' : 'application/json'
  filename = file.split(/[\\/]/).at(-1)
} else {
  const vectors = JSON.parse(readFileSync(join(root, 'fixtures/vectors/dpp/interoperability/epcis/v1.json'), 'utf8'))
  const vector = vectors.vectors.find((v) => v.id === 'five-event-document')
  bytes = new TextEncoder().encode(JSON.stringify(vector.input.document, null, 2) + '\n')
  say(`Reading the ${vector.id} fixture (${bytes.byteLength} bytes) under the profile's default limits: ${EPCIS_DEFAULT_LIMITS.maxDocumentBytes} bytes, ${EPCIS_DEFAULT_LIMITS.maxEventsPerPage} events, depth ${EPCIS_DEFAULT_LIMITS.maxJsonDepth}.`)
}

// The storage is handed in. The module opens nothing by itself.
const storage = storeDir == null ? createMemoryEpcisStorage() : await openFileEpcisStorage(storeDir)
say(storeDir == null ? 'Using storage in memory, which is gone when this run ends; --store <folder> keeps it.' : `Using the folder ${storage.dir} as storage.`)
try {
  // Recovery comes before the first import: it finishes or discards whatever an earlier run left unfinished.
  const recovery = await recoverEpcisExchange(storage)
  for (const action of recovery.actions) say(`Recovery: ${action.action}${action.importId == null ? '' : ` for ${action.importId}`}.`)

  // The request identifier is the caller's. Here it is taken from the bytes, so the same file is the same request.
  const request = {
    storage,
    sourceId: 'example-source',
    requestId: `example-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`,
    bytes,
    mediaType,
    receivedAt: new Date().toISOString(),
    provenance: { kind: 'file', filename },
    policy: { policyId: 'example-policy@1' },
  }
  const outcome = await importEpcisSource(request)
  if (outcome.outcome === 'refused') {
    say(`Refused, and nothing was kept: ${outcome.reason}: ${outcome.detail}.`)
    if (outcome.remedy != null) say(outcome.remedy)
    process.exitCode = 1
  } else if (outcome.outcome === 'request-conflict') {
    say(`Request ${outcome.requestId} is already bound to other bytes as ${outcome.existingImportId}; nothing was kept and the earlier import stands.`)
    process.exitCode = 1
  } else {
    const { record } = outcome
    say(outcome.replayed
      ? `Request ${record.requestId} was imported before, on ${record.receivedAt}; this is that import and nothing was written again.`
      : `Retained ${record.byteLength} bytes as ${record.mediaType} with digest ${record.sha256}, exactly as received, as import ${record.importId}.`)
    say(`The request identifier is bound to request digest ${record.requestDigest}, unique within its ${record.idempotency.scope}.`)
    if (record.envelope == null) say('The document is not an EPCIS envelope; it is retained as bytes and nothing in it is interpreted.')
    else say(`The envelope is an ${record.envelope.type}${record.envelope.schemaVersion == null ? '' : ` at schemaVersion ${record.envelope.schemaVersion}`} carrying ${plural(record.events.length, 'event')}.`)
    say(record.documentValidity === 'valid'
      ? 'The pinned EPCIS 2.0.1 schema accepts the document and no envelope, context or identifier check failed. That is validity of the document, not a statement about who made it.'
      : 'The document is not valid under the pinned EPCIS 2.0.1 schema and the profile\'s checks. It is retained with its findings as evidence that was received, and is excluded from everything described as valid.')
    for (const finding of record.findings) say(`${finding.severity}: ${finding.path || '/'}: ${finding.message}.`)
    for (const key of record.preservedExtensions) say(`Document member ${key} is outside the schema and is preserved without interpretation.`)
    for (const context of record.contextRefs.filter((c) => !c.pinned)) say(`Context ${context.value} is not pinned by this profile; nothing that depends on its terms is established.`)

    for (const event of record.events) {
      const identity = event.identityKind === 'event-id' ? event.identity : `${event.identity} (local, not in the source)`
      const ids = event.identifiers.map((i) => `${i.scheme}${i.gtin == null ? '' : ` GTIN ${i.gtin}`}${i.serial == null ? '' : ` serial ${i.serial}`}${i.lot == null ? '' : ` lot ${i.lot}`}${i.problem == null ? '' : ` (${i.problem})`}`)
      say(`Event ${event.pointer || '/'} is ${/^[AEIOU]/.test(event.eventType) ? 'an' : 'a'} ${event.eventType || 'typeless event'} with identity ${identity} and body digest ${event.bodyDigest}; arrival: ${event.arrival}; identifiers: ${ids.join('; ') || 'none'}.`)
      for (const finding of event.validation.findings) say(`${finding.severity}: ${finding.path}: ${finding.message}.`)
      if (event.errorDeclaration != null) say(`The error declaration at ${event.pointer} is ${event.errorDeclaration.resolution}${event.errorDeclaration.missing == null ? '' : `: this source does not hold ${event.errorDeclaration.missing.join(', ')}`}; it is retained and is not a VSC correction.`)
      if (event.conflict != null) say(`Event ${event.pointer} has a different body from the one held by ${event.conflict.withImportId} under the same identity; both are kept and the conflict is ${event.conflict.state}.`)
    }
    if (record.state === 'blocked') say('The import is blocked: a conflict among its events waits for a recorded decision.')

    // The same request again: the same import, no second receipt.
    const again = await importEpcisSource({ ...request, receivedAt: new Date().toISOString() })
    say(`The same request made again answers ${again.outcome === 'retained' && again.replayed && again.record.importId === record.importId ? 'the same import and writes nothing' : 'something else, which is a defect'}.`)

    // Export answers the retained original, byte for byte.
    const exported = await exportEpcisSource(storage, record.importId)
    const unchanged = exported != null && Buffer.from(exported.bytes).equals(Buffer.from(bytes)) && exported.sha256 === record.sha256
    say(`Export returned ${exported.byteLength} bytes as ${exported.mediaType} with digest ${exported.sha256}: ${unchanged ? 'the bytes that were received, unchanged' : 'not the bytes that were received, which is a defect'}.`)
    if (!unchanged) process.exitCode = 1

    // A generated view is a different thing, with a label and a digest of its own.
    const derived = await deriveEpcisEventProjection(storage, record.importId)
    say(`A generated view of the events is labelled ${derived.kind} (${derived.projection}), has its own digest ${derived.sha256} and is never returned as the original.`)

    // The index answers which events an identifier takes part in, and in which role.
    const first = record.events.flatMap((e) => e.identifiers).find((i) => i.problem == null && i.scheme === 'gs1-sgtin')
    if (first != null && record.documentValidity === 'valid') {
      const found = await findEpcisAssociations(storage, { identifier: first.value, granularity: 'instance' })
      say(`The item ${first.value} takes part in ${plural(found.associations.length, 'event')}: ${found.associations.map((a) => `${a.role} at ${a.pointer}`).join('; ')}.`)
    }
  }
} finally {
  await storage.close?.()
}
say('No event was mapped: the epcis-vsc mappings are parked, and the import record records each event\'s mapping outcome as not-attempted.')
say('Nothing was signed, issued, anchored or written to a token by this example. An import is data, and proves nothing about who observed an event.')
