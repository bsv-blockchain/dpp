import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { checkSelection, compareProfiles, fieldsForV2, missingRequiredV2, readManifestAny, readPublicPayloadSchema, reviewProfileData, type ProfileManifestV2, type ProfileFieldV2 } from '../src/index.js'

const battery = readManifestAny('battery@4') as ProfileManifestV2
const textile = readManifestAny('textile@4') as ProfileManifestV2
const field = (manifest: ProfileManifestV2, key: string) => manifest.fields.find(f => f.key === key)!
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true })
addFormats(ajv)
const validateManifest = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/profile-manifest-v2.schema.json', import.meta.url), 'utf8')))
const schema = readPublicPayloadSchema('battery@4') as { properties: Record<string, object>; required: string[]; $defs: object }
const validate = ajv.compile(schema)
const fragment = (key: string, value: unknown) => ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: schema.$defs, ...schema.properties[key] })(value)

function sample(f: ProfileFieldV2): unknown {
  const one = () => {
    if (f.valueType === 'enum') return f.codeList?.options[0]?.value ?? 'example'
    if (f.valueType === 'multi') return [f.codeList?.options[0]?.value ?? 'example']
    if (['decimal', 'integer', 'percent'].includes(f.valueType)) return f.constraints?.minimum ?? 1
    if (f.valueType === 'monthYear') return '2026-09'
    if (f.valueType === 'date') return '2026-09-16'
    if (f.valueType === 'record') return Object.fromEntries((f.parts ?? []).filter(p => p.required).map(p => [p.key, p.valueType === 'country' ? 'DE' : ['decimal', 'integer', 'percent'].includes(p.valueType) ? 1 : p.key === 'cas' ? '7439-92-1' : 'example']))
    if (['document', 'url'].includes(f.valueType)) return 'https://example.org/evidence'
    return 'example'
  }
  return f.cardinality === 'many' && f.valueType !== 'multi' ? [one()] : one()
}

