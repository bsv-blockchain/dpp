/**
 * Deterministic passport projections (`spec/passport-projections.md` §4,
 * `contracts/passport-projection.schema.json`): from pinned source revisions,
 * accepted relationships, a named policy, a cutoff and an audience, derive
 * the value of every field the profile declares, with the source each value
 * came from and a separate result for its availability, its applicability and
 * any conflict. Pure: no storage, no network, no clock. The same inputs in
 * any arrival order produce the same `projectionDigest`, which is SHA-256 of
 * the RFC 8785 canonical JSON of the commitment body; the identity is derived
 * from that digest and is never a secured-source digest.
 *
 * The precedence rules this file implements, numbered as the specification
 * numbers them: (1) only field locations and granularities the profile
 * declares are read, so a model specification never stands in for an item
 * measurement; (2) the pinned revisions are read, never whichever revision is
 * newest; (3) a batch or item value overrides the model's only where the
 * field and the policy declare it, otherwise the two are a conflict with both
 * sources named; (4) a dynamic measurement is matched on subject, property,
 * method and unit exactly and selected by observation time under the policy,
 * with a tie a conflict, so arrival order is never authority; (5) invalid,
 * revoked and correction-unresolved evidence is excluded and listed; (6) zero
 * and false are values, and availability, applicability and findings are
 * separate axes; (7) traversal is bounded, and a cycle, a missing source or an
 * exceeded limit is a finding, never a silent omission.
 */
import { createHash } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { AccessTier, Granularity, ProfileField } from './index.js'
import { isFieldV2, isManifestV2, type AnyProfileField, type AnyProfileManifest } from './manifest-v2.js'
import { categoryOf, declaredInapplicable, evaluateFieldApplicability, type ApplicabilityContext, type ApplicabilityOutcome } from './applicability.js'
import { selectLanguage, type LanguageSelection, type LocalisedValue, type MeasurementConversion } from './evidence-shapes.js'

export const PROJECTION_VERSION = '1' as const
export const PROJECTION_ID_PREFIX = 'urn:bsv:dpp:projection:sha256:'
export const DEFAULT_PROJECTION_LIMITS = { maxDepth: 8, maxRefs: 100 } as const

export type ProjectionGranularity = 'model' | 'batch' | 'item' | 'component'
export type DisclosureScope = 'public' | 'owner' | 'legitimate' | 'authority'
export type RelationshipKind = 'instance-of-model' | 'member-of-batch' | 'component-of' | 'successor-of'

/** A source revision as the caller resolved it: exact identity, the payload it carried and the digest of its retained bytes. */
export interface ResolvedSource {
  recordId: string
  revisionId: string
  subject: { id: string; granularity: ProjectionGranularity }
  profileRef: { id: string; version: number }
  payload: Record<string, unknown>
  digest: string
  recordedAt: string
  effective?: { from?: string; until?: string }
  disclosure: { policyId?: string; scope: DisclosureScope }
  authorisation: { kind: string; policyId: string; principal?: string; evidenceRef?: string }
}

export interface ProjectionRelationship {
  relationshipId: string
  kind: RelationshipKind
  source: { id: string; granularity: ProjectionGranularity }
  target: { id: string; granularity: ProjectionGranularity }
  evidence: { sourceRevision?: { recordId: string; revisionId: string }; credentialRef?: { id: string; digest?: string }; eventRef?: { importId: string; eventRef: string } }
  effective?: { from?: string; until?: string }
  policyRef: string
}

export type MeasurementStatus = 'accepted' | 'invalid' | 'revoked' | 'unresolved-correction'

/** A dynamic observation of one property of one subject, with the exact scope a projection matches on. */
export interface ProjectionMeasurement {
  property: string
  subject: { id: string; granularity: ProjectionGranularity }
  value: number | string | boolean
  unit: string
  method: string
  observedAt: string
  effectiveAt?: string
  source: { recordId: string; revisionId: string }
  status?: MeasurementStatus
}

export interface ProjectionPolicy {
  id: string
  /** The field keys a batch or item source may override the model's value for. */
  precedence: { batchOverrides: string[]; itemOverrides: string[] }
  measurementSelection: 'latest-observed' | 'latest-effective'
  tie: 'conflict'
}

