// EPCIS exchange over the API: file import, a configured pull and exact
// export. Every answer here comes from `@bsv/dpp-credentials/epcis-exchange`
// through the routes under /api/epcis. The tests hold the routes to what the
// module promises: an upload is retained as the exact bytes that arrived, a
// retry is the same request, a refused transport keeps nothing, a pull
// continues where it stopped, and an export is the original, byte for byte.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EPCIS_GS1_ARTEFACTS } from '@bsv/dpp-credentials'
import { EPCIS_RECORD_KINDS, EpcisStorageFault, checkEpcisExchangeInvariants, faultInjectingEpcisStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { EPCIS_DEFAULT_LIMITS } from '@bsv/dpp-credentials/epcis-source'
import { openMongoEpcisStorage } from '../src/epcis/mongo-storage.js'
import { mintPassportId } from '../src/identifiers.js'
import { epcisDocument, eventId, gs1Dir, item, objectEvent, sha256, startApp, startEpcisSource, startMongo, testConfig, utf8, type FixtureSource, type Json, type TestApp, type TestMongo } from './epcis-fixtures.js'

const SECRET = 'source-credential-51c9e0aa7b'
const apps: TestApp[] = []
const sources: FixtureSource[] = []
const folders: string[] = []
let mongo: TestMongo

beforeAll(async () => {
  mongo = await startMongo()
})
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(sources.splice(0).map((source) => source.close()))
})
afterAll(async () => {
  await mongo.stop()
  for (const dir of folders) rmSync(dir, { recursive: true, force: true })
})

const app = async (options: Parameters<typeof startApp>[0] = {}): Promise<TestApp> => {
  const started = await startApp(options)
  apps.push(started)
  return started
}
const source = async (...args: Parameters<typeof startEpcisSource>): Promise<FixtureSource> => {
  const started = await startEpcisSource(...args)
  sources.push(started)
  return started
}
/** The settings of one configured source that points at a fixture on this machine. */
const sourceSettings = (fixture: FixtureSource, over: Record<string, string> = {}): Record<string, string> => ({
  EPCIS_SOURCES: 'supplier-a',
  EPCIS_SOURCE_SUPPLIER_A_URL: fixture.baseUrl,
  EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'true',
  EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: SECRET,
  ...over,
})
const ref = (id: string): string => encodeURIComponent(id)
const importsOf = async (api: TestApp): Promise<Json[]> => (await api.get('/api/epcis/imports?limit=200')).body.imports as Json[]

// A passport identifier as this application mints one: a GS1 Digital Link under the demonstration prefix, with its check digit.
const PASSPORT = mintPassportId({ host: 'passports.example.com', prefix: '952' }, '100000001', 'EVENTS-1')
const valid = (): Json => epcisDocument([objectEvent(1, [item('HTTP-1'), PASSPORT]), objectEvent(2, [item('HTTP-1')], { 'example:note': 'seen on the line', 'example:reading': { value: 21.5, unit: 'CEL' } })])
/**
 * A valid document written the way no serialiser here would write it: tabs,
 * carriage returns, members out of their usual order, an escaped character,
 * a number with an exponent and blank lines at the end. An export that had
 * been parsed and written out again would differ from it.
 */
const UNUSUAL = utf8(
  [
    '{\r\n\t"epcisBody" :\t{ "eventList":[',
    `\t\t{ "disposition":"active","bizStep" : "inspecting", "action":"OBSERVE"   ,"epcList":["${item('HTTP-9')}"],`,
    `\t\t  "recordTime":"2026-03-02T09:09:00.000Z","eventTimeZoneOffset":"+00:00","eventTime":"2026-03-02T08:09:00.000Z","eventID":"${eventId(9)}",`,
    '\t\t  "example:weight" : 1.250e1, "example:label":"caf\\u00e9", "type":"ObjectEvent" }',
    '\t] },',
    '  "creationDate":"2026-03-03T07:00:00.000Z",   "schemaVersion":"2.0",',
    '  "type":"EPCISDocument",',
    '  "@context":[ "https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld",{"example":"https://example.org/vocab/"} ]',
    '}\n\n\n',
  ].join('\r\n')
)

describe('sign-in', () => {
  it('guards every exchange route, and keeps nothing of an upload that was not signed in', async () => {
    const api = await app({ session: null })
    const bytes = utf8(JSON.stringify(valid()))
    expect((await api.upload('/api/epcis/imports?requestId=anonymous', bytes)).status).toBe(401)
    for (const path of ['/api/epcis/status', '/api/epcis/sources', '/api/epcis/imports', '/api/epcis/imports/x', '/api/epcis/imports/x/original', '/api/epcis/sources/supplier-a/pulls/all', `/api/epcis/events?identifier=${ref(PASSPORT)}`, '/api/epcis/conflicts', '/api/epcis/conflicts/x']) {
      const answer = await api.get(path)
      expect(answer.status, path).toBe(401)
      expect(answer.body, path).toMatchObject({ error: 'sign-in-required' })
    }
    expect((await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })).status).toBe(401)
    expect((await api.post('/api/epcis/conflicts/x/resolutions', { decision: 'x', disposition: 'all-retained' })).status).toBe(401)
    expect(await api.exchange.listImports({})).toEqual([])
    expect(await api.exchange.storage.getBytes(sha256(bytes))).toBeUndefined()
  })
})

