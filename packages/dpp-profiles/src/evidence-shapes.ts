/**
 * The shared evidence, measurement, document, language and date shapes
 * (`contracts/profile-evidence.schema.json`, `spec/passport-projections.md`
 * §5), with the few pure helpers a projection and a profile validator need:
 * which precision a date carries, which language of a text to return, when a
 * warranty expiry can be derived from evidence and when it cannot, and which
 * unit conversions are explicit enough to make. None of these guesses. A
 * month is never given a day, a fraction is never read as a percent without
 * its basis saying so, and a missing start date yields no expiry.
 */

export type DatePrecision = 'day' | 'month' | 'year'
export interface PreciseDate { date: string; precision: DatePrecision }
export type EvidenceGranularity = 'model' | 'batch' | 'item' | 'component'
export type AccessScope = 'public' | 'owner' | 'legitimate' | 'authority'

export interface SubjectRef { id: string; granularity: EvidenceGranularity; componentRef?: string }
export interface SourceRef { kind: 'source-revision' | 'credential' | 'document'; id: string; revisionId?: string; digest?: string }
export interface RelevantTime { at?: string; from?: string; until?: string; precision: DatePrecision }

export interface ClaimEvidence {
  property: string
  subject: SubjectRef
  source: SourceRef
  reporter?: string
  issuer?: string
  relevantTime?: RelevantTime
  reportRef?: string
}

export interface RelatedDocument {
  ref: string
  purpose: string
  url?: string
  mediaType?: string
  language?: string
  revision?: string
  date?: string
  precision?: DatePrecision
  digest?: string
  byteLength?: number
  retained: boolean
  access: AccessScope
}

export interface Certification {
  scheme: { id: string; name: string; version?: string }
  certificateId: string
  issuer: string
  subject: SubjectRef
  validFrom?: string
  validUntil?: string
  precision?: DatePrecision
  documentRef?: RelatedDocument
  credentialRef?: { id: string; digest?: string }
  verification: { status: 'verified' | 'failed' | 'unknown' | 'not-checked'; checkedAt?: string; reportRef?: string }
}

export type MeasurementBasis = 'fraction' | 'percent' | 'mass' | 'count' | 'per-functional-unit'

export interface MeasurementConversion { fromUnit: string; toUnit: string; rule: string; explicit: true }

export interface Measurement {
  property: string
  value: number | string
  unit: string
  basis?: MeasurementBasis
  functionalUnit?: string
  denominator?: { value: number; unit: string }
  method?: { id: string; version?: string }
  boundary?: string
  conditions?: string
  measuredAt?: PreciseDate
  effective?: { from?: string; until?: string }
  subject: SubjectRef
  evidence?: ClaimEvidence[]
  conversion?: MeasurementConversion
}

export interface LocalisedValue { language: string; text: string }
export type LanguageSelection = 'exact' | 'base' | 'default'
export interface LocalisedText { values: LocalisedValue[]; returnedLanguage?: string; selection?: LanguageSelection }

export interface WarrantyTerms { duration: { value: number; unit: 'months' | 'years' }; calendarRule: 'purchase-date' | 'manufacture-date' | 'first-use'; conditions?: string }
export interface WarrantyStart { date: string; precision: DatePrecision; evidenceRef: string }
export interface WarrantyExpiry { start: WarrantyStart; terms: WarrantyTerms; derived: { date: string; precision: DatePrecision; rule: string } }

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const YEAR = /^\d{4}$/

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The precision a date string carries, or undefined when it is not a real
 * calendar date at any of the three precisions. `2026-02-30` is undefined,
 * not a February day rounded to something.
 */
export function datePrecisionOf(text: string): DatePrecision | undefined {
  if (YEAR.test(text)) return 'year'
  if (MONTH.test(text)) return 'month'
  const day = DAY.exec(text)
  if (day == null) return undefined
  const [, y, m, d] = day
  return Number(d) <= daysInMonth(Number(y), Number(m)) ? 'day' : undefined
}

/** The primary language subtag of a BCP 47 tag, lower-cased: `de` of `de-CH`. */
export function baseLanguage(tag: string): string {
  return tag.split('-')[0]!.toLowerCase()
}

/**
 * Which of a text's languages to return: the exact tag the reader asked for,
 * then any value in the reader's base language (or the base of the exact
 * tag), then the declared default. The selection is recorded so a surface
 * can say which it got; a value is never rewritten into another language.
 * Undefined when none of the three matches, which a caller reports rather
 * than papering over with the first value.
 */
