import { describe, expect, it } from 'vitest'
import { RETIRED_PROFILE_IDS, SUPPORTED_PROFILE_IDS, createProfileRegistry, readManifestAny, readPublicPayloadSchema, type BindingArtefact } from '../src/index.js'
import { SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticBinding, utf8 } from './binding-fixture.js'

// The registry is the one place a profile becomes usable. A binding gets in
// only if its digest is on the operator's list and every file it names is the
// file it names, byte for byte.
const bytes = bindingBytes(syntheticBinding())
const digest = sha256Hex(bytes)
const trusting = (...digests: string[]) => createProfileRegistry({ trustedBindingDigests: digests })

describe('createProfileRegistry: registering a binding', () => {
  it('registers a trusted binding whose artefacts are intact and resolves it', async () => {
    const registry = trusting(digest)
    const result = await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })
    expect(result).toMatchObject({ ok: true, alreadyRegistered: false, profile: { format: 'binding', id: 'example-lamp', version: 1, profile: 'example-lamp@1', bindingDigest: digest } })
    const resolved = registry.resolve('example-lamp', 1)
    expect(resolved).toMatchObject({ format: 'binding', bindingDigest: digest, binding: syntheticBinding() })
    if (resolved?.format !== 'binding') throw new Error('expected a binding')
    expect(resolved.artefacts.map((a) => [a.artefact.path, new TextDecoder().decode(a.bytes)])).toEqual(syntheticBinding().artefacts.map((a) => [a.path, SYNTHETIC_FILES[a.path]]))
  })

  it('accepts an asynchronous resolver and asks it for each artefact the binding lists', async () => {
    const asked: string[] = []
    const result = await trusting(digest).register({ bindingBytes: bytes, resolveArtefact: async (artefact) => { asked.push(artefact.path); return resolveSynthetic(artefact) } })
    expect(result.ok).toBe(true)
    expect(asked).toEqual(['product.schema.json', 'context.jsonld', 'shapes.ttl', 'background.ttl'])
  })

  it('refuses a binding whose digest is not trusted, without reading it or asking for a file', async () => {
    let asked = 0
    const result = await trusting('0'.repeat(64)).register({ bindingBytes: bytes, resolveArtefact: (a) => { asked += 1; return resolveSynthetic(a) } })
    expect(result).toEqual({ ok: false, code: 'binding-untrusted', bindingDigest: digest, detail: expect.stringContaining(digest) })
    expect(asked).toBe(0)
    // Not JSON at all, and still refused for the reason that matters first.
    expect(await trusting().register({ bindingBytes: utf8('not json'), resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'binding-untrusted' })
  })

  it('refuses trusted bytes that are not a binding', async () => {
    const notJson = utf8('{"bindingVersion":"1"')
    expect(await trusting(sha256Hex(notJson)).register({ bindingBytes: notJson, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'binding-not-json' })
    const invalid = bindingBytes({ ...syntheticBinding(), granularity: 'model' })
    expect(await trusting(sha256Hex(invalid)).register({ bindingBytes: invalid, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'binding-invalid', detail: expect.stringContaining('granularity') })
    const inconsistent = bindingBytes({ ...syntheticBinding(), profile: 'example-lamp@7' })
    expect(await trusting(sha256Hex(inconsistent)).register({ bindingBytes: inconsistent, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'binding-inconsistent' })
  })

  it('has no effect when the same bytes are registered again', async () => {
    const registry = trusting(digest)
    const first = await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })
    let asked = 0
    const again = await registry.register({ bindingBytes: bytes, resolveArtefact: () => { asked += 1; return undefined } })
    expect(again).toMatchObject({ ok: true, alreadyRegistered: true })
    expect(asked).toBe(0)
    if (!first.ok || !again.ok) throw new Error('expected both to be accepted')
    expect(again.profile).toBe(first.profile)
    expect(registry.list().filter((p) => p.format === 'binding')).toHaveLength(1)
  })

  it('refuses a second binding for the same id and version with a different digest', async () => {
    const other = bindingBytes({ ...syntheticBinding(), title: 'Example lamp, another edition' })
    const registry = trusting(digest, sha256Hex(other))
    await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })
    const result = await registry.register({ bindingBytes: other, resolveArtefact: resolveSynthetic })
    expect(result).toMatchObject({ ok: false, code: 'binding-conflict', profile: 'example-lamp@1', bindingDigest: sha256Hex(other) })
    if (!result.ok) expect(result.detail).toContain(digest)
    expect(registry.resolve('example-lamp', 1)).toMatchObject({ bindingDigest: digest })
  })

  it('lets a next version sit beside the first', async () => {
    const next = bindingBytes({ ...syntheticBinding(), version: 2, profile: 'example-lamp@2' })
    const registry = trusting(digest, sha256Hex(next))
    expect((await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).ok).toBe(true)
    expect((await registry.register({ bindingBytes: next, resolveArtefact: resolveSynthetic })).ok).toBe(true)
    expect(registry.resolve('example-lamp', 1)).toMatchObject({ bindingDigest: digest })
    expect(registry.resolve('example-lamp', 2)).toMatchObject({ bindingDigest: sha256Hex(next) })
  })

  it('refuses a binding that claims a profile a manifest already defines', async () => {
    const claim = bindingBytes({ ...syntheticBinding(), id: 'general', profile: 'general@1' })
    const registry = trusting(sha256Hex(claim))
    expect(await registry.register({ bindingBytes: claim, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'profile-held-by-manifest', profile: 'general@1' })
    expect(registry.resolve('general', 1)).toMatchObject({ format: 'manifest' })
  })
})

