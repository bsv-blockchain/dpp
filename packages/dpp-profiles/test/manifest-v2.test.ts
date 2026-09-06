import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { consumerDocument, mappingTable, payloadSchema, readManifests } from '../scripts/build.mjs'
import { isManifestV2, readManifestAny, type ProfileManifestV2 } from '../src/index.js'
import { SYNTHETIC_MANIFEST } from './projection-fixture.js'

const root = join(import.meta.dirname, '..')
const read = (relative: string): object => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateV1 = ajv.compile(read('schemas/profile-manifest.schema.json'))
const validateV2 = ajv.compile(read('schemas/profile-manifest-v2.schema.json'))

describe('manifest version 2 (schemas/profile-manifest-v2.schema.json)', () => {
  it('accepts the synthetic fixture, refuses it without a requirement status, and is not what version 1 accepts', () => {
    expect(validateV2(SYNTHETIC_MANIFEST), JSON.stringify(validateV2.errors)).toBe(true)
    expect(validateV1(SYNTHETIC_MANIFEST)).toBe(false)
    const stripped = structuredClone(SYNTHETIC_MANIFEST) as ProfileManifestV2
    delete (stripped.fields[0] as Partial<ProfileManifestV2['fields'][number]>).requirement
    expect(validateV2(stripped)).toBe(false)
    const badRule = structuredClone(SYNTHETIC_MANIFEST) as ProfileManifestV2
    badRule.fields[0]!.applicability = { rule: 'effective' } as ProfileManifestV2['fields'][number]['applicability']
    expect(validateV2(badRule)).toBe(false)
  })

  it('still validates every published version 1 manifest once its fields carry a requirement status', () => {
    for (const manifest of readManifests() as Array<{ manifestVersion: string; fields: Array<Record<string, unknown>> }>) {
      if (manifest.manifestVersion !== '1') continue
      const lifted = structuredClone(manifest)
      lifted.manifestVersion = '2'
      for (const f of lifted.fields) f.requirement = { status: 'needs-review', source: 'not yet crosswalked' }
      expect(validateV2(lifted), JSON.stringify(validateV2.errors)).toBe(true)
    }
  })

  it('generates a standalone payload schema: shapes embedded, month precision patterned, deferred requirements never required', () => {
    const schema = payloadSchema(SYNTHETIC_MANIFEST, 'public') as { $defs: Record<string, unknown>; properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining(['measurement', 'certification', 'claimEvidence', 'localisedText', 'relatedDocument', 'preciseDate']))
    expect(schema.properties.certification).toMatchObject({ type: 'array', items: { $ref: '#/$defs/certification' } })
    expect(schema.properties.madeMonth).toMatchObject({ type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
    expect(schema.required).not.toContain('carbonFootprintClass')
    expect(schema.required).not.toContain('dueDiligenceReport')
    expect(schema.required).toContain('massKg')
    const validate = ajv.compile(schema)
    const payload = { profile: 'synthetic', profile_version: 2, category: 'industrial', modelName: 'S1', batchId: 'L', serial: 'S', massKg: 12, capacityKwh: 5, originCountry: 'DE', madeMonth: '2026-02', recycledShare: 25, hazardousSubstanceCount: 0, secondLife: false, cyclesUsed: 0, certification: [{ scheme: { id: 's', name: 'S' }, certificateId: 'c', issuer: 'i', subject: { id: 'x', granularity: 'model' }, verification: { status: 'not-checked' } }], colour: { values: [{ language: 'en', text: 'Blue' }] } }
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
    expect(validate({ ...payload, madeMonth: '2026-02-01' })).toBe(false)
    expect(validate({ ...payload, certification: [{ scheme: { id: 's', name: 'S' } }] })).toBe(false)
    const restricted = payloadSchema(SYNTHETIC_MANIFEST, 'restricted') as { properties: Record<string, unknown>; $defs?: unknown }
    expect(restricted.properties.purchaseDate).toMatchObject({ type: 'string', format: 'date' })
    expect(restricted.$defs).toBeUndefined()
  })

  it('generates a consumer document that carries the version 2 keys and a candidate-successor status', () => {
    const doc = consumerDocument(SYNTHETIC_MANIFEST, readManifests()) as { status: string; manifestVersion: string; succession: { of: string }; fields: Array<Record<string, unknown>> }
    expect(doc.status).toBe('candidate successor to synthetic@1: opt-in by explicit version until the reviewed cutover')
    expect(doc.manifestVersion).toBe('2')
    expect(doc.succession.of).toBe('synthetic@1')
    const made = doc.fields.find((f) => f.key === 'madeMonth')
    expect(made).toMatchObject({ type: 'date', precision: 'month', requirement: { status: 'enacted' } })
    const origin = doc.fields.find((f) => f.key === 'originCountry')
    expect(origin).toMatchObject({ overridable: { at: 'batch', policy: 'origin-per-batch@1' } })
    const exhaustion = doc.fields.find((f) => f.key === 'exhaustionThreshold')
    expect(exhaustion?.applicabilityRule).toMatchObject({ rule: 'all' })
    expect(exhaustion?.conditional).toBeUndefined()
    const composition = doc.fields.find((f) => f.key === 'componentComposition')
    expect(composition).toMatchObject({ scope: 'component', componentScoped: true, repeat: true })
    const table = mappingTable(SYNTHETIC_MANIFEST)
    expect(table).toContain('| Requirement status |')
    expect(table).toContain('not-to-be-displayed: synthetic-guidance row 18 from 2027-02-18')
    expect(table).toContain('rule {"rule":"all"')
  })

  it('reads a published manifest by either version and refuses a name that is not a profile', () => {
    const battery = readManifestAny('battery@2')
    expect(battery.manifestVersion).toBe('1')
    expect(isManifestV2(battery)).toBe(false)
    expect(isManifestV2(SYNTHETIC_MANIFEST)).toBe(true)
    expect(() => readManifestAny('../frozen')).toThrow(/not a profile identifier/)
  })
})
