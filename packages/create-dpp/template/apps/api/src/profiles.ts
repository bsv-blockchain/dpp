// Industry profiles: which product data a passport carries, checked against
// the profile's published JSON schema before anything is written. The
// schemas and manifests come from @bsv/dpp-profiles; this module only
// chooses the current ones and runs the validator.
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  PROFILE_IDS,
  readManifest,
  readPublicPayloadSchema,
  readRestrictedPayloadSchema,
  type ProfileId,
  type ProfileManifest,
} from '@bsv/dpp-profiles'

const ajv = new Ajv2020({ allErrors: true, strict: false })
;(addFormats as unknown as (instance: Ajv2020) => void)(ajv)

/** The profiles a brand may choose: every published version whose manifest says it is current. */
export function currentProfiles(): Array<{ id: ProfileId; title: string; description?: string }> {
  return PROFILE_IDS.filter((id) => readManifest(id).status === 'current').map((id) => {
    const manifest = readManifest(id)
    return { id, title: manifest.title, description: manifest.description }
  })
}

export function isProfileId(value: string): value is ProfileId {
  return (PROFILE_IDS as readonly string[]).includes(value)
}

export function manifestFor(profile: ProfileId): ProfileManifest {
  return readManifest(profile)
}

export type Tier = 'public' | 'restricted'

export interface Validation {
  valid: boolean
  problems: string[]
}

/** Check a payload against the profile's public or restricted schema. The problems name the field and what is wrong. */
export function validatePayload(profile: ProfileId, tier: Tier, payload: unknown): Validation {
  const schema = (tier === 'public' ? readPublicPayloadSchema(profile) : readRestrictedPayloadSchema(profile)) as { $id?: string }
  const validate = (schema.$id != null ? ajv.getSchema(schema.$id) : undefined) ?? ajv.compile(schema)
  const valid = validate(payload) as boolean
  const problems = valid ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || 'the payload'} ${e.message ?? 'is invalid'}`)
  return { valid, problems }
}

/** A placeholder of the right shape for one schema node, so a form can start from something valid. */
function placeholder(node: Record<string, unknown>, name: string): unknown {
  if (node.const !== undefined) return node.const
  if (Array.isArray(node.enum)) return node.enum[0]
  if (Array.isArray(node.oneOf)) return placeholder(node.oneOf[0] as Record<string, unknown>, name)
  if (Array.isArray(node.anyOf)) return placeholder(node.anyOf[0] as Record<string, unknown>, name)
  const type = Array.isArray(node.type) ? node.type[0] : node.type
  if (type === 'object' || node.properties != null) {
    const out: Record<string, unknown> = {}
    const properties = (node.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const key of (node.required ?? []) as string[]) out[key] = placeholder(properties[key] ?? {}, key)
    return out
  }
  if (type === 'array') return Array.from({ length: Math.max(1, Number(node.minItems ?? 1)) }, () => placeholder((node.items ?? {}) as Record<string, unknown>, name))
  if (type === 'integer') return Number(node.minimum ?? 0)
  if (type === 'number') return Number(node.minimum ?? 0)
  if (type === 'boolean') return false
  if (node.format === 'date') return '2026-01-01'
  if (node.format === 'date-time') return '2026-01-01T00:00:00Z'
  if (node.format === 'uri') return 'https://example.com/'
  if (typeof node.pattern === 'string') {
    // The shapes the profiles' patterns ask for: a country code, a month, a CAS number, a GTIN.
    const candidates = ['AU', '2026-01', '7440-50-8', '09521000000025', '12345678', 'A', '0']
    const regex = new RegExp(node.pattern)
    const match = candidates.find((candidate) => regex.test(candidate))
    if (match != null) return match
  }
  const text = `${name} placeholder`
  return typeof node.maxLength === 'number' ? text.slice(0, node.maxLength) : text
}

/**
 * A minimal valid public payload for the profile: every required field with a
 * placeholder value. With `demonstration`, it starts with the notice a record
 * that describes no real product carries. Replace every value with the
 * product's own data; a placeholder is never a statement about a product.
 */
export function samplePayload(profile: ProfileId, demonstration: boolean): Record<string, unknown> {
  const { payload, problems } = sampleWithProblems(profile, demonstration)
  if (problems.length > 0) throw new Error(`the generated ${profile} sample is refused by its own schema: ${problems.join('; ')}`)
  return payload
}

/** The same sample, with whatever its own schema still refuses, so a form can start from it and show what to fix. */
export function sampleWithProblems(profile: ProfileId, demonstration: boolean): { payload: Record<string, unknown>; problems: string[] } {
  const schema = readPublicPayloadSchema(profile) as Record<string, unknown>
  const required = placeholder(schema, 'payload') as Record<string, unknown>
  const payload = demonstration ? { notice: 'Demonstration record. Nothing here describes a real product.', ...required } : required
  return { payload, problems: validatePayload(profile, 'public', payload).problems }
}
