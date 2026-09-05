import { describe, expect, it } from 'vitest'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { readManifest, readPublicPayloadSchema, readRestrictedPayloadSchema, type ProfileField, type ProfileManifest } from '../src/index.js'

// A consumer configures its validator as spec/profiles.md section 3 requires:
// formats asserted, the dialect fixed, unknown keywords refused.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const compiled = new Map<string, ValidateFunction>()
const publicSchema = (profile: 'battery@2' | 'textile@2' | 'general@2'): ValidateFunction => {
  let v = compiled.get(profile)
  if (v == null) { v = ajv.compile(readPublicPayloadSchema(profile)); compiled.set(profile, v) }
  return v
}

/** A plausible value of the field's type, for the required fields a sample must carry. */
function sampleValue(field: Pick<ProfileField, 'valueType' | 'codeList' | 'constraints' | 'parts' | 'cardinality'>): unknown {
  const patterned = (): string => {
    const pattern = field.constraints?.pattern
    if (pattern == null) return 'x'
    if (pattern.includes('\\d{2,7}-\\d{2}-\\d')) return '50-00-0'
    if (pattern.includes('[A-Z]{2}')) return 'IT'
    return 'x'
  }
  const one = (): unknown => {
    switch (field.valueType) {
      case 'id': case 'text': case 'graphic': return patterned()
      case 'enum': return field.codeList?.options[0]?.value ?? 'x'
      case 'multi': return [field.codeList?.options[0]?.value ?? 'x']
      case 'decimal': case 'integer': return field.constraints?.minimum ?? 1
      case 'percent': return 50
      case 'monthYear': return '2026-01'
      case 'date': return '2026-01-01'
      case 'url': case 'document': return 'https://example.test/x'
      case 'country': return 'IT'
      case 'record': return Object.fromEntries((field.parts ?? []).filter((p) => p.required).map((p) => [p.key, sampleValue({ ...p, cardinality: 'one' })]))
      default: return 'x'
    }
  }
  return field.cardinality === 'many' && field.valueType !== 'multi' ? [one()] : one()
}

/** A public payload that satisfies every unconditional required field the schema names. */
function sample(manifest: ProfileManifest): Record<string, unknown> {
  const payload: Record<string, unknown> = { profile: manifest.id, profile_version: manifest.version }
  const category = manifest.applicability.categories[0]?.value
  if (category != null && manifest.stamps.some((s) => s.key === 'category') || manifest.fields.some((f) => f.key === 'category')) payload.category = category
  for (const f of manifest.fields) {
    if (f.accessTier !== 'public' || f.obligation !== 'required' || f.applicability.rule !== 'always') continue
    if (!['form', 'brand', 'platform'].includes(f.provenance.capture)) continue
    payload[f.key] = sampleValue(f)
  }
  return payload
}

