import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { convertMeasurement, datePrecisionOf, deriveWarrantyExpiry, selectLanguage, type Measurement, type WarrantyTerms } from '../src/index.js'

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const shapes = JSON.parse(readFileSync(new URL('../../../contracts/profile-evidence.schema.json', import.meta.url), 'utf8')) as { $defs: Record<string, unknown> }
ajv.addSchema(shapes, 'shapes')
const validate = (def: string, value: unknown): boolean => ajv.validate({ $ref: `shapes#/$defs/${def}` }, value) as boolean

describe('the shared evidence shapes (contracts/profile-evidence.schema.json)', () => {
  it('keeps a date at the precision it was supplied and refuses an impossible one', () => {
    expect(datePrecisionOf('2026')).toBe('year')
    expect(datePrecisionOf('2026-02')).toBe('month')
    expect(datePrecisionOf('2026-02-28')).toBe('day')
    expect(datePrecisionOf('2026-02-30')).toBeUndefined()
    expect(datePrecisionOf('2026-13')).toBeUndefined()
    expect(datePrecisionOf('26-02')).toBeUndefined()
    expect(validate('preciseDate', { date: '2026-02', precision: 'month' })).toBe(true)
    expect(validate('preciseDate', { date: '2026-02-01', precision: 'month' })).toBe(false)
    expect(validate('preciseDate', { date: '2026', precision: 'day' })).toBe(false)
  })

  it('derives a warranty expiry only from an evidenced start, at the start\'s precision', () => {
    const terms: WarrantyTerms = { duration: { value: 24, unit: 'months' }, calendarRule: 'purchase-date' }
    const day = deriveWarrantyExpiry({ date: '2026-03-15', precision: 'day', evidenceRef: 'purchase:1' }, terms)
    expect(day).toMatchObject({ expiry: { derived: { date: '2028-03-15', precision: 'day' } } })
    const clamped = deriveWarrantyExpiry({ date: '2027-01-31', precision: 'day', evidenceRef: 'purchase:2' }, { duration: { value: 1, unit: 'months' }, calendarRule: 'purchase-date' })
    expect(clamped).toMatchObject({ expiry: { derived: { date: '2027-02-28', precision: 'day' } } })
    const month = deriveWarrantyExpiry({ date: '2026-02', precision: 'month', evidenceRef: 'batch:made' }, { duration: { value: 2, unit: 'years' }, calendarRule: 'manufacture-date' })
    expect(month).toMatchObject({ expiry: { derived: { date: '2028-02', precision: 'month' } } })
    expect(JSON.stringify(month)).not.toContain('2028-02-01')
    const year = deriveWarrantyExpiry({ date: '2026', precision: 'year', evidenceRef: 'x' }, { duration: { value: 3, unit: 'years' }, calendarRule: 'manufacture-date' })
    expect(year).toMatchObject({ expiry: { derived: { date: '2029', precision: 'year' } } })
    expect(deriveWarrantyExpiry({ date: '2026', precision: 'year', evidenceRef: 'x' }, { duration: { value: 18, unit: 'months' }, calendarRule: 'manufacture-date' })).toMatchObject({ reason: expect.stringContaining('year-precision start') })
    expect(deriveWarrantyExpiry(undefined, terms)).toEqual({ reason: "no evidenced purchase-date start; the model's terms alone give no expiry" })
    expect(deriveWarrantyExpiry({ date: '2026-03', precision: 'day', evidenceRef: 'x' }, terms)).toMatchObject({ reason: expect.stringContaining('not a day-precision date') })
    if ('expiry' in day) expect(validate('warrantyExpiry', day.expiry)).toBe(true)
  })

  it('selects a language exactly, then by base, then by the declared default, and reports none otherwise', () => {
    const values = [{ language: 'de', text: 'Blau' }, { language: 'en', text: 'Blue' }, { language: 'en-GB', text: 'Blue (GB)' }]
    expect(selectLanguage(values, { exact: 'en-GB', default: 'de' })).toEqual({ text: 'Blue (GB)', language: 'en-GB', selection: 'exact' })
    expect(selectLanguage(values, { exact: 'en-us', default: 'de' })).toEqual({ text: 'Blue', language: 'en', selection: 'base' })
    expect(selectLanguage(values, { base: 'en', default: 'de' })).toEqual({ text: 'Blue', language: 'en', selection: 'base' })
    expect(selectLanguage(values, { exact: 'fr', default: 'de' })).toEqual({ text: 'Blau', language: 'de', selection: 'default' })
    expect(selectLanguage(values, { exact: 'fr', default: 'de-CH' })).toEqual({ text: 'Blau', language: 'de', selection: 'default' })
    expect(selectLanguage(values, { exact: 'fr', default: 'it' })).toBeUndefined()
    expect(validate('localisedText', { values, returnedLanguage: 'en', selection: 'base' })).toBe(true)
    expect(validate('localisedText', { values: [] })).toBe(false)
  })

  it('converts a fraction to a percent only with the basis stated, and refuses anything else by name', () => {
    const fraction: Measurement = { property: 'recycledShare', value: 0.25, unit: 'kg/kg', basis: 'fraction', subject: { id: 'urn:example:model', granularity: 'model' } }
    const converted = convertMeasurement(fraction, { unit: '%', basis: 'percent' })
    expect(converted).toMatchObject({ measurement: { value: 25, unit: '%', basis: 'percent', conversion: { fromUnit: 'kg/kg', toUnit: '%', explicit: true } } })
    if ('measurement' in converted) expect(validate('measurement', converted.measurement)).toBe(true)
    expect(convertMeasurement({ ...fraction, basis: undefined }, { unit: '%', basis: 'percent' })).toMatchObject({ reason: expect.stringContaining('no basis') })
    expect(convertMeasurement({ ...fraction, basis: 'mass', unit: 'kg' }, { unit: '%', basis: 'percent' })).toMatchObject({ reason: expect.stringContaining('no explicit conversion') })
    expect(convertMeasurement({ ...fraction, value: 'about a quarter' }, { unit: '%', basis: 'percent' })).toMatchObject({ reason: expect.stringContaining('textual') })
    expect(convertMeasurement({ ...fraction, unit: '%', basis: 'percent', value: 25 }, { unit: '%', basis: 'percent' })).toEqual({ measurement: { ...fraction, unit: '%', basis: 'percent', value: 25 } })
  })

  it('validates the shapes and refuses the ones that claim what they cannot', () => {
    expect(validate('measurement', { property: 'x', value: 'mass balance 40', unit: 'kg', subject: { id: 'a', granularity: 'item' } })).toBe(false)
    expect(validate('measurement', { property: 'x', value: 'mass balance 40', unit: 'kg', basis: 'mass', subject: { id: 'a', granularity: 'item' } })).toBe(true)
    expect(validate('measurement', { property: 'x', value: 0, unit: 'kg', subject: { id: 'a', granularity: 'item' } })).toBe(true)
    expect(validate('relatedDocument', { ref: 'd', purpose: 'p', retained: true, access: 'public' })).toBe(false)
    expect(validate('relatedDocument', { ref: 'd', purpose: 'p', retained: true, access: 'public', digest: 'ab'.repeat(32), byteLength: 10 })).toBe(true)
    expect(validate('relatedDocument', { ref: 'd', purpose: 'p', retained: false, access: 'public', url: 'https://example.org/d' })).toBe(true)
    const certification = { scheme: { id: 'urn:example:scheme', name: 'Example scheme' }, certificateId: 'C-1', issuer: 'Example body', subject: { id: 'urn:example:component:cell', granularity: 'component', componentRef: 'cell-7' }, validUntil: '2025-12-31', precision: 'day', verification: { status: 'unknown' } }
    expect(validate('certification', certification)).toBe(true)
    expect(validate('certification', { ...certification, verification: { status: 'valid' } })).toBe(false)
    expect(validate('claimEvidence', { property: '/massKg', subject: { id: 'a', granularity: 'model' }, source: { kind: 'source-revision', id: 'rec-1', revisionId: 'r2' }, relevantTime: { at: '2026-02', precision: 'month' } })).toBe(true)
    expect(validate('claimEvidence', { property: 'massKg', subject: { id: 'a', granularity: 'model' }, source: { kind: 'source-revision', id: 'rec-1' } })).toBe(false)
  })
})
