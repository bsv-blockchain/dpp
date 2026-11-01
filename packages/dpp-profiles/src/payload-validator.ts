/**
 * The payload validator a verifier plugs into `verifyPassportEvidence`
 * (`spec/verification.md` §4, `schema`): a token state's `payload_public`
 * checked against the public schema the profile and version it declares
 * select (`spec/profiles.md` §3). The protocol package holds no schema, so
 * the check lives here, beside the schemas, and a caller passes the result
 * of `profilePayloadValidator()` as `payloadValidator` in its evidence policy.
 *
 * The answer is one of the report's own: `pass` when the payload validates,
 * `fail` with `schema-invalid` and one sentence per problem when it does
 * not, and `unknown` with `schema-unavailable` for a profile this package
 * does not publish, because an unknown profile selects no schema here and
 * guessing one would be a pass nobody earned.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { DeclaredPayload, PartialCheck } from '@bsv/dpp-protocol'
import { PROFILE_IDS, readPublicPayloadSchema, type ProfileId } from './index.js'

const isProfileId = (value: string): value is ProfileId => (PROFILE_IDS as readonly string[]).includes(value)

/** One sentence per schema problem, naming the field, as `examples/sample-payload.mjs` prints them. */
export function describeSchemaProblems(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const where = e.instancePath === '' ? 'the payload' : `\`${e.instancePath.replace(/^\//, '').replace(/\//g, '.')}\``
    if (e.keyword === 'required') return `${where} is missing the required field \`${String(e.params.missingProperty)}\`.`
    if (e.keyword === 'additionalProperties') return `${where} has a field the profile does not define: \`${String(e.params.additionalProperty)}\`.`
    if (e.keyword === 'enum') return `${where} is not one of the values the profile lists.`
    return `${where} ${e.message ?? 'does not validate'}.`
  })
}

/**
 * A validator over the published public payload schemas. Schemas compile on
 * first use and are kept; the Ajv instance asserts formats and fixes the
 * 2020-12 dialect, which is what every published schema declares.
 */
export function profilePayloadValidator(): (payload: DeclaredPayload) => Promise<PartialCheck> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv)
  const compiled = new Map<ProfileId, ValidateFunction>()
  const validatorFor = (profile: ProfileId): ValidateFunction => {
    const kept = compiled.get(profile)
    if (kept != null) return kept
    const schema = readPublicPayloadSchema(profile)
    const known = typeof schema.$id === 'string' ? ajv.getSchema(schema.$id) : undefined
    const v: ValidateFunction = known ?? ajv.compile(schema)
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
