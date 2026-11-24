import dns from 'node:dns'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  HISTORICAL_SECTOR_BINDINGS,
  BUNDLED_BINDING_DIGESTS,
  authorisedPayloadValidator,
  bindingPayloadValidator,
  buildGs1DigitalLink,
  bundledBindingLicenceTexts,
  bundledBindingNotices,
  createProfileRegistry,
  exportProfileBundle,
  openProfileBundle,
  parseGs1DigitalLink,
  prepareBoundPayload,
  profileBundleDirectory,
  profileBundleFiles,
  registerBundledBindings,
  registerProfileBundle,
  splitProductByAccess,
  type BindingValidationDetail,
  type ExportedProfileBundle,
  type PayloadValidation,
  type ProfileBinding,
  type ProfileRegistry,
  type ValidationEngines,
} from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { refuseNetwork, type NetworkGuard } from './network-off.js'

// Validation from an exported bundle, with nothing else to read from.
//
// The first deployment registers the two bundled sector bindings from the
// package folder and exports them. The second is built from that export
// alone: its registry is filled from the bundle on disk, the package's own
// `bindings/` folder is never opened again, and every way onto the network
// is refused, so the hosts the contexts are named after might as well not
// exist. The same battery and textile documents are then checked by both,
// and the two answers must be the same, finding for finding.
//
// The documents are the unmodified copies under test/fixtures/sector-bindings/.
// A payload is made from one in memory, as sector-bindings.test.ts makes it:
// a positive vector is the document less its note members, and each
// negative is a positive vector with the one change its case names.

// Every file read by this package's own modules is written down, so the test can say which folders the second deployment read.
const reads = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => { reads.paths.push(String(args[0] instanceof URL ? args[0].pathname : args[0])); return actual.readFileSync(...args) }) as typeof actual.readFileSync
  return { ...actual, default: { ...actual, readFileSync }, readFileSync }
})

const packageRoot = join(import.meta.dirname, '..')
const BINDINGS_FOLDER = join(packageRoot, 'bindings')
const NOTICE = 'Demonstration record: this passport describes no real product.'
const PASSPORT_HOST = 'passports.example'

type Json = Record<string, unknown>
interface Expected { status: 'pass' | 'fail' | 'unknown'; cause?: string; step?: string; constraint?: string }
interface PayloadCase { name: string; from: string; passportOf?: string; set?: Json; remove?: string[]; expected: Expected }
interface RegistrationCase { name: string; expected: { refusal: string; artefact: string } }
type Case = PayloadCase | RegistrationCase
const isRegistration = (c: Case): c is RegistrationCase => 'refusal' in c.expected

const withoutNotes = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutNotes)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node).filter(([name]) => !name.startsWith('_comment')).map(([name, value]) => [name, withoutNotes(value)]))
}

const sectors = HISTORICAL_SECTOR_BINDINGS.map(({ profile, bindingDigest }) => {
  const fixtures = join(packageRoot, 'test', 'fixtures', 'sector-bindings', profile)
  const binding = JSON.parse(readFileSync(join(BINDINGS_FOLDER, profile, 'binding.json'), 'utf8')) as ProfileBinding
  const documents = new Map(binding.vectors.positive.map((path) => [path, JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as Json]))
  const cases = binding.vectors.negative.flatMap((path) => (JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as { cases: Case[] }).cases).filter((c): c is PayloadCase => !isRegistration(c))
  return { profile, bindingDigest, binding, documents, cases }
})
type Sector = (typeof sectors)[number]
const each = sectors.map((sector) => [sector.profile, sector] as const)

