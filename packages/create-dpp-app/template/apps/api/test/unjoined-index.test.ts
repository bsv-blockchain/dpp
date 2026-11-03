import { describe, expect, it } from 'vitest'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { INDEX_REGISTRATION_FORMAT, signRegistration } from '@bsv/dpp-protocol'
import { loadConfig } from '../src/config.js'
import { startDevIndex } from '../src/dev-index.js'
import { openPlatform } from '../src/platform.js'

/**
 * Before go-live, an index address with no tokens is one this app has not
 * joined: the platform keeps the in-process index and says so, naming the
 * command. The in-process index itself can run registration open, for the
 * go-live test, and reports the network it was started on.
 */
describe('an index the app has not joined', () => {
  it('starts the in-process index and names go-live, instead of announcing to an index that would refuse', async () => {
    const lines: string[] = []
    const platform = await openPlatform({ config: loadConfig({ INDEX_URL: 'https://dpp-overlay-testnet.bsvb.net', NETWORK: 'test' }), mode: 'live', log: (line) => lines.push(line) })
    try {
      expect(platform.index.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(lines.some((line) => /^This app has not joined https:\/\/dpp-overlay-testnet\.bsvb\.net yet .* npm run go-live /.test(line))).toBe(true)
      expect(await platform.index.health()).toMatchObject({ status: 'ok', network: 'test' })
    } finally {
      await platform.close()
    }
  })

  it('opens the test wallet on the configured root key when DPP_TEST_WALLET=1, so the registered key is the key in .env', async () => {
    const rootKey = '77'.repeat(32)
    const lines: string[] = []
    const platform = await openPlatform({ config: loadConfig({ WALLET_ROOT_KEY: rootKey, DPP_TEST_WALLET: '1', NETWORK: 'test' }), mode: 'live', log: (line) => lines.push(line) })
    try {
      expect(platform.wallet.kind).toBe('test')
      expect(platform.wallet.identityKey).toBe(PrivateKey.fromHex(rootKey).toPublicKey().toString())
      expect(lines.some((line) => line.includes('DPP_TEST_WALLET'))).toBe(true)
    } finally {
      await platform.close()
    }
  })
})

describe('the in-process index with registration open', () => {
  it('registers a wallet-signed request and names the key afterwards', async () => {
    const app = PrivateKey.fromHex('78'.repeat(32))
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open' })
    try {
      const request = await signRegistration(
        { registrationFormat: INDEX_REGISTRATION_FORMAT, indexUrl: index.url, publisherKey: app.toPublicKey().toString(), network: 'test', custodyProfile: 'managed-custody@2', label: 'test app', requestedAt: new Date().toISOString() },
        new ProtoWallet(app)
      )
      const response = await fetch(`${index.url}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      expect(response.status).toBe(201)
      const body = (await response.json()) as { tokens: { submit: string; callback: string } }
      expect(body.tokens.submit).toMatch(/^[0-9a-f]{64}$/)
      const capabilities = (await (await fetch(`${index.url}/capabilities`)).json()) as { publisherPolicy: { publisherKeys: string[] }; profiles: Array<{ kind: string; id: string; version: string; options?: Record<string, unknown> }> }
      expect(capabilities.publisherPolicy.publisherKeys).toContain(app.toPublicKey().toString())
      expect(capabilities.profiles.find((p) => p.kind === 'operator')?.options?.registration).toBe('open')
      expect(capabilities.profiles.find((p) => p.kind === 'custody')).toMatchObject({ id: 'managed-custody', version: '2' })
    } finally {
      await index.close()
    }
  })
})
