import { randomUUID } from 'node:crypto';
import { SEAL_CONTEXTS } from './context.js';
import { validateSealStructure } from './validation.js';
import type { JsonObject, ProductIdentifier, Seal, StatusEntry } from './types.js';
import { EPCIS_MAPPING_PROFILES, EPCIS_SOURCE_VOCABULARY, type EpcisMappingProfile, type EpcisSourceReference, type EpcisValidationFindings } from './epcis-source.js';
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
  /** The mapping profile the outcome was decided under. */
  profile: EpcisMappingProfile;
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
 * semantics a verifier evaluates. Each name matches a mappingLimits entry
 * of epcis-vsc@1 and of epcis-vsc@2 so a result can cite it.
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

/* ------------------------- the CBV 2.0 crosswalk ------------------------ */

/**
 * How a CBV 2.0 disposition (section 7.2.3) bears on the custody state
 * machine of vsc-draft-compat@0.1.0 (spec/vsc-profile.md section 5): `origin`
 * (Q1), `transit` (Q2) and `terminal` (Q4) are dispositions the VSC terms
 * share with CBV, so a SEAL carries them verbatim where the event's type and
 * action agree with the state (only a commissioning ObjectEvent enters the
 * origin, and a commissioning or decommissioning one is never in transit);
 * `neutral` records a condition and no custody state; `unnamed-transition`
 * records a custody change for which no VSC term is a CBV value. CBV has no
 * disposition for the destination state (Q3), whose only VSC term is
 * `received`.
 */
export type CbvCustodyEffect = 'origin' | 'transit' | 'terminal' | 'neutral' | 'unnamed-transition';

/**
 * Every CBV 2.0 disposition, including those section 7.2.3.1 deprecates (each
 * classified as the value that replaces it), with its custody effect under
 * epcis-vsc@2. The profile manifest records the same table, and a test holds
 * the two equal.
 */
export const CBV_DISPOSITION_CROSSWALK: Readonly<Record<string, Readonly<{ effect: CbvCustodyEffect; replacedBy?: string }>>> = Object.freeze({
  active: { effect: 'origin' },
  available: { effect: 'neutral' },
  completeness_inferred: { effect: 'neutral' },
  completeness_verified: { effect: 'neutral' },
  conformant: { effect: 'neutral' },
  container_closed: { effect: 'neutral' },
  container_open: { effect: 'neutral' },
  damaged: { effect: 'neutral' },
  destroyed: { effect: 'terminal' },
  dispensed: { effect: 'terminal' },
  disposed: { effect: 'unnamed-transition' },
  encoded: { effect: 'neutral' },
  expired: { effect: 'neutral' },
  in_progress: { effect: 'neutral' },
  in_transit: { effect: 'transit' },
  inactive: { effect: 'unnamed-transition' },
  mismatch_class: { effect: 'neutral' },
  mismatch_instance: { effect: 'neutral' },
  mismatch_quantity: { effect: 'neutral' },
  needs_replacement: { effect: 'neutral' },
  no_pedigree_match: { effect: 'neutral' },
  non_conformant: { effect: 'neutral' },
  non_sellable_other: { effect: 'neutral' },
  partially_dispensed: { effect: 'unnamed-transition' },
  recalled: { effect: 'neutral' },
  reserved: { effect: 'neutral' },
  retail_sold: { effect: 'unnamed-transition' },
  returned: { effect: 'transit' },
  sellable_accessible: { effect: 'neutral' },
  sellable_not_accessible: { effect: 'neutral' },
  stolen: { effect: 'unnamed-transition' },
  unavailable: { effect: 'neutral' },
  unknown: { effect: 'neutral' },
  non_sellable_expired: { effect: 'neutral', replacedBy: 'expired' },
  non_sellable_damaged: { effect: 'neutral', replacedBy: 'damaged' },
  non_sellable_disposed: { effect: 'unnamed-transition', replacedBy: 'disposed' },
  non_sellable_no_pedigree_match: { effect: 'neutral', replacedBy: 'no_pedigree_match' },
  non_sellable_recalled: { effect: 'neutral', replacedBy: 'recalled' },
});

const CBV_DISPOSITION_PREFIX = /^urn:epcglobal:cbv:disp:|^https:\/\/ref\.gs1\.org\/cbv\/Disp-/;
const CBV_BIZSTEP_PREFIX = /^urn:epcglobal:cbv:bizstep:|^https:\/\/ref\.gs1\.org\/cbv\/BizStep-/;
const bizStepTerm = (value: unknown): string | undefined => (typeof value === 'string' ? value.replace(CBV_BIZSTEP_PREFIX, '') : undefined);
type Refusal = { mapping: 'unsupported' | 'insufficient-data'; missing: string[] };

