import { describe, expect, it } from 'vitest'
import { DppLookupService, MAX_LOOKUP_RESULTS } from '../src/lsDpp.js'
import { InMemoryDppStorage, type DppRecord } from '../src/storage.js'

/**
 * The lookup guard and the answer cap at the service boundary rather than the
 * HTTP one, because MiniOverlay (the app's demonstration mode) calls this
 * class directly and never passes the handler's validation, and because
 * MongoDppStorage would run whatever object reaches it as a filter.
 */

const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/LS-1'
const UID = 'LS-UID-1'

function record(n: number, overrides: Partial<DppRecord> = {}): DppRecord {
  return {
    txid: `${n}`.padStart(64, '0'),
    outputIndex: 0,
    passportId: PASSPORT_ID,
    uid: UID,
    op: n === 0 ? 'ACTIVATE' : 'SERVICE_EVENT',
    timestamp: '2026-07-26T09:00:00Z',
    previousTxid: n === 0 ? '' : `${n - 1}`.padStart(64, '0'),
    spent: false,
    spendingTxid: '',
    createdAt: new Date(1_753_500_000_000 + n * 1000),
    ...overrides,
  }
}

async function seeded(count: number): Promise<DppLookupService> {
  const storage = new InMemoryDppStorage()
  for (let n = 0; n < count; n++) await storage.insert(record(n))
  return new DppLookupService(storage)
}

describe('the query guard', () => {
  it('refuses an operator-shaped value where a string belongs', async () => {
    const service = await seeded(3)
    const probes = [
      { uid: { $ne: '' } },
      { passportId: { $gt: '' } },
      { uid: ['LS-UID-1'] },
      { uid: 7 },
    ]
    for (const query of probes) {
      await expect(
        service.lookup({ service: 'ls_dpp', query: query as unknown as object })
      ).rejects.toThrow(/passportId or uid/)
    }
  })

  it('treats an empty string as missing, since every record without a chip stores uid as ""', async () => {
    const service = await seeded(3)
    for (const query of [{ uid: '' }, { passportId: '' }, {}]) {
      await expect(service.lookup({ service: 'ls_dpp', query })).rejects.toThrow(
        /passportId or uid/
      )
    }
  })

  it('still answers a plain string query, by either key', async () => {
    const service = await seeded(3)
    expect(await service.lookup({ service: 'ls_dpp', query: { uid: UID } })).toHaveLength(3)
    expect(
      await service.lookup({ service: 'ls_dpp', query: { passportId: PASSPORT_ID } })
    ).toHaveLength(3)
  })
})

describe('the answer cap', () => {
  it('holds, and the newest states survive it', async () => {
    const count = MAX_LOOKUP_RESULTS + 25
    const service = await seeded(count)
    const formula = (await service.lookup({
      service: 'ls_dpp',
      query: { passportId: PASSPORT_ID },
    })) as Array<{ txid: string }>

    expect(formula).toHaveLength(MAX_LOOKUP_RESULTS)
    const answered = new Set(formula.map((entry) => entry.txid))
    // The tip is the newest record; a cap that kept the oldest instead would
    // answer a stale tip, which is worse than a truncated history.
    expect(answered.has(record(count - 1).txid)).toBe(true)
    expect(answered.has(record(0).txid)).toBe(false)
  })
})
