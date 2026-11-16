import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  BUNDLED_BINDING_DIGESTS,
  PROFILE_IDS,
  PROFILE_RETIRED,
  ProfileRetiredError,
  RETIRED_PROFILE_IDS,
  RETIRED_PROFILE_REPLACEMENTS,
  SUPPORTED_PROFILE_IDS,
  assertProfileNotRetired,
  authorisedPayloadValidator,
  bindingPayloadValidator,
  checkSelection,
  compareProfiles,
  createProfileRegistry,
  fieldsFor,
  fieldsForV2,
  isRetiredProfile,
  missingRequired,
  missingRequiredV2,
  prepareBoundPayload,
  profilePayloadValidator,
  projectPassport,
  readConsumerDocument,
  readFrozen,
  readManifest,
  readManifestAny,
  readPublicPayloadSchema,
  readRestrictedPayloadSchema,
  registerBundledBindings,
  reviewProfileData,
  type BindingValidationDetail,
  type PayloadValidation,
  type ProfileManifest,
  type RetiredProfileId,
} from '../src/index.js'
import { bindingBytes, resolveSynthetic, sha256Hex, syntheticBinding } from './binding-fixture.js'
import { baseInput } from './projection-fixture.js'

// The sector profiles first published as manifests are retired (spec/profiles.md
// section 4). Retirement changes what the package does with them and nothing
// they say: no payload is prepared or validated for writing under one, a
// record that declares one is unsupported and never passed or failed, and
// every frozen file is still the file it was.
const root = join(import.meta.dirname, '..')
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const RETIRED: readonly RetiredProfileId[] = RETIRED_PROFILE_IDS
const parts = (profile: string): { id: string; version: number } => ({ id: profile.split('@')[0]!, version: Number(profile.split('@')[1]) })
const PASSPORT = 'https://id.example.test/01/09521000000018/21/0001'

/** Ajv as a verifier installs it: the 2020 build with formats. */
const compiler = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv
}

type Node = Record<string, unknown>
/** A placeholder of the right shape for one schema node, so each frozen schema has a payload it accepts. */
function placeholder(node: Node, name: string): unknown {
  if (node.const !== undefined) return node.const
  if (Array.isArray(node.enum)) return node.enum[0]
  if (Array.isArray(node.oneOf)) return placeholder(node.oneOf[0] as Node, name)
  if (Array.isArray(node.anyOf)) return placeholder(node.anyOf[0] as Node, name)
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type
  const properties = (node.properties ?? {}) as Record<string, Node>
  if (type === 'object' || node.properties != null) return Object.fromEntries(((node.required ?? []) as string[]).map((key) => [key, placeholder(properties[key] ?? {}, key)]))
  if (type === 'array') return Array.from({ length: Math.max(1, Number(node.minItems ?? 1)) }, () => placeholder((node.items ?? {}) as Node, name))
  if (type === 'integer' || type === 'number') {
    const low = Number(node.minimum ?? (node.exclusiveMinimum != null ? Number(node.exclusiveMinimum) + 1 : 1))
    return node.maximum != null ? Math.min(low, Number(node.maximum)) : low
  }
  if (type === 'boolean') return false
  if (node.format === 'date') return '2026-01-15'
  if (node.format === 'date-time') return '2026-01-15T09:00:00Z'
  if (node.format === 'uri') return `https://example.com/${name}`
  if (node.format === 'email') return 'contact@example.com'
  if (node.pattern === '^[A-Z]{2}$') return 'DE'
  if (node.pattern === '^\\d{2,7}-\\d{2}-\\d$') return '7439-93-2'
  if (node.pattern === '^\\d{4}-(0[1-9]|1[0-2])$') return '2026-01'
  const text = `Example ${name}`
  return typeof node.maxLength === 'number' ? text.slice(0, node.maxLength) : text
}

/** A payload the profile's frozen public schema accepts, checked against that schema read as a file. */
function acceptedPayload(profile: RetiredProfileId): string {
  const schema = readPublicPayloadSchema(profile)
  const payload = placeholder(schema, 'payload')
  const validate = compiler().compile(schema)
  expect(validate(payload), `${profile}: ${JSON.stringify(validate.errors)}`).toBe(true)
  return JSON.stringify(payload)
}

/** The three payloads a reader may meet: one the frozen schema accepts, one it refuses, and text that is not JSON. */
const payloadsFor = (profile: RetiredProfileId): Array<[string, string]> => {
  const { id, version } = parts(profile)
  return [
    ['a payload its frozen schema accepts', acceptedPayload(profile)],
    ['a payload its frozen schema refuses', JSON.stringify({ profile: id, profile_version: version, undefinedField: true })],
    ['text that is not JSON', '{not json'],
  ]
}

