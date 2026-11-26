import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { goLive } from '../src/go-live.js'

vi.mock('@bsv/dpp-protocol', async importOriginal => ({
  ...await importOriginal<typeof import('@bsv/dpp-protocol')>(),
  SUPPORTED_VERSIONS: ['1', '2', '3'],
}))

it('refuses a v3-capable protocol before enabling live publishing or opening the wallet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-v3-hold-'))
  const openPlatform = vi.fn()
  try {
    const result = await goLive({ env: {}, envFile: join(dir, '.env'), projectName: 'test', out: () => {}, openPlatform })
    expect(result.ok).toBe(false)
    expect(result.failures[0].problem).toContain('1Color')
    expect(openPlatform).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual([])
    expect(() => loadConfig({ LIVE_PUBLISHING: 'true' })).toThrow(/1Color/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
