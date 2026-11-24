import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { PrivateKey } from '@bsv/sdk'
import { evidencePackageSigner, evidencePackageSigningKey, inspectEvidencePackage, signEvidenceManifest, type InventoryEntry, type UnsignedEvidenceManifest } from '@bsv/dpp-protocol'
import {
  BUNDLED_BINDINGS,
  BUNDLED_BINDING_DIGESTS,
  BUNDLED_BINDING_LICENCE,
  CURRENT_SECTOR_BINDINGS,
  GS1_RESOLVER_ARTEFACTS,
  PROFILE_BUNDLE_DESCRIPTOR,
  PROFILE_BUNDLE_LIMITS,
  PROFILE_BUNDLE_REPRESENTATIONS,
  PROFILE_BUNDLE_ROOT,
  bundledBindingLicenceTexts,
  bundledBindingNotices,
  createProfileRegistry,
  describeArtefact,
  describeProfileBundleOmission,
  exportProfileBundle,
  openProfileBundle,
  profileBundleDirectory,
  profileBundleFiles,
  profileBundleInconsistencies,
  profileBundleProblems,
  registerBundledBindings,
  registerProfileBundle,
  type BindingArtefact,
  type ExportedProfileBundle,
  type OpenedProfileBundle,
  type ProfileBinding,
  type ProfileBundleDescriptor,
  type ProfileRegistry,
} from '../src/index.js'
import { SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticAccessBinding, syntheticBinding, utf8 } from './binding-fixture.js'

// The profile bundle: what an export holds, how its descriptor is checked,
// where a bundle is read from, and how the files sit in an evidence package.
// Whether a restored binding is trusted is in profile-bundle-trust.test.ts,
// and validation from a bundle with the network off is in
// profile-bundle-offline.test.ts.
const packageRoot = join(import.meta.dirname, '..')
const repo = join(packageRoot, '..', '..')
const jsonOf = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const lamp = syntheticBinding()
const lampBytes = bindingBytes(lamp)
const lampDigest = sha256Hex(lampBytes)
const tiers = syntheticAccessBinding()
const tiersBytes = bindingBytes(tiers)
const tiersDigest = sha256Hex(tiersBytes)

const registryWith = async (...bindings: Uint8Array[]): Promise<ProfileRegistry> => {
  const registry = createProfileRegistry({ trustedBindingDigests: bindings.map(sha256Hex) })
  for (const bytes of bindings) expect(await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: true })
  return registry
}
const exported = async (input: Parameters<typeof exportProfileBundle>[0]): Promise<ExportedProfileBundle> => {
  const result = await exportProfileBundle(input)
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
  return result
}
const opened = async (source: Parameters<typeof openProfileBundle>[0], options?: Parameters<typeof openProfileBundle>[1]): Promise<OpenedProfileBundle> => {
  const result = await openProfileBundle(source, options)
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
  return result.bundle
}
const descriptorOf = (bundle: ExportedProfileBundle): ProfileBundleDescriptor => JSON.parse(new TextDecoder().decode(bundle.files.get(`${bundle.root}/${PROFILE_BUNDLE_DESCRIPTOR}`)!)) as ProfileBundleDescriptor