const expectRetired = (answer: PayloadValidation, profile: RetiredProfileId, about: string): void => {
  expect(answer.status, `${profile}, ${about}`).toBe('unknown')
  expect(answer.status).not.toBe('pass')
  expect(answer.status).not.toBe('fail')
  expect(answer.reasonCode).toBe('schema-unavailable')
  const detail = answer.detail as BindingValidationDetail
  expect(detail).toEqual({ profile, cause: 'profile-retired', replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile], steps: [] })
}

describe('the retired sector profiles', () => {
  it('are named by one exported list, each with the profile that replaces it', () => {
    expect([...RETIRED_PROFILE_IDS]).toEqual(['battery@2', 'battery@3', 'battery@4', 'textile@1', 'textile@2', 'textile@3', 'textile@4'])
    expect(PROFILE_RETIRED).toBe('profile-retired')
    expect(Object.keys(RETIRED_PROFILE_REPLACEMENTS).sort()).toEqual([...RETIRED_PROFILE_IDS].sort())
    for (const profile of RETIRED) {
      expect(isRetiredProfile(profile)).toBe(true)
      expect(RETIRED_PROFILE_REPLACEMENTS[profile]).toBe(profile.startsWith('battery@') ? 'eu-battery@1' : 'eu-textile@1')
      expect(() => assertProfileNotRetired(profile)).toThrow(ProfileRetiredError)
    }
    // A replacement is never itself retired, and no other identifier is.
    for (const replacement of Object.values(RETIRED_PROFILE_REPLACEMENTS)) expect(isRetiredProfile(replacement)).toBe(false)
    for (const other of ['general@2', 'general@1', 'eu-battery@1', 'eu-textile@1', 'example-bottle@1', 'example-notebook@1', 'battery@1', 'battery@5', 'Battery@2', 'battery', '']) {
      expect(isRetiredProfile(other), other).toBe(false)
      expect(() => assertProfileNotRetired(other)).not.toThrow()
    }
  })

  it('stay published, and the supported manifest profiles are the published ones that are not retired', () => {
    for (const profile of RETIRED) expect(PROFILE_IDS).toContain(profile)
    expect([...SUPPORTED_PROFILE_IDS]).toEqual(PROFILE_IDS.filter((profile) => !isRetiredProfile(profile)))
    expect([...SUPPORTED_PROFILE_IDS].sort()).toEqual(['general@1', 'general@2'])
  })

  it('carries one error for every thrown refusal: the code, the profile and its replacement', () => {
    const refusal = new ProfileRetiredError('textile@3')
    expect(refusal).toMatchObject({ name: 'ProfileRetiredError', code: 'profile-retired', profile: 'textile@3', replacedBy: 'eu-textile@1' })
    expect(refusal.message).toContain('textile@3 is retired')
    expect(refusal.message).toContain('eu-textile@1 replaces it')
    expect(refusal.message).toContain('no converter')
  })
})

describe('a retired profile keeps its frozen definition', () => {
  it.each(RETIRED)('%s: the manifest, both schemas and the consumer document are in the package at the digests frozen.json records', (profile) => {
    const frozen = readFrozen()
    const { id, version } = parts(profile)
    const files = [`generated/payload-schema/${profile}.public.schema.json`, `generated/payload-schema/${profile}.restricted.schema.json`, `generated/consumer/${id}-v${version}.json`]
    expect(sha256(readFileSync(join(root, 'manifests', `${profile}.json`))), `${profile} manifest`).toBe(frozen.manifests[profile])
    for (const relative of files) {
      expect(frozen.generated[relative], relative).toMatch(/^[0-9a-f]{64}$/)
      expect(sha256(readFileSync(join(root, relative))), relative).toBe(frozen.generated[relative])
    }
  })

  it('frozen.json still verifies every file it names, retired or not, and names every published manifest', () => {
    const frozen = readFrozen()
    expect(Object.keys(frozen.manifests).sort()).toEqual([...PROFILE_IDS].sort())
    for (const [profile, digest] of Object.entries(frozen.manifests)) expect(sha256(readFileSync(join(root, 'manifests', `${profile}.json`))), profile).toBe(digest)
    for (const [relative, digest] of Object.entries(frozen.generated)) {
      expect(existsSync(join(root, relative)), relative).toBe(true)
      expect(sha256(readFileSync(join(root, relative))), relative).toBe(digest)
    }
  })

  // Historical: these read a frozen file or describe it, and judge no payload.
  it.each(RETIRED)('%s: the functions that only read the definition still read it', (profile) => {
    const manifest = readManifestAny(profile)
    expect(manifest.profile).toBe(profile)
    expect(readManifest(profile).profile).toBe(profile)
    expect(readPublicPayloadSchema(profile)).toMatchObject({ type: 'object' })
    expect(readRestrictedPayloadSchema(profile)).toMatchObject({ type: 'object' })
    expect(readConsumerDocument(profile)).toBeTypeOf('object')
    expect(fieldsFor(readManifest(profile)).applies.length + fieldsFor(readManifest(profile)).needsReview.length).toBe(manifest.fields.length)
    expect(fieldsForV2(manifest).applies.length).toBeGreaterThanOrEqual(0)
    // The manifest is immutable, so its own status member is as it was frozen and is not what says the profile is retired.
    expect(['current', 'draft', 'superseded']).toContain(manifest.status)
  })

  it('still compares two frozen manifests of one industry', () => {
    expect(compareProfiles('battery@2', 'battery@4')).toMatchObject({ from: { profile: 'battery@2' }, to: { profile: 'battery@4' }, activation: 'explicit-consumer-selection' })
  })
})

