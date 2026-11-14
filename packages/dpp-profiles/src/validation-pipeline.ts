/**
 * The steps behind `bindingPayloadValidator`, `authorisedPayloadValidator`
 * and `prepareBoundPayload` (`spec/profiles.md` §7). The three differ only in
 * how much of the product document they read, so they share one pipeline and
 * tell it which view they hold:
 *
 *   public      the public payload alone, read as a projection
 *   authorised  the public payload rejoined with the restricted part
 *   whole       the writer's document, before it is split
 *
 * This module is not part of the package's public surface. The whole view in
 * particular must stay with the writer: handed a public payload it would
 * call a withheld property missing, and would not notice a disclosed one.
 */
import canonicalize from 'canonicalize'
import { assembleProduct, isPublicProperty, joinKeyProperties } from './access-tiers.js'
import type { BindingStepOutcome, BindingValidationCause, BindingValidationDetail, BindingValidationView, EngineContext, EngineFile, EngineFinding, JsonLdEngine, JsonLdExpansion, ShaclValidation, ValidationEngines, WithheldCheck } from './binding-validator.js'
import { describeSchemaProblems, profilePayloadValidator, type CompiledSchema, type PayloadToValidate, type PayloadValidation, type SchemaCompiler, type SchemaProblem } from './payload-validator.js'
import { checkProductIdentity } from './product-identity.js'
import type { BindingAccess, BindingArtefact, BindingStep, EngineCapability, ProfileBinding } from './profile-binding.js'
import type { BindingProfile, ProfileRegistry } from './profile-registry.js'
import { parseStrictJson } from './strict-json.js'

/** How each cause reads in the report's shared vocabulary: a check that ran and did not hold, or one that could not be completed. */
const REASON_CODE: Record<BindingValidationCause, NonNullable<PayloadValidation['reasonCode']>> = {
  'envelope-invalid': 'schema-invalid',
  'profile-binding-mismatch': 'schema-invalid',
  'schema-invalid': 'schema-invalid',
  'profile-rule-violation': 'schema-invalid',
  'product-identity-mismatch': 'schema-invalid',
  'restricted-property-disclosed': 'schema-invalid',
  'product-assembly-refused': 'schema-invalid',
  'profile-unknown': 'schema-unavailable',
  'product-identity-unavailable': 'schema-unavailable',
  'validator-unavailable': 'schema-unavailable',
  'restricted-tier-withheld': 'schema-unavailable',
}

const ENVELOPE_MEMBERS = ['profile', 'profile_version', 'profile_binding_sha256', 'product']
/** The stamp a demonstration record carries first (`spec/profiles.md` §5). It is the one optional member. */
const NOTICE = 'notice'
const SHA256 = /^[0-9a-f]{64}$/
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
/** A subject no product has, so the predicates read back from a probe are the probe's own. */
const PROBE_SUBJECT = 'urn:x-dpp-access-probe:subject'

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

const describeWithheld = (check: WithheldCheck): string => `Not decided: the rule on ${check.property} (${check.constraint}) needs a property outside the public payload.`

const filesOf = (profile: BindingProfile, role: BindingArtefact['role']): EngineFile[] => profile.artefacts.filter((a) => a.artefact.role === role).map((a) => ({ path: a.artefact.path, mediaType: a.artefact.mediaType, bytes: a.bytes }))

/** The product's own identifier, where it states one as text: the node a shape reports a top-level finding against. */
function subjectOf(binding: ProfileBinding, product: Json): string | undefined {
  for (const name of joinKeyProperties(binding)) if (typeof product[name] === 'string') return product[name]
  return undefined
}

/** A schema problem that says no more than "a top-level property is missing", for a property outside the public payload. */
const isWithheldProblem = (binding: ProfileBinding, problem: SchemaProblem): boolean =>
  problem.keyword === 'required' && problem.instancePath === '' && typeof problem.params.missingProperty === 'string' && !isPublicProperty(binding, problem.params.missingProperty)

/** A finding that says no more than "the product has no value here": a minimum count, on the product itself, along one property. */
const reportsAbsence = (finding: EngineFinding, subject: string | undefined): boolean =>
  finding.constraint === 'MinCountConstraintComponent' && subject != null && finding.focusNode === subject && finding.path != null && !/[<>\s]/.test(finding.path)

