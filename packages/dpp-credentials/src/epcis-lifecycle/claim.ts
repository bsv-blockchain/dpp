import { CachedKeyDeriver, Hash, LockingScript, Signature, Utils, type ChainTracker, type Transaction, type WalletProtocol } from '@bsv/sdk'
import {
  buildAttestationAnchor,
  compareCodePoints,
  decodeAttestationAnchor,
  identityKeyFromDidKey,
  type AnchorMetadata,
  type AnchorSigner,
  type DataSigner,
  type ExternalCredentialVerification,
  type ExternalCredentialVerifier,
  type PartialCheck,
} from '@bsv/dpp-protocol'
import {
  EPCIS_CONTEXT_IRI,
  EPCIS_CONTEXT_PREFIXES,
  EPCIS_EVENT_TYPES,
  canonicalEpcisIdentifier,
  constrainedCanonicalDigitalLink,
  type EpcisEventType,
} from './shared.js'
import { jcsBytes, parseCanonicalJcs } from './jcs.js'

/**
 * The EPCIS lifecycle claim, `dpp-epcis-lifecycle@1`
 * (`spec/epcis-lifecycle-claim.md`): one faithful EPCIS 2.0.1 event, signed
 * by its issuer inside a DPP envelope that names the passports the event is
 * bound to, the issuer's asserted role and authority scope, the issue time,
 * an optional link to the source the event came from, and the pinned context
 * and event profile digests. The covered bytes are the RFC 8785 form of the
 * envelope without its signature; the exported and anchored bytes are the
 * RFC 8785 form of the whole signed envelope, representation
 * `dpp-epcis-lifecycle-json@1`.
 *
 * The native claim of `@bsv/dpp-protocol` (`dpp-lifecycle-v1`) is untouched and
 * stays readable and verifiable; a reader dispatches by `claimFormat`. Nothing
 * here maps a token operation to an event: the only input is an EPCIS event
 * the caller observed or received, and an event that names no object is
 * refused.
 *
 * Verification reports each finding separately and never folds one into
 * another: event structure, event semantics, product binding, signature,
 * authority, possession, ownership, anchor commitment, inclusion and
 * correction state. What the verifier was not given stays `unknown` or
 * `unavailable`, never `pass`.
 */

