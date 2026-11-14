#!/usr/bin/env node
/**
 * Start a passport's public payload from its industry profile, and check a
 * payload before it is written.
 *
 *   node examples/sample-payload.mjs <profile@version>                 print a minimal valid public payload
 *   node examples/sample-payload.mjs <profile@version> --demonstration the same, starting with the notice a demonstration record carries
 *   node examples/sample-payload.mjs --check <profile@version> <file>  check a payload file against the profile
 *   node examples/sample-payload.mjs --all                             generate and check a sample for every supported profile
 *
 * The sample is generated from the profile's published public payload schema
 * in @bsv/dpp-profiles (generated/payload-schema/<profile>.public.schema.json):
 * every required field, and nothing else, with a placeholder value of the
 * right shape. It is checked against the same schema before it is printed.
 * Replace every value with the product's own data; a placeholder is never a
 * statement about a product. The profile's own page says what each field
 * means (docs/profiles/).
 *
 * With --demonstration, the payload starts with `notice`, the sentence a
 * person reads first on a record that describes no real product
 * (spec/profiles.md section 5). A record about a real product never carries it.
 *
 * With --check, every problem is printed as one sentence naming the field,
 * and the command exits non-zero if there is any. With --all, what CI runs,
 * a sample is generated and checked for every supported profile version.
 *
 * A retired profile (RETIRED_PROFILE_IDS in @bsv/dpp-profiles) is refused by
 * name, `profile-retired`, with what replaces it: no sample is started and
 * no payload is checked under one, though its frozen schema is still
 * published. The profiles that replace the retired sector profiles are held
 * by a binding and have product documents, not samples from a schema
 * (docs/profiles/eu-sector-bindings.md).
 *
 * Results print one sentence per check, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PROFILE_RETIRED, RETIRED_PROFILE_IDS, SUPPORTED_PROFILE_IDS, describeRetiredProfile, isRetiredProfile, readPublicPayloadSchema } from '@bsv/dpp-profiles'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)

/** A placeholder of the right shape for one schema node; `name` is the property it fills. */
function sample(node, name) {
  if (node.const !== undefined) return node.const
  if (Array.isArray(node.enum)) return node.enum[0]
  if (Array.isArray(node.oneOf)) return sample(node.oneOf[0], name)
  if (Array.isArray(node.anyOf)) return sample(node.anyOf[0], name)
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type
  if (type === 'object' || node.properties != null) {
    const out = {}
    for (const key of node.required ?? []) out[key] = sample(node.properties?.[key] ?? {}, key)
    return out
  }
  if (type === 'array') return Array.from({ length: Math.max(1, node.minItems ?? 1) }, () => sample(node.items ?? {}, name))
  if (type === 'integer' || type === 'number') {
    const low = node.minimum ?? (node.exclusiveMinimum != null ? node.exclusiveMinimum + 1 : 1)
    return node.maximum != null ? Math.min(low, node.maximum) : low
  }
  if (type === 'boolean') return false
  if (node.format === 'date') return '2026-01-15'
  if (node.format === 'date-time') return '2026-01-15T09:00:00Z'
  if (node.format === 'uri') return `https://example.com/${name}`
  if (node.format === 'email') return 'contact@example.com'
  if (node.pattern === '^[A-Z]{2}$') return 'DE'
  if (node.pattern === '^\\d{2,7}-\\d{2}-\\d$') return '7439-93-2'
  if (node.pattern === '^\\d{4}-(0[1-9]|1[0-2])$') return '2026-01'
  const text = `Example ${name}`
  return node.maxLength != null ? text.slice(0, node.maxLength) : text
}

/** One sentence per schema error, naming the field. */
function problems(validate) {
  return (validate.errors ?? []).map((e) => {
    const field = e.instancePath === '' ? 'the payload' : `\`${e.instancePath.slice(1).replaceAll('/', '.')}\``
    if (e.keyword === 'required') return `${field === 'the payload' ? 'the payload' : field} is missing the required field \`${e.params.missingProperty}\``
    if (e.keyword === 'additionalProperties') return `${field} has a field the profile does not define: \`${e.params.additionalProperty}\``
    return `${field} ${e.message}`
  })
}

const DEMONSTRATION_NOTICE = 'Demonstration record: no real product stands behind this passport.'

function generate(profile, demonstration = false) {
  const schema = readPublicPayloadSchema(profile)
  const required = sample(schema, 'payload')
  const payload = demonstration ? { notice: DEMONSTRATION_NOTICE, ...required } : required
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema)
  return { payload, valid: validate(payload), errors: problems(validate) }
}

/** Stop, by name, when the profile asked for is retired: nothing is generated or checked under it. */
function refuseRetired(profile) {
  if (typeof profile !== 'string' || !isRetiredProfile(profile)) return
  console.error(`${PROFILE_RETIRED}: ${describeRetiredProfile(profile)}`)
  process.exit(2)
}

const args = process.argv.slice(2)
if (args[0] === '--all') {
  let failures = 0
  for (const profile of SUPPORTED_PROFILE_IDS) {
    const { payload, valid, errors } = generate(profile)
    if (!valid) failures += 1
    console.log(`${valid ? 'ok' : 'FAIL'}: the ${profile} sample fills ${Object.keys(payload).length} required fields and ${valid ? 'is valid under its published schema' : `is refused: ${errors.join('; ')}`}.`)
    const demo = generate(profile, true)
    if (!demo.valid) failures += 1
    console.log(`${demo.valid ? 'ok' : 'FAIL'}: its demonstration sample, starting with notice, ${demo.valid ? 'is valid too' : `is refused: ${demo.errors.join('; ')}`}.`)
  }
  const offered = RETIRED_PROFILE_IDS.filter((profile) => SUPPORTED_PROFILE_IDS.includes(profile))
  if (offered.length > 0) failures += 1
  console.log(`${offered.length === 0 ? 'ok' : 'FAIL'}: no sample is generated for a retired profile (${RETIRED_PROFILE_IDS.join(', ')})${offered.length === 0 ? '' : `, yet ${offered.join(', ')} is still offered`}.`)
  console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
  process.exit(failures === 0 ? 0 : 1)
}
if (args[0] === '--check') {
  const [, profile, file] = args
  refuseRetired(profile)
  if (!SUPPORTED_PROFILE_IDS.includes(profile) || file == null) {
    console.error(`usage: node examples/sample-payload.mjs --check <profile@version> <file>; profiles: ${SUPPORTED_PROFILE_IDS.join(', ')}`)
    process.exit(2)
  }
  const validate = ajv.compile(readPublicPayloadSchema(profile))
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  if (validate(payload)) {
    console.log(`ok: ${file} is a valid ${profile} public payload.`)
    process.exit(0)
  }
  for (const problem of problems(validate)) console.log(`FAIL: ${problem}.`)
  process.exit(1)
}
const demonstration = args.includes('--demonstration')
const [profile] = args.filter((arg) => !arg.startsWith('--'))
refuseRetired(profile)
if (!SUPPORTED_PROFILE_IDS.includes(profile)) {
  console.error(`usage: node examples/sample-payload.mjs <profile@version> [--demonstration]; profiles: ${SUPPORTED_PROFILE_IDS.join(', ')}`)
  process.exit(2)
}
const { payload, valid, errors } = generate(profile, demonstration)
if (!valid) {
  console.error(`The generated ${profile} sample is refused by its own schema: ${errors.join('; ')}.`)
  process.exit(1)
}
console.log(JSON.stringify(payload, null, 2))
