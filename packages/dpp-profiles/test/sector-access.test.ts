import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_PAYLOAD_PUBLIC_BYTES_V2 } from '@bsv/dpp-protocol'
import {
  HISTORICAL_SECTOR_BINDINGS,
  BUNDLED_BINDING_DIGESTS,
  CURRENT_SECTOR_BINDINGS,
  PUBLIC_PAYLOAD_MAX_BYTES,
  assembleProduct,
  authorisedPayloadValidator,
  bindingPayloadValidator,
  buildGs1DigitalLink,
  createProfileRegistry,
  describeArtefact,
  parseGs1DigitalLink,
  prepareBoundPayload,
  profileBindingDigest,
  registerBundledBindings,
  splitProductByAccess,
  type BindingValidationDetail,
  type PayloadValidation,
  type PreparedBoundPayload,
  type ProfileBinding,
  type ProfileRegistry,
  type ValidationEngines,
} from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'

// The two bundled sector bindings split a product document into a public
// payload and a restricted part. These tests take the product documents under
// test/fixtures/sector-bindings/ through that split with the real engines:
// what the writer prepares, what any reader can decide from the public
// payload, and what a reader who holds both parts decides.
//
// The documents are unmodified copies. Each is used with its note members
// removed, and every altered document is made in memory.
const packageRoot = join(import.meta.dirname, '..')
const NOTICE = 'Demonstration record: this passport describes no real product.'
const PASSPORT_HOST = 'passports.example'

type Json = Record<string, unknown>
const withoutNotes = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutNotes)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node).filter(([name]) => !name.startsWith('_comment')).map(([name, value]) => [name, withoutNotes(value)]))
}

const sectors = HISTORICAL_SECTOR_BINDINGS.map(({ profile, bindingDigest }) => {
  const folder = join(packageRoot, 'bindings', profile)
  const binding = JSON.parse(readFileSync(join(folder, 'binding.json'), 'utf8')) as ProfileBinding
  const documents = binding.vectors.positive.map((path) => ({ path, product: withoutNotes(JSON.parse(readFileSync(join(packageRoot, 'test', 'fixtures', 'sector-bindings', profile, path), 'utf8'))) as Json }))
  return { profile, bindingDigest, folder, binding, documents }
})
type Sector = Omit<(typeof sectors)[number], 'profile' | 'bindingDigest'> & { profile: string; bindingDigest: string }
const each = sectors.map((s) => [s.profile, s] as const)
const positives = sectors.flatMap((s) => s.documents.map((d) => [`${s.profile} ${d.path}`, s, d.product] as const))
/** The larger document of each sector, which carries restricted properties. */
const rich = (sector: Sector): Json => structuredClone(sector.documents[1]!.product)
const other = (sector: Sector): Json => structuredClone(sector.documents[0]!.product)

const passportIdOf = (product: Json): string => {
  const link = parseGs1DigitalLink(product.id as string)
  return buildGs1DigitalLink(PASSPORT_HOST, link.gtin, link.serial!)
}
const restrictedNames = (sector: Sector, product: Json): string[] => Object.keys(product).filter((name) => !sector.binding.access!.public.includes(name))

/** Every text value at any depth. */
const texts = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) for (const entry of node) texts(entry, found)
  else if (node !== null && typeof node === 'object') for (const value of Object.values(node)) texts(value, found)
  else if (typeof node === 'string') found.push(node)
  return found
}
/**
 * The text values a product holds in restricted properties only. A value the
 * document also states in a public property is public because the document
 * says it there, and no split by property can change that, so such values
 * are counted and set aside.
 */
const restrictedValues = (sector: Sector, product: Json): { values: string[]; restated: string[] } => {
  const names = restrictedNames(sector, product)
  const open = new Set(texts(Object.fromEntries(Object.entries(product).filter(([name]) => !names.includes(name)))))
  const closed = [...new Set(texts(names.map((name) => product[name])))]
  return { values: closed.filter((value) => !open.has(value)), restated: closed.filter((value) => open.has(value)) }
}
/** The restricted values a text repeats, as JSON writes them. */
const leaked = (text: string, values: string[]): string[] => values.filter((value) => text.includes(JSON.stringify(value)))

let networkAttempts = 0
const realFetch = globalThis.fetch
let engines: ValidationEngines
let registry: ProfileRegistry
const logged: unknown[][] = []