export interface ProjectionInput {
  passportId: string
  subject: { id: string; granularity: 'model' | 'batch' | 'item' }
  profile: AnyProfileManifest
  sources: ResolvedSource[]
  relationships: ProjectionRelationship[]
  measurements?: ProjectionMeasurement[]
  policy: ProjectionPolicy
  /** The historical cutoff: sources recorded and measurements observed after it are excluded. Absent means no cutoff, recorded as null. */
  asOf?: string
  disclosureScope: DisclosureScope
  locale?: { exact?: string; base?: string; default: string }
  jurisdiction?: string
  /** Overrides the category read from the sources' payload, when the caller knows it independently. */
  category?: string
  validationRefs?: string[]
  limits?: { maxDepth?: number; maxRefs?: number }
}

export type FieldAvailability = 'present' | 'missing' | 'unknown' | 'withheld'
export type FieldFinding = 'conflict' | 'unsupported' | 'limit' | 'cycle' | 'missing-source'

export interface ProjectedValue {
  value: unknown
  source: { recordId: string; revisionId: string; pointer: string }
  granularity: ProjectionGranularity
  language?: string
  selection?: LanguageSelection
  conversion?: MeasurementConversion
  observedAt?: string
  method?: string
}

export interface FieldResult {
  availability: FieldAvailability
  applicability: ApplicabilityOutcome
  finding?: FieldFinding
  conflicts?: Array<{ recordId: string; revisionId: string; value: unknown }>
  reason?: string
  excluded?: Array<{ recordId: string; revisionId: string; reason: string }>
}

export interface ProjectionFinding { code: string; field?: string; detail: string }

export interface PassportProjection {
  projectionId: string
  projectionVersion: typeof PROJECTION_VERSION
  projectionDigest: string
  passportId: string
  subjectId: string
  granularity: 'model' | 'batch' | 'item'
  profileRef: { id: string; version: number }
  sourceRefs: Array<{ recordId: string; revisionId: string; digest: string; subjectId: string; granularity: ProjectionGranularity }>
  relationshipRefs: Array<{ relationshipId: string; kind: RelationshipKind; sourceId: string; targetId: string; policyRef: string }>
  policyRef: string
  asOf: string | null
  disclosureScope: DisclosureScope
  values: Record<string, ProjectedValue>
  fieldResults: Record<string, FieldResult>
  evidenceRefs: string[]
  validationRefs: string[]
  diagnostics?: { truncated: boolean; limits: Record<string, number>; findings: ProjectionFinding[] }
  template?: string
}

export interface ProjectionOutput {
  projection: PassportProjection
  /** `ok` is complete: no source was missing, no limit or cycle was hit and no record had competing revisions. Conflicts between sources are field results, not validation failures. */
  validation: { ok: boolean; findings: ProjectionFinding[] }
}

const GRANULARITY_ORDER: Record<ProjectionGranularity, number> = { model: 0, batch: 1, item: 2, component: 3 }
const AUDIENCE: Record<DisclosureScope, readonly AccessTier[]> = {
  public: ['public'],
  owner: ['public', 'owner'],
  legitimate: ['public', 'legitimate'],
  authority: ['public', 'legitimate', 'authority'],
}
const COMPLETENESS_FINDINGS = new Set(['limit', 'cycle', 'missing-source', 'duplicate-revision', 'profile-mismatch'])

/** SHA-256 of the RFC 8785 canonical JSON of an inline payload. A retained source's digest is over its exact retained bytes; this is the digest of a payload carried inline. */
export function payloadDigest(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  const text = canonicalize(value)
  if (text == null) throw new Error('the value has no canonical JSON form')
  return text
}