describe('reviewed version 4 drafts', () => {
  it.each([battery, textile])('validates $profile and accounts for each predecessor field', manifest => {
    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true)
    expect(manifest.status).toBe('draft')
    expect(checkSelection({ baseline: 'native-baseline@2', industry: manifest.profile, purpose: 'claim' }).conflicts.map(c => c.code)).toContain('industry-draft')
    const previous = readManifestAny(manifest.succession!.of)
    for (const f of previous.fields) expect(manifest.succession!.migration.filter(m => m.from === f.key)).toHaveLength(1)
  })

  it('accepts month-only manufacture evidence without inventing a day', () => {
    const payload: Record<string, unknown> = { profile: 'battery', profile_version: 4 }
    for (const key of schema.required) if (!(key in payload)) payload[key] = sample(field(battery, key))
    expect(payload).not.toHaveProperty('manufacturingDate')
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
    expect(missingRequiredV2(battery, payload, { category: 'ev' }).missing.map(f => f.key)).not.toContain('manufacturingDate')
    expect(validate({ ...payload, manufacturingMonth: '2026-13' })).toBe(false)
    expect(validate({ ...payload, profile_version: 3 })).toBe(false)
    expect(reviewProfileData('battery@4', { manufacturingMonth: '2026-09', manufacturingDate: '2026-08-31' })).toContainEqual(expect.objectContaining({ outcome: 'invalid', field: 'manufacturingDate' }))
    expect(reviewProfileData('battery@4', { manufacturingMonth: '2026-02', manufacturingDate: '2026-02-30' })[0]?.outcome).toBe('invalid')
    expect(reviewProfileData('battery@4', { manufacturingMonth: '2026-09', manufacturingDate: '2026-09-16' })).toEqual([])
  })

  it('rejects city/country-only contact and preserves alternative postal systems', () => {
    expect(fragment('manufacturerAddress', { city: 'Berlin', country: 'DE' })).toBe(false)
    expect(fragment('manufacturerAddress', { addressLine: 'PO Box 123', city: 'Dubai', country: 'AE' })).toBe(true)
  })

  it('requires independently supplied power values with conditions for EV and industrial batteries', () => {
    const power = { at20PercentSocW: 820.5, at80PercentSocW: 1200.25, referenceConditions: '25 C, test duration recorded in report', method: 'urn:example:method', evidenceRef: 'urn:example:report' }
    expect(fragment('originalPowerCapability', power)).toBe(true)
    const { at20PercentSocW: omitted, ...incomplete } = power
    expect(fragment('originalPowerCapability', incomplete)).toBe(false)
    expect(fragment('originalPowerCapability', 1200)).toBe(false)
    expect(fragment('originalPowerCapability', { ...power, at80PercentSocW: -1 })).toBe(false)
    for (const category of ['ev', 'industrial', 'stationary']) expect(missingRequiredV2(battery, {}, { category }).missing.map(f => f.key)).toContain('originalPowerCapability')
    expect(missingRequiredV2(battery, {}, { category: 'lmt' }).missing.map(f => f.key)).toContain('powerOriginal')
    expect(fieldsForV2(battery, { category: 'lmt' }).notApplicable.map(f => f.key)).toContain('originalPowerCapability')
  })

  it('keeps individual performance distinct from EV state-of-health exclusions', () => {
    const ev = fieldsForV2(battery, { category: 'ev' })
    expect(ev.notApplicable.map(f => f.key)).toEqual(expect.arrayContaining(['powerRemaining', 'resistanceCurrentOhm']))
    expect(ev.applies.map(f => f.key)).toEqual(expect.arrayContaining(['powerAtStatusChange', 'resistanceAtStatusChange']))
    expect(ev.unresolved.map(u => u.field.key)).toContain('roundTripEfficiencyAtStatusChange')
    const item = { property: 'power', value: 820.5, unit: 'W', subject: { id: 'urn:example:item', granularity: 'item' } }
    expect(reviewProfileData('battery@4', { powerAtStatusChange: [item] })[0]?.outcome).toBe('needs-review')
    expect(reviewProfileData('battery@4', { powerAtStatusChange: [{ ...item, subject: { id: 'model', granularity: 'model' } }] }).some(f => f.outcome === 'invalid')).toBe(true)
    expect(reviewProfileData('battery@4', { powerAtStatusChange: [{ ...item, unit: 'kW' }] }).some(f => f.outcome === 'invalid')).toBe(true)
    expect(reviewProfileData('battery@4', { powerAtStatusChange: [{ ...item, measuredAt: { date: '2026-09-16', precision: 'day' }, method: { id: 'urn:example:method' }, evidence: [{ property: 'power', subject: item.subject, source: { kind: 'document', id: 'urn:example:report' } }] }] })).toEqual([])
  })

  it('records enacted due-diligence dates without claiming scope or evidence are settled', () => {
    expect(field(battery, 'dueDiligenceReport').requirement).toMatchObject({ status: 'enacted', effectiveDate: '2027-08-18' })
    expect(fieldsForV2(battery, { asOf: '2027-08-17' }).notApplicable.map(f => f.key)).toContain('dueDiligenceReport')
    expect(fieldsForV2(battery, { asOf: '2027-08-18' }).unresolved.map(u => u.field.key)).toContain('dueDiligenceReport')
    expect(field(battery, 'instructionsForUse').requirement).toMatchObject({ status: 'needs-review', source: 'eu-omnibus-proposal-2025' })
  })

  it('separates textile field choices from current labelling and conditional consumer rules', () => {
    for (const key of ['name', 'category', 'modelIdentifier', 'batch', 'manufacturerContact']) expect(field(textile, key).requirement.status).toBe('anticipated')
    for (const key of ['manufacturingPlace', 'care', 'expectedLifetime', 'collection', 'chemicalCompliance']) expect(field(textile, key).requirement.status).toBe('none')
    expect(field(textile, 'componentFibres').requirement).toMatchObject({ status: 'enacted', clause: 'Article 11' })
    expect(missingRequiredV2(textile, {}, {}).unresolved.map(u => u.field.key)).toContain('componentFibres')
    expect(field(textile, 'certifications').requirement.note).toContain('public authorities')
    expect(fieldsForV2(textile, { asOf: '2026-09-26' }).notApplicable.map(f => f.key)).toContain('certifications')
    expect(fieldsForV2(textile, { asOf: '2026-09-27' }).unresolved.map(u => u.field.key)).toContain('certifications')
    expect(textile.identity.modelIdentifier).toBe('modelIdentifier')
  })

  it('reviews component shares separately instead of accepting a whole-product average', () => {
    const components = [{ component: 'shell' }, { component: 'lining' }]
    const componentFibres = [{ component: 'shell', percent: 60 }, { component: 'shell', percent: 40 }, { component: 'lining', percent: 100 }]
    expect(reviewProfileData('textile@4', { components, componentFibres })).toEqual([])
    expect(reviewProfileData('textile@4', { components, componentFibres: [{ component: 'shell', percent: 60 }, { component: 'lining', percent: 40 }] })).toHaveLength(2)
    expect(reviewProfileData('textile@4', { componentFibres: [{ component: 'unknown', percent: 100 }] })[0]?.reason).toContain('Identify component')
    expect(() => reviewProfileData('textile@3', {})).toThrow(/not implemented/)
  })
})

