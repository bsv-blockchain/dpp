import { beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { EvidencePolicy } from '@bsv/dpp-protocol'
import {
  bindingPayloadValidator,
  createProfileRegistry,
  profilePayloadValidator,
  type BindingValidationDetail,
  type EngineFinding,
  type JsonLdEngine,
  type PayloadToValidate,
  type PayloadValidation,
  type ProfileRegistry,
  type ShaclEngine,
  type ValidationEngines,
} from '../src/index.js'
import { SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticBinding } from './binding-fixture.js'

// The validator a writer or a verifier plugs in for profiles held by a
// binding. Engines are stand-ins here, so each row of the outcome table is
// exercised on its own. The real engines are tested with the adapter.
const GTIN = '09523000000012'
const passportId = `https://passports.example/01/${GTIN}/21/LAMP-0001`
const product = (): Record<string, unknown> => ({ '@context': SYNTHETIC_CONTEXT_URI, id: `https://id.example/01/${GTIN}/21/LAMP-0001`, name: 'Desk lamp', gtin: GTIN, serialNumber: 'LAMP-0001', lumens: 800 })

const fullBytes = bindingBytes(syntheticBinding())
const fullDigest = sha256Hex(fullBytes)
// The same profile family with the two steps a plain JSON Schema profile uses.
const plain = { ...syntheticBinding(), id: 'example-lamp-plain', profile: 'example-lamp-plain@1', artefacts: [syntheticBinding().artefacts[0]], validation: { steps: ['json-schema', 'passport-identity'], blockingSeverities: ['Violation'] } }
const plainBytes = bindingBytes(plain)
const plainDigest = sha256Hex(plainBytes)

let registry: ProfileRegistry
beforeAll(async () => {
  registry = createProfileRegistry({ trustedBindingDigests: [fullDigest, plainDigest] })
  for (const bytes of [fullBytes, plainBytes]) expect((await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).ok).toBe(true)
})

const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
const NQUADS = '<https://id.example/a> <https://profiles.example/lamp/v1#name> "Desk lamp" .\n'
const jsonLd = (answer: Awaited<ReturnType<JsonLdEngine['toRdf']>> = { ok: true, nquads: NQUADS }, calls: unknown[] = []): JsonLdEngine => ({ toRdf: async (input) => { calls.push(input); return answer } })
const shacl = (findings: EngineFinding[] = [], capabilities: ShaclEngine['capabilities'] = ['shacl-core', 'shacl-sparql-constraints'], calls: unknown[] = []): ShaclEngine => ({ capabilities, validate: async (input) => { calls.push(input); return { ok: true, findings } } })
const allEngines = (): ValidationEngines => ({ jsonSchema: compiler(), jsonLd: jsonLd(), shacl: shacl() })

const envelope = (over: Record<string, unknown> = {}, profile = 'example-lamp', digest = fullDigest): Record<string, unknown> => ({ profile, profile_version: 1, profile_binding_sha256: digest, product: product(), ...over })
const input = (payload: unknown, over: Partial<PayloadToValidate> = {}): PayloadToValidate => ({ profile: 'example-lamp', profileVersion: 1, payloadPublic: typeof payload === 'string' ? payload : JSON.stringify(payload), passportId, ...over })
const run = (payload: unknown, engines: ValidationEngines | undefined = allEngines(), over: Partial<PayloadToValidate> = {}): Promise<PayloadValidation> => bindingPayloadValidator({ registry, engines })(input(payload, over))
const detailOf = (result: PayloadValidation): BindingValidationDetail => result.detail as BindingValidationDetail
const stepOf = (result: PayloadValidation, step: string) => detailOf(result).steps.find((s) => s.step === step)

describe('bindingPayloadValidator: the whole pipeline', () => {
  it('passes only when every step passes, and lists the steps in the binding\'s order', async () => {
    const result = await run(envelope())
    expect(result.status).toBe('pass')
    expect(result.reasonCode).toBeUndefined()
    expect(detailOf(result)).toMatchObject({ profile: 'example-lamp@1', bindingDigest: fullDigest })
    expect(detailOf(result).cause).toBeUndefined()
    expect(detailOf(result).steps.map((s) => [s.step, s.status])).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['json-schema', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
  })

  it('has the shape of the protocol\'s payloadValidator hook and of profilePayloadValidator', () => {
    const hook: NonNullable<EvidencePolicy['payloadValidator']> = bindingPayloadValidator({ registry, engines: allEngines() })
    const same: ReturnType<typeof profilePayloadValidator> = bindingPayloadValidator({ registry })
    expect(typeof hook).toBe('function')
    expect(typeof same).toBe('function')
  })

  it('passes a plain JSON Schema profile with a schema compiler and no other engine', async () => {
    const result = await run(envelope({}, 'example-lamp-plain', plainDigest), { jsonSchema: compiler() }, { profile: 'example-lamp-plain' })
    expect(result.status).toBe('pass')
    expect(detailOf(result).steps.map((s) => s.step)).toEqual(['envelope', 'binding', 'json-schema', 'passport-identity'])
  })

  it('accepts the notice a demonstration record carries first', async () => {
    const result = await run({ notice: 'Demonstration record: no real product stands behind it.', ...envelope() })
    expect(result.status).toBe('pass')
  })
})

describe('bindingPayloadValidator: an unknown profile', () => {
  it('answers unknown, never pass, for a profile the registry does not hold', async () => {
    const result = await run(envelope({ profile: 'toaster' }), allEngines(), { profile: 'toaster', profileVersion: 9 })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { profile: 'toaster@9', cause: 'profile-unknown' } })
  })
})

