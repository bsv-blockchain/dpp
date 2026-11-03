import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readEnvFile, updateEnvFile } from '../src/env-file.js'

const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function envFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-env-'))
  temps.push(dir)
  const path = join(dir, '.env')
  writeFileSync(path, content)
  return path
}

describe('the .env file', () => {
  it('rewrites the named keys in place, keeps every other line and comment, and appends a key the file lacks', async () => {
    const path = envFile('# The chain\nNETWORK=main\n\n# Index\nINDEX_URL=\nINDEX_SUBMIT_TOKEN=\nLIVE_PUBLISHING=false\n')
    await updateEnvFile(path, { INDEX_URL: 'https://index.example', INDEX_SUBMIT_TOKEN: 'a'.repeat(64), WALLET_ROOT_KEY: 'b'.repeat(64) })
    expect(readFileSync(path, 'utf8')).toBe('# The chain\nNETWORK=main\n\n# Index\nINDEX_URL=https://index.example\nINDEX_SUBMIT_TOKEN=' + 'a'.repeat(64) + '\nLIVE_PUBLISHING=false\nWALLET_ROOT_KEY=' + 'b'.repeat(64) + '\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readEnvFile(path)).toMatchObject({ NETWORK: 'main', INDEX_URL: 'https://index.example', WALLET_ROOT_KEY: 'b'.repeat(64) })
  })

  it('rewrites every occurrence of a duplicated key, so what the API reads is what was written', async () => {
    const path = envFile('INDEX_SUBMIT_TOKEN=\n# pasted from a provider\nINDEX_SUBMIT_TOKEN=old\nLIVE_PUBLISHING=false\n')
    await updateEnvFile(path, { INDEX_SUBMIT_TOKEN: 'new' })
    expect(readFileSync(path, 'utf8')).toBe('INDEX_SUBMIT_TOKEN=new\n# pasted from a provider\nINDEX_SUBMIT_TOKEN=new\nLIVE_PUBLISHING=false\n')
    expect(readEnvFile(path).INDEX_SUBMIT_TOKEN).toBe('new')
  })

  it('creates the file when it does not exist and reads nothing from a missing one', async () => {
    const path = join(dirname(envFile('')), 'missing.env')
    expect(readEnvFile(path)).toEqual({})
    await updateEnvFile(path, { LIVE_PUBLISHING: 'true' })
    expect(readFileSync(path, 'utf8')).toBe('LIVE_PUBLISHING=true\n')
  })
})
