import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PROJECTION_ID_PREFIX, projectPassport, projectionCommitmentBody, verifyProjectionCommitment, type ProjectionInput, type ProjectionRelationship } from '../src/index.js'
import { BATCH, BATCH_ID, ITEM_1, ITEM_2, ITEM_2_SOURCE, MEASUREMENTS, MODEL_ID, MODEL_R1, MODEL_R2, RELATIONSHIPS, SYNTHETIC_MANIFEST, baseInput, shuffled, source } from './projection-fixture.js'

const VECTORS_PATH = new URL('../../../fixtures/vectors/dpp/interoperability/projection/v1.json', import.meta.url)
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateProjection = ajv.compile(JSON.parse(readFileSync(new URL('../../../contracts/passport-projection.schema.json', import.meta.url), 'utf8')))

describe('projectPassport (spec/passport-projections.md section 4)', () => {
  const { projection, validation } = projectPassport(baseInput())

  it('validates against passport-projection@1 and commits to its own body', () => {
    expect(validateProjection(projection), JSON.stringify(validateProjection.errors)).toBe(true)
    expect(projection.projectionId).toBe(`${PROJECTION_ID_PREFIX}${projection.projectionDigest}`)
    expect(verifyProjectionCommitment(projection)).toEqual({ digestValid: true, idValid: true })
    const body = projectionCommitmentBody(projection)
    expect(Object.keys(body)).not.toContain('projectionId')
    expect(Object.keys(body)).not.toContain('projectionDigest')
    expect(Object.keys(body)).not.toContain('diagnostics')
    expect(validation.ok).toBe(true)
  })

  it('reads the pinned model revision, not the newest one, and records every source it read', () => {
    expect(projection.values.capacityKwh).toMatchObject({ value: 5.2, source: { recordId: 'rec-model-1', revisionId: 'r2', pointer: '/capacityKwh' }, granularity: 'model' })
    expect(projection.sourceRefs.map((s) => `${s.recordId}@${s.revisionId}`)).toEqual(['rec-batch-1@r1', 'rec-item-1@r1', 'rec-model-1@r2'])
    expect(projection.relationshipRefs.map((r) => r.relationshipId)).toEqual(['rel-batch-model', 'rel-item1-batch', 'rel-item1-cell', 'rel-item1-model'])
  })

  it('applies a declared batch override and reports an undeclared one as a conflict with both sources', () => {
    expect(projection.values.originCountry).toMatchObject({ value: 'PL', source: { recordId: 'rec-batch-1' }, granularity: 'batch' })
    expect(projection.fieldResults.originCountry).toMatchObject({ availability: 'present', applicability: 'applies' })
    expect(projection.values.massKg).toBeUndefined()
    expect(projection.fieldResults.massKg).toMatchObject({ availability: 'present', finding: 'conflict' })
    expect(projection.fieldResults.massKg.conflicts).toEqual([
      { recordId: 'rec-model-1', revisionId: 'r2', value: 12.5 },
      { recordId: 'rec-batch-1', revisionId: 'r1', value: 13 },
    ])
  })

  it('selects the latest accepted observation whatever the arrival order, and lists what it set aside', () => {
    expect(projection.fieldResults.stateOfHealth).toMatchObject({ availability: 'withheld' })
    const legitimate = projectPassport(baseInput({ disclosureScope: 'legitimate' })).projection
    expect(legitimate.values.stateOfHealth).toMatchObject({ value: 95, observedAt: '2026-06-01T08:00:00Z', method: 'synthetic-method-1', source: { recordId: 'obs-soh-3' } })
    expect(legitimate.fieldResults.stateOfHealth.excluded).toEqual([
      { recordId: 'obs-soh-invalid', revisionId: 'r1', reason: 'invalid evidence is not read' },
      { recordId: 'obs-soh-revoked', revisionId: 'r1', reason: 'revoked evidence is not read' },
    ])
    expect(projection.values.cyclesUsed).toMatchObject({ value: 120 })
    expect(legitimate.evidenceRefs).toContain('source-revision:obs-soh-3@r1')
  })

  it('treats a tie under the policy as a conflict and a wrong unit as no observation', () => {
    const item2 = projectPassport(baseInput({ passportId: ITEM_2, subject: { id: ITEM_2, granularity: 'item' }, disclosureScope: 'legitimate' })).projection
    expect(item2.fieldResults.stateOfHealth).toMatchObject({ availability: 'present', finding: 'conflict' })
    expect(item2.fieldResults.stateOfHealth.conflicts?.map((c) => c.value).sort()).toEqual([93, 97])
    expect(item2.values.stateOfHealth).toBeUndefined()
    expect(item2.fieldResults.cyclesUsed).toMatchObject({ availability: 'missing' })
    expect(item2.fieldResults.cyclesUsed.reason).toContain('another unit')
  })

  it('never manufactures an item fact from the model and says so', () => {
    const item2 = projectPassport(baseInput({ passportId: ITEM_2, subject: { id: ITEM_2, granularity: 'item' }, disclosureScope: 'legitimate', measurements: [] })).projection
    expect(item2.values.remainingCapacity).toBeUndefined()
    expect(item2.fieldResults.remainingCapacity).toMatchObject({ availability: 'missing', applicability: 'applies' })
    expect(item2.fieldResults.remainingCapacity.reason).toContain('no accepted item observation')
    const withModelValue = projectPassport(baseInput({ passportId: ITEM_2, subject: { id: ITEM_2, granularity: 'item' }, disclosureScope: 'legitimate', measurements: [], sources: [MODEL_R1, { ...MODEL_R2, payload: { ...MODEL_R2.payload, remainingCapacity: 5 } }, BATCH, ITEM_2_SOURCE] })).projection
    expect(withModelValue.values.remainingCapacity).toBeUndefined()
    expect(withModelValue.fieldResults.remainingCapacity.reason).toContain('model-only information')
  })

  it('keeps availability, applicability and findings on separate axes, and preserves zero and false', () => {
    expect(projection.values.hazardousSubstanceCount).toMatchObject({ value: 0 })
    expect(projection.values.secondLife).toMatchObject({ value: false })
    expect(projection.fieldResults.hazardousSubstanceCount).toMatchObject({ availability: 'present', applicability: 'applies' })
    // exhaustionThreshold: the model carries 70, the category is industrial, the rule is ev and effective 2027: present and not applicable, both said.
    expect(projection.values.exhaustionThreshold).toMatchObject({ value: 70 })
    expect(projection.fieldResults.exhaustionThreshold).toMatchObject({ availability: 'present', applicability: 'not-applicable' })
    // dueDiligenceReport: present and unresolved, never a pass.
    expect(projection.fieldResults.dueDiligenceReport).toMatchObject({ availability: 'present', applicability: 'unresolved' })
    expect(projection.fieldResults.dueDiligenceReport.reason).toContain('primary text')
    // warrantyMonths: needs review stays unresolved with the value present.
    expect(projection.fieldResults.warrantyMonths).toMatchObject({ availability: 'present', applicability: 'unresolved' })
    // remainingCapacity for an industrial 5.2 kWh model applies through the threshold branch.
    expect(projectPassport(baseInput({ disclosureScope: 'legitimate' })).projection.fieldResults.remainingCapacity).toMatchObject({ applicability: 'applies' })
  })

  it('converts a fraction to a percent only with an explicit basis, and refuses another basis', () => {
    const fromR1 = projectPassport(baseInput({ asOf: '2026-02-01T00:00:00Z' })).projection
    expect(fromR1.values.recycledShare).toMatchObject({ value: 25, conversion: { fromUnit: 'kg/kg', toUnit: '%', explicit: true } })
    expect(projection.values.recycledShare).toMatchObject({ value: 25 })
    expect(projection.values.recycledShare.conversion).toBeUndefined()
    const mass = projectPassport(baseInput({ sources: [MODEL_R1, { ...MODEL_R2, payload: { ...MODEL_R2.payload, recycledShare: { value: 25, basis: 'mass', unit: 'kg' } } }, BATCH] })).projection
    expect(mass.values.recycledShare).toBeUndefined()
    expect(mass.fieldResults.recycledShare).toMatchObject({ availability: 'present', finding: 'unsupported' })
  })

  it('selects the language exactly, then by base language, then the default, and records which', () => {
    expect(projection.values.colour).toMatchObject({ value: 'Blue (GB)', language: 'en-GB', selection: 'exact' })
    expect(projectPassport(baseInput({ locale: { exact: 'en-US', default: 'de' } })).projection.values.colour).toMatchObject({ value: 'Blue', language: 'en', selection: 'base' })
    expect(projectPassport(baseInput({ locale: { exact: 'fr', default: 'de' } })).projection.values.colour).toMatchObject({ value: 'Blau', language: 'de', selection: 'default' })
    const none = projectPassport(baseInput({ locale: { exact: 'fr', default: 'it' } })).projection
    expect(none.values.colour).toBeUndefined()
    expect(none.fieldResults.colour).toMatchObject({ availability: 'present', finding: 'unsupported' })
  })

  it('withholds restricted tiers for a public audience and releases them to the right one, with different digests', () => {
    expect(projection.fieldResults.purchaseDate).toMatchObject({ availability: 'withheld' })
    expect(projection.values.purchaseDate).toBeUndefined()
    const owner = projectPassport(baseInput({ disclosureScope: 'owner' })).projection
    expect(owner.values.purchaseDate).toMatchObject({ value: '2026-03-15' })
    expect(owner.fieldResults.stateOfHealth).toMatchObject({ availability: 'withheld' })
    expect(owner.projectionDigest).not.toBe(projection.projectionDigest)
    expect(JSON.stringify(projection)).not.toContain('2026-03-15')
  })

  it('keeps month precision: the batch month is a month and no day is invented', () => {
    expect(projection.values.madeMonth).toMatchObject({ value: '2026-02', granularity: 'batch' })
  })

  it('applies the cutoff to sources and observations and says what it excluded', () => {
    const early = projectPassport(baseInput({ asOf: '2026-02-01T00:00:00Z', disclosureScope: 'legitimate' }))
    expect(early.projection.sourceRefs.map((s) => `${s.recordId}@${s.revisionId}`)).toEqual(['rec-model-1@r1'])
    expect(early.projection.values.massKg).toMatchObject({ value: 12 })
    expect(early.projection.fieldResults.stateOfHealth).toMatchObject({ availability: 'missing' })
    expect(early.projection.fieldResults.madeMonth).toMatchObject({ availability: 'unknown', finding: 'missing-source' })
    expect(early.validation.findings.map((f) => f.code)).toContain('after-cutoff')
    expect(early.projection.asOf).toBe('2026-02-01T00:00:00Z')
    expect(projectPassport(baseInput({ asOf: undefined })).projection.asOf).toBeNull()
  })

  it('replays to the identical digest from any arrival order of the same accepted inputs', () => {
    const base = baseInput()
    for (const seed of [1, 7, 42]) {
      const replayed = projectPassport({ ...base, sources: shuffled(base.sources, seed), relationships: shuffled(base.relationships, seed + 1), measurements: shuffled(base.measurements ?? [], seed + 2) })
      expect(replayed.projection.projectionDigest).toBe(projection.projectionDigest)
      expect(replayed.projection.projectionId).toBe(projection.projectionId)
    }
    const changed = projectPassport({ ...base, sources: [MODEL_R1, { ...MODEL_R2, payload: { ...MODEL_R2.payload, modelName: 'Synthetic cell S1 (revised)' } }, BATCH, ...base.sources.slice(3)] })
    expect(changed.projection.projectionDigest).not.toBe(projection.projectionDigest)
  })

  it('names a missing model source, a cycle and an exceeded limit as findings and stays partial rather than wrong', () => {
    const missing = projectPassport(baseInput({ sources: [BATCH, ...baseInput().sources.slice(3)] }))
    expect(missing.validation.ok).toBe(false)
    expect(missing.validation.findings.map((f) => f.code)).toContain('missing-source')
    expect(missing.projection.fieldResults.modelName).toMatchObject({ availability: 'unknown', finding: 'missing-source' })
    expect(missing.projection.values.modelName).toBeUndefined()

    const loop: ProjectionRelationship = { relationshipId: 'rel-loop', kind: 'instance-of-model', source: { id: MODEL_ID, granularity: 'model' }, target: { id: ITEM_1, granularity: 'item' }, evidence: { sourceRevision: { recordId: 'rec-item-1', revisionId: 'r1' } }, policyRef: 'registration-policy@1' }
    const cyclic = projectPassport(baseInput({ relationships: [...RELATIONSHIPS, loop] }))
    expect(cyclic.validation.ok).toBe(false)
    expect(cyclic.validation.findings.map((f) => f.code)).toContain('cycle')
    expect(cyclic.projection.values.massKg).toBeUndefined()
    expect(cyclic.projection.values.serial).toMatchObject({ value: 'SYN-0001' })

    const chain: ProjectionRelationship[] = Array.from({ length: 120 }, (_, i) => ({ relationshipId: `rel-succ-${String(i).padStart(3, '0')}`, kind: 'successor-of', source: { id: ITEM_1, granularity: 'item' }, target: { id: `urn:example:successor:${i}`, granularity: 'item' }, evidence: { credentialRef: { id: `urn:example:credential:succ-${i}` } }, policyRef: 'succession-policy@1' }))
    const limited = projectPassport(baseInput({ relationships: [...RELATIONSHIPS, ...chain] }))
    expect(limited.validation.ok).toBe(false)
    expect(limited.projection.diagnostics?.truncated).toBe(true)
    expect(limited.validation.findings.map((f) => f.code)).toContain('limit')
    expect(limited.projection.relationshipRefs.length).toBeLessThanOrEqual(100)
  })

  it('refuses a record supplied at two revisions that nothing pins, and refuses non-finite numbers outright', () => {
    const unpinned = RELATIONSHIPS.map((r) => (r.evidence.sourceRevision?.recordId === 'rec-model-1' ? { ...r, evidence: { credentialRef: { id: 'urn:example:credential:x' } } } : r))
    const out = projectPassport(baseInput({ relationships: unpinned }))
    expect(out.validation.findings.map((f) => f.code)).toContain('duplicate-revision')
    expect(out.projection.values.modelName).toBeUndefined()
    expect(() => projectPassport(baseInput({ sources: [MODEL_R1, { ...MODEL_R2, payload: { ...MODEL_R2.payload, massKg: Number.POSITIVE_INFINITY } }, BATCH] }))).toThrow(/finite/)
  })

  it('reads a model subject on its own and marks item fields as outside the subject', () => {
    // The caller resolves the model's current pointer to one revision; two unpinned revisions are refused (tested below).
    const model = projectPassport(baseInput({ passportId: MODEL_ID, subject: { id: MODEL_ID, granularity: 'model' }, sources: [MODEL_R2] })).projection
    expect(model.values.modelName).toMatchObject({ value: 'Synthetic cell S1' })
    expect(model.fieldResults.serial).toMatchObject({ availability: 'missing' })
    expect(model.fieldResults.serial.reason).toContain('the subject is a model')
    expect(model.sourceRefs.map((s) => s.recordId)).toEqual(['rec-model-1'])
  })

  it('reads a batch subject and reports the source revision it used for the batch', () => {
    const batch = projectPassport(baseInput({ passportId: BATCH_ID, subject: { id: BATCH_ID, granularity: 'batch' } })).projection
    expect(batch.values.madeMonth).toMatchObject({ value: '2026-02' })
    expect(batch.values.originCountry).toMatchObject({ value: 'PL' })
    expect(batch.fieldResults.serial).toMatchObject({ availability: 'missing' })
  })
})

