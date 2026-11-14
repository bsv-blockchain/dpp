/**
 * The payload validator for profiles held by a binding (`spec/profiles.md`
 * §7). It has the shape of `profilePayloadValidator`, so a writer calls it
 * before issuing and a verifier passes it as `payloadValidator` in its
 * evidence policy.
 *
 * A payload under a binding is an envelope around one product document. The
 * envelope and the binding digest are always checked first. The checks the
 * binding lists then run in the binding's order:
 *
 *   json-schema        the product against the binding's schema
 *   json-ld-expand     the product to RDF, with the binding's contexts only
 *   shacl              that RDF against the binding's shapes and background
 *   passport-identity  the product against the passport that carries it
 *
 * The outcome rule is the whole point of the module. A step that fails makes
 * the answer `fail`. Otherwise a step that could not run makes it `unknown`.
 * Only every step passing is `pass`. A missing engine, a capability the
 * engine does not have, a timeout, an unknown profile and a missing passport
 * identifier are all steps that could not run, so none of them can pass.
 *
 * This package takes no validator library. The caller supplies the JSON
 * Schema compiler, as for `profilePayloadValidator`, and the JSON-LD and
 * SHACL engines. `@bsv/dpp-profiles/validation-engine` builds the latter two
 * from libraries the caller installs.
 */
import canonicalize from 'canonicalize'
import { describeSchemaProblems, profilePayloadValidator, type CompiledSchema, type PayloadToValidate, type PayloadValidation, type SchemaCompiler } from './payload-validator.js'
import { checkProductIdentity } from './product-identity.js'
import type { BindingArtefact, BindingStep, EngineCapability, FindingSeverity } from './profile-binding.js'
import type { BindingProfile, ProfileRegistry } from './profile-registry.js'
import { parseStrictJson } from './strict-json.js'

/** One result a SHACL engine reports. `constraint` is the local name of the constraint component, such as `MinCountConstraintComponent`. */
export interface EngineFinding {
  severity: FindingSeverity
  constraint: string
  focusNode?: string
  path?: string
  message?: string
  value?: string
}

/** A context the engine may use: the URI documents name it by, and its bytes. */
export interface EngineContext {
  uri: string
  bytes: Uint8Array
}

/** A shapes or background file as registered. */
export interface EngineFile {
  path: string
  mediaType: string
  bytes: Uint8Array
}

export type JsonLdExpansion =
  | { ok: true; /** The document as N-Quads. */ nquads: string }
  | { ok: false; reason: 'context-not-listed' | 'document-invalid' | 'timeout' | 'engine-error'; detail: string }

/**
 * Turns a JSON-LD document into RDF. An engine uses the contexts it is handed
 * and no others: a context outside that list is `context-not-listed`, and
 * nothing is fetched. `document-invalid` is a document the contexts do not
 * fully define. `timeout` and `engine-error` say the engine could not finish.
 */
export interface JsonLdEngine {
  toRdf(input: { document: unknown; contexts: readonly EngineContext[] }): Promise<JsonLdExpansion>
}

export type ShaclValidation = { ok: true; findings: EngineFinding[] } | { ok: false; reason: 'timeout' | 'engine-error'; detail: string }

/**
 * Validates RDF against shapes. `capabilities` says what the engine can
 * check. The validator reads it before every run, because an engine that
 * cannot evaluate a kind of constraint reports no finding for it, and that
 * silence would otherwise look like a pass.
 */
export interface ShaclEngine {
  capabilities: readonly EngineCapability[]
  validate(input: { nquads: string; shapes: readonly EngineFile[]; background: readonly EngineFile[] }): Promise<ShaclValidation>
}

/** What the caller supplies. Each is optional, and a step whose engine is absent answers `unknown`. */
export interface ValidationEngines {
  /** A JSON Schema 2020-12 compiler: Ajv's 2020 build with formats, as `profilePayloadValidator` takes. */
  jsonSchema?: SchemaCompiler
  jsonLd?: JsonLdEngine
  shacl?: ShaclEngine
}

/**
 * The precise reason a payload did not pass. The report's shared vocabulary
 * has two codes for a payload check, `schema-invalid` and
 * `schema-unavailable`, so the validator answers with those and names the
 * cause here.
 */
export type BindingValidationCause =
  /** The payload is not the envelope: not strict JSON, a member missing, or a member the envelope does not define. */
  | 'envelope-invalid'
  /** The registry holds no profile for the identifier and version the payload declares. */
  | 'profile-unknown'
  /** The payload declares a binding digest other than the registered binding's. */
  | 'profile-binding-mismatch'
  /** The product does not validate against the binding's JSON Schema. */
  | 'schema-invalid'
  /** The product breaks a rule of the profile: an unlisted context, a document its contexts do not define, or a blocking SHACL finding. */
  | 'profile-rule-violation'
  /** The product document is not about the passport's item. */
  | 'product-identity-mismatch'
  /** The product could not be compared with the passport: no passport identifier, or a form the identity rules do not read. */
  | 'product-identity-unavailable'
  /** A step could not run: no engine, a missing capability, a timeout or an engine error. */
  | 'validator-unavailable'