/**
 * epcis-vsc@1's maintenance-observation limit, as its manifest publishes it:
 * an observation (an OBSERVE event, or a TransformationEvent, whose action is
 * the caller's decision rather than a source fact) at an inspection, repair or
 * sensor reading step that reports the disposition `active` records no
 * custody transition. In the VSC custody model `active` is the origin state,
 * which no transition enters, so a SEAL for it would either assert a new
 * custody origin or be refused as a prohibited step. An ObjectEvent whose
 * action is ADD or DELETE commissions or decommissions its objects and is not
 * an observation, and a maintenance step that reports a custody state (a
 * sensor reading in transit) is a custody step: both map as before.
 */
const MAINTENANCE_STEPS = new Set(['inspecting', 'repairing', 'sensor_reporting']);
function maintenanceObservation(event: JsonObject, seal: Seal): string | undefined {
  const step = bizStepTerm(event.bizStep);
  if (step == null || !MAINTENANCE_STEPS.has(step) || seal.eventVector.how.disposition !== 'active') return undefined;
  if (event.type !== 'TransformationEvent' && seal.eventVector.how.action !== 'OBSERVE') return undefined;
  return `maintenance-observation: business step ${JSON.stringify(event.bizStep)} with disposition "active" records no custody transition, and the VSC custody rules are not changed to admit it`;
}

/**
 * epcis-vsc@2's decision before any SEAL is built: the event type and the
 * action first, because the crosswalk reads them; then an error declaration,
 * which retracts a prior event rather than recording a step; then the
 * disposition through the crosswalk, with the business step that names a
 * hand-over at the destination. Undefined means the event goes on to the
 * mapping and its remaining checks, exactly as under epcis-vsc@1.
 */