describe('bindingPayloadValidator: the envelope', () => {
  const refused: Array<[string, unknown]> = [
    ['text that is not JSON', '{not json'],
    ['a member name twice at the top', `{"profile":"example-lamp","profile":"example-lamp","profile_version":1,"profile_binding_sha256":"${fullDigest}","product":${JSON.stringify(product())}}`],
    ['a member name twice inside the product', `{"profile":"example-lamp","profile_version":1,"profile_binding_sha256":"${fullDigest}","product":{"id":"${product().id as string}","name":"Desk lamp","name":"Floor lamp"}}`],
    ['an array', [envelope()]],
    ['no product', (() => { const e = envelope(); delete e.product; return e })()],
    ['no binding digest', (() => { const e = envelope(); delete e.profile_binding_sha256; return e })()],
    ['no profile version', (() => { const e = envelope(); delete e.profile_version; return e })()],
    ['a member the envelope does not define', envelope({ dataCarrier: 'NFC-1' })],
    ['product fields beside the product document', envelope({ name: 'Desk lamp' })],
    ['a product that is not an object', envelope({ product: 'https://id.example/product.json' })],
    ['a product that is a list', envelope({ product: [product()] })],
    ['an empty notice', envelope({ notice: '' })],
    ['a notice that is not text', envelope({ notice: { en: 'Demonstration' } })],
    ['a binding digest in upper case', envelope({ profile_binding_sha256: fullDigest.toUpperCase() })],
    ['a binding digest that is not a digest', envelope({ profile_binding_sha256: 'latest' })],
    ['a profile version given as text', envelope({ profile_version: '1' })],
    ['a profile other than the one the state declares', envelope({ profile: 'example-lamp-plain' })],
    ['a profile version other than the one the state declares', envelope({ profile_version: 2 })],
  ]
  it.each(refused)('fails %s', async (_name, payload) => {
    const result = await run(payload)
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'envelope-invalid' } })
    expect(detailOf(result).steps).toHaveLength(1)
    expect(detailOf(result).steps[0]).toMatchObject({ step: 'envelope', status: 'fail' })
    for (const sentence of detailOf(result).steps[0]!.messages ?? []) expect(sentence).toMatch(/\.$/)
  })
})

