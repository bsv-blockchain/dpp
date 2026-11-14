import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { EngineContext, EngineFile, JsonLdEngine, JsonLdExpansion, ShaclEngine, ShaclValidation } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { createValidatorClient } from '../src/validator-client.js'
import { startValidatorService, type ValidatorLogEntry, type ValidatorService, type ValidatorServiceOptions } from '../src/validator-service.js'
import { expandRequestText, validateRequestText } from '../src/validator-wire.js'

// The service's own behaviour: what it refuses, what it bounds and what it
// says about itself. The engine is supplied here, so each limit can be met
// with an engine that is slow on purpose. The threads the service runs its
// own engine in are tested on the built package, in validator-workers.test.ts.
const repo = join(import.meta.dirname, '..', '..', '..')
const folder = join(repo, 'examples', 'custom-profile', 'example-bottle@1')
const bytes = (file: string): Uint8Array => new Uint8Array(readFileSync(join(folder, file)))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const CONTEXT = 'https://profiles.example/bottle/v1/context.jsonld'
const contexts: EngineContext[] = [{ uri: CONTEXT, bytes: bytes('context.jsonld') }]
const shapes: EngineFile[] = [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: bytes('shapes.ttl') }]
const background: EngineFile[] = [{ path: 'background.ttl', mediaType: 'text/turtle', bytes: bytes('background.ttl') }]
const product = (JSON.parse(readFileSync(join(folder, 'vectors', 'item.json'), 'utf8')) as { payload: { product: Record<string, unknown> } }).payload.product
const CAPABILITIES = ['shacl-core', 'shacl-sparql-constraints']

// Every body the service sends is held to the published contract.
const contract = JSON.parse(readFileSync(join(repo, 'contracts', 'validator.schema.json'), 'utf8')) as { $id: string }
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addSchema(contract)
const conforms = (definition: string, body: unknown): void => {
  const validate = ajv.getSchema(`${contract.$id}#/$defs/${definition}`)!
  expect(validate(body), `${definition}: ${JSON.stringify(validate.errors)}`).toBe(true)
}

let engine: { jsonLd: JsonLdEngine; shacl: ShaclEngine }
let nquads: string
beforeAll(async () => {
  engine = await createValidationEngine()
  const expansion = await engine.jsonLd.toRdf({ document: product, contexts })
  if (!expansion.ok) throw new Error(expansion.detail)
  nquads = expansion.nquads
})

const running: ValidatorService[] = []
const start = async (options: ValidatorServiceOptions = {}): Promise<ValidatorService> => {
  const service = await startValidatorService({ engines: engine, ...options })
  running.push(service)
  return service
}
afterEach(async () => { await Promise.all(running.splice(0).map((service) => service.close())) })

interface Reply { status: number; body: any; headers: Headers }
const call = async (service: ValidatorService, path: string, init: RequestInit = {}): Promise<Reply> => {
  const response = await fetch(`${service.url}${path}`, init)
  const text = await response.text()
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text), headers: response.headers }
}
const post = (service: ValidatorService, path: string, body: string, headers: Record<string, string> = {}): Promise<Reply> => call(service, path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
const refusal = (reply: Reply, status: number, code: string): void => {
  expect({ status: reply.status, code: reply.body?.error?.code }).toEqual({ status, code })
  conforms('refusal', reply.body)
}
const expandBody = (): string => expandRequestText({ document: product, contexts })
const validateBody = (requires: string[] = CAPABILITIES): string => validateRequestText({ nquads, shapes, background }, requires as never)
/** An engine whose operations end only when the test says so. */
const held = (): { engines: { jsonLd: JsonLdEngine; shacl: ShaclEngine }; started: () => number; release: () => void } => {
  let begun = 0
  const waiting: Array<() => void> = []
  const wait = <T>(result: T): Promise<T> => new Promise((resolve) => { begun += 1; waiting.push(() => resolve(result)) })
  return {
    engines: { jsonLd: { toRdf: () => wait<JsonLdExpansion>({ ok: true, nquads: 'late' }) }, shacl: { capabilities: ['shacl-core'], validate: () => wait<ShaclValidation>({ ok: true, findings: [] }) } },
    started: () => begun,
    release: () => { for (const go of waiting.splice(0)) go() },
  }
}
const until = async (condition: () => boolean): Promise<void> => { for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5)) ; expect(condition()).toBe(true) }

