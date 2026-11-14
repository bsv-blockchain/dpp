#!/usr/bin/env node
/**
 * Pull EPCIS events from a source through the standard events query, under
 * the epcis-json@1 profile (spec/epcis-interoperability.md section 3),
 * printing one sentence per finding. Runs from the packed packages: the only
 * imports are @bsv/dpp-credentials and its ./epcis-exchange entry point.
 *
 *   node examples/pull-epcis.mjs            # a stand-in source on this machine, the seven-event fixture
 *   node examples/pull-epcis.mjs --offline  # use the provisioned GS1 files and fetch nothing from GS1
 *
 * The source here is a stand-in that this example starts on 127.0.0.1 and
 * stops again. It answers `GET /events` with pages of three events and a
 * next link, which is all the example needs of it. It is not an EPCIS
 * repository. To pull from a real one, see scripts/epcis-pull-interop.mjs.
 *
 * The pull is kept in memory, because the stand-in has a new address on
 * every run and a pull is bound to the address of its source. A deployment
 * hands pullEpcisEvents a durable store, such as openFileEpcisStorage.
 *
 * What it does: asks for pages within the profile's limits, hands each page
 * to the same import a file takes, moves its checkpoint only after a page is
 * retained, and says how the run ended. What it does not do: capture events,
 * subscribe, crawl, map, sign, issue, anchor or touch a token. A pull never
 * says it holds the complete history of a source.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { provisionGs1Artefacts } from '@bsv/dpp-credentials'
import { createMemoryEpcisStorage, getEpcisImport, pullEpcisEvents } from '@bsv/dpp-credentials/epcis-exchange'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = (sentence) => console.log(sentence)
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const rest = process.argv.slice(2)
if (rest.some((a) => a !== '--offline')) {
  console.error('usage: node examples/pull-epcis.mjs [--offline]')
  process.exit(2)
}

// Provisioning is explicit and comes first: a page is refused without the pinned schema, so none is asked for.
const artefacts = await provisionGs1Artefacts({ offline: rest.includes('--offline') })
for (const file of artefacts.files.filter((f) => f.outcome === 'fetched')) say(`Obtained ${file.fileName} from GS1 and checked it against its pinned digest.`)
if (!artefacts.ok) {
  for (const file of artefacts.files.filter((f) => f.outcome === 'failed')) say(`The pinned GS1 file ${file.fileName} is not available in ${artefacts.dir}: ${file.reason}: ${file.detail}.`)
  say('Nothing is validated without the pinned schema. Run dpp-gs1-artefacts fetch with network access, or place the files GS1 publishes in that folder.')
  process.exit(1)
}

/* ---- the stand-in source ---- */

