import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describeArtefact, profileBindingDigest, profileBindingInconsistencies, profileBindingProblems, readProfileBinding, type ProfileBinding } from '../src/index.js'
import { bindingBytes, sha256Hex, syntheticBinding, utf8 } from './binding-fixture.js'

// The binding file has two descriptions: the JSON Schema a tool in any
// language can apply, and the check this package runs at registration without
// a validator library. They must never disagree, so every vector below is
// given to both and the verdicts are compared.
const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'schemas', 'profile-binding-v1.schema.json'), 'utf8')) as Record<string, unknown>
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

type Mutation = (binding: Record<string, any>) => void
const vary = (change: Mutation): unknown => { const copy = syntheticBinding() as unknown as Record<string, any>; change(copy); return copy }

const positives: Array<[string, unknown]> = [
  ['the binding that uses every step', syntheticBinding()],
  ['a plain JSON Schema profile: one schema artefact and two steps', vary((b) => { b.artefacts = [b.artefacts[0]]; b.validation = { steps: ['json-schema', 'passport-identity'], blockingSeverities: ['Violation'] } })],
  ['a source that names its repository, release and revision', vary((b) => { b.source = { name: 'A public source', repository: 'https://source.example/profiles', release: '1.2.0', revision: 'a'.repeat(40), licence: 'CC-BY-4.0', notices: ['notices/source.txt'] } })],
  ['no granularity member and no related identifiers', vary((b) => { delete b.identity.granularityMember; b.identity.related = []; b.identity.mustEqual = []; b.identity.mustNotContradict = [] })],
  ['warnings that block as well as violations', vary((b) => { b.validation.blockingSeverities = ['Violation', 'Warning'] })],
  ['a version written as a whole number with a decimal point', JSON.parse(JSON.stringify(syntheticBinding()).replace('"version":1,', '"version":1.0,'))],
]

