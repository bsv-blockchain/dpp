import type { EngineContext, JsonLdEngine } from './binding-validator.js'
import type { BindingIdentity } from './profile-binding.js'
import { valueAt } from './binding-pointer.js'

type Json = Record<string, unknown>
const PROBE = 'urn:dpp:identity-property:'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

const decodeToken = (token: string) => token.replace(/~1/g, '/').replace(/~0/g, '~')
const memberName = (pointer: string) => decodeToken(pointer.slice(pointer.lastIndexOf('/') + 1))
const parentPointer = (pointer: string) => pointer.slice(0, pointer.lastIndexOf('/'))

function* definitions(context: unknown): Generator<[string, unknown]> {
  if (Array.isArray(context)) {
    for (const entry of context) yield* definitions(entry)
  } else if (isObject(context)) {
    for (const entry of Object.entries(context)) {
      yield entry
      if (isObject(entry[1])) yield* definitions(entry[1]['@context'])
    }
  }
}

/** An unqualified pointer with no term or default vocabulary in any pinned context is a JSON-only rule. */
export function semanticRules(identity: BindingIdentity, contexts: readonly EngineContext[]): { pointers: string[]; typeNames: string[] } {
  const terms = new Set<string>()
  const typeNames = new Set(['@type'])
  for (const context of contexts) {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(context.bytes))
    for (const [name, definition] of definitions(parsed['@context'])) {
      terms.add(name)
      if (definition === '@type' || (isObject(definition) && definition['@id'] === '@type')) typeNames.add(name)
    }
  }
  const rules = [...identity.mustEqual, ...identity.mustNotContradict, ...(identity.granularityMember == null ? [] : [identity.granularityMember])]
  const pointers = [...new Set(rules.map((r) => r.pointer))].filter((pointer) => {
    const name = memberName(pointer)
    return name.includes(':') || terms.has(name) || terms.has('@vocab')
  })
  return { pointers, typeNames: [...typeNames] }
}

