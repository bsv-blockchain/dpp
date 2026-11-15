// Profiles held by a binding: a data model defined outside @bsv/dpp-profiles,
// as JSON-LD contexts and SHACL shapes or as a JSON Schema, that the package
// validates through one immutable binding file. This module is assembled once
// at start-up: it opens the validation engine the configuration chose
// (validation-engine.ts), registers the profiles and any folder the
// configuration names, and then answers for the writer, the reader and the
// forms.
//
// Where the profiles come from is a setting. By default the two sector
// bindings are read from the folder the profiles package ships. With
// PROFILE_BUNDLE_DIR they are read from a profile bundle in that folder, as a
// restore installs it, and the package's folder is not read. The bundle is a
// second resolver for the same registry: the files come from somewhere else,
// and every rule about them stays the same.
//
// Three rules hold throughout. Trust is a list of binding digests, and a
// folder or a bundle whose digest is not on it is refused. A check that could
// not run is never a pass, so without the engine a bound profile cannot be
// written and a reading says "not checked". No profile file is ever fetched:
// every context is read from the binding's own folder or from the bundle.
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_BINDINGS,
  BUNDLED_BINDING_DIGESTS,
  authorisedPayloadValidator,
  bindingPayloadValidator,
  bundledBindingLicenceTexts,
  bundledBindingNotices,
  createProfileRegistry,
  openProfileBundle,
  prepareBoundPayload,
  profileBindingDigest,
  profileBundleDirectory,
  registerBundledBindings,
  registerProfileBundle,
  type AuthorisedPayloadToValidate,
  type BindingProfile,
  type BindingStepOutcome,
  type BindingValidationDetail,
  type BoundPayloadRefusal,
  type EngineFinding,
  type PayloadToValidate,
  type PayloadValidation,
  type PreparedBoundPayload,
  type ProfileRegistry,
  type ValidationEngines,
  type WithheldCheck,
} from '@bsv/dpp-profiles'
import { ajv } from './profiles.js'
import { openValidationEngine, type ValidationEngineSettings } from './validation-engine.js'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The project root, where .env lives: a relative folder in the configuration is read from here. */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export interface BoundProfilesOptions {
  /** Folders that each hold one binding.json and the files it names. */
  customProfileDirs?: string[]
  /** The digests of the custom bindings this deployment reviewed and chose to trust. */
  trustedBindingDigests?: string[]
  /** A folder that holds a profile bundle. Set, bound profiles are registered from it and the package's own bindings folder is not read. */
  profileBundleDir?: string
  /** The validation engine: a validator service's address and token, or neither for the engine in this process. */
  validator?: ValidationEngineSettings
  /** How a validation library is loaded. Tests pass one that fails, to stand in for libraries that are not installed. */
  loadEngineLibrary?: (name: string) => Promise<unknown>
  /** The transport to a validator service. The platform's by default. */
  fetch?: typeof globalThis.fetch
  /** How long one exchange with a validator service may take, in milliseconds. */
  validatorTimeoutMs?: number
  log?: (line: string) => void
}

/** A licence text as a profile bundle carries it. */
export interface ProfileLicenceText {
  licence: string
  bytes: Uint8Array
  mediaType?: string
  fileName?: string
}

/** A profile that was not registered at start-up, and why. The API runs without it. */
export interface ProfileRefusal {
  /** The bundled profile, or the folder the configuration named. */
  source: string
  code: string
  detail: string
}

/**
 * How a view of a payload came out, for a person. `not-checked` is every
 * answer that is not a decision: no engine, an unregistered profile, a rule
 * that needs the restricted part. It is never shown as a pass.
 */
export type ViewStatus = 'pass' | 'fail' | 'not-checked'

/** A SHACL finding, with the place in the product document it concerns when that could be worked out. */
export interface LocatedFinding extends EngineFinding {
  step: string
  /** A JSON pointer into the product document: the node, then the property. */
  pointer?: string
  /** The property as the document writes it, such as `gs1:netWeight`. */
  property?: string
}

