import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, EngineFile, JsonLdEngine, ShaclEngine } from '../src/index.js'
import { VALIDATION_ENGINE_LIBRARIES, ValidationEngineUnavailableError, createValidationEngine } from '../src/validation-engine.js'

// The adapter over the JSON-LD and SHACL libraries, exercised on the example
// bottle profile's own files. The libraries are installed in this repository
// for these tests only, and nothing in the package's main entry point reaches
// them (entry-point-isolation.test.ts).
const folder = join(import.meta.dirname, '..', '..', '..', 'examples', 'custom-profile', 'example-bottle@1')
const bytes = (file: string): Uint8Array => new Uint8Array(readFileSync(join(folder, file)))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const CONTEXT = 'https://profiles.example/bottle/v1/context.jsonld'
const contexts: EngineContext[] = [{ uri: CONTEXT, bytes: bytes('context.jsonld') }]
const shapes: EngineFile[] = [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: bytes('shapes.ttl') }]
const background: EngineFile[] = [{ path: 'background.ttl', mediaType: 'text/turtle', bytes: bytes('background.ttl') }]
const product = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...(JSON.parse(readFileSync(join(folder, 'vectors', 'item.json'), 'utf8')) as { payload: { product: Record<string, unknown> } }).payload.product, ...over })
const bambooCap = [{ type: 'Part', name: 'Body', material: 'stainless-steel' }, { type: 'Part', name: 'Cap', material: 'bamboo' }]

let jsonLd: JsonLdEngine
let shacl: ShaclEngine
beforeAll(async () => { ({ jsonLd, shacl } = await createValidationEngine()) })

const realFetch = globalThis.fetch
let fetched = 0
const refuseNetwork = (): void => { fetched = 0; globalThis.fetch = (async () => { fetched += 1; throw new Error('the network is not to be used') }) as typeof fetch }
afterEach(() => { globalThis.fetch = realFetch })

