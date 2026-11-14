// The earlier sector profiles are retired (RETIRED_PROFILE_IDS in
// @bsv/dpp-profiles). This application offers none of them, writes nothing
// under one and reports a record that declares one as not checked, which is
// neither a pass nor a failure. Retirement removes nothing: a passport
// already in the journal under a retired profile stays there, readable, and
// no further state, hand-on or claim is made for it.
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProfileRetiredError, RETIRED_PROFILE_IDS, RETIRED_PROFILE_REPLACEMENTS } from '@bsv/dpp-profiles'
import { sectorFormFor } from '../../web/src/lib/bound/forms'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { currentProfiles, isProfileId, manifestFor, samplePayload, sampleWithProblems, validatePayload } from '../src/profiles.js'
import { createServer } from '../src/server.js'
import type { PassportRecord } from '../src/store.js'
import { WriteRefused } from '../src/writer.js'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const policy = { host: config.passportHost, prefix: config.gs1Prefix }
const brandId = 'dev-brand'
const RETIRED: readonly string[] = RETIRED_PROFILE_IDS
const parts = (profile: string): { id: string; version: number } => ({ id: profile.split('@')[0]!, version: Number(profile.split('@')[1]) })
let platform: Platform
let server: Server
let base: string

beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  const party = platform.parties.brand(brandId)
  await platform.store.saveBrand({ id: brandId, name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: new Date().toISOString() })
  const app = createServer({ platform, devSession: { userId: 'developer', email: 'developer@localhost', name: 'Developer', brandIds: [brandId] } })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.close()
  await platform.close()
})

