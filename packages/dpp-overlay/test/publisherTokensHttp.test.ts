import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { startOverlayService, type RunningService } from '../src/index.js'
import { InMemoryPublisherTokenStore, issueToken, tokenDigest } from '../src/publisherTokens.js'
import { bodyOf, eventTx, genesisTx, JSON_BODY, newNode, OCTET, PASSPORT_ID, submitBeef, type TestNode } from './helpers.js'
import { K1, K2, OPERATORS, operatorPriv, pub, signPolicy, T0 } from './policy-fixture.js'

/**
 * Per-publisher write tokens over HTTP (`publisherTokens.ts`): a bearer that
 * belongs to one key and one use writes only what that key signed. Two
 * publishers under one policy each hold their own tokens; the legacy
 * operator-wide tokens keep working beside them.
 */
const HOST = '127.0.0.1'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
  vi.restoreAllMocks()
})

const walletA = new ProtoWallet(K1)
const walletB = new ProtoWallet(K2)
const PASSPORT_B = 'https://id.gs1.org/01/09506000134352/21/TOKENS-B'

/** One policy naming both publishers from the start, so both write to one index. */
function twoPublishers(): TestNode {
  const genesis = signPolicy(
    {
      policyFormat: 'dpp-publisher-policy@1',
      policyVersion: 1,
      scope: { operatorProfile: 'single-operator@1', operators: Object.keys(OPERATORS) },
      issuedAt: T0,
      publishers: [
        { key: pub(K1), role: 'state-publisher', activeFrom: T0 },
        { key: pub(K2), role: 'state-publisher', activeFrom: T0 },
      ],
      authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    },
    operatorPriv
  )
  return newNode('', {}, { publisherPolicy: { chain: [genesis], operators: OPERATORS, versions: [1], source: 'test' }, quiet: true })
}

async function serve(node: TestNode, store: InMemoryPublisherTokenStore | undefined, extra: Record<string, unknown> = {}): Promise<string> {
  running = await startOverlayService(node.engine, {
    port: 0,
    host: HOST,
    components: { ...node.components, ...(store == null ? {} : { publisherTokens: store }) },
    knownOnChain: async () => false,
    ...extra,
  })
  return `http://${HOST}:${running.port}`
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })

async function tokensFor(store: InMemoryPublisherTokenStore, key: PrivateKey): Promise<{ submit: string; callback: string }> {
  const submit = (await issueToken(store, pub(key), 'submit', 'app')).token
  const callback = (await issueToken(store, pub(key), 'callback', 'app')).token
  return { submit, callback }
}

async function retract(base: string, txid: string, headers: Record<string, string>): Promise<Response> {
  return await fetch(`${base}/retract`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: JSON.stringify({ txid, outputIndex: 0, reason: 'network refused' }) })
}

async function pushProof(base: string, txid: string, headers: Record<string, string>): Promise<Response> {
  const merklePath = MerklePath.fromCoinbaseTxidAndHeight(txid, 800_001).toHex()
  return await fetch(`${base}/arc-ingest`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: JSON.stringify({ txid, merklePath }) })
}

