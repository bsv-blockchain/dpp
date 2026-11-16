/**
 * The profile binding, format 1 (`spec/profiles.md` §7,
 * `schemas/profile-binding-v1.schema.json`): one immutable JSON file per
 * version of a profile whose definitions are written outside this package.
 * It names every file that defines the profile by byte length and SHA-256,
 * lists the checks a payload goes through, says how the product document
 * must match the passport that carries it, and may say which top-level
 * properties of that document are public.
 *
 * The file is checked here by hand, because this package takes no validator
 * library. The JSON Schema beside it says the same thing for every other
 * tool, and a test gives both the same vectors and compares the verdicts.
 */
import { createHash } from 'node:crypto'
import { topLevelProperty } from './access-tiers.js'
import { parseStrictJson } from './strict-json.js'

export const PROFILE_BINDING_VERSION = '1'

export type BindingArtefactRole = 'context' | 'shapes' | 'background' | 'schema'
export type BindingStep = 'json-schema' | 'json-ld-expand' | 'shacl' | 'passport-identity'
export type EngineCapability = 'json-schema-2020-12' | 'shacl-core' | 'shacl-sparql-constraints'
export type FindingSeverity = 'Violation' | 'Warning' | 'Info'

/** One file the profile is defined by. `uri` is what a document names a context by, and only a context has one. */
export interface BindingArtefact {
  role: BindingArtefactRole
  /** The file's name relative to the binding. It is what the caller's resolver is asked for. */
  path: string
  uri?: string
  mediaType: string
  byteLength: number
  sha256: string
  licence: string
}

/** How the product document must match the passport that carries it. Every pointer is a JSON Pointer into the payload envelope. */
export interface BindingIdentity {
  scheme: 'gs1-digital-link'
  comparison: 'gs1-key-tuple'
  /** Where the product document states its own identifier. Two that are present must be the same string. */
  subject: { pointers: string[]; keys: ['01', '21'] }
  /** Members that state a GTIN or a serial. Each one present must equal the subject's. */
  mustEqual: Array<{ pointer: string; part: 'gtin' | 'serial' }>
  /** Members that name the product by a link that may be coarser than the item, and must not name another product. */
  mustNotContradict: Array<{ pointer: string }>
  /** The member that declares a granularity, where the document has one. */
  granularityMember?: { pointer: string; whenPresent: 'item' }
  /** Identifiers of a model or a batch the item belongs to. They are never compared as the subject. */
  related: Array<{ pointer: string; relation: 'model' | 'batch' }>
}

/**
 * Which top-level properties of the product document are public. Every other
 * property is restricted, one the binding has never heard of included. The
 * list sits in the binding so the digest a payload declares also commits to
 * what was public when it was written.
 */
export interface BindingAccess {
  /** The name of this split, as `id@version`. */
  policy: string
  /** A property is wholly public or wholly restricted. Nothing is split inside a nested object or a list. */
  tierSplit: 'top-level-property'
  default: 'restricted'
  /** The public property names, each exactly as a product document writes it. */
  public: string[]
}

export interface ProfileBinding {
  bindingVersion: '1'
  id: string
  version: number
  profile: string
  title: string
  /** What the name covers and what it does not claim. */
  scope: string
  publisher: { name: string; registration: 'bundled' | 'local' }
  source: { name: string; repository?: string; release?: string; revision?: string; licence: string; notices: string[] }
  granularity: 'item'
  payload: { root: '/product'; mediaType: string; documents: 'one-self-contained' }
  artefacts: BindingArtefact[]
  validation: {
    steps: BindingStep[]
    engine?: { requires: EngineCapability[] }
    blockingSeverities: FindingSeverity[]
  }
  identity: BindingIdentity
  /** Absent: the profile has one tier and the whole product document is public. */
  access?: BindingAccess
  vectors: { positive: string[]; negative: string[] }
  baseline: string
  roles: string[]
}

