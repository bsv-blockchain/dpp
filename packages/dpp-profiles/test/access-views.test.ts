import { beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { MAX_PAYLOAD_PUBLIC_BYTES_V2 } from '@bsv/dpp-protocol'
import {
  PUBLIC_PAYLOAD_MAX_BYTES,
  authorisedPayloadValidator,
  bindingPayloadValidator,
  createProfileRegistry,
  prepareBoundPayload,
  splitProductByAccess,
  type BindingValidationDetail,
  type EngineFinding,
  type JsonLdEngine,
  type PayloadValidation,
  type ProfileBinding,
  type ProfileRegistry,
  type ShaclEngine,
  type ValidationEngines,
} from '../src/index.js'
import { SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticAccessBinding, syntheticBinding, utf8 } from './binding-fixture.js'

// A binding with two tiers, read three ways: by any reader, who has the
// public payload alone; by an authorised reader, who has both parts; and by
// the writer, who has the whole document. The engines are stand-ins, so each
// rule about a withheld check is exercised on its own. The real engines run
// the same rules on the bundled bindings in sector-access.test.ts.
const GTIN = '09523000000012'
const ID = `https://id.example/01/${GTIN}/21/LAMP-0001`
const passportId = `https://passports.example/01/${GTIN}/21/LAMP-0001`
const LAMP = 'https://profiles.example/lamp/v1#'
const product = (): Record<string, unknown> => ({ '@context': SYNTHETIC_CONTEXT_URI, id: ID, name: 'Desk lamp', gtin: GTIN, serialNumber: 'LAMP-0001', lumens: 800, batch: `https://id.example/01/${GTIN}/10/LOT-SECRET-7` })
/** The values of the restricted properties, as they would appear in any text that repeated them. */
const RESTRICTED_VALUES = ['800', 'LOT-SECRET-7']

const tiers = syntheticAccessBinding()
const tiersBytes = bindingBytes(tiers)
const tiersDigest = sha256Hex(tiersBytes)
const oneTierBytes = bindingBytes(syntheticBinding())
const oneTierDigest = sha256Hex(oneTierBytes)
// A plain JSON Schema profile whose schema requires a restricted property.
const strictSchema = utf8(JSON.stringify({ ...(JSON.parse(SYNTHETIC_FILES['product.schema.json']!) as object), $id: 'https://profiles.example/lamp/v1/tiers.schema.json', required: ['id', 'name', 'lumens'] }))
const plain: ProfileBinding = {
  ...tiers,
  id: 'example-lamp-tiers-plain',
  profile: 'example-lamp-tiers-plain@1',
  artefacts: [{ ...tiers.artefacts[0]!, path: 'tiers.schema.json', byteLength: strictSchema.byteLength, sha256: sha256Hex(strictSchema) }],
  validation: { steps: ['json-schema', 'passport-identity'], blockingSeverities: ['Violation'] },
}
const plainBytes = bindingBytes(plain)
const plainDigest = sha256Hex(plainBytes)

let registry: ProfileRegistry
beforeAll(async () => {
  registry = createProfileRegistry({ trustedBindingDigests: [tiersDigest, oneTierDigest, plainDigest] })
  for (const bytes of [tiersBytes, oneTierBytes, plainBytes]) {
    expect((await registry.register({ bindingBytes: bytes, resolveArtefact: (a) => (a.path === 'tiers.schema.json' ? strictSchema : resolveSynthetic(a)) })).ok).toBe(true)
  }
})

const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
/** A stand-in expander: one triple per top-level member, under the document's own identifier. */
const expander = (calls: Array<Record<string, unknown>> = []): JsonLdEngine => ({
  toRdf: async ({ document }) => {
    const members = document as Record<string, unknown>
    calls.push(members)
    const subject = String(members.id ?? members['@id'])
    return { ok: true, nquads: Object.keys(members).filter((name) => !name.startsWith('@') && name !== 'id').map((name) => `<${subject}> <${LAMP}${name}> "x" .\n`).join('') }
  },
})
const missing = (property: string, over: Partial<EngineFinding> = {}): EngineFinding => ({ severity: 'Violation', constraint: 'MinCountConstraintComponent', focusNode: ID, path: `${LAMP}${property}`, message: 'Less than 1 values', ...over })
/** Stand-in shapes: a minimum count of one on each named property of the product. */
const shapes = (required: string[], extra: (nquads: string) => EngineFinding[] = () => [], calls: string[] = []): ShaclEngine => ({
  capabilities: ['shacl-core', 'shacl-sparql-constraints'],
  validate: async ({ nquads }) => { calls.push(nquads); return { ok: true, findings: [...required.filter((property) => !nquads.includes(`<${LAMP}${property}>`)).map((property) => missing(property)), ...extra(nquads)] } },
})
const engines = (required: string[] = ['name', 'lumens'], extra?: (nquads: string) => EngineFinding[]): ValidationEngines => ({ jsonSchema: compiler(), jsonLd: expander(), shacl: shapes(required, extra) })

const envelope = (productPart: unknown, id = tiers.id, digest = tiersDigest): string => JSON.stringify({ profile: id, profile_version: 1, profile_binding_sha256: digest, product: productPart })
const parts = (whole = product()) => splitProductByAccess({ binding: tiers, product: whole })
const publicView = (productPart: unknown, own: ValidationEngines = engines(), id = tiers.id, digest = tiersDigest): Promise<PayloadValidation> => bindingPayloadValidator({ registry, engines: own })({ profile: id, profileVersion: 1, payloadPublic: envelope(productPart, id, digest), passportId })
const authorised = (productPart: unknown, restrictedProduct: unknown, own: ValidationEngines = engines(), over: { id?: string; digest?: string; passportId?: string | undefined } = {}): Promise<PayloadValidation> =>
  authorisedPayloadValidator({ registry, engines: own })({ profile: over.id ?? tiers.id, profileVersion: 1, payloadPublic: envelope(productPart, over.id ?? tiers.id, over.digest ?? tiersDigest), ...('passportId' in over ? (over.passportId == null ? {} : { passportId: over.passportId }) : { passportId }), ...(restrictedProduct === undefined ? {} : { restrictedProduct }) })
const detailOf = (result: PayloadValidation): BindingValidationDetail => result.detail as BindingValidationDetail
const stepOf = (result: PayloadValidation, step: string) => detailOf(result).steps.find((s) => s.step === step)
const order = (result: PayloadValidation) => detailOf(result).steps.map((s) => [s.step, s.status])

describe('the public view: a public payload read as a projection', () => {
  it('passes only when every rule could be decided from the public payload and held', async () => {
    const result = await publicView(parts().publicProduct, engines(['name']))
    expect(result.status).toBe('pass')
    expect(result.reasonCode).toBeUndefined()
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'pass'], ['json-schema', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(detailOf(result).access).toEqual({ policy: 'example-lamp-access@1', view: 'public', withheld: [] })
  })

  it('answers unknown, never pass and never fail, when a required property is restricted, and lists the withheld check', async () => {
    const result = await publicView(parts().publicProduct)
    expect(result.status).toBe('unknown')
    expect(result.reasonCode).toBe('schema-unavailable')
    expect(detailOf(result).cause).toBe('restricted-tier-withheld')
    const check = { step: 'shacl', property: `${LAMP}lumens`, constraint: 'MinCountConstraintComponent', message: 'Less than 1 values' }
    expect(detailOf(result).access).toEqual({ policy: 'example-lamp-access@1', view: 'public', withheld: [check] })
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'unknown', cause: 'restricted-tier-withheld', withheld: [check], findings: [missing('lumens')] })
    expect(stepOf(result, 'shacl')?.messages).toEqual([`Not decided: the rule on ${LAMP}lumens (MinCountConstraintComponent) needs a property outside the public payload.`])
    // Every other step ran and held.
    expect(detailOf(result).steps.filter((s) => s.status !== 'pass').map((s) => s.step)).toEqual(['shacl'])
  })

  it('fails when a public property the rules require is missing: nothing was withheld there', async () => {
    const { gtin: _gtin, ...publicProduct } = parts().publicProduct
    const result = await publicView(publicProduct, engines(['name', 'gtin']))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
    expect(stepOf(result, 'shacl')?.messages).toEqual([`Violation at ${LAMP}gtin: Less than 1 values.`])
    expect(detailOf(result).access?.withheld).toEqual([])
  })

  it('fails on the public rule and still lists the withheld one beside it', async () => {
    const { gtin: _gtin, ...publicProduct } = parts().publicProduct
    const result = await publicView(publicProduct, engines(['gtin', 'lumens']))
    expect(result.status).toBe('fail')
    expect(stepOf(result, 'shacl')?.messages).toEqual([`Violation at ${LAMP}gtin: Less than 1 values.`])
    expect(detailOf(result).access?.withheld.map((w) => w.property)).toEqual([`${LAMP}lumens`])
  })

  const notAbsence: Array<[string, EngineFinding]> = [
    ['a wrong value, which no absent property explains', missing('lumens', { constraint: 'DatatypeConstraintComponent' })],
    ['a missing value on a nested node, which is public or restricted with its parent', missing('lumens', { focusNode: '_:b0' })],
    ['a missing value on another node', missing('lumens', { focusNode: `https://id.example/01/${GTIN}/21/LAMP-0002` })],
    ['a rule along a path of several properties', missing('lumens', { path: `<${LAMP}wiring>/<${LAMP}lumens>` })],
    ['a rule with no path, such as a SPARQL constraint on the product', { severity: 'Violation', constraint: 'SPARQLConstraintComponent', focusNode: ID, message: 'The declared level does not match.' }],
  ]
  it.each(notAbsence)('fails on %s, restricted property or not', async (_name, finding) => {
    const result = await publicView(parts().publicProduct, engines(['name'], () => [finding]))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-rule-violation' } })
    expect(detailOf(result).access?.withheld).toEqual([])
  })

  it('reports a finding the binding does not block on, and withholds nothing for it', async () => {
    const warning = missing('lumens', { severity: 'Warning' })
    const result = await publicView(parts().publicProduct, engines(['name'], () => [warning]))
    expect(result.status).toBe('pass')
    expect(stepOf(result, 'shacl')).toMatchObject({ status: 'pass', findings: [warning] })
    expect(detailOf(result).access?.withheld).toEqual([])
  })

  it('reads the public names as the predicates the contexts give them, by asking the engine', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { gtin: _gtin, ...publicProduct } = parts().publicProduct
    const result = await publicView(publicProduct, { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes(['gtin', 'lumens']) })
    expect(result.status).toBe('fail')
    // The payload itself, then the payload again under a subject of its own with a marker at each absent public name.
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(publicProduct)
    expect(calls[1]!.id).not.toBe(ID)
    expect(Object.keys(calls[1]!).sort()).toEqual(['@context', 'id', 'name', 'serialNumber', 'gtin', 'granularity', 'model'].sort())
    expect(Object.keys(calls[1]!)).not.toContain('lumens')
  })

  it('asks the engine nothing more when no finding reports an absent value', async () => {
    const calls: Array<Record<string, unknown>> = []
    await publicView(parts().publicProduct, { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes(['name']) })
    expect(calls).toHaveLength(1)
  })

  it('answers unknown, not fail and not pass, when the names could not be read as predicates', async () => {
    const { gtin: _gtin, ...publicProduct } = parts().publicProduct
    let asked = 0
    const once: JsonLdEngine = { toRdf: async (input) => { asked += 1; if (asked > 1) throw new Error('the engine stopped'); return expander().toRdf(input) } }
    const result = await publicView(publicProduct, { jsonSchema: compiler(), jsonLd: once, shacl: shapes(['gtin']) })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'restricted-tier-withheld' } })
    expect(asked).toBeGreaterThan(2)
  })

  it('reads each name alone when one of them spoils the document', async () => {
    const { gtin: _gtin, ...publicProduct } = parts().publicProduct
    // This engine refuses any document that carries `model`, as a context would refuse a name it does not define.
    const picky: JsonLdEngine = { toRdf: async (input) => (Object.hasOwn(input.document as object, 'model') ? { ok: false, reason: 'document-invalid', detail: 'model is not defined' } : expander().toRdf(input)) }
    const result = await publicView(publicProduct, { jsonSchema: compiler(), jsonLd: picky, shacl: shapes(['gtin', 'lumens']) })
    // `gtin` was still read as public, so its absence is a failure, and `lumens` is still withheld.
    expect(result.status).toBe('fail')
    expect(stepOf(result, 'shacl')?.messages).toEqual([`Violation at ${LAMP}gtin: Less than 1 values.`])
    expect(detailOf(result).access?.withheld.map((w) => w.property)).toEqual([`${LAMP}lumens`])
  })

  it('withholds a schema rule that only misses a restricted property', async () => {
    const result = await publicView(parts().publicProduct, { jsonSchema: compiler() }, plain.id, plainDigest)
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'restricted-tier-withheld' } })
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'pass'], ['json-schema', 'unknown'], ['passport-identity', 'pass']])
    expect(detailOf(result).access?.withheld).toEqual([{ step: 'json-schema', property: 'lumens', constraint: 'required', message: "must have required property 'lumens'" }])
  })

  it('fails a schema rule the public payload breaks, and names only that rule', async () => {
    const result = await publicView({ ...parts().publicProduct, name: '' }, { jsonSchema: compiler() }, plain.id, plainDigest)
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'schema-invalid' } })
    expect(stepOf(result, 'json-schema')?.messages).toEqual(['`name` must NOT have fewer than 1 characters.'])
    expect(detailOf(result).access?.withheld.map((w) => w.property)).toEqual(['lumens'])
  })

  it('fails a missing public property under the schema: nothing was withheld there', async () => {
    const { name: _name, ...publicProduct } = parts().publicProduct
    const result = await publicView(publicProduct, { jsonSchema: compiler() }, plain.id, plainDigest)
    expect(result.status).toBe('fail')
    expect(stepOf(result, 'json-schema')?.messages).toEqual(['the payload is missing the required field `name`.'])
  })

  it('still answers unknown for a step that could not run, whatever was withheld', async () => {
    const result = await publicView(parts().publicProduct, { jsonSchema: compiler() })
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect((await bindingPayloadValidator({ registry, engines: engines(['name']) })({ profile: tiers.id, profileVersion: 1, payloadPublic: envelope(parts().publicProduct) })).status).toBe('unknown')
  })

  it('leaves a binding with one tier exactly as it was: no access step and no access member', async () => {
    const result = await bindingPayloadValidator({ registry, engines: engines() })({ profile: 'example-lamp', profileVersion: 1, payloadPublic: envelope(product(), 'example-lamp', oneTierDigest), passportId })
    expect(result.status).toBe('pass')
    expect(order(result).map(([step]) => step)).toEqual(['envelope', 'binding', 'json-schema', 'json-ld-expand', 'shacl', 'passport-identity'])
    expect(Object.hasOwn(detailOf(result), 'access')).toBe(false)
  })
})