describe('importing an uploaded document', () => {
  it('retains the upload, answers its findings, lists it and reads it back', async () => {
    const api = await app()
    const bytes = utf8(JSON.stringify(valid(), null, 2))
    const answer = await api.upload('/api/epcis/imports?requestId=upload-1&filename=line-events.jsonld', bytes)
    expect(answer.status).toBe(201)
    expect(answer.body).toMatchObject({ outcome: 'retained', replayed: false, resumed: false })
    const record = answer.body.record
    expect(record).toMatchObject({ sourceId: 'upload', requestId: 'upload-1', mediaType: 'application/ld+json', byteLength: bytes.byteLength, sha256: sha256(bytes), documentValidity: 'valid', state: 'evaluated', sourceLocation: { kind: 'file', filename: 'line-events.jsonld' }, policyId: 'starter-default@1' })
    expect(record.events.map((event: Json) => event.arrival)).toEqual(['new', 'new'])
    // A member the schema does not name is kept and named, never dropped.
    expect(record.events[1].preservedExtensions).toEqual(['example:note', 'example:reading'])
    // Nothing was mapped, signed or published: the record says so itself.
    expect(record.events.every((event: Json) => (event.mapping as Json).outcome === 'not-attempted')).toBe(true)

    expect(await importsOf(api)).toEqual([expect.objectContaining({ importId: record.importId, sourceId: 'upload', requestId: 'upload-1', sha256: sha256(bytes), documentValidity: 'valid', state: 'evaluated', events: 2, conflicts: 0, provenance: { kind: 'file', filename: 'line-events.jsonld' } })])
    const read = await api.get(`/api/epcis/imports/${ref(record.importId)}`)
    expect(read.status).toBe(200)
    expect(read.body).toEqual(record)
    expect((await api.get(`/api/epcis/imports/${ref('urn:bsv:dpp:epcis:import:sha256:' + '0'.repeat(64))}`)).status).toBe(404)
  })

  it('retains a document that parses and fails validation, with its findings, and says it is invalid', async () => {
    const api = await app()
    const { action: _dropped, ...withoutAction } = objectEvent(3, [item('HTTP-3')])
    const answer = await api.upload('/api/epcis/imports?requestId=invalid-1', utf8(JSON.stringify(epcisDocument([withoutAction]))))
    expect(answer.status).toBe(201)
    expect(answer.body.record).toMatchObject({ documentValidity: 'invalid', state: 'evaluated' })
    const findings = [...answer.body.record.findings, ...answer.body.record.events.flatMap((event: Json) => (event.validation as { findings: Json[] }).findings)]
    expect(findings.some((finding: Json) => finding.severity === 'error')).toBe(true)
    expect((await importsOf(api))[0]).toMatchObject({ documentValidity: 'invalid' })
    expect((await importsOf(api))[0]!.findings).toBeGreaterThan(0)
  })

  it('answers a retry with the same request identifier as the same request, with one receipt', async () => {
    const api = await app()
    const bytes = utf8(JSON.stringify(valid()))
    const first = await api.upload('/api/epcis/imports?requestId=retry-1', bytes)
    const again = await api.upload('/api/epcis/imports?requestId=retry-1', bytes)
    expect([first.status, again.status]).toEqual([201, 200])
    expect(again.body).toMatchObject({ outcome: 'retained', replayed: true })
    expect(again.body.record).toEqual(first.body.record)
    expect(await importsOf(api)).toHaveLength(1)

    // Three copies of one new request sent at once: one import, answered three times.
    const together = await Promise.all([1, 2, 3].map(() => api.upload('/api/epcis/imports?requestId=retry-2', bytes)))
    expect(together.map((answer) => answer.status).sort()).toEqual([200, 200, 201])
    expect(new Set(together.map((answer) => answer.body.record.importId)).size).toBe(1)
    expect(await importsOf(api)).toHaveLength(2)
    // The second request holds the same bytes as the first, and every event of it repeats one that is held.
    expect(together[0]!.body.record.events.map((event: Json) => event.arrival)).toEqual(['duplicate', 'duplicate'])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
  })

  it('refuses the same request identifier with different bytes, and the first import stands', async () => {
    const api = await app()
    const bytes = utf8(JSON.stringify(valid()))
    const other = utf8(JSON.stringify(valid(), null, 1))
    const first = await api.upload('/api/epcis/imports?requestId=conflict-1', bytes)
    const second = await api.upload('/api/epcis/imports?requestId=conflict-1', other)
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ error: 'request-conflict', outcome: 'request-conflict', kept: false, existingImportId: first.body.record.importId })
    // The same bytes under another media type are another request too.
    expect((await api.upload('/api/epcis/imports?requestId=conflict-1', bytes, 'application/json')).status).toBe(409)
    expect(await importsOf(api)).toHaveLength(1)
    expect(await api.exchange.storage.getBytes(sha256(other))).toBeUndefined()
    expect(sha256((await api.get(`/api/epcis/imports/${ref(first.body.record.importId)}/original`)).bytes)).toBe(sha256(bytes))
    // The same identifier under another source scope is another request.
    expect((await api.upload('/api/epcis/imports?requestId=conflict-1&sourceId=other-source', other)).status).toBe(201)
  })

  it('refuses a transport it cannot keep with a clear status, and keeps nothing', async () => {
    const api = await app()
    const good = JSON.stringify(valid())
    const justOver = utf8(`${good}${' '.repeat(EPCIS_DEFAULT_LIMITS.maxDocumentBytes + 1 - good.length)}`)
    const farOver = utf8(`${good}${' '.repeat(EPCIS_DEFAULT_LIMITS.maxDocumentBytes * 2)}`)
    const cases: Array<[string, Uint8Array, string, Record<string, string>, number, string]> = [
      ['a media type that is not EPCIS', utf8(good), 'text/plain', {}, 415, 'unsupported-media-type'],
      ['no media type', utf8(good), '', {}, 415, 'unsupported-media-type'],
      ['bytes that are not JSON', utf8('{"type":"EPCISDocument",'), 'application/ld+json', {}, 422, 'malformed-json'],
      ['no bytes at all', new Uint8Array(0), 'application/ld+json', {}, 422, 'malformed-json'],
      ['a member written twice', utf8('{"type":"EPCISDocument","type":"EPCISDocument"}'), 'application/json', {}, 422, 'duplicate-key'],
      ['bytes that are not UTF-8', new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), 'application/json', {}, 422, 'malformed-utf8'],
      ['a document one byte past the limit', justOver, 'application/ld+json', {}, 413, 'oversized'],
      ['a document far past the limit', farOver, 'application/ld+json', {}, 413, 'oversized'],
      ['a compressed body', new Uint8Array(gzipSync(good)), 'application/ld+json', { 'content-encoding': 'gzip' }, 415, 'content-encoding-unsupported'],
    ]
    for (const [what, bytes, mediaType, headers, status, code] of cases) {
      const answer = await api.upload(`/api/epcis/imports?requestId=${ref(what)}`, bytes, mediaType, headers)
      expect(answer.status, what).toBe(status)
      expect(answer.body, what).toMatchObject({ error: code, outcome: 'refused', kept: false })
      expect(typeof answer.body.description, what).toBe('string')
      expect(await api.exchange.storage.getBytes(sha256(bytes)), what).toBeUndefined()
    }
    const unnamed = await api.upload('/api/epcis/imports', utf8(good))
    expect(unnamed.status).toBe(400)
    expect(unnamed.body.error).toBe('request-id-required')
    // Nothing was kept of any of them: no receipt, no record of any kind.
    expect(await importsOf(api)).toEqual([])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
    for (const kind of Object.values(EPCIS_RECORD_KINDS)) expect(await api.exchange.storage.list(kind, { limit: 10 }), kind).toEqual([])
  })
})