const temporary: string[] = []
const scratch = (): string => { const folder = mkdtempSync(join(tmpdir(), 'dpp-profile-bundle-')); temporary.push(folder); return folder }
const writeTo = (folder: string, files: ReadonlyMap<string, Uint8Array>): void => {
  for (const [path, bytes] of files) {
    const target = join(folder, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}
afterAll(() => { for (const folder of temporary) rmSync(folder, { recursive: true, force: true }) })

describe('profile bundle descriptor, format 1: the hand-written check and the JSON Schema agree', () => {
  const schema = jsonOf<Record<string, unknown>>(join(packageRoot, 'schemas', 'profile-bundle-v1.schema.json'))
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  const digest = 'a'.repeat(64)
  const base = (): Record<string, any> => ({
    format: 'dpp-profile-bundle',
    version: '1',
    profiles: [{ profile: 'example-lamp@1', bindingDigest: digest, notices: ['NOTICE.md'] }],
    licences: [{ licence: 'Apache-2.0', path: 'licences/Apache-2.0.txt' }],
    omitted: [{ uri: 'https://ref.gs1.org/standards/example/context', sha256: digest, byteLength: 12, reason: 'provisioned-by-destination', requiredBy: [{ profile: 'example-lamp@1', path: 'context.jsonld' }] }],
    limits: { ...PROFILE_BUNDLE_LIMITS },
  })
  const vary = (change: (descriptor: Record<string, any>) => void): unknown => { const copy = base(); change(copy); return copy }

  const positives: Array<[string, unknown]> = [
    ['a descriptor with a notice, a licence text and a file left out', base()],
    ['nothing left out, no notice and no licence', vary((d) => { d.profiles[0].notices = []; d.licences = []; d.omitted = [] })],
    ['a licence that is named and whose text is not carried', vary((d) => { delete d.licences[0].path })],
    ['a file named for the deployment and needed by no binding', vary((d) => { delete d.omitted[0].requiredBy })],
    ['two profiles', vary((d) => { d.profiles.push({ profile: 'example-lamp-tiers@1', bindingDigest: 'b'.repeat(64), notices: [] }) })],
  ]
  const negatives: Array<[string, unknown]> = [
    ['not an object', 'bundle'],
    ['an array', [base()]],
    ['null', null],
    ['another format name', vary((d) => { d.format = 'dpp-evidence-package' })],
    ['an unknown format version', vary((d) => { d.version = '2' })],
    ['the version as a number', vary((d) => { d.version = 1 })],
    ['a member the format does not define', vary((d) => { d.trustedBindingDigests = [digest] })],
    ['a signature of its own', vary((d) => { d.signature = { signer: '02' + 'a'.repeat(64), value: '00' } })],
    ['no profiles member', vary((d) => { delete d.profiles })],
    ['no profile', vary((d) => { d.profiles = [] })],
    ['a profile that is not id@version in form', vary((d) => { d.profiles[0].profile = 'example-lamp' })],
    ['a profile name that climbs out of the folder', vary((d) => { d.profiles[0].profile = '../example-lamp@1' })],
    ['a binding digest in upper case', vary((d) => { d.profiles[0].bindingDigest = 'A'.repeat(64) })],
    ['a profile without its binding digest', vary((d) => { delete d.profiles[0].bindingDigest })],
    ['a profile said to be trusted', vary((d) => { d.profiles[0].trusted = true })],
    ['a profile without a notices list', vary((d) => { delete d.profiles[0].notices })],
    ['a notice path with a dot-dot segment', vary((d) => { d.profiles[0].notices = ['../NOTICE.md'] })],
    ['an absolute notice path', vary((d) => { d.profiles[0].notices = ['/etc/passwd'] })],
    ['no licences member', vary((d) => { delete d.licences })],
    ['a licence with an empty name', vary((d) => { d.licences[0].licence = '' })],
    ['a licence text path with a backslash', vary((d) => { d.licences[0].path = 'licences\\Apache-2.0.txt' })],
    ['no omitted member', vary((d) => { delete d.omitted })],
    ['a file left out with no address', vary((d) => { delete d.omitted[0].uri })],
    ['a file left out whose address is not a URI', vary((d) => { d.omitted[0].uri = 'context.jsonld' })],
    ['a file left out with no digest', vary((d) => { delete d.omitted[0].sha256 })],
    ['a file left out of length zero', vary((d) => { d.omitted[0].byteLength = 0 })],
    ['a reason the format does not name', vary((d) => { d.omitted[0].reason = 'too-large' })],
    ['a file left out with its bytes written in', vary((d) => { d.omitted[0].bytes = 'e30=' })],
    ['an empty needed-by list', vary((d) => { d.omitted[0].requiredBy = [] })],
    ['a needed-by entry without a path', vary((d) => { delete d.omitted[0].requiredBy[0].path })],
    ['no limits member', vary((d) => { delete d.limits })],
    ['limits without the owner commitment', vary((d) => { delete d.limits.ownerCommitment })],
    ['a bundle that claims the owner commitment is established', vary((d) => { d.limits.ownerCommitment = 'established' })],
    ['a bundle that claims trust comes from its exporter', vary((d) => { d.limits.trust = 'exporter-signature' })],
    ['a bundle that claims to carry manifest profiles', vary((d) => { d.limits.profiles = 'all' })],
    ['a limit the format does not name', vary((d) => { d.limits.completeness = 'complete' })],
  ]

  it.each(positives)('both accept %s', (_name, descriptor) => {
    expect(validate(descriptor), JSON.stringify(validate.errors)).toBe(true)
    expect(profileBundleProblems(descriptor)).toEqual([])
  })

  it.each(negatives)('both refuse %s', (_name, descriptor) => {
    expect(validate(descriptor)).toBe(false)
    const problems = profileBundleProblems(descriptor)
    expect(problems.length).toBeGreaterThan(0)
    for (const sentence of problems) expect(sentence).toMatch(/\.$/)
  })

  it('names the member each problem is at', () => {
    expect(profileBundleProblems(vary((d) => { d.omitted[0].byteLength = 0 }))).toEqual(['`omitted.0.byteLength` must be a whole number of at least 1.'])
    expect(profileBundleProblems(vary((d) => { d.limits.ownerCommitment = 'established' }))).toEqual(['`limits.ownerCommitment` must be "not-established".'])
    expect(profileBundleProblems(vary((d) => { d.signature = {} }))).toEqual(['the descriptor has a member the format does not define: `signature`.'])
  })

  it('finds what a schema cannot: a profile or a licence listed twice, and a file needed by a profile the bundle does not cover', () => {
    expect(profileBundleInconsistencies(base() as ProfileBundleDescriptor)).toEqual([])
    expect(profileBundleInconsistencies(vary((d) => { d.profiles.push({ ...d.profiles[0] }) }) as ProfileBundleDescriptor)).toEqual(['the profile example-lamp@1 is listed twice.'])
    expect(profileBundleInconsistencies(vary((d) => { d.licences.push({ licence: 'Apache-2.0' }) }) as ProfileBundleDescriptor)).toEqual(['the licence Apache-2.0 is listed twice.'])
    expect(profileBundleInconsistencies(vary((d) => { d.omitted[0].requiredBy[0].profile = 'example-kettle@1' }) as ProfileBundleDescriptor)).toEqual(['https://ref.gs1.org/standards/example/context is said to be needed by example-kettle@1, which the bundle does not cover.'])
  })

  it('every descriptor an export writes satisfies both', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes, tiersBytes) })
    const descriptor = descriptorOf(bundle)
    expect(validate(descriptor), JSON.stringify(validate.errors)).toBe(true)
    expect(profileBundleProblems(descriptor)).toEqual([])
    expect(profileBundleInconsistencies(descriptor)).toEqual([])
    expect(descriptor).toEqual(bundle.descriptor)
  })
})

