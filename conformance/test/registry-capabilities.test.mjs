import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const read = (path) => JSON.parse(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'))
const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
const common = ajv.compile(read('contracts/capabilities.schema.json'))
const registry = ajv.compile(read('contracts/registry-capabilities.schema.json'))

test('an index declaration meets the common schema while the registry route requires its own role, protocols and services', () => {
  const index = read('conformance/examples/capabilities-reference-node.json')
  assert.equal(common(index), true)
  assert.equal(registry(index), false)
  const example = read('conformance/examples/capabilities-registry.json')
  assert.equal(registry(example), true)
  for (const [field, value] of Object.entries({ roles: index.roles, protocols: index.protocols, topics: ['tm_dpp'], services: ['ls_dpp'] })) {
    const wrongRole = { ...example, [field]: value }
    assert.equal(registry(wrongRole), false, field)
  }
})

test('the reporting guide reader cannot verify the external credential offered by the example registry', () => {
  const guide = readFileSync(new URL('../../docs/implement/reporting.md', import.meta.url), 'utf8')
  const declaration = guide.split('## Declare what you support')[1].match(/```json\n([\s\S]*?)\n```/)[1]
  const reader = JSON.parse(declaration)
  const service = read('conformance/examples/capabilities-registry.json')
  assert.equal(common(reader), true)
  assert.equal(registry(service), true)
  const id = 'vc-di-ecdsa-rdfc-2019@1'
  assert.ok(service.representations.some(rep => rep.id === id && rep.verification === 'content'))
  assert.ok(service.proofSuites.includes('ecdsa-rdfc-2019'))
  assert.ok(reader.unsupported.some(rep => rep.id === id))
  assert.ok(!reader.representations.some(rep => rep.id === id))
  assert.ok(!reader.proofSuites.includes('ecdsa-rdfc-2019'))
  assert.deepEqual(reader.profiles.filter(profile => profile.id === 'managed-custody').map(profile => profile.version), ['1'])
  assert.ok(reader.representations.some(rep => rep.id === 'dpp-managed-acceptance@1'))
})
