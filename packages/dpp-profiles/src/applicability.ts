/**
 * The declarative applicability evaluator (`spec/profiles.md` §3,
 * `spec/passport-projections.md` §6). A rule is data, never an expression:
 * category membership, jurisdiction, an effective interval, a numeric
 * threshold on a payload value, `all` and `any` over those, `needs-review`
 * for what only a person can decide, and `unresolved` for what the primary
 * source could not establish. Three outcomes and never a fourth: a field
 * applies, does not apply, or is unresolved. Unresolved is not satisfied and
 * is not a failure either; it is shown, and it never becomes a pass.
 */
import type { ApplicabilityRule, ProfileManifest, ProfileField } from './index.js'
import { isFieldV2, type AnyProfileField, type AnyProfileManifest, type ApplicabilityRuleV2 } from './manifest-v2.js'

export type ApplicabilityOutcome = 'applies' | 'not-applicable' | 'unresolved'

export interface ApplicabilityContext {
  /** The product category, as the manifest's `applicability.categoryKey` payload value names it. */
  category?: string
  /** The jurisdiction the passport is evaluated for, for example `EU`. */
  jurisdiction?: string
  /** The date or instant the evaluation is made at, for `effective` rules. */
  asOf?: string
  /** Payload values a `threshold` rule may read, as numbers or as `{ value, unit }`. */
  values?: Record<string, unknown>
  /**
   * The field keys the record declares inapplicable under `inapplicableFields`
   * (`spec/profiles.md` §3): a declaration by the declaring party, with a
   * reason, that a conditional data point does not apply to this record. It
   * turns an unresolved field into not-applicable with the reason `declared`;
   * it never makes a required, enacted, unconditionally applicable field
   * optional, because a declaration is not a value.
   */
  declaredNotApplicable?: string[]
}

export interface ApplicabilityResult { outcome: ApplicabilityOutcome; reasons: string[] }

const applies = (reasons: string[] = []): ApplicabilityResult => ({ outcome: 'applies', reasons })
const notApplicable = (reason: string): ApplicabilityResult => ({ outcome: 'not-applicable', reasons: [reason] })
const unresolved = (reason: string): ApplicabilityResult => ({ outcome: 'unresolved', reasons: [reason] })

/** The calendar day of a date or instant, as `YYYY-MM-DD`, for a lexicographic comparison that needs no clock. */
function dayOf(value: string): string | undefined {
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : /^\d{4}$/.test(value) ? `${value}-01-01` : undefined
}

function thresholdValue(raw: unknown, unit: string | undefined): { value: number } | { reason: string } {
  if (raw == null) return { reason: 'not supplied' }
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { reason: 'not a finite number' }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as { value?: unknown; unit?: unknown }
    if (typeof record.value !== 'number' || !Number.isFinite(record.value)) return { reason: 'carries no finite numeric value' }
    if (unit != null && record.unit !== unit) return { reason: `is in ${String(record.unit)}, not the rule's ${unit}` }
    return { value: record.value }
  }
  return { reason: 'is not numeric' }
}

