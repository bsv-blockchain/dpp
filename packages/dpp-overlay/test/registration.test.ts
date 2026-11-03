import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { appendPublisherVersion, verifyPolicyChain, type PublisherPolicy } from '@bsv/dpp-protocol'
import {
  FileRegistrationStore,
  InMemoryRegistrationStore,
  MongoRegistrationStore,
  REGISTRATIONS_FORMAT,
  mergeAppendedVersions,
  refreshPolicyChain,
  appendRegistrationVersion,
  registrationSettingsFromEnvironment,
  registrationStoreFromEnvironment,
  sameIndexUrl,
  sourceAddress,
  type Registration,
  type RegistrationStore,
} from '../src/registration.js'
import type { PublisherPolicyConfig } from '../src/policyConfig.js'
import { FEDERATION_OPERATORS, OPERATORS, STRANGER, federatedChain, operatorPriv, policyChain, pub } from './policy-fixture.js'

/**
 * The registration store: the policy versions an index appended for
 * registered publishers and the record of each registration, over memory, a
 * policy file with a sibling registrations file, and the index's MongoDB
 * database. The same contract runs over the three; the file store is also
 * what a second process (the operator's command line) writes, so a store
 * opened on the same file sees what another instance appended.
 */
const NEW_KEY = pub(STRANGER)
const T2 = new Date('2026-07-01T00:00:00.000Z')

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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-registration-'))
  temps.push(dir)
  return dir
}

/** A policy file holding the fixture chain, as PUBLISHER_POLICY_FILE names one. */
function policyFile(chain: PublisherPolicy[] = policyChain()): string {
  const path = join(tempDir(), 'publisher-policy.json')
  writeFileSync(path, JSON.stringify(chain, null, 2) + '\n')
  return path
}

const appended = (chain: PublisherPolicy[]): PublisherPolicy => appendPublisherVersion(chain, OPERATORS, { add: { key: NEW_KEY, role: 'state-publisher' } }, operatorPriv, T2)