describe('exporting a bundle', () => {
  it('carries the binding in its exact bytes and every artefact the binding lists, each with its media type, length and SHA-256', async () => {
    const registry = await registryWith(lampBytes)
    const bundle = await exported({ registry })
    expect(bundle.root).toBe(PROFILE_BUNDLE_ROOT)
    expect([...bundle.files.keys()]).toEqual([
      'profiles/example-lamp@1/binding.json',
      'profiles/example-lamp@1/product.schema.json',
      'profiles/example-lamp@1/context.jsonld',
      'profiles/example-lamp@1/shapes.ttl',
      'profiles/example-lamp@1/background.ttl',
      'profiles/profile-bundle.json',
    ])
    // The binding file is the registered bytes, not the binding written out again.
    expect(bundle.files.get('profiles/example-lamp@1/binding.json')).toEqual(lampBytes)
    expect(sha256Hex(bundle.files.get('profiles/example-lamp@1/binding.json')!)).toBe(lampDigest)
    for (const artefact of lamp.artefacts) {
      const bytes = bundle.files.get(`profiles/example-lamp@1/${artefact.path}`)!
      expect(bytes).toEqual(utf8(SYNTHETIC_FILES[artefact.path]!))
      expect(bundle.inventory.find((entry) => entry.path === `profiles/example-lamp@1/${artefact.path}`)).toEqual({
        path: `profiles/example-lamp@1/${artefact.path}`,
        category: 'schemas',
        mediaType: artefact.mediaType,
        byteLength: artefact.byteLength,
        sha256: artefact.sha256,
        represents: `example-lamp@1#${artefact.path}`,
        representation: PROFILE_BUNDLE_REPRESENTATIONS.artefact,
      })
    }
    expect(bundle.inventory[0]).toEqual({ path: 'profiles/example-lamp@1/binding.json', category: 'schemas', mediaType: 'application/json', byteLength: lampBytes.byteLength, sha256: lampDigest, represents: 'example-lamp@1', representation: PROFILE_BUNDLE_REPRESENTATIONS.binding })
    expect(bundle.inventory.at(-1)).toMatchObject({ path: 'profiles/profile-bundle.json', category: 'schemas', mediaType: 'application/json', represents: 'profile bundle: example-lamp@1', representation: PROFILE_BUNDLE_REPRESENTATIONS.descriptor })
  })

  it('lists one inventory entry per file, with the length and digest of the bytes it carries', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes, tiersBytes) })
    expect(bundle.inventory.map((entry) => entry.path)).toEqual([...bundle.files.keys()])
    for (const entry of bundle.inventory) {
      expect(describeArtefact(bundle.files.get(entry.path)!)).toEqual({ byteLength: entry.byteLength, sha256: entry.sha256 })
      expect(entry.category).toBe('schemas')
    }
  })

  it('states which profiles it covers, what it leaves out and what it does not establish', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes, tiersBytes) })
    expect(bundle.descriptor).toEqual({
      format: 'dpp-profile-bundle',
      version: '1',
      profiles: [
        { profile: 'example-lamp@1', bindingDigest: lampDigest, notices: [] },
        { profile: 'example-lamp-tiers@1', bindingDigest: tiersDigest, notices: [] },
      ],
      // Named, and no text was given to carry.
      licences: [{ licence: 'Apache-2.0' }],
      omitted: [],
      limits: { profiles: 'bindings-only', trust: 'destination-trusted-digests', ownerCommitment: 'not-established' },
    })
    expect(bundle.manifest).toEqual({ profiles: ['example-lamp@1', 'example-lamp-tiers@1'], withheld: [] })
  })

  it('gives the same bytes for the same registry and input, the descriptor included', async () => {
    const registry = await registryWith(lampBytes, tiersBytes)
    const [first, second] = [await exported({ registry }), await exported({ registry })]
    expect([...second.files.entries()].map(([path, bytes]) => [path, sha256Hex(bytes)])).toEqual([...first.files.entries()].map(([path, bytes]) => [path, sha256Hex(bytes)]))
    expect(second.inventory).toEqual(first.inventory)
  })

  it('hands out copies: changing an exported file changes neither the registry nor a later export', async () => {
    const registry = await registryWith(lampBytes)
    const first = await exported({ registry })
    first.files.get('profiles/example-lamp@1/binding.json')!.fill(0)
    first.files.get('profiles/example-lamp@1/shapes.ttl')!.fill(0)
    const second = await exported({ registry })
    expect(second.files.get('profiles/example-lamp@1/binding.json')).toEqual(lampBytes)
    expect(second.files.get('profiles/example-lamp@1/shapes.ttl')).toEqual(utf8(SYNTHETIC_FILES['shapes.ttl']!))
  })

  it('carries the profiles named, in the order named, and each once', async () => {
    const registry = await registryWith(lampBytes, tiersBytes)
    const bundle = await exported({ registry, profiles: ['example-lamp-tiers@1', 'example-lamp-tiers@1'] })
    expect(bundle.descriptor.profiles.map((entry) => entry.profile)).toEqual(['example-lamp-tiers@1'])
    expect([...bundle.files.keys()].every((path) => !path.startsWith('profiles/example-lamp@1/'))).toBe(true)
  })

  it('sits in the folder the exporter chooses', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes), root: 'evidence/profile-definitions' })
    expect([...bundle.files.keys()].every((path) => path.startsWith('evidence/profile-definitions/'))).toBe(true)
    await expect(exportProfileBundle({ registry: await registryWith(lampBytes), root: '../outside' })).rejects.toThrow(TypeError)
    await expect(exportProfileBundle({ registry: await registryWith(lampBytes), root: '/absolute' })).rejects.toThrow(TypeError)
  })

  it('refuses, by name, what it cannot carry', async () => {
    const empty = createProfileRegistry({ trustedBindingDigests: [] })
    expect(await exportProfileBundle({ registry: empty })).toMatchObject({ ok: false, code: 'no-profile' })
    expect(await exportProfileBundle({ registry: empty, profiles: [] })).toMatchObject({ ok: false, code: 'no-profile' })
    const registry = await registryWith(lampBytes)
    expect(await exportProfileBundle({ registry, profiles: ['example-kettle@1'] })).toMatchObject({ ok: false, code: 'profile-not-registered', profile: 'example-kettle@1' })
    expect(await exportProfileBundle({ registry, profiles: ['example-lamp'] })).toMatchObject({ ok: false, code: 'profile-not-registered' })
    // A manifest-format profile ships with the package and has no binding to carry.
    expect(await exportProfileBundle({ registry, profiles: ['general@2'] })).toMatchObject({ ok: false, code: 'profile-not-bound', profile: 'general@2' })
    // A retired profile resolves to nothing, so there is nothing to carry under it.
    expect(await exportProfileBundle({ registry, profiles: ['battery@2'] })).toMatchObject({ ok: false, code: 'profile-not-registered', profile: 'battery@2' })
  })

  it('refuses a binding whose artefact would take the binding file\'s place in the folder', async () => {
    const schema = utf8(SYNTHETIC_FILES['product.schema.json']!)
    const binding = syntheticBinding()
    binding.artefacts[0] = { ...binding.artefacts[0]!, path: 'binding.json' }
    const bytes = bindingBytes(binding)
    const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(bytes)] })
    expect(await registry.register({ bindingBytes: bytes, resolveArtefact: (artefact) => (artefact.path === 'binding.json' ? schema : resolveSynthetic(artefact)) })).toMatchObject({ ok: true })
    expect(await exportProfileBundle({ registry })).toMatchObject({ ok: false, code: 'artefact-path-collision', profile: 'example-lamp@1' })
  })
})