const published = (sector: Sector, path: string): Json => structuredClone(sector.documents.get(path)!)
const positive = (sector: Sector, path: string): Json => withoutNotes(published(sector, path)) as Json
const passportIdOf = (document: Json): string => {
  const link = parseGs1DigitalLink(document.id as string)
  return buildGs1DigitalLink(PASSPORT_HOST, link.gtin, link.serial!)
}
const envelope = (sector: Sector, product: Json, bindingDigest = sector.bindingDigest): Json => ({ notice: NOTICE, profile: sector.binding.id, profile_version: sector.binding.version, profile_binding_sha256: bindingDigest, product })
const changed = (product: Json, change: Pick<PayloadCase, 'set' | 'remove'>): Json => {
  const copy = { ...structuredClone(product), ...(change.set ?? {}) }
  for (const pointer of change.remove ?? []) {
    const tokens = pointer.split('/').slice(1)
    let at: Json = copy
    for (const token of tokens.slice(0, -1)) at = at[token] as Json
    expect(Object.hasOwn(at, tokens.at(-1)!), `${pointer} is there to remove`).toBe(true)
    delete at[tokens.at(-1)!]
  }
  return copy
}

/** One payload to check: the envelope, the passport it is checked under, and the engines where a case takes them away. */
interface Check { payload: Json; passportId?: string; engines?: (engines: ValidationEngines) => ValidationEngines }
const outage = (engines: ValidationEngines): ValidationEngines => ({ jsonLd: engines.jsonLd!, shacl: { capabilities: engines.shacl!.capabilities, validate: async () => { throw new Error('the engine is not running') } } })
/** The payload each negative case names, built as sector-bindings.test.ts builds it. */
const checkOf = (sector: Sector, c: PayloadCase): Check => {
  const base = positive(sector, c.from)
  switch (c.name) {
    case 'notes-kept': { const document = published(sector, c.from); return { payload: envelope(sector, document), passportId: passportIdOf(document) } }
    case 'unlisted-context': return { payload: envelope(sector, { ...base, '@context': [...(base['@context'] as string[]), 'https://contexts.example/unlisted.jsonld'] }), passportId: passportIdOf(base) }
    case 'no-passport-identifier': return { payload: envelope(sector, base) }
    case 'engine-outage': return { payload: envelope(sector, base), passportId: passportIdOf(base), engines: outage }
    case 'wrong-binding-digest': return { payload: envelope(sector, base, sectors.find((other) => other !== sector)!.bindingDigest), passportId: passportIdOf(base) }
    case 'member-beside-product': return { payload: { ...envelope(sector, base), 'gs1:gtin': base['gs1:gtin'] }, passportId: passportIdOf(base) }
    default: return { payload: envelope(sector, changed(base, c)), passportId: passportIdOf(c.passportOf == null ? base : positive(sector, c.passportOf)) }
  }
}