const errorsOf = (v: ValidateFunction): string => (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ')

describe('the generated public payload schemas', () => {
  it.each(['battery@2', 'textile@2', 'general@2'] as const)('%s accepts a payload carrying its stamps and unconditional required fields', (profile) => {
    const manifest = readManifest(profile)
    const validate = publicSchema(profile)
    const payload = sample(manifest)
    expect(validate(payload), errorsOf(validate)).toBe(true)
  })

  it('requires the profile stamps and never infers a missing version', () => {
    const manifest = readManifest('general@2')
    const validate = publicSchema('general@2')
    const payload = sample(manifest)
    const { profile_version: _v, ...withoutVersion } = payload
    expect(validate(withoutVersion)).toBe(false)
    expect(validate({ ...payload, profile_version: 1 })).toBe(false)
    expect(validate({ ...payload, profile: 'battery' })).toBe(false)
  })

  it('refuses an undeclared key in the public projection', () => {
    const validate = publicSchema('general@2')
    expect(validate({ ...sample(readManifest('general@2')), somethingElse: 1 })).toBe(false)
  })

  it('honours closed and open code lists, percentage bounds and country patterns, wherever a profile declares them', () => {
    const eligible = (f: ProfileField): boolean => f.accessTier === 'public' && f.awaitingAct == null && f.cardinality === 'one'
    const seen = { closed: 0, open: 0, percent: 0, country: 0 }
    for (const profile of ['battery@2', 'textile@2', 'general@2'] as const) {
      const manifest = readManifest(profile)
      const validate = publicSchema(profile)
      const base = sample(manifest)
      expect(validate(base), `${profile} sample: ${errorsOf(validate)}`).toBe(true)
      const closed = manifest.fields.find((f) => eligible(f) && f.valueType === 'enum' && f.codeList?.closed === true)
      const open = manifest.fields.find((f) => eligible(f) && f.valueType === 'enum' && f.codeList?.closed === false)
      const percent = manifest.fields.find((f) => eligible(f) && f.valueType === 'percent')
      const country = manifest.fields.find((f) => eligible(f) && f.valueType === 'country')
      if (closed != null) {
        seen.closed += 1
        expect(validate({ ...base, [closed.key]: closed.codeList!.options[0].value }), `${profile} ${closed.key}: ${errorsOf(validate)}`).toBe(true)
        expect(validate({ ...base, [closed.key]: 'not-in-the-list' }), `${profile} ${closed.key} refuses an unlisted value`).toBe(false)
      }
      if (open != null) {
        seen.open += 1
        expect(validate({ ...base, [open.key]: 'not-in-the-list' }), `${profile} ${open.key}: ${errorsOf(validate)}`).toBe(true)
      }
      if (percent != null) {
        seen.percent += 1
        expect(validate({ ...base, [percent.key]: 40 }), `${profile} ${percent.key}: ${errorsOf(validate)}`).toBe(true)
        expect(validate({ ...base, [percent.key]: 140 })).toBe(false)
      }
      if (country != null) {
        seen.country += 1
        expect(validate({ ...base, [country.key]: 'IT' }), `${profile} ${country.key}: ${errorsOf(validate)}`).toBe(true)
        expect(validate({ ...base, [country.key]: 'Italy' })).toBe(false)
      }
    }
    expect(seen.closed, 'a closed public enum somewhere').toBeGreaterThan(0)
    expect(seen.open, 'an open public enum somewhere').toBeGreaterThan(0)
    expect(seen.percent + seen.country, 'a percentage or a country somewhere').toBeGreaterThan(0)
  })

  it('types a repeated record by its parts and their required members', () => {
    const textile = readManifest('textile@2')
    const fibres = textile.fields.find((f) => f.key === 'fibres')!
    expect(fibres.valueType).toBe('record')
    expect(fibres.cardinality).toBe('many')
    const validate = publicSchema('textile@2')
    const base = sample(textile)
    const fibre = fibres.parts!.find((p) => p.key === 'fibre')!
    const good = fibre.codeList!.options[0].value
    expect(validate({ ...base, fibres: [{ fibre: good, percent: 100 }] }), errorsOf(validate)).toBe(true)
    expect(validate({ ...base, fibres: [{ fibre: good, percent: 100, extra: true }] })).toBe(false)
    expect(validate({ ...base, fibres: { fibre: good, percent: 100 } })).toBe(false)
    expect(validate({ ...base, fibres: [{ fibre: good, percent: 130 }] })).toBe(false)
  })

  it('states no constraint for a field whose permitted form waits on an act', () => {
    const textile = readManifest('textile@2')
    const waiting = textile.fields.filter((f) => f.awaitingAct != null && f.accessTier === 'public')
    expect(waiting.length).toBeGreaterThan(0)
    const schema = readPublicPayloadSchema('textile@2') as { properties: Record<string, Record<string, unknown>> }
    for (const f of waiting) {
      const property = schema.properties[f.key]
      expect(property.enum, f.key).toBeUndefined()
      expect(property.pattern, f.key).toBeUndefined()
    }
  })

  it('keeps the restricted tiers in a separate schema with none of the public fields', () => {
    const battery = readManifest('battery@2')
    const restricted = readRestrictedPayloadSchema('battery@2') as { properties: Record<string, unknown> }
    const publicKeys = new Set(battery.fields.filter((f) => f.accessTier === 'public').map((f) => f.key))
    for (const key of Object.keys(restricted.properties)) expect(publicKeys.has(key), key).toBe(false)
    expect(Object.keys(restricted.properties).length).toBe(battery.fields.filter((f) => f.accessTier !== 'public').length)
  })
})
