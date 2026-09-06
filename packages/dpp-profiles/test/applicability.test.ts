import { describe, expect, it } from 'vitest'
import { declaredInapplicable, evaluateApplicability, evaluateFieldApplicability, fieldsFor, fieldsForV2, missingRequired, missingRequiredV2, readManifest, type ApplicabilityRuleV2 } from '../src/index.js'
import { SYNTHETIC_MANIFEST } from './projection-fixture.js'

const rule = (r: ApplicabilityRuleV2): ApplicabilityRuleV2 => r

describe('evaluateApplicability (spec/passport-projections.md section 6)', () => {
  it('answers always, category-in and needs-review as the version 1 reader does', () => {
    expect(evaluateApplicability({ rule: 'always' }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'category-in', categories: ['ev'] }, { category: 'ev' }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'category-in', categories: ['ev'] }, { category: 'lmt' }).outcome).toBe('not-applicable')
    expect(evaluateApplicability({ rule: 'category-in', categories: ['ev'] }, {}).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'needs-review', condition: 'only where a commercial warranty is envisaged' })).toEqual({ outcome: 'unresolved', reasons: ['needs review: only where a commercial warranty is envisaged'] })
    expect(evaluateApplicability({ rule: 'needs-review', condition: 'x', categories: ['ev'] }, { category: 'lmt' }).outcome).toBe('not-applicable')
    const battery = readManifest('battery@2')
    const legacy = fieldsFor(battery, 'ev')
    const evaluated = fieldsForV2(battery, { category: 'ev' })
    expect(evaluated.applies.map((f) => f.key)).toEqual(legacy.applies.map((f) => f.key))
    expect(evaluated.notApplicable.map((f) => f.key)).toEqual(legacy.notApplicable.map((f) => f.key))
    expect(evaluated.unresolved.map((u) => u.field.key)).toEqual(legacy.needsReview.map((f) => f.key))
  })

  it('composes all and any, with unresolved never becoming a pass', () => {
    const ev2027 = rule({ rule: 'all', rules: [{ rule: 'category-in', categories: ['ev'] }, { rule: 'effective', from: '2027-02-18' }] })
    expect(evaluateApplicability(ev2027, { category: 'ev', asOf: '2027-03-01' }).outcome).toBe('applies')
    expect(evaluateApplicability(ev2027, { category: 'ev', asOf: '2026-09-06T10:00:00Z' })).toEqual({ outcome: 'not-applicable', reasons: ['not effective until 2027-02-18'] })
    expect(evaluateApplicability(ev2027, { category: 'lmt', asOf: '2027-03-01' }).outcome).toBe('not-applicable')
    expect(evaluateApplicability(ev2027, { category: 'ev' })).toEqual({ outcome: 'unresolved', reasons: ['no evaluation date supplied for an effective-date rule'] })
    const either = rule({ rule: 'any', rules: [{ rule: 'category-in', categories: ['lmt'] }, { rule: 'all', rules: [{ rule: 'category-in', categories: ['industrial'] }, { rule: 'threshold', field: 'capacityKwh', operator: 'gt', value: 2, unit: 'kWh' }] }] })
    expect(evaluateApplicability(either, { category: 'lmt' }).outcome).toBe('applies')
    expect(evaluateApplicability(either, { category: 'industrial', values: { capacityKwh: 5 } }).outcome).toBe('applies')
    expect(evaluateApplicability(either, { category: 'industrial', values: { capacityKwh: 1.5 } }).outcome).toBe('not-applicable')
    expect(evaluateApplicability(either, { category: 'industrial' })).toMatchObject({ outcome: 'unresolved' })
    expect(evaluateApplicability(either, { category: 'industrial', values: { capacityKwh: { value: 5, unit: 'Ah' } } })).toMatchObject({ outcome: 'unresolved' })
    expect(evaluateApplicability(either, { category: 'industrial', values: { capacityKwh: { value: 5, unit: 'kWh' } } }).outcome).toBe('applies')
    expect(evaluateApplicability(either, { category: 'ev', values: { capacityKwh: 60 } }).outcome).toBe('not-applicable')
    const withOpen = rule({ rule: 'any', rules: [{ rule: 'category-in', categories: ['lmt'] }, { rule: 'unresolved', reason: 'primary text not confirmed', source: 'Article 48' }] })
    expect(evaluateApplicability(withOpen, { category: 'ev' })).toEqual({ outcome: 'unresolved', reasons: ['primary text not confirmed (Article 48)'] })
    expect(evaluateApplicability(withOpen, { category: 'lmt' }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'all', rules: [{ rule: 'always' }, { rule: 'unresolved', reason: 'x' }] }).outcome).toBe('unresolved')
  })

  it('decides jurisdiction and effective intervals, and is unresolved without the context they need', () => {
    expect(evaluateApplicability({ rule: 'jurisdiction-in', jurisdictions: ['EU'] }, { jurisdiction: 'EU' }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'jurisdiction-in', jurisdictions: ['EU'] }, { jurisdiction: 'AU' }).outcome).toBe('not-applicable')
    expect(evaluateApplicability({ rule: 'jurisdiction-in', jurisdictions: ['EU'] }, {}).outcome).toBe('unresolved')
    expect(evaluateApplicability({ rule: 'effective', from: '2027-02-18', until: '2030-12-31' }, { asOf: '2031-01-01' })).toEqual({ outcome: 'not-applicable', reasons: ['no longer effective after 2030-12-31'] })
    expect(evaluateApplicability({ rule: 'effective', until: '2030-12-31' }, { asOf: '2030-12-31T23:59:59Z' }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'effective', from: '2027-02' }, { asOf: 'not a date' }).outcome).toBe('unresolved')
    expect(evaluateApplicability({ rule: 'threshold', field: 'capacityKwh', operator: 'eq', value: 2 }, { values: { capacityKwh: 'two' } }).outcome).toBe('unresolved')
    expect(evaluateApplicability({ rule: 'threshold', field: 'capacityKwh', operator: 'lte', value: 2 }, { values: { capacityKwh: 2 } }).outcome).toBe('applies')
    expect(evaluateApplicability({ rule: 'threshold', field: 'capacityKwh', operator: 'lt', value: 2 }, { values: { capacityKwh: 2 } }).outcome).toBe('not-applicable')
    expect(evaluateApplicability({ rule: 'threshold', field: 'capacityKwh', operator: 'gte', value: 2 }, { values: { capacityKwh: 2 } }).outcome).toBe('applies')
  })

  it('sorts the synthetic manifest into applies, not applicable and unresolved for an industrial 5 kWh model in 2026', () => {
    const result = fieldsForV2(SYNTHETIC_MANIFEST, { category: 'industrial', jurisdiction: 'EU', asOf: '2026-09-06', values: { capacityKwh: 5 } })
    expect(result.applies.map((f) => f.key)).toContain('remainingCapacity')
    expect(result.notApplicable.map((f) => f.key)).toEqual(['exhaustionThreshold'])
    expect(result.unresolved.map((u) => u.field.key).sort()).toEqual(['dueDiligenceReport', 'warrantyMonths', 'warrantyRule'])
    expect(result.unresolved.find((u) => u.field.key === 'dueDiligenceReport')?.reasons[0]).toContain('primary text')
  })

  it('never counts an unresolved or deferred required field as missing, and never as satisfied', () => {
    const payload = { profile: 'synthetic', profile_version: 2, category: 'industrial', modelName: 'S1', massKg: 12, capacityKwh: 5, originCountry: 'DE', hazardousSubstanceCount: 0 }
    const gaps = missingRequiredV2(SYNTHETIC_MANIFEST, payload, { category: 'industrial', jurisdiction: 'EU', asOf: '2026-09-06', values: payload })
    expect(gaps.missing.map((f) => f.key).sort()).toEqual(['batchId', 'madeMonth', 'recycledShare', 'serial'])
    expect(gaps.deferred.map((d) => `${d.field.key}:${d.status}`).sort()).toEqual(['carbonFootprintClass:not-to-be-displayed', 'dueDiligenceReport:anticipated'])
    expect(gaps.unresolved).toEqual([])
    const battery = readManifest('battery@2')
    const legacy = missingRequired(battery, { category: 'ev' }, 'ev')
    const evaluated = missingRequiredV2(battery, { category: 'ev' }, { category: 'ev' })
    expect(evaluated.missing.map((f) => f.key)).toEqual(legacy.missing.map((f) => f.key))
    expect(evaluated.unresolved.map((u) => u.field.key)).toEqual(legacy.needsReview.map((f) => f.key))
    expect(evaluated.deferred).toEqual([])
  })
})

describe('declared inapplicability (inapplicableFields)', () => {
  const conditional = { key: 'x', applicability: { rule: 'unresolved' as const, reason: 'if applicable' } }
  const unconditional = { key: 'y', applicability: { rule: 'always' as const } }

  it('turns an unresolved field into not-applicable with the reason declared, and never switches off a field that applies', () => {
    expect(evaluateFieldApplicability(conditional, {}).outcome).toBe('unresolved')
    const declared = evaluateFieldApplicability(conditional, { declaredNotApplicable: ['x'] })
    expect(declared.outcome).toBe('not-applicable')
    expect(declared.reasons[0]).toMatch(/^declared:/)
    expect(evaluateFieldApplicability(unconditional, { declaredNotApplicable: ['y'] }).outcome).toBe('applies')
  })

  it('reads the declarations from the payload itself, ignoring malformed entries', () => {
    expect(declaredInapplicable({ inapplicableFields: [{ field: 'a', reason: 'not a cycle application' }, { field: 'b' }, { field: 'c', reason: '   ' }, 'd', null] })).toEqual(['a'])
    expect(declaredInapplicable({})).toEqual([])
    expect(declaredInapplicable(undefined)).toEqual([])
  })
})
