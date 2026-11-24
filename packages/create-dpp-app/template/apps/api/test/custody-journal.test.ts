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
