/**
 * `@bsv/dpp-profiles/validation-engine`: the JSON-LD and SHACL engines
 * `bindingPayloadValidator` takes, built over three libraries the caller
 * installs: `jsonld`, `n3` and `shacl-engine` with its SPARQL plug-in.
 *
 * This is a separate entry point on purpose. The package's main entry point
 * never imports it, and it loads the libraries only when
 * `createValidationEngine` is called. A service that reads token history and
 * validates nothing, such as the index, therefore neither installs nor loads
 * them, and a caller with another SHACL engine implements the two interfaces
 * itself and does not use this module at all.
 *
 * Three promises are kept here and tested:
 *
 *   - a context is used only if the call handed it over. Any other is
 *     refused, including one a handed-over context imports, and each call
 *     starts with an empty cache, so nothing handed to one call is there for
 *     the next;
 *   - nothing is fetched. The JSON-LD processor is given a loader that
 *     answers from the handed-over contexts and has no other source;
 *   - a result that arrives after the time limit is discarded. The answer is
 *     `timeout`, which the validator reports as `unknown`.
 *
 * The time limit is a deadline, not a pre-emption: JavaScript cannot
 * interrupt work that does not yield, so a call can take longer than the
 * limit to return. What the limit guarantees is that a late result is never
 * used. A service that must bound the time itself runs the engine in a worker
 * it can stop.
 */
import type { EngineContext, EngineFile, EngineFinding, JsonLdEngine, JsonLdExpansion, ShaclEngine, ShaclValidation } from './binding-validator.js'
import type { EngineCapability, FindingSeverity } from './profile-binding.js'

/**
 * The libraries this adapter is tested with, at exact versions. They are not
 * dependencies of the package: a caller that wants this adapter installs
 * them, and a caller that does not never pays for them.
 */
export const VALIDATION_ENGINE_LIBRARIES = { jsonld: '9.0.0', n3: '2.13.12', 'shacl-engine': '1.1.3' } as const