describe('notices and licence texts travel with the files they account for', () => {
  const noticed: ProfileBinding = { ...syntheticBinding(), id: 'example-lamp-noticed', profile: 'example-lamp-noticed@1', source: { name: 'A public source', licence: 'CC-BY-4.0', notices: ['NOTICE.md', 'notices/source.txt'] } }
  const noticedBytes = bindingBytes(noticed)
  const notices: Record<string, Uint8Array> = { 'NOTICE.md': utf8('# Notice\n\nThese files come from a public source.\n'), 'notices/source.txt': utf8('Copyright the source.\n') }

  it('carries every notice the binding lists, in its exact bytes, and lists it in the descriptor', async () => {
    const asked: string[] = []
    const bundle = await exported({ registry: await registryWith(noticedBytes), readNotice: (profile, path) => { asked.push(`${profile.profile} ${path}`); return notices[path] } })
    expect(asked).toEqual(['example-lamp-noticed@1 NOTICE.md', 'example-lamp-noticed@1 notices/source.txt'])
    expect(bundle.files.get('profiles/example-lamp-noticed@1/NOTICE.md')).toEqual(notices['NOTICE.md'])
    expect(bundle.files.get('profiles/example-lamp-noticed@1/notices/source.txt')).toEqual(notices['notices/source.txt'])
    expect(bundle.descriptor.profiles).toEqual([{ profile: 'example-lamp-noticed@1', bindingDigest: sha256Hex(noticedBytes), notices: ['NOTICE.md', 'notices/source.txt'] }])
    expect(bundle.inventory.filter((entry) => entry.representation === PROFILE_BUNDLE_REPRESENTATIONS.notice).map((entry) => [entry.path, entry.mediaType, entry.represents])).toEqual([
      ['profiles/example-lamp-noticed@1/NOTICE.md', 'text/markdown', 'example-lamp-noticed@1#NOTICE.md'],
      ['profiles/example-lamp-noticed@1/notices/source.txt', 'text/plain', 'example-lamp-noticed@1#notices/source.txt'],
    ])
  })

  it('refuses the export when a listed notice cannot be read, so third-party files never leave without it', async () => {
    const registry = await registryWith(noticedBytes)
    expect(await exportProfileBundle({ registry })).toMatchObject({ ok: false, code: 'notice-unavailable', profile: 'example-lamp-noticed@1', notice: 'NOTICE.md' })
    expect(await exportProfileBundle({ registry, readNotice: (_profile, path) => (path === 'NOTICE.md' ? notices[path] : undefined) })).toMatchObject({ ok: false, code: 'notice-unavailable', notice: 'notices/source.txt' })
    const thrown = await exportProfileBundle({ registry, readNotice: () => { throw new Error('the folder is gone') } })
    expect(thrown).toMatchObject({ ok: false, code: 'notice-unavailable', notice: 'NOTICE.md' })
    expect(thrown.ok ? '' : thrown.detail).toContain('the folder is gone')
  })

  it('names every licence a carried file is under, and carries the text of each it was given', async () => {
    const registry = await registryWith(noticedBytes)
    const text = utf8('The text of the licence.\n')
    const bundle = await exported({ registry, readNotice: (_profile, path) => notices[path], licenceTexts: [{ licence: 'CC-BY-4.0', bytes: text }] })
    // The source is under one licence and the synthetic files under another: both are named, and one has its text.
    expect(bundle.descriptor.licences).toEqual([{ licence: 'CC-BY-4.0', path: 'licences/CC-BY-4.0.txt' }, { licence: 'Apache-2.0' }])
    expect(bundle.files.get('profiles/licences/CC-BY-4.0.txt')).toEqual(text)
    expect(bundle.inventory.find((entry) => entry.path === 'profiles/licences/CC-BY-4.0.txt')).toMatchObject({ category: 'schemas', mediaType: 'text/plain', represents: 'CC-BY-4.0', representation: PROFILE_BUNDLE_REPRESENTATIONS.licence })
  })

  it('carries no licence text that no carried file is under', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes), licenceTexts: [{ licence: 'MIT', bytes: utf8('MIT\n') }, { licence: 'Apache-2.0', bytes: utf8('Apache\n') }] })
    expect(bundle.descriptor.licences).toEqual([{ licence: 'Apache-2.0', path: 'licences/Apache-2.0.txt' }])
    expect([...bundle.files.keys()].filter((path) => path.startsWith('profiles/licences/'))).toEqual(['profiles/licences/Apache-2.0.txt'])
  })

  it('needs a file name for a licence whose name is not one, and refuses two texts for one licence', async () => {
    const registry = await registryWith(lampBytes)
    await expect(exportProfileBundle({ registry, licenceTexts: [{ licence: 'Proprietary, see the notice', bytes: utf8('x') }] })).rejects.toThrow(/needs a fileName/)
    await expect(exportProfileBundle({ registry, licenceTexts: [{ licence: 'Apache-2.0', bytes: utf8('x') }, { licence: 'Apache-2.0', bytes: utf8('y') }] })).rejects.toThrow(/two texts/)
    await expect(exportProfileBundle({ registry, licenceTexts: [{ licence: 'Apache-2.0', bytes: utf8('x'), fileName: '../LICENSE' }] })).rejects.toThrow(/needs a fileName/)
    // A name with a character a descriptor path does not take is given a file name, and the descriptor it writes is still one.
    await expect(exportProfileBundle({ registry, licenceTexts: [{ licence: 'GPL-3.0+', bytes: utf8('x') }] })).rejects.toThrow(/needs a fileName/)
    const plus: ProfileBinding = { ...syntheticBinding(), source: { name: 'A public source', licence: 'GPL-3.0+', notices: [] } }
    const named = await exported({ registry: await registryWith(bindingBytes(plus)), licenceTexts: [{ licence: 'GPL-3.0+', bytes: utf8('x'), fileName: 'GPL-3.0-or-later.txt' }] })
    expect(named.descriptor.licences).toEqual([{ licence: 'GPL-3.0+', path: 'licences/GPL-3.0-or-later.txt' }, { licence: 'Apache-2.0' }])
    expect(profileBundleProblems(named.descriptor)).toEqual([])
  })

  it('a restored bundle hands on the notices and licence texts it carries, so the next export is the same bundle', async () => {
    const registry = await registryWith(noticedBytes)
    const first = await exported({ registry, readNotice: (_profile, path) => notices[path], licenceTexts: [{ licence: 'CC-BY-4.0', bytes: utf8('The text of the licence.\n') }] })
    const restored = await opened(profileBundleFiles(first.files))
    expect(await restored.noticeBytes('example-lamp-noticed@1', 'NOTICE.md')).toEqual(notices['NOTICE.md'])
    // Only a notice the descriptor lists is read: not the binding, not an artefact, not another profile's file.
    expect(await restored.noticeBytes('example-lamp-noticed@1', 'binding.json')).toBeUndefined()
    expect(await restored.noticeBytes('example-lamp-noticed@1', 'shapes.ttl')).toBeUndefined()
    expect(await restored.noticeBytes('example-kettle@1', 'NOTICE.md')).toBeUndefined()
    expect(await restored.licenceTexts()).toEqual([{ licence: 'CC-BY-4.0', bytes: utf8('The text of the licence.\n'), fileName: 'CC-BY-4.0.txt' }])

    const second = createProfileRegistry({ trustedBindingDigests: [sha256Hex(noticedBytes)] })
    expect(await registerProfileBundle(second, restored)).toMatchObject([{ ok: true }])
    const again = await exported({ registry: second, readNotice: (profile, path) => restored.noticeBytes(profile.profile, path), licenceTexts: await restored.licenceTexts() })
    expect(again.inventory).toEqual(first.inventory)
    for (const [path, bytes] of again.files) expect(bytes, path).toEqual(first.files.get(path))
  })

  it('carries every selected sector version under its own name with the original artefacts, notices and licence', async () => {
    const entries = BUNDLED_BINDINGS
    const registry = createProfileRegistry({ trustedBindingDigests: entries.map((entry) => entry.bindingDigest) })
    for (const result of await registerBundledBindings(registry, { profiles: entries.map((entry) => entry.profile) })) expect(result).toMatchObject({ ok: true })
    const bundle = await exported({ registry, readNotice: bundledBindingNotices(), licenceTexts: bundledBindingLicenceTexts() })
    for (const entry of entries) {
      const { profile, bindingDigest } = entry
      const folder = join(packageRoot, 'bindings', 'artefactDirectory' in entry ? entry.artefactDirectory : profile)
      const bytes = readFileSync(join(folder, 'artefactDirectory' in entry ? 'binding.v2.json' : 'binding.json'))
      const binding = JSON.parse(bytes.toString()) as ProfileBinding
      expect(bundle.files.get(`profiles/${profile}/binding.json`)).toEqual(new Uint8Array(bytes))
      for (const name of ['NOTICE.md', ...binding.artefacts.map((artefact) => artefact.path)]) {
        expect(bundle.files.get(`profiles/${profile}/${name}`), `${profile}/${name}`).toEqual(new Uint8Array(readFileSync(join(folder, name))))
      }
      expect(bundle.descriptor.profiles.find((item) => item.profile === profile)).toEqual({ profile, bindingDigest, notices: ['NOTICE.md'] })
    }
    const restored = await opened(profileBundleFiles(bundle.files))
    const destination = createProfileRegistry({ trustedBindingDigests: CURRENT_SECTOR_BINDINGS.map((entry) => entry.bindingDigest) })
    expect(await registerProfileBundle(destination, restored, { profiles: CURRENT_SECTOR_BINDINGS.map((entry) => entry.profile), expected: entries })).toMatchObject([{ ok: true }, { ok: true }])
    expect(bundle.descriptor.licences).toEqual([{ licence: BUNDLED_BINDING_LICENCE, path: 'licences/Apache-2.0.txt' }])
    expect(bundle.files.get('profiles/licences/Apache-2.0.txt')).toEqual(new Uint8Array(readFileSync(join(packageRoot, 'LICENSE'))))
    expect(new TextDecoder().decode(bundle.files.get('profiles/licences/Apache-2.0.txt'))).toContain('Apache License')
    // Nothing in either bundled binding is a file GS1 publishes, so nothing is left out.
    expect(bundle.descriptor.omitted).toEqual([])
  })

  it('the bundled notice reader answers only for the bundled bindings as the package pins them', () => {
    const read = bundledBindingNotices()
    const battery = BUNDLED_BINDINGS[0]
    expect(read(battery, 'NOTICE.md')).toEqual(new Uint8Array(readFileSync(join(packageRoot, 'bindings', battery.profile, 'NOTICE.md'))))
    expect(read({ profile: 'example-lamp@1', bindingDigest: lampDigest }, 'NOTICE.md')).toBeUndefined()
    // The bundled name over other bytes is not the bundled binding, and the package's notice does not account for it.
    expect(read({ profile: battery.profile, bindingDigest: lampDigest }, 'NOTICE.md')).toBeUndefined()
    expect(read(battery, 'MISSING.md')).toBeUndefined()
    expect(read(battery, '../eu-textile@1/NOTICE.md')).toBeUndefined()
    expect(() => bundledBindingNotices({ directory: '/tmp/bindings' as unknown as URL })).toThrow(TypeError)
  })
})

