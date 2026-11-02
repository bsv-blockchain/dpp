import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  FilePublisherTokenStore,
  InMemoryPublisherTokenStore,
  MongoPublisherTokenStore,
  PUBLISHER_TOKENS_FORMAT,
  issueToken,
  newToken,
  tokenDigest,
  tokenStoreFromEnvironment,
  writeAccessWarnings,
  type PublisherTokenStore,
} from '../src/publisherTokens.js'

/**
 * The per-publisher token store: a token belongs to one key and one use, is
 * kept as its SHA-256 only, and is revoked in place. The same contract runs
 * over the memory, file and Mongo implementations; the Mongo half runs
 * against a real mongod, as storage.test.ts does.
 */
const KEY_A = '02' + '11'.repeat(32)
const KEY_B = '03' + '22'.repeat(32)
const NOW = () => new Date('2026-11-02T10:00:00Z')

let mongod: MongoMemoryServer | undefined
let client: MongoClient | undefined
let count = 0
const temps: string[] = []

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
}, 300_000)

afterAll(async () => {
  await client?.close()
  await mongod?.stop()
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-tokens-'))
  temps.push(dir)
  return join(dir, 'publisher-tokens.json')
}

const stores: Array<[string, () => PublisherTokenStore]> = [
  ['memory', () => new InMemoryPublisherTokenStore()],
  ['file', () => new FilePublisherTokenStore(tempFile())],
  ['mongo', () => new MongoPublisherTokenStore(client!.db(`tokens-${count++}`))],
]

describe.each(stores)('the %s token store', (_name, open) => {
  it('issues a 64-hex token whose digest finds a record bound to the key and use, and never stores the token', async () => {
    const store = open()
    const { token, record } = await issueToken(store, KEY_A, 'submit', 'app one', NOW)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(record).toEqual({ sha256: tokenDigest(token), publisherKey: KEY_A, use: 'submit', label: 'app one', issuedAt: '2026-11-02T10:00:00Z' })
    expect(await store.find(tokenDigest(token))).toEqual(record)
    expect(await store.find(tokenDigest(newToken()))).toBeUndefined()
    expect(JSON.stringify(await store.list())).not.toContain(token)
  })

  it('revokes in place: the record stays, marked revoked, and a second revocation is false', async () => {
    const store = open()
    const { token } = await issueToken(store, KEY_A, 'callback', 'app one', NOW)
    expect(await store.revoke(tokenDigest(token), '2026-11-02T11:00:00Z')).toBe(true)
    expect((await store.find(tokenDigest(token)))?.revokedAt).toBe('2026-11-02T11:00:00Z')
    expect(await store.revoke(tokenDigest(token), '2026-11-02T12:00:00Z')).toBe(false)
    expect(await store.revoke(tokenDigest(newToken()), '2026-11-02T12:00:00Z')).toBe(false)
  })

  it('refuses a second record with the same digest and lists records oldest first', async () => {
    const store = open()
    const { record } = await issueToken(store, KEY_A, 'submit', 'one', NOW)
    await expect(store.issue(record)).rejects.toThrow(/already/)
    await issueToken(store, KEY_B, 'submit', 'two', () => new Date('2026-11-02T10:00:01Z'))
    expect((await store.list()).map((r) => r.label)).toEqual(['one', 'two'])
  })
})

describe('issuing', () => {
  it('refuses a key that is not a compressed public key, an unknown use and a label over 128 bytes', async () => {
    const store = new InMemoryPublisherTokenStore()
    await expect(issueToken(store, 'nope', 'submit', 'x', NOW)).rejects.toThrow(/compressed public key/)
    await expect(issueToken(store, KEY_A, 'export' as never, 'x', NOW)).rejects.toThrow(/use/)
    await expect(issueToken(store, KEY_A, 'submit', 'y'.repeat(129), NOW)).rejects.toThrow(/label/)
    await expect(issueToken(store, KEY_A, 'submit', 'bad\u0000label', NOW)).rejects.toThrow(/label/)
  })

  it('lower-cases the publisher key so a token matches however the key was typed', async () => {
    const store = new InMemoryPublisherTokenStore()
    const { record } = await issueToken(store, KEY_A.toUpperCase(), 'submit', 'x', NOW)
    expect(record.publisherKey).toBe(KEY_A)
  })
})

describe('the file store', () => {
  it('writes the dpp-publisher-tokens@1 document and a second instance over the same path reads it', async () => {
    const path = tempFile()
    const first = new FilePublisherTokenStore(path)
    const { token } = await issueToken(first, KEY_A, 'submit', 'app', NOW)
    const document = JSON.parse(readFileSync(path, 'utf8'))
    expect(document.format).toBe(PUBLISHER_TOKENS_FORMAT)
    expect(document.tokens).toHaveLength(1)
    const second = new FilePublisherTokenStore(path)
    expect((await second.find(tokenDigest(token)))?.publisherKey).toBe(KEY_A)
  })

  it('is an empty store when the file does not exist yet, and re-reads when another writer changes the file', async () => {
    const path = tempFile()
    const store = new FilePublisherTokenStore(path)
    expect(await store.list()).toEqual([])
    const other = new FilePublisherTokenStore(path)
    const { token } = await issueToken(other, KEY_B, 'callback', 'late', NOW)
    expect((await store.find(tokenDigest(token)))?.use).toBe('callback')
    await other.revoke(tokenDigest(token), '2026-11-02T11:00:00Z')
    expect((await store.find(tokenDigest(token)))?.revokedAt).toBe('2026-11-02T11:00:00Z')
  })

  it('writes the file world-readable, since it holds digests and the container reads it as another user', async () => {
    const path = tempFile()
    await issueToken(new FilePublisherTokenStore(path), KEY_A, 'submit', 'app', NOW)
    expect(statSync(path).mode & 0o777).toBe(0o644)
  })

  it('refuses a file of another format', async () => {
    const path = tempFile()
    writeFileSync(path, JSON.stringify({ format: 'something-else', tokens: [] }))
    await expect(new FilePublisherTokenStore(path).list()).rejects.toThrow(/dpp-publisher-tokens@1/)
  })
})

describe('writeAccessWarnings', () => {
  it('warns only for a route with neither a legacy token nor a store', () => {
    expect(writeAccessWarnings({ store: false })).toHaveLength(2)
    expect(writeAccessWarnings({ store: true })).toEqual([])
    expect(writeAccessWarnings({ submitToken: 'x', store: false }).map((w) => w.split(' ')[0])).toEqual(['ARC_CALLBACK_TOKEN'])
    expect(writeAccessWarnings({ submitToken: '', proofToken: 'y', store: false }).map((w) => w.split(' ')[0])).toEqual(['SUBMIT_TOKEN'])
  })
})

describe('tokenStoreFromEnvironment', () => {
  it('selects the file store when PUBLISHER_TOKENS_FILE is set, Mongo when a database is given, memory otherwise', () => {
    const path = tempFile()
    expect(tokenStoreFromEnvironment({ PUBLISHER_TOKENS_FILE: path }, client!.db('env'))).toBeInstanceOf(FilePublisherTokenStore)
    expect(tokenStoreFromEnvironment({}, client!.db('env'))).toBeInstanceOf(MongoPublisherTokenStore)
    expect(tokenStoreFromEnvironment({}, undefined)).toBeInstanceOf(InMemoryPublisherTokenStore)
    expect(tokenStoreFromEnvironment({ PUBLISHER_TOKENS_FILE: '  ' }, undefined)).toBeInstanceOf(InMemoryPublisherTokenStore)
  })
})