const get = async (path: string): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`)
  return { status: response.status, body: await response.json() }
}
const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const refusal = async (attempt: Promise<unknown>): Promise<WriteRefused> => {
  try {
    await attempt
  } catch (cause) {
    if (cause instanceof WriteRefused) return cause
    throw cause
  }
  throw new Error('the write was not refused')
}

/** A passport as an earlier release of this application left it in the journal: one state, under a retired profile. */
async function storedUnder(profile: string, serial: string): Promise<PassportRecord> {
  const passportId = mintPassportId(policy, '100000042', serial)
  const brand = platform.parties.brand(brandId)
  const { id, version } = parts(profile)
  const record: PassportRecord = {
    passportId,
    brandId,
    profile,
    createdAt: '2026-10-01T00:00:00Z',
    status: 'active',
    holder: { party: brand.name, controllerKey: await brand.controllerKey(passportId) },
    states: [
      {
        op: 'ISSUE',
        txid: 'ab'.repeat(32),
        outputIndex: 0,
        rawTx: '',
        beef: '',
        timestamp: '2026-10-01T00:00:00Z',
        actor: brand.name,
        controllerKey: await brand.controllerKey(passportId),
        payloadPublic: JSON.stringify({ profile: id, profile_version: version, name: 'An earlier demonstration record' }),
        ownerTier: { hash: '00'.repeat(32), ciphertext: '' },
        index: 'admitted',
        network: 'accepted',
      },
    ],
    acceptanceRecords: [],
  }
  await platform.store.savePassport(record)
  return record
}

describe('no retired profile is offered', () => {
  it('lists none: not among the manifest profiles, not over HTTP, and not as a form', async () => {
    expect(currentProfiles().map((p) => p.id)).toEqual(['general@2'])
    const listed = ((await get('/api/profiles')).body as Array<{ id: string; format: string }>).map((p) => p.id)
    expect(listed).toEqual(['general@2', 'eu-battery@1', 'eu-textile@1'])
    for (const profile of RETIRED) {
      expect(listed, profile).not.toContain(profile)
      expect(isProfileId(profile), profile).toBe(false)
      expect(sectorFormFor(profile), profile).toBeUndefined()
      expect(platform.profiles.get(profile), profile).toBeUndefined()
    }
    // What replaces them is offered, each with its form.
    for (const replacement of new Set(Object.values(RETIRED_PROFILE_REPLACEMENTS))) {
      expect(listed).toContain(replacement)
      expect(sectorFormFor(replacement)?.profile).toBe(replacement)
    }
  })

  it.each(RETIRED)('%s: the profile route answers 410 with profile-retired and serves no schema, field or sample', async (profile) => {
    const { status, body } = await get(`/api/profiles/${encodeURIComponent(profile)}`)
    expect(status).toBe(410)
    expect(body.error).toBe('profile-retired')
    expect(body.description).toContain(`${RETIRED_PROFILE_REPLACEMENTS[profile as keyof typeof RETIRED_PROFILE_REPLACEMENTS]} replaces it`)
    expect(Object.keys(body).sort()).toEqual(['description', 'error'])
    expect((await get(`/api/profiles/${encodeURIComponent(profile)}/codes?class=x:Y`)).status).toBe(404)
  })

  it.each(RETIRED)('%s: no sample is started and no payload is checked', (profile) => {
    const retired = profile as never
    for (const act of [() => samplePayload(retired, true), () => sampleWithProblems(retired, false), () => validatePayload(retired, 'public', {}), () => validatePayload(retired, 'restricted', {}), () => manifestFor(retired)]) {
      expect(act).toThrow(ProfileRetiredError)
    }
  })
})

describe('nothing is written under a retired profile', () => {
  it.each(RETIRED)('%s: the writer refuses to issue, with a payload or with a product document, and journals nothing', async (profile) => {
    const brand = platform.parties.brand(brandId)
    const passportId = mintPassportId(policy, '100000041', `NEW-${profile.replace('@', '-')}`)
    for (const data of [{ payload: { profile: parts(profile).id, profile_version: parts(profile).version }, ownerFields: {} }, { product: { id: passportId } }, {}]) {
      const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile, ...data }))
      expect(refused.code).toBe('profile-retired')
      expect(refused.message).toContain('Nothing was signed')
      expect(refused.data).toEqual({ replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile as keyof typeof RETIRED_PROFILE_REPLACEMENTS] })
    }
    expect(await platform.store.getPassport(passportId)).toBeUndefined()
    expect(await platform.index.lineage(passportId).catch(() => [])).toEqual([])
  })

  it.each(RETIRED)('%s: the issue route answers 409 with profile-retired', async (profile) => {
    const { status, body } = await post(`/api/brands/${brandId}/passports`, { profile, itemReference: '100000043', serial: `HTTP-${profile.replace('@', '-')}`, payload: {}, ownerFields: {} })
    expect(status).toBe(409)
    expect(body.error).toBe('profile-retired')
    expect((await platform.store.listPassports({ brandId })).every((p) => !p.passportId.includes('/21/HTTP-'))).toBe(true)
  })

  it.each(RETIRED)('%s: a passport already journalled gets no further state, hand-on or claim, and stays as it was', async (profile) => {
    const record = await storedUnder(profile, `OLD-${profile.replace('@', '-')}`)
    const before = JSON.stringify(await platform.store.getPassport(record.passportId))
    const brand = platform.parties.brand(brandId)
    const writes = [
      platform.writer.update({ record, actor: brand, payload: { profile: parts(profile).id, profile_version: parts(profile).version } }),
      platform.writer.update({ record, actor: brand, product: { id: record.passportId } }),
      platform.writer.transfer({ record, holder: brand, recipient: platform.parties.recipient('offer-none'), acceptance: {} as never }),
      platform.writer.retire({ record, actor: brand, reason: 'end of the demonstration' }),
      platform.custody.offer({ record, holder: brand, terms: { word: 'Handed on' } }),
      platform.claims.sign({ passport: record, issuer: platform.parties.member('developer'), eventType: 'Disposition' }),
    ]
    for (const write of writes) expect((await refusal(write)).code).toBe('profile-retired')
    expect(JSON.stringify(await platform.store.getPassport(record.passportId))).toBe(before)
    expect(await platform.store.listOffers({ passportId: record.passportId })).toEqual([])
    expect(await platform.store.listClaims({ passportId: record.passportId })).toEqual([])

    // Over HTTP the journal view is still served, and each write route refuses.
    const ref = encodeURIComponent(record.passportId)
    expect((await get(`/api/passports/${ref}`)).body).toMatchObject({ passportId: record.passportId, profile, status: 'active', profileRetired: { replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile as keyof typeof RETIRED_PROFILE_REPLACEMENTS] } })
    for (const [path, body] of [['update', { payload: {} }], ['retire', { reason: 'x' }], ['offer', {}], ['claims', { eventType: 'Disposition' }]] as const) {
      const answer = await post(`/api/passports/${ref}/${path}`, body)
      expect([answer.status, answer.body.error], path).toEqual([409, 'profile-retired'])
    }
  })
})

describe('a record that declares a retired profile is reported as not checked', () => {
  it.each(RETIRED)('%s: the public view is unknown with profile-retired, whatever the payload holds', async (profile) => {
    const { id, version } = parts(profile)
    const passportId = mintPassportId(policy, '100000044', 'READ-0001')
    for (const payloadPublic of [JSON.stringify({ profile: id, profile_version: version }), '{not json', JSON.stringify({ profile: id, profile_version: version, profile_binding_sha256: '0'.repeat(64), product: { id: passportId } })]) {
      const validation = await platform.profiles.validatePublic({ profile: id, profileVersion: version, payloadPublic, passportId })
      expect(validation).toEqual({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { profile, cause: 'profile-retired', replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile as keyof typeof RETIRED_PROFILE_REPLACEMENTS], steps: [] } })
      const view = await platform.profiles.viewCheck('public', validation)
      expect(view).toMatchObject({ view: 'public', status: 'not-checked', cause: 'profile-retired', steps: [], findings: [], withheld: [] })
      expect(view.summary).toContain('retired profile')
      expect(view.summary).toContain(`${RETIRED_PROFILE_REPLACEMENTS[profile as keyof typeof RETIRED_PROFILE_REPLACEMENTS]} replaces it`)
      expect(view.summary).toContain('not a pass')
      const authorised = await platform.profiles.validateAuthorised({ profile: id, profileVersion: version, payloadPublic, passportId, restrictedProduct: {} })
      expect(authorised).toEqual(validation)
    }
  })
})

describe('what retirement leaves alone', () => {
  it('general@2 is offered, sampled, checked and issued as before', async () => {
    const sample = samplePayload('general@2', true)
    expect(validatePayload('general@2', 'public', sample)).toEqual({ valid: true, problems: [] })
    expect((await get('/api/profiles/general%402')).body).toMatchObject({ id: 'general@2', format: 'manifest' })
    const { status, body } = await post(`/api/brands/${brandId}/passports`, { profile: 'general@2', itemReference: '100000045', serial: 'GEN-0001', payload: sample, ownerFields: {} })
    expect(status).toBe(200)
    expect(body).toMatchObject({ profile: 'general@2', status: 'active' })
    expect(body).not.toHaveProperty('profileRetired')
    const reading = await platform.read(body.passportId)
    expect(reading.payloadChecks.map((c) => [c.profile, c.publicView.status])).toEqual([['general@2', 'pass']])
  })

  it('an identifier nobody published is still unknown, with its own code', async () => {
    expect((await get('/api/profiles/toaster%409')).status).toBe(404)
    const { status, body } = await post(`/api/brands/${brandId}/passports`, { profile: 'toaster@9', itemReference: '100000046', serial: 'T-1', payload: {} })
    expect([status, body.error]).toEqual([400, 'profile-unknown'])
  })
})
