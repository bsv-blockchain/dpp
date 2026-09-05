import { randomUUID } from 'node:crypto';
import { SEAL_CONTEXTS } from './context.js';
import { validateSealStructure } from './validation.js';
import type { JsonObject, ProductIdentifier, Seal, StatusEntry } from './types.js';
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
  const disposition = typeof event.disposition === 'string' ? event.disposition.replace(/^urn:epcglobal:cbv:disp:|^https:\/\/ref.gs1.org\/cbv\/Disp-/, '') : undefined;
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
