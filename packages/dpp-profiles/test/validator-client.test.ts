import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { bindingPayloadValidator, createProfileRegistry, profileBindingDigest, type BindingValidationDetail, type EngineContext, type EngineFile, type PayloadValidation, type ProfileRegistry, type ValidationEngines } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { createValidatorClient, type ValidatorClientOptions } from '../src/validator-client.js'
import { startValidatorService } from '../src/validator-service.js'

// The client, against services that go wrong in every way a service can.
// Each case is held to two things: the engine call answers `timeout` or
// `engine-error`, and the validator over it answers `unknown`. The payload is
// the example bottle's positive vector, which passes with a working engine,
// so any other answer here is the fault under test and nothing else.
const folder = join(import.meta.dirname, '..', '..', '..', 'examples', 'custom-profile', 'example-bottle@1')
const bytes = (file: string): Uint8Array => new Uint8Array(readFileSync(join(folder, file)))
const CONTEXT = 'https://profiles.example/bottle/v1/context.jsonld'
const contexts: EngineContext[] = [{ uri: CONTEXT, bytes: bytes('context.jsonld') }]
const shapes: EngineFile[] = [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: bytes('shapes.ttl') }]
const background: EngineFile[] = [{ path: 'background.ttl', mediaType: 'text/turtle', bytes: bytes('background.ttl') }]
const vector = JSON.parse(readFileSync(join(folder, 'vectors', 'item.json'), 'utf8')) as { passportId: string; payload: { product: Record<string, unknown> } }
const product = vector.payload.product
const TOKEN = 'correct-horse-battery-staple'
/** A value that appears in the product document and nowhere in an address or a file name. */
const SECRET_VALUE = 'BTL-0001'

let registry: ProfileRegistry
let engine: Awaited<ReturnType<typeof createValidationEngine>>
let nquads: string
const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
beforeAll(async () => {
  const bindingBytes = bytes('binding.json')
  registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(bindingBytes)] })
  expect((await registry.register({ bindingBytes, resolveArtefact: (artefact) => bytes(artefact.path) })).ok).toBe(true)
  engine = await createValidationEngine()
  const expansion = await engine.jsonLd.toRdf({ document: product, contexts })
  if (!expansion.ok) throw new Error(expansion.detail)
  nquads = expansion.nquads
})

/** The whole validator over one pair of engines, on the vector that passes. */
const validateWith = (engines: ValidationEngines): Promise<PayloadValidation> =>
  bindingPayloadValidator({ registry, engines: { jsonSchema: compiler(), ...engines } })({ profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
const stepsOf = (result: PayloadValidation): BindingValidationDetail['steps'] => (result.detail as BindingValidationDetail).steps

// A service that answers whatever the test tells it to, and keeps what it was sent.
type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void
interface Fake { url: string; requests: Array<{ method: string; url: string; authorization?: string; body: string }>; handler: Handler }
const servers: Server[] = []
async function fake(handler: Handler): Promise<Fake> {
  const state: Fake = { url: '', requests: [], handler }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      state.requests.push({ method: request.method!, url: request.url!, ...(request.headers.authorization == null ? {} : { authorization: request.headers.authorization }), body })
      state.handler(request, response, body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return state
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })))
})

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(body)) }
const CAPABILITIES = ['shacl-core', 'shacl-sparql-constraints']
/** A service that answers as the contract describes, by asking the real engine. `over` changes one answer. */
const honest = (over: Partial<Record<'/expand' | '/validate', (response: ServerResponse) => void>> = {}, capabilities: Record<string, string[]> = {}): Handler => (request, response, body) => {
  const path = request.url as '/expand' | '/validate'
  if (over[path] != null) return over[path]!(response)
  const sent = JSON.parse(body) as { document: unknown; contexts: Array<{ uri: string; content: string }>; nquads: string; shapes: Array<{ path: string; mediaType: string; content: string }>; background: Array<{ path: string; mediaType: string; content: string }> }
  const decode = (content: string): Uint8Array => new Uint8Array(Buffer.from(content, 'base64'))
  const files = (list: Array<{ path: string; mediaType: string; content: string }>): EngineFile[] => list.map((f) => ({ path: f.path, mediaType: f.mediaType, bytes: decode(f.content) }))
  const work = path === '/expand' ? engine.jsonLd.toRdf({ document: sent.document, contexts: sent.contexts.map((c) => ({ uri: c.uri, bytes: decode(c.content) })) }) : engine.shacl.validate({ nquads: sent.nquads, shapes: files(sent.shapes), background: files(sent.background) })
  void work.then((result) => json(response, 200, { contract: 'dpp-validator/1', capabilities: capabilities[path] ?? CAPABILITIES, result }))
}

