import { beforeAll, expect, it } from 'vitest'
import { createProfileRegistry, describeArtefact, prepareBoundPayload, profileBindingDigest } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { bindingBytes, syntheticBinding, utf8 } from './binding-fixture.js'

const names = ['https://example.org/context/a', 'https://example.org/context/b', 'https://example.org/context/scoped']
const predicates = ['https://example.org/a/serial', 'https://example.org/b/serial']
const passportId = 'https://id.example/01/09521234543213/21/SER-1'
const engines = createValidationEngine()
const binding = syntheticBinding()
binding.validation = { steps: ['json-ld-expand', 'passport-identity'], blockingSeverities: ['Violation'] }
binding.identity.mustEqual = [{ pointer: '/product/serial', part: 'serial' }]
binding.identity.mustNotContradict = []
delete binding.identity.granularityMember
const files = predicates.map((serial) => utf8(JSON.stringify({ '@context': { '@protected': true, id: '@id', serial } })))
const scoped = 'https://example.org/scoped/serial'
files.push(utf8(JSON.stringify({ '@context': {
  id: '@id', kind: '@type', serial: predicates[0], Lamp: { '@id': 'https://example.org/Lamp', '@context': { serial: scoped } },
} })))
binding.artefacts = names.map((uri, i) => ({ role: 'context', path: 'context-' + i + '.jsonld', mediaType: 'application/ld+json', uri, licence: 'Apache-2.0', ...describeArtefact(files[i]!) }))
const bytes = bindingBytes(binding)
const registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(bytes)] })
beforeAll(async () => {
  const registered = await registry.register({ bindingBytes: bytes, resolveArtefact: (a) => files[names.indexOf(a.uri!)] })
  expect(registered, JSON.stringify(registered)).toMatchObject({ ok: true })
})

it.each([0, 1])('uses the protected context actually selected by the product (%i)', async (i) => {
  const check = async (over: Record<string, unknown>) => prepareBoundPayload({
    profile: binding.id, profileVersion: binding.version, registry, engines: await engines, passportId,
    product: { '@context': names[i], id: passportId, serial: 'SER-1', ...over },
  })
  expect(await check({ [predicates[1 - i]!]: 'another property' })).toMatchObject({ ok: true })
  expect(await check({ [predicates[i]!]: 'DIFFERENT' })).toMatchObject({ ok: false, validation: { status: 'fail' } })
})

it('resolves a type-scoped rule when the product uses a pinned alias for @type', async () => {
  const check = async (over: Record<string, unknown>) => prepareBoundPayload({
    profile: binding.id, profileVersion: binding.version, registry, engines: await engines, passportId,
    product: { '@context': names[2], id: passportId, kind: 'Lamp', serial: 'SER-1', ...over },
  })
  expect(await check({ [predicates[0]!]: 'a separate property' })).toMatchObject({ ok: true })
  expect(await check({ [scoped]: 'DIFFERENT' })).toMatchObject({ ok: false, validation: { status: 'fail' } })
})

it('reads the serial of a nested item under its property-scoped context and ignores its sibling', async () => {
  const nested = syntheticBinding()
  nested.validation = { steps: ['json-ld-expand', 'passport-identity'], blockingSeverities: ['Violation'] }
  nested.identity.subject.pointers = ['/product/items/0/id']
  nested.identity.mustEqual = [{ pointer: '/product/items/0/serial', part: 'serial' }, { pointer: '/product/items/0/identifiers/serial', part: 'serial' }]
  nested.identity.mustNotContradict = []
  delete nested.identity.granularityMember
  const uri = 'https://example.org/context/nested'
  const bytes = utf8(JSON.stringify({ '@context': { id: '@id', serial: predicates[0], items: {
    '@id': 'https://example.org/items', '@context': { serial: scoped, serialAlias: scoped, identifiers: '@nest' },
  } } }))
  nested.artefacts = [{ role: 'context', path: 'nested.jsonld', mediaType: 'application/ld+json', uri, licence: 'Apache-2.0', ...describeArtefact(bytes) }]
  const manifest = bindingBytes(nested)
  const registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(manifest)] })
  expect(await registry.register({ bindingBytes: manifest, resolveArtefact: () => bytes })).toMatchObject({ ok: true })
  const prepare = async (attributes: Record<string, unknown>) => prepareBoundPayload({
    profile: nested.id, profileVersion: nested.version, registry, engines: await engines, passportId,
    product: { '@context': uri, items: [{ id: passportId, ...attributes }, { id: 'urn:example:related', serial: 'RELATED-1' }] },
  })
  expect(await prepare({ serial: { '@value': 'SER-1' }, serialAlias: 'SER-1' })).toMatchObject({ ok: true })
  expect(await prepare({ identifiers: { serial: { '@value': 'SER-1' } } })).toMatchObject({ ok: true })
  expect(await prepare({ [scoped]: 'SER-1', [predicates[0]!]: 'other property' })).toMatchObject({ ok: true })
  expect(await prepare({ serialAlias: 'ITEM-2' })).toMatchObject({ ok: false, validation: { status: 'fail' } })
})
