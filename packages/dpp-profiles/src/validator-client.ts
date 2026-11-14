/**
 * `@bsv/dpp-profiles/validator-client`: the JSON-LD and SHACL engines
 * `bindingPayloadValidator` takes, answered by a validator service over the
 * `dpp-validator/1` contract (`contracts/validator.schema.json`) in place of
 * libraries in this process.
 *
 * `createValidatorClient({ url })` returns `{ jsonLd, shacl }` in the shape
 * `createValidationEngine()` returns them, so an application chooses between
 * the two by configuration and changes nothing else. The service is an
 * engine and no more: the registry, the binding digest, the access split and
 * the passport identity check all stay in the application's process, and the
 * service is sent only the product document and the binding's rule files.
 *
 * The one rule this module exists to keep: nothing that goes wrong between
 * here and the service can read as a pass. A service that is stopped, slow,
 * redirecting, answering an error, answering something other than the
 * contract, answering more than the limit, or answering for an engine with
 * fewer capabilities than the caller was told, gives `timeout` or
 * `engine-error`, which the validator reports as `unknown`.
 *
 * Four more promises, each tested:
 *
 *   - no redirect is followed, so no request and no token reaches an address
 *     other than the one configured;
 *   - a request larger than the limit is not sent, and an answer larger than
 *     the limit is not read to its end;
 *   - one exchange never outlasts the time limit;
 *   - the token and the document appear in no error text.
 *
 * Creating a client opens no connection. Importing this module loads nothing
 * beyond the package's own code.
 */
import type { JsonLdEngine, JsonLdExpansion, ShaclEngine, ShaclValidation } from './binding-validator.js'
import type { EngineCapability } from './profile-binding.js'
import { VALIDATOR_DEFAULTS, VALIDATOR_PATHS, expandRequestText, readCapabilitiesAnswer, readExpandAnswer, readRefusalCode, readValidateAnswer, validateRequestText, type ValidatorCapabilities } from './validator-wire.js'

export { VALIDATOR_CONTRACT } from './validator-wire.js'
export type { ValidatorCapabilities } from './validator-wire.js'

export interface ValidatorClientOptions {
  /** Where the service answers: an `http:` or `https:` address, with a path prefix if it sits behind one. It carries no user name, password, query or fragment. */
  url: string | URL
  /** The bearer token the service requires, where it requires one. It is sent to the configured address only. */
  token?: string
  /** How long one exchange may take, in milliseconds, from the request to the last byte of the answer. Default 15 000. */
  timeoutMs?: number
  /** The largest request body sent, in bytes. A larger one is not sent. Default 8 MiB. */
  maxRequestBytes?: number
  /** The largest answer read, in bytes. Default 8 MiB. */
  maxResponseBytes?: number
  /** The `fetch` to call. Default: the runtime's. A caller that needs a client certificate or a private certificate authority passes one that carries it. */
  fetch?: typeof fetch
}

export type ValidatorProbe = { ok: true; service: ValidatorCapabilities } | { ok: false; detail: string }

export interface ValidatorClient {
  jsonLd: JsonLdEngine
  /** `capabilities` is what the service last said its engine can check. It is empty until the service has answered once. */
  shacl: ShaclEngine
  /** Asks the service what it is, and remembers the capabilities it names. A deployment calls it at start to say in its log which engine it reached. It never throws. */
  probe(): Promise<ValidatorProbe>
}

type Exchange = { status: number; text: string } | { failed: 'timeout' | 'engine-error'; detail: string }

const reasonOf = (cause: unknown): string => {
  const inner = (cause as { cause?: { code?: unknown; message?: unknown } } | undefined)?.cause
  if (typeof inner?.code === 'string') return inner.code
  if (typeof inner?.message === 'string') return inner.message
  return cause instanceof Error ? cause.message : String(cause)
}

const limitOf = (value: number | undefined, fallback: number, name: string): number => {
  const limit = value ?? fallback
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) throw new TypeError(`${name} must be a number above zero`)
  return limit
}

/**
 * The engines, answered by the service at `url`. Throws `TypeError` for an
 * address or a limit that cannot be used, since that is a mistake in the
 * configuration and not something a service did. Nothing else throws: every
 * later failure is an answer the validator reports as `unknown`.
 */
