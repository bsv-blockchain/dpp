// The first run: a whole passport lifecycle with no wallet, no funds, no
// Docker and no network. A test wallet with fixed keys stands in for the
// platform wallet, the index runs in this process with in-memory storage and
// its header checks off, and the records live in memory. Everything else is
// the code the live platform runs: the writer's six steps, the index's real
// admission rules, managed custody, claims, and the reader's report.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyLifecycleClaim } from '@bsv/dpp-core'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { samplePayload } from '../src/profiles.js'
import type { PassportRecord } from '../src/store.js'
import { pendingDuties, runDuties } from '../src/worker.js'
import { WriteRefused } from '../src/writer.js'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
let platform: Platform
const brandId = 'brand-test-1'
const profile = 'general@2' as const
let passportId: string
let payload: Record<string, unknown>

beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  passportId = mintPassportId({ host: config.passportHost, prefix: config.gs1Prefix }, '100000001', `TEST-${Date.now().toString(36).toUpperCase()}`)
  payload = samplePayload(profile, true)
})

afterAll(async () => {
  await platform.close()
})

const latest = async (): Promise<PassportRecord> => {
  const record = await platform.store.getPassport(passportId)
  if (record == null) throw new Error('the passport is not in the journal')
  return record
}

describe('a passport lifecycle under managed custody', () => {
  it('names the platform wallet as a publisher on the index', async () => {
    const keys = await platform.index.publisherKeys()
    expect(keys).toContain(platform.wallet.identityKey)
  })

  it('refuses an identifier outside the configured prefix and host', async () => {
    const brand = platform.parties.brand(brandId)
    await expect(
      platform.writer.issue({ brandId, brand, passportId: 'https://id.gs1.org/01/09506000134352/21/7AC18477503A', profile, payload, ownerFields: {} })
    ).rejects.toBeInstanceOf(WriteRefused)
  })

  it('refuses a payload the profile schema rejects', async () => {
    const brand = platform.parties.brand(brandId)
    await expect(platform.writer.issue({ brandId, brand, passportId, profile, payload: { nonsense: true }, ownerFields: {} })).rejects.toMatchObject({ code: 'payload-invalid' })
    expect(await platform.store.getPassport(passportId)).toBeUndefined()
  })

  it('issues the passport: the genesis is admitted by the index', async () => {
    const brand = platform.parties.brand(brandId)
    const outcome = await platform.writer.issue({ brandId, brand, passportId, profile, payload, ownerFields: { serviceNotes: 'first revision' } })
    expect(outcome.entry.op).toBe('ISSUE')
    expect(outcome.entry.index).toBe('admitted')
    expect(outcome.record.holder.party).toBe(brand.name)
    const held = await platform.index.lineage(passportId)
    expect(held.map((tx) => tx.id('hex'))).toEqual([outcome.entry.txid])
  })

  it('updates the passport, proving control by linkage', async () => {
    const brand = platform.parties.brand(brandId)
    const revised = { ...payload, careNote: 'revised by the UPDATE' }
    const outcome = await platform.writer.update({ record: await latest(), actor: brand, payload: revised, ownerFields: { serviceNotes: 'second revision' } })
    expect(outcome.entry.op).toBe('UPDATE')
    expect(outcome.entry.index).toBe('admitted')
    expect(outcome.state.controlLinkage).toHaveLength(64)
  })

  it('refuses an update by a party that does not control the passport', async () => {
    const stranger = platform.parties.member('someone-else')
    await expect(platform.writer.update({ record: await latest(), actor: stranger, payload, ownerFields: {} })).rejects.toMatchObject({ code: 'not-the-controller' })
  })

  it('runs the unattended duties: proofs are fetched and pushed to the index', async () => {
    expect((await pendingDuties(platform.store)).map((d) => d.duty)).toEqual(['prove', 'prove'])
    await runDuties({ store: platform.store, index: platform.index, writer: platform.writer })
    const record = await latest()
    expect(record.states.every((s) => s.proof != null && s.proofPushed === true)).toBe(true)
    expect(await pendingDuties(platform.store)).toEqual([])
  })

  it('hands the passport on: offer, acceptance by claim code, and a TRANSFER that commits to the record', async () => {
    const brand = platform.parties.brand(brandId)
    const { offer, claimCode } = await platform.custody.offer({ record: await latest(), holder: brand, terms: { word: 'Passed on', note: 'Handed to the distributor' } })
    expect(offer.status).toBe('open')
    expect(claimCode).toMatch(/^[0-9a-f]{16}$/)
    await expect(platform.custody.accept({ requestId: offer.requestId, claimCode: 'wrong' })).rejects.toMatchObject({ code: 'claim-code-wrong' })
    const accepted = await platform.custody.accept({ requestId: offer.requestId, claimCode })
    expect(accepted.offer.status).toBe('transferred')
    expect(accepted.record.custodian).toBe(platform.wallet.identityKey)
    const record = await latest()
    expect(record.states.at(-1)?.op).toBe('TRANSFER')
    expect(record.holder.party).toBe(`recipient:${offer.requestId}`)
    expect(record.acceptanceRecords).toHaveLength(1)
  })

  it('reads the passport back as a stranger would, with the acceptance record supplied', async () => {
    const reading = await platform.read(passportId)
    expect(reading.lineage.map((s) => s.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER'])
    const status = (name: string): string | undefined => reading.checks.find((c) => c.name === name)?.status
    expect(status('recordEncoding')).toBe('pass')
    expect(status('actorSignatures')).toBe('pass')
    expect(status('publisherSignatures')).toBe('pass')
    expect(status('linkage')).toBe('pass')
    expect(status('evidenceAvailability')).toBe('pass')
    expect(status('issuerAuthority')).toBe('pass')
    // Nothing here is mined and no header source was asked.
    expect(status('inclusion')).toBe('unknown')
  })

  it('lets the recipient retire the passport, and nothing follows', async () => {
    const record = await latest()
    const recipient = platform.custody.holderOf(record)
    const outcome = await platform.writer.retire({ record, actor: recipient, reason: 'recycled' })
    expect(outcome.entry.op).toBe('RETIRE')
    expect(outcome.record.status).toBe('retired')
    await expect(platform.writer.update({ record: await latest(), actor: recipient, payload, ownerFields: {} })).rejects.toMatchObject({ code: 'retired' })
  })

  it('signs a lifecycle claim on the other rail, by the recycler, without touching the passport', async () => {
    const recycler = platform.parties.member('recycler-line-3')
    const claim = await platform.claims.sign({ passport: await latest(), issuer: recycler, eventType: 'Disposition' })
    expect(verifyLifecycleClaim(claim.claim).signature).toBe('verified')
    expect(claim.claim.issuer).toBe(recycler.did)
    expect((await platform.store.listClaims({ passportId })).length).toBe(1)
  })
})
