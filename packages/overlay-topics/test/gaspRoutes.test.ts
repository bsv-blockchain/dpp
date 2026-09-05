import { afterEach, describe, expect, it } from 'vitest'
import { Transaction, type LookupAnswer, type STEAK, type TaggedBEEF } from '@bsv/sdk'
import { startOverlayService, type OverlayEngine, type RunningService } from '../src/index.js'
import { bodyOf, genesisTx, JSON_BODY, newNode, submitBeef } from './helpers.js'

/**
 * The two GASP routes a peer synchronises from, as the upstream overlay
 * protocol defines them: POST /requestSyncResponse with the topic in
 * X-BSV-Topic, POST /requestForeignGASPNode with graphID, txid and
 * outputIndex. The first half drives a stand-in engine so the wire is what is
 * asserted; the second asks a real engine for a state it holds.
 */

const HOST = '127.0.0.1'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

interface Seen {
  sync: Array<[unknown, string]>
  nodes: Array<[string, string, number]>
}

function stubEngine(): { engine: OverlayEngine; seen: Seen } {
  const seen: Seen = { sync: [], nodes: [] }
  const engine = {
    submit: async (_: TaggedBEEF): Promise<STEAK> => ({}),
    lookup: async (): Promise<LookupAnswer> => ({ type: 'output-list', outputs: [] }),
    listTopicManagers: async () => ({ tm_dpp: { name: 'tm_dpp', shortDescription: 'DPP' } }),
    listLookupServiceProviders: async () => ({}),
    getDocumentationForTopicManager: async () => '',
    getDocumentationForLookupServiceProvider: async () => '',
    handleNewMerkleProof: async () => {},
    provideForeignSyncResponse: async (request: unknown, topic: string) => {
      seen.sync.push([request, topic])
      return { UTXOList: [{ txid: 'ab'.repeat(32), outputIndex: 1, score: 7 }], since: (request as { since: number }).since }
    },
    provideForeignGASPNode: async (graphID: string, txid: string, outputIndex: number) => {
      seen.nodes.push([graphID, txid, outputIndex])
      if (txid === 'ff'.repeat(32)) throw new Error('Unable to find output associated with your request!')
      return { graphID, rawTx: '00', outputIndex }
    },
  } as unknown as OverlayEngine
  return { engine, seen }
}

async function serve(engine: OverlayEngine): Promise<string> {
  running = await startOverlayService(engine, { port: 0, host: HOST })
  return `http://${HOST}:${running.port}`
}

const post = async (base: string, route: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  await fetch(`${base}${route}`, { method: 'POST', headers: { ...JSON_BODY, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /requestSyncResponse', () => {
  it('passes the request and the topic from X-BSV-Topic to the engine and returns its answer', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const response = await post(base, '/requestSyncResponse', { version: 1, since: 0 }, { 'X-BSV-Topic': 'tm_dpp' })
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ UTXOList: [{ txid: 'ab'.repeat(32), outputIndex: 1, score: 7 }], since: 0 })
    expect(seen.sync).toEqual([[{ version: 1, since: 0, limit: 500 }, 'tm_dpp']])
    const limited = await post(base, '/requestSyncResponse', { version: 1, since: 5, limit: 100 }, { 'X-BSV-Topic': 'tm_dpp' })
    expect(limited.status).toBe(200)
    expect(seen.sync[1]).toEqual([{ version: 1, since: 5, limit: 100 }, 'tm_dpp'])
  })

  it('defaults and clamps limit to 500, so no peer receives every output of a topic in one answer', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    for (const [limit, expected] of [[undefined, 500], [10_000, 500], [500, 500], [10, 10]] as Array<[number | undefined, number]>) {
      const response = await post(base, '/requestSyncResponse', { version: 1, since: 0, ...(limit === undefined ? {} : { limit }) }, { 'X-BSV-Topic': 'tm_dpp' })
      expect(response.status).toBe(200)
      expect(seen.sync.at(-1)).toEqual([{ version: 1, since: 0, limit: expected }, 'tm_dpp'])
    }
    // Zero and negatives are still refused: a clamp bounds, it does not guess.
    expect((await post(base, '/requestSyncResponse', { version: 1, since: 0, limit: 0 }, { 'X-BSV-Topic': 'tm_dpp' })).status).toBe(400)
  })

  it('refuses a missing or unknown topic and a malformed request, in the shape the other routes use', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const cases: Array<[unknown, Record<string, string>, string]> = [
      [{ version: 1, since: 0 }, {}, 'X-BSV-Topic header is required'],
      [{ version: 1, since: 0 }, { 'X-BSV-Topic': 'tm_other' }, 'unknown topic tm_other'],
      [{ since: 0 }, { 'X-BSV-Topic': 'tm_dpp' }, 'version must be a number'],
      [{ version: 1, since: -1 }, { 'X-BSV-Topic': 'tm_dpp' }, 'since must be a non-negative integer'],
      [{ version: 1, since: 1.5 }, { 'X-BSV-Topic': 'tm_dpp' }, 'since must be a non-negative integer'],
      [{ version: 1, since: 0, limit: 0 }, { 'X-BSV-Topic': 'tm_dpp' }, 'limit must be a positive integer'],
      [[1, 2], { 'X-BSV-Topic': 'tm_dpp' }, 'body must be a JSON object with version and since'],
      ['{', { 'X-BSV-Topic': 'tm_dpp' }, 'body must be JSON'],
    ]
    for (const [body, headers, description] of cases) {
      const response = await post(base, '/requestSyncResponse', body, headers)
      expect(response.status, description).toBe(400)
      expect(await bodyOf(response)).toEqual({ status: 'error', description })
    }
    expect(seen.sync).toHaveLength(0)
  })
})