beforeAll(async () => {
  // Validation must not need the network. Any attempt is counted, and fails.
  globalThis.fetch = (async () => { networkAttempts += 1; throw new Error('the network is off for these tests') }) as typeof fetch
  // Nothing the package does writes a log line. Anything written is kept and read at the end.
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args) })
  engines = await createValidationEngine()
  registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
  for (const result of await registerBundledBindings(registry)) expect(result).toMatchObject({ ok: true })
})
afterAll(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

const prepare = (sector: Sector, product: Json, over: Partial<Parameters<typeof prepareBoundPayload>[0]> = {}) =>
  prepareBoundPayload({ registry, engines, profile: sector.binding.id, profileVersion: sector.binding.version, product, passportId: passportIdOf(product), notice: NOTICE, ...over })
const prepared = async (sector: Sector, product: Json): Promise<PreparedBoundPayload> => {
  const result = await prepare(sector, product)
  if (!result.ok) throw new Error(`${result.code}: ${result.detail} ${JSON.stringify(result.validation?.detail ?? result.publicView?.detail)}`)
  return result
}
const envelope = (sector: Sector, product: unknown, bindingDigest = sector.bindingDigest): string => JSON.stringify({ notice: NOTICE, profile: sector.binding.id, profile_version: sector.binding.version, profile_binding_sha256: bindingDigest, product })
const publicView = (sector: Sector, payloadPublic: string, passportId: string, own: ProfileRegistry = registry): Promise<PayloadValidation> =>
  bindingPayloadValidator({ registry: own, engines })({ profile: sector.binding.id, profileVersion: sector.binding.version, payloadPublic, passportId })
const detailOf = (result: PayloadValidation): BindingValidationDetail => result.detail as BindingValidationDetail
const order = (result: PayloadValidation) => detailOf(result).steps.map((s) => [s.step, s.status])

/** The public-view answers these tests collect, to be read for restricted values at the end. */
const publicAnswers: Array<{ sector: Sector; product: Json; result: PayloadValidation }> = []

describe('the explicitly selected sector bindings with a required product class', () => {
  const selected = createProfileRegistry({ trustedBindingDigests: CURRENT_SECTOR_BINDINGS.map((entry) => entry.bindingDigest) })
  beforeAll(async () => {
    for (const result of await registerBundledBindings(selected, { profiles: CURRENT_SECTOR_BINDINGS.map((entry) => entry.profile) })) expect(result.ok).toBe(true)
  })

  it.each(each)('%s retains its read rules while its successor validates the same disclosure in all three views', async (_profile, original) => {
    const next = selected.resolve(original.binding.id, 2)
    if (next?.format !== 'binding') throw new Error('expected the successor binding')
    const sector = { ...original, profile: next.profile, binding: next.binding, bindingDigest: next.bindingDigest }
    const id = sector.binding.id
    for (const { product } of sector.documents) {
      const old = await prepared(original, product)
      const result = await prepare(sector, product, { registry: selected })
      if (!result.ok) throw new Error(JSON.stringify(result))
      expect([result.validation.status, result.publicView.status]).toEqual(['pass', 'pass'])
      expect(result.restrictedProduct).toEqual(old.restrictedProduct)
      expect(JSON.parse(result.payloadPublic)).toEqual({ ...JSON.parse(old.payloadPublic), profile_version: 2, profile_binding_sha256: next.bindingDigest })
      expect(result.byteLength).toBe(old.byteLength)
      expect(result.byteLength).toBeLessThanOrEqual(PUBLIC_PAYLOAD_MAX_BYTES)
      const authorised = await authorisedPayloadValidator({ registry: selected, engines })({ profile: id, profileVersion: 2, passportId: passportIdOf(product), payloadPublic: result.payloadPublic, restrictedProduct: result.restrictedProduct })
      expect(authorised.status).toBe('pass')
      expect((await publicView(original, old.payloadPublic, passportIdOf(product))).status).toBe('pass')
    }
    const product = other(original)
    const passportId = passportIdOf(product)
    const { type: _type, ...untyped } = product
    const classFailure = { status: 'fail', detail: { cause: 'profile-rule-violation', steps: expect.arrayContaining([
      expect.objectContaining({ step: 'shacl', findings: expect.arrayContaining([expect.objectContaining({ focusNode: product.id, constraint: 'ClassConstraintComponent' })]) }),
    ]) } }
    for (const changed of [
      untyped,
      { ...untyped, type: 'gs1:Product' },
      { ...untyped, type: 'gs1:Product', '@included': [rich(original)] },
    ]) {
      expect((await prepare(sector, changed, { registry: selected }))).toMatchObject({ ok: false, validation: classFailure })
      const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product: changed })
      const input = { profile: id, profileVersion: 2, passportId, payloadPublic: envelope(sector, publicProduct) }
      expect(await bindingPayloadValidator({ registry: selected, engines })(input)).toMatchObject({ status: 'unknown', detail: { cause: 'restricted-tier-withheld' } })
      expect(await authorisedPayloadValidator({ registry: selected, engines })({ ...input, restrictedProduct })).toMatchObject(classFailure)
    }
    const direct = { ...product, type: next.binding.validation.subjectClass }
    expect(await prepare(sector, direct, { registry: selected })).toMatchObject({ ok: true, validation: { status: 'pass' }, publicView: { status: 'pass' } })
  })
})