describe('bindingPayloadValidator: the binding digest', () => {
  it('fails a payload that declares another binding, and runs nothing after it', async () => {
    const calls: unknown[] = []
    const result = await run(envelope({ profile_binding_sha256: plainDigest }), { jsonSchema: compiler(), jsonLd: jsonLd(undefined, calls), shacl: shacl([], undefined, calls) })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-binding-mismatch', bindingDigest: fullDigest } })
    expect(detailOf(result).steps.map((s) => [s.step, s.status])).toEqual([['envelope', 'pass'], ['binding', 'fail']])
    expect(stepOf(result, 'binding')?.messages?.[0]).toContain(plainDigest)
    expect(calls).toEqual([])
  })
})

describe('bindingPayloadValidator: json-schema', () => {
  it('fails a product the schema refuses, one sentence per problem', async () => {
    const result = await run(envelope({ product: { ...product(), lumens: 0, colour: 'red' } }))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'schema-invalid' } })
    expect(stepOf(result, 'json-schema')).toMatchObject({ status: 'fail', cause: 'schema-invalid' })
    expect(stepOf(result, 'json-schema')?.messages).toEqual(expect.arrayContaining(['the payload has a field the profile does not define: `colour`.', '`lumens` must be >= 1.']))
  })

  it('answers unknown without a compiler, and when the compiler cannot compile the schema', async () => {
    const none = await run(envelope({}, 'example-lamp-plain', plainDigest), {}, { profile: 'example-lamp-plain' })
    expect(none).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect(stepOf(none, 'json-schema')).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
    const broken = await run(envelope({}, 'example-lamp-plain', plainDigest), { jsonSchema: { compile: () => { throw new Error('unsupported dialect') }, getSchema: () => undefined } }, { profile: 'example-lamp-plain' })
    expect(broken).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
    expect(stepOf(broken, 'json-schema')?.messages?.[0]).toContain('unsupported dialect')
  })

  it('compiles the schema once and reuses one the compiler already holds', async () => {
    const ajv = compiler()
    let compiled = 0
    const counting = { compile: (schema: Record<string, unknown>) => { compiled += 1; return ajv.compile(schema) }, getSchema: (id: string) => ajv.getSchema(id) }
    const validate = bindingPayloadValidator({ registry, engines: { ...allEngines(), jsonSchema: counting } })
    for (let i = 0; i < 3; i++) expect((await validate(input(envelope()))).status).toBe('pass')
    expect(compiled).toBe(1)
    // A second validator over the same compiler finds the schema by its $id and compiles nothing.
    expect((await bindingPayloadValidator({ registry, engines: { ...allEngines(), jsonSchema: counting } })(input(envelope()))).status).toBe('pass')
    expect(compiled).toBe(1)
  })
})

