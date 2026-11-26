import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { KNOWN_INDEX_HOSTS, loadConfig } from '../src/config.js'

const rootKey = '11'.repeat(32)
const token = 'a'.repeat(64)

describe('configuration', () => {
  it('runs without an index in development', () => {
    expect(loadConfig({ LIVE_PUBLISHING: 'false' }).index.url).toBeUndefined()
    expect(loadConfig({ LIVE_PUBLISHING: 'false' }).index.joined).toBe(false)
  })

  it('has joined an index only with its address and both tokens', () => {
    expect(loadConfig({ INDEX_URL: 'http://index.example:8080/' }).index.joined).toBe(false)
    expect(loadConfig({ INDEX_URL: 'http://index.example:8080/', INDEX_SUBMIT_TOKEN: token }).index.joined).toBe(false)
    const joined = loadConfig({ INDEX_URL: 'http://index.example:8080/', INDEX_SUBMIT_TOKEN: token, INDEX_CALLBACK_TOKEN: token }).index
    expect(joined.joined).toBe(true)
    expect(joined.url).toBe('http://index.example:8080')
  })

  it('refuses to write to the chain without an index it has joined', () => {
    expect(() => loadConfig({ LIVE_PUBLISHING: 'true', WALLET_ROOT_KEY: rootKey })).toThrow(/INDEX_URL/)
    expect(() => loadConfig({ LIVE_PUBLISHING: 'true', WALLET_ROOT_KEY: rootKey, INDEX_URL: 'http://index.example:8080/' })).toThrow(/go-live/)
    expect(loadConfig({ LIVE_PUBLISHING: 'true', WALLET_ROOT_KEY: rootKey, INDEX_URL: 'http://index.example:8080/', INDEX_SUBMIT_TOKEN: token, INDEX_CALLBACK_TOKEN: token }).livePublishing).toBe(true)
  })

  it('refuses a secret copied from the example file, naming the setting and never the value', () => {
    for (const [name, value] of [
      ['AUTH_SECRET', 'change-me-to-32-random-bytes-hex'],
      ['BRAND_ROOT_SECRET', 'development-only-brand-secret-replace-me'],
      ['MANAGED_IDENTITY_SECRET', 'development-only-anything'],
    ]) {
      let message = ''
      try {
        loadConfig({ [name]: value })
      } catch (cause) {
        message = (cause as Error).message
      }
      expect(message).toContain(name)
      expect(message).toContain('openssl rand -hex 32')
      expect(message).not.toContain(value)
    }
    // Unset, the development default stands so a bare checkout runs.
    expect(loadConfig({}).authSecret).toMatch(/^development-only-/)
    expect(loadConfig({ AUTH_SECRET: 'b'.repeat(64) }).authSecret).toBe('b'.repeat(64))
  })

  it('reads the EPCIS query sources, and keeps each credential behind a function', () => {
    // The store is the application database unless a folder is chosen: the default says so.
    expect(loadConfig({}).epcis).toEqual({ gs1Dir: 'local/gs1', gs1Offline: false, sources: [], storage: { kind: 'mongodb' } })
    const secret = 'configured-credential-93be11'
    const config = loadConfig({
      DPP_GS1_ARTEFACTS_DIR: '/var/lib/dpp/gs1',
      DPP_GS1_ARTEFACTS_OFFLINE: 'true',
      EPCIS_SOURCES: 'supplier-a, line-2',
      EPCIS_SOURCE_SUPPLIER_A_URL: 'https://events.example.org/epcis/',
      EPCIS_SOURCE_SUPPLIER_A_ORIGINS: 'https://events.example.org, https://pages.example.org',
      EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: secret,
      EPCIS_SOURCE_SUPPLIER_A_REPEAT_LISTS: 'true',
      EPCIS_SOURCE_LINE_2_URL: 'http://127.0.0.1:8080/epcis',
      EPCIS_SOURCE_LINE_2_LOCAL_TEST: 'true',
      EPCIS_SOURCE_LINE_2_BASIC_USER: 'operator',
      EPCIS_SOURCE_LINE_2_BASIC_PASSWORD: secret,
    })
    expect(config.epcis).toMatchObject({ gs1Dir: '/var/lib/dpp/gs1', gs1Offline: true })
    const [first, second] = config.epcis.sources
    expect(first).toMatchObject({ sourceId: 'supplier-a', baseUrl: 'https://events.example.org/epcis', permittedOrigins: ['https://events.example.org', 'https://pages.example.org'], localTest: false, repeatListParameters: true, credentialScheme: 'bearer' })
    // The base address's own origin is the one permitted origin when none is listed. The local-test option is off unless it is set.
    expect(second).toMatchObject({ sourceId: 'line-2', baseUrl: 'http://127.0.0.1:8080/epcis', permittedOrigins: ['http://127.0.0.1:8080'], localTest: true, repeatListParameters: false, credentialScheme: 'basic' })
    expect(first!.credentials!()).toEqual({ scheme: 'bearer', token: secret })
    expect(second!.credentials!()).toEqual({ scheme: 'basic', username: 'operator', password: secret })
    // Serialising or printing the configuration shows that a credential is set, never what it is.
    expect(JSON.stringify(config.epcis)).not.toContain(secret)
    expect(inspect(config.epcis, { depth: 10, showHidden: true })).not.toContain(secret)
    const header = loadConfig({ EPCIS_SOURCES: 'gate', EPCIS_SOURCE_GATE_URL: 'https://gate.example.org', EPCIS_SOURCE_GATE_HEADER_NAME: 'X-Api-Key', EPCIS_SOURCE_GATE_HEADER_VALUE: secret }).epcis.sources[0]!
    expect(header.credentials!()).toEqual({ scheme: 'header', name: 'X-Api-Key', value: secret })
    expect(loadConfig({ EPCIS_SOURCES: 'gate', EPCIS_SOURCE_GATE_URL: 'https://gate.example.org' }).epcis.sources[0]).toEqual({ sourceId: 'gate', baseUrl: 'https://gate.example.org', permittedOrigins: ['https://gate.example.org'], localTest: false, repeatListParameters: false })
  })

  it('refuses an EPCIS source it cannot use, naming the setting and never its value', () => {
    const secret = 'configured-credential-93be11'
    const base = { EPCIS_SOURCES: 'supplier-a', EPCIS_SOURCE_SUPPLIER_A_URL: 'https://events.example.org/epcis' }
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ EPCIS_SOURCES: 'Supplier A' }, /EPCIS_SOURCES holds a name/],
      [{ ...base, EPCIS_SOURCES: 'supplier-a,supplier-a' }, /names supplier-a twice/],
      [{ EPCIS_SOURCES: 'supplier-a' }, /EPCIS_SOURCE_SUPPLIER_A_URL is not set/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_URL: `not an address ${secret}` }, /EPCIS_SOURCE_SUPPLIER_A_URL does not parse/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_URL: `https://operator:${secret}@events.example.org/epcis` }, /EPCIS_SOURCE_SUPPLIER_A_URL carries user information/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_URL: `https://events.example.org/epcis?key=${secret}` }, /carries a query or a fragment/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_URL: 'http://events.example.org/epcis' }, /plain http address/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_URL: 'ftp://events.example.org/epcis' }, /must be an https address/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_ORIGINS: 'https://events.example.org/epcis' }, /EPCIS_SOURCE_SUPPLIER_A_ORIGINS holds an entry that is not an origin/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'yes' }, /EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST must be true or false/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_BASIC_PASSWORD: secret }, /BASIC_USER and EPCIS_SOURCE_SUPPLIER_A_BASIC_PASSWORD are set together/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_HEADER_VALUE: secret }, /HEADER_NAME and EPCIS_SOURCE_SUPPLIER_A_HEADER_VALUE are set together/],
      [{ ...base, EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: secret, EPCIS_SOURCE_SUPPLIER_A_HEADER_NAME: 'X-Api-Key', EPCIS_SOURCE_SUPPLIER_A_HEADER_VALUE: secret }, /more than one credential set/],
    ]
    for (const [env, expected] of cases) {
      let message = ''
      try {
        loadConfig(env)
      } catch (cause) {
        message = (cause as Error).message
      }
      expect(message, JSON.stringify(Object.keys(env))).toMatch(expected)
      expect(message).not.toContain(secret)
    }
  })

  it('chooses the EPCIS store, the profile resolver and the validation engine by setting', () => {
    const plain = loadConfig({})
    expect(plain.epcis.storage).toEqual({ kind: 'mongodb' })
    expect(plain.profileBundleDir).toBeUndefined()
    expect(plain.validator).toEqual({ url: undefined, token: undefined })
    expect(loadConfig({ EPCIS_STORAGE: 'file' }).epcis.storage).toEqual({ kind: 'file', dir: 'local/epcis-store' })
    expect(loadConfig({ EPCIS_STORAGE: 'file', EPCIS_STORAGE_DIR: '/var/lib/dpp/epcis' }).epcis.storage).toEqual({ kind: 'file', dir: '/var/lib/dpp/epcis' })
    expect(() => loadConfig({ EPCIS_STORAGE: 'postgres' })).toThrow('EPCIS_STORAGE must be mongodb or file')
    expect(loadConfig({ PROFILE_BUNDLE_DIR: 'local/profile-bundle' }).profileBundleDir).toBe('local/profile-bundle')
    expect(loadConfig({ VALIDATOR_URL: 'http://validator:8090/', VALIDATOR_TOKEN: 'a-token' }).validator).toEqual({ url: 'http://validator:8090', token: 'a-token' })
    expect(loadConfig({ INDEX_EXPORT_TOKEN: 'export-token', INDEX_EXPORTER_KEY: `02${'ab'.repeat(32)}` }).indexExport).toEqual({ token: 'export-token', exporterKey: `02${'ab'.repeat(32)}` })
    expect(() => loadConfig({ INDEX_EXPORTER_KEY: 'not-a-key' })).toThrow(/INDEX_EXPORTER_KEY must be a compressed public key/)
  })

  it('refuses a validator setting it cannot use, by name and without repeating it', () => {
    const secret = 'validator-token-5c1d9e'
    for (const [env, expected] of [
      [{ VALIDATOR_URL: 'ftp://validator.example/' }, /VALIDATOR_URL must be the http or https address/],
      [{ VALIDATOR_URL: 'not an address' }, /VALIDATOR_URL must be the http or https address/],
      [{ VALIDATOR_URL: `https://operator:${secret}@validator.example` }, /VALIDATOR_URL carries user information/],
      [{ VALIDATOR_URL: `https://validator.example/?token=${secret}` }, /VALIDATOR_URL carries a query or a fragment/],
      [{ VALIDATOR_TOKEN: secret }, /VALIDATOR_TOKEN is set without VALIDATOR_URL/],
      [{ VALIDATOR_URL: 'https://validator.example', VALIDATOR_TOKEN: `${secret} with a space` }, /VALIDATOR_TOKEN must be visible ASCII/],
    ] as const) {
      let message = ''
      try {
        loadConfig(env)
      } catch (cause) {
        message = (cause as Error).message
      }
      expect(message, JSON.stringify(Object.keys(env))).toMatch(expected)
      expect(message).not.toContain(secret)
    }
  })

  it('knows which network each hosted index serves', () => {
    expect(KNOWN_INDEX_HOSTS['dpp-overlay-testnet.bsvb.net']).toBe('test')
    expect(KNOWN_INDEX_HOSTS['dpp-overlay-mainnet.bsvb.net']).toBe('main')
    expect(KNOWN_INDEX_HOSTS['dpp-overlay.bsvb.net']).toBe('main')
  })
})
