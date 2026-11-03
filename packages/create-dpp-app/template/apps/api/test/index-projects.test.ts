import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readEnvFile } from '../src/env-file.js'
import { addIndex, connectIndex } from '../src/index-projects.js'

/**
 * connect-index writes a provider's address and tokens and runs the checks;
 * add-index creates an index project beside the app with the app's
 * publisher key, takes the connection its connection script wrote and runs
 * the configuration checks. Here the index starter is a stub command that
 * writes .app.env the way the real one does, through the package override
 * the scaffold check also uses.
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

describe('add-index', () => {
  it('creates the index project beside the app through the index starter, takes its connection and runs the configuration checks', async () => {
    const { root, envFile } = app()
    const parent = join(root, '..')
    // A stub for `npm exec --package <spec> -- create-dpp-index`: records its arguments and writes .app.env as the starter's connection script does.
    const stubDir = mkdtempSync(join(tmpdir(), 'dpp-stub-starter-'))
    temps.push(stubDir)
    const stub = join(stubDir, 'create-dpp-index')
    writeFileSync(stub, `#!/bin/sh\nmkdir -p "$1"\nprintf '%s\\n' "$@" > "$1/args.txt"\nprintf 'NETWORK=test\\nINDEX_URL=http://localhost:8080\\nINDEX_SUBMIT_TOKEN=${'f'.repeat(64)}\\nINDEX_CALLBACK_TOKEN=${'9'.repeat(64)}\\n' > "$1/.app.env"\n`)
    chmodSync(stub, 0o755)
    const lines: string[] = []
    const result = await addIndex({
      env: { ...secrets, ...readEnvFile(envFile) },
      envFile,
      projectName: 'my-app',
      out: (line) => lines.push(line),
      directory: 'my-app-index',
      parentDirectory: parent,
      existsSync,
      createCommand: [stub],
      connectionCommand: ['true'],
      publisherKey: '02' + '11'.repeat(32),
      indexStarterVersion: '0.1.0-beta.2',
    })
    expect(result.ok).toBe(true)
    const args = readFileSync(join(parent, 'my-app-index', 'args.txt'), 'utf8').split('\n')
    expect(args[0]).toBe(join(parent, 'my-app-index'))
    expect(args).toContain('--publisher-key')
    expect(args).toContain('02' + '11'.repeat(32))
    expect(args).toContain('--network')
    expect(args).toContain('test')
    const file = readEnvFile(envFile)
    expect(file.INDEX_URL).toBe('http://localhost:8080')
    expect(file.INDEX_SUBMIT_TOKEN).toBe('f'.repeat(64))
    expect(file.LIVE_PUBLISHING).toBe('false')
    const output = lines.join('\n')
    expect(output).toContain('npm run up')
    expect(output).toContain('npm run go-live')
    expect(output).not.toContain('f'.repeat(64))
  })

  it('refuses to run an unpinned index starter', async () => {
    const { root, envFile } = app()
    const result = await addIndex({ env: { ...secrets, ...readEnvFile(envFile) }, envFile, projectName: 'my-app', out: () => {}, directory: 'new-index', parentDirectory: join(root, '..'), existsSync, createCommand: ['false'], publisherKey: '02' + '11'.repeat(32) })
    expect(result.ok).toBe(false)
    expect(result.failures[0]?.problem).toContain('indexStarter')
  })

  it('refuses a directory that already exists, before creating anything', async () => {
    const { root, envFile } = app()
    const parent = join(root, '..')
    mkdirSync(join(parent, 'taken'))
    const result = await addIndex({ env: { ...secrets, ...readEnvFile(envFile) }, envFile, projectName: 'my-app', out: () => {}, directory: 'taken', parentDirectory: parent, existsSync, createCommand: ['false'], publisherKey: '02' + '11'.repeat(32), indexStarterVersion: '0.1.0-beta.2' })
    expect(result.ok).toBe(false)
    expect(result.failures[0]?.problem).toContain('taken')
    expect(readEnvFile(envFile).INDEX_URL).toBe('')
  })
})
