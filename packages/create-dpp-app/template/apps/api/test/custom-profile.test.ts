// A profile of your own, held by a binding in a folder: the configuration
// names the folder and the digest of the binding this deployment reviewed,
// and the profile is registered at start-up without a line of source
// changing. The folders under test/fixtures/custom-profile are the two
// example profiles of the DPP repository, example-bottle@1 and
// example-notebook@1, with the vectors that say what each accepts.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { profileBindingDigest } from '@bsv/dpp-profiles'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { samplePayload } from '../src/profiles.js'

type Json = Record<string, unknown>

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'custom-profile')
const bottle = join(fixtures, 'example-bottle@1')
const notebook = join(fixtures, 'example-notebook@1')
const digestOf = (folder: string): string => profileBindingDigest(new Uint8Array(readFileSync(join(folder, 'binding.json'))))
const vector = (folder: string, name: string): { passportId: string; payload: { product: Json } } => JSON.parse(readFileSync(join(folder, 'vectors', name), 'utf8'))

const scratch = mkdtempSync(join(tmpdir(), 'dpp-custom-profile-'))
const opened: Platform[] = []
const brandId = 'brand-custom-1'

/** A platform with these settings, and every line it logged while starting. */
async function start(settings: Record<string, string>): Promise<{ platform: Platform; lines: string[] }> {
  const lines: string[] = []
  const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false', ...settings })
  const platform = await openPlatform({ config, mode: 'test', log: (line) => lines.push(line) })
  opened.push(platform)
  return { platform, lines }
}

afterAll(async () => {
  for (const platform of opened) await platform.close()
  rmSync(scratch, { recursive: true, force: true })
})