describe('createProfileRegistry: every artefact is held to its length and digest', () => {
  const withFile = (path: string, replacement: Uint8Array | undefined | (() => never)) => (artefact: BindingArtefact): Uint8Array | undefined => {
    if (artefact.path !== path) return resolveSynthetic(artefact)
    return typeof replacement === 'function' ? replacement() : replacement
  }

  it('refuses a missing artefact and names it', async () => {
    const registry = trusting(digest)
    const result = await registry.register({ bindingBytes: bytes, resolveArtefact: withFile('shapes.ttl', undefined) })
    expect(result).toMatchObject({ ok: false, code: 'artefact-unavailable', artefact: 'shapes.ttl', profile: 'example-lamp@1' })
    expect(registry.resolve('example-lamp', 1)).toBeUndefined()
  })

  it('refuses when the resolver throws, and names the artefact', async () => {
    const result = await trusting(digest).register({ bindingBytes: bytes, resolveArtefact: withFile('context.jsonld', () => { throw new Error('disk on fire') }) })
    expect(result).toMatchObject({ ok: false, code: 'artefact-unavailable', artefact: 'context.jsonld', detail: expect.stringContaining('disk on fire') })
  })

  it('refuses an artefact of another length and names it', async () => {
    const longer = utf8(SYNTHETIC_FILES['shapes.ttl'] + '# one more line\n')
    expect(await trusting(digest).register({ bindingBytes: bytes, resolveArtefact: withFile('shapes.ttl', longer) })).toMatchObject({ ok: false, code: 'artefact-length-mismatch', artefact: 'shapes.ttl' })
  })

  it('refuses an artefact of the right length with one byte changed, and names it', async () => {
    const altered = utf8(SYNTHETIC_FILES['background.ttl']!.replace('Lamp a', 'Lamp b'))
    expect(altered.byteLength).toBe(utf8(SYNTHETIC_FILES['background.ttl']!).byteLength)
    const registry = trusting(digest)
    expect(await registry.register({ bindingBytes: bytes, resolveArtefact: withFile('background.ttl', altered) })).toMatchObject({ ok: false, code: 'artefact-digest-mismatch', artefact: 'background.ttl' })
    expect(registry.resolve('example-lamp', 1)).toBeUndefined()
    // The same registry takes the binding once the file is right.
    expect((await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).ok).toBe(true)
  })

  it('refuses a resolver answer that is not bytes', async () => {
    const result = await trusting(digest).register({ bindingBytes: bytes, resolveArtefact: withFile('shapes.ttl', SYNTHETIC_FILES['shapes.ttl'] as unknown as Uint8Array) })
    expect(result).toMatchObject({ ok: false, code: 'artefact-unavailable', artefact: 'shapes.ttl' })
  })

  it('keeps its own copy of each artefact, so a caller cannot change a registered profile', async () => {
    const handed = new Map<string, Uint8Array>()
    const registry = trusting(digest)
    await registry.register({ bindingBytes: bytes, resolveArtefact: (a) => { const b = resolveSynthetic(a)!; handed.set(a.path, b); return b } })
    handed.get('shapes.ttl')!.fill(0x20)
    const resolved = registry.resolve('example-lamp', 1)
    if (resolved?.format !== 'binding') throw new Error('expected a binding')
    expect(sha256Hex(resolved.artefacts.find((a) => a.artefact.path === 'shapes.ttl')!.bytes)).toBe(syntheticBinding().artefacts[2]!.sha256)
  })

  it('registers one profile once when the same bytes arrive twice at the same moment', async () => {
    const registry = trusting(digest)
    const slow = async (a: BindingArtefact): Promise<Uint8Array | undefined> => { await new Promise((done) => setTimeout(done, 5)); return resolveSynthetic(a) }
    const [one, two] = await Promise.all([registry.register({ bindingBytes: bytes, resolveArtefact: slow }), registry.register({ bindingBytes: bytes, resolveArtefact: slow })])
    expect(one.ok && two.ok).toBe(true)
    if (!one.ok || !two.ok) throw new Error('expected both to be accepted')
    expect(two.profile).toBe(one.profile)
    expect(registry.list().filter((p) => p.format === 'binding')).toHaveLength(1)
  })
})

