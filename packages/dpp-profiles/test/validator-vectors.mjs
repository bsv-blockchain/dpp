/**
 * The vectors a validation engine is held to, as one list that any pair of
 * engines can be run through: the two bundled sector bindings' positive and
 * negative cases and the two example custom profiles' payload vectors.
 *
 * The same list is run with the engine in this process, with a client of a
 * validator service started in the test, with a client of a stand-in service
 * written for the test, and with a client of the built image
 * (`scripts/validator-parity.mjs`). An engine behind a service is the same
 * engine only if every one of these gives the same answer.
 *
 * This file is plain JavaScript and imports nothing from the package. The
 * caller hands it the package's exports, so a test hands it the source and
 * the parity script hands it the built package.
 *
 * Every payload is made in memory from the documents and vector files on
 * disk, exactly as `sector-bindings.test.ts`, `sector-access.test.ts` and
 * `custom-profile-example.test.ts` make them. No altered copy of a product
 * document is stored.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NOTICE = 'Demonstration record: this passport describes no real product.'
/** The passport is issued under the writer's own host, which is not the host the product document names. */
const PASSPORT_HOST = 'passports.example'

const json = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** The document without the members whose name starts `_comment`, at any depth. */
const withoutNotes = (node) => {
  if (Array.isArray(node)) return node.map(withoutNotes)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node).filter(([name]) => !name.startsWith('_comment')).map(([name, value]) => [name, withoutNotes(value)]))
}

/** The product with a case's `set` members written and its `remove` pointers deleted. */
const changed = (product, change) => {
  const copy = { ...structuredClone(product), ...(change.set ?? {}) }
  for (const pointer of change.remove ?? []) {
    const tokens = pointer.split('/').slice(1)
    let at = copy
    for (const token of tokens.slice(0, -1)) at = at[token]
    if (!Object.hasOwn(at, tokens.at(-1))) throw new Error(`${pointer} is not there to remove`)
    delete at[tokens.at(-1)]
  }
  return copy
}

/**
 * The vectors, each with a name, what it is expected to answer and a `run`
 * that takes `{ jsonLd, shacl }` and returns the validator's whole answer.
 *
 * @param {object} options
 * @param {object} options.api      the exports of `@bsv/dpp-profiles`
 * @param {string} options.repo     the repository root
 * @param {() => object} options.compiler  a fresh JSON Schema 2020-12 compiler, for the example profiles' schema step
 */
