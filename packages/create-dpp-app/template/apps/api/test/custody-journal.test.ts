import { PushDrop, Spend, Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import { findDppOutputs, OWNER_PROTOCOL_ID } from '@bsv/dpp-protocol'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { Custody } from '../src/custody.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { samplePayload } from '../src/profiles.js'
import { MongoStore } from '../src/store.js'
import { developer, startApp, startMongo } from './epcis-fixtures.js'

const config = loadConfig({ PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
let platform: Platform

afterEach(async () => { await platform?.close() })

async function offered(mechanism: 'claim-code' | 'named-recipient') {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  const brand = platform.parties.brand('sample-brand')
  const passportId = mintPassportId({ host: config.passportHost, prefix: config.gs1Prefix }, '100000001', 'OFFER-1')
  await platform.writer.issue({ brandId: 'sample-brand', brand, passportId, profile: 'general@2', payload: samplePayload('general@2', true) })
  const passport = (await platform.store.getPassport(passportId))!
  const recipient = mechanism === 'named-recipient' ? platform.parties.member('sample-member') : undefined
  const recipientIdentityKey = recipient?.identityKey
  const issued = await platform.custody.offer({ record: passport, holder: brand, terms: { word: 'Handed on' }, mechanism, recipientIdentityKey })
  return { requestId: issued.offer.requestId, claimCode: issued.claimCode, recipient, passportId }
}

describe('completion of a journalled custody transfer', () => {
  it('allows one concurrent open offer per passport in memory and MongoDB and releases the place on withdrawal', async () => {
    const original = await offered('claim-code')
    const passport = (await platform.store.getPassport(original.passportId))!
    const holder = platform.parties.brand('sample-brand')
    await platform.custody.withdraw(original.requestId, holder)
    const mongo = await startMongo()
    try {
      const database = mongo.database()
      const store = new MongoStore(database)
      const otherStore = new MongoStore(database)
      await store.init()
      await store.savePassport(passport)
      for (const [left, right] of [[platform.store, platform.store], [store, otherStore]]) {
        const service = (storage: typeof platform.store) => new Custody({ store: storage, wallet: platform.wallet, parties: platform.parties, writer: platform.writer })
        const args = { record: passport, holder, terms: {} }
        const attempts = await Promise.allSettled([service(left).offer(args), service(right).offer(args)])
        expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
        expect(attempts.find(attempt => attempt.status === 'rejected')).toMatchObject({ reason: { code: 'offer-open' } })
        const open = await left.listOffers({ passportId: original.passportId, status: 'open' })
        expect(open).toHaveLength(1)
        await service(right).withdraw(open[0].requestId, holder)
        expect((await service(left).offer(args)).offer.status).toBe('open')
      }
    } finally {
      await mongo.stop()
    }
  })

  it('returns the same journalled transaction for concurrent calls on a newly opened offer', async () => {
    const args = await offered('claim-code')
    const [first, second] = await Promise.all([platform.custody.accept(args), platform.custody.accept(args)])
    expect(second).toEqual(first)
    expect((await platform.store.getPassport(args.passportId))!.acceptanceRecords).toEqual([first.record])
    expect((await platform.store.getPassport(args.passportId))!.states.map(entry => entry.op)).toEqual(['ISSUE', 'TRANSFER'])
  })

  it('keeps one transfer across two custody services sharing the store', async () => {
    const args = await offered('claim-code')
    const second = new Custody({ store: platform.store, wallet: platform.wallet, parties: platform.parties, writer: platform.writer })
    const attempts = await Promise.allSettled([platform.custody.accept(args), second.accept(args)])
    expect(attempts.some(attempt => attempt.status === 'fulfilled')).toBe(true)
    for (const attempt of attempts) if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ code: 'operation-interrupted' })
    const completed = await second.accept(args)
    expect(await platform.custody.accept(args)).toEqual(completed)
    expect((await platform.store.getPassport(args.passportId))!.states.map(entry => entry.op)).toEqual(['ISSUE', 'TRANSFER'])
  })

  it('reconciles a completed journal write after the transfer caller loses its response', async () => {
    const args = await offered('claim-code')
    const transfer = platform.writer.transfer.bind(platform.writer)
    const write = vi.spyOn(platform.writer, 'transfer').mockImplementationOnce(async input => {
      await transfer(input)
      throw new Error('connection closed after storing the transfer')
    })
    const accepted = await platform.custody.accept(args)
    expect(accepted.transferTxid).toBe((await platform.store.getPassport(args.passportId))!.states[1].txid)
    expect((await platform.store.getOffer(args.requestId))?.status).toBe('transferred')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps a retained transfer pending until its send has a successful answer and refuses mismatched transfer bytes', async () => {
    const args = await offered('claim-code')
    const completed = await platform.custody.accept(args)
    await platform.store.saveOffer({ ...completed.offer, status: 'accepted', transferTxid: undefined })
    const passport = (await platform.store.getPassport(args.passportId))!
    const transfer = passport.states[1]
    transfer.network = 'unanswered'
    await platform.store.savePassport(passport)
    await expect(platform.custody.accept(args)).rejects.toMatchObject({ code: 'operation-interrupted' })
    expect((await platform.store.getOffer(args.requestId))?.status).toBe('accepted')
    transfer.network = 'dry-run'
    transfer.rawTx = passport.states[0].rawTx
    await platform.store.savePassport(passport)
    await expect(platform.custody.accept(args)).rejects.toMatchObject({ code: 'acceptance-mismatch' })
    expect((await platform.store.getOffer(args.requestId))?.status).toBe('accepted')
  })

  it('returns the retained offer to concurrent creators and after a lost response in memory and MongoDB', async () => {
    const original = await offered('claim-code')
    const record = (await platform.store.getPassport(original.passportId))!
    const holder = platform.parties.brand('sample-brand')
    await platform.custody.withdraw(original.requestId, holder)
    const mongo = await startMongo()
    try {
      const database = mongo.database()
      const store = new MongoStore(database)
      await store.init()
      await store.savePassport(record)
      for (const [left, right] of [[platform.store, platform.store], [store, new MongoStore(database)]]) {
        const service = (storage: typeof platform.store) => new Custody({ store: storage, wallet: platform.wallet, parties: platform.parties, writer: platform.writer })
        const args = { requestId: 'warehouse:handover-1', record, holder, terms: { word: 'Sold', note: 'In person' } }
        const results = await Promise.all([service(left).offer(args), service(right).offer(args)])
        expect(results.map(result => result.offer.requestId)).toEqual([args.requestId, args.requestId])
        expect(results.filter(result => result.claimCode)).toHaveLength(1)
        const first = results.find(result => result.claimCode)!
        const replay = await service(right).offer({ ...args, terms: { note: 'In person', word: 'Sold' } })
        expect(replay).toEqual({ offer: first.offer })
        expect(await left.listOffers({ passportId: record.passportId, status: 'open' })).toHaveLength(1)
        await expect(service(left).offer({ ...args, terms: { word: 'Gift' } })).rejects.toMatchObject({ code: 'offer-request-conflict' })
        await expect(service(left).offer({ ...args, mechanism: 'named-recipient', recipientIdentityKey: holder.identityKey })).rejects.toMatchObject({ code: 'offer-request-conflict' })
        await expect(service(left).offer({ ...args, requestId: 'new-request' })).rejects.toMatchObject({ code: 'offer-open' })
        await service(left).withdraw(args.requestId, holder)
        expect((await service(right).offer(args)).offer.status).toBe('withdrawn')
        expect(await left.listOffers({ passportId: record.passportId, status: 'open' })).toHaveLength(0)
      }
    } finally {
      await mongo.stop()
    }
  })

  it.each(['transferred before reservation', 'unanswered before reservation', 'transferred after insertion'] as const)('returns the retained status when a matching creation overlaps a transfer: %s', async timing => {
    const original = await offered('claim-code')
    const record = (await platform.store.getPassport(original.passportId))!
    const holder = platform.parties.brand('sample-brand')
    await platform.custody.withdraw(original.requestId, holder)
    const peer = new Custody({ store: platform.store, wallet: platform.wallet, parties: platform.parties, writer: platform.writer })
    const requestId = 'overlapping-handover'
    const args = { requestId, record, holder, terms: { word: 'Handed on' } }
    const recipient = platform.parties.member('sample-member')
    const input = timing === 'transferred after insertion'
      ? { ...args, mechanism: 'named-recipient' as const, recipientIdentityKey: recipient.identityKey }
      : args
    if (timing === 'transferred after insertion') {
      const insert = platform.store.createOpenOffer.bind(platform.store)
      vi.spyOn(platform.store, 'createOpenOffer').mockImplementationOnce(async offer => {
        const inserted = await insert(offer)
        expect(inserted).toBe(true)
        expect(await peer.offer(input)).toEqual({ offer })
        await peer.accept({ requestId, recipient })
        return inserted
      })
    } else {
      const get = platform.store.getOffer.bind(platform.store)
      vi.spyOn(platform.store, 'getOffer').mockImplementationOnce(async id => {
        const initial = await get(id)
        expect(initial).toBeUndefined()
        const winner = await peer.offer(input)
        expect(winner.claimCode).toBeTruthy()
        const acceptance = { requestId, claimCode: winner.claimCode }
        if (timing === 'unanswered before reservation') {
          vi.spyOn(platform.wallet.adapter, 'send').mockResolvedValueOnce('unanswered')
          await expect(peer.accept(acceptance)).rejects.toMatchObject({ code: 'network-unanswered' })
        } else {
          await peer.accept(acceptance)
        }
        return initial
      })
    }
    const result = await platform.custody.offer(input)
    expect(result.offer.status).toBe(timing === 'unanswered before reservation' ? 'accepted' : 'transferred')
    expect(result).toEqual(await peer.offer(input))
    expect(result).not.toHaveProperty('claimCode')
    expect(result.offer).not.toHaveProperty('record')
    expect(result.offer).not.toHaveProperty('transferTxid')
    await expect(peer.offer({ ...input, terms: { word: 'Repaired' } })).rejects.toMatchObject({ code: 'offer-request-conflict' })
    await expect(peer.offer({ ...input, requestId: 'different-handover' })).rejects.toMatchObject({
      code: timing === 'unanswered before reservation' ? 'operation-interrupted' : 'tip-moved',
    })
    expect(await platform.store.getOffer('different-handover')).toBeUndefined()
    expect((await platform.store.getPassport(record.passportId))?.states.map(state => state.op)).toEqual(['ISSUE', 'TRANSFER'])
  })

  it('replays through the holder API after transfer without returning its code or signed acceptance', async () => {
    const api = await startApp({ config, mode: 'test' })
    try {
      const brand = api.platform.parties.brand('dev-brand')
      const { passportId, product } = (await api.get('/api/profiles/eu-battery@2')).body.examples[0]
      await api.platform.writer.issue({ brandId: 'dev-brand', brand, passportId, profile: 'eu-battery@2', product })
      const path = `/api/passports/${encodeURIComponent(passportId)}/offer`
      const body = { requestId: 'batch:order:123', terms: { word: 'Sold' }, recipientIdentityKey: null }
      for (const invalid of ['', '.', '..', 4, null, 'é'.repeat(65), 'field\nseparator']) {
        const result = await api.post(path, { ...body, requestId: invalid })
        expect(result.body.error).toBe('offer-request-id-invalid')
      }
      for (const key of [false, ['invalid'], '', 'invalid']) {
        const result = await api.post(path, { ...body, mechanism: 'named-recipient', recipientIdentityKey: key })
        expect(result.body.error).toBe('recipient-invalid')
      }
      const created = await api.post(path, body)
      expect(created.body.offer.requestId).toBe(body.requestId)
      const replay = await api.post(path, body)
      expect(replay.body).toEqual({ offer: created.body.offer })
      const code = created.body.claimCode
      expect((await api.post(`/api/offers/${encodeURIComponent(body.requestId)}/accept`, { claimCode: code })).status).toBe(200)
      const afterTransfer = await api.post(path, body)
      expect(afterTransfer.body).toEqual({ offer: { ...created.body.offer, status: 'transferred' } })
      expect((await api.post(path, { ...body, requestId: 'next-offer' })).status).toBe(403)
      const next = await api.post(path, { ...body, requestId: 'next-offer', claimCode: code })
      expect(next.status).toBe(200)
      expect((await api.post(path, { ...body, requestId: 'next-offer', claimCode: 'incorrect' })).status).toBe(403)
      const peer = api.platform.parties.member(developer.userId)
      const withdraw = await api.post('/api/offers/next-offer/withdraw', { claimCode: code })
      expect(withdraw.status).toBe(200)
      const named = { terms: { word: 'Gift' }, requestId: 'é'.repeat(64), mechanism: 'named-recipient', recipientIdentityKey: peer.identityKey, claimCode: code }
      const namedOffer = await api.post(path, named)
      expect(namedOffer.status).toBe(200)
      expect(namedOffer.body.claimCode).toBeUndefined()
      expect((await api.post(path, named)).body).toEqual(namedOffer.body)
      expect((await api.post(path, { ...named, recipientIdentityKey: brand.identityKey })).body.error).toBe('offer-request-conflict')
      const anotherPassport = mintPassportId({ host: config.passportHost, prefix: config.gs1Prefix }, '100000002', 'OFFER-2')
      await api.platform.writer.issue({ brandId: 'dev-brand', brand, passportId: anotherPassport, profile: 'general@2', payload: samplePayload('general@2', true) })
      const conflict = await api.post(`/api/passports/${encodeURIComponent(anotherPassport)}/offer`, body)
      expect(conflict.body.error).toBe('offer-request-conflict')
      expect(await api.platform.store.listOffers({ passportId: anotherPassport })).toHaveLength(0)
    } finally {
      await api.close()
    }
  })

  it.each(['declined', 'expired', 'moved-tip'] as const)('preserves the original offer after %s and writes no transfer', async scenario => {
    const args = await offered('claim-code')
    const holder = platform.parties.brand('sample-brand')
    const original = (await platform.store.getOffer(args.requestId))!
    if (scenario === 'declined') await platform.custody.decline(args.requestId, args.claimCode)
    if (scenario === 'moved-tip') {
      const record = (await platform.store.getPassport(args.passportId))!
      await platform.writer.update({ record, actor: holder, payload: samplePayload('general@2', true) })
    }
    if (scenario === 'expired') {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(original.expiresAt))
    }
    try {
      const transfer = vi.spyOn(platform.writer, 'transfer')
      const expectedCode = { declined: 'offer-closed', expired: 'offer-expired', 'moved-tip': 'tip-moved' }[scenario]
      await expect(platform.custody.accept(args)).rejects.toMatchObject({ code: expectedCode })
      const record = (await platform.store.getPassport(args.passportId))!
      const replay = await platform.custody.offer({ record, holder, requestId: args.requestId, terms: original.terms })
      expect(replay).toEqual({ offer: { ...original, status: scenario === 'moved-tip' ? 'open' : scenario } })
      expect(await platform.store.listOffers({ passportId: record.passportId })).toHaveLength(1)
      expect(record.acceptanceRecords).toHaveLength(0)
      expect(transfer).not.toHaveBeenCalled()
    } finally {
      if (scenario === 'expired') vi.useRealTimers()
    }
  })

  it('locks to the signed controller and accepts only that controller’s spend after handover', async () => {
    const offer = await offered('claim-code')
    const { record: acceptance } = await platform.custody.accept(offer)
    const transferred = (await platform.store.getPassport(offer.passportId))!
    const recipient = platform.custody.holderOf(transferred)
    const { record } = await platform.writer.update({ record: transferred, actor: recipient, payload: samplePayload('general@2', true) })
    const states = record.states.map(entry => Transaction.fromAtomicBEEF(Utils.toArray(entry.beef, 'base64')))
    const outputs = states.map(tx => findDppOutputs(tx)[0]!)
    for (const output of outputs) expect(output.lockingPublicKey.toString()).toBe(output.state.ownerIdentityKey)
    expect(outputs[1]!.lockingPublicKey.toString()).toBe(acceptance.acceptance.destinationKey)
    function spendAt(index: number, unlockingScript = states[index]!.inputs[0]!.unlockingScript!) {
      const tx = states[index]!
      const prev = states[index - 1]!
      const input = tx.inputs[0]!
      expect(input.sourceTXID ?? input.sourceTransaction?.id('hex')).toBe(prev.id('hex'))
      const source = prev.outputs[input.sourceOutputIndex]!
      return new Spend({
        sourceTXID: prev.id('hex'), sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: source.satoshis!,
        lockingScript: source.lockingScript, transactionVersion: tx.version, otherInputs: tx.inputs.slice(1),
        unlockingScript, inputSequence: input.sequence!, inputIndex: 0, outputs: tx.outputs, lockTime: tx.lockTime,
      }).validate()
    }
    expect(spendAt(1)).toBe(true)
    expect(spendAt(2)).toBe(true)
    // The previous holder and the funding wallet cannot authorise the new holder's input.
    for (const wallet of [platform.parties.brand('sample-brand').wallet, platform.wallet.publisher]) {
      const wrong = await new PushDrop(wallet as WalletInterface).unlock(OWNER_PROTOCOL_ID, offer.passportId, 'self').sign(states[2]!, 0)
      expect(() => spendAt(2, wrong)).toThrow()
    }
  })

  it('reserves the predecessor during transfer and lets the new holder offer after a delayed creator', async () => {
    const first = await offered('claim-code')
    const record = (await platform.store.getPassport(first.passportId))!
    const oldHolder = platform.parties.brand('sample-brand')
    const oldOffer = (await platform.store.getOffer(first.requestId))!
    const delayed = { requestId: 'delayed', record, holder: oldHolder, terms: {} }
    let entered!: () => void
    let release!: () => void
    const signingDone = new Promise<void>(resolve => { entered = resolve })
    const resume = new Promise<void>(resolve => { release = resolve })
    const transfer = platform.writer.transfer.bind(platform.writer)
    vi.spyOn(platform.writer, 'transfer').mockImplementationOnce(async args => {
      entered()
      await resume
      return await transfer(args)
    })
    const accepting = platform.custody.accept(first)
    try {
      await signingDone
      await expect(platform.custody.offer(delayed)).rejects.toMatchObject({ code: 'offer-open' })
    } finally {
      release()
      await accepting
    }
    await expect(platform.custody.offer(delayed)).rejects.toMatchObject({ code: 'tip-moved' })
    // A prior release or a process interrupted after insertion can have left an open offer at the spent predecessor.
    await platform.store.saveOffer({ ...oldOffer, requestId: 'abandoned-draft', status: 'open' })
    const current = (await platform.store.getPassport(first.passportId))!
    const next = await platform.custody.offer({ record: current, holder: platform.custody.holderOf(current), requestId: 'next-holder', terms: {} })
    expect(next.offer.expectedPredecessor.txid).toBe(current.states[1].txid)
    expect((await platform.store.getOffer('abandoned-draft'))?.status).toBe('withdrawn')
  })

  it('keeps an accepted predecessor reserved across two MongoDB clients while the successor is offered', async () => {
    const first = await offered('claim-code')
    const original = (await platform.store.getOffer(first.requestId))!
    const completed = await platform.custody.accept(first)
    const passport = (await platform.store.getPassport(first.passportId))!
    const successor = await platform.custody.offer({ record: passport, holder: platform.custody.holderOf(passport), terms: {} })
    const accepted = { ...original, status: 'accepted' as const, record: completed.record }
    const delayed = { ...original, requestId: 'delayed-creation' }
    const mongo = await MongoMemoryServer.create()
    const left = new MongoClient(mongo.getUri())
    const right = new MongoClient(mongo.getUri())
    try {
      const primary = new MongoStore(left.db('custody'))
      const peer = new MongoStore(right.db('custody'))
      await primary.init()
      expect(await primary.createOpenOffer(original)).toBe(true)
      expect(await Promise.all([primary.changeOfferStatus(accepted, 'open'), peer.createOpenOffer(delayed)])).toEqual([true, false])
      expect(await peer.createOpenOffer(delayed)).toBe(false)
      expect(await peer.changeOfferStatus({ ...original, status: 'withdrawn' }, 'open')).toBe(false)
      expect(await peer.getOffer(delayed.requestId)).toBeUndefined()
      // The writer has advanced the tip, but the first custodian has yet to record its transfer acknowledgement.
      expect(await peer.createOpenOffer(successor.offer)).toBe(true)
      expect(await primary.changeOfferStatus(completed.offer, 'accepted')).toBe(true)
      expect(await peer.getOffer(first.requestId)).toMatchObject({ status: 'transferred', transferTxid: completed.transferTxid })
      expect(await primary.getOffer(successor.offer.requestId)).toMatchObject({ status: 'open', expectedPredecessor: successor.offer.expectedPredecessor })
    } finally {
      await Promise.all([left.close(), right.close()])
      await mongo.stop()
    }
  })

  it('does not replace an offer based on an unsettled journal tip', async () => {
    const original = await offered('claim-code')
    const record = (await platform.store.getPassport(original.passportId))!
    const heldOffer = (await platform.store.getOffer(original.requestId))!
    const holder = platform.parties.brand('sample-brand')
    const update = await platform.writer.update({ record, actor: holder, payload: samplePayload('general@2', true) })
    const pending = update.record
    pending.states[1].network = 'unanswered'
    await platform.store.savePassport(pending)
    await expect(platform.custody.offer({ record: pending, holder, terms: {}, requestId: 'other-offer' }))
      .rejects.toMatchObject({ code: 'operation-interrupted' })
    expect(await platform.store.getOffer(original.requestId)).toEqual(heldOffer)
    expect(await platform.store.getOffer('other-offer')).toBeUndefined()
  })

  it('uses the authenticated member for a named offer through the API', async () => {
    const api = await startApp({ config, mode: 'test' })
    try {
      const brand = api.platform.parties.brand('dev-brand')
      const { passportId, product } = (await api.get('/api/profiles/eu-battery@2')).body.examples[0]
      await api.platform.writer.issue({ brandId: 'dev-brand', brand, passportId, profile: 'eu-battery@2', product })
      const record = (await api.platform.store.getPassport(passportId))!
      const member = api.platform.parties.member(developer.userId)
      const { offer } = await api.platform.custody.offer({ record, holder: brand, terms: {}, mechanism: 'named-recipient', recipientIdentityKey: member.identityKey })
      const path = `/api/offers/${offer.requestId}/accept`
      const accepted = await api.post(path, {})
      expect(accepted.status).toBe(200)
      expect(accepted.body.record.acceptance.recipientIdentityKey).toBe(member.identityKey)
      expect((await api.post(path, {})).body.transferTxid).toBe(accepted.body.transferTxid)
      expect((await api.platform.store.getPassport(passportId))?.holder.party).toBe(member.name)
      expect((await api.post(`/api/passports/${encodeURIComponent(passportId)}/authorised-view`, {})).status).toBe(200)
    } finally {
      await api.close()
    }
  })

  it.each(['claim-code', 'named-recipient'] as const)('completes an accepted %s offer after its transfer was journalled and checks the recipient on each retry', async (mechanism) => {
    const args = await offered(mechanism)
    const completed = await platform.custody.accept(args)
    await platform.store.saveOffer({ ...completed.offer, status: 'accepted', transferTxid: undefined })
    const wrong = mechanism === 'claim-code' ? { ...args, claimCode: 'not-this-offer' } : { ...args, recipient: platform.parties.member('different-member') }
    const code = mechanism === 'claim-code' ? 'claim-code-wrong' : 'recipient-wrong'
    await expect(platform.custody.accept(wrong)).rejects.toMatchObject({ code })
    expect((await platform.store.getOffer(args.requestId))?.status).toBe('accepted')
    const [first, second] = await Promise.all([platform.custody.accept(args), platform.custody.accept(args)])
    expect(first).toEqual(completed)
    expect(second).toEqual(completed)
    expect(await platform.custody.accept(args)).toEqual(completed)
    await expect(platform.custody.accept(wrong)).rejects.toMatchObject({ code })
    expect((await platform.store.getPassport(args.passportId))!.states.map(entry => entry.op)).toEqual(['ISSUE', 'TRANSFER'])
  })
})
