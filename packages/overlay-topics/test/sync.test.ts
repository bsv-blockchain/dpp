import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import { startPeerSynchronisation } from '../src/sync.js'

/**
 * The reconciliation after a round (sync.ts): the SDK moves the checkpoint to
 * the newest offered output before fetching any, skips a graph that fails,
 * and a lineage lost that way never returned. Here a stand-in peer offers
 * outputs, a stand-in engine does what the SDK does to the checkpoint, and
 * the storage says what arrived.
 */
const HOST = '127.0.0.1'
const TXID_A = 'aa'.repeat(32)
const TXID_B = 'bb'.repeat(32)
let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((resolve) => (server == null ? resolve() : server.close(() => resolve())))
  server = undefined
})

async function peerOffering(offered: Record<string, Array<{ txid: string; outputIndex: number; score: number }>>): Promise<{ base: string; requests: Array<{ topic: string; since: number }> }> {
  const requests: Array<{ topic: string; since: number }> = []
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      const topic = String(request.headers['x-bsv-topic'] ?? '')
      const { since } = JSON.parse(body) as { since: number }
      requests.push({ topic, since })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ since: 0, UTXOList: (offered[topic] ?? []).filter((o) => o.score >= since) }))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, HOST, resolve))
  return { base: `http://${HOST}:${(server.address() as AddressInfo).port}`, requests }
}

function admitted(storage: InMemoryOverlayStorage, txid: string, topic: string): Promise<void> {
  return storage.insertOutput({ txid, outputIndex: 0, outputScript: [0x51], satoshis: 1, topic, spent: false, outputsConsumed: [], consumedBy: [] } as never)
}

describe('reconciliation after a synchronisation round', () => {
  it('holds the checkpoint at the earliest offered output that did not arrive, so the next round offers it again', async () => {
    const storage = new InMemoryOverlayStorage()
    const peer = await peerOffering({ tm_dpp: [{ txid: TXID_A, outputIndex: 0, score: 40 }, { txid: TXID_B, outputIndex: 0, score: 60 }] })
    // What the SDK does: the checkpoint moves to the newest output listed, whatever arrived.
    const engine = { startGASPSync: async () => { await storage.updateLastInteraction(peer.base, 'tm_dpp', 100) } }
    const warnings: string[] = []
    const sync = startPeerSynchronisation(engine, {
      intervalMs: 0, peers: [peer.base], log: () => {}, warn: (line) => warnings.push(line),
      reconcile: { storage, topics: ['tm_dpp'], maxAttempts: 3 },
    })
    const first = await sync.runOnce()
    expect(first.ok).toBe(true)
    expect(first.reconciliation).toEqual([{ peer: peer.base, topic: 'tm_dpp', offered: 2, missing: 2, heldAt: 40, abandoned: [], partial: false }])
    expect(await storage.getLastInteraction(peer.base, 'tm_dpp')).toBe(40)
    expect(peer.requests).toEqual([{ topic: 'tm_dpp', since: 0 }])
    expect(warnings.some((w) => w.includes('2 of 2 outputs offered') && w.includes('held at 40'))).toBe(true)

    // The first arrives; the checkpoint is held at the second.
    await admitted(storage, TXID_A, 'tm_dpp')
    const second = await sync.runOnce()
    expect(second.reconciliation?.[0]).toMatchObject({ offered: 2, missing: 1, heldAt: 60 })
    expect(await storage.getLastInteraction(peer.base, 'tm_dpp')).toBe(60)
    expect(peer.requests[1]).toEqual({ topic: 'tm_dpp', since: 40 })

    // Everything arrived: the SDK's checkpoint stands and nothing is held.
    await admitted(storage, TXID_B, 'tm_dpp')
    const third = await sync.runOnce()
    expect(third.reconciliation?.[0]).toMatchObject({ offered: 1, missing: 0 })
    expect(third.reconciliation?.[0].heldAt).toBeUndefined()
    expect(await storage.getLastInteraction(peer.base, 'tm_dpp')).toBe(100)
    sync.stop()
  })

  it('leaves an output behind after maxAttempts rounds and says so once, so a refused state is not asked for for ever', async () => {
    const storage = new InMemoryOverlayStorage()
    const peer = await peerOffering({ tm_dpp: [{ txid: TXID_A, outputIndex: 0, score: 40 }] })
    const engine = { startGASPSync: async () => { await storage.updateLastInteraction(peer.base, 'tm_dpp', 100) } }
    const warnings: string[] = []
    const sync = startPeerSynchronisation(engine, {
      intervalMs: 0, peers: [peer.base], log: () => {}, warn: (line) => warnings.push(line),
      reconcile: { storage, topics: ['tm_dpp'], maxAttempts: 2 },
    })
    expect((await sync.runOnce()).reconciliation?.[0]).toMatchObject({ missing: 1, heldAt: 40, abandoned: [] })
    expect(await storage.getLastInteraction(peer.base, 'tm_dpp')).toBe(40)
    expect((await sync.runOnce()).reconciliation?.[0]).toMatchObject({ missing: 0, abandoned: [`${TXID_A}.0`] })
    expect(await storage.getLastInteraction(peer.base, 'tm_dpp')).toBe(100)
    expect(warnings.filter((w) => w.includes('left behind after 2 rounds'))).toHaveLength(1)
    sync.stop()
  })

  it('checks every configured topic, and a peer that cannot be read is a warning and not a failed round', async () => {
    const storage = new InMemoryOverlayStorage()
    const peer = await peerOffering({ tm_attestation: [{ txid: TXID_B, outputIndex: 0, score: 7 }] })
    const engine = { startGASPSync: async () => {} }
    const warnings: string[] = []
    const sync = startPeerSynchronisation(engine, {
      intervalMs: 0, peers: [peer.base, 'http://127.0.0.1:1'], log: () => {}, warn: (line) => warnings.push(line),
      reconcile: { storage, topics: ['tm_dpp', 'tm_attestation'] },
    })
    const round = await sync.runOnce()
    expect(round.ok).toBe(true)
    expect(round.reconciliation).toEqual([
      { peer: peer.base, topic: 'tm_dpp', offered: 0, missing: 0, abandoned: [], partial: false },
      { peer: peer.base, topic: 'tm_attestation', offered: 1, missing: 1, abandoned: [], partial: false },
    ])
    // Nothing to hold below: the checkpoint was already 0.
    expect(await storage.getLastInteraction(peer.base, 'tm_attestation')).toBe(0)
    expect(warnings.filter((w) => w.includes('could not read what http://127.0.0.1:1 offered'))).toHaveLength(2)
    sync.stop()
  })

  it('does nothing without reconciliation settings, exactly as before', async () => {
    const engine = { startGASPSync: async () => {} }
    const sync = startPeerSynchronisation(engine, { intervalMs: 0, peers: ['http://127.0.0.1:1'], log: () => {}, warn: () => {} })
    const round = await sync.runOnce()
    expect(round.ok).toBe(true)
    expect(round.reconciliation).toBeUndefined()
    sync.stop()
  })
})