export interface ViewCheck {
  view: 'public' | 'authorised' | 'whole'
  status: ViewStatus
  /** The precise cause, in the validator's own word. Absent on a pass. */
  cause?: string
  /** One or more sentences saying what this answer means, and what it does not. */
  summary: string
  steps: Array<{ step: string; status: ViewStatus; cause?: string; messages: string[] }>
  findings: LocatedFinding[]
  /** The rules this view could not decide, because they need a property it does not hold. */
  withheld: WithheldCheck[]
}

export interface BoundProfileDescription {
  id: string
  format: 'binding'
  title: string
  description: string
  bindingDigest: string
  steps: string[]
  /** The split, when the binding makes one: every property not listed is restricted. */
  access?: { policy: string; public: string[] }
  /** The contexts a product document may name, by the file name the binding gives each. */
  contexts: Array<{ path: string; uri: string }>
  /** Prefixes the contexts define, so a property's full name can be written the way documents write it. */
  prefixes: Record<string, string>
  engine: { available: boolean; kind: 'in-process' | 'service'; problem?: string }
}

export interface BoundProfiles {
  readonly registry: ProfileRegistry
  engines: ValidationEngines
  /** Where the JSON-LD and SHACL engines run: in this process, or in a validator service. */
  engineKind: 'in-process' | 'service'
  /** Why the JSON-LD and SHACL engines cannot be used, as last found. For a validator service this changes as the service comes and goes. */
  readonly engineProblem: string | undefined
  /** Look at the engine again. A validator service is asked what it is; the engine in this process answers what start-up found. */
  checkEngine(): Promise<void>
  /** Where bound profiles are resolved from: the folder the profiles package ships, or a profile bundle. */
  source: 'package' | 'bundle'
  readonly refusals: ProfileRefusal[]
  /** Register every profile again from the configured sources, into a new registry. A restore calls it after it installed a bundle. */
  reload(): Promise<void>
  /** The bytes of a notice a registered binding lists, from wherever the binding was read. It is what an export of the profiles carries beside them. */
  readNotice(profile: BindingProfile, path: string): Promise<Uint8Array | undefined>
  /** The licence texts that travel with the registered profiles, where this deployment holds them. */
  licenceTexts(): Promise<ProfileLicenceText[]>
  /** The registered binding for `id@version`, or nothing. */
  get(profile: string): BindingProfile | undefined
  list(): BindingProfile[]
  describe(profile: BindingProfile): BoundProfileDescription
  /** The code values the profile's vocabulary defines for each class asked for, as documents write them. */
  codeLists(profile: BindingProfile, classes: string[]): Promise<Record<string, Array<{ value: string; label: string }>>>
  /** The writer's call: validate the whole document, split it and build the exact public payload. */
  prepare(input: { profile: BindingProfile; product: Json; passportId: string; notice?: string }): Promise<PreparedBoundPayload | BoundPayloadRefusal>
  /** The public view: what the report runs for every state. */
  validatePublic(payload: PayloadToValidate): Promise<PayloadValidation>
  /** The authorised view: the public payload rejoined with the restricted part. */
  validateAuthorised(payload: AuthorisedPayloadToValidate): Promise<PayloadValidation>
  /** A validation as the API reports it, with each finding placed in the document where it can be. */
  viewCheck(view: ViewCheck['view'], validation: PayloadValidation, located?: { profile: BindingProfile; product: Json }): Promise<ViewCheck>
}

const detailOf = (validation: PayloadValidation): BindingValidationDetail | undefined => (isObject(validation.detail) ? (validation.detail as unknown as BindingValidationDetail) : undefined)

/** `id@version` split into the pair the registry takes; nothing for any other form. */
export function profileParts(profile: string): { id: string; version: number } | undefined {
  const match = /^(.+)@([1-9][0-9]*)$/.exec(profile)
  return match == null ? undefined : { id: match[1], version: Number(match[2]) }
}