const fixture = JSON.parse(readFileSync(join(root, 'fixtures/vectors/dpp/interoperability/epcis/v1.json'), 'utf8')).vectors.find((v) => v.id === 'five-event-document').input.document
const events = fixture.epcisBody.eventList
const PER_PAGE = 3
const standIn = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname !== '/epcis/events') { response.writeHead(404).end(); return }
  const offset = Number(url.searchParams.get('nextPageToken') ?? '0')
  const headers = { 'content-type': 'application/ld+json', 'GS1-EPCIS-Version': '2.0.0', 'GS1-CBV-Version': '2.0.0' }
  if (offset + PER_PAGE < events.length) headers.Link = `</epcis/events?perPage=${PER_PAGE}&nextPageToken=${offset + PER_PAGE}>; rel="next"`
  response.writeHead(200, headers).end(JSON.stringify({ '@context': fixture['@context'], type: 'EPCISQueryDocument', schemaVersion: '2.0', creationDate: '2026-03-03T07:00:00.000Z', epcisBody: { queryResults: { queryName: 'SimpleEventQuery', resultsBody: { eventList: events.slice(offset, offset + PER_PAGE) } } } }))
})
await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${standIn.address().port}`
say(`Started a stand-in source at ${origin}, holding the ${events.length} events of the fixture. It is not an EPCIS repository.`)

/* ---- the pull ---- */

// The storage is handed in, like the transport. The module opens nothing by itself.
const storage = createMemoryEpcisStorage()
say('Using storage in memory, which is gone when this run ends.')
try {
  // The source: where it is, where its requests may go, the limits in force, and how its credential is obtained.
  const source = {
    sourceId: 'example-source',
    baseUrl: `${origin}/epcis`,
    permittedOrigins: [origin],
    policy: { policyId: 'example-policy@1' },
    // This source needs no credential. One that does is given a function here, never a value, and the value is written nowhere.
    credentials: undefined,
    // Plain http on this machine is permitted for the example only. A real source is https, and this is left out.
    localTest: true,
  }
  const pull = () => pullEpcisEvents({ storage, source, queryId: 'example-query', query: { perPage: PER_PAGE }, fetch })

  const report = async (result) => {
    if (result.outcome === 'refused') { say(`Refused, and nothing was requested or kept: ${result.reason}: ${result.detail}.`); process.exitCode = 1; return }
    say(`Run ${result.run.run} of pass ${result.pull.pass.number} ${result.run.resumed ? 'continued from the checkpoint' : result.pull.pass.window.basis === 'watermark' ? 'began a new pass at the watermark less the overlap' : 'began at the query\'s bounds'} and asked ${source.baseUrl}/events with ${Object.entries(result.pull.pass.parameters).map(([name, value]) => `${name}=${value}`).join(', ')}.`)
    for (const page of result.pages) {
      const record = await getEpcisImport(storage, page.importId)
      say(`Page ${page.page} held ${plural(page.events.total, 'event')} in ${page.byteLength} bytes (${page.events.new} new, ${page.events.duplicate} already held, ${page.events.newObservation} observed again, ${page.events.conflict} in conflict) and is retained as ${record.importId}, ${record.documentValidity}, with provenance ${record.sourceLocation.kind} page ${record.sourceLocation.page} from ${record.sourceLocation.origin}${page.importReplayed ? '; the same bytes were already held, so no second import was written' : ''}.`)
    }
    say(`The source reported EPCIS ${result.server.epcis ?? 'in no header'} and CBV ${result.server.cbv ?? 'in no header'}.`)
    say(`Outcome: ${result.outcome} (${result.reason}); the run ${result.completion === 'exhausted' ? 'exhausted the source\'s pages for this pass' : result.completion === 'stopped-at-limit' ? 'stopped at a limit' : 'failed'}. In detail: ${result.detail}.`)
    say(`Limits in force: ${result.limits.maxPullPages} pages, ${result.limits.maxPullBytes} bytes and ${result.limits.maxPullSeconds} seconds a run, ${result.limits.maxDocumentBytes} bytes and ${result.limits.maxEventsPerPage} events a page${result.limitOverrides.length === 0 ? ', all the profile\'s defaults' : `; set by the operator: ${result.limitOverrides.map((o) => `${o.limit} ${o.value}`).join(', ')}`}.${result.localTest ? ' The local-test option was on.' : ''}`)
    for (const limit of result.completenessLimits) say(`Not complete history: ${limit}.`)
    if (result.pull.watermark != null) say(`The watermark is ${result.pull.watermark.recordTime}: the next pass asks for events recorded since ${result.pull.recordTimeOverlapSeconds} seconds before it.`)
    if (result.outcome !== 'ok') process.exitCode = 1
  }

  await report(await pull())
  // The same pull again. The pass before was exhausted, so this run begins the next one and recognises what it already holds.
  say('Pulling again.')
  await report(await pull())
} finally {
  await new Promise((resolve) => standIn.close(resolve))
  say('Stopped the stand-in source.')
}
say('Nothing was signed, issued, anchored or written to a token by this example. A pull is data, and proves nothing about who observed an event.')
