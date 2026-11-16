#!/usr/bin/env node
/**
 * A second validator service, written for the tests from the contract
 * (`contracts/validator.schema.json`) and from nothing else in this package: it
 * imports no module of `@bsv/dpp-profiles`, runs in a process of its own and
 * reaches the libraries by its own route. It exists to show that a client
 * pointed at another implementation of the contract gets the same decisions.
 *
 * It differs from the package's service on purpose:
 *
 *   - its own HTTP handling, body reading and digest check;
 *   - expansion in two calls, `expand` and then `toRDF` of the expanded
 *     form, where the adapter makes one;
 *   - one store built quad by quad for the data and background;
 *   - its own reading of the engine's results into findings;
 *   - no thread pool, queue or time limit.
 *
 * It is not a product: it has no limits worth the name and must not be run
 * outside a test. Started with no arguments it listens on a free port of the
 * loopback address and prints `{"port": <number>}` on one line.
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import jsonld from 'jsonld'
import n3 from 'n3'
import { Validator } from 'shacl-engine'
import { validations, targetResolvers } from 'shacl-engine/sparql.js'

const CONTRACT = 'dpp-validator/1'
const coreOnly = process.argv.includes('--core-only')
const capabilities = coreOnly ? ['shacl-core'] : ['shacl-core', 'shacl-sparql-constraints']
const FORMATS = { 'text/turtle': 'Turtle', 'application/n-triples': 'N-Triples', 'application/n-quads': 'N-Quads', 'application/trig': 'TriG' }
const SHACL = 'http://www.w3.org/ns/shacl#'

class Refusal extends Error {
  constructor(status, code, detail) { super(detail); this.status = status; this.code = code }
}

/** A file of the request, checked against the digest sent with it. */
function fileBytes(entry, label) {
  if (entry === null || typeof entry !== 'object' || typeof entry.content !== 'string' || typeof entry.sha256 !== 'string') throw new Refusal(400, 'request-invalid', `${label} is not a file entry`)
  const bytes = Buffer.from(entry.content, 'base64')
  if (bytes.toString('base64') !== entry.content) throw new Refusal(400, 'request-invalid', `${label} is not canonical base64`)
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Refusal(422, 'digest-mismatch', `${label} does not have the digest sent with it`)
  return bytes
}

async function expand(request) {
  if (!Array.isArray(request.contexts) || !('document' in request)) throw new Refusal(400, 'request-invalid', 'an expansion carries a document and contexts')
  const held = new Map()
  for (const [index, entry] of request.contexts.entries()) {
    const bytes = fileBytes(entry, `contexts[${index}]`)
    try { held.set(entry.uri, JSON.parse(bytes.toString('utf8'))) } catch { return { ok: false, reason: 'engine-error', detail: `the context ${entry.uri} is not JSON` } }
  }
  const unlisted = []
  const documentLoader = async (url) => {
    if (!held.has(url)) { unlisted.push(url); throw new Error(`not listed: ${url}`) }
    return { contextUrl: null, documentUrl: url, document: structuredClone(held.get(url)) }
  }
  try {
    const processor = jsonld()
    const expanded = await processor.expand(request.document, { safe: true, documentLoader })
    return { ok: true, nquads: await processor.toRDF(expanded, { format: 'application/n-quads', safe: true, documentLoader }) }
  } catch (cause) {
    if (unlisted.length > 0) return { ok: false, reason: 'context-not-listed', detail: `no context was sent for ${unlisted[0]}` }
    if (typeof cause?.name === 'string' && cause.name.startsWith('jsonld.')) return { ok: false, reason: 'document-invalid', detail: `the contexts do not define this document: ${cause.message}` }
    return { ok: false, reason: 'engine-error', detail: 'the engine failed' }
  }
}

const text = (term) => (term.termType === 'BlankNode' ? `_:${term.value}` : term.value)
const local = (iri) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1)

