import { describe, expect, it } from 'vitest'
import { EVIDENCE_FACETS, VERSION_2_OPERATION_MAPPING, mapNativeOperation, readManifest } from '../src/index.js'

const battery = readManifest('battery@2')

/**
 * Record version 2 carries four operations (`spec/record-model-v2.md` §4),
 * and `spec/rules.md` §2 reads each for mapping as the version 1 operation
 * it stands for. Every test here states the equivalence: the version 2
 * operation and its version 1 reading produce the same outcome, event type,
 * missing evidence and losses under the same request.
 */
describe('version 2 operations map through their version 1 reading (rules.md §2)', () => {
  it('reads ISSUE as ACTIVATE, UPDATE as EDIT, TRANSFER as TRANSFER and RETIRE as RECYCLED', () => {
    expect(VERSION_2_OPERATION_MAPPING).toEqual({ ISSUE: 'ACTIVATE', UPDATE: 'EDIT', TRANSFER: 'TRANSFER', RETIRE: 'RECYCLED' })
    for (const [v2, v1] of Object.entries(VERSION_2_OPERATION_MAPPING)) {
      expect(EVIDENCE_FACETS[v2 as keyof typeof EVIDENCE_FACETS], v2).toEqual(EVIDENCE_FACETS[v1])
    }
  })

  it('gives a version 2 operation exactly the result its version 1 reading gets, with and without evidence', () => {
    const requests = [
      { evidence: undefined },
      { evidence: { facility: 'urn:facility:1', time: '2026-01-01T00:00:00Z', responsibleParty: 'did:example:maker' } },
      { evidence: { custodyRecord: 'sha256:abc' } },
      { evidence: { dispositionKind: 'process-with-outputs' as const, outputs: ['urn:item:2'] } },
    ]
    for (const [v2, v1] of Object.entries(VERSION_2_OPERATION_MAPPING) as Array<[keyof typeof VERSION_2_OPERATION_MAPPING, string]>) {
      for (const r of requests) {
        const a = mapNativeOperation(battery, { nativeOperation: v2, evidence: r.evidence })
        const b = mapNativeOperation(battery, { nativeOperation: v1 as never, evidence: r.evidence })
        // The loss sentences name the operation as the state carries it; everything else is identical.
        const asCarried = (sentence: string): string => sentence.replace(new RegExp(`^(an )?${v1}\\b`), (m) => m.replace(v1, v2))
        expect({ ...a, nativeOperation: undefined }, `${v2} as ${v1}`).toEqual({ ...b, nativeOperation: undefined, losses: b.losses.map(asCarried) })
        expect(a.nativeOperation).toBe(v2)
      }
    }
  })

  it('does not read an ISSUE as a manufacture event without manufacturing evidence, nor a RETIRE as a disposition without its kind', () => {
    const issue = mapNativeOperation(battery, { nativeOperation: 'ISSUE' })
    expect(issue.outcome).toBe('insufficient-data')
    expect(issue.eventType).toBe('Origin')
    expect(issue.missingEvidence).toEqual(['facility', 'time', 'responsibleParty'])
    const retire = mapNativeOperation(battery, { nativeOperation: 'RETIRE' })
    expect(retire.outcome).toBe('insufficient-data')
    expect(retire.eventType).toBe('Disposition')
    expect(retire.missingEvidence).toEqual(['dispositionKind'])
  })
})