describe('reading a payload that declares a retired profile', () => {
  it.each(RETIRED)('%s: profilePayloadValidator answers unknown with profile-retired, whatever the payload', async (profile) => {
    const validate = profilePayloadValidator(compiler())
    const { id, version } = parts(profile)
    for (const [about, payloadPublic] of payloadsFor(profile)) {
      expectRetired(await validate({ profile: id, profileVersion: version, payloadPublic }), profile, about)
      expectRetired(await validate({ profile: id, profileVersion: version, payloadPublic, passportId: PASSPORT }), profile, `${about}, with the passport named`)
    }
  })

  it.each(RETIRED)('%s: the validators over a registry answer the same, with the bundled bindings registered and with no engine at all', async (profile) => {
    const { id, version } = parts(profile)
    const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    for (const result of await registerBundledBindings(registry)) expect(result.ok).toBe(true)
    const validators = [
      bindingPayloadValidator({ registry, engines: { jsonSchema: compiler() } }),
      bindingPayloadValidator({ registry }),
      authorisedPayloadValidator({ registry, engines: { jsonSchema: compiler() } }),
    ]
    for (const validate of validators) {
      for (const [about, payloadPublic] of payloadsFor(profile)) expectRetired(await validate({ profile: id, profileVersion: version, payloadPublic, passportId: PASSPORT }), profile, about)
    }
    // A restricted part handed over beside it changes nothing: the profile's rules are not applied to either part.
    expectRetired(await authorisedPayloadValidator({ registry, engines: { jsonSchema: compiler() } })({ profile: id, profileVersion: version, payloadPublic: '{}', passportId: PASSPORT, restrictedProduct: {} }), profile, 'with a restricted part')
  })

  it('is decided on the identity, before a registry is asked', async () => {
    // A registry of another making that would answer for the identity is never consulted.
    const lying = { register: async () => { throw new Error('not asked') }, resolve: () => { throw new Error('not asked') }, status: () => { throw new Error('not asked') }, list: () => [] } as unknown as Parameters<typeof bindingPayloadValidator>[0]['registry']
    expectRetired(await bindingPayloadValidator({ registry: lying })({ profile: 'battery', profileVersion: 2, payloadPublic: '{}' }), 'battery@2', 'a registry that would answer')
  })
})

describe('the registry tells a retired profile from an unknown one', () => {
  const registry = createProfileRegistry({ trustedBindingDigests: [] })

  it.each(RETIRED)('%s is reported as retired with its replacement, and does not resolve', (profile) => {
    const { id, version } = parts(profile)
    expect(registry.status(id, version)).toEqual({ state: 'retired', profile, replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile] })
    expect(registry.resolve(id, version)).toBeUndefined()
  })

  it('reports an identifier nobody published as unknown, and a supported manifest profile as registered', () => {
    expect(registry.status('toaster', 9)).toEqual({ state: 'unknown', profile: 'toaster@9' })
    expect(registry.status('battery', 1)).toEqual({ state: 'unknown', profile: 'battery@1' })
    expect(registry.status('battery', 2.5)).toMatchObject({ state: 'unknown' })
    expect(registry.status('general', 2)).toMatchObject({ state: 'registered', profile: { format: 'manifest', profile: 'general@2' } })
    expect(registry.status('general', 1)).toMatchObject({ state: 'registered', profile: { format: 'manifest', profile: 'general@1' } })
  })

  it('lists no retired profile', async () => {
    const withBundled = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    await registerBundledBindings(withBundled)
    expect(registry.list().map((p) => p.profile)).toEqual(['general@2', 'general@1'])
    expect(withBundled.list().map((p) => p.profile)).toEqual(['general@2', 'general@1', 'eu-battery@1', 'eu-textile@1'])
    for (const listed of withBundled.list()) expect(isRetiredProfile(listed.profile)).toBe(false)
  })

  it.each(RETIRED)('%s: a binding that claims the identity is refused, so the identity is never given another definition', async (profile) => {
    const { id, version } = parts(profile)
    const claim = bindingBytes({ ...syntheticBinding(), id, version, profile })
    const trusting = createProfileRegistry({ trustedBindingDigests: [sha256Hex(claim)] })
    const result = await trusting.register({ bindingBytes: claim, resolveArtefact: resolveSynthetic })
    expect(result).toMatchObject({ ok: false, code: 'profile-retired', profile })
    expect(trusting.resolve(id, version)).toBeUndefined()
    expect(trusting.status(id, version)).toMatchObject({ state: 'retired' })
  })
})

