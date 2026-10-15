import { afterEach, describe, expect, it } from 'vitest'
import { Transaction } from '@bsv/sdk'
import { startOverlayService, type RunningService } from '../src/index.js'
import { eventTx, genesisTx, lookupPassport, newNode, submitBeef } from './helpers.js'

/**
 * POST /lookup by GS1 key: a caller holding only the path a barcode or a
 * person gives, `01/<gtin>/21/<serial>`, finds the passport and learns its
 * exact identifier, host included, from the states themselves.
 */

const HOST = '127.0.0.1'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('POST /lookup with gs1Key', () => {
  it('answers the same states as the exact identifier, from a bare path', async () => {
    const node = newNode(undefined, {}, { quiet: true })
    running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components })
    const base = `http://${HOST}:${running.port}`
    const { tx: genesis } = await genesisTx()
    const { tx: event } = await eventTx(genesis)
    for (const tx of [genesis, event]) expect((await submitBeef(base, tx.toBEEF())).headers.get('x-admission')).toBe('tm_dpp=admitted')

    const txids = (outputs: Array<{ beef: number[] }>) => outputs.map((o) => Transaction.fromBEEF(o.beef).id('hex')).sort()
    const exact = txids(await lookupPassport(base, { passportId: 'https://id.gs1.org/01/09506000134352/21/EXT-1' }))
    expect(exact).toHaveLength(2)
    expect(txids(await lookupPassport(base, { gs1Key: '01/09506000134352/21/EXT-1' }))).toEqual(exact)
    expect(txids(await lookupPassport(base, { gs1Key: '01:09506000134352|21:EXT-1' }))).toEqual(exact)
  })
})
