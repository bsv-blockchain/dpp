import { afterEach, afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { INDEX_REGISTRATION_FORMAT, appendPublisherVersion, signRegistration, type PublisherPolicy, type RegistrationClaim } from '@bsv/dpp-protocol'
import { startOverlayService, type RunningService } from '../src/index.js'
import { InMemoryPublisherTokenStore, issueToken } from '../src/publisherTokens.js'
import { FileRegistrationStore, InMemoryRegistrationStore, type RegistrationSettings, type RegistrationStore } from '../src/registration.js'
import { runRegistrationsCommand } from '../src/registrationsCommand.js'
import type { PublisherPolicyConfig } from '../src/policyConfig.js'
import { bodyOf, genesisTx, JSON_BODY, newNode, submitBeef, type TestNode } from './helpers.js'
import { K2, OPERATOR, OPERATORS, operatorPriv, policyChain, pub, signPolicy, T0 } from './policy-fixture.js'

/**
 * POST /register over HTTP (`spec/services.md` section 2): an application's
 * wallet-signed request appends a policy version the running index serves
 * and admits under at once, and returns the application's two write tokens;
 * in approval mode the request waits for the operator. Every refusal is
 * named, nothing in any answer is the operator's key, and a key registers
 * once.
 */
const HOST = '127.0.0.1'
const INDEX_URL = 'https://index.example'
const NOW = new Date('2026-07-26T08:00:00Z')
const APP = PrivateKey.fromHex('67'.repeat(32))
const APP_2 = PrivateKey.fromHex('68'.repeat(32))
const appWallet = new ProtoWallet(APP)

let running: RunningService | undefined
const temps: string[] = []
afterEach(async () => {
  await running?.close()
  running = undefined
})
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function node(chain: PublisherPolicy[] = policyChain()): { node: TestNode; policy: PublisherPolicyConfig } {
  const policy: PublisherPolicyConfig = { chain, operators: OPERATORS, versions: chain.map((p) => p.policyVersion), source: 'test' }
  return { node: newNode('', {}, { publisherPolicy: policy, quiet: true, now: () => NOW }), policy }
}

interface Served { base: string; tokens: InMemoryPublisherTokenStore; store: RegistrationStore; policy: PublisherPolicyConfig; settings: RegistrationSettings }

async function serve(mode: 'open' | 'approval' | 'off', options: { chain?: PublisherPolicy[]; rateLimitPerHour?: number; custodyProfile?: string; store?: RegistrationStore } = {}): Promise<Served> {
  const { node: n, policy } = node(options.chain)
  const tokens = new InMemoryPublisherTokenStore()
  const store = options.store ?? new InMemoryRegistrationStore()
  const settings: RegistrationSettings = { mode: mode === 'off' ? 'open' : mode, signingKey: operatorPriv, indexUrl: INDEX_URL, custodyProfile: options.custodyProfile ?? 'record-model-baseline@2', store, rateLimitPerHour: options.rateLimitPerHour ?? 10, trustProxy: false }
  running = await startOverlayService(n.engine, {
    port: 0,
    host: HOST,
    network: 'test',
    now: () => NOW,
    components: { ...n.components, publisherTokens: tokens, ...(mode === 'off' ? {} : { registration: settings }) },
    knownOnChain: async () => false,
  })
  return { base: `http://${HOST}:${running.port}`, tokens, store, policy, settings }
}

const claim = (overrides: Partial<RegistrationClaim> = {}, key: PrivateKey = APP): RegistrationClaim => ({
  registrationFormat: INDEX_REGISTRATION_FORMAT,
  indexUrl: `${INDEX_URL}/`,
  publisherKey: pub(key),
  network: 'test',
  custodyProfile: 'record-model-baseline@2',
  label: 'Cell pack demo',
  requestedAt: NOW.toISOString(),
  ...overrides,
})

async function register(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await fetch(`${base}/register`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const signed = async (overrides: Partial<RegistrationClaim> = {}, key: PrivateKey = APP) => await signRegistration(claim(overrides, key), new ProtoWallet(key))
const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })

describe('open registration', () => {
  it('appends a version the index serves at once, admits the key\'s state under the returned token, and never answers with the operator key', async () => {
    const { base, tokens, policy } = await serve('open')
    const response = await register(base, await signed())
    expect(response.status).toBe(201)
    const body = await bodyOf(response)
    expect(body).toMatchObject({ status: 'registered', policyVersion: 3 })
    expect(body.tokens.submit).toMatch(/^[0-9a-f]{64}$/)
    expect(body.tokens.callback).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(body)).not.toContain(operatorPriv.toHex())

    const served = (await bodyOf(await fetch(`${base}/publisher-policy`))) as PublisherPolicy[]
    expect(served.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect(served[2].publishers.find((p) => p.key === pub(APP))).toMatchObject({ role: 'state-publisher', activeFrom: NOW.toISOString() })
    expect(served[2].authorisation).toMatchObject({ kind: 'rotation', signer: pub(operatorPriv) })
    expect(policy.versions).toEqual([1, 2, 3])
    expect((await tokens.list()).map((t) => [t.publisherKey, t.use, t.label])).toEqual([[pub(APP), 'submit', 'Cell pack demo'], [pub(APP), 'callback', 'Cell pack demo']])

    const { tx } = await genesisTx({}, appWallet)
    const admitted = await submitBeef(base, tx.toBEEF(), bearer(body.tokens.submit))
    expect(admitted.status).toBe(200)
    expect(admitted.headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect((await submitBeef(base, tx.toBEEF())).status).toBe(401)
  })

  it('registers a key once: a second request is 409 with no further version or tokens', async () => {
    const { base, tokens, policy } = await serve('open')
    expect((await register(base, await signed())).status).toBe(201)
    const again = await register(base, await signed({ label: 'Renamed' }))
    expect(again.status).toBe(409)
    expect(await bodyOf(again)).toMatchObject({ status: 'error', error: 'already-registered' })
    expect(policy.chain.length).toBe(3)
    expect((await tokens.list()).length).toBe(2)
  })

  it('refuses the request\'s own failures by name: signature, address, network, custody profile, clock and shape', async () => {
    const { base, policy } = await serve('open')
    const good = await signed()
    const expectRefusal = async (body: unknown, status: number, error: string) => {
      const response = await register(base, body)
      expect([response.status, (await bodyOf(response)).error]).toEqual([status, error])
    }
    await expectRefusal({ ...good, label: 'Tampered' }, 401, 'registration-signature-invalid')
    await expectRefusal(await signed({ indexUrl: 'https://other.example/' }), 400, 'index-url-mismatch')
    await expectRefusal(await signed({ network: 'main' }), 409, 'network-mismatch')
    await expectRefusal(await signed({ custodyProfile: 'managed-custody@2' }), 409, 'custody-profile-mismatch')
    await expectRefusal(await signed({ requestedAt: '2026-07-26T07:00:00Z' }), 400, 'request-stale')
    await expectRefusal({ ...good, extra: true }, 400, 'registration-malformed')
    await expectRefusal('not json', 400, 'registration-malformed')
    expect(policy.chain.length).toBe(2)
  })

  it('answers 409 for a key the policy already names, with nothing appended, and settles two requests in flight as one registration', async () => {
    const { base, tokens, policy } = await serve('open')
    const named = await register(base, await signed({}, K2))
    expect([named.status, (await bodyOf(named)).error]).toEqual([409, 'already-registered'])
    expect(policy.chain.length).toBe(2)
    expect((await tokens.list()).length).toBe(0)
    const [first, second] = await Promise.all([register(base, await signed()), register(base, await signed({ label: 'Twin' }))])
    expect([first.status, second.status].sort()).toEqual([201, 409])
    expect(policy.chain.length).toBe(3)
    expect((await tokens.list()).length).toBe(2)
  })

  it('serves a version another process appended on GET /publisher-policy without waiting for a registration', async () => {
    const { base, store, policy } = await serve('open')
    await store.appendVersion(appendPublisherVersion(policy.chain, OPERATORS, { add: { key: pub(APP_2), role: 'state-publisher' } }, operatorPriv, new Date('2026-07-26T08:01:00Z')))
    const served = (await bodyOf(await fetch(`${base}/publisher-policy`))) as PublisherPolicy[]
    expect(served.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect(policy.versions).toEqual([1, 2, 3])
  })

  it('answers 503 when the version would hold more publishers than a policy may', async () => {
    const full = signPolicy(
      {
        policyFormat: 'dpp-publisher-policy@1',
        policyVersion: 1,
        scope: { operatorProfile: 'single-operator@1', operators: [OPERATOR] },
        issuedAt: T0,
        publishers: Array.from({ length: 256 }, (_, i) => ({ key: pub(PrivateKey.fromHex((i + 1000).toString(16).padStart(64, '0'))), role: 'state-publisher' as const, activeFrom: T0 })),
        authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
      },
      operatorPriv
    )
    const { base } = await serve('open', { chain: [full] })
    const response = await register(base, await signed())
    expect(response.status).toBe(503)
    expect(await bodyOf(response)).toMatchObject({ error: 'registration-unavailable' })
  })

  it('limits requests per source address', async () => {
    const { base } = await serve('open', { rateLimitPerHour: 2 })
    expect((await register(base, await signed({}, APP))).status).toBe(201)
    expect((await register(base, await signed({}, APP_2))).status).toBe(201)
    const third = await register(base, await signed({}, PrivateKey.fromHex('69'.repeat(32))))
    expect(third.status).toBe(429)
    expect(await bodyOf(third)).toMatchObject({ error: 'registration-rate-limited' })
  })
})

describe('registration under approval', () => {
  it('holds the request as pending until the operator decides, then hands the tokens over once', async () => {
    const { base, store, policy, tokens } = await serve('approval')
    const first = await register(base, await signed())
    expect(first.status).toBe(202)
    expect(await bodyOf(first)).toEqual({ status: 'pending' })
    expect(await store.registration(pub(APP))).toMatchObject({ status: 'pending', label: 'Cell pack demo', requestedAt: NOW.toISOString() })
    expect(policy.chain.length).toBe(2)
    expect((await register(base, await signed({ label: 'Second try' }))).status).toBe(202)
    expect((await store.registration(pub(APP)))?.label).toBe('Cell pack demo')

    // The operator approves out of process: the version lands in the store and the record says approved.
    const version = appendPublisherVersion(policy.chain, OPERATORS, { add: { key: pub(APP), role: 'state-publisher' } }, operatorPriv, new Date('2026-07-26T08:05:00Z'))
    await store.appendVersion(version)
    await store.saveRegistration({ ...(await store.registration(pub(APP)))!, status: 'approved', policyVersion: 3, decidedAt: '2026-07-26T08:05:00Z' })

    const collected = await register(base, await signed())
    expect(collected.status).toBe(201)
    const body = await bodyOf(collected)
    expect(body).toMatchObject({ status: 'registered', policyVersion: 3 })
    expect(body.tokens.submit).toMatch(/^[0-9a-f]{64}$/)
    expect((await store.registration(pub(APP)))).toMatchObject({ status: 'collected', collectedAt: NOW.toISOString() })
    expect(policy.chain.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect((await bodyOf(await fetch(`${base}/publisher-policy`))).length).toBe(3)
    expect((await tokens.list()).length).toBe(2)

    const again = await register(base, await signed())
    expect(again.status).toBe(409)
    expect(await bodyOf(again)).toMatchObject({ error: 'already-registered' })
  })

  it('takes the operator\'s approval from the command line, through the policy file both share', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-registration-http-'))
    temps.push(dir)
    const policyFile = join(dir, 'publisher-policy.json')
    writeFileSync(policyFile, JSON.stringify(policyChain(), null, 2) + '\n')
    const { base, policy } = await serve('approval', { store: new FileRegistrationStore(policyFile) })
    expect((await register(base, await signed())).status).toBe(202)
    const lines: string[] = []
    await runRegistrationsCommand(['approve'], { publisher: pub(APP) }, { PUBLISHER_POLICY_FILE: policyFile, OPERATOR_IDENTITY_KEYS: `${OPERATOR}=${pub(operatorPriv)}`, OPERATOR_SIGNING_KEY: operatorPriv.toHex() }, (line) => lines.push(line))
    expect(lines[0]).toContain('approved')
    expect(policy.chain.length).toBe(2)
    const collected = await register(base, await signed())
    expect(collected.status).toBe(201)
    expect(await bodyOf(collected)).toMatchObject({ status: 'registered', policyVersion: 3 })
    expect(policy.chain.length).toBe(3)
    expect((await bodyOf(await fetch(`${base}/publisher-policy`))).length).toBe(3)
  })

  it('answers a refused and a revoked key with 403 by name', async () => {
    const { base, store } = await serve('approval')
    await store.saveRegistration({ publisherKey: pub(APP), label: 'x', network: 'test', custodyProfile: 'record-model-baseline@2', requestedAt: NOW.toISOString(), status: 'refused', decidedAt: NOW.toISOString() })
    await store.saveRegistration({ publisherKey: pub(APP_2), label: 'y', network: 'test', custodyProfile: 'record-model-baseline@2', requestedAt: NOW.toISOString(), status: 'revoked', decidedAt: NOW.toISOString() })
    const refused = await register(base, await signed())
    expect([refused.status, (await bodyOf(refused)).error]).toEqual([403, 'registration-refused'])
    const revoked = await register(base, await signed({}, APP_2))
    expect([revoked.status, (await bodyOf(revoked)).error]).toEqual([403, 'registration-revoked'])
  })
})

describe('registration off', () => {
  it('answers 404 by name and the capability document says so', async () => {
    const { base } = await serve('off')
    const response = await register(base, await signed())
    expect([response.status, (await bodyOf(response)).error]).toEqual([404, 'registration-unavailable'])
    const capabilities = await bodyOf(await fetch(`${base}/capabilities`))
    expect(capabilities.profiles.find((p: { kind: string }) => p.kind === 'operator').options.registration).toBe('off')
    expect(capabilities.unsupported.map((u: { id: string }) => u.id)).toContain('self-service-registration')
  })

  it('is named in the capability document when on', async () => {
    const { base } = await serve('approval')
    const capabilities = await bodyOf(await fetch(`${base}/capabilities`))
    expect(capabilities.profiles.find((p: { kind: string }) => p.kind === 'operator').options.registration).toBe('approval')
    expect(capabilities.unsupported.map((u: { id: string }) => u.id)).not.toContain('self-service-registration')
  })
})

describe('a registered publisher writes', () => {
  it('under its own tokens only: another publisher\'s token is refused for its state', async () => {
    const { base, tokens } = await serve('open')
    const body = await bodyOf(await register(base, await signed()))
    const other = (await issueToken(tokens, pub(K2), 'submit', 'other')).token
    const { tx } = await genesisTx({}, appWallet)
    const crossed = await submitBeef(base, tx.toBEEF(), bearer(other))
    expect(crossed.status).toBe(403)
    expect((await submitBeef(base, tx.toBEEF(), bearer(body.tokens.submit))).status).toBe(200)
  })
})