const temporary: string[] = []
afterAll(() => { for (const folder of temporary) rmSync(folder, { recursive: true, force: true }) })
const writeTo = (folder: string, files: ReadonlyMap<string, Uint8Array>): void => {
  for (const [path, bytes] of files) {
    const target = join(folder, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}

let engines: ValidationEngines
/** The first deployment: the bundled bindings, registered from the package folder. */
let first: ProfileRegistry
/** The second: a registry filled from the exported bundle on disk, and from nothing else. */
let second: ProfileRegistry
let bundle: ExportedProfileBundle
let bundleFolder: string
let guard: NetworkGuard
/** How many file reads had been made when the first deployment was switched off. */
let readsBeforeRestore = 0
/** The files read to build the second deployment, taken as soon as it was built. */
let readsToRestore: string[] = []

beforeAll(async () => {
  first = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
  for (const result of await registerBundledBindings(first, { profiles: HISTORICAL_SECTOR_BINDINGS.map((entry) => entry.profile) })) expect(result).toMatchObject({ ok: true, alreadyRegistered: false })
  const exported = await exportProfileBundle({ registry: first, readNotice: bundledBindingNotices(), licenceTexts: bundledBindingLicenceTexts() })
  if (!exported.ok) throw new Error(`${exported.code}: ${exported.detail}`)
  bundle = exported
  bundleFolder = mkdtempSync(join(tmpdir(), 'dpp-profile-bundle-offline-'))
  temporary.push(bundleFolder)
  writeTo(bundleFolder, bundle.files)

  // From here on there is no network, and the package's own bindings folder is not read again.
  guard = refuseNetwork()
  readsBeforeRestore = reads.paths.length
  engines = await createValidationEngine()

  const opened = await openProfileBundle(profileBundleDirectory(bundleFolder))
  if (!opened.ok) throw new Error(`${opened.code}: ${opened.detail}`)
  // The destination's own configuration says which bindings it trusts. The bundle does not.
  second = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
  expect(await registerProfileBundle(second, opened.bundle, { expected: HISTORICAL_SECTOR_BINDINGS })).toMatchObject(HISTORICAL_SECTOR_BINDINGS.map(({ profile, bindingDigest }) => ({ ok: true, alreadyRegistered: false, profile: { profile, bindingDigest } })))
  readsToRestore = reads.paths.slice(readsBeforeRestore)
})
afterAll(() => { guard?.restore() })

const authorised = (registry: ProfileRegistry, sector: Sector, check: Check): Promise<PayloadValidation> => {
  const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: sector.binding, product: check.payload.product as Json })
  return authorisedPayloadValidator({ registry, engines: (check.engines ?? ((given) => given))(engines) })({
    profile: sector.binding.id,
    profileVersion: sector.binding.version,
    payloadPublic: JSON.stringify({ ...check.payload, product: publicProduct }),
    ...(restrictedProduct == null ? {} : { restrictedProduct }),
    ...(check.passportId == null ? {} : { passportId: check.passportId }),
  })
}
const publicOnly = (registry: ProfileRegistry, sector: Sector, check: Check): Promise<PayloadValidation> => {
  const { publicProduct } = splitProductByAccess({ binding: sector.binding, product: check.payload.product as Json })
  return bindingPayloadValidator({ registry, engines: (check.engines ?? ((given) => given))(engines) })({
    profile: sector.binding.id,
    profileVersion: sector.binding.version,
    payloadPublic: JSON.stringify({ ...check.payload, product: publicProduct }),
    ...(check.passportId == null ? {} : { passportId: check.passportId }),
  })
}
const detailOf = (result: PayloadValidation): BindingValidationDetail => result.detail as BindingValidationDetail
const findingsOf = (result: PayloadValidation): number => detailOf(result).steps.reduce((count, step) => count + (step.findings?.length ?? 0), 0)

describe('the network guard refuses and records every way out', () => {
  it('a fetch, a name lookup and a connection each fail and are written down', async () => {
    const probe = refuseNetwork()
    try {
      await expect((async () => fetch('https://ref.gs1.org/'))()).rejects.toThrow(/network is off/)
      expect(() => dns.lookup('ref.gs1.org', () => {})).toThrow(/network is off/)
      await expect((async () => dns.promises.lookup('ref.gs1.org'))()).rejects.toThrow(/network is off/)
      expect(() => net.connect(443, '192.0.2.1')).toThrow(/network is off/)
      expect(() => new net.Socket().connect(443, '192.0.2.1')).toThrow(/network is off/)
      expect(probe.attempts).toEqual(['fetch https://ref.gs1.org/', 'dns.lookup ref.gs1.org', 'dns.promises.lookup ref.gs1.org', 'net.connect 443', 'socket connect 443'])
    } finally {
      probe.restore()
    }
    // The probe stood in front of the guard the tests below run under, so its attempts are its own and that guard's record is untouched.
    expect(guard.attempts).toEqual([])
    // With the probe gone the outer guard is the one that answers, so it is working too.
    await expect((async () => fetch('https://ref.gs1.org/'))()).rejects.toThrow(/network is off/)
    expect(guard.attempts.splice(0)).toEqual(['fetch https://ref.gs1.org/'])
  })
})