describe('a writer prepares the public payload and the restricted part', () => {
  it.each(positives)('%s: the whole document validates, and the public payload validates as any reader checks it', async (_name, sector, product) => {
    const result = await prepared(sector, product)
    expect(result.validation.status).toBe('pass')
    expect(order(result.validation)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(detailOf(result.validation).access).toEqual({ policy: sector.binding.access!.policy, view: 'whole', withheld: [] })
    // Every rule of these shapes that a public payload can break was decided, and held.
    expect(result.publicView.status, JSON.stringify(result.publicView.detail)).toBe('pass')
    expect(order(result.publicView)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(detailOf(result.publicView).access).toEqual({ policy: sector.binding.access!.policy, view: 'public', withheld: [] })
    publicAnswers.push({ sector, product, result: result.publicView })
  })

  it.each(positives)('%s: the public payload is the envelope around the public properties, and nothing else', async (_name, sector, product) => {
    const { payloadPublic } = await prepared(sector, product)
    const payload = JSON.parse(payloadPublic) as { product: Json }
    expect(Object.keys(payload)).toEqual(['notice', 'profile', 'profile_version', 'profile_binding_sha256', 'product'])
    expect(payload).toMatchObject({ notice: NOTICE, profile: sector.binding.id, profile_version: 1, profile_binding_sha256: sector.bindingDigest })
    const names = Object.keys(payload.product)
    for (const name of names) expect(sector.binding.access!.public, name).toContain(name)
    // In the document's own order, each with the value the document gave it.
    expect(names).toEqual(Object.keys(product).filter((name) => sector.binding.access!.public.includes(name)))
    for (const name of names) expect(payload.product[name]).toEqual(product[name])
  })

  it.each(positives)('%s: no restricted value is in the public payload text', async (_name, sector, product) => {
    const { payloadPublic } = await prepared(sector, product)
    const { values } = restrictedValues(sector, product)
    expect(leaked(payloadPublic, values)).toEqual([])
    for (const name of restrictedNames(sector, product)) {
      // Neither the property's name as a member of the product, nor its value written out whole.
      expect(Object.hasOwn((JSON.parse(payloadPublic) as { product: Json }).product, name), name).toBe(false)
      if (product[name] !== null && typeof product[name] === 'object') expect(payloadPublic.includes(JSON.stringify(product[name])), name).toBe(false)
    }
  })

  it('counts what was scanned: the restricted properties of each document, their text values, and the values the document itself restates in a public property', () => {
    const counted = Object.fromEntries(positives.map(([name, sector, product]) => {
      const { values, restated } = restrictedValues(sector, product)
      return [name, { properties: Object.keys(product).length, restricted: restrictedNames(sector, product).length, restrictedValues: values.length, restatedInAPublicProperty: restated.length }]
    }))
    // Recorded, so a change to a document or to a public list shows here. A restated value is public because the
    // document states it publicly as well, such as an operator's name repeated as the manufacturer's.
    expect(counted).toEqual({
      'eu-battery@1 vectors/amperia-staxwall-item.jsonld': { properties: 15, restricted: 3, restrictedValues: 41, restatedInAPublicProperty: 0 },
      'eu-battery@1 vectors/battery-product.jsonld': { properties: 63, restricted: 21, restrictedValues: 185, restatedInAPublicProperty: 17 },
      'eu-textile@1 vectors/fjordline-aurora-item.jsonld': { properties: 10, restricted: 0, restrictedValues: 0, restatedInAPublicProperty: 0 },
      'eu-textile@1 vectors/garment-product.jsonld': { properties: 60, restricted: 13, restrictedValues: 81, restatedInAPublicProperty: 22 },
    })
  })

  it('records the size of each public payload against the limit', async () => {
    expect(PUBLIC_PAYLOAD_MAX_BYTES).toBe(MAX_PAYLOAD_PUBLIC_BYTES_V2)
    const sizes: Record<string, { publicPayload: number; wholeDocument: number }> = {}
    for (const [name, sector, product] of positives) {
      const { payloadPublic, byteLength } = await prepared(sector, product)
      expect(byteLength).toBe(new TextEncoder().encode(payloadPublic).byteLength)
      expect(byteLength).toBeLessThanOrEqual(PUBLIC_PAYLOAD_MAX_BYTES)
      sizes[name] = { publicPayload: byteLength, wholeDocument: new TextEncoder().encode(envelope(sector, product)).byteLength }
    }
    // Minified, in UTF-8 bytes, with the demonstration notice. The second figure is the envelope around the whole document, for comparison.
    expect(sizes).toEqual({
      'eu-battery@1 vectors/amperia-staxwall-item.jsonld': { publicPayload: 830, wholeDocument: 4703 },
      'eu-battery@1 vectors/battery-product.jsonld': { publicPayload: 10319, wholeDocument: 28157 },
      'eu-textile@1 vectors/fjordline-aurora-item.jsonld': { publicPayload: 727, wholeDocument: 727 },
      'eu-textile@1 vectors/garment-product.jsonld': { publicPayload: 19632, wholeDocument: 26190 },
    })
  })

  it.each(positives)('%s: split then rejoined is the original document as data', async (_name, sector, product) => {
    const before = JSON.stringify(product)
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product })
    expect(JSON.stringify(product)).toBe(before)
    const rejoined = assembleProduct({ binding: sector.binding, publicProduct, restrictedProduct })
    expect(rejoined).toEqual({ ok: true, product })
    // The same parts give the same text every time.
    expect(JSON.stringify(assembleProduct({ binding: sector.binding, publicProduct, restrictedProduct }))).toBe(JSON.stringify(rejoined))
    // The restricted part opens with the product's identifier, and a document with nothing restricted has no restricted part.
    if (restrictedNames(sector, product).length === 0) expect(restrictedProduct).toBeUndefined()
    else expect(Object.keys(restrictedProduct!)).toEqual(['id', ...restrictedNames(sector, product)])
    // What the writer is handed is the same cut.
    const result = await prepared(sector, product)
    expect(JSON.parse(result.payloadPublic).product).toEqual(publicProduct)
    expect(result.restrictedProduct).toEqual(restrictedProduct)
  })

  it.each(each)('%s: a property the binding has never heard of goes to the restricted part', (_profile, sector) => {
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product: { ...rich(sector), 'internal:costPrice': '41.90', 'https://vocabulary.example/margin': 0.31 } })
    expect(Object.keys(publicProduct)).not.toContain('internal:costPrice')
    expect(Object.keys(publicProduct)).not.toContain('https://vocabulary.example/margin')
    expect(restrictedProduct).toMatchObject({ 'internal:costPrice': '41.90', 'https://vocabulary.example/margin': 0.31 })
  })

  it.each(each)('%s: refuses a document that fails, including one whose only fault is in a restricted property', async (_profile, sector) => {
    // A serial stated beside the identifier that is another item's.
    expect(await prepare(sector, { ...rich(sector), 'schema:serialNumber': 'ANOTHER-ITEM' })).toMatchObject({ ok: false, code: 'validation-failed', validation: { status: 'fail', detail: { cause: 'product-identity-mismatch' } } })

    // The operator record is restricted in both sectors, and the shapes require its location number.
    const operator = sector.profile === 'eu-battery@1' ? 'eubat:hasOperatorInformation' : 'oec:hasOperatorInformation'
    const faulty = rich(sector)
    expect(sector.binding.access!.public).not.toContain(operator)
    delete (faulty[operator] as Json)['gs1:globalLocationNumber']
    const refused = await prepare(sector, faulty)
    expect(refused).toMatchObject({ ok: false, code: 'validation-failed', validation: { status: 'fail', detail: { cause: 'profile-rule-violation', access: { view: 'whole' } } } })
    expect(Object.hasOwn(refused, 'payloadPublic')).toBe(false)

    // The public payload of that document is the valid document's, so a reader of it alone sees nothing wrong.
    // That is the limit of the public view: it decides the rules the public payload can break, and no others.
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product: faulty })
    const alone = await publicView(sector, envelope(sector, publicProduct), passportIdOf(faulty))
    expect(alone.status).toBe('pass')
    publicAnswers.push({ sector, product: faulty, result: alone })
    const both = await authorisedPayloadValidator({ registry, engines })({ profile: sector.binding.id, profileVersion: 1, payloadPublic: envelope(sector, publicProduct), passportId: passportIdOf(faulty), restrictedProduct })
    expect(both).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
  })

  it.each(each)('%s: refuses a document it could not validate, for want of an engine or of a passport identifier', async (_profile, sector) => {
    const none = await prepare(sector, rich(sector), { engines: {} })
    expect(none).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } } })
    expect(Object.hasOwn(none, 'payloadPublic')).toBe(false)
    expect(await prepare(sector, rich(sector), { engines: await createValidationEngine({ sparql: false }) })).toMatchObject({ ok: false, code: 'validation-unavailable' })
    expect(await prepare(sector, rich(sector), { passportId: undefined as never })).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { detail: { cause: 'product-identity-unavailable' } } })
  })

  it.each(each)('%s: refuses a public payload over the limit, with its actual size, and does not count the restricted part', async (_profile, sector) => {
    const long = { '@value': 'An account of the product. '.repeat(2600), '@language': 'en' }
    const wide = { ...rich(sector), 'gs1:productDescription': [long] }
    const refused = await prepare(sector, wide)
    expect(refused).toMatchObject({ ok: false, code: 'public-payload-too-large', limit: 65535, validation: { status: 'pass' } })
    if (refused.ok) throw new Error('expected a refusal')
    const { publicProduct } = splitProductByAccess({ binding: sector.binding, product: wide })
    expect(refused.byteLength).toBe(new TextEncoder().encode(envelope(sector, publicProduct)).byteLength)
    expect(refused.byteLength).toBeGreaterThan(65535)
    expect(Object.hasOwn(refused, 'payloadPublic')).toBe(false)

    // The same weight in a restricted property leaves the public payload as it was.
    const operator = sector.profile === 'eu-battery@1' ? 'eubat:hasOperatorInformation' : 'oec:hasOperatorInformation'
    const heavy = rich(sector)
    ;(heavy[operator] as Json)['gs1:organizationName'] = 'An operator with a long name. '.repeat(2600)
    const [baseline, weighed] = [await prepared(sector, rich(sector)), await prepared(sector, heavy)]
    expect(new TextEncoder().encode(JSON.stringify(weighed.restrictedProduct)).byteLength).toBeGreaterThan(65535)
    expect(weighed.payloadPublic).toBe(baseline.payloadPublic)
  })
})

