import { beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PrivateKey } from '@bsv/sdk'
import { evidencePackageSigner, evidencePackageSigningKey, inspectEvidencePackage, signEvidenceManifest, type EvidencePackageManifest } from '@bsv/dpp-protocol'
import {
  PROFILE_BUNDLE_DESCRIPTOR,
  bindingPayloadValidator,
  createProfileRegistry,
  exportProfileBundle,
  openProfileBundle,
  profileBundleFiles,
  registerProfileBundle,
  type BindingArtefact,
  type BindingValidationDetail,
  type ExportedProfileBundle,
  type OpenedProfileBundle,
  type PayloadValidation,
  type ProfileBinding,
  type ProfileBundleDescriptor,
  type ProfileRegistry,
  type ValidationEngines,
} from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticAccessBinding, syntheticBinding, utf8 } from './binding-fixture.js'

// Trust at restore. A deployment that restores profiles from a package it
// was handed registers them through its own registry, against its own
// trusted digests. The exporter's signature on the package says who
// assembled the bytes and nothing about who may define a profile, so every
// package below is signed correctly, inspects as valid on all three
// questions, and is refused all the same.
//
// The profile is the synthetic lamp with two tiers. `lumens` and `batch` are
// restricted in the binding the destination trusts.
const GTIN = '09523000000012'
const ID = `https://id.example/01/${GTIN}/21/LAMP-0001`
const passportId = `https://passports.example/01/${GTIN}/21/LAMP-0001`

const genuine = syntheticAccessBinding()
const genuineBytes = bindingBytes(genuine)
const genuineDigest = sha256Hex(genuineBytes)
const PROFILE = genuine.profile

/** The same profile name over a binding that lets more through: `lumens` made public, and the shapes no longer run. */
const permissive: ProfileBinding = {
  ...syntheticAccessBinding(),
  artefacts: syntheticAccessBinding().artefacts.filter((artefact) => artefact.role === 'schema' || artefact.role === 'context'),
  validation: { steps: ['json-schema', 'json-ld-expand', 'passport-identity'], engine: { requires: ['json-schema-2020-12'] }, blockingSeverities: ['Violation'] },
  access: { ...syntheticAccessBinding().access!, public: [...syntheticAccessBinding().access!.public, 'lumens'] },
}
const permissiveBytes = bindingBytes(permissive)
const permissiveDigest = sha256Hex(permissiveBytes)

const exporter = PrivateKey.fromString('0b'.padStart(64, '0'), 'hex')
const exporterIdentity = exporter.toPublicKey().toString()

interface Package { manifest: EvidencePackageManifest; files: Map<string, number[]>; bundle: ExportedProfileBundle }

/** A package as an exporter assembles it: the bundle's files under a manifest the exporter signs with its derived key for the passport. */
async function packageOf(bundle: ExportedProfileBundle, files: ReadonlyMap<string, Uint8Array> = bundle.files): Promise<Package> {
  const signingKey = evidencePackageSigningKey(exporter, passportId)
  const describe = (bytes: Uint8Array): { byteLength: number; sha256: string } => ({ byteLength: bytes.byteLength, sha256: sha256Hex(bytes) })
  // The inventory is taken over the files as they are packaged, so a file changed before signing is listed as it is.
  const inventory = bundle.inventory.filter((entry) => files.has(entry.path)).map((entry) => ({ ...entry, ...describe(files.get(entry.path)!) }))
  const manifest = await signEvidenceManifest({
    format: 'dpp-evidence-package',
    version: '1',
    passportId,
    exportedAt: '2026-11-15T00:00:00Z',
    exporter: { id: exporterIdentity, role: 'registry' },
    profiles: bundle.manifest.profiles,
    disclosure: { scope: 'public', recoveryBackup: false },
    completeness: { snapshots: [], withheld: bundle.manifest.withheld, absent: [] },
    sources: [],
    inventory,
    signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
  }, { sign: (preimage) => signingKey.sign(preimage).toDER() as number[] })
  return { manifest, files: new Map([...files].map(([path, bytes]) => [path, Array.from(bytes)])), bundle }
}

/** The package is exactly what its exporter signed: structure, inventory and signature all hold, under the expected signer. */
const expectCorrectlySigned = (pack: Package): void => {
  expect(inspectEvidencePackage(pack.manifest, pack.files, { expectedPassportId: passportId, expectedSigner: evidencePackageSigner(exporterIdentity, passportId) })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [] })
}

