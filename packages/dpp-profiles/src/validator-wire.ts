/**
 * The wire contract of the validator service, `dpp-validator/1`
 * (`contracts/validator.schema.json`, `spec/services.md` §7), as the client and the
 * service of this package both read it: the names, the limits each side
 * starts from, and the strict reading of every body that crosses the wire.
 *
 * The contract carries the two engine operations and nothing else. A file is
 * sent whole, as base64, beside its SHA-256, and the receiver holds the bytes
 * to that digest. Neither side trusts a body because of who sent it: a member
 * the contract does not name, a wrong type or a digest that does not match is
 * a refusal, never a best effort.
 *
 * This module is not an entry point of the package. It loads no library.
 */
import { createHash } from 'node:crypto'
import type { EngineContext, EngineFile, EngineFinding, JsonLdExpansion, ShaclValidation } from './binding-validator.js'
import type { EngineCapability } from './profile-binding.js'
import { parseStrictJson } from './strict-json.js'

/** The contract both sides name in every answer. A client refuses an answer under any other. */
export const VALIDATOR_CONTRACT = 'dpp-validator/1'

export const VALIDATOR_PATHS = { health: '/health', capabilities: '/capabilities', expand: '/expand', validate: '/validate' } as const

/** What a service or a client is built with when the caller names nothing else. */
export const VALIDATOR_DEFAULTS = {
  /** The largest request body, in bytes: 8 MiB. */
  maxRequestBytes: 8 * 1024 * 1024,
  /** The largest answer a client reads, in bytes: 8 MiB. */
  maxResponseBytes: 8 * 1024 * 1024,
  /** How long the service lets one operation run, in milliseconds. */
  serviceTimeoutMs: 10_000,
  /** How long a client waits for one answer, in milliseconds. It is longer than the service's limit, so the service's own answer arrives first. */
  clientTimeoutMs: 15_000,
  /** How many operations the service runs at once. */
  concurrency: 2,
  /** How many more it holds waiting. */
  queueLimit: 16,
  /** The port the command listens on. */
  port: 8090,
} as const

/** The most files one request may carry in one list. */
export const MAX_FILES = 64

const CAPABILITIES: readonly EngineCapability[] = ['json-schema-2020-12', 'shacl-core', 'shacl-sparql-constraints']
const SEVERITIES: readonly string[] = ['Violation', 'Warning', 'Info']
const EXPANSION_REASONS: readonly string[] = ['context-not-listed', 'document-invalid', 'timeout', 'engine-error']
const VALIDATION_REASONS: readonly string[] = ['timeout', 'engine-error']
const SHA256 = /^[0-9a-f]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
/** The members of an object that the contract does not name there, as one sentence, or nothing. */
const extraMembers = (value: Json, allowed: readonly string[], where: string): string | undefined => {
  const extra = Object.keys(value).filter((name) => !allowed.includes(name))
  return extra.length === 0 ? undefined : `${where} has a member the contract does not name: ${extra.map((name) => JSON.stringify(name)).join(', ')}`
}

/** What the service says about itself at `GET /capabilities`. */
export interface ValidatorCapabilities {
  contract: typeof VALIDATOR_CONTRACT
  /** The engine behind the service: a name, a version and the libraries it runs, each with the version installed. */
  engine: { name: string; version: string; libraries: Record<string, string> }
  /** What the engine can check. A client reads this before it asks for a validation, as it would read an engine in its own process. */
  capabilities: EngineCapability[]
  /** The media types the engine reads shapes and background files in. */
  mediaTypes: string[]
  /** The limits this service runs under. */
  limits: { maxRequestBytes: number; timeoutMs: number; concurrency: number; queueLimit: number }
}

/** The body of a refusal: every answer that is not 200. */
export interface ValidatorRefusal {
  contract: typeof VALIDATOR_CONTRACT
  error: { code: ValidatorRefusalCode; detail: string }
}

export type ValidatorRefusalCode =
  /** The body is not the JSON the contract describes. */
  | 'request-invalid'
  /** The service requires a bearer token and the request carried none, or another. */
  | 'unauthorised'
  | 'not-found'
  | 'method-not-allowed'
  /** The body is larger than the service reads. */
  | 'request-too-large'
  /** The body is not declared as `application/json`. */
  | 'unsupported-media-type'
  /** A file's bytes do not have the SHA-256 sent beside them. */
  | 'digest-mismatch'
  /** The request requires a capability this engine does not have. */
  | 'capability-unavailable'
  /** Every worker is taken and the queue is full, or the request waited too long. */
  | 'busy'
  /** The engine did not load, or its worker stopped. */
  | 'engine-unavailable'