describe('any reader checks the public payload alone', () => {
  it.each(each)('%s: a restricted property smuggled into the public payload fails as a disclosure', async (_profile, sector) => {
    const product = rich(sector)
    const { publicProduct } = splitProductByAccess({ binding: sector.binding, product })
    const name = restrictedNames(sector, product)[0]!
    const result = await publicView(sector, envelope(sector, { ...publicProduct, [name]: product[name] }), passportIdOf(product))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'restricted-property-disclosed' } })
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'fail']])
    expect(detailOf(result).steps[2]!.messages).toEqual([`The public payload carries \`${name}\`, which ${sector.binding.access!.policy} does not list as public.`])
    publicAnswers.push({ sector, product, result })
  })

  it.each(each)('%s: the whole document in place of its public part fails the same way, and names every restricted property', async (_profile, sector) => {
    const product = rich(sector)
    const result = await publicView(sector, envelope(sector, product), passportIdOf(product))
    expect(result).toMatchObject({ status: 'fail', detail: { cause: 'restricted-property-disclosed' } })
    expect(detailOf(result).steps[2]!.messages).toHaveLength(restrictedNames(sector, product).length)
    publicAnswers.push({ sector, product, result })
  })

  it('eu-battery@1: a public property the shapes require, left out of the public payload, is a failure and not a withheld check', async () => {
    // The battery shapes require these of every item. The textile shapes require nothing of the item itself.
    const sector = sectors[0]!
    for (const document of sector.documents) {
      const { publicProduct } = splitProductByAccess({ binding: sector.binding, product: document.product })
      for (const dropped of ['schema:schemaVersion', 'oec:hasReportingGranularity', 'eubat:batteryModelIdentifier', 'gs1:hasSerialNumber', 'oec:lastUpdated', 'oec:passportStatus']) {
        const { [dropped]: _dropped, ...rest } = publicProduct
        const result = await publicView(sector, envelope(sector, rest), passportIdOf(document.product))
        expect(result, dropped).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
        expect(detailOf(result).access?.withheld, dropped).toEqual([])
        publicAnswers.push({ sector, product: document.product, result })
      }
    }
  })

  it('eu-textile@1: the shapes require nothing of the item itself, so no public property can be withheld or missed', async () => {
    const sector = sectors[1]!
    const product = rich(sector)
    const { publicProduct } = splitProductByAccess({ binding: sector.binding, product })
    const kept = ['@context', 'id', 'type']
    const result = await publicView(sector, envelope(sector, Object.fromEntries(Object.entries(publicProduct).filter(([name]) => kept.includes(name)))), passportIdOf(product))
    expect(result.status).toBe('pass')
    publicAnswers.push({ sector, product, result })
  })

  it.each(each)('%s: under another item\'s passport the public payload fails the identity check', async (_profile, sector) => {
    const { payloadPublic } = await prepared(sector, rich(sector))
    const result = await publicView(sector, payloadPublic, passportIdOf(other(sector)))
    expect(result).toMatchObject({ status: 'fail', detail: { cause: 'product-identity-mismatch' } })
    publicAnswers.push({ sector, product: rich(sector), result })
  })
})