export interface BindingStepOutcome {
  step: 'envelope' | 'binding' | BindingStep
  status: 'pass' | 'fail' | 'unknown'
  cause?: BindingValidationCause
  /** One sentence per problem. */
  messages?: string[]
  /** Every finding the SHACL engine reported, blocking or not. */
  findings?: EngineFinding[]
}

/** What `detail` carries for a profile held by a binding. */
export interface BindingValidationDetail {
  /** `id@version`, as the payload declares it. */
  profile: string
  /** The registered binding's digest, once the profile resolved. */
  bindingDigest?: string
  /** The cause of the first failure, else of the first step that could not run. Absent on a pass. */
  cause?: BindingValidationCause
  /** The steps that ran, in order. */
  steps: BindingStepOutcome[]
}

/** How each cause reads in the report's shared vocabulary: a check that ran and did not hold, or one that could not be completed. */
const REASON_CODE: Record<BindingValidationCause, NonNullable<PayloadValidation['reasonCode']>> = {
  'envelope-invalid': 'schema-invalid',
  'profile-binding-mismatch': 'schema-invalid',
  'schema-invalid': 'schema-invalid',
  'profile-rule-violation': 'schema-invalid',
  'product-identity-mismatch': 'schema-invalid',
  'profile-unknown': 'schema-unavailable',
  'product-identity-unavailable': 'schema-unavailable',
  'validator-unavailable': 'schema-unavailable',
}

const ENVELOPE_MEMBERS = ['profile', 'profile_version', 'profile_binding_sha256', 'product']
/** The stamp a demonstration record carries first (`spec/profiles.md` §5). It is the one optional member. */
const NOTICE = 'notice'
const SHA256 = /^[0-9a-f]{64}$/

interface Envelope {
  profile: string
  profile_version: number
  profile_binding_sha256: string
  product: Record<string, unknown>
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The envelope read strictly, or the sentences saying why the payload is not one. */
function readEnvelope(payload: PayloadToValidate): { envelope: Envelope; parsed: Json } | { problems: string[] } {
  const parsed = parseStrictJson(payload.payloadPublic)
  if (!parsed.ok) return { problems: [`The payload is refused: ${parsed.detail}.`] }
  const value = parsed.value
  if (!isObject(value)) return { problems: ['The payload must be one JSON object.'] }
  const problems: string[] = []
  for (const member of ENVELOPE_MEMBERS) if (!Object.hasOwn(value, member)) problems.push(`The payload is missing the member \`${member}\`.`)
  for (const member of Object.keys(value)) if (!ENVELOPE_MEMBERS.includes(member) && member !== NOTICE) problems.push(`The payload has a member the envelope does not define: \`${member}\`. Product data belongs inside \`product\`.`)
  if (Object.hasOwn(value, 'profile') && value.profile !== payload.profile) problems.push(`The payload's \`profile\` is not the profile being checked, ${payload.profile}.`)
  if (Object.hasOwn(value, 'profile_version') && value.profile_version !== payload.profileVersion) problems.push(`The payload's \`profile_version\` is not the version being checked, ${payload.profileVersion}.`)
  if (Object.hasOwn(value, 'profile_binding_sha256') && !(typeof value.profile_binding_sha256 === 'string' && SHA256.test(value.profile_binding_sha256))) problems.push('`profile_binding_sha256` must be 64 lower-case hexadecimal characters.')
  if (Object.hasOwn(value, 'product') && !isObject(value.product)) problems.push('`product` must be one JSON object: the product document.')
  if (Object.hasOwn(value, NOTICE) && !(typeof value[NOTICE] === 'string' && value[NOTICE].length > 0)) problems.push('`notice` must be one sentence of text.')
  return problems.length > 0 ? { problems } : { envelope: value as unknown as Envelope, parsed: value }
}

/**
 * Every way the product document names a context the binding does not list.
 * A document may name contexts by listed URI only. A context written into
 * the document, or a null that clears one, is refused as well: either would
 * change what the document's terms mean and so which rules reach them.
 */
function contextProblems(product: Json, listed: ReadonlySet<string>): string[] {
  const problems: string[] = []
  const visit = (node: unknown, at: string): void => {
    if (Array.isArray(node)) { node.forEach((entry, index) => visit(entry, `${at}/${index}`)); return }
    if (!isObject(node)) return
    for (const [key, value] of Object.entries(node)) {
      const where = `${at}/${key}`
      if (key !== '@context') { visit(value, where); continue }
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (typeof entry !== 'string') problems.push(`The product document carries a context that is not a URI at ${where}. A document names its contexts by the URIs the binding lists.`)
        else if (!listed.has(entry)) problems.push(`The product document names a context the binding does not list at ${where}: ${entry}.`)
      }
    }
  }
  visit(product, '/product')
  if (!Object.hasOwn(product, '@context')) problems.push('The product document names no context, so it cannot be read as the profile\'s data.')
  return problems
}

