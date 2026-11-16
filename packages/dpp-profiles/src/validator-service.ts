/**
 * `@bsv/dpp-profiles/validator-service`: the validation engine behind a
 * network call, under the `dpp-validator/1` contract
 * (`contracts/validator.schema.json`, `spec/services.md` §7).
 *
 * The service is an engine and nothing more. It answers two operations, the
 * two the engine adapter has: `POST /expand` turns a JSON-LD document into
 * RDF with the contexts the request carries, and `POST /validate` checks RDF
 * against the shapes and background files the request carries. It holds no
 * profile, no binding, no registry and no list of anything it trusts, and it
 * decides nothing about a passport: those stay with the application that
 * calls it. Every file arrives in the request beside its SHA-256, and the
 * service holds the bytes to that digest before the engine sees them.
 *
 * What it keeps, each tested:
 *
 *   - it fetches nothing. A context the request did not carry is refused,
 *     as the adapter refuses it in a process of its own, and the service
 *     makes no outbound request of any kind;
 *   - it is bounded. A body over the limit is refused before it is read to
 *     its end; a fixed number of operations run at once; a fixed number more
 *     wait, and the next is refused as `busy`;
 *   - an operation that passes the time limit is stopped, not only
 *     abandoned. The engine runs in threads of its own, and the service
 *     terminates the thread that ran over and starts another. The caller is
 *     answered `timeout`, which a validator reports as `unknown`;
 *   - it logs no content: one entry per request, with the route, the
 *     status, the sizes and the time taken.
 *
 * Importing this module starts nothing and loads no library. A service
 * exists only once `startValidatorService` has been called. The `dpp-validator`
 * command calls it, and so may an application that wants the service in its
 * own process tree.
 *
 * A caller with another engine passes it as `engines`. The service then
 * serves that engine over the same contract, on its own thread: the time
 * limit still answers `timeout` at the limit and never uses a late result,
 * but the service cannot stop work it does not own, so that work holds its
 * place among the running operations until it ends.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Worker } from 'node:worker_threads'
import type { JsonLdEngine, JsonLdExpansion, ShaclEngine, ShaclValidation } from './binding-validator.js'
import type { EngineCapability } from './profile-binding.js'
import { VALIDATOR_CONTRACT, VALIDATOR_DEFAULTS, VALIDATOR_PATHS, readExpandRequest, readValidateRequest, type ValidatorCapabilities, type ValidatorRefusalCode } from './validator-wire.js'
import type { WorkerMessage, WorkerRequest, WorkerSettings } from './validator-worker.js'

export { VALIDATOR_CONTRACT, VALIDATOR_DEFAULTS } from './validator-wire.js'
export type { ValidatorCapabilities, ValidatorRefusalCode } from './validator-wire.js'

/** One line of the service's log. It names no document, no file and no finding. */
export interface ValidatorLogEntry {
  /** `expand`, `validate`, `health`, `capabilities`, or `other` for any address the contract does not name. */
  route: 'expand' | 'validate' | 'health' | 'capabilities' | 'other'
  method: string
  status: number
  /** `ok`, the engine's reason when the operation did not finish, or the refusal code. */
  outcome: string
  requestBytes: number
  responseBytes: number
  durationMs: number
}

export interface ValidatorServiceOptions {
  /** The address to listen on. Default `127.0.0.1`, so a service started without thought is reachable from its own machine only. */
  host?: string
  /** The port to listen on. Default 0: any free port, which the returned service names. */
  port?: number
  /** A bearer token the two operations then require. Without one they are open to whoever can reach the port. */
  token?: string
  /** The largest request body read, in bytes. Default 8 MiB. */
  maxRequestBytes?: number
  /** How long one operation may run, in milliseconds, and how long a request may wait for its turn. Default 10 000. */
  timeoutMs?: number
  /** How many operations run at once: the number of engine threads. Default 2. */
  concurrency?: number
  /** How many requests may wait beyond those running. Default 16. */
  queueLimit?: number
  /** The memory one engine thread may use for its heap, in mebibytes. A thread that passes it is stopped. Default 512. */
  maxWorkerMemoryMb?: number
  /** False runs the engine without the SPARQL plug-in. It then declares `shacl-core` only. Default true. */
  sparql?: boolean
  /**
   * Another engine to serve in place of this package's. It runs on the
   * service's own thread and is asked as it would be in an application.
   * `engine` describes it in the capability document.
   */
  engines?: { jsonLd: JsonLdEngine; shacl: ShaclEngine }
  engine?: { name: string; version: string; libraries?: Record<string, string> }
  /** Called once per request, after the answer. Default: nothing is logged. */
  log?: (entry: ValidatorLogEntry) => void
}

