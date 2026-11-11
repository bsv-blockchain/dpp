import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { connectionUrl, runConnectionCommand } from '../src/connectionCommand.js'
import { FilePublisherTokenStore, tokenDigest } from '../src/publisherTokens.js'

/**
 * `dpp-index connection`: one application's submit and callback tokens,
 * issued into the store the environment names and printed once as the env
 * file the application starter reads. Here the store is a tokens file; the
 * Compose preset's MongoDB store shares its contract (publisherTokens.test.ts).
 */
const APP_KEY = '02' + '11'.repeat(32)
const OTHER_KEY = '03' + '22'.repeat(32)
const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function operator(extra: Record<string, string> = {}): { env: Record<string, string>; tokensFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-connection-'))
  temps.push(dir)
  const tokensFile = join(dir, 'publisher-tokens.json')
  return { env: { PUBLISHER_TOKENS_FILE: tokensFile, SERVICE_IDENTITY_KEY: APP_KEY, NETWORK: 'test', PUBLIC_URL: 'https://index.example.org/', ...extra }, tokensFile }
}

async function connection(env: Record<string, string>, values: { publisher?: string; url?: string; label?: string } = {}): Promise<Record<string, string | undefined>> {
  const lines: string[] = []
  await runConnectionCommand(values, env, (line) => lines.push(line), () => new Date('2026-11-09T10:00:00Z'))
  return parseEnv(lines.join('\n'))
}

describe('dpp-index connection', () => {
  it('issues the configured publisher a submit and a callback token and prints the four settings the application reads', async () => {
    const { env, tokensFile } = operator()
    const file = await connection(env)
    expect(Object.keys(file).sort()).toEqual(['INDEX_CALLBACK_TOKEN', 'INDEX_SUBMIT_TOKEN', 'INDEX_URL', 'NETWORK'])
    expect(file.NETWORK).toBe('test')
    expect(file.INDEX_URL).toBe('https://index.example.org')
    expect(file.INDEX_SUBMIT_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    expect(file.INDEX_CALLBACK_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    const store = new FilePublisherTokenStore(tokensFile)
    expect(await store.find(tokenDigest(file.INDEX_SUBMIT_TOKEN!))).toMatchObject({ publisherKey: APP_KEY, use: 'submit', label: 'app:submit' })
    expect(await store.find(tokenDigest(file.INDEX_CALLBACK_TOKEN!))).toMatchObject({ publisherKey: APP_KEY, use: 'callback', label: 'app:callback' })
  })

  it('rotates on a rerun: the label\'s earlier pair is revoked, another label\'s and another key\'s stay live', async () => {
    const { env, tokensFile } = operator()
    const first = await connection(env)
    const second = await connection(env, { label: 'second-app' })
    const other = await connection(env, { publisher: OTHER_KEY })
    const third = await connection(env)
    const store = new FilePublisherTokenStore(tokensFile)
    for (const token of [first.INDEX_SUBMIT_TOKEN, first.INDEX_CALLBACK_TOKEN]) expect((await store.find(tokenDigest(token!)))?.revokedAt).toBe('2026-11-09T10:00:00Z')
    for (const token of [second.INDEX_SUBMIT_TOKEN, other.INDEX_CALLBACK_TOKEN, third.INDEX_SUBMIT_TOKEN, third.INDEX_CALLBACK_TOKEN]) expect((await store.find(tokenDigest(token!)))?.revokedAt).toBeUndefined()
    expect((await store.find(tokenDigest(other.INDEX_SUBMIT_TOKEN!)))?.publisherKey).toBe(OTHER_KEY)
  })

  it('takes the address from --url over PUBLIC_URL, keeps a path and drops the trailing slash', async () => {
    const { env } = operator()
    expect((await connection(env, { url: 'http://index:8080/' })).INDEX_URL).toBe('http://index:8080')
    expect((await connection(env, { url: 'https://example.org/dpp/' })).INDEX_URL).toBe('https://example.org/dpp')
  })

  it('refuses before issuing anything without a publisher, an address, a known network or a plain URL', async () => {
    const { env, tokensFile } = operator()
    await expect(connection({ ...env, SERVICE_IDENTITY_KEY: '' })).rejects.toThrow('--publisher')
    await expect(connection({ ...env, PUBLIC_URL: '' })).rejects.toThrow('--url')
    await expect(connection({ ...env, NETWORK: 'regtest' })).rejects.toThrow('NETWORK')
    await expect(connection(env, { publisher: 'not-a-key' })).rejects.toThrow('compressed public key')
    expect(() => connectionUrl('index.example.org')).toThrow('absolute URL')
    expect(() => connectionUrl('ftp://index.example.org')).toThrow('http or https')
    expect(() => connectionUrl('https://user:secret@index.example.org')).toThrow('credentials')
    expect(await new FilePublisherTokenStore(tokensFile).list()).toEqual([])
  })
})
