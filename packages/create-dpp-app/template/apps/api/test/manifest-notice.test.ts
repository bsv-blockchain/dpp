import { afterEach, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { DEMONSTRATION_NOTICE, samplePayload } from '../src/profiles.js'

let platform: Platform | undefined
afterEach(async () => { await platform?.close() })
async function writer(prefix: string) {
  const config = loadConfig({ PASSPORT_HOST: 'passport.example', GS1_PREFIX: prefix, NETWORK: 'test', LIVE_PUBLISHING: 'false' })
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  const brand = platform.parties.brand('sample-brand')
  const passportId = mintPassportId({ host: config.passportHost, prefix }, '1'.repeat(12 - prefix.length), 'NOTICE-1')
  return { platform, brand, passportId, issue: (payload: Record<string, unknown>) => platform!.writer.issue({ brandId: 'sample-brand', brand, passportId, profile: 'general@2', payload }) }
}

it.each(['952', '952123'])('writes the demonstration statement first for a passport under prefix %s', async (prefix) => {
  const { platform, brand, issue } = await writer(prefix)
  const fields = samplePayload('general@2', false)
  const genesis = await issue(fields)
  expect(Object.entries(JSON.parse(genesis.state.payloadPublic))[0]).toEqual(['notice', DEMONSTRATION_NOTICE])
  const translated = 'Ce passeport de démonstration ne décrit aucun produit réel.'
  const updated = await platform.writer.update({ actor: brand, record: genesis.record, payload: { ...fields, notice: translated } })
  expect(Object.entries(JSON.parse(updated.state.payloadPublic))[0]).toEqual(['notice', translated])
  expect(Object.hasOwn(fields, 'notice')).toBe(false)
})

it('refuses the demonstration statement on a real-product configuration before signing a state', async () => {
  const { platform, brand, passportId, issue } = await writer('123456')
  await expect(issue(samplePayload('general@2', true))).rejects.toMatchObject({ code: 'demonstration-notice-unexpected' })
  expect(await platform.store.getPassport(passportId)).toBeUndefined()
  const genesis = await issue(samplePayload('general@2', false))
  expect(JSON.parse(genesis.state.payloadPublic)).not.toHaveProperty('notice')
  await expect(platform.writer.update({ record: genesis.record, actor: brand, payload: samplePayload('general@2', true) })).rejects.toMatchObject({ code: 'demonstration-notice-unexpected' })
  expect((await platform.store.getPassport(passportId))?.states).toHaveLength(1)
})
