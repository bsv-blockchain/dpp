/**
 * The packaging relationship fixture: a demonstration bottle under
 * `general@2`, whose closure and label are components carrying their own
 * material mass observations, whose return scheme is a related document,
 * whose producer-responsibility registration is certification-shaped
 * evidence on the item, and which is itself a component of the filled
 * product it contains. The projection over the container reads the
 * container's own sources, records every component relationship without
 * entering it, and names the source of every value. This is a relationship
 * demonstration, not a packaging regulatory profile: no packaging
 * instrument's field list is claimed here. `REGENERATE_FIXTURES=1`
 * rewrites the published file.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import canonicalize from 'canonicalize'
import { projectPassport, readManifest, type ProjectionInput, type ProjectionMeasurement, type ProjectionRelationship, type ResolvedSource } from '../src/index.js'
import { shuffled } from './projection-fixture.js'

const VECTORS_PATH = new URL('../../../fixtures/vectors/dpp/interoperability/projection/packaging-v1.json', import.meta.url)
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateProjection = ajv.compile(JSON.parse(readFileSync(new URL('../../../contracts/passport-projection.schema.json', import.meta.url), 'utf8')))
const validateSource = ajv.compile(JSON.parse(readFileSync(new URL('../../../contracts/passport-source.schema.json', import.meta.url), 'utf8')))

const GENERAL = readManifest('general@2')
const BOTTLE_MODEL = 'https://id.example.org/01/09520000000042'
const BOTTLE = `${BOTTLE_MODEL}/21/BTL-0001`
const CLOSURE = 'https://id.example.org/01/09520000000059/21/CAP-0001'
const LABEL = 'https://id.example.org/01/09520000000066/21/LBL-0001'
const CONTENT_MODEL = 'https://id.example.org/01/09520000000073'
const CONTENT = `${CONTENT_MODEL}/21/CNT-0001`

const digest = (payload: unknown): string => createHash('sha256').update(canonicalize(payload) as string, 'utf8').digest('hex')
function source(recordId: string, subject: ResolvedSource['subject'], recordedAt: string, payload: Record<string, unknown>): ResolvedSource {
  return {
    recordId, revisionId: 'r1', subject, profileRef: { id: 'general', version: 2 }, payload, digest: digest(payload), recordedAt,
    disclosure: { policyId: 'disclosure-default@1', scope: 'public' },
    authorisation: { kind: 'registration', policyId: 'registration-policy@1', principal: 'urn:example:principal:filler', evidenceRef: `registration:${recordId}@r1` },
  }
}

/** The return scheme as a related document: purpose, hash and a public location, nothing about its content interpreted here. */
const RETURN_SCHEME = {
  purpose: 'deposit return scheme terms',
  title: 'Demonstration deposit return scheme, container terms',
  url: 'https://example.org/return-scheme/terms-2026',
  digest: { algorithm: 'sha256', value: '2ff1c4b1d5f5a1f8b3a9c0e7d6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39' },
  language: 'en',
  retained: false,
  access: 'public',
}
/** Producer-responsibility registration as certification-shaped evidence: who issued what to whom, and that nobody here has checked it. */
const EPR_REGISTRATION = {
  scheme: { id: 'urn:example:scheme:producer-responsibility-register', name: 'Demonstration producer responsibility register' },
  certificateId: 'PRR-2026-000451',
  issuer: 'Demonstration producer responsibility organisation',
  subject: { id: BOTTLE_MODEL, granularity: 'model' },
  validity: { from: '2026-01-01', until: '2026-12-31' },
  verification: { status: 'not-checked' },
}

export const MODEL_SOURCE = source('rec-bottle-model', { id: BOTTLE_MODEL, granularity: 'model' }, '2026-03-02T09:00:00Z', {
  profile: 'general', profile_version: 2, name: 'Demonstration 750 ml bottle', category: 'packaging', manufacturer: 'Demonstration Glassworks', manufacturerContact: 'packaging@example.org',
  modelIdentifier: 'BTL-750-CLR', manufacturingPlace: { city: 'Leipzig', country: 'DE' }, dimensions: '750 ml, 300 mm high, 75 mm diameter', weight: 0.39,
  materials: [{ part: 'body', material: 'clear soda-lime glass', origin: 'DE' }, { part: 'closure', material: 'HDPE' }, { part: 'label', material: 'paper' }],
  recycledContent: 60, careNote: 'Rinse and return through the deposit scheme; the closure and label separate by hand.',
  collection: 'Deposit return at any participating collection point; the deposit is refunded on return of the intact container.',
  recyclability: 'Glass body recyclable in the container glass stream; closure and label are separate streams.', separability: 'Closure unscrews; label lifts in warm water.',
  guaranteeTerms: RETURN_SCHEME,
})
export const ITEM_SOURCE = source('rec-bottle-item', { id: BOTTLE, granularity: 'item' }, '2026-04-14T10:00:00Z', {
  profile: 'general', profile_version: 2, serialNumber: 'BTL-0001', made: '2026-04', certificate: EPR_REGISTRATION,
})
export const CLOSURE_SOURCE = source('rec-closure', { id: CLOSURE, granularity: 'component' }, '2026-04-14T10:05:00Z', {
  profile: 'general', profile_version: 2, serialNumber: 'CAP-0001', made: '2026-04',
})
export const LABEL_SOURCE = source('rec-label', { id: LABEL, granularity: 'component' }, '2026-04-14T10:06:00Z', {
  profile: 'general', profile_version: 2, serialNumber: 'LBL-0001', made: '2026-04',
})
export const CONTENT_SOURCE = source('rec-content-item', { id: CONTENT, granularity: 'item' }, '2026-04-20T08:00:00Z', {
  profile: 'general', profile_version: 2, serialNumber: 'CNT-0001', made: '2026-04', makerName: 'Demonstration Spring Water',
})