export function createValidatorClient(options: ValidatorClientOptions): ValidatorClient {
  let base: URL
  try {
    base = new URL(String(options.url))
  } catch {
    throw new TypeError('The validator service address is not a URL')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new TypeError('The validator service address must begin http: or https:')
  // Credentials in an address end up in logs and error text. The token is the one credential, and it travels in a header.
  if (base.username !== '' || base.password !== '') throw new TypeError('The validator service address must not carry a user name or a password; pass the token as `token`')
  if (base.search !== '' || base.hash !== '') throw new TypeError('The validator service address must not carry a query or a fragment')
  const token = options.token
  if (token != null && !/^[\x21-\x7e]+$/.test(token)) throw new TypeError('The validator service token must be visible ASCII with no spaces')
  const timeoutMs = limitOf(options.timeoutMs, VALIDATOR_DEFAULTS.clientTimeoutMs, 'timeoutMs')
  const maxRequestBytes = limitOf(options.maxRequestBytes, VALIDATOR_DEFAULTS.maxRequestBytes, 'maxRequestBytes')
  const maxResponseBytes = limitOf(options.maxResponseBytes, VALIDATOR_DEFAULTS.maxResponseBytes, 'maxResponseBytes')
  const send = options.fetch ?? globalThis.fetch
  if (typeof send !== 'function') throw new TypeError('No fetch is available; pass one as `fetch`')

  const prefix = base.pathname.replace(/\/+$/, '')
  const addressOf = (path: string): string => `${base.origin}${prefix}${path}`
  /** The service named in a sentence: its origin and prefix, which carry no secret. */
  const service = `the validator service at ${base.origin}${prefix}`

  /** What the service last said its engine can check. Nothing is assumed before it has said so. */
  let known: EngineCapability[] = []

  /** One request and its whole answer, inside the time limit and the size limits. It never throws. */
  const exchange = async (method: 'GET' | 'POST', path: string, body?: string): Promise<Exchange> => {
    if (body != null) {
      const size = Buffer.byteLength(body, 'utf8')
      if (size > maxRequestBytes) return { failed: 'engine-error', detail: `the request is ${size} bytes and at most ${maxRequestBytes} are sent to ${service}, so it was not sent` }
    }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const response = await send(addressOf(path), {
        method,
        // A redirect is an answer from somewhere that is not the configured service. It is refused, not followed, so neither the document nor the token goes anywhere else.
        redirect: 'manual',
        headers: { accept: 'application/json', ...(body == null ? {} : { 'content-type': 'application/json' }), ...(token == null ? {} : { authorization: `Bearer ${token}` }) },
        ...(body == null ? {} : { body }),
        signal: controller.signal,
      })
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel().catch(() => undefined)
        return { failed: 'engine-error', detail: `${service} answered with a redirect, which is not followed` }
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        await response.body?.cancel().catch(() => undefined)
        return { failed: 'engine-error', detail: `${service} announced an answer of ${declared} bytes and at most ${maxResponseBytes} are read` }
      }
      // Read by hand, so an answer with no declared length is still cut off at the limit.
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = response.body?.getReader()
      if (reader != null) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxResponseBytes) {
            await reader.cancel().catch(() => undefined)
            return { failed: 'engine-error', detail: `${service} sent more than the ${maxResponseBytes} bytes that are read` }
          }
          chunks.push(value)
        }
      }
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      } catch {
        return { failed: 'engine-error', detail: `${service} sent an answer that is not UTF-8` }
      }
      if (response.status === 200 && !/^application\/json\s*(;|$)/i.test(response.headers.get('content-type') ?? '')) return { failed: 'engine-error', detail: `${service} answered 200 with something that is not declared as JSON` }
      return { status: response.status, text }
    } catch (cause) {
      if (timedOut) return { failed: 'timeout', detail: `${service} did not answer within ${timeoutMs} ms` }
      return { failed: 'engine-error', detail: `${service} could not be reached: ${reasonOf(cause)}` }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Why an answer that is not 200 cannot be used. Only the code is repeated, and only when the body is a refusal: the rest of the body is the service's text, and stays there. */
  const refused = (reply: { status: number; text: string }): string => {
    const code = readRefusalCode(reply.text)
    return `${service} answered ${reply.status}${code != null && /^[a-z-]{1,40}$/.test(code) ? ` (${code})` : ''}`
  }

  const toRdf: JsonLdEngine['toRdf'] = async (input): Promise<JsonLdExpansion> => {
    let body: string
    try {
      body = expandRequestText(input)
    } catch (cause) {
      return { ok: false, reason: 'engine-error', detail: `the document could not be written as JSON: ${reasonOf(cause)}` }
    }
    const reply = await exchange('POST', VALIDATOR_PATHS.expand, body)
    if ('failed' in reply) return { ok: false, reason: reply.failed, detail: reply.detail }
    if (reply.status !== 200) return { ok: false, reason: 'engine-error', detail: refused(reply) }
    const answer = readExpandAnswer(reply.text)
    if ('problem' in answer) return { ok: false, reason: 'engine-error', detail: `${service} did not answer as the contract describes: ${answer.problem}` }
    known = answer.capabilities
    return answer.result
  }

  const validate: ShaclEngine['validate'] = async (input): Promise<ShaclValidation> => {
    // What the caller was told this engine can check, and so what it decided to ask on the strength of.
    const told = [...known]
    const reply = await exchange('POST', VALIDATOR_PATHS.validate, validateRequestText(input, told))
    if ('failed' in reply) return { ok: false, reason: reply.failed, detail: reply.detail }
    if (reply.status !== 200) return { ok: false, reason: 'engine-error', detail: refused(reply) }
    const answer = readValidateAnswer(reply.text)
    if ('problem' in answer) return { ok: false, reason: 'engine-error', detail: `${service} did not answer as the contract describes: ${answer.problem}` }
    known = answer.capabilities
    // The engine that answered must be able to check everything the caller was told. One that cannot would have
    // reported nothing for the constraints it does not evaluate, and that silence would read as a pass.
    const lacking = told.filter((capability) => !answer.capabilities.includes(capability))
    if (lacking.length > 0) return { ok: false, reason: 'engine-error', detail: `${service} answered for an engine without ${lacking.join(', ')}, which this validation was asked for` }
    return answer.result
  }

  const probe = async (): Promise<ValidatorProbe> => {
    const reply = await exchange('GET', VALIDATOR_PATHS.capabilities)
    if ('failed' in reply) return { ok: false, detail: reply.detail }
    if (reply.status !== 200) return { ok: false, detail: refused(reply) }
    const answer = readCapabilitiesAnswer(reply.text)
    if ('problem' in answer) return { ok: false, detail: `${service} did not answer as the contract describes: ${answer.problem}` }
    known = answer.capabilities
    return { ok: true, service: answer }
  }

  return {
    jsonLd: { toRdf },
    shacl: {
      // Read each time it is asked for, so the validator sees what the service said in its latest answer.
      get capabilities(): readonly EngineCapability[] { return [...known] },
      validate,
    },
    probe,
  }
}
