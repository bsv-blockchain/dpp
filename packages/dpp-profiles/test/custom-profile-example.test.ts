import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  bindingPayloadValidator,
  createProfileRegistry,
  describeArtefact,
  isDemonstrationGtin,
  profileBindingDigest,
  profileBindingProblems,
  readProfileBinding,
  type BindingArtefact,
  type BindingValidationDetail,
  type ProfileBinding,
  type ProfileRegistry,
  type ValidationEngines,
} from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'

// The reference custom profile under examples/custom-profile/. It is a
// folder of files and nothing else: these tests register it from that folder
// through the package's public interface, which is the proof that a profile
// can be added without editing the package.
const repo = join(import.meta.dirname, '..', '..', '..')
const examples = join(repo, 'examples', 'custom-profile')
const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path))
const jsonOf = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const fromFolder = (folder: string, substitute: Record<string, string> = {}) => (artefact: BindingArtefact): Uint8Array => bytesOf(join(folder, substitute[artefact.path] ?? artefact.path))

interface PayloadVector { description: string; kind: 'payload'; passportId?: string; payload: Record<string, unknown>; expected: { status: 'pass' | 'fail' | 'unknown'; cause?: string; step?: string; constraint?: string } }
interface RegistrationVector { description: string; kind: 'registration'; trustedBindingDigests: string[]; register: Array<{ binding: string; substitute?: Record<string, string> }>; expected: { refusal: string; artefact?: string } }
type Vector = PayloadVector | RegistrationVector

const profiles = ['example-bottle@1', 'example-notebook@1'].map((name) => {
  const folder = join(examples, name)
  const bindingBytes = bytesOf(join(folder, 'binding.json'))
  const binding = jsonOf<ProfileBinding>(join(folder, 'binding.json'))
  const vectors = [...binding.vectors.positive.map((path) => ({ path, positive: true })), ...binding.vectors.negative.map((path) => ({ path, positive: false }))].map((v) => ({ ...v, vector: jsonOf<Vector>(join(folder, v.path)) }))
  return { name, folder, bindingBytes, digest: profileBindingDigest(bindingBytes), binding, vectors }
})
const bottle = profiles[0]!
const notebook = profiles[1]!

const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
let engines: ValidationEngines
let registry: ProfileRegistry
beforeAll(async () => {
  engines = { jsonSchema: compiler(), ...(await createValidationEngine()) }
  registry = createProfileRegistry({ trustedBindingDigests: profiles.map((p) => p.digest) })
  for (const p of profiles) expect(await registry.register({ bindingBytes: p.bindingBytes, resolveArtefact: fromFolder(p.folder) })).toMatchObject({ ok: true, alreadyRegistered: false })
})

