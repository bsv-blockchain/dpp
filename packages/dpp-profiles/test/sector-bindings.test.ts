import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BUNDLED_BINDINGS,
  BUNDLED_BINDING_DIGESTS,
  authorisedPayloadValidator,
  buildGs1DigitalLink,
  createProfileRegistry,
  isDemonstrationGtin,
  parseGs1DigitalLink,
  registerBundledBindings,
  splitProductByAccess,
  type BindingArtefact,
  type BindingValidationDetail,
  type PayloadValidation,
  type ProfileBinding,
  type ProfileRegistry,
  type ValidationEngines,
} from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'

// The two sector bindings the package bundles, taken through the whole
// pipeline with the real engines: registered from the package folder, then
// every vector checked as a reader who holds both parts of a state checks it.
//
// The product documents under test/fixtures/sector-bindings/ are unmodified
// copies. Every payload here is made from one of them in memory, so no
// altered copy of a document is stored: a positive vector is the document
// with its note members removed, and each negative is a positive vector
// with the one change its case names. Both bindings split the document into
// a public and a restricted part, so each is cut as its binding says and the
// two parts are checked together, which checks the whole document. What a
// reader of the public payload alone can decide is in sector-access.test.ts.
const packageRoot = join(import.meta.dirname, '..')
const NOTICE = 'Demonstration record: this passport describes no real product.'
/** The passport is issued under the writer's own host, which is not the host the product document names. */
const PASSPORT_HOST = 'passports.example'

type Json = Record<string, unknown>
interface Expected { status: 'pass' | 'fail' | 'unknown'; cause?: string; step?: string; constraint?: string }
interface PayloadCase { name: string; description: string; from: string; passportOf?: string; set?: Json; remove?: string[]; expected: Expected }
interface RegistrationCase { name: string; description: string; expected: { refusal: string; artefact: string } }
type Case = PayloadCase | RegistrationCase
const isRegistration = (c: Case): c is RegistrationCase => 'refusal' in c.expected

const sectors = BUNDLED_BINDINGS.map(({ profile, bindingDigest }) => {
  const folder = join(packageRoot, 'bindings', profile)
  const fixtures = join(packageRoot, 'test', 'fixtures', 'sector-bindings', profile)
  const binding = JSON.parse(readFileSync(join(folder, 'binding.json'), 'utf8')) as ProfileBinding
  const documents = new Map(binding.vectors.positive.map((path) => [path, JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as Json]))
  const cases = binding.vectors.negative.flatMap((path) => (JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as { cases: Case[] }).cases)
  return { profile, bindingDigest, folder, binding, documents, cases }
})
type Sector = (typeof sectors)[number]
const each = sectors.map((s) => [s.profile, s] as const)

/** The document without the members whose name starts `_comment`, at any depth. They are notes for a reader, and no context defines them. */
const withoutNotes = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutNotes)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node).filter(([name]) => !name.startsWith('_comment')).map(([name, value]) => [name, withoutNotes(value)]))
}
const hasNotes = (node: unknown): boolean => (Array.isArray(node) ? node.some(hasNotes) : node !== null && typeof node === 'object' && Object.entries(node).some(([name, value]) => name.startsWith('_comment') || hasNotes(value)))

const published = (sector: Sector, path: string): Json => structuredClone(sector.documents.get(path)!)
const positive = (sector: Sector, path: string): Json => withoutNotes(published(sector, path)) as Json
/** The passport identifier a writer would issue for the document's product: the document's own GTIN and serial, under the writer's host. */
const passportIdOf = (document: Json): string => {
  const link = parseGs1DigitalLink(document.id as string)
  return buildGs1DigitalLink(PASSPORT_HOST, link.gtin, link.serial!)
}
const envelope = (sector: Sector, product: Json, bindingDigest = sector.bindingDigest): Json => ({ notice: NOTICE, profile: sector.binding.id, profile_version: sector.binding.version, profile_binding_sha256: bindingDigest, product })

/** The product with a case's `set` members written and its `remove` pointers deleted. */
const changed = (product: Json, change: Pick<PayloadCase, 'set' | 'remove'>): Json => {
  const copy = { ...structuredClone(product), ...(change.set ?? {}) }
  for (const pointer of change.remove ?? []) {
    const tokens = pointer.split('/').slice(1)
    let at: Json = copy
    for (const token of tokens.slice(0, -1)) at = at[token] as Json
    expect(Object.hasOwn(at, tokens.at(-1)!), `${pointer} is there to remove`).toBe(true)
    delete at[tokens.at(-1)!]
  }
  return copy
}

