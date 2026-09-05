import { describe, expect, it } from 'vitest'
import { EVIDENCE_FACETS, mapNativeOperation, readManifest, type NativeOperation } from '../src/index.js'

const battery = readManifest('battery@2')
const textile = readManifest('textile@2')
const OPERATIONS: NativeOperation[] = ['ACTIVATE', 'SOLD', 'RESOLD', 'REPAIRED', 'RECYCLED', 'EDIT', 'TRANSFER']
const mapped = battery.fields.filter((f) => f.semanticUri).slice(0, 3).map((f) => f.key)
const unmapped = battery.fields.find((f) => !f.semanticUri)!.key

describe('conditional lifecycle mapping (rules.md §2)', () => {
  it('has a structured evidence condition for every operation every profile maps', () => {
    for (const manifest of [battery, textile, readManifest('general@2')]) {
      for (const m of manifest.eventMappings) expect(EVIDENCE_FACETS[m.nativeOperation as NativeOperation], `${manifest.profile} ${m.nativeOperation}`).toBeDefined()
    }
  })

  it('does not map an ACTIVATE to a manufacture event without manufacturing evidence', () => {
    const result = mapNativeOperation(battery, { nativeOperation: 'ACTIVATE', payloadKeys: mapped })
    expect(result.outcome).toBe('insufficient-data')
    expect(result.eventType).toBe('Origin')
    expect(result.missingEvidence).toEqual(['facility', 'time', 'responsibleParty'])
    expect(result.losses.some((l) => l.includes('missing evidence: facility'))).toBe(true)
  })

  it('maps losslessly when the evidence is complete and every payload key has a semantic field', () => {
    const result = mapNativeOperation(battery, {
      nativeOperation: 'ACTIVATE',
      payloadKeys: mapped,
      evidence: { facility: 'urn:facility:1', time: '2026-01-01T00:00:00Z', responsibleParty: 'did:example:maker' },
    })
    expect(result.outcome).toBe('lossless')
    expect(result.losses).toEqual([])
    expect(result.mappedFields).toHaveLength(mapped.length)
  })

  it('reports a transformed mapping and names the field without an external home', () => {
    const result = mapNativeOperation(battery, {
      nativeOperation: 'ACTIVATE',
      payloadKeys: [...mapped, unmapped],
      evidence: { facility: 'urn:facility:1', time: '2026-01-01T00:00:00Z', responsibleParty: 'did:example:maker' },
    })
    expect(result.outcome).toBe('transformed')
    expect(result.unmappedFields).toEqual([unmapped])
    expect(result.losses).toEqual([`no external semantic field for ${unmapped}`])
  })

  it('never reads a token transfer as a shipment or a change of custody', () => {
    for (const op of ['TRANSFER', 'SOLD', 'RESOLD'] as const) {
      const result = mapNativeOperation(battery, { nativeOperation: op })
      expect(result.outcome, op).toBe('insufficient-data')
      expect(result.eventType).toBe('Transfer')
    }
    expect(mapNativeOperation(battery, { nativeOperation: 'TRANSFER', evidence: { custodyRecord: 'sha256:abc' } }).outcome).toBe('lossless')
    expect(mapNativeOperation(battery, { nativeOperation: 'SOLD', evidence: { source: 'urn:site:a', destination: 'urn:site:b' } }).outcome).toBe('lossless')
    const partial = mapNativeOperation(battery, { nativeOperation: 'SOLD', evidence: { source: 'urn:site:a' } })
    expect(partial.outcome).toBe('insufficient-data')
    expect(partial.missingEvidence).toEqual(['destination'])
  })

  it('maps an EDIT to a metadata revision, transformed, and never to a physical transformation', () => {
    const result = mapNativeOperation(battery, { nativeOperation: 'EDIT' })
    expect(result.outcome).toBe('transformed')
    expect(result.losses[0]).toMatch(/no physical transformation/)
  })

  it('distinguishes disposal from a process whose outputs carry new identities', () => {
    expect(mapNativeOperation(battery, { nativeOperation: 'RECYCLED', evidence: { dispositionKind: 'disposal' } }).outcome).toBe('lossless')
    const noOutputs = mapNativeOperation(battery, { nativeOperation: 'RECYCLED', evidence: { dispositionKind: 'process-with-outputs' } })
    expect(noOutputs.outcome).toBe('insufficient-data')
    expect(noOutputs.missingEvidence).toEqual(['outputs'])
    expect(mapNativeOperation(battery, { nativeOperation: 'RECYCLED', evidence: { dispositionKind: 'process-with-outputs', outputs: ['urn:epc:id:sgtin:9521234.000001.1'] } }).outcome).toBe('lossless')
  })

  it('returns unsupported for an operation the profile does not map', () => {
    const narrowed = { ...textile, eventMappings: textile.eventMappings.filter((m) => m.nativeOperation !== 'REPAIRED') }
    const result = mapNativeOperation(narrowed, { nativeOperation: 'REPAIRED', evidence: { workDone: 'x', performedBy: 'y', performedAt: 'z' } })
    expect(result.outcome).toBe('unsupported')
    expect(result.eventType).toBeUndefined()
    expect(result.losses).toHaveLength(1)
  })

  it('always yields exactly one outcome, and a loss list whenever the outcome is not lossless', () => {
    const evidences = [undefined, {}, { facility: 'f', time: 't', responsibleParty: 'p', source: 's', destination: 'd', custodyRecord: 'c', workDone: 'w', performedBy: 'b', performedAt: 'a', dispositionKind: 'disposal' as const }]
    for (const op of OPERATIONS) {
      for (const evidence of evidences) {
        for (const payloadKeys of [[], mapped, [unmapped]]) {
          const result = mapNativeOperation(battery, { nativeOperation: op, payloadKeys, evidence })
          expect(['lossless', 'transformed', 'unsupported', 'insufficient-data']).toContain(result.outcome)
          if (result.outcome === 'lossless') expect(result.losses).toEqual([])
          else expect(result.losses.length).toBeGreaterThan(0)
        }
      }
    }
  })
})
