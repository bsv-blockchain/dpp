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

  it('knows which network each hosted index serves', () => {
    expect(KNOWN_INDEX_HOSTS['dpp-overlay-testnet.bsvb.net']).toBe('test')
    expect(KNOWN_INDEX_HOSTS['dpp-overlay.bsvb.net']).toBe('main')
  })
})
