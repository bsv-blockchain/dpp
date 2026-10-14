import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const rootKey = '11'.repeat(32)

describe('configuration', () => {
  it('runs without an index in development', () => {
    expect(loadConfig({ LIVE_PUBLISHING: 'false' }).index.url).toBeUndefined()
  })

  it('refuses to write to the chain without an index that persists', () => {
    expect(() => loadConfig({ LIVE_PUBLISHING: 'true', WALLET_ROOT_KEY: rootKey })).toThrow(/INDEX_URL/)
    expect(loadConfig({ LIVE_PUBLISHING: 'true', WALLET_ROOT_KEY: rootKey, INDEX_URL: 'http://index.example:8080/' }).index.url).toBe('http://index.example:8080')
  })
})