describe('startValidatorService: what it says about itself', () => {
  it('listens on the loopback address and a free port unless told otherwise', async () => {
    const service = await start()
    expect(service.host).toBe('127.0.0.1')
    expect(service.port).toBeGreaterThan(0)
    expect(service.url).toBe(`http://127.0.0.1:${service.port}`)
  })

  it('answers /health and /capabilities as the contract describes', async () => {
    const service = await start({ engine: { name: 'test-engine', version: '1.2.3', libraries: { a: '1' } }, timeoutMs: 4000, concurrency: 3, queueLimit: 5, maxRequestBytes: 100_000 })
    const health = await call(service, '/health')
    expect(health).toMatchObject({ status: 200, body: { contract: 'dpp-validator/1', ok: true } })
    conforms('health', health.body)
    const capabilities = await call(service, '/capabilities')
    expect(capabilities.status).toBe(200)
    conforms('capabilities', capabilities.body)
    expect(capabilities.body).toEqual({ contract: 'dpp-validator/1', engine: { name: 'test-engine', version: '1.2.3', libraries: { a: '1' } }, capabilities: CAPABILITIES, mediaTypes: ['text/turtle', 'application/n-triples', 'application/n-quads', 'application/trig'], limits: { maxRequestBytes: 100_000, timeoutMs: 4000, concurrency: 3, queueLimit: 5 } })
    expect(service.capabilities).toEqual(capabilities.body)
    expect(capabilities.headers.get('cache-control')).toBe('no-store')
  })

  it('answers the two operations with the engine\'s own results', async () => {
    const service = await start()
    const expansion = await post(service, '/expand', expandBody())
    expect(expansion).toMatchObject({ status: 200, body: { contract: 'dpp-validator/1', capabilities: CAPABILITIES, result: { ok: true, nquads } } })
    conforms('expandAnswer', expansion.body)
    const validation = await post(service, '/validate', validateBody())
    expect(validation.body.result).toEqual(await engine.shacl.validate({ nquads, shapes, background }))
    conforms('validateAnswer', validation.body)
    // The requests the client writes are the contract's too.
    conforms('expandRequest', JSON.parse(expandBody()))
    conforms('validateRequest', JSON.parse(validateBody()))
  })

  it('refuses options it cannot run with', async () => {
    for (const options of [{ port: -1 }, { timeoutMs: 0 }, { concurrency: 0 }, { queueLimit: -1 }, { maxRequestBytes: 1.5 }, { token: 'two words' }]) await expect(startValidatorService({ engines: engine, ...options })).rejects.toBeInstanceOf(TypeError)
  })

  it('says why it could not listen', async () => {
    const service = await start()
    await expect(startValidatorService({ engines: engine, port: service.port })).rejects.toThrow(/could not listen on 127\.0\.0\.1:\d+/)
  })
})