/** Refuse a non-finite number anywhere in a value: it has no canonical form and no meaning as a fact. */
function assertFinite(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is not a finite number`)
    return
  }
  if (Array.isArray(value)) { value.forEach((v, i) => assertFinite(v, `${path}[${i}]`)); return }
  if (value != null && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertFinite(v, `${path}.${k}`)
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const instant = (value: string): number => {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) throw new Error(`${value} is not a date or instant`)
  return t
}

function hasValue(payload: Record<string, unknown>, key: string): boolean {
  const v = payload[key]
  return v !== undefined && v !== null && v !== ''
}

/** The commitment body: every committed property, none of the derived or diagnostic ones (`spec/passport-projections.md` §4). */
export function projectionCommitmentBody(projection: PassportProjection): Record<string, unknown> {
  return {
    projectionVersion: projection.projectionVersion,
    passportId: projection.passportId,
    subjectId: projection.subjectId,
    granularity: projection.granularity,
    profileRef: projection.profileRef,
    sourceRefs: projection.sourceRefs,
    relationshipRefs: projection.relationshipRefs,
    policyRef: projection.policyRef,
    asOf: projection.asOf,
    disclosureScope: projection.disclosureScope,
    values: projection.values,
    fieldResults: projection.fieldResults,
    evidenceRefs: projection.evidenceRefs,
    validationRefs: projection.validationRefs,
  }
}

/** The canonical bytes of the commitment body, as a UTF-8 string. */
export function projectionCommitment(projection: PassportProjection): string {
  return canonicalJson(projectionCommitmentBody(projection))
}

export function projectionDigest(projection: PassportProjection): string {
  return createHash('sha256').update(projectionCommitment(projection), 'utf8').digest('hex')
}

/** Whether a projection's recorded identity and digest are the ones its committed body yields. */
export function verifyProjectionCommitment(projection: PassportProjection): { digestValid: boolean; idValid: boolean } {
  const digest = projectionDigest(projection)
  return { digestValid: digest === projection.projectionDigest, idValid: projection.projectionId === `${PROJECTION_ID_PREFIX}${projection.projectionDigest}` }
}

interface Node { id: string; granularity: ProjectionGranularity; depth: number }

/**
 * Derive one passport's projection. Throws only for a caller error: a
 * non-finite number in a payload or a measurement, or a date that is not one.
 * Every other difficulty is a finding in the output.
 */
export function projectPassport(input: ProjectionInput): ProjectionOutput {
  const limits = { maxDepth: input.limits?.maxDepth ?? DEFAULT_PROJECTION_LIMITS.maxDepth, maxRefs: input.limits?.maxRefs ?? DEFAULT_PROJECTION_LIMITS.maxRefs }
  const findings: ProjectionFinding[] = []
  const finding = (code: string, detail: string, field?: string): void => { findings.push({ code, ...(field == null ? {} : { field }), detail }) }
  const asOf = input.asOf ?? null
  const cutoff = asOf == null ? undefined : instant(asOf)

  // The inputs in a canonical order, so nothing below depends on arrival order.
  const sources = [...input.sources].sort((a, b) => compare(a.recordId, b.recordId) || compare(a.revisionId, b.revisionId))
  const relationships = [...input.relationships].sort((a, b) => compare(a.relationshipId, b.relationshipId))
  const measurements = [...(input.measurements ?? [])].sort((a, b) => compare(a.source.recordId, b.source.recordId) || compare(a.source.revisionId, b.source.revisionId) || compare(a.property, b.property) || compare(a.observedAt, b.observedAt))
  for (const s of sources) assertFinite(s.payload, `source ${s.recordId}@${s.revisionId} payload`)
  for (const m of measurements) assertFinite(m.value, `measurement ${m.property} of ${m.subject.id}`)

  // (7) Bounded traversal of the subject graph: item to batch to model, with components and successors recorded and not entered.
  const visited = new Map<string, Node>()
  const followed: ProjectionRelationship[] = []
  let refs = 0
  let truncated = false
  const queue: Array<Node & { path: string[] }> = [{ id: input.subject.id, granularity: input.subject.granularity, depth: 0, path: [input.subject.id] }]
  while (queue.length > 0 && !truncated) {
    const node = queue.shift() as Node & { path: string[] }
    if (visited.has(node.id)) continue
    visited.set(node.id, { id: node.id, granularity: node.granularity, depth: node.depth })
    for (const rel of relationships) {
      const outward = rel.source.id === node.id && (rel.kind === 'instance-of-model' || rel.kind === 'member-of-batch' || rel.kind === 'successor-of')
      const inward = rel.target.id === node.id && rel.kind === 'component-of'
      if (!outward && !inward) continue
      refs += 1
      if (refs > limits.maxRefs) { truncated = true; finding('limit', `more than ${limits.maxRefs} source and relationship references; the projection is partial`); break }
      followed.push(rel)
      if (!outward || rel.kind === 'successor-of') continue
      if (node.path.includes(rel.target.id)) { finding('cycle', `relationship ${rel.relationshipId} returns to ${rel.target.id}, which is already on the path ${node.path.join(' > ')}`); continue }
      if (node.depth + 1 > limits.maxDepth) { finding('limit', `relationship ${rel.relationshipId} would exceed depth ${limits.maxDepth}; ${rel.target.id} was not resolved`); truncated = true; continue }
      queue.push({ id: rel.target.id, granularity: rel.target.granularity, depth: node.depth + 1, path: [...node.path, rel.target.id] })
    }
  }

  // (2) The pinned revisions of every visited subject, under the selected profile and cutoff; a record supplied at two revisions is used only when a relationship pins one.
  const pinned = new Map<string, string>()
  for (const rel of followed) if (rel.evidence.sourceRevision != null) pinned.set(rel.evidence.sourceRevision.recordId, rel.evidence.sourceRevision.revisionId)
  const byRecord = new Map<string, ResolvedSource[]>()
  for (const s of sources) {
    if (!visited.has(s.subject.id)) continue
    if (cutoff != null && instant(s.recordedAt) > cutoff) { finding('after-cutoff', `source ${s.recordId}@${s.revisionId} was recorded at ${s.recordedAt}, after the cutoff ${asOf}`); continue }
    if (s.profileRef.id !== input.profile.id || s.profileRef.version !== input.profile.version) { finding('profile-mismatch', `source ${s.recordId}@${s.revisionId} is under ${s.profileRef.id}@${s.profileRef.version}, not ${input.profile.id}@${input.profile.version}, and is not read`); continue }
    byRecord.set(s.recordId, [...(byRecord.get(s.recordId) ?? []), s])
  }
  const used: ResolvedSource[] = []
  for (const [recordId, revisions] of byRecord) {
    if (revisions.length === 1) { used.push(revisions[0] as ResolvedSource); continue }
    const chosen = pinned.get(recordId)
    const match = chosen == null ? undefined : revisions.find((r) => r.revisionId === chosen)
    if (match == null) { finding('duplicate-revision', `record ${recordId} was supplied at revisions ${revisions.map((r) => r.revisionId).join(', ')} and no relationship pins one; none is read`); continue }
    used.push(match)
  }
  refs += used.length
  if (refs > limits.maxRefs && !truncated) { truncated = true; finding('limit', `more than ${limits.maxRefs} source and relationship references; the projection is partial`) }
  const byGranularity = new Map<ProjectionGranularity, ResolvedSource[]>()
  for (const s of used) byGranularity.set(s.subject.granularity, [...(byGranularity.get(s.subject.granularity) ?? []), s])
  for (const node of visited.values()) {
    if (node.granularity === 'component') continue
    if (!used.some((s) => s.subject.id === node.id)) finding('missing-source', `no source revision was supplied for ${node.granularity} ${node.id}`)
  }

  // The applicability context: the category from the model's payload unless the caller names it, public values only.
  const manifest = input.profile
  const stampKeys = new Set(manifest.stamps.map((s) => s.key))
  const fields = manifest.fields as AnyProfileField[]
  const publicKeys = new Set(fields.filter((f) => f.accessTier === 'public').map((f) => f.key))
  const publicValues: Record<string, unknown> = {}
  for (const g of ['model', 'batch', 'item'] as const) for (const s of byGranularity.get(g) ?? []) for (const [k, v] of Object.entries(s.payload)) if (publicKeys.has(k)) publicValues[k] = v
  const modelSource = (byGranularity.get('model') ?? [])[0]
  const ctx: ApplicabilityContext = {
    ...(input.category != null ? { category: input.category } : categoryOf(manifest, modelSource?.payload ?? publicValues) == null ? {} : { category: categoryOf(manifest, modelSource?.payload ?? publicValues) as string }),
    ...(input.jurisdiction == null ? {} : { jurisdiction: input.jurisdiction }),
    ...(asOf == null ? {} : { asOf }),
    values: publicValues,
    declaredNotApplicable: declaredInapplicable(publicValues),
  }
  const allowedTiers = AUDIENCE[input.disclosureScope]
  const requested = GRANULARITY_ORDER[input.subject.granularity]

  const values: Record<string, ProjectedValue> = {}
  const fieldResults: Record<string, FieldResult> = {}
  const evidence = new Set<string>()

  for (const field of fields) {
    if (stampKeys.has(field.key)) continue
    const applicability = evaluateFieldApplicability(field, ctx)
    const result: FieldResult = { availability: 'missing', applicability: applicability.outcome }
    const reasons: string[] = applicability.outcome === 'unresolved' ? [...applicability.reasons] : []
    const finish = (): void => {
      if (reasons.length > 0) result.reason = reasons.join('; ')
      fieldResults[field.key] = result
    }
    if (!allowedTiers.includes(field.accessTier)) {
      result.availability = 'withheld'
      reasons.unshift(`the ${field.accessTier} tier is outside the ${input.disclosureScope} audience`)
      finish(); continue
    }
    const fieldGranularity: Granularity = field.granularity
    if (GRANULARITY_ORDER[fieldGranularity] > requested) {
      reasons.unshift(`the field describes a ${fieldGranularity} and the subject is a ${input.subject.granularity}`)
      finish(); continue
    }
    const dynamic = field.provenance.dynamic === true || field.valueType === 'measurement'
    if (dynamic) {
      projectMeasurement(field, fieldGranularity, result, reasons, values, evidence, measurements, visited, byGranularity, input.policy, cutoff, truncated)
      finish(); continue
    }
    // (1) and (3): the field's own granularity first, then declared overrides only.
    const own = (byGranularity.get(fieldGranularity) ?? []).filter((s) => hasValue(s.payload, field.key))
    const reachable = [...visited.values()].some((n) => n.granularity === fieldGranularity)
    const hasSource = (byGranularity.get(fieldGranularity) ?? []).length > 0
    let chosen: ResolvedSource | undefined
    const conflicts: Array<{ recordId: string; revisionId: string; value: unknown }> = []
    if (own.length > 1) {
      for (const s of own) conflicts.push({ recordId: s.recordId, revisionId: s.revisionId, value: s.payload[field.key] })
    } else if (own.length === 1) {
      chosen = own[0]
    }
    for (const g of ['batch', 'item'] as const) {
      if (GRANULARITY_ORDER[g] <= GRANULARITY_ORDER[fieldGranularity] || GRANULARITY_ORDER[g] > requested) continue
      const carriers = (byGranularity.get(g) ?? []).filter((s) => hasValue(s.payload, field.key))
      if (carriers.length === 0) continue
      const declared = isFieldV2(field) ? field.overridable?.at === g : true
      const allowed = declared && (g === 'batch' ? input.policy.precedence.batchOverrides : input.policy.precedence.itemOverrides).includes(field.key)
      if (allowed && carriers.length === 1) { chosen = carriers[0]; conflicts.length = 0; continue }
      if (chosen != null) conflicts.push({ recordId: chosen.recordId, revisionId: chosen.revisionId, value: chosen.payload[field.key] })
      for (const s of carriers) conflicts.push({ recordId: s.recordId, revisionId: s.revisionId, value: s.payload[field.key] })
      chosen = undefined
      if (!allowed && own.length === 0 && carriers.length === 1) {
        // A value carried at a finer granularity than the field declares, with no declared override: not a conflict, but not a permitted location either.
        conflicts.length = 0
        result.finding = 'unsupported'
        reasons.unshift(`the value is carried by ${g} ${carriers[0]?.subject.id} for a ${fieldGranularity} field without a declared override`)
      } else {
        result.finding = 'conflict'
        reasons.unshift(`${g} ${carriers.map((s) => s.subject.id).join(', ')} carries a value the ${fieldGranularity} does not delegate for ${field.key}`)
      }
    }
    if (result.finding === 'conflict' || conflicts.length > 0) {
      result.availability = 'present'
      result.finding = 'conflict'
      result.conflicts = conflicts
      if (!reasons.some((r) => r.includes('carries a value'))) reasons.unshift(`${conflicts.length} sources carry different authority for ${field.key}`)
      finish(); continue
    }
    if (result.finding === 'unsupported') { finish(); continue }
    if (chosen == null) {
      if (!reachable || !hasSource) {
        result.availability = 'unknown'
        result.finding = truncated && !reachable ? 'limit' : 'missing-source'
        reasons.unshift(!reachable ? `no ${fieldGranularity} is related to ${input.subject.id}` : `no source revision was supplied for the ${fieldGranularity}`)
      } else {
        const coarser = (['model', 'batch'] as const).filter((g) => GRANULARITY_ORDER[g] < GRANULARITY_ORDER[fieldGranularity]).find((g) => (byGranularity.get(g) ?? []).some((s) => hasValue(s.payload, field.key)))
        if (coarser != null) reasons.unshift(`${coarser}-only information: the ${coarser} carries ${field.key} and a ${fieldGranularity} value is not fabricated from it`)
      }
      finish(); continue
    }
    const raw = chosen.payload[field.key]
    const projected = interpretValue(field, raw, chosen, input.locale)
    if ('reason' in projected) {
      result.availability = 'present'
      result.finding = 'unsupported'
      reasons.unshift(projected.reason)
      finish(); continue
    }
    result.availability = 'present'
    values[field.key] = projected.value
    finish()
  }

  const sourceRefs = used.map((s) => ({ recordId: s.recordId, revisionId: s.revisionId, digest: s.digest, subjectId: s.subject.id, granularity: s.subject.granularity }))
    .sort((a, b) => compare(a.recordId, b.recordId) || compare(a.revisionId, b.revisionId))
  const relationshipRefs = followed.map((r) => ({ relationshipId: r.relationshipId, kind: r.kind, sourceId: r.source.id, targetId: r.target.id, policyRef: r.policyRef }))
    .sort((a, b) => compare(a.relationshipId, b.relationshipId))
  for (const r of followed) if (r.evidence.credentialRef != null) evidence.add(`credential:${r.evidence.credentialRef.id}`)
  for (const s of used) if (s.authorisation.evidenceRef != null) evidence.add(`authorisation:${s.authorisation.evidenceRef}`)

  const projection: PassportProjection = {
    projectionId: '',
    projectionVersion: PROJECTION_VERSION,
    projectionDigest: '',
    passportId: input.passportId,
    subjectId: input.subject.id,
    granularity: input.subject.granularity,
    profileRef: { id: manifest.id, version: manifest.version },
    sourceRefs,
    relationshipRefs,
    policyRef: input.policy.id,
    asOf,
    disclosureScope: input.disclosureScope,
    values: Object.fromEntries(Object.entries(values).sort(([a], [b]) => compare(a, b))),
    fieldResults: Object.fromEntries(Object.entries(fieldResults).sort(([a], [b]) => compare(a, b))),
    evidenceRefs: [...evidence].sort(compare),
    validationRefs: [...(input.validationRefs ?? [])].sort(compare),
    diagnostics: { truncated, limits: { maxDepth: limits.maxDepth, maxRefs: limits.maxRefs, refsUsed: Math.min(refs, limits.maxRefs + 1) }, findings },
  }
  projection.projectionDigest = projectionDigest(projection)
  projection.projectionId = `${PROJECTION_ID_PREFIX}${projection.projectionDigest}`
  const ok = !findings.some((f) => COMPLETENESS_FINDINGS.has(f.code))
  return { projection, validation: { ok, findings } }
}

/** (4) and (5): the one accepted measurement of a dynamic field, or the reason there is none. */
function projectMeasurement(
  field: AnyProfileField, granularity: Granularity, result: FieldResult, reasons: string[], values: Record<string, ProjectedValue>, evidence: Set<string>,
  measurements: ProjectionMeasurement[], visited: Map<string, Node>, byGranularity: Map<ProjectionGranularity, ResolvedSource[]>, policy: ProjectionPolicy, cutoff: number | undefined, truncated: boolean,
): void {
  const subjects = [...visited.values()].filter((n) => n.granularity === granularity).map((n) => n.id)
  if (subjects.length === 0) {
    result.availability = 'unknown'
    result.finding = truncated ? 'limit' : 'missing-source'
    reasons.unshift(`no ${granularity} is related to the subject, so no ${field.key} observation can be attributed`)
    return
  }
  const scoped = measurements.filter((m) => subjects.includes(m.subject.id) && m.subject.granularity === granularity && m.property === field.key && (field.unit == null || m.unit === field.unit))
  const excluded: FieldResult['excluded'] = []
  const accepted: ProjectionMeasurement[] = []
  for (const m of scoped) {
    if (cutoff != null && instant(m.observedAt) > cutoff) { excluded.push({ ...m.source, reason: `observed at ${m.observedAt}, after the cutoff` }); continue }
    const status = m.status ?? 'accepted'
    if (status !== 'accepted') { excluded.push({ ...m.source, reason: `${status} evidence is not read` }); continue }
    if (m.method == null || m.method === '') { excluded.push({ ...m.source, reason: 'no method is named' }); continue }
    accepted.push(m)
  }
  if (excluded.length > 0) result.excluded = excluded
  const wrongUnit = measurements.filter((m) => subjects.includes(m.subject.id) && m.property === field.key && field.unit != null && m.unit !== field.unit)
  if (accepted.length === 0) {
    result.availability = 'missing'
    const modelCarries = (byGranularity.get('model') ?? []).some((s) => hasValue(s.payload, field.key))
    reasons.unshift(wrongUnit.length > 0 ? `${wrongUnit.length} observation(s) of ${field.key} are in another unit than ${field.unit}` : modelCarries ? `model-only information: the model declares ${field.key} and no accepted ${granularity} observation exists` : `no accepted ${granularity} observation of ${field.key}`)
    return
  }
  const methods = [...new Set(accepted.map((m) => m.method))].sort(compare)
  if (methods.length > 1) {
    result.availability = 'present'
    result.finding = 'conflict'
    result.conflicts = accepted.map((m) => ({ ...m.source, value: m.value }))
    reasons.unshift(`observations under different methods (${methods.join(', ')}) are not compared`)
    return
  }
  const key = (m: ProjectionMeasurement): number => instant(policy.measurementSelection === 'latest-effective' ? m.effectiveAt ?? m.observedAt : m.observedAt)
  const ordered = [...accepted].sort((a, b) => key(b) - key(a) || compare(a.source.recordId, b.source.recordId) || compare(a.source.revisionId, b.source.revisionId))
  const top = ordered[0] as ProjectionMeasurement
  const ties = ordered.filter((m) => key(m) === key(top))
  if (ties.some((m) => JSON.stringify(m.value) !== JSON.stringify(top.value))) {
    result.availability = 'present'
    result.finding = 'conflict'
    result.conflicts = ties.map((m) => ({ ...m.source, value: m.value }))
    reasons.unshift(`${ties.length} observations at ${top.observedAt} disagree and the policy resolves a tie as a conflict`)
    return
  }
  result.availability = 'present'
  values[field.key] = { value: top.value, source: { recordId: top.source.recordId, revisionId: top.source.revisionId, pointer: `/${field.key}` }, granularity, observedAt: top.observedAt, method: top.method }
  evidence.add(`source-revision:${top.source.recordId}@${top.source.revisionId}`)
}

/** A payload value read under the field's type: language selection for a localised text, an explicit basis for a percent, and the value as it is otherwise. */
function interpretValue(field: AnyProfileField, raw: unknown, source: ResolvedSource, locale: ProjectionInput['locale']): { value: ProjectedValue } | { reason: string } {
  const base = { source: { recordId: source.recordId, revisionId: source.revisionId, pointer: field.pointer }, granularity: source.subject.granularity }
  const isRecord = raw != null && typeof raw === 'object' && !Array.isArray(raw)
  if (field.valueType === 'localisedText' || (isRecord && Array.isArray((raw as { values?: unknown }).values) && (raw as { values: unknown[] }).values.every((v) => v != null && typeof v === 'object' && 'language' in (v as object) && 'text' in (v as object)))) {
    const candidates = (raw as { values: LocalisedValue[] }).values
    if (locale == null) return { value: { ...base, value: raw } }
    const selected = selectLanguage(candidates, locale)
    if (selected == null) return { reason: `no value of ${field.key} in ${locale.exact ?? locale.base ?? locale.default} or its base language or the default ${locale.default}` }
    return { value: { ...base, value: selected.text, language: selected.language, selection: selected.selection } }
  }
  if (field.valueType === 'percent' && isRecord) {
    const record = raw as { value?: unknown; basis?: unknown; unit?: unknown }
    if (typeof record.value !== 'number') return { reason: `${field.key} carries no numeric value` }
    if (record.basis === 'percent') return { value: { ...base, value: record.value } }
    if (record.basis === 'fraction') return { value: { ...base, value: record.value * 100, conversion: { fromUnit: typeof record.unit === 'string' ? record.unit : 'fraction', toUnit: '%', rule: 'fraction to percent: multiplied by 100', explicit: true } } }
    return { reason: `${field.key} carries the basis ${String(record.basis)}, which is not read as a percent` }
  }
  return { value: { ...base, value: raw } }
}
