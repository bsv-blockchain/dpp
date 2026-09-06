/**
 * The projection scenario every projection test and the published vector
 * file are built from: one synthetic model under the demonstration prefix
 * 952 in two revisions, one batch that overrides one field by declaration
 * and another without, two items, out-of-order and tied measurements, a
 * restricted purchase date, a month-precision manufacture date, a fraction
 * beside a percent, a zero and a false, a text in three languages, and the
 * relationships between them. Nothing here describes a product that exists.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { ProfileManifestV2, ProjectionInput, ProjectionMeasurement, ProjectionPolicy, ProjectionRelationship, ResolvedSource } from '../src/index.js'

export const SYNTHETIC_MANIFEST = JSON.parse(readFileSync(new URL('./fixtures/synthetic-v2-manifest.json', import.meta.url), 'utf8')) as ProfileManifestV2

export const GTIN = '09521000000010'
export const MODEL_ID = `https://id.example.org/01/${GTIN}`
export const BATCH_ID = `https://id.example.org/01/${GTIN}/10/LOT-2026-02`
export const ITEM_1 = `https://id.example.org/01/${GTIN}/10/LOT-2026-02/21/SYN-0001`
export const ITEM_2 = `https://id.example.org/01/${GTIN}/10/LOT-2026-02/21/SYN-0002`

const digest = (payload: unknown): string => createHash('sha256').update(canonicalize(payload) as string, 'utf8').digest('hex')

export function source(recordId: string, revisionId: string, subject: ResolvedSource['subject'], recordedAt: string, payload: Record<string, unknown>, scope: ResolvedSource['disclosure']['scope'] = 'public'): ResolvedSource {
  return {
    recordId, revisionId, subject, profileRef: { id: 'synthetic', version: 2 }, payload, digest: digest(payload), recordedAt,
    disclosure: { policyId: 'disclosure-default@1', scope },
    authorisation: { kind: 'registration', policyId: 'registration-policy@1', principal: 'urn:example:principal:maker', evidenceRef: `registration:${recordId}@${revisionId}` },
  }
}

export const MODEL_R1 = source('rec-model-1', 'r1', { id: MODEL_ID, granularity: 'model' }, '2026-01-10T09:00:00Z', {
  profile: 'synthetic', profile_version: 2, category: 'industrial', modelName: 'Synthetic cell S1', massKg: 12, capacityKwh: 5, originCountry: 'DE',
  colour: { values: [{ language: 'de', text: 'Blau' }, { language: 'en', text: 'Blue' }, { language: 'en-GB', text: 'Blue (GB)' }] },
  recycledShare: { value: 0.25, basis: 'fraction', unit: 'kg/kg' }, hazardousSubstanceCount: 0, secondLife: false,
  warrantyMonths: 24, warrantyRule: 'purchase-date', exhaustionThreshold: 70, carbonFootprintClass: 'B',
  dueDiligenceReport: { ref: 'doc-dd-1', purpose: 'due diligence report', url: 'https://example.org/dd/1', retained: false, access: 'public' },
})
export const MODEL_R2 = source('rec-model-1', 'r2', { id: MODEL_ID, granularity: 'model' }, '2026-03-01T09:00:00Z', {
  ...MODEL_R1.payload, massKg: 12.5, capacityKwh: 5.2, recycledShare: { value: 25, basis: 'percent', unit: '%' },
})
export const BATCH = source('rec-batch-1', 'r1', { id: BATCH_ID, granularity: 'batch' }, '2026-02-15T09:00:00Z', {
  profile: 'synthetic', profile_version: 2, batchId: 'LOT-2026-02', madeMonth: '2026-02', originCountry: 'PL', massKg: 13,
})
export const ITEM_1_SOURCE = source('rec-item-1', 'r1', { id: ITEM_1, granularity: 'item' }, '2026-02-20T09:00:00Z', {
  profile: 'synthetic', profile_version: 2, serial: 'SYN-0001', purchaseDate: '2026-03-15',
}, 'owner')
export const ITEM_2_SOURCE = source('rec-item-2', 'r1', { id: ITEM_2, granularity: 'item' }, '2026-02-20T09:30:00Z', {
  profile: 'synthetic', profile_version: 2, serial: 'SYN-0002',
})

export const RELATIONSHIPS: ProjectionRelationship[] = [
  { relationshipId: 'rel-item1-model', kind: 'instance-of-model', source: { id: ITEM_1, granularity: 'item' }, target: { id: MODEL_ID, granularity: 'model' }, evidence: { sourceRevision: { recordId: 'rec-model-1', revisionId: 'r2' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-item1-batch', kind: 'member-of-batch', source: { id: ITEM_1, granularity: 'item' }, target: { id: BATCH_ID, granularity: 'batch' }, evidence: { sourceRevision: { recordId: 'rec-batch-1', revisionId: 'r1' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-batch-model', kind: 'instance-of-model', source: { id: BATCH_ID, granularity: 'batch' }, target: { id: MODEL_ID, granularity: 'model' }, evidence: { sourceRevision: { recordId: 'rec-model-1', revisionId: 'r2' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-item2-model', kind: 'instance-of-model', source: { id: ITEM_2, granularity: 'item' }, target: { id: MODEL_ID, granularity: 'model' }, evidence: { sourceRevision: { recordId: 'rec-model-1', revisionId: 'r2' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-item2-batch', kind: 'member-of-batch', source: { id: ITEM_2, granularity: 'item' }, target: { id: BATCH_ID, granularity: 'batch' }, evidence: { sourceRevision: { recordId: 'rec-batch-1', revisionId: 'r1' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-item1-cell', kind: 'component-of', source: { id: 'urn:example:component:cell-7', granularity: 'component' }, target: { id: ITEM_1, granularity: 'item' }, evidence: { credentialRef: { id: 'urn:example:credential:assembly-1' } }, policyRef: 'component-assertion@1' },
]

const measurement = (subjectId: string, property: string, value: number, unit: string, observedAt: string, recordId: string, extra: Partial<ProjectionMeasurement> = {}): ProjectionMeasurement => ({
  property, subject: { id: subjectId, granularity: 'item' }, value, unit, method: 'synthetic-method-1', observedAt, source: { recordId, revisionId: 'r1' }, ...extra,
})

/** Arrival order is deliberately scrambled: the June reading arrives before the May one, and the April one last. */
export const MEASUREMENTS: ProjectionMeasurement[] = [
  measurement(ITEM_1, 'stateOfHealth', 95, '%', '2026-06-01T08:00:00Z', 'obs-soh-3'),
  measurement(ITEM_1, 'stateOfHealth', 96, '%', '2026-05-01T08:00:00Z', 'obs-soh-2'),
  measurement(ITEM_1, 'stateOfHealth', 98, '%', '2026-04-01T08:00:00Z', 'obs-soh-1'),
  measurement(ITEM_1, 'stateOfHealth', 40, '%', '2026-07-01T08:00:00Z', 'obs-soh-invalid', { status: 'invalid' }),
  measurement(ITEM_1, 'stateOfHealth', 90, '%', '2026-07-02T08:00:00Z', 'obs-soh-revoked', { status: 'revoked' }),
  measurement(ITEM_1, 'cyclesUsed', 120, 'count', '2026-06-01T08:00:00Z', 'obs-cycles-1'),
  measurement(ITEM_1, 'remainingCapacity', 4.6, 'kWh', '2026-06-01T08:00:00Z', 'obs-cap-1'),
  measurement(ITEM_2, 'stateOfHealth', 97, '%', '2026-06-01T08:00:00Z', 'obs-soh-tie-a'),
  measurement(ITEM_2, 'stateOfHealth', 93, '%', '2026-06-01T08:00:00Z', 'obs-soh-tie-b'),
  measurement(ITEM_2, 'cyclesUsed', 80, 'cycles', '2026-06-01T08:00:00Z', 'obs-cycles-wrong-unit'),
]

export const POLICY: ProjectionPolicy = { id: 'projection-policy@1', precedence: { batchOverrides: ['originCountry'], itemOverrides: [] }, measurementSelection: 'latest-observed', tie: 'conflict' }

export function baseInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    passportId: ITEM_1,
    subject: { id: ITEM_1, granularity: 'item' },
    profile: SYNTHETIC_MANIFEST,
    sources: [MODEL_R1, MODEL_R2, BATCH, ITEM_1_SOURCE, ITEM_2_SOURCE],
    relationships: RELATIONSHIPS,
    measurements: MEASUREMENTS,
    policy: POLICY,
    disclosureScope: 'public',
    locale: { exact: 'en-GB', default: 'de' },
    jurisdiction: 'EU',
    asOf: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

/** A deterministic shuffle, so a replay test is reproducible and still not the input order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}