describe('a binding that restricts a property the shapes require', () => {
  // Each sector binding again, under an identifier of its own, changed so that a rule of its shapes needs a restricted
  // property. For batteries the shapes already require the schema version of every item, so restricting it is enough.
  // The textile shapes require nothing of the item itself, so a second shapes file, written here, requires the water
  // usage record, which the binding restricts. No file of either binding is changed.
  // The same file requires the passport status too, a public property, so a missing public value can be told from a withheld one.
  // A term's IRI sits beside the context that defines it, so each is built from the context's URI as the binding lists it.
  const termOf = (sector: Sector, context: string, term: string): string => new URL(term, sector.binding.artefacts.find((a) => a.path === context)!.uri).href
  const WATER_USAGE = termOf(sectors[1]!, 'textile-context.jsonld', 'hasWaterUsage')
  const PASSPORT_STATUS = termOf(sectors[1]!, 'dpp-core-context.jsonld', 'passportStatus')
  const REQUIRES_WATER = new TextEncoder().encode(`@prefix sh: <http://www.w3.org/ns/shacl#> .\n<https://profiles.example/shapes/WaterUsageRequired> a sh:NodeShape ;\n  sh:targetSubjectsOf <https://ref.gs1.org/voc/gtin> ;\n  sh:property [ sh:path <${WATER_USAGE}> ; sh:minCount 1 ; sh:message "An item states its water usage." ] ;\n  sh:property [ sh:path <${PASSPORT_STATUS}> ; sh:minCount 1 ; sh:message "An item states its passport status." ] .\n`)
  const variants = sectors.map((sector) => {
    const battery = sector.profile === 'eu-battery@1'
    const id = `${sector.binding.id}-withheld`
    const binding: ProfileBinding = {
      ...structuredClone(sector.binding),
      id,
      profile: `${id}@1`,
      publisher: { name: 'This test', registration: 'local' },
      access: { ...sector.binding.access!, policy: `${id}-access@1`, public: sector.binding.access!.public.filter((name) => name !== 'schema:schemaVersion') },
      artefacts: battery ? sector.binding.artefacts : [...sector.binding.artefacts, { role: 'shapes', path: 'requires-water.ttl', mediaType: 'text/turtle', ...describeArtefact(REQUIRES_WATER), licence: 'Apache-2.0' }],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(binding, null, 2) + '\n')
    const expected = battery
      ? { property: 'https://schema.org/schemaVersion', restricted: 'schema:schemaVersion' }
      : { property: WATER_USAGE, restricted: 'eutex:hasWaterUsage' }
    return { sector, binding, bytes, digest: profileBindingDigest(bytes), expected }
  })
  let own: ProfileRegistry
  beforeAll(async () => {
    own = createProfileRegistry({ trustedBindingDigests: variants.map((v) => v.digest) })
    for (const v of variants) {
      const result = await own.register({ bindingBytes: v.bytes, resolveArtefact: (artefact) => (artefact.path === 'requires-water.ttl' ? REQUIRES_WATER : new Uint8Array(readFileSync(join(v.sector.folder, artefact.path)))) })
      expect(result).toMatchObject({ ok: true })
    }
  })

  it.each(variants.map((v) => [v.binding.profile, v] as const))('%s: the public view is unknown, never pass and never fail, and lists the withheld check', async (_profile, v) => {
    const product = rich(v.sector)
    expect(Object.hasOwn(product, v.expected.restricted)).toBe(true)
    const result = await prepareBoundPayload({ registry: own, engines, profile: v.binding.id, profileVersion: 1, product, passportId: passportIdOf(product) })
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    // The writer holds the whole document, which satisfies the rule.
    expect(result.validation.status).toBe('pass')
    expect(JSON.parse(result.payloadPublic).product).not.toHaveProperty([v.expected.restricted])

    for (const answer of [result.publicView, await bindingPayloadValidator({ registry: own, engines })({ profile: v.binding.id, profileVersion: 1, payloadPublic: result.payloadPublic, passportId: passportIdOf(product) })]) {
      expect(answer.status).toBe('unknown')
      expect(answer.reasonCode).toBe('schema-unavailable')
      const detail = detailOf(answer)
      expect(detail.cause).toBe('restricted-tier-withheld')
      expect(detail.access).toMatchObject({ policy: v.binding.access!.policy, view: 'public' })
      expect(detail.access!.withheld.map((w) => [w.step, w.property, w.constraint])).toEqual([['shacl', v.expected.property, 'MinCountConstraintComponent']])
      expect(order(answer)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'unknown'], ['passport-identity', 'pass']])
      publicAnswers.push({ sector: { ...v.sector, binding: v.binding }, product, result: answer })
    }

    // With both parts the rule is decided, and holds.
    const both = await authorisedPayloadValidator({ registry: own, engines })({ profile: v.binding.id, profileVersion: 1, payloadPublic: result.payloadPublic, passportId: passportIdOf(product), restrictedProduct: result.restrictedProduct })
    expect(both.status).toBe('pass')
  })

  it.each(variants.map((v) => [v.binding.profile, v] as const))('%s: a missing public property fails beside the withheld check, and the two are told apart', async (_profile, v) => {
    const product = rich(v.sector)
    const { 'oec:passportStatus': _status, ...publicProduct } = splitProductByAccess({ binding: v.binding, product }).publicProduct
    const payloadPublic = JSON.stringify({ profile: v.binding.id, profile_version: 1, profile_binding_sha256: v.digest, product: publicProduct })
    const result = await bindingPayloadValidator({ registry: own, engines })({ profile: v.binding.id, profileVersion: 1, payloadPublic, passportId: passportIdOf(product) })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
    const shacl = detailOf(result).steps.find((s) => s.step === 'shacl')!
    // The failure names the public property only. The restricted one stays a withheld check.
    expect(shacl.messages).toHaveLength(1)
    expect(shacl.messages![0]).toContain(PASSPORT_STATUS)
    expect(detailOf(result).access!.withheld.map((w) => w.property)).toEqual([v.expected.property])
    publicAnswers.push({ sector: { ...v.sector, binding: v.binding }, product, result })
  })
})