describe('consumer change reports', () => {
  it('reports additions, changed constraints and source metadata with frozen digests', () => {
    const report = compareProfiles('battery@3', 'battery@4')
    expect(report.from.sha256).toBe('98bae04f2b01db1cac0995dfe0849900f25072c55348249df446b9ff87dbe68e')
    expect(report.to.status).toBe('draft')
    expect(report.fields.find(f => f.key === 'manufacturerAddress')?.properties).toContain('parts')
    expect(report.fields.find(f => f.key === 'originalPowerCapability')?.kind).toBe('added')
    expect(report.fields.find(f => f.key === 'dueDiligenceReport')?.properties).toContain('applicability')
    expect(report.requiresConsumerReview).toBe(true)
    expect(report.activation).toBe('explicit-consumer-selection')
    expect(compareProfiles('textile@3', 'textile@4').profileChanges.map(c => c.property)).toContain('identity')
    expect(compareProfiles('battery@4', 'battery@3').fields.find(f => f.key === 'originalPowerCapability')?.kind).toBe('removed')
  })

  it('is deterministic, handles unchanged inputs, and refuses unrelated or unsafe selections', () => {
    expect(compareProfiles('battery@3', 'battery@4')).toEqual(compareProfiles('battery@3', 'battery@4'))
    expect(compareProfiles('battery@4', 'battery@4')).toMatchObject({ fields: [], profileChanges: [], requiresConsumerReview: false })
    expect(() => compareProfiles('../frozen', 'battery@4')).toThrow(/not a profile identifier/)
    expect(() => compareProfiles('battery@4', 'textile@4')).toThrow(/same industry/)
    expect(() => compareProfiles('battery@999', 'battery@4')).toThrow()
  })

  it('preserves the frozen version 3 manifests and all their generated artefacts', () => {
    const snapshots: Record<string, string> = {
      'manifests/battery@3.json': '98bae04f2b01db1cac0995dfe0849900f25072c55348249df446b9ff87dbe68e',
      'manifests/textile@3.json': 'db6df7376161fa334f84a2237581be6b076c20c29d873b6028381d08cbe31d66',
      'generated/payload-schema/battery@3.public.schema.json': '52690cd9b6d78805da790ddb832df21b8b7c438bc721d9306f65965e4a2bf8ac',
      'generated/payload-schema/battery@3.restricted.schema.json': 'ed6b31c40d835d6c7f082b44dace265ec49c3405354f3b94fe8d365cadcbd5dc',
      'generated/consumer/battery-v3.json': '97c9b7819dabee1ab8df44ef90b264a99a7c23ba27413c2d595a61e3408232b1',
      'generated/mapping/battery@3.md': '8d4bf09221a53c22e57b238f35697efa0e882e5efa3cff073d2d238e28c77bc7',
      'generated/payload-schema/textile@3.public.schema.json': 'f5ef5ecff10277608d896d9ad13f17188408652f58c2130fb2b98340a9f6e09e',
      'generated/payload-schema/textile@3.restricted.schema.json': '4352d7685bf93e62d9a773b5815086368ab97abe5f5d8887c1bc017ab5f1e164',
      'generated/consumer/textile-v3.json': '330898b5c4fa07e83340f724cc343ff71222dfe666487a3588a39a1f3a790ff8',
      'generated/mapping/textile@3.md': '626e136d03819f72c9f34eaca9d9c8fe7c65f3a6fe31d1cd158f2b106034bdb6',
    }
    for (const [path, digest] of Object.entries(snapshots)) expect(createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex'), path).toBe(digest)
  })
})