export const RELATIONSHIPS: ProjectionRelationship[] = [
  { relationshipId: 'rel-bottle-model', kind: 'instance-of-model', source: { id: BOTTLE, granularity: 'item' }, target: { id: BOTTLE_MODEL, granularity: 'model' }, evidence: { sourceRevision: { recordId: 'rec-bottle-model', revisionId: 'r1' } }, policyRef: 'registration-policy@1' },
  { relationshipId: 'rel-closure-of-bottle', kind: 'component-of', source: { id: CLOSURE, granularity: 'component' }, target: { id: BOTTLE, granularity: 'item' }, evidence: { sourceRevision: { recordId: 'rec-closure', revisionId: 'r1' } }, policyRef: 'component-assertion@1' },
  { relationshipId: 'rel-label-of-bottle', kind: 'component-of', source: { id: LABEL, granularity: 'component' }, target: { id: BOTTLE, granularity: 'item' }, evidence: { sourceRevision: { recordId: 'rec-label', revisionId: 'r1' } }, policyRef: 'component-assertion@1' },
  // The other direction: the filled container is a component of the product it holds.
  { relationshipId: 'rel-bottle-of-content', kind: 'component-of', source: { id: BOTTLE, granularity: 'item' }, target: { id: CONTENT, granularity: 'item' }, evidence: { eventRef: { importId: 'urn:example:import:filling-2026-04-20', eventRef: 'ni:///sha-256;3b1f5c2d7e9a4b6c8d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e?ver=CBV2.0' } }, policyRef: 'component-assertion@1' },
]

/** Material mass observations of the components themselves, in grams, attributed to the component and never folded into the container. */
export const MEASUREMENTS: ProjectionMeasurement[] = [
  { property: 'materialMass', subject: { id: CLOSURE, granularity: 'component' }, value: 2.4, unit: 'g', method: 'urn:example:method:balance-1', observedAt: '2026-04-14T10:05:00Z', source: { recordId: 'obs-closure-mass', revisionId: 'r1' } },
  { property: 'materialMass', subject: { id: LABEL, granularity: 'component' }, value: 0.9, unit: 'g', method: 'urn:example:method:balance-1', observedAt: '2026-04-14T10:06:00Z', source: { recordId: 'obs-label-mass', revisionId: 'r1' } },
]

export function containerInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    passportId: BOTTLE,
    subject: { id: BOTTLE, granularity: 'item' },
    profile: GENERAL,
    sources: [MODEL_SOURCE, ITEM_SOURCE, CLOSURE_SOURCE, LABEL_SOURCE, CONTENT_SOURCE],
    relationships: RELATIONSHIPS,
    measurements: MEASUREMENTS,
    policy: { id: 'projection-policy@1', precedence: { batchOverrides: [], itemOverrides: [] }, measurementSelection: 'latest-observed', tie: 'conflict' },
    disclosureScope: 'public',
    locale: { exact: 'en', base: 'en', default: 'en' },
    ...overrides,
  }
}

