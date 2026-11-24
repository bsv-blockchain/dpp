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
