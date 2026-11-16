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
 *   `resolutionId`, `pullId`), each a URN that names what it is.
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
  /** One record per configured query against a source: its definition, how far it got and where it resumes. Not rebuildable from any source. */
  pull: 'pull',
  /** One record per page a pull acknowledged, in order, with the import that holds it. */
  pullPage: 'pull-page',
  /** One record per recovery snapshot restored into this store: which snapshot, when, and what it covered. Not rebuildable from any source. */
  restore: 'restore',
  /** One record per original a restore placed: the reference it was exported under and where this store holds it. */
  relocation: 'relocation',
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
export const restoreJournalKey = (snapshotId: string): string => `restore.${snapshotId}`;
export const relocationKey = (snapshotId: string, sha256: string): string => `${snapshotId}.${sha256}`;

/* ------------------------------ import record ---------------------------- */

export interface EpcisFileProvenance {
  kind: 'file';
  /** The name the file arrived under, when the caller knows one. A name, never a path with credentials. */
  filename?: string;
}

/** The standard query parameters a page's provenance may name. Nothing else is recorded, so nothing else can ride in. */
export const EPCIS_QUERY_PARAMETERS = ['MATCH_anyEPC', 'eventType', 'GE_eventTime', 'LT_eventTime', 'GE_recordTime', 'EQ_eventID', 'perPage', 'nextPageToken'] as const;

export interface EpcisQueryProvenance {
  kind: 'query';
  /** The configured origin the query was made to: scheme, host and port, and nothing else. */
  origin: string;
  /** The standard query parameters that were sent, by name. */
  query: Record<string, string>;
  /** The page's position in its traversal of the query, from 1. */
  page: number;
}

/** How the bytes arrived: as a file, or as one page of a standard events query. Provenance is never a credential and never proof of origin. */
export type EpcisProvenance = EpcisFileProvenance | EpcisQueryProvenance;

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
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'discard'; sha256: string; startedAt: string }
  /** A restore of a recovery snapshot that has begun and is not finished. Only the restore can finish it, because only it holds the snapshot. */
  | { recordType: 'epcis-journal'; recordVersion: typeof EPCIS_RECORD_VERSION; entry: 'restore'; snapshotId: string; startedAt: string };

export interface EpcisRetentionRecord {
  recordType: 'epcis-retention';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  sha256: string;
  importId: string;
}

/* --------------------------------- restores ------------------------------ */

/** How many records of each kind a recovery snapshot carried into a store. */
export interface EpcisRestoreCounts {
  originals: number;
  imports: number;
  observations: number;
  resolutions: number;
  pulls: number;
  pullPages: number;
}

/**
 * One recovery snapshot restored into this store. Written once, in the batch
 * that ends the restore, so its presence says the restore finished. It is how
 * a restored record is traced to the snapshot it came from: the snapshot
 * itself is never changed.
 */
export interface EpcisRestoreRecord {
  recordType: 'epcis-restore';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  restoreId: string;
  /** The snapshot's identity, as its descriptor gives it. */
  snapshotId: string;
  /** The SHA-256 of the descriptor file the restore read. */
  descriptorSha256: string;
  /** When the snapshot was taken, as its descriptor says. */
  snapshotTakenAt: string;
  /** Every source scope the snapshot covered. */
  sourceIds: string[];
  /** Whether the snapshot carried the cursors of its pulls. */
  cursors: 'excluded' | 'included';
  counts: EpcisRestoreCounts;
  startedAt: string;
  restoredAt: string;
}

/** Where one original of a restored snapshot went. The snapshot names bytes by the reference its store used; this store names them its own way. */
export interface EpcisRelocationRecord {
  recordType: 'epcis-relocation';
  recordVersion: typeof EPCIS_RECORD_VERSION;
  snapshotId: string;
  sha256: string;
  byteLength: number;
  /** The `bytesRef` the import records of the snapshot carry for these bytes. */
  exportedRef: string;
  /** The file of the snapshot that carried them, relative to its descriptor. */
  path: string;
  /** The `bytesRef` the restored import records carry. The bytes were read back from this store and matched their digest before this was written. */
  destinationRef: string;
}