// ---------------------------------------------------------------------------
// Requests, as the client writes them and the service reads them.

/** The JSON text of an expansion request. */
export function expandRequestText(input: { document: unknown; contexts: readonly EngineContext[] }): string {
  return JSON.stringify({ document: input.document, contexts: input.contexts.map((c) => ({ uri: c.uri, sha256: sha256Hex(c.bytes), content: toBase64(c.bytes) })) })
}

/** The JSON text of a validation request. `requires` is what the client told its caller this engine can check. */
export function validateRequestText(input: { nquads: string; shapes: readonly EngineFile[]; background: readonly EngineFile[] }, requires: readonly EngineCapability[]): string {
  const files = (list: readonly EngineFile[]): unknown[] => list.map((f) => ({ path: f.path, mediaType: f.mediaType, sha256: sha256Hex(f.bytes), content: toBase64(f.bytes) }))
  return JSON.stringify({ nquads: input.nquads, shapes: files(input.shapes), background: files(input.background), requires })
}

/** A request the service did not accept, with the status it answers. */
export interface RequestRefusal { ok: false; status: 400 | 422; code: 'request-invalid' | 'digest-mismatch'; detail: string }

const invalid = (detail: string): RequestRefusal => ({ ok: false, status: 400, code: 'request-invalid', detail })

/** One file of a request: its bytes, held to the digest sent with them. `label` names it in a refusal and is never its content. */
function readContent(entry: Json, label: string): { bytes: Uint8Array } | RequestRefusal {
  if (!isText(entry.sha256) || !SHA256.test(entry.sha256)) return invalid(`${label}: sha256 must be 64 lower-case hexadecimal characters`)
  if (!isText(entry.content) || !BASE64.test(entry.content)) return invalid(`${label}: content must be base64 with padding`)
  const bytes = new Uint8Array(Buffer.from(entry.content, 'base64'))
  // The same bytes can be written as base64 in more than one way when the last group carries stray bits. One text per file, or two requests could differ and mean the same.
  if (toBase64(bytes) !== entry.content) return invalid(`${label}: content is not canonical base64`)
  const found = sha256Hex(bytes)
  if (found !== entry.sha256) return { ok: false, status: 422, code: 'digest-mismatch', detail: `${label}: the bytes sent have SHA-256 ${found}, not the ${entry.sha256} sent with them` }
  return { bytes }
}

function readList(value: unknown, name: string): Json[] | RequestRefusal {
  if (!Array.isArray(value)) return invalid(`${name} must be a list`)
  if (value.length > MAX_FILES) return invalid(`${name} lists ${value.length} files; at most ${MAX_FILES} are read`)
  for (const [index, entry] of value.entries()) if (!isObject(entry)) return invalid(`${name}[${index}] must be an object`)
  return value as Json[]
}

/** The body as one JSON object. It is returned under a name of its own, so no member a sender writes can be read as this module's refusal. */
function readBody(text: string): { body: Json } | RequestRefusal {
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return invalid(`the body is refused: ${parsed.detail}`)
  return isObject(parsed.value) ? { body: parsed.value } : invalid('the body must be one JSON object')
}

/** An expansion request read strictly: the engine's own input, or the refusal. */
export function readExpandRequest(text: string): { ok: true; input: { document: unknown; contexts: EngineContext[] } } | RequestRefusal {
  const read = readBody(text)
  if (!('body' in read)) return read
  const { body } = read
  const extra = extraMembers(body, ['document', 'contexts'], 'the request')
  if (extra != null) return invalid(extra)
  if (!Object.hasOwn(body, 'document')) return invalid('the request has no document')
  const list = readList(body.contexts, 'contexts')
  if (!Array.isArray(list)) return list
  const contexts: EngineContext[] = []
  for (const [index, entry] of list.entries()) {
    const extraHere = extraMembers(entry, ['uri', 'sha256', 'content'], `contexts[${index}]`)
    if (extraHere != null) return invalid(extraHere)
    if (!isText(entry.uri) || entry.uri === '') return invalid(`contexts[${index}]: uri must be text`)
    if (contexts.some((c) => c.uri === entry.uri)) return invalid(`contexts[${index}]: the URI ${entry.uri} is listed twice`)
    const content = readContent(entry, `contexts[${index}] (${entry.uri})`)
    if (!('bytes' in content)) return content
    contexts.push({ uri: entry.uri, bytes: content.bytes })
  }
  return { ok: true, input: { document: body.document, contexts } }
}