describe('createProfileRegistry: the trusted list', () => {
  it('refuses a list entry that is not a SHA-256 in lower-case hexadecimal', () => {
    expect(() => trusting('abc')).toThrow(/64 lower-case hexadecimal/)
    expect(() => trusting(digest.toUpperCase())).toThrow(/64 lower-case hexadecimal/)
  })

  it('is fixed when the registry is made: a later change to the caller\'s list changes nothing', async () => {
    const list = [digest]
    const registry = createProfileRegistry({ trustedBindingDigests: list })
    list.length = 0
    expect((await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })).ok).toBe(true)
  })
})

describe('createProfileRegistry: the manifest-format profiles answer through the same interface', () => {
  it('resolves every supported manifest profile without a registration, and no retired one', () => {
    const registry = trusting()
    for (const id of RETIRED_PROFILE_IDS) {
      const [name, version] = id.split('@') as [string, string]
      expect(registry.resolve(name, Number(version)), id).toBeUndefined()
    }
    for (const id of SUPPORTED_PROFILE_IDS) {
      const [name, version] = id.split('@') as [string, string]
      const profile = registry.resolve(name, Number(version))
      expect(profile, id).toMatchObject({ format: 'manifest', id: name, version: Number(version), profile: id })
      if (profile?.format !== 'manifest') throw new Error('expected a manifest')
      expect(profile.readManifest()).toEqual(readManifestAny(id))
      expect(profile.readPublicPayloadSchema()).toEqual(readPublicPayloadSchema(id))
    }
  })

  it('lists manifest profiles and bindings together, and resolves nothing it does not hold', async () => {
    const registry = trusting(digest)
    expect(registry.list().map((p) => p.profile)).toEqual([...SUPPORTED_PROFILE_IDS])
    await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })
    expect(registry.list().map((p) => `${p.format}:${p.profile}`)).toEqual([...SUPPORTED_PROFILE_IDS.map((id) => `manifest:${id}`), 'binding:example-lamp@1'])
    for (const [id, version] of [['toaster', 9], ['general', 3], ['example-lamp', 2], ['general', 1.5], ['__proto__', 1], ['general@2', 2]] as const) expect(registry.resolve(id, version), `${id}@${version}`).toBeUndefined()
  })

  it('lets a caller ask for a profile without knowing which format answers', async () => {
    const registry = trusting(digest)
    await registry.register({ bindingBytes: bytes, resolveArtefact: resolveSynthetic })
    expect(['general', 'example-lamp'].map((id) => registry.resolve(id, 1)?.profile)).toEqual(['general@1', 'example-lamp@1'])
  })
})