const negatives: Array<[string, unknown]> = [
  ['not an object', 'binding'],
  ['an array', [syntheticBinding()]],
  ['null', null],
  ['an unknown binding format', vary((b) => { b.bindingVersion = '2' })],
  ['the format as a number', vary((b) => { b.bindingVersion = 1 })],
  ['a member the format does not define', vary((b) => { b.policies = { tierSplit: 'top-level-property' } })],
  ['a digest of itself', vary((b) => { b.sha256 = 'a'.repeat(64) })],
  ['no scope sentence', vary((b) => { delete b.scope })],
  ['an empty scope sentence', vary((b) => { b.scope = '' })],
  ['an identifier outside the profile grammar', vary((b) => { b.id = 'Example_Lamp' })],
  ['version zero', vary((b) => { b.version = 0 })],
  ['a fractional version', vary((b) => { b.version = 1.5 })],
  ['a version given as text', vary((b) => { b.version = '1' })],
  ['a profile that is not id@version in form', vary((b) => { b.profile = 'example-lamp' })],
  ['a registration the format does not name', vary((b) => { b.publisher.registration = 'signed' })],
  ['a publisher without a name', vary((b) => { delete b.publisher.name })],
  ['a source without a licence', vary((b) => { delete b.source.licence })],
  ['a source revision that is not a full commit hash', vary((b) => { b.source.revision = 'abc1234' })],
  ['a source repository that is not a URI', vary((b) => { b.source.repository = 'not a uri' })],
  ['a notice path that climbs out of the folder', vary((b) => { b.source.notices = ['../NOTICE'] })],
  ['a granularity other than item', vary((b) => { b.granularity = 'model' })],
  ['a payload root other than /product', vary((b) => { b.payload.root = '/' })],
  ['more than one product document', vary((b) => { b.payload.documents = 'model-batch-item' })],
  ['no artefacts', vary((b) => { b.artefacts = [] })],
  ['an artefact role the format does not name', vary((b) => { b.artefacts[0].role = 'ontology' })],
  ['an artefact with an absolute path', vary((b) => { b.artefacts[0].path = '/etc/passwd' })],
  ['an artefact path with a dot-dot segment', vary((b) => { b.artefacts[0].path = 'a/../b.json' })],
  ['an artefact path with a backslash', vary((b) => { b.artefacts[0].path = 'a\\b.json' })],
  ['an artefact of length zero', vary((b) => { b.artefacts[0].byteLength = 0 })],
  ['an artefact digest in upper case', vary((b) => { b.artefacts[0].sha256 = b.artefacts[0].sha256.toUpperCase() })],
  ['an artefact digest that is too short', vary((b) => { b.artefacts[0].sha256 = 'abc' })],
  ['an artefact without a licence', vary((b) => { delete b.artefacts[0].licence })],
  ['a context without the URI documents name it by', vary((b) => { delete b.artefacts[1].uri })],
  ['a context URI that is not a URI', vary((b) => { b.artefacts[1].uri = 'context.jsonld' })],
  ['a URI on an artefact that is not a context', vary((b) => { b.artefacts[2].uri = 'https://profiles.example/lamp/v1/shapes.ttl' })],
  ['an artefact member the format does not define', vary((b) => { b.artefacts[0].sourcePath = 'x' })],
  ['no steps', vary((b) => { b.validation.steps = [] })],
  ['a step the format does not name', vary((b) => { b.validation.steps = ['strict-json', 'passport-identity'] })],
  ['a step listed twice', vary((b) => { b.validation.steps = ['json-schema', 'json-schema', 'passport-identity'] })],
  ['steps without the identity check', vary((b) => { b.validation.steps = ['json-schema'] })],
  ['an engine capability the format does not name', vary((b) => { b.validation.engine.requires = ['shacl-advanced'] })],
  ['an engine capability listed twice', vary((b) => { b.validation.engine.requires = ['shacl-core', 'shacl-core'] })],
  ['an engine member without its list', vary((b) => { b.validation.engine = {} })],
  ['no blocking severity', vary((b) => { b.validation.blockingSeverities = [] })],
  ['a severity SHACL does not define', vary((b) => { b.validation.blockingSeverities = ['Error'] })],
  ['a context allowlist beside the artefacts', vary((b) => { b.validation.contextAllowlist = ['https://profiles.example/lamp/v1/context.jsonld'] })],
  ['an identity scheme other than GS1 Digital Link', vary((b) => { b.identity.scheme = 'did' })],
  ['a comparison other than the key tuple', vary((b) => { b.identity.comparison = 'string-equality' })],
  ['no subject pointer', vary((b) => { b.identity.subject.pointers = [] })],
  ['a subject pointer listed twice', vary((b) => { b.identity.subject.pointers = ['/product/id', '/product/id'] })],
  ['a subject pointer outside the product document', vary((b) => { b.identity.subject.pointers = ['/profile'] })],
  ['a subject pointer at the product document itself', vary((b) => { b.identity.subject.pointers = ['/product'] })],
  ['subject keys other than 01 and 21', vary((b) => { b.identity.subject.keys = ['01', '10'] })],
  ['subject keys in the other order', vary((b) => { b.identity.subject.keys = ['21', '01'] })],
  ['a must-equal part that is neither GTIN nor serial', vary((b) => { b.identity.mustEqual[0].part = 'lot' })],
  ['a must-equal entry without a pointer', vary((b) => { delete b.identity.mustEqual[0].pointer })],
  ['a must-not-contradict entry with a part', vary((b) => { b.identity.mustNotContradict[0].part = 'gtin' })],
  ['a granularity member that expects a model', vary((b) => { b.identity.granularityMember.whenPresent = 'model' })],
  ['a related identifier with a relation the format does not name', vary((b) => { b.identity.related[0].relation = 'sibling' })],
  ['no related list', vary((b) => { delete b.identity.related })],
  ['no positive vector', vary((b) => { b.vectors.positive = [] })],
  ['no negative vector', vary((b) => { b.vectors.negative = [] })],
  ['a vector listed twice', vary((b) => { b.vectors.negative = ['vectors/negative.json', 'vectors/negative.json'] })],
  ['an empty baseline', vary((b) => { b.baseline = '' })],
  ['no roles', vary((b) => { b.roles = [] })],
  ['a role listed twice', vary((b) => { b.roles = ['passport-reader', 'passport-reader'] })],
]

describe('profile binding, format 1: the hand-written check and the JSON Schema agree', () => {
  it.each(positives)('both accept %s', (_name, binding) => {
    expect(validate(binding), JSON.stringify(validate.errors)).toBe(true)
    expect(profileBindingProblems(binding)).toEqual([])
  })

  it.each(negatives)('both refuse %s', (_name, binding) => {
    expect(validate(binding)).toBe(false)
    const problems = profileBindingProblems(binding)
    expect(problems.length).toBeGreaterThan(0)
    for (const sentence of problems) expect(sentence).toMatch(/\.$/)
  })

  it('names the member each problem is at', () => {
    expect(profileBindingProblems(vary((b) => { b.artefacts[0].byteLength = 0 }))).toEqual(['`artefacts.0.byteLength` must be a whole number of at least 1.'])
    expect(profileBindingProblems(vary((b) => { b.policies = {} }))).toEqual(['the binding has a member the format does not define: `policies`.'])
  })
})

