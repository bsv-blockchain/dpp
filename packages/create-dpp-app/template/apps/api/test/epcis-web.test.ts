// The words the web client puts on EPCIS answers, exercised here because the
// web app has no test runner of its own and this module touches neither the
// page nor the network. Each answer below is a real one, from the API over
// the module, so the test holds the page's words to what the API sends: that
// an upload was refused or retained, that a history is partial, and that a
// valid document is never worded as a signed or verified one. The pages
// around it are type-checked by the build.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SUPPLIED_DATA_NOTICE,
  countsLine,
  describePull,
  describePullRefusal,
  describeRefusal,
  describeRetained,
  describeSource,
  eventCounts,
  extensionMembers,
  findingsOf,
  latestFirst,
  mediaTypeOf,
  originalPath,
  passportSpellings,
  provenanceLabel,
  queryFromForm,
  validityLabel,
  type EpcisEventsAnswer,
  type EpcisImportAnswer,
  type EpcisImportSummary,
  type EpcisPullResult,
  type EpcisSource,
} from '../../web/src/lib/epcis'
import { mintPassportId } from '../src/identifiers.js'
import { epcisDocument, item, objectEvent, startApp, startEpcisSource, testConfig, utf8, type Answer, type FixtureSource, type TestApp } from './epcis-fixtures.js'

const PASSPORT = mintPassportId({ host: 'passports.example.com', prefix: '952' }, '100000001', 'WEB-1')
let api: TestApp
let fixture: FixtureSource
let failing: FixtureSource

beforeAll(async () => {
  fixture = await startEpcisSource(Array.from({ length: 5 }, (_, index) => objectEvent(index + 1, [item(`WEB-${index + 1}`)])))
  failing = await startEpcisSource(Array.from({ length: 5 }, (_, index) => objectEvent(index + 1, [item(`WEB-${index + 1}`)])), { failRequest: (n) => (n === 2 ? 503 : undefined) })
  api = await startApp({
    config: testConfig({
      EPCIS_SOURCES: 'supplier-a,supplier-b,misconfigured',
      EPCIS_SOURCE_SUPPLIER_A_URL: fixture.baseUrl,
      EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'true',
      EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: 'a-credential-the-page-never-sees',
      EPCIS_SOURCE_SUPPLIER_B_URL: failing.baseUrl,
      EPCIS_SOURCE_SUPPLIER_B_LOCAL_TEST: 'true',
      EPCIS_SOURCE_MISCONFIGURED_URL: 'https://events.example.org/epcis',
      EPCIS_SOURCE_MISCONFIGURED_ORIGINS: 'https://other.example.org',
      EPCIS_SOURCE_MISCONFIGURED_REPEAT_LISTS: 'true',
    }),
  })
})
afterAll(async () => {
  await api.close()
  await fixture.close()
  await failing.close()
})

/** An error answer as the web client's fetch wrapper hands it to a page: the code, the description and everything else. */
const asApiError = (answer: Answer): { code: string; message: string; details: Record<string, unknown> } => {
  const { error, description, ...details } = answer.body as { error: string; description: string } & Record<string, unknown>
  return { code: error, message: description, details }
}