let networkAttempts = 0
const realFetch = globalThis.fetch
let engines: ValidationEngines
let coreOnly: ValidationEngines
let registry: ProfileRegistry

beforeAll(async () => {
  // Validation must not need the network. Any attempt is counted, and fails.
  globalThis.fetch = (async () => { networkAttempts += 1; throw new Error('the network is off for these tests') }) as typeof fetch
  engines = await createValidationEngine()
  coreOnly = await createValidationEngine({ sparql: false })
  registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
  for (const result of await registerBundledBindings(registry)) expect(result).toMatchObject({ ok: true, alreadyRegistered: false })
})
afterAll(() => { globalThis.fetch = realFetch })

/** The envelope's product cut in two, and both parts checked together. */
const validate = (sector: Sector, payload: Json, options: { passportId?: string; engines?: ValidationEngines; registry?: ProfileRegistry } = {}): Promise<PayloadValidation> => {
  const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product: payload.product as Json })
  return authorisedPayloadValidator({ registry: options.registry ?? registry, engines: options.engines ?? engines })({
    profile: sector.binding.id,
    profileVersion: sector.binding.version,
    payloadPublic: JSON.stringify({ ...payload, product: publicProduct }),
    ...(restrictedProduct == null ? {} : { restrictedProduct }),
    ...(options.passportId == null ? {} : { passportId: options.passportId }),
  })
}
const stepsOf = (result: PayloadValidation): BindingValidationDetail['steps'] => (result.detail as BindingValidationDetail).steps
const violationsOf = (result: PayloadValidation): string[] => (stepsOf(result).find((s) => s.step === 'shacl')?.findings ?? []).filter((f) => f.severity === 'Violation').map((f) => f.constraint)

/** What each case does beyond its `set` and `remove`: how the payload is built and what it is checked with. */
const SPECIAL: Record<string, (sector: Sector, c: PayloadCase) => Promise<PayloadValidation>> = {
  'notes-kept': (sector, c) => {
    const document = published(sector, c.from)
    expect(hasNotes(document)).toBe(true)
    return validate(sector, envelope(sector, document), { passportId: passportIdOf(document) })
  },
  'unlisted-context': (sector, c) => {
    const product = positive(sector, c.from)
    return validate(sector, envelope(sector, { ...product, '@context': [...(product['@context'] as string[]), 'https://contexts.example/unlisted.jsonld'] }), { passportId: passportIdOf(product) })
  },
  'no-passport-identifier': (sector, c) => validate(sector, envelope(sector, positive(sector, c.from))),
  'engine-outage': (sector, c) => {
    const product = positive(sector, c.from)
    const down: ValidationEngines = { jsonLd: engines.jsonLd!, shacl: { capabilities: engines.shacl!.capabilities, validate: async () => { throw new Error('the engine is not running') } } }
    return validate(sector, envelope(sector, product), { passportId: passportIdOf(product), engines: down })
  },
  'wrong-binding-digest': (sector, c) => {
    const product = positive(sector, c.from)
    // The other bundled binding's digest: a real binding, and not this profile's.
    const other = sectors.find((s) => s !== sector)!.bindingDigest
    return validate(sector, envelope(sector, product, other), { passportId: passportIdOf(product) })
  },
}
const run = (sector: Sector, c: PayloadCase): Promise<PayloadValidation> => {
  const special = SPECIAL[c.name]
  if (special != null) return special(sector, c)
  const base = positive(sector, c.from)
  // The passport is the unchanged document's, or another vector's where the case says so.
  return validate(sector, envelope(sector, changed(base, c)), { passportId: passportIdOf(c.passportOf == null ? base : positive(sector, c.passportOf)) })
}