describe('the example profiles are what they say they are', () => {
  it.each(profiles.map((p) => [p.name, p] as const))('%s: the binding reads, and records each artefact as it is on disk', (_name, p) => {
    expect(profileBindingProblems(p.binding)).toEqual([])
    expect(readProfileBinding(p.bindingBytes)).toMatchObject({ ok: true, digest: p.digest })
    expect(p.binding.profile).toBe(p.name)
    for (const artefact of p.binding.artefacts) expect({ path: artefact.path, ...describeArtefact(bytesOf(join(p.folder, artefact.path))) }).toEqual({ path: artefact.path, byteLength: artefact.byteLength, sha256: artefact.sha256 })
  })

  it.each(profiles.map((p) => [p.name, p] as const))('%s: every vector file in the folder is listed by the binding', (_name, p) => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => { const path = join(dir, entry); return statSync(path).isDirectory() ? walk(path) : [path] })
    // A vector is a JSON file that says what kind it is. The files a registration vector swaps in sit beside the vectors and are not vectors.
    const onDisk = walk(join(p.folder, 'vectors')).filter((path) => path.endsWith('.json') && jsonOf<{ kind?: string }>(path).kind != null).map((path) => relative(p.folder, path)).sort()
    expect([...p.binding.vectors.positive, ...p.binding.vectors.negative].sort()).toEqual(onDisk)
  })

  it('uses a demonstration GTIN in every identifier and carries the demonstration notice first', () => {
    for (const p of profiles) {
      for (const { vector } of p.vectors) {
        if (vector.kind !== 'payload') continue
        expect(Object.keys(vector.payload)[0]).toBe('notice')
        const gtins = JSON.stringify(vector).match(/\b\d{13,14}\b/g) ?? []
        expect(gtins.length).toBeGreaterThan(0)
        for (const gtin of gtins) expect(isDemonstrationGtin(gtin), `${p.name} ${gtin}`).toBe(true)
      }
    }
  })

  it('ships nothing but its own definitions: every namespace is the example\'s or a W3C vocabulary', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => { const path = join(dir, entry); return statSync(path).isDirectory() ? walk(path) : [path] })
    const allowed = [/^https:\/\/profiles\.example\//, /^https:\/\/id\.example\//, /^https:\/\/passports\.example\//, /^https:\/\/resolver\.example\//, /^http:\/\/www\.w3\.org\//, /^https:\/\/json-schema\.org\/draft\/2020-12\/schema$/, /^https:\/\/github\.com\/bsv-blockchain\/dpp$/]
    for (const file of walk(examples)) {
      for (const url of readFileSync(file, 'utf8').match(/https?:\/\/[^\s"'<>)]+/g) ?? []) expect(allowed.some((pattern) => pattern.test(url)), `${relative(examples, file)}: ${url}`).toBe(true)
    }
  })

  it('the second profile uses the json-schema and passport-identity steps and nothing else', () => {
    expect(notebook.binding.validation.steps).toEqual(['json-schema', 'passport-identity'])
    expect(notebook.binding.artefacts.map((a) => a.role)).toEqual(['schema'])
    expect(bottle.binding.validation.steps).toEqual(['json-schema', 'json-ld-expand', 'shacl', 'passport-identity'])
    expect(bottle.binding.artefacts.map((a) => a.role).sort()).toEqual(['background', 'context', 'schema', 'shapes'])
  })
})