describe('a custom profile from a folder', () => {
  it('is registered when its digest is trusted, and writes and reads end to end', async () => {
    const { platform, lines } = await start({ CUSTOM_PROFILE_DIRS: `${bottle}, ${notebook}`, TRUSTED_BINDING_DIGESTS: `${digestOf(bottle)},${digestOf(notebook)}` })
    expect(platform.profiles.refusals).toEqual([])
    expect(platform.profiles.list().map((p) => p.profile)).toEqual(['eu-battery@1', 'eu-textile@1', 'example-bottle@1', 'example-notebook@1'])
    expect(lines.some((line) => line.includes('example-bottle@1 registered from') && line.includes(digestOf(bottle)))).toBe(true)

    const policy = { host: platform.config.passportHost, prefix: platform.config.gs1Prefix }
    const brand = platform.parties.brand(brandId)
    // example-bottle@1 runs every step: a schema, a context of its own, shapes with a SPARQL constraint, and the identity rules.
    const item = vector(bottle, 'item.json')
    const passportId = mintPassportId(policy, '123454321', 'BTL-0001')
    expect(passportId).toBe(item.passportId)
    const outcome = await platform.writer.issue({ brandId, brand, passportId, profile: 'example-bottle@1', product: item.payload.product })
    expect(outcome.entry.index).toBe('admitted')
    const reading = await platform.read(passportId)
    expect(reading.checks.find((c) => c.name === 'schema')?.status).toBe('pass')
    expect(reading.payloadChecks[0].publicView.steps.map((s) => [s.step, s.status])).toEqual([
      ['envelope', 'pass'],
      ['binding', 'pass'],
      ['json-schema', 'pass'],
      ['json-ld-expand', 'pass'],
      ['shacl', 'pass'],
      ['passport-identity', 'pass'],
    ])
    // The shapes recommend a care note; the warning is reported and does not block.
    expect(reading.payloadChecks[0].publicView.findings.map((f) => f.severity)).toEqual(['Warning'])
    // The binding makes no split, so the whole document is public and the holder's view is the same document.
    expect(reading.product?.publicProduct).toEqual(item.payload.product)
    expect(reading.product?.access).toBeUndefined()
    const authorised = await platform.readAuthorised((await platform.store.getPassport(passportId))!, brand)
    expect(authorised.authorisedView.status).toBe('pass')
    expect(authorised.restrictedProduct).toBeUndefined()
    expect(authorised.product).toEqual(item.payload.product)

    // The profile's own negative vectors are refused by the writer.
    const part = vector(bottle, 'part-not-dishwasher-safe.json')
    await expect(platform.writer.issue({ brandId, brand, passportId: mintPassportId(policy, '123454321', 'BTL-0002'), profile: 'example-bottle@1', product: { ...part.payload.product, id: 'https://id.example/01/09521234543213/21/BTL-0002', serialNumber: 'BTL-0002' } })).rejects.toMatchObject({ code: 'product-invalid' })
    const other = vector(bottle, 'other-product.json')
    await expect(platform.writer.issue({ brandId, brand, passportId: mintPassportId(policy, '123454321', 'BTL-0003'), profile: 'example-bottle@1', product: other.payload.product })).rejects.toMatchObject({ code: 'product-invalid', data: { cause: 'product-identity-mismatch' } })

    // example-notebook@1 is plain JSON under a schema.
    const page = vector(notebook, 'item.json')
    const notebookId = mintPassportId(policy, '987600010', 'NB-0001')
    expect(notebookId).toBe(page.passportId)
    await platform.writer.issue({ brandId, brand, passportId: notebookId, profile: 'example-notebook@1', product: page.payload.product })
    expect((await platform.read(notebookId)).payloadChecks[0].publicView.status).toBe('pass')
    await expect(platform.writer.issue({ brandId, brand, passportId: mintPassportId(policy, '987600010', 'NB-0002'), profile: 'example-notebook@1', product: { ...page.payload.product, id: 'https://id.example/01/09529876000101/21/NB-0002', serialNumber: 'NB-0002', pages: 'many' } })).rejects.toMatchObject({ code: 'product-invalid', data: { cause: 'schema-invalid' } })
  })

  it('is refused at start-up when its digest is not trusted, naming the digest to review, and the API carries on without it', async () => {
    const { platform, lines } = await start({ CUSTOM_PROFILE_DIRS: bottle, TRUSTED_BINDING_DIGESTS: digestOf(notebook) })
    expect(platform.profiles.refusals).toHaveLength(1)
    expect(platform.profiles.refusals[0]).toMatchObject({ source: bottle, code: 'binding-untrusted' })
    expect(platform.profiles.refusals[0].detail).toContain(digestOf(bottle))
    expect(platform.profiles.refusals[0].detail).toContain('TRUSTED_BINDING_DIGESTS')
    expect(lines.some((line) => line.includes('binding-untrusted') && line.includes('The API continues without it.'))).toBe(true)
    expect(platform.profiles.list().map((p) => p.profile)).toEqual(['eu-battery@1', 'eu-textile@1'])

    // Nothing is written under the refused profile, a reading of one says not checked, and every other profile works.
    const policy = { host: platform.config.passportHost, prefix: platform.config.gs1Prefix }
    const brand = platform.parties.brand(brandId)
    const item = vector(bottle, 'item.json')
    await expect(platform.writer.issue({ brandId, brand, passportId: item.passportId, profile: 'example-bottle@1', product: item.payload.product })).rejects.toMatchObject({ code: 'profile-unknown' })
    const validation = await platform.profiles.validatePublic({ profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(item.payload), passportId: item.passportId })
    expect(await platform.profiles.viewCheck('public', validation)).toMatchObject({ status: 'not-checked', cause: 'profile-unknown' })
    const general = await platform.writer.issue({ brandId, brand, passportId: mintPassportId(policy, '100000088', 'GEN-0001'), profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
    expect(general.entry.index).toBe('admitted')
  })

  it('is refused when a file changed after its binding was trusted', async () => {
    // An artefact changed: the binding still has the trusted digest, and records the file it expected.
    const longer = join(scratch, 'longer')
    cpSync(bottle, longer, { recursive: true })
    appendFileSync(join(longer, 'shapes.ttl'), '\n# a rule added later\n')
    // The repository's own altered file: one fact changed and the length kept.
    const sameLength = join(scratch, 'same-length')
    cpSync(bottle, sameLength, { recursive: true })
    writeFileSync(join(sameLength, 'background.ttl'), readFileSync(join(bottle, 'vectors', 'registration', 'altered-background.ttl')))
    // The binding itself changed: it has another digest, which nobody trusted.
    const rebound = join(scratch, 'rebound')
    cpSync(bottle, rebound, { recursive: true })
    writeFileSync(join(rebound, 'binding.json'), readFileSync(join(bottle, 'binding.json'), 'utf8').replace('Example refillable bottle', 'Example refillable flask'))
    const missing = join(scratch, 'missing')

    const { platform, lines } = await start({ CUSTOM_PROFILE_DIRS: [longer, sameLength, rebound, missing].join(','), TRUSTED_BINDING_DIGESTS: digestOf(bottle) })
    expect(platform.profiles.refusals.map((r) => [r.source, r.code])).toEqual([
      [longer, 'artefact-length-mismatch'],
      [sameLength, 'artefact-digest-mismatch'],
      [rebound, 'binding-untrusted'],
      [missing, 'binding-unavailable'],
    ])
    expect(platform.profiles.refusals[0].detail).toContain('shapes.ttl')
    expect(platform.profiles.refusals[1].detail).toContain('background.ttl')
    expect(platform.profiles.refusals[2].detail).toContain(digestOf(rebound))
    expect(lines.filter((line) => line.includes('The API continues without it.'))).toHaveLength(4)
    expect(platform.profiles.get('example-bottle@1')).toBeUndefined()
    expect(platform.profiles.list().map((p) => p.profile)).toEqual(['eu-battery@1', 'eu-textile@1'])
  })

  it('stops the start for a trusted digest that is not a digest, naming the setting', () => {
    expect(() => loadConfig({ TRUSTED_BINDING_DIGESTS: 'example-bottle@1' })).toThrow(/TRUSTED_BINDING_DIGESTS/)
    expect(() => loadConfig({ TRUSTED_BINDING_DIGESTS: digestOf(bottle).toUpperCase() })).toThrow(/lower-case/)
    expect(loadConfig({ CUSTOM_PROFILE_DIRS: ' a , ,b ', TRUSTED_BINDING_DIGESTS: '' }).customProfiles).toEqual({ dirs: ['a', 'b'], trustedBindingDigests: [] })
    expect(loadConfig({}).customProfiles).toEqual({ dirs: [], trustedBindingDigests: [] })
  })
})