describe('exporting an original', () => {
  it('answers the uploaded bytes, byte for byte and by digest, under the media type they arrived with', async () => {
    const api = await app()
    const imported = await api.upload('/api/epcis/imports?requestId=unusual-1', UNUSUAL)
    expect(imported.status).toBe(201)
    expect(imported.body.record).toMatchObject({ documentValidity: 'valid', sha256: sha256(UNUSUAL), byteLength: UNUSUAL.byteLength })
    const exported = await api.get(`/api/epcis/imports/${ref(imported.body.record.importId)}/original`)
    expect(exported.status).toBe(200)
    expect(sha256(exported.bytes)).toBe(sha256(UNUSUAL))
    expect(Buffer.from(exported.bytes).equals(Buffer.from(UNUSUAL))).toBe(true)
    // Parsing it and writing it out again would have given other bytes: the export is not that.
    expect(sha256(JSON.stringify(JSON.parse(exported.text)))).not.toBe(sha256(UNUSUAL))
    expect(exported.headers.get('content-type')).toBe('application/ld+json')
    expect(exported.headers.get('content-length')).toBe(String(UNUSUAL.byteLength))
    expect(exported.headers.get('x-content-sha256')).toBe(sha256(UNUSUAL))
    expect(exported.headers.get('content-disposition')).toMatch(/^attachment; filename="epcis-[0-9a-f]{16}\.jsonld"$/)
    expect(exported.headers.get('x-content-type-options')).toBe('nosniff')

    // The same bytes sent as plain JSON are another import, exported as plain JSON.
    const plain = await api.upload('/api/epcis/imports?requestId=unusual-2', UNUSUAL, 'application/json; charset=utf-8')
    const plainExport = await api.get(`/api/epcis/imports/${ref(plain.body.record.importId)}/original`)
    expect(plainExport.headers.get('content-type')).toBe('application/json')
    expect(sha256(plainExport.bytes)).toBe(sha256(UNUSUAL))
    expect((await api.get(`/api/epcis/imports/${ref('urn:bsv:dpp:epcis:import:sha256:' + 'f'.repeat(64))}/original`)).status).toBe(404)
  })
})