describe('what the events page says about an upload', () => {
  it('says a retained document is held exactly, and that a valid one is not a signed one', async () => {
    const bytes = utf8(JSON.stringify(epcisDocument([objectEvent(1, [PASSPORT, item('WEB-A')]), objectEvent(2, [item('WEB-A')], { 'example:note': 'seen on the line' })])))
    const first = await api.upload('/api/epcis/imports?requestId=web-1', bytes)
    const described = describeRetained(first.body as EpcisImportAnswer)
    expect(described).toMatchObject({ tone: 'pass', title: 'Retained' })
    expect(described.lines[0]).toBe(`The exact bytes are kept: ${bytes.byteLength} bytes, SHA-256 ${first.body.record.sha256}.`)
    const text = described.lines.join(' ')
    expect(text).toMatch(/passed the format check/)
    expect(text).toMatch(/It is not signed, and nothing here verifies who made it or that its events happened\./)
    expect(text).toMatch(/2 events: 2 new, 0 already held, 0 observed again, 0 in conflict\./)
    expect(described.lines.at(-1)).toBe('Nothing was signed, issued or written to a passport.')
    // Nowhere is a retained document called verified, authentic or trusted.
    expect(text).not.toMatch(/\b(verified|authentic|trusted|proven)\b/)

    // Sent again, it is the same import and the page says so.
    const again = describeRetained((await api.upload('/api/epcis/imports?requestId=web-1', bytes)).body as EpcisImportAnswer)
    expect(again.title).toBe('Already retained')
    expect(again.lines.join(' ')).toMatch(/already used for the same bytes.*No second copy was kept\./)
  })

  it('says a document that failed the format check was kept, with its findings, and warns', async () => {
    const { action: _dropped, ...withoutAction } = objectEvent(3, [item('WEB-B')])
    const answer = (await api.upload('/api/epcis/imports?requestId=web-invalid', utf8(JSON.stringify(epcisDocument([withoutAction]))))).body as EpcisImportAnswer
    const described = describeRetained(answer)
    expect(described).toMatchObject({ tone: 'warn', title: 'Retained' })
    expect(described.lines.join(' ')).toMatch(/was kept and did not pass the format check\. \d+ findings? say why\. Its events are not listed against products\./)
    expect(findingsOf(answer.record).length).toBeGreaterThan(0)
    expect(validityLabel(answer.record.documentValidity)).toEqual({ tone: 'warn', label: 'Invalid format, unsigned' })
  })

  it('says a second body under a held event identifier is kept beside the first', async () => {
    await api.upload('/api/epcis/imports?requestId=web-body-1', utf8(JSON.stringify(epcisDocument([objectEvent(7, [item('WEB-C')])]))))
    const answer = (await api.upload('/api/epcis/imports?requestId=web-body-2', utf8(JSON.stringify(epcisDocument([objectEvent(7, [item('WEB-C')], { disposition: 'in_transit' })]))))).body as EpcisImportAnswer
    const described = describeRetained(answer)
    expect(described.tone).toBe('warn')
    expect(described.lines.join(' ')).toMatch(/1 event arrived with another body than the one already held under the same identifier\. Both are kept until someone records a decision\./)
    expect(eventCounts(answer.record)).toEqual({ total: 1, new: 0, duplicate: 0, newObservation: 0, conflict: 1 })
  })

  it('says a refused upload was refused, why, and that nothing was kept', async () => {
    const malformed = describeRefusal(asApiError(await api.upload('/api/epcis/imports?requestId=web-bad', utf8('{"type":'))))
    expect(malformed).toMatchObject({ tone: 'fail', title: 'Refused: malformed-json' })
    expect(malformed.lines.at(-1)).toBe('Nothing was kept.')
    const wrongType = describeRefusal(asApiError(await api.upload('/api/epcis/imports?requestId=web-type', utf8('{}'), 'text/csv')))
    expect(wrongType.title).toBe('Refused: unsupported-media-type')
    const conflict = describeRefusal(asApiError(await api.upload('/api/epcis/imports?requestId=web-1', utf8('{}'))))
    expect(conflict.title).toBe('Refused: this request identifier is already used for other bytes')
    expect(conflict.lines.join(' ')).toMatch(/Nothing of this upload was kept\./)
    // A refusal that can be remedied says how.
    expect(describeRefusal({ code: 'gs1-artefact-unavailable', message: 'The GS1 artefact is not in the folder.', details: { remedy: 'Run "dpp-gs1-artefacts fetch".', kept: false } }).lines).toEqual(['The GS1 artefact is not in the folder.', 'Run "dpp-gs1-artefacts fetch".', 'Nothing was kept.'])
  })
})