/** One sentence for a finding that blocks: its severity, what it is about and the shape's own message. */
function describeFinding(finding: EngineFinding): string {
  const about = finding.path ?? finding.focusNode
  const said = finding.message ?? finding.constraint
  return `${finding.severity}${about == null ? '' : ` at ${about}`}: ${said}${/[.!?]$/.test(said) ? '' : '.'}`
}

const filesOf = (profile: BindingProfile, role: BindingArtefact['role']): EngineFile[] => profile.artefacts.filter((a) => a.artefact.role === role).map((a) => ({ path: a.artefact.path, mediaType: a.artefact.mediaType, bytes: a.bytes }))

/**
 * A validator over the profiles a registry holds. For a profile held by a
 * binding it runs the pipeline above. For a manifest-format profile it
 * answers exactly as `profilePayloadValidator` does with the same compiler,
 * so one validator serves a deployment that carries both.
 */
export function bindingPayloadValidator(options: { registry: ProfileRegistry; engines?: ValidationEngines }): (payload: PayloadToValidate) => Promise<PayloadValidation> {
  const { registry } = options
  const engines = options.engines ?? {}
  const manifestValidator = engines.jsonSchema == null ? undefined : profilePayloadValidator(engines.jsonSchema)
  // One compiled schema per binding digest: a binding never changes, so neither does its schema.
  const compiled = new Map<string, CompiledSchema>()

  const schemaFor = (profile: BindingProfile, compiler: SchemaCompiler): CompiledSchema => {
    const kept = compiled.get(profile.bindingDigest)
    if (kept != null) return kept
    const artefact = profile.artefacts.find((a) => a.artefact.role === 'schema')!
    const schema = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artefact.bytes)) as Record<string, unknown>
    // A compiler keeps one schema per $id and refuses a second, so one it already holds is reused, and only
    // if it is this schema. Another binding may carry other rules under the same $id, and checking this
    // product against those would be an answer about the wrong profile.
    const known = typeof schema.$id === 'string' ? compiler.getSchema(schema.$id) : undefined
    if (known != null && !(known.schema !== undefined && canonicalize(known.schema) === canonicalize(schema))) throw new Error(`the compiler already holds a different schema under ${String(schema.$id)}`)
    const validate = known ?? compiler.compile(schema)
    compiled.set(profile.bindingDigest, validate)
    return validate
  }

  const answer = (detail: Omit<BindingValidationDetail, 'cause'>): PayloadValidation => {
    const worst = detail.steps.find((s) => s.status === 'fail') ?? detail.steps.find((s) => s.status === 'unknown')
    if (worst == null) return { status: 'pass', detail }
    const cause = worst.cause ?? 'validator-unavailable'
    return { status: worst.status === 'fail' ? 'fail' : 'unknown', reasonCode: REASON_CODE[cause], detail: { ...detail, cause } }
  }

  return async (payload) => {
    const id = `${payload.profile}@${payload.profileVersion}`
    const profile = registry.resolve(payload.profile, payload.profileVersion)
    // An unknown profile selects no rules. Guessing some would be a pass nobody earned.
    if (profile == null) return { status: 'unknown', reasonCode: REASON_CODE['profile-unknown'], detail: { profile: id, cause: 'profile-unknown', steps: [] } }
    if (profile.format === 'manifest') {
      if (manifestValidator == null) return { status: 'unknown', reasonCode: REASON_CODE['validator-unavailable'], detail: { profile: id, cause: 'validator-unavailable', steps: [] } }
      return manifestValidator(payload)
    }

    const steps: BindingStepOutcome[] = []
    const detail = { profile: id, bindingDigest: profile.bindingDigest, steps }
    const unavailable = (step: BindingStep, message: string): void => { steps.push({ step, status: 'unknown', cause: 'validator-unavailable', messages: [message] }) }

    const read = readEnvelope(payload)
    if ('problems' in read) {
      steps.push({ step: 'envelope', status: 'fail', cause: 'envelope-invalid', messages: read.problems })
      return answer(detail)
    }
    steps.push({ step: 'envelope', status: 'pass' })
    const { envelope, parsed } = read

    // A payload that declares another binding was written to other rules. Checking it against these would answer a question nobody asked.
    if (envelope.profile_binding_sha256 !== profile.bindingDigest) {
      steps.push({ step: 'binding', status: 'fail', cause: 'profile-binding-mismatch', messages: [`The payload declares binding ${envelope.profile_binding_sha256}; ${id} is registered with binding ${profile.bindingDigest}.`] })
      return answer(detail)
    }
    steps.push({ step: 'binding', status: 'pass' })

    const { binding } = profile
    const required = binding.validation.engine?.requires ?? []
    // What json-ld-expand produced, for shacl: the data, or the reason there is none.
    let rdf: { nquads: string } | { missing: string } = { missing: 'the binding lists no json-ld-expand step before it' }

    for (const step of binding.validation.steps) {
      if (step === 'json-schema') {
        if (engines.jsonSchema == null) { unavailable(step, 'No JSON Schema compiler was supplied.'); continue }
        let validate: CompiledSchema
        try {
          validate = schemaFor(profile, engines.jsonSchema)
        } catch (cause) {
          unavailable(step, `The binding's schema could not be compiled: ${reasonOf(cause)}.`)
          continue
        }
        if (validate(envelope.product)) steps.push({ step, status: 'pass' })
        else steps.push({ step, status: 'fail', cause: 'schema-invalid', messages: describeSchemaProblems(validate.errors) })
      } else if (step === 'json-ld-expand') {
        const contexts: EngineContext[] = profile.artefacts.filter((a) => a.artefact.role === 'context').map((a) => ({ uri: a.artefact.uri!, bytes: a.bytes }))
        // Refused here, before any engine, so the rule holds whichever engine is installed and when none is.
        const problems = contextProblems(envelope.product, new Set(contexts.map((c) => c.uri)))
        if (problems.length > 0) {
          steps.push({ step, status: 'fail', cause: 'profile-rule-violation', messages: problems })
          rdf = { missing: 'the product document was refused before it was expanded' }
          continue
        }
        if (engines.jsonLd == null) {
          unavailable(step, 'No JSON-LD engine was supplied.')
          rdf = { missing: 'no JSON-LD engine was supplied' }
          continue
        }
        let expansion: JsonLdExpansion
        try {
          expansion = await engines.jsonLd.toRdf({ document: envelope.product, contexts })
        } catch (cause) {
          expansion = { ok: false, reason: 'engine-error', detail: reasonOf(cause) }
        }
        if (expansion.ok) {
          steps.push({ step, status: 'pass' })
          rdf = { nquads: expansion.nquads }
        } else if (expansion.reason === 'context-not-listed' || expansion.reason === 'document-invalid') {
          steps.push({ step, status: 'fail', cause: 'profile-rule-violation', messages: [`The product document could not be read with the binding's contexts: ${expansion.detail}.`] })
          rdf = { missing: 'the product document did not expand' }
        } else {
          unavailable(step, `The JSON-LD engine did not finish (${expansion.reason}): ${expansion.detail}.`)
          rdf = { missing: 'the JSON-LD engine did not finish' }
        }
      } else if (step === 'shacl') {
        if ('missing' in rdf) { unavailable(step, `Not run: ${rdf.missing}.`); continue }
        if (engines.shacl == null) { unavailable(step, 'No SHACL engine was supplied.'); continue }
        const capabilities = engines.shacl.capabilities
        const lacking = (['shacl-core', ...required.filter((c) => c !== 'json-schema-2020-12')] as EngineCapability[]).filter((c, i, all) => all.indexOf(c) === i && !capabilities.includes(c))
        // Asked anyway, such an engine would report nothing for the constraints it cannot evaluate.
        if (lacking.length > 0) { unavailable(step, `The SHACL engine lacks a capability the binding requires: ${lacking.join(', ')}.`); continue }
        let validation: ShaclValidation
        try {
          validation = await engines.shacl.validate({ nquads: rdf.nquads, shapes: filesOf(profile, 'shapes'), background: filesOf(profile, 'background') })
        } catch (cause) {
          validation = { ok: false, reason: 'engine-error', detail: reasonOf(cause) }
        }
        if (!validation.ok) { unavailable(step, `The SHACL engine did not finish (${validation.reason}): ${validation.detail}.`); continue }
        const blocking = validation.findings.filter((f) => binding.validation.blockingSeverities.includes(f.severity))
        const findings = validation.findings.length > 0 ? { findings: validation.findings } : {}
        if (blocking.length === 0) steps.push({ step, status: 'pass', ...findings })
        else steps.push({ step, status: 'fail', cause: 'profile-rule-violation', messages: blocking.map(describeFinding), ...findings })
      } else {
        const identity = checkProductIdentity({ payload: parsed, identity: binding.identity, passportId: payload.passportId })
        if (identity.status === 'pass') steps.push({ step, status: 'pass' })
        else steps.push({ step, status: identity.status, cause: identity.status === 'fail' ? 'product-identity-mismatch' : 'product-identity-unavailable', messages: identity.findings.map((f) => f.detail) })
      }
    }
    return answer(detail)
  }
}
