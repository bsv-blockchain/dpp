/**
 * The payload validator for profiles held by a binding (`spec/profiles.md`
 * §7). It has the shape of `profilePayloadValidator`, so a verifier passes
 * it as `payloadValidator` in its evidence policy. A writer calls
 * `prepareBoundPayload`, which runs the same steps on the whole document
 * before anything is issued.
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
 * A payload that declares a retired profile is answered before any of that:
 * `unknown` with the cause `profile-retired`, whatever the registry holds.
 *
 * A binding with an `access` member splits the product document in two, and
 * the payload on chain then carries the public part only. Such a payload is
 * checked here as a projection of the whole document, which is what any
 * reader has. A rule that fails only because a restricted property is absent
 * is a check that was withheld from this reader, not a failure, and any
 * withheld check makes the answer `unknown`. A restricted property that
 * turns up in the public payload fails, since it was disclosed. A reader who
 * also holds the restricted part uses `authorisedPayloadValidator`, which
 * rejoins the two and checks the whole.
 *
 * This package takes no validator library. The caller supplies the JSON
 * Schema compiler, as for `profilePayloadValidator`, and the JSON-LD and
 * SHACL engines. `@bsv/dpp-profiles/validation-engine` builds the latter two
 * from libraries the caller installs.
 */
import type { ProductAssemblyRefusalCode } from './access-tiers.js'
import type { PayloadToValidate, PayloadValidation, SchemaCompiler } from './payload-validator.js'
import type { BindingStep, EngineCapability, FindingSeverity } from './profile-binding.js'
import type { ProfileRegistry } from './profile-registry.js'
import { createValidationPipeline } from './validation-pipeline.js'

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
  /** The payload declares a retired profile. Its rules are no longer applied, so no step ran. */
  | 'profile-retired'
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
  /** The public payload carries a property the binding does not list as public. */
  | 'restricted-property-disclosed'
  /** The public payload and the restricted part were not rejoined. The step's `refusal` is the code. */
  | 'product-assembly-refused'
  /** A rule could not be decided from the public payload, because it needs a restricted property. */
  | 'restricted-tier-withheld'

/** How much of the product document a validation read. */
export type BindingValidationView =
  /** The public payload alone, as a projection of the whole document. */
  | 'public'
  /** The public payload rejoined with the restricted part. */
  | 'authorised'
  /** The whole document, before it was split. Only a writer has this view. */
  | 'whole'

/** A rule the public payload could not decide. It names the rule and the property, and never a value. */
export interface WithheldCheck {
  step: 'json-schema' | 'shacl'
  /** The property the rule needs: its name for a schema rule, its IRI for a shape. */
  property: string
  /** The kind of rule: the schema keyword, or the SHACL constraint component. */
  constraint: string
  /** The rule's own message, where it has one. */
  message?: string
}

export interface BindingStepOutcome {
  /** `access` is the disclosure check on a public payload, and `assembly` the rejoin of the two parts. */
  step: 'envelope' | 'binding' | 'access' | 'assembly' | BindingStep
  status: 'pass' | 'fail' | 'unknown'
  cause?: BindingValidationCause
  /** One sentence per problem. */
  messages?: string[]
  /** Every finding the SHACL engine reported, blocking or not. */
  findings?: EngineFinding[]
  /** The rules this step could not decide from the public payload. */
  withheld?: WithheldCheck[]
  /** Why the parts were not rejoined, on a failed `assembly` step. */
  refusal?: ProductAssemblyRefusalCode
}

/** What `detail` carries for a profile held by a binding. */
export interface BindingValidationDetail {
  /** `id@version`, as the payload declares it. */
  profile: string
  /** The registered binding's digest, once the profile resolved. */
  bindingDigest?: string
  /** The cause of the first failure, else of the first step that could not run. Absent on a pass. */
  cause?: BindingValidationCause
  /** With `profile-retired`: the profile that replaces the retired one. */
  replacedBy?: string
  /** The steps that ran, in order. */
  steps: BindingStepOutcome[]
  /** Present when the binding splits the product document: which view was checked, and every rule that view could not decide. */
  access?: { policy: string; view: BindingValidationView; withheld: WithheldCheck[] }
}

/** A public payload with the restricted part that belongs to it, as an authorised reader holds them. */
export interface AuthorisedPayloadToValidate extends PayloadToValidate {
  /** The restricted part, parsed. Omit it only for a state that has none. */
  restrictedProduct?: unknown
}

/**
 * A validator over the profiles a registry holds. For a profile held by a
 * binding it runs the pipeline above on the public payload. For a
 * manifest-format profile it answers exactly as `profilePayloadValidator`
 * does with the same compiler, so one validator serves a deployment that
 * carries both.
 */
export function bindingPayloadValidator(options: { registry: ProfileRegistry; engines?: ValidationEngines }): (payload: PayloadToValidate) => Promise<PayloadValidation> {
  const run = createValidationPipeline(options)
  return (payload) => run({ payload, view: 'public' })
}

/**
 * A validator for a reader who holds both parts of a state. It checks the
 * envelope and the binding digest of the public payload, rejoins the two
 * parts and runs every step on the whole document, the identity check
 * included. Parts that do not rejoin fail, and the `assembly` step names
 * the refusal.
 *
 * A pass says the rejoined document satisfies the profile. It does not say
 * the restricted part is the one the record commits to: compare the stored
 * blob with the record's hash first, as `spec/record-model.md` §7 requires.
 */
export function authorisedPayloadValidator(options: { registry: ProfileRegistry; engines?: ValidationEngines }): (input: AuthorisedPayloadToValidate) => Promise<PayloadValidation> {
  const run = createValidationPipeline(options)
  return ({ restrictedProduct, ...payload }) => run({ payload, view: 'authorised', restrictedProduct })
}