describe('the example profiles\' payload vectors', () => {
  const payloadVectors = profiles.flatMap((p) => p.vectors.filter((v) => v.vector.kind === 'payload').map((v) => [`${p.name} ${v.path}`, p, v.vector as PayloadVector, v.positive] as const))

  it('cover every negative the profile is asked to ship', () => {
    expect(bottle.binding.vectors.negative.map((path) => path.replace(/^vectors\//, '').replace(/\.json$/, '')).sort()).toEqual([
      'conflicting-gtin', 'conflicting-serial', 'granularity-mismatch', 'missing-required-property', 'model-as-subject', 'no-passport-identifier', 'other-product', 'part-not-dishwasher-safe',
      'registration/altered-artefact', 'registration/conflicting-second-registration', 'registration/untrusted-binding', 'unlisted-context', 'wrong-binding-digest',
    ])
  })

  it.each(payloadVectors)('%s', async (_name, p, vector, positive) => {
    expect(vector.expected.status === 'pass').toBe(positive)
    const result = await bindingPayloadValidator({ registry, engines })({ profile: p.binding.id, profileVersion: p.binding.version, payloadPublic: JSON.stringify(vector.payload), ...(vector.passportId == null ? {} : { passportId: vector.passportId }) })
    const detail = result.detail as BindingValidationDetail
    expect(result.status, JSON.stringify(detail)).toBe(vector.expected.status)
    expect(detail.cause).toBe(vector.expected.cause)
    if (vector.expected.step != null) {
      const first = detail.steps.find((s) => s.status === vector.expected.status)
      expect(first?.step).toBe(vector.expected.step)
      if (vector.expected.constraint != null) expect(first?.findings?.filter((f) => f.severity === 'Violation').map((f) => f.constraint)).toEqual([vector.expected.constraint])
    }
  })

  it('reports the recommended care note as a warning on the positive vector, and passes', async () => {
    const vector = bottle.vectors.find((v) => v.path === 'vectors/item.json')!.vector as PayloadVector
    const result = await bindingPayloadValidator({ registry, engines })({ profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
    expect(result.status).toBe('pass')
    expect((result.detail as BindingValidationDetail).steps.find((s) => s.step === 'shacl')?.findings).toEqual([expect.objectContaining({ severity: 'Warning', message: 'A care note is recommended.' })])
  })

  it('control: the negative only SPARQL can find is unknown, never pass, with an engine that lacks SPARQL', async () => {
    const vector = bottle.vectors.find((v) => v.path === 'vectors/part-not-dishwasher-safe.json')!.vector as PayloadVector
    const input = { profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId }
    const coreOnly = { jsonSchema: compiler(), ...(await createValidationEngine({ sparql: false })) }
    const result = await bindingPayloadValidator({ registry, engines: coreOnly })(input)
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
    const steps = (result.detail as BindingValidationDetail).steps
    expect(steps.find((s) => s.step === 'shacl')?.messages?.[0]).toContain('shacl-sparql-constraints')
    // Every other step passed: without the capability check this payload would have been a pass.
    expect(steps.filter((s) => s.step !== 'shacl').every((s) => s.status === 'pass')).toBe(true)
    expect((await bindingPayloadValidator({ registry, engines })(input)).status).toBe('fail')
  })

  it('needs no JSON-LD or SHACL engine for the plain JSON Schema profile', async () => {
    const vector = notebook.vectors.find((v) => v.path === 'vectors/item.json')!.vector as PayloadVector
    const result = await bindingPayloadValidator({ registry, engines: { jsonSchema: compiler() } })({ profile: 'example-notebook', profileVersion: 1, payloadPublic: JSON.stringify(vector.payload), passportId: vector.passportId })
    expect(result.status).toBe('pass')
  })
})

describe('the example profiles\' registration vectors', () => {
  const registrationVectors = bottle.vectors.filter((v) => v.vector.kind === 'registration').map((v) => [v.path, v.vector as RegistrationVector] as const)

  it.each(registrationVectors)('%s', async (_path, vector) => {
    const fresh = createProfileRegistry({ trustedBindingDigests: vector.trustedBindingDigests })
    const results = []
    for (const step of vector.register) results.push(await fresh.register({ bindingBytes: bytesOf(join(bottle.folder, step.binding)), resolveArtefact: fromFolder(bottle.folder, step.substitute) }))
    // Every registration before the last is the set-up and must succeed.
    for (const earlier of results.slice(0, -1)) expect(earlier.ok).toBe(true)
    expect(results.at(-1)).toMatchObject({ ok: false, code: vector.expected.refusal, ...(vector.expected.artefact == null ? {} : { artefact: vector.expected.artefact }) })
  })

  it('the altered artefact is the one that would have hidden the SPARQL finding', async () => {
    // Registered by force, with the changed file's own digest written into a changed binding, the bamboo cap passes.
    const altered = bytesOf(join(bottle.folder, 'vectors', 'registration', 'altered-background.ttl'))
    const forged = structuredClone(bottle.binding)
    Object.assign(forged.artefacts.find((a) => a.path === 'background.ttl')!, describeArtefact(altered))
    const forgedBytes = new TextEncoder().encode(JSON.stringify(forged))
    const forgedDigest = profileBindingDigest(forgedBytes)
    const own = createProfileRegistry({ trustedBindingDigests: [forgedDigest] })
    expect((await own.register({ bindingBytes: forgedBytes, resolveArtefact: fromFolder(bottle.folder, { 'background.ttl': 'vectors/registration/altered-background.ttl' }) })).ok).toBe(true)
    const vector = bottle.vectors.find((v) => v.path === 'vectors/part-not-dishwasher-safe.json')!.vector as PayloadVector
    const payload = { ...vector.payload, profile_binding_sha256: forgedDigest }
    expect((await bindingPayloadValidator({ registry: own, engines })({ profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(payload), passportId: vector.passportId })).status).toBe('pass')
    // Under the real binding the same payload is refused at the digest: it names rules this registry does not hold.
    expect(await bindingPayloadValidator({ registry, engines })({ profile: 'example-bottle', profileVersion: 1, payloadPublic: JSON.stringify(payload), passportId: vector.passportId })).toMatchObject({ status: 'fail', detail: { cause: 'profile-binding-mismatch' } })
  })
})