describe('files that are named and never carried', () => {
  // A context at an address GS1 publishes at. Its bytes are written for this test and are no file of GS1's.
  const gs1Context = utf8(JSON.stringify({ '@context': { id: '@id', lamp: 'https://profiles.example/lamp/v1#', name: 'lamp:name', lumens: 'lamp:lumens' } }, null, 1))
  const GS1_URI = 'https://ref.gs1.org/standards/example/example-context.jsonld'
  const withGs1 = (): ProfileBinding => {
    const binding = syntheticBinding()
    binding.id = 'example-lamp-gs1'
    binding.profile = 'example-lamp-gs1@1'
    binding.artefacts[1] = { role: 'context', path: 'gs1-example-context.jsonld', uri: GS1_URI, mediaType: 'application/ld+json', byteLength: gs1Context.byteLength, sha256: sha256Hex(gs1Context), licence: 'Apache-2.0' }
    return binding
  }
  const gs1Bytes = bindingBytes(withGs1())
  const resolve = (artefact: BindingArtefact): Uint8Array | undefined => (artefact.path === 'gs1-example-context.jsonld' ? gs1Context : resolveSynthetic(artefact))
  const registryWithGs1 = async (): Promise<ProfileRegistry> => {
    const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(gs1Bytes)] })
    expect(await registry.register({ bindingBytes: gs1Bytes, resolveArtefact: resolve })).toMatchObject({ ok: true })
    return registry
  }

  it('an artefact published at a GS1 address is named by address and digest, and its bytes are not in the bundle', async () => {
    const bundle = await exported({ registry: await registryWithGs1() })
    expect([...bundle.files.keys()]).toEqual([
      'profiles/example-lamp-gs1@1/binding.json',
      'profiles/example-lamp-gs1@1/product.schema.json',
      'profiles/example-lamp-gs1@1/shapes.ttl',
      'profiles/example-lamp-gs1@1/background.ttl',
      'profiles/profile-bundle.json',
    ])
    const omission = { uri: GS1_URI, sha256: sha256Hex(gs1Context), byteLength: gs1Context.byteLength, reason: 'provisioned-by-destination', requiredBy: [{ profile: 'example-lamp-gs1@1', path: 'gs1-example-context.jsonld' }] }
    expect(bundle.descriptor.omitted).toEqual([omission])
    expect(bundle.manifest.withheld).toEqual([`provisioned-by-destination ${GS1_URI} sha256:${sha256Hex(gs1Context)} bytes:${gs1Context.byteLength}`])
    expect(describeProfileBundleOmission(bundle.descriptor.omitted[0]!)).toBe(bundle.manifest.withheld[0])
    // No file of the bundle holds the bytes, under any name.
    const digests = [...bundle.files.values()].map(sha256Hex)
    expect(digests).not.toContain(sha256Hex(gs1Context))
    expect(bundle.inventory.map((entry) => entry.sha256)).not.toContain(sha256Hex(gs1Context))
  })

  it.each(['https://gs1.org/voc/example', 'https://www.gs1.org/standards/example', 'https://REF.GS1.ORG/standards/example', 'http://id.gs1.org/context'])('treats %s as a GS1 address', async (uri) => {
    const binding = withGs1()
    binding.artefacts[1]!.uri = uri
    const bytes = bindingBytes(binding)
    const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(bytes)] })
    expect(await registry.register({ bindingBytes: bytes, resolveArtefact: resolve })).toMatchObject({ ok: true })
    const bundle = await exported({ registry })
    expect(bundle.descriptor.omitted.map((entry) => entry.uri)).toEqual([uri])
    expect(bundle.files.has('profiles/example-lamp-gs1@1/gs1-example-context.jsonld')).toBe(false)
  })

  it.each(['https://vocabulary.example/extensions/common/core/gs1-shortcuts-context.jsonld', 'https://gs1.org.example/context', 'https://notgs1.org/context', 'https://profiles.example/gs1.org/context'])('does not take %s for a GS1 address', async (uri) => {
    const binding = withGs1()
    binding.artefacts[1]!.uri = uri
    const bytes = bindingBytes(binding)
    const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(bytes)] })
    expect(await registry.register({ bindingBytes: bytes, resolveArtefact: resolve })).toMatchObject({ ok: true })
    const bundle = await exported({ registry })
    expect(bundle.descriptor.omitted).toEqual([])
    expect(bundle.files.get('profiles/example-lamp-gs1@1/gs1-example-context.jsonld')).toEqual(gs1Context)
  })

  it('an artefact with the digest of a file the deployment provisions is named by that file\'s address, whatever its role', async () => {
    const background = utf8(SYNTHETIC_FILES['background.ttl']!)
    const pinned = { uri: 'https://publisher.example/vocabulary/background.ttl', sha256: sha256Hex(background), byteLength: background.byteLength }
    const bundle = await exported({ registry: await registryWith(lampBytes), provisioned: [pinned] })
    expect(bundle.files.has('profiles/example-lamp@1/background.ttl')).toBe(false)
    expect(bundle.descriptor.omitted).toEqual([{ ...pinned, reason: 'provisioned-by-destination', requiredBy: [{ profile: 'example-lamp@1', path: 'background.ttl' }] }])
  })

  it('names the files the exporter lists for the deployment, such as the pinned GS1 tables, though no binding needs them', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes), provisioned: GS1_RESOLVER_ARTEFACTS })
    expect(bundle.descriptor.omitted).toEqual(GS1_RESOLVER_ARTEFACTS.map(({ uri, sha256, byteLength }) => ({ uri, sha256, byteLength, reason: 'provisioned-by-destination' })))
    expect(bundle.manifest.withheld).toEqual(GS1_RESOLVER_ARTEFACTS.map((artefact) => `provisioned-by-destination ${artefact.uri} sha256:${artefact.sha256} bytes:${artefact.byteLength}`))
    // Every file of the bundle is still the lamp's own.
    expect([...bundle.files.keys()].length).toBe(6)
  })

  it('the package\'s own GS1 table is matched without being asked for', async () => {
    // A binding that lists a file under the digest of a pinned GS1 file. The bytes here are not GS1's: the registry
    // is made to accept them by a stand-in, because the point is what the export does with that digest.
    const pinned = GS1_RESOLVER_ARTEFACTS[0]
    const binding = syntheticBinding()
    binding.artefacts[3] = { ...binding.artefacts[3]!, sha256: pinned.sha256, byteLength: pinned.byteLength }
    const bytes = bindingBytes(binding)
    const standIn: ProfileRegistry = {
      register: async () => { throw new Error('not used') },
      resolve: () => ({ format: 'binding', id: binding.id, version: 1, profile: binding.profile, bindingDigest: sha256Hex(bytes), bindingBytes: bytes, binding, artefacts: binding.artefacts.map((artefact) => ({ artefact, bytes: utf8(SYNTHETIC_FILES[artefact.path]!) })) }),
      status: () => { throw new Error('not used') },
      list: () => [],
    }
    const bundle = await exported({ registry: standIn, profiles: [binding.profile] })
    expect(bundle.files.has('profiles/example-lamp@1/background.ttl')).toBe(false)
    expect(bundle.descriptor.omitted).toEqual([{ uri: pinned.uri, sha256: pinned.sha256, byteLength: pinned.byteLength, reason: 'provisioned-by-destination', requiredBy: [{ profile: 'example-lamp@1', path: 'background.ttl' }] }])
  })

  it('refuses a provisioned entry that is not an address, a digest and a length', async () => {
    const registry = await registryWith(lampBytes)
    await expect(exportProfileBundle({ registry, provisioned: [{ uri: 'background.ttl', sha256: 'a'.repeat(64), byteLength: 1 }] })).rejects.toThrow(TypeError)
    await expect(exportProfileBundle({ registry, provisioned: [{ uri: 'https://publisher.example/x', sha256: 'abc', byteLength: 1 }] })).rejects.toThrow(TypeError)
    await expect(exportProfileBundle({ registry, provisioned: [{ uri: 'https://publisher.example/x', sha256: 'a'.repeat(64), byteLength: 0 }] })).rejects.toThrow(TypeError)
  })

  it('a restored deployment supplies the named file itself, and the registry holds it to the binding\'s digest', async () => {
    const bundle = await exported({ registry: await registryWithGs1() })
    const restored = await opened(profileBundleFiles(bundle.files))
    const trusting = (): ProfileRegistry => createProfileRegistry({ trustedBindingDigests: [sha256Hex(gs1Bytes)] })

    // Not supplied: the profile is not registered, and the refusal says what to obtain.
    const without = trusting()
    const [missing] = await registerProfileBundle(without, restored)
    expect(missing).toMatchObject({ ok: false, code: 'bundle-artefact-not-provisioned', profile: 'example-lamp-gs1@1', artefact: 'gs1-example-context.jsonld', registration: { code: 'artefact-unavailable' } })
    expect(without.resolve('example-lamp-gs1', 1)).toBeUndefined()

    // Supplied with other bytes: refused by the digest the binding records.
    const wrong = trusting()
    const [altered] = await registerProfileBundle(wrong, restored, { provisioned: () => utf8('{"@context":{}}') })
    expect(altered).toMatchObject({ ok: false, code: 'bundle-artefact-altered', artefact: 'gs1-example-context.jsonld' })
    expect(wrong.resolve('example-lamp-gs1', 1)).toBeUndefined()

    // Supplied as pinned: registered, with the same bytes the first deployment held.
    const asked: string[] = []
    const right = trusting()
    const [accepted] = await registerProfileBundle(right, restored, { provisioned: (artefact) => { asked.push(`${artefact.path} ${artefact.uri}`); return gs1Context } })
    expect(accepted).toMatchObject({ ok: true, alreadyRegistered: false, profile: { profile: 'example-lamp-gs1@1', bindingDigest: sha256Hex(gs1Bytes) } })
    // Only the file the bundle does not hold is asked of the deployment.
    expect(asked).toEqual([`gs1-example-context.jsonld ${GS1_URI}`])
    const held = right.resolve('example-lamp-gs1', 1)
    expect(held?.format === 'binding' ? held.artefacts.map((entry) => sha256Hex(entry.bytes)) : []).toEqual(withGs1().artefacts.map((artefact) => artefact.sha256))
  })
})