describe('the events that name a product', () => {
  it('lists each with its source and its validity, shows extension members, and says what an event is not', async () => {
    const api = await app()
    const first = await api.upload('/api/epcis/imports?requestId=events-1&sourceId=line-scanner', utf8(JSON.stringify(valid())))
    // An invalid document names the same product. It is retained, and it is not indexed.
    const { action: _dropped, ...withoutAction } = objectEvent(5, [PASSPORT])
    await api.upload('/api/epcis/imports?requestId=events-2', utf8(JSON.stringify(epcisDocument([withoutAction]))))

    const answer = await api.get(`/api/epcis/events?identifier=${ref(PASSPORT)}`)
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ identifier: PASSPORT, granularity: 'instance', nature: 'supplied-data' })
    expect(answer.body.notice).toMatch(/data a source supplied/)
    expect(answer.body.notice).toMatch(/not signed/)
    expect(answer.body.events).toHaveLength(1)
    expect(answer.body.events[0]).toMatchObject({
      association: { identifier: PASSPORT, role: 'object', granularity: 'instance', eventType: 'ObjectEvent', sourceId: 'line-scanner', errorDeclared: false },
      source: { importId: first.body.record.importId, sourceId: 'line-scanner', documentValidity: 'valid', state: 'evaluated', provenance: { kind: 'file' }, sha256: first.body.record.sha256 },
      event: { arrival: 'new', identityKind: 'event-id', identity: eventId(1) },
    })

    // The other item of the same document is in two events, one of which carries members the schema does not name.
    const other = (await api.get(`/api/epcis/events?identifier=${ref(item('HTTP-1'))}`)).body.events as Json[]
    expect(other).toHaveLength(2)
    const extended = other.find((entry) => ((entry.event as Json).preservedExtensions as string[]).length > 0)!
    expect((extended.event as Json).preservedExtensions).toEqual(['example:note', 'example:reading'])
    expect(extended.body).toMatchObject({ 'example:note': 'seen on the line', 'example:reading': { value: 21.5, unit: 'CEL' } })

    // Exact identifiers only, one item is not a class, and a source scope narrows the answer.
    expect((await api.get(`/api/epcis/events?identifier=${ref(PASSPORT.toLowerCase())}`)).body.events).toEqual([])
    expect((await api.get(`/api/epcis/events?identifier=${ref(PASSPORT)}&granularity=class`)).body.events).toEqual([])
    expect((await api.get(`/api/epcis/events?identifier=${ref(PASSPORT)}&sourceId=upload`)).body.events).toEqual([])
    expect((await api.get('/api/epcis/events')).status).toBe(400)
    expect((await api.get(`/api/epcis/events?identifier=${ref(PASSPORT)}&granularity=everything`)).status).toBe(400)
  })
})

describe('conflicts', () => {
  it('lists two bodies under one event identifier, and records a decision that removes neither', async () => {
    const api = await app()
    await api.upload('/api/epcis/imports?requestId=body-1', utf8(JSON.stringify(epcisDocument([objectEvent(7, [item('HTTP-7')])]))))
    const second = await api.upload('/api/epcis/imports?requestId=body-2', utf8(JSON.stringify(epcisDocument([objectEvent(7, [item('HTTP-7')], { disposition: 'in_transit' })]))))
    expect(second.body.record).toMatchObject({ state: 'blocked', events: [{ arrival: 'conflict', conflict: { state: 'open' } }] })
    const conflictId = second.body.record.events[0].conflict.conflictId as string

    const listed = await api.get('/api/epcis/conflicts')
    expect(listed.body).toMatchObject({ importsRead: 2, truncated: false, conflicts: [{ conflictId, state: 'open', identity: eventId(7), sourceId: 'upload' }] })
    expect(listed.body.conflicts[0].observations).toHaveLength(2)
    expect((await importsOf(api)).map((entry) => entry.conflicts).sort()).toEqual([0, 1])

    const path = `/api/epcis/conflicts/${ref(conflictId)}/resolutions`
    expect((await api.post(path, { decision: 'Keep both.', disposition: 'whichever' })).status).toBe(400)
    expect((await api.post(`/api/epcis/conflicts/${ref('urn:bsv:dpp:epcis:conflict:sha256:' + '0'.repeat(64))}/resolutions`, { decision: 'Keep both.', disposition: 'all-retained' })).status).toBe(404)
    const decision = { decision: 'The later reading stands. Both are kept.', disposition: 'all-retained', decidedAt: '2026-03-10T00:00:00.000Z' }
    const decided = await api.post(path, decision)
    expect(decided.status).toBe(201)
    expect(decided.body).toMatchObject({ outcome: 'recorded', replayed: false, resolution: { conflictId, disposition: 'all-retained', decidedBy: 'developer', decidedAt: decision.decidedAt, sequence: 1 } })
    // The same decision sent again is the one recorded.
    const again = await api.post(path, decision)
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ replayed: true, resolution: decided.body.resolution })

    const after = await api.get(`/api/epcis/conflicts/${ref(conflictId)}`)
    expect(after.body).toMatchObject({ state: 'resolved', currentResolutionId: decided.body.resolution.resolutionId })
    expect(after.body.observations).toHaveLength(2)
    expect(after.body.resolutions).toHaveLength(1)
    expect((await api.get(`/api/epcis/imports/${ref(second.body.record.importId)}`)).body).toMatchObject({ state: 'evaluated', events: [{ conflict: { state: 'resolved' } }] })
  })
})