describe('the public view: a restricted property in the public payload', () => {
  const disclosures: Array<[string, Record<string, unknown>]> = [
    ['a restricted property the profile defines', { lumens: 800 }],
    ['a property the binding has never heard of', { supplierPrice: 'PRICE-SECRET' }],
    ['a restricted property under its full IRI', { [`${LAMP}lumens`]: 800 }],
    ['the whole document in place of its public part', { lumens: 800, batch: product().batch }],
  ]
  it.each(disclosures)('fails %s with its own cause, and runs nothing after it', async (_name, extra) => {
    const calls: Array<Record<string, unknown>> = []
    const shaclCalls: string[] = []
    const result = await publicView({ ...parts().publicProduct, ...extra }, { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes([], undefined, shaclCalls) })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'restricted-property-disclosed' } })
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['access', 'fail']])
    expect(stepOf(result, 'access')?.messages).toEqual(Object.keys(extra).map((name) => `The public payload carries \`${name}\`, which example-lamp-access@1 does not list as public.`))
    expect([calls, shaclCalls]).toEqual([[], []])
    // The answer names the property and does not repeat what it held.
    expect(JSON.stringify(result)).not.toMatch(/800|PRICE-SECRET|LOT-SECRET/)
  })
})

describe('the authorised view: both parts, rejoined', () => {
  it('passes on the true parts, with every step run on the whole document', async () => {
    const { publicProduct, restrictedProduct } = parts()
    const calls: Array<Record<string, unknown>> = []
    const result = await authorised(publicProduct, restrictedProduct, { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes(['name', 'lumens']) })
    expect(result.status).toBe('pass')
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'pass'], ['json-schema', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(detailOf(result).access).toEqual({ policy: 'example-lamp-access@1', view: 'authorised', withheld: [] })
    expect(calls).toEqual([product()])
  })

  it('fails when the restricted part belongs to another product, and names the refusal', async () => {
    const { publicProduct } = parts()
    const other = parts({ ...product(), id: `https://id.example/01/${GTIN}/21/LAMP-0002`, serialNumber: 'LAMP-0002' }).restrictedProduct
    const result = await authorised(publicProduct, other)
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-assembly-refused' } })
    expect(order(result)).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'fail']])
    expect(stepOf(result, 'assembly')).toMatchObject({ refusal: 'restricted-part-names-another-product' })
    expect(stepOf(result, 'assembly')?.messages?.[0]).toMatch(/^The two parts were not rejoined \(restricted-part-names-another-product\)\./)
  })

  const refusals: Array<[string, (p: ReturnType<typeof parts>) => [unknown, unknown]]> = [
    ['part-not-an-object', (p) => [p.publicProduct, [p.restrictedProduct]]],
    ['join-key-missing', (p) => [p.publicProduct, { lumens: 800 }]],
    ['property-in-both-parts', (p) => [p.publicProduct, { ...p.restrictedProduct, name: 'Desk lamp' }]],
    ['restricted-property-in-public-part', (p) => [{ ...p.publicProduct, lumens: 800 }, { id: ID, batch: product().batch }]],
    ['public-property-in-restricted-part', (p) => { const { gtin, ...rest } = p.publicProduct; return [rest, { ...p.restrictedProduct, gtin }] }],
  ]
  it.each(refusals)('fails a rejoin refused as %s, and runs no check on the pieces', async (code, make) => {
    const calls: Array<Record<string, unknown>> = []
    const [publicProduct, restrictedProduct] = make(parts())
    const result = await authorised(publicProduct, restrictedProduct, { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes([]) })
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'product-assembly-refused' } })
    expect(stepOf(result, 'assembly')?.refusal).toBe(code)
    expect(calls).toEqual([])
  })

  it('fails a missing required property outright: with both parts in hand nothing is withheld', async () => {
    const { publicProduct } = parts()
    // A state with no restricted part: the public part is the whole document, and it lacks what the shapes require.
    const result = await authorised(publicProduct, undefined)
    expect(result).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation', access: { view: 'authorised', withheld: [] } } })
  })

  it('applies the identity rules to the rejoined document, restricted members included', async () => {
    const { publicProduct, restrictedProduct } = parts()
    expect((await authorised(publicProduct, restrictedProduct, engines(), { passportId: `https://passports.example/01/${GTIN}/21/LAMP-0002` })).status).toBe('fail')
    expect(await authorised(publicProduct, restrictedProduct, engines(), { passportId: undefined })).toMatchObject({ status: 'unknown', detail: { cause: 'product-identity-unavailable' } })
  })

  it('checks the envelope and the binding digest before it rejoins anything', async () => {
    const { publicProduct, restrictedProduct } = parts()
    const wrong = await authorised(publicProduct, restrictedProduct, engines(), { digest: oneTierDigest })
    expect(order(wrong)).toEqual([['envelope', 'pass'], ['binding', 'fail']])
    const broken = await authorisedPayloadValidator({ registry, engines: engines() })({ profile: tiers.id, profileVersion: 1, payloadPublic: '{not json', passportId, restrictedProduct })
    expect(order(broken)).toEqual([['envelope', 'fail']])
  })

  it('never passes without the engines the binding needs', async () => {
    const { publicProduct, restrictedProduct } = parts()
    expect(await authorised(publicProduct, restrictedProduct, {})).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
  })

  it('serves a binding with one tier: the public payload is the whole document', async () => {
    const result = await authorised(product(), undefined, engines(), { id: 'example-lamp', digest: oneTierDigest })
    expect(result.status).toBe('pass')
    expect(order(result)[2]).toEqual(['assembly', 'pass'])
    const extra = await authorised(product(), { id: ID, margin: 0.4 }, engines(), { id: 'example-lamp', digest: oneTierDigest })
    expect(stepOf(extra, 'assembly')?.refusal).toBe('public-property-in-restricted-part')
  })

  it('answers unknown for a manifest-format profile handed a restricted part, and as profilePayloadValidator without one', async () => {
    const general = { profile: 'general', profileVersion: 2, payloadPublic: JSON.stringify({ profile: 'general', profile_version: 2 }) }
    const validate = authorisedPayloadValidator({ registry, engines: { jsonSchema: compiler() } })
    expect(await validate({ ...general, restrictedProduct: { cost: 1 } })).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    expect((await validate(general)).status).toBe('fail')
  })
})

