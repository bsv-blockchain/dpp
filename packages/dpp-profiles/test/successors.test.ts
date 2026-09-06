import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { fieldsForV2, isManifestV2, missingRequiredV2, readConsumerDocument, readFrozen, readManifestAny, readPublicPayloadSchema, readRestrictedPayloadSchema, type ProfileFieldV2, type ProfileManifestV2 } from '../src/index.js'

/**
 * The draft successors battery@3 and textile@3 (`spec/profiles.md` §4):
 * what the applicability crosswalk decided, held as behaviour. An
 * anticipated field never blocks; a data point the guidance leaves
 * conditional is unresolved, not failed and not passed, until the record
 * declares it inapplicable or supplies it; the state-of-health category
 * sets are the guidance's; every predecessor field has a migration outcome;
 * and the two current versions keep every byte they were frozen at.
 */
const root = join(import.meta.dirname, '..')
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')
const battery = readManifestAny('battery@3') as ProfileManifestV2
const textile = readManifestAny('textile@3') as ProfileManifestV2
const field = (m: ProfileManifestV2, key: string): ProfileFieldV2 => {
  const f = m.fields.find((x) => x.key === key)
  if (f == null) throw new Error(`no field ${key}`)
  return f
}
const CATEGORIES = ['ev', 'lmt', 'industrial', 'stationary'] as const
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const compiled = new Map<string, ValidateFunction>()
const schema = (profile: 'battery@3' | 'textile@3', tier: 'public' | 'restricted'): ValidateFunction => {
  const id = `${profile}:${tier}`
  let v = compiled.get(id)
  if (v == null) { v = ajv.compile(tier === 'public' ? readPublicPayloadSchema(profile) : readRestrictedPayloadSchema(profile)); compiled.set(id, v) }
  return v
}
const errorsOf = (v: ValidateFunction): string => (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ')

/** A plausible value for a field's type, for the required fields a sample must carry. */
function sampleValue(f: ProfileFieldV2): unknown {
  const one = (): unknown => {
    switch (f.valueType) {
      case 'enum': return f.codeList?.options[0]?.value ?? 'x'
      case 'multi': return [f.codeList?.options[0]?.value ?? 'x']
      case 'decimal': case 'integer': return f.constraints?.minimum ?? 1
      case 'percent': return 50
      case 'monthYear': return '2026-01'
      case 'date': return f.precision === 'month' ? '2026-01' : '2026-01-01'
      case 'url': case 'document': return 'https://example.org/x'
      case 'country': return 'DE'
      case 'record': return Object.fromEntries((f.parts ?? []).filter((p) => p.required).map((p) => [p.key, p.valueType === 'country' ? 'DE' : p.valueType === 'enum' ? p.codeList?.options[0]?.value ?? 'x' : ['decimal', 'integer', 'percent'].includes(p.valueType) ? 1 : p.key === 'cas' ? '7439-92-1' : 'x']))
      default: return 'x'
    }
  }
  return f.cardinality === 'many' && f.valueType !== 'multi' ? [one()] : one()
}

describe('battery@3, the draft successor to battery@2', () => {
  const anticipated = battery.fields.filter((f) => f.requirement.status === 'anticipated').map((f) => f.key)

  it('is a draft under manifest version 2 that succeeds battery@2 and keeps every predecessor field', () => {
    expect(isManifestV2(battery)).toBe(true)
    expect(battery.status).toBe('draft')
    expect(battery.succession?.of).toBe('battery@2')
    const predecessor = readManifestAny('battery@2')
    for (const f of predecessor.fields) expect(battery.fields.map((x) => x.key), f.key).toContain(f.key)
    expect(battery.fields).toHaveLength(predecessor.fields.length + 12)
  })

  it('(a) never reports the twenty-one anticipated fields missing, for any category, even when absent', () => {
    expect(anticipated).toHaveLength(21)
    expect(anticipated.sort()).toEqual([
      'carbonAbsolute', 'carbonClass', 'carbonDistribution', 'carbonEndOfLife', 'carbonFootprint', 'carbonFootprintLabel', 'carbonGeneralInfo', 'carbonProduction', 'carbonRawMaterials', 'carbonStudyUrl',
      'dueDiligenceAssurances', 'dueDiligenceReport',
      'recycledCobaltPost', 'recycledCobaltPre', 'recycledLeadPost', 'recycledLeadPre', 'recycledLithiumPost', 'recycledLithiumPre', 'recycledNickelPost', 'recycledNickelPre', 'recycledShareTotal',
    ].sort())
    for (const category of CATEGORIES) {
      const gaps = missingRequiredV2(battery, { category }, { category })
      for (const key of anticipated) expect(gaps.missing.map((f) => f.key), `${key} for ${category}`).not.toContain(key)
      const deferred = gaps.deferred.filter((d) => anticipated.includes(d.field.key))
      // Every anticipated field the profile itself requires is deferred by name, never silently satisfied.
      expect(deferred.map((d) => d.field.key).sort()).toEqual(anticipated.filter((k) => field(battery, k).obligation === 'required').sort())
      for (const d of deferred) expect(d.status).toBe('anticipated')
    }
    // The generated schema requires none of them.
    const required = (readPublicPayloadSchema('battery@3') as { required: string[] }).required
    for (const key of anticipated) expect(required).not.toContain(key)
  })

  it('(b) leaves capacityFade unresolved for industrial and stationary, missing for ev and lmt, and not applicable when declared', () => {
    for (const category of ['ev', 'lmt'] as const) {
      const gaps = missingRequiredV2(battery, { category }, { category })
      expect(gaps.missing.map((f) => f.key), category).toContain('capacityFade')
      expect(gaps.unresolved.map((u) => u.field.key), category).not.toContain('capacityFade')
    }
    for (const category of ['industrial', 'stationary'] as const) {
      const gaps = missingRequiredV2(battery, { category }, { category })
      expect(gaps.missing.map((f) => f.key), category).not.toContain('capacityFade')
      expect(gaps.unresolved.map((u) => u.field.key), category).toContain('capacityFade')
      expect(gaps.unresolved.find((u) => u.field.key === 'capacityFade')?.reasons[0]).toMatch(/only applicable for some industrial batteries/)
      const declared = missingRequiredV2(battery, { category, inapplicableFields: [{ field: 'capacityFade', reason: 'a non-cycle application', declaredBy: 'the maker' }] }, { category })
      expect(declared.missing.map((f) => f.key), category).not.toContain('capacityFade')
      expect(declared.unresolved.map((u) => u.field.key), category).not.toContain('capacityFade')
      expect(fieldsForV2(battery, { category, declaredNotApplicable: ['capacityFade'] }).notApplicable.map((f) => f.key)).toContain('capacityFade')
    }
    // A declaration cannot switch off an unconditional enacted field.
    expect(missingRequiredV2(battery, { category: 'ev', inapplicableFields: [{ field: 'massKg', reason: 'no' }] }, { category: 'ev' }).missing.map((f) => f.key)).toContain('massKg')
  })

  it('(c) scopes remainingCapacityAh to the guidance: applies for lmt, unresolved for industrial and stationary, not applicable for ev', () => {
    const outcome = (category: (typeof CATEGORIES)[number]): string => {
      const r = fieldsForV2(battery, { category })
      return r.applies.some((f) => f.key === 'remainingCapacityAh') ? 'applies' : r.notApplicable.some((f) => f.key === 'remainingCapacityAh') ? 'not-applicable' : 'unresolved'
    }
    expect(outcome('lmt')).toBe('applies')
    expect(outcome('industrial')).toBe('unresolved')
    expect(outcome('stationary')).toBe('unresolved')
    expect(outcome('ev')).toBe('not-applicable')
    // Captured over life, not at registration: absent at registration is never a registration gap, and for industrial it is listed as unresolved.
    expect(field(battery, 'remainingCapacityAh').provenance.capture).toBe('event')
    expect(missingRequiredV2(battery, { category: 'lmt' }, { category: 'lmt' }).missing.map((f) => f.key)).not.toContain('remainingCapacityAh')
    expect(missingRequiredV2(battery, { category: 'industrial' }, { category: 'industrial' }).unresolved.map((u) => u.field.key)).toContain('remainingCapacityAh')
    for (const key of ['powerRemaining', 'roundTripRemaining', 'selfDischargeEvolution', 'resistanceCurrentOhm']) {
      expect(fieldsForV2(battery, { category: 'ev' }).notApplicable.map((f) => f.key), key).toContain(key)
      expect(fieldsForV2(battery, { category: 'lmt' }).applies.map((f) => f.key), key).toContain(key)
    }
  })

  it('(d) leaves stateOfCharge and the other if-applicable data points unresolved for every category', () => {
    for (const category of CATEGORIES) {
      const unresolved = fieldsForV2(battery, { category }).unresolved.map((u) => u.field.key)
      for (const key of ['stateOfCharge', 'roundTripFade', 'cyclesUsed', 'temperatureRecord', 'timeAboveRange', 'timeBelowRange', 'chargingAboveRange', 'chargingBelowRange', 'deepDischargeEvents', 'accidents', 'temperatureSeries', 'stateOfChargeSeries']) {
        expect(unresolved, `${key} for ${category}`).toContain(key)
      }
    }
  })

  it('(e) leaves warrantyUntil unresolved unless the record declares that no commercial warranty is envisaged', () => {
    const gaps = missingRequiredV2(battery, { category: 'ev' }, { category: 'ev' })
    expect(gaps.unresolved.map((u) => u.field.key)).toContain('warrantyUntil')
    expect(gaps.missing.map((f) => f.key)).not.toContain('warrantyUntil')
    const declared = missingRequiredV2(battery, { category: 'ev', inapplicableFields: [{ field: 'warrantyUntil', reason: 'no commercial warranty is envisaged' }] }, { category: 'ev' })
    expect(declared.unresolved.map((u) => u.field.key)).not.toContain('warrantyUntil')
    expect(field(battery, 'warrantyTerms').valueType).toBe('warrantyTerms')
  })

  it('(f) requires passportId and operator under Article 77(3)', () => {
    for (const key of ['passportId', 'operator']) {
      const f = field(battery, key)
      expect(f.obligation).toBe('required')
      expect(f.requirement).toMatchObject({ status: 'enacted', clause: 'Article 77(3)' })
      expect(f.legalBasis).toBe('Art. 77(3)')
    }
  })

  it('(g) records a migration outcome for every predecessor field exactly once and every new field as new', () => {
    const migration = battery.succession?.migration ?? []
    const predecessorKeys = readManifestAny('battery@2').fields.map((f) => f.key)
    for (const key of predecessorKeys) expect(migration.filter((m) => m.from === key), key).toHaveLength(1)
    const newKeys = battery.fields.map((f) => f.key).filter((k) => !predecessorKeys.includes(k))
    expect(newKeys.sort()).toEqual(['inapplicableFields', 'instructionsForUse', 'manufacturerAddress', 'manufacturerEmail', 'manufacturerWeb', 'manufacturingMonth', 'operatingTemperatureRange', 'ratedCapacityCurrentAh', 'resistanceCurrentOhm', 'stateOfChargeSeries', 'temperatureSeries', 'warrantyTerms'])
    for (const key of newKeys) expect(migration.find((m) => m.from === key)?.outcome, key).toBe('new')
    expect(migration.find((m) => m.from === 'manufacturerContact')).toMatchObject({ outcome: 'split', to: 'manufacturerAddress' })
    expect(migration).toHaveLength(predecessorKeys.length + newKeys.length)
    for (const m of migration) expect(m.note.length, m.from).toBeGreaterThan(10)
  })

  it('(h) generates a public schema that accepts the enacted required fields and a restricted schema that refuses a wrong-typed measurement', () => {
    const publicSchema = readPublicPayloadSchema('battery@3') as { required: string[] }
    const payload: Record<string, unknown> = { profile: 'battery', profile_version: 3 }
    for (const key of publicSchema.required) {
      if (key === 'profile' || key === 'profile_version') continue
      const f = field(battery, key)
      expect(f.requirement.status, key).toMatch(/^(enacted|guidance|none)$/)
      expect(f.applicability.rule, key).toBe('always')
      payload[key] = key === 'category' ? 'ev' : sampleValue(f)
    }
    const v = schema('battery@3', 'public')
    expect(v(payload), errorsOf(v)).toBe(true)
    expect(v({ ...payload, operatingTemperatureRange: { lower: 'cold', upper: 60 } })).toBe(false)
    expect(v({ ...payload, operatingTemperatureRange: { lower: -20, upper: 60 } })).toBe(true)
    // The restricted tier requires its own enacted fields; the sample carries them so that only the measurement under test decides the outcome.
    const r = schema('battery@3', 'restricted')
    const restricted: Record<string, unknown> = {}
    for (const key of (readRestrictedPayloadSchema('battery@3') as { required: string[] }).required) restricted[key] = key === 'sparePartsEmail' ? 'parts@example.org' : sampleValue(field(battery, key))
    expect(r(restricted), errorsOf(r)).toBe(true)
    expect(r({ ...restricted, ratedCapacityCurrentAh: 5 })).toBe(false)
    expect(r({ ...restricted, ratedCapacityCurrentAh: { property: '/ratedCapacityCurrentAh', value: 5, unit: 'Ah', method: { id: 'urn:example:method:capacity-1' }, measuredAt: { date: '2026-06-01', precision: 'day' }, subject: { id: 'https://id.example.org/01/09520000000011/21/SER-1', granularity: 'item' } } }), errorsOf(r)).toBe(true)
    expect(r({ ...restricted, temperatureSeries: { property: '/temperatureSeries', value: 21, unit: '°C', subject: { id: 'x', granularity: 'item' } } })).toBe(false)
    expect(r({ ...restricted, temperatureSeries: [{ property: '/temperatureSeries', value: 21, unit: '°C', subject: { id: 'x', granularity: 'item' } }] }), errorsOf(r)).toBe(true)
    expect(v({ ...payload, warrantyTerms: { duration: { value: 8, unit: 'years' }, calendarRule: 'purchase-date' } }), errorsOf(v)).toBe(true)
    expect(v({ ...payload, warrantyTerms: { duration: { value: 8 }, calendarRule: 'purchase-date' } })).toBe(false)
  })

  it('(i) says in its consumer document which version it succeeds and keeps the legacy field keys', () => {
    const doc = readConsumerDocument('battery@3') as { status: string; manifestVersion: string; succession: { of: string }; fields: Array<Record<string, unknown>> }
    expect(doc.status).toBe('candidate successor to battery@2: opt-in by explicit version until the reviewed cutover')
    expect(doc.manifestVersion).toBe('2')
    expect(doc.succession.of).toBe('battery@2')
    expect(doc.fields).toHaveLength(117)
    const capacityFade = doc.fields.find((f) => f.key === 'capacityFade') as Record<string, unknown>
    expect(capacityFade).toMatchObject({ obligation: 'must', access: 'legitimate', level: 'model', type: 'percent', legalRef: 'Annex IV Part A(1)' })
    expect(capacityFade.requirement).toMatchObject({ status: 'enacted' })
    expect((capacityFade.applicabilityRule as { rule: string }).rule).toBe('any')
    expect(readFileSync(join(root, 'generated', 'mapping', 'battery@3.md'), 'utf8')).toContain('| Requirement status |')
  })

  it('(j) leaves every frozen digest of the five earlier manifests exactly where it was', () => {
    const frozen = readFrozen()
    expect(frozen.manifests['battery@2']).toBe('a697852aba912b2f54193aaa0eac3990f49dd69364b555f5485bb30289b32aaf')
    expect(frozen.manifests['textile@2']).toBe('9aacfd62d465a82a8f4ae2a41c5ee4257c2b4943faf006e7f85a1e3ca2e8630e')
    expect(frozen.manifests['general@2']).toBe('70bbcaa8d145dd8928dcc61fc5e44343784c97d71783695e2b46cf91531b1c7d')
    expect(frozen.manifests['textile@1']).toBe('6fae1897b61de2269eb9507a2437f93b0f9cfc0a13239b83359a04299a0271df')
    expect(frozen.manifests['general@1']).toBe('ef895946e243a9fdb7b0f303e7624038d0eb41e00da0ec8c894538f92effe37e')
    for (const profile of ['battery@2', 'textile@2', 'general@2', 'textile@1', 'general@1']) {
      expect(sha256(readFileSync(join(root, 'manifests', `${profile}.json`))), profile).toBe(frozen.manifests[profile])
    }
    expect(Object.keys(frozen.manifests).sort()).toEqual(['battery@2', 'battery@3', 'general@1', 'general@2', 'textile@1', 'textile@2', 'textile@3'])
  })

  it('names its guidance source as guidance and says stationary follows the industrial column by its own reading', () => {
    const guidance = battery.applicability.statements.find((s) => s.status === 'guidance')
    expect(guidance?.text).toMatch(/not the Commission's official position/)
    expect(battery.applicability.statements.some((s) => s.status === 'needs-review' && /stationary/i.test(s.text))).toBe(true)
    expect(battery.sourceRefs.some((s) => s.id === 'eu-battery-guidance-2026-08' && s.licence === 'CC BY 4.0')).toBe(true)
    expect(field(battery, 'instructionsForUse').requirement.status).toBe('not-to-be-displayed')
    expect(field(battery, 'serviceDate').requirement.status).toBe('needs-review')
    expect(field(battery, 'stateOfHealth').requirement.status).toBe('none')
    expect(battery.regulatoryLine).not.toMatch(/\bcompliant\b/)
  })
})

describe('textile@3, the draft successor to textile@2', () => {
  it('never blocks on an anticipated ESPR field and keeps the binding labelling fields required', () => {
    const gaps = missingRequiredV2(textile, { category: 'apparel' }, { category: 'apparel' })
    const required = (readPublicPayloadSchema('textile@3') as { required: string[] }).required.filter((k) => k !== 'profile' && k !== 'profile_version')
    // The record carries the category, so every other schema-required field is missing and nothing anticipated is.
    expect(gaps.missing.map((f) => f.key).sort()).toEqual(required.filter((k) => k !== 'category').sort())
    expect(required.sort()).toEqual(['batch', 'care', 'category', 'collection', 'fibres', 'manufacturer', 'manufacturerContact', 'manufacturingPlace', 'modelIdentifier', 'name'])
    expect(gaps.deferred.map((d) => `${d.field.key}:${d.status}`)).toContain('substancesOfConcern:anticipated')
    expect(gaps.unresolved.map((u) => u.field.key)).toContain('nonTextileParts')
    for (const key of ['recycledContent', 'washCycles', 'carbonFootprint', 'supplyChain', 'footprintClass', 'repairability', 'microplasticRelease']) {
      expect(field(textile, key).requirement.status, key).toBe('anticipated')
    }
    expect(field(textile, 'fibres').requirement).toMatchObject({ status: 'enacted', source: 'eu-1007-2011' })
    expect(field(textile, 'repairServices').requirement.status).toBe('needs-review')
  })

  it('declares component-scoped composition and method-qualified assessments without mandating a score or a scheme', () => {
    const components = field(textile, 'components')
    expect(components).toMatchObject({ scope: 'component', componentScoped: true, cardinality: 'many', obligation: 'recommended' })
    expect(field(textile, 'componentFibres').parts?.map((p) => p.key)).toEqual(['component', 'fibre', 'percent', 'source'])
    for (const key of ['recycledContentAssessment', 'microfibreReleaseAssessment', 'repairabilityAssessment']) {
      const f = field(textile, key)
      expect(f.valueType, key).toBe('measurement')
      expect(f.obligation, key).toBe('optional')
    }
    expect(field(textile, 'certificationEvidence').valueType).toBe('certification')
    expect(field(textile, 'certifications').codeList?.closed).toBe(false)
    const v = schema('textile@3', 'public')
    const base = { profile: 'textile', profile_version: 3, name: 'Demonstration jacket', category: 'apparel', modelIdentifier: 'DJ-1', batch: 'B1', manufacturer: 'Demonstration Textiles', manufacturerContact: 'textiles@example.org', manufacturingPlace: { city: 'Porto', country: 'PT' }, fibres: [{ fibre: 'cotton', percent: 100 }], care: ['wash30'], collection: 'Textile bank' }
    expect(v(base), errorsOf(v)).toBe(true)
    expect(v({ ...base, components: [{ component: 'shell', role: 'shell', massShare: 60 }, { component: 'lining', role: 'lining', massShare: 40 }], componentFibres: [{ component: 'shell', fibre: 'polyamide', percent: 100, source: 'postConsumer' }] }), errorsOf(v)).toBe(true)
    expect(v({ ...base, componentFibres: [{ component: 'shell', fibre: 'polyamide', percent: 120 }] })).toBe(false)
    expect(v({ ...base, certificationEvidence: [{ scheme: { id: 'urn:example:scheme:1', name: 'Demonstration scheme' }, certificateId: 'CERT-1', issuer: 'Demonstration certification body', subject: { id: 'https://id.example.org/01/09520000000028', granularity: 'model' }, verification: { status: 'not-checked' } }] }), errorsOf(v)).toBe(true)
    expect(v({ ...base, certificationEvidence: [{ scheme: { id: 'urn:example:scheme:1', name: 'Demonstration scheme' }, certificateId: 'CERT-1', issuer: 'Demonstration certification body', subject: { id: 'x', granularity: 'model' } }] })).toBe(false)
    expect(v({ ...base, careNoteLocalised: { values: [{ language: 'pt', text: 'Lavar a 30 graus' }, { language: 'en', text: 'Wash at 30 degrees' }] } }), errorsOf(v)).toBe(true)
    expect(v({ ...base, recycledContentAssessment: { property: '/recycledContentAssessment', value: 0.42, unit: 'kg/kg', basis: 'fraction', method: { id: 'urn:example:method:physical-recycled-1' }, subject: { id: 'https://id.example.org/01/09520000000028', granularity: 'model' } } }), errorsOf(v)).toBe(true)
  })

  it('records a migration outcome for all forty-nine predecessor fields and marks the successors it adds as new', () => {
    const migration = textile.succession?.migration ?? []
    const predecessorKeys = readManifestAny('textile@2').fields.map((f) => f.key)
    expect(predecessorKeys).toHaveLength(49)
    for (const key of predecessorKeys) expect(migration.filter((m) => m.from === key), key).toHaveLength(1)
    const newKeys = textile.fields.map((f) => f.key).filter((k) => !predecessorKeys.includes(k))
    expect(newKeys.sort()).toEqual(['careNoteLocalised', 'certificationEvidence', 'componentFibres', 'components', 'inapplicableFields', 'microfibreReleaseAssessment', 'recycledContentAssessment', 'relatedDocuments', 'repairabilityAssessment', 'substanceStatementLocalised', 'warrantyTerms'])
    for (const key of newKeys) expect(migration.find((m) => m.from === key)?.outcome, key).toBe('new')
    expect(textile.status).toBe('draft')
    expect(textile.succession?.of).toBe('textile@2')
    expect(field(textile, 'made').precision).toBe('month')
    expect((readConsumerDocument('textile@3') as { status: string }).status).toMatch(/^candidate successor to textile@2/)
  })
})