const ID = /^[a-z][a-z0-9-]*$/u
const PROFILE = /^[a-z][a-z0-9-]*@[1-9][0-9]*$/u
const PATH = /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@-][A-Za-z0-9._@-]*)*$/u
const POINTER = /^\/product(\/[^/]+)+$/u
const URI = /^[a-z][a-z0-9+.-]*:[^\s]+$/u
const SHA256 = /^[0-9a-f]{64}$/u
const REVISION = /^[0-9a-f]{40}$/u
const ROLES: readonly string[] = ['context', 'shapes', 'background', 'schema']
const STEPS: readonly string[] = ['json-schema', 'json-ld-expand', 'shacl', 'passport-identity']
const CAPABILITIES: readonly string[] = ['json-schema-2020-12', 'shacl-core', 'shacl-sparql-constraints']
const SEVERITIES: readonly string[] = ['Violation', 'Warning', 'Info']

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The problems that make a value not a format 1 binding, one sentence each,
 * naming the member. Empty means the value has the binding's structure. This
 * is the hand-written twin of the JSON Schema: it accepts and refuses exactly
 * what the schema does, and says nothing about rules that relate one member
 * to another, which `profileBindingInconsistencies` checks.
 */
export function profileBindingProblems(value: unknown): string[] {
  const problems: string[] = []
  const say = (sentence: string): void => { problems.push(sentence) }
  const name = (at: string): string => (at === '' ? 'the binding' : `\`${at}\``)
  const join = (at: string, key: string | number): string => (at === '' ? String(key) : `${at}.${key}`)

  /** An object with exactly the members the format names: every required one present, none undefined by the format. */
  const members = (candidate: unknown, at: string, required: readonly string[], optional: readonly string[] = []): Json | undefined => {
    if (!isObject(candidate)) { say(`${name(at)} must be an object.`); return undefined }
    for (const key of required) if (!Object.hasOwn(candidate, key)) say(`${name(at)} is missing the required member \`${key}\`.`)
    for (const key of Object.keys(candidate)) if (!required.includes(key) && !optional.includes(key)) say(`${name(at)} has a member the format does not define: \`${key}\`.`)
    return candidate
  }
  const has = (object: Json, key: string): boolean => Object.hasOwn(object, key)
  const text = (object: Json, key: string, at: string, pattern?: RegExp, what = 'text of at least one character'): void => {
    if (!has(object, key)) return
    const v = object[key]
    if (typeof v !== 'string' || v.length === 0 || (pattern != null && !pattern.test(v))) say(`${name(join(at, key))} must be ${what}.`)
  }
  const constant = (object: Json, key: string, at: string, expected: string): void => {
    if (has(object, key) && object[key] !== expected) say(`${name(join(at, key))} must be ${JSON.stringify(expected)}.`)
  }
  const oneOf = (object: Json, key: string, at: string, allowed: readonly string[]): void => {
    if (has(object, key) && !(typeof object[key] === 'string' && allowed.includes(object[key]))) say(`${name(join(at, key))} must be one of ${allowed.join(', ')}.`)
  }
  /** An array whose items each pass `item`. Returns the array when it is one. */
  const list = (object: Json, key: string, at: string, options: { min?: number; unique?: boolean }, item: (entry: unknown, at: string) => void): unknown[] | undefined => {
    if (!has(object, key)) return undefined
    const v = object[key]
    const where = join(at, key)
    if (!Array.isArray(v)) { say(`${name(where)} must be a list.`); return undefined }
    if (v.length < (options.min ?? 0)) say(`${name(where)} must list at least ${options.min} ${options.min === 1 ? 'entry' : 'entries'}.`)
    // Entries are compared as JSON text, which is how the schema's uniqueness rule compares scalars and lists of them.
    if (options.unique === true && new Set(v.map((entry) => JSON.stringify(entry))).size !== v.length) say(`${name(where)} must not list an entry twice.`)
    v.forEach((entry, index) => item(entry, join(where, index)))
    return v
  }
  const textItem = (pattern: RegExp | undefined, what: string) => (entry: unknown, at: string): void => {
    if (typeof entry !== 'string' || entry.length === 0 || (pattern != null && !pattern.test(entry))) say(`${name(at)} must be ${what}.`)
  }
  const enumItem = (allowed: readonly string[]) => (entry: unknown, at: string): void => {
    if (!(typeof entry === 'string' && allowed.includes(entry))) say(`${name(at)} must be one of ${allowed.join(', ')}.`)
  }
  const isPath = (entry: unknown, at: string): void => {
    if (typeof entry !== 'string' || entry.length > 512 || !PATH.test(entry)) say(`${name(at)} must be a relative file name of at most 512 characters with no empty, dot or dot-dot segment.`)
  }
  const pointerText = 'a JSON Pointer under /product'

  const binding = members(value, '', ['bindingVersion', 'id', 'version', 'profile', 'title', 'scope', 'publisher', 'source', 'granularity', 'payload', 'artefacts', 'validation', 'identity', 'vectors', 'baseline', 'roles'], ['access'])
  if (binding == null) return problems

  constant(binding, 'bindingVersion', '', PROFILE_BINDING_VERSION)
  text(binding, 'id', '', ID, 'lower-case letters, digits and hyphens, starting with a letter')
  if (has(binding, 'version') && !(typeof binding.version === 'number' && Number.isInteger(binding.version) && binding.version >= 1)) say('`version` must be a whole number of at least 1.')
  text(binding, 'profile', '', PROFILE, 'an identifier of the form id@version')
  text(binding, 'title', '')
  text(binding, 'scope', '')
  text(binding, 'baseline', '')
  oneOf(binding, 'granularity', '', ['item'])

  if (has(binding, 'publisher')) {
    const publisher = members(binding.publisher, 'publisher', ['name', 'registration'])
    if (publisher != null) {
      text(publisher, 'name', 'publisher')
      oneOf(publisher, 'registration', 'publisher', ['bundled', 'local'])
    }
  }

  if (has(binding, 'source')) {
    const source = members(binding.source, 'source', ['name', 'licence', 'notices'], ['repository', 'release', 'revision'])
    if (source != null) {
      text(source, 'name', 'source')
      text(source, 'licence', 'source')
      text(source, 'release', 'source')
      text(source, 'repository', 'source', URI, 'a URI')
      text(source, 'revision', 'source', REVISION, 'a full commit hash of forty lower-case hexadecimal characters')
      list(source, 'notices', 'source', {}, isPath)
    }
  }

  if (has(binding, 'payload')) {
    const payload = members(binding.payload, 'payload', ['root', 'mediaType', 'documents'])
    if (payload != null) {
      constant(payload, 'root', 'payload', '/product')
      text(payload, 'mediaType', 'payload')
      constant(payload, 'documents', 'payload', 'one-self-contained')
    }
  }

  list(binding, 'artefacts', '', { min: 1 }, (entry, at) => {
    const artefact = members(entry, at, ['role', 'path', 'mediaType', 'byteLength', 'sha256', 'licence'], ['uri'])
    if (artefact == null) return
    oneOf(artefact, 'role', at, ROLES)
    if (has(artefact, 'path')) isPath(artefact.path, join(at, 'path'))
    text(artefact, 'uri', at, URI, 'a URI')
    text(artefact, 'mediaType', at)
    text(artefact, 'licence', at)
    text(artefact, 'sha256', at, SHA256, 'sixty-four lower-case hexadecimal characters')
    if (has(artefact, 'byteLength') && !(typeof artefact.byteLength === 'number' && Number.isInteger(artefact.byteLength) && artefact.byteLength >= 1)) say(`${name(join(at, 'byteLength'))} must be a whole number of at least 1.`)
    // Only a context is named by a URI: one without it could never be handed to a document, and one elsewhere would be read by nothing.
    if (artefact.role === 'context' && !has(artefact, 'uri')) say(`${name(at)} is a context and is missing the required member \`uri\`.`)
    if (artefact.role !== 'context' && has(artefact, 'uri')) say(`${name(at)} is not a context and must not carry \`uri\`.`)
  })

  if (has(binding, 'validation')) {
    const validation = members(binding.validation, 'validation', ['steps', 'blockingSeverities'], ['engine'])
    if (validation != null) {
      const steps = list(validation, 'steps', 'validation', { min: 1, unique: true }, enumItem(STEPS))
      if (steps != null && !steps.includes('passport-identity')) say('`validation.steps` must include passport-identity.')
      list(validation, 'blockingSeverities', 'validation', { min: 1, unique: true }, enumItem(SEVERITIES))
      if (has(validation, 'engine')) {
        const engine = members(validation.engine, 'validation.engine', ['requires'])
        if (engine != null) list(engine, 'requires', 'validation.engine', { unique: true }, enumItem(CAPABILITIES))
      }
    }
  }

  if (has(binding, 'identity')) {
    const identity = members(binding.identity, 'identity', ['scheme', 'comparison', 'subject', 'mustEqual', 'mustNotContradict', 'related'], ['granularityMember'])
    if (identity != null) {
      constant(identity, 'scheme', 'identity', 'gs1-digital-link')
      constant(identity, 'comparison', 'identity', 'gs1-key-tuple')
      if (has(identity, 'subject')) {
        const subject = members(identity.subject, 'identity.subject', ['pointers', 'keys'])
        if (subject != null) {
          list(subject, 'pointers', 'identity.subject', { min: 1, unique: true }, textItem(POINTER, pointerText))
          if (has(subject, 'keys') && JSON.stringify(subject.keys) !== '["01","21"]') say('`identity.subject.keys` must be the list "01", "21".')
        }
      }
      list(identity, 'mustEqual', 'identity', {}, (entry, at) => {
        const rule = members(entry, at, ['pointer', 'part'])
        if (rule == null) return
        text(rule, 'pointer', at, POINTER, pointerText)
        oneOf(rule, 'part', at, ['gtin', 'serial'])
      })
      list(identity, 'mustNotContradict', 'identity', {}, (entry, at) => {
        const rule = members(entry, at, ['pointer'])
        if (rule != null) text(rule, 'pointer', at, POINTER, pointerText)
      })
      list(identity, 'related', 'identity', {}, (entry, at) => {
        const rule = members(entry, at, ['pointer', 'relation'])
        if (rule == null) return
        text(rule, 'pointer', at, POINTER, pointerText)
        oneOf(rule, 'relation', at, ['model', 'batch'])
      })
      if (has(identity, 'granularityMember')) {
        const member = members(identity.granularityMember, 'identity.granularityMember', ['pointer', 'whenPresent'])
        if (member != null) {
          text(member, 'pointer', 'identity.granularityMember', POINTER, pointerText)
          constant(member, 'whenPresent', 'identity.granularityMember', 'item')
        }
      }
    }
  }

  if (has(binding, 'access')) {
    const access = members(binding.access, 'access', ['policy', 'tierSplit', 'default', 'public'])
    if (access != null) {
      text(access, 'policy', 'access', PROFILE, 'an identifier of the form id@version')
      constant(access, 'tierSplit', 'access', 'top-level-property')
      constant(access, 'default', 'access', 'restricted')
      list(access, 'public', 'access', { min: 1, unique: true }, textItem(undefined, 'text of at least one character'))
    }
  }

  if (has(binding, 'vectors')) {
    const vectors = members(binding.vectors, 'vectors', ['positive', 'negative'])
    if (vectors != null) {
      list(vectors, 'positive', 'vectors', { min: 1, unique: true }, isPath)
      list(vectors, 'negative', 'vectors', { min: 1, unique: true }, isPath)
    }
  }

  list(binding, 'roles', '', { min: 1, unique: true }, textItem(undefined, 'text of at least one character'))
  return problems
}