describe('prepareBoundPayload', () => {
  const prepare = (over: Partial<Parameters<typeof prepareBoundPayload>[0]> = {}) => prepareBoundPayload({ registry, engines: engines(), profile: tiers.id, profileVersion: 1, product: product(), passportId, ...over })

  it('returns the public payload as the exact text to sign, the restricted part and both checks', async () => {
    const result = await prepare()
    if (!result.ok) throw new Error(result.detail)
    const { publicProduct, restrictedProduct } = parts()
    expect(result.payloadPublic).toBe(JSON.stringify({ profile: tiers.id, profile_version: 1, profile_binding_sha256: tiersDigest, product: publicProduct }))
    expect(result.byteLength).toBe(new TextEncoder().encode(result.payloadPublic).byteLength)
    expect(result.restrictedProduct).toEqual(restrictedProduct)
    expect(result.validation).toMatchObject({ status: 'pass', detail: { access: { view: 'whole', withheld: [] } } })
    // The shapes require a restricted property, so a reader of this payload cannot decide that rule. The writer is told so.
    expect(result.publicView).toMatchObject({ status: 'unknown', detail: { cause: 'restricted-tier-withheld', access: { view: 'public' } } })
    for (const value of RESTRICTED_VALUES) expect(result.payloadPublic).not.toContain(value)
  })

  it('prepares a payload that any reader then checks to the same answer', async () => {
    const result = await prepare({ engines: engines(['name']) })
    if (!result.ok) throw new Error(result.detail)
    expect(result.publicView.status).toBe('pass')
    const read = await bindingPayloadValidator({ registry, engines: engines(['name']) })({ profile: tiers.id, profileVersion: 1, payloadPublic: result.payloadPublic, passportId })
    expect(read).toEqual(result.publicView)
    const rejoined = await authorisedPayloadValidator({ registry, engines: engines() })({ profile: tiers.id, profileVersion: 1, payloadPublic: result.payloadPublic, passportId, restrictedProduct: result.restrictedProduct })
    expect(rejoined.status).toBe('pass')
  })

  it('validates the whole document first, then the public part', async () => {
    const calls: Array<Record<string, unknown>> = []
    const result = await prepare({ engines: { jsonSchema: compiler(), jsonLd: expander(calls), shacl: shapes(['name']) } })
    expect(result.ok).toBe(true)
    expect(calls.map((document) => Object.hasOwn(document, 'lumens'))).toEqual([true, false])
  })

  it('writes the notice of a demonstration record first', async () => {
    const result = await prepare({ notice: 'Demonstration record: no real product stands behind it.' })
    if (!result.ok) throw new Error(result.detail)
    expect(Object.keys(JSON.parse(result.payloadPublic) as object)).toEqual(['notice', 'profile', 'profile_version', 'profile_binding_sha256', 'product'])
  })

  it('returns no restricted part for a document with no restricted property', async () => {
    const { lumens: _lumens, batch: _batch, ...open } = product()
    const result = await prepare({ product: open, engines: engines(['name']) })
    if (!result.ok) throw new Error(result.detail)
    expect(Object.hasOwn(result, 'restrictedProduct')).toBe(false)
  })

  it('does not change the document it is given', async () => {
    const input = product()
    const before = JSON.stringify(input)
    await prepare({ product: input })
    expect(JSON.stringify(input)).toBe(before)
  })

  it('refuses a document that fails, and says which check', async () => {
    const result = await prepare({ product: { ...product(), lumens: 0 } })
    expect(result).toMatchObject({ ok: false, code: 'validation-failed', validation: { status: 'fail', detail: { cause: 'schema-invalid', access: { view: 'whole' } } } })
    expect(Object.hasOwn(result, 'payloadPublic')).toBe(false)
    // A restricted property the rules require, missing from the whole document, is a failure for the writer.
    const { lumens: _lumens, ...dim } = product()
    expect(await prepare({ product: dim })).toMatchObject({ ok: false, code: 'validation-failed', validation: { status: 'fail', detail: { cause: 'profile-rule-violation' } } })
    expect(await prepare({ passportId: `https://passports.example/01/${GTIN}/21/LAMP-0002` })).toMatchObject({ ok: false, code: 'validation-failed', validation: { detail: { cause: 'product-identity-mismatch' } } })
  })

  it('refuses a document it could not validate: no engine, no passport identifier, no registered profile', async () => {
    const none = await prepare({ engines: {} })
    expect(none).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } } })
    expect(Object.hasOwn(none, 'payloadPublic')).toBe(false)
    expect(await prepare({ engines: undefined })).toMatchObject({ ok: false, code: 'validation-unavailable' })
    expect(await prepare({ passportId: undefined as never })).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { detail: { cause: 'product-identity-unavailable' } } })
    expect(await prepare({ profile: 'toaster', profileVersion: 9 })).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { status: 'unknown', detail: { profile: 'toaster@9', cause: 'profile-unknown' } } })
  })

  it('refuses a public payload over the limit, with its actual size in UTF-8 bytes', async () => {
    expect(PUBLIC_PAYLOAD_MAX_BYTES).toBe(MAX_PAYLOAD_PUBLIC_BYTES_V2)
    const long = await prepare({ product: { ...product(), name: 'x'.repeat(70_000) }, engines: engines(['name']) })
    const expected = new TextEncoder().encode(JSON.stringify({ profile: tiers.id, profile_version: 1, profile_binding_sha256: tiersDigest, product: { ...parts().publicProduct, name: 'x'.repeat(70_000) } })).byteLength
    expect(long).toMatchObject({ ok: false, code: 'public-payload-too-large', byteLength: expected, limit: 65535, validation: { status: 'pass' } })
    expect(Object.hasOwn(long, 'payloadPublic')).toBe(false)
    // Fewer than 65,535 characters and more than 65,535 bytes: the limit is on the bytes.
    const wide = await prepare({ product: { ...product(), name: '€'.repeat(30_000) }, engines: engines(['name']) })
    expect(wide).toMatchObject({ ok: false, code: 'public-payload-too-large' })
    if (wide.ok) throw new Error('expected a refusal')
    expect(wide.byteLength).toBeGreaterThan(90_000)
  })

  it('holds the public payload to the limit exactly: one byte under passes and one byte over does not', async () => {
    const base = new TextEncoder().encode(JSON.stringify({ profile: tiers.id, profile_version: 1, profile_binding_sha256: tiersDigest, product: { ...parts().publicProduct, name: '' } })).byteLength
    const at = await prepare({ product: { ...product(), name: 'x'.repeat(65535 - base) }, engines: engines(['name']) })
    expect(at).toMatchObject({ ok: true, byteLength: 65535 })
    expect(await prepare({ product: { ...product(), name: 'x'.repeat(65536 - base) }, engines: engines(['name']) })).toMatchObject({ ok: false, code: 'public-payload-too-large', byteLength: 65536 })
  })

  it('counts the public payload only: a large restricted property does not refuse it', async () => {
    const result = await prepare({ product: { ...product(), batch: `https://id.example/01/${GTIN}/10/${'L'.repeat(70_000)}` }, engines: engines(['name']) })
    expect(result).toMatchObject({ ok: true })
  })

  it('refuses a split whose public part fails on its own, which every reader would see', async () => {
    // A rule that relates a public property to a restricted one: it holds on the whole and breaks on the public part.
    const related = (nquads: string): EngineFinding[] => (nquads.includes(`<${LAMP}lumens>`) ? [] : [{ severity: 'Violation', constraint: 'SPARQLConstraintComponent', focusNode: ID, message: 'A lamp with a name states its lumens.' }])
    const result = await prepare({ engines: engines(['name'], related) })
    expect(result).toMatchObject({ ok: false, code: 'public-view-failed', validation: { status: 'pass' }, publicView: { status: 'fail', detail: { cause: 'profile-rule-violation' } } })
    expect(Object.hasOwn(result, 'payloadPublic')).toBe(false)
  })

  it('refuses a manifest-format profile, which has no binding to declare', async () => {
    expect(await prepare({ profile: 'general', profileVersion: 2 })).toMatchObject({ ok: false, code: 'profile-not-bound' })
  })

  it('refuses a document that cannot be written as JSON', async () => {
    const loop: Record<string, unknown> = product()
    loop.self = loop
    expect(await prepare({ product: loop })).toMatchObject({ ok: false, code: 'validation-failed' })
  })

  it('prepares the whole document as the public payload under a binding with one tier', async () => {
    const result = await prepare({ profile: 'example-lamp' })
    if (!result.ok) throw new Error(result.detail)
    expect(JSON.parse(result.payloadPublic)).toEqual({ profile: 'example-lamp', profile_version: 1, profile_binding_sha256: oneTierDigest, product: product() })
    expect(Object.hasOwn(result, 'restrictedProduct')).toBe(false)
    expect(result.publicView).toBe(result.validation)
  })
})