export interface ValidatorService {
  /** Where the service answers, such as `http://127.0.0.1:8090`. */
  url: string
  host: string
  port: number
  /** What `GET /capabilities` answers. */
  capabilities: ValidatorCapabilities
  /** Stops listening, refuses what is waiting, stops the engine threads and resolves once the port is free. */
  close(): Promise<void>
}

type Operation = 'expand' | 'validate'
type EngineInput = WorkerRequest['input']
type EngineResult = JsonLdExpansion | ShaclValidation
/** What became of one operation: the engine's result, or the reason the service has none. */
type Outcome = { result: EngineResult } | { refusal: ValidatorRefusalCode; status: number; detail: string }

/** One place an operation can run. */
interface Slot {
  /** Free to take an operation now. */
  idle(): boolean
  /** Able to take one now or once its current work ends. A slot whose engine did not load is not. */
  usable(): boolean
  /** True when `stop` ends the work itself, and not only the wait for it. */
  readonly stopsWork: boolean
  /** Runs one operation. `done` never rejects. `stop` answers the operation with `result` and ends its work where the slot can; once the operation has ended it does nothing, so it can never reach the next one. */
  run(operation: Operation, input: EngineInput): { done: Promise<EngineResult>; stop(result: EngineResult): void }
  close(): Promise<void>
}

/** How much of an oversized body is discarded, unread, while its sender reads the refusal. */
const DISCARD_BYTES = 1024 * 1024
const MEDIA_TYPES = ['text/turtle', 'application/n-triples', 'application/n-quads', 'application/trig']
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const numberOf = (value: number | undefined, fallback: number, name: string, minimum: number): number => {
  const chosen = value ?? fallback
  if (typeof chosen !== 'number' || !Number.isInteger(chosen) || chosen < minimum) throw new TypeError(`${name} must be a whole number, ${minimum} or more`)
  return chosen
}

/** This package's name and version, read from its manifest beside `dist/`. */
function ownPackage(): { name: string; version: string } {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name?: string; version?: string }
    if (typeof manifest.name === 'string' && typeof manifest.version === 'string') return { name: manifest.name, version: manifest.version }
  } catch { /* described as unknown below */ }
  return { name: '@bsv/dpp-profiles', version: 'unknown' }
}

/**
 * An engine thread, and its replacements. The thread is started at once and
 * again whenever it ends: after the service stopped it for running over, or
 * after it ended by itself, which a thread out of memory does.
 */