describe('bindingPayloadValidator: two bindings whose schemas share one $id', () => {
  // A compiler keeps one schema per $id. A second binding that reuses the $id for other rules must not be
  // checked against the first binding's schema, in either order.
  const strictSchema = JSON.parse(SYNTHETIC_FILES['product.schema.json']!) as { $id: string; properties: Record<string, unknown> }
  const looseText = JSON.stringify({ ...strictSchema, properties: { ...strictSchema.properties, lumens: { type: 'integer' } } })
  const looseBytes = new TextEncoder().encode(looseText)
  const loose = { ...plain, id: 'example-lamp-loose', profile: 'example-lamp-loose@1', artefacts: [{ ...plain.artefacts[0]!, path: 'loose.schema.json', byteLength: looseBytes.byteLength, sha256: sha256Hex(looseBytes) }] }
  const looseBindingBytes = bindingBytes(loose)
  const dim = { ...product(), lumens: 0 }
  const strictInput = input(envelope({ product: dim }, 'example-lamp-plain', plainDigest), { profile: 'example-lamp-plain' })
  const looseInput = input(envelope({ product: dim }, 'example-lamp-loose', sha256Hex(looseBindingBytes)), { profile: 'example-lamp-loose' })

  const both = async (): Promise<ProfileRegistry> => {
    const own = createProfileRegistry({ trustedBindingDigests: [plainDigest, sha256Hex(looseBindingBytes)] })
    expect((await own.register({ bindingBytes: plainBytes, resolveArtefact: resolveSynthetic })).ok).toBe(true)
    expect((await own.register({ bindingBytes: looseBindingBytes, resolveArtefact: (a) => (a.path === 'loose.schema.json' ? looseBytes : resolveSynthetic(a)) })).ok).toBe(true)
    return own
  }

  it('answers unknown for the binding that came second, and never passes it on the first one\'s schema', async () => {
    const validate = bindingPayloadValidator({ registry: await both(), engines: { jsonSchema: compiler() } })
    // Loose first: zero lumens is allowed by its own schema.
    expect((await validate(looseInput)).status).toBe('pass')
    // The strict binding refuses zero lumens. Reusing the loose schema would have passed it.
    const strict = await validate(strictInput)
    expect(strict).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect(stepOf(strict, 'json-schema')?.messages?.[0]).toContain(strictSchema.$id)
  })

  it('answers unknown in the other order too, instead of failing a valid product on the wrong schema', async () => {
    const validate = bindingPayloadValidator({ registry: await both(), engines: { jsonSchema: compiler() } })
    expect((await validate(strictInput)).status).toBe('fail')
    expect(await validate(looseInput)).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
  })

  it('checks each against its own schema when each validator has its own compiler', async () => {
    const own = await both()
    expect((await bindingPayloadValidator({ registry: own, engines: { jsonSchema: compiler() } })(looseInput)).status).toBe('pass')
    expect((await bindingPayloadValidator({ registry: own, engines: { jsonSchema: compiler() } })(strictInput)).status).toBe('fail')
  })
})

