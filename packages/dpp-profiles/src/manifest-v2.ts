/**
 * Manifest version 2 (`schemas/profile-manifest-v2.schema.json`,
 * `spec/passport-projections.md` §6): everything version 1 declares, plus a
 * requirement status per field, a composable applicability rule that can say
 * `unresolved`, date precision, subject scope, override declarations, the
 * shared evidence value types and a succession record. A version 1 manifest
 * is read as it always was; `readManifestAny` returns whichever version a
 * published manifest declares, and a reader branches on `manifestVersion`.
 */
import { readFileSync } from 'node:fs'
import type { Granularity, ProfileField, ProfileManifest, ValueType } from './index.js'
import type { DatePrecision } from './evidence-shapes.js'

/** The applicability rule of a version 2 field. `always`, `category-in` and `needs-review` keep their version 1 meaning. */
export type ApplicabilityRuleV2 =
  | { rule: 'always' }
  | { rule: 'category-in'; categories: string[] }
  | { rule: 'needs-review'; condition: string; categories?: string[] }
  | { rule: 'all' | 'any'; rules: ApplicabilityRuleV2[] }
  | { rule: 'jurisdiction-in'; jurisdictions: string[] }
  | { rule: 'effective'; from?: string; until?: string }
  | { rule: 'threshold'; field: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number; unit?: string }
  | { rule: 'unresolved'; reason: string; source?: string }

export type ValueTypeV2 = ValueType | 'measurement' | 'certification' | 'claimEvidence' | 'localisedText' | 'relatedDocument' | 'warrantyTerms'

/**
 * What asks for a field's value and how settled that is; separate from the
 * profile's own `obligation` and from the instrument `legalBasis` names.
 * `not-to-be-displayed` is a positive statement from guidance that the value
 * is not to be filled or shown as of the effective date; a consumer never
 * shows such a field as required.
 */
export interface RequirementStatus {
  /** `none`: no instrument or guidance asks for the value; the obligation is the profile's own. */
  status: 'enacted' | 'guidance' | 'anticipated' | 'needs-review' | 'not-to-be-displayed' | 'none'
  source: string
  clause?: string
  effectiveDate?: string
  note?: string
}

export interface ProfileFieldV2 extends Omit<ProfileField, 'valueType' | 'applicability'> {
  valueType: ValueTypeV2
  applicability: ApplicabilityRuleV2
  requirement: RequirementStatus
  precision?: DatePrecision
  scope?: Granularity | 'component'
  componentScoped?: boolean
  /** A batch or item source may carry a value that takes precedence over the model's, under the named policy. Absent means a conflict, never an override. */
  overridable?: { at: 'batch' | 'item'; policy: string }
}

export type MigrationOutcome = 'unchanged' | 'renamed' | 'retyped' | 'split' | 'new' | 'withdrawn' | 'relabelled'

export interface ProfileManifestV2 extends Omit<ProfileManifest, 'manifestVersion' | 'fields'> {
  manifestVersion: '2'
  fields: ProfileFieldV2[]
  succession?: { of: string; migration: Array<{ from: string; to?: string; outcome: MigrationOutcome; note: string }> }
}

export type AnyProfileManifest = ProfileManifest | ProfileManifestV2
export type AnyProfileField = ProfileField | ProfileFieldV2

export function isManifestV2(manifest: AnyProfileManifest): manifest is ProfileManifestV2 {
  return manifest.manifestVersion === '2'
}

export function isFieldV2(field: AnyProfileField): field is ProfileFieldV2 {
  return (field as ProfileFieldV2).requirement != null
}

const packageRoot = new URL('../', import.meta.url)

/**
 * The manifest of any published profile, version 1 or 2, by its `id@version`.
 * The identifier is checked against the manifest grammar before it names a
 * file, so nothing outside `manifests/` can be read through it.
 */
export function readManifestAny(profile: string): AnyProfileManifest {
  if (!/^[a-z][a-z0-9-]*@[0-9]+$/.test(profile)) throw new Error(`${profile} is not a profile identifier of the form id@version`)
  const manifest = JSON.parse(readFileSync(new URL(`manifests/${profile}.json`, packageRoot), 'utf8')) as AnyProfileManifest
  if (manifest.manifestVersion !== '1' && manifest.manifestVersion !== '2') throw new Error(`${profile} declares manifest version ${String((manifest as { manifestVersion: unknown }).manifestVersion)}, which this reader does not implement`)
  return manifest
}