function workerSlot(settings: WorkerSettings, maxMemoryMb: number, onChange: () => void): Slot & { ready: Promise<{ capabilities: string[]; libraries: Record<string, string> }> } {
  let worker: Worker | undefined
  let state: 'starting' | 'idle' | 'busy' | 'failed' | 'closed' = 'starting'
  let current: { id: number; finish: (result: EngineResult) => void } | undefined
  let nextId = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let announce: { resolve: (value: { capabilities: string[]; libraries: Record<string, string> }) => void; reject: (cause: Error) => void } | undefined
  const ready = new Promise<{ capabilities: string[]; libraries: Record<string, string> }>((resolve, reject) => { announce = { resolve, reject } })
  // A slot whose first start fails rejects `ready`. Later failures have nobody waiting on it.
  ready.catch(() => undefined)

  const finish = (result: EngineResult): void => {
    const job = current
    current = undefined
    job?.finish(result)
  }

  const start = (): void => {
    if (state === 'closed') return
    state = 'starting'
    const thread = new Worker(new URL('./validator-worker.js', import.meta.url), { workerData: settings, resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb } })
    worker = thread
    let loaded = false
    thread.on('message', (message: WorkerMessage) => {
      if (worker !== thread) return
      if (message.type === 'ready') {
        loaded = true
        state = 'idle'
        announce?.resolve({ capabilities: message.capabilities, libraries: message.libraries })
        onChange()
      } else if (message.type === 'failed') {
        // The engine did not load: a library is missing. The thread is ended, and `exit` below decides when to try again.
        state = 'failed'
        announce?.reject(new Error(message.detail))
        void thread.terminate()
      } else if (current != null && message.id === current.id) {
        state = 'idle'
        finish(message.result)
        onChange()
      }
    })
    // An error ends the thread, and `exit` follows it. The reason is kept for the operation that was running.
    let ended = 'the engine thread ended'
    thread.on('error', (cause) => { ended = `the engine thread stopped: ${reasonOf(cause)}` })
    thread.on('exit', () => {
      if (worker !== thread) return
      worker = undefined
      finish({ ok: false, reason: 'engine-error', detail: ended })
      if (state === 'closed') return
      if (loaded) { start(); return }
      // It never loaded. Trying again at once would spin, so the next attempt waits.
      state = 'failed'
      announce?.reject(new Error(ended))
      retry = setTimeout(start, 1000)
      retry.unref()
      onChange()
    })
  }
  start()

  return {
    ready,
    stopsWork: true,
    idle: () => state === 'idle',
    usable: () => state === 'idle' || state === 'busy' || state === 'starting',
    run: (operation, input) => {
      const id = nextId++
      const done = new Promise<EngineResult>((resolve) => { current = { id, finish: resolve } })
      state = 'busy'
      worker!.postMessage({ id, operation, input } as WorkerRequest)
      return {
        done,
        stop: (result) => {
          const thread = worker
          if (thread == null || current?.id !== id) return
          // Answer first, then end the thread. The replacement starts now, so the slot is back as soon as its engine has loaded.
          worker = undefined
          finish(result)
          void thread.terminate()
          start()
          onChange()
        },
      }
    },
    close: async () => {
      state = 'closed'
      clearTimeout(retry)
      const thread = worker
      worker = undefined
      finish({ ok: false, reason: 'engine-error', detail: 'the validator service is stopping' })
      await thread?.terminate()
    },
  }
}

/** A place on the service's own thread, for an engine the caller supplied. Its work cannot be stopped, so the place stays taken until the work ends. */
function suppliedSlot(engines: { jsonLd: JsonLdEngine; shacl: ShaclEngine }, onChange: () => void): Slot {
  let busy = false
  let current: ((result: EngineResult) => void) | undefined
  return {
    stopsWork: false,
    idle: () => !busy,
    usable: () => true,
    run: (operation, input) => {
      busy = true
      let settle!: (result: EngineResult) => void
      const done = new Promise<EngineResult>((resolve) => { settle = resolve })
      current = settle
      // The first answer is the one the caller gets. A result that arrives after the operation was stopped is dropped here.
      const answer = (result: EngineResult): void => { if (current === settle) { current = undefined; settle(result) } }
      const work = (async (): Promise<EngineResult> => (operation === 'expand' ? engines.jsonLd.toRdf(input as Parameters<JsonLdEngine['toRdf']>[0]) : engines.shacl.validate(input as Parameters<ShaclEngine['validate']>[0])))()
      // The place is free only when the work itself has ended, whether or not anybody still waits for it.
      const ended = (result: EngineResult): void => { answer(result); busy = false; onChange() }
      work.then(ended, (cause) => ended({ ok: false, reason: 'engine-error', detail: reasonOf(cause) }))
      return { done, stop: answer }
    },
    close: async () => { current?.({ ok: false, reason: 'engine-error', detail: 'the validator service is stopping' }); current = undefined },
  }
}

/**
 * Starts a validator service and resolves once it is listening and its
 * engine has loaded. Rejects when the engine cannot load, naming the reason,
 * or when the port cannot be bound: a service that could not validate does
 * not start.
 */