/** Which artefact roles each step reads. */
const STEP_ROLES: Record<BindingStep, BindingArtefactRole[]> = {
  'json-schema': ['schema'],
  'json-ld-expand': ['context'],
  shacl: ['shapes', 'background'],
  'passport-identity': [],
}

/** Which step each engine capability belongs to. */
const CAPABILITY_STEP: Record<EngineCapability, BindingStep> = {
  'json-schema-2020-12': 'json-schema',
  'shacl-core': 'shacl',
  'shacl-sparql-constraints': 'shacl',
}

/**
 * The ways a structurally valid binding contradicts itself, one sentence
 * each. A schema cannot state these, because each relates one member to
 * another: the profile name to its parts, a step to the files it reads, a
 * capability to its step. A binding with any of them is refused at
 * registration, since it could not be applied as written.
 */
export function profileBindingInconsistencies(binding: ProfileBinding): string[] {
  const problems: string[] = []
  const expected = `${binding.id}@${binding.version}`
  if (binding.profile !== expected) problems.push(`\`profile\` is ${binding.profile} but \`id\` and \`version\` make ${expected}.`)

  const twice = (values: string[]): string[] => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))]
  for (const path of twice(binding.artefacts.map((a) => a.path))) problems.push(`the artefact path ${path} is listed twice.`)
  for (const uri of twice(binding.artefacts.flatMap((a) => (a.uri == null ? [] : [a.uri])))) {
    const first = binding.artefacts.find((a) => a.uri === uri)!
    problems.push(`the context URI of ${first.path} is listed twice: ${uri}.`)
  }

  const steps = binding.validation.steps
  const count = (role: BindingArtefactRole): number => binding.artefacts.filter((a) => a.role === role).length
  if (steps.includes('json-schema') && count('schema') !== 1) problems.push(`the json-schema step needs exactly one schema artefact; the binding lists ${count('schema')}.`)
  if (steps.includes('json-ld-expand') && count('context') === 0) problems.push('the json-ld-expand step needs at least one context artefact.')
  if (steps.includes('shacl') && count('shapes') === 0) problems.push('the shacl step needs at least one shapes artefact.')
  if (steps.includes('shacl') && !steps.slice(0, steps.indexOf('shacl')).includes('json-ld-expand')) problems.push('the shacl step must come after json-ld-expand, which gives it the data to check.')

  const read = new Set(steps.flatMap((step) => STEP_ROLES[step]))
  for (const artefact of binding.artefacts) if (!read.has(artefact.role)) problems.push(`the ${artefact.role} artefact ${artefact.path} is read by no listed step.`)
  for (const capability of binding.validation.engine?.requires ?? []) {
    if (!steps.includes(CAPABILITY_STEP[capability])) problems.push(`the engine capability ${capability} belongs to the ${CAPABILITY_STEP[capability]} step, which the binding does not list.`)
  }

  const subject = new Set(binding.identity.subject.pointers)
  const others: Array<[string, string]> = [
    ...binding.identity.mustEqual.map((rule): [string, string] => [rule.pointer, 'a stated value']),
    ...binding.identity.mustNotContradict.map((rule): [string, string] => [rule.pointer, 'a product identifier']),
    ...binding.identity.related.map((rule): [string, string] => [rule.pointer, 'a related identifier']),
  ]
  for (const [pointer, use] of others) if (subject.has(pointer)) problems.push(`${pointer} is read both as the subject and as ${use}.`)

  if (binding.access != null) {
    const open = new Set(binding.access.public)
    // A reader of the public payload makes the same identity comparison as a writer. A member the comparison
    // reads that sat in the restricted tier would be skipped there without a word, and the two could disagree.
    const read = [...binding.identity.subject.pointers, ...binding.identity.mustEqual.map((rule) => rule.pointer), ...binding.identity.mustNotContradict.map((rule) => rule.pointer), ...(binding.identity.granularityMember == null ? [] : [binding.identity.granularityMember.pointer])]
    const missing = new Map<string, string>()
    for (const pointer of read) {
      const property = topLevelProperty(pointer)
      if (!open.has(property) && !missing.has(property)) missing.set(property, pointer)
    }
    for (const [property, pointer] of missing) problems.push(`\`access.public\` does not list ${property}, which the identity rules read at ${pointer}.`)
    if (steps.includes('json-ld-expand') && !open.has('@context')) problems.push('`access.public` does not list @context, which the json-ld-expand step needs to read a public payload.')
  }
  return problems
}

