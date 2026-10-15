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
      ).rejects.toThrow(/passportId, uid, tokenId or gs1Key/)
    }
  })

  it('treats an empty string as missing, since every record without a chip stores uid as ""', async () => {
    const service = await seeded(3)
    for (const query of [{ uid: '' }, { passportId: '' }, { tokenId: '' }, {}]) {
      await expect(service.lookup({ service: 'ls_dpp', query })).rejects.toThrow(
        /passportId, uid, tokenId or gs1Key/
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

describe('the GS1 key, for a caller holding a GTIN and serial but no host', () => {
  // One product, two passports issued under two hosts, and the GTIN spelt as
  // the 13 digits a barcode carries under one of them: one key tuple.
  const A = 'https://dpp.example.com/01/09529990001039/21/EBL-1'
  const B = 'https://passports.example.org/01/9529990001039/21/EBL-1'
  const OTHER = 'https://dpp.example.com/01/09529990001039/21/EBL-2'

  async function twoHosts(): Promise<DppLookupService> {
    const storage = new InMemoryDppStorage()
    await storage.insert(record(0, { passportId: A, uid: '' }))
    await storage.insert(record(1, { passportId: A, uid: '' }))
    await storage.insert(record(2, { passportId: B, uid: '', previousTxid: '' }))
    await storage.insert(record(3, { passportId: OTHER, uid: '', previousTxid: '' }))
    return new DppLookupService(storage)
  }
  const txids = (formula: unknown) => (formula as Array<{ txid: string }>).map((o) => o.txid.replace(/^0+/, '') || '0')

  it('answers every passport that names the key, under any host, in all three spellings', async () => {
    const service = await twoHosts()
    for (const gs1Key of ['01:09529990001039|21:EBL-1', '01/09529990001039/21/EBL-1', '/01/9529990001039/21/EBL-1', 'https://elsewhere.example/01/09529990001039/21/EBL-1']) {
      expect(txids(await service.lookup({ service: 'ls_dpp', query: { gs1Key } }))).toEqual(['0', '1', '2'])
    }
    expect(txids(await service.lookup({ service: 'ls_dpp', query: { gs1Key: '01/09529990001039/21/EBL-2' } }))).toEqual(['3'])
    expect(await service.lookup({ service: 'ls_dpp', query: { gs1Key: '01/09529990001039/21/NONE' } })).toEqual([])
  })

  it('refuses a value that names no GS1 key', async () => {
    const service = await twoHosts()
    for (const gs1Key of ['EBL-1', '01:', 'https://dpp.example.com/passport/EBL-1', '21/EBL-1']) {
      await expect(service.lookup({ service: 'ls_dpp', query: { gs1Key } })).rejects.toThrow(/gs1Key must be/)
    }
  })

  it('stores no key for an identifier that is not a GS1 Digital Link', async () => {
    const storage = new InMemoryDppStorage()
    await storage.insert(record(0, { passportId: 'urn:example:passport:1', uid: '' }))
    expect((await storage.findByPassport('urn:example:passport:1'))[0].gs1Key).toBe('')
    expect(await storage.findByGs1Key('')).toEqual([])
  })
})

describe('the token id, for a caller holding a carried lineage and nothing else', () => {
  const TOKEN = `${'c'.repeat(64)}_0`
  const OTHER_TOKEN = `${'d'.repeat(64)}_0`
  const CARRIED = 'https://dpp.example.com/01/09529990001039/21/TOKEN-1'

  async function mixed(): Promise<DppLookupService> {
    const storage = new InMemoryDppStorage()
    // An uncarried lineage, then a carried one, then another carried one.
    await storage.insert(record(0))
    await storage.insert(record(1))
    await storage.insert(record(2, { passportId: CARRIED, uid: '', previousTxid: '', tokenId: TOKEN }))
    await storage.insert(record(3, { passportId: CARRIED, uid: '', tokenId: TOKEN }))
    await storage.insert(record(4, { passportId: CARRIED, uid: '', previousTxid: '', tokenId: OTHER_TOKEN }))
    return new DppLookupService(storage)
  }
  const txids = (formula: unknown) => (formula as Array<{ txid: string }>).map((o) => o.txid.replace(/^0+/, '') || '0')

  it('answers exactly the states of the one lineage the token is', async () => {
    const service = await mixed()
    expect(txids(await service.lookup({ service: 'ls_dpp', query: { tokenId: TOKEN } }))).toEqual(['2', '3'])
    expect(txids(await service.lookup({ service: 'ls_dpp', query: { tokenId: OTHER_TOKEN } }))).toEqual(['4'])
    expect(await service.lookup({ service: 'ls_dpp', query: { tokenId: `${'e'.repeat(64)}_0` } })).toEqual([])
  })

  it('answers the passport identifier first when both are given, as it does for uid', async () => {
    const service = await mixed()
    expect(txids(await service.lookup({ service: 'ls_dpp', query: { passportId: PASSPORT_ID, tokenId: TOKEN } }))).toEqual(['0', '1'])
  })

  it('refuses any other spelling of a token id by name rather than answering empty', async () => {
    const service = await mixed()
    for (const tokenId of ['c'.repeat(64), `${'c'.repeat(64)}_1`, `${'C'.repeat(64)}_0`, `${'c'.repeat(63)}_0`, 'TOKEN-1', `${'c'.repeat(64)}_0 `]) {
      await expect(service.lookup({ service: 'ls_dpp', query: { tokenId } })).rejects.toThrow(/tokenId must be/)
    }
    await expect(service.lookup({ service: 'ls_dpp', query: { tokenId: { $ne: '' } } as unknown as object })).rejects.toThrow(/passportId, uid, tokenId or gs1Key/)
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