describe('startValidatorService: an engine and nothing more', () => {
  it('refuses a context the request did not carry, exactly as the engine in this process does, and reaches for no network', async () => {
    const service = await start()
    const client = createValidatorClient({ url: service.url })
    const realFetch = globalThis.fetch
    let outbound = 0
    // Only the test's own calls to the service are let through. Anything else is an outbound request.
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => { if (!String(input instanceof Request ? input.url : input).startsWith(service.url)) { outbound += 1; throw new Error('the network is not to be used') } return realFetch(input, init) }) as typeof fetch
    try {
      const unlisted = { ...product, '@context': [CONTEXT, 'https://profiles.example/extras/v1/context.jsonld'] }
      expect(await client.jsonLd.toRdf({ document: unlisted, contexts })).toEqual(await engine.jsonLd.toRdf({ document: unlisted, contexts }))
      expect(await client.jsonLd.toRdf({ document: unlisted, contexts })).toMatchObject({ ok: false, reason: 'context-not-listed', detail: expect.stringContaining('https://profiles.example/extras/v1/context.jsonld') })
      // A context that a sent context imports, and that was not sent.
      const importing = utf8(JSON.stringify({ '@context': ['https://profiles.example/shared/v1/context.jsonld', { name: 'https://profiles.example/bottle/v1#name' }] }))
      expect(await client.jsonLd.toRdf({ document: { '@context': CONTEXT, name: 'Bottle' }, contexts: [{ uri: CONTEXT, bytes: importing }] })).toMatchObject({ ok: false, reason: 'context-not-listed' })
      expect(await client.jsonLd.toRdf({ document: product, contexts: [] })).toMatchObject({ ok: false, reason: 'context-not-listed' })
      expect(outbound).toBe(0)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('keeps nothing between requests: a context sent with one is not there for the next', async () => {
    const service = await start()
    const client = createValidatorClient({ url: service.url })
    const shared = 'https://profiles.example/shared/v1/context.jsonld'
    const document = { '@context': shared, '@id': 'https://id.example/thing', label: 'A thing' }
    const first = await client.jsonLd.toRdf({ document, contexts: [{ uri: shared, bytes: utf8(JSON.stringify({ '@context': { label: 'https://profiles.example/shared/v1#label' } })) }] })
    expect(first).toMatchObject({ ok: true, nquads: expect.stringContaining('<https://profiles.example/shared/v1#label> "A thing"') })
    const second = await client.jsonLd.toRdf({ document, contexts: [{ uri: shared, bytes: utf8(JSON.stringify({ '@context': { label: 'https://profiles.example/other/v1#label' } })) }] })
    expect(second).toMatchObject({ ok: true, nquads: expect.stringContaining('<https://profiles.example/other/v1#label> "A thing"') })
    expect(await client.jsonLd.toRdf({ document, contexts })).toMatchObject({ ok: false, reason: 'context-not-listed' })
  })

  it('holds every file to the digest sent with it, and names the file, not its content', async () => {
    const service = await start()
    const wrongContext = JSON.parse(expandBody()) as { contexts: Array<{ sha256: string }> }
    wrongContext.contexts[0]!.sha256 = '0'.repeat(64)
    const reply = await post(service, '/expand', JSON.stringify(wrongContext))
    refusal(reply, 422, 'digest-mismatch')
    expect(reply.body.error.detail).toContain(CONTEXT)
    for (const list of ['shapes', 'background'] as const) {
      const body = JSON.parse(validateBody()) as Record<'shapes' | 'background', Array<{ content: string }>>
      // One byte changed and the length kept, so only the digest can tell.
      const changed = Buffer.from(body[list][0]!.content, 'base64')
      changed[changed.length - 2] = changed[changed.length - 2]! ^ 1
      body[list][0]!.content = changed.toString('base64')
      const answer = await post(service, '/validate', JSON.stringify(body))
      refusal(answer, 422, 'digest-mismatch')
      expect(answer.body.error.detail).toContain(`${list}[0] (${list}.ttl)`)
    }
  })

  it('reports files the engine cannot read as the engine does: an engine error, in a 200', async () => {
    const service = await start()
    const client = createValidatorClient({ url: service.url })
    expect(await client.shacl.validate({ nquads, shapes: [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: utf8('this is not turtle') }], background })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('shapes.ttl') })
    expect(await client.shacl.validate({ nquads, shapes: [{ path: 'shapes.xml', mediaType: 'application/rdf+xml', bytes: utf8('<rdf/>') }], background })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('application/rdf+xml') })
    expect(await client.jsonLd.toRdf({ document: { ...product, colour: 'red' }, contexts })).toMatchObject({ ok: false, reason: 'document-invalid' })
  })

  it('refuses a validation that requires a capability its engine lacks, and does not run it', async () => {
    const calls: unknown[] = []
    const coreOnly = await createValidationEngine({ sparql: false })
    const service = await start({ engines: { jsonLd: coreOnly.jsonLd, shacl: { capabilities: coreOnly.shacl.capabilities, validate: async (input) => { calls.push(input); return coreOnly.shacl.validate(input) } } } })
    const reply = await post(service, '/validate', validateBody())
    refusal(reply, 422, 'capability-unavailable')
    expect(reply.body.error.detail).toContain('shacl-sparql-constraints')
    expect(calls).toEqual([])
    // Asked for what it has, it answers, and says what it has.
    expect(await post(service, '/validate', validateBody(['shacl-core']))).toMatchObject({ status: 200, body: { capabilities: ['shacl-core'], result: { ok: true } } })
  })
})