export async function validatorVectors({ api, repo, compiler }) {
  const packageRoot = join(repo, 'packages', 'dpp-profiles')
  const vectors = []
  const add = (name, expected, run) => vectors.push({ name, expected, sparqlOnly: expected.constraint === 'SPARQLConstraintComponent', run })

  // The two bundled sector bindings.
  const registry = api.createProfileRegistry({ trustedBindingDigests: api.BUNDLED_BINDING_DIGESTS })
  for (const result of await api.registerBundledBindings(registry)) if (!result.ok) throw new Error(`a bundled binding did not register: ${result.code}`)
  const sectors = api.BUNDLED_BINDINGS.map(({ profile, bindingDigest }) => {
    const binding = json(join(packageRoot, 'bindings', profile, 'binding.json'))
    const fixtures = join(packageRoot, 'test', 'fixtures', 'sector-bindings', profile)
    const documents = new Map(binding.vectors.positive.map((path) => [path, json(join(fixtures, path))]))
    const cases = binding.vectors.negative.flatMap((path) => json(join(fixtures, path)).cases)
    return { profile, bindingDigest, binding, documents, cases }
  })
  const published = (sector, path) => structuredClone(sector.documents.get(path))
  const positive = (sector, path) => withoutNotes(published(sector, path))
  const passportIdOf = (document) => {
    const link = api.parseGs1DigitalLink(document.id)
    return api.buildGs1DigitalLink(PASSPORT_HOST, link.gtin, link.serial)
  }
  const envelope = (sector, product, bindingDigest = sector.bindingDigest) => ({ notice: NOTICE, profile: sector.binding.id, profile_version: sector.binding.version, profile_binding_sha256: bindingDigest, product })
  /** The envelope's product cut in two, and both parts checked together: what a reader who holds both parts of a state does. */
  const authorised = (sector, payload, passportId) => (engines) => {
    const { publicProduct, restrictedProduct } = api.splitProductByAccess({ binding: sector.binding, product: payload.product })
    return api.authorisedPayloadValidator({ registry, engines })({
      profile: sector.binding.id,
      profileVersion: sector.binding.version,
      payloadPublic: JSON.stringify({ ...payload, product: publicProduct }),
      ...(restrictedProduct == null ? {} : { restrictedProduct }),
      ...(passportId == null ? {} : { passportId }),
    })
  }
  /** The public part alone, which is what any reader holds, less the public properties named in `dropped`. */
  const publicOnly = (sector, payload, passportId, dropped = []) => (engines) => {
    const { publicProduct } = api.splitProductByAccess({ binding: sector.binding, product: payload.product })
    const product = Object.fromEntries(Object.entries(publicProduct).filter(([name]) => !dropped.includes(name)))
    return api.bindingPayloadValidator({ registry, engines })({ profile: sector.binding.id, profileVersion: sector.binding.version, payloadPublic: JSON.stringify({ ...payload, product }), passportId })
  }
  /** What a case does beyond its `set` and `remove`. */
  const special = {
    'notes-kept': (sector, c) => { const document = published(sector, c.from); return authorised(sector, envelope(sector, document), passportIdOf(document)) },
    'unlisted-context': (sector, c) => {
      const product = positive(sector, c.from)
      return authorised(sector, envelope(sector, { ...product, '@context': [...product['@context'], 'https://contexts.example/unlisted.jsonld'] }), passportIdOf(product))
    },
    'no-passport-identifier': (sector, c) => authorised(sector, envelope(sector, positive(sector, c.from))),
    'engine-outage': (sector, c) => {
      const product = positive(sector, c.from)
      const run = authorised(sector, envelope(sector, product), passportIdOf(product))
      // The engine that expanded the document, with a SHACL engine that is not running.
      return (engines) => run({ jsonLd: engines.jsonLd, shacl: { get capabilities() { return engines.shacl.capabilities }, validate: async () => { throw new Error('the engine is not running') } } })
    },
    'wrong-binding-digest': (sector, c) => {
      const product = positive(sector, c.from)
      return authorised(sector, envelope(sector, product, sectors.find((s) => s !== sector).bindingDigest), passportIdOf(product))
    },
  }
  for (const sector of sectors) {
    for (const path of sector.binding.vectors.positive) {
      const product = positive(sector, path)
      add(`${sector.profile} ${path}`, { status: 'pass' }, authorised(sector, envelope(sector, product), passportIdOf(product)))
      add(`${sector.profile} ${path} (public payload alone)`, { status: 'pass' }, publicOnly(sector, envelope(sector, product), passportIdOf(product)))
    }
    // A public property the shapes require of the item, left out of the public payload. To tell it from a withheld
    // check the validator asks the engine to expand again, so this is the case that makes several calls for one answer.
    const required = sector.binding.access.public.find((name) => name === 'oec:passportStatus')
    const first = positive(sector, sector.binding.vectors.positive[0])
    if (sector.profile === 'eu-battery@1' && required != null && Object.hasOwn(first, required)) {
      add(`${sector.profile} ${sector.binding.vectors.positive[0]} (public payload alone, without ${required})`, { status: 'fail', cause: 'profile-rule-violation', step: 'shacl', constraint: 'MinCountConstraintComponent' }, publicOnly(sector, envelope(sector, first), passportIdOf(first), [required]))
    }
    for (const c of sector.cases) {
      // A registration case is refused by the registry before any engine is asked, so no engine can differ on it.
      if ('refusal' in c.expected) continue
      const made = special[c.name]
      if (made != null) { add(`${sector.profile} ${c.name}`, c.expected, made(sector, c)); continue }
      const base = positive(sector, c.from)
      add(`${sector.profile} ${c.name}`, c.expected, authorised(sector, envelope(sector, changed(base, c)), passportIdOf(c.passportOf == null ? base : positive(sector, c.passportOf))))
    }
  }

  // The two example custom profiles, registered from their folders.
  const examples = join(repo, 'examples', 'custom-profile')
  const profiles = ['example-bottle@1', 'example-notebook@1'].map((name) => {
    const folder = join(examples, name)
    const bindingBytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))
    return { name, folder, bindingBytes, digest: api.profileBindingDigest(bindingBytes), binding: json(join(folder, 'binding.json')) }
  })
  const custom = api.createProfileRegistry({ trustedBindingDigests: profiles.map((p) => p.digest) })
  for (const p of profiles) {
    const result = await custom.register({ bindingBytes: p.bindingBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(p.folder, artefact.path))) })
    if (!result.ok) throw new Error(`${p.name} did not register: ${result.code}`)
  }
  // One compiler for the whole list: the schema step is the application's, in every arrangement.
  const jsonSchema = compiler()
  for (const p of profiles) {
    for (const path of [...p.binding.vectors.positive, ...p.binding.vectors.negative]) {
      const vector = json(join(p.folder, path))
      if (vector.kind !== 'payload') continue
      add(`${p.name} ${path}`, vector.expected, (engines) => api.bindingPayloadValidator({ registry: custom, engines: { jsonSchema, ...engines } })({ profile: p.binding.id, profileVersion: p.binding.version, payloadPublic: JSON.stringify(vector.payload), ...(vector.passportId == null ? {} : { passportId: vector.passportId }) }))
    }
  }
  return vectors
}