describe('the sector bindings accept their positive vectors', () => {
  const positives = sectors.flatMap((s) => s.binding.vectors.positive.map((path) => [`${s.profile} ${path}`, s, path] as const))

  it('each sector has two, and neither states one GTIN in its identifier and another beside it', () => {
    for (const s of sectors) {
      expect(s.binding.vectors.positive.length).toBe(2)
      for (const document of s.documents.values()) {
        const link = parseGs1DigitalLink(document.id as string)
        expect(link.serial).toBeDefined()
        expect(isDemonstrationGtin(link.gtin)).toBe(true)
        expect(document['gs1:gtin']).toBe(link.gtin)
      }
    }
  })

  it.each(positives)('%s passes every step under a passport at another host', async (_name, sector, path) => {
    const product = positive(sector, path)
    const passportId = passportIdOf(product)
    expect(new URL(passportId).host).not.toBe(new URL(product.id as string).host)
    const result = await validate(sector, envelope(sector, product), { passportId })
    expect(result.status, JSON.stringify(result.detail)).toBe('pass')
    expect(result.reasonCode).toBeUndefined()
    expect(stepsOf(result).map((s) => [s.step, s.status])).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(violationsOf(result)).toEqual([])
  })

  it.each(positives)('%s is the published document less its note members, and nothing else', (_name, sector, path) => {
    const document = published(sector, path)
    const product = positive(sector, path)
    const removed = Object.keys(document).filter((name) => !Object.hasOwn(product, name))
    expect(removed.length).toBeGreaterThan(0)
    expect(removed.every((name) => name.startsWith('_comment'))).toBe(true)
    for (const name of Object.keys(product)) if (!hasNotes(document[name])) expect(product[name]).toEqual(document[name])
  })
})

