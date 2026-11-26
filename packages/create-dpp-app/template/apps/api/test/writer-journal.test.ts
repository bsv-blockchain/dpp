import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Beef, Transaction, Utils } from '@bsv/sdk'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { IndexClient } from '../src/index-client.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { createServer } from '../src/server.js'
import { samplePayload } from '../src/profiles.js'
import { MongoStore, type PassportRecord } from '../src/store.js'
import { pendingDuties, runDuties } from '../src/worker.js'
import { ActionAlreadySeen } from '../src/wallet.js'
import { Writer } from '../src/writer.js'
import { startMongo, type TestMongo } from './epcis-fixtures.js'

const config = loadConfig({ PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', NETWORK: 'test', LIVE_PUBLISHING: 'false' })
const identifiers = { host: config.passportHost, prefix: config.gs1Prefix }
let mongo: TestMongo
let platform: Platform
let primary: MongoStore
let secondary: MongoStore
let writer: Writer
let otherWriter: Writer

const newWriter = (store: MongoStore, index = platform.index) => new Writer({
  store, wallet: platform.wallet, index, identifiers,
  bound: platform.profiles, livePublishing: false, spendCapSatoshis: 20_000,
})
const brand = () => platform.parties.brand('sample-brand')
const id = (serial: string) => mintPassportId(identifiers, '100000001', serial)
const data = () => samplePayload('general@2', true)
const issue = (serial: string, service = writer) => service.issue({ brandId: 'sample-brand', brand: brand(), passportId: id(serial), profile: 'general@2', payload: data() })
const update = (service: Writer, record: PassportRecord, note: string) => service.update({ record, actor: brand(), payload: data(), eventData: { note } })

// Pause one real adapter call. Every other call still reaches the test wallet or loopback index.
function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeAll(async () => { mongo = await startMongo() })
afterAll(async () => { await mongo?.stop() })
beforeEach(async () => {
  const db = mongo.database()
  primary = new MongoStore(db)
  secondary = new MongoStore(db)
  await primary.init()
  await secondary.init()
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  writer = newWriter(primary)
  otherWriter = newWriter(secondary)
})
afterEach(async () => { vi.restoreAllMocks(); await platform?.close() })

describe('two writers sharing the passport journal in MongoDB', () => {
  it('keeps a pending update on the shared tip and lets another passport complete while the send is blocked', async () => {
    const issued = await issue('CONCURRENT')
    const stale = (await secondary.getPassport(issued.record.passportId))!
    const reached = signal(), release = signal()
    const realSend = platform.wallet.adapter.send.bind(platform.wallet.adapter)
    const sends = vi.spyOn(platform.wallet.adapter, 'send').mockImplementationOnce(async (built) => {
      reached.resolve()
      await release.promise
      return realSend(built)
    })
    const pending = update(writer, issued.record, 'first')
    let pendingTxid: string | undefined
    try {
      await reached.promise
      const journal = (await secondary.getPassport(stale.passportId))!
      expect(journal.states.map((entry) => entry.network)).toEqual(['dry-run', 'pending'])
      pendingTxid = journal.states.at(-1)!.txid
      await expect(update(otherWriter, stale, 'second')).rejects.toMatchObject({ code: expect.stringMatching(/^(operation-interrupted|tip-moved)$/) })
      expect((await secondary.getPassport(stale.passportId))!.states.at(-1)?.txid).toBe(pendingTxid)
      expect((await issue('INDEPENDENT', otherWriter)).entry.network).toBe('dry-run')
      expect(sends).toHaveBeenCalledTimes(2)
    } finally { release.resolve(); await pending }
    const saved = (await secondary.getPassport(stale.passportId))!
    expect(saved.states.map((entry) => entry.txid)).toEqual([issued.entry.txid, pendingTxid])
    expect(saved.states.at(-1)?.network).toBe('dry-run')
  })

  it.each(['sent', 'abandoned'] as const)('keeps the exact unanswered update until the operator resolves it as %s', async (answer) => {
    const original = await issue('INTERRUPTED')
    const send = vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
    await expect(update(writer, original.record, 'interrupted')).rejects.toMatchObject({ code: 'network-unanswered' })
    const retained = (await secondary.getPassport(original.record.passportId))!
    const draft = retained.states.at(-1)!
    expect(draft.network).toBe('unanswered')
    expect(draft.beef).toBe(Utils.toBase64(send.mock.calls[0]![0].beef))
    expect((await pendingDuties(secondary)).filter((duty) => duty.txid === draft.txid).map((duty) => duty.duty)).toEqual(['resolve-interrupted'])
    await runDuties({ store: secondary, index: platform.index, writer: otherWriter })
    await expect(update(otherWriter, retained, 'too early')).rejects.toMatchObject({ code: 'operation-interrupted' })
    expect(send).toHaveBeenCalledTimes(1)
    await otherWriter.resolveInterrupted(retained, draft.txid, answer)
    const settled = (await primary.getPassport(retained.passportId))!
    expect(settled.states.map((entry) => entry.txid)).toEqual(answer === 'sent' ? [original.entry.txid, draft.txid] : [original.entry.txid])
    if (answer === 'sent') expect(settled.states.at(-1)).toMatchObject({ network: 'dry-run', beef: draft.beef })
    expect((await update(writer, settled, 'continued')).state.previousTxid).toBe(settled.states.at(-1)!.txid)
  })

  it('removes a refused genesis and allows a fresh issue for the same identifier', async () => {
    vi.spyOn(platform.index, 'announce').mockResolvedValueOnce('refused')
    const send = vi.spyOn(platform.wallet.adapter, 'send')
    await expect(issue('RETRY-GENESIS')).rejects.toMatchObject({ code: 'index-refused' })
    expect(send).not.toHaveBeenCalled()
    expect(await secondary.getPassport(id('RETRY-GENESIS'))).toBeUndefined()
    expect((await issue('RETRY-GENESIS', otherWriter)).record.states).toHaveLength(1)
  })

  it('retains a sent state when an index without retraction refuses its announcement', async () => {
    const index = new IndexClient({ ...platform.devIndex! })
    const send = vi.spyOn(platform.wallet.adapter, 'send')
    const announce = vi.spyOn(index, 'announce').mockResolvedValueOnce('refused')
    const retract = vi.spyOn(index, 'retract')
    const { entry, record } = await issue('SEND-FIRST', newWriter(primary, index))
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ txid: entry.txid }))
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(announce.mock.invocationCallOrder[0]!)
    expect(entry).toMatchObject({ network: 'dry-run', index: 'refused' })
    await runDuties({ store: secondary, index, writer: newWriter(secondary, index) })
    expect((await primary.getPassport(record.passportId))!.states[0]!.index).toBe('admitted')
    expect(announce.mock.calls).toEqual([[send.mock.calls[0]![0].beef], [send.mock.calls[0]![0].beef]])
    expect(send).toHaveBeenCalledTimes(1)
    expect(retract).not.toHaveBeenCalled()
  })

  it('discards a refused send without contacting a non-retracting index', async () => {
    const index = new IndexClient({ ...platform.devIndex! })
    const announce = vi.spyOn(index, 'announce')
    const retract = vi.spyOn(index, 'retract')
    vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('refused')
    await expect(issue('REFUSED-SEND-FIRST', newWriter(primary, index))).rejects.toMatchObject({ code: 'network-refused' })
    expect(announce).not.toHaveBeenCalled()
    expect(retract).not.toHaveBeenCalled()
    expect(await secondary.getPassport(id('REFUSED-SEND-FIRST'))).toBeUndefined()
  })

  it('resumes a send-first write after the process loses its post-send journal update', async () => {
    const index = new IndexClient({ ...platform.devIndex! })
    const announce = vi.spyOn(index, 'announce')
    const send = vi.spyOn(platform.wallet.adapter, 'send')
    vi.spyOn(primary, 'recordSpend').mockRejectedValueOnce(new Error('interrupted after wallet send'))
    await expect(issue('RECOVER-SEND-FIRST', newWriter(primary, index))).rejects.toThrow('interrupted after wallet send')
    const pending = (await secondary.getPassport(id('RECOVER-SEND-FIRST')))!
    const draft = pending.states[0]!
    expect(draft).toMatchObject({ network: 'pending', index: 'not-asked' })
    expect(announce).not.toHaveBeenCalled()
    const resumedWriter = newWriter(secondary, index)
    await resumedWriter.resolveInterrupted(pending, draft.txid, 'sent')
    await runDuties({ store: secondary, writer: resumedWriter, index })
    expect((await primary.getPassport(pending.passportId))!.states[0]).toMatchObject({ txid: draft.txid, network: 'dry-run', index: 'admitted' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledExactlyOnceWith(send.mock.calls[0]![0].beef)
  })

  it('backfills two missed states in spend order with original BEEF after the writer clock moved backwards', async () => {
    const send = vi.spyOn(platform.wallet.adapter, 'send')
    const submit = platform.index.announce.bind(platform.index)
    const announce = vi.spyOn(platform.index, 'announce').mockResolvedValue('unreachable')
    vi.spyOn(platform.index, 'lineage').mockRejectedValue(new Error('index is offline'))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-26T10:01:00Z'))
      const genesis = await issue('BACKFILL')
      vi.setSystemTime(new Date('2026-11-26T10:00:00Z'))
      const next = await update(writer, genesis.record, 'offline')
      expect(send).toHaveBeenCalledTimes(2)
      const [genesisBytes, nextBytes] = send.mock.calls.map(([built]) => built.beef)
      expect(Transaction.fromAtomicBEEF(nextBytes!).id('hex')).toBe(next.entry.txid)
      expect(Beef.fromBinary(nextBytes!).findTxid(genesis.entry.txid)?.tx?.toHex()).toBe(genesis.entry.rawTx)

      // The first backfill is still offline. The worker must defer the successor.
      announce.mockClear()
      await runDuties({ store: secondary, index: platform.index, writer: otherWriter })
      expect(announce.mock.calls).toEqual([[genesisBytes]])
      announce.mockClear().mockImplementation(submit)
      await runDuties({ store: secondary, index: platform.index, writer: otherWriter })
      expect(announce.mock.calls).toEqual([[genesisBytes], [nextBytes]])
      expect((await primary.getPassport(next.record.passportId))!.states.map(s => s.index)).toEqual(['admitted', 'admitted'])
      expect(send).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('applies a late proof acknowledgement to its own transaction and retains the original BEEF', async () => {
    const issued = await issue('LATE-PROOF')
    const reached = signal(), release = signal()
    const push = platform.index.pushProof.bind(platform.index)
    vi.spyOn(platform.index, 'pushProof').mockImplementationOnce(async (txid, path) => {
      reached.resolve()
      await release.promise
      return push(txid, path)
    })
    const proving = otherWriter.prove((await secondary.getPassport(issued.record.passportId))!, issued.entry.txid)
    let nextTxid: string
    try {
      await reached.promise
      const latest = (await primary.getPassport(issued.record.passportId))!
      nextTxid = (await update(writer, latest, 'during proof')).entry.txid
    } finally { release.resolve(); await proving }
    const { states } = (await secondary.getPassport(issued.record.passportId))!
    expect(states.map((entry) => entry.txid)).toEqual([issued.entry.txid, nextTxid])
    expect(states[0]).toMatchObject({ rawTx: issued.entry.rawTx, sentBeef: issued.entry.beef, proofPushed: true })
    expect(states[0]!.beef).not.toBe(issued.entry.beef)
    expect(states[1]!.proof).toBeUndefined()
  })

  it('preserves an appended state when the worker receives a late index announcement', async () => {
    const announce = platform.index.announce.bind(platform.index)
    const requests = vi.spyOn(platform.index, 'announce').mockResolvedValueOnce('unreachable').mockResolvedValueOnce('unreachable')
    const issued = await issue('LATE-ANNOUNCEMENT')
    expect(issued.entry.index).toBe('unreachable')
    const reached = signal(), release = signal()
    requests.mockImplementationOnce(async (bytes) => {
      const outcome = await announce(bytes)
      reached.resolve()
      await release.promise
      return outcome
    })
    const worker = runDuties({ store: secondary, index: platform.index, writer: otherWriter })
    let nextTxid: string
    try {
      await reached.promise
      nextTxid = (await update(writer, (await primary.getPassport(issued.record.passportId))!, 'during announcement')).entry.txid
    } finally { release.resolve(); await worker }
    const { states } = (await primary.getPassport(issued.record.passportId))!
    expect(states.map((entry) => entry.txid)).toEqual([issued.entry.txid, nextTxid])
    expect(states[0]!.index).toBe('admitted')
    expect(states[1]!.network).toBe('dry-run')
    expect(requests.mock.calls[2]![0]).toEqual(Utils.toArray(issued.entry.beef, 'base64'))
  })
  it.each(['current', 'legacy'] as const)('retains a refused %s draft until withdrawal succeeds at the original index', async (journalVersion) => {
    vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('refused')
    const withdrawals = vi.spyOn(platform.index, 'retract').mockResolvedValueOnce({ ok: false, detail: 'temporarily offline' })
    await expect(issue('WITHDRAWAL')).rejects.toMatchObject({ code: 'retraction-pending' })
    const record = (await secondary.getPassport(id('WITHDRAWAL')))!
    const draft = record.states[0]!
    expect(draft.network).toBe('refused')
    expect(draft.draftIndexId).toBe(platform.index.destinationId)
    if (journalVersion === 'legacy') {
      delete draft.draftIndexId
      await secondary.savePassport(record)
    }
    expect(withdrawals).toHaveBeenCalledExactlyOnceWith(draft.txid, expect.stringContaining('the network refused'), draft.outputIndex)
    await expect(otherWriter.resolveInterrupted(record, draft.txid, 'sent')).rejects.toMatchObject({ code: 'not-interrupted' })
    await otherWriter.resolveInterrupted(record, draft.txid, 'abandoned')
    expect(withdrawals.mock.calls[1]).toEqual(withdrawals.mock.calls[0])
    expect(await primary.getPassport(record.passportId)).toBeUndefined()
    const retry = await issue('WITHDRAWAL')
    expect(retry.record.states).toHaveLength(1)
    expect(retry.entry).not.toHaveProperty('draftIndexId')
  })

  it('requires the original index to reconcile a withdrawal before replacing an outstanding draft', async () => {
    vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
    await expect(issue('INDEX-CHANGED')).rejects.toMatchObject({ code: 'network-unanswered' })
    const pending = (await secondary.getPassport(id('INDEX-CHANGED')))!
    const draft = pending.states[0]!
    const replacement = new IndexClient({ url: 'https://replacement.example', supportsRetraction: true })
    const wrongIndex = vi.spyOn(replacement, 'retract').mockResolvedValue({ ok: false, absent: true, detail: 'output unknown' })
    const discard = vi.spyOn(platform.wallet.adapter, 'discard')
    await expect(newWriter(secondary, replacement).resolveInterrupted(pending, draft.txid, 'abandoned'))
      .rejects.toMatchObject({ code: 'retraction-index-changed' })
    expect(wrongIndex).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    expect((await primary.getPassport(pending.passportId))!.states[0]!.network).toBe('unanswered')
    const original = vi.spyOn(platform.index, 'retract')
    await otherWriter.resolveInterrupted(pending, draft.txid, 'abandoned')
    expect(original).toHaveBeenCalledExactlyOnceWith(draft.txid, expect.any(String), draft.outputIndex)
    expect(await primary.getPassport(pending.passportId)).toBeUndefined()
  })

  it('keeps the transaction when the wallet reports it was already seen during abandonment', async () => {
    vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
    await expect(issue('ALREADY-SEEN')).rejects.toMatchObject({ code: 'network-unanswered' })
    const record = (await secondary.getPassport(id('ALREADY-SEEN')))!
    const entry = record.states[0]!
    vi.spyOn(platform.wallet.adapter, 'discard').mockRejectedValueOnce(new ActionAlreadySeen('seen by the wallet'))
    const withdrawn = vi.spyOn(platform.index, 'retract')
    await expect(otherWriter.resolveInterrupted(record, entry.txid, 'abandoned')).rejects.toMatchObject({ code: 'network-seen' })
    expect(withdrawn).not.toHaveBeenCalled()
    expect((await primary.getPassport(record.passportId))!.states[0]).toMatchObject({ rawTx: entry.rawTx, beef: entry.beef, network: 'unanswered' })
    expect((await writer.resolveInterrupted(record, entry.txid, 'sent')).states[0]!.network).toBe('dry-run')
  })

  it('shows a pending genesis and keeps an unanswered update out of the current public payload', async () => {
    const api = createServer({ platform: { ...platform, store: primary, writer } })
    const server = api.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/passports/${encodeURIComponent(id('PENDING-VIEW'))}`
    try {
      vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
      await expect(issue('PENDING-VIEW')).rejects.toMatchObject({ code: 'network-unanswered' })
      const draft = (await primary.getPassport(id('PENDING-VIEW')))!
      const pending = await (await fetch(url)).json()
      expect(pending.status).toBe('awaiting-send')
      expect(pending).not.toHaveProperty('payload')
      const issued = await writer.resolveInterrupted(draft, draft.states[0]!.txid, 'sent')
      vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
      const payload = { ...data(), name: 'Unanswered change' }
      await expect(writer.update({ record: issued, actor: brand(), payload })).rejects.toMatchObject({ code: 'network-unanswered' })
      const current = await (await fetch(url)).json()
      expect(current.payload).toEqual(JSON.parse(issued.states[0]!.payloadPublic))
      expect(current.states.map((state: { network: string }) => state.network)).toEqual(['dry-run', 'unanswered'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('refuses to carry a missing or damaged committed owner tier on a public update or retirement', async () => {
    const { record } = await issue('COMMITTED-TIER')
    for (const damage of ['missing', 'ciphertext', 'digest']) {
      const changed = structuredClone(record)
      const original = changed.states[0]!.ownerTier!
      if (damage === 'missing') delete changed.states[0]!.ownerTier
      if (damage === 'ciphertext') original.ciphertext = Buffer.from('truncated ciphertext').toString('base64')
      if (damage === 'digest') original.hash = '00'.repeat(32)
      await primary.savePassport(changed)
      await expect(writer.update({ record: changed, actor: brand(), payload: data() })).rejects.toMatchObject({ code: 'owner-tier-unsound' })
      await expect(writer.retire({ record: changed, actor: brand(), reason: 'recycled' })).rejects.toMatchObject({ code: 'owner-tier-unsound' })
      expect((await primary.getPassport(record.passportId))!.states).toHaveLength(1)
    }
  })

})