/** Holds one failure to the rule: the engine call names the failure, and the validator answers `unknown`. */
async function expectUnknown(options: ValidatorClientOptions, reason: 'timeout' | 'engine-error', detail: RegExp, step: 'json-ld-expand' | 'shacl' = 'json-ld-expand'): Promise<void> {
  const direct = step === 'json-ld-expand' ? await createValidatorClient(options).jsonLd.toRdf({ document: product, contexts }) : await createValidatorClient(options).shacl.validate({ nquads, shapes, background })
  expect(direct).toMatchObject({ ok: false, reason })
  if (!direct.ok) {
    expect(direct.detail).toMatch(detail)
    // Neither the token nor anything from the document is repeated in what a report would carry.
    expect(direct.detail).not.toContain(TOKEN)
    expect(direct.detail).not.toContain(SECRET_VALUE)
  }
  const result = await validateWith(createValidatorClient(options))
  expect(result, JSON.stringify(result.detail)).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
  expect(stepsOf(result).find((s) => s.step === step)).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
  expect(JSON.stringify(result)).not.toContain(TOKEN)
}

describe('createValidatorClient: a working service', () => {
  it('answers as the engine in this process does, and sends each file with its digest', async () => {
    const service = await fake(honest())
    const client = createValidatorClient({ url: service.url, token: TOKEN })
    expect(client.shacl.capabilities).toEqual([])
    expect(await client.jsonLd.toRdf({ document: product, contexts })).toEqual({ ok: true, nquads })
    expect(client.shacl.capabilities).toEqual(CAPABILITIES)
    expect(await client.shacl.validate({ nquads, shapes, background })).toEqual(await engine.shacl.validate({ nquads, shapes, background }))
    expect((await validateWith(client)).status).toBe('pass')
    const [expand, validate] = service.requests
    expect(expand).toMatchObject({ method: 'POST', url: '/expand', authorization: `Bearer ${TOKEN}` })
    const sent = JSON.parse(expand!.body) as { contexts: Array<{ uri: string; sha256: string; content: string }> }
    expect(sent.contexts).toEqual([{ uri: CONTEXT, sha256: createHash('sha256').update(contexts[0]!.bytes).digest('hex'), content: Buffer.from(contexts[0]!.bytes).toString('base64') }])
    // The validation says which capabilities the caller was told the engine has.
    expect(JSON.parse(validate!.body)).toMatchObject({ requires: CAPABILITIES, shapes: [{ path: 'shapes.ttl', mediaType: 'text/turtle' }], background: [{ path: 'background.ttl' }] })
  })

  it('reaches a service behind a path prefix', async () => {
    const service = await fake((request, response, body) => { request.url = request.url!.replace(/^\/engines\/validator/, ''); honest()(request, response, body) })
    const client = createValidatorClient({ url: `${service.url}/engines/validator/` })
    expect(await client.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(service.requests[0]!.url).toBe('/engines/validator/expand')
  })

  it('probe says which engine answered, and never throws', async () => {
    const service = await startValidatorService({ engines: engine, engine: { name: 'test-engine', version: '1' } })
    try {
      const client = createValidatorClient({ url: service.url })
      expect(await client.probe()).toEqual({ ok: true, service: service.capabilities })
      expect(client.shacl.capabilities).toEqual(CAPABILITIES)
    } finally {
      await service.close()
    }
    expect(await createValidatorClient({ url: service.url }).probe()).toMatchObject({ ok: false, detail: expect.stringContaining('could not be reached') })
  })
})

describe('createValidatorClient: a service that cannot be used is never a pass', () => {
  it('nothing listening at the address', async () => {
    const gone = await fake(honest())
    const url = gone.url
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()))
    await expectUnknown({ url, token: TOKEN }, 'engine-error', /could not be reached/)
  })

  it('a service that never answers, cut off at the time limit', async () => {
    const service = await fake(() => { /* holds the request and says nothing */ })
    const started = performance.now()
    await expectUnknown({ url: service.url, token: TOKEN, timeoutMs: 150 }, 'timeout', /did not answer within 150 ms/)
    // Two calls, one direct and one through the validator, each cut off at its limit.
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('a service that starts its answer and never ends it', async () => {
    const service = await fake((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"contract":"dpp-validator/1",') })
    await expectUnknown({ url: service.url, timeoutMs: 150 }, 'timeout', /did not answer within/)
  })

  it.each([
    [500, { contract: 'dpp-validator/1', error: { code: 'engine-unavailable', detail: 'x' } }, /answered 500 \(engine-unavailable\)/],
    [503, { contract: 'dpp-validator/1', error: { code: 'busy', detail: 'x' } }, /answered 503 \(busy\)/],
    [401, { contract: 'dpp-validator/1', error: { code: 'unauthorised', detail: 'x' } }, /answered 401 \(unauthorised\)/],
    [404, 'not here', /answered 404$/],
    [204, '', /answered 204$/],
  ] as const)('an answer with status %i', async (status, body, detail) => {
    const service = await fake((_request, response) => { if (status === 204) { response.writeHead(204); response.end() } else json(response, status, body) })
    await expectUnknown({ url: service.url, token: TOKEN }, 'engine-error', detail)
  })

  it('a refusal whose text quotes the document: only its code is repeated, and only if it reads as a code', async () => {
    const service = await fake((_request, response, body) => json(response, 422, { contract: 'dpp-validator/1', error: { code: `leak ${SECRET_VALUE}`, detail: body } }))
    await expectUnknown({ url: service.url }, 'engine-error', /answered 422$/)
  })

  it.each([
    ['text that is not JSON', (response: ServerResponse) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"contract":') }, /not answer as the contract describes/],
    ['a page of HTML with status 200', (response: ServerResponse) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html>Sign in</html>') }, /not declared as JSON/],
    ['another contract', (response: ServerResponse) => json(response, 200, { contract: 'dpp-validator/2', capabilities: CAPABILITIES, result: { ok: true, nquads: '' } }), /names the contract "dpp-validator\/2"/],
    ['no contract', (response: ServerResponse) => json(response, 200, { capabilities: CAPABILITIES, result: { ok: true, nquads: '' } }), /names the contract undefined/],
    ['no capabilities', (response: ServerResponse) => json(response, 200, { contract: 'dpp-validator/1', result: { ok: true, nquads: '' } }), /capabilities/],
    ['no result', (response: ServerResponse) => json(response, 200, { contract: 'dpp-validator/1', capabilities: CAPABILITIES }), /carries no result/],
    ['a success without its N-Quads', (response: ServerResponse) => json(response, 200, { contract: 'dpp-validator/1', capabilities: CAPABILITIES, result: { ok: true } }), /without its N-Quads/],
    ['a failure with a reason the contract does not name', (response: ServerResponse) => json(response, 200, { contract: 'dpp-validator/1', capabilities: CAPABILITIES, result: { ok: false, reason: 'pass', detail: 'x' } }), /without a reason the contract names/],
    ['a member name written twice', (response: ServerResponse) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"contract":"dpp-validator/1","capabilities":[],"result":{"ok":false,"ok":true,"nquads":""}}') }, /appears twice/],
    ['bytes that are not UTF-8', (response: ServerResponse) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(Buffer.from([0x7b, 0xff, 0x7d])) }, /not UTF-8/],
  ] as const)('an answer that is %s', async (_name, answer, detail) => {
    const service = await fake(honest({ '/expand': answer }))
    await expectUnknown({ url: service.url, token: TOKEN }, 'engine-error', detail)
  })

  it.each([
    ['findings that are not a list', { ok: true, findings: 'none' }, /without its findings/],
    ['a finding with a severity SHACL does not have', { ok: true, findings: [{ severity: 'Pass', constraint: 'X' }] }, /a finding the contract does not describe/],
    ['a finding with a member the contract does not name', { ok: true, findings: [{ severity: 'Warning', constraint: 'X', product }] }, /a finding the contract does not describe/],
    ['a finding whose message is not text', { ok: true, findings: [{ severity: 'Warning', constraint: 'X', message: 7 }] }, /a finding the contract does not describe/],
    ['an expansion where a validation was asked for', { ok: true, nquads: '' }, /without its findings/],
  ] as const)('a validation that answers %s', async (_name, result, detail) => {
    const service = await fake(honest({ '/validate': (response) => json(response, 200, { contract: 'dpp-validator/1', capabilities: CAPABILITIES, result }) }))
    await expectUnknown({ url: service.url }, 'engine-error', detail, 'shacl')
  })

  it('an answer larger than the limit, announced or not, is not read to its end', async () => {
    const big = JSON.stringify({ contract: 'dpp-validator/1', capabilities: CAPABILITIES, result: { ok: true, nquads: 'x'.repeat(200_000) } })
    const announced = await fake((_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(big)) }); response.end(big) })
    await expectUnknown({ url: announced.url, maxResponseBytes: 10_000 }, 'engine-error', /announced an answer of \d+ bytes and at most 10000 are read/)
    // Sent in pieces with no length, and without an end: only the limit stops the reading.
    const endless = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      const timer = setInterval(() => { if (response.destroyed) clearInterval(timer); else response.write('x'.repeat(4096)) }, 1)
    })
    await expectUnknown({ url: endless.url, maxResponseBytes: 10_000, timeoutMs: 5000 }, 'engine-error', /sent more than the 10000 bytes that are read/)
  })

  it('a request larger than the limit is not sent', async () => {
    const service = await fake(honest())
    await expectUnknown({ url: service.url, maxRequestBytes: 500 }, 'engine-error', /at most 500 are sent .* so it was not sent/)
    expect(service.requests).toEqual([])
  })

  it('a redirect is not followed, so neither the document nor the token reaches another address', async () => {
    const elsewhere = await fake(honest())
    for (const status of [301, 302, 307, 308]) {
      const service = await fake((_request, response) => { response.writeHead(status, { location: `${elsewhere.url}/expand` }); response.end() })
      await expectUnknown({ url: service.url, token: TOKEN }, 'engine-error', /answered with a redirect, which is not followed/)
      expect(service.requests.length).toBeGreaterThan(0)
    }
    // Even a redirect within the same service is refused: the configured address is the only one asked.
    const same = await fake((request, response) => { response.writeHead(307, { location: `${request.url}/` }); response.end() })
    await expectUnknown({ url: same.url, token: TOKEN }, 'engine-error', /redirect/)
    expect(same.requests.every((r) => r.url === '/expand')).toBe(true)
    expect(elsewhere.requests).toEqual([])
  })

  it('a service whose engine has fewer capabilities than the binding requires', async () => {
    const service = await fake(honest({}, { '/expand': ['shacl-core'], '/validate': ['shacl-core'] }))
    const client = createValidatorClient({ url: service.url })
    const result = await validateWith(client)
    expect(result).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
    expect(stepsOf(result).find((s) => s.step === 'shacl')?.messages?.[0]).toContain('shacl-sparql-constraints')
    // The product and its identity predicates were expanded. The missing capability prevents validation.
    expect(service.requests.map((r) => r.url)).toEqual(['/expand', '/expand'])
  })

  it('a service that named a capability when it expanded and answers the validation without it', async () => {
    // What a deployment gets when the service is replaced by a lesser engine between two calls.
    const service = await fake(honest({}, { '/validate': ['shacl-core'] }))
    const client = createValidatorClient({ url: service.url })
    const result = await validateWith(client)
    expect(result, JSON.stringify(result.detail)).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
    expect(stepsOf(result).find((s) => s.step === 'shacl')?.messages?.[0]).toMatch(/answered for an engine without shacl-sparql-constraints/)
    expect(JSON.parse(service.requests.find((request) => request.url === '/validate')!.body)).toMatchObject({ requires: CAPABILITIES })
    // And it now reports what that engine said, so the next payload is not sent for a validation it cannot have.
    expect(client.shacl.capabilities).toEqual(['shacl-core'])
  })

  it('a capability the contract does not name is not one the validator can rely on', async () => {
    const service = await fake(honest({}, { '/expand': ['shacl-core', 'shacl-everything'], '/validate': ['shacl-core', 'shacl-everything'] }))
    const client = createValidatorClient({ url: service.url })
    await client.jsonLd.toRdf({ document: product, contexts })
    expect(client.shacl.capabilities).toEqual(['shacl-core'])
  })

  it('a document that cannot be written as JSON', async () => {
    const service = await fake(honest())
    const circular: Record<string, unknown> = { '@context': CONTEXT }
    circular.self = circular
    expect(await createValidatorClient({ url: service.url }).jsonLd.toRdf({ document: circular, contexts })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('could not be written as JSON') })
    expect(service.requests).toEqual([])
  })
})