export const EPCIS_LIFECYCLE_CLAIM_FORMAT = 'dpp-epcis-lifecycle@1' as const
export const EPCIS_LIFECYCLE_REPRESENTATION = 'dpp-epcis-lifecycle-json@1' as const
export const EPCIS_LIFECYCLE_MEDIA_TYPE = 'application/json' as const
/** The BRC-42 protocol the issuer's signing key derives under; the protocol identifier is the domain separation. */
export const EPCIS_LIFECYCLE_PROTOCOL: WalletProtocol = [1, 'dpp epcis lifecycle v1']
export const EPCIS_LIFECYCLE_KEY_ID = 'event' as const
/** The byte bound of a complete signed claim. */
export const EPCIS_LIFECYCLE_MAX_BYTES = 2 * 1024 * 1024
/** The pinned EPCIS 2.0.1 JSON-LD context: the first entry of every `eventContext`. */
export const EPCIS_LIFECYCLE_CONTEXT = { iri: EPCIS_CONTEXT_IRI, sha256: '5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737' } as const
/** The event profile: the pinned EPCIS 2.0.1 JSON schema every signed event is held to. */
export const EPCIS_LIFECYCLE_EVENT_SCHEMA = { uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json', sha256: '0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af' } as const
export const EPCIS_LIFECYCLE_ROLES = ['observer', 'owner', 'custodian', 'authorised-reporter'] as const
/** Binding fields whose identifiers name individual objects. */
export const EPCIS_LIFECYCLE_INSTANCE_FIELDS = ['epcList', 'parentID', 'childEPCs', 'inputEPCList', 'outputEPCList'] as const
/** Binding fields whose identifiers name a class of objects, through a quantity element's `epcClass`. */
export const EPCIS_LIFECYCLE_CLASS_FIELDS = ['quantityList', 'childQuantityList', 'inputQuantityList', 'outputQuantityList'] as const

export type EpcisLifecycleRole = (typeof EPCIS_LIFECYCLE_ROLES)[number]
export type EpcisLifecycleBindingField = (typeof EPCIS_LIFECYCLE_INSTANCE_FIELDS)[number] | (typeof EPCIS_LIFECYCLE_CLASS_FIELDS)[number]
export type { EpcisEventType }

/** One passport the event is bound to, through one identifier exactly as the event carries it. */
export interface EpcisLifecycleBinding {
  passportId: string
  field: EpcisLifecycleBindingField
  identifier: string
  level: 'instance' | 'class'
}

/** One entry of the context the event is read under: the pinned EPCIS context by IRI, or an inline prefix declaration, each with its SHA-256. */
export type EpcisLifecycleContextEntry =
  | { iri: string; sha256: string }
  | { inline: Record<string, string>; sha256: string }

/** Where the event came from, when it was not captured by the issuer at signing. */
export interface EpcisLifecycleSource {
  /** `imported`: received from a repository or another party; `captured`: the issuer's own capture system. */
  relation: 'imported' | 'captured'
  /** SHA-256 of the original source bytes, which stay with the source and are never relabelled. */
  sourceDigest: string
  mediaType: 'application/json' | 'application/ld+json'
  /** The JSON Pointer of the event inside the source document. */
  eventPointer: string
  /** A source-scoped import identity, kept distinct from the event's own `eventID`. */
  localEventIdentity?: string
  /** The party the source was received from, as an EPCIS party identifier. */
  sourceParty?: string
}

export interface EpcisLifecycleClaim {
  claimFormat: typeof EPCIS_LIFECYCLE_CLAIM_FORMAT
  /** Exactly one EPCIS 2.0.1 event, faithful to its source; DPP members never sit inside it. */
  event: Record<string, unknown>
  eventContext: EpcisLifecycleContextEntry[]
  eventSchema: { uri: string; sha256: string }
  bindings: EpcisLifecycleBinding[]
  issuer: string
  issuerKeyDid?: string
  /** The party identifier the issuer is, as the event's source and destination roles name parties. */
  issuerParty?: string
  assertedRole: EpcisLifecycleRole
  /** The passports the issuer claims authority for under `assertedRole`; each has a binding. */
  authorityScope: string[]
  issuedAt: string
  /** Owned extension rules a verifier must hold to check the event's semantics. */
  requiredExtensions?: string[]
  source?: EpcisLifecycleSource
}

export interface SignedEpcisLifecycleClaim extends EpcisLifecycleClaim { signature: string }

export interface BuildEpcisLifecycleClaimInput {
  event: Record<string, unknown>
  /** Inline prefix declarations the event's extension members use, after the pinned EPCIS context. */
  extensionContexts?: Array<Record<string, string>>
  bindings: EpcisLifecycleBinding[]
  issuer: string
  issuerKeyDid?: string
  issuerParty?: string
  assertedRole: EpcisLifecycleRole
  authorityScope: string[]
  issuedAt: string
  requiredExtensions?: string[]
  source?: EpcisLifecycleSource
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface EpcisLifecycleFinding<S extends string> {
  status: S
  reasonCode?: string
  detail?: unknown
}
export type EpcisLifecycleCheckStatus = 'pass' | 'fail' | 'unknown'
export type EpcisLifecycleSemanticsStatus = EpcisLifecycleCheckStatus | 'unavailable'
export type EpcisLifecycleAuthorityStatus = 'supported' | 'unavailable' | 'refused'
export type EpcisLifecycleRoleStatus = 'asserted' | 'not-asserted' | 'unknown'
export type EpcisLifecycleCorrectionStatus = 'none' | 'declared-in-error' | 'unknown'

/** What the signed event states about one party role: an assertion by the issuer, never a fact the verifier established. */
export interface EpcisLifecyclePartyFinding extends EpcisLifecycleFinding<EpcisLifecycleRoleStatus> {
  from: string[]
  to: string[]
}

export interface EpcisLifecycleFindings {
  eventStructure: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  eventSemantics: EpcisLifecycleFinding<EpcisLifecycleSemanticsStatus>
  productBinding: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  signature: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  authority: EpcisLifecycleFinding<EpcisLifecycleAuthorityStatus>
  possession: EpcisLifecyclePartyFinding
  ownership: EpcisLifecyclePartyFinding
  anchorCommitment: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  inclusion: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  correction: EpcisLifecycleFinding<EpcisLifecycleCorrectionStatus>
}

/** One binding as verified: whether its identifier is where it says, at the level it says, and what the caller's comparison answered. */
export interface EpcisLifecycleBindingResult extends EpcisLifecycleBinding {
  status: EpcisLifecycleCheckStatus
  reasonCode?: string
  detail?: unknown
}

/** A member outside the EPCIS standard, kept byte for byte and named here. */
export interface EpcisLifecycleExtension { path: string; name: string; namespace: string }
/** A vocabulary value, as a standard CBV 2.0 term or an extension term. */
export interface EpcisLifecycleTerm { path: string; value: string; kind: 'standard' | 'extension' }

export type EpcisLifecycleRelation = 'same-claim' | 'conflict' | 'error-declaration' | 'restatement' | 'other-issuer' | 'unrelated' | 'unverified'

export interface EpcisLifecycleVerification {
  representation: typeof EPCIS_LIFECYCLE_REPRESENTATION
  mediaType: typeof EPCIS_LIFECYCLE_MEDIA_TYPE
  /** SHA-256 of the bytes as given; once they are canonical, the anchor's digest. */
  digest: string
  /** `urn:sha256:` and the digest, when the bytes are a canonical claim. */
  attestationId?: string
  claim?: SignedEpcisLifecycleClaim
  eventId?: string
  eventType?: EpcisEventType
  issuer?: string
  /** The compressed key the signature was checked against. */
  issuerKey?: string
  identityBinding?: 'key-identified' | 'requires-resolution'
  /** Every passport a binding names, in code point order. */
  boundPassports: string[]
  /**
   * The passports whose individual item the verified event names: an
   * instance binding whose identifier is where it says and whose comparison
   * passed. A class-level binding never puts a passport here.
   */
  itemParticipants: string[]
  bindings: EpcisLifecycleBindingResult[]
  extensions: EpcisLifecycleExtension[]
  terms: EpcisLifecycleTerm[]
  /** How each related claim the caller supplied stands to this one. */
  relations: Array<{ digest: string; relation: EpcisLifecycleRelation }>
  findings: EpcisLifecycleFindings
}

/** The answer an authority resolver gives for one role, one passport and one time. */
export interface EpcisLifecycleAuthorityAnswer { status: 'supported' | 'unsupported' | 'unavailable'; detail?: unknown }
export interface EpcisLifecycleAuthorityQuestion {
  /** `claim` for the issuer's own assertion, `error-declaration` when another issuer declares this claim's event in error. */
  purpose: 'claim' | 'error-declaration'
  role: EpcisLifecycleRole
  passportId: string
  issuer: string
  issuerKey: string
  issuerParty?: string
  eventId: string
  eventType: EpcisEventType
  eventTime: string
  issuedAt: string
}

export interface EpcisLifecycleComparisonInput {
  passportId: string
  identifier: string
  field: EpcisLifecycleBindingField
  level: 'instance' | 'class'
  eventType: EpcisEventType
}

/** An anchor output for the claim, as a locking script or as the transaction holding it, whose merkle path is the inclusion evidence. */
export interface EpcisLifecycleAnchorEvidence {
  lockingScript?: LockingScript | string
  transaction?: Transaction
  outputIndex?: number
}

export interface EpcisLifecycleVerificationOptions {
  /** What the caller independently expects; a claim about anything else fails the finding concerned. */
  expected?: { passportId?: string; eventId?: string }
  /** The pinned EPCIS 2.0.1 schema check, which the protocol package cannot carry; absent, structure is `unknown` once the structural rules held. */
  eventSchemaValidator?: (event: Record<string, unknown>, schema: typeof EPCIS_LIFECYCLE_EVENT_SCHEMA) => PartialCheck | Promise<PartialCheck>
  /** The extension rules the verifier holds, by identifier; a required rule missing here makes semantics `unavailable`. */
  extensionRules?: Record<string, (event: Record<string, unknown>, claim: SignedEpcisLifecycleClaim) => PartialCheck | Promise<PartialCheck>>
  /** Whether an identifier denotes the passport's product under the identity rules; `@bsv/dpp-profiles` supplies one. Absent, binding is `unknown`. */
  compareProduct?: (input: EpcisLifecycleComparisonInput) => PartialCheck | Promise<PartialCheck>
  /** Whether the issuer holds the asserted role for a passport at the event's time. Absent, authority is `unavailable`. */
  authorityResolver?: (question: EpcisLifecycleAuthorityQuestion) => EpcisLifecycleAuthorityAnswer | Promise<EpcisLifecycleAuthorityAnswer>
  anchors?: EpcisLifecycleAnchorEvidence[]
  /** The header source a merkle path is checked against. */
  chainTracker?: ChainTracker
  /** Other claims to read beside this one, and whether they are every claim the caller holds for its passports. */
  related?: { claims: Array<number[] | string>; complete: boolean }
  maxBytes?: number
}

// ---------------------------------------------------------------------------
// Vocabularies and shapes (EPCIS 2.0.1 §7, CBV 2.0 §7)
// ---------------------------------------------------------------------------

const CBV_WEB = 'https://ref.gs1.org/cbv/'
const VOCABULARIES = {
  bizStep: { web: 'BizStep-', terms: ['accepting', 'arriving', 'assembling', 'collecting', 'commissioning', 'consigning', 'creating_class_instance', 'cycle_counting', 'decommissioning', 'departing', 'destroying', 'disassembling', 'dispensing', 'encoding', 'entering_exiting', 'holding', 'inspecting', 'installing', 'killing', 'loading', 'other', 'packing', 'picking', 'receiving', 'removing', 'repackaging', 'repairing', 'replacing', 'reserving', 'retail_selling', 'shipping', 'staging_outbound', 'stock_taking', 'stocking', 'storing', 'transporting', 'unloading', 'unpacking', 'void_shipping', 'sensor_reporting', 'sampling'] },
  disposition: { web: 'Disp-', terms: ['active', 'container_closed', 'damaged', 'destroyed', 'dispensed', 'disposed', 'encoded', 'expired', 'in_progress', 'in_transit', 'inactive', 'no_pedigree_match', 'non_sellable_other', 'partially_dispensed', 'recalled', 'reserved', 'retail_sold', 'returned', 'sellable_accessible', 'sellable_not_accessible', 'stolen', 'unknown', 'available', 'completeness_verified', 'completeness_inferred', 'conformant', 'container_open', 'mismatch_instance', 'mismatch_class', 'mismatch_quantity', 'needs_replacement', 'non_conformant', 'unavailable'] },
  errorReason: { web: 'ER-', terms: ['did_not_occur', 'incorrect_data'] },
  bizTransactionType: { web: 'BTT-', terms: ['bol', 'cert', 'desadv', 'inv', 'pedigree', 'po', 'poc', 'prodorder', 'recadv', 'rma', 'testprd', 'testres', 'upevt'] },
  sourceDestType: { web: 'SDT-', terms: ['owning_party', 'possessing_party', 'location'] },
} as const
type Vocabulary = keyof typeof VOCABULARIES

const COMMON_MEMBERS = ['@context', 'type', 'eventTime', 'recordTime', 'eventTimeZoneOffset', 'eventID', 'certificationInfo', 'errorDeclaration']
const TYPE_MEMBERS: Record<EpcisEventType, string[]> = {
  ObjectEvent: ['action', 'epcList', 'quantityList', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList', 'ilmd'],
  AggregationEvent: ['parentID', 'childEPCs', 'childQuantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList'],
  TransactionEvent: ['bizTransactionList', 'parentID', 'epcList', 'quantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'sourceList', 'destinationList', 'sensorElementList'],
  TransformationEvent: ['inputEPCList', 'inputQuantityList', 'outputEPCList', 'outputQuantityList', 'transformationID', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList', 'ilmd'],
  AssociationEvent: ['parentID', 'childEPCs', 'childQuantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList'],
}
const SENSOR_METADATA = ['time', 'deviceID', 'deviceMetadata', 'rawData', 'startTime', 'endTime', 'dataProcessingMethod', 'bizRules']
const SENSOR_REPORT = ['type', 'exception', 'deviceID', 'deviceMetadata', 'rawData', 'dataProcessingMethod', 'bizRules', 'time', 'microorganism', 'chemicalSubstance', 'coordinateReferenceSystem', 'value', 'component', 'stringValue', 'booleanValue', 'hexBinaryValue', 'uriValue', 'minValue', 'maxValue', 'meanValue', 'sDev', 'percRank', 'percValue', 'uom']
const SENSOR_TIMES = new Set(['time', 'startTime', 'endTime'])
const SENSOR_NUMBERS = new Set(['value', 'minValue', 'maxValue', 'meanValue', 'sDev', 'percRank', 'percValue'])
const SENSOR_URIS = new Set(['deviceID', 'deviceMetadata', 'rawData', 'dataProcessingMethod', 'bizRules', 'microorganism', 'chemicalSubstance', 'coordinateReferenceSystem', 'uriValue'])

const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s\u0000-\u001f\u007f-\u009f]+$/
const ABSOLUTE = /^(?:https?:\/\/[^\s]+|urn:[^\s]+)$/
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/
const OFFSET = /^[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$/
const DID = /^did:[a-z0-9]+:(?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})*(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})$/
const HEX64 = /^[0-9a-f]{64}$/
const CBV_HASH_ID = /^ni:\/\/\/sha-256;([0-9a-f]{64})\?ver=CBV2\.0$/
const LOCAL_IDENTITY = /^urn:bsv:dpp:epcis:local-event:sha256:([0-9a-f]{64})$/

const isObject = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)
const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const sha256Hex = (bytes: number[]): string => Utils.toHex(Hash.sha256(bytes))
const anyone = new CachedKeyDeriver('anyone')

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = TIMESTAMP.exec(value)
  if (m == null) return false
  const [, year, month, day, hour, minute, second, , oh, om] = m
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false
  if (oh != null && (Number(oh) > 14 || Number(om) > 59)) return false
  return Number.isFinite(Date.parse(value))
}

function text(value: unknown, field: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error(`${field} must be nonempty printable text`)
  if (Utils.toArray(value, 'utf8').length > maximum) throw new Error(`${field} exceeds ${maximum} UTF-8 bytes`)
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[], what: string): void {
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new Error(`${what} has the unsupported member ${key}`)
  for (const key of required) if (!(key in value)) throw new Error(`${what} lacks ${key}`)
}

// ---------------------------------------------------------------------------
// The envelope (spec §2)
// ---------------------------------------------------------------------------

const ENVELOPE_REQUIRED = ['claimFormat', 'event', 'eventContext', 'eventSchema', 'bindings', 'issuer', 'assertedRole', 'authorityScope', 'issuedAt']
const ENVELOPE_OPTIONAL = ['issuerKeyDid', 'issuerParty', 'requiredExtensions', 'source']
const ALL_FIELDS: readonly string[] = [...EPCIS_LIFECYCLE_INSTANCE_FIELDS, ...EPCIS_LIFECYCLE_CLASS_FIELDS]

/** The envelope's shape: members, types and bounds. What the members say is judged by the findings, not here. */
function envelopeShape(value: unknown, signed: boolean): asserts value is SignedEpcisLifecycleClaim {
  if (!isObject(value)) throw new Error('a claim is a JSON object')
  exactKeys(value, signed ? [...ENVELOPE_REQUIRED, 'signature'] : ENVELOPE_REQUIRED, ENVELOPE_OPTIONAL, 'the claim')
  if (value.claimFormat !== EPCIS_LIFECYCLE_CLAIM_FORMAT) throw new Error(`claimFormat must be ${EPCIS_LIFECYCLE_CLAIM_FORMAT}`)
  if (!isObject(value.event)) throw new Error('event must be one EPCIS event object')
  if (!Array.isArray(value.eventContext) || value.eventContext.length === 0) throw new Error('eventContext must list the pinned EPCIS context first')
  value.eventContext.forEach((entry, index) => {
    const what = `eventContext[${index}]`
    if (!isObject(entry)) throw new Error(`${what} must be an object`)
    if ('iri' in entry) { exactKeys(entry, ['iri', 'sha256'], [], what); text(entry.iri, `${what}.iri`, 512) } else {
      exactKeys(entry, ['inline', 'sha256'], [], what)
      if (!isObject(entry.inline) || Object.keys(entry.inline).length === 0) throw new Error(`${what}.inline must declare at least one prefix`)
      for (const [prefix, iri] of Object.entries(entry.inline)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix) || typeof iri !== 'string' || !/^[a-z][a-z0-9+.-]*:\S+$/.test(iri)) throw new Error(`${what}.inline maps prefix names to namespace IRIs and nothing else`)
      }
    }
    if (typeof entry.sha256 !== 'string' || !HEX64.test(entry.sha256)) throw new Error(`${what}.sha256 must be 64 lower-case hex characters`)
  })
  if (!isObject(value.eventSchema)) throw new Error('eventSchema must name the event profile')
  exactKeys(value.eventSchema, ['uri', 'sha256'], [], 'eventSchema')
  text(value.eventSchema.uri, 'eventSchema.uri', 512)
  if (typeof value.eventSchema.sha256 !== 'string' || !HEX64.test(value.eventSchema.sha256)) throw new Error('eventSchema.sha256 must be 64 lower-case hex characters')
  if (!Array.isArray(value.bindings) || value.bindings.length === 0) throw new Error('bindings must name at least one passport')
  const seen = new Set<string>()
  value.bindings.forEach((binding, index) => {
    const what = `bindings[${index}]`
    if (!isObject(binding)) throw new Error(`${what} must be an object`)
    exactKeys(binding, ['passportId', 'field', 'identifier', 'level'], [], what)
    text(binding.passportId, `${what}.passportId`, 512)
    text(binding.identifier, `${what}.identifier`, 1024)
    if (typeof binding.field !== 'string' || !ALL_FIELDS.includes(binding.field)) throw new Error(`${what}.field must be one of ${ALL_FIELDS.join(', ')}`)
    if (binding.level !== 'instance' && binding.level !== 'class') throw new Error(`${what}.level must be instance or class`)
    const key = bindingKey(binding.passportId, binding.field, binding.identifier)
    if (seen.has(key)) throw new Error(`${what} repeats a binding`)
    seen.add(key)
  })
  text(value.issuer, 'issuer', 512)
  if (!DID.test(value.issuer)) throw new Error('issuer must be a DID without a path, query or fragment')
  if (value.issuer.startsWith('did:key:')) {
    if (value.issuerKeyDid !== undefined) throw new Error('a did:key issuer omits issuerKeyDid')
    identityKeyFromDidKey(value.issuer)
  } else {
    text(value.issuerKeyDid, 'issuerKeyDid', 256)
    identityKeyFromDidKey(value.issuerKeyDid)
  }
  if (value.issuerParty !== undefined) { text(value.issuerParty, 'issuerParty', 512); if (!URI.test(value.issuerParty)) throw new Error('issuerParty must be a URI') }
  if (typeof value.assertedRole !== 'string' || !(EPCIS_LIFECYCLE_ROLES as readonly string[]).includes(value.assertedRole)) throw new Error(`assertedRole must be one of ${EPCIS_LIFECYCLE_ROLES.join(', ')}`)
  if (!Array.isArray(value.authorityScope) || value.authorityScope.length === 0) throw new Error('authorityScope must name at least one passport')
  value.authorityScope.forEach((p, i) => text(p, `authorityScope[${i}]`, 512))
  if (new Set(value.authorityScope).size !== value.authorityScope.length) throw new Error('authorityScope repeats a passport')
  if (!validTimestamp(value.issuedAt)) throw new Error('issuedAt must be an ISO 8601 date-time with a timezone and a valid calendar date')
  if (value.requiredExtensions !== undefined) {
    if (!Array.isArray(value.requiredExtensions) || value.requiredExtensions.length === 0) throw new Error('requiredExtensions, when present, names at least one rule')
    value.requiredExtensions.forEach((rule, i) => { text(rule, `requiredExtensions[${i}]`, 512); if (!ABSOLUTE.test(rule)) throw new Error(`requiredExtensions[${i}] must be an absolute URI`) })
    if (new Set(value.requiredExtensions).size !== value.requiredExtensions.length) throw new Error('requiredExtensions repeats a rule')
  }
  if (value.source !== undefined) {
    const source = value.source
    if (!isObject(source)) throw new Error('source must be an object')
    exactKeys(source, ['relation', 'sourceDigest', 'mediaType', 'eventPointer'], ['localEventIdentity', 'sourceParty'], 'source')
    if (source.relation !== 'imported' && source.relation !== 'captured') throw new Error('source.relation must be imported or captured')
    if (typeof source.sourceDigest !== 'string' || !HEX64.test(source.sourceDigest)) throw new Error('source.sourceDigest must be 64 lower-case hex characters')
    if (source.mediaType !== 'application/json' && source.mediaType !== 'application/ld+json') throw new Error('source.mediaType must be application/json or application/ld+json')
    if (typeof source.eventPointer !== 'string' || !/^(?:\/(?:[^~/]|~[01])*)*$/.test(source.eventPointer)) throw new Error('source.eventPointer must be a JSON Pointer')
    if (source.localEventIdentity !== undefined) { text(source.localEventIdentity, 'source.localEventIdentity', 512); if (!URI.test(source.localEventIdentity)) throw new Error('source.localEventIdentity must be a URI') }
    if (source.sourceParty !== undefined) { text(source.sourceParty, 'source.sourceParty', 512); if (!URI.test(source.sourceParty)) throw new Error('source.sourceParty must be a URI') }
  }
  if (signed) {
    if (typeof value.signature !== 'string' || !/^(?:[0-9a-f]{2}){8,72}$/.test(value.signature)) throw new Error('signature must be lower-case DER hex')
    if (Utils.toHex(Signature.fromDER(value.signature, 'hex').toDER() as number[]) !== value.signature) throw new Error('signature must use canonical DER')
  }
  // Every value must survive the strict canonical reading a verifier applies, so nothing signed here is unreadable there.
  const bytes = jcsBytes(value)
  if (bytes.length > EPCIS_LIFECYCLE_MAX_BYTES) throw new Error(`the claim exceeds ${EPCIS_LIFECYCLE_MAX_BYTES} bytes`)
  parseCanonicalJcs(bytes, { maxBytes: EPCIS_LIFECYCLE_MAX_BYTES, maxDepth: 64 })
}

