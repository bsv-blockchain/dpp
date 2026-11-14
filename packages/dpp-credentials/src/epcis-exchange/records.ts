/**
 * The durable records of an EPCIS exchange, their versions and their keys.
 *
 * Every record type carries its own version, and a JSON Schema under
 * `contracts/` describes each: the import record in
 * `contracts/epcis-import.schema.json`, the rest in
 * `contracts/epcis-exchange-records.schema.json`. A record is plain JSON so
 * that a later recovery export can carry it as it is stored.
 *
 * Three kinds of identifier appear here and are never interchanged:
 *
 * - an event's own `eventID`, exactly as its source declares it and scoped
 *   to the configured `sourceId` (`identityKind: 'event-id'`);
 * - a local ingestion identity, assigned here to an event that declares no
 *   `eventID` (`identityKind: 'local'`);
 * - identifiers of this module's own records (`importId`, `conflictId`,
 *   `resolutionId`), each a URN that names what it is.
 *
 * None of them is a GS1 CBV Event Hash ID. This module computes no event
 * hash and never presents an `eventID`, a body digest or a local identity as
 * one. An `eventID` that happens to be written in that form is still only
 * the identifier its source declared.
 */
import {
  classifyEpcisIdentifier,
  EPCIS_EVENT_TYPES,
  type EpcisFinding,
  type EpcisIdentifierFinding,
} from '../epcis-source.js';
import { canonicalizeJcs } from '../jcs.js';
import type { JsonObject } from '../types.js';
import { sha256Hex } from './storage.js';

/* --------------------------------- kinds --------------------------------- */

/** The storage kinds this module writes. A later feature adds its own beside them. */
export const EPCIS_RECORD_KINDS = {
  /** One import record per acknowledged request. */
  import: 'import',
  /** Which imports hold which retained bytes, so bytes two imports share are never removed for one of them. Rebuildable from the import records. */
  retention: 'retention',
  /** One record per distinct observation of an event under its scoped identity. */
  observation: 'observation',
  /** Conflict decisions. Not rebuildable from any source. */
  resolution: 'resolution',
  /** The associations index. Rebuildable from the import records and the retained bytes. */
  association: 'association',
  /** Work that has begun and is not finished: what recovery reads. */
  journal: 'journal',
} as const;

export const EPCIS_IMPORT_VERSION = '2';
export const EPCIS_RECORD_VERSION = '1';

/* ------------------------------ identifiers ------------------------------ */

const digestOf = (value: unknown): string => sha256Hex(canonicalizeJcs(value));

/** The storage key of an import: one per source scope and request identifier, so a repeated request finds the record of the first. */
export function epcisImportKey(sourceId: string, requestId: string): string {
  return digestOf(['import', sourceId, requestId]);
}

/** The stable identity of an import, derived from its source scope and request identifier. */
export function epcisImportId(sourceId: string, requestId: string): string {
  return `urn:bsv:dpp:epcis:import:sha256:${epcisImportKey(sourceId, requestId)}`;
}

const IMPORT_ID = /^urn:bsv:dpp:epcis:import:sha256:([0-9a-f]{64})$/;
const CONFLICT_ID = /^urn:bsv:dpp:epcis:conflict:sha256:([0-9a-f]{64})$/;

export function importKeyOf(importId: string): string | undefined {
  return IMPORT_ID.exec(importId)?.[1];
}

/**
 * The digest a request identifier is bound to: the source scope, the media
 * type, the exact length and the SHA-256 of the bytes. Receipt time,
 * provenance and the policy in force are not part of it, so a retry that
 * differs only in those is the same request.
 */
export function epcisRequestDigest(request: { sourceId: string; mediaType: string; byteLength: number; sha256: string }): string {
  return digestOf({ byteLength: request.byteLength, mediaType: request.mediaType, sha256: request.sha256, sourceId: request.sourceId });
}

export type EpcisIdentityKind = 'event-id' | 'local';

/**
 * The key every observation of one event is filed under: the source scope,
 * the kind of identity and the identity. The kind is part of it so that an
 * `eventID` written to look like a local identity stays a different event,
 * and the source scope is part of it so that two sources that use one
 * `eventID` are never merged.
 */
export function epcisEventScopeKey(sourceId: string, identityKind: EpcisIdentityKind, identity: string): string {
  return digestOf(['event', sourceId, identityKind, identity]);
}

/** The identity of the conflict among the bodies held under one scoped event identity. */
export function epcisConflictId(sourceId: string, identityKind: EpcisIdentityKind, identity: string): string {
  return `urn:bsv:dpp:epcis:conflict:sha256:${epcisEventScopeKey(sourceId, identityKind, identity)}`;
}