const exported = async (registry: ProfileRegistry): Promise<ExportedProfileBundle> => {
  const result = await exportProfileBundle({ registry })
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
  return result
}
const opened = async (pack: Package): Promise<OpenedProfileBundle> => {
  const result = await openProfileBundle(profileBundleFiles(pack.files))
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
  return result.bundle
}
const registryWith = async (bytes: Uint8Array, resolve: (artefact: BindingArtefact) => Uint8Array | undefined = resolveSynthetic): Promise<ProfileRegistry> => {
  const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(bytes)] })
  expect(await registry.register({ bindingBytes: bytes, resolveArtefact: resolve })).toMatchObject({ ok: true })
  return registry
}
/** The destination: a registry that trusts the genuine binding and nothing else. */
const destination = (): ProfileRegistry => createProfileRegistry({ trustedBindingDigests: [genuineDigest] })

/** The descriptor of a package rewritten, as someone who can sign the package can rewrite it. */
const withDescriptor = (bundle: ExportedProfileBundle, change: (descriptor: ProfileBundleDescriptor) => void, files: Map<string, Uint8Array> = new Map(bundle.files)): Map<string, Uint8Array> => {
  const at = `${bundle.root}/${PROFILE_BUNDLE_DESCRIPTOR}`
  const descriptor = JSON.parse(new TextDecoder().decode(files.get(at)!)) as ProfileBundleDescriptor
  change(descriptor)
  files.set(at, utf8(`${JSON.stringify(descriptor, null, 2)}\n`))
  return files
}

let engines: ValidationEngines
let genuinePackage: Package
let substitutedPackage: Package
beforeAll(async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  engines = { jsonSchema: ajv, ...(await createValidationEngine()) }
  genuinePackage = await packageOf(await exported(await registryWith(genuineBytes)))
  // Whoever holds the exporter's key can register any binding in a registry of their own and export it under the same name.
  substitutedPackage = await packageOf(await exported(await registryWith(permissiveBytes)))
})

const payloadOf = (product: Record<string, unknown>, bindingDigest: string): string => JSON.stringify({ profile: genuine.id, profile_version: genuine.version, profile_binding_sha256: bindingDigest, product })
const publicProduct = { '@context': SYNTHETIC_CONTEXT_URI, id: ID, name: 'Desk lamp' }
/** A public payload that discloses `lumens`, which the trusted binding keeps restricted. */
const disclosing = { ...publicProduct, lumens: 800 }
const validateWith = (registry: ProfileRegistry, payloadPublic: string): Promise<PayloadValidation> => bindingPayloadValidator({ registry, engines })({ profile: genuine.id, profileVersion: genuine.version, payloadPublic, passportId })
const detailOf = (result: PayloadValidation): BindingValidationDetail => result.detail as BindingValidationDetail

describe('the substituted binding is a real attack, not a spelling difference', () => {
  it('keeps the name, changes the digest, and lets through what the trusted binding refuses', async () => {
    expect(permissive.profile).toBe(PROFILE)
    expect(permissiveDigest).not.toBe(genuineDigest)

    // Under the trusted binding, a public payload that discloses a restricted property fails.
    const trusted = await registryWith(genuineBytes)
    expect(await validateWith(trusted, payloadOf(disclosing, genuineDigest))).toMatchObject({ status: 'fail', detail: { cause: 'restricted-property-disclosed' } })

    // In a registry that had been made to accept the substitute, the same disclosure passes, and no shape is asked.
    const fooled = await registryWith(permissiveBytes)
    const result = await validateWith(fooled, payloadOf(disclosing, permissiveDigest))
    expect(result.status, JSON.stringify(result.detail)).toBe('pass')
    expect(detailOf(result).steps.map((step) => step.step)).toEqual(['envelope', 'binding', 'access', 'json-schema', 'json-ld-expand', 'passport-identity'])
  })
})