export function evaluateApplicability(rule: ApplicabilityRule | ApplicabilityRuleV2, ctx: ApplicabilityContext = {}): ApplicabilityResult {
  switch (rule.rule) {
    case 'always':
      return applies()
    case 'category-in': {
      const categories = rule.categories ?? []
      if (ctx.category == null) return applies(['no category supplied; a category-in rule is read as applying, as fieldsFor reads it'])
      return categories.includes(ctx.category) ? applies() : notApplicable(`category ${ctx.category} is not one of ${categories.join(', ')}`)
    }
    case 'needs-review': {
      const categories = rule.categories
      if (categories != null && ctx.category != null && !categories.includes(ctx.category)) return notApplicable(`category ${ctx.category} is outside the categories the review concerns`)
      return unresolved(`needs review: ${rule.condition ?? 'the condition is not stated'}`)
    }
    case 'all': {
      const results = rule.rules.map((r) => evaluateApplicability(r, ctx))
      const no = results.filter((r) => r.outcome === 'not-applicable')
      if (no.length > 0) return { outcome: 'not-applicable', reasons: no.flatMap((r) => r.reasons) }
      const open = results.filter((r) => r.outcome === 'unresolved')
      if (open.length > 0) return { outcome: 'unresolved', reasons: open.flatMap((r) => r.reasons) }
      return applies(results.flatMap((r) => r.reasons))
    }
    case 'any': {
      const results = rule.rules.map((r) => evaluateApplicability(r, ctx))
      const yes = results.find((r) => r.outcome === 'applies')
      if (yes != null) return applies(yes.reasons)
      const open = results.filter((r) => r.outcome === 'unresolved')
      if (open.length > 0) return { outcome: 'unresolved', reasons: open.flatMap((r) => r.reasons) }
      return { outcome: 'not-applicable', reasons: results.flatMap((r) => r.reasons) }
    }
    case 'jurisdiction-in':
      if (ctx.jurisdiction == null) return unresolved('no jurisdiction supplied')
      return rule.jurisdictions.includes(ctx.jurisdiction) ? applies() : notApplicable(`jurisdiction ${ctx.jurisdiction} is not one of ${rule.jurisdictions.join(', ')}`)
    case 'effective': {
      if (ctx.asOf == null) return unresolved('no evaluation date supplied for an effective-date rule')
      const day = dayOf(ctx.asOf)
      if (day == null) return unresolved(`the evaluation date ${ctx.asOf} is not a date`)
      if (rule.from != null && day < rule.from) return notApplicable(`not effective until ${rule.from}`)
      if (rule.until != null && day > rule.until) return notApplicable(`no longer effective after ${rule.until}`)
      return applies()
    }
    case 'threshold': {
      const read = thresholdValue(ctx.values?.[rule.field], rule.unit)
      if ('reason' in read) return unresolved(`${rule.field} ${read.reason}, so the threshold cannot be decided`)
      const v = read.value
      const holds = rule.operator === 'gt' ? v > rule.value : rule.operator === 'gte' ? v >= rule.value : rule.operator === 'lt' ? v < rule.value : rule.operator === 'lte' ? v <= rule.value : v === rule.value
      return holds ? applies() : notApplicable(`${rule.field} ${v}${rule.unit == null ? '' : ` ${rule.unit}`} is not ${rule.operator} ${rule.value}`)
    }
    case 'unresolved':
      return unresolved(`${rule.reason}${rule.source == null ? '' : ` (${rule.source})`}`)
    default:
      return unresolved(`rule ${String((rule as { rule: unknown }).rule)} is not one this evaluator implements`)
  }
}

/** The key under which a record declares fields inapplicable, and the shape of each declaration. */
export const INAPPLICABLE_FIELDS_KEY = 'inapplicableFields'
export interface InapplicabilityDeclaration { field: string; reason: string; declaredBy?: string }