export function conflictScopeKeyOf(conflictId: string): string | undefined {
  return CONFLICT_ID.exec(conflictId)?.[1];
}

const padded = (value: number, width: number): string => String(value).padStart(width, '0');

export const observationKey = (scopeKey: string, sequence: number): string => `${scopeKey}.${padded(sequence, 10)}`;
export const resolutionKey = (scopeKey: string, sequence: number): string => `${scopeKey}.${padded(sequence, 10)}`;
export const retentionKey = (sha256: string, importKey: string): string => `${sha256}.${importKey}`;
export const importJournalKey = (importKey: string): string => `import.${importKey}`;
export const resolutionJournalKey = (scopeKey: string): string => `resolution.${scopeKey}`;
export const discardJournalKey = (sha256: string): string => `discard.${sha256}`;
export const REBUILD_JOURNAL_KEY = 'rebuild.associations';

/* ------------------------------ import record ---------------------------- */

export interface EpcisProvenance {
  /** How the bytes arrived. This module imports files; a later pull adds `query`. */
  kind: 'file';
  /** The name the file arrived under, when the caller knows one. A name, never a path with credentials. */
  filename?: string;
}

export interface EpcisContextRef {
  kind: 'iri' | 'inline';
  value: string;
  digest?: string;
  pinned: boolean;
  /** `document`, or the pointer of the event that declared it. */
  scope: string;
}

export interface EpcisImportEvent {
  pointer: string;
  /** The event's own eventID, exactly as declared. Absent when the event declares none. */
  eventId?: string;
  /** The identity arrivals are compared under: the eventID, or the local ingestion identity. */
  identity: string;
  identityKind: EpcisIdentityKind;
  /** Empty when the event names no type. */
  eventType: string;
  eventTime?: string;
  recordTime?: string;
  bodyDigest: string;
  identifiers: EpcisIdentifierFinding[];
  preservedExtensions: string[];
  validation: { schema: 'pass' | 'fail'; findings: EpcisFinding[] };
  errorDeclaration?: { declarationTime?: string; reason?: string; correctiveEventIDs: string[]; resolution: 'resolved' | 'unresolved'; missing?: string[] };
  /** No mapping profile is implemented here, so every event records that none was attempted. */
  mapping: { outcome: 'not-attempted'; missing: string[]; unmapped: string[] };
  /** Present once the import is evaluated. */
  arrival?: 'new' | 'duplicate' | 'new-observation' | 'conflict';
  /** The observation record this arrival wrote, or for a duplicate the one it repeats. */
  observation?: { sequence: number; importId: string; pointer: string };
  /** Present when this arrival added an observation to an identity that holds more than one body. */
  conflict?: { conflictId: string; withImportId: string; withPointer: string; withBodyDigest: string; state: 'open' | 'resolved'; resolutionId?: string; resolution?: string; resolvedAt?: string };
}

