// Which profile resolver a deployment uses, shown by what it resolves.
//
// With PROFILE_BUNDLE_DIR set, the profiles held by a binding are read from
// the bundle in that folder and from nowhere else. The sector profiles are
// also in the installed profiles package, byte for byte, so a deployment
// that quietly read them from the package instead would answer every
// question about a complete bundle the same way. These tests ask the
// questions that tell the two apart: a folder with no bundle, a bundle with
// a file gone, and a bundle that carries one of the two profiles. In each,
// a profile the folder does not give is not resolved, the deployment says
// so, nothing can be written under it, and a payload that declares it reads
// as not checked. A check that did not run is never a pass.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EPCIS_GS1_ARTEFACTS } from '@bsv/dpp-credentials'
import { BUNDLED_BINDINGS, exportProfileBundle } from '@bsv/dpp-profiles'
import { startApp, testConfig, type Json, type TestApp } from './epcis-fixtures.js'

const SECTOR = ['eu-battery@1', 'eu-textile@1'] as const
const folders: string[] = []
const apps: TestApp[] = []

/** What the control deployment, which reads the installed package, made for each sector profile: a product, its passport identifier and its signed public payload. */
const made = new Map<string, { itemReference: string; serial: string; passportId: string; product: Json; payload: { profile: string; profileVersion: number; payloadPublic: string; passportId: string } }>()
/** The files of a bundle of the profiles named, as an export writes them, under the folder name a restore installs them at. */
const bundleFiles = new Map<string, Map<string, Uint8Array>>()

const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-profile-bundle-'))
  folders.push(dir)
  return dir
}
const app = async (over: Record<string, string> = {}): Promise<TestApp> => {
  const started = await startApp({ config: testConfig(over) })
  apps.push(started)
  const party = started.platform.parties.brand('dev-brand')
  await started.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: '2026-03-01T00:00:00.000Z' })
  return started
}
const install = (dir: string, files: Map<string, Uint8Array>, without: (path: string) => boolean = () => false): void => {
  for (const [path, bytes] of files) {
    if (without(path)) continue
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), bytes)
  }
}
const everyFile = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)

beforeAll(async () => {
  // The control: no bundle folder is configured, so both sector profiles are read from the installed package.
  const packaged = await app()
  expect(packaged.platform.profiles.source).toBe('package')
  expect(packaged.platform.profiles.list().map((profile) => profile.profile).sort()).toEqual([...SECTOR])
  expect(packaged.platform.profiles.refusals).toEqual([])
  for (const profile of SECTOR) {
    const example = (await packaged.get(`/api/profiles/${encodeURIComponent(profile)}`)).body.examples[0] as { itemReference: string; serial: string; passportId: string; product: Json }
    const bound = packaged.platform.profiles.get(profile)!
    const prepared = await packaged.platform.profiles.prepare({ profile: bound, product: example.product, passportId: example.passportId })
    if (!('payloadPublic' in prepared)) throw new Error(`the control deployment could not prepare ${profile}: ${JSON.stringify(prepared)}`)
    const payload = { profile: bound.id, profileVersion: bound.version, payloadPublic: prepared.payloadPublic as string, passportId: example.passportId }
    // Under the package's own binding the payload passes. This is what a deployment that fell back to the package would answer below.
    expect((await packaged.platform.profiles.validatePublic(payload)).status, profile).toBe('pass')
    made.set(profile, { ...example, payload })
  }
  for (const [name, profiles] of [['both', [...SECTOR]], ['textile-only', ['eu-textile@1']]] as const) {
    const bundle = await exportProfileBundle({
      registry: packaged.platform.profiles.registry,
      profiles: [...profiles],
      readNotice: (profile, path) => packaged.platform.profiles.readNotice(profile, path),
      licenceTexts: await packaged.platform.profiles.licenceTexts(),
      provisioned: EPCIS_GS1_ARTEFACTS,
      root: 'profiles',
    })
    if (!bundle.ok) throw new Error(`the control deployment could not export a bundle: ${bundle.code}: ${bundle.detail}`)
    bundleFiles.set(name, bundle.files)
  }
  await packaged.close()
  apps.splice(apps.indexOf(packaged), 1)
}, 120_000)

afterEach(async () => {
  await Promise.all(apps.splice(0).map((started) => started.close()))
})
afterAll(() => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true })
})