/** Every vector run in order with one pair of engines: `[{ name, result }]`. */
export async function runVectors(vectors, engines) {
  const results = []
  for (const vector of vectors) results.push({ name: vector.name, result: await vector.run(engines) })
  return results
}

/**
 * What an answer decided, without the sentences that explain it: the status,
 * the cause, each step with its status, cause, findings and withheld checks.
 * Two engines that are not the same code may word a refusal differently and
 * must still agree on all of this.
 */
export function decisionOf(result) {
  const detail = result.detail ?? {}
  return {
    status: result.status,
    reasonCode: result.reasonCode,
    cause: detail.cause,
    steps: (detail.steps ?? []).map((step) => ({ step: step.step, status: step.status, cause: step.cause, findings: step.findings, withheld: step.withheld, refusal: step.refusal })),
    withheld: detail.access?.withheld,
  }
}

/** The sentences saying where a vector's answer is not what the vector expects. Empty when it is. */
export function expectationProblems(vector, result) {
  const { expected } = vector
  const problems = []
  const detail = result.detail ?? {}
  if (expected.status != null && result.status !== expected.status) problems.push(`${vector.name}: status ${result.status}, expected ${expected.status}`)
  if (expected.cause != null && detail.cause !== expected.cause) problems.push(`${vector.name}: cause ${detail.cause}, expected ${expected.cause}`)
  if (expected.step != null) {
    const first = (detail.steps ?? []).find((s) => s.status === expected.status)
    if (first?.step !== expected.step) problems.push(`${vector.name}: decided at ${first?.step}, expected ${expected.step}`)
    if (expected.constraint != null) {
      const violations = (first?.findings ?? []).filter((f) => f.severity === 'Violation').map((f) => f.constraint)
      if (violations.length !== 1 || violations[0] !== expected.constraint) problems.push(`${vector.name}: violations ${JSON.stringify(violations)}, expected ${expected.constraint}`)
    }
  }
  return problems
}
