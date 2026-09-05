/**
 * @bsv/dpp-profiles: the canonical industry data profiles (`spec/profiles.md`).
 *
 * The package is data first. `manifests/` holds the immutable profile
 * manifests, `schemas/` their JSON Schema, `generated/` what the deterministic
 * generator derives from them (payload schemas and consumer documents), and
 * `frozen.json` the digests a published version is held to. This module gives
 * a consumer typed access to those files and the GS1 identifier helpers a
 * writer needs; it has no runtime dependency.
 */
import { readFileSync } from 'node:fs'

export * from './identifiers.js'
export * from './mapping.js'
export * from './combinations.js'

export type ValueType = 'id' | 'text' | 'enum' | 'multi' | 'decimal' | 'integer' | 'percent' | 'monthYear' | 'date' | 'url' | 'document' | 'graphic' | 'country' | 'record' | 'any'
export type AccessTier = 'public' | 'owner' | 'legitimate' | 'authority'
export type Obligation = 'required' | 'recommended' | 'optional'
export type Granularity = 'model' | 'batch' | 'item'
export type Capture = 'form' | 'brand' | 'platform' | 'event' | 'derived' | 'deferred'

export interface Option { value: string; label: string }
export interface CodeList { closed: boolean; options: Option[] }
export interface Constraints { minimum?: number; maximum?: number; step?: number; pattern?: string; patternHint?: string; maxLength?: number }
export interface Part { key: string; label: string; valueType: 'text' | 'decimal' | 'percent' | 'integer' | 'enum' | 'country'; unit?: string; codeList?: CodeList; constraints?: Constraints; required?: boolean }
export interface ApplicabilityRule { rule: 'always' | 'category-in' | 'needs-review'; categories?: string[]; condition?: string }

export interface ProfileField {
  key: string
  pointer: string
  label: string
  semanticUri?: string
  valueType: ValueType
  unit?: string
  codeList?: CodeList
  constraints?: Constraints
  cardinality: 'one' | 'many'
  granularity: Granularity
  provenance: { capture: Capture; dynamic?: boolean; prose?: boolean; onLabel?: boolean; needsBms?: boolean; kind?: 'fact' | 'declaration' | 'calculation' | 'assessment' }
  accessTier: AccessTier
  obligation: Obligation
  legalBasis: string
  applicability: ApplicabilityRule
  sourceRefs?: Array<{ source: string; clause?: string; name?: string; property?: string }>
  awaitingAct?: string
  supersedes?: string
  group?: string
  parts?: Part[]
  note?: string
}

export interface ProfileManifest {
  manifestVersion: '1'
  id: string
  version: number
  profile: string
  kind: 'industry'
  status: 'draft' | 'current' | 'superseded'
  supersededBy?: string
  title: string
  description?: string
  regulatoryLine: string
  baseline: string
  roles: string[]
  applicability: { categories: Option[]; categoryKey?: string; jurisdictions: string[]; statements: Array<{ text: string; status: 'enacted' | 'anticipated' | 'needs-review'; source?: string; effectiveDate?: string }> }
  schemaDialect: 'https://json-schema.org/draft/2020-12/schema'
  schemaUri: string
  schemaDigest: string
  restrictedSchemaUri: string
  restrictedSchemaDigest: string
  contextRefs: Array<{ id: string; name: string; version: string; repository?: string; licence?: string; retrieved?: string; urnPattern?: string; use: string }>
  extends: string | null
  stamps: Array<{ key: string; description: string; valueType: 'text' | 'id' | 'integer' | 'enum'; const?: string | number; codeList?: CodeList; pattern?: string }>
  fields: ProfileField[]
  eventMappings: Array<{ nativeOperation: string; eventType: string; externalEvent: string; requires: string; withoutEvidence: 'insufficient-data' | 'unsupported' | 'transformed' }>
  accessPolicyRef: string
  accessTiers: Array<{ id: AccessTier; description: string; storage: 'on-chain public payload' | 'off-chain encrypted' }>
  sourceRefs: Array<{ id: string; name: string; reference?: string; version?: string; licence?: string; licensedText?: boolean; use: string; fields?: string[] }>
  groups?: Array<{ id: string; title: string; blurb?: string }>
  identity: { passportIdentifier: string; granularities: Granularity[]; itemIdentifier?: string; modelIdentifier?: string; batchIdentifier?: string; parentRelations: Array<{ child: 'item' | 'batch'; parent: 'model' | 'batch' }> }
}