describe('startValidatorService: what it refuses before any engine is asked', () => {
  const expand = (change: (body: any) => void): string => { const body = JSON.parse(expandBody()); change(body); return JSON.stringify(body) }
  const validate = (change: (body: any) => void): string => { const body = JSON.parse(validateBody()); change(body); return JSON.stringify(body) }

  it.each([
    ['text that is not JSON', '/expand', '{"document":'],
    ['a list', '/expand', '[]'],
    ['a member the contract does not name', '/expand', expand((b) => { b.profile = 'eu-battery@1' })],
    ['a member name written twice', '/expand', `{"document":{},"contexts":[],"contexts":${JSON.stringify(JSON.parse(expandBody()).contexts)}}`],
    ['no document', '/expand', expand((b) => { delete b.document })],
    ['contexts that are not a list', '/expand', expand((b) => { b.contexts = {} })],
    ['a context that is not an object', '/expand', expand((b) => { b.contexts = ['https://profiles.example/x'] })],
    ['a context listed twice', '/expand', expand((b) => { b.contexts.push(b.contexts[0]) })],
    ['a context with a member the contract does not name', '/expand', expand((b) => { b.contexts[0].url = 'https://profiles.example/fetch-me' })],
    ['a digest that is not 64 lower-case hexadecimal characters', '/expand', expand((b) => { b.contexts[0].sha256 = b.contexts[0].sha256.toUpperCase() })],
    ['content that is not base64', '/expand', expand((b) => { b.contexts[0].content = '{not base64}' })],
    ['content that is base64 written another way', '/expand', expand((b) => { b.contexts[0].content = 'QR=='; b.contexts[0].sha256 = '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd' })],
    ['more files than are read', '/expand', expand((b) => { b.contexts = Array.from({ length: 65 }, (_, i) => ({ ...b.contexts[0], uri: `https://profiles.example/${i}` })) })],
    ['data that is not text', '/validate', validate((b) => { b.nquads = [] })],
    ['a file without a media type', '/validate', validate((b) => { delete b.shapes[0].mediaType })],
    ['no background list', '/validate', validate((b) => { delete b.background })],
    ['a required capability the contract does not name', '/validate', validate((b) => { b.requires = ['shacl-everything'] })],
  ])('%s is request-invalid', async (_name, path, body) => {
    const calls: unknown[] = []
    const service = await start({ engines: { jsonLd: { toRdf: async (input) => { calls.push(input); return { ok: true, nquads: '' } } }, shacl: { capabilities: ['shacl-core', 'shacl-sparql-constraints'], validate: async (input) => { calls.push(input); return { ok: true, findings: [] } } } } })
    refusal(await post(service, path, body), 400, 'request-invalid')
    expect(calls).toEqual([])
  })

  it('refuses any address, method and media type the contract does not name', async () => {
    const service = await start()
    refusal(await call(service, '/'), 404, 'not-found')
    refusal(await post(service, '/profiles', '{}'), 404, 'not-found')
    refusal(await call(service, '/expand'), 405, 'method-not-allowed')
    refusal(await call(service, '/health', { method: 'POST', body: '{}' }), 405, 'method-not-allowed')
    refusal(await call(service, '/capabilities', { method: 'DELETE' }), 405, 'method-not-allowed')
    refusal(await post(service, '/expand', expandBody(), { 'content-type': 'text/plain' }), 415, 'unsupported-media-type')
    refusal(await call(service, '/validate', { method: 'POST', body: validateBody(), headers: { 'content-type': 'application/ld+json' } }), 415, 'unsupported-media-type')
    refusal(await post(service, '/expand', Buffer.from([0x7b, 0xff, 0x7d]) as never), 400, 'request-invalid')
  })

  it('refuses a body over the limit on its declared length, without reading it', async () => {
    const service = await start({ maxRequestBytes: 2000 })
    const reply = await post(service, '/expand', expandBody())
    refusal(reply, 413, 'request-too-large')
    expect(reply.headers.get('connection')).toBe('close')
    expect(await post(service, '/expand', expandRequestText({ document: {}, contexts: [] }))).toMatchObject({ status: 200 })
  })

  it('refuses a body over the limit that declares no length, as soon as it has read that much', async () => {
    const service = await start({ maxRequestBytes: 2000 })
    const reply = await new Promise<{ status: number; body: string; sent: number }>((resolve, reject) => {
      // Sent in pieces with no declared length and no end: only the limit stops the reading.
      let sent = 0
      const request = httpRequest(`${service.url}/expand`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => { clearInterval(timer); resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8'), sent }) })
      })
      request.on('error', (cause) => { clearInterval(timer); if (sent < 1_000_000) reject(cause) })
      const timer = setInterval(() => { if (sent > 1_000_000) { clearInterval(timer); reject(new Error('the service kept reading')) } else { sent += 500; request.write('x'.repeat(500)) } }, 1)
    })
    expect(reply.status).toBe(413)
    expect(JSON.parse(reply.body)).toMatchObject({ error: { code: 'request-too-large' } })
    expect(reply.sent).toBeLessThan(200_000)
  })

  it('with a token: the two operations require it, and /health and /capabilities stay open', async () => {
    const service = await start({ token: 'correct-horse' })
    const none = await post(service, '/expand', expandBody())
    refusal(none, 401, 'unauthorised')
    expect(none.headers.get('www-authenticate')).toBe('Bearer')
    refusal(await post(service, '/validate', validateBody(), { authorization: 'Bearer wrong-horse' }), 401, 'unauthorised')
    refusal(await post(service, '/expand', expandBody(), { authorization: 'Basic correct-horse' }), 401, 'unauthorised')
    refusal(await post(service, '/expand', expandBody(), { authorization: 'Bearer correct-horse-and-more' }), 401, 'unauthorised')
    expect(await post(service, '/expand', expandBody(), { authorization: 'Bearer correct-horse' })).toMatchObject({ status: 200, body: { result: { ok: true } } })
    expect((await call(service, '/health')).status).toBe(200)
    expect((await call(service, '/capabilities')).status).toBe(200)
    // The client sends it, and a client without it is told the engine could not run.
    expect(await createValidatorClient({ url: service.url, token: 'correct-horse' }).jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(await createValidatorClient({ url: service.url }).jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('answered 401 (unauthorised)') })
    // No refusal repeats the token.
    expect(JSON.stringify(none.body)).not.toContain('correct-horse')
  })
})