/**
 * The predicates the public property names stand for, under the contexts the
 * public payload names. A shape reports a missing value by predicate, and
 * the binding lists properties by the names documents write, so one has to
 * be read as the other before a finding can be put in a tier.
 *
 * The engine does the reading: the public payload is expanded once more
 * under a subject of its own, with a marker value at every public name the
 * payload does not carry. A name that cannot be read that way is left out,
 * which errs towards calling its rule withheld and never towards a pass.
 */
async function publicPredicates(jsonLd: JsonLdEngine, binding: ProfileBinding, access: BindingAccess, product: Json, contexts: readonly EngineContext[]): Promise<Set<string>> {
  const names = joinKeyProperties(binding)
  const predicates = new Set<string>()
  if (access.public.includes('@type')) predicates.add(RDF_TYPE)
  const marker = [{ '@value': 'probe' }]
  const subject = names.find((name) => Object.hasOwn(product, name)) ?? '@id'
  const absent = access.public.filter((name) => !name.startsWith('@') && !names.includes(name) && !Object.hasOwn(product, name))
  const read = async (document: Json): Promise<boolean> => {
    let expansion: JsonLdExpansion
    try {
      expansion = await jsonLd.toRdf({ document, contexts })
    } catch {
      return false
    }
    if (!expansion.ok) return false
    for (const line of expansion.nquads.split('\n')) {
      const match = /^<([^>]*)> <([^>]*)> /.exec(line)
      if (match != null && match[1] === PROBE_SUBJECT) predicates.add(match[2]!)
    }
    return true
  }
  const base: Json = { ...Object.fromEntries(Object.entries(product).filter(([name]) => !names.includes(name))), [subject]: PROBE_SUBJECT }
  if (await read({ ...base, ...Object.fromEntries(absent.map((name) => [name, marker])) })) return predicates
  // One name the contexts do not read as a property spoils the document, so each name is then read alone.
  await read(base)
  for (const name of absent) await read({ '@context': product['@context'], [subject]: PROBE_SUBJECT, [name]: marker })
  return predicates
}

export interface PipelineInput {
  payload: PayloadToValidate
  view: BindingValidationView
  /** The restricted part, for the authorised view. */
  restrictedProduct?: unknown
}