describe('createValidatorClient: the configuration', () => {
  it('opens no connection until an engine is asked', async () => {
    const service = await fake(honest())
    createValidatorClient({ url: service.url })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(service.requests).toEqual([])
  })

  it.each([
    ['not a URL', { url: 'validator' }, /not a URL/],
    ['another scheme', { url: 'file:///var/run/validator' }, /http: or https:/],
    ['a user name and a password in the address', { url: 'http://user:secret@validator:8090' }, /must not carry a user name or a password/],
    ['a query in the address', { url: 'http://validator:8090/?token=secret' }, /must not carry a query/],
    ['a token with a space', { url: 'http://validator:8090', token: 'two words' }, /visible ASCII/],
    ['a time limit of zero', { url: 'http://validator:8090', timeoutMs: 0 }, /timeoutMs/],
    ['a size limit that is not a number', { url: 'http://validator:8090', maxResponseBytes: Number.NaN }, /maxResponseBytes/],
  ] as const)('refuses %s, and repeats no secret in saying so', (_name, options, message) => {
    let thrown: unknown
    try { createValidatorClient(options as ValidatorClientOptions) } catch (cause) { thrown = cause }
    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).message).toMatch(message)
    expect((thrown as Error).message).not.toContain('secret')
  })

  it('takes the caller\'s fetch, and asks it for no redirect following', async () => {
    const calls: Array<{ url: string; redirect?: string }> = []
    const client = createValidatorClient({ url: 'https://validator.example', fetch: (async (url: string, init: RequestInit) => { calls.push({ url, redirect: init.redirect }); throw new Error('no network in this test') }) as typeof fetch })
    expect(await client.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: false, reason: 'engine-error' })
    expect(calls).toEqual([{ url: 'https://validator.example/expand', redirect: 'manual' }])
  })

  it('sends a request once more when the service closed the connection before answering, and only once more', async () => {
    const dropped = (): never => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }) }
    const service = await fake(honest())
    let calls = 0
    const once = createValidatorClient({ url: service.url, token: TOKEN, fetch: (async (url: string, init: RequestInit) => (++calls === 1 ? dropped() : fetch(url, init))) as typeof fetch })
    expect(await once.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(calls).toBe(2)
    calls = 0
    const always = createValidatorClient({ url: service.url, token: TOKEN, fetch: (async () => { calls++; return dropped() }) as typeof fetch })
    expect(await always.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('could not be reached: UND_ERR_SOCKET') })
    expect(calls).toBe(2)
  })
})

afterAll(() => { expect(servers).toEqual([]) })