describe('profile binding: rules that relate one member to another', () => {
  const inconsistent = (change: Mutation): string[] => profileBindingInconsistencies(vary(change) as ProfileBinding)

  it('finds nothing wrong with a consistent binding', () => {
    expect(profileBindingInconsistencies(syntheticBinding())).toEqual([])
  })

  it('refuses a profile that is not its own id and version', () => {
    expect(inconsistent((b) => { b.profile = 'example-lamp@2' })).toEqual(['`profile` is example-lamp@2 but `id` and `version` make example-lamp@1.'])
  })

  it('refuses two artefacts at one path and two contexts under one URI', () => {
    expect(inconsistent((b) => { b.artefacts[3].path = b.artefacts[2].path })).toEqual([expect.stringMatching(/shapes\.ttl.*twice/)])
    expect(inconsistent((b) => { b.artefacts.push({ ...b.artefacts[1], path: 'other.jsonld' }) })).toEqual([expect.stringMatching(/context\.jsonld.*twice/)])
  })

  it('refuses a step whose artefacts are missing', () => {
    expect(inconsistent((b) => { b.artefacts = b.artefacts.filter((a: { role: string }) => a.role !== 'schema') })).toEqual([expect.stringMatching(/json-schema.*exactly one schema/)])
    expect(inconsistent((b) => { b.artefacts.push({ ...b.artefacts[0], path: 'second.schema.json' }) })).toEqual([expect.stringMatching(/json-schema.*exactly one schema/)])
    expect(inconsistent((b) => { b.artefacts = b.artefacts.filter((a: { role: string }) => a.role !== 'context') })).toEqual([expect.stringMatching(/json-ld-expand.*context/)])
    expect(inconsistent((b) => { b.artefacts = b.artefacts.filter((a: { role: string }) => a.role !== 'shapes') })).toEqual([expect.stringMatching(/shacl.*shapes/)])
  })

  it('refuses an artefact no listed step reads', () => {
    expect(inconsistent((b) => { b.validation.steps = ['json-ld-expand', 'shacl', 'passport-identity']; b.validation.engine.requires = ['shacl-core'] })).toEqual([expect.stringMatching(/product\.schema\.json.*no listed step/)])
  })

  it('refuses shacl without json-ld-expand before it', () => {
    expect(inconsistent((b) => { b.validation.steps = ['json-schema', 'shacl', 'json-ld-expand', 'passport-identity'] })).toEqual([expect.stringMatching(/shacl.*after.*json-ld-expand/)])
  })

  it('refuses an engine capability whose step is not listed', () => {
    expect(inconsistent((b) => { b.artefacts = [b.artefacts[0]]; b.validation.steps = ['json-schema', 'passport-identity'] })).toEqual([expect.stringMatching(/shacl-core.*shacl/), expect.stringMatching(/shacl-sparql-constraints.*shacl/)])
  })

  it('refuses a pointer the identity rules read in two ways', () => {
    expect(inconsistent((b) => { b.identity.related.push({ pointer: '/product/id', relation: 'model' }) })).toEqual([expect.stringMatching(/\/product\/id.*subject.*related/)])
  })
})

describe('reading a binding from its bytes', () => {
  it('digests the exact bytes: one more byte is another binding', () => {
    const bytes = bindingBytes(syntheticBinding())
    expect(profileBindingDigest(bytes)).toBe(sha256Hex(bytes))
    expect(profileBindingDigest(utf8(new TextDecoder().decode(bytes) + ' '))).not.toBe(profileBindingDigest(bytes))
  })

  it('returns the binding with its digest', () => {
    const bytes = bindingBytes(syntheticBinding())
    const read = readProfileBinding(bytes)
    expect(read).toEqual({ ok: true, binding: syntheticBinding(), digest: sha256Hex(bytes) })
  })

  it('refuses bytes that are not UTF-8, not JSON, or carry a member name twice', () => {
    expect(readProfileBinding(new Uint8Array([0xff, 0xfe, 0x7b]))).toMatchObject({ ok: false, code: 'binding-not-json' })
    expect(readProfileBinding(utf8('{"bindingVersion":"1"'))).toMatchObject({ ok: false, code: 'binding-not-json' })
    const twice = new TextDecoder().decode(bindingBytes(syntheticBinding())).replace('"version": 1,', '"version": 1,\n  "version": 2,')
    expect(readProfileBinding(utf8(twice))).toMatchObject({ ok: false, code: 'binding-not-json', detail: [expect.stringMatching(/"version" appears twice/)] })
  })

  it('refuses a binding the format does not accept, then one whose members disagree', () => {
    expect(readProfileBinding(bindingBytes(vary((b) => { b.granularity = 'batch' })))).toMatchObject({ ok: false, code: 'binding-invalid' })
    expect(readProfileBinding(bindingBytes(vary((b) => { b.profile = 'example-lamp@9' })))).toMatchObject({ ok: false, code: 'binding-inconsistent' })
  })

  it('describes an artefact the way a binding lists it', () => {
    const bytes = utf8('@prefix sh: <http://www.w3.org/ns/shacl#> .\n')
    expect(describeArtefact(bytes)).toEqual({ byteLength: bytes.byteLength, sha256: sha256Hex(bytes) })
  })
})