/** A validation request read strictly: the engine's own input and the capabilities the caller requires, or the refusal. */
export function readValidateRequest(text: string): { ok: true; input: { nquads: string; shapes: EngineFile[]; background: EngineFile[] }; requires: EngineCapability[] } | RequestRefusal {
  const body = readBody(text)
  if (!('body' in body)) return body
  const request = body.body
  const extra = extraMembers(request, ['nquads', 'shapes', 'background', 'requires'], 'the request')
  if (extra != null) return invalid(extra)
  if (!isText(request.nquads)) return invalid('nquads must be text')
  const files = (name: 'shapes' | 'background'): EngineFile[] | RequestRefusal => {
    const list = readList(request[name], name)
    if (!Array.isArray(list)) return list
    const held: EngineFile[] = []
    for (const [index, entry] of list.entries()) {
      const extraHere = extraMembers(entry, ['path', 'mediaType', 'sha256', 'content'], `${name}[${index}]`)
      if (extraHere != null) return invalid(extraHere)
      if (!isText(entry.path) || entry.path === '') return invalid(`${name}[${index}]: path must be text`)
      if (!isText(entry.mediaType) || entry.mediaType === '') return invalid(`${name}[${index}]: mediaType must be text`)
      const content = readContent(entry, `${name}[${index}] (${entry.path})`)
      if (!('bytes' in content)) return content
      held.push({ path: entry.path, mediaType: entry.mediaType, bytes: content.bytes })
    }
    return held
  }
  const shapes = files('shapes')
  if (!Array.isArray(shapes)) return shapes
  const background = files('background')
  if (!Array.isArray(background)) return background
  // An absent list requires nothing beyond what the operation is. A capability this contract does not name is refused, not ignored: ignoring it would be answering for a check nobody ran.
  const requires = request.requires ?? []
  if (!Array.isArray(requires) || !requires.every((c): c is EngineCapability => isText(c) && CAPABILITIES.includes(c as EngineCapability))) return invalid(`requires must list capabilities among ${CAPABILITIES.join(', ')}`)
  return { ok: true, input: { nquads: request.nquads, shapes, background }, requires: [...new Set(requires)] }
}

// ---------------------------------------------------------------------------
// Answers, as the service writes them and the client reads them.

/** The body of a 200 from `POST /expand` or `POST /validate`. */
export interface ValidatorAnswer<Result> {
  contract: typeof VALIDATOR_CONTRACT
  /** What the engine that produced this answer can check. */
  capabilities: EngineCapability[]
  result: Result
}

/** An answer that is not what the contract describes, as one sentence. */
export interface AnswerProblem { problem: string }

const readCapabilities = (value: unknown): EngineCapability[] | undefined =>
  Array.isArray(value) && value.every(isText) ? (value.filter((c) => CAPABILITIES.includes(c as EngineCapability)) as EngineCapability[]) : undefined

function readAnswer(text: string): { capabilities: EngineCapability[]; result: Json } | AnswerProblem {
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return { problem: `the answer is refused: ${parsed.detail}` }
  const body = parsed.value
  if (!isObject(body)) return { problem: 'the answer is not one JSON object' }
  if (body.contract !== VALIDATOR_CONTRACT) return { problem: `the answer names the contract ${JSON.stringify(body.contract)}, not ${VALIDATOR_CONTRACT}` }
  const capabilities = readCapabilities(body.capabilities)
  if (capabilities == null) return { problem: 'the answer does not list the engine\'s capabilities' }
  if (!isObject(body.result) || typeof body.result.ok !== 'boolean') return { problem: 'the answer carries no result' }
  return { capabilities, result: body.result }
}

const readFailure = <Reason extends string>(result: Json, reasons: readonly string[]): { ok: false; reason: Reason; detail: string } | AnswerProblem =>
  isText(result.reason) && reasons.includes(result.reason) && isText(result.detail) ? { ok: false, reason: result.reason as Reason, detail: result.detail } : { problem: 'the answer reports a failure without a reason the contract names' }