/** The durable record of one retained source, in the shape of `contracts/epcis-import.schema.json` version 2. */
export interface EpcisImportRecord {
  importVersion: typeof EPCIS_IMPORT_VERSION;
  importId: string;
  requestId: string;
  requestDigest: string;
  idempotency: { scope: 'source'; rule: 'request-digest-equal' };
  sourceId: string;
  receivedAt: string;
  mediaType: 'application/json' | 'application/ld+json';
  byteLength: number;
  sha256: string;
  bytesRef: string;
  sourceLocation: EpcisProvenance;
  contextRefs: EpcisContextRef[];
  profileRefs: string[];
  policyId: string;
  limits: Record<string, number>;
  /** `received`: the bytes and this record are durable and arrivals are not yet recorded. `evaluated`: every arrival is recorded. `blocked`: an arrival of this import is part of an open conflict. Operational, never a verdict. */
  state: 'received' | 'evaluated' | 'blocked';
  /** Whether the pinned schema accepted the document and no envelope or identifier check failed. It says nothing about who made the document or whether its events happened. */
  documentValidity: 'valid' | 'invalid';
  envelope?: { type: 'EPCISDocument' | 'EPCISQueryDocument'; schemaVersion?: string; creationDate?: string; queryName?: string; hasHeader: boolean; hasMasterData: boolean };
  findings: EpcisFinding[];
  preservedExtensions: string[];
  events: EpcisImportEvent[];
  progress: { pagesRead: number; bytesRead: number; complete: boolean; completenessLimits: string[] };
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------ other records ---------------------------- */

/** One distinct observation of an event under its scoped identity. Written once and never changed. */
export interface EpcisObservationRecord {
  recordType: 'epcis-observation';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  sourceId: string;
  identity: string;
  identityKind: EpcisIdentityKind;
  /** The event's own eventID, exactly as declared, when it declares one. */
  eventId?: string;
  /** The position of this observation among those held under the identity, from 1. */
  sequence: number;
  importId: string;
  pointer: string;
  /** The digest of the retained bytes the observation was read from. */
  sourceSha256: string;
  eventType: string;
  bodyDigest: string;
  /** The repository's record time, exactly as present: a string in a valid event, whatever else an invalid one wrote. */
  recordTime?: unknown;
  /** The error declaration, exactly as present. */
  errorDeclaration?: unknown;
  arrival: 'new' | 'new-observation' | 'conflict';
  observedAt: string;
}

export type EpcisResolutionDisposition = 'body-selected' | 'all-retained' | 'none-relied-on';

/** One decision about the bodies held under one event identity. Appended, never changed: a later decision supersedes it and both stay. */
export interface EpcisResolutionRecord {
  recordType: 'epcis-conflict-resolution';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  resolutionId: string;
  conflictId: string;
  sourceId: string;
  identity: string;
  identityKind: EpcisIdentityKind;
  /** The position of this decision among those recorded for the conflict, from 1. */
  sequence: number;
  /** The decision this one replaces, when there was one. */
  supersedes?: string;
  /** What was decided, in the decider's words. */
  decision: string;
  disposition: EpcisResolutionDisposition;
  /** The body later work reads, when the disposition is `body-selected`. */
  selectedBodyDigest?: string;
  decidedAt: string;
  /** Who decided, as the application names them. Never a credential. */
  decidedBy?: string;
  /** Every body the decision covers. A body that arrives later is not covered and reopens the conflict. */
  bodyDigests: string[];
  /** Every competing observation, by reference. None is changed or removed. */
  observations: Array<{ sequence: number; importId: string; pointer: string; sourceSha256: string; bodyDigest: string }>;
}

/** `instance`: one individual item. `class`: a product class, a lot or a pattern, which names no individual item. */
export type EpcisAssociationGranularity = 'instance' | 'class';

export type EpcisAssociationRole =
  | 'object'
  | 'object-quantity'
  | 'aggregation-parent'
  | 'aggregation-child'
  | 'aggregation-child-quantity'
  | 'transaction-parent'
  | 'transaction-object'
  | 'transaction-object-quantity'
  | 'transformation-input'
  | 'transformation-input-quantity'
  | 'transformation-output'
  | 'transformation-output-quantity'
  | 'association-parent'
  | 'association-child'
  | 'association-child-quantity';

/** One relationship between an identifier and an event. Rebuildable, so it is an index and not evidence. */
export interface EpcisAssociationRecord {
  recordType: 'epcis-association';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  /** The identifier exactly as the event writes it. */
  identifier: string;
  granularity: EpcisAssociationGranularity;
  role: EpcisAssociationRole;
  scheme: EpcisIdentifierFinding['scheme'];
  gtin?: string;
  serial?: string;
  lot?: string;
  /** For a quantity element: the quantity and unit, exactly as present. */
  quantity?: number;
  uom?: string;
  sourceId: string;
  importId: string;
  /** The pointer of the event, and of the identifier within the document. */
  pointer: string;
  path: string;
  identity: string;
  identityKind: EpcisIdentityKind;
  eventType: string;
  eventTime?: string;
  /** True when the event carries an error declaration, so a reader does not take a retracted step for one that stands. */
  errorDeclared: boolean;
}

export type EpcisJournalRecord =
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'intake'; importId: string; sourceId: string; requestId: string; requestDigest: string; sha256: string; startedAt: string }
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'import'; importId: string; startedAt: string }
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'resolution'; conflictId: string; resolutionId: string; startedAt: string }
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'rebuild'; startedAt: string }
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'discard'; sha256: string; startedAt: string };

export interface EpcisRetentionRecord {
  recordType: 'epcis-retention';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  sha256: string;
  importId: string;
}

/* ------------------------------ associations ----------------------------- */

interface AssociationList { key: string; role: EpcisAssociationRole; quantity: boolean }