const registration = (overrides: Partial<Registration> = {}): Registration => ({
  publisherKey: NEW_KEY,
  label: 'Cell pack demo',
  network: 'test',
  custodyProfile: 'managed-custody@2',
  requestedAt: '2026-07-01T00:00:00Z',
  status: 'registered',
  policyVersion: 3,
  decidedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const stores: Array<[string, () => RegistrationStore]> = [
  ['memory', () => new InMemoryRegistrationStore()],
  ['file', () => new FileRegistrationStore(policyFile())],
  ['mongo', () => new MongoRegistrationStore(client!.db(`registration-${count++}`))],
]

describe.each(stores)('the %s registration store', (name, open) => {
  it('holds the versions it appended, newest last', async () => {
    const store = open()
    const chain = policyChain()
    const version = appended(chain)
    await store.appendVersion(version)
    const held = await store.versions()
    expect(held[held.length - 1]).toEqual(version)
    // The file store's versions are the policy file itself; the others hold only what was appended.
    expect(held.length).toBe(name === 'file' ? 3 : 1)
  })

  it('refuses a second copy of a version number', async () => {
    const store = open()
    const version = appended(policyChain())
    await store.appendVersion(version)
    await expect(store.appendVersion(version)).rejects.toThrow(/version 3/)
  })

  it('saves a registration per publisher key, rewrites it in place and lists oldest request first', async () => {
    const store = open()
    expect(await store.registration(NEW_KEY)).toBeUndefined()
    await store.saveRegistration(registration({ status: 'pending', policyVersion: undefined, decidedAt: undefined }))
    expect(await store.registration(NEW_KEY)).toEqual({ publisherKey: NEW_KEY, label: 'Cell pack demo', network: 'test', custodyProfile: 'managed-custody@2', requestedAt: '2026-07-01T00:00:00Z', status: 'pending' })
    await store.saveRegistration(registration())
    expect((await store.registration(NEW_KEY))?.status).toBe('registered')
    await store.saveRegistration(registration({ publisherKey: pub(operatorPriv), requestedAt: '2026-06-30T00:00:00Z', status: 'refused' }))
    expect((await store.listRegistrations()).map((r) => r.publisherKey)).toEqual([pub(operatorPriv), NEW_KEY])
  })
})

describe('the file registration store', () => {
  it('writes the chain back to the policy file and the registrations beside it, and another instance on the same file sees both', async () => {
    const path = policyFile()
    const store = new FileRegistrationStore(path)
    const version = appended(policyChain())
    await store.appendVersion(version)
    await store.saveRegistration(registration())
    const written = JSON.parse(readFileSync(path, 'utf8')) as PublisherPolicy[]
    expect(written.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect(verifyPolicyChain(written, OPERATORS).ok).toBe(true)
    const sibling = JSON.parse(readFileSync(join(path, '..', 'publisher-policy.registrations.json'), 'utf8'))
    expect(sibling.format).toBe(REGISTRATIONS_FORMAT)
    expect(sibling.registrations).toEqual([registration()])
    const other = new FileRegistrationStore(path)
    expect((await other.versions()).length).toBe(3)
    expect(await other.registration(NEW_KEY)).toEqual(registration())
    // The first instance re-reads what the second wrote.
    await other.saveRegistration(registration({ status: 'revoked' }))
    expect((await store.registration(NEW_KEY))?.status).toBe('revoked')
  })

  it('says when the policy file cannot be written, before anything is appended', async () => {
    const path = policyFile()
    chmodSync(path, 0o444)
    expect(() => new FileRegistrationStore(path).assertWritable()).toThrow(/not writable/)
    chmodSync(path, 0o644)
    expect(() => new FileRegistrationStore(path).assertWritable()).not.toThrow()
  })
})

describe('merging appended versions into the configured chain', () => {
  it('takes the versions the store holds beyond the configured chain, verified as one chain', () => {
    const chain = policyChain()
    const version = appended(chain)
    const merged = mergeAppendedVersions(chain, [...chain, version], OPERATORS)
    expect(merged.chain.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect(merged.versions).toEqual([1, 2, 3])
    expect(mergeAppendedVersions(chain, [version], OPERATORS).chain.length).toBe(3)
    expect(mergeAppendedVersions(chain, [], OPERATORS).chain).toEqual(chain)
  })

  it('stops by name on a stored version that no longer verifies', () => {
    const chain = policyChain()
    const version = appended(chain)
    const tampered = { ...version, publishers: [...version.publishers, { key: pub(operatorPriv), role: 'state-publisher' as const, activeFrom: '2026-07-01T00:00:00.000Z' }] }
    expect(() => mergeAppendedVersions(chain, [tampered], OPERATORS)).toThrow(/appended policy version 3 refused, signature-invalid/)
  })

  it('refreshes a running configuration in place, so the topic managers holding the array see the new version', async () => {
    const chain = policyChain()
    const config: PublisherPolicyConfig = { chain, operators: OPERATORS, versions: [1, 2], source: 'test' }
    const store = new InMemoryRegistrationStore()
    const held = config.chain
    expect(await refreshPolicyChain(config, store)).toEqual([])
    await store.appendVersion(appended(chain))
    expect(await refreshPolicyChain(config, store)).toEqual([3])
    expect(held.length).toBe(3)
    expect(config.versions).toEqual([1, 2, 3])
    expect(await refreshPolicyChain(config, store)).toEqual([])
  })
})

describe('the store the environment selects', () => {
  it('is MongoDB when there is a database, else the policy file, else nothing', () => {
    const db = client!.db(`registration-${count++}`)
    expect(registrationStoreFromEnvironment({ PUBLISHER_POLICY_FILE: policyFile() }, db)).toBeInstanceOf(MongoRegistrationStore)
    expect(registrationStoreFromEnvironment({ PUBLISHER_POLICY_FILE: policyFile() }, undefined)).toBeInstanceOf(FileRegistrationStore)
    expect(registrationStoreFromEnvironment({ PUBLISHER_POLICY_JSON: '[]' }, undefined)).toBeUndefined()
    expect(registrationStoreFromEnvironment({}, undefined)).toBeUndefined()
  })
})

describe('the registration settings the environment names', () => {
  const policy = (): PublisherPolicyConfig => ({ chain: policyChain(), operators: OPERATORS, versions: [1, 2], source: 'test' })
  const store = () => new InMemoryRegistrationStore()
  const env = (overrides: Record<string, string | undefined> = {}) => ({ REGISTRATION: 'open', OPERATOR_SIGNING_KEY: operatorPriv.toHex(), PUBLIC_URL: 'https://index.example', ...overrides })

  it('is nothing when REGISTRATION is unset, whatever else is set', () => {
    expect(registrationSettingsFromEnvironment(env({ REGISTRATION: undefined }), policy(), store(), 'managed-custody@2')).toBeUndefined()
    expect(registrationSettingsFromEnvironment(env({ REGISTRATION: ' ' }), undefined, undefined, 'managed-custody@2')).toBeUndefined()
  })

  it('refuses a mode it does not know', () => {
    expect(() => registrationSettingsFromEnvironment(env({ REGISTRATION: 'yes' }), policy(), store(), 'managed-custody@2')).toThrow(/REGISTRATION must be open or approval/)
  })

  it('needs a publisher policy, a store the chain can grow in, the operator key of the scope, and the public address', () => {
    expect(() => registrationSettingsFromEnvironment(env(), undefined, undefined, 'managed-custody@2')).toThrow(/publisher policy/)
    expect(() => registrationSettingsFromEnvironment(env(), policy(), undefined, 'managed-custody@2')).toThrow(/PUBLISHER_POLICY_JSON/)
    expect(() => registrationSettingsFromEnvironment(env({ OPERATOR_SIGNING_KEY: undefined }), policy(), store(), 'managed-custody@2')).toThrow(/OPERATOR_SIGNING_KEY/)
    expect(() => registrationSettingsFromEnvironment(env({ OPERATOR_SIGNING_KEY: 'zz' }), policy(), store(), 'managed-custody@2')).toThrow(/OPERATOR_SIGNING_KEY is not a private key/)
    expect(() => registrationSettingsFromEnvironment(env({ OPERATOR_SIGNING_KEY: STRANGER.toHex() }), policy(), store(), 'managed-custody@2')).toThrow(/not the identity key of an operator/)
    expect(() => registrationSettingsFromEnvironment(env({ PUBLIC_URL: undefined }), policy(), store(), 'managed-custody@2')).toThrow(/PUBLIC_URL/)
    expect(() => registrationSettingsFromEnvironment(env({ PUBLIC_URL: 'index.example' }), policy(), store(), 'managed-custody@2')).toThrow(/PUBLIC_URL/)
    expect(() => registrationSettingsFromEnvironment(env({ REGISTRATION_RATE_LIMIT: 'many' }), policy(), store(), 'managed-custody@2')).toThrow(/REGISTRATION_RATE_LIMIT/)
  })

  it('refuses a federated scope by name', () => {
    const { genesis, rotation } = federatedChain()
    const federated: PublisherPolicyConfig = { chain: [genesis, rotation], operators: FEDERATION_OPERATORS, versions: [1, 2], source: 'test' }
    expect(() => registrationSettingsFromEnvironment(env(), federated, store(), 'managed-custody@2')).toThrow(/single-operator@1/)
  })

  it('refuses an unwritable policy file before the first registration', () => {
    const path = policyFile()
    chmodSync(path, 0o444)
    try {
      expect(() => registrationSettingsFromEnvironment(env(), policy(), new FileRegistrationStore(path), 'managed-custody@2')).toThrow(/not writable/)
    } finally {
      chmodSync(path, 0o644)
    }
  })

  it('holds the mode, the signing key, the address, the profile and the limits', () => {
    const settings = registrationSettingsFromEnvironment(env({ REGISTRATION: 'approval', REGISTRATION_RATE_LIMIT: '3', TRUST_PROXY: '1' }), policy(), store(), 'record-model-baseline@2')!
    expect(settings.mode).toBe('approval')
    expect(settings.signingKey.toPublicKey().toString()).toBe(pub(operatorPriv))
    expect(settings.indexUrl).toBe('https://index.example')
    expect(settings.custodyProfile).toBe('record-model-baseline@2')
    expect(settings.rateLimitPerHour).toBe(3)
    expect(settings.trustProxy).toBe(true)
    const defaults = registrationSettingsFromEnvironment(env(), policy(), store(), 'managed-custody@2')!
    expect(defaults.mode).toBe('open')
    expect(defaults.rateLimitPerHour).toBe(10)
    expect(defaults.trustProxy).toBe(false)
  })
})

describe('comparing an index address', () => {
  it('ignores one trailing slash and host case, and nothing else', () => {
    expect(sameIndexUrl('https://index.example/', 'https://index.example')).toBe(true)
    expect(sameIndexUrl('https://Index.Example', 'https://index.example/')).toBe(true)
    expect(sameIndexUrl('https://index.example:443/', 'https://index.example')).toBe(true)
    expect(sameIndexUrl('https://index.example/dpp/', 'https://index.example/dpp')).toBe(true)
    expect(sameIndexUrl('https://index.example/dpp', 'https://index.example')).toBe(false)
    expect(sameIndexUrl('http://index.example', 'https://index.example')).toBe(false)
    expect(sameIndexUrl('https://index.example?x=1', 'https://index.example')).toBe(false)
    expect(sameIndexUrl('not a url', 'https://index.example')).toBe(false)
  })
})

describe('the source address a registration counts against', () => {
  it('is the socket peer unless a proxy is trusted, and then the hop the proxy appended last, bounded', () => {
    expect(sourceAddress({ 'x-forwarded-for': 'spoofed, 10.0.0.1' }, '127.0.0.1', false)).toBe('127.0.0.1')
    expect(sourceAddress({ 'x-forwarded-for': 'spoofed, 10.0.0.1' }, '127.0.0.1', true)).toBe('10.0.0.1')
    expect(sourceAddress({ 'x-forwarded-for': '10.0.0.2' }, '127.0.0.1', true)).toBe('10.0.0.2')
    expect(sourceAddress({}, '127.0.0.1', true)).toBe('127.0.0.1')
    expect(sourceAddress({ 'x-forwarded-for': 'x'.repeat(500) }, '127.0.0.1', true).length).toBeLessThanOrEqual(64)
    expect(sourceAddress({}, undefined, false)).toBe('unknown')
  })
})

describe('appending when another process appended first', () => {
  it('rebuilds once on a duplicate version number and returns the next version', async () => {
    const chain = policyChain()
    const config: PublisherPolicyConfig = { chain, operators: OPERATORS, versions: [1, 2], source: 'test' }
    const inner = new InMemoryRegistrationStore()
    let raced = false
    const racing: RegistrationStore = {
      versions: () => inner.versions(),
      registration: (key) => inner.registration(key),
      saveRegistration: (record) => inner.saveRegistration(record),
      listRegistrations: () => inner.listRegistrations(),
      async appendVersion(policy) {
        if (!raced) {
          raced = true
          // The other process appended version 3 between our refresh and our append.
          await inner.appendVersion(appendPublisherVersion(chain, OPERATORS, { add: { key: pub(operatorPriv), role: 'state-publisher' } }, operatorPriv, new Date('2026-07-01T00:00:00.000Z')))
          const duplicate = new Error('E11000 duplicate key error collection: x index: policyVersion_1') as Error & { code: number }
          duplicate.code = 11000
          throw duplicate
        }
        await inner.appendVersion(policy)
      },
    }
    const version = await appendRegistrationVersion(config, racing, operatorPriv, { add: { key: NEW_KEY, role: 'state-publisher' } }, new Date('2026-07-01T00:00:01.000Z'))
    expect(version.policyVersion).toBe(4)
    expect(config.chain.map((p) => p.policyVersion)).toEqual([1, 2, 3, 4])
    expect(verifyPolicyChain(config.chain, OPERATORS).ok).toBe(true)
  })
})