const SUMMARIES: Record<ViewCheck['view'], Record<ViewStatus, string>> = {
  public: {
    pass: 'The public payload carries only public properties, every rule it could break was evaluated and held, and it describes this passport\'s item. This says nothing about restricted data.',
    fail: 'The public payload breaks a rule of its profile, or is not about this passport\'s item.',
    'not-checked': 'The public payload was not checked to a decision.',
  },
  authorised: {
    pass: 'The public payload rejoined with the restricted part satisfies the profile and describes this passport\'s item. This is not a statement about the on-chain commitment: that is the owner-tier check.',
    fail: 'The rejoined document breaks a rule of its profile, or the two parts do not belong together.',
    'not-checked': 'The rejoined document was not checked to a decision.',
  },
  whole: {
    pass: 'The whole product document satisfies the profile and describes this passport\'s item.',
    fail: 'The whole product document breaks a rule of its profile, or is not about this passport\'s item.',
    'not-checked': 'The whole product document was not checked to a decision.',
  },
}

/** A manifest profile's payload is checked against its public schema and nothing else, so its answer says no more than that. */
const SCHEMA_SUMMARIES: Record<ViewStatus, string> = {
  pass: 'The public payload fits the public schema of the profile it declares. This says nothing about the owner tier.',
  fail: 'The public payload does not fit the public schema of the profile it declares.',
  'not-checked': 'The public payload was not checked to a decision.',
}

const NOT_CHECKED_REASONS: Record<string, string> = {
  'profile-unknown': 'This application holds no binding for the profile the payload declares.',
  'profile-retired': 'The payload declares a retired profile. Its rules are no longer applied, so the payload is neither passed nor failed.',
  'validator-unavailable': 'A validation step could not run.',
  'product-identity-unavailable': 'The product document could not be compared with the passport identifier.',
  'restricted-tier-withheld': 'A rule needs a restricted property, which this view does not hold.',
}

/** Prefix definitions of a JSON-LD context: a term whose whole value is a namespace address. */
function prefixesOf(profile: BindingProfile): Record<string, string> {
  const prefixes: Record<string, string> = {}
  const read = (context: unknown): void => {
    if (Array.isArray(context)) return context.forEach(read)
    if (!isObject(context)) return
    for (const [term, value] of Object.entries(context)) {
      if (!term.startsWith('@') && typeof value === 'string' && /^[a-z][a-z0-9+.-]*:.*[/#]$/i.test(value) && prefixes[term] == null) prefixes[term] = value
    }
  }
  for (const { artefact, bytes } of profile.artefacts) {
    if (artefact.role !== 'context') continue
    try {
      read((JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Json)['@context'])
    } catch {
      // A context that does not parse was already refused or will fail validation; it defines no prefix here.
    }
  }
  return prefixes
}

/** An address written the way documents write it, `prefix:name`, when a prefix covers it. */
function compactWith(prefixes: Record<string, string>, iri: string): string | undefined {
  let best: [string, string] | undefined
  for (const entry of Object.entries(prefixes)) if (iri.startsWith(entry[1]) && (best == null || entry[1].length > best[1].length)) best = entry
  return best == null ? undefined : `${best[0]}:${iri.slice(best[1].length)}`
}

const escapePointer = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')
const POINTER_NODE = 'urn:x-dpp-pointer:'

/**
 * A copy of the product document in which every nested node that has no
 * identifier is given one made from its place in the document. It is used
 * only to find where a finding belongs and is never validated as the
 * product, signed or stored: naming a node can change what a shape decides,
 * so the findings themselves always come from the document as written.
 */
function withPointerNodes(product: Json): { document: Json; pointers: Map<string, string> } {
  const pointers = new Map<string, string>()
  const visit = (value: unknown, pointer: string, root: boolean): unknown => {
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, `${pointer}/${index}`, false))
    if (!isObject(value)) return value
    // A value object, such as text with a language, is a literal and has no identifier.
    if (Object.hasOwn(value, '@value')) return value
    const copy: Json = {}
    for (const [key, child] of Object.entries(value)) copy[key] = key === '@context' ? child : visit(child, `${pointer}/${escapePointer(key)}`, false)
    const stated = [value['@id'], value.id].find((id): id is string => typeof id === 'string')
    if (stated != null) {
      if (!pointers.has(stated)) pointers.set(stated, pointer)
    } else if (!root && Object.keys(value).length > 0) {
      const id = `${POINTER_NODE}${encodeURI(pointer)}`
      copy['@id'] = id
      pointers.set(id, pointer)
    }
    return copy
  }
  return { document: visit(product, '', true) as Json, pointers }
}