describe('a correctly signed package that carries a substituted, more permissive binding is refused', () => {
  it('the package is what its exporter signed', () => {
    expectCorrectlySigned(genuinePackage)
    expectCorrectlySigned(substitutedPackage)
    expect(substitutedPackage.bundle.descriptor.profiles).toEqual([{ profile: PROFILE, bindingDigest: permissiveDigest, notices: [] }])
  })

  it('is refused as untrusted by a destination whose trusted list does not hold its digest', async () => {
    const registry = destination()
    const [result] = await registerProfileBundle(registry, await opened(substitutedPackage))
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-untrusted', profile: PROFILE, bindingDigest: permissiveDigest, registration: { ok: false, code: 'binding-untrusted', bindingDigest: permissiveDigest } })
    expect(result!.ok ? '' : result!.detail).toContain('gives a binding no authority')
    // Nothing was registered, so a payload under the profile cannot pass here.
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
    expect(registry.list().filter((profile) => profile.format === 'binding')).toEqual([])
    expect(await validateWith(registry, payloadOf(disclosing, permissiveDigest))).toMatchObject({ status: 'unknown', detail: { cause: 'profile-unknown' } })
    expect(await validateWith(registry, payloadOf(publicProduct, genuineDigest))).toMatchObject({ status: 'unknown', detail: { cause: 'profile-unknown' } })
  })

  it('is refused as substituted where the destination expects another binding for that profile, before the registry is asked', async () => {
    let asked = 0
    const inner = destination()
    const counting: ProfileRegistry = { ...inner, register: (input) => { asked += 1; return inner.register(input) } }
    const [result] = await registerProfileBundle(counting, await opened(substitutedPackage), { expected: [{ profile: PROFILE, bindingDigest: genuineDigest }] })
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-substituted', profile: PROFILE, bindingDigest: permissiveDigest })
    expect(result!.ok ? '' : result!.detail).toContain(genuineDigest)
    expect('registration' in result!).toBe(false)
    expect(asked).toBe(0)
    expect(inner.resolve(genuine.id, genuine.version)).toBeUndefined()
  })

  it('is refused as substituted where the destination already holds the profile, and the held binding stays as it was', async () => {
    const registry = destination()
    expect(await registerProfileBundle(registry, await opened(genuinePackage))).toMatchObject([{ ok: true, alreadyRegistered: false }])
    const [result] = await registerProfileBundle(registry, await opened(substitutedPackage))
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-substituted', bindingDigest: permissiveDigest })
    const held = registry.resolve(genuine.id, genuine.version)
    expect(held).toMatchObject({ format: 'binding', bindingDigest: genuineDigest })
    expect(await validateWith(registry, payloadOf(disclosing, genuineDigest))).toMatchObject({ status: 'fail', detail: { cause: 'restricted-property-disclosed' } })
  })

  it('an expected digest narrows what is accepted and never widens it', async () => {
    // Expecting the substitute does not make it trusted: the registry's own list still decides.
    const registry = destination()
    const [result] = await registerProfileBundle(registry, await opened(substitutedPackage), { expected: [{ profile: PROFILE, bindingDigest: permissiveDigest }] })
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-untrusted' })
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
    // And a trusted binding is refused where another was expected.
    const [other] = await registerProfileBundle(destination(), await opened(genuinePackage), { expected: [{ profile: PROFILE, bindingDigest: permissiveDigest }] })
    expect(other).toMatchObject({ ok: false, code: 'bundle-binding-substituted', bindingDigest: genuineDigest })
    await expect(registerProfileBundle(destination(), await opened(genuinePackage), { expected: [{ profile: PROFILE, bindingDigest: genuineDigest }, { profile: PROFILE, bindingDigest: permissiveDigest }] })).rejects.toThrow(/has one/)
    await expect(registerProfileBundle(destination(), await opened(genuinePackage), { expected: [{ profile: PROFILE, bindingDigest: 'abc' }] })).rejects.toThrow(TypeError)
  })

  it('nothing the package says of itself makes the binding trusted', async () => {
    // A descriptor that names the genuine digest over the substituted file contradicts the file, and is refused for that.
    const relabelled = await packageOf(substitutedPackage.bundle, withDescriptor(substitutedPackage.bundle, (descriptor) => { descriptor.profiles[0]!.bindingDigest = genuineDigest }))
    expectCorrectlySigned(relabelled)
    const [result] = await registerProfileBundle(destination(), await opened(relabelled))
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-mismatch', bindingDigest: permissiveDigest })
    // The format has no member for a claim of trust: a descriptor that carries one is not a descriptor.
    const claiming = await packageOf(substitutedPackage.bundle, withDescriptor(substitutedPackage.bundle, (descriptor) => { (descriptor as unknown as Record<string, unknown>).trustedBindingDigests = [permissiveDigest] }))
    expectCorrectlySigned(claiming)
    expect(await openProfileBundle(profileBundleFiles(claiming.files))).toMatchObject({ ok: false, code: 'bundle-descriptor-invalid' })
  })

  it('the genuine package from the same exporter registers, so the refusals above are about the binding and not the exporter', async () => {
    const registry = destination()
    expect(await registerProfileBundle(registry, await opened(genuinePackage))).toMatchObject([{ ok: true, alreadyRegistered: false, profile: { profile: PROFILE, bindingDigest: genuineDigest } }])
    expect(await registerProfileBundle(registry, await opened(genuinePackage))).toMatchObject([{ ok: true, alreadyRegistered: true }])
  })
})