export async function startValidatorService(options: ValidatorServiceOptions = {}): Promise<ValidatorService> {
  const host = options.host ?? '127.0.0.1'
  const port = numberOf(options.port, 0, 'port', 0)
  const maxRequestBytes = numberOf(options.maxRequestBytes, VALIDATOR_DEFAULTS.maxRequestBytes, 'maxRequestBytes', 1)
  const timeoutMs = numberOf(options.timeoutMs, VALIDATOR_DEFAULTS.serviceTimeoutMs, 'timeoutMs', 1)
  const concurrency = numberOf(options.concurrency, VALIDATOR_DEFAULTS.concurrency, 'concurrency', 1)
  const queueLimit = numberOf(options.queueLimit, VALIDATOR_DEFAULTS.queueLimit, 'queueLimit', 0)
  const maxWorkerMemoryMb = numberOf(options.maxWorkerMemoryMb, 512, 'maxWorkerMemoryMb', 64)
  const token = options.token
  if (token != null && !/^[\x21-\x7e]+$/.test(token)) throw new TypeError('token must be visible ASCII with no spaces')
  const expected = token == null ? undefined : createHash('sha256').update(token).digest()
  const log = options.log

  // The slots, and the requests waiting for one.
  interface Waiting { operation: Operation; input: EngineInput; settle: (outcome: Outcome) => void; expires: ReturnType<typeof setTimeout>; stop?: (result: EngineResult) => void; limit?: ReturnType<typeof setTimeout> }
  const waiting: Waiting[] = []
  let slots: Slot[] = []
  let closing = false
  const pump = (): void => {
    for (;;) {
      const slot = slots.find((s) => s.idle())
      const next = waiting[0]
      if (slot == null || next == null) return
      waiting.shift()
      clearTimeout(next.expires)
      const running = slot.run(next.operation, next.input)
      next.stop = running.stop
      // The time limit of the operation itself. A slot that owns its work ends it; any slot answers now and never uses what arrives later.
      next.limit = setTimeout(() => running.stop({ ok: false, reason: 'timeout', detail: `the operation did not finish within ${timeoutMs} ms${slot.stopsWork ? ' and was stopped' : ', and its result will not be used'}` }), timeoutMs)
      void running.done.then((result) => { clearTimeout(next.limit); next.settle({ result }) })
    }
  }

  let capabilities: EngineCapability[]
  let engine: ValidatorCapabilities['engine']
  if (options.engines != null) {
    const supplied = options.engines
    slots = Array.from({ length: concurrency }, () => suppliedSlot(supplied, () => pump()))
    capabilities = [...supplied.shacl.capabilities]
    engine = { name: options.engine?.name ?? 'supplied-engine', version: options.engine?.version ?? 'unknown', libraries: { ...(options.engine?.libraries ?? {}) } }
  } else {
    // The adapter's own limit only discards a late result. It is set beyond the service's, which stops the thread, so it never answers first.
    const settings: WorkerSettings = { timeoutMs: Math.min(2 * timeoutMs + 1000, 2 ** 31 - 1), sparql: options.sparql ?? true }
    const threads = Array.from({ length: concurrency }, () => workerSlot(settings, maxWorkerMemoryMb, () => pump()))
    slots = threads
    try {
      const loaded = await Promise.all(threads.map((t) => t.ready))
      capabilities = loaded[0]!.capabilities as EngineCapability[]
      const own = ownPackage()
      engine = { name: `${own.name}/validation-engine`, version: own.version, libraries: loaded[0]!.libraries }
    } catch (cause) {
      await Promise.all(threads.map((t) => t.close()))
      throw new Error(`The validation engine did not load, so the validator service did not start: ${reasonOf(cause)}`)
    }
  }
  const document: ValidatorCapabilities = { contract: VALIDATOR_CONTRACT, engine, capabilities, mediaTypes: [...MEDIA_TYPES], limits: { maxRequestBytes, timeoutMs, concurrency, queueLimit } }

  /** Queues one operation and resolves with what became of it. `cancel` withdraws it: from the queue, or from the slot running it. */
  const submit = (operation: Operation, input: EngineInput): { outcome: Promise<Outcome>; cancel: () => void } => {
    if (closing) return { outcome: Promise.resolve({ refusal: 'engine-unavailable', status: 503, detail: 'the validator service is stopping' }), cancel: () => undefined }
    if (!slots.some((s) => s.usable())) return { outcome: Promise.resolve({ refusal: 'engine-unavailable', status: 503, detail: 'no engine is running' }), cancel: () => undefined }
    const queued = waiting.length
    if (!slots.some((s) => s.idle()) && queued >= queueLimit) return { outcome: Promise.resolve({ refusal: 'busy', status: 503, detail: `${concurrency} operations are running and ${queued} are waiting` }), cancel: () => undefined }
    let entry!: Waiting
    const outcome = new Promise<Outcome>((settle) => {
      entry = {
        operation, input, settle,
        // A request that waits a whole time limit for its turn is told the service is busy. It did not run, so it was not a timeout of the engine.
        expires: setTimeout(() => { waiting.splice(waiting.indexOf(entry), 1); settle({ refusal: 'busy', status: 503, detail: `no engine became free within ${timeoutMs} ms` }) }, timeoutMs),
      }
      waiting.push(entry)
    })
    pump()
    return {
      outcome,
      cancel: () => {
        clearTimeout(entry.expires)
        clearTimeout(entry.limit)
        const at = waiting.indexOf(entry)
        if (at !== -1) { waiting.splice(at, 1); entry.settle({ refusal: 'busy', status: 503, detail: 'the caller went away before the operation began' }) }
        // Nobody is waiting for the answer any more, so the work is ended where it can be.
        entry.stop?.({ ok: false, reason: 'engine-error', detail: 'the caller went away' })
      },
    }
  }

  const routeOf = (path: string): ValidatorLogEntry['route'] => (path === VALIDATOR_PATHS.expand ? 'expand' : path === VALIDATOR_PATHS.validate ? 'validate' : path === VALIDATOR_PATHS.health ? 'health' : path === VALIDATOR_PATHS.capabilities ? 'capabilities' : 'other')

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = performance.now()
    const path = (request.url ?? '').split('?')[0]!
    const route = routeOf(path)
    let requestBytes = 0
    const send = (status: number, body: unknown, outcome: string, headers: Record<string, string> = {}): void => {
      const text = JSON.stringify(body)
      const bytes = Buffer.byteLength(text, 'utf8')
      if (!response.destroyed && !response.headersSent) {
        response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(bytes), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
        response.end(text)
      }
      log?.({ route, method: request.method ?? '', status, outcome, requestBytes, responseBytes: bytes, durationMs: Math.round(performance.now() - started) })
    }
    const refuse = (status: number, code: ValidatorRefusalCode, detail: string, headers: Record<string, string> = {}): void => send(status, { contract: VALIDATOR_CONTRACT, error: { code, detail } }, code, headers)

    if (route === 'other') { request.resume(); return refuse(404, 'not-found', 'The contract names /health, /capabilities, /expand and /validate.') }
    if (route === 'health' || route === 'capabilities') {
      request.resume()
      if (request.method !== 'GET') return refuse(405, 'method-not-allowed', `${path} answers GET.`, { allow: 'GET' })
      if (route === 'capabilities') return send(200, document, 'ok')
      if (closing || !slots.some((s) => s.usable())) return refuse(503, 'engine-unavailable', 'No engine is running.')
      return send(200, { contract: VALIDATOR_CONTRACT, ok: true }, 'ok')
    }
    if (request.method !== 'POST') { request.resume(); return refuse(405, 'method-not-allowed', `${path} answers POST.`, { allow: 'POST' }) }
    if (expected != null) {
      const given = /^Bearer ([\x21-\x7e]+)$/.exec(request.headers.authorization ?? '')?.[1]
      // Compared as digests, so the comparison takes the same time whatever was sent.
      if (given == null || !timingSafeEqual(createHash('sha256').update(given).digest(), expected)) { request.resume(); return refuse(401, 'unauthorised', 'This service requires its bearer token.', { 'www-authenticate': 'Bearer' }) }
    }
    if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) { request.resume(); return refuse(415, 'unsupported-media-type', 'The body must be declared as application/json.') }
    // A refusal sent before the body has been read is written at once. A caller still sending would lose it if the connection
    // closed under its hands, so for a moment what arrives is discarded unread, and then the connection is closed. That
    // moment is one second or DISCARD_BYTES, whichever ends first.
    const refuseUnread = (status: number, code: ValidatorRefusalCode, detail: string, headers: Record<string, string> = {}): void => {
      let discarded = 0
      request.removeAllListeners('data')
      request.on('data', (chunk: Buffer) => { discarded += chunk.byteLength; if (discarded > DISCARD_BYTES) request.destroy() })
      request.resume()
      setTimeout(() => request.destroy(), 1000).unref()
      refuse(status, code, detail, { ...headers, connection: 'close' })
    }
    // With every place taken and the queue full the answer is already known, so the body is not read to find it out. The
    // same is decided again once the body has been read, because the queue may have filled meanwhile.
    if (!closing && slots.some((s) => s.usable()) && !slots.some((s) => s.idle()) && waiting.length >= queueLimit) return refuseUnread(503, 'busy', `${concurrency} operations are running and ${waiting.length} are waiting.`, { 'retry-after': '1' })
    const tooLarge = (): void => refuseUnread(413, 'request-too-large', `The body is larger than the ${maxRequestBytes} bytes this service reads.`)
    // Refused on the declared length where there is one, so an oversized body is not read at all.
    if (Number(request.headers['content-length']) > maxRequestBytes) return tooLarge()
    const body = await new Promise<Buffer | 'too-large' | 'gone'>((resolve) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => {
        requestBytes += chunk.byteLength
        if (requestBytes <= maxRequestBytes) { chunks.push(chunk); return }
        request.pause()
        request.removeAllListeners('data')
        resolve('too-large')
      })
      request.on('end', () => resolve(Buffer.concat(chunks)))
      request.on('error', () => resolve('gone'))
      request.on('close', () => resolve('gone'))
    })
    if (body === 'too-large') return tooLarge()
    // The caller went away before the body was whole. There is nobody to answer.
    if (body === 'gone') return
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      return refuse(400, 'request-invalid', 'The body is not UTF-8.')
    }
    const read = route === 'expand' ? readExpandRequest(text) : readValidateRequest(text)
    if (!read.ok) return refuse(read.status, read.code, `${read.detail}.`)
    if ('requires' in read) {
      const lacking = read.requires.filter((c) => !capabilities.includes(c))
      // Asked anyway, the engine would report nothing for the constraints it cannot evaluate.
      if (lacking.length > 0) return refuse(422, 'capability-unavailable', `This engine lacks a capability the request requires: ${lacking.join(', ')}.`)
    }
    const job = submit(route, read.input)
    let answered = false
    response.on('close', () => { if (!answered) job.cancel() })
    const outcome = await job.outcome
    answered = true
    if ('refusal' in outcome) return refuse(outcome.status, outcome.refusal, `${outcome.detail}.`, outcome.refusal === 'busy' ? { 'retry-after': '1' } : {})
    send(200, { contract: VALIDATOR_CONTRACT, capabilities, result: outcome.result }, outcome.result.ok ? 'ok' : outcome.result.reason)
  }

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      // Nothing above should throw. If something does, the caller is told the service failed and learns nothing else.
      if (!response.headersSent) { response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ contract: VALIDATOR_CONTRACT, error: { code: 'engine-unavailable', detail: 'The service failed.' } })) }
    })
  })
  // A caller that sends its headers or its body slowly holds a connection, not an engine thread, and not for long.
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 64
  // Beyond the operations that can run or wait, a few connections are left for /health and /capabilities.
  server.maxConnections = concurrency + queueLimit + 16

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => { server.off('error', reject); resolve() })
    })
  } catch (cause) {
    await Promise.all(slots.map((s) => s.close()))
    throw new Error(`The validator service could not listen on ${host}:${port}: ${reasonOf(cause)}`)
  }
  const address = server.address()
  const bound = typeof address === 'object' && address != null ? address.port : port

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${bound}`,
    host,
    port: bound,
    capabilities: document,
    close: async () => {
      closing = true
      for (const entry of waiting.splice(0)) { clearTimeout(entry.expires); entry.settle({ refusal: 'engine-unavailable', status: 503, detail: 'the validator service is stopping' }) }
      await Promise.all(slots.map((s) => s.close()))
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
    },
  }
}
