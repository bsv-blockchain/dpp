/**
 * Conditional lifecycle mapping (`spec/rules.md` §2, `spec/profiles.md` §2).
 *
 * A native operation maps to an external lifecycle semantics only when the
 * evidence the profile's `eventMappings` entry requires is actually present,
 * and the result is exactly one of four words. `lossless` means every native
 * fact the state carries has an external counterpart of equal meaning;
 * `transformed` means the mapping was made but something has no home and is
 * listed; `unsupported` means the profile declares no mapping for the
 * operation; `insufficient-data` means the evidence condition is not met. No
 * result other than `lossless` comes without its list of what was lost or is
 * missing, and nothing is dropped silently.
 */
import type { ProfileManifest } from './index.js'

export type NativeOperationV1 = 'ACTIVATE' | 'SOLD' | 'RESOLD' | 'REPAIRED' | 'RECYCLED' | 'EDIT' | 'TRANSFER'
/** The four record-version-2 capabilities (`spec/record-model-v2.md` §4). */
export type NativeOperationV2 = 'ISSUE' | 'UPDATE' | 'RETIRE'
export type NativeOperation = NativeOperationV1 | NativeOperationV2

/**
 * Which version 1 mapping a version 2 operation is read under
 * (`spec/rules.md` §2): ISSUE is the genesis as ACTIVATE was, UPDATE a
 * metadata revision as EDIT was, RETIRE a disposition as RECYCLED was, and
 * TRANSFER is TRANSFER. The evidence conditions are the same, so an ISSUE is
 * no more a manufacture than an ACTIVATE was, and a RETIRE is a disposition
 * only with its disposition evidence. A manifest declares its mappings under
 * the version 1 names; a version 2 operation is mapped through this table
 * and the result names the operation that was actually written.
 */
export const VERSION_2_OPERATION_MAPPING: Record<NativeOperationV2 | 'TRANSFER', NativeOperationV1> = {
  ISSUE: 'ACTIVATE',
  UPDATE: 'EDIT',
  TRANSFER: 'TRANSFER',
  RETIRE: 'RECYCLED',
}
export type MappingOutcome = 'lossless' | 'transformed' | 'unsupported' | 'insufficient-data'

/**
 * The evidence a caller can actually put forward, each item a reference to a
 * record (a claim digest, an outpoint, a document digest), never a bare flag:
 * the mapping asks whether the fact is evidenced, not whether it is asserted.
 */
export interface LifecycleEvidence {
  /** Origin: where, when and by whom the item was made or commissioned. */
  facility?: string
  time?: string
  responsibleParty?: string
  /** Transfer: the physical move, or the custody record that changed hands. */
  source?: string
  destination?: string
  custodyRecord?: string
  /** Transformation (repair): what was done, by whom, when. */
  workDone?: string
  performedBy?: string
  performedAt?: string
  /** Disposition: whether this item was disposed of, or fed a process whose outputs carry new identities. */
  dispositionKind?: 'disposal' | 'process-with-outputs'
  outputs?: string[]
}

export interface MappingRequest {
  nativeOperation: NativeOperation
  /** The payload keys the native state carries (public and restricted), so unmapped facts can be listed. */
  payloadKeys?: string[]
  evidence?: LifecycleEvidence
}

export interface MappingResult {
  nativeOperation: NativeOperation
  outcome: MappingOutcome
  /** The external semantics the mapping targets, when the profile declares one. */
  eventType?: string
  externalEvent?: string
  /** The evidence facets the mapping requires and did not receive. */
  missingEvidence: string[]
  /** Everything lost or missing, in words; empty only when the outcome is lossless. */
  losses: string[]
  /** Payload keys with an external semantic field, and those without. */
  mappedFields: Array<{ key: string; semanticUri: string }>
  unmappedFields: string[]
}

type Facet = keyof LifecycleEvidence

/**
 * The structured form of each mapping's `requires` prose: which evidence
 * facets must be present, as alternatives (any one group satisfies).
 */