describe('POST /requestForeignGASPNode', () => {
  it('passes graphID, txid and outputIndex to the engine and returns the node', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const graphID = `${'ab'.repeat(32)}.1`
    const response = await post(base, '/requestForeignGASPNode', { graphID, txid: 'cd'.repeat(32), outputIndex: 0, metadata: true })
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ graphID, rawTx: '00', outputIndex: 0 })
    expect(seen.nodes).toEqual([[graphID, 'cd'.repeat(32), 0]])
  })

  it('refuses a malformed request and answers 404 for an output the engine cannot find', async () => {
    const { engine } = stubEngine()
    const base = await serve(engine)
    const graphID = `${'ab'.repeat(32)}.1`
    const cases: Array<[unknown, string]> = [
      [{ graphID: 'nope', txid: 'cd'.repeat(32), outputIndex: 0 }, 'graphID must be txid.outputIndex'],
      [{ graphID, txid: 'short', outputIndex: 0 }, 'txid must be 64 lower-case hex characters'],
      [{ graphID, txid: 'cd'.repeat(32), outputIndex: -1 }, 'outputIndex must be a non-negative integer'],
      [{ graphID, txid: 'cd'.repeat(32) }, 'outputIndex must be a non-negative integer'],
      [null, 'body must be a JSON object with graphID, txid and outputIndex'],
    ]
    for (const [body, description] of cases) {
      const response = await post(base, '/requestForeignGASPNode', body)
      expect(response.status, description).toBe(400)
      expect(await bodyOf(response)).toEqual({ status: 'error', description })
    }
    const missing = await post(base, '/requestForeignGASPNode', { graphID, txid: 'ff'.repeat(32), outputIndex: 0 })
    expect(missing.status).toBe(404)
    expect((await bodyOf(missing)).description).toBe('this index holds no such output in that graph')
  })

  it('serves a held state and its proven funding from a real engine', async () => {
    const node = newNode()
    const base = await serve(node.engine)
    const { tx } = await genesisTx()
    expect((await submitBeef(base, tx.toBEEF())).status).toBe(200)
    const txid = tx.id('hex')

    const listed = await post(base, '/requestSyncResponse', { version: 1, since: 0 }, { 'X-BSV-Topic': 'tm_dpp' })
    expect(listed.status).toBe(200)
    const answer = await bodyOf(listed)
    expect(answer.UTXOList).toEqual([{ txid, outputIndex: 0, score: expect.any(Number) }])
    expect(answer.since).toBe(0)
    // Nothing is offered for the anchor topic, and nothing newer than the score.
    expect((await bodyOf(await post(base, '/requestSyncResponse', { version: 1, since: 0 }, { 'X-BSV-Topic': 'tm_attestation' }))).UTXOList).toEqual([])
    expect((await bodyOf(await post(base, '/requestSyncResponse', { version: 1, since: answer.UTXOList[0].score + 1 }, { 'X-BSV-Topic': 'tm_dpp' }))).UTXOList).toEqual([])
    // The limit reaches the storage: two more passports make three tips, and a page of two lists two.
    for (const suffix of ['TWO', 'THREE']) {
      const { tx: other } = await genesisTx({ passportId: `https://id.gs1.org/01/09506000134352/21/EXT-${suffix}` })
      expect((await submitBeef(base, other.toBEEF())).status).toBe(200)
    }
    expect((await bodyOf(await post(base, '/requestSyncResponse', { version: 1, since: 0 }, { 'X-BSV-Topic': 'tm_dpp' }))).UTXOList).toHaveLength(3)
    expect((await bodyOf(await post(base, '/requestSyncResponse', { version: 1, since: 0, limit: 2 }, { 'X-BSV-Topic': 'tm_dpp' }))).UTXOList).toHaveLength(2)

    const graphID = `${txid}.0`
    const state = await bodyOf(await post(base, '/requestForeignGASPNode', { graphID, txid, outputIndex: 0 }))
    expect(state).toEqual({ graphID, rawTx: tx.toHex(), outputIndex: 0 })
    const funding = tx.inputs[0].sourceTransaction!
    const parent = await bodyOf(await post(base, '/requestForeignGASPNode', { graphID, txid: funding.id('hex'), outputIndex: 0 }))
    expect(parent).toEqual({ graphID, rawTx: funding.toHex(), outputIndex: 0, proof: funding.merklePath!.toHex() })
    expect(Transaction.fromHex(parent.rawTx).id('hex')).toBe(funding.id('hex'))
  })
})