describe('a record commits to its binding, and a restored binding that is not that one fails as it always has', () => {
  it('a payload that declares the trusted digest fails against a substituted binding, even in a registry that accepted it', async () => {
    const fooled = createProfileRegistry({ trustedBindingDigests: [permissiveDigest] })
    expect(await registerProfileBundle(fooled, await opened(substitutedPackage))).toMatchObject([{ ok: true }])
    const result = await validateWith(fooled, payloadOf(publicProduct, genuineDigest))
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid', detail: { cause: 'profile-binding-mismatch', bindingDigest: permissiveDigest } })
    expect(detailOf(result).steps).toMatchObject([{ step: 'envelope', status: 'pass' }, { step: 'binding', status: 'fail' }])
  })

  it('and passes its binding check against the binding restored from the genuine package', async () => {
    const registry = destination()
    await registerProfileBundle(registry, await opened(genuinePackage))
    const result = await validateWith(registry, payloadOf(publicProduct, genuineDigest))
    expect(detailOf(result).steps.slice(0, 3)).toMatchObject([{ step: 'envelope', status: 'pass' }, { step: 'binding', status: 'pass' }, { step: 'access', status: 'pass' }])
    // The shapes need `lumens`, which the public payload withholds: not decided, so not a pass.
    expect(result).toMatchObject({ status: 'unknown', detail: { cause: 'restricted-tier-withheld' } })
  })
})

describe('a correctly signed package that carries an altered artefact is refused', () => {
  // Shapes that require nothing, under the genuine binding's name for its shapes file.
  const laxShapes = utf8('@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix lamp: <https://profiles.example/lamp/v1#> .\nlamp:LampShape a sh:NodeShape ; sh:targetSubjectsOf lamp:name .\n')
  const shapesPath = `profiles/${PROFILE}/shapes.ttl`

  it('with other bytes of another length', async () => {
    const pack = await packageOf(genuinePackage.bundle, new Map(genuinePackage.bundle.files).set(shapesPath, laxShapes))
    // The exporter listed and signed the altered file, so the package itself is consistent.
    expectCorrectlySigned(pack)
    expect(pack.manifest.inventory.find((entry) => entry.path === shapesPath)?.sha256).toBe(sha256Hex(laxShapes))
    const registry = destination()
    const [result] = await registerProfileBundle(registry, await opened(pack))
    expect(result).toMatchObject({ ok: false, code: 'bundle-artefact-altered', profile: PROFILE, bindingDigest: genuineDigest, artefact: 'shapes.ttl', registration: { code: 'artefact-length-mismatch' } })
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
    expect(await validateWith(registry, payloadOf(publicProduct, genuineDigest))).toMatchObject({ status: 'unknown', detail: { cause: 'profile-unknown' } })
  })

  it('with one byte changed and the length kept, so only the digest can tell', async () => {
    const changed = utf8(SYNTHETIC_FILES['shapes.ttl']!.replace('sh:minCount 1', 'sh:minCount 0'))
    expect(changed.byteLength).toBe(utf8(SYNTHETIC_FILES['shapes.ttl']!).byteLength)
    const pack = await packageOf(genuinePackage.bundle, new Map(genuinePackage.bundle.files).set(shapesPath, changed))
    expectCorrectlySigned(pack)
    const registry = destination()
    const [result] = await registerProfileBundle(registry, await opened(pack))
    expect(result).toMatchObject({ ok: false, code: 'bundle-artefact-altered', artefact: 'shapes.ttl', registration: { code: 'artefact-digest-mismatch' } })
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
  })

  it('names an artefact the package does not hold, and the bundle as incomplete', async () => {
    const files = new Map(genuinePackage.bundle.files)
    files.delete(shapesPath)
    const pack = await packageOf(genuinePackage.bundle, files)
    expectCorrectlySigned(pack)
    const registry = destination()
    const [result] = await registerProfileBundle(registry, await opened(pack))
    expect(result).toMatchObject({ ok: false, code: 'bundle-artefact-missing', artefact: 'shapes.ttl', registration: { code: 'artefact-unavailable' } })
    expect(result!.ok ? '' : result!.detail).toContain('incomplete')
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
  })
})