/** The identity of a restore: one per snapshot and store. */
export function epcisRestoreId(snapshotId: string): string {
  return `urn:bsv:dpp:epcis:restore:sha256:${snapshotId}`;
}

/* ---------------------------------- pulls -------------------------------- */

export const EPCIS_PULL_VERSION = '1';

/** The eight outcomes of reaching a source (`spec/epcis-interoperability.md` section 3). One never stands in for another. */
export type EpcisSourceOutcome = 'source-link-missing' | 'source-authentication-required' | 'source-forbidden' | 'source-unavailable' | 'unexpected-media-type' | 'invalid-source' | 'partial-history' | 'ok';

/** Why a run ended as it did. Each belongs to exactly one outcome; see EPCIS_PULL_REASON_OUTCOME in pull.ts. */
export type EpcisPullReason =
  | 'exhausted'
  | 'page-limit' | 'byte-limit' | 'time-limit' | 'cursor-unusable' | 'pagination-malformed' | 'pagination-target-refused'
  | 'no-base-address'
  | 'http-401'
  | 'http-403'
  | 'timeout' | 'network-error' | 'http-error' | 'redirect-refused' | 'redirect-limit' | 'redirect-malformed' | 'target-refused'
  | 'media-type' | 'html-body'
  | 'page-oversized' | 'wire-version-missing' | 'wire-version-unsupported' | 'credential-echoed' | 'import-refused';

/** `exhausted`: the source named no further page. `stopped-at-limit`: a run limit ended the run first. `failed`: the run ended for any other reason. */
export type EpcisPullCompletion = 'exhausted' | 'stopped-at-limit' | 'failed';

/** A departure from the strict reading of the query interface that was accepted, and recorded where it was met. */
export type EpcisPullLeniency = 'link-relation-unquoted' | 'next-page-token-numeric' | 'cbv-version-header-absent' | 'empty-final-page' | 'cursor-expiry-unreadable' | 'list-parameters-repeated';

/** The query a pull makes, as it was configured. Lists are sorted and without repeats, so one definition has one form. */
export interface EpcisPullQuery {
  /** Product selection, sent as MATCH_anyEPC. */
  matchAnyEPC?: string[];
  /** Sent as eventType. */
  eventTypes?: string[];
  /** Sent as GE_eventTime and LT_eventTime. */
  eventTime?: { from?: string; until?: string };
  /** Sent as GE_recordTime. */
  recordTime?: { from?: string };
  /** An explicit refresh of known events, sent as EQ_eventID. */
  eventIds?: string[];
  /** Sent as perPage. */
  perPage: number;
}

/** The source scope of a pull as it is recorded. It holds no credential, only whether one was configured. */
export interface EpcisPullSourceScope {
  sourceId: string;
  /** The address the events query is made under, without user information, query or fragment. */
  baseUrl: string;
  /** Every origin a request of this pull may be made to. */
  permittedOrigins: string[];
  /** True when plain http and private addresses were permitted, which is for local tests only. */
  localTest: boolean;
  credentialsConfigured: boolean;
  /** The versions sent in GS1-EPCIS-Version and GS1-CBV-Version. */
  wireVersions: { epcis: string; cbv: string };
  /** Present, and true, when the source was configured to be sent each list value as its own parameter. A leniency: the interface description declares lists pipe-delimited. */
  repeatListParameters?: true;
}

/** Where the next page is, as the source named it. */
export interface EpcisPullCursor {
  /** The address of the next page, checked against the permitted origins before it was recorded and again before it is used. */
  target: string;
  /** The nextPageToken the address carries, when it carries one. */
  token?: string;
  /** When the source said the cursor expires, when it said so in a form that could be read. */
  expiresAt?: string;
  /** The page of the traversal that named it. */
  afterPage: number;
}