/** The profiles this package publishes, current and superseded, in the order the index lists them. */
export const PROFILE_IDS = ['battery@2', 'textile@2', 'general@2', 'textile@1', 'general@1'] as const
export type ProfileId = (typeof PROFILE_IDS)[number]

const packageRoot = new URL('../', import.meta.url)

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, packageRoot), 'utf8')) as T
}

/** The immutable manifest of one published profile. */
export function readManifest(profile: ProfileId): ProfileManifest {
  return readJson<ProfileManifest>(`manifests/${profile}.json`)
}

/** The generated JSON Schema (2020-12) for the profile's public payload. */
export function readPublicPayloadSchema(profile: ProfileId): Record<string, unknown> {
  return readJson(`generated/payload-schema/${profile}.public.schema.json`)
}

/** The generated JSON Schema (2020-12) for the profile's restricted tiers. */
export function readRestrictedPayloadSchema(profile: ProfileId): Record<string, unknown> {
  return readJson(`generated/payload-schema/${profile}.restricted.schema.json`)
}

/** The generated consumer document in the legacy registry and application shape. */
export function readConsumerDocument(profile: ProfileId): Record<string, unknown> {
  return readJson(`generated/consumer/${profile.replace('@', '-v')}.json`)
}

/** Exchange profiles this package catalogues (spec/exchange.md section 2). */
export const EXCHANGE_PROFILE_IDS = ['untp-0.7.0-jose@1', 'vsc-draft-compat@0.1.0'] as const
export type ExchangeProfileId = (typeof EXCHANGE_PROFILE_IDS)[number]

/** Operator profiles this package catalogues (spec/services.md, spec/conformance.md section 4). */
export const OPERATOR_PROFILE_IDS = ['single-operator@1', 'federated-operators@1'] as const
export type OperatorProfileId = (typeof OPERATOR_PROFILE_IDS)[number]

/** The manifest of one exchange profile: representation, artefacts with their retrieval state, proof suites, anchoring, mappings. */
export function readExchangeProfile(profile: ExchangeProfileId): Record<string, unknown> {
  return readJson(`manifests/exchange/${profile}.json`)
}

/** The manifest of one operator profile: admission, publisher policy, discovery, synchronisation, retention and acceptance exercises. */
export function readOperatorProfile(profile: OperatorProfileId): Record<string, unknown> {
  return readJson(`manifests/operator/${profile}.json`)
}

/** The frozen digests every published manifest and generated file is held to. */
export function readFrozen(): { frozenAt: string; manifests: Record<string, string>; generated: Record<string, string> } {
  return readJson('frozen.json')
}

/**
 * The fields of a manifest that apply to one product category, the rule
 * `spec/profiles.md` §3 sets: `always` applies, `category-in` applies to the
 * named categories, and `needs-review` is returned separately because no code
 * can decide it. The caller shows the review list rather than treating it as
 * satisfied or as universally required.
 */
export function fieldsFor(manifest: ProfileManifest, category?: string): { applies: ProfileField[]; needsReview: ProfileField[]; notApplicable: ProfileField[] } {
  const applies: ProfileField[] = []
  const needsReview: ProfileField[] = []
  const notApplicable: ProfileField[] = []
  for (const field of manifest.fields) {
    const rule = field.applicability
    const inCategory = rule.categories == null || category == null || rule.categories.includes(category)
    if (!inCategory) notApplicable.push(field)
    else if (rule.rule === 'needs-review') needsReview.push(field)
    else applies.push(field)
  }
  return { applies, needsReview, notApplicable }
}

/**
 * Which required fields a public payload is missing, under the same three-way
 * rule: a field under review is listed separately and never blocks. Values are
 * read at the field's pointer; a value counts as present when it is not
 * undefined, null, an empty string or an empty array.
 */
export function missingRequired(manifest: ProfileManifest, payload: Record<string, unknown>, category?: string): { missing: ProfileField[]; needsReview: ProfileField[] } {
  const { applies, needsReview } = fieldsFor(manifest, category)
  const present = (field: ProfileField): boolean => {
    const value = payload[field.key]
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }
  return {
    missing: applies.filter((f) => f.obligation === 'required' && ['form', 'brand', 'platform'].includes(f.provenance.capture) && !present(f)),
    needsReview: needsReview.filter((f) => f.obligation === 'required' && !present(f)),
  }
}