const expand = async (document: unknown, engine: JsonLdEngine = jsonLd, given: EngineContext[] = contexts): Promise<string> => {
  const result = await engine.toRdf({ document, contexts: given })
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`)
  return result.nquads
}

describe('createValidationEngine: JSON-LD expansion', () => {
  it('expands a document with the contexts it was handed', async () => {
    const nquads = await expand(product())
    expect(nquads).toContain('<https://id.example/01/09521234543213/21/BTL-0001> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://profiles.example/bottle/v1#Bottle> .')
    expect(nquads).toContain('<https://profiles.example/bottle/v1#material> <https://profiles.example/bottle/v1#stainless-steel> .')
  })

  it('refuses a context it was not handed and never touches the network', async () => {
    refuseNetwork()
    const result = await jsonLd.toRdf({ document: product({ '@context': [CONTEXT, 'https://profiles.example/extras/v1/context.jsonld'] }), contexts })
    expect(result).toMatchObject({ ok: false, reason: 'context-not-listed' })
    if (!result.ok) expect(result.detail).toContain('https://profiles.example/extras/v1/context.jsonld')
    const none = await jsonLd.toRdf({ document: product(), contexts: [] })
    expect(none).toMatchObject({ ok: false, reason: 'context-not-listed' })
    expect(fetched).toBe(0)
  })

  it('refuses a context that one of its contexts imports and it was not handed', async () => {
    refuseNetwork()
    const importing = utf8(JSON.stringify({ '@context': ['https://profiles.example/shared/v1/context.jsonld', { name: 'https://profiles.example/bottle/v1#name' }] }))
    const result = await jsonLd.toRdf({ document: { '@context': CONTEXT, name: 'Bottle' }, contexts: [{ uri: CONTEXT, bytes: importing }] })
    expect(result).toMatchObject({ ok: false, reason: 'context-not-listed' })
    if (!result.ok) expect(result.detail).toContain('https://profiles.example/shared/v1/context.jsonld')
    expect(fetched).toBe(0)
  })

  it('keeps nothing between calls: a context handed to one call is not there for the next', async () => {
    const shared = 'https://profiles.example/shared/v1/context.jsonld'
    const sharedBytes = utf8(JSON.stringify({ '@context': { label: 'https://profiles.example/shared/v1#label' } }))
    const document = { '@context': shared, '@id': 'https://id.example/thing', label: 'A thing' }
    expect(await expand(document, jsonLd, [{ uri: shared, bytes: sharedBytes }])).toContain('<https://profiles.example/shared/v1#label> "A thing"')
    // The same URI with other bytes is another context, and the first answer must not be served again.
    const other = utf8(JSON.stringify({ '@context': { label: 'https://profiles.example/other/v1#label' } }))
    expect(await expand(document, jsonLd, [{ uri: shared, bytes: other }])).toContain('<https://profiles.example/other/v1#label> "A thing"')
    expect(await jsonLd.toRdf({ document, contexts })).toMatchObject({ ok: false, reason: 'context-not-listed' })
  })

  it('refuses a document its contexts do not fully define, instead of dropping what it cannot read', async () => {
    for (const document of [product({ colour: 'red' }), product({ parts: [{ type: 'Part', name: 'Cap', material: 'unobtainium' }] }), product({ id: 'bottle-1' })]) {
      expect(await jsonLd.toRdf({ document, contexts })).toMatchObject({ ok: false, reason: 'document-invalid' })
    }
  })

  it('reports a context that is not JSON as an engine error', async () => {
    expect(await jsonLd.toRdf({ document: product(), contexts: [{ uri: CONTEXT, bytes: utf8('{not json') }] })).toMatchObject({ ok: false, reason: 'engine-error' })
  })
})

describe('createValidationEngine: SHACL validation', () => {
  it('reports the same care-note warning for valid bottles at each level of a trusted class hierarchy', async () => {
    const terms = 'https://profiles.example/bottle/v1#'
    const hierarchy = { path: 'bottle-types.ttl', mediaType: 'text/turtle', bytes: utf8(`
      @prefix bottle: <${terms}> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      bottle:TravelBottle rdfs:subClassOf bottle:Bottle .
      bottle:InsulatedTravelBottle rdfs:subClassOf bottle:TravelBottle .
    `) }
    refuseNetwork()
    for (const name of ['Bottle', 'TravelBottle', 'InsulatedTravelBottle']) {
      const nquads = await expand(product({ type: terms + name }))
      const result = await shacl.validate({ nquads, shapes, background: [...background, hierarchy] })
      if (!result.ok) throw new Error(result.detail)
      expect(result.findings, name).toEqual([
        expect.objectContaining({ severity: 'Warning', constraint: 'MinCountConstraintComponent', path: terms + 'careNote' }),
      ])
    }
    // The product can describe a classification. Only the binding can use it to select a shape.
    const data = await expand(product({ type: terms + 'TravelBottle' }))
    const classification = `<${terms}TravelBottle> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <${terms}Bottle> .\n`
    const withoutHierarchy = await shacl.validate({ nquads: data + classification, shapes, background })
    expect(withoutHierarchy).toEqual({ ok: true, findings: [] })
    expect(fetched).toBe(0)
  })

  it('returns repeatable findings for distinct blank nodes in each input document', async () => {
    const shape = { path: 'seen.ttl', mediaType: 'text/turtle', bytes: utf8(`
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      <urn:shape> a sh:NodeShape ; sh:targetSubjectsOf <urn:seen> ;
        sh:property [ sh:path <urn:seen> ; sh:maxCount 0 ] .
    `) }
    const file = (path: string, ttl: string) => ({ path, mediaType: 'text/turtle', bytes: utf8(ttl) })
    const input = {
      nquads: '_:same <urn:seen> "product" .',
      shapes: [shape],
      background: [
        file('first.ttl', '_:same <urn:seen> "first" . [] <urn:seen> "anonymous" .'),
        file('second.ttl', '_:same <urn:seen> "second" .'),
      ],
    }
    const first = await shacl.validate(input)
    if (!first.ok) throw new Error(first.detail)
    expect(new Set(first.findings.map((finding) => finding.focusNode)).size).toBe(4)
    expect(await shacl.validate(input)).toEqual(first)
  })

  it('declares the core and the SPARQL constraints', () => {
    expect([...shacl.capabilities].sort()).toEqual(['shacl-core', 'shacl-sparql-constraints'])
  })

  it('reports each finding with its severity, constraint, focus node, path and message', async () => {
    const result = await shacl.validate({ nquads: await expand(product({ capacityMillilitres: 50 })), shapes, background })
    if (!result.ok) throw new Error(result.detail)
    expect(result.findings).toEqual(expect.arrayContaining([
      { severity: 'Violation', constraint: 'MinInclusiveConstraintComponent', focusNode: 'https://id.example/01/09521234543213/21/BTL-0001', path: 'https://profiles.example/bottle/v1#capacityMillilitres', message: expect.any(String), value: '50' },
      { severity: 'Warning', constraint: 'MinCountConstraintComponent', focusNode: 'https://id.example/01/09521234543213/21/BTL-0001', path: 'https://profiles.example/bottle/v1#careNote', message: 'A care note is recommended.' },
    ]))
    expect(result.findings).toHaveLength(2)
  })

  it('finds what only the SPARQL constraint can, and reads the background file to do it', async () => {
    const nquads = await expand(product({ parts: bambooCap }))
    const result = await shacl.validate({ nquads, shapes, background })
    if (!result.ok) throw new Error(result.detail)
    expect(result.findings.filter((f) => f.severity === 'Violation')).toEqual([
      { severity: 'Violation', constraint: 'SPARQLConstraintComponent', focusNode: 'https://id.example/01/09521234543213/21/BTL-0001', message: 'A bottle declared dishwasher safe has a part made of a material that does not withstand a dishwasher.', value: 'https://profiles.example/bottle/v1#bamboo' },
    ])
    // Without the background neither part's material is known to be one, which a core constraint reports for each part instead.
    const bare = await shacl.validate({ nquads, shapes, background: [] })
    if (!bare.ok) throw new Error(bare.detail)
    expect(bare.findings.filter((f) => f.severity === 'Violation').map((f) => f.constraint)).toEqual(['NodeConstraintComponent', 'NodeConstraintComponent'])
  })

  it('control: an engine without the SPARQL capability misses that finding and says so in what it declares', async () => {
    const core = await createValidationEngine({ sparql: false })
    expect(core.shacl.capabilities).toEqual(['shacl-core'])
    const result = await core.shacl.validate({ nquads: await expand(product({ parts: bambooCap })), shapes, background })
    if (!result.ok) throw new Error(result.detail)
    // No violation at all: this silence is why the validator reads the capabilities before it asks.
    expect(result.findings.filter((f) => f.severity === 'Violation')).toEqual([])
  })

  it('reports shapes it cannot parse and a media type it does not read as engine errors', async () => {
    const nquads = await expand(product())
    expect(await shacl.validate({ nquads, shapes: [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: utf8('this is not turtle') }], background })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('shapes.ttl') })
    expect(await shacl.validate({ nquads, shapes: [{ path: 'shapes.xml', mediaType: 'application/rdf+xml', bytes: utf8('<rdf/>') }], background })).toMatchObject({ ok: false, reason: 'engine-error', detail: expect.stringContaining('application/rdf+xml') })
    expect(await shacl.validate({ nquads: 'not n-quads', shapes, background })).toMatchObject({ ok: false, reason: 'engine-error' })
  })
})

describe('createValidationEngine: the time limit', () => {
  it('answers timeout, never a result, once the limit has passed', async () => {
    const hurried = await createValidationEngine({ timeoutMs: 0 })
    expect(await hurried.jsonLd.toRdf({ document: product(), contexts })).toMatchObject({ ok: false, reason: 'timeout' })
    expect(await hurried.shacl.validate({ nquads: await expand(product()), shapes, background })).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('refuses a limit that is not a number of milliseconds', async () => {
    await expect(createValidationEngine({ timeoutMs: -1 })).rejects.toThrow(/timeoutMs/)
    await expect(createValidationEngine({ timeoutMs: Number.NaN })).rejects.toThrow(/timeoutMs/)
  })
})

describe('createValidationEngine: the libraries', () => {
  it('names the versions it is tested with, which are the versions installed here', () => {
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> }
    for (const [name, version] of Object.entries(VALIDATION_ENGINE_LIBRARIES)) expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version)
    expect(Object.keys(VALIDATION_ENGINE_LIBRARIES).sort()).toEqual(['jsonld', 'n3', 'shacl-engine'])
  })

  it('says which library is missing when one is not installed', async () => {
    const missing = createValidationEngine({ load: async (name) => { if (name === 'shacl-engine') throw new Error("Cannot find package 'shacl-engine'"); return import(name) } })
    await expect(missing).rejects.toBeInstanceOf(ValidationEngineUnavailableError)
    await expect(missing).rejects.toMatchObject({ library: 'shacl-engine', message: expect.stringContaining('shacl-engine@1.1.3') })
  })
})