/**
 * A result path as the steps to follow from the node: `<a>/<b>` is two
 * steps, and `<a>|<b>` is one step with two spellings. Nothing for a path
 * with any other operator, which is then placed at its node only.
 */
function pathSteps(path: string): string[][] | undefined {
  if (!/[<>]/.test(path)) return [[path]]
  const names = (text: string): string[] => [...text.matchAll(/<([^<>]+)>/g)].map((match) => match[1])
  if (/^<[^<>]+>(\/<[^<>]+>)*$/.test(path)) return names(path).map((name) => [name])
  if (/^<[^<>]+>(\|<[^<>]+>)+$/.test(path)) return [names(path)]
  return undefined
}

/** The value a JSON pointer names in a document, or nothing. */
function valueAt(document: unknown, pointer: string): unknown {
  let value = document
  for (const segment of pointer.split('/').slice(1)) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Json)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return value
}

const findingKey = (finding: EngineFinding): string => JSON.stringify([finding.severity, finding.constraint, finding.path ?? null, finding.message ?? null, finding.value ?? null])

/** What one pass over the configured sources registered: the registry, what was refused, and where each profile's notices are read from. */
interface Registered {
  registry: ProfileRegistry
  refusals: ProfileRefusal[]
  validatePublic: BoundProfiles['validatePublic']
  validateAuthorised: BoundProfiles['validateAuthorised']
  /** By binding digest: how a notice of that binding is read. */
  notices: Map<string, (path: string) => Promise<Uint8Array | undefined>>
  licenceTexts: () => Promise<ProfileLicenceText[]>
}