// Read the predicate and object of statements about a named subject from the engine's N-Quads.
// A blank node or a literal with an unsupported datatype remains an unreadable value.
const escapes: Record<string, string> = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' }
const unescapeTerm = (term: string): string => term.replace(/\\(u[\da-fA-F]{4}|U[\da-fA-F]{8}|[tbnrf"'\\])/g, (_, code: string) =>
  code.length > 1 ? String.fromCodePoint(parseInt(code.slice(1), 16)) : escapes[code]!)
const triple = /^\s*<([^>]*)>\s*<([^>]*)>\s*(.*)$/su
const objectTerm = /^(?:<([^>]*)>|"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]*)>|(@[\w-]+))?)/su

function* namedStatements(nquads: string) {
  for (const line of nquads.split(/\r\n?|\n/)) {
    const match = triple.exec(line)
    if (match == null) {
      if (line.trimStart().startsWith('<')) throw new Error('Unreadable named statement in expanded product.')
      continue
    }
    const term = objectTerm.exec(match[3]!)
    yield {
      subject: unescapeTerm(match[1]!),
      predicate: unescapeTerm(match[2]!),
      iri: term?.[1] == null ? undefined : unescapeTerm(term[1]),
      literal: term?.[2] == null ? undefined : unescapeTerm(term[2]),
      datatype: term?.[3] == null ? undefined : unescapeTerm(term[3]),
      language: term?.[4],
    }
  }
}

export function namedObjects(nquads: string, subject: string, predicate: string): string[] {
  const objects: string[] = []
  for (const term of namedStatements(nquads)) {
    if (term.subject === subject && term.predicate === predicate && term.iri != null) objects.push(term.iri)
  }
  return objects
}

/** Resolve the binding's names with the same processor and contexts that read the subject. */
export async function readSemanticIdentity(
  rules: ReturnType<typeof semanticRules>, identity: BindingIdentity, product: Json, subject: string,
  nquads: string, engine: JsonLdEngine, contexts: readonly EngineContext[],
): Promise<Map<string, unknown[]>> {
  const marker = 'dpp-identity-property'
  const locations = new Set(identity.subject.pointers.filter((pointer) => valueAt({ product }, pointer) === subject).map(parentPointer))
  const isDirectMember = (pointer: string) => parentPointer(pointer) === '/product' || locations.has(parentPointer(pointer))
  const { pointers } = rules
  // Keep the path to the bound node so property- and type-scoped contexts apply just as
  // they did in the product. The probe contains no product values other than context and type.
  function probeNode(pointer: string, id: string): Json | unknown[] {
    const path = pointer.split('/').slice(2)
    function descend(current: unknown, depth: number): Json | unknown[] {
      if (depth === path.length) return { '@value': marker }
      const key = decodeToken(path[depth]!)
      if (Array.isArray(current)) return [descend(current[Number(key)], depth + 1)]
      const scope: Json = {}
      if (isObject(current)) {
        for (const name of rules.typeNames) if (Object.hasOwn(current, name)) scope[name] = current[name]
        if (depth > 0 && Object.hasOwn(current, '@context')) scope['@context'] = current['@context']
      }
      // A nested JSON object can introduce another RDF node, or group properties of
      // the same node with @nest. Let the processor make that distinction.
      const container = ['/product', ...path.slice(0, depth)].join('/')
      if (locations.has(container) || (depth === 0 && path.length === 1)) scope['@id'] = id
      if (depth === path.length - 1) return { ...scope, [key]: { '@value': marker } }
      return { ...scope, [key]: descend(isObject(current) ? current[key] : undefined, depth + 1) }
    }
    return descend(product, 0)
  }
  const probe = async (pointers: readonly string[], selected: unknown): Promise<Map<string, string>> => {
    const nodes = pointers.map((pointer, index) => probeNode(pointer, PROBE + index))
    const expansion = await engine.toRdf({ document: { '@context': selected, '@graph': nodes }, contexts })
    const predicates = new Map<string, string>()
    if (!expansion.ok) {
      if (expansion.reason === 'document-invalid') return predicates
      throw new Error('The binding identity predicates could not be read.')
    }
    for (const term of namedStatements(expansion.nquads)) {
      if (!term.subject.startsWith(PROBE) || term.literal !== marker || term.language) continue
      const pointer = pointers[Number(term.subject.slice(PROBE.length))]
      if (pointer !== undefined) predicates.set(pointer, term.predicate)
    }
    return predicates
  }
  const active = product['@context']
  const selected = new Set(Array.isArray(active) ? active : [active])
  const predicates = await probe(pointers, active)
  const alternatives = contexts.filter((c) => !selected.has(c.uri))
  for (const pointer of pointers) {
    const name = memberName(pointer)
    // Without its prefix, JSON-LD can read a compact name literally as an absolute IRI.
    const provisional = predicates.get(pointer)
    if (provisional != null && (provisional !== name || name.includes('://'))) continue
    // Another unrecognised name can cause a batch probe to fail. Try this rule alone in the
    // actual context first, then consult individual pinned contexts for a missing definition.
    const activePredicate = provisional ?? (await probe([pointer], active)).get(pointer)
    if (activePredicate != null && activePredicate !== name) { predicates.set(pointer, activePredicate); continue }
    if (!isDirectMember(pointer)) continue
    const candidates = new Set<string>()
    for (const other of alternatives) {
      const iri = (await probe([pointer], other.uri)).get(pointer)
      if (iri != null && iri !== name) candidates.add(iri)
    }
    if (candidates.size > 1) throw new Error('The binding identity predicate has different meanings in its permitted contexts.')
    const iri = candidates.values().next().value ?? activePredicate
    if (iri != null) predicates.set(pointer, iri)
  }
  if (pointers.some((pointer) => isDirectMember(pointer) && !predicates.has(pointer))) throw new Error('The binding identity predicates could not all be resolved under the selected contexts.')

  const values = new Map<string, unknown[]>([...predicates.keys()].map((pointer) => [pointer, []]))
  const linkPointers = new Set(identity.mustNotContradict.map((rule) => rule.pointer))
  for (const term of namedStatements(nquads)) {
    if (term.subject !== subject) continue
    for (const [pointer, iri] of predicates) {
      if (iri !== term.predicate) continue
      let value = linkPointers.has(pointer) ? term.iri : undefined
      if (term.literal !== undefined && !term.language && (term.datatype == null || term.datatype === XSD + 'string' || (linkPointers.has(pointer) && term.datatype === XSD + 'anyURI'))) {
        value = term.literal
      }
      values.get(pointer)!.push(value)
    }
  }
  return values
}
