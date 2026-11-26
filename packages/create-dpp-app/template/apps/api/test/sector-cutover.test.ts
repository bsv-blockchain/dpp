import { Transaction, Utils } from '@bsv/sdk'
import { buildLockingScript, completeState, findDppOutputs, ownerBlobHash, ownerKeyFor } from '@bsv/dpp-protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { DEMONSTRATION_NOTICE } from '../src/profiles.js'
import { OWNER_DATA_PROTOCOL } from '../src/writer.js'
import type { PassportRecord } from '../src/store.js'
import { startApp, type TestApp } from './epcis-fixtures.js'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
let app: TestApp

beforeAll(async () => {
  app = await startApp({ config })
  const brand = app.platform.parties.brand('dev-brand')
  await app.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: brand.identityKey, did: brand.did, createdAt: '2026-11-24T00:00:00.000Z' })
})
afterAll(async () => { await app?.close() })

// An earlier issuer uses the historical binding, the ordinary protocol signatures and a local test wallet.
async function historicalJournal(profile: string): Promise<PassportRecord> {
  const { platform } = app
  const bound = platform.profiles.get(profile)!
  const { passportId, product } = (await app.get(`/api/profiles/${profile}`)).body.examples[0]
  const prepared = await platform.profiles.prepare({ profile: bound, product, passportId, notice: DEMONSTRATION_NOTICE })
  if (!prepared.ok) throw new Error(prepared.detail)
  const brandId = 'dev-brand'
  const actor = platform.parties.brand(brandId)
  const controllerKey = await actor.controllerKey(passportId)
  const { ciphertext } = await actor.wallet.encrypt({
    plaintext: Utils.toArray(JSON.stringify(prepared.restrictedProduct ?? {}), 'utf8'), protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self',
  })
  const hash = ownerBlobHash(ciphertext)
  const timestamp = '2026-10-01T00:00:00Z'
  const state = await completeState({
    version: '2', op: 'ISSUE', passportId, timestamp, ownerIdentityKey: controllerKey, actorIdentityKey: actor.identityKey, actorKeyId: actor.name,
    eventData: '', payloadPublic: prepared.payloadPublic, payloadOwnerHash: hash, previousTxid: '', previousOutputIndex: null, lineageGenesis: null,
    controlLinkage: '', authorisationCommitment: '',
  }, actor.wallet, platform.wallet.publisher)
  const lockingScript = buildLockingScript(state, await ownerKeyFor(passportId, platform.wallet.publisher))
  const built = await platform.wallet.adapter.build({ lockingScript, passportId })
  const [output] = findDppOutputs(built.tx)
  if (output == null) throw new Error('The historical transaction has no passport output.')
  return {
    passportId, brandId, profile, createdAt: timestamp, status: 'active', holder: { party: actor.name, controllerKey }, acceptanceRecords: [],
    states: [{
      op: 'ISSUE', txid: built.txid, outputIndex: output.outputIndex, rawTx: built.tx.toHex(), beef: Utils.toBase64(built.beef),
      timestamp, actor: actor.name, controllerKey, payloadPublic: prepared.payloadPublic,
      ownerTier: { hash, ciphertext: Utils.toBase64(ciphertext) }, index: 'admitted', network: 'dry-run',
    }],
  }
}

describe.each(['eu-battery@1', 'eu-textile@1'])('the cutover for %s', (profile) => {
  const successor = profile.replace('@1', '@2')
  let journal: PassportRecord
  beforeAll(async () => { journal = await historicalJournal(profile) })

  it('names the successor and refuses a new historical ISSUE before signing', async () => {
    const catalogue = (await app.get('/api/profiles')).body as Array<{ id: string; issueSuccessor?: string }>
    expect(catalogue.find(entry => entry.id === journal.profile)?.issueSuccessor).toBe(successor)
    expect(catalogue.filter(entry => entry.issueSuccessor == null).map(entry => entry.id)).toContain(successor)
    const response = await app.post('/api/brands/dev-brand/passports', { profile: journal.profile })
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ error: 'profile-superseded', replacedBy: successor })
    await expect(app.platform.writer.issue({ brandId: journal.brandId, brand: app.platform.parties.brand(journal.brandId), passportId: journal.passportId, profile: journal.profile })).rejects.toMatchObject({ code: 'profile-superseded', data: { replacedBy: successor } })
    expect(await app.platform.store.getPassport(journal.passportId)).toBeUndefined()
  })

  it('reads and maintains the original signed ISSUE on its original edition', async () => {
    await app.platform.store.savePassport(journal)
    expect(await app.platform.index.announce(Array.from(Buffer.from(journal.states[0].beef, 'base64')))).toBe('admitted')
    const ref = encodeURIComponent(journal.passportId)
    const reading = await app.get(`/api/verify?passportId=${ref}`)
    expect(reading.status).toBe(200)
    expect(reading.body.product.profile).toBe(journal.profile)
    expect(reading.body.payloadChecks[0].publicView.status).toBe('pass')
    expect((await app.post(`/api/passports/${ref}/authorised-view`, {})).body.authorisedView.status).toBe('pass')
    const example = (await app.get(`/api/profiles/${journal.profile}`)).body.examples[0]
    const response = await app.post(`/api/passports/${ref}/update`, { product: example.product })
    expect(response.status, response.text).toBe(200)
    const updated = (await app.platform.store.getPassport(journal.passportId))!
    expect(updated.states.map(entry => entry.op)).toEqual(['ISSUE', 'UPDATE'])
    expect(updated.profile).toBe(journal.profile)
    expect(updated.states[0].rawTx).toBe(journal.states[0].rawTx)
    const predecessor = findDppOutputs(Transaction.fromHex(updated.states[0].rawTx))[0]!
    expect(predecessor.lockingPublicKey.toString()).toBe(await ownerKeyFor(journal.passportId, app.platform.wallet.publisher))
    expect(predecessor.lockingPublicKey.toString()).not.toBe(predecessor.state.ownerIdentityKey)
    const next = Transaction.fromAtomicBEEF(Utils.toArray(updated.states[1]!.beef, 'base64'))
    const successor = findDppOutputs(next)[0]!
    expect(successor.lockingPublicKey.toString()).toBe(successor.state.ownerIdentityKey)
    expect(await next.verify('scripts only')).toBe(true)
    expect((await app.post(`/api/passports/${ref}/authorised-view`, {})).body.authorisedView.status).toBe('pass')
  })
})