describe('startValidatorService: its bounds', () => {
  it('runs no more operations at once than it was told, holds the next in order and refuses the one after as busy', async () => {
    const slow = held()
    const service = await start({ engines: slow.engines, concurrency: 2, queueLimit: 1, timeoutMs: 5000 })
    const first = post(service, '/expand', expandBody())
    const second = post(service, '/expand', expandBody())
    await until(() => slow.started() === 2)
    const third = post(service, '/expand', expandBody())
    // The third waits. It has not reached the engine.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(slow.started()).toBe(2)
    const fourth = await post(service, '/expand', expandBody())
    refusal(fourth, 503, 'busy')
    expect(fourth.headers.get('retry-after')).toBe('1')
    // /health and /capabilities are not operations and are answered all the while.
    expect((await call(service, '/health')).status).toBe(200)
    slow.release()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    await until(() => slow.started() === 3)
    slow.release()
    expect((await third).body).toMatchObject({ result: { ok: true, nquads: 'late' } })
  })

  it('answers timeout at the limit and never uses the result that arrives later', async () => {
    const slow = held()
    const service = await start({ engines: slow.engines, concurrency: 1, queueLimit: 0, timeoutMs: 100 })
    const began = performance.now()
    const reply = await post(service, '/expand', expandBody())
    expect(performance.now() - began).toBeLessThan(2000)
    expect(reply).toMatchObject({ status: 200, body: { result: { ok: false, reason: 'timeout' } } })
    conforms('expandAnswer', reply.body)
    // This engine is the caller's, so the service cannot stop it. It says so, and the work keeps its place.
    expect(reply.body.result.detail).toBe('the operation did not finish within 100 ms, and its result will not be used')
    refusal(await post(service, '/expand', expandBody()), 503, 'busy')
    // Once the work ends, late, its place is free again and its result has gone nowhere.
    slow.release()
    await until(() => slow.started() === 1)
    const next = post(service, '/expand', expandBody())
    await until(() => slow.started() === 2)
    slow.release()
    expect((await next).body.result).toEqual({ ok: true, nquads: 'late' })
    // Through the client the answer is the engine's own `timeout`, which a validator reports as unknown.
    const again = createValidatorClient({ url: service.url }).jsonLd.toRdf({ document: product, contexts })
    expect(await again).toMatchObject({ ok: false, reason: 'timeout' })
    slow.release()
  })

  it('tells a request that waited a whole time limit for its turn that it is busy, which is not a timeout of the engine', async () => {
    const slow = held()
    const service = await start({ engines: slow.engines, concurrency: 1, queueLimit: 4, timeoutMs: 150 })
    const first = post(service, '/expand', expandBody())
    await until(() => slow.started() === 1)
    const waited = await post(service, '/expand', expandBody())
    refusal(waited, 503, 'busy')
    expect(waited.body.error.detail).toContain('no engine became free within 150 ms')
    expect(slow.started()).toBe(1)
    expect((await first).body.result.reason).toBe('timeout')
    slow.release()
  })

  it('withdraws a request whose caller went away before its turn', async () => {
    const slow = held()
    const service = await start({ engines: slow.engines, concurrency: 1, queueLimit: 4, timeoutMs: 5000 })
    const first = post(service, '/expand', expandBody())
    await until(() => slow.started() === 1)
    const gone = new AbortController()
    const abandoned = fetch(`${service.url}/expand`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: expandBody(), signal: gone.signal }).catch(() => 'aborted')
    await new Promise((resolve) => setTimeout(resolve, 50))
    gone.abort()
    expect(await abandoned).toBe('aborted')
    await new Promise((resolve) => setTimeout(resolve, 50))
    slow.release()
    expect((await first).status).toBe(200)
    // The abandoned request never reached the engine.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(slow.started()).toBe(1)
  })

  it('turns an engine that throws into an engine error, and stays up', async () => {
    const service = await start({ engines: { jsonLd: { toRdf: () => { throw new Error('the engine broke') } }, shacl: { capabilities: ['shacl-core'], validate: async () => { throw new Error('the engine broke') } } } })
    expect((await post(service, '/expand', expandBody())).body.result).toEqual({ ok: false, reason: 'engine-error', detail: 'the engine broke' })
    expect((await post(service, '/validate', validateBody(['shacl-core']))).body.result).toEqual({ ok: false, reason: 'engine-error', detail: 'the engine broke' })
    expect((await call(service, '/health')).status).toBe(200)
  })

  it('once closed, answers nothing and frees its port', async () => {
    const service = await startValidatorService({ engines: engine })
    await service.close()
    await expect(fetch(`${service.url}/health`)).rejects.toThrow()
    const again = await startValidatorService({ engines: engine, port: service.port })
    await again.close()
  })
})