/** The answer to an expansion, read strictly. */
export function readExpandAnswer(text: string): { capabilities: EngineCapability[]; result: JsonLdExpansion } | AnswerProblem {
  const answer = readAnswer(text)
  if ('problem' in answer) return answer
  const { capabilities, result } = answer
  if (result.ok === false) {
    const failure = readFailure<Exclude<JsonLdExpansion, { ok: true }>['reason']>(result, EXPANSION_REASONS)
    return 'problem' in failure ? failure : { capabilities, result: failure }
  }
  return isText(result.nquads) ? { capabilities, result: { ok: true, nquads: result.nquads } } : { problem: 'the answer reports an expansion without its N-Quads' }
}

const FINDING_TEXT = ['focusNode', 'path', 'message', 'value'] as const

/** One finding, rebuilt member by member, so nothing the contract does not name reaches a report. */
function readFinding(value: unknown): EngineFinding | undefined {
  if (!isObject(value) || !isText(value.severity) || !SEVERITIES.includes(value.severity) || !isText(value.constraint)) return undefined
  if (Object.keys(value).some((name) => name !== 'severity' && name !== 'constraint' && !(FINDING_TEXT as readonly string[]).includes(name))) return undefined
  const finding: EngineFinding = { severity: value.severity as EngineFinding['severity'], constraint: value.constraint }
  for (const name of FINDING_TEXT) {
    if (!Object.hasOwn(value, name)) continue
    if (!isText(value[name])) return undefined
    finding[name] = value[name]
  }
  return finding
}

/** The answer to a validation, read strictly. One malformed finding spoils the answer: a report must not carry part of what the engine found. */
export function readValidateAnswer(text: string): { capabilities: EngineCapability[]; result: ShaclValidation } | AnswerProblem {
  const answer = readAnswer(text)
  if ('problem' in answer) return answer
  const { capabilities, result } = answer
  if (result.ok === false) {
    const failure = readFailure<Exclude<ShaclValidation, { ok: true }>['reason']>(result, VALIDATION_REASONS)
    return 'problem' in failure ? failure : { capabilities, result: failure }
  }
  if (!Array.isArray(result.findings)) return { problem: 'the answer reports a validation without its findings' }
  const findings = result.findings.map(readFinding)
  if (findings.some((f) => f == null)) return { problem: 'the answer carries a finding the contract does not describe' }
  return { capabilities, result: { ok: true, findings: findings as EngineFinding[] } }
}

/** The capability document, read strictly enough to rely on: the contract, the engine and the capabilities. */
export function readCapabilitiesAnswer(text: string): ValidatorCapabilities | AnswerProblem {
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return { problem: `the answer is refused: ${parsed.detail}` }
  const body = parsed.value
  if (!isObject(body)) return { problem: 'the answer is not one JSON object' }
  if (body.contract !== VALIDATOR_CONTRACT) return { problem: `the answer names the contract ${JSON.stringify(body.contract)}, not ${VALIDATOR_CONTRACT}` }
  const capabilities = readCapabilities(body.capabilities)
  if (capabilities == null) return { problem: 'the answer does not list the engine\'s capabilities' }
  const engine = body.engine
  if (!isObject(engine) || !isText(engine.name) || !isText(engine.version) || !isObject(engine.libraries) || !Object.values(engine.libraries).every(isText)) return { problem: 'the answer does not name its engine' }
  const limits = body.limits
  const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!isObject(limits) || !number(limits.maxRequestBytes) || !number(limits.timeoutMs) || !number(limits.concurrency) || !number(limits.queueLimit)) return { problem: 'the answer does not state its limits' }
  if (!Array.isArray(body.mediaTypes) || !body.mediaTypes.every(isText)) return { problem: 'the answer does not list its media types' }
  return {
    contract: VALIDATOR_CONTRACT,
    engine: { name: engine.name, version: engine.version, libraries: { ...(engine.libraries as Record<string, string>) } },
    capabilities,
    mediaTypes: [...(body.mediaTypes as string[])],
    limits: { maxRequestBytes: limits.maxRequestBytes, timeoutMs: limits.timeoutMs, concurrency: limits.concurrency, queueLimit: limits.queueLimit },
  }
}

/** The code of a refusal body, where the body is one. Used only to say why in a sentence. */
export function readRefusalCode(text: string): string | undefined {
  const parsed = parseStrictJson(text)
  if (!parsed.ok || !isObject(parsed.value) || !isObject(parsed.value.error)) return undefined
  return isText(parsed.value.error.code) ? parsed.value.error.code : undefined
}
