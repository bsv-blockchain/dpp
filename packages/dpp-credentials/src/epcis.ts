import { randomUUID } from 'node:crypto';
import { SEAL_CONTEXTS } from './context.js';
import { validateSealStructure } from './validation.js';
import type { JsonObject, ProductIdentifier, Seal, StatusEntry } from './types.js';
import { EPCIS_SOURCE_VOCABULARY, type EpcisSourceReference, type EpcisValidationFindings } from './epcis-source.js';
export const EPCIS_VOCABULARY = 'urn:bsv:vsc:vocab:epcis-roundtrip:0.1.0';
export const EPCIS_TYPES = ['ObjectEvent','AggregationEvent','TransformationEvent','TransactionEvent','AssociationEvent'] as const;
export interface EpcisMappingOptions {
  id?: string; issuer: string; assertionMethod: string; actorRole: string;
  jurisdiction: string; issuedAt: string; recordedAt?: string; validUntil?: string;
  credentialStatus: StatusEntry; chainOfCustody: Seal['chainOfCustody'];
  /** EPCIS TransformationEvent has no action. Its VSC action requires an explicit mapping decision. */
  transformationAction?: 'ADD' | 'OBSERVE' | 'DELETE';
}
/** Retains the complete source event in a signed JSON extension, allowing lossless round trips. */
export function mapEpcisEvent(event: JsonObject, options: EpcisMappingOptions): Seal {
  if (typeof event.type !== 'string' || !EPCIS_TYPES.includes(event.type as typeof EPCIS_TYPES[number])) throw new Error('Unsupported EPCIS event type');
  const identifiers: ProductIdentifier[] = [];
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !/^(urn:epc:|https:\/\/)/.test(value)) throw new Error('Product identifier requires a supported EPCIS URI');
    if (!identifiers.some(p => p.value === value)) identifiers.push({ scheme: 'EPC', value, schemeAuthority: 'GS1' });
  };
  const idFields = event.type === 'TransformationEvent' ? ['inputEPCList','outputEPCList'] : event.type === 'AggregationEvent' || event.type === 'AssociationEvent' ? ['childEPCs'] : ['epcList'];
  for (const field of idFields) {
    if (event[field] !== undefined && !Array.isArray(event[field])) throw new Error(`Invalid ${field}`);
    for (const value of (event[field] as unknown[] | undefined) ?? []) add(value);
  }
  if (event.parentID !== undefined) add(event.parentID);
  for (const field of ['quantityList','inputQuantityList','outputQuantityList','childQuantityList']) {
    if (event[field] !== undefined && !Array.isArray(event[field])) throw new Error(`Invalid ${field}`);
    for (const item of (event[field] as JsonObject[] | undefined) ?? []) {
      if (!item || typeof item !== 'object' || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity < 0) throw new Error(`Invalid ${field} quantity`);
      add(item.epcClass);
    }
  }
  if (!identifiers.length) throw new Error('Insufficient product identifiers for VSC mapping');
  const disposition = typeof event.disposition === 'string' ? event.disposition.replace(/^urn:epcglobal:cbv:disp:|^https:\/\/ref\.gs1\.org\/cbv\/Disp-/, '') : undefined;
  if (typeof event.eventTime !== 'string' || typeof event.eventTimeZoneOffset !== 'string' || typeof event.bizStep !== 'string' || !disposition) throw new Error('Event time, timezone, business step and disposition are required; they are never fabricated');
  const action = event.type === 'TransformationEvent' ? options.transformationAction : event.action;
  if (!['ADD','OBSERVE','DELETE'].includes(action as string)) throw new Error('An explicit supported action mapping is required');
  const recordedAt = event.recordTime ?? options.recordedAt;
  if (typeof recordedAt !== 'string') throw new Error('Recorded time is required');
  const id = options.id ?? `urn:uuid:${randomUUID()}`;
  const seal: Seal = {
    '@context': [...SEAL_CONTEXTS], type: ['VerifiableCredential','VSC-SEAL'], id,
    issuer: options.issuer, issuanceDate: options.issuedAt, validFrom: options.issuedAt,
    ...(options.validUntil ? { validUntil: options.validUntil } : {}), sealVersion: '1.0', sealTimestamp: options.issuedAt, correctionOf: null,
    credentialSubject: { id, ...(options.chainOfCustody.parentSeals.length ? { predecessorCredentials: [...options.chainOfCustody.parentSeals] } : {}) },
    credentialStatus: structuredClone(options.credentialStatus),
    eventVector: {
      what: { productIdentifiers: identifiers },
      when: { eventTime: event.eventTime, recordedAt, timezone: event.eventTimeZoneOffset, timePrecision: /\.\d+/.test(event.eventTime) ? 'millisecond' : 'second' },
      where: { jurisdiction: options.jurisdiction, ...(event.readPoint ? { readPoint: structuredClone(event.readPoint) } : {}), ...(event.bizLocation ? { businessLocation: structuredClone(event.bizLocation) } : {}) },
      who: { actorDid: options.issuer, actorRole: options.actorRole, assertionMethod: options.assertionMethod },
      how: { eventType: event.type, eventTypeVocab: 'urn:epcis:cbv:v2', businessStep: event.bizStep, disposition, action: action as 'ADD' | 'OBSERVE' | 'DELETE' },
    },
    extensions: { '+Dn': { '+D1': { vocabularyUrn: EPCIS_VOCABULARY, event: structuredClone(event) } } },
    chainOfCustody: structuredClone(options.chainOfCustody),
  };
  const result = validateSealStructure(seal, { requireProof: false });
  if (!result.valid) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('; '));
  return seal;
}
/** Extraction preserves source data; callers must verify the credential before trusting it. */
export function extractEpcisEvent(seal: Seal): JsonObject {
  const source = Object.values(seal.extensions['+Dn']).find(v => v.vocabularyUrn === EPCIS_VOCABULARY);
  if (!source || !source.event || typeof source.event !== 'object' || Array.isArray(source.event)) throw new Error('No supported EPCIS round-trip mapping');
  return structuredClone(source.event) as JsonObject;
}