describe('pulling from a configured source', () => {
  const seven = (): Json[] => Array.from({ length: 7 }, (_, index) => objectEvent(index + 1, [item(`PULL-${index + 1}`)]))

  it('describes the source without its credential, and reads several pages from it', async () => {
    const fixture = await source(seven(), { requireAuthorization: `Bearer ${SECRET}` })
    const api = await app({ config: testConfig(sourceSettings(fixture)) })

    const described = await api.get('/api/epcis/sources')
    expect(described.body).toEqual([{ sourceId: 'supplier-a', baseUrl: fixture.baseUrl, permittedOrigins: [fixture.origin], localTest: true, repeatListParameters: false, credentialConfigured: true, credentialScheme: 'bearer' }])
    expect(described.text).not.toContain(SECRET)
    expect((await api.get('/api/epcis/status')).body).toMatchObject({ storage: 'memory', artefacts: { state: 'present' }, recovery: { actions: [], remaining: 0 }, policy: 'starter-default@1' })

    const run = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 3 } })
    expect(run.status).toBe(200)
    // The outcome is the module's, in its own words.
    expect(run.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', completion: 'exhausted', exhausted: true, sourceId: 'supplier-a', queryId: 'all', localTest: true, events: { total: 7, new: 7, duplicate: 0 } })
    expect(run.body.pages.map((page: Json) => [page.page, (page.events as Json).total, page.last])).toEqual([[1, 3, false], [2, 3, false], [3, 1, true]])
    expect(run.body.completenessLimits[0]).toMatch(/not the complete history/)
    // The credential went to the source, and came back in nothing.
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.requests.every((request) => request.headers.authorization === `Bearer ${SECRET}`)).toBe(true)
    expect(fixture.requests.every((request) => request.headers['gs1-epcis-version'] === '2.0.1' && request.headers['gs1-cbv-version'] === '2.0.0')).toBe(true)
    expect(run.text).not.toContain(SECRET)
    expect(run.body.pull.source).toMatchObject({ credentialsConfigured: true, localTest: true })

    const state = await api.get('/api/epcis/sources/supplier-a/pulls/all')
    expect(state.body.pull).toEqual(run.body.pull)
    expect(state.body.pages).toEqual(run.body.pages)
    // Each page is an import like any other: listed, and exported as the bytes the source sent.
    const listed = await importsOf(api)
    expect(listed.map((entry) => (entry.provenance as Json).kind)).toEqual(['query', 'query', 'query'])
    for (const page of run.body.pages as Json[]) expect(sha256((await api.get(`/api/epcis/imports/${ref(String(page.importId))}/original`)).bytes)).toBe(page.sha256)
    expect((await api.get(`/api/epcis/events?identifier=${ref(item('PULL-5'))}`)).body.events[0]).toMatchObject({ source: { sourceId: 'supplier-a', documentValidity: 'valid', provenance: { kind: 'query', origin: fixture.origin, page: 2 } } })

    // What a request may not do: name an unknown source, leave out the query name, or redefine a query under a name already bound.
    expect((await api.post('/api/epcis/sources/nobody/pulls', { queryId: 'all', query: {} })).status).toBe(404)
    expect((await api.post('/api/epcis/sources/supplier-a/pulls', { query: {} })).status).toBe(400)
    const redefined = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 5 } })
    expect(redefined.status).toBe(409)
    expect(redefined.body).toMatchObject({ error: 'pull-conflict', outcome: 'refused', requested: false })
    expect((await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'bad', query: { everything: true } })).status).toBe(400)
    expect((await api.get('/api/epcis/sources/supplier-a/pulls/never-run')).status).toBe(404)
    expect(fixture.requests).toHaveLength(3)
  })

  it('says a history is partial when the source stops answering, and continues from its checkpoint after a restart', async () => {
    const db = mongo.database()
    // The third page request is answered 503, once.
    const fixture = await source(seven(), { requireAuthorization: `Bearer ${SECRET}`, failRequest: (n) => (n === 3 ? 503 : undefined) })
    const config = testConfig(sourceSettings(fixture))
    const first = await app({ config, db })
    expect(first.exchange.storageKind).toBe('mongodb')
    const stopped = await first.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(stopped.status).toBe(200)
    expect(stopped.body).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 503, completion: 'failed', exhausted: false, events: { total: 4, new: 4 } })
    expect(stopped.body.pages).toHaveLength(2)
    expect(stopped.body.completenessLimits.join(' ')).toMatch(/ended as http-error before the source's pages were exhausted/)
    await first.close()
    apps.splice(apps.indexOf(first), 1)

    // A new process over the same database.
    const lines: string[] = []
    const second = await app({ config, db, lines })
    expect(lines).toContain('EPCIS recovery: nothing was left unfinished.')
    expect((await second.get('/api/epcis/sources/supplier-a/pulls/all')).body.pull).toMatchObject({ status: 'failed', pagesAcknowledged: 2 })
    const resumed = await second.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(resumed.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', exhausted: true, run: { run: 2, resumed: true }, events: { total: 3, new: 3, duplicate: 0 } })
    expect(resumed.body.pages.map((page: Json) => page.page)).toEqual([3, 4])
    // No page was asked for twice except the one that failed, and none was skipped.
    expect(fixture.requests.map((request) => request.query.nextPageToken == null ? 0 : Number(Buffer.from(request.query.nextPageToken, 'base64url').toString()))).toEqual([0, 2, 4, 4, 6])
    const state = (await second.get('/api/epcis/sources/supplier-a/pulls/all')).body
    expect(state.pull).toMatchObject({ status: 'exhausted', pagesAcknowledged: 4, runs: 2, totals: { events: { total: 7, new: 7, duplicate: 0, conflict: 0 } } })
    expect(state.pages.map((page: Json) => page.sequence)).toEqual([1, 2, 3, 4])
    expect(await importsOf(second)).toHaveLength(4)
    expect(await checkEpcisExchangeInvariants(second.exchange.storage, { associations: true })).toEqual([])
    // The credential is in no record the database holds.
    for (const name of ['epcis_log', 'epcis_records', 'epcis_bytes', 'epcis_chunks']) expect(JSON.stringify(await db.collection(name).find().toArray())).not.toContain(SECRET)
  })

  it('loses no page and repeats none when the process stops in the middle of a run', async () => {
    const config = (fixture: FixtureSource) => testConfig(sourceSettings(fixture))
    const body = { queryId: 'all', query: { perPage: 2 } }
    // An uninterrupted run is the measure: what it leaves, and how many durable calls it made.
    const controlSource = await source(seven(), { requireAuthorization: `Bearer ${SECRET}` })
    const counting = faultInjectingEpcisStorage(await openMongoEpcisStorage(mongo.database(), { journal: false }))
    const control = await app({ config: config(controlSource), storage: counting.storage })
    expect((await control.post('/api/epcis/sources/supplier-a/pulls', body)).body).toMatchObject({ outcome: 'ok', events: { total: 7, new: 7 } })
    const calls = counting.calls().length
    expect(calls).toBeGreaterThan(30)
    const eventsHeld = async (api: TestApp): Promise<string[]> => {
      const out: string[] = []
      for (let n = 1; n <= 7; n += 1) for (const entry of (await api.get(`/api/epcis/events?identifier=${ref(item(`PULL-${n}`))}`)).body.events as Json[]) out.push(`${n} ${(entry.source as Json).importId}`)
      return out
    }
    const measure = await eventsHeld(control)
    expect(measure).toHaveLength(7)

    // Stopped after a durable call in the first, the middle and the last third of the run.
    for (const at of [Math.floor(calls / 4), Math.floor(calls / 2), Math.floor((3 * calls) / 4)]) {
      const db = mongo.database()
      const fixture = await source(seven(), { requireAuthorization: `Bearer ${SECRET}` })
      const faulty = faultInjectingEpcisStorage(await openMongoEpcisStorage(db, { journal: false }), { at, when: 'after' })
      const dying = await app({ config: config(fixture), storage: faulty.storage })
      const died = await dying.post('/api/epcis/sources/supplier-a/pulls', body)
      // The run did not end: its process stopped. The answer is an error and carries nothing of the store.
      expect(died.status, `stopped after durable call ${at}`).toBe(500)
      expect(died.text).not.toContain(SECRET)

      const lines: string[] = []
      const restarted = await app({ config: config(fixture), db, lines })
      expect(lines.some((line) => line.startsWith('EPCIS recovery:'))).toBe(true)
      expect(await checkEpcisExchangeInvariants(restarted.exchange.storage, { associations: true }), `stopped after durable call ${at}`).toEqual([])
      const finished = await restarted.post('/api/epcis/sources/supplier-a/pulls', body)
      expect(finished.body, `stopped after durable call ${at}`).toMatchObject({ outcome: 'ok', reason: 'exhausted', run: { resumed: true } })
      const state = (await restarted.get('/api/epcis/sources/supplier-a/pulls/all')).body
      expect(state.pull, `stopped after durable call ${at}`).toMatchObject({ status: 'exhausted', pagesAcknowledged: 4, totals: { events: { total: 7, new: 7, duplicate: 0, conflict: 0 } } })
      // Every event is held once, as after the uninterrupted run.
      expect((await eventsHeld(restarted)).map((line) => line.split(' ')[0]), `stopped after durable call ${at}`).toEqual(measure.map((line) => line.split(' ')[0]))
      expect(await importsOf(restarted)).toHaveLength(4)
      expect(await checkEpcisExchangeInvariants(restarted.exchange.storage, { associations: true })).toEqual([])
      expect(faulty.calls().length).toBe(at)
    }
    // The fault is the one the module's wrapper raises, so this is the stop the shared suite makes.
    expect(new EpcisStorageFault(1, 'after', 'commit')).toBeInstanceOf(Error)
  }, 120_000)

  it('refuses a source whose address is outside its permitted origins, before anything is requested', async () => {
    const fixture = await source(seven())
    const api = await app({ config: testConfig(sourceSettings(fixture, { EPCIS_SOURCE_SUPPLIER_A_ORIGINS: 'https://events.example.org' })) })
    const described = (await api.get('/api/epcis/sources')).body[0]
    expect(described).toMatchObject({ permittedOrigins: ['https://events.example.org'], localTest: true })
    expect(described.problem).toMatch(/permitted origins do not list/)
    const refused = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ error: 'invalid-request', outcome: 'refused', requested: false })
    expect(refused.body.description).toMatch(/permittedOrigins does not list/)
    expect(fixture.requests).toEqual([])
    expect((await api.get('/api/epcis/sources/supplier-a/pulls/all')).status).toBe(404)
    expect(await importsOf(api)).toEqual([])
  })

  it('does not follow a next page to an origin that is not permitted, and says the history is partial', async () => {
    const elsewhere = await source(seven())
    const fixture = await source(seven(), { nextOrigin: elsewhere.origin })
    const api = await app({ config: testConfig(sourceSettings(fixture, { EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: '' })) })
    const run = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(run.body).toMatchObject({ outcome: 'partial-history', reason: 'pagination-target-refused', completion: 'failed', exhausted: false, events: { total: 2 } })
    // The first page is retained. The second was never asked for, anywhere.
    expect(run.body.pages).toHaveLength(1)
    expect(fixture.requests).toHaveLength(1)
    expect(elsewhere.requests).toEqual([])
  })

  it('names a sign-in page as what it is, and a source that wants another credential', async () => {
    const page = await source([], { answer: { status: 200, mediaType: 'text/html', body: '<!doctype html><title>Sign in</title>' } })
    const api = await app({ config: testConfig(sourceSettings(page)) })
    expect((await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })).body).toMatchObject({ outcome: 'unexpected-media-type', completion: 'failed', pages: [] })
    const guarded = await source(seven(), { requireAuthorization: 'Bearer another-secret-entirely' })
    const other = await app({ config: testConfig(sourceSettings(guarded)) })
    const refused = await other.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })
    expect(refused.body).toMatchObject({ outcome: 'source-authentication-required', reason: 'http-401', pages: [] })
    expect(refused.text).not.toContain(SECRET)
  })

  it('refuses plain http and private addresses unless the local-test option is set for the source', async () => {
    expect(() => testConfig({ EPCIS_SOURCES: 'supplier-a', EPCIS_SOURCE_SUPPLIER_A_URL: 'http://127.0.0.1:9/epcis' })).toThrow(/EPCIS_SOURCE_SUPPLIER_A_URL is a plain http address/)
    // An https address on a private network passes configuration and is refused by the pull, which asks nothing of it.
    const api = await app({ config: testConfig({ EPCIS_SOURCES: 'supplier-a', EPCIS_SOURCE_SUPPLIER_A_URL: 'https://10.0.0.5/epcis' }) })
    expect((await api.get('/api/epcis/sources')).body[0]).toMatchObject({ localTest: false, credentialConfigured: false })
    expect((await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })).body).toMatchObject({ outcome: 'source-unavailable', reason: 'target-refused', localTest: false, pages: [] })
  })
})

