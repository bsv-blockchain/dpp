// EPCIS exchange over the API: file import, a configured pull and exact
// export. Every answer here comes from `@bsv/dpp-credentials/epcis-exchange`
// through the routes under /api/epcis. The tests hold the routes to what the
// module promises: an upload is retained as the exact bytes that arrived, a
// retry is the same request, a refused transport keeps nothing, a pull
// continues where it stopped, and an export is the original, byte for byte.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EPCIS_GS1_ARTEFACTS } from '@bsv/dpp-credentials'
import { EPCIS_RECORD_KINDS, EpcisStorageFault, checkEpcisExchangeInvariants, createMemoryEpcisStorage, faultInjectingEpcisStorage, openFileEpcisStorage, type EpcisExchangeStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { EPCIS_DEFAULT_LIMITS } from '@bsv/dpp-credentials/epcis-source'
import { openMongoEpcisStorage } from '../src/epcis/mongo-storage.js'
import { mintPassportId } from '../src/identifiers.js'
import { MONGO_SERVER_SELECTION_TIMEOUT_MS } from '../src/platform.js'
import { CELL_A, CELL_B, ELECTROLYTE_LOT, MODULE, PACK, PALLET, SCRAP_CLASS, epcisDocument, eventId, fiveEventTypes, gs1Dir, item, minute, objectEvent, sha256, startApp, startEpcisSource, startMongo, testConfig, utf8, type Answer, type FixtureSource, type Json, type TestApp, type TestMongo } from './epcis-fixtures.js'

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

  it('retains a standalone event solely as an invalid receipt across upload, replay and original-byte export', async () => {
    const api = await app()
    const bytes = utf8(JSON.stringify(objectEvent(1, [CELL_A]), null, 2))
    const request = '/api/epcis/imports?requestId=standalone-file'
    const first = await api.upload(request, bytes)
    expect(first.status).toBe(201)
    const record = first.body.record
    expect(record).toMatchObject({ documentValidity: 'invalid', events: [], sha256: sha256(bytes) })
    expect(record.envelope).toBeUndefined()
    expect(record.findings).toContainEqual(expect.objectContaining({ code: 'envelope-unrecognised' }))
    const replay = await api.upload(request, bytes)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ replayed: true, record: { importId: record.importId, receivedAt: record.receivedAt, events: [] } })
    expect(await importsOf(api)).toHaveLength(1)
    const original = await api.get(`/api/epcis/imports/${ref(record.importId)}/original`)
    expect(original.status).toBe(200)
    expect(Buffer.from(original.bytes).equals(Buffer.from(bytes))).toBe(true)
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
      // The run did not end: its process stopped. The answer names the store, says the run may be made again, and carries nothing of the store.
      expect(died.status, `stopped after durable call ${at}`).toBe(503)
      expect(died.body, `stopped after durable call ${at}`).toMatchObject({ error: 'storage-unavailable', outcome: 'failed', retryable: true })
      // A run acknowledges page by page, so its answer does not say whether it was acknowledged.
      expect(died.body, `stopped after durable call ${at}`).not.toHaveProperty('acknowledged')
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

describe('every event type, a class of items and corrections', () => {
  /** A document written by hand around the events given, so an export that had been parsed and written out again would differ from it. */
  const written = (events: Json[]): Uint8Array =>
    utf8(`{\r\n\t"type":"EPCISDocument", "schemaVersion":"2.0",\n  "@context": ${JSON.stringify(epcisDocument([])['@context'])},\n"creationDate":"2026-03-03T07:00:00.000Z" ,\n  "epcisBody" : { "eventList": [\n${events.map((event) => `\t${JSON.stringify(event)}`).join(' ,\r\n')}\n ] }\n}\n\n`)
  const entries = async (api: TestApp, identifier: string, query = ''): Promise<Json[]> => (await api.get(`/api/epcis/events?identifier=${ref(identifier)}${query}`)).body.events as Json[]
  const roles = async (api: TestApp, identifier: string, query = ''): Promise<unknown[]> => (await entries(api, identifier, query)).map((entry) => [(entry.association as Json).eventType, (entry.association as Json).role])

  it('imports one document that holds all five event types, exports it unchanged, and finds each item and each class under the role it has', async () => {
    const api = await app()
    const events = fiveEventTypes()
    const bytes = written(events)
    const imported = await api.upload('/api/epcis/imports?requestId=five-1&sourceId=assembly-line&filename=assembly.jsonld', bytes)
    expect(imported.status).toBe(201)
    const record = imported.body.record
    expect(record).toMatchObject({ sourceId: 'assembly-line', documentValidity: 'valid', state: 'evaluated', sha256: sha256(bytes), byteLength: bytes.byteLength })
    expect(record.events.map((event: Json) => [event.eventType, event.identity, event.arrival])).toEqual([
      ['TransformationEvent', eventId(31), 'new'],
      ['ObjectEvent', eventId(32), 'new'],
      ['AssociationEvent', eventId(33), 'new'],
      ['AggregationEvent', eventId(34), 'new'],
      ['TransactionEvent', eventId(35), 'new'],
    ])
    expect([...record.findings, ...record.events.flatMap((event: Json) => (event.validation as { findings: Json[] }).findings)].filter((finding: Json) => finding.severity === 'error')).toEqual([])

    // The bytes that arrived are the bytes that leave, whatever event types they hold.
    const exported = await api.get(`/api/epcis/imports/${ref(record.importId)}/original`)
    expect(Buffer.from(exported.bytes).equals(Buffer.from(bytes))).toBe(true)
    expect(sha256(JSON.stringify(JSON.parse(exported.text)))).not.toBe(sha256(bytes))
    expect(exported.headers.get('x-content-sha256')).toBe(sha256(bytes))

    // Each individual item is found under every event that names it, with the role it has there.
    expect(await roles(api, PACK)).toEqual([['ObjectEvent', 'object'], ['AssociationEvent', 'association-parent'], ['AggregationEvent', 'aggregation-child'], ['TransactionEvent', 'transaction-object']])
    expect(await roles(api, MODULE)).toEqual([['TransformationEvent', 'transformation-output'], ['AssociationEvent', 'association-child']])
    expect(await roles(api, CELL_A)).toEqual([['TransformationEvent', 'transformation-input']])
    expect(await roles(api, PALLET)).toEqual([['AggregationEvent', 'aggregation-parent']])
    // And each event is shown as the retained document holds it.
    for (const entry of await entries(api, PACK)) expect(entry.body).toEqual(events.find((event) => event.eventID === (entry.event as Json).identity))

    // A class-level lookup: a lot and a pattern, each named with a quantity, are found as classes.
    const lot = await api.get(`/api/epcis/events?identifier=${ref(ELECTROLYTE_LOT)}&granularity=class`)
    expect(lot.status).toBe(200)
    expect(lot.body).toMatchObject({ identifier: ELECTROLYTE_LOT, granularity: 'class', nature: 'supplied-data' })
    expect(lot.body.events).toHaveLength(1)
    expect(lot.body.events[0]).toMatchObject({
      association: { identifier: ELECTROLYTE_LOT, granularity: 'class', role: 'transformation-input-quantity', eventType: 'TransformationEvent', quantity: 4, uom: 'EA', sourceId: 'assembly-line', errorDeclared: false },
      source: { importId: record.importId, documentValidity: 'valid' },
      event: { identity: eventId(31), arrival: 'new' },
    })
    expect(lot.body.events[0].body).toEqual(events[0])
    expect((await entries(api, SCRAP_CLASS, '&granularity=class')).map((entry) => entry.association)).toMatchObject([{ granularity: 'class', role: 'transformation-output-quantity', quantity: 0.5, uom: 'KGM' }])
    // A class is never answered as an individual item taking part, and an item is never answered as a class.
    expect(await entries(api, ELECTROLYTE_LOT)).toEqual([])
    expect(await entries(api, ELECTROLYTE_LOT, '&granularity=instance')).toEqual([])
    expect(await entries(api, SCRAP_CLASS, '&granularity=instance')).toEqual([])
    for (const one of [PACK, MODULE, CELL_A, CELL_B, PALLET]) expect(await entries(api, one, '&granularity=class'), one).toEqual([])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
  })

  it('keeps an error declaration and a changed observation beside the event they are about, replaces nothing, and resolves a correction only within its source', async () => {
    const api = await app()
    const [transformation, commissioning, , , transaction] = fiveEventTypes() as [Json, Json, Json, Json, Json]
    const firstBytes = written(fiveEventTypes())
    const first = await api.upload('/api/epcis/imports?requestId=corrections-1&sourceId=assembly-line', firstBytes)
    expect(first.status).toBe(201)

    // The source later declares the commissioning in error, and names the event that corrects it, which arrives in the same document.
    const declaration = { declarationTime: minute(50), reason: 'incorrect_data', correctiveEventIDs: [eventId(40)] }
    const declared = { ...commissioning, recordTime: minute(50), errorDeclaration: declaration }
    const corrective = objectEvent(40, [PACK], { action: 'ADD', bizStep: 'commissioning', disposition: 'active' })
    const second = await api.upload('/api/epcis/imports?requestId=corrections-2&sourceId=assembly-line', utf8(JSON.stringify(epcisDocument([declared, corrective]))))
    expect(second.status).toBe(201)
    expect(second.body.record).toMatchObject({ documentValidity: 'valid', state: 'evaluated' })
    // A further observation of the same event: the second under its identity, beside the first.
    expect(second.body.record.events[0]).toMatchObject({ identity: eventId(32), arrival: 'new-observation', observation: { sequence: 2 }, errorDeclaration: { correctiveEventIDs: [eventId(40)], resolution: 'resolved' } })
    expect(second.body.record.events[0].conflict).toBeUndefined()
    expect(second.body.record.events[1]).toMatchObject({ identity: eventId(40), arrival: 'new' })

    // The repository records the transformation again at another time, with the same body. And it declares the shipment in error, naming an event it never sent.
    const reobserved = { ...transformation, recordTime: minute(55) }
    const orphan = { ...transaction, recordTime: minute(56), errorDeclaration: { declarationTime: minute(56), reason: 'did_not_occur', correctiveEventIDs: [eventId(99)] } }
    const third = await api.upload('/api/epcis/imports?requestId=corrections-3&sourceId=assembly-line', utf8(JSON.stringify(epcisDocument([reobserved, orphan]))))
    expect(third.status).toBe(201)
    expect(third.body.record.events[0]).toMatchObject({ identity: eventId(31), arrival: 'new-observation', observation: { sequence: 2 } })
    expect(third.body.record.events[0].errorDeclaration).toBeUndefined()
    expect(third.body.record.events[1]).toMatchObject({ identity: eventId(35), arrival: 'new-observation', errorDeclaration: { correctiveEventIDs: [eventId(99)], resolution: 'unresolved', missing: [eventId(99)] } })
    // Another source scope that names the same corrective event does not hold it: a correction is never resolved across sources.
    const elsewhere = await api.upload('/api/epcis/imports?requestId=corrections-4&sourceId=another-line', utf8(JSON.stringify(epcisDocument([declared]))))
    expect(elsewhere.body.record.events[0]).toMatchObject({ arrival: 'new', errorDeclaration: { resolution: 'unresolved', missing: [eventId(40)] } })

    // Nothing was replaced. The first import is the record and the bytes it was, and no arrival here is a conflict.
    expect((await api.get(`/api/epcis/imports/${ref(first.body.record.importId)}`)).body).toEqual(first.body.record)
    expect(Buffer.from((await api.get(`/api/epcis/imports/${ref(first.body.record.importId)}/original`)).bytes).equals(Buffer.from(firstBytes))).toBe(true)
    expect((await api.get('/api/epcis/conflicts')).body).toMatchObject({ conflicts: [], importsRead: 4, truncated: false })
    expect((await importsOf(api)).map((entry) => [entry.state, entry.conflicts])).toEqual(Array.from({ length: 4 }, () => ['evaluated', 0]))

    // The events of the product show both observations of its commissioning: the one first received, and the one that declares it in error.
    // The index answers in the order of its keys, which is not the order of arrival, so the entries are read in the order they were observed.
    const observedOrder = (list: Json[]): Json[] => [...list].sort((a, b) => Number(((a.event as Json).observation as Json).sequence) - Number(((b.event as Json).observation as Json).sequence))
    const commissionings = observedOrder((await entries(api, PACK, '&sourceId=assembly-line')).filter((entry) => (entry.event as Json).identity === eventId(32)))
    expect(commissionings.map((entry) => [(entry.source as Json).importId, (entry.association as Json).errorDeclared, (entry.event as Json).arrival])).toEqual([
      [first.body.record.importId, false, 'new'],
      [second.body.record.importId, true, 'new-observation'],
    ])
    expect((commissionings[0]!.body as Json).errorDeclaration).toBeUndefined()
    expect((commissionings[1]!.body as Json).errorDeclaration).toEqual(declaration)
    // The transformation observed twice is listed twice for an item it took in, with neither observation marked in error.
    expect(observedOrder(await entries(api, CELL_A, '&sourceId=assembly-line')).map((entry) => [(entry.source as Json).importId, (entry.association as Json).errorDeclared, ((entry.body as Json).recordTime)])).toEqual([
      [first.body.record.importId, false, transformation.recordTime],
      [third.body.record.importId, false, minute(55)],
    ])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
  })
})

describe('a store that fails', () => {
  /** What the failing store says. It names a host, as a database driver's error does, so a test can show that a caller is never told it. */
  const CAUSE = 'connection to db-internal-7.example.internal:27017 was reset'
  /**
   * A store whose durable call fails once, the given number of calls after
   * it is armed, in a process that carries on with the same store. `before`:
   * the call never reached the store. `after`: it was applied and its answer
   * was lost.
   */
  function failingOnce(inner: EpcisExchangeStorage): { storage: EpcisExchangeStorage; calls(): number; arm(at: number, when: 'before' | 'after'): void } {
    let made = 0
    let plan: { at: number; when: 'before' | 'after' } | undefined
    const durable = async <T>(run: () => Promise<T>): Promise<T> => {
      made += 1
      if (plan == null || made !== plan.at) return run()
      if (plan.when === 'after') await run()
      throw new Error(CAUSE)
    }
    return {
      calls: () => made,
      arm: (at, when) => {
        plan = { at: made + at, when }
      },
      storage: {
        putBytes: (digest, bytes) => durable(() => inner.putBytes(digest, bytes)),
        deleteBytes: (digest) => durable(() => inner.deleteBytes(digest)),
        commit: (writes) => durable(() => inner.commit(writes)),
        getBytes: (digest) => inner.getBytes(digest),
        get: (kind, key) => inner.get(kind, key),
        list: (kind, options) => inner.list(kind, options),
      },
    }
  }
  const STORE_FAILURE = { error: 'storage-unavailable', outcome: 'failed', retryable: true, acknowledged: false }
  /** A run acknowledges page by page, so the answer to one that failed does not say it was not acknowledged: it says the pages acknowledged before the failure are kept. */
  const RUN_FAILURE = { error: 'storage-unavailable', outcome: 'failed', retryable: true }

  it('answers a write that failed during an upload by name, as a request to send again, loses nothing acknowledged, and takes the same request in the same process', async () => {
    const bytes = utf8(JSON.stringify(valid()))
    const counting = failingOnce(createMemoryEpcisStorage())
    const control = await app({ storage: counting.storage })
    expect((await control.upload('/api/epcis/imports?requestId=flaky', bytes)).status).toBe(201)
    const steps = counting.calls()
    expect(steps).toBeGreaterThanOrEqual(6)

    for (let at = 1; at <= steps; at += 1) {
      for (const when of ['before', 'after'] as const) {
        const where = `${when} durable call ${at} of ${steps}`
        const failing = failingOnce(createMemoryEpcisStorage())
        const lines: string[] = []
        const api = await app({ storage: failing.storage, lines })
        const earlier = await api.upload('/api/epcis/imports?requestId=earlier', UNUSUAL)
        expect(earlier.status, where).toBe(201)

        failing.arm(at, when)
        const failed = await api.upload('/api/epcis/imports?requestId=flaky', bytes)
        // Named, and said to be safe to send again. Not the unnamed failure of the API, and not a refusal of the document.
        expect(failed.status, where).toBe(503)
        expect(failed.body, where).toEqual({ ...STORE_FAILURE, description: expect.stringMatching(/did not complete a call\. This upload was not acknowledged\. Send it again with the same requestId/) })
        // The store's own words are for the operator's log and are not in the answer.
        expect(failed.text, where).not.toContain('db-internal-7')
        expect(lines.filter((line) => line.startsWith('EPCIS store:') && line.includes(CAUSE)), where).toHaveLength(1)

        // What was acknowledged before is held as it was, and the API answers its other requests.
        expect(Buffer.from((await api.get(`/api/epcis/imports/${ref(earlier.body.record.importId)}/original`)).bytes).equals(Buffer.from(UNUSUAL)), where).toBe(true)
        expect((await api.get(`/api/epcis/imports/${ref(earlier.body.record.importId)}`)).body, where).toEqual(earlier.body.record)
        expect((await api.get('/api/epcis/status')).status, where).toBe(200)

        // The same request again, in the same process, with no restart and no recovery between.
        const again = await api.upload('/api/epcis/imports?requestId=flaky', bytes)
        expect([200, 201], where).toContain(again.status)
        expect(again.body, where).toMatchObject({ outcome: 'retained', record: { requestId: 'flaky', state: 'evaluated', documentValidity: 'valid', sha256: sha256(bytes) } })
        expect((await importsOf(api)).map((entry) => entry.requestId).sort(), where).toEqual(['earlier', 'flaky'])
        expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true }), where).toEqual([])
        // And once more it is a repeat, answered with the same import.
        const repeat = await api.upload('/api/epcis/imports?requestId=flaky', bytes)
        expect(repeat.status, where).toBe(200)
        expect(repeat.body.record, where).toEqual(again.body.record)
        await api.close()
        apps.splice(apps.indexOf(api), 1)
      }
    }
  })

  it('answers writes another writer keeps winning by name, as a request to send again, and the same request is one import once they stop', async () => {
    // The event results of an import always lose to another writer, as if one kept taking the same event identities, until the test stops it.
    const inner = createMemoryEpcisStorage()
    let contended = true
    let lost = 0
    const storage: EpcisExchangeStorage = {
      putBytes: (digest, bytes) => inner.putBytes(digest, bytes),
      getBytes: (digest) => inner.getBytes(digest),
      deleteBytes: (digest) => inner.deleteBytes(digest),
      get: (kind, key) => inner.get(kind, key),
      list: (kind, options) => inner.list(kind, options),
      commit: async (writes) => {
        const observation = writes.find((write) => write.kind === EPCIS_RECORD_KINDS.observation)
        if (!contended || observation == null) return inner.commit(writes)
        lost += 1
        return { committed: false, failed: { kind: observation.kind, key: observation.key, expected: 'absent', found: 1 } }
      },
    }
    const api = await app({ storage })
    const bytes = utf8(JSON.stringify(valid()))
    const failed = await api.upload('/api/epcis/imports?requestId=contended', bytes)
    expect(failed.status).toBe(503)
    expect(failed.body).toEqual({ error: 'storage-contention', description: expect.stringMatching(/gave up after a bounded number of attempts\. This upload was not acknowledged\. Send it again with the same requestId/), outcome: 'failed', retryable: true, acknowledged: false })
    // The bound the module states, and no more: the request did not hang on a writer that never stops.
    expect(lost).toBe(8)

    contended = false
    const again = await api.upload('/api/epcis/imports?requestId=contended', bytes)
    expect([200, 201]).toContain(again.status)
    expect(again.body).toMatchObject({ outcome: 'retained', record: { requestId: 'contended', state: 'evaluated', documentValidity: 'valid', sha256: sha256(bytes) } })
    expect((await importsOf(api)).map((entry) => entry.requestId)).toEqual(['contended'])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
  })

  it('answers a write that failed during a pull by name, and the same query run again finishes with no page lost and no event held twice', async () => {
    const seven = (): Json[] => Array.from({ length: 7 }, (_, index) => objectEvent(index + 1, [item(`PULL-${index + 1}`)]))
    const body = { queryId: 'all', query: { perPage: 2 } }
    const counting = failingOnce(createMemoryEpcisStorage())
    const control = await app({ config: testConfig(sourceSettings(await source(seven()))), storage: counting.storage })
    expect((await control.post('/api/epcis/sources/supplier-a/pulls', body)).body).toMatchObject({ outcome: 'ok', events: { total: 7, new: 7 } })
    const steps = counting.calls()
    expect(steps).toBeGreaterThan(20)

    for (let at = 1; at <= steps; at += 1) {
      for (const when of ['before', 'after'] as const) {
        const where = `${when} durable call ${at} of ${steps}`
        const fixture = await source(seven(), { requireAuthorization: `Bearer ${SECRET}` })
        const failing = failingOnce(createMemoryEpcisStorage())
        const api = await app({ config: testConfig(sourceSettings(fixture)), storage: failing.storage })
        failing.arm(at, when)
        const failed = await api.post('/api/epcis/sources/supplier-a/pulls', body)
        expect(failed.status, where).toBe(503)
        expect(failed.body, where).toEqual({ ...RUN_FAILURE, description: expect.stringMatching(/This run did not finish\. The pages it acknowledged before the failure are kept\. Run the same queryId again: it continues after the last page it acknowledged/) })
        expect(failed.text, where).not.toContain('db-internal-7')
        expect(failed.text, where).not.toContain(SECRET)
        // Whatever the run had acknowledged is held, and its checkpoint is not past it.
        const held = await api.get('/api/epcis/sources/supplier-a/pulls/all')
        if (held.status === 200) {
          expect(held.body.pages, where).toHaveLength(held.body.pull.pagesAcknowledged)
          for (const page of held.body.pages as Json[]) expect(sha256((await api.get(`/api/epcis/imports/${ref(String(page.importId))}/original`)).bytes), where).toBe(page.sha256)
        }

        const again = await api.post('/api/epcis/sources/supplier-a/pulls', body)
        expect(again.status, where).toBe(200)
        expect(again.body, where).toMatchObject({ outcome: 'ok', reason: 'exhausted', exhausted: true })
        const state = (await api.get('/api/epcis/sources/supplier-a/pulls/all')).body
        expect(state.pull, where).toMatchObject({ status: 'exhausted' })
        // The four pages of the history, each acknowledged once, and every event observed once.
        expect((state.pages as Json[]).filter((page) => page.pass === 1).map((page) => page.page), where).toEqual([1, 2, 3, 4])
        const observed = (await api.exchange.storage.list(EPCIS_RECORD_KINDS.observation, { limit: 100 })).map((record) => `${String(record.value.identity)} ${String(record.value.sequence)}`)
        expect(observed.sort(), where).toEqual(Array.from({ length: 7 }, (_, index) => `${eventId(index + 1)} 1`).sort())
        expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true }), where).toEqual([])
        await api.close()
        apps.splice(apps.indexOf(api), 1)
        await fixture.close()
        sources.splice(sources.indexOf(fixture), 1)
      }
    }
  }, 120_000)

  it('answers by name, within a bounded wait, while the database is away, at the store and at a sign-in kept in the same database, and holds what it had acknowledged when it is back', async () => {
    // A database of this test's own, which it stops and starts. Each API opens it as main.ts does: the platform connects with its own client, and the exchange is opened on the platform's database.
    const mongod = await MongoMemoryServer.create()
    const address = new URL(mongod.getUri()).host
    const fixture = await source(Array.from({ length: 3 }, (_, index) => objectEvent(index + 1, [item(`OUTAGE-${index + 1}`)])))
    const database = (name: string, over: Record<string, string> = {}) => testConfig({ MONGO_URL: mongod.getUri(), MONGO_DB: name, ...over })
    // The sign-in lookup's failure is written to the process's error output, as Better Auth's own report of it is.
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // The store's own failure: the development session stands in for sign-in, so that a request reaches the EPCIS store.
      const lines: string[] = []
      const api = await app({ mode: 'live', config: database('epcis_outage', sourceSettings(fixture)), lines })
      expect(api.exchange.storageKind).toBe('mongodb')
      // As main.ts runs with a database: sign-in on that same database, looked up before a route reaches the store.
      const signed = await app({ mode: 'live', signIn: true, config: database('epcis_outage_sign_in') })
      const signUp = await fetch(`${signed.base}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: signed.platform.config.publicUrl }, body: JSON.stringify({ email: 'operator@example.com', password: 'outage-test-password-1', name: 'Operator' }) })
      expect(signUp.status).toBe(200)
      signed.headers.cookie = signUp.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
      const earlier = await api.upload('/api/epcis/imports?requestId=before-outage', UNUSUAL)
      expect(earlier.status).toBe(201)
      expect((await signed.upload('/api/epcis/imports?requestId=before-outage', UNUSUAL)).status).toBe(201)

      await mongod.stop({ doCleanup: false })
      const bytes = utf8(JSON.stringify(valid()))
      const timed = async (ask: () => Promise<Answer>): Promise<Answer & { waited: number }> => {
        const started = Date.now()
        const answer = await ask()
        return { ...answer, waited: Date.now() - started }
      }
      // Bounded by the time the application's own client waits for a server, with room for the driver's one retry. Never an open-ended wait.
      const bound = MONGO_SERVER_SELECTION_TIMEOUT_MS * 4

      const during = await timed(() => api.upload('/api/epcis/imports?requestId=during-outage', bytes))
      expect(during.status).toBe(503)
      expect(during.body).toMatchObject({ error: 'storage-unavailable', outcome: 'failed', retryable: true, acknowledged: false })
      expect(during.waited).toBeLessThan(bound)
      // A pull is answered the same way, and asks nothing of its source: the record it continues from could not be read.
      const asked = fixture.requests.length
      const pulled = await timed(() => api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} }))
      expect(pulled.status).toBe(503)
      expect(pulled.body).toEqual({ ...RUN_FAILURE, description: expect.stringMatching(/did not complete a call\. This run did not finish/) })
      expect(pulled.waited).toBeLessThan(bound)
      expect(fixture.requests).toHaveLength(asked)
      // Reads are answered the same way: no route hangs and none answers an unnamed failure.
      expect((await api.get('/api/epcis/imports')).body).toMatchObject({ error: 'storage-unavailable', retryable: true })
      expect((await api.get(`/api/epcis/imports/${ref(earlier.body.record.importId)}/original`)).status).toBe(503)
      // The two routes that read no store still answer, and so does the rest of the API.
      expect((await api.get('/api/epcis/status')).status).toBe(200)
      expect((await api.get('/api/epcis/sources')).status).toBe(200)
      expect((await api.get('/api/health')).status).toBe(200)
      // The operator's log names the failure. No answer carried the database's address.
      for (const answer of [during, pulled]) expect(answer.text).not.toContain(address)
      expect(lines.some((line) => line.startsWith('EPCIS store:') && line.includes('did not complete'))).toBe(true)

      // With sign-in on the same database the lookup of the signed-in user fails first. It is named as well, within the same bound.
      const signedDuring = await timed(() => signed.upload('/api/epcis/imports?requestId=during-outage', bytes))
      expect(signedDuring.status).toBe(503)
      expect(signedDuring.body).toEqual({ error: 'sign-in-unavailable', description: expect.stringMatching(/could not be looked up.*This upload was not acknowledged\. Send it again with the same requestId/), outcome: 'failed', retryable: true, acknowledged: false })
      expect(signedDuring.waited).toBeLessThan(bound)
      expect(signedDuring.text).not.toContain(address)
      expect((await signed.get('/api/epcis/status')).body).toMatchObject({ error: 'sign-in-unavailable', retryable: true })
      expect(errorOutput.mock.calls.some(([line]) => String(line).startsWith('EPCIS route: the signed-in user could not be looked up'))).toBe(true)
      // A request with no session reads nothing from the database, and is still told to sign in.
      expect((await fetch(`${signed.base}/api/epcis/imports`)).status).toBe(401)

      // The database is back at the same address, with what it held.
      await mongod.start(true)
      const back = await api.get(`/api/epcis/imports/${ref(earlier.body.record.importId)}/original`)
      expect(back.status).toBe(200)
      expect(Buffer.from(back.bytes).equals(Buffer.from(UNUSUAL))).toBe(true)
      expect((await api.get(`/api/epcis/imports/${ref(earlier.body.record.importId)}`)).body).toEqual(earlier.body.record)
      // The requests that were not acknowledged are sent again: each upload is one import, and the pull runs to the end of its history.
      for (const each of [api, signed]) {
        const again = await each.upload('/api/epcis/imports?requestId=during-outage', bytes)
        expect([200, 201]).toContain(again.status)
        expect(again.body).toMatchObject({ outcome: 'retained', record: { state: 'evaluated', sha256: sha256(bytes) } })
        expect((await importsOf(each)).map((entry) => entry.requestId).sort()).toEqual(['before-outage', 'during-outage'])
      }
      expect((await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: {} })).body).toMatchObject({ outcome: 'ok', reason: 'exhausted', events: { total: 3, new: 3 } })
      for (const each of [api, signed]) expect(await checkEpcisExchangeInvariants(each.exchange.storage, { associations: true })).toEqual([])
    } finally {
      errorOutput.mockRestore()
      // Each API's client is closed while its database still answers.
      await Promise.all(apps.splice(0).map((each) => each.close().catch(() => undefined)))
      await mongod.stop().catch(() => undefined)
    }
  }, 120_000)

  it('answers retained bytes that are altered or gone by name, as something sending the request again will not mend', async () => {
    const store = createMemoryEpcisStorage()
    const api = await app({ storage: store })
    const imported = await api.upload('/api/epcis/imports?requestId=damaged-1', UNUSUAL)
    const other = await api.upload('/api/epcis/imports?requestId=sound-1', utf8(JSON.stringify(valid())))
    const original = `/api/epcis/imports/${ref(imported.body.record.importId)}/original`
    store.state.bytes.get(sha256(UNUSUAL))![0] = 0x20
    const altered = await api.get(original)
    expect(altered.status).toBe(500)
    expect(altered.body).toMatchObject({ error: 'retained-bytes-mismatch', outcome: 'failed', retryable: false })
    // Nothing of the altered bytes is answered.
    expect(altered.headers.get('x-content-sha256')).toBeNull()
    store.state.bytes.delete(sha256(UNUSUAL))
    expect((await api.get(original)).body).toMatchObject({ error: 'retained-bytes-missing', outcome: 'failed', retryable: false })
    // The record is still read, and another import is exported as it was.
    expect((await api.get(`/api/epcis/imports/${ref(imported.body.record.importId)}`)).status).toBe(200)
    expect((await api.get(`/api/epcis/imports/${ref(other.body.record.importId)}/original`)).status).toBe(200)
  })

  it('answers a record it cannot read, a damaged store and a store no longer open to it by name', async () => {
    // A pull record written by another version of the module: its checkpoint may mean something this version does not know, so it is not guessed at.
    const memory = createMemoryEpcisStorage()
    const fixture = await source([objectEvent(1, [item('UNREAD-1')])])
    const pulling = await app({ config: testConfig(sourceSettings(fixture)), storage: memory })
    const body = { queryId: 'all', query: {} }
    expect((await pulling.post('/api/epcis/sources/supplier-a/pulls', body)).body).toMatchObject({ outcome: 'ok', reason: 'exhausted' })
    for (const held of memory.state.records.get(EPCIS_RECORD_KINDS.pull)!.values()) held.value.recordVersion = '99'
    const asked = fixture.requests.length
    const unread = await pulling.post('/api/epcis/sources/supplier-a/pulls', body)
    expect(unread.status).toBe(500)
    expect(unread.body).toMatchObject({ error: 'record-unreadable', outcome: 'failed', retryable: false })
    // Such a record may be sound, written by another version, so the operator is told to run that version and not only to restore.
    expect(unread.body.description).toMatch(/does not read: it was written by another version, or it is damaged.*run the version that wrote it/)
    expect(fixture.requests).toHaveLength(asked)

    // The file-system adapter, with the record of an import overwritten on disk by something that is not a record.
    const dir = mkdtempSync(join(tmpdir(), 'dpp-starter-epcis-store-'))
    try {
      const store = await openFileEpcisStorage(dir, { fsync: false })
      const api = await app({ storage: store })
      const imported = await api.upload('/api/epcis/imports?requestId=on-disk', UNUSUAL)
      expect(imported.status).toBe(201)
      const recordFile = readdirSync(join(dir, 'records', EPCIS_RECORD_KINDS.import), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((path) => (JSON.parse(readFileSync(path, 'utf8')) as { value?: Json }).value?.importId === imported.body.record.importId)
      expect(recordFile).toHaveLength(1)
      writeFileSync(recordFile[0]!, 'not a record')
      const damaged = await api.get(`/api/epcis/imports/${ref(imported.body.record.importId)}`)
      expect(damaged.status).toBe(500)
      expect(damaged.body).toMatchObject({ error: 'storage-corrupt', outcome: 'failed', retryable: false })
      // The adapter's own words name the folder. They are for the log, not the answer.
      expect(damaged.text).not.toContain(dir)

      // Once the store is closed under the running API, every route answers that it may be asked again, and none hangs.
      await store.close()
      for (const answer of [await api.get('/api/epcis/imports'), await api.upload('/api/epcis/imports?requestId=after-close', utf8(JSON.stringify(valid())))]) {
        expect(answer.status).toBe(503)
        expect(answer.body).toMatchObject({ error: 'storage-unavailable', outcome: 'failed', retryable: true, acknowledged: false })
        expect(answer.body.description).toMatch(/is not open to this process/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the edges of a paged history', () => {
  const offsets = (fixture: FixtureSource): number[] => fixture.requests.map((request) => (request.query.nextPageToken == null ? 0 : Number(Buffer.from(request.query.nextPageToken, 'base64url').toString())))
  /** A partial history is never said to be complete, in the answer or in the record. */
  const partial = (body: Json): void => {
    expect(body.exhausted).toBe(false)
    expect(body.completion).not.toBe('exhausted')
    expect(body.outcome).not.toBe('ok')
    expect((body.pull as Json).status).not.toBe('exhausted')
    expect(((body.pull as Json).pass as Json).exhausted).toBe(false)
    expect((body.completenessLimits as string[])[0]).toMatch(/not the complete history/)
  }

  it('stops at the page limit, says the history is partial, and finishes it on the next run', async () => {
    // Eleven events at one a page: one page more than a run reads under the default limits, which are the ones this application runs under.
    expect(EPCIS_DEFAULT_LIMITS.maxPullPages).toBe(10)
    const eleven = Array.from({ length: 11 }, (_, index) => objectEvent(index + 1, [item(`EDGE-${index + 1}`)]))
    const fixture = await source(eleven)
    const api = await app({ config: testConfig(sourceSettings(fixture)) })
    const body = { queryId: 'all', query: { perPage: 1 } }

    const first = await api.post('/api/epcis/sources/supplier-a/pulls', body)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ outcome: 'partial-history', reason: 'page-limit', completion: 'stopped-at-limit', exhausted: false, events: { total: 10, new: 10 }, limits: { maxPullPages: 10 }, limitOverrides: [], run: { pagesAcknowledged: 10 } })
    partial(first.body)
    expect(first.body.pages).toHaveLength(10)
    expect(first.body.completenessLimits.join(' ')).toMatch(/stopped at its page limit/)
    const stopped = (await api.get('/api/epcis/sources/supplier-a/pulls/all')).body
    expect(stopped.pull).toMatchObject({ status: 'stopped-at-limit', pagesAcknowledged: 10, pass: { exhausted: false }, cursor: { afterPage: 10 } })
    expect(stopped.pull.watermark).toBeUndefined()
    // The eleventh event is not held, and nothing says it is.
    expect((await api.get(`/api/epcis/events?identifier=${ref(item('EDGE-11'))}`)).body.events).toEqual([])
    expect(await importsOf(api)).toHaveLength(10)

    const second = await api.post('/api/epcis/sources/supplier-a/pulls', body)
    expect(second.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', completion: 'exhausted', exhausted: true, run: { run: 2, resumed: true, pagesFetched: 1 }, events: { total: 1, new: 1, duplicate: 0 } })
    // Every page was asked for once, in order: none again, none skipped.
    expect(offsets(fixture)).toEqual(Array.from({ length: 11 }, (_, index) => index))
    const finished = (await api.get('/api/epcis/sources/supplier-a/pulls/all')).body
    expect(finished.pull).toMatchObject({ status: 'exhausted', pagesAcknowledged: 11, runs: 2, totals: { events: { total: 11, new: 11, duplicate: 0, conflict: 0 } } })
    expect(finished.pages.map((page: Json) => [page.sequence, page.page])).toEqual(Array.from({ length: 11 }, (_, index) => [index + 1, index + 1]))
    expect((await api.get(`/api/epcis/events?identifier=${ref(item('EDGE-11'))}`)).body.events).toHaveLength(1)
    expect(await importsOf(api)).toHaveLength(11)
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
  })

  it('takes an empty result as the answer to the query, retains the empty page, and holds no event', async () => {
    const empty = await source([])
    const api = await app({ config: testConfig(sourceSettings(empty)) })
    const run = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'nothing-yet', query: {} })
    expect(run.status).toBe(200)
    expect(run.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', completion: 'exhausted', exhausted: true, events: { total: 0, new: 0 } })
    expect(run.body.pages).toHaveLength(1)
    expect(run.body.pages[0]).toMatchObject({ page: 1, last: true, events: { total: 0 } })
    // The pages were exhausted. That is still not a statement about what the source holds or will hold.
    expect(run.body.completenessLimits[0]).toMatch(/not the complete history/)
    // The empty answer is retained like any page: it is the evidence that the query was answered.
    const listed = await importsOf(api)
    expect(listed).toEqual([expect.objectContaining({ importId: run.body.pages[0].importId, sourceId: 'supplier-a', events: 0, documentValidity: 'valid', state: 'evaluated', provenance: expect.objectContaining({ kind: 'query', page: 1 }) })])
    const original = await api.get(`/api/epcis/imports/${ref(run.body.pages[0].importId)}/original`)
    expect(sha256(original.bytes)).toBe(run.body.pages[0].sha256)
    expect(JSON.parse(original.text).epcisBody.queryResults.resultsBody.eventList).toEqual([])
    const state = (await api.get('/api/epcis/sources/supplier-a/pulls/nothing-yet')).body
    expect(state.pull).toMatchObject({ status: 'exhausted', pagesAcknowledged: 1, pass: { exhausted: true } })
    expect(state.pull.watermark).toBeUndefined()

    // A source that holds events, asked for a product none of them names, answers the same way.
    const stocked = await source(Array.from({ length: 3 }, (_, index) => objectEvent(index + 1, [item(`HELD-${index + 1}`)])))
    const other = await app({ config: testConfig(sourceSettings(stocked)) })
    const none = await other.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'not-held', query: { matchAnyEPC: [item('NOT-HELD')] } })
    expect(none.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', exhausted: true, events: { total: 0 } })
    expect(stocked.requests.map((request) => request.query.MATCH_anyEPC)).toEqual([item('NOT-HELD')])
    expect((await other.get(`/api/epcis/events?identifier=${ref(item('HELD-1'))}`)).body.events).toEqual([])
  })

  it('asks again from the bounds of the query when its cursor has expired, never sends the expired cursor, and holds no event twice', async () => {
    let now = Date.parse('2026-03-10T00:00:00.000Z')
    const clock = (): string => new Date(now).toISOString()
    const seven = Array.from({ length: 7 }, (_, index) => objectEvent(index + 1, [item(`EXPIRY-${index + 1}`)]))
    // Every cursor the source names is good for one minute. Its third page request is answered 503, once.
    const fixture = await source(seven, { failRequest: (n) => (n === 3 ? 503 : undefined), tokenExpires: () => new Date(now + 60_000).toISOString() })
    const api = await app({ config: testConfig(sourceSettings(fixture)), now: clock })
    const body = { queryId: 'all', query: { perPage: 2 } }

    const stopped = await api.post('/api/epcis/sources/supplier-a/pulls', body)
    expect(stopped.body).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 503, completion: 'failed', events: { total: 4, new: 4 } })
    partial(stopped.body)
    expect(stopped.body.pull.cursor).toMatchObject({ afterPage: 2, expiresAt: new Date(now + 60_000).toISOString() })

    // Two minutes later the cursor is past the time the source gave it.
    now += 120_000
    const resumed = await api.post('/api/epcis/sources/supplier-a/pulls', body)
    expect(resumed.status).toBe(200)
    expect(resumed.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', exhausted: true, replay: { reason: 'cursor-expired', pagesAcknowledgedBefore: 2 }, run: { run: 2, replays: 1 }, events: { total: 7, new: 3, duplicate: 4, conflict: 0 } })
    expect(resumed.body.completenessLimits.join(' ')).toMatch(/replayed from its bounds/)
    // The first run asked for offsets 0, 2 and 4. The second began again at 0: the expired cursor, which names offset 4, was not what it sent first.
    expect(offsets(fixture)).toEqual([0, 2, 4, 0, 2, 4, 6])
    // The same query and the same pass, traversed a second time. Every event is held once, and nothing is in conflict.
    const state = (await api.get('/api/epcis/sources/supplier-a/pulls/all')).body
    expect(state.pull).toMatchObject({ status: 'exhausted', pass: { number: 1, attempt: 2, exhausted: true } })
    const observed = (await api.exchange.storage.list(EPCIS_RECORD_KINDS.observation, { limit: 100 })).map((record) => `${String(record.value.identity)} ${String(record.value.sequence)}`)
    expect(observed.sort()).toEqual(seven.map((event) => `${String(event.eventID)} 1`).sort())
    expect((await api.get('/api/epcis/conflicts')).body.conflicts).toEqual([])
    expect(await checkEpcisExchangeInvariants(api.exchange.storage, { associations: true })).toEqual([])
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
    const died = await dying.upload('/api/epcis/imports?requestId=interrupted', bytes)
    expect(died.status).toBe(503)
    expect(died.body).toMatchObject({ error: 'storage-unavailable', outcome: 'failed', retryable: true, acknowledged: false })

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
    expect((await dying.upload('/api/epcis/imports?requestId=never-held', bytes)).body).toMatchObject({ error: 'storage-unavailable', retryable: true })
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