describe('a reader who holds both parts checks the whole', () => {
  const authorised = (sector: Sector, payloadPublic: string, restrictedProduct: unknown, passportId: string): Promise<PayloadValidation> =>
    authorisedPayloadValidator({ registry, engines })({ profile: sector.binding.id, profileVersion: sector.binding.version, payloadPublic, passportId, ...(restrictedProduct === undefined ? {} : { restrictedProduct }) })

  it.each(positives)('%s: passes on the true parts', async (_name, sector, product) => {
    const { payloadPublic, restrictedProduct } = await prepared(sector, product)
    const result = await authorised(sector, payloadPublic, restrictedProduct, passportIdOf(product))
    expect(result.status, JSON.stringify(result.detail)).toBe('pass')
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(detailOf(result).access).toEqual({ policy: sector.binding.access!.policy, view: 'authorised', withheld: [] })
  })

  it.each(each)('%s: fails when the restricted part belongs to another product', async (_profile, sector) => {
    const mine = await prepared(sector, other(sector))
    const theirs = await prepared(sector, rich(sector))
    expect(theirs.restrictedProduct).toBeDefined()
    const result = await authorised(sector, mine.payloadPublic, theirs.restrictedProduct, passportIdOf(other(sector)))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-assembly-refused' } })
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'fail']])
    expect(detailOf(result).steps[2]).toMatchObject({ refusal: 'restricted-part-names-another-product' })
  })

  it.each(each)('%s: every rejoin refusal, each by its code', async (_profile, sector) => {
    const product = rich(sector)
    const { payloadPublic, restrictedProduct } = await prepared(sector, product)
    const publicProduct = (JSON.parse(payloadPublic) as { product: Json }).product
    const [closed] = restrictedNames(sector, product) as [string]
    const { id: _id, ...unnamed } = restrictedProduct!
    const { [closed]: moved, ...withoutMoved } = restrictedProduct!
    const { 'gs1:gtin': gtin, ...withoutGtin } = publicProduct
    const cases: Array<[string, unknown, unknown]> = [
      ['part-not-an-object', publicProduct, JSON.stringify(restrictedProduct)],
      ['join-key-missing', publicProduct, unnamed],
      ['restricted-part-names-another-product', publicProduct, { ...restrictedProduct, id: other(sector).id }],
      ['property-in-both-parts', publicProduct, { ...restrictedProduct, 'gs1:gtin': gtin }],
      ['restricted-property-in-public-part', { ...publicProduct, [closed]: moved }, withoutMoved],
      ['public-property-in-restricted-part', withoutGtin, { ...restrictedProduct, 'gs1:gtin': gtin }],
    ]
    for (const [code, publicPart, restrictedPart] of cases) {
      const direct = assembleProduct({ binding: sector.binding, publicProduct: publicPart, restrictedProduct: restrictedPart })
      expect(direct, code).toMatchObject({ ok: false, code })
      const result = await authorised(sector, envelope(sector, publicPart), restrictedPart, passportIdOf(product))
      expect(result, code).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-assembly-refused' } })
      expect(detailOf(result).steps.at(-1), code).toMatchObject({ step: 'assembly', refusal: code })
    }
  })

  it.each(each)('%s: a restricted part that was altered fails on the rule it now breaks', async (_profile, sector) => {
    const product = rich(sector)
    const { payloadPublic, restrictedProduct } = await prepared(sector, product)
    const operator = sector.profile === 'eu-battery@1' ? 'eubat:hasOperatorInformation' : 'oec:hasOperatorInformation'
    const altered = structuredClone(restrictedProduct!)
    delete (altered[operator] as Json)['gs1:globalLocationNumber']
    expect(await authorised(sector, payloadPublic, altered, passportIdOf(product))).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
  })
})

describe('validation under the access split', () => {
  // Last in the file on purpose: these read what every test above collected.
  it('gave no public-view answer that repeats a restricted value', () => {
    expect(publicAnswers.length).toBeGreaterThanOrEqual(20)
    expect(new Set(publicAnswers.map((a) => a.result.status))).toEqual(new Set(['pass', 'fail', 'unknown']))
    for (const { sector, product, result } of publicAnswers) {
      const { values } = restrictedValues(sector, product)
      expect(leaked(JSON.stringify(result), values)).toEqual([])
    }
  })

  it('wrote no log line', () => {
    expect(logged).toEqual([])
  })

  it('never reached for the network', () => {
    expect(networkAttempts).toBe(0)
    expect(globalThis.fetch).not.toBe(realFetch)
  })
})