describe('the second deployment is built from the bundle alone', () => {
  it('holds the same bindings and the same artefact bytes as the first', () => {
    for (const { profile } of HISTORICAL_SECTOR_BINDINGS) {
      const [id, version] = profile.split('@') as [string, string]
      const [a, b] = [first.resolve(id, Number(version)), second.resolve(id, Number(version))]
      if (a?.format !== 'binding' || b?.format !== 'binding') throw new Error(`${profile} is not held by a binding in both registries`)
      expect(b.bindingDigest).toBe(a.bindingDigest)
      expect(b.bindingBytes).toEqual(a.bindingBytes)
      expect(b.binding).toEqual(a.binding)
      expect(b.artefacts.map((entry) => entry.artefact)).toEqual(a.artefacts.map((entry) => entry.artefact))
      for (const [index, entry] of b.artefacts.entries()) expect(entry.bytes, entry.artefact.path).toEqual(a.artefacts[index]!.bytes)
    }
  })

  it('read its bindings and artefacts from the bundle folder, and nothing from the package\'s own bindings folder', () => {
    expect(readsToRestore.filter((path) => path.startsWith(BINDINGS_FOLDER))).toEqual([])
    const fromBundle = readsToRestore.filter((path) => path.startsWith(bundleFolder)).map((path) => path.slice(bundleFolder.length + 1).split('\\').join('/'))
    // The descriptor, then each binding with the artefacts it lists. No notice and no licence text is read to validate.
    expect(fromBundle).toEqual(['profiles/profile-bundle.json', ...sectors.flatMap((sector) => [`profiles/${sector.profile}/binding.json`, ...sector.binding.artefacts.map((artefact) => `profiles/${sector.profile}/${artefact.path}`)])])
  })

  it('an export made by the second deployment is the first one\'s export, byte for byte', async () => {
    // The notices and the licence text come from the bundle too, so nothing is read from the package folder to pass the profiles on.
    const opened = await openProfileBundle(profileBundleDirectory(bundleFolder))
    if (!opened.ok) throw new Error(`${opened.code}: ${opened.detail}`)
    const again = await exportProfileBundle({ registry: second, readNotice: (profile, path) => opened.bundle.noticeBytes(profile.profile, path), licenceTexts: await opened.bundle.licenceTexts() })
    if (!again.ok) throw new Error(`${again.code}: ${again.detail}`)
    expect(again.inventory).toEqual(bundle.inventory)
    expect([...again.files.keys()]).toEqual([...bundle.files.keys()])
    for (const [path, bytes] of again.files) expect(bytes, path).toEqual(bundle.files.get(path))
  })
})