describe('the other refusals a bundle can meet, each under its own name', () => {
  it('a profile the bundle does not cover, and a binding file it lists and does not hold', async () => {
    const bundle = await opened(genuinePackage)
    expect(await registerProfileBundle(destination(), bundle, { profiles: ['example-kettle@1'] })).toMatchObject([{ ok: false, code: 'bundle-profile-absent', profile: 'example-kettle@1' }])
    const files = new Map(genuinePackage.bundle.files)
    files.delete(`profiles/${PROFILE}/binding.json`)
    const [missing] = await registerProfileBundle(destination(), await opened(await packageOf(genuinePackage.bundle, files)))
    expect(missing).toMatchObject({ ok: false, code: 'bundle-binding-missing', profile: PROFILE })
  })

  it('a trusted binding listed under another profile\'s name is registered as what it is, and the name it was listed under is not', async () => {
    const lamp = bindingBytes(syntheticBinding())
    const lampDigest = sha256Hex(lamp)
    // The one-tier lamp's binding, filed in the folder and under the name of the two-tier profile.
    const files = withDescriptor(genuinePackage.bundle, (descriptor) => { descriptor.profiles[0]!.bindingDigest = lampDigest })
    files.set(`profiles/${PROFILE}/binding.json`, lamp)
    const pack = await packageOf(genuinePackage.bundle, files)
    expectCorrectlySigned(pack)
    const registry = createProfileRegistry({ trustedBindingDigests: [genuineDigest, lampDigest] })
    const [result] = await registerProfileBundle(registry, await opened(pack))
    expect(result).toMatchObject({ ok: false, code: 'bundle-binding-misfiled', profile: PROFILE, bindingDigest: lampDigest, registered: { profile: 'example-lamp@1' } })
    expect(registry.resolve(genuine.id, genuine.version)).toBeUndefined()
    expect(registry.resolve('example-lamp', 1)).toMatchObject({ format: 'binding', bindingDigest: lampDigest })
  })

  it('a refusal no bundle causes is passed on with the registry\'s own answer', async () => {
    const garbage = utf8('not a binding')
    const files = withDescriptor(genuinePackage.bundle, (descriptor) => { descriptor.profiles[0]!.bindingDigest = sha256Hex(garbage) })
    files.set(`profiles/${PROFILE}/binding.json`, garbage)
    const registry = createProfileRegistry({ trustedBindingDigests: [sha256Hex(garbage)] })
    const [result] = await registerProfileBundle(registry, await opened(await packageOf(genuinePackage.bundle, files)))
    expect(result).toMatchObject({ ok: false, code: 'bundle-registration-refused', registration: { code: 'binding-not-json' } })
  })

  it('one refused profile does not stop the others, and each result says which profile it is about', async () => {
    const lamp = bindingBytes(syntheticBinding())
    const both = createProfileRegistry({ trustedBindingDigests: [genuineDigest, sha256Hex(lamp)] })
    for (const bytes of [lamp, genuineBytes]) expect(await both.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: true })
    const pack = await packageOf(await exported(both))
    // The destination trusts one of the two.
    const registry = destination()
    expect(await registerProfileBundle(registry, await opened(pack))).toMatchObject([{ ok: false, code: 'bundle-binding-untrusted', profile: 'example-lamp@1' }, { ok: true, profile: { profile: PROFILE } }])
    expect(registry.list().filter((profile) => profile.format === 'binding').map((profile) => profile.profile)).toEqual([PROFILE])
  })
})