describe('the sector bindings refuse, or cannot decide, their negative cases', () => {
  const NAMES = ['altered-artefact', 'conflicting-gtin', 'conflicting-serial', 'engine-outage', 'granularity-mismatch', 'granularity-product-link', 'missing-required-property', 'model-level-document', 'no-passport-identifier', 'notes-kept', 'other-product', 'unlisted-context', 'wrong-binding-digest']
  const payloadCases = sectors.flatMap((s) => s.cases.filter((c): c is PayloadCase => !isRegistration(c)).map((c) => [`${s.profile} ${c.name}`, s, c] as const))
  const byName = (sector: Sector, name: string): PayloadCase => sector.cases.find((c): c is PayloadCase => c.name === name && !isRegistration(c))!

  it.each(each)('%s lists every case a sector binding is asked to carry', (_profile, sector) => {
    expect(sector.cases.map((c) => c.name).sort()).toEqual(NAMES)
    for (const c of sector.cases) if (!isRegistration(c)) expect(sector.binding.vectors.positive, c.name).toContain(c.from)
  })

  it.each(payloadCases)('%s', async (_name, sector, c) => {
    expect(c.expected.status).not.toBe('pass')
    const result = await run(sector, c)
    const detail = result.detail as BindingValidationDetail
    expect(result.status, JSON.stringify(detail)).toBe(c.expected.status)
    expect(result.reasonCode).toBe(c.expected.status === 'fail' ? 'schema-invalid' : 'schema-unavailable')
    expect(detail.cause).toBe(c.expected.cause)
    // The step that decided the answer: the first that failed, or the first that could not run.
    expect(detail.steps.find((s) => s.status === c.expected.status)?.step).toBe(c.expected.step)
    if (c.expected.constraint != null) expect(violationsOf(result)).toEqual([c.expected.constraint])
  })

  it.each(each)('%s: the published document is refused for its note members alone', async (_profile, sector) => {
    for (const path of sector.binding.vectors.positive) {
      const document = published(sector, path)
      const result = await validate(sector, envelope(sector, document), { passportId: passportIdOf(document) })
      expect(result).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
      expect(stepsOf(result).find((s) => s.step === 'json-ld-expand')?.messages?.[0]).toMatch(/"property":"_comment/)
    }
  })

  it.each(each)('%s: every identity case satisfies the shapes, so only the identity check stands between it and a pass', async (_profile, sector) => {
    for (const name of ['other-product', 'conflicting-serial', 'conflicting-gtin']) {
      const steps = stepsOf(await run(sector, byName(sector, name)))
      expect(steps.filter((s) => s.step !== 'passport-identity').every((s) => s.status === 'pass'), name).toBe(true)
    }
  })

  it.each(each)('%s: the declared granularity is found by the SPARQL constraint, which an engine without SPARQL does not report', async (_profile, sector) => {
    const c = byName(sector, 'granularity-mismatch')
    const product = changed(positive(sector, c.from), c)
    const registered = registry.resolve(sector.binding.id, sector.binding.version)
    if (registered?.format !== 'binding') throw new Error('expected a binding')
    const files = (role: BindingArtefact['role']) => registered.artefacts.filter((a) => a.artefact.role === role).map((a) => ({ path: a.artefact.path, mediaType: a.artefact.mediaType, bytes: a.bytes }))
    const expansion = await engines.jsonLd!.toRdf({ document: product, contexts: registered.artefacts.filter((a) => a.artefact.role === 'context').map((a) => ({ uri: a.artefact.uri!, bytes: a.bytes })) })
    if (!expansion.ok) throw new Error(expansion.detail)

    // Asked directly, the two engines disagree on the same data and shapes: the difference is the SPARQL constraint.
    const input = { nquads: expansion.nquads, shapes: files('shapes'), background: files('background') }
    const full = await engines.shacl!.validate(input)
    const core = await coreOnly.shacl!.validate(input)
    if (!full.ok || !core.ok) throw new Error('an engine did not finish')
    expect(full.findings.filter((f) => f.severity === 'Violation').map((f) => f.constraint)).toEqual(['SPARQLConstraintComponent'])
    expect(core.findings.filter((f) => f.severity === 'Violation')).toEqual([])

    // Through the validator, the engine without SPARQL is never asked: its silence is not allowed to count.
    const withCore = await validate(sector, envelope(sector, product), { passportId: passportIdOf(positive(sector, c.from)), engines: coreOnly })
    const shacl = stepsOf(withCore).find((s) => s.step === 'shacl')
    expect(shacl).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
    expect(shacl?.messages?.[0]).toContain('shacl-sparql-constraints')
    expect(withCore.status).not.toBe('pass')
  })

  it.each(each)('%s: a granularity fault only SPARQL can find is unknown, never pass, with an engine that lacks SPARQL', async (_profile, sector) => {
    const c = byName(sector, 'granularity-product-link')
    const base = positive(sector, c.from)
    const input = [sector, envelope(sector, changed(base, c)), { passportId: passportIdOf(base) }] as const
    const withCore = await validate(input[0], input[1], { ...input[2], engines: coreOnly })
    expect(withCore).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    // Every other step passed, the identity check among them: without the capability check this payload would have been a pass.
    expect(stepsOf(withCore).filter((s) => s.step !== 'shacl').every((s) => s.status === 'pass')).toBe(true)
    expect((await validate(...input)).status).toBe('fail')
  })

  it.each(each)('%s: a model-level document is refused by the identity check whatever the shapes say', async (_profile, sector) => {
    const result = await run(sector, byName(sector, 'model-level-document'))
    const identity = stepsOf(result).find((s) => s.step === 'passport-identity')
    expect(identity).toMatchObject({ status: 'fail', cause: 'product-identity-mismatch' })
    expect(identity?.messages?.[0]).toBe('The product document describes a model, not a serialised item.')
  })

  it.each(each)('%s: with no engine at all the answer is unknown', async (_profile, sector) => {
    const product = positive(sector, sector.binding.vectors.positive[0]!)
    const result = await validate(sector, envelope(sector, product), { passportId: passportIdOf(product), engines: {} })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect(stepsOf(result).filter((s) => s.status === 'unknown').map((s) => s.step)).toEqual(['json-ld-expand', 'shacl'])
  })

  it.each(each)('%s: a profile that was never registered is unknown', async (_profile, sector) => {
    const product = positive(sector, sector.binding.vectors.positive[0]!)
    const empty = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    expect(await validate(sector, envelope(sector, product), { passportId: passportIdOf(product), registry: empty })).toMatchObject({ status: 'unknown', detail: { cause: 'profile-unknown' } })
  })

  it.each(each)('%s: an altered artefact is refused at registration, so the profile never becomes usable', async (_profile, sector) => {
    const c = sector.cases.find(isRegistration)!
    const fresh = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    const result = await fresh.register({
      bindingBytes: new Uint8Array(readFileSync(join(sector.folder, 'binding.json'))),
      resolveArtefact: (artefact) => {
        const bytes = new Uint8Array(readFileSync(join(sector.folder, artefact.path)))
        // One byte changed and the length kept, so only the digest can tell.
        if (artefact.path === c.expected.artefact) bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1
        return bytes
      },
    })
    expect(result).toMatchObject({ ok: false, code: c.expected.refusal, artefact: c.expected.artefact, profile: sector.profile })
    expect(fresh.resolve(sector.binding.id, sector.binding.version)).toBeUndefined()
  })
})

describe('validation under the sector bindings', () => {
  // Last in the file on purpose: it counts every attempt the tests above could have made.
  it('never reached for the network', () => {
    expect(networkAttempts).toBe(0)
    expect(globalThis.fetch).not.toBe(realFetch)
  })
})