export interface EpcisPullServerVersions {
  /** GS1-EPCIS-Version as the source reported it. */
  epcis?: string;
  /** GS1-CBV-Version as the source reported it. Absent when the source sent none. */
  cbv?: string;
}

export interface EpcisPullEventCounts {
  total: number;
  new: number;
  duplicate: number;
  newObservation: number;
  conflict: number;
}

/** One traversal of the source's pages for one window of the query. */
export interface EpcisPullPass {
  /** From 1. A new pass begins only after the one before it was exhausted. */
  number: number;
  /** From 1. One more each time the pass is replayed from its bounds because its cursor could not be reused. */
  attempt: number;
  /** The standard query parameters every request of this pass is made with, by name. The retained query bounds a replay starts from. */
  parameters: Record<string, string>;
  /** `query-bounds`: the query as configured. `watermark`: the record-time lower bound was moved to the watermark less the overlap margin. */
  window: { basis: 'query-bounds' | 'watermark'; recordTimeFrom?: string; overlapSeconds?: number };
  startedAt: string;
  /** Pages acknowledged in the current attempt. */
  pagesAcknowledged: number;
  /** True once the source named no further page. */
  exhausted: boolean;
  /** The greatest record time seen in the pass so far. */
  maxRecordTime?: string;
}

/** A page that was read and whose import had begun when the record was written. It is finished, never fetched again, if its receipt is held. */
export interface EpcisPullPending {
  sequence: number;
  pass: number;
  attempt: number;
  page: number;
  requestId: string;
  /** True when this pull already holds an import of exactly these bytes, so the page answers that import and writes no second one. */
  importReplayed: boolean;
  sha256: string;
  byteLength: number;
  mediaType: string;
  receivedAt: string;
  /** The standard parameters the page was asked for with. */
  query: Record<string, string>;
  /** The cursor for the page after it. Absent when the source named none. */
  next?: EpcisPullCursor;
  /** True when the source named no further page. */
  last: boolean;
  /** Set when the source named a further page that could not be recorded. The page is still acknowledged, and the run then ends. */
  nextProblem?: { reason: 'pagination-malformed' | 'pagination-target-refused'; detail: string };
  server: EpcisPullServerVersions;
  leniencies: EpcisPullLeniency[];
}

export interface EpcisPullRunSummary {
  /** From 1. */
  run: number;
  startedAt: string;
  /** Absent while the run is under way, or when its process stopped. */
  endedAt?: string;
  outcome?: EpcisSourceOutcome;
  reason?: EpcisPullReason;
  completion?: EpcisPullCompletion;
  detail?: string;
  /** Pages read from the source in this run, replayed ones included. */
  pagesFetched: number;
  pagesAcknowledged: number;
  bytesRead: number;
  /** How often this run fell back to a replay. */
  replays: number;
  /** True when the run began from state an earlier run left. */
  resumed: boolean;
}

/** The durable state of one configured query against one source. Versioned, and never rebuilt from a source. */
export interface EpcisPullRecord {
  recordType: 'epcis-pull';
  recordVersion: typeof EPCIS_PULL_VERSION;
  pullId: string;
  sourceId: string;
  /** The caller's name for the configured query. Unique within one `sourceId`. */
  queryId: string;
  /** The digest the name is bound to: the source identity, the base address, the query and the overlap margin. The same name with another definition is refused. */
  definitionDigest: string;
  source: EpcisPullSourceScope;
  query: EpcisPullQuery;
  /** How far before the watermark the record-time bound of a later pass begins. */
  recordTimeOverlapSeconds: number;
  policyId: string;
  /** The limits in force for the latest run. */
  limits: Record<string, number>;
  /** Every limit the operator set away from the profile's default, in the latest run. */
  limitOverrides: Array<{ limit: string; default: number; value: number }>;
  /** `running`: a run is under way, or its process stopped. `exhausted`, `stopped-at-limit` and `failed` are how the latest run ended. */
  status: 'running' | EpcisPullCompletion;
  pass: EpcisPullPass;
  /** The checkpoint: where the next page is. It is moved only in the batch that acknowledges the page that named it. */
  cursor?: EpcisPullCursor;
  pending?: EpcisPullPending;
  /** The latest replay, and how many pages had been acknowledged in the pass when it was decided. */
  replay?: { reason: 'cursor-expired' | 'cursor-rejected' | 'cursor-missing'; decidedAt: string; pass: number; attempt: number; pagesAcknowledgedBefore: number };
  /** The greatest record time seen when a pass was last exhausted. It bounds the next pass and proves nothing about corrections. */
  watermark?: { recordTime: string; pass: number; establishedAt: string };
  /** Pages acknowledged over the life of the pull: the number of page records. */
  pagesAcknowledged: number;
  runs: number;
  lastRun: EpcisPullRunSummary;
  totals: { bytes: number; events: EpcisPullEventCounts };
  /** Every reason the retained events are not the complete history of the source. */
  completenessLimits: string[];
  /** Every time an operator declared that this source is reached at another address, oldest first. Absent when the address never changed. */
  endpointRemaps?: EpcisPullEndpointRemap[];
  createdAt: string;
  updatedAt: string;
}