describe('bindingPayloadValidator: json-ld-expand', () => {
  it('hands the engine the product document and the binding\'s contexts, and nothing else', async () => {
    const calls: Array<{ document: unknown; contexts: Array<{ uri: string; bytes: Uint8Array }> }> = []
    await run(envelope(), { ...allEngines(), jsonLd: jsonLd(undefined, calls) })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.document).toEqual(product())
    expect(calls[0]!.contexts.map((c) => [c.uri, new TextDecoder().decode(c.bytes)])).toEqual([[SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES['context.jsonld']]])
  })

  const unlisted: Array<[string, unknown]> = [
    ['a context the binding does not list', 'https://elsewhere.example/context.jsonld'],
    ['a listed context beside one that is not', [SYNTHETIC_CONTEXT_URI, 'https://elsewhere.example/context.jsonld']],
    ['a context written into the document', { name: 'https://elsewhere.example/name' }],
    ['a listed context beside one written into the document', [SYNTHETIC_CONTEXT_URI, { lumens: 'https://elsewhere.example/lumens' }]],
    ['a null context, which would clear the listed one', [SYNTHETIC_CONTEXT_URI, null]],
    ['a relative context reference', 'context.jsonld'],
  ]
  it.each(unlisted)('refuses %s before any engine runs', async (_name, context) => {
    const calls: unknown[] = []
    for (const engines of [{ jsonSchema: compiler(), jsonLd: jsonLd(undefined, calls), shacl: shacl([], undefined, calls) }, { jsonSchema: compiler() }]) {
      const result = await run(envelope({ product: { ...product(), '@context': context } }), engines)
      expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
      expect(stepOf(result, 'json-ld-expand')).toMatchObject({ status: 'fail', cause: 'profile-rule-violation' })
    }
    expect(calls).toEqual([])
  })

  it('refuses an unlisted context nested inside the product document', async () => {
    const schemaFree = { ...allEngines(), jsonSchema: { compile: () => Object.assign(() => true, { errors: null }), getSchema: () => undefined } }
    const result = await run(envelope({ product: { ...product(), part: { '@context': 'https://elsewhere.example/part.jsonld', name: 'Shade' } } }), schemaFree)
    expect(stepOf(result, 'json-ld-expand')).toMatchObject({ status: 'fail', cause: 'profile-rule-violation' })
    expect(stepOf(result, 'json-ld-expand')?.messages?.[0]).toContain('https://elsewhere.example/part.jsonld')
  })

  it('refuses a product document that names no context', async () => {
    const bare = product()
    delete bare['@context']
    const result = await run(envelope({ product: bare }))
    expect(stepOf(result, 'json-ld-expand')).toMatchObject({ status: 'fail', cause: 'profile-rule-violation' })
  })

  it('fails when the engine refuses a context or the document', async () => {
    for (const reason of ['context-not-listed', 'document-invalid'] as const) {
      const result = await run(envelope(), { ...allEngines(), jsonLd: jsonLd({ ok: false, reason, detail: 'the engine said no' }) })
      expect(result).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
      expect(stepOf(result, 'json-ld-expand')?.messages?.[0]).toContain('the engine said no')
    }
  })

  it('answers unknown without an engine, on a timeout, on an engine error and when the engine throws', async () => {
    const cases: Array<[string, ValidationEngines]> = [
      ['no engine', { jsonSchema: compiler(), shacl: shacl() }],
      ['timeout', { ...allEngines(), jsonLd: jsonLd({ ok: false, reason: 'timeout', detail: 'gave up after 10 ms' }) }],
      ['engine error', { ...allEngines(), jsonLd: jsonLd({ ok: false, reason: 'engine-error', detail: 'library missing' }) }],
      ['throws', { ...allEngines(), jsonLd: { toRdf: async () => { throw new Error('boom') } } }],
    ]
    for (const [name, engines] of cases) {
      const result = await run(envelope(), engines)
      expect(result, name).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
      expect(stepOf(result, 'json-ld-expand'), name).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
      // Without RDF there is nothing for the shapes to check, so that step could not run either.
      expect(stepOf(result, 'shacl'), name).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
      expect(stepOf(result, 'passport-identity'), name).toMatchObject({ status: 'pass' })
    }
  })
})