/** The byte length and SHA-256 a binding records for an artefact. An author runs each file through this when writing the binding. */
export function describeArtefact(bytes: Uint8Array): { byteLength: number; sha256: string } {
  return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * The binding digest: the SHA-256 of the file's exact bytes, as lower-case
 * hexadecimal. It is taken over the bytes and never over a re-serialised
 * object, so the file cannot hold it and two spellings of one binding are two
 * bindings.
 */
export function profileBindingDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export type BindingReadRefusalCode = 'binding-not-json' | 'binding-invalid' | 'binding-inconsistent'
export type BindingRead = { ok: true; binding: ProfileBinding; digest: string } | { ok: false; code: BindingReadRefusalCode; detail: string[] }

/**
 * A binding read from its bytes: UTF-8, strict JSON, the format's structure
 * and the rules between members, in that order. The digest is of the bytes
 * as given.
 */
export function readProfileBinding(bytes: Uint8Array): BindingRead {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, code: 'binding-not-json', detail: ['the bytes are not UTF-8.'] }
  }
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return { ok: false, code: 'binding-not-json', detail: [`${parsed.detail}.`] }
  const problems = profileBindingProblems(parsed.value)
  if (problems.length > 0) return { ok: false, code: 'binding-invalid', detail: problems }
  const binding = parsed.value as ProfileBinding
  const inconsistencies = profileBindingInconsistencies(binding)
  if (inconsistencies.length > 0) return { ok: false, code: 'binding-inconsistent', detail: inconsistencies }
  return { ok: true, binding, digest: profileBindingDigest(bytes) }
}
