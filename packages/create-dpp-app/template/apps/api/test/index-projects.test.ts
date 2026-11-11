import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readEnvFile } from '../src/env-file.js'
import { connectIndex } from '../src/index-projects.js'

/**
 * connect-index writes a provider's address and tokens and runs the checks.
 * --from takes them from the connection file an index operator writes with
 * dpp-index connection, in the form that command prints.
 */
const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

const secrets = { AUTH_SECRET: 'a'.repeat(64), BRAND_ROOT_SECRET: 'b'.repeat(64), MANAGED_IDENTITY_SECRET: 'c'.repeat(64) }

function app(): { root: string; envFile: string } {
  const parent = mkdtempSync(join(tmpdir(), 'dpp-index-projects-'))
  temps.push(parent)
  const root = join(parent, 'my-app')
  mkdirSync(root)
  const envFile = join(root, '.env')
  writeFileSync(envFile, `NETWORK=test\nINDEX_URL=\nINDEX_SUBMIT_TOKEN=\nINDEX_CALLBACK_TOKEN=\nLIVE_PUBLISHING=false\nDPP_TEST_WALLET=1\nWALLET_ROOT_KEY=${'77'.repeat(32)}\n`)
  return { root, envFile }
}

describe('connect-index', () => {
  it('writes the address and the tokens given, then runs the checks against the file', async () => {
    const { root, envFile } = app()
    const lines: string[] = []
    const result = await connectIndex({ env: { ...secrets, ...readEnvFile(envFile) }, envFile, projectName: 'my-app', out: (line) => lines.push(line), url: 'http://127.0.0.1:1/', submitToken: 'd'.repeat(64), callbackToken: 'e'.repeat(64) })
    const file = readEnvFile(envFile)
    expect(file.INDEX_URL).toBe('http://127.0.0.1:1')
    expect(file.INDEX_SUBMIT_TOKEN).toBe('d'.repeat(64))
    expect(file.INDEX_CALLBACK_TOKEN).toBe('e'.repeat(64))
    // The checks ran: the index at port 1 is unreachable.
    expect(result.ok).toBe(false)
    expect(result.failures.map((f) => f.check)).toEqual(['index'])
    expect(existsSync(join(root, '.env'))).toBe(true)
  })

  it('needs an address', async () => {
    const { envFile } = app()
    const result = await connectIndex({ env: { ...secrets }, envFile, projectName: 'my-app', out: () => {}, url: '' })
    expect(result.failures[0]?.fix).toContain('--url')
  })
})

describe('connect-index --from', () => {
  function connection(dir: string, network: string): string {
    const path = join(dir, 'app.env')
    writeFileSync(path, `# The index connection for an application server.\nNETWORK=${network}\nINDEX_URL=http://127.0.0.1:1/\nINDEX_SUBMIT_TOKEN=${'f'.repeat(64)}\nINDEX_CALLBACK_TOKEN=${'9'.repeat(64)}\n`)
    return path
  }

  it('takes the address and both tokens from the operator\'s connection file, never printing a token, then runs the checks', async () => {
    const { root, envFile } = app()
    const lines: string[] = []
    const result = await connectIndex({ env: { ...secrets, ...readEnvFile(envFile) }, envFile, projectName: 'my-app', out: (line) => lines.push(line), from: connection(root, 'test') })
    const file = readEnvFile(envFile)
    expect(file.INDEX_URL).toBe('http://127.0.0.1:1')
    expect(file.INDEX_SUBMIT_TOKEN).toBe('f'.repeat(64))
    expect(file.INDEX_CALLBACK_TOKEN).toBe('9'.repeat(64))
    expect(file.LIVE_PUBLISHING).toBe('false')
    expect(result.failures.map((f) => f.check)).toEqual(['index'])
    expect(lines.join('\n')).not.toContain('f'.repeat(64))
  })

  it('refuses a file for the other network and a missing file, before writing anything', async () => {
    const { root, envFile } = app()
    const env = { ...secrets, ...readEnvFile(envFile) }
    const other = await connectIndex({ env, envFile, projectName: 'my-app', out: () => {}, from: connection(root, 'main') })
    expect(other.failures[0]?.problem).toContain('main index')
    const missing = await connectIndex({ env, envFile, projectName: 'my-app', out: () => {}, from: join(root, 'absent.env') })
    expect(missing.failures[0]?.problem).toContain('does not exist')
    expect(readEnvFile(envFile).INDEX_URL).toBe('')
  })
})
