import { afterEach, describe, expect, it, vi } from 'vitest'
import { MerklePath, Transaction } from '@bsv/sdk'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, eventTx, genesisTx, JSON_BODY, lookupPassport, newNode, PASSPORT_ID, submitBeef, type TestNode } from './helpers.js'

/**
 * POST /retract: a writer announced a state before sending it, as the writing
 * rules allow, and the network refused the transaction. The index holds a
 * phantom tip until the writer withdraws it; a proven state, a spent state and
 * a state the network knows are never withdrawn.
 */

const HOST = '127.0.0.1'
const TOKEN = 'sekret'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
  vi.restoreAllMocks()
})

async function serve(node: TestNode, extra: Record<string, unknown> = {}): Promise<string> {
  running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components, submitToken: TOKEN, ...extra })
  return `http://${HOST}:${running.port}`
}

const AUTH = { Authorization: `Bearer ${TOKEN}` }

async function retract(base: string, body: unknown, headers: Record<string, string> = AUTH): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${base}/retract`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: JSON.stringify(body) })
  return { status: response.status, body: await bodyOf(response) }
}

/** A genesis and one event on top of it, both announced and admitted; the event is the candidate phantom. */
async function genesisAndEvent(base: string): Promise<{ genesis: Transaction; event: Transaction }> {
  const { tx: genesis } = await genesisTx()
  const { tx: event } = await eventTx(genesis)
  for (const tx of [genesis, event]) {
    const response = await submitBeef(base, tx.toBEEF(), AUTH)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-admission')).toBe('tm_dpp=admitted')
  }
  return { genesis, event }
}

const txids = (outputs: Array<{ beef: number[] }>): string[] => outputs.map((o) => Transaction.fromBEEF(o.beef).id('hex')).sort()

describe('POST /retract', () => {
  it('retracts an unproven state, makes the predecessor the tip again and admits later states', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = newNode()
    const asked: string[] = []
    const base = await serve(node, { knownOnChain: async (txid: string) => { asked.push(txid); return false } })
    const { genesis, event } = await genesisAndEvent(base)
    const phantom = event.id('hex')
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toEqual([genesis.id('hex'), phantom].sort())

    const { status, body } = await retract(base, { txid: phantom, outputIndex: 0, reason: 'network refused: fee too low' })
    expect(status).toBe(200)
    expect(body).toEqual({
      status: 'retracted',
      txid: phantom,
      outputIndex: 0,
      reason: 'network refused: fee too low',
      networkChecked: true,
      restoredTip: { txid: genesis.id('hex'), outputIndex: 0 },
      unrepaired: [],
    })
    expect(asked).toEqual([phantom])
    expect(warn.mock.calls.some((call) => String(call[0]).includes(`removed tm_dpp output ${phantom}:0`))).toBe(true)

    // The index holds the genesis alone, unspent again, in both stores.
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toEqual([genesis.id('hex')])
    const history = await bodyOf(await fetch(`${base}/history?passportId=${encodeURIComponent(PASSPORT_ID)}`))
    expect(history.items).toEqual([expect.objectContaining({ txid: genesis.id('hex'), spent: false, spendingTxid: '' })])
    const held = await node.storage.findOutput(genesis.id('hex'), 0, 'tm_dpp')
    expect(held).toMatchObject({ spent: false, consumedBy: [] })
    expect(await node.storage.findOutput(phantom, 0, 'tm_dpp')).toBeNull()
    expect(await node.storage.doesAppliedTransactionExist({ txid: phantom, topic: 'tm_dpp' })).toBe(false)

    // Should the network take the same transaction after all, it is admitted again, not skipped as a duplicate.
    const reannounced = await submitBeef(base, event.toBEEF(), AUTH)
    expect(reannounced.headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect((await retract(base, { txid: phantom, outputIndex: 0, reason: 'refused again' })).status).toBe(200)

    // And a different later state spending the restored tip is admitted.
    const { tx: replacement } = await eventTx(genesis, { timestamp: '2026-07-26T11:00:00Z', eventData: '{"channel":"web"}' })
    const admitted = await submitBeef(base, replacement.toBEEF(), AUTH)
    expect(admitted.headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect(await bodyOf(admitted)).toEqual({ tm_dpp: { outputsToAdmit: [0], coinsToRetain: [0], coinsRemoved: [] } })
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toEqual([genesis.id('hex'), replacement.id('hex')].sort())
    const after = await bodyOf(await fetch(`${base}/history?passportId=${encodeURIComponent(PASSPORT_ID)}`))
    expect(after.items.map((i: { txid: string; spent: boolean; spendingTxid: string }) => [i.txid, i.spent, i.spendingTxid])).toEqual([
      [genesis.id('hex'), true, replacement.id('hex')],
      [replacement.id('hex'), false, ''],
    ])
  })

  it('refuses a proven state, a spent state and an unknown outpoint', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = await serve(newNode())
    const { genesis, event } = await genesisAndEvent(base)

    const spent = await retract(base, { txid: genesis.id('hex'), outputIndex: 0, reason: 'trying the middle' })
    expect(spent.status).toBe(409)
    expect(spent.body).toMatchObject({ status: 'error', error: 'retraction-refused', description: expect.stringContaining('spent') })

    const unknown = await retract(base, { txid: 'ab'.repeat(32), outputIndex: 0, reason: 'never here' })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toBe('output-unknown')

    const proof = MerklePath.fromCoinbaseTxidAndHeight(event.id('hex'), 800_001)
    const pushed = await fetch(`${base}/arc-ingest`, { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ txid: event.id('hex'), merklePath: proof.toHex() }) })
    expect(pushed.status).toBe(200)
    const proven = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'too late' })
    expect(proven.status).toBe(409)
    expect(proven.body).toMatchObject({ error: 'retraction-refused', description: expect.stringContaining('merkle path') })
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toHaveLength(2)
  })

  it('refuses when the chain tracker knows the transaction, and defers when it cannot answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let answer: () => Promise<boolean> = async () => true
    const base = await serve(newNode(), { knownOnChain: async () => await answer() })
    const { event } = await genesisAndEvent(base)
    const known = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'writer thinks it failed' })
    expect(known.status).toBe(409)
    expect(known.body).toMatchObject({ error: 'retraction-refused', description: expect.stringContaining('chain tracker knows') })

    answer = async () => { throw new Error('connection refused') }
    const deferred = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'writer thinks it failed' })
    expect(deferred.status).toBe(503)
    expect(deferred.body).toMatchObject({ error: 'chain-tracker-unavailable', description: expect.stringContaining('try again') })
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toHaveLength(2)
  })

  it('refuses when the output changes between the checks and the delete, and removes nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = newNode()
    // While the network is being asked, a writer's successor lands: the
    // re-read before the delete sees the output spent and stops.
    let successor: Transaction | undefined
    const base = await serve(node, {
      knownOnChain: async () => {
        if (successor != null) await node.engine.submit({ beef: successor.toBEEF(), topics: ['tm_dpp'] })
        return false
      },
    })
    const { event } = await genesisAndEvent(base)
    successor = (await eventTx(event, { timestamp: '2026-07-26T12:00:00Z', op: 'REPAIRED' })).tx
    const { status, body } = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'racing the writer' })
    expect(status).toBe(409)
    expect(body).toMatchObject({ error: 'retraction-refused', description: expect.stringContaining('changed while the retraction was being checked') })
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toHaveLength(3)
    expect(await node.storage.findOutput(event.id('hex'), 0, 'tm_dpp')).toMatchObject({ spent: true })
  })

  it('requires the /submit bearer token', async () => {
    const base = await serve(newNode())
    const { event } = await genesisAndEvent(base)
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: 'Basic sekret' }]) {
      const { status, body } = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'x' }, headers)
      expect(status).toBe(401)
      expect(body.description).toContain('bearer token')
    }
    expect(txids(await lookupPassport(base, { passportId: PASSPORT_ID }))).toHaveLength(2)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'x' })).status).toBe(200)
  })

  it('says so when no header source can be asked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = await serve(newNode())
    const { event } = await genesisAndEvent(base)
    const { status, body } = await retract(base, { txid: event.id('hex'), outputIndex: 0, reason: 'refused' })
    expect(status).toBe(200)
    expect(body.networkChecked).toBe(false)
    expect(body.note).toContain('scripts-only')
  })

  it('validates the body and is 503 on a node without its stores', async () => {
    const base = await serve(newNode())
    for (const [body, description] of [
      [{ txid: 'nope', outputIndex: 0, reason: 'x' }, 'txid must be 64 lower-case hex characters'],
      [{ txid: 'ab'.repeat(32), outputIndex: -1, reason: 'x' }, 'outputIndex must be a non-negative integer'],
      [{ txid: 'ab'.repeat(32), outputIndex: 0, reason: '   ' }, 'reason must be a non-empty string of at most 1000 characters'],
      [[1], 'body must be a JSON object with txid, outputIndex and reason'],
    ] as Array<[unknown, string]>) {
      const { status, body: answer } = await retract(base, body)
      expect(status).toBe(400)
      expect(answer.description).toBe(description)
    }
    const bare = await startOverlayService(newNode().engine, { port: 0, host: HOST })
    try {
      const response = await fetch(`http://${HOST}:${bare.port}/retract`, { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ txid: 'ab'.repeat(32), outputIndex: 0, reason: 'x' }) })
      expect(response.status).toBe(503)
      expect((await bodyOf(response)).error).toBe('retraction-unavailable')
    } finally {
      await bare.close()
    }
  })
})