export function selectLanguage(values: readonly LocalisedValue[], locale: { exact?: string; base?: string; default: string }): { text: string; language: string; selection: LanguageSelection } | undefined {
  const lower = (tag: string): string => tag.toLowerCase()
  if (locale.exact != null) {
    const exact = values.find((v) => lower(v.language) === lower(locale.exact as string))
    if (exact != null) return { text: exact.text, language: exact.language, selection: 'exact' }
  }
  const base = locale.base != null ? baseLanguage(locale.base) : locale.exact != null ? baseLanguage(locale.exact) : undefined
  if (base != null) {
    const match = values.find((v) => baseLanguage(v.language) === base)
    if (match != null) return { text: match.text, language: match.language, selection: 'base' }
  }
  const fallback = values.find((v) => lower(v.language) === lower(locale.default)) ?? values.find((v) => baseLanguage(v.language) === baseLanguage(locale.default))
  if (fallback != null) return { text: fallback.text, language: fallback.language, selection: 'default' }
  return undefined
}

/**
 * A warranty expiry from an evidenced start and the model's terms, at the
 * precision the start permits: a day start yields a day (month ends clamped,
 * so 31 January plus one month is 28 or 29 February), a month start yields a
 * month, a year start yields a year and only for whole years. No start, a
 * start whose text does not match its precision, or a duration a year cannot
 * place, yields a reason and no date. Terms alone never yield an expiry.
 */
export function deriveWarrantyExpiry(start: WarrantyStart | undefined, terms: WarrantyTerms): { expiry: WarrantyExpiry } | { reason: string } {
  if (start == null) return { reason: `no evidenced ${terms.calendarRule} start; the model's terms alone give no expiry` }
  if (datePrecisionOf(start.date) !== start.precision) return { reason: `the start ${start.date} is not a ${start.precision}-precision date` }
  if (!Number.isInteger(terms.duration.value) || terms.duration.value < 1) return { reason: 'the warranty duration is not a positive whole number' }
  const months = terms.duration.unit === 'years' ? terms.duration.value * 12 : terms.duration.value
  const label = `${terms.calendarRule} plus ${terms.duration.value} ${terms.duration.unit}`
  if (start.precision === 'year') {
    if (months % 12 !== 0) return { reason: `a year-precision start cannot place ${months} months in a year; the expiry stays underived` }
    return { expiry: { start, terms, derived: { date: String(Number(start.date) + months / 12), precision: 'year', rule: `${label}, year precision` } } }
  }
  const [y, m, d] = start.date.split('-').map(Number) as [number, number, number | undefined]
  const total = (y * 12 + (m - 1)) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const mm = String(month).padStart(2, '0')
  if (start.precision === 'month') {
    return { expiry: { start, terms, derived: { date: `${year}-${mm}`, precision: 'month', rule: `${label}, month precision; no day is invented` } } }
  }
  const day = Math.min(d as number, daysInMonth(year, month))
  return { expiry: { start, terms, derived: { date: `${year}-${mm}-${String(day).padStart(2, '0')}`, precision: 'day', rule: `${label}, day precision, month end clamped` } } }
}

/**
 * The one conversion explicit enough to make without a method: a fraction
 * whose basis says it is a fraction, to a percent. Everything else is
 * refused with the reason, because a bare number does not say whether 0.5
 * is a half or half a percent, and a mass-balance share is not a physical
 * share. A converted measurement keeps its source unit in `conversion`.
 */
export function convertMeasurement(measurement: Measurement, target: { unit: string; basis?: MeasurementBasis }): { measurement: Measurement } | { reason: string } {
  if (typeof measurement.value !== 'number') return { reason: 'a textual value cannot be converted' }
  if (measurement.unit === target.unit && (target.basis == null || measurement.basis === target.basis)) return { measurement }
  if (measurement.basis === 'fraction' && target.basis === 'percent') {
    return {
      measurement: {
        ...measurement,
        value: measurement.value * 100,
        unit: target.unit,
        basis: 'percent',
        conversion: { fromUnit: measurement.unit, toUnit: target.unit, rule: 'fraction to percent: multiplied by 100', explicit: true },
      },
    }
  }
  if (measurement.basis == null) return { reason: `no basis is declared for ${measurement.property}, so ${measurement.unit} cannot be read as ${target.unit}` }
  return { reason: `no explicit conversion from ${measurement.basis} in ${measurement.unit} to ${target.basis ?? 'an undeclared basis'} in ${target.unit}` }
}