export const EVIDENCE_FACETS: Record<NativeOperation, Facet[][]> = {
  ACTIVATE: [['facility', 'time', 'responsibleParty']],
  SOLD: [['source', 'destination'], ['custodyRecord']],
  RESOLD: [['source', 'destination'], ['custodyRecord']],
  TRANSFER: [['custodyRecord']],
  REPAIRED: [['workDone', 'performedBy', 'performedAt']],
  EDIT: [[]],
  RECYCLED: [['dispositionKind']],
  ISSUE: [['facility', 'time', 'responsibleParty']],
  UPDATE: [[]],
  RETIRE: [['dispositionKind']],
}

const present = (evidence: LifecycleEvidence, facet: Facet): boolean => {
  const value = evidence[facet]
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0
}

export function mapNativeOperation(manifest: ProfileManifest, request: MappingRequest): MappingResult {
  const { nativeOperation } = request
  const evidence = request.evidence ?? {}
  const keys = [...new Set(request.payloadKeys ?? [])]
  const byKey = new Map(manifest.fields.map((f) => [f.key, f] as const))
  const mappedFields = keys.flatMap((key) => {
    const uri = byKey.get(key)?.semanticUri
    return uri ? [{ key, semanticUri: uri }] : []
  })
  const unmappedFields = keys.filter((key) => !byKey.get(key)?.semanticUri)
  const base = { nativeOperation, missingEvidence: [] as string[], losses: [] as string[], mappedFields, unmappedFields }

  // A version 2 operation is mapped under the version 1 name the manifest declares.
  const declared: NativeOperationV1 = nativeOperation in VERSION_2_OPERATION_MAPPING ? VERSION_2_OPERATION_MAPPING[nativeOperation as NativeOperationV2 | 'TRANSFER'] : (nativeOperation as NativeOperationV1)
  const mapping = manifest.eventMappings.find((m) => m.nativeOperation === declared)
  if (mapping == null) {
    return { ...base, outcome: 'unsupported', losses: [`${manifest.profile} declares no external mapping for ${nativeOperation}; the native operation stays native`] }
  }
  const target = { eventType: mapping.eventType, externalEvent: mapping.externalEvent }

  // The evidence condition: any one alternative group fully present satisfies it.
  const groups = EVIDENCE_FACETS[nativeOperation]
  const satisfied = groups.some((group) => group.every((facet) => present(evidence, facet)))
  if (!satisfied) {
    const shortest = [...groups].sort((a, b) => a.filter((f) => !present(evidence, f)).length - b.filter((f) => !present(evidence, f)).length)[0]
    const missingEvidence = shortest.filter((facet) => !present(evidence, facet))
    return {
      ...base,
      ...target,
      outcome: mapping.withoutEvidence,
      missingEvidence,
      losses: [
        `${nativeOperation} is not mapped to ${mapping.externalEvent}: ${mapping.requires}`,
        ...missingEvidence.map((facet) => `missing evidence: ${facet}`),
        ...unmappedFields.map((key) => `no external semantic field for ${key}`),
      ],
    }
  }

  const losses: string[] = []
  if (declared === 'EDIT') losses.push(`${nativeOperation === 'EDIT' ? 'an EDIT' : 'an UPDATE'} is a metadata revision; no physical transformation is implied and none is mapped`)
  if (declared === 'RECYCLED' && evidence.dispositionKind === 'process-with-outputs' && !present(evidence, 'outputs')) {
    return {
      ...base,
      ...target,
      outcome: 'insufficient-data',
      missingEvidence: ['outputs'],
      losses: ['a recycling process creating new products or materials must name the outputs that carry new identities', ...unmappedFields.map((key) => `no external semantic field for ${key}`)],
    }
  }
  losses.push(...unmappedFields.map((key) => `no external semantic field for ${key}`))
  return { ...base, ...target, outcome: losses.length === 0 ? 'lossless' : 'transformed', losses }
}