describe('bindingPayloadValidator: shacl', () => {
  const violation: EngineFinding = { severity: 'Violation', constraint: 'MinCountConstraintComponent', focusNode: 'https://id.example/a', path: 'https://profiles.example/lamp/v1#lumens', message: 'Less than 1 values' }
  const warning: EngineFinding = { severity: 'Warning', constraint: 'MinCountConstraintComponent', focusNode: 'https://id.example/a', path: 'https://profiles.example/lamp/v1#careNote', message: 'A care note is recommended.' }
  const info: EngineFinding = { severity: 'Info', constraint: 'SPARQLConstraintComponent', focusNode: 'https://id.example/a', message: 'For information.' }

  it('hands the engine the expanded data, the shapes and the background', async () => {
    const calls: Array<{ nquads: string; shapes: Array<{ path: string; mediaType: string; bytes: Uint8Array }>; background: Array<{ path: string; mediaType: string; bytes: Uint8Array }> }> = []
    await run(envelope(), { ...allEngines(), shacl: shacl([], undefined, calls) })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.nquads).toBe(NQUADS)
    expect(calls[0]!.shapes.map((f) => [f.path, f.mediaType, new TextDecoder().decode(f.bytes)])).toEqual([['shapes.ttl', 'text/turtle', SYNTHETIC_FILES['shapes.ttl']]])
    expect(calls[0]!.background.map((f) => [f.path, f.mediaType, new TextDecoder().decode(f.bytes)])).toEqual([['background.ttl', 'text/turtle', SYNTHETIC_FILES['background.ttl']]])
  })

  it('fails on a finding of a blocking severity and carries every finding in the detail', async () => {
    const result = await run(envelope(), { ...allEngines(), shacl: shacl([warning, violation]) })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'fail', cause: 'profile-rule-violation', findings: [warning, violation] })
  })

  it('passes with findings the binding does not list as blocking, and still reports them', async () => {
    const result = await run(envelope(), { ...allEngines(), shacl: shacl([warning, info]) })
    expect(result.status).toBe('pass')
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'pass', findings: [warning, info] })
  })

  it('fails on a warning under a binding that lists warnings as blocking', async () => {
    const strict = bindingBytes({ ...syntheticBinding(), id: 'example-lamp-strict', profile: 'example-lamp-strict@1', validation: { ...syntheticBinding().validation, blockingSeverities: ['Violation', 'Warning'] } })
    const own = createProfileRegistry({ trustedBindingDigests: [sha256Hex(strict)] })
    expect((await own.register({ bindingBytes: strict, resolveArtefact: resolveSynthetic })).ok).toBe(true)
    const validate = bindingPayloadValidator({ registry: own, engines: { ...allEngines(), shacl: shacl([warning]) } })
    const result = await validate(input(envelope({}, 'example-lamp-strict', sha256Hex(strict)), { profile: 'example-lamp-strict' }))
    expect(result).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
  })

  it('answers unknown without an engine', async () => {
    const result = await run(envelope(), { jsonSchema: compiler(), jsonLd: jsonLd() })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
  })

  it('answers unknown, without asking the engine, when it lacks a capability the binding requires', async () => {
    const calls: unknown[] = []
    const result = await run(envelope(), { ...allEngines(), shacl: shacl([], ['shacl-core'], calls) })
    expect(result).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
    expect(stepOf(result, 'shacl')?.messages?.[0]).toContain('shacl-sparql-constraints')
    // A core-only engine would have found nothing wrong, and that silence must not read as a pass.
    expect(calls).toEqual([])
  })

  it('answers unknown on a timeout, on an engine error and when the engine throws', async () => {
    const answers: ShaclEngine[] = [
      { capabilities: ['shacl-core', 'shacl-sparql-constraints'], validate: async () => ({ ok: false, reason: 'timeout', detail: 'gave up after 10 ms' }) },
      { capabilities: ['shacl-core', 'shacl-sparql-constraints'], validate: async () => ({ ok: false, reason: 'engine-error', detail: 'shapes did not parse' }) },
      { capabilities: ['shacl-core', 'shacl-sparql-constraints'], validate: async () => { throw new Error('boom') } },
    ]
    for (const engine of answers) {
      const result = await run(envelope(), { ...allEngines(), shacl: engine })
      expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    }
  })

  it('does not run when the product was refused before it expanded', async () => {
    const calls: unknown[] = []
    const result = await run(envelope({ product: { ...product(), '@context': 'https://elsewhere.example/context.jsonld' } }), { ...allEngines(), shacl: shacl([], undefined, calls) })
    expect(result.status).toBe('fail')
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'unknown' })
    expect(calls).toEqual([])
  })
})

