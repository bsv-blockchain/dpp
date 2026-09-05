import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivateKey, ProtoWallet, Transaction, Utils } from '@bsv/sdk'
import { DppTopicManager } from '../src/tmDpp.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, eventTx, genesisTx, lookupPassport, newNode, PASSPORT_ID, SERVER_ID, submitBeef } from './helpers.js'

/**
 * A refused spend of the admitted tip. The Engine reads a spend it did not
 * retain as the tip's consumption and evicts the tip with its lineage, and
 * before that it announces the spend to every lookup service. tm_dpp now
 * retains the offered coins on every refusal, and ls_dpp records a spend only
 * once the spending transaction is admitted, so the passport reads exactly as
 * it did before the refused announcement. What the Engine still does with the
 * refused transaction is asserted here too, so the residue is a documented
 * fact and not a surprise.
 */

const HOST = '127.0.0.1'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
  vi.restoreAllMocks()
})

const normalise = (outputs: Array<{ beef: number[]; outputIndex: number }>) =>
  outputs.map((o) => ({ txid: Transaction.fromBEEF(o.beef).id('hex'), outputIndex: o.outputIndex, beef: Utils.toBase64(o.beef) })).sort((x, y) => x.txid.localeCompare(y.txid))

describe('a refused spend of the tip', () => {
  it('leaves /lookup, /history and the record store unchanged, and the tip still unspent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = newNode()
    running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components })
    const base = `http://${HOST}:${running.port}`
    const { tx: genesis } = await genesisTx()
    const { tx: tip } = await eventTx(genesis)
    for (const tx of [genesis, tip]) expect((await submitBeef(base, tx.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=admitted')

    const historyUrl = `${base}/history?passportId=${encodeURIComponent(PASSPORT_ID)}`
    const lookupBefore = normalise(await lookupPassport(base, { passportId: PASSPORT_ID }))
    const historyBefore = await bodyOf(await fetch(historyUrl))
    const recordsBefore = JSON.parse(JSON.stringify(await node.records.findByPassport(PASSPORT_ID)))
    expect(historyBefore.items.map((i: { spent: boolean }) => i.spent)).toEqual([true, false])

    // Two refusals that spend the tip: one countersigned by a stranger, one
    // breaking a chain invariant (passport_id changes).
    const { tx: wrongKey } = await eventTx(tip, { timestamp: '2026-07-26T11:00:00Z' }, new ProtoWallet(PrivateKey.fromHex('44'.repeat(32))))
    const { tx: wrongPassport } = await eventTx(tip, { timestamp: '2026-07-26T11:00:00Z', passportId: 'https://id.gs1.org/01/09506000134352/21/OTHER-1' })
    for (const refused of [wrongKey, wrongPassport]) {
      const response = await submitBeef(base, refused.toBEEF())
      expect(response.status).toBe(200)
      expect(response.headers.get('x-admission')).toBe('tm_dpp=none')
      expect(await bodyOf(response)).toEqual({ tm_dpp: { outputsToAdmit: [], coinsToRetain: [0], coinsRemoved: [] } })
    }
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('admitted nothing'))).toHaveLength(2)

    // Unchanged, all three views of the passport.
    expect(normalise(await lookupPassport(base, { passportId: PASSPORT_ID }))).toEqual(lookupBefore)
    const historyAfter = await bodyOf(await fetch(historyUrl))
    expect(historyAfter.items).toEqual(historyBefore.items)
    expect(JSON.parse(JSON.stringify(await node.records.findByPassport(PASSPORT_ID)))).toEqual(recordsBefore)

    // What the Engine did with the refused transactions: kept the tip and
    // its lineage (the guard), marked the tip spent in its own storage all
    // the same, and recorded each refused transaction as applied to the
    // topic. The host reads that record for what it is: the same bytes
    // announced again are re-evaluated and answered none, never duplicate,
    // so the writer records an incident and not success.
    const held = await node.storage.findOutput(tip.id('hex'), 0, 'tm_dpp')
    expect(held).not.toBeNull()
    expect(held?.spent).toBe(true)
    expect(held?.consumedBy).toEqual([])
    expect(await node.storage.findOutput(genesis.id('hex'), 0, 'tm_dpp')).not.toBeNull()
    for (const refused of [wrongKey, wrongPassport]) {
      expect(await node.storage.findOutput(refused.id('hex'), 0, 'tm_dpp')).toBeNull()
      expect(await node.storage.doesAppliedTransactionExist({ txid: refused.id('hex'), topic: 'tm_dpp' })).toBe(true)
      const again = await submitBeef(base, refused.toBEEF())
      expect(again.headers.get('x-admission')).toBe('tm_dpp=none')
      expect(await bodyOf(again)).toEqual({ tm_dpp: { outputsToAdmit: [], coinsToRetain: [0], coinsRemoved: [] } })
      expect(await node.storage.doesAppliedTransactionExist({ txid: refused.id('hex'), topic: 'tm_dpp' })).toBe(true)
    }
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('was announced and refused before'))).toHaveLength(2)

    // A valid later state is admitted against the retained tip, which is
    // then spent by it and by nothing else.
    const { tx: next } = await eventTx(tip, { timestamp: '2026-07-26T12:00:00Z', op: 'REPAIRED' })
    const admitted = await submitBeef(base, next.toBEEF())
    expect(admitted.headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect(await bodyOf(admitted)).toEqual({ tm_dpp: { outputsToAdmit: [0], coinsToRetain: [0], coinsRemoved: [] } })
    const final = await bodyOf(await fetch(historyUrl))
    expect(final.items.map((i: { txid: string; spent: boolean; spendingTxid: string }) => [i.txid, i.spent, i.spendingTxid])).toEqual([
      [genesis.id('hex'), true, tip.id('hex')],
      [tip.id('hex'), true, next.id('hex')],
      [next.id('hex'), false, ''],
    ])
    expect(await lookupPassport(base, { passportId: PASSPORT_ID })).toHaveLength(3)
  })

  it('admits a transaction refused for a transient reason once it is re-announced with the reason gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = newNode()
    running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components })
    const base = `http://${HOST}:${running.port}`
    const { tx: genesis } = await genesisTx()
    const { tx: event } = await eventTx(genesis)

    // The successor first, as a stranger poisoning the outbox or a writer's
    // announcements arriving out of order would: refused, the predecessor
    // being unknown, and recorded by the Engine as applied.
    const early = await submitBeef(base, event.toBEEF())
    expect(early.headers.get('x-admission')).toBe('tm_dpp=none')
    expect(await node.storage.doesAppliedTransactionExist({ txid: event.id('hex'), topic: 'tm_dpp' })).toBe(true)
    expect(await lookupPassport(base, { passportId: PASSPORT_ID })).toEqual([])

    // The predecessor, then the successor again: re-evaluated, not skipped.
    expect((await submitBeef(base, genesis.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=admitted')
    const again = await submitBeef(base, event.toBEEF())
    expect(again.headers.get('x-admission')).toBe('tm_dpp=admitted')
    expect(await bodyOf(again)).toEqual({ tm_dpp: { outputsToAdmit: [0], coinsToRetain: [0], coinsRemoved: [] } })
    expect(await lookupPassport(base, { passportId: PASSPORT_ID })).toHaveLength(2)
    const history = await bodyOf(await fetch(`${base}/history?passportId=${encodeURIComponent(PASSPORT_ID)}`))
    expect(history.items.map((i: { txid: string; spent: boolean; spendingTxid: string }) => [i.txid, i.spent, i.spendingTxid])).toEqual([
      [genesis.id('hex'), true, event.id('hex')],
      [event.id('hex'), false, ''],
    ])
    // And an admitted transaction announced once more is the genuine duplicate it always was.
    expect((await submitBeef(base, event.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=duplicate')
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('admitted nothing'))).toHaveLength(1)
  })

  it('is the topic manager retaining the offered coins on refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tm = new DppTopicManager(SERVER_ID)
    const { tx: genesis } = await genesisTx()
    const { tx: refused } = await eventTx(genesis, {}, new ProtoWallet(PrivateKey.fromHex('44'.repeat(32))))
    // The Engine offers input 0 as a previously admitted coin; refused, it is retained.
    expect(await tm.identifyAdmissibleOutputs(refused.toBEEF(), [0])).toEqual({ outputsToAdmit: [], coinsToRetain: [0] })
    // Nothing offered, nothing to retain.
    expect(await tm.identifyAdmissibleOutputs(refused.toBEEF(), [])).toEqual({ outputsToAdmit: [], coinsToRetain: [] })
    // And the valid successor is admitted with the same coin retained.
    const { tx: valid } = await eventTx(genesis)
    expect(await tm.identifyAdmissibleOutputs(valid.toBEEF(), [0])).toEqual({ outputsToAdmit: [0], coinsToRetain: [0] })
  })

  it('judges a proven state announced without its predecessor bytes against the predecessor the index holds', async () => {
    const node = newNode()
    const { tx: genesis } = await genesisTx()
    await node.engine.submit({ beef: genesis.toBEEF(), topics: ['tm_dpp'] })
    const { tx: event } = await eventTx(genesis)
    // A proven state's BEEF stops at its proof and carries no parent; the
    // Engine still offers the parent as a previous coin, and the manager now
    // reads the parent's script from the engine storage it was given.
    event.merklePath = (await import('@bsv/sdk')).MerklePath.fromCoinbaseTxidAndHeight(event.id('hex'), 800_500)
    const beef = event.toBEEF()
    expect(beef.length).toBeLessThan(genesis.toBEEF().length + event.toHex().length / 2)
    const steak = await node.engine.submit({ beef, topics: ['tm_dpp'] })
    expect(steak.tm_dpp).toEqual({ outputsToAdmit: [0], coinsToRetain: [0], coinsRemoved: [] })
    const bare = new DppTopicManager(SERVER_ID)
    expect((await bare.identifyAdmissibleOutputs(beef, [0])).outputsToAdmit).toEqual([])
  })
})
