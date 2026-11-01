/**
 * The payload validator a verifier plugs into `verifyPassportEvidence`
 * (`spec/verification.md` §4, `schema`): a token state's `payload_public`
 * checked against the public schema the profile and version it declares
 * select (`spec/profiles.md` §3). The protocol package holds no schema, so
 * the check lives here, beside the schemas, and a caller passes the result
 * of `profilePayloadValidator(ajv)` as `payloadValidator` in its evidence
 * policy.
 *
 * This package takes no validator library of its own, as the rest of it
 * takes none: the caller brings the JSON Schema 2020-12 compiler it already
 * installed, Ajv's 2020 build with `ajv-formats` and `strict: false`, exactly
 * as the package page shows, and this module asks it for one compiled
 * validator per profile and keeps them.
 *
 * The answer is one of the report's own: `pass` when the payload validates,
 * `fail` with `schema-invalid` and one sentence per problem when it does
 * not, and `unknown` with `schema-unavailable` for a profile this package
 * does not publish, because an unknown profile selects no schema here and
 * guessing one would be a pass nobody earned.
 */
import { PROFILE_IDS, readPublicPayloadSchema, type ProfileId } from './index.js'

/** One problem a compiled validator reports, in the shape Ajv gives. */
export interface SchemaProblem {
  instancePath: string
  keyword: string
  message?: string
  params: Record<string, unknown>
}

/** A compiled validator: Ajv's `ValidateFunction`, structurally. */
export interface CompiledSchema {
  (data: unknown): boolean
  errors?: SchemaProblem[] | null
}

/** The compiler the caller supplies: an Ajv 2020 instance with formats added, structurally. */
export interface SchemaCompiler {
  compile(schema: Record<string, unknown>): CompiledSchema
  getSchema(id: string): CompiledSchema | undefined
}

/** The part of a token state's payload the validator reads: what `verifyPassportEvidence` hands to `payloadValidator`. */
export interface PayloadToValidate {
  profile: string
  profileVersion: number
  payloadPublic: string
}

/** The validator's answer, in the report's own words: a partial check for `schema`. */
export interface PayloadValidation {
  status: 'pass' | 'fail' | 'unknown'
  reasonCode?: 'schema-invalid' | 'schema-unavailable'
  detail?: string | string[]
}

const isProfileId = (value: string): value is ProfileId => (PROFILE_IDS as readonly string[]).includes(value)

/** One sentence per schema problem, naming the field, as `examples/sample-payload.mjs` prints them. */
export function describeSchemaProblems(errors: SchemaProblem[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const where = e.instancePath === '' ? 'the payload' : `\`${e.instancePath.replace(/^\//, '').replace(/\//g, '.')}\``
    if (e.keyword === 'required') return `${where} is missing the required field \`${String(e.params.missingProperty)}\`.`
    if (e.keyword === 'additionalProperties') return `${where} has a field the profile does not define: \`${String(e.params.additionalProperty)}\`.`
    if (e.keyword === 'enum') return `${where} is not one of the values the profile lists.`
    return `${where} ${e.message ?? 'does not validate'}.`
  })
}

/**
 * A validator over the published public payload schemas, compiled by the
 * compiler the caller supplies. Schemas compile on first use and are kept,
 * and a schema the compiler already holds by `$id` is reused rather than
 * compiled twice, which Ajv refuses.
 */
export function profilePayloadValidator(compiler: SchemaCompiler): (payload: PayloadToValidate) => Promise<PayloadValidation> {
  const compiled = new Map<ProfileId, CompiledSchema>()
  const validatorFor = (profile: ProfileId): CompiledSchema => {
    const kept = compiled.get(profile)
    if (kept != null) return kept
    const schema = readPublicPayloadSchema(profile)
    const known = typeof schema.$id === 'string' ? compiler.getSchema(schema.$id) : undefined
    const v = known ?? compiler.compile(schema)
    compiled.set(profile, v)
    return v
  }
  return async ({ profile, profileVersion, payloadPublic }) => {
    const id = `${profile}@${profileVersion}`
    if (!isProfileId(id)) return { status: 'unknown', reasonCode: 'schema-unavailable', detail: `${id} is not a published industry profile` }
    let parsed: unknown
    try { parsed = JSON.parse(payloadPublic) } catch { return { status: 'fail', reasonCode: 'schema-invalid', detail: ['the payload is not JSON.'] } }
    const validate = validatorFor(id)
    if (validate(parsed)) return { status: 'pass', detail: id }
    return { status: 'fail', reasonCode: 'schema-invalid', detail: describeSchemaProblems(validate.errors) }
  }
}