describe('what the events page says about a pull', () => {
  it('shows the outcome in the module\'s own words, and says an exhausted query is not a complete history', async () => {
    const result = (await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'web', query: { perPage: 2 } })).body as EpcisPullResult
    const described = describePull(result)
    expect(described).toMatchObject({ tone: 'pass', title: 'ok: exhausted (exhausted)', partial: false })
    expect(described.lines[0]).toBe(result.detail)
    expect(described.lines[1]).toMatch(/The source named no further page for this query\. That is the end of this query, and not a statement that the source holds nothing else\./)
    expect(described.lines).toContain('3 pages retained in this run. 5 events: 5 new, 0 already held, 0 observed again, 0 in conflict.')
    expect(described.lines).toContain('The local-test option is on for this source: plain http and private addresses were permitted.')
    // Every reason the module gives for the history not being complete is shown as it gave it.
    expect(result.completenessLimits.length).toBeGreaterThan(0)
    for (const limit of result.completenessLimits) expect(described.lines).toContain(`Not complete history: ${limit}.`)
    expect(described.lines.join(' ')).not.toMatch(/complete history of the source is held|all events/i)
  })

  it('says so when the history is partial, whatever the outcome is called', async () => {
    const stopped = (await api.post('/api/epcis/sources/supplier-b/pulls', { queryId: 'web', query: { perPage: 2 } })).body as EpcisPullResult
    const described = describePull(stopped)
    expect(described).toMatchObject({ tone: 'warn', title: 'source-unavailable: http-error (failed)', partial: true })
    expect(described.lines[1]).toMatch(/^History is partial: this run ended before the source named a last page\./)
    expect(described.lines).toContain('1 page retained in this run. 2 events: 2 new, 0 already held, 0 observed again, 0 in conflict.')
    // The next run continues, and says it did.
    const resumed = describePull((await api.post('/api/epcis/sources/supplier-b/pulls', { queryId: 'web', query: { perPage: 2 } })).body as EpcisPullResult)
    expect(resumed).toMatchObject({ title: 'ok: exhausted (exhausted)', partial: false })
    expect(resumed.lines).toContain('This was run 2. It continued from where the run before it stopped.')
    // A run that retained nothing is a failure, and one a limit stopped is a warning with the module's outcome as its title.
    expect(describePull({ ...stopped, pages: [], events: { total: 0, new: 0, duplicate: 0, newObservation: 0, conflict: 0 } }).tone).toBe('fail')
    expect(describePull({ ...stopped, outcome: 'partial-history', reason: 'page-limit', completion: 'stopped-at-limit', leniencies: ['empty-final-page'] })).toMatchObject({ tone: 'warn', title: 'partial-history: page-limit (stopped-at-limit)', partial: true })
    expect(describePull({ ...stopped, leniencies: ['empty-final-page', 'list-parameters-repeated'] }).lines).toContain('Accepted leniently: empty-final-page, list-parameters-repeated.')
  })

  it('says a refused pull asked nothing of the source', async () => {
    const refused = describePullRefusal(asApiError(await api.post('/api/epcis/sources/misconfigured/pulls', { queryId: 'web', query: {} })))
    expect(refused).toMatchObject({ tone: 'fail', title: 'Refused: invalid-request' })
    expect(refused.lines.at(-1)).toBe('Nothing was requested from the source, and nothing was kept.')
  })

  it('describes a source: where it goes, whether a credential is set, and the local-test option', async () => {
    const sources = (await api.get('/api/epcis/sources')).body as EpcisSource[]
    const [first, , misconfigured] = sources
    expect(describeSource(first!)).toEqual([`Queries go to ${fixture.baseUrl}/events.`, `Requests may go to: ${fixture.origin}.`, 'A credential is set on the server (bearer). It is never sent to this page.', 'Local test is on: plain http and private addresses are permitted. Use it only for a source on your own machine.'])
    expect(describeSource(sources[1]!)).toContain('No credential is set.')
    const lines = describeSource(misconfigured!)
    expect(lines).toContain('Lists are sent as repeated parameters, which is recorded as a leniency.')
    expect(lines.at(-1)).toMatch(/^This source cannot be pulled from as it is configured: its permitted origins do not list https:\/\/events\.example\.org/)
    expect(lines.join(' ')).not.toMatch(/Local test is on/)
    // What the page is sent about a source holds no credential to show.
    expect(JSON.stringify(sources)).not.toContain('a-credential-the-page-never-sees')
    expect(queryFromForm({ identifiers: ` ${item('WEB-1')} \n\n${item('WEB-2')},`, eventTypes: 'ObjectEvent', eventIds: '', from: '2026-03-02T08:00:00Z', until: ' ', perPage: '2' })).toEqual({ matchAnyEPC: [item('WEB-1'), item('WEB-2')], eventTypes: ['ObjectEvent'], eventTime: { from: '2026-03-02T08:00:00Z' }, perPage: 2 })
    expect(queryFromForm({ identifiers: '', eventTypes: '', eventIds: '', from: '', until: '', perPage: 'many' })).toEqual({})
  })
})