/** A library the adapter needs is not installed, or did not load. */
export class ValidationEngineUnavailableError extends Error {
  readonly library: string
  constructor(library: string, cause: unknown) {
    const version = (VALIDATION_ENGINE_LIBRARIES as Record<string, string>)[library]
    super(`The validation engine needs ${library}${version == null ? '' : `@${version}`}, which did not load: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'ValidationEngineUnavailableError'
    this.library = library
  }
}

export interface ValidationEngineOptions {
  /** How long one expansion or one validation may take, in milliseconds. Default 10 000. */
  timeoutMs?: number
  /** False builds an engine without the SPARQL plug-in. It then declares `shacl-core` only, and a binding that requires SPARQL constraints answers `unknown` with it. Default true. */
  sparql?: boolean
  /**
   * How a library is loaded, by the names `jsonld`, `n3`, `shacl-engine` and
   * `shacl-engine/sparql.js`. The default is a dynamic `import`. A bundler
   * cannot follow that, so a bundled caller passes a function that imports
   * each name statically.
   */
  load?: (name: string) => Promise<unknown>
}

const DEFAULT_TIMEOUT_MS = 10_000
const SH = 'http://www.w3.org/ns/shacl#'
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const SEVERITIES: readonly string[] = ['Violation', 'Warning', 'Info']
/** The serialisations the RDF parser reads, by media type. */
const RDF_FORMATS: Record<string, string> = { 'text/turtle': 'Turtle', 'application/n-triples': 'N-Triples', 'application/n-quads': 'N-Quads', 'application/trig': 'TriG' }

// The libraries ship no types this package could depend on, so the few
// members used here are described by hand and everything else stays unknown.
interface Term { termType: string; value: string }
interface Quad { predicate: Term }
interface N3 {
  Parser: new (options: { format: string; blankNodePrefix: string; factory: Record<string, unknown> }) => { parse(text: string): Quad[] }
  Store: new (quads?: unknown[]) => unknown
  DataFactory: Record<string, unknown> & { blankNode(name?: string): Term }
}
interface JsonLdProcessor {
  toRDF(document: unknown, options: { format: string; safe: boolean; documentLoader: (url: string) => Promise<{ contextUrl: null; documentUrl: string; document: unknown }> }): Promise<string>
}
interface PathStep { quantifier: string; start: string; end: string; predicates: Term[] }
interface EngineResult {
  severity: Term
  constraintComponent: Term
  focusNode?: { term?: Term | null }
  path?: PathStep[] | null
  message?: Term[]
  value?: { term?: Term | null }
}
interface ShaclLibrary { Validator: new (shapes: unknown, options: Record<string, unknown>) => { validate(data: { dataset: unknown }): Promise<{ results: EngineResult[] }> } }

const TIMED_OUT = Symbol('timed out')

/** The work's result, or `TIMED_OUT` when the limit passed first or the result arrived after it. */
async function within<T>(timeoutMs: number, work: () => Promise<T>): Promise<T | typeof TIMED_OUT> {
  const started = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs) })
  try {
    const result = await Promise.race([work(), limit])
    // Work that never yielded can finish before the timer is allowed to fire. It is late all the same.
    return performance.now() - started >= timeoutMs ? TIMED_OUT : result
  } finally {
    clearTimeout(timer)
  }
}

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const localName = (iri: string): string => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1)
const termText = (term: Term): string => (term.termType === 'BlankNode' ? `_:${term.value}` : term.value)

/** A result path as text: one predicate IRI for a plain property, and SPARQL path syntax for anything longer. */
function pathText(path: PathStep[]): string {
  if (path.length === 1 && path[0]!.quantifier === 'one' && path[0]!.start === 'subject' && path[0]!.predicates.length === 1) return path[0]!.predicates[0]!.value
  const quantifier: Record<string, string> = { one: '', oneOrMore: '+', zeroOrMore: '*', zeroOrOne: '?' }
  return path.map((step) => `${step.start === 'object' ? '^' : ''}${step.predicates.map((p) => `<${p.value}>`).join('|')}${quantifier[step.quantifier] ?? ''}`).join('/')
}

/** The engine's own result, reduced to the finding the validator carries. A member the result does not have is left out. */
function findingOf(result: EngineResult): EngineFinding {
  const focus = result.focusNode?.term
  const value = result.value?.term
  const message = result.message?.[0]?.value
  return {
    severity: localName(result.severity.value) as FindingSeverity,
    constraint: localName(result.constraintComponent.value),
    ...(focus == null ? {} : { focusNode: termText(focus) }),
    ...(result.path == null || result.path.length === 0 ? {} : { path: pathText(result.path) }),
    ...(message == null ? {} : { message }),
    ...(value == null ? {} : { value: termText(value) }),
  }
}

/** A marker the context loader throws, so its refusal is told apart from every error the processor raises itself. */
class ContextNotListed extends Error {
  constructor(readonly url: string) { super(`the context ${url} was not handed to the engine`) }
}

/**
 * The engines, once the libraries have loaded. Rejects with
 * `ValidationEngineUnavailableError`, naming the library, when one is not
 * installed: the caller then validates without them, and every step that
 * needs an engine answers `unknown`.
 */
export async function createValidationEngine(options: ValidationEngineOptions = {}): Promise<{ jsonLd: JsonLdEngine; shacl: ShaclEngine }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be a number of milliseconds, zero or more')
  const sparql = options.sparql ?? true
  const load = options.load ?? ((name: string): Promise<unknown> => import(name))
  const library = async <T>(name: string): Promise<T> => {
    try {
      const loaded = (await load(name)) as { default?: unknown }
      // A CommonJS library arrives under `default`; an ES module is its own namespace.
      return (loaded.default ?? loaded) as T
    } catch (cause) {
      throw new ValidationEngineUnavailableError(name.split('/')[0]!, cause)
    }
  }
  const jsonldFactory = await library<() => JsonLdProcessor>('jsonld')
  const n3 = await library<N3>('n3')
  const { Validator } = await library<ShaclLibrary>('shacl-engine')
  const plugin = sparql ? await library<{ validations: unknown; targetResolvers: unknown }>('shacl-engine/sparql.js') : undefined

  // The engine asks its factory for terms and for an empty dataset. The RDF library's own are enough.
  const factory = { ...n3.DataFactory, dataset: (quads?: unknown[]) => new n3.Store(quads) }
  // Blank nodes belong to one input document. Scope its labelled and anonymous nodes separately so
  // repeated validations identify the same focus and value without joining nodes from different files.
  const parser = (format: string, scope: string) => {
    let anonymous = 0
    return new n3.Parser({
      format,
      blankNodePrefix: scope + '_label_',
      factory: { ...n3.DataFactory, blankNode: (name?: string) => n3.DataFactory.blankNode(name ?? scope + '_anon_' + anonymous++) },
    })
  }
  const parse = (file: EngineFile, scope: string): Quad[] => {
    const format = RDF_FORMATS[file.mediaType]
    if (format == null) throw new Error(`${file.path} has media type ${file.mediaType}, which this engine does not read`)
    try {
      return parser(format, scope).parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes))
    } catch (cause) {
      throw new Error(`${file.path} did not parse as ${format}: ${reasonOf(cause)}`)
    }
  }

  const toRdf = async ({ document, contexts }: { document: unknown; contexts: readonly EngineContext[] }): Promise<JsonLdExpansion> => {
    const handed = new Map<string, unknown>()
    try {
      for (const context of contexts) handed.set(context.uri, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(context.bytes)))
    } catch (cause) {
      return { ok: false, reason: 'engine-error', detail: `a context is not JSON: ${reasonOf(cause)}` }
    }
    let refused: string | undefined
    // The only source of contexts. It has no fallback, so a URL outside the list can be refused and cannot be fetched.
    const documentLoader = async (url: string): Promise<{ contextUrl: null; documentUrl: string; document: unknown }> => {
      if (!handed.has(url)) { refused ??= url; throw new ContextNotListed(url) }
      return { contextUrl: null, documentUrl: url, document: structuredClone(handed.get(url)) }
    }
    try {
      // A processor of its own for each call. The library keeps the contexts it has resolved by URL, and a shared
      // one would answer for a context this call was never handed, or was handed with other bytes.
      const processor = jsonldFactory()
      // Safe mode refuses what the contexts do not define. Without it such a member is dropped, and a dropped member is one no shape can see.
      const nquads = await within(timeoutMs, () => processor.toRDF(document, { format: 'application/n-quads', safe: true, documentLoader }))
      if (nquads === TIMED_OUT) return { ok: false, reason: 'timeout', detail: `expansion did not finish within ${timeoutMs} ms` }
      return { ok: true, nquads }
    } catch (cause) {
      if (refused != null) return { ok: false, reason: 'context-not-listed', detail: `the context ${refused} was not handed to the engine` }
      const error = cause as { name?: string; message?: string; details?: { code?: string; event?: { message?: string; details?: unknown } } }
      if (typeof error?.name === 'string' && error.name.startsWith('jsonld.')) {
        const event = error.details?.event
        const said = [error.message, event?.message, event?.details == null ? error.details?.code : JSON.stringify(event.details)].filter((part) => part != null && part !== '').join(' ')
        return { ok: false, reason: 'document-invalid', detail: said.replace(/\.$/, '') }
      }
      return { ok: false, reason: 'engine-error', detail: reasonOf(cause) }
    }
  }

  const capabilities: EngineCapability[] = sparql ? ['shacl-core', 'shacl-sparql-constraints'] : ['shacl-core']
  const validate = async ({ nquads, shapes, background }: { nquads: string; shapes: readonly EngineFile[]; background: readonly EngineFile[] }): Promise<ShaclValidation> => {
    try {
      const shapeQuads = shapes.flatMap((file, index) => parse(file, 'shapes' + index))
      const backgroundQuads = background.flatMap((file, index) => parse(file, 'background' + index))
      let dataQuads: unknown[]
      try {
        dataQuads = parser('N-Quads', 'product').parse(nquads)
      } catch (cause) {
        throw new Error(`the data did not parse as N-Quads: ${reasonOf(cause)}`)
      }
      const report = await within(timeoutMs, () => {
        // The engine resolves targetClass and class constraints against its shapes graph.
        // Only the binding's background can extend the class hierarchy used here.
        const hierarchy = backgroundQuads.filter((quad) => quad.predicate.value === RDFS_SUBCLASS)
        const validator = new Validator(new n3.Store([...shapeQuads, ...hierarchy]), plugin == null ? { factory } : { factory, validations: plugin.validations, targetResolvers: plugin.targetResolvers })
        return validator.validate({ dataset: new n3.Store([...backgroundQuads, ...dataQuads]) })
      })
      if (report === TIMED_OUT) return { ok: false, reason: 'timeout', detail: `validation did not finish within ${timeoutMs} ms` }
      // The engine also records results that are not findings when asked to trace. Only the three SHACL severities are findings.
      return { ok: true, findings: report.results.filter((r) => r.severity.value.startsWith(SH) && SEVERITIES.includes(localName(r.severity.value))).map(findingOf) }
    } catch (cause) {
      return { ok: false, reason: 'engine-error', detail: reasonOf(cause) }
    }
  }

  return { jsonLd: { toRdf }, shacl: { capabilities, validate } }
}