/**
 * The published vector file is generated from the scenario and held
 * identical here; `REGENERATE_FIXTURES=1` rewrites it. Each vector carries
 * its complete input, the synthetic profile included, so an implementation
 * in another language reproduces the digest without this package.
 */
describe('the published projection vectors', () => {
  const cases: Array<{ id: string; description: string; input: ProjectionInput; tags: string[] }> = [
    { id: 'item-public', description: 'An item for a public audience: pinned model revision, declared batch override, undeclared batch conflict, dynamic cycles, withheld restricted fields, month precision, language selection and preserved zero and false.', input: baseInput(), tags: ['happy-path'] },
    { id: 'item-legitimate', description: 'The same item for the legitimate-interest audience: the state of health observation is selected by observation time with invalid and revoked readings set aside.', input: baseInput({ disclosureScope: 'legitimate' }), tags: ['happy-path'] },
    { id: 'item-owner', description: 'The same item for the owner: the purchase date is released and the legitimate-interest tier stays withheld.', input: baseInput({ disclosureScope: 'owner' }), tags: ['happy-path'] },
    { id: 'item-at-cutoff', description: 'The same item at a cutoff before the second model revision and the batch: only the first revision is read and no batch fact is invented.', input: baseInput({ asOf: '2026-02-01T00:00:00Z' }), tags: ['happy-path'] },
    { id: 'item-tie-and-wrong-unit', description: 'The second item: two observations at the same instant disagree and are a conflict; an observation in another unit is no observation.', input: baseInput({ passportId: ITEM_2, subject: { id: ITEM_2, granularity: 'item' }, disclosureScope: 'legitimate' }), tags: ['error-case'] },
    { id: 'item-missing-model', description: 'The item with no model source supplied: model fields are unknown with a missing-source finding, and nothing is fabricated.', input: baseInput({ sources: [BATCH, ...baseInput().sources.slice(3)] }), tags: ['error-case'] },
    { id: 'item-cycle', description: 'A relationship that returns to the item: a cycle finding, and the projection stays partial.', input: baseInput({ relationships: [...RELATIONSHIPS, { relationshipId: 'rel-loop', kind: 'instance-of-model', source: { id: MODEL_ID, granularity: 'model' }, target: { id: ITEM_1, granularity: 'item' }, evidence: { sourceRevision: { recordId: 'rec-item-1', revisionId: 'r1' } }, policyRef: 'registration-policy@1' }] }), tags: ['error-case'] },
    { id: 'model-subject', description: 'The model as the subject at its current revision: item and batch fields are outside the subject, not missing facts.', input: baseInput({ passportId: MODEL_ID, subject: { id: MODEL_ID, granularity: 'model' }, sources: [MODEL_R2] }), tags: ['happy-path'] },
  ]
  const vectors = cases.map((c) => {
    const { projection, validation } = projectPassport(c.input)
    const base = baseInput()
    const replayed = projectPassport({ ...c.input, sources: shuffled(c.input.sources, 3), relationships: shuffled(c.input.relationships, 5), measurements: shuffled(c.input.measurements ?? base.measurements ?? [], 9) })
    // The profile is the same for every vector and is carried once under
    // `shared`; a vector's input names it by reference (the README says so).
    const { profile: _profile, ...input } = c.input
    return {
      id: c.id,
      description: c.description,
      input: { ...input, profile: { $shared: 'profile' } },
      expected: {
        projectionDigest: projection.projectionDigest,
        projectionId: projection.projectionId,
        replayedDigest: replayed.projection.projectionDigest,
        values: projection.values,
        fieldResults: projection.fieldResults,
        sourceRefs: projection.sourceRefs,
        relationshipRefs: projection.relationshipRefs,
        findings: validation.findings.map((f) => f.code).sort(),
        complete: validation.ok,
      },
      tags: c.tags,
    }
  })
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  const file = {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.projection.v1',
    name: 'DPP passport projection v1: deterministic derivation from pinned sources under a named policy',
    brc: [],
    version: '1.0.0',
    reference_impl: `dpp-profiles@${version}`,
    parity_class: 'required',
    shared: { profile: SYNTHETIC_MANIFEST },
    vectors,
  }
  const text = JSON.stringify(file, null, 2) + '\n'

  it('every vector replays to its own digest from a shuffled arrival order', () => {
    for (const v of vectors) expect(v.expected.replayedDigest, v.id).toBe(v.expected.projectionDigest)
  })

  it('is published verbatim under fixtures/vectors/dpp/interoperability/projection/v1.json', () => {
    if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(VECTORS_PATH, text)
    expect(readFileSync(VECTORS_PATH, 'utf8')).toBe(text)
  })

  it('every published projection validates against the contract', () => {
    for (const v of vectors) {
      const { projection } = projectPassport({ ...v.input, profile: SYNTHETIC_MANIFEST })
      expect(validateProjection(projection), `${v.id}: ${JSON.stringify(validateProjection.errors)}`).toBe(true)
    }
  })
})

describe('the synthetic manifest the scenario runs under', () => {
  it('is the version 2 fixture, and its stamps are never projected', () => {
    expect(SYNTHETIC_MANIFEST.manifestVersion).toBe('2')
    const { projection } = projectPassport(baseInput())
    expect(Object.keys(projection.fieldResults)).not.toContain('profile')
    expect(Object.keys(projection.fieldResults)).not.toContain('notice')
    expect(source('x', '1', { id: 'a', granularity: 'item' }, '2026-01-01T00:00:00Z', {}).digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