describe('issued documents validate the same from the bundle as from the package, finding for finding', () => {
  it.each(sectors.map((sector) => [sector.profile, sector] as const))('%s checks the restored subject for contradictory expanded identifiers', async (_name, sector) => {
    const base = positive(sector, sector.binding.vectors.positive[0]!)
    const { 'gs1:gtin': _, ...rest } = base
    const product = { ...rest, 'https://ref.gs1.org/voc/gtin': '09521000001428' }
    const check = { payload: envelope(sector, product), passportId: passportIdOf(base) }
    const recovered = await authorised(second, sector, check)
    expect(recovered).toEqual(await authorised(first, sector, check))
    expect(detailOf(recovered).steps.find((s) => s.step === 'passport-identity')).toMatchObject({ status: 'fail' })
    const publicReport = await publicOnly(second, sector, check)
    expect(JSON.stringify(publicReport)).not.toContain('09521000001428')
  })

  const positives = sectors.flatMap((sector) => sector.binding.vectors.positive.map((path) => [`${sector.profile} ${path}`, sector, path] as const))
  const negatives = sectors.flatMap((sector) => sector.cases.map((c) => [`${sector.profile} ${c.name}`, sector, c] as const))

  it('covers two documents and every negative payload case of each sector', () => {
    expect(positives.length).toBe(4)
    expect(negatives.length).toBe(28)
  })

  it.each(positives)('%s: a reader with both parts gets a pass from each, with the same steps and findings', async (_name, sector, path) => {
    const product = positive(sector, path)
    const check: Check = { payload: envelope(sector, product), passportId: passportIdOf(product) }
    const [a, b] = [await authorised(first, sector, check), await authorised(second, sector, check)]
    expect(a.status, JSON.stringify(a.detail)).toBe('pass')
    expect(b).toEqual(a)
    expect(detailOf(b).bindingDigest).toBe(sector.bindingDigest)
    expect(detailOf(b).steps.map((step) => [step.step, step.status])).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['assembly', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
  })

  it.each(positives)('%s: a reader of the public payload alone gets the same answer from each', async (_name, sector, path) => {
    const product = positive(sector, path)
    const check: Check = { payload: envelope(sector, product), passportId: passportIdOf(product) }
    const [a, b] = [await publicOnly(first, sector, check), await publicOnly(second, sector, check)]
    expect(b).toEqual(a)
    expect(detailOf(b).access).toMatchObject({ policy: sector.binding.access!.policy, view: 'public' })
  })

  it.each(positives)('%s: a writer prepares the same public payload and the same restricted part from each', async (_name, sector, path) => {
    const product = positive(sector, path)
    const prepare = (registry: ProfileRegistry) => prepareBoundPayload({ registry, engines, profile: sector.binding.id, profileVersion: sector.binding.version, product, passportId: passportIdOf(product), notice: NOTICE })
    const [a, b] = [await prepare(first), await prepare(second)]
    expect(a.ok, JSON.stringify(a)).toBe(true)
    expect(b).toEqual(a)
  })

  it.each(negatives)('%s: refused, or not decided, the same way by each', async (_name, sector, c) => {
    const check = checkOf(sector, c)
    const [a, b] = [await authorised(first, sector, check), await authorised(second, sector, check)]
    // The case's own expectation holds for the first deployment, so the comparison below is of a real refusal.
    expect(a.status, JSON.stringify(a.detail)).toBe(c.expected.status)
    expect(detailOf(a).cause).toBe(c.expected.cause)
    expect(detailOf(a).steps.find((step) => step.status === c.expected.status)?.step).toBe(c.expected.step)
    expect(b).toEqual(a)
    // A reader of the public payload alone decides less, and may not see a fault that sits in a restricted property. Whatever it decides, both decide it.
    const [publicA, publicB] = [await publicOnly(first, sector, check), await publicOnly(second, sector, check)]
    expect(publicB).toEqual(publicA)
  })

  it('the comparisons above compared findings, not their absence', async () => {
    // At least one case of each sector reports SHACL findings, so "the same" was said of something.
    for (const sector of sectors) {
      const c = sector.cases.find((candidate) => candidate.name === 'missing-required-property')!
      const result = await authorised(second, sector, checkOf(sector, c))
      expect(findingsOf(result)).toBeGreaterThan(0)
      expect(detailOf(result).steps.find((step) => step.step === 'shacl')?.findings?.map((finding) => finding.constraint)).toContain('MinCountConstraintComponent')
    }
  })
})

describe('what is missing is said, and is never a pass', () => {
  const restore = async (files: ReadonlyMap<string, Uint8Array>): Promise<{ registry: ProfileRegistry; results: Awaited<ReturnType<typeof registerProfileBundle>> }> => {
    const opened = await openProfileBundle(profileBundleFiles(files))
    if (!opened.ok) throw new Error(`${opened.code}: ${opened.detail}`)
    const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    return { registry, results: await registerProfileBundle(registry, opened.bundle) }
  }
  const passing = (sector: Sector): Check => { const product = positive(sector, sector.binding.vectors.positive[1]!); return { payload: envelope(sector, product), passportId: passportIdOf(product) } }

  it.each(each)('%s: a bundle that lacks one artefact is named incomplete, and a payload under the profile is unknown', async (_profile, sector) => {
    for (const artefact of sector.binding.artefacts) {
      const files = new Map(bundle.files)
      files.delete(`profiles/${sector.profile}/${artefact.path}`)
      const { registry, results } = await restore(files)
      const refused = results.find((result) => !result.ok)
      expect(refused, artefact.path).toMatchObject({ ok: false, code: 'bundle-artefact-missing', profile: sector.profile, artefact: artefact.path, bindingDigest: sector.bindingDigest })
      expect(registry.resolve(sector.binding.id, sector.binding.version), artefact.path).toBeUndefined()
      // The other profile's files are all there, so it is restored as usual.
      expect(results.filter((result) => result.ok).length).toBe(1)
      const check = passing(sector)
      for (const result of [await authorised(registry, sector, check), await publicOnly(registry, sector, check)]) {
        expect(result, artefact.path).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { profile: sector.profile, cause: 'profile-unknown', steps: [] } })
      }
      const prepared = await prepareBoundPayload({ registry, engines, profile: sector.binding.id, profileVersion: sector.binding.version, product: check.payload.product as Json, passportId: check.passportId! })
      expect(prepared, artefact.path).toMatchObject({ ok: false, code: 'validation-unavailable' })
    }
  })

  it.each(each)('%s: a bundle that lacks the binding file registers nothing for the profile', async (_profile, sector) => {
    const files = new Map(bundle.files)
    files.delete(`profiles/${sector.profile}/binding.json`)
    const { registry, results } = await restore(files)
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: 'bundle-binding-missing', profile: sector.profile })
    expect((await authorised(registry, sector, passing(sector))).status).toBe('unknown')
  })

  it('a folder with no descriptor is not a bundle, and nothing is registered from it', async () => {
    const files = new Map(bundle.files)
    files.delete('profiles/profile-bundle.json')
    expect(await openProfileBundle(profileBundleFiles(files))).toMatchObject({ ok: false, code: 'bundle-descriptor-missing' })
    expect(await openProfileBundle(profileBundleDirectory(join(bundleFolder, 'profiles', 'licences')))).toMatchObject({ ok: false, code: 'bundle-descriptor-missing' })
  })

  it.each(each)('%s: from the bundle, a restricted part that belongs to another product is refused, and the right one passes', async (_profile, sector) => {
    // The larger document of each sector has restricted properties.
    const product = positive(sector, sector.binding.vectors.positive[1]!)
    const result = await prepareBoundPayload({ registry: second, engines, profile: sector.binding.id, profileVersion: sector.binding.version, product, passportId: passportIdOf(product), notice: NOTICE })
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    expect(result.restrictedProduct).toBeDefined()
    const validate = authorisedPayloadValidator({ registry: second, engines })
    const input = { profile: sector.binding.id, profileVersion: sector.binding.version, payloadPublic: result.payloadPublic, passportId: passportIdOf(product) }
    const whole = await validate({ ...input, restrictedProduct: result.restrictedProduct })
    expect(whole.status, JSON.stringify(whole.detail)).toBe('pass')
    const other = await validate({ ...input, restrictedProduct: { ...result.restrictedProduct, id: 'https://id.example/01/09521234002000/21/ANOTHER' } })
    expect(other).toMatchObject({ status: 'fail', detail: { cause: 'product-assembly-refused' } })
  })

  it.each(each)('%s: from the bundle, a payload with no passport identifier, or with no engine to check it, is unknown', async (_profile, sector) => {
    const check = passing(sector)
    expect(await authorised(second, sector, { payload: check.payload })).toMatchObject({ status: 'unknown', detail: { cause: 'product-identity-unavailable' } })
    expect(await authorised(second, sector, { ...check, engines: () => ({}) })).toMatchObject({ status: 'unknown', detail: { cause: 'validator-unavailable' } })
  })

  it('validation from the bundle says nothing of the owner commitment, and the bundle says so', () => {
    expect(bundle.descriptor.limits).toEqual({ profiles: 'bindings-only', trust: 'destination-trusted-digests', ownerCommitment: 'not-established' })
    const written = JSON.parse(readFileSync(join(bundleFolder, 'profiles', 'profile-bundle.json'), 'utf8')) as { limits: unknown }
    expect(written.limits).toEqual(bundle.descriptor.limits)
  })
})

describe('validation from the bundle', () => {
  // Last in the file on purpose: it reads the record of everything the tests above could have tried.
  it('never reached for the network: no fetch, no name lookup, no connection', () => {
    expect(guard.attempts).toEqual([])
  })

  it('never read the package\'s own bindings folder after the first deployment was switched off', () => {
    expect(reads.paths.slice(readsBeforeRestore).filter((path) => path.startsWith(BINDINGS_FOLDER))).toEqual([])
  })
})