/** A result path as the contract writes it: the predicate alone for one plain step, SPARQL path syntax otherwise. */
function pathOf(steps) {
  const plain = steps.length === 1 && steps[0].quantifier === 'one' && steps[0].start === 'subject' && steps[0].predicates.length === 1
  if (plain) return steps[0].predicates[0].value
  const marks = { one: '', oneOrMore: '+', zeroOrMore: '*', zeroOrOne: '?' }
  return steps.map((s) => `${s.start === 'object' ? '^' : ''}${s.predicates.map((p) => `<${p.value}>`).join('|')}${marks[s.quantifier] ?? ''}`).join('/')
}

async function validate(request) {
  if (typeof request.nquads !== 'string' || !Array.isArray(request.shapes) || !Array.isArray(request.background)) throw new Refusal(400, 'request-invalid', 'a validation carries nquads, shapes and background')
  const lacking = (request.requires ?? []).filter((c) => !capabilities.includes(c))
  if (lacking.length > 0) throw new Refusal(422, 'capability-unavailable', `this engine lacks ${lacking.join(', ')}`)
  const quadsOf = (list, name) => list.flatMap((entry, index) => {
    const bytes = fileBytes(entry, `${name}[${index}]`)
    const format = FORMATS[entry.mediaType]
    if (format == null) throw new Error(`${entry.path} has media type ${entry.mediaType}, which is not read`)
    return new n3.Parser({ format }).parse(bytes.toString('utf8'))
  })
  const shapes = new n3.Store()
  const data = new n3.Store()
  try {
    for (const quad of quadsOf(request.shapes, 'shapes')) shapes.addQuad(quad)
    for (const quad of quadsOf(request.background, 'background')) data.addQuad(quad)
    for (const quad of new n3.Parser({ format: 'N-Quads' }).parse(request.nquads)) data.addQuad(quad)
    const factory = { ...n3.DataFactory, dataset: (quads) => new n3.Store(quads) }
    const validator = new Validator(shapes, coreOnly ? { factory } : { factory, validations, targetResolvers })
    const report = await validator.validate({ dataset: data })
    const findings = []
    for (const result of report.results) {
      const severity = result.severity?.value ?? ''
      if (!severity.startsWith(SHACL) || !['Violation', 'Warning', 'Info'].includes(local(severity))) continue
      const finding = { severity: local(severity), constraint: local(result.constraintComponent.value) }
      if (result.focusNode?.term != null) finding.focusNode = text(result.focusNode.term)
      if (result.path != null && result.path.length > 0) finding.path = pathOf(result.path)
      if (result.message?.[0]?.value != null) finding.message = result.message[0].value
      if (result.value?.term != null) finding.value = text(result.value.term)
      findings.push(finding)
    }
    return { ok: true, findings }
  } catch (cause) {
    if (cause instanceof Refusal) throw cause
    return { ok: false, reason: 'engine-error', detail: 'the engine failed' }
  }
}

const server = createServer(async (request, response) => {
  const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
  try {
    const path = request.url.split('?')[0]
    if (request.method === 'GET' && path === '/health') return send(200, { contract: CONTRACT, ok: true })
    if (request.method === 'GET' && path === '/capabilities') {
      return send(200, { contract: CONTRACT, engine: { name: 'stand-in-validator', version: '0', libraries: {} }, capabilities, mediaTypes: Object.keys(FORMATS), limits: { maxRequestBytes: 0, timeoutMs: 0, concurrency: 0, queueLimit: 0 } })
    }
    if (request.method !== 'POST' || (path !== '/expand' && path !== '/validate')) return send(404, { contract: CONTRACT, error: { code: 'not-found', detail: 'no such route' } })
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Refusal(400, 'request-invalid', 'the body is not JSON') }
    send(200, { contract: CONTRACT, capabilities, result: path === '/expand' ? await expand(body) : await validate(body) })
  } catch (cause) {
    if (cause instanceof Refusal) send(cause.status, { contract: CONTRACT, error: { code: cause.code, detail: cause.message } })
    else send(500, { contract: CONTRACT, error: { code: 'engine-unavailable', detail: 'the stand-in failed' } })
  }
})
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