function crosswalkRefusal(event: JsonObject, options: EpcisMappingOptions): Refusal | undefined {
  if (typeof event.type !== 'string' || !EPCIS_TYPES.includes(event.type as typeof EPCIS_TYPES[number])) return classifyFailure(event, 'Unsupported EPCIS event type');
  const action = event.type === 'TransformationEvent' ? options.transformationAction : event.action;
  if (!['ADD', 'OBSERVE', 'DELETE'].includes(action as string)) return classifyFailure(event, 'An explicit supported action mapping is required');
  // EPCIS 2.0 section 7.4.1.2: the event asserts that the prior event's assertions are in error, not that its step happened.
  if (event.errorDeclaration !== undefined) return { mapping: 'unsupported', missing: ['error-declaration: the event carries an EPCIS error declaration, which asserts that the prior event it repeats is in error rather than that its step happened; a SEAL would assert the step the source retracted, and only a VSC correction retracts a SEAL'] };
  const step = bizStepTerm(event.bizStep);
  const destination = (what: string): Refusal => ({ mapping: 'unsupported', missing: [`custody-destination-unnamed: business step ${JSON.stringify(event.bizStep)} with ${what} records a hand-over at the destination, the VSC state Q3, whose only VSC term received is not a CBV disposition`] });
  const atDestination = step === 'receiving' || step === 'accepting';
  if (typeof event.disposition !== 'string') {
    // EPCIS 2.0 section 7.3.6.2.1: an omitted disposition leaves the disposition unchanged.
    if (action !== 'OBSERVE') return undefined;
    if (atDestination) return destination('no disposition');
    return { mapping: 'unsupported', missing: ['custody-neutral: an OBSERVE event without a disposition leaves the disposition unchanged and records no custody state; every SEAL carries one of the nine VSC custody terms, and none is substituted for a state the event did not record'] };
  }
  const term = event.disposition.replace(CBV_DISPOSITION_PREFIX, '');
  const entry = Object.hasOwn(CBV_DISPOSITION_CROSSWALK, term) ? CBV_DISPOSITION_CROSSWALK[term] : undefined;
  if (entry == null) return { mapping: 'unsupported', missing: [`non-cbv-disposition: disposition ${JSON.stringify(event.disposition)} is not a CBV 2.0 disposition; this profile carries CBV values only and never writes a VSC-only term for one`] };
  // EPCIS 2.0 section 7.4.2: an ObjectEvent ADD commissions its objects and an ObjectEvent DELETE decommissions them; on the other event types the action adds to or removes from an aggregation, association or business transaction.
  const commissioning = event.type === 'ObjectEvent' && action === 'ADD';
  const decommissioning = event.type === 'ObjectEvent' && action === 'DELETE';
  if (entry.effect === 'origin' && commissioning) return undefined;
  if (entry.effect === 'transit' || entry.effect === 'terminal') {
    if (commissioning) return { mapping: 'unsupported', missing: [`lifecycle-conflict: an ObjectEvent whose action is ADD commissions its objects, so its SEAL can only open their custody chain at the origin, and disposition ${JSON.stringify(term)} is not the origin`] };
    if (decommissioning && entry.effect === 'transit') return { mapping: 'unsupported', missing: [`lifecycle-conflict: an ObjectEvent whose action is DELETE decommissions its objects, which do not exist after it, so disposition ${JSON.stringify(term)} cannot place them in transit`] };
    return undefined;
  }
  if (entry.effect === 'unnamed-transition') return { mapping: 'unsupported', missing: [`custody-transition-unnamed: disposition ${JSON.stringify(term)} records a custody change for which no VSC term is a CBV value; carrying it fails the SEAL schema and no VSC term is substituted`] };
  if (atDestination) return destination(`disposition ${JSON.stringify(term)}`);
  if (entry.effect === 'origin') {
    if (event.type === 'TransformationEvent') return { mapping: 'unsupported', missing: ['custody-neutral: disposition "active" on a TransformationEvent records no custody state a SEAL can carry: the SEAL would carry the inputs, which exist before the transformation, as a new custody chain at the origin, and the VSC term for a transformation step, transformed, is not a CBV value'] };
    // On the other event types the action concerns an aggregation, association or business transaction, never the objects' existence.
    const what = event.type === 'ObjectEvent' ? `an ObjectEvent whose action is ${action as string}` : `${event.type === 'AggregationEvent' || event.type === 'AssociationEvent' ? 'an' : 'a'} ${event.type} (action ${action as string}), whose objects exist before it,`;
    return { mapping: 'unsupported', missing: [`custody-neutral: disposition "active" on ${what} records no custody step; active is the VSC origin state, which only an ObjectEvent that commissions its objects (action ADD) enters, and a SEAL carrying it would open a new custody chain for objects that already exist`] };
  }
  return { mapping: 'unsupported', missing: [`custody-neutral: disposition ${JSON.stringify(term)} records a condition and no custody state; every SEAL carries one of the nine VSC custody terms, and none is substituted for a state the event did not record`] };
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
 *
 * `profile` selects the mapping profile: `epcis-vsc@1` by default, or
 * `epcis-vsc@2`, which refuses an error declaration and decides the
 * disposition through `CBV_DISPOSITION_CROSSWALK` before the mapping, naming
 * each refusal by the mapping limit it cites. A source reference must name the
 * same profile.
 */
export function mapEpcisEventWithReport(event: JsonObject, options: EpcisMappingOptions, report: { sourceReference?: EpcisSourceReference; validation?: EpcisValidationFindings; profile?: EpcisMappingProfile } = {}): EpcisMappingReport {
  const profile = report.profile ?? 'epcis-vsc@1';
  if (!(EPCIS_MAPPING_PROFILES as readonly string[]).includes(profile)) throw new Error(`mapping profile ${String(profile)} is not one this package implements`);
  const preserved = Object.keys(event).filter((key) => key !== 'type');
  const base = { profile, preserved, ...(report.validation == null ? {} : { validation: report.validation }) };
  if (profile === 'epcis-vsc@2') {
    const refusal = crosswalkRefusal(event, options);
    if (refusal != null) return { ...refusal, unmapped: [], ...base };
  }
  let seal: Seal;
  try {
    seal = mapEpcisEvent(event, options);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ...classifyFailure(event, message), unmapped: [], ...base };
  }
  if (profile === 'epcis-vsc@1') {
    const maintenance = maintenanceObservation(event, seal);
    if (maintenance != null) return { mapping: 'unsupported', missing: [maintenance], unmapped: [], ...base };
  }
  if (report.sourceReference != null) {
    if (report.sourceReference.vocabularyUrn !== EPCIS_SOURCE_VOCABULARY) throw new Error('a source reference carries the epcis-source vocabulary');
    if (report.sourceReference.mappingProfile !== profile) throw new Error(`a source reference names the mapping profile the report is made under, here ${profile}`);
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
