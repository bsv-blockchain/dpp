#!/usr/bin/env node
/**
 * Start a passport's public payload from its industry profile, and check a
 * payload before it is written.
 *
 *   node examples/sample-payload.mjs <profile@version>                 print a minimal valid public payload
 *   node examples/sample-payload.mjs --check <profile@version> <file>  check a payload file against the profile
 *   node examples/sample-payload.mjs --all                             generate and check a sample for every profile
 *
 * The sample is generated from the profile's published public payload schema
 * in @bsv/dpp-profiles (generated/payload-schema/<profile>.public.schema.json):
 * every required field, and nothing else, with a placeholder value of the
 * right shape. It is checked against the same schema before it is printed.
 * Replace every value with the product's own data; a placeholder is never a
 * statement about a product. The profile's own page says what each field
 * means (docs/profiles/).
 *
 * With --check, every problem is printed as one sentence naming the field,
 * and the command exits non-zero if there is any. With --all, what CI runs,
 * a sample is generated and checked for every published profile version.
 *
 * Results print one sentence per check, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PROFILE_IDS, readPublicPayloadSchema } from '@bsv/dpp-profiles'

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

function generate(profile) {
  const schema = readPublicPayloadSchema(profile)
  const payload = sample(schema, 'payload')
  const validate = ajv.compile(schema)
  return { payload, valid: validate(payload), errors: problems(validate) }
}

const args = process.argv.slice(2)
if (args[0] === '--all') {
  let failures = 0
  for (const profile of PROFILE_IDS) {
    const { payload, valid, errors } = generate(profile)
    if (!valid) failures += 1
    console.log(`${valid ? 'ok' : 'FAIL'}: the ${profile} sample fills ${Object.keys(payload).length} required fields and ${valid ? 'is valid under its published schema' : `is refused: ${errors.join('; ')}`}.`)
  }
  console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
  process.exit(failures === 0 ? 0 : 1)
}
if (args[0] === '--check') {
  const [, profile, file] = args
  if (!PROFILE_IDS.includes(profile) || file == null) {
    console.error(`usage: node examples/sample-payload.mjs --check <profile@version> <file>; profiles: ${PROFILE_IDS.join(', ')}`)
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
const [profile] = args
if (!PROFILE_IDS.includes(profile)) {
  console.error(`usage: node examples/sample-payload.mjs <profile@version>; profiles: ${PROFILE_IDS.join(', ')}`)
  process.exit(2)
}
const { payload, valid, errors } = generate(profile)
if (!valid) {
  console.error(`The generated ${profile} sample is refused by its own schema: ${errors.join('; ')}.`)
  process.exit(1)
}
console.log(JSON.stringify(payload, null, 2))