/** The declarations a payload carries under `inapplicableFields`, as field keys; malformed entries are ignored, never read as a declaration. */
export function declaredInapplicable(payload: Record<string, unknown> | undefined): string[] {
  const raw = payload?.[INAPPLICABLE_FIELDS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((d): d is InapplicabilityDeclaration => d != null && typeof d === 'object' && typeof (d as InapplicabilityDeclaration).field === 'string' && typeof (d as InapplicabilityDeclaration).reason === 'string' && (d as InapplicabilityDeclaration).reason.trim() !== '').map((d) => d.field)
}

/**
 * A field's applicability under a context: a declaration under
 * `inapplicableFields` answers not-applicable with the reason `declared`
 * only where the rule would otherwise be unresolved or conditional, so a
 * declaration cannot switch off a field that applies unconditionally; the
 * rule answers otherwise.
 */
export function evaluateFieldApplicability(field: Pick<AnyProfileField, 'key' | 'applicability'>, ctx: ApplicabilityContext = {}): ApplicabilityResult {
  const result = evaluateApplicability(field.applicability, ctx)
  if (result.outcome !== 'unresolved' || !(ctx.declaredNotApplicable ?? []).includes(field.key)) return result
  return { outcome: 'not-applicable', reasons: ['declared: the record declares the field inapplicable under inapplicableFields'] }
}

export interface FieldsForResult<F extends AnyProfileField> {
  applies: F[]
  notApplicable: F[]
  unresolved: Array<{ field: F; reasons: string[] }>
}

/**
 * The fields of a version 1 or version 2 manifest under a context: what
 * applies, what does not, and what is unresolved with its reasons. The
 * version 1 `fieldsFor` remains the reader for version 1 manifests with a
 * bare category; this one takes the whole context.
 */
export function fieldsForV2<M extends AnyProfileManifest>(manifest: M, ctx: ApplicabilityContext = {}): FieldsForResult<M['fields'][number]> {
  type F = M['fields'][number]
  const result: FieldsForResult<F> = { applies: [], notApplicable: [], unresolved: [] }
  for (const field of manifest.fields as F[]) {
    const r = evaluateFieldApplicability(field, ctx)
    if (r.outcome === 'applies') result.applies.push(field)
    else if (r.outcome === 'not-applicable') result.notApplicable.push(field)
    else result.unresolved.push({ field, reasons: r.reasons })
  }
  return result
}

const CAPTURED_AT_REGISTRATION: ReadonlyArray<ProfileField['provenance']['capture']> = ['form', 'brand', 'platform']

function present(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key]
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

export interface MissingRequiredV2Result<F extends AnyProfileField> {
  /** Required, applicable, captured at registration, and absent: this blocks. */
  missing: F[]
  /** Required and absent, but whether it applies is unresolved: shown, never blocking, never satisfied. */
  unresolved: Array<{ field: F; reasons: string[] }>
  /** Required in the profile's own terms but whose requirement status defers it: anticipated, not to be displayed, or under review. Never counted as missing. */
  deferred: Array<{ field: F; status: string }>
}

/**
 * Which required fields a payload lacks under a context, on three separate
 * lists. A field whose applicability is unresolved is never missing and never
 * satisfied; a field whose requirement status is anticipated, not to be
 * displayed or under review is deferred and never blocks, so an adopter can
 * keep incomplete draft data without a false failure or a false pass. A
 * field the payload declares inapplicable under `inapplicableFields` is
 * not-applicable where it would otherwise be unresolved.
 */
export function missingRequiredV2<M extends AnyProfileManifest>(manifest: M, payload: Record<string, unknown>, ctx: ApplicabilityContext = {}): MissingRequiredV2Result<M['fields'][number]> {
  type F = M['fields'][number]
  const result: MissingRequiredV2Result<F> = { missing: [], unresolved: [], deferred: [] }
  // The payload's own declarations, unless the caller supplied the list.
  const effective: ApplicabilityContext = ctx.declaredNotApplicable == null ? { ...ctx, declaredNotApplicable: declaredInapplicable(payload) } : ctx
  for (const field of manifest.fields as F[]) {
    if (field.obligation !== 'required' || present(payload, field.key)) continue
    if (isFieldV2(field) && ['anticipated', 'not-to-be-displayed', 'needs-review'].includes(field.requirement.status)) {
      result.deferred.push({ field, status: field.requirement.status })
      continue
    }
    const r = evaluateFieldApplicability(field, effective)
    if (r.outcome === 'not-applicable') continue
    if (r.outcome === 'unresolved') { result.unresolved.push({ field, reasons: r.reasons }); continue }
    if (CAPTURED_AT_REGISTRATION.includes(field.provenance.capture)) result.missing.push(field)
  }
  return result
}

/** The category value a payload names for a manifest, read at the manifest's declared category key. */
export function categoryOf(manifest: Pick<ProfileManifest, 'applicability'>, payload: Record<string, unknown> | undefined): string | undefined {
  const key = manifest.applicability.categoryKey
  if (key == null || payload == null) return undefined
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}