/* ------------------------- explicit mapping report ---------------------- */


export type EpcisMappingOutcome = 'lossless' | 'transformed' | 'unsupported' | 'insufficient-data';

export interface EpcisMappingReport {
  /** lossless: every source semantic the profile knows is carried; transformed: carried with the named losses; unsupported: the profile cannot express the event or a decision is missing; insufficient-data: the source lacks a required input that is never fabricated. */
  mapping: EpcisMappingOutcome;
  /** The unsigned SEAL, present for lossless and transformed only. */
  seal?: Seal;
  /** What the source lacks (insufficient-data) or what decision or feature is missing (unsupported). */
  missing: string[];
  /** Source semantics the SEAL's event vector does not carry and only the round-trip extension retains. */
  unmapped: string[];
  /** Source members retained in the signed round-trip extension. */
  preserved: string[];
  validation?: EpcisValidationFindings;
}

/**
 * Members whose meaning the VSC profile does not carry in its event vector:
 * present in the round-trip extension, absent from any custody or event
 * semantics a verifier evaluates. Each name matches an epcis-vsc@1
 * mappingLimits entry so a result can cite it.
 */
const TRANSFORMED_MEMBERS: Record<string, string> = {
  sensorElementList: 'sensor-elements',
  sourceList: 'source-destination-parties',
  destinationList: 'source-destination-parties',
  bizTransactionList: 'business-transactions',
  persistentDisposition: 'persistent-disposition',
  ilmd: 'instance-lot-master-data',
  certificationInfo: 'certification-info',
  errorDeclaration: 'error-declaration',
  transformationID: 'transformation-id',
  quantityList: 'quantities',
  childQuantityList: 'quantities',
  inputQuantityList: 'quantities',
  outputQuantityList: 'quantities',
  '@context': 'event-level-context',
};
const CARRIED_MEMBERS = new Set(['type', 'eventTime', 'eventTimeZoneOffset', 'recordTime', 'eventID', 'action', 'bizStep', 'disposition', 'readPoint', 'bizLocation', 'epcList', 'childEPCs', 'parentID', 'inputEPCList', 'outputEPCList']);