describe('startValidatorService: its log', () => {
  it('writes one entry per request, and none of them holds a document, a file, a finding or the token', async () => {
    const entries: ValidatorLogEntry[] = []
    const service = await start({ token: 'correct-horse', log: (entry) => entries.push(entry) })
    const auth = { authorization: 'Bearer correct-horse' }
    await post(service, '/expand', expandBody(), auth)
    await post(service, '/validate', validateBody(), auth)
    await post(service, '/expand', expandRequestText({ document: { ...product, colour: 'red' }, contexts }), auth)
    await post(service, '/expand', expandBody())
    await post(service, '/expand', '{"document":', auth)
    await call(service, '/health')
    await call(service, `/lookup?serial=${encodeURIComponent(String(product['serialNumber'] ?? 'BTL-0001'))}`)
    expect(entries.map((e) => [e.route, e.method, e.status, e.outcome])).toEqual([
      ['expand', 'POST', 200, 'ok'],
      ['validate', 'POST', 200, 'ok'],
      ['expand', 'POST', 200, 'document-invalid'],
      ['expand', 'POST', 401, 'unauthorised'],
      ['expand', 'POST', 400, 'request-invalid'],
      ['health', 'GET', 200, 'ok'],
      ['other', 'GET', 404, 'not-found'],
    ])
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['durationMs', 'method', 'outcome', 'requestBytes', 'responseBytes', 'route', 'status'])
      expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(entries[0]!.requestBytes).toBe(Buffer.byteLength(expandBody()))
    // Nothing from the product document, the rule files, the findings or the token is in any entry.
    const logged = JSON.stringify(entries)
    for (const text of ['correct-horse', 'BTL-0001', 'id.example', 'profiles.example', 'stainless', 'careNote', 'A care note is recommended', 'colour']) expect(logged, text).not.toContain(text)
  })

  it('logs nothing unless it is given somewhere to log', async () => {
    const written: unknown[][] = []
    const real = { log: console.log, error: console.error, warn: console.warn }
    console.log = console.error = console.warn = (...args: unknown[]) => { written.push(args) }
    try {
      const service = await start()
      await post(service, '/expand', expandBody())
      await post(service, '/expand', '{')
    } finally {
      Object.assign(console, real)
    }
    expect(written).toEqual([])
  })
})