/** The pipeline over a registry and the caller's engines. One compiled schema is kept per binding for its life. */
export function createValidationPipeline(options: { registry: ProfileRegistry; engines?: ValidationEngines }): (input: PipelineInput) => Promise<PayloadValidation> {
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

  return async ({ payload, view, restrictedProduct }) => {
    const id = `${payload.profile}@${payload.profileVersion}`
    const profile = registry.resolve(payload.profile, payload.profileVersion)
    // An unknown profile selects no rules. Guessing some would be a pass nobody earned.
    if (profile == null) return { status: 'unknown', reasonCode: REASON_CODE['profile-unknown'], detail: { profile: id, cause: 'profile-unknown', steps: [] } }
    if (profile.format === 'manifest') {
      // A manifest-format profile keeps its restricted tiers under a schema of its own, which no step here reads.
      // Answering for the public payload alone would leave the part that was handed over unchecked and unsaid.
      if (restrictedProduct !== undefined) {
        return { status: 'unknown', reasonCode: REASON_CODE['validator-unavailable'], detail: { profile: id, cause: 'validator-unavailable', steps: [{ step: 'assembly', status: 'unknown', cause: 'validator-unavailable', messages: [`${id} is a manifest-format profile. Its restricted part is not rejoined or checked here.`] }] } }
      }
      if (manifestValidator == null) return { status: 'unknown', reasonCode: REASON_CODE['validator-unavailable'], detail: { profile: id, cause: 'validator-unavailable', steps: [] } }
      return manifestValidator(payload)
    }

    const { binding } = profile
    const access = binding.access
    const steps: BindingStepOutcome[] = []
    const withheld: WithheldCheck[] = []
    const detail = { profile: id, bindingDigest: profile.bindingDigest, steps, ...(access == null ? {} : { access: { policy: access.policy, view, withheld } }) }
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

    // Only the public view reads a part of the document, and only where the binding splits it.
    const projection = view === 'public' ? access : undefined
    let product = envelope.product
    if (projection != null) {
      const disclosed = Object.keys(product).filter((name) => !isPublicProperty(binding, name))
      // Nothing after this step runs on such a payload: a finding about a disclosed value would repeat it in the answer.
      if (disclosed.length > 0) {
        steps.push({ step: 'access', status: 'fail', cause: 'restricted-property-disclosed', messages: disclosed.map((name) => `The public payload carries \`${name}\`, which ${projection.policy} does not list as public.`) })
        return answer(detail)
      }
      steps.push({ step: 'access', status: 'pass' })
    } else if (view === 'authorised') {
      const assembly = assembleProduct({ binding, publicProduct: product, restrictedProduct })
      if (!assembly.ok) {
        steps.push({ step: 'assembly', status: 'fail', cause: 'product-assembly-refused', refusal: assembly.code, messages: [`The two parts were not rejoined (${assembly.code}). ${assembly.detail}`] })
        return answer(detail)
      }
      steps.push({ step: 'assembly', status: 'pass' })
      product = assembly.product
    }
    // The identity rules point into the envelope, so the document they read sits where the payload's did.
    const pointed: Json = product === envelope.product ? parsed : { ...parsed, product }

    const required = binding.validation.engine?.requires ?? []
    const contexts: EngineContext[] = profile.artefacts.filter((a) => a.artefact.role === 'context').map((a) => ({ uri: a.artefact.uri!, bytes: a.bytes }))
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
        if (validate(product)) { steps.push({ step, status: 'pass' }); continue }
        const problems = validate.errors ?? []
        const absent = projection != null ? problems.filter((problem) => isWithheldProblem(binding, problem)) : []
        const broken = problems.filter((problem) => !absent.includes(problem))
        const checks = absent.map((problem): WithheldCheck => ({ step, property: String(problem.params.missingProperty), constraint: problem.keyword, ...(problem.message == null ? {} : { message: problem.message }) }))
        withheld.push(...checks)
        if (broken.length > 0 || checks.length === 0) steps.push({ step, status: 'fail', cause: 'schema-invalid', messages: describeSchemaProblems(broken), ...(checks.length > 0 ? { withheld: checks } : {}) })
        else steps.push({ step, status: 'unknown', cause: 'restricted-tier-withheld', messages: checks.map(describeWithheld), withheld: checks })
      } else if (step === 'json-ld-expand') {
        // Refused here, before any engine, so the rule holds whichever engine is installed and when none is.
        const problems = contextProblems(product, new Set(contexts.map((c) => c.uri)))
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
          expansion = await engines.jsonLd.toRdf({ document: product, contexts })
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
        // A public payload lacks the restricted properties by design. A rule that only misses one of them was not broken: it was not decided.
        const subject = subjectOf(binding, product)
        const candidates = projection != null ? blocking.filter((f) => reportsAbsence(f, subject)) : []
        const open = candidates.length > 0 && projection != null && engines.jsonLd != null ? await publicPredicates(engines.jsonLd, binding, projection, product, contexts) : new Set<string>()
        const absent = candidates.filter((f) => !open.has(f.path!))
        const broken = blocking.filter((f) => !absent.includes(f))
        const checks = absent.map((f): WithheldCheck => ({ step, property: f.path!, constraint: f.constraint, ...(f.message == null ? {} : { message: f.message }) }))
        withheld.push(...checks)
        if (broken.length > 0) steps.push({ step, status: 'fail', cause: 'profile-rule-violation', messages: broken.map(describeFinding), ...findings, ...(checks.length > 0 ? { withheld: checks } : {}) })
        else if (checks.length > 0) steps.push({ step, status: 'unknown', cause: 'restricted-tier-withheld', messages: checks.map(describeWithheld), ...findings, withheld: checks })
        else steps.push({ step, status: 'pass', ...findings })
      } else {
        const identity = checkProductIdentity({ payload: pointed, identity: binding.identity, passportId: payload.passportId })
        if (identity.status === 'pass') steps.push({ step, status: 'pass' })
        else steps.push({ step, status: identity.status, cause: identity.status === 'fail' ? 'product-identity-mismatch' : 'product-identity-unavailable', messages: identity.findings.map((f) => f.detail) })
      }
    }
    return answer(detail)
  }
}