function classifyFailure(event: JsonObject, message: string): { mapping: 'unsupported' | 'insufficient-data'; missing: string[] } {
  if (message.startsWith('Unsupported EPCIS event type')) return { mapping: 'unsupported', missing: [`event type ${JSON.stringify(event.type)} is outside the five types the profile maps`] };
  if (message.startsWith('An explicit supported action mapping is required')) {
    return { mapping: 'unsupported', missing: [event.type === 'TransformationEvent' ? 'a TransformationEvent has no action; the mapping decision transformationAction was not supplied' : `action ${JSON.stringify(event.action)} is not ADD, OBSERVE or DELETE`] };
  }
  if (message.startsWith('Insufficient product identifiers')) return { mapping: 'insufficient-data', missing: ['no product identifier the profile carries'] };
  if (message.startsWith('Product identifier requires a supported EPCIS URI')) return { mapping: 'unsupported', missing: ['an identifier is neither an EPC URN nor an HTTPS URI'] };
  if (message.startsWith('Event time, timezone, business step and disposition are required')) {
    const missing: string[] = [];
    if (typeof event.eventTime !== 'string') missing.push('eventTime');
    if (typeof event.eventTimeZoneOffset !== 'string') missing.push('eventTimeZoneOffset');
    if (typeof event.bizStep !== 'string') missing.push('bizStep');
    if (typeof event.disposition !== 'string') missing.push('disposition');
    return { mapping: 'insufficient-data', missing: missing.length ? missing : ['eventTime, eventTimeZoneOffset, bizStep or disposition'] };
  }
  if (message.startsWith('Recorded time is required')) return { mapping: 'insufficient-data', missing: ['recordTime, and no recordedAt was supplied'] };
  if (/disposition/.test(message)) return { mapping: 'unsupported', missing: [`disposition ${JSON.stringify(event.disposition)} is not one the VSC profile's custody model names`] };
  if (/quantity/.test(message)) return { mapping: 'unsupported', missing: ['a quantity element is not a finite non-negative number'] };
  return { mapping: 'unsupported', missing: [message] };
}

/**
 * The explicit outcome of mapping one EPCIS event into the VSC profile.
 * Wraps `mapEpcisEvent` without changing it: a refusal becomes a named
 * outcome rather than an exception, a success is `lossless` only when the
 * event carries nothing the profile cannot express, and a supplied source
 * reference is signed into the SEAL beside the round-trip extension so the
 * credential names the exact bytes and pointer it was mapped from. The SEAL
 * is unsigned and unpublished: issuance is a separate, separately authorised
 * step that also requires issuer, status and custody evidence.
 */
export function mapEpcisEventWithReport(event: JsonObject, options: EpcisMappingOptions, report: { sourceReference?: EpcisSourceReference; validation?: EpcisValidationFindings } = {}): EpcisMappingReport {
  const preserved = Object.keys(event).filter((key) => key !== 'type');
  const base = { preserved, ...(report.validation == null ? {} : { validation: report.validation }) };
  let seal: Seal;
  try {
    seal = mapEpcisEvent(event, options);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ...classifyFailure(event, message), unmapped: [], ...base };
  }
  if (report.sourceReference != null) {
    if (report.sourceReference.vocabularyUrn !== EPCIS_SOURCE_VOCABULARY) throw new Error('a source reference carries the epcis-source vocabulary');
    seal.extensions['+Dn'][EPCIS_SOURCE_VOCABULARY] = structuredClone(report.sourceReference);
    const check = validateSealStructure(seal, { requireProof: false });
    if (!check.valid) throw new Error(check.errors.map(e => `${e.path}: ${e.message}`).join('; '));
  }
  const unmapped = new Set<string>();
  for (const key of Object.keys(event)) {
    if (CARRIED_MEMBERS.has(key)) continue;
    unmapped.add(TRANSFORMED_MEMBERS[key] ?? `extension:${key}`);
  }
  if (event.type === 'TransformationEvent') unmapped.add('transformation-action-decision');
  const identifierCount = seal.eventVector.what.productIdentifiers.length;
  if (identifierCount > 1) unmapped.add('multi-product-event');
  return { mapping: unmapped.size === 0 ? 'lossless' : 'transformed', seal, missing: [], unmapped: [...unmapped].sort(), ...base };
}