describe('the packaging relationship fixture (general@2 container, components and content)', () => {
  const { projection, validation } = projectPassport(containerInput())

  it('reads the container and its model, names each value\'s source, and validates against the contract', () => {
    expect(validation.ok).toBe(true)
    expect(validateProjection(projection), JSON.stringify(validateProjection.errors)).toBe(true)
    expect(projection.values.name).toMatchObject({ value: 'Demonstration 750 ml bottle', source: { recordId: 'rec-bottle-model', revisionId: 'r1', pointer: '/name' }, granularity: 'model' })
    expect(projection.values.serialNumber).toMatchObject({ value: 'BTL-0001', source: { recordId: 'rec-bottle-item', revisionId: 'r1' }, granularity: 'item' })
    expect(projection.values.made).toMatchObject({ value: '2026-04', granularity: 'item' })
    expect(projection.values.certificate).toMatchObject({ value: EPR_REGISTRATION, source: { recordId: 'rec-bottle-item' } })
    expect(projection.values.guaranteeTerms).toMatchObject({ value: RETURN_SCHEME, source: { recordId: 'rec-bottle-model' } })
    expect(projection.values.materials).toMatchObject({ value: MODEL_SOURCE.payload.materials })
    expect(projection.values.weight).toMatchObject({ value: 0.39, granularity: 'model' })
    expect(projection.sourceRefs.map((s) => s.recordId)).toEqual(['rec-bottle-item', 'rec-bottle-model'])
  })

  it('records the closure and label as components without entering them, and does not read the content the bottle is part of', () => {
    expect(projection.relationshipRefs.map((r) => r.relationshipId)).toEqual(['rel-bottle-model', 'rel-closure-of-bottle', 'rel-label-of-bottle'])
    expect(projection.sourceRefs.map((s) => s.recordId)).not.toContain('rec-closure')
    expect(projection.sourceRefs.map((s) => s.recordId)).not.toContain('rec-content-item')
    expect(JSON.stringify(projection)).not.toContain('Demonstration Spring Water')
    // The component masses stay observations of the components; the container's weight is the model's own declared value.
    expect(JSON.stringify(projection.values)).not.toContain('2.4')
    expect(projection.evidenceRefs).not.toContain('source-revision:obs-closure-mass@r1')
  })

  it('projects the content as its own subject with the bottle outside it', () => {
    const content = projectPassport(containerInput({ passportId: CONTENT, subject: { id: CONTENT, granularity: 'item' } })).projection
    expect(content.values.serialNumber).toMatchObject({ value: 'CNT-0001', source: { recordId: 'rec-content-item' } })
    expect(content.relationshipRefs.map((r) => r.relationshipId)).toEqual(['rel-bottle-of-content'])
    expect(content.sourceRefs.map((s) => s.recordId)).toEqual(['rec-content-item'])
    expect(content.fieldResults.name).toMatchObject({ availability: 'unknown', finding: 'missing-source' })
  })

  it('every source revision and relationship validates against passport-source@1', () => {
    for (const s of containerInput().sources) {
      // The contract's record carries the digest as payloadDigest; the projector's resolved form carries it as digest.
      const record = { recordId: s.recordId, revisionId: s.revisionId, subject: s.subject, profileRef: s.profileRef, payload: s.payload, payloadDigest: s.digest, recordedAt: s.recordedAt, disclosure: s.disclosure, authorisation: s.authorisation }
      expect(validateSource(record), `${s.recordId}: ${JSON.stringify(validateSource.errors)}`).toBe(true)
    }
    for (const r of RELATIONSHIPS) expect(validateSource(r), `${r.relationshipId}: ${JSON.stringify(validateSource.errors)}`).toBe(true)
  })
})

describe('the published packaging vectors', () => {
  const cases: Array<{ id: string; description: string; input: ProjectionInput; tags: string[] }> = [
    { id: 'container-public', description: 'The bottle for a public audience: model and item values each name their source, the closure and label relationships are recorded without being entered, the return scheme and the producer-responsibility registration are carried as documents, and the content the bottle is part of is not read.', input: containerInput(), tags: ['happy-path'] },
    { id: 'content-subject', description: 'The filled product as the subject: its own item source only, the bottle relationship recorded, the model fields unknown because no content model source was supplied.', input: containerInput({ passportId: CONTENT, subject: { id: CONTENT, granularity: 'item' } }), tags: ['error-case'] },
    { id: 'container-without-model', description: 'The bottle without its model source: model fields are unknown with a missing-source finding and nothing is fabricated from the components.', input: containerInput({ sources: [ITEM_SOURCE, CLOSURE_SOURCE, LABEL_SOURCE, CONTENT_SOURCE] }), tags: ['error-case'] },
  ]
  const vectors = cases.map((c) => {
    const { projection, validation } = projectPassport(c.input)
    const replayed = projectPassport({ ...c.input, sources: shuffled(c.input.sources, 3), relationships: shuffled(c.input.relationships, 5), measurements: shuffled(c.input.measurements ?? [], 9) })
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
    id: 'dpp.projection.packaging-v1',
    name: 'DPP passport projection v1 over a packaging relationship graph: container, components and content under general@2',
    brc: [],
    version: '1.0.0',
    reference_impl: `dpp-profiles@${version}`,
    parity_class: 'required',
    shared: { profile: GENERAL },
    vectors,
  }
  const text = JSON.stringify(file, null, 2) + '\n'

  it('every vector replays to its own digest from a shuffled arrival order', () => {
    for (const v of vectors) expect(v.expected.replayedDigest, v.id).toBe(v.expected.projectionDigest)
  })

  it('is published verbatim under fixtures/vectors/dpp/interoperability/projection/packaging-v1.json', () => {
    if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(VECTORS_PATH, text)
    expect(readFileSync(VECTORS_PATH, 'utf8')).toBe(text)
  })
})