describe('the pinned GS1 files at start-up', () => {
  const emptyFolder = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-starter-gs1-'))
    folders.push(dir)
    return dir
  }
  const bytes = utf8(JSON.stringify(valid()))

  it('starts without them, says so in one line, and refuses every import and pull with how to provide them', async () => {
    const dir = emptyFolder()
    const fixture = await source([objectEvent(1, [item('GS1-1')])])
    const lines: string[] = []
    const api = await app({ config: testConfig({ ...sourceSettings(fixture), DPP_GS1_ARTEFACTS_DIR: dir }), lines })
    const line = lines.filter((entry) => entry.startsWith('GS1 files for EPCIS validation:'))
    expect(line).toHaveLength(1)
    expect(line[0]).toMatch(/unavailable in .*epcis-json-schema-2\.0\.1\.json \(offline\).*The API runs, and every EPCIS import and pull is refused until they are provided\./)
    expect(line[0]).toContain(`npx dpp-gs1-artefacts fetch --dir ${dir}`)
    // The API did start: its other routes answer.
    expect((await api.get('/api/health')).status).toBe(200)
    const status = (await api.get('/api/epcis/status')).body
    expect(status.artefacts).toMatchObject({ dir, state: 'unavailable' })
    expect(status.artefacts.remedy).toContain('https://ref.gs1.org')

    const refused = await api.upload('/api/epcis/imports?requestId=no-schema', bytes)
    expect(refused.status).toBe(503)
    expect(refused.body).toMatchObject({ error: 'gs1-artefact-unavailable', outcome: 'refused', kept: false })
    expect(refused.body.remedy).toMatch(/dpp-gs1-artefacts fetch/)
    expect(await api.exchange.storage.getBytes(sha256(bytes))).toBeUndefined()
    const pull = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })
    expect(pull.status).toBe(503)
    expect(pull.body).toMatchObject({ error: 'gs1-artefact-unavailable', outcome: 'refused', requested: false })
    expect(pull.body.remedy).toMatch(/dpp-gs1-artefacts fetch/)
    expect(fixture.requests).toEqual([])
    expect(await importsOf(api)).toEqual([])

    // An operator places the files GS1 publishes in the folder. The next import is read against them, with no restart.
    for (const name of readdirSync(gs1Dir())) copyFileSync(join(gs1Dir(), name), join(dir, name))
    expect((await api.get('/api/epcis/status')).body.artefacts).toMatchObject({ state: 'present' })
    expect((await api.upload('/api/epcis/imports?requestId=no-schema', bytes)).status).toBe(201)
  })

  it('fetches them into the configured folder when it may, checks them, and says so', async () => {
    const dir = emptyFolder()
    const asked: string[] = []
    // A transport that answers what GS1 publishes, from the folder the test set-up provisioned. Nothing leaves this machine.
    const fromCache: typeof globalThis.fetch = async (input) => {
      const url = String(input)
      asked.push(url)
      const artefact = EPCIS_GS1_ARTEFACTS.find((entry) => entry.uri === url)
      return artefact == null ? new Response('', { status: 404 }) : new Response(new Uint8Array(readFileSync(join(gs1Dir(), artefact.fileName))), { status: 200 })
    }
    const lines: string[] = []
    const api = await app({ config: testConfig({ DPP_GS1_ARTEFACTS_DIR: dir, DPP_GS1_ARTEFACTS_OFFLINE: 'false' }), fetch: fromCache, lines })
    expect(lines.filter((entry) => entry.startsWith('GS1 files for EPCIS validation:'))).toEqual([`GS1 files for EPCIS validation: fetched from GS1 into ${dir} and checked against their pinned digests.`])
    expect(asked.sort()).toEqual(EPCIS_GS1_ARTEFACTS.map((entry) => entry.uri).sort())
    expect(readdirSync(dir).sort()).toEqual(EPCIS_GS1_ARTEFACTS.map((entry) => entry.fileName).sort())
    expect((await api.upload('/api/epcis/imports?requestId=fetched', bytes)).status).toBe(201)

    // The next start finds them and asks GS1 for nothing.
    const again: string[] = []
    await app({ config: testConfig({ DPP_GS1_ARTEFACTS_DIR: dir, DPP_GS1_ARTEFACTS_OFFLINE: 'false' }), fetch: fromCache, lines: again })
    expect(again.filter((entry) => entry.startsWith('GS1 files for EPCIS validation:'))).toEqual([`GS1 files for EPCIS validation: present in ${dir}.`])
    expect(asked).toHaveLength(EPCIS_GS1_ARTEFACTS.length)
  })

  it('starts when GS1 cannot be reached or answers other bytes, and keeps no file it could not check', async () => {
    for (const [what, transport, reason] of [
      ['no network', (async () => { throw new Error('getaddrinfo ENOTFOUND ref.gs1.org') }) as typeof globalThis.fetch, 'network'],
      ['other bytes', (async () => new Response('{"not":"the schema"}', { status: 200 })) as typeof globalThis.fetch, 'length-mismatch'],
    ] as const) {
      const dir = emptyFolder()
      const lines: string[] = []
      const api = await app({ config: testConfig({ DPP_GS1_ARTEFACTS_DIR: dir, DPP_GS1_ARTEFACTS_OFFLINE: 'false' }), fetch: transport, lines })
      expect(lines.find((entry) => entry.startsWith('GS1 files for EPCIS validation:')), what).toContain(`(${reason})`)
      expect(readdirSync(dir), what).toEqual([])
      expect((await api.upload('/api/epcis/imports?requestId=unreachable', bytes)).status, what).toBe(503)
    }
  })
})

