import { beforeAll, describe, expect, it } from 'vitest'
import { authorisedPayloadValidator, bindingPayloadValidator, createProfileRegistry, describeArtefact, prepareBoundPayload, profileBindingDigest, type ValidationEngines } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { bindingBytes, SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES, syntheticAccessBinding, utf8 } from './binding-fixture.js'

const namespace = 'https://profiles.example/lamp/v1#'
const binding = syntheticAccessBinding()
binding.validation = { steps: ['json-ld-expand', 'shacl', 'passport-identity'], subjectClass: namespace + 'Lamp', blockingSeverities: ['Violation'] }
const files = { ...SYNTHETIC_FILES, 'background.ttl': SYNTHETIC_FILES['background.ttl'] + `
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  lamp:TaskLamp rdfs:subClassOf lamp:Lamp .
  lamp:AdjustableTaskLamp rdfs:subClassOf lamp:TaskLamp .` }
binding.artefacts = binding.artefacts.filter((a) => a.role !== 'schema').map((a) => ({ ...a, ...describeArtefact(utf8(files[a.path as keyof typeof files])) }))
binding.access!.public.push('@type', 'lumens')
const bytes = bindingBytes(binding)
const digest = profileBindingDigest(bytes)
const registry = createProfileRegistry({ trustedBindingDigests: [digest] })
const passportId = 'https://id.example/01/09521234543213/21/LMP-001'
const item = { '@context': SYNTHETIC_CONTEXT_URI, id: passportId, name: 'Desk lamp', lumens: 700 }
const selected = { profile: binding.id, profileVersion: binding.version, passportId }
let engines: ValidationEngines

beforeAll(async () => {
  expect(await registry.register({ bindingBytes: bytes, resolveArtefact: (a) => utf8(files[a.path as keyof typeof files]) })).toMatchObject({ ok: true })
  engines = await createValidationEngine()
})

const writer = (over: Record<string, unknown>) => prepareBoundPayload({ ...selected, registry, engines, product: { ...item, ...over } })
const readerInput = (over: Record<string, unknown>) => ({
  ...selected, payloadPublic: JSON.stringify({ profile: binding.id, profile_version: binding.version, profile_binding_sha256: digest, product: { ...item, ...over } }),
})

describe('a binding that selects a required RDF class on its product subject', () => {
  it.each(['Lamp', 'TaskLamp', 'AdjustableTaskLamp'])('accepts %s on the identified product for the writer and both readers', async (type) => {
    const productType = { '@type': [namespace + 'Product', namespace + type] }
    expect(await writer(productType)).toMatchObject({ ok: true, validation: { status: 'pass' }, publicView: { status: 'pass' } })
    expect(await authorisedPayloadValidator({ registry, engines })(readerInput(productType))).toMatchObject({ status: 'pass' })
  })

  it('requires the class on the product itself, including when a related product has it', async () => {
    for (const over of [{}, { '@type': namespace + 'Accessory' }, { '@included': [{ '@id': passportId + '-related', '@type': namespace + 'Lamp' }] }]) {
      const result = await writer(over)
      expect(result).toMatchObject({ ok: false, validation: { status: 'fail', detail: { steps: expect.arrayContaining([
        expect.objectContaining({ step: 'shacl', status: 'fail', findings: [expect.objectContaining({ focusNode: passportId, constraint: 'ClassConstraintComponent' })] }),
      ]) } } })
    }
  })

  it('distinguishes a public projection from the complete record when the type is missing', async () => {
    expect(await bindingPayloadValidator({ registry, engines })(readerInput({}))).toMatchObject({ status: 'unknown', detail: { cause: 'restricted-tier-withheld' } })
    expect(await authorisedPayloadValidator({ registry, engines })(readerInput({}))).toMatchObject({ status: 'fail', detail: { cause: 'profile-rule-violation' } })
  })

  it('reports a subclass check that cannot run as unavailable and refuses preparation', async () => {
    const shacl = engines.shacl!
    const unavailable = { ...engines, shacl: {
      capabilities: shacl.capabilities,
      validate: (input: Parameters<typeof shacl.validate>[0]) => input.shapes.some((shape) => shape.path === 'subject-class.ttl')
        ? Promise.resolve({ ok: false as const, reason: 'timeout' as const, detail: 'class check timed out' })
        : shacl.validate(input),
    } }
    const prepared = await prepareBoundPayload({ ...selected, registry, engines: unavailable, product: { ...item, '@type': namespace + 'TaskLamp' } })
    expect(prepared).toMatchObject({ ok: false, code: 'validation-unavailable', validation: { status: 'unknown', detail: { cause: 'validator-unavailable' } } })
  })
})