describe('what a passport page says about the events that name it', () => {
  it('labels every event as supplied data, with its source and its validity, and never as signed or verified', async () => {
    const answer = (await api.get(`/api/epcis/events?identifier=${encodeURIComponent(PASSPORT)}`)).body as EpcisEventsAnswer
    expect(answer.events).toHaveLength(1)
    const [entry] = answer.events
    expect(validityLabel(entry!.source.documentValidity)).toEqual({ tone: 'neutral', label: 'Valid format, unsigned' })
    expect(provenanceLabel(entry!.source.provenance)).toBe('Uploaded file')
    expect(SUPPLIED_DATA_NOTICE).toMatch(/data a source supplied/)
    expect(SUPPLIED_DATA_NOTICE).toMatch(/Nobody signed them here\. Not the holder of this passport, not its brand and not the source\./)
    expect(SUPPLIED_DATA_NOTICE).toMatch(/It does not mean the event happened, or that anyone verified who reported it\./)
    // The label of a valid document is never the green of a passed check.
    for (const validity of ['valid', 'invalid'] as const) expect(validityLabel(validity).tone).not.toBe('pass')

    const pulled = (await api.get(`/api/epcis/events?identifier=${encodeURIComponent(item('WEB-4'))}`)).body as EpcisEventsAnswer
    expect(provenanceLabel(pulled.events[0]!.source.provenance)).toBe(`Page 2 of a query to ${fixture.origin}`)
    expect(originalPath(pulled.events[0]!.source.importId)).toBe(`/api/epcis/imports/${encodeURIComponent(pulled.events[0]!.source.importId)}/original`)
  })

  it('shows every extension member of an event, and drops none it has no value for', async () => {
    const answer = (await api.get(`/api/epcis/events?identifier=${encodeURIComponent(item('WEB-A'))}`)).body as EpcisEventsAnswer
    const extended = answer.events.find((entry) => (entry.event?.preservedExtensions.length ?? 0) > 0)!
    expect(extensionMembers(extended)).toEqual([{ name: 'example:note', value: 'seen on the line', held: true }])
    expect(extensionMembers(answer.events.find((entry) => entry !== extended)!)).toEqual([])
    // An entry that names a member and carries no body still lists the member.
    expect(extensionMembers({ event: extended.event })).toEqual([{ name: 'example:note', value: undefined, held: false }])
    expect(extensionMembers({ event: { ...extended.event!, preservedExtensions: ['example:empty', 'example:note'] }, body: { 'example:empty': null, 'example:note': { deep: [1, 2] } } })).toEqual([{ name: 'example:empty', value: null, held: true }, { name: 'example:note', value: { deep: [1, 2] }, held: true }])
  })

  it('searches the passport\'s own identifier and the same path at the GS1 resolver, and says which', () => {
    expect(passportSpellings(PASSPORT)).toEqual([PASSPORT, PASSPORT.replace('https://passports.example.com', 'https://id.gs1.org')])
    expect(passportSpellings('https://id.gs1.org/01/09521000000011/21/A1')).toEqual(['https://id.gs1.org/01/09521000000011/21/A1'])
    expect(passportSpellings('urn:epc:id:sgtin:9521234.012345.A1')).toEqual(['urn:epc:id:sgtin:9521234.012345.A1'])
    expect(passportSpellings('not an identifier')).toEqual(['not an identifier'])
  })
})

describe('the small things the events page decides', () => {
  it('sends a file under an EPCIS media type when it has one, and lets the API refuse the rest', () => {
    expect(mediaTypeOf({ name: 'events.jsonld', type: '' })).toBe('application/ld+json')
    expect(mediaTypeOf({ name: 'events.json', type: '' })).toBe('application/json')
    expect(mediaTypeOf({ name: 'events.json', type: 'application/ld+json; charset=utf-8' })).toBe('application/ld+json')
    expect(mediaTypeOf({ name: 'events.xml', type: 'text/xml' })).toBe('text/xml')
    expect(mediaTypeOf({ name: 'events', type: '' })).toBe('application/octet-stream')
  })

  it('lists the latest import first and counts events in plain words', async () => {
    const imports = (await api.get('/api/epcis/imports?limit=200')).body.imports as EpcisImportSummary[]
    const ordered = latestFirst(imports)
    expect(ordered).toHaveLength(imports.length)
    for (let i = 1; i < ordered.length; i += 1) expect(ordered[i - 1]!.receivedAt >= ordered[i]!.receivedAt).toBe(true)
    expect(countsLine({ total: 0, new: 0, duplicate: 0, newObservation: 0, conflict: 0 })).toBe('No events.')
    expect(countsLine({ total: 1, new: 1, duplicate: 0, newObservation: 0, conflict: 0 })).toBe('1 event: 1 new, 0 already held, 0 observed again, 0 in conflict.')
  })
})