export async function openBoundProfiles(options: BoundProfilesOptions = {}): Promise<BoundProfiles> {
  const log = options.log ?? (() => {})

  // The engine is opened once. Without it the API still starts: a bound profile then cannot be written, and a reading says "not checked".
  const loadLibrary = options.loadEngineLibrary ?? ((name: string): Promise<unknown> => import(name))
  const engine = await openValidationEngine(options.validator ?? {}, {
    load: loadLibrary,
    ...(options.fetch == null ? {} : { fetch: options.fetch }),
    ...(options.validatorTimeoutMs == null ? {} : { timeoutMs: options.validatorTimeoutMs }),
    log,
  })
  const engines: ValidationEngines = { jsonSchema: ajv, ...engine.engines }

  const custom = options.customProfileDirs ?? []
  const bundleDir = options.profileBundleDir == null ? undefined : isAbsolute(options.profileBundleDir) ? options.profileBundleDir : resolve(PROJECT_ROOT, options.profileBundleDir)
  const source: BoundProfiles['source'] = bundleDir == null ? 'package' : 'bundle'

  /** One pass over the configured sources, into a registry of its own. Trust is the same list whichever source the files come from. */
  const register = async (): Promise<Registered> => {
    const refusals: ProfileRefusal[] = []
    const refuse = (from: string, code: string, detail: string): void => {
      refusals.push({ source: from, code, detail })
      log(`Profile ${from} was not registered (${code}): ${detail} The API continues without it.`)
    }
    const notices: Registered['notices'] = new Map()
    let licenceTexts: Registered['licenceTexts'] = async () => []
    const registry = createProfileRegistry({ trustedBindingDigests: [...BUNDLED_BINDING_DIGESTS, ...(options.trustedBindingDigests ?? [])] })

    if (bundleDir == null) {
      for (const result of await registerBundledBindings(registry)) {
        if (!result.ok) refuse(result.profile ?? 'a bundled binding', result.code, result.detail)
      }
      const packaged = bundledBindingNotices()
      for (const profile of registry.list()) if (profile.format === 'binding') notices.set(profile.bindingDigest, async (path) => packaged(profile, path))
      licenceTexts = async () => bundledBindingLicenceTexts()
    } else {
      // The bundle is read from this deployment's own folder. A sector profile is expected under the digest the installed
      // profiles package publishes for it, so a bundle that carries another definition under that name is refused whoever
      // put it there, and every other binding must be on this deployment's own trusted list.
      const opened = await openProfileBundle(profileBundleDirectory(bundleDir))
      if (!opened.ok) {
        refuse(`the profile bundle in ${bundleDir}`, opened.code, `${opened.detail} PROFILE_BUNDLE_DIR names the folder a restore installs a bundle into; until it holds one, no profile is registered from it.`)
      } else {
        const { bundle } = opened
        for (const result of await registerProfileBundle(registry, bundle, { expected: BUNDLED_BINDINGS })) {
          if (!result.ok) {
            refuse(`${result.profile ?? 'a profile'} of the bundle in ${bundleDir}`, result.code, result.detail)
            continue
          }
          const name = result.profile.profile
          notices.set(result.profile.bindingDigest, (path) => bundle.noticeBytes(name, path))
          log(`Profile ${name} registered from the bundle in ${bundleDir} under binding digest ${result.profile.bindingDigest}.`)
        }
        licenceTexts = () => bundle.licenceTexts()
      }
    }

    for (const dir of custom) {
      const folder = isAbsolute(dir) ? dir : resolve(PROJECT_ROOT, dir)
      let bindingBytes: Uint8Array
      try {
        bindingBytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))
      } catch (cause) {
        refuse(folder, 'binding-unavailable', `binding.json could not be read from the folder (${reasonOf(cause)}).`)
        continue
      }
      const result = await registry.register({ bindingBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(join(folder, artefact.path))) })
      if (result.ok) {
        // The same bytes registered before, from the bundle, keep the notices the bundle carries.
        if (!notices.has(result.profile.bindingDigest)) {
          notices.set(result.profile.bindingDigest, async (path) => {
            // A notice path is a relative file name with no dot or dot-dot segment, and it is checked here because it becomes part of a file name.
            if (!/^[A-Za-z0-9_@-][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@-][A-Za-z0-9._@-]*)*$/u.test(path)) return undefined
            try {
              return new Uint8Array(readFileSync(join(folder, path)))
            } catch {
              return undefined
            }
          })
        }
        log(`Profile ${result.profile.profile} registered from ${folder} under binding digest ${result.profile.bindingDigest}.`)
      } else if (result.code === 'binding-untrusted') {
        // The digest is named so the operator can review the file and trust exactly these bytes. A changed file has another digest and stays refused.
        refuse(folder, result.code, `Its binding.json has digest ${profileBindingDigest(bindingBytes)}, which is not in TRUSTED_BINDING_DIGESTS. Review the binding and every file it names, then add that digest to trust it. A binding that changed since you trusted it has a new digest.`)
      } else {
        refuse(folder, result.code, result.detail)
      }
    }

    const held = registry.list().filter((profile) => profile.format === 'binding')
    log(`Profiles held by a binding, from ${source === 'package' ? 'the profiles package' : `the bundle in ${bundleDir}`}: ${held.length === 0 ? 'none' : held.map((profile) => profile.profile).join(', ')}.${engine.problem == null ? '' : ' None can be written until the validation engine is available.'}`)
    return { registry, refusals, validatePublic: bindingPayloadValidator({ registry, engines }), validateAuthorised: authorisedPayloadValidator({ registry, engines }), notices, licenceTexts }
  }

  let current = await register()
  const prefixCache = new Map<string, Record<string, string>>()
  const prefixesFor = (profile: BindingProfile): Record<string, string> => {
    const kept = prefixCache.get(profile.bindingDigest)
    if (kept != null) return kept
    const prefixes = prefixesOf(profile)
    prefixCache.set(profile.bindingDigest, prefixes)
    return prefixes
  }
  const get = (profile: string): BindingProfile | undefined => {
    const parts = profileParts(profile)
    const resolved = parts == null ? undefined : current.registry.resolve(parts.id, parts.version)
    return resolved?.format === 'binding' ? resolved : undefined
  }

  const codeCache = new Map<string, Promise<Map<string, Array<{ value: string; label: string }>>>>()
  /** Every individual the profile's background files declare, by class, with its label. Read once per binding. */
  const codesOf = (profile: BindingProfile): Promise<Map<string, Array<{ value: string; label: string }>>> => {
    const kept = codeCache.get(profile.bindingDigest)
    if (kept != null) return kept
    const work = (async () => {
      const byClass = new Map<string, Array<{ value: string; label: string }>>()
      const loaded = (await loadLibrary('n3')) as { default?: unknown }
      const n3 = (loaded.default ?? loaded) as { Parser: new (options: { format: string }) => { parse(text: string): Array<{ subject: { termType: string; value: string }; predicate: { value: string }; object: { termType: string; value: string; language?: string } }> } }
      const prefixes = prefixesFor(profile)
      const TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
      const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
      const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
      const labels = new Map<string, string>()
      const supers = new Map<string, string[]>()
      const typed: Array<[string, string]> = []
      for (const { artefact, bytes } of profile.artefacts) {
        if (artefact.role !== 'background' || artefact.mediaType !== 'text/turtle') continue
        for (const quad of new n3.Parser({ format: 'Turtle' }).parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) {
          if (quad.subject.termType !== 'NamedNode') continue
          if (quad.predicate.value === LABEL && (quad.object.language == null || quad.object.language === '' || quad.object.language === 'en') && !labels.has(quad.subject.value)) labels.set(quad.subject.value, quad.object.value)
          else if (quad.predicate.value === SUBCLASS && quad.object.termType === 'NamedNode') supers.set(quad.subject.value, [...(supers.get(quad.subject.value) ?? []), quad.object.value])
          else if (quad.predicate.value === TYPE && quad.object.termType === 'NamedNode') typed.push([quad.subject.value, quad.object.value])
        }
      }
      const ancestors = (type: string, seen = new Set<string>()): Set<string> => {
        if (seen.has(type)) return seen
        seen.add(type)
        for (const parent of supers.get(type) ?? []) ancestors(parent, seen)
        return seen
      }
      for (const [subject, type] of typed) {
        const value = compactWith(prefixes, subject)
        if (value == null) continue
        for (const each of ancestors(type)) {
          const name = compactWith(prefixes, each)
          if (name == null) continue
          const list = byClass.get(name) ?? []
          if (!list.some((entry) => entry.value === value)) list.push({ value, label: labels.get(subject) ?? value })
          byClass.set(name, list)
        }
      }
      return byClass
    })()
    codeCache.set(profile.bindingDigest, work)
    return work
  }

  /** Where each finding of a validation belongs in the product document, worked out on a copy whose nested nodes are named by their place. */
  const locate = async (profile: BindingProfile, product: Json, findings: Array<EngineFinding & { step: string }>): Promise<LocatedFinding[]> => {
    if (findings.length === 0 || engines.jsonLd == null || engines.shacl == null) return findings
    const prefixes = prefixesFor(profile)
    const { document, pointers } = withPointerNodes(product)
    const contexts = profile.artefacts.filter((a) => a.artefact.role === 'context').map((a) => ({ uri: a.artefact.uri!, bytes: a.bytes }))
    const files = (role: 'shapes' | 'background') => profile.artefacts.filter((a) => a.artefact.role === role).map((a) => ({ path: a.artefact.path, mediaType: a.artefact.mediaType, bytes: a.bytes }))
    let named: EngineFinding[] = []
    try {
      const expansion = await engines.jsonLd.toRdf({ document, contexts })
      if (expansion.ok) {
        const validation = await engines.shacl.validate({ nquads: expansion.nquads, shapes: files('shapes'), background: files('background') })
        if (validation.ok) named = validation.findings
      }
    } catch {
      // Without a second pass the findings are still reported, only not placed.
    }
    const unused = named.map((finding) => ({ finding, key: findingKey(finding), used: false }))
    return findings.map((finding) => {
      const key = findingKey(finding)
      const twin = unused.find((candidate) => !candidate.used && candidate.key === key)
      if (twin == null) return finding
      twin.used = true
      const node = twin.finding.focusNode == null ? undefined : pointers.get(twin.finding.focusNode)
      if (node == null) return finding
      const steps = finding.path == null ? undefined : pathSteps(finding.path)?.map((spellings) => spellings.map((iri) => compactWith(prefixes, iri)))
      if (steps == null || steps.some((spellings) => spellings.some((name) => name == null))) return { ...finding, pointer: node }
      // Where a step has two spellings, the one the document uses is the place; with neither written, the first is where a value would go.
      let pointer = node
      let property: string | undefined
      for (const spellings of steps as string[][]) {
        const here = valueAt(product, pointer)
        property = spellings.find((name) => isObject(here) && Object.hasOwn(here, name)) ?? spellings[0]
        pointer = `${pointer}/${escapePointer(property)}`
      }
      return { ...finding, pointer, ...(property == null ? {} : { property }) }
    })
  }

  const viewStatus = (status: 'pass' | 'fail' | 'unknown'): ViewStatus => (status === 'unknown' ? 'not-checked' : status)

  return {
    get registry() {
      return current.registry
    },
    engines,
    engineKind: engine.kind,
    get engineProblem() {
      return engine.problem
    },
    async checkEngine() {
      await engine.check()
    },
    source,
    get refusals() {
      return current.refusals
    },
    async reload() {
      current = await register()
    },
    readNotice: async (profile, path) => await current.notices.get(profile.bindingDigest)?.(path),
    licenceTexts: () => current.licenceTexts(),
    get,
    list: () => current.registry.list().filter((profile): profile is BindingProfile => profile.format === 'binding'),
    describe: (profile) => ({
      id: profile.profile,
      format: 'binding',
      title: profile.binding.title,
      description: profile.binding.scope,
      bindingDigest: profile.bindingDigest,
      steps: [...profile.binding.validation.steps],
      ...(profile.binding.access == null ? {} : { access: { policy: profile.binding.access.policy, public: [...profile.binding.access.public] } }),
      contexts: profile.artefacts.filter((a) => a.artefact.role === 'context').map((a) => ({ path: a.artefact.path, uri: a.artefact.uri! })),
      prefixes: prefixesFor(profile),
      engine: { available: engine.problem == null, kind: engine.kind, ...(engine.problem == null ? {} : { problem: engine.problem }) },
    }),
    async codeLists(profile, classes) {
      const out: Record<string, Array<{ value: string; label: string }>> = {}
      if (engine.problem != null) return out
      let all: Map<string, Array<{ value: string; label: string }>>
      try {
        all = await codesOf(profile)
      } catch {
        return out
      }
      for (const name of classes) out[name] = all.get(name) ?? []
      return out
    },
    prepare: ({ profile, product, passportId, notice }) => prepareBoundPayload({ registry: current.registry, engines, profile: profile.id, profileVersion: profile.version, product, passportId, ...(notice == null ? {} : { notice }) }),
    validatePublic: (payload) => current.validatePublic(payload),
    validateAuthorised: (payload) => current.validateAuthorised(payload),
    async viewCheck(view, validation, located) {
      const status = viewStatus(validation.status)
      const detail = detailOf(validation)
      const steps: BindingStepOutcome[] = detail?.steps ?? []
      const cause = detail?.cause
      const flat = steps.flatMap((step) => (step.findings ?? []).map((finding) => ({ ...finding, step: step.step })))
      const findings = located == null ? flat : await locate(located.profile, located.product, flat)
      const messages = typeof validation.detail === 'string' ? [validation.detail] : Array.isArray(validation.detail) ? validation.detail : []
      const replaced = cause === 'profile-retired' && detail?.replacedBy != null ? ` ${detail.replacedBy} replaces it.` : ''
      const engineProblem = engine.problem
      const reason = status !== 'not-checked' ? '' : ` ${cause === 'validator-unavailable' && engineProblem != null ? `The validation engine is not available: ${engineProblem}` : (NOT_CHECKED_REASONS[cause ?? ''] ?? 'A check could not run.')}${replaced} A check that could not run is not a pass.`
      return {
        view,
        status,
        ...(cause == null ? {} : { cause }),
        summary: `${(detail == null || cause === 'profile-retired') && view === 'public' ? SCHEMA_SUMMARIES[status] : SUMMARIES[view][status]}${reason}`,
        steps: detail == null ? (messages.length === 0 || status === 'pass' ? [] : [{ step: 'json-schema', status, messages }]) : steps.map((step) => ({ step: step.step, status: viewStatus(step.status), ...(step.cause == null ? {} : { cause: step.cause }), messages: step.messages ?? [] })),
        findings,
        withheld: detail?.access?.withheld ?? [],
      }
    },
  }
}