const bindingKey = (a: string, b: string, c: string): string => JSON.stringify([a, b, c])

// ---------------------------------------------------------------------------
// The event (spec §4): structure, identity, extensions and terms
// ---------------------------------------------------------------------------

interface EventReading {
  problems: Array<{ reasonCode: string; detail: string }>
  extensions: EpcisLifecycleExtension[]
  terms: EpcisLifecycleTerm[]
}

function namespacesOf(claim: EpcisLifecycleClaim, reading: EventReading): Map<string, string> {
  const namespaces = new Map(Object.entries(EPCIS_CONTEXT_PREFIXES))
  for (const entry of claim.eventContext) if ('inline' in entry) for (const [p, iri] of Object.entries(entry.inline)) namespaces.set(p, iri)
  const own = claim.event['@context']
  if (own !== undefined) {
    const entries = Array.isArray(own) ? own : [own]
    entries.forEach((entry, index) => {
      if (entry === EPCIS_CONTEXT_IRI) return
      if (isObject(entry) && Object.keys(entry).length > 0 && Object.entries(entry).every(([p, iri]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(p) && typeof iri === 'string' && /^[a-z][a-z0-9+.-]*:\S+$/.test(iri))) {
        for (const [p, iri] of Object.entries(entry)) namespaces.set(p, iri as string)
        return
      }
      reading.problems.push({ reasonCode: 'x-context-unpinned', detail: `event.@context[${index}] is neither the pinned EPCIS context nor an inline prefix declaration` })
    })
  }
  return namespaces
}

function checkContexts(claim: EpcisLifecycleClaim, reading: EventReading): void {
  claim.eventContext.forEach((entry, index) => {
    if ('iri' in entry) {
      if (index !== 0 || entry.iri !== EPCIS_LIFECYCLE_CONTEXT.iri) reading.problems.push({ reasonCode: 'x-context-unpinned', detail: `eventContext[${index}] names ${entry.iri}; the pinned EPCIS 2.0.1 context comes first and every other entry is inline` })
      else if (entry.sha256 !== EPCIS_LIFECYCLE_CONTEXT.sha256) reading.problems.push({ reasonCode: 'x-context-digest-mismatch', detail: `eventContext[0] binds ${entry.sha256}, not the pinned digest of the EPCIS 2.0.1 context` })
    } else {
      if (index === 0) reading.problems.push({ reasonCode: 'x-context-unpinned', detail: 'eventContext[0] must be the pinned EPCIS 2.0.1 context' })
      const actual = sha256Hex(jcsBytes(entry.inline))
      if (actual !== entry.sha256) reading.problems.push({ reasonCode: 'x-context-digest-mismatch', detail: `eventContext[${index}] binds ${entry.sha256}, but its inline declaration digests to ${actual}` })
    }
  })
  if (claim.eventSchema.uri !== EPCIS_LIFECYCLE_EVENT_SCHEMA.uri || claim.eventSchema.sha256 !== EPCIS_LIFECYCLE_EVENT_SCHEMA.sha256) {
    reading.problems.push({ reasonCode: 'x-profile-digest-mismatch', detail: `eventSchema binds ${claim.eventSchema.uri} at ${claim.eventSchema.sha256}, not the pinned EPCIS 2.0.1 JSON schema` })
  }
}

function readEvent(claim: EpcisLifecycleClaim): EventReading {
  const reading: EventReading = { problems: [], extensions: [], terms: [] }
  const event = claim.event
  const problem = (reasonCode: string, detail: string): void => { reading.problems.push({ reasonCode, detail }) }
  checkContexts(claim, reading)
  const namespaces = namespacesOf(claim, reading)

  const extension = (key: string, path: string): void => {
    if (ABSOLUTE.test(key)) { reading.extensions.push({ path, name: key, namespace: key }); return }
    const colon = key.indexOf(':')
    const prefix = colon > 0 ? key.slice(0, colon) : ''
    const local = colon > 0 ? key.slice(colon + 1) : ''
    const namespace = namespaces.get(prefix)
    if (colon <= 0 || local.length === 0 || /[/:\s]/.test(local)) { problem('schema-invalid', `${path} is not an EPCIS member and not a prefixed or absolute extension name`); return }
    if (namespace == null) { problem('x-extension-prefix-undeclared', `${path} uses the prefix ${prefix}, which no context the claim carries declares`); return }
    reading.extensions.push({ path, name: key, namespace })
  }
  const members = (value: Record<string, unknown>, path: string, known: string[], allowExtensions: boolean): void => {
    for (const key of Object.keys(value)) {
      if (known.includes(key)) continue
      if (allowExtensions) extension(key, `${path}.${key}`)
      else problem('schema-invalid', `${path}.${key} is not a member of ${path.replace(/\[\d+\]$/, '')}`)
    }
  }
  const uri = (value: unknown, path: string): void => { if (typeof value !== 'string' || !URI.test(value)) problem('schema-invalid', `${path} must be a URI`) }
  const time = (value: unknown, path: string): void => { if (!validTimestamp(value)) problem('schema-invalid', `${path} must be an ISO 8601 date-time with a timezone`) }
  const vocab = (value: unknown, path: string, vocabulary: Vocabulary): void => {
    const { web, terms } = VOCABULARIES[vocabulary]
    if (typeof value !== 'string' || value.length === 0) { problem('schema-invalid', `${path} must be a vocabulary term`); return }
    if (/^urn:epcglobal:cbv:/.test(value) || /^https?:\/\/ns\.gs1\.org\/cbv\//.test(value)) { problem('schema-invalid', `${path} spells a CBV term in a form EPCIS 2.0.1 JSON does not admit: ${value}`); return }
    if (value.startsWith(CBV_WEB)) {
      const term = value.slice(CBV_WEB.length)
      if (term.startsWith(web) && (terms as readonly string[]).includes(term.slice(web.length))) reading.terms.push({ path, value, kind: 'standard' })
      else problem('schema-invalid', `${path} names ${value}, which is not a CBV 2.0 ${vocabulary} term`)
      return
    }
    if ((terms as readonly string[]).includes(value)) { reading.terms.push({ path, value, kind: 'standard' }); return }
    if (URI.test(value) && value.includes(':')) { reading.terms.push({ path, value, kind: 'extension' }); return }
    problem('schema-invalid', `${path} is ${value}, neither a CBV 2.0 ${vocabulary} term nor an extension URI`)
  }
  const idList = (value: unknown, path: string): void => {
    if (!Array.isArray(value)) { problem('schema-invalid', `${path} must be a list`); return }
    value.forEach((id, i) => uri(id, `${path}[${i}]`))
  }
  const quantities = (value: unknown, path: string): void => {
    if (!Array.isArray(value)) { problem('schema-invalid', `${path} must be a list`); return }
    value.forEach((element, i) => {
      const p = `${path}[${i}]`
      if (!isObject(element)) { problem('schema-invalid', `${p} must be a quantity element`); return }
      members(element, p, ['epcClass', 'quantity', 'uom'], false)
      uri(element.epcClass, `${p}.epcClass`)
      if (element.quantity !== undefined && typeof element.quantity !== 'number') problem('schema-invalid', `${p}.quantity must be a number`)
      if (element.uom !== undefined && (typeof element.uom !== 'string' || !/^[A-Z0-9]{2,3}$/.test(element.uom))) problem('schema-invalid', `${p}.uom must be a UN/CEFACT unit code`)
      if (element.uom !== undefined && element.quantity === undefined) problem('schema-invalid', `${p}.uom needs a quantity`)
    })
  }
  const typed = (value: unknown, path: string, member: 'source' | 'destination' | 'bizTransaction'): void => {
    if (!Array.isArray(value)) { problem('schema-invalid', `${path} must be a list`); return }
    value.forEach((element, i) => {
      const p = `${path}[${i}]`
      if (!isObject(element)) { problem('schema-invalid', `${p} must be an object`); return }
      members(element, p, ['type', member], false)
      uri(element[member], `${p}.${member}`)
      if (member === 'bizTransaction') { if (element.type !== undefined) vocab(element.type, `${p}.type`, 'bizTransactionType') } else vocab(element.type, `${p}.type`, 'sourceDestType')
    })
  }
  const location = (value: unknown, path: string): void => {
    if (!isObject(value)) { problem('schema-invalid', `${path} must be an object`); return }
    uri(value.id, `${path}.id`)
    members(value, path, ['id'], true)
  }
  const sensors = (value: unknown, path: string): void => {
    if (!Array.isArray(value)) { problem('schema-invalid', `${path} must be a list`); return }
    value.forEach((element, i) => {
      const p = `${path}[${i}]`
      if (!isObject(element)) { problem('schema-invalid', `${p} must be a sensor element`); return }
      members(element, p, ['sensorMetadata', 'sensorReport'], true)
      if (element.sensorMetadata !== undefined) {
        if (!isObject(element.sensorMetadata)) problem('schema-invalid', `${p}.sensorMetadata must be an object`)
        else {
          members(element.sensorMetadata, `${p}.sensorMetadata`, SENSOR_METADATA, true)
          for (const [k, v] of Object.entries(element.sensorMetadata)) {
            if (SENSOR_TIMES.has(k)) time(v, `${p}.sensorMetadata.${k}`)
            else if (SENSOR_URIS.has(k)) uri(v, `${p}.sensorMetadata.${k}`)
          }
        }
      }
      if (!Array.isArray(element.sensorReport) || element.sensorReport.length === 0) { problem('schema-invalid', `${p}.sensorReport must list at least one report`); return }
      element.sensorReport.forEach((report, j) => {
        const q = `${p}.sensorReport[${j}]`
        if (!isObject(report)) { problem('schema-invalid', `${q} must be an object`); return }
        members(report, q, SENSOR_REPORT, true)
        if (typeof report.type !== 'string' || report.type.length === 0) problem('schema-invalid', `${q}.type must name the measurement type`)
        for (const [k, v] of Object.entries(report)) {
          if (SENSOR_TIMES.has(k)) time(v, `${q}.${k}`)
          else if (SENSOR_NUMBERS.has(k) && typeof v !== 'number') problem('schema-invalid', `${q}.${k} must be a number`)
          else if (SENSOR_URIS.has(k)) uri(v, `${q}.${k}`)
          else if (k === 'booleanValue' && typeof v !== 'boolean') problem('schema-invalid', `${q}.booleanValue must be a boolean`)
          else if ((k === 'stringValue' || k === 'uom' || k === 'exception' || k === 'component') && typeof v !== 'string') problem('schema-invalid', `${q}.${k} must be text`)
          else if (k === 'hexBinaryValue' && (typeof v !== 'string' || !/^(?:[0-9A-Fa-f]{2})*$/.test(v))) problem('schema-invalid', `${q}.hexBinaryValue must be hexadecimal`)
        }
      })
    })
  }

  // The type, then the members the type admits.
  const type = event.type
  if (typeof type !== 'string' || !(EPCIS_EVENT_TYPES as readonly string[]).includes(type)) {
    problem('x-event-type-unsupported', `event.type must be exactly one of ${EPCIS_EVENT_TYPES.join(', ')}`)
    return reading
  }
  const known = [...COMMON_MEMBERS, ...TYPE_MEMBERS[type as EpcisEventType]]
  members(event, 'event', known, true)

  // Common members (EPCIS 2.0.1 §7.4.1).
  time(event.eventTime, 'event.eventTime')
  if (typeof event.eventTimeZoneOffset !== 'string' || !OFFSET.test(event.eventTimeZoneOffset)) problem('schema-invalid', 'event.eventTimeZoneOffset must be a UTC offset such as +10:00')
  if (event.recordTime !== undefined) time(event.recordTime, 'event.recordTime')
  if (event.certificationInfo !== undefined) {
    if (Array.isArray(event.certificationInfo)) event.certificationInfo.forEach((c, i) => uri(c, `event.certificationInfo[${i}]`))
    else uri(event.certificationInfo, 'event.certificationInfo')
  }
  if (event.errorDeclaration !== undefined) {
    const d = event.errorDeclaration
    if (!isObject(d)) problem('schema-invalid', 'event.errorDeclaration must be an object')
    else {
      members(d, 'event.errorDeclaration', ['declarationTime', 'reason', 'correctiveEventIDs'], true)
      time(d.declarationTime, 'event.errorDeclaration.declarationTime')
      if (d.reason !== undefined) vocab(d.reason, 'event.errorDeclaration.reason', 'errorReason')
      if (d.correctiveEventIDs !== undefined) idList(d.correctiveEventIDs, 'event.errorDeclaration.correctiveEventIDs')
    }
  }

  // Event identity (spec §4): the event carries its own eventID, and nothing is relabelled as a CBV Event Hash ID.
  const eventId = event.eventID
  if (eventId === undefined) problem('x-event-id-missing', 'event.eventID is required: the claim never mints or infers an event identifier')
  else if (typeof eventId !== 'string' || !URI.test(eventId)) problem('schema-invalid', 'event.eventID must be a URI')
  else {
    const hash = CBV_HASH_ID.exec(eventId)
    const local = claim.source?.localEventIdentity
    if (LOCAL_IDENTITY.test(eventId) || (local != null && eventId === local)) problem('x-local-identity-as-event-id', `event.eventID ${eventId} is a source-scoped import identity, which travels in source and never as the event's own identifier`)
    else if (hash != null) {
      const digests = new Set<string>()
      if (claim.source != null) digests.add(claim.source.sourceDigest)
      const localHash = local == null ? null : LOCAL_IDENTITY.exec(local)
      if (localHash != null) digests.add(localHash[1])
      const { eventID: _id, recordTime: _rt, errorDeclaration: _ed, ...body } = event
      digests.add(sha256Hex(jcsBytes(body)))
      digests.add(sha256Hex(jcsBytes(event)))
      if (digests.has(hash[1])) problem('x-digest-relabelled', `event.eventID presents a digest the claim also carries as a CBV 2.0 Event Hash ID; this format selects no CBV hash, and a local or source digest is never relabelled as one`)
    }
  }

  // The per-type constraints (EPCIS 2.0.1 §7.4.2 to §7.4.6).
  const nonEmpty = (key: string): boolean => Array.isArray(event[key]) && (event[key] as unknown[]).length > 0
  const action = event.action
  if (type === 'TransformationEvent') {
    if (action !== undefined) problem('schema-invalid', 'a TransformationEvent has no action')
    const inputs = nonEmpty('inputEPCList') || nonEmpty('inputQuantityList')
    const outputs = nonEmpty('outputEPCList') || nonEmpty('outputQuantityList')
    if (!(inputs && outputs) && !((inputs || outputs) && event.transformationID !== undefined)) problem('schema-invalid', 'a TransformationEvent names inputs and outputs, or one of them with a transformationID')
    if (event.transformationID !== undefined) uri(event.transformationID, 'event.transformationID')
  } else if (action !== 'ADD' && action !== 'OBSERVE' && action !== 'DELETE') {
    problem('schema-invalid', `a ${type} needs action ADD, OBSERVE or DELETE`)
  }
  if (type === 'ObjectEvent') {
    if (!('epcList' in event) && !nonEmpty('quantityList') && !(nonEmpty('sensorElementList') && event.readPoint !== undefined)) problem('schema-invalid', 'an ObjectEvent names epcList, a quantityList, or sensor elements at a readPoint')
    if (event.ilmd !== undefined && action !== 'ADD') problem('schema-invalid', 'an ObjectEvent carries ilmd only with action ADD')
  }
  if (type === 'AggregationEvent') {
    if ((action === 'ADD' || action === 'DELETE') && event.parentID === undefined) problem('schema-invalid', `an AggregationEvent with action ${String(action)} names its parentID`)
    if (!nonEmpty('childEPCs') && !nonEmpty('childQuantityList') && action !== 'DELETE') problem('schema-invalid', 'an AggregationEvent names childEPCs or a childQuantityList, unless it deletes every child')
  }
  if (type === 'AssociationEvent') {
    if (event.parentID === undefined) problem('schema-invalid', 'an AssociationEvent names its parentID')
    if (!nonEmpty('childEPCs') && !nonEmpty('childQuantityList') && action !== 'DELETE') problem('schema-invalid', 'an AssociationEvent names childEPCs or a childQuantityList, unless it deletes every child')
  }
  if (type === 'TransactionEvent') {
    if (!nonEmpty('bizTransactionList')) problem('schema-invalid', 'a TransactionEvent names at least one business transaction')
    if (!('epcList' in event) && !nonEmpty('quantityList') && action !== 'DELETE') problem('schema-invalid', 'a TransactionEvent names epcList or a quantityList, unless it deletes every association')
  }

  // The shared members.
  for (const key of ['epcList', 'childEPCs', 'inputEPCList', 'outputEPCList']) if (event[key] !== undefined) idList(event[key], `event.${key}`)
  for (const key of ['quantityList', 'childQuantityList', 'inputQuantityList', 'outputQuantityList']) if (event[key] !== undefined) quantities(event[key], `event.${key}`)
  if (event.parentID !== undefined) uri(event.parentID, 'event.parentID')
  if (event.bizStep !== undefined) vocab(event.bizStep, 'event.bizStep', 'bizStep')
  if (event.disposition !== undefined) vocab(event.disposition, 'event.disposition', 'disposition')
  if (event.persistentDisposition !== undefined) {
    const pd = event.persistentDisposition
    if (!isObject(pd) || (pd.set === undefined && pd.unset === undefined)) problem('schema-invalid', 'event.persistentDisposition sets or unsets at least one disposition')
    else {
      members(pd, 'event.persistentDisposition', ['set', 'unset'], false)
      for (const k of ['set', 'unset'] as const) {
        if (pd[k] === undefined) continue
        const list = pd[k]
        if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length) problem('schema-invalid', `event.persistentDisposition.${k} must list distinct dispositions`)
        else list.forEach((d, i) => vocab(d, `event.persistentDisposition.${k}[${i}]`, 'disposition'))
      }
    }
  }
  if (event.readPoint !== undefined) location(event.readPoint, 'event.readPoint')
  if (event.bizLocation !== undefined) location(event.bizLocation, 'event.bizLocation')
  if (event.bizTransactionList !== undefined) typed(event.bizTransactionList, 'event.bizTransactionList', 'bizTransaction')
  if (event.sourceList !== undefined) typed(event.sourceList, 'event.sourceList', 'source')
  if (event.destinationList !== undefined) typed(event.destinationList, 'event.destinationList', 'destination')
  if (event.sensorElementList !== undefined) sensors(event.sensorElementList, 'event.sensorElementList')
  if (event.ilmd !== undefined) {
    if (!isObject(event.ilmd)) problem('schema-invalid', 'event.ilmd must be an object')
    else members(event.ilmd, 'event.ilmd', [], true)
  }

  // Temporal order: an issuer cannot sign an observation before the event it reports.
  if (validTimestamp(event.eventTime) && Date.parse(claim.issuedAt) < Date.parse(event.eventTime)) problem('x-issued-before-event', `issuedAt ${claim.issuedAt} precedes event.eventTime ${event.eventTime}`)
  return reading
}

// ---------------------------------------------------------------------------
// Binding, party roles and authority (spec §5 and §6)
// ---------------------------------------------------------------------------

const OBJECT_FIELDS = [...EPCIS_LIFECYCLE_INSTANCE_FIELDS, ...EPCIS_LIFECYCLE_CLASS_FIELDS]

/** Whether the event names any object at all; an event that names none observed nothing a passport can be bound to. */
function namesAnObject(event: Record<string, unknown>): boolean {
  return OBJECT_FIELDS.some((field) => (field === 'parentID' ? typeof event.parentID === 'string' : Array.isArray(event[field]) && (event[field] as unknown[]).length > 0))
}

/** The granularity an identifier itself declares, when the GS1 grammar says: an item, a class (a model, a lot, a pattern), or not decidable here. */
export function epcisIdentifierGranularity(identifier: string): 'instance' | 'class' | 'undetermined' {
  if (/^urn:epc:(class|idpat):/.test(identifier)) return 'class'
  if (/^urn:epc:id:/.test(identifier)) return 'instance'
  if (/^https?:\/\//.test(identifier)) {
    try {
      const link = constrainedCanonicalDigitalLink(identifier)
      const m = /^https:\/\/id\.gs1\.org\/([0-9]+)\/[^/]+(?:\/([0-9]+)\/[^/]+)?$/.exec(link)
      if (m == null) return 'undetermined'
      const [, key, qualifier] = m
      if (key === '01' || key === '8006') return qualifier === '21' ? 'instance' : 'class'
      if (key === '00' || key === '8003' || key === '8004' || key === '8018' || key === '253') return 'instance'
      return 'undetermined'
    } catch {
      return 'undetermined'
    }
  }
  return 'undetermined'
}

function staticBinding(binding: EpcisLifecycleBinding, event: Record<string, unknown>, type: EpcisEventType | undefined): EpcisLifecycleBindingResult {
  const fail = (reasonCode: string, detail: string): EpcisLifecycleBindingResult => ({ ...binding, status: 'fail', reasonCode, detail })
  if (type == null || !TYPE_MEMBERS[type].includes(binding.field)) return fail('x-binding-field-absent', `a ${String(type)} has no ${binding.field}`)
  const isClassField = (EPCIS_LIFECYCLE_CLASS_FIELDS as readonly string[]).includes(binding.field)
  const value = event[binding.field]
  const present = binding.field === 'parentID'
    ? value === binding.identifier
    : Array.isArray(value) && value.some((v) => (isClassField ? isObject(v) && v.epcClass === binding.identifier : v === binding.identifier))
  if (!present) return fail('x-binding-identifier-absent', `${binding.identifier} is not in event.${binding.field} exactly as written`)
  if (isClassField && binding.level === 'instance') return fail('x-class-as-item', `event.${binding.field} names a class of objects, which never establishes an individual item's participation`)
  if (!isClassField && binding.level === 'class') return fail('x-binding-level-mismatch', `event.${binding.field} names individual objects; a class binding is made through a quantity list`)
  if (!isClassField && epcisIdentifierGranularity(binding.identifier) === 'class') return fail('x-class-as-item', `${binding.identifier} names a model, a lot or a pattern, which cannot stand in for an item`)
  return { ...binding, status: 'unknown', reasonCode: 'x-comparison-unavailable', detail: 'the identifier is where the binding says; no product comparison was supplied' }
}

/** A party identifier in one comparable spelling: an EPC URI or a GS1 Digital Link in canonical Digital Link form, anything else as written. */
function partyKey(value: string): string {
  try { return canonicalEpcisIdentifier(value) } catch { return value }
}

function partyRole(event: Record<string, unknown>, term: 'owning_party' | 'possessing_party'): { from: string[]; to: string[] } {
  const pick = (list: unknown, member: 'source' | 'destination'): string[] =>
    Array.isArray(list)
      ? list.filter((e) => isObject(e) && (e.type === term || e.type === `${CBV_WEB}SDT-${term}`) && typeof e[member] === 'string').map((e) => (e as Record<string, string>)[member])
      : []
  return { from: pick(event.sourceList, 'source'), to: pick(event.destinationList, 'destination') }
}

function partyFinding(event: Record<string, unknown>, term: 'owning_party' | 'possessing_party'): EpcisLifecyclePartyFinding {
  const { from, to } = partyRole(event, term)
  if (from.length === 0 && to.length === 0) return { status: 'not-asserted', from, to, detail: `the event names no ${term} source or destination; nothing about ${term === 'owning_party' ? 'ownership' : 'possession'} is inferred from its business step, disposition or any token operation` }
  return { status: 'asserted', from, to, detail: `the signed event states these ${term} roles; the verifier establishes no more than that the issuer signed them` }
}

/** The authority refusals that need no outside evidence (spec §6). */
function contradictions(claim: EpcisLifecycleClaim): Array<{ reasonCode: string; detail: string }> {
  const out: Array<{ reasonCode: string; detail: string }> = []
  const bound = new Set(claim.bindings.map((b) => b.passportId))
  for (const passport of claim.authorityScope) if (!bound.has(passport)) out.push({ reasonCode: 'x-scope-without-binding', detail: `authorityScope names ${passport}, which no binding names` })
  const issuerParty = claim.issuerParty == null ? undefined : partyKey(claim.issuerParty)
  if (claim.assertedRole === 'observer' && claim.source?.relation === 'imported' && (claim.source.sourceParty == null || issuerParty == null || partyKey(claim.source.sourceParty) !== issuerParty)) {
    out.push({ reasonCode: 'x-importer-not-observer', detail: 'the source link says the event was imported from another party, so the issuer cannot sign it as the observer; an importer signs as authorised-reporter' })
  }
  for (const [role, term] of [['owner', 'owning_party'], ['custodian', 'possessing_party']] as const) {
    if (claim.assertedRole !== role || issuerParty == null) continue
    const { from, to } = partyRole(claim.event, term)
    if (from.length + to.length > 0 && ![...from, ...to].some((p) => partyKey(p) === issuerParty)) {
      out.push({ reasonCode: 'x-party-role-contradicted', detail: `the issuer asserts ${role}, but the event's ${term} roles name only other parties` })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Bytes, signing and identity (spec §3)
// ---------------------------------------------------------------------------

/** The covered bytes: the RFC 8785 form of the envelope without `signature`. */
export function epcisLifecycleSigningBytes(claim: EpcisLifecycleClaim): number[] {
  const { signature: _signature, ...unsigned } = claim as SignedEpcisLifecycleClaim
  return jcsBytes(unsigned)
}

/** The exported and anchored bytes: the RFC 8785 form of the complete signed envelope. */
export function epcisLifecycleClaimBytes(claim: SignedEpcisLifecycleClaim): number[] {
  envelopeShape(claim, true)
  return jcsBytes(claim)
}

export function epcisLifecycleClaimDigest(claim: SignedEpcisLifecycleClaim): string {
  return sha256Hex(epcisLifecycleClaimBytes(claim))
}

/** The claim's identity, as for native claims: `urn:sha256:` and the digest of the complete signed bytes. */
export function epcisLifecycleClaimId(claim: SignedEpcisLifecycleClaim): string {
  return `urn:sha256:${epcisLifecycleClaimDigest(claim)}`
}

/** The strict reading of exported bytes: refused unless they are exactly the canonical form of a well-shaped signed claim. */
export function parseEpcisLifecycleClaim(input: number[] | string, maxBytes = EPCIS_LIFECYCLE_MAX_BYTES): SignedEpcisLifecycleClaim {
  const bytes = typeof input === 'string' ? Utils.toArray(input, 'utf8') : input
  if (bytes.length > maxBytes) throw new Error(`the claim exceeds ${maxBytes} bytes`)
  const value = parseCanonicalJcs(bytes, { maxBytes, maxDepth: 64 })
  envelopeShape(value, true)
  return value
}

/**
 * Everything a claim must satisfy before it is signed, with no outside
 * evidence: the envelope, the event's structure and identity, an observed
 * object, every binding where it says and at the level it says, and none of
 * the authority contradictions. Throws with every reason when one fails.
 */
export function assertEpcisLifecycleClaim(value: unknown): asserts value is EpcisLifecycleClaim {
  envelopeShape(value, false)
  const reasons: string[] = []
  const reading = readEvent(value)
  for (const p of reading.problems) reasons.push(`${p.reasonCode}: ${p.detail}`)
  if (!namesAnObject(value.event)) reasons.push('x-no-observation: the event names no object; a business step, a sale label, a metadata edit or a token operation alone is not an observation and is never issued as one')
  const type = (EPCIS_EVENT_TYPES as readonly string[]).includes(value.event.type as string) ? (value.event.type as EpcisEventType) : undefined
  for (const binding of value.bindings) {
    const result = staticBinding(binding, value.event, type)
    if (result.status === 'fail') reasons.push(`${result.reasonCode}: ${String(result.detail)}`)
  }
  for (const c of contradictions(value)) reasons.push(`${c.reasonCode}: ${c.detail}`)
  if (reasons.length > 0) throw new Error(`the claim cannot be issued: ${reasons.join('; ')}`)
}

/** Build the envelope from an EPCIS event: the pinned context and event profile digests are filled in, and every issuance rule is applied. */
export function buildEpcisLifecycleClaim(input: BuildEpcisLifecycleClaimInput): EpcisLifecycleClaim {
  const claim: EpcisLifecycleClaim = {
    claimFormat: EPCIS_LIFECYCLE_CLAIM_FORMAT,
    event: input.event,
    eventContext: [
      { iri: EPCIS_LIFECYCLE_CONTEXT.iri, sha256: EPCIS_LIFECYCLE_CONTEXT.sha256 },
      ...(input.extensionContexts ?? []).map((inline) => ({ inline, sha256: sha256Hex(jcsBytes(inline)) })),
    ],
    eventSchema: { uri: EPCIS_LIFECYCLE_EVENT_SCHEMA.uri, sha256: EPCIS_LIFECYCLE_EVENT_SCHEMA.sha256 },
    bindings: input.bindings,
    issuer: input.issuer,
    ...(input.issuerKeyDid == null ? {} : { issuerKeyDid: input.issuerKeyDid }),
    ...(input.issuerParty == null ? {} : { issuerParty: input.issuerParty }),
    assertedRole: input.assertedRole,
    authorityScope: input.authorityScope,
    issuedAt: input.issuedAt,
    ...(input.requiredExtensions == null ? {} : { requiredExtensions: input.requiredExtensions }),
    ...(input.source == null ? {} : { source: input.source }),
  }
  assertEpcisLifecycleClaim(claim)
  return claim
}

function verificationKey(claim: EpcisLifecycleClaim): string {
  return identityKeyFromDidKey(claim.issuerKeyDid ?? claim.issuer)
}

function signatureHolds(claim: SignedEpcisLifecycleClaim): boolean {
  const publicKey = anyone.derivePublicKey(EPCIS_LIFECYCLE_PROTOCOL, EPCIS_LIFECYCLE_KEY_ID, verificationKey(claim))
  return publicKey.verify(epcisLifecycleSigningBytes(claim), Signature.fromDER(claim.signature, 'hex'))
}

/**
 * Sign through the wallet's `createSignature`, under
 * `[1, 'dpp epcis lifecycle v1']`, key identifier `event`, counterparty
 * `anyone`. Every issuance rule is applied first, and the signature is
 * checked against the declared key before the claim is returned.
 */
export async function signEpcisLifecycleClaim(claim: EpcisLifecycleClaim, signer: DataSigner): Promise<SignedEpcisLifecycleClaim> {
  assertEpcisLifecycleClaim(claim)
  const { signature } = await signer.createSignature({
    data: epcisLifecycleSigningBytes(claim), protocolID: EPCIS_LIFECYCLE_PROTOCOL, keyID: EPCIS_LIFECYCLE_KEY_ID, counterparty: 'anyone',
  })
  const signed: SignedEpcisLifecycleClaim = { ...claim, signature: Utils.toHex(signature) }
  envelopeShape(signed, true)
  if (!signatureHolds(signed)) throw new Error('signer does not match the declared issuer key')
  return signed
}

// ---------------------------------------------------------------------------
// Anchoring (spec §8)
// ---------------------------------------------------------------------------

const boundPassportsOf = (claim: EpcisLifecycleClaim): string[] => [...new Set(claim.bindings.map((b) => b.passportId))].sort(compareCodePoints)

/**
 * The anchor metadata for each bound passport, in code point order: one
 * output each, all in one transaction, with that passport as `subject` and the
 * same digest and attestation identifier. `tm_attestation` admits them as it
 * admits any generic anchor; which passports the event concerns is decided by
 * verifying the claim, never by an anchor's subject.
 */
export function epcisLifecycleAnchorMetadata(claim: SignedEpcisLifecycleClaim, anchoredBy: string): AnchorMetadata[] {
  assertEpcisLifecycleClaim((({ signature: _s, ...unsigned }) => unsigned)(claim))
  if (!signatureHolds(claim)) throw new Error('anchor metadata is derived from a claim whose signature holds')
  const digest = epcisLifecycleClaimDigest(claim)
  return boundPassportsOf(claim).map((subject) => ({
    digest, attestationId: `urn:sha256:${digest}`, issuer: claim.issuer, subject,
    attestationType: claim.event.type as string, representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: EPCIS_LIFECYCLE_MEDIA_TYPE, anchoredBy,
  }))
}

/** The anchor locking scripts for every bound passport, signed by the anchoring service, for the caller to place in one transaction. */
export async function buildEpcisLifecycleAnchors(claim: SignedEpcisLifecycleClaim, anchoredBy: string, signer: AnchorSigner): Promise<LockingScript[]> {
  const scripts: LockingScript[] = []
  for (const metadata of epcisLifecycleAnchorMetadata(claim, anchoredBy)) scripts.push(await buildAttestationAnchor(metadata, signer))
  return scripts
}

// ---------------------------------------------------------------------------
// Verification (spec §9)
// ---------------------------------------------------------------------------

const RANK: Record<string, number> = { fail: 0, refused: 0, unavailable: 1, unknown: 2, pass: 3, supported: 3 }
function worst<S extends string>(parts: Array<EpcisLifecycleFinding<S>>, empty: EpcisLifecycleFinding<S>): EpcisLifecycleFinding<S> {
  if (parts.length === 0) return empty
  const sorted = [...parts].sort((a, b) => RANK[a.status] - RANK[b.status])
  const first = sorted[0]
  const details = parts.filter((p) => p.detail !== undefined).map((p) => (p.reasonCode == null ? p.detail : { reasonCode: p.reasonCode, detail: p.detail }))
  return { status: first.status, ...(first.reasonCode == null ? {} : { reasonCode: first.reasonCode }), ...(details.length === 0 ? {} : { detail: details.length === 1 ? (first.detail ?? details[0]) : details }) }
}

async function ask(call: () => PartialCheck | Promise<PartialCheck>): Promise<PartialCheck> {
  try { return await call() } catch (cause) { return { status: 'unknown', reasonCode: 'verifier-not-supplied', detail: message(cause) } }
}
const asCheck = (p: PartialCheck): EpcisLifecycleFinding<EpcisLifecycleCheckStatus> => ({
  status: p.status === 'not-applicable' ? 'unknown' : p.status,
  ...(p.reasonCode == null ? {} : { reasonCode: p.reasonCode }),
  ...(p.detail === undefined ? {} : { detail: p.detail }),
})

/** The event body a duplicate or a conflict is judged by: the event without its repository `recordTime` and its `errorDeclaration`. */
function bodyDigest(event: Record<string, unknown>): string {
  const { recordTime: _rt, errorDeclaration: _ed, ...body } = event
  return sha256Hex(jcsBytes(body))
}

/**
 * How one verified claim stands to another (spec §7). Identical bytes are
 * the same claim. Under one issuer and one `eventID`: different bodies are a
 * conflict, never merged; one body with an `errorDeclaration` added is an
 * error declaration; the same body in other bytes is a restatement. Another
 * issuer's claim about the same `eventID` is its own attestation.
 */
export function epcisLifecycleClaimRelation(a: EpcisLifecycleVerification, b: EpcisLifecycleVerification): EpcisLifecycleRelation {
  if (a.claim == null || b.claim == null || a.findings.signature.status !== 'pass' || b.findings.signature.status !== 'pass') return 'unverified'
  if (a.digest === b.digest) return 'same-claim'
  if (a.eventId == null || a.eventId !== b.eventId) return 'unrelated'
  if (a.claim.issuer !== b.claim.issuer || a.issuerKey !== b.issuerKey) return 'other-issuer'
  if (bodyDigest(a.claim.event) !== bodyDigest(b.claim.event)) return 'conflict'
  if ((a.claim.event.errorDeclaration === undefined) !== (b.claim.event.errorDeclaration === undefined)) return 'error-declaration'
  return 'restatement'
}

function refusedVerification(digest: string, reasonCode: string, cause: unknown): EpcisLifecycleVerification {
  const why = { reasonCode: 'x-bytes-refused', detail: 'the bytes are not a canonical claim, so nothing they say was read' }
  const party: EpcisLifecyclePartyFinding = { status: 'unknown', from: [], to: [], ...why }
  return {
    representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: EPCIS_LIFECYCLE_MEDIA_TYPE, digest,
    boundPassports: [], itemParticipants: [], bindings: [], extensions: [], terms: [], relations: [],
    findings: {
      eventStructure: { status: 'fail', reasonCode, detail: message(cause) },
      eventSemantics: { status: 'unknown', ...why }, productBinding: { status: 'unknown', ...why }, signature: { status: 'unknown', ...why },
      authority: { status: 'unavailable', ...why }, possession: party, ownership: { ...party },
      anchorCommitment: { status: 'unknown', ...why }, inclusion: { status: 'unknown', ...why }, correction: { status: 'unknown', ...why },
    },
  }
}

/**
 * Verify exported bytes and report every finding on its own. Nothing is
 * fetched: the schema check, the extension rules, the product comparison, the
 * authority resolver, the anchors, the header source and the related claims
 * all come from the caller, and each one not supplied leaves its finding
 * `unknown` or `unavailable` with a reason.
 */
export async function verifyEpcisLifecycleClaim(input: number[] | string, options: EpcisLifecycleVerificationOptions = {}): Promise<EpcisLifecycleVerification> {
  const bytes = typeof input === 'string' ? Utils.toArray(input, 'utf8') : input
  const digest = sha256Hex(bytes)
  let claim: SignedEpcisLifecycleClaim
  try {
    claim = parseEpcisLifecycleClaim(bytes, options.maxBytes ?? EPCIS_LIFECYCLE_MAX_BYTES)
  } catch (cause) {
    return refusedVerification(digest, /canonical form/.test(message(cause)) ? 'x-not-canonical' : 'decode-failed', cause)
  }
  const event = claim.event
  const type = (EPCIS_EVENT_TYPES as readonly string[]).includes(event.type as string) ? (event.type as EpcisEventType) : undefined
  const eventId = typeof event.eventID === 'string' ? event.eventID : undefined
  const boundPassports = boundPassportsOf(claim)

  // Signature.
  let issuerKey: string | undefined
  let signature: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  try {
    issuerKey = verificationKey(claim)
    signature = signatureHolds(claim)
      ? { status: 'pass' }
      : { status: 'fail', reasonCode: 'signature-invalid', detail: `the signature does not verify under the key ${claim.issuerKeyDid ?? claim.issuer} derives for [1, 'dpp epcis lifecycle v1'] and the key identifier event` }
  } catch (cause) {
    signature = { status: 'fail', reasonCode: 'signature-invalid', detail: message(cause) }
  }

  // Event structure: the protocol's structural rules, then the caller's pinned schema check.
  const reading = readEvent(claim)
  if (options.expected?.eventId !== undefined && options.expected.eventId !== eventId) reading.problems.push({ reasonCode: 'x-event-id-mismatch', detail: `the event is ${String(eventId)}, not the expected ${options.expected.eventId}` })
  let eventStructure: EpcisLifecycleFinding<EpcisLifecycleCheckStatus>
  if (reading.problems.length > 0) eventStructure = { status: 'fail', reasonCode: reading.problems[0].reasonCode, detail: reading.problems }
  else if (options.eventSchemaValidator == null) eventStructure = { status: 'unknown', reasonCode: 'schema-unavailable', detail: 'the structural rules held; the pinned EPCIS 2.0.1 schema was not applied because no validator was supplied' }
  else eventStructure = asCheck(await ask(() => options.eventSchemaValidator!(event, EPCIS_LIFECYCLE_EVENT_SCHEMA)))

  // Event semantics: an observed object, then every declared extension rule.
  const semanticParts: Array<EpcisLifecycleFinding<EpcisLifecycleSemanticsStatus>> = []
  if (!namesAnObject(event)) semanticParts.push({ status: 'fail', reasonCode: 'x-no-observation', detail: 'the event names no object' })
  for (const rule of claim.requiredExtensions ?? []) {
    const check = options.extensionRules?.[rule]
    if (check == null) semanticParts.push({ status: 'unavailable', reasonCode: 'x-extension-rule-unavailable', detail: `the claim requires the extension rule ${rule}, which this verifier does not hold` })
    else {
      const answer = await ask(() => check(event, claim))
      semanticParts.push({ ...asCheck(answer), detail: { rule, ...(answer.detail === undefined ? {} : { detail: answer.detail }) } })
    }
  }
  const eventSemantics = worst(semanticParts, { status: 'pass', detail: (claim.requiredExtensions ?? []).length === 0 ? 'the event names an observed object and requires no extension rule' : 'every required extension rule held' })

  // Product binding: where each binding says, at the level it says, then the caller's comparison.
  const bindings: EpcisLifecycleBindingResult[] = []
  for (const binding of claim.bindings) {
    const result = staticBinding(binding, event, type)
    if (result.status === 'fail' || options.compareProduct == null || type == null) { bindings.push(result); continue }
    const answer = await ask(() => options.compareProduct!({ passportId: binding.passportId, identifier: binding.identifier, field: binding.field, level: binding.level, eventType: type }))
    const check = asCheck(answer)
    bindings.push({ ...binding, status: check.status, ...(check.reasonCode == null ? {} : { reasonCode: check.reasonCode }), ...(check.detail === undefined ? {} : { detail: check.detail }) })
  }
  const bindingParts: Array<EpcisLifecycleFinding<EpcisLifecycleCheckStatus>> = bindings.map((b) => ({ status: b.status, ...(b.reasonCode == null ? {} : { reasonCode: b.reasonCode }), detail: { passportId: b.passportId, field: b.field, identifier: b.identifier, level: b.level, ...(b.detail === undefined ? {} : { detail: b.detail }) } }))
  if (options.expected?.passportId !== undefined && !boundPassports.includes(options.expected.passportId)) bindingParts.push({ status: 'fail', reasonCode: 'subject-mismatch', detail: `the claim binds ${boundPassports.join(', ')}, not the expected ${options.expected.passportId}` })
  const productBinding = worst(bindingParts, { status: 'unknown', reasonCode: 'no-evidence' })
  const itemParticipants = boundPassports.filter((p) => bindings.some((b) => b.passportId === p && b.level === 'instance' && b.status === 'pass'))

  // Party roles: what the signed event states, each on its own.
  const possession = partyFinding(event, 'possessing_party')
  const ownership = partyFinding(event, 'owning_party')

  // Authority: contradictions refuse; otherwise only the resolver can support it.
  let authority: EpcisLifecycleFinding<EpcisLifecycleAuthorityStatus>
  const refused = contradictions(claim)
  if (refused.length > 0) authority = { status: 'refused', reasonCode: refused[0].reasonCode, detail: refused }
  else if (signature.status !== 'pass' || issuerKey == null || eventId == null || type == null) authority = { status: 'unavailable', reasonCode: 'authority-unavailable', detail: 'authority is not assessed for a claim whose signature or event identity did not hold' }
  else if ((claim.assertedRole === 'owner' || claim.assertedRole === 'custodian') && claim.issuerParty == null && (claim.assertedRole === 'owner' ? ownership : possession).status === 'asserted') {
    authority = { status: 'unavailable', reasonCode: 'x-issuer-party-undeclared', detail: `the issuer asserts ${claim.assertedRole} but declares no issuerParty, so the event's party roles cannot be compared with it` }
  } else if (options.authorityResolver == null) {
    authority = { status: 'unavailable', reasonCode: 'authority-unavailable', detail: 'no authority resolver was supplied; a valid signature establishes which key signed, not that its holder held the asserted role' }
  } else {
    const parts: Array<EpcisLifecycleFinding<EpcisLifecycleAuthorityStatus>> = []
    for (const passportId of claim.authorityScope) {
      let answer: EpcisLifecycleAuthorityAnswer
      try {
        answer = await options.authorityResolver({ purpose: 'claim', role: claim.assertedRole, passportId, issuer: claim.issuer, issuerKey, ...(claim.issuerParty == null ? {} : { issuerParty: claim.issuerParty }), eventId, eventType: type, eventTime: event.eventTime as string, issuedAt: claim.issuedAt })
      } catch (cause) {
        answer = { status: 'unavailable', detail: message(cause) }
      }
      const detail = { passportId, role: claim.assertedRole, ...(answer.detail === undefined ? {} : { detail: answer.detail }) }
      parts.push(answer.status === 'supported' ? { status: 'supported', detail } : answer.status === 'unsupported' ? { status: 'refused', reasonCode: 'authority-unconfirmed', detail } : { status: 'unavailable', reasonCode: 'authority-unavailable', detail })
    }
    authority = worst(parts, { status: 'unavailable', reasonCode: 'authority-unavailable' })
  }

  // Anchor commitment and inclusion, when the caller supplies anchors.
  let anchorCommitment: EpcisLifecycleFinding<EpcisLifecycleCheckStatus> = { status: 'unknown', reasonCode: 'no-evidence', detail: 'no anchor was supplied' }
  let inclusion: EpcisLifecycleFinding<EpcisLifecycleCheckStatus> = { status: 'unknown', reasonCode: 'no-evidence', detail: 'no anchor transaction was supplied' }
  if (options.anchors != null && options.anchors.length > 0) {
    const anchorParts: Array<EpcisLifecycleFinding<EpcisLifecycleCheckStatus>> = []
    const inclusionParts: Array<EpcisLifecycleFinding<EpcisLifecycleCheckStatus>> = []
    const covered = new Set<string>()
    for (const [index, evidence] of options.anchors.entries()) {
      let script: LockingScript | undefined
      try {
        if (evidence.transaction != null) script = evidence.transaction.outputs[evidence.outputIndex ?? 0]?.lockingScript
        else if (evidence.lockingScript != null) script = typeof evidence.lockingScript === 'string' ? LockingScript.fromHex(evidence.lockingScript) : evidence.lockingScript
      } catch { script = undefined }
      const decoded = script == null ? null : decodeAttestationAnchor(script)
      if (decoded == null) { anchorParts.push({ status: 'fail', reasonCode: 'decode-failed', detail: `anchor ${index} is not a valid bsv-attestation-anchor-v1 output` }); continue }
      const mismatches: string[] = []
      if (decoded.digest !== digest) mismatches.push('digest')
      if (decoded.attestationId !== `urn:sha256:${digest}`) mismatches.push('attestationId')
      if (decoded.issuer !== claim.issuer) mismatches.push('issuer')
      if (!boundPassports.includes(decoded.subject)) mismatches.push('subject')
      if (decoded.attestationType !== event.type) mismatches.push('attestationType')
      if (decoded.representation !== EPCIS_LIFECYCLE_REPRESENTATION) mismatches.push('representation')
      if (decoded.mediaType !== EPCIS_LIFECYCLE_MEDIA_TYPE) mismatches.push('mediaType')
      if (mismatches.length > 0) anchorParts.push({ status: 'fail', reasonCode: mismatches[0] === 'digest' ? 'digest-mismatch' : 'metadata-mismatch', detail: { anchor: index, mismatches } })
      else { covered.add(decoded.subject); anchorParts.push({ status: 'pass' }) }
      const tx = evidence.transaction
      if (tx == null) inclusionParts.push({ status: 'unknown', reasonCode: 'proof-absent', detail: `anchor ${index} came without its transaction` })
      else if (tx.merklePath == null) inclusionParts.push({ status: 'unknown', reasonCode: 'proof-absent', detail: `anchor ${index}'s transaction carries no merkle path` })
      else if (options.chainTracker == null) inclusionParts.push({ status: 'unknown', reasonCode: 'header-source-unavailable', detail: 'no header source was supplied' })
      else {
        try {
          const ok = await tx.merklePath.verify(tx.id('hex'), options.chainTracker)
          inclusionParts.push(ok ? { status: 'pass', detail: { anchor: index, blockHeight: tx.merklePath.blockHeight } } : { status: 'fail', reasonCode: 'proof-refuted', detail: `anchor ${index}'s merkle path does not reach a root the header source holds` })
        } catch (cause) {
          inclusionParts.push({ status: 'fail', reasonCode: 'proof-refuted', detail: message(cause) })
        }
      }
    }
    anchorCommitment = worst(anchorParts, anchorCommitment)
    if (anchorCommitment.status === 'pass') anchorCommitment = { status: 'pass', detail: { coveredPassports: [...covered].sort(compareCodePoints), uncoveredPassports: boundPassports.filter((p) => !covered.has(p)) } }
    inclusion = worst(inclusionParts, inclusion)
  }

  const verification: EpcisLifecycleVerification = {
    representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: EPCIS_LIFECYCLE_MEDIA_TYPE, digest, attestationId: `urn:sha256:${digest}`,
    claim, ...(eventId == null ? {} : { eventId }), ...(type == null ? {} : { eventType: type }), issuer: claim.issuer,
    ...(issuerKey == null ? {} : { issuerKey }), identityBinding: claim.issuer.startsWith('did:key:') ? 'key-identified' : 'requires-resolution',
    boundPassports, itemParticipants, bindings, extensions: reading.extensions, terms: reading.terms, relations: [],
    findings: {
      eventStructure, eventSemantics, productBinding, signature, authority, possession, ownership, anchorCommitment, inclusion,
      correction: { status: 'unknown', reasonCode: 'no-evidence', detail: 'no related claims were supplied' },
    },
  }

  // Correction state (spec §7), from the related claims the caller holds.
  if (event.errorDeclaration !== undefined) {
    verification.findings.correction = { status: 'declared-in-error', reasonCode: 'x-self-declared', detail: { declaredBy: verification.attestationId, errorDeclaration: event.errorDeclaration } }
  }
  if (options.related != null) {
    const { related: _related, anchors: _anchors, ...inner } = options
    const others: EpcisLifecycleVerification[] = []
    for (const other of options.related.claims) others.push(await verifyEpcisLifecycleClaim(other, inner))
    verification.relations = others.map((o) => ({ digest: o.digest, relation: epcisLifecycleClaimRelation(verification, o) }))
    if (event.errorDeclaration === undefined) {
      const declarations = others.filter((o) => epcisLifecycleClaimRelation(verification, o) === 'error-declaration' || (epcisLifecycleClaimRelation(verification, o) === 'other-issuer' && o.claim?.event.errorDeclaration !== undefined && bodyDigest(o.claim.event) === bodyDigest(event)))
      const authorised: EpcisLifecycleVerification[] = []
      for (const d of declarations) {
        if (d.claim!.issuer === claim.issuer && d.issuerKey === issuerKey) { authorised.push(d); continue }
        if (options.authorityResolver == null || d.issuerKey == null || type == null || eventId == null) continue
        let all = boundPassports.length > 0
        for (const passportId of boundPassports) {
          let answer: EpcisLifecycleAuthorityAnswer
          try { answer = await options.authorityResolver({ purpose: 'error-declaration', role: d.claim!.assertedRole, passportId, issuer: d.claim!.issuer, issuerKey: d.issuerKey, ...(d.claim!.issuerParty == null ? {} : { issuerParty: d.claim!.issuerParty }), eventId, eventType: type, eventTime: event.eventTime as string, issuedAt: d.claim!.issuedAt }) } catch { answer = { status: 'unavailable' } }
          if (answer.status !== 'supported') all = false
        }
        if (all) authorised.push(d)
      }
      if (authorised.length > 0) {
        const d = authorised[0]
        const declaration = d.claim!.event.errorDeclaration as Record<string, unknown>
        const corrective = Array.isArray(declaration.correctiveEventIDs) ? (declaration.correctiveEventIDs as string[]) : []
        verification.findings.correction = {
          status: 'declared-in-error',
          detail: { declaredBy: d.attestationId, errorDeclaration: declaration, correctiveClaims: others.filter((o) => o.findings.signature.status === 'pass' && o.eventId != null && corrective.includes(o.eventId)).map((o) => o.attestationId) },
        }
      } else if (declarations.length > 0) {
        verification.findings.correction = { status: 'unknown', reasonCode: 'x-declaration-unauthorised', detail: { declaredBy: declarations.map((d) => d.attestationId), why: 'another issuer declared the event in error and no authority resolver supports that issuer for every bound passport' } }
      } else if (options.related.complete) {
        verification.findings.correction = { status: 'none', detail: 'no verified claim among the complete set supplied declares this event in error' }
      } else {
        verification.findings.correction = { status: 'unknown', reasonCode: 'x-related-incomplete', detail: 'no declaration was among the claims supplied, and the caller did not say they were complete' }
      }
    }
  }
  return verification
}

// ---------------------------------------------------------------------------
// The verification report (spec/verification.md)
// ---------------------------------------------------------------------------

/**
 * The verifier `verifyPassportEvidence` takes as `credentialVerifier` for
 * this representation. The report's check names are frozen, so the findings
 * travel under the existing checks with their precise cause: `proof` is the
 * signature; `schema` is event structure, event semantics and product binding;
 * `time` is the event and issue times; `status` is the correction state; and
 * `authority` is the authority finding. `subjects` are the bound passports, so
 * an anchor's subject is compared with them; item participation is in the
 * detail and in `verifyEpcisLifecycleClaim`'s result. Any other
 * representation is `representation-unsupported`.
 */
export function epcisLifecycleCredentialVerifierFor(options: EpcisLifecycleVerificationOptions = {}): ExternalCredentialVerifier {
  return async (input) => {
    if (input.representation !== EPCIS_LIFECYCLE_REPRESENTATION) {
      const u: PartialCheck = { status: 'unknown', reasonCode: 'representation-unsupported', detail: input.representation }
      return { proof: u, schema: u, time: u, status: u, authority: u }
    }
    const v = await verifyEpcisLifecycleClaim(input.bytes, options)
    return epcisLifecycleReportEntries(v)
  }
}

/** One verification as the report's credential entries, each carrying the precise finding in `detail`. */
export function epcisLifecycleReportEntries(v: EpcisLifecycleVerification): ExternalCredentialVerification {
  const f = v.findings
  const check = (finding: EpcisLifecycleFinding<string>, name: string): PartialCheck => {
    const status = finding.status === 'pass' || finding.status === 'supported' ? 'pass'
      : finding.status === 'fail' || finding.status === 'refused' ? 'fail' : 'unknown'
    const reasonCode = status === 'pass' ? undefined
      : finding.reasonCode == null ? 'verifier-not-supplied'
        : finding.reasonCode
    return { status, ...(reasonCode == null ? {} : { reasonCode }), detail: { finding: name, status: finding.status, ...(finding.detail === undefined ? {} : { detail: finding.detail }) } }
  }
  const schemaParts = [check(f.eventStructure, 'eventStructure'), check(f.eventSemantics, 'eventSemantics'), check(f.productBinding, 'productBinding')]
  const order: Record<string, number> = { fail: 0, unknown: 1, pass: 2 }
  const schemaWorst = [...schemaParts].sort((a, b) => order[a.status] - order[b.status])[0]
  const correction: PartialCheck = f.correction.status === 'declared-in-error'
    ? { status: 'fail', reasonCode: 'x-declared-in-error', detail: f.correction.detail }
    : f.correction.status === 'none' ? { status: 'pass', detail: f.correction.detail } : { status: 'unknown', reasonCode: f.correction.reasonCode ?? 'no-evidence', detail: f.correction.detail }
  const event = v.claim?.event
  const time: PartialCheck = event == null ? { status: 'unknown', reasonCode: 'decode-failed' }
    : f.eventStructure.status === 'fail' && JSON.stringify(f.eventStructure.detail ?? '').includes('x-issued-before-event') ? { status: 'fail', reasonCode: 'time-invalid', detail: { eventTime: event.eventTime, issuedAt: v.claim!.issuedAt } }
      : validTimestamp(event.eventTime) ? { status: 'pass', detail: { eventTime: event.eventTime, issuedAt: v.claim!.issuedAt } } : { status: 'fail', reasonCode: 'time-invalid' }
  return {
    ...(v.attestationId == null ? {} : { id: v.attestationId }),
    ...(v.issuer == null ? {} : { issuer: v.issuer }),
    subjects: v.boundPassports,
    ...(v.eventType == null ? {} : { attestationType: v.eventType }),
    proof: check(f.signature, 'signature'),
    schema: { ...schemaWorst, detail: { parts: schemaParts.map((p) => p.detail), itemParticipants: v.itemParticipants } },
    time,
    status: correction,
    authority: check(f.authority, 'authority'),
  }
}
