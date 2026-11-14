// What the EPCIS tests share: synthetic documents, an in-memory MongoDB and a
// small stand-in for a source's query interface.
//
// Every identifier is synthetic, under the GS1 demonstration prefix 952. The
// source listens on 127.0.0.1 only, on a port the system picks, and every
// test that starts one stops it. It is not an EPCIS repository and answers no
// more of the query interface than these tests ask of it.
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { EpcisExchangeStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { EPCIS_CONTEXT_IRI } from '@bsv/dpp-credentials/epcis-source'
import type { Session } from '../src/auth.js'
import { loadConfig, type Config } from '../src/config.js'
import { startEpcisExchange, type EpcisExchange } from '../src/epcis/exchange.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { createServer as createApiServer } from '../src/server.js'

export type Json = Record<string, unknown>

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

/** The folder the test set-up provisioned the pinned GS1 files into. */
export const gs1Dir = (): string => process.env.DPP_GS1_ARTEFACTS_DIR as string

/* --------------------------------- documents ----------------------------- */

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
export const eventId = (n: number): string => `urn:uuid:00000000-0000-4000-8000-0000000002${pad(n)}`
export const item = (serial: string): string => `urn:epc:id:sgtin:9521234.012345.${serial}`
export const minute = (n: number, hour = 9): string => `2026-03-02T${pad(hour)}:${pad(n)}:00.000Z`

/** One synthetic observation of the identifiers given. Event `n` was recorded at minute `n`. */
export function objectEvent(n: number, identifiers: string[], fields: Json = {}): Json {
  return { type: 'ObjectEvent', eventID: eventId(n), eventTime: minute(n, 8), eventTimeZoneOffset: '+00:00', recordTime: minute(n), epcList: identifiers, action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active', ...fields }
}

export function epcisDocument(eventList: Json[], extra: Json = {}): Json {
  return { '@context': [EPCIS_CONTEXT_IRI, { example: 'https://example.org/vocab/' }], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-03-03T07:00:00.000Z', ...extra, epcisBody: { eventList } }
}

/* ---------------------------------- MongoDB ------------------------------ */

export interface TestMongo {
  client: MongoClient
  /** A database of its own for each call, so no test meets another's records. */
  database(): Db
  stop(): Promise<void>
}

/** One MongoDB node, in memory, as the reference deployment runs it: no replica set, so no multi-document transaction. */
export async function startMongo(): Promise<TestMongo> {
  const mongod = await MongoMemoryServer.create()
  const client = await MongoClient.connect(mongod.getUri())
  let count = 0
  return {
    client,
    database: () => client.db(`epcis_test_${process.pid}_${(count += 1)}`),
    stop: async () => {
      await client.close()
      await mongod.stop()
    },
  }
}

/* ----------------------------------- source ------------------------------ */

export interface SourceRequest {
  path: string
  /** The query as it was sent, undecoded. */
  search: string
  query: Record<string, string>
  headers: IncomingHttpHeaders
}

export interface SourceBehaviour {
  /** Answer 401 unless the request carries exactly this Authorization header. */
  requireAuthorization?: string
  /** Called with the number of each page request, from 1. Return a status to answer it with that status and no page. */
  failRequest?: (n: number) => number | undefined
  /** Name the next page on this origin instead of the source's own. */
  nextOrigin?: string
  /** Answer this in place of an EPCIS page: a status, a media type and a body. */
  answer?: { status: number; mediaType: string; body: string }
}

export interface FixtureSource {
  origin: string
  /** The base address of the query interface. */
  baseUrl: string
  events: Json[]
  behaviour: SourceBehaviour
  /** Every request received, in order. */
  requests: SourceRequest[]
  close(): Promise<void>
}

export async function startEpcisSource(events: Json[] = [], behaviour: SourceBehaviour = {}): Promise<FixtureSource> {
  const requests: SourceRequest[] = []
  let origin = ''
  let pageRequests = 0
  const source: FixtureSource = { origin: '', baseUrl: '', events: [...events], behaviour, requests, close: async () => undefined }

  const server: Server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? '/', origin)
    const query = Object.fromEntries(url.searchParams)
    requests.push({ path: url.pathname, search: url.search, query, headers: incoming.headers })
    const settings = source.behaviour
    if (settings.requireAuthorization != null && incoming.headers.authorization !== settings.requireAuthorization) {
      response.writeHead(401, { 'www-authenticate': 'Bearer' }).end()
      return
    }
    if (url.pathname !== '/epcis/events') {
      response.writeHead(404).end()
      return
    }
    pageRequests += 1
    const failure = settings.failRequest?.(pageRequests)
    if (failure != null) {
      response.writeHead(failure, { 'content-type': 'application/problem+json' }).end('{"title":"the source is not available"}')
      return
    }
    if (settings.answer != null) {
      response.writeHead(settings.answer.status, { 'content-type': settings.answer.mediaType, 'GS1-EPCIS-Version': '2.0.1' }).end(settings.answer.body)
      return
    }
    const offset = query.nextPageToken == null ? 0 : Number(Buffer.from(query.nextPageToken, 'base64url').toString('utf8'))
    const perPage = Math.max(1, Number(query.perPage ?? '30'))
    const wanted = query.MATCH_anyEPC?.split('|')
    const matched = source.events.filter((event) => wanted == null || (Array.isArray(event.epcList) && event.epcList.some((epc) => wanted.includes(String(epc)))))
    const slice = matched.slice(offset, offset + perPage)
    const headers: Record<string, string> = { 'content-type': 'application/ld+json', 'GS1-EPCIS-Version': '2.0.1', 'GS1-CBV-Version': '2.0.0' }
    if (offset + perPage < matched.length) {
      const parameters = new URLSearchParams(query)
      parameters.set('nextPageToken', Buffer.from(String(offset + perPage), 'utf8').toString('base64url'))
      headers.Link = `<${settings.nextOrigin ?? origin}/epcis/events?${parameters.toString()}>; rel="next"`
    }
    const document = { '@context': [EPCIS_CONTEXT_IRI], type: 'EPCISQueryDocument', schemaVersion: '2.0', creationDate: '2026-03-03T07:00:00.000Z', epcisBody: { queryResults: { queryName: 'SimpleEventQuery', resultsBody: { eventList: slice } } } }
    response.writeHead(200, headers).end(JSON.stringify(document))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  source.origin = origin
  source.baseUrl = `${origin}/epcis`
  source.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return source
}

/* ------------------------------------ the API ---------------------------- */

/** The configuration the EPCIS tests run under: the provisioned GS1 folder, never fetched into, and whatever a test adds. */
export const testConfig = (over: Record<string, string> = {}): Config =>
  loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false', DPP_GS1_ARTEFACTS_DIR: gs1Dir(), DPP_GS1_ARTEFACTS_OFFLINE: 'true', ...over })

export const developer: Session = { userId: 'developer', email: 'developer@localhost', name: 'Developer', brandIds: ['dev-brand'] }

export interface Answer {
  status: number
  headers: Headers
  bytes: Uint8Array
  text: string
  body: any
}

export interface TestApp {
  base: string
  platform: Platform
  exchange: EpcisExchange
  /** Every line start-up and the exchange logged. */
  lines: string[]
  get(path: string): Promise<Answer>
  /** A JSON body. */
  post(path: string, body: unknown): Promise<Answer>
  /** A body sent as the bytes given, under the media type given. */
  upload(path: string, bytes: Uint8Array, mediaType?: string, headers?: Record<string, string>): Promise<Answer>
  close(): Promise<void>
}

/** The API as main.ts assembles it, on a port of its own: the platform, the exchange opened beside it, and the server. */
export async function startApp(options: { config?: Config; db?: Db; storage?: EpcisExchangeStorage; session?: Session | null; fetch?: typeof globalThis.fetch; lines?: string[] } = {}): Promise<TestApp> {
  const config = options.config ?? testConfig()
  const lines = options.lines ?? []
  const log = (line: string): void => void lines.push(line)
  const platform = await openPlatform({ config, mode: 'test', log })
  const exchange = await startEpcisExchange({ config: config.epcis, ...(options.db == null ? {} : { db: options.db }), ...(options.storage == null ? {} : { storage: options.storage }), ...(options.fetch == null ? {} : { fetch: options.fetch }), log })
  const app = createApiServer({ platform, exchange, ...(options.session === null ? {} : { devSession: options.session ?? developer }) })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const answer = async (response: Response): Promise<Answer> => {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    let body: unknown
    try {
      body = text === '' ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, headers: response.headers, bytes, text, body }
  }
  return {
    base,
    platform,
    exchange,
    lines,
    get: async (path) => answer(await fetch(`${base}${path}`)),
    post: async (path, body) => answer(await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
    upload: async (path, bytes, mediaType = 'application/ld+json', headers = {}) => answer(await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': mediaType, ...headers }, body: bytes as unknown as BodyInit })),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await exchange.close()
      await platform.close()
    },
  }
}