describe('nothing is prepared or validated for writing under a retired profile', () => {
  it.each(RETIRED)('%s: prepareBoundPayload refuses with profile-retired and prepares nothing', async (profile) => {
    const { id, version } = parts(profile)
    const registry = createProfileRegistry({ trustedBindingDigests: [] })
    const prepared = await prepareBoundPayload({ registry, engines: { jsonSchema: compiler() }, profile: id, profileVersion: version, product: { id: PASSPORT }, passportId: PASSPORT })
    expect(prepared).toMatchObject({ ok: false, code: 'profile-retired' })
    expect(prepared).not.toHaveProperty('payloadPublic')
    if (!prepared.ok) expect(prepared.detail).toContain(RETIRED_PROFILE_REPLACEMENTS[profile])
  })

  it.each(RETIRED)('%s: the completeness checks, the data review and the projection refuse by name', (profile) => {
    const manifest = readManifestAny(profile)
    const refused = (act: () => unknown): void => {
      let thrown: unknown
      try { act() } catch (cause) { thrown = cause }
      expect(thrown).toBeInstanceOf(ProfileRetiredError)
      expect(thrown).toMatchObject({ code: 'profile-retired', profile, replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile] })
    }
    refused(() => missingRequired(manifest as ProfileManifest, {}))
    refused(() => missingRequiredV2(manifest, {}, {}))
    refused(() => reviewProfileData(profile, {}))
    refused(() => projectPassport({ ...baseInput(), profile: manifest }))
  })

  it.each(RETIRED)('%s: no selection may name it, for reading, writing or a claim', (profile) => {
    for (const purpose of ['read', 'write', 'claim'] as const) {
      const result = checkSelection({ baseline: 'native-baseline@2', industry: profile, purpose })
      expect(result.ok, purpose).toBe(false)
      expect(result.conflicts.map((c) => c.code)).toEqual(['industry-retired'])
      expect(result.conflicts[0]!.detail).toContain(RETIRED_PROFILE_REPLACEMENTS[profile])
    }
  })
})

describe('what retirement leaves alone', () => {
  it('general@2 and general@1 are validated as before', async () => {
    const validate = profilePayloadValidator(compiler())
    const accepted = JSON.stringify(placeholder(readPublicPayloadSchema('general@2'), 'payload'))
    expect(await validate({ profile: 'general', profileVersion: 2, payloadPublic: accepted })).toEqual({ status: 'pass', detail: 'general@2' })
    expect(await validate({ profile: 'general', profileVersion: 2, payloadPublic: JSON.stringify({ profile: 'general', profile_version: 2, colour: 'red' }) })).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid' })
    const first = JSON.stringify(placeholder(readPublicPayloadSchema('general@1'), 'payload'))
    expect(await validate({ profile: 'general', profileVersion: 1, payloadPublic: first })).toEqual({ status: 'pass', detail: 'general@1' })
    expect(missingRequired(readManifest('general@2'), {}).missing.length).toBeGreaterThan(0)
    expect(checkSelection({ baseline: 'native-baseline@2', industry: 'general@2', purpose: 'claim' })).toMatchObject({ ok: true, conflicts: [] })
    expect(() => reviewProfileData('general@2', {})).toThrow(/not implemented/)
  })

  it('an identifier nobody published is still unknown, with its own cause', async () => {
    expect(await profilePayloadValidator(compiler())({ profile: 'toaster', profileVersion: 9, payloadPublic: '{}' })).toEqual({ status: 'unknown', reasonCode: 'schema-unavailable', detail: 'toaster@9 is not a published industry profile' })
    const registry = createProfileRegistry({ trustedBindingDigests: [] })
    expect(await bindingPayloadValidator({ registry })({ profile: 'toaster', profileVersion: 9, payloadPublic: '{}' })).toEqual({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { profile: 'toaster@9', cause: 'profile-unknown', steps: [] } })
  })

  it('the bundled bindings, which replace the retired profiles, register and resolve', async () => {
    const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    const results = await registerBundledBindings(registry)
    expect(results.map((r) => r.ok)).toEqual([true, true])
    for (const replacement of new Set(Object.values(RETIRED_PROFILE_REPLACEMENTS))) {
      const { id, version } = parts(replacement)
      expect(registry.status(id, version)).toMatchObject({ state: 'registered', profile: { format: 'binding', profile: replacement } })
    }
  })
})