/** One declaration that the same source is now reached at another address. The source scope, the pull and everything retained under them keep their identities. */
export interface EpcisPullEndpointRemap {
  remappedAt: string;
  /** Who declared it, as the application names them. Never a credential. */
  remappedBy?: string;
  from: { baseUrl: string; definitionDigest: string };
  to: { baseUrl: string; definitionDigest: string };
  /** What became of the checkpoint's cursor: there was none, its address is permitted under the new configuration and it was kept, or it was dropped and the pass replays from its bounds. */
  cursor: 'none' | 'kept' | 'dropped';
}

/** One acknowledged page. Written once, in the batch that moves the checkpoint past it. */
export interface EpcisPullPageRecord {
  recordType: 'epcis-pull-page';
  recordVersion: typeof EPCIS_PULL_VERSION;
  pullId: string;
  sourceId: string;
  /** The page's position among every page the pull acknowledged, from 1. */
  sequence: number;
  run: number;
  pass: number;
  attempt: number;
  /** The page's position in its traversal, from 1. */
  page: number;
  /** The import that holds the page. */
  importId: string;
  /** True when this pull already held an import of exactly these bytes, so the page answered that import and no second one was written. */
  importReplayed: boolean;
  sha256: string;
  byteLength: number;
  mediaType: string;
  receivedAt: string;
  /** The standard parameters the page was asked for with. */
  query: Record<string, string>;
  documentValidity: 'valid' | 'invalid';
  events: EpcisPullEventCounts;
  /** True when the source named no further page. */
  last: boolean;
  server: EpcisPullServerVersions;
  leniencies: EpcisPullLeniency[];
}

/** The storage key of a pull: one per source scope and query name. */
export function epcisPullKey(sourceId: string, queryId: string): string {
  return digestOf(['pull', sourceId, queryId]);
}

/** The stable identity of a pull. */
export function epcisPullId(sourceId: string, queryId: string): string {
  return `urn:bsv:dpp:epcis:pull:sha256:${epcisPullKey(sourceId, queryId)}`;
}

const PULL_ID = /^urn:bsv:dpp:epcis:pull:sha256:([0-9a-f]{64})$/;

export function pullKeyOf(pullId: string): string | undefined {
  return PULL_ID.exec(pullId)?.[1];
}

export const pullPageKey = (pullKey: string, sequence: number): string => `${pullKey}.${padded(sequence, 10)}`;

/** The digest a query name is bound to. Limits, permitted origins, credentials, the versions sent and how a list is written into the address are not part of it: an operator may change those without making a new source. */
export function epcisPullDefinitionDigest(definition: { sourceId: string; baseUrl: string; query: EpcisPullQuery; recordTimeOverlapSeconds: number }): string {
  return digestOf({ baseUrl: definition.baseUrl, query: definition.query, recordTimeOverlapSeconds: definition.recordTimeOverlapSeconds, sourceId: definition.sourceId });
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