describe('bindingPayloadValidator: passport-identity', () => {
  it('fails a valid document that belongs to another passport', async () => {
    const result = await run(envelope(), allEngines(), { passportId: `https://passports.example/01/${GTIN}/21/LAMP-0002` })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-identity-mismatch' } })
    expect(stepOf(result, 'passport-identity')).toMatchObject({ status: 'fail', cause: 'product-identity-mismatch', messages: ['The product document describes a different product from the passport that carries it.'] })
    // Every profile rule held: only the identity check stands between this document and a pass.
    expect(detailOf(result).steps.filter((s) => s.status !== 'pass').map((s) => s.step)).toEqual(['passport-identity'])
  })

  it('answers unknown, never pass, when no passport identifier is supplied', async () => {
    const result = await bindingPayloadValidator({ registry, engines: allEngines() })({ profile: 'example-lamp', profileVersion: 1, payloadPublic: JSON.stringify(envelope()) })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'product-identity-unavailable' } })
    expect(stepOf(result, 'passport-identity')).toMatchObject({ status: 'unknown', cause: 'product-identity-unavailable' })
  })

  it('answers unknown for a subject it cannot read', async () => {
    const result = await run(envelope({ product: { ...product(), id: 'urn:uuid:5b1d0c4e-0000-4000-8000-000000000001' } }))
    expect(result).toMatchObject({ status: 'unknown', detail: { cause: 'product-identity-unavailable' } })
  })
})

describe('bindingPayloadValidator: the outcome rule', () => {
  it('lets a failure at any step outrank a step that could not run', async () => {
    const result = await run(envelope(), { jsonSchema: compiler() }, { passportId: `https://passports.example/01/${GTIN}/21/LAMP-0002` })
    expect(detailOf(result).steps.map((s) => [s.step, s.status])).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['json-schema', 'pass'], ['json-ld-expand', 'unknown'], ['shacl', 'unknown'], ['passport-identity', 'fail']])
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-identity-mismatch' } })
  })

  it('names the first failure when several steps fail', async () => {
    const result = await run(envelope({ product: { ...product(), lumens: 0 } }), allEngines(), { passportId: `https://passports.example/01/${GTIN}/21/LAMP-0002` })
    expect(detailOf(result).cause).toBe('schema-invalid')
    expect(detailOf(result).steps.filter((s) => s.status === 'fail').map((s) => s.step)).toEqual(['json-schema', 'passport-identity'])
  })

  it('never passes when anything a step needs is missing', async () => {
    const pieces: Array<[string, (e: ValidationEngines) => ValidationEngines, Partial<PayloadToValidate>]> = [
      ['no engines at all', () => ({}), {}],
      ['no schema compiler', (e) => ({ ...e, jsonSchema: undefined }), {}],
      ['no JSON-LD engine', (e) => ({ ...e, jsonLd: undefined }), {}],
      ['no SHACL engine', (e) => ({ ...e, shacl: undefined }), {}],
      ['a SHACL engine without SPARQL', (e) => ({ ...e, shacl: shacl([], ['shacl-core']) }), {}],
      ['a SHACL engine that declares nothing', (e) => ({ ...e, shacl: shacl([], []) }), {}],
      ['no passport identifier', (e) => e, { passportId: undefined }],
    ]
    for (const [name, change, over] of pieces) {
      const result = await run(envelope(), change(allEngines()), over)
      expect(result.status, name).toBe('unknown')
      expect(result.reasonCode, name).toBe('schema-unavailable')
    }
    const none = await bindingPayloadValidator({ registry })(input(envelope()))
    expect(none.status).toBe('unknown')
  })
})

describe('bindingPayloadValidator: a manifest-format profile through the same validator', () => {
  const general = { profile: 'general', profile_version: 2, colour: 'red' }

  it('answers as profilePayloadValidator does, with the caller\'s compiler', async () => {
    const ajv = compiler()
    const own = await bindingPayloadValidator({ registry, engines: { jsonSchema: ajv } })({ profile: 'general', profileVersion: 2, payloadPublic: JSON.stringify(general), passportId })
    const reference = await profilePayloadValidator(compiler())({ profile: 'general', profileVersion: 2, payloadPublic: JSON.stringify(general) })
    expect(reference.status).toBe('fail')
    expect(own).toEqual(reference)
  })

  it('answers unknown without a compiler', async () => {
    const result = await bindingPayloadValidator({ registry })({ profile: 'general', profileVersion: 2, payloadPublic: JSON.stringify(general) })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { profile: 'general@2', cause: 'validator-unavailable' } })
  })
})
