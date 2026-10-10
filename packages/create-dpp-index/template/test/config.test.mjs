import assert from 'node:assert/strict'
import { createECDH } from 'node:crypto'
import { test } from 'node:test'
import { validateConfiguration } from '../scripts/config.mjs'

function valid() {
  const publisher = createECDH('secp256k1')
  publisher.generateKeys()
  return { SERVICE_IDENTITY_KEY: publisher.getPublicKey('hex', 'compressed'),
    ANCHOR_SERVICE_KEYS: publisher.getPublicKey('hex', 'compressed'), NETWORK: 'main',
    PORT: '8080', HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:8080',
    MONGO_URL: 'mongodb://127.0.0.1:27017', MONGO_DB: 'index_test',
    SUBMIT_TOKEN: 'a'.repeat(64), ARC_CALLBACK_TOKEN: 'b'.repeat(64),
    ACCEPTANCE_COMMITMENT: 'required' }
}

test('managed and baseline admission both have a valid explicit configuration', () => {
  assert.deepEqual(validateConfiguration(valid()), [])
  assert.deepEqual(validateConfiguration({ ...valid(), ACCEPTANCE_COMMITMENT: '' }), [])
})

test('missing persistence, header bypass and publisher private keys stop startup', () => {
  for (const change of [{ MONGO_URL: '' }, { CHAIN_TRACKER: 'scripts-only' }, { SERVER_PRIVATE_KEY: '11'.repeat(32) }]) {
    assert.ok(validateConfiguration({ ...valid(), ...change }).length > 0)
  }
})

test('write scopes need separate tokens and errors never contain the secret', () => {
  const env = valid()
  env.ARC_CALLBACK_TOKEN = env.SUBMIT_TOKEN
  const errors = validateConfiguration(env)
  assert.ok(errors.some(error => error.includes('separate secrets')))
  assert.ok(!errors.join('\n').includes(env.SUBMIT_TOKEN))
})

test('hosted origins require HTTPS and valid publisher keys', () => {
  assert.ok(validateConfiguration({ ...valid(), PUBLIC_URL: 'http://index.example.org' }).length)
  assert.ok(validateConfiguration({ ...valid(), SERVICE_IDENTITY_KEY: `02${'ff'.repeat(32)}` }).length)
  assert.deepEqual(validateConfiguration({ ...valid(), PUBLIC_URL: 'https://index.example.org', HOST: '0.0.0.0' }), [])
})

test('empty anchor restrictions and unknown custody modes fail closed', () => {
  assert.ok(validateConfiguration({ ...valid(), ANCHOR_SERVICE_KEYS: '' }).length)
  assert.ok(validateConfiguration({ ...valid(), ACCEPTANCE_COMMITMENT: 'maybe' }).length)
})

test('evidence export requires its own key and access token', () => {
  const env = valid()
  env.EXPORT_SIGNING_KEY = '44'.repeat(32)
  assert.ok(validateConfiguration(env).length)
  env.EXPORT_TOKEN = 'c'.repeat(64)
  assert.deepEqual(validateConfiguration(env), [])
  env.EXPORT_SIGNING_KEY = '0'.repeat(64)
  assert.ok(validateConfiguration(env).length)
})