describe('reading a bundle', () => {
  it('reads the same bundle from memory and from a folder on disk', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes, tiersBytes) })
    const folder = scratch()
    writeTo(folder, bundle.files)
    for (const source of [profileBundleFiles(bundle.files), profileBundleDirectory(folder), profileBundleDirectory(pathToFileURL(folder))]) {
      const restored = await opened(source)
      expect(restored.root).toBe('profiles')
      expect(restored.profiles).toEqual(['example-lamp@1', 'example-lamp-tiers@1'])
      expect(restored.descriptor).toEqual(bundle.descriptor)
      expect(await restored.bindingBytes('example-lamp@1')).toEqual(lampBytes)
      expect(await restored.bindingBytes('example-lamp-tiers@1')).toEqual(tiersBytes)
      for (const artefact of lamp.artefacts) expect(await restored.resolverFor('example-lamp@1')(artefact)).toEqual(utf8(SYNTHETIC_FILES[artefact.path]!))
      // A profile the bundle does not list reads nothing, whatever the folder holds.
      expect(await restored.bindingBytes('example-kettle@1')).toBeUndefined()
      expect(await restored.resolverFor('example-kettle@1')(lamp.artefacts[0]!)).toBeUndefined()
      expect(await restored.resolverFor('example-lamp@1')({ ...lamp.artefacts[0]!, path: 'missing.json' })).toBeUndefined()
    }
  })

  it('takes the files as the protocol package holds them, as arrays of numbers', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes) })
    const asNumbers = new Map([...bundle.files].map(([path, bytes]) => [path, Array.from(bytes)]))
    const restored = await opened(profileBundleFiles(asNumbers))
    const bytes = await restored.bindingBytes('example-lamp@1')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes).toEqual(lampBytes)
  })

  it('reads a bundle that sits in another folder of the package when told where', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes), root: 'evidence/profile-definitions' })
    expect(await openProfileBundle(profileBundleFiles(bundle.files))).toMatchObject({ ok: false, code: 'bundle-descriptor-missing' })
    expect((await opened(profileBundleFiles(bundle.files), { root: 'evidence/profile-definitions' })).profiles).toEqual(['example-lamp@1'])
  })

  it('a folder source opens nothing outside its folder', async () => {
    const outer = scratch()
    const folder = join(outer, 'package')
    mkdirSync(folder)
    writeFileSync(join(outer, 'secret.txt'), 'outside')
    writeFileSync(join(folder, 'inside.txt'), 'inside')
    const source = profileBundleDirectory(folder)
    expect(new TextDecoder().decode(await source('inside.txt'))).toBe('inside')
    for (const path of ['../secret.txt', 'a/../../secret.txt', '/etc/hosts', join(outer, 'secret.txt'), 'inside.txt/..', '', '.', 'a\\..\\..\\secret.txt']) expect(await source(path), path).toBeUndefined()
    expect(await source('missing.txt')).toBeUndefined()
    // A folder where a file was asked for is not a file.
    mkdirSync(join(folder, 'nested'))
    expect(await source('nested')).toBeUndefined()
    expect(() => profileBundleDirectory(new URL('https://bundles.example/package/'))).toThrow(TypeError)
    expect(() => profileBundleDirectory('')).toThrow(TypeError)
  })

  it('a folder source reads a link as the file it points to, and the registry still holds the bytes to the binding', async () => {
    // A link cannot make a registry accept other bytes: what is read is checked against the digest whatever its path.
    const bundle = await exported({ registry: await registryWith(lampBytes) })
    const folder = scratch()
    writeTo(folder, bundle.files)
    const other = join(folder, 'other-shapes.ttl')
    writeFileSync(other, '# other shapes\n')
    rmSync(join(folder, 'profiles', 'example-lamp@1', 'shapes.ttl'))
    symlinkSync(other, join(folder, 'profiles', 'example-lamp@1', 'shapes.ttl'))
    const registry = createProfileRegistry({ trustedBindingDigests: [lampDigest] })
    const [result] = await registerProfileBundle(registry, await opened(profileBundleDirectory(folder)))
    expect(result).toMatchObject({ ok: false, code: 'bundle-artefact-altered', artefact: 'shapes.ttl' })
  })

  it('refuses a folder with no descriptor, and a descriptor it cannot read as one', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes) })
    const at = 'profiles/profile-bundle.json'
    const withDescriptor = (bytes: Uint8Array | undefined): ReturnType<typeof profileBundleFiles> => {
      const files = new Map(bundle.files)
      if (bytes == null) files.delete(at)
      else files.set(at, bytes)
      return profileBundleFiles(files)
    }
    const text = new TextDecoder().decode(bundle.files.get(at))
    expect(await openProfileBundle(withDescriptor(undefined))).toMatchObject({ ok: false, code: 'bundle-descriptor-missing' })
    expect(await openProfileBundle(() => { throw new Error('the disk is gone') })).toMatchObject({ ok: false, code: 'bundle-descriptor-missing' })
    expect(await openProfileBundle(withDescriptor(new Uint8Array([0xff, 0xfe])))).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
    expect(await openProfileBundle(withDescriptor(utf8('not json')))).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
    // One member name twice: two readers could otherwise read two descriptors.
    expect(await openProfileBundle(withDescriptor(utf8(text.replace('"version": "1",', '"version": "1", "version": "1",'))))).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
    expect(await openProfileBundle(withDescriptor(utf8(text.replace('"not-established"', '"established"'))))).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
    const twice = JSON.parse(text) as ProfileBundleDescriptor
    twice.profiles.push({ ...twice.profiles[0]! })
    const refused = await openProfileBundle(withDescriptor(utf8(JSON.stringify(twice))))
    expect(refused).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
    expect(refused.ok ? '' : refused.detail).toContain('listed twice')
  })
})