describe('per-publisher tokens on POST /submit', () => {
  it('admits each publisher\'s own state under its own token, and refuses a state the token\'s key did not sign with a named 403', async () => {
    const store = new InMemoryPublisherTokenStore()
    const a = await tokensFor(store, K1)
    const b = await tokensFor(store, K2)
    const base = await serve(twoPublishers(), store)
    const { tx: genesisA } = await genesisTx({}, walletA)
    const { tx: genesisB } = await genesisTx({ passportId: PASSPORT_B, payloadPublic: JSON.stringify({ name: 'B', dataCarrier: 'B-UID' }) }, walletB)

    const own = await submitBeef(base, genesisA.toBEEF(), bearer(a.submit))
    expect(own.status).toBe(200)
    expect(own.headers.get('x-admission')).toBe('tm_dpp=admitted')

    const crossed = await submitBeef(base, genesisB.toBEEF(), bearer(a.submit))
    expect(crossed.status).toBe(403)
    expect(await bodyOf(crossed)).toMatchObject({ status: 'error', error: 'token-publisher-mismatch' })
    expect((await bodyOf(await submitBeef(base, genesisB.toBEEF(), bearer(b.submit)))).tm_dpp.outputsToAdmit).toEqual([0])
  })

  it('refuses an unknown, a revoked and a wrong-use token with 401, and the other publisher keeps writing', async () => {
    const store = new InMemoryPublisherTokenStore()
    const a = await tokensFor(store, K1)
    const b = await tokensFor(store, K2)
    const base = await serve(twoPublishers(), store)
    const { tx: genesisA } = await genesisTx({}, walletA)
    const { tx: genesisB } = await genesisTx({ passportId: PASSPORT_B }, walletB)

    const unknown = await submitBeef(base, genesisA.toBEEF(), bearer('f'.repeat(64)))
    expect(unknown.status).toBe(401)
    expect((await bodyOf(unknown)).description).toBe('POST /submit requires a submit token')
    const none = await submitBeef(base, genesisA.toBEEF())
    expect(none.status).toBe(401)

    const wrongUse = await submitBeef(base, genesisA.toBEEF(), bearer(a.callback))
    expect(wrongUse.status).toBe(401)
    expect((await bodyOf(wrongUse)).description).toContain('submit token')

    expect(await store.revoke(tokenDigest(a.submit), '2026-11-02T12:00:00Z')).toBe(true)
    const revoked = await submitBeef(base, genesisA.toBEEF(), bearer(a.submit))
    expect(revoked.status).toBe(401)
    expect((await bodyOf(revoked)).description).toContain('revoked')
    expect((await submitBeef(base, genesisB.toBEEF(), bearer(b.submit))).status).toBe(200)
  })

  it('keeps the legacy operator-wide token working beside the store, for any publisher', async () => {
    const store = new InMemoryPublisherTokenStore()
    await tokensFor(store, K1)
    const base = await serve(twoPublishers(), store, { submitToken: 'legacy-secret' })
    const { tx: genesisB } = await genesisTx({ passportId: PASSPORT_B }, walletB)
    expect((await submitBeef(base, genesisB.toBEEF(), bearer('legacy-secret'))).status).toBe(200)
    expect((await submitBeef(base, genesisB.toBEEF(), bearer('legacy-wrong'))).status).toBe(401)
  })

  it('leaves the route open on a node with neither a store nor a legacy token, as before', async () => {
    const base = await serve(twoPublishers(), undefined)
    const { tx: genesisA } = await genesisTx({}, walletA)
    expect((await submitBeef(base, genesisA.toBEEF())).status).toBe(200)
  })

  it('checks an anchor against the anchoring service key it names', async () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
    const anchoredBy: string = fixture.anchor.anchoredBy
    const store = new InMemoryPublisherTokenStore()
    const a = await tokensFor(store, K1)
    const service = (await issueToken(store, anchoredBy, 'submit', 'anchoring service')).token
    const base = await serve(newNode('', {}, { anchorServices: [anchoredBy], quiet: true }), store)
    const funding = new Transaction()
    funding.addOutput({ satoshis: 10_000, lockingScript: LockingScript.fromHex('51') })
    funding.merklePath = MerklePath.fromCoinbaseTxidAndHeight(funding.id('hex'), 800_000)
    const tx = new Transaction()
    tx.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    tx.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(fixture.lockingScript) })
    tx.addOutput({ satoshis: 9_000, lockingScript: LockingScript.fromHex('51') })
    const headers = { ...OCTET, 'X-Topics': '["tm_attestation"]' }
    const wrong = await fetch(`${base}/submit`, { method: 'POST', headers: { ...headers, ...bearer(a.submit) }, body: new Uint8Array(tx.toBEEF()) })
    expect(wrong.status).toBe(403)
    expect((await bodyOf(wrong)).error).toBe('token-publisher-mismatch')
    const right = await fetch(`${base}/submit`, { method: 'POST', headers: { ...headers, ...bearer(service) }, body: new Uint8Array(tx.toBEEF()) })
    expect(right.status).toBe(200)
    expect((await bodyOf(right)).tm_attestation.outputsToAdmit).toEqual([0])
  })
})

describe('a token store that cannot answer', () => {
  it('answers 503 with a fixed description and no server detail, on every write route', async () => {
    const store = new InMemoryPublisherTokenStore()
    store.find = async () => { throw new Error('/srv/secret/path/tokens.json is not a JSON token file') }
    const base = await serve(twoPublishers(), store)
    const { tx: genesisA } = await genesisTx({}, walletA)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const submitted = await submitBeef(base, genesisA.toBEEF(), bearer('f'.repeat(64)))
    expect(submitted.status).toBe(503)
    expect(await bodyOf(submitted)).toEqual({ status: 'error', description: 'token store unavailable; try again' })
    expect((await retract(base, genesisA.id('hex'), bearer('f'.repeat(64)))).status).toBe(503)
    expect((await pushProof(base, genesisA.id('hex'), bearer('f'.repeat(64)))).status).toBe(503)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('token store'))).toBe(true)
  })
})

describe('per-publisher tokens on POST /retract and POST /arc-ingest', () => {
  it('retracts only with a submit token of the publisher that signed the held state', async () => {
    const store = new InMemoryPublisherTokenStore()
    const a = await tokensFor(store, K1)
    const b = await tokensFor(store, K2)
    const base = await serve(twoPublishers(), store)
    const { tx: genesisA } = await genesisTx({}, walletA)
    const { tx: eventA } = await eventTx(genesisA, {}, walletA)
    for (const tx of [genesisA, eventA]) expect((await submitBeef(base, tx.toBEEF(), bearer(a.submit))).status).toBe(200)
    const crossed = await retract(base, eventA.id('hex'), bearer(b.submit))
    expect(crossed.status).toBe(403)
    expect((await bodyOf(crossed)).error).toBe('token-publisher-mismatch')
    expect((await retract(base, eventA.id('hex'), bearer(a.callback))).status).toBe(401)
    expect((await retract(base, eventA.id('hex'), bearer(a.submit))).status).toBe(200)
    expect((await retract(base, 'ab'.repeat(32), bearer(a.submit))).status).toBe(404)
  })

  it('applies a proof only with a callback token of the publisher that signed the held state', async () => {
    const store = new InMemoryPublisherTokenStore()
    const a = await tokensFor(store, K1)
    const b = await tokensFor(store, K2)
    const base = await serve(twoPublishers(), store)
    const { tx: genesisA } = await genesisTx({}, walletA)
    expect((await submitBeef(base, genesisA.toBEEF(), bearer(a.submit))).status).toBe(200)
    const txid = genesisA.id('hex')
    const crossed = await pushProof(base, txid, bearer(b.callback))
    expect(crossed.status).toBe(403)
    expect((await bodyOf(crossed)).error).toBe('token-publisher-mismatch')
    expect((await pushProof(base, txid, bearer(a.submit))).status).toBe(401)
    expect((await pushProof(base, txid, { 'X-Callback-Token': a.callback })).status).toBe(200)
    expect((await pushProof(base, 'ab'.repeat(32), bearer(a.callback))).status).toBe(404)
  })
})