const ASSOCIATION_LISTS: Record<string, { parent?: EpcisAssociationRole; lists: AssociationList[] }> = {
  ObjectEvent: { lists: [{ key: 'epcList', role: 'object', quantity: false }, { key: 'quantityList', role: 'object-quantity', quantity: true }] },
  AggregationEvent: { parent: 'aggregation-parent', lists: [{ key: 'childEPCs', role: 'aggregation-child', quantity: false }, { key: 'childQuantityList', role: 'aggregation-child-quantity', quantity: true }] },
  TransactionEvent: { parent: 'transaction-parent', lists: [{ key: 'epcList', role: 'transaction-object', quantity: false }, { key: 'quantityList', role: 'transaction-object-quantity', quantity: true }] },
  TransformationEvent: {
    lists: [
      { key: 'inputEPCList', role: 'transformation-input', quantity: false },
      { key: 'inputQuantityList', role: 'transformation-input-quantity', quantity: true },
      { key: 'outputEPCList', role: 'transformation-output', quantity: false },
      { key: 'outputQuantityList', role: 'transformation-output-quantity', quantity: true },
    ],
  },
  AssociationEvent: { parent: 'association-parent', lists: [{ key: 'childEPCs', role: 'association-child', quantity: false }, { key: 'childQuantityList', role: 'association-child-quantity', quantity: true }] },
};

/**
 * Whether an identifier names one item or a class of them. A quantity
 * element is always a class reference, whatever it is written as. In an
 * identifier list the identifier itself decides: a lot, a pattern, a class
 * URN or a Digital Link without a serial names no individual item.
 */
export function epcisIdentifierGranularity(finding: EpcisIdentifierFinding, inQuantityList: boolean): EpcisAssociationGranularity {
  if (inQuantityList) return 'class';
  if (finding.scheme === 'gs1-lgtin' || finding.scheme === 'gs1-sgtin-pattern') return 'class';
  if (/^urn:epc:(class|idpat):/.test(finding.value)) return 'class';
  if (finding.scheme === 'gs1-digital-link' && finding.serial == null) return 'class';
  return 'instance';
}

export interface EpcisEventAssociation {
  identifier: string;
  granularity: EpcisAssociationGranularity;
  role: EpcisAssociationRole;
  scheme: EpcisIdentifierFinding['scheme'];
  gtin?: string;
  serial?: string;
  lot?: string;
  quantity?: number;
  uom?: string;
  path: string;
}

/**
 * Every relationship one event states between an identifier and itself, with
 * the role the event gives it. Only the five event types the profile reads
 * are interpreted. An identifier that is not a URI is left out: it was
 * reported as a finding and names nothing an index could be asked for.
 */
export function epcisEventAssociations(event: JsonObject, pointer: string): EpcisEventAssociation[] {
  const type = typeof event.type === 'string' ? event.type : '';
  if (!(EPCIS_EVENT_TYPES as readonly string[]).includes(type)) return [];
  const shape = ASSOCIATION_LISTS[type];
  if (shape == null) return [];
  const out: EpcisEventAssociation[] = [];
  const add = (path: string, value: unknown, role: EpcisAssociationRole, element?: JsonObject): void => {
    const finding = classifyEpcisIdentifier(path, value);
    if (finding.problem === 'not a URI') return;
    out.push({
      identifier: finding.value,
      granularity: epcisIdentifierGranularity(finding, element != null),
      role,
      scheme: finding.scheme,
      ...(finding.gtin == null ? {} : { gtin: finding.gtin }),
      ...(finding.serial == null ? {} : { serial: finding.serial }),
      ...(finding.lot == null ? {} : { lot: finding.lot }),
      ...(typeof element?.quantity === 'number' ? { quantity: element.quantity } : {}),
      ...(typeof element?.uom === 'string' ? { uom: element.uom } : {}),
      path,
    });
  };
  if (shape.parent != null && event.parentID !== undefined) add(`${pointer}/parentID`, event.parentID, shape.parent);
  for (const list of shape.lists) {
    const values = event[list.key];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (!list.quantity) { add(`${pointer}/${list.key}/${index}`, value, list.role); return; }
      if (value != null && typeof value === 'object' && !Array.isArray(value)) add(`${pointer}/${list.key}/${index}/epcClass`, (value as JsonObject).epcClass, list.role, value as JsonObject);
    });
  }
  return out;
}

/** The key prefix every association of one identifier at one granularity is filed under. */
export function associationSubjectKey(granularity: EpcisAssociationGranularity, identifier: string): string {
  return digestOf(['association', granularity, identifier]);
}

export const associationSourceKey = (sourceId: string): string => digestOf(['source', sourceId]).slice(0, 16);

export function associationKey(granularity: EpcisAssociationGranularity, identifier: string, sourceId: string, importKey: string, position: number): string {
  return `${associationSubjectKey(granularity, identifier)}.${associationSourceKey(sourceId)}.${importKey}.${padded(position, 8)}`;
}