/** Everything a deployment answers about a sector profile it does not hold: it is not listed, cannot be written, and a payload that declares it is not checked. */
async function notResolved(api: TestApp, profile: (typeof SECTOR)[number]): Promise<void> {
  const example = made.get(profile)!
  expect(api.platform.profiles.get(profile), profile).toBeUndefined()
  expect(api.platform.profiles.list().map((held) => held.profile), profile).not.toContain(profile)
  expect(((await api.get('/api/profiles')).body as Json[]).map((listed) => listed.id), profile).not.toContain(profile)
  const described = await api.get(`/api/profiles/${encodeURIComponent(profile)}`)
  expect(described.status, profile).toBe(404)
  expect(described.body, profile).toMatchObject({ error: 'profile-unknown' })
  expect((await api.get(`/api/profiles/${encodeURIComponent(profile)}/codes?class=x`)).status, profile).toBe(404)

  // Nothing is written under it: the request is refused by name, and no passport is in the journal.
  const issued = await api.post('/api/brands/dev-brand/passports', { profile, itemReference: example.itemReference, serial: example.serial, product: example.product })
  expect(issued.status, profile).toBe(400)
  expect(issued.body, profile).toMatchObject({ error: 'profile-unknown' })
  expect(await api.platform.store.getPassport(example.passportId), profile).toBeUndefined()

  // A payload that declares it, and that passes under the package's binding, is not checked here. That is an answer of its own, and it is not a pass.
  const validation = await api.platform.profiles.validatePublic(example.payload)
  expect(validation.status, profile).toBe('unknown')
  const view = await api.platform.profiles.viewCheck('public', validation)
  expect(view.status, profile).toBe('not-checked')
  expect(view.status, profile).not.toBe('pass')
  expect(view.summary, profile).toMatch(/A check that could not run is not a pass\./)
}

describe('a deployment told to read its profiles from a bundle folder', () => {
  it('resolves no sector profile from a folder that holds no bundle, says so, and puts nothing into the folder', async () => {
    const dir = folder()
    const lines: string[] = []
    const started = await startApp({ config: testConfig({ PROFILE_BUNDLE_DIR: dir }), lines })
    apps.push(started)
    const party = started.platform.parties.brand('dev-brand')
    await started.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: '2026-03-01T00:00:00.000Z' })

    // The resolver is the bundle's, and it gave nothing. Had the package's bindings been read in its place, both profiles would be listed here.
    expect(started.platform.profiles.source).toBe('bundle')
    expect(started.platform.profiles.list()).toEqual([])
    // The deployment says what is missing: one refusal, which names the folder and the setting.
    expect(started.platform.profiles.refusals).toHaveLength(1)
    expect(started.platform.profiles.refusals[0]).toMatchObject({ source: `the profile bundle in ${dir}`, detail: expect.stringContaining('PROFILE_BUNDLE_DIR names the folder a restore installs a bundle into; until it holds one, no profile is registered from it.') })
    expect(lines.filter((line) => line.startsWith(`Profile the profile bundle in ${dir} was not registered`))).toHaveLength(1)
    const operations = (await started.get('/api/operations')).body
    expect(operations.profiles).toMatchObject({ source: 'bundle', refused: [{ source: `the profile bundle in ${dir}`, code: started.platform.profiles.refusals[0]!.code }] })
    // The API runs, and its other profiles are as they were.
    expect((await started.get('/api/health')).status).toBe(200)

    for (const profile of SECTOR) await notResolved(started, profile)
    // Nothing was copied in to make the folder whole.
    expect(everyFile(dir)).toEqual([])
  })

  it('resolves both sector profiles once the folder holds their bundle, under the digests the package publishes', async () => {
    const dir = folder()
    install(dir, bundleFiles.get('both')!)
    const api = await app({ PROFILE_BUNDLE_DIR: dir })
    expect(api.platform.profiles.source).toBe('bundle')
    expect(api.platform.profiles.refusals).toEqual([])
    expect(api.platform.profiles.list().map((profile) => [profile.profile, profile.bindingDigest]).sort()).toEqual(BUNDLED_BINDINGS.map((entry) => [entry.profile, entry.bindingDigest]).sort())
    for (const profile of SECTOR) expect((await api.platform.profiles.validatePublic(made.get(profile)!.payload)).status, profile).toBe('pass')
  })

  it('resolves only the profile a bundle carries: the other is not taken from the package', async () => {
    const dir = folder()
    install(dir, bundleFiles.get('textile-only')!)
    const api = await app({ PROFILE_BUNDLE_DIR: dir })
    expect(api.platform.profiles.source).toBe('bundle')
    expect(api.platform.profiles.list().map((profile) => profile.profile)).toEqual(['eu-textile@1'])
    expect((await api.platform.profiles.validatePublic(made.get('eu-textile@1')!.payload)).status).toBe('pass')
    await notResolved(api, 'eu-battery@1')
  })

  it('refuses a bundle with a file gone, by name, and resolves nothing in its place', async () => {
    const dir = folder()
    const files = bundleFiles.get('both')!
    // One file of the battery profile that is not its binding: a rule file or a context the binding names.
    const gone = [...files.keys()].find((path) => path.startsWith('profiles/eu-battery@1/') && !path.endsWith('binding.json'))!
    expect(gone).toBeDefined()
    install(dir, files, (path) => path === gone)
    const lines: string[] = []
    const started = await startApp({ config: testConfig({ PROFILE_BUNDLE_DIR: dir }), lines })
    apps.push(started)
    const party = started.platform.parties.brand('dev-brand')
    await started.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: '2026-03-01T00:00:00.000Z' })

    expect(started.platform.profiles.source).toBe('bundle')
    expect(started.platform.profiles.refusals.length).toBeGreaterThan(0)
    expect(lines.some((line) => /was not registered \(/.test(line))).toBe(true)
    // The incomplete profile is not resolved, from the bundle or from anywhere else.
    await notResolved(started, 'eu-battery@1')
    expect((await started.get('/api/operations')).body.profiles.refused.length).toBeGreaterThan(0)
  })
})