describe('a bundle in an evidence package', () => {
  const exporter = PrivateKey.fromString('07'.padStart(64, '0'), 'hex')
  const passportId = 'https://passports.example/01/09523000000012/21/LAMP-0001'
  const manifestSchema = jsonOf<Record<string, unknown>>(join(repo, 'contracts', 'evidence-package.schema.json'))

  it('is listed in the manifest with the existing vocabulary, and the package inspects on all three questions', async () => {
    const bundle = await exported({ registry: await registryWith(lampBytes, tiersBytes), provisioned: GS1_RESOLVER_ARTEFACTS })
    // The entries are inventory entries as the protocol package types them: nothing is converted.
    const inventory: InventoryEntry[] = bundle.inventory
    const signingKey = evidencePackageSigningKey(exporter, passportId)
    const unsigned: UnsignedEvidenceManifest = {
      format: 'dpp-evidence-package',
      version: '1',
      passportId,
      exportedAt: '2026-11-15T00:00:00Z',
      exporter: { id: exporter.toPublicKey().toString(), role: 'registry' },
      profiles: bundle.manifest.profiles,
      disclosure: { scope: 'public', recoveryBackup: false },
      completeness: { snapshots: [], withheld: bundle.manifest.withheld, absent: [] },
      sources: [],
      inventory,
      signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
    }
    const manifest = await signEvidenceManifest(unsigned, { sign: (preimage) => signingKey.sign(preimage).toDER() as number[] })

    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(manifestSchema)
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true)

    const files = new Map([...bundle.files].map(([path, bytes]) => [path, Array.from(bytes)]))
    const inspection = inspectEvidencePackage(manifest, files, { expectedPassportId: passportId, expectedSigner: evidencePackageSigner(exporter.toPublicKey().toString(), passportId) })
    expect(inspection).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [], recoveryBackup: false })
    // What the bundle leaves out is declared in the manifest's own words for it.
    expect(inspection.declaredWithheld).toEqual(bundle.manifest.withheld)
    expect(inspection.declaredWithheld.length).toBe(GS1_RESOLVER_ARTEFACTS.length)

    // The files the package was inspected with are the files the bundle is read from.
    const restored = await opened(profileBundleFiles(files))
    const registry = createProfileRegistry({ trustedBindingDigests: [lampDigest, tiersDigest] })
    expect(await registerProfileBundle(registry, restored)).toMatchObject([{ ok: true, profile: { profile: 'example-lamp@1' } }, { ok: true, profile: { profile: 'example-lamp-tiers@1' } }])
  })
})