describe('recovery at start-up', () => {
  it('finishes an import a stopped process left, before a request is accepted, and says what it did', async () => {
    const db = mongo.database()
    const bytes = utf8(JSON.stringify(valid()))
    // A process that stopped after it had written the receipt of an upload, which is its third durable call.
    const dying = await app({ storage: faultInjectingEpcisStorage(await openMongoEpcisStorage(db, { journal: false }), { at: 3, when: 'after' }).storage })
    expect((await dying.upload('/api/epcis/imports?requestId=interrupted', bytes)).status).toBe(500)

    const lines: string[] = []
    const restarted = await app({ db, lines })
    expect(lines).toContain('EPCIS recovery: import-finished x1; 0 left unfinished.')
    expect((await restarted.get('/api/epcis/status')).body.recovery).toMatchObject({ actions: [{ action: 'import-finished', from: 'received', state: 'evaluated' }], remaining: 0 })
    const listed = await importsOf(restarted)
    expect(listed).toEqual([expect.objectContaining({ requestId: 'interrupted', state: 'evaluated', sha256: sha256(bytes) })])
    // The upload sent again is the import recovery finished, not a second one.
    const retried = await restarted.upload('/api/epcis/imports?requestId=interrupted', bytes)
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ replayed: true, record: { importId: listed[0]!.importId } })
    expect(await importsOf(restarted)).toHaveLength(1)
  })

  it('discards an upload that never reached its receipt, bytes included', async () => {
    const db = mongo.database()
    const bytes = utf8(JSON.stringify(valid()))
    const dying = await app({ storage: faultInjectingEpcisStorage(await openMongoEpcisStorage(db, { journal: false }), { at: 2, when: 'after' }).storage })
    expect((await dying.upload('/api/epcis/imports?requestId=never-held', bytes)).status).toBe(500)
    const lines: string[] = []
    const restarted = await app({ db, lines })
    expect(lines).toContain('EPCIS recovery: intake-discarded x1; 0 left unfinished.')
    expect(await importsOf(restarted)).toEqual([])
    expect(await restarted.exchange.storage.getBytes(sha256(bytes))).toBeUndefined()
  })

  it('answers a document whose record is larger than the MongoDB store keeps as a refusal, and leaves no import of it', async () => {
    const db = mongo.database()
    const api = await app({ db })
    // Hundreds of thousands of very short identifiers: a document within the size limit whose import record is far larger than it.
    const many = Array.from({ length: 260_000 }, (_, index) => `a:${(index % 36).toString(36)}`)
    const bytes = utf8(JSON.stringify(epcisDocument([objectEvent(1, many)])))
    expect(bytes.byteLength).toBeLessThan(EPCIS_DEFAULT_LIMITS.maxDocumentBytes)
    const refused = await api.upload('/api/epcis/imports?requestId=too-large', bytes)
    expect(refused.status).toBe(413)
    expect(refused.body).toMatchObject({ error: 'record-too-large', outcome: 'refused', kept: false })
    expect(await importsOf(api)).toEqual([])
    expect((await api.get(`/api/epcis/events?identifier=${ref('a:0')}`)).body.events).toEqual([])
    // Other uploads go on as before, and the next start discards what the refused one had put down.
    expect((await api.upload('/api/epcis/imports?requestId=after-large', utf8(JSON.stringify(valid())))).status).toBe(201)
    await api.close()
    apps.splice(apps.indexOf(api), 1)
    const lines: string[] = []
    const restarted = await app({ db, lines })
    expect(lines).toContain('EPCIS recovery: intake-discarded x1; 0 left unfinished.')
    expect(await restarted.exchange.storage.getBytes(sha256(bytes))).toBeUndefined()
    expect(await importsOf(restarted)).toHaveLength(1)
    expect(await checkEpcisExchangeInvariants(restarted.exchange.storage, { associations: true })).toEqual([])
  })

  it('says which store it runs on', async () => {
    const lines: string[] = []
    const memory = await app({ lines })
    expect(memory.exchange.storageKind).toBe('memory')
    expect(lines).toContain('EPCIS store: no MongoDB, so imports are held in memory and are gone when this process ends.')
  })
})
