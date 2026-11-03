import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import { readEnvFile } from '../src/env-file.js'
import { startDevIndex, type DevIndex } from '../src/dev-index.js'
import { goLive, type GoLiveOptions } from '../src/go-live.js'
import { openPlatform } from '../src/platform.js'

/**
 * npm run go-live against an in-process index with registration open: the
 * first run makes the root key, registers the publisher key, stores the two
 * tokens and flips LIVE_PUBLISHING; a second run changes nothing; every
 * failure names its fix. The test wallet stands in (DPP_TEST_WALLET=1), as
 * it does in the scaffold check.
 */
const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

const secrets = { AUTH_SECRET: 'a'.repeat(64), BRAND_ROOT_SECRET: 'b'.repeat(64), MANAGED_IDENTITY_SECRET: 'c'.repeat(64) }

function project(env: Record<string, string>): { envFile: string; env: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-go-live-'))
  temps.push(dir)
  const envFile = join(dir, '.env')
  writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  return { envFile, env }
}

async function run(index: DevIndex | { url: string }, overrides: Record<string, string> = {}, options: Partial<GoLiveOptions> = {}) {
  const { envFile, env } = project({ NETWORK: 'test', INDEX_URL: index.url, DPP_TEST_WALLET: '1', PASSPORT_HOST: 'localhost:3000', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false', ...secrets, ...overrides })
  const lines: string[] = []
  const result = await goLive({ env: { ...env }, envFile, projectName: 'my-test-app', out: (line) => lines.push(line), ...options })
  return { result, lines, envFile, file: readEnvFile(envFile) }
}

const failure = (result: { failures: Array<{ check: string }> }, check: string) => result.failures.find((f) => f.check === check)

describe('go-live', () => {
  it('registers on the first run, stores the tokens and goes live; a second run keeps everything', async () => {
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open' })
    try {
      const first = await run(index)
      expect(first.result.failures).toEqual([])
      expect(first.result.ok).toBe(true)
      expect(first.file.WALLET_ROOT_KEY).toMatch(/^[0-9a-f]{64}$/)
      expect(first.file.INDEX_SUBMIT_TOKEN).toMatch(/^[0-9a-f]{64}$/)
      expect(first.file.INDEX_CALLBACK_TOKEN).toMatch(/^[0-9a-f]{64}$/)
      expect(first.file.LIVE_PUBLISHING).toBe('true')
      const key = PrivateKey.fromHex(first.file.WALLET_ROOT_KEY).toPublicKey().toString()
      const policy = (await (await fetch(`${index.url}/publisher-policy`)).json()) as Array<{ publishers: Array<{ key: string }> }>
      expect(policy[policy.length - 1].publishers.map((p) => p.key)).toContain(key)
      const output = first.lines.join('\n')
      expect(output).toContain('DPP_TEST_WALLET')
      expect(output).not.toContain(first.file.WALLET_ROOT_KEY)
      expect(output).not.toContain(first.file.INDEX_SUBMIT_TOKEN)
      expect(output).toContain(key)
      expect(output).toMatch(/real satoshis/)

      // The same file again: nothing re-registers, the tokens and the key stay.
      const again = await goLive({ env: { ...first.file }, envFile: first.envFile, projectName: 'my-test-app', out: () => {} })
      expect(again.failures).toEqual([])
      const file = readEnvFile(first.envFile)
      expect(file.INDEX_SUBMIT_TOKEN).toBe(first.file.INDEX_SUBMIT_TOKEN)
      expect(file.WALLET_ROOT_KEY).toBe(first.file.WALLET_ROOT_KEY)
      expect((await (await fetch(`${index.url}/publisher-policy`)).json()).length).toBe(policy.length)
    } finally {
      await index.close()
    }
  })

  it('under approval, reports the wait and collects the tokens once the operator approved', async () => {
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'approval' })
    try {
      const first = await run(index)
      const pending = failure(first.result, 'registration')
      expect(pending?.problem).toMatch(/approv/)
      expect(pending?.fix).toContain('go-live')
      expect(first.file.LIVE_PUBLISHING).toBe('false')
      expect(first.file.INDEX_SUBMIT_TOKEN).toBeUndefined()
      await index.approve!(PrivateKey.fromHex(first.file.WALLET_ROOT_KEY).toPublicKey().toString())
      const second = await goLive({ env: { ...first.file }, envFile: first.envFile, projectName: 'my-test-app', out: () => {} })
      expect(second.failures).toEqual([])
      expect(readEnvFile(first.envFile).LIVE_PUBLISHING).toBe('true')
    } finally {
      await index.close()
    }
  })

  it('decides LIVE_PUBLISHING itself: a file already saying true without tokens is not a dead end', async () => {
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open' })
    try {
      const result = await run(index, { LIVE_PUBLISHING: 'true' })
      expect(result.result.failures).toEqual([])
      expect(result.file.INDEX_SUBMIT_TOKEN).toMatch(/^[0-9a-f]{64}$/)
      expect(result.file.LIVE_PUBLISHING).toBe('true')
    } finally {
      await index.close()
    }
  })

  it('names the reason an index could not be reached, and a request the protocol refuses to sign, without a stack trace', async () => {
    const unreachable = await run({ url: 'http://127.0.0.1:1' })
    expect(failure(unreachable.result, 'index')?.problem).toMatch(/could not be reached: fetch failed \(.+\)/)
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open' })
    try {
      const bad = await run(index, {}, { projectName: 'my\u0007app' })
      expect(failure(bad.result, 'registration')?.problem).toMatch(/label/)
      expect(failure(bad.result, 'registration')?.fix).toContain('package.json')
    } finally {
      await index.close()
    }
  })

  it('refuses a known host on the wrong network and a placeholder secret at configuration, before touching the wallet or the index', async () => {
    const wrong = await run({ url: 'https://dpp-overlay.bsvb.net' })
    expect(failure(wrong.result, 'configuration')?.problem).toMatch(/dpp-overlay\.bsvb\.net.*main/)
    expect(wrong.file.WALLET_ROOT_KEY).toBeUndefined()
    const placeholder = await run({ url: 'https://dpp-overlay-testnet.bsvb.net' }, { AUTH_SECRET: 'change-me-to-32-random-bytes-hex' })
    expect(failure(placeholder.result, 'configuration')?.problem).toContain('AUTH_SECRET')
    expect(placeholder.lines.join('\n')).not.toContain('change-me-to-32-random-bytes-hex')
    const mainnet = await run({ url: 'https://dpp-overlay.bsvb.net' }, { NETWORK: 'main' })
    expect(mainnet.result.failures.filter((f) => f.check === 'configuration').map((f) => `${f.problem} ${f.fix}`).join(' ')).toMatch(/952.*licensed/)
    expect(mainnet.result.failures.map((f) => f.problem).join(' ')).toContain('PASSPORT_HOST')
  })

  it('names an unreachable index, a network mismatch and a custody profile mismatch at the index check', async () => {
    const unreachable = await run({ url: 'http://127.0.0.1:1' })
    expect(failure(unreachable.result, 'index')?.problem).toMatch(/reach/)
    expect(failure(unreachable.result, 'index')?.fix).toContain('connect-index')
    const mainnetIndex = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'main', registration: 'open' })
    try {
      const mismatch = await run(mainnetIndex)
      expect(failure(mismatch.result, 'index')?.problem).toMatch(/main.*test|test.*main/)
    } finally {
      await mainnetIndex.close()
    }
    const baseline = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open', custody: 'record-model-baseline@2' })
    try {
      const custody = await run(baseline)
      expect(failure(custody.result, 'index')?.problem).toContain('record-model-baseline@2')
    } finally {
      await baseline.close()
    }
  })

  it('reports an index that does not register, and empty funds with the funding address', async () => {
    const closed = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test' })
    try {
      const refused = await run(closed)
      expect(failure(refused.result, 'registration')?.problem).toMatch(/does not register/)
      expect(failure(refused.result, 'registration')?.fix).toContain('connect-index')
    } finally {
      await closed.close()
    }
    const index = await startDevIndex({ publisherKey: PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), network: 'test', registration: 'open' })
    try {
      const broke = await run(index, {}, {
        openPlatform: async (options) => {
          const platform = await openPlatform(options)
          platform.wallet.balance = async () => 0
          return platform
        },
      })
      expect(failure(broke.result, 'funds')?.problem).toMatch(/0 satoshis/)
      expect(failure(broke.result, 'funds')?.fix).toMatch(/wallet fund/)
      expect(broke.file.INDEX_SUBMIT_TOKEN).toMatch(/^[0-9a-f]{64}$/)
      expect(broke.file.LIVE_PUBLISHING).toBe('false')
    } finally {
      await index.close()
    }
  })
})
