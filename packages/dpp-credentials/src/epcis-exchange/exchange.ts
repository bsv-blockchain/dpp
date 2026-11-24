/**
 * EPCIS import, export, conflict decisions, the associations index and
 * recovery, over an injected store (`spec/epcis-interoperability.md`, the
 * epcis-json@1 profile, sections 1, 2, 6 and 7).
 *
 * What this is: the durable orchestration around the pure pieces of
 * epcis-source.ts. It retains the exact bytes of a source, records what the
 * source held and how each event arrived, and gives the bytes back unchanged.
 *
 * What this is not: an EPCIS repository or a capture interface. It reaches
 * no network: the query pull is pull.ts, which hands each page it reads to
 * the import here. An import is data. It moves no passport, and a document
 * that passes validation says nothing about who wrote it or whether its
 * events happened.
 *
 * The durable steps of one import, in order:
 *
 *   1. journal `intake`     the request is noted, nothing is held yet
 *   2. the bytes            durable under their SHA-256
 *   3. the receipt          the import record in state `received`, the
 *                           retention entry, and the journal moved to `import`
 *   4. the event results    every new observation and the record in state
 *                           `evaluated` or `blocked`, in one batch
 *   5. the associations     index entries, in bounded batches
 *   6. journal cleared
 *
 * Success is acknowledged only after step 6. A store that stopped before
 * step 3 holds nothing a caller was told about, and recovery discards it. A
 * store that stopped at or after step 3 holds a receipt, and recovery or a
 * retry of the same request finishes it. Nothing in between is possible,
 * because steps 3 and 4 are each one atomic batch.
 */
import {
  EPCIS_SOURCE_PROFILE,
  classifyEventArrival,
  contextReferences,
  epcisErrorDeclaration,
  epcisEventBodyDigest,
  eventIdentifiers,
  preservedDocumentExtensions,
  preservedEventExtensions,
  parseEpcisSource,
  resolveEpcisLimits,
  unresolvedCorrections,
  validateEpcisDocument,
  type EpcisFinding,
  type EpcisLimits,
  type EpcisParseResult,
  type EpcisRefusal,
  type EpcisValidationFindings,
} from '../epcis-source.js';
import { Gs1ArtefactUnavailableError } from '../gs1-artefacts.js';
import { JcsError, canonicalizeJcs } from '../jcs.js';
import type { JsonObject } from '../types.js';
import {
  EPCIS_IMPORT_VERSION,
  EPCIS_QUERY_PARAMETERS,
  EPCIS_RECORD_KINDS,
  EPCIS_RECORD_VERSION,
  REBUILD_JOURNAL_KEY,
  associationKey,
  associationSourceKey,
  associationSubjectKey,
  conflictScopeKeyOf,
  discardJournalKey,
  epcisConflictId,
  epcisEventAssociations,
  epcisEventScopeKey,
  epcisImportId,
  epcisImportKey,
  epcisRequestDigest,
  epcisResolutionId,
  importJournalKey,
  importKeyOf,
  observationKey,
  resolutionJournalKey,
  resolutionKey,
  retentionKey,
  type EpcisAssociationGranularity,
  type EpcisAssociationRecord,
  type EpcisContextRef,
  type EpcisImportEvent,
  type EpcisImportRecord,
  type EpcisJournalRecord,
  type EpcisObservationRecord,
  type EpcisProvenance,
  type EpcisPullPageRecord,
  type EpcisPullRecord,
  type EpcisResolutionDisposition,
  type EpcisResolutionRecord,
  type EpcisRetentionRecord,
} from './records.js';
import { sha256Hex, type EpcisExchangeStorage, type EpcisStorageWrite, type EpcisStoredRecord } from './storage.js';
import { inTurn, listAll } from './turn.js';

/* ---------------------------------- shape -------------------------------- */

/** The named operator policy an import is read under, and the limits it sets. Limits it does not name take the profile's defaults. */
export interface EpcisImportPolicy {
  policyId: string;
  limits?: Partial<EpcisLimits>;
}

export interface ImportEpcisSourceInput {
  storage: EpcisExchangeStorage;
  /** The configured origin the events are scoped under. It names an origin, never an account. */
  sourceId: string;
  /** The caller's identifier for this request. Unique within one `sourceId`. */
  requestId: string;
  /** The exact bytes received. */
  bytes: Uint8Array;
  mediaType: string;
  /** When the bytes were received, as an ISO 8601 date-time. */
  receivedAt: string;
  /** Where the bytes came from: a file, or one page of a standard events query. Recorded as given, so it never carries a credential. */
  provenance: EpcisProvenance;
  policy: EpcisImportPolicy;
  /** The folder the pinned GS1 schema is read from; see gs1-artefacts.ts for the default. */
  artefactsDir?: string;
  /** The clock for `updatedAt`. The system clock by default. */
  now?: () => string;
}

export type EpcisImportRefusal = EpcisRefusal | 'too-many-contexts' | 'contexts-oversized' | 'no-canonical-form' | 'gs1-artefact-unavailable' | 'invalid-request';

export type EpcisImportOutcome =
  /** Nothing was kept and nothing changed. */
  | { outcome: 'refused'; reason: EpcisImportRefusal; detail: string; remedy?: string; limits?: EpcisLimits }
  /** The request identifier is already bound to other bytes. Nothing was kept and the earlier import stands. */
  | { outcome: 'request-conflict'; sourceId: string; requestId: string; existingImportId: string; existingRequestDigest: string; detail: string }
  /** The source is held. `replayed` says the request had been acknowledged or begun before; `resumed` says this call finished work an earlier one had left. */
  | { outcome: 'retained'; replayed: boolean; resumed: boolean; record: EpcisImportRecord };

export type EpcisExchangeErrorCode = 'retained-bytes-missing' | 'retained-bytes-mismatch' | 'record-unreadable' | 'storage-contention';

/** The store holds something that breaks a promise of this module, or would not settle. Never a property of a source. */
export class EpcisExchangeError extends Error {
  readonly code: EpcisExchangeErrorCode;
  constructor(code: EpcisExchangeErrorCode, message: string) {
    super(message);
    this.name = 'EpcisExchangeError';
    this.code = code;
  }
}

export interface EpcisOriginalExport {
  kind: 'original';
  importId: string;
  /** The retained bytes, exactly as received. */
  bytes: Uint8Array;
  mediaType: string;
  sha256: string;
  byteLength: number;
}

export const EPCIS_EVENT_PROJECTION = 'urn:bsv:dpp:epcis:projection:events:1';

export interface EpcisDerivedProjection {
  kind: 'derived';
  derived: true;
  projection: typeof EPCIS_EVENT_PROJECTION;
  derivedFrom: { importId: string; sha256: string; mediaType: string };
  /** Generated here. Never the bytes that were received. */
  bytes: Uint8Array;
  mediaType: 'application/json';
  /** The digest of the generated bytes, which is not the digest of the source. */
  sha256: string;
  byteLength: number;
}

export interface EpcisConflict {
  conflictId: string;
  sourceId: string;
  identity: string;
  identityKind: 'event-id' | 'local';
  /** `resolved` only while the latest decision covers every body held. */
  state: 'open' | 'resolved';
  bodyDigests: string[];
  observations: EpcisObservationRecord[];
  resolutions: EpcisResolutionRecord[];
  currentResolutionId?: string;
}

export interface ResolveEpcisConflictInput {
  conflictId: string;
  /** What was decided, in the decider's words. */
  decision: string;
  disposition: EpcisResolutionDisposition;
  /** Required for `body-selected`, and one of the competing bodies. */
  selectedBodyDigest?: string;
  decidedAt: string;
  /** Who decided, as the application names them. Never a credential. */
  decidedBy?: string;
  now?: () => string;
}

export type EpcisResolutionOutcome =
  | { outcome: 'refused'; reason: 'no-conflict' | 'invalid-request'; detail: string }
  | { outcome: 'recorded'; replayed: boolean; resolution: EpcisResolutionRecord };

export interface EpcisAssociationQuery {
  /** The identifier exactly as events write it. No other spelling of the same item is searched. */
  identifier: string;
  /** `instance` for an individual item, `class` for a class, a lot or a pattern. One never answers for the other. */
  granularity: EpcisAssociationGranularity;
  sourceId?: string;
  after?: string;
  limit?: number;
}

export interface EpcisAssociationPage {
  associations: EpcisAssociationRecord[];
  /** Pass as `after` for the next page. Absent when there is none. */
  next?: string;
}

export interface EpcisRebuildReport {
  importsRead: number;
  importsIndexed: number;
  associationsRemoved: number;
  associationsWritten: number;
}

export type EpcisRecoveryAction =
  | { action: 'intake-discarded'; importId: string; sha256: string; bytesRemoved: boolean }
  | { action: 'bytes-discarded'; sha256: string; bytesRemoved: boolean }
  | { action: 'import-finished'; importId: string; from: 'received' | 'results-recorded'; state: EpcisImportRecord['state'] }
  | { action: 'resolution-applied'; conflictId: string; resolutionId: string; importsUpdated: number }
  | { action: 'associations-rebuilt'; importsIndexed: number; associationsWritten: number }
  /** A restore of a recovery snapshot was begun and not finished. Recovery leaves it as it is: run the restore again with the same snapshot. */
  | { action: 'restore-pending'; snapshotId: string }
  | { action: 'journal-discarded'; key: string; detail: string };

export interface EpcisRecoveryReport {
  /** What recovery did, in the order it did it. */
  actions: EpcisRecoveryAction[];
  /** Unfinished work still journalled afterwards. 0 unless recovery itself was interrupted, or a restore is unfinished, which only the restore can finish. */
  remaining: number;
}

/* --------------------------------- helpers ------------------------------- */

const K = EPCIS_RECORD_KINDS;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A batch never carries more index entries than this, so one very wide event cannot make one very large write. */
const ASSOCIATION_BATCH = 128;
/** How often a batch is rebuilt when another writer got in first. More than a few means two writers are fighting, which one process never does. */
const ATTEMPTS = 8;
/**
 * The most findings one import record keeps. Validation reports every error
 * it finds, and a hostile document can make that list far larger than the
 * document. The count of all findings is still recorded, and validity is
 * decided on all of them.
 */
export const EPCIS_MAX_RECORDED_FINDINGS = 1000;

const systemClock = (): string => new Date().toISOString();
const mediaTypeBase = (value: string): string => value.split(';')[0]?.trim().toLowerCase() ?? '';
const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;

function atPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const raw of pointer.split('/').slice(1)) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) current = current[Number(token)];
    else if (current != null && typeof current === 'object') current = (current as Record<string, unknown>)[token];
    else return undefined;
  }
  return current;
}

async function mustCommit(storage: EpcisExchangeStorage, writes: EpcisStorageWrite[], what: string): Promise<void> {
  const result = await storage.commit(writes);
  if (!result.committed) throw new EpcisExchangeError('storage-contention', `${what} could not be written: ${result.failed.kind}/${result.failed.key} was expected at ${result.failed.expected} and is at ${result.failed.found}`);
}

const journalEntry = (entry: Record<string, unknown>): JsonObject => ({ recordType: 'epcis-journal', recordVersion: EPCIS_RECORD_VERSION, ...entry });

/* ------------------------------- the request ----------------------------- */

type Refusal = Extract<EpcisImportOutcome, { outcome: 'refused' }>;
const refuse = (reason: EpcisImportRefusal, detail: string, extra: { remedy?: string; limits?: EpcisLimits } = {}): Refusal => ({ outcome: 'refused', reason, detail, ...extra });

function requestProblem(input: ImportEpcisSourceInput): string | undefined {
  const name = (value: unknown, what: string): string | undefined => (typeof value !== 'string' || value.length < 1 || value.length > 256 || CONTROL.test(value) ? `${what} is 1 to 256 characters without control characters` : undefined);
  if (input == null || typeof input !== 'object') return 'an import is described by an object';
  if (input.storage == null || typeof input.storage.commit !== 'function') return 'an import is handed the storage it writes to';
  const problem = name(input.sourceId, 'sourceId') ?? name(input.requestId, 'requestId');
  if (problem != null) return problem;
  if (!(input.bytes instanceof Uint8Array)) return 'bytes are a Uint8Array';
  if (typeof input.mediaType !== 'string') return 'mediaType is a string';
  if (typeof input.receivedAt !== 'string' || !DATE_TIME.test(input.receivedAt) || Number.isNaN(Date.parse(input.receivedAt))) return 'receivedAt is an ISO 8601 date-time with a zone';
  if (input.policy == null || typeof input.policy !== 'object') return 'the policy in force is named';
  const policyProblem = name(input.policy.policyId, 'policy.policyId');
  if (policyProblem != null) return policyProblem;
  const provenance = input.provenance as unknown;
  if (provenance == null || typeof provenance !== 'object' || Array.isArray(provenance)) return 'provenance is an object';
  return provenanceProblem(provenance as Record<string, unknown>);
}

/** A page's origin is exactly a scheme, a host and a port: no path, no query and no user information, so nothing but the place is recorded. */
function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false;
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value; } catch { return false; }
}

// Only what this module knows how to record is accepted, so a token or a header cannot ride in on an unknown member.
function provenanceProblem(provenance: Record<string, unknown>): string | undefined {
  const members = Object.keys(provenance);
  if (provenance.kind === 'file') {
    if (members.some((member) => member !== 'kind' && member !== 'filename')) return 'file provenance carries kind and filename only';
    const filename = provenance.filename;
    if (filename !== undefined && (typeof filename !== 'string' || filename.length < 1 || filename.length > 1024 || CONTROL.test(filename) || /:\/\/|[?#]/.test(filename))) return 'provenance.filename is a file name of at most 1024 characters, not an address, a query or a fragment';
    return undefined;
  }
  if (provenance.kind === 'query') {
    if (members.some((member) => member !== 'kind' && member !== 'origin' && member !== 'query' && member !== 'page')) return 'query provenance carries kind, origin, query and page only';
    if (!isOrigin(provenance.origin)) return 'provenance.origin is an http or https origin: a scheme, a host and a port, and nothing else';
    const query = provenance.query;
    if (query == null || typeof query !== 'object' || Array.isArray(query)) return 'provenance.query is an object of the standard query parameters that were sent';
    for (const [name, value] of Object.entries(query)) {
      if (!(EPCIS_QUERY_PARAMETERS as readonly string[]).includes(name)) return `provenance.query names only the standard parameters ${EPCIS_QUERY_PARAMETERS.join(', ')}`;
      if (typeof value !== 'string' || value.length > 8192 || CONTROL.test(value)) return `provenance.query.${name} is a string of at most 8192 characters without control characters`;
    }
    if (!Number.isSafeInteger(provenance.page) || (provenance.page as number) < 1) return 'provenance.page is the position of the page, from 1';
    return undefined;
  }
  return 'provenance.kind is file or query';
}

/** Provenance as it is recorded: the members this module names, copied, and nothing the caller's object happened to carry beside them. */
function recordedProvenance(provenance: EpcisProvenance): EpcisProvenance {
  if (provenance.kind === 'file') return { kind: 'file', ...(provenance.filename == null ? {} : { filename: provenance.filename }) };
  return { kind: 'query', origin: provenance.origin, query: { ...provenance.query }, page: provenance.page };
}

interface Prepared {
  limits: EpcisLimits;
  document: JsonObject;
  record: EpcisImportRecord;
}

function receiptContextRefs(parsed: Extract<EpcisParseResult, { ok: true }>): EpcisContextRef[] {
  const contextRefs: EpcisContextRef[] = contextReferences(parsed.context.document).map((ref) => ({ ...ref, scope: 'document' }));
  for (const declared of parsed.context.events) for (const ref of contextReferences(declared.context)) contextRefs.push({ ...ref, scope: declared.pointer });
  return contextRefs;
}

/** The context digests an event body is read under: the document's and its own declaration's. */
function eventContextDigests(refs: readonly EpcisContextRef[], pointer: string): string[] {
  return [...new Set(refs.filter((ref) => ref.digest != null && (ref.scope === 'document' || ref.scope === pointer)).map((ref) => ref.digest as string))].sort();
}

/** A validation result in the shape `unresolvedCorrections` reads, rebuilt from a record, so a correction is decided by the same function at receipt and at recovery. */
function correctionsView(events: readonly EpcisImportEvent[]): EpcisValidationFindings {
  return {
    schema: 'pass',
    findings: [],
    preservedExtensions: [],
    events: events.map((event) => ({
      pointer: event.pointer,
      type: event.eventType,
      identifiers: [],
      preservedExtensions: [],
      ...(event.errorDeclaration == null ? {} : { errorDeclaration: { correctiveEventIDs: event.errorDeclaration.correctiveEventIDs } }),
    })),
  };
}

function applyCorrections(events: EpcisImportEvent[], held: ReadonlySet<string>): void {
  const unresolved = new Map(unresolvedCorrections(correctionsView(events), held).map((entry) => [entry.pointer, entry.missing]));
  for (const event of events) {
    if (event.errorDeclaration == null) continue;
    const missing = unresolved.get(event.pointer);
    const { missing: _earlier, ...rest } = event.errorDeclaration;
    event.errorDeclaration = { ...rest, resolution: missing == null ? 'resolved' : 'unresolved', ...(missing == null || missing.length === 0 ? {} : { missing }) };
  }
}

/**
 * Everything about an import that needs no store: the strict parse, the
 * limits, the pinned-schema validation and each event's identity, digest and
 * findings. A refusal comes from here, before anything is written.
 */
function prepare(input: ImportEpcisSourceInput, clock: () => string): Refusal | Prepared {
  let limits: EpcisLimits;
  try { limits = resolveEpcisLimits(input.policy.limits ?? {}); } catch (error) { return refuse('invalid-request', (error as Error).message); }
  const parsed: EpcisParseResult = parseEpcisSource(input.bytes, { mediaType: input.mediaType, limits });
  if (!parsed.ok) return refuse(parsed.reason, parsed.detail, { limits });
  const { sha256, mediaType } = parsed;
  try {
    // Every digest and comparison below is taken over a canonical form. Taking it once over the whole document finds a value that has none before anything is written.
    canonicalizeJcs(parsed.document);
    const contextRefs = receiptContextRefs(parsed);
    // Nothing is fetched here, so a context document is counted as it is declared: each distinct one once, and an inline one by the bytes of its canonical form.
    const distinct = new Map(contextRefs.map((ref) => [ref.value, ref]));
    if (distinct.size > limits.maxContextDocuments) return refuse('too-many-contexts', `${distinct.size} context declarations exceeds the ${limits.maxContextDocuments} context document limit`, { limits });
    let inlineBytes = 0;
    const inline = (declaration: unknown): void => { for (const entry of declaration === undefined ? [] : Array.isArray(declaration) ? declaration : [declaration]) if (typeof entry !== 'string') inlineBytes += utf8Length(canonicalizeJcs(entry)); };
    inline(parsed.context.document);
    for (const declared of parsed.context.events) inline(declared.context);
    if (inlineBytes > limits.maxContextBytes) return refuse('contexts-oversized', `${inlineBytes} bytes of inline context exceeds the ${limits.maxContextBytes} byte context limit`, { limits });

    let validation: EpcisValidationFindings;
    try {
      validation = validateEpcisDocument(parsed.document, { events: parsed.events, ...(input.artefactsDir == null ? {} : { artefactsDir: input.artefactsDir }) });
    } catch (error) {
      if (error instanceof Gs1ArtefactUnavailableError) return refuse('gs1-artefact-unavailable', error.message, { remedy: error.remedy, limits });
      throw error;
    }

    const contextFindings: EpcisFinding[] = contextRefs.filter((ref) => !ref.pinned).map((ref) => ({
      code: 'context-unpinned',
      path: ref.scope === 'document' ? '/@context' : `${ref.scope}/@context`,
      message: `context ${ref.value} is not pinned by this profile; it is kept as declared and nothing that depends on its terms is established`,
      severity: 'warning',
    }));
    // A validation finding belongs to the event whose pointer leads its path. Matching on whole segments keeps event 1 from collecting the findings of events 10 to 19.
    const pointers = new Set(parsed.events.map((event) => event.pointer));
    const owner = (path: string): string | undefined => {
      const parts = path.split('/');
      for (let length = parts.length; length > 1; length -= 1) {
        const candidate = parts.slice(0, length).join('/');
        if (pointers.has(candidate)) return candidate;
      }
      return undefined;
    };
    const eventFindings = new Map<string, EpcisFinding[]>();
    const documentFindings: EpcisFinding[] = [...parsed.findings];
    for (const finding of [...validation.findings, ...contextFindings]) {
      const pointer = owner(finding.path);
      if (pointer == null) { documentFindings.push(finding); continue; }
      const list = eventFindings.get(pointer);
      if (list == null) eventFindings.set(pointer, [finding]);
      else list.push(finding);
    }
    const validated = new Map(validation.events.map((event) => [event.pointer, event]));

    const events: EpcisImportEvent[] = parsed.events.map((pointer) => {
      const source = atPointer(parsed.document, pointer.pointer) as JsonObject;
      const found = validated.get(pointer.pointer);
      return {
        pointer: pointer.pointer,
        ...(pointer.eventId == null ? {} : { eventId: pointer.eventId }),
        identity: pointer.identityKind === 'event-id' ? (pointer.eventId as string) : (pointer.localIdentity as string),
        identityKind: pointer.identityKind,
        eventType: pointer.type,
        ...(typeof source.eventTime === 'string' ? { eventTime: source.eventTime } : {}),
        ...(typeof source.recordTime === 'string' ? { recordTime: source.recordTime } : {}),
        bodyDigest: epcisEventBodyDigest(source, eventContextDigests(contextRefs, pointer.pointer)),
        identifiers: found?.identifiers ?? [],
        preservedExtensions: found?.preservedExtensions ?? [],
        validation: { schema: validation.schema, findings: eventFindings.get(pointer.pointer) ?? [] },
        ...(found?.errorDeclaration == null ? {} : { errorDeclaration: { ...found.errorDeclaration, resolution: 'unresolved' as const } }),
        mapping: { outcome: 'not-attempted', missing: [], unmapped: [] },
      };
    });
    // Until the store is consulted, a correction is resolved only by what this document itself holds.
    applyCorrections(events, new Set(events.filter((event) => event.identityKind === 'event-id').map((event) => event.identity)));

    const total = documentFindings.length + events.reduce((sum, event) => sum + event.validation.findings.length, 0);
    const failed = [...documentFindings, ...events.flatMap((event) => event.validation.findings)].some((finding) => finding.severity === 'error');
    const identifierProblem = events.some((event) => event.identifiers.some((identifier) => identifier.problem != null));
    const documentValidity = parsed.envelope != null && validation.schema === 'pass' && !failed && !identifierProblem ? 'valid' : 'invalid';
    if (total > EPCIS_MAX_RECORDED_FINDINGS) {
      let room = EPCIS_MAX_RECORDED_FINDINGS - 1;
      const keep = (list: EpcisFinding[]): EpcisFinding[] => { const kept = list.slice(0, Math.max(room, 0)); room -= kept.length; return kept; };
      const keptDocument = keep(documentFindings);
      for (const event of events) event.validation.findings = keep(event.validation.findings);
      documentFindings.length = 0;
      documentFindings.push(...keptDocument, { code: 'findings-truncated', path: '', message: `${total} findings were made and the first ${EPCIS_MAX_RECORDED_FINDINGS - 1} are recorded; the document's validity was decided on all of them`, severity: 'info' });
    }

    const now = clock();
    const record: EpcisImportRecord = {
      importVersion: EPCIS_IMPORT_VERSION,
      importId: epcisImportId(input.sourceId, input.requestId),
      requestId: input.requestId,
      requestDigest: epcisRequestDigest({ sourceId: input.sourceId, mediaType, byteLength: parsed.byteLength, sha256 }),
      idempotency: { scope: 'source', rule: 'request-digest-equal' },
      sourceId: input.sourceId,
      receivedAt: input.receivedAt,
      mediaType: mediaType as EpcisImportRecord['mediaType'],
      byteLength: parsed.byteLength,
      sha256,
      bytesRef: `sha256:${sha256}`,
      sourceLocation: recordedProvenance(input.provenance),
      contextRefs,
      profileRefs: [EPCIS_SOURCE_PROFILE],
      policyId: input.policy.policyId,
      limits: { ...limits },
      state: 'received',
      documentValidity,
      ...(parsed.envelope == null ? {} : { envelope: { ...parsed.envelope } }),
      findings: documentFindings,
      preservedExtensions: validation.preservedExtensions,
      events,
      progress: input.provenance.kind === 'file'
        ? { pagesRead: 1, bytesRead: parsed.byteLength, complete: true, completenessLimits: ['a file import holds what the file carries and says nothing about what else its source holds'] }
        // One page is never the whole answer, whatever page it is. How far the query got is the pull record's to say.
        : { pagesRead: input.provenance.page, bytesRead: parsed.byteLength, complete: false, completenessLimits: ['this is one page of a query result; the pull record says how far the query got and within which bounds', 'a query result holds what its filters matched when it was answered and says nothing about what else its source holds'] },
      createdAt: input.receivedAt,
      updatedAt: now,
    };
    return { limits, document: parsed.document, record };
  } catch (error) {
    // A string with an unpaired surrogate parses, and has no canonical form to digest. It is refused like any other transport that cannot be carried exactly.
    if (error instanceof JcsError) return refuse('no-canonical-form', error.message, { limits });
    throw error;
  }
}

/* -------------------------------- evaluation ----------------------------- */

const asRecord = (held: EpcisStoredRecord): EpcisImportRecord => held.value as unknown as EpcisImportRecord;
const asObservation = (held: EpcisStoredRecord): EpcisObservationRecord => held.value as unknown as EpcisObservationRecord;
const asResolution = (held: EpcisStoredRecord): EpcisResolutionRecord => held.value as unknown as EpcisResolutionRecord;
const toValue = (record: object): JsonObject => record as unknown as JsonObject;

const loadObservations = async (storage: EpcisExchangeStorage, scopeKey: string): Promise<EpcisObservationRecord[]> => (await listAll(storage, K.observation, `${scopeKey}.`)).map(asObservation);
const loadResolutions = async (storage: EpcisExchangeStorage, scopeKey: string): Promise<EpcisResolutionRecord[]> => (await listAll(storage, K.resolution, `${scopeKey}.`)).map(asResolution);

const covers = (resolution: EpcisResolutionRecord | undefined, bodies: ReadonlySet<string>): boolean => resolution != null && [...bodies].every((body) => resolution.bodyDigests.includes(body));

/**
 * Classify every event of a received import against what its source scope
 * already holds, and write the results as one batch: the new observations
 * and the record, together or not at all. Each observation takes the next
 * sequence under its identity and expects that place to be free, so two
 * writers cannot both take it; the one that loses classifies again.
 */
async function recordEventResults(storage: EpcisExchangeStorage, importKey: string, document: JsonObject, clock: () => string): Promise<EpcisImportRecord> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const held = await storage.get(K.import, importKey);
    if (held == null) throw new EpcisExchangeError('record-unreadable', `the import record ${importKey} is gone`);
    const record = asRecord(held);
    if (record.state !== 'received') return record;
    const observed = new Map<string, EpcisObservationRecord[]>();
    const decided = new Map<string, EpcisResolutionRecord | undefined>();
    const writes: EpcisStorageWrite[] = [];
    const events = record.events.map((event) => ({ ...event }));
    for (const event of events) {
      const source = atPointer(document, event.pointer) as JsonObject;
      const scopeKey = epcisEventScopeKey(record.sourceId, event.identityKind, event.identity);
      let priors = observed.get(scopeKey);
      if (priors == null) { priors = await loadObservations(storage, scopeKey); observed.set(scopeKey, priors); }
      const incoming = { identity: event.identity, bodyDigest: event.bodyDigest, ...(typeof source.recordTime === 'string' ? { recordTime: source.recordTime } : {}), ...(source.errorDeclaration === undefined ? {} : { errorDeclaration: source.errorDeclaration }) };
      const rawRecordTime = canonicalizeJcs(source.recordTime ?? null);
      let duplicateOf: EpcisObservationRecord | undefined;
      let sameBody = false;
      for (const prior of priors) {
        const arrival = classifyEventArrival({ identity: prior.identity, bodyDigest: prior.bodyDigest, ...(typeof prior.recordTime === 'string' ? { recordTime: prior.recordTime } : {}), ...(prior.errorDeclaration === undefined ? {} : { errorDeclaration: prior.errorDeclaration }) }, incoming);
        if (arrival === 'conflict') continue;
        sameBody = true;
        // The classifier compares a record time as a string. One that is not a string is compared as the value it is, so two different ones are never taken for a repeat.
        if (arrival === 'duplicate' && canonicalizeJcs(prior.recordTime ?? null) === rawRecordTime) { duplicateOf = prior; break; }
      }
      if (duplicateOf != null) {
        event.arrival = 'duplicate';
        event.observation = { sequence: duplicateOf.sequence, importId: duplicateOf.importId, pointer: duplicateOf.pointer };
        continue;
      }
      const arrival = priors.length === 0 ? 'new' : sameBody ? 'new-observation' : 'conflict';
      const observation: EpcisObservationRecord = {
        recordType: 'epcis-observation',
        recordVersion: EPCIS_RECORD_VERSION,
        sourceId: record.sourceId,
        identity: event.identity,
        identityKind: event.identityKind,
        ...(event.eventId == null ? {} : { eventId: event.eventId }),
        sequence: priors.length + 1,
        importId: record.importId,
        pointer: event.pointer,
        sourceSha256: record.sha256,
        eventType: event.eventType,
        bodyDigest: event.bodyDigest,
        ...(source.recordTime === undefined ? {} : { recordTime: source.recordTime }),
        ...(source.errorDeclaration === undefined ? {} : { errorDeclaration: source.errorDeclaration }),
        arrival,
        observedAt: record.receivedAt,
      };
      const other = priors.find((prior) => prior.bodyDigest !== event.bodyDigest);
      priors.push(observation);
      writes.push({ op: 'put', kind: K.observation, key: observationKey(scopeKey, observation.sequence), value: toValue(observation), expect: 'absent' });
      event.arrival = arrival;
      event.observation = { sequence: observation.sequence, importId: record.importId, pointer: event.pointer };
      if (other != null) {
        if (!decided.has(scopeKey)) decided.set(scopeKey, (await loadResolutions(storage, scopeKey)).at(-1));
        const latest = decided.get(scopeKey);
        const settled = covers(latest, new Set(priors.map((prior) => prior.bodyDigest)));
        event.conflict = {
          conflictId: epcisConflictId(record.sourceId, event.identityKind, event.identity),
          withImportId: other.importId,
          withPointer: other.pointer,
          withBodyDigest: other.bodyDigest,
          state: settled ? 'resolved' : 'open',
          ...(settled && latest != null ? { resolutionId: latest.resolutionId, resolution: latest.decision, resolvedAt: latest.decidedAt } : {}),
        };
      }
    }
    // A correction is resolved by an event of this document or by one already observed under the same source, never by another source's.
    const heldIdentities = new Set(events.filter((event) => event.identityKind === 'event-id').map((event) => event.identity));
    for (const named of new Set(events.flatMap((event) => event.errorDeclaration?.correctiveEventIDs ?? []))) {
      if (heldIdentities.has(named)) continue;
      const found = await storage.list(K.observation, { prefix: `${epcisEventScopeKey(record.sourceId, 'event-id', named)}.`, limit: 1 });
      if (found.length > 0) heldIdentities.add(named);
    }
    applyCorrections(events, heldIdentities);
    const evaluated: EpcisImportRecord = { ...record, events, state: events.some((event) => event.conflict?.state === 'open') ? 'blocked' : 'evaluated', updatedAt: clock() };
    writes.push({ op: 'put', kind: K.import, key: importKey, value: toValue(evaluated), expect: held.revision });
    const result = await storage.commit(writes);
    if (result.committed) return evaluated;
  }
  throw new EpcisExchangeError('storage-contention', `the event results of ${importKey} could not be written after ${ATTEMPTS} attempts; another writer keeps changing the same event identities`);
}

function associationWrites(record: EpcisImportRecord, importKey: string, document: JsonObject): EpcisStorageWrite[] {
  if (record.documentValidity !== 'valid') return [];
  const writes: EpcisStorageWrite[] = [];
  for (const event of record.events) {
    const source = atPointer(document, event.pointer) as JsonObject;
    for (const association of epcisEventAssociations(source, event.pointer)) {
      const value: EpcisAssociationRecord = {
        recordType: 'epcis-association',
        recordVersion: EPCIS_RECORD_VERSION,
        ...association,
        sourceId: record.sourceId,
        importId: record.importId,
        pointer: event.pointer,
        identity: event.identity,
        identityKind: event.identityKind,
        eventType: event.eventType,
        ...(event.eventTime == null ? {} : { eventTime: event.eventTime }),
        errorDeclared: event.errorDeclaration != null,
      };
      writes.push({ op: 'put', kind: K.association, key: associationKey(association.granularity, association.identifier, record.sourceId, importKey, writes.length), value: toValue(value) });
    }
  }
  return writes;
}

/** Index entries are whole values under keys that depend only on the record and the bytes, so writing them a second time changes nothing. */
async function writeAssociations(storage: EpcisExchangeStorage, record: EpcisImportRecord, importKey: string, document: JsonObject): Promise<number> {
  const writes = associationWrites(record, importKey, document);
  for (let start = 0; start < writes.length; start += ASSOCIATION_BATCH) await mustCommit(storage, writes.slice(start, start + ASSOCIATION_BATCH), 'the associations index');
  return writes.length;
}

/** The exact retained bytes of an import, checked against the digest they were recorded under. */
async function retainedBytes(storage: EpcisExchangeStorage, record: EpcisImportRecord): Promise<Uint8Array> {
  const bytes = await storage.getBytes(record.sha256);
  if (bytes == null) throw new EpcisExchangeError('retained-bytes-missing', `the bytes of ${record.importId} are not in the store`);
  if (bytes.byteLength !== record.byteLength || sha256Hex(bytes) !== record.sha256) throw new EpcisExchangeError('retained-bytes-mismatch', `the bytes held for ${record.importId} do not match the digest they were recorded under`);
  return bytes;
}

/** Compare source projections with a missing member distinct from an explicit JSON null. */
function sameProjection(a: unknown, b: unknown): boolean {
  return a === undefined || b === undefined ? a === b : canonicalizeJcs(a) === canonicalizeJcs(b);
}

function matchesSourceCorrection(receipt: EpcisImportEvent['errorDeclaration'], value: unknown, localIds: ReadonlySet<string>): boolean {
  const declared = epcisErrorDeclaration(value);
  if (receipt == null || declared == null) return receipt === declared;
  const { resolution, missing, ...fields } = receipt;
  if (!sameProjection(fields, declared)) return false;
  const ids = declared.correctiveEventIDs;
  if (resolution === 'resolved') return ids.length > 0 && missing === undefined;
  if (ids.length === 0) return missing === undefined;
  // Earlier imports may already have supplied some references. References in this document were always available.
  if (missing == null || missing.length === 0 || missing.some(id => localIds.has(id))) return false;
  const absent = new Set(missing);
  return sameProjection(missing, ids.filter(id => absent.has(id)));
}

/** The retained document, parsed again under the limits the import was accepted under. */
async function retainedDocument(storage: EpcisExchangeStorage, record: EpcisImportRecord): Promise<JsonObject> {
  const parsed = parseEpcisSource(await retainedBytes(storage, record), { mediaType: record.mediaType, limits: record.limits as Partial<EpcisLimits> });
  if (!parsed.ok) throw new EpcisExchangeError('record-unreadable', `the bytes of ${record.importId} no longer parse under the limits they were accepted under: ${parsed.reason}`);
  if (canonicalizeJcs(receiptContextRefs(parsed)) !== canonicalizeJcs(record.contextRefs)) throw new EpcisExchangeError('record-unreadable', `the context references of ${record.importId} differ from its source`);
  if (!sameProjection(record.envelope, parsed.envelope) || !sameProjection(record.preservedExtensions, preservedDocumentExtensions(parsed.document))) throw new EpcisExchangeError('record-unreadable', `the envelope or preserved extensions of ${record.importId} differ from its source`);
  if (record.events.length !== parsed.events.length) throw new EpcisExchangeError('record-unreadable', `the number of events in ${record.importId} differs from its source`);
  const localIds = new Set(parsed.events.flatMap(pointer => pointer.eventId == null ? [] : [pointer.eventId]));
  for (const [index, pointer] of parsed.events.entries()) {
    const event = record.events[index]!;
    const body = atPointer(parsed.document, pointer.pointer) as JsonObject;
    const matches = event.pointer === pointer.pointer && event.identityKind === pointer.identityKind && event.eventId === pointer.eventId
      && event.identity === (pointer.eventId ?? pointer.localIdentity) && event.eventType === pointer.type
      && event.bodyDigest === epcisEventBodyDigest(body, eventContextDigests(record.contextRefs, pointer.pointer))
      && event.eventTime === (typeof body.eventTime === 'string' ? body.eventTime : undefined)
      && event.recordTime === (typeof body.recordTime === 'string' ? body.recordTime : undefined)
      && matchesSourceCorrection(event.errorDeclaration, body.errorDeclaration, localIds)
      && sameProjection(event.identifiers, eventIdentifiers(body, pointer.pointer))
      && sameProjection(event.preservedExtensions, preservedEventExtensions(body));
    if (!matches) throw new EpcisExchangeError('record-unreadable', `event ${pointer.pointer} of ${record.importId} differs from its source`);
  }
  return parsed.document;
}

/** Steps 4 to 6 of an import, from wherever an earlier call left them. */
async function finishImport(storage: EpcisExchangeStorage, importKey: string, document: JsonObject | undefined, clock: () => string): Promise<{ record: EpcisImportRecord; from: 'received' | 'results-recorded' }> {
  const held = await storage.get(K.import, importKey);
  if (held == null) throw new EpcisExchangeError('record-unreadable', `the import record ${importKey} is gone`);
  const from = asRecord(held).state === 'received' ? 'received' : 'results-recorded';
  const source = document ?? (await retainedDocument(storage, asRecord(held)));
  const record = await recordEventResults(storage, importKey, source, clock);
  await writeAssociations(storage, record, importKey, source);
  await mustCommit(storage, [{ op: 'delete', kind: K.journal, key: importJournalKey(importKey) }], 'the journal');
  return { record, from };
}

/** Remove bytes no import holds. Bytes another import retains stay, whatever was interrupted. Only recovery calls it. */
async function discardUnheldBytes(storage: EpcisExchangeStorage, sha256: string): Promise<boolean> {
  if ((await storage.list(K.retention, { prefix: `${sha256}.`, limit: 1 })).length > 0) return false;
  const present = (await storage.getBytes(sha256)) != null;
  await storage.deleteBytes(sha256);
  return present;
}

/* ---------------------------------- import ------------------------------- */

/**
 * Import one EPCIS document.
 *
 * A transport that is unsafe to parse, over a limit or of the wrong media
 * type is refused and nothing is kept. A document that parses safely is
 * retained exactly as received, with its findings, whether or not it is
 * valid. The same request identifier with the same bytes answers the same
 * import and writes no second receipt; with different bytes it is a conflict
 * and the first stands.
 *
 * Nothing here signs, issues, anchors or moves anything.
 */
export function importEpcisSource(input: ImportEpcisSourceInput): Promise<EpcisImportOutcome> {
  const problem = requestProblem(input);
  if (problem != null) return Promise.resolve(refuse('invalid-request', problem));
  const clock = input.now ?? systemClock;
  const { storage } = input;
  return inTurn(storage, async (): Promise<EpcisImportOutcome> => {
    const importKey = epcisImportKey(input.sourceId, input.requestId);
    const journalKey = importJournalKey(importKey);
    const mediaType = mediaTypeBase(input.mediaType);
    let prepared: Prepared | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const existing = await storage.get(K.import, importKey);
      if (existing != null) {
        // A repeat is decided against the receipt alone: its bytes were accepted once, so they need no second parse, and bytes that differ need no parse at all.
        const record = asRecord(existing);
        const same = mediaType === record.mediaType && input.bytes.byteLength === record.byteLength && sha256Hex(input.bytes) === record.sha256;
        if (!same) return { outcome: 'request-conflict', sourceId: input.sourceId, requestId: input.requestId, existingImportId: record.importId, existingRequestDigest: record.requestDigest, detail: `request ${input.requestId} is already bound to other bytes or another media type under ${input.sourceId}; the earlier import stands` };
        if ((await storage.get(K.journal, journalKey)) == null) return { outcome: 'retained', replayed: true, resumed: false, record };
        const finished = await finishImport(storage, importKey, prepared?.document, clock);
        return { outcome: 'retained', replayed: true, resumed: true, record: finished.record };
      }
      if (prepared == null) {
        const outcome = prepare(input, clock);
        if ('outcome' in outcome) return outcome;
        prepared = outcome;
      }
      const { record, document } = prepared;

      // Step 1. An intake left by a call that stopped before its receipt was never acknowledged, so it is replaced.
      const stale = await storage.get(K.journal, journalKey);
      const intake: EpcisStorageWrite[] = [{ op: 'put', kind: K.journal, key: journalKey, value: journalEntry({ entry: 'intake', importId: record.importId, sourceId: record.sourceId, requestId: record.requestId, requestDigest: record.requestDigest, sha256: record.sha256, startedAt: clock() }), expect: stale?.revision ?? 'absent' }];
      // If it had put down other bytes, they are noted for recovery to remove. An import never removes bytes itself: another import may be about to hold them.
      const left = stale?.value as unknown as EpcisJournalRecord | undefined;
      if (left?.entry === 'intake' && left.sha256 !== record.sha256) intake.push({ op: 'put', kind: K.journal, key: discardJournalKey(left.sha256), value: journalEntry({ entry: 'discard', sha256: left.sha256, startedAt: clock() }) });
      if (!(await storage.commit(intake)).committed) continue;
      // Step 2.
      await storage.putBytes(record.sha256, input.bytes);
      // Step 3. The receipt, the retention entry and the journal move together.
      const noted = await storage.get(K.journal, journalKey);
      const retention: EpcisRetentionRecord = { recordType: 'epcis-retention', recordVersion: EPCIS_RECORD_VERSION, sha256: record.sha256, importId: record.importId };
      const receipt = await storage.commit([
        { op: 'put', kind: K.import, key: importKey, value: toValue(record), expect: 'absent' },
        { op: 'put', kind: K.retention, key: retentionKey(record.sha256, importKey), value: toValue(retention) },
        { op: 'put', kind: K.journal, key: journalKey, value: journalEntry({ entry: 'import', importId: record.importId, startedAt: clock() }), ...(noted == null ? { expect: 'absent' as const } : { expect: noted.revision }) },
      ]);
      if (!receipt.committed) continue;
      // Steps 4 to 6.
      const finished = await finishImport(storage, importKey, document, clock);
      return { outcome: 'retained', replayed: false, resumed: false, record: finished.record };
    }
    throw new EpcisExchangeError('storage-contention', `the import of request ${input.requestId} could not settle after ${ATTEMPTS} attempts; another writer keeps taking the same request`);
  });
}

/* ---------------------------------- reading ------------------------------ */

export async function getEpcisImport(storage: EpcisExchangeStorage, importId: string): Promise<EpcisImportRecord | undefined> {
  const importKey = importKeyOf(importId);
  if (importKey == null) return undefined;
  const held = await storage.get(K.import, importKey);
  return held == null ? undefined : asRecord(held);
}

export async function findEpcisImportByRequest(storage: EpcisExchangeStorage, sourceId: string, requestId: string): Promise<EpcisImportRecord | undefined> {
  const held = await storage.get(K.import, epcisImportKey(sourceId, requestId));
  return held == null ? undefined : asRecord(held);
}

/** A page of import records, in storage order. Pass the last record's `importId` as `after`. */
export async function listEpcisImports(storage: EpcisExchangeStorage, options: { after?: string; limit?: number } = {}): Promise<EpcisImportRecord[]> {
  const after = options.after == null ? undefined : importKeyOf(options.after);
  return (await storage.list(K.import, { ...(after == null ? {} : { after }), limit: options.limit ?? 50 })).map(asRecord);
}

/**
 * The retained original of an import: the bytes exactly as received, under
 * the media type they arrived with. It answers the original or nothing. A
 * projection is a different function with a different result type, so one
 * can never be handed over in place of the other.
 */
export async function exportEpcisSource(storage: EpcisExchangeStorage, importId: string): Promise<EpcisOriginalExport | undefined> {
  const record = await getEpcisImport(storage, importId);
  if (record == null) return undefined;
  const bytes = await retainedBytes(storage, record);
  return { kind: 'original', importId: record.importId, bytes, mediaType: record.mediaType, sha256: record.sha256, byteLength: record.byteLength };
}

/**
 * A generated view of an import's events: each event as parsed, with its
 * pointer, identity and body digest, in canonical JSON. It is labelled
 * derived, names the source it was made from and carries its own digest. It
 * is not an EPCIS envelope and is not the source.
 */
export async function deriveEpcisEventProjection(storage: EpcisExchangeStorage, importId: string): Promise<EpcisDerivedProjection | undefined> {
  const record = await getEpcisImport(storage, importId);
  if (record == null) return undefined;
  const document = await retainedDocument(storage, record);
  const derivedFrom = { importId: record.importId, sha256: record.sha256, mediaType: record.mediaType };
  const body = {
    derived: true,
    projection: EPCIS_EVENT_PROJECTION,
    derivedFrom,
    events: record.events.map((event) => ({ pointer: event.pointer, identity: event.identity, identityKind: event.identityKind, eventType: event.eventType, bodyDigest: event.bodyDigest, event: atPointer(document, event.pointer) })),
  };
  const bytes = new TextEncoder().encode(canonicalizeJcs(body));
  return { kind: 'derived', derived: true, projection: EPCIS_EVENT_PROJECTION, derivedFrom, bytes, mediaType: 'application/json', sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
}

/* --------------------------------- conflicts ----------------------------- */

async function readConflict(storage: EpcisExchangeStorage, conflictId: string): Promise<EpcisConflict | undefined> {
  const scopeKey = conflictScopeKeyOf(conflictId);
  if (scopeKey == null) return undefined;
  const observations = await loadObservations(storage, scopeKey);
  const bodies = new Set(observations.map((observation) => observation.bodyDigest));
  if (bodies.size < 2) return undefined;
  const resolutions = await loadResolutions(storage, scopeKey);
  const latest = resolutions.at(-1);
  const first = observations[0]!;
  return {
    conflictId,
    sourceId: first.sourceId,
    identity: first.identity,
    identityKind: first.identityKind,
    state: covers(latest, bodies) ? 'resolved' : 'open',
    bodyDigests: [...bodies].sort(),
    observations,
    resolutions,
    ...(latest == null ? {} : { currentResolutionId: latest.resolutionId }),
  };
}

/** The bodies held under one event identity when there is more than one, every observation of them, and every decision made. Undefined when the identity holds one body or none. */
export function getEpcisConflict(storage: EpcisExchangeStorage, conflictId: string): Promise<EpcisConflict | undefined> {
  return readConflict(storage, conflictId);
}

/** Mark the imports a decision releases. The decision record is the truth; this only brings the import records into line with it, so it can be repeated. */
async function applyResolution(storage: EpcisExchangeStorage, conflictId: string, clock: () => string): Promise<number> {
  const conflict = await readConflict(storage, conflictId);
  const latest = conflict?.resolutions.at(-1);
  // A body that arrived after the decision is not covered by it. The conflict is open again and nothing is released.
  if (conflict == null || latest == null || conflict.state !== 'resolved') return 0;
  let updated = 0;
  for (const importId of new Set(conflict.observations.map((observation) => observation.importId))) {
    const importKey = importKeyOf(importId);
    if (importKey == null) continue;
    for (let attempt = 0; ; attempt += 1) {
      const held = await storage.get(K.import, importKey);
      if (held == null) break;
      const record = asRecord(held);
      if (record.state === 'received') break;
      let changed = false;
      const events = record.events.map((event) => {
        if (event.conflict?.conflictId !== conflictId || event.conflict.resolutionId === latest.resolutionId) return event;
        changed = true;
        return { ...event, conflict: { ...event.conflict, state: 'resolved' as const, resolutionId: latest.resolutionId, resolution: latest.decision, resolvedAt: latest.decidedAt } };
      });
      if (!changed) break;
      const next: EpcisImportRecord = { ...record, events, state: events.some((event) => event.conflict?.state === 'open') ? 'blocked' : 'evaluated', updatedAt: clock() };
      if ((await storage.commit([{ op: 'put', kind: K.import, key: importKey, value: toValue(next), expect: held.revision }])).committed) { updated += 1; break; }
      // The attempt that just lost is counted, so the bound is the one every other write here has and the one the message states.
      if (attempt + 1 >= ATTEMPTS) throw new EpcisExchangeError('storage-contention', `${importId} could not be released after ${ATTEMPTS} attempts`);
    }
  }
  return updated;
}

/**
 * Record a decision about a conflict: what was decided, its disposition and
 * time, and a reference to every competing observation. No observation and
 * no source is changed or removed. A decision cannot be rebuilt from any
 * source, so it is its own versioned record, appended and never edited: a
 * later decision supersedes an earlier one and both are kept.
 */
export function resolveEpcisConflict(storage: EpcisExchangeStorage, input: ResolveEpcisConflictInput): Promise<EpcisResolutionOutcome> {
  const refused = (reason: 'no-conflict' | 'invalid-request', detail: string): EpcisResolutionOutcome => ({ outcome: 'refused', reason, detail });
  const dispositions: readonly string[] = ['body-selected', 'all-retained', 'none-relied-on'];
  if (input == null || typeof input !== 'object') return Promise.resolve(refused('invalid-request', 'a decision is described by an object'));
  if (typeof input.conflictId !== 'string' || conflictScopeKeyOf(input.conflictId) == null) return Promise.resolve(refused('invalid-request', 'conflictId is the identity getEpcisConflict or an import record gives'));
  if (typeof input.decision !== 'string' || input.decision.trim() === '' || input.decision.length > 4000) return Promise.resolve(refused('invalid-request', 'a decision says what was decided, in 1 to 4000 characters'));
  if (!dispositions.includes(input.disposition)) return Promise.resolve(refused('invalid-request', `disposition is one of ${dispositions.join(', ')}`));
  if (typeof input.decidedAt !== 'string' || !DATE_TIME.test(input.decidedAt) || Number.isNaN(Date.parse(input.decidedAt))) return Promise.resolve(refused('invalid-request', 'decidedAt is an ISO 8601 date-time with a zone'));
  if (input.decidedBy !== undefined && (typeof input.decidedBy !== 'string' || input.decidedBy.length < 1 || input.decidedBy.length > 256 || CONTROL.test(input.decidedBy))) return Promise.resolve(refused('invalid-request', 'decidedBy is 1 to 256 characters'));
  if ((input.disposition === 'body-selected') !== (input.selectedBodyDigest !== undefined)) return Promise.resolve(refused('invalid-request', 'selectedBodyDigest is given for body-selected and for no other disposition'));
  if (input.selectedBodyDigest !== undefined && !SHA256.test(String(input.selectedBodyDigest))) return Promise.resolve(refused('invalid-request', 'selectedBodyDigest is a body digest'));
  const clock = input.now ?? systemClock;
  return inTurn(storage, async (): Promise<EpcisResolutionOutcome> => {
    const scopeKey = conflictScopeKeyOf(input.conflictId) as string;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const conflict = await readConflict(storage, input.conflictId);
      if (conflict == null) return refused('no-conflict', 'no event identity with more than one body is held under that conflictId');
      if (input.selectedBodyDigest !== undefined && !conflict.bodyDigests.includes(input.selectedBodyDigest)) return refused('invalid-request', 'selectedBodyDigest is not one of the competing bodies');
      const latest = conflict.resolutions.at(-1);
      const repeats = latest != null && conflict.state === 'resolved' && latest.decision === input.decision && latest.disposition === input.disposition && latest.decidedAt === input.decidedAt && latest.decidedBy === input.decidedBy && latest.selectedBodyDigest === input.selectedBodyDigest;
      const journalKey = resolutionJournalKey(scopeKey);
      if (repeats) {
        // The same decision again answers the one recorded, and finishes releasing imports if an earlier call stopped before it had.
        if ((await storage.get(K.journal, journalKey)) != null) {
          await applyResolution(storage, input.conflictId, clock);
          await mustCommit(storage, [{ op: 'delete', kind: K.journal, key: journalKey }], 'the journal');
        }
        return { outcome: 'recorded', replayed: true, resolution: latest };
      }
      const sequence = conflict.resolutions.length + 1;
      const resolution: EpcisResolutionRecord = {
        recordType: 'epcis-conflict-resolution',
        recordVersion: EPCIS_RECORD_VERSION,
        resolutionId: epcisResolutionId(scopeKey, sequence),
        conflictId: input.conflictId,
        sourceId: conflict.sourceId,
        identity: conflict.identity,
        identityKind: conflict.identityKind,
        sequence,
        ...(latest == null ? {} : { supersedes: latest.resolutionId }),
        decision: input.decision,
        disposition: input.disposition,
        ...(input.selectedBodyDigest === undefined ? {} : { selectedBodyDigest: input.selectedBodyDigest }),
        decidedAt: input.decidedAt,
        ...(input.decidedBy === undefined ? {} : { decidedBy: input.decidedBy }),
        bodyDigests: conflict.bodyDigests,
        observations: conflict.observations.map((observation) => ({ sequence: observation.sequence, importId: observation.importId, pointer: observation.pointer, sourceSha256: observation.sourceSha256, bodyDigest: observation.bodyDigest })),
      };
      const pending = await storage.get(K.journal, journalKey);
      const written = await storage.commit([
        { op: 'put', kind: K.resolution, key: resolutionKey(scopeKey, sequence), value: toValue(resolution), expect: 'absent' },
        { op: 'put', kind: K.journal, key: journalKey, value: journalEntry({ entry: 'resolution', conflictId: input.conflictId, resolutionId: resolution.resolutionId, startedAt: clock() }), ...(pending == null ? { expect: 'absent' as const } : { expect: pending.revision }) },
      ]);
      if (!written.committed) continue;
      await applyResolution(storage, input.conflictId, clock);
      await mustCommit(storage, [{ op: 'delete', kind: K.journal, key: journalKey }], 'the journal');
      return { outcome: 'recorded', replayed: false, resolution };
    }
    throw new EpcisExchangeError('storage-contention', `the decision on ${input.conflictId} could not be written after ${ATTEMPTS} attempts`);
  });
}

/* -------------------------------- associations --------------------------- */

/**
 * The events an identifier takes part in, with the role each event gives it.
 * An individual item and a class are asked for separately and never answer
 * for each other: a quantity of a class is not an item's participation.
 * Only valid imports are indexed.
 */
export async function findEpcisAssociations(storage: EpcisExchangeStorage, query: EpcisAssociationQuery): Promise<EpcisAssociationPage> {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 1000);
  const prefix = `${associationSubjectKey(query.granularity, query.identifier)}.${query.sourceId == null ? '' : `${associationSourceKey(query.sourceId)}.`}`;
  const page = await storage.list(K.association, { prefix, ...(query.after == null ? {} : { after: query.after }), limit: limit + 1 });
  const kept = page.slice(0, limit);
  return { associations: kept.map((held) => held.value as unknown as EpcisAssociationRecord), ...(page.length > limit ? { next: kept[kept.length - 1]!.key } : {}) };
}

async function rebuildAssociations(storage: EpcisExchangeStorage, clock: () => string): Promise<EpcisRebuildReport> {
  const pending = await storage.get(K.journal, REBUILD_JOURNAL_KEY);
  await mustCommit(storage, [{ op: 'put', kind: K.journal, key: REBUILD_JOURNAL_KEY, value: journalEntry({ entry: 'rebuild', startedAt: clock() }), ...(pending == null ? { expect: 'absent' as const } : { expect: pending.revision }) }], 'the journal');
  const report: EpcisRebuildReport = { importsRead: 0, importsIndexed: 0, associationsRemoved: 0, associationsWritten: 0 };
  for (;;) {
    const page = await storage.list(K.association, { limit: ASSOCIATION_BATCH });
    if (page.length === 0) break;
    await mustCommit(storage, page.map((held) => ({ op: 'delete' as const, kind: K.association, key: held.key })), 'the associations index');
    report.associationsRemoved += page.length;
  }
  let after: string | undefined;
  for (;;) {
    const page = await storage.list(K.import, { ...(after == null ? {} : { after }), limit: 20 });
    for (const held of page) {
      const record = asRecord(held);
      report.importsRead += 1;
      // An import that is not yet evaluated is indexed when it is finished, by the call or the recovery that finishes it.
      if (record.state === 'received' || record.documentValidity !== 'valid') continue;
      report.associationsWritten += await writeAssociations(storage, record, held.key, await retainedDocument(storage, record));
      report.importsIndexed += 1;
    }
    if (page.length < 20) break;
    after = page[page.length - 1]!.key;
  }
  await mustCommit(storage, [{ op: 'delete', kind: K.journal, key: REBUILD_JOURNAL_KEY }], 'the journal');
  return report;
}

/**
 * Rebuild the associations index from the import records and the retained
 * bytes alone. The index holds nothing that is not in them, so a rebuilt
 * index is exactly the one built as imports arrived.
 */
export function rebuildEpcisAssociations(storage: EpcisExchangeStorage, options: { now?: () => string } = {}): Promise<EpcisRebuildReport> {
  return inTurn(storage, () => rebuildAssociations(storage, options.now ?? systemClock));
}

/* ---------------------------------- recovery ----------------------------- */

/**
 * Finish or discard what a stopped process left, and say what was done.
 *
 * Run it when a store is opened, before any import is accepted: it assumes
 * no other call is in flight on the same store. It is the only place bytes
 * are ever removed, which is why it must run alone. After it:
 *
 * - every source a caller was told about is held, with its record;
 * - nothing is half recorded: a request that never reached its receipt has
 *   left no bytes and no record;
 * - every import is evaluated, every decision is applied, and the index is
 *   complete.
 *
 * It needs no GS1 file: a receipt already holds its validation.
 *
 * One kind of unfinished work it cannot finish: a restore of a recovery
 * snapshot (recovery.ts). It reports the restore as pending and leaves its
 * entry, and the restore is run again with the same snapshot.
 */
export function recoverEpcisExchange(storage: EpcisExchangeStorage, options: { now?: () => string } = {}): Promise<EpcisRecoveryReport> {
  const clock = options.now ?? systemClock;
  return inTurn(storage, async (): Promise<EpcisRecoveryReport> => {
    const actions: EpcisRecoveryAction[] = [];
    const entries = await listAll(storage, K.journal);
    // An interrupted rebuild is repeated last, so it indexes the imports that are finished first.
    entries.sort((a, b) => Number((a.value as unknown as EpcisJournalRecord).entry === 'rebuild') - Number((b.value as unknown as EpcisJournalRecord).entry === 'rebuild'));
    for (const held of entries) {
      const entry = held.value as unknown as EpcisJournalRecord;
      const clear = (): Promise<void> => mustCommit(storage, [{ op: 'delete', kind: K.journal, key: held.key }], 'the journal');
      if (entry.entry === 'intake') {
        // No receipt was written, so no caller was told the source is held. What the attempt left is removed.
        const bytesRemoved = await discardUnheldBytes(storage, entry.sha256);
        await clear();
        actions.push({ action: 'intake-discarded', importId: entry.importId, sha256: entry.sha256, bytesRemoved });
      } else if (entry.entry === 'import') {
        const importKey = importKeyOf(entry.importId);
        if (importKey == null || (await storage.get(K.import, importKey)) == null) {
          await clear();
          actions.push({ action: 'journal-discarded', key: held.key, detail: 'it names an import that has no record' });
          continue;
        }
        const finished = await finishImport(storage, importKey, undefined, clock);
        actions.push({ action: 'import-finished', importId: entry.importId, from: finished.from, state: finished.record.state });
      } else if (entry.entry === 'resolution') {
        const importsUpdated = await applyResolution(storage, entry.conflictId, clock);
        await clear();
        actions.push({ action: 'resolution-applied', conflictId: entry.conflictId, resolutionId: entry.resolutionId, importsUpdated });
      } else if (entry.entry === 'discard') {
        const bytesRemoved = await discardUnheldBytes(storage, entry.sha256);
        await clear();
        actions.push({ action: 'bytes-discarded', sha256: entry.sha256, bytesRemoved });
      } else if (entry.entry === 'rebuild') {
        const report = await rebuildAssociations(storage, clock);
        actions.push({ action: 'associations-rebuilt', importsIndexed: report.importsIndexed, associationsWritten: report.associationsWritten });
      } else if (entry.entry === 'restore') {
        // Only the restore holds the snapshot, so only it can finish. The entry stays, and the store says it is unfinished until the restore is run again.
        actions.push({ action: 'restore-pending', snapshotId: entry.snapshotId });
      } else {
        await clear();
        actions.push({ action: 'journal-discarded', key: held.key, detail: 'it is not an entry this version writes' });
      }
    }
    return { actions, remaining: (await listAll(storage, K.journal)).length };
  });
}

/**
 * Check a store against the promises of this module and list every breach.
 * An empty list means: nothing is journalled as unfinished; every import has
 * its exact bytes, its retention entry and its event results; every
 * observation belongs to an import that names it; sequences have no gap; and
 * every page a pull acknowledged has its page record and its import.
 * With `associations`, the index is also compared with what a rebuild would
 * write. The adapter suite runs it after every simulated crash.
 */
export async function checkEpcisExchangeInvariants(storage: EpcisExchangeStorage, options: { associations?: boolean } = {}): Promise<string[]> {
  const breaches: string[] = [];
  for (const held of await listAll(storage, K.journal)) breaches.push(`journal ${held.key}: unfinished ${(held.value as unknown as EpcisJournalRecord).entry}`);
  const imports = new Map<string, EpcisImportRecord>();
  const resolvedReferences = new Set<string>();
  const expected = new Map<string, JsonObject>();
  for (const held of await listAll(storage, K.import)) {
    const record = asRecord(held);
    imports.set(record.importId, record);
    if (held.key !== importKeyOf(record.importId) || held.key !== epcisImportKey(record.sourceId, record.requestId)) breaches.push(`import ${held.key}: filed under a key that is not its request's`);
    if (record.state === 'received') breaches.push(`import ${record.importId}: still received`);
    if ((await storage.get(K.retention, retentionKey(record.sha256, held.key))) == null) breaches.push(`import ${record.importId}: no retention entry`);
    let document: JsonObject | undefined;
    try { document = await retainedDocument(storage, record); } catch (error) { breaches.push(`import ${record.importId}: ${(error as Error).message}`); }
    for (const event of record.events) {
      if (record.state === 'received') continue;
      if (event.errorDeclaration?.resolution === 'resolved') {
        for (const id of event.errorDeclaration.correctiveEventIDs) resolvedReferences.add(epcisEventScopeKey(record.sourceId, 'event-id', id));
      }
      if (event.arrival == null || event.observation == null) { breaches.push(`import ${record.importId} ${event.pointer}: no arrival recorded`); continue; }
      const observation = await storage.get(K.observation, observationKey(epcisEventScopeKey(record.sourceId, event.identityKind, event.identity), event.observation.sequence));
      if (observation == null) { breaches.push(`import ${record.importId} ${event.pointer}: its observation is not held`); continue; }
      const value = asObservation(observation);
      if (value.bodyDigest !== event.bodyDigest) breaches.push(`import ${record.importId} ${event.pointer}: its observation holds another body`);
      if (value.importId !== event.observation.importId || value.pointer !== event.observation.pointer || value.sequence !== event.observation.sequence
        || (event.arrival === 'duplicate' && value.sourceId !== record.sourceId) || value.identityKind !== event.identityKind || value.identity !== event.identity
        || value.eventId !== event.eventId || value.eventType !== event.eventType) breaches.push(`import ${record.importId} ${event.pointer}: its observation names another event`);
      if (document == null) continue;
      const source = atPointer(document, event.pointer) as JsonObject;
      if (event.arrival === 'duplicate') {
        // Historic duplicate detection treats a missing repository value and JSON null as equal.
        if (!sameProjection(value.recordTime ?? null, source.recordTime ?? null) || !sameProjection(value.errorDeclaration ?? null, source.errorDeclaration ?? null)) breaches.push(`import ${record.importId} ${event.pointer}: its observation has different repository fields`);
      } else if (value.importId !== record.importId || value.pointer !== event.pointer || value.arrival !== event.arrival
        || value.sourceSha256 !== record.sha256 || value.observedAt !== record.receivedAt
        || !sameProjection(value.recordTime, source.recordTime) || !sameProjection(value.errorDeclaration, source.errorDeclaration)) {
        breaches.push(`import ${record.importId} ${event.pointer}: its observation differs from its retained arrival`);
      }
    }
    if (options.associations === true && document != null) for (const write of associationWrites(record, held.key, document)) if (write.op === 'put') expected.set(write.key, write.value);
  }
  let scope = '';
  let sequence = 0;
  for (const held of await listAll(storage, K.observation)) {
    const value = asObservation(held);
    const owner = imports.get(value.importId);
    if (owner == null) breaches.push(`observation ${held.key}: its import is not held`);
    // An observation is one source scope's. An import of another scope never accounts for it, whatever identity and bytes the two share.
    else if (owner.sourceId !== value.sourceId) breaches.push(`observation ${held.key}: it names the source scope ${JSON.stringify(value.sourceId)}, and its import belongs to ${JSON.stringify(owner.sourceId)}`);
    else if (!owner.events.some((event) => event.pointer === value.pointer && event.identity === value.identity && event.observation?.sequence === value.sequence && event.arrival !== 'duplicate')) breaches.push(`observation ${held.key}: its import does not name it`);
    const [scopeKey] = held.key.split('.');
    resolvedReferences.delete(epcisEventScopeKey(value.sourceId, value.identityKind, value.identity));
    sequence = scopeKey === scope ? sequence + 1 : 1;
    scope = scopeKey!;
    if (value.sequence !== sequence) breaches.push(`observation ${held.key}: sequence ${value.sequence} where ${sequence} was expected`);
  }
  for (const reference of resolvedReferences) breaches.push(`resolved correction ${reference}: no referenced event is held under that source`);
  for (const held of await listAll(storage, K.retention)) {
    const value = held.value as unknown as EpcisRetentionRecord;
    if (imports.get(value.importId)?.sha256 !== value.sha256) breaches.push(`retention ${held.key}: no import holds those bytes under that identity`);
  }
  for (const held of await listAll(storage, K.resolution)) {
    const value = asResolution(held);
    for (const reference of value.observations) {
      const scopeKey = conflictScopeKeyOf(value.conflictId);
      if (scopeKey == null || (await storage.get(K.observation, observationKey(scopeKey, reference.sequence))) == null) breaches.push(`resolution ${value.resolutionId}: observation ${reference.sequence} is not held`);
    }
  }
  // A pull's checkpoint never points past what is retained: every page it acknowledged has its record, in order, and its import.
  for (const held of await listAll(storage, K.pull)) {
    const pull = held.value as unknown as EpcisPullRecord;
    const pages = (await listAll(storage, K.pullPage, `${held.key}.`)).map((page) => page.value as unknown as EpcisPullPageRecord);
    if (pages.length !== pull.pagesAcknowledged) breaches.push(`pull ${pull.pullId}: ${pull.pagesAcknowledged} pages acknowledged and ${pages.length} page records held`);
    pages.forEach((page, index) => {
      if (page.sequence !== index + 1) breaches.push(`pull ${pull.pullId}: page record ${page.sequence} where ${index + 1} was expected`);
      const owner = imports.get(page.importId);
      if (owner?.sha256 !== page.sha256) breaches.push(`pull ${pull.pullId} page ${page.sequence}: its import is not held with those bytes`);
      // A page is its pull's, and a pull is one source scope's: bytes two scopes both hold never make one scope's page out of the other's import.
      else if (page.sourceId !== pull.sourceId || owner.sourceId !== pull.sourceId) breaches.push(`pull ${pull.pullId} page ${page.sequence}: the pull belongs to the source scope ${JSON.stringify(pull.sourceId)}, the page names ${JSON.stringify(page.sourceId)} and its import belongs to ${JSON.stringify(owner.sourceId)}`);
    });
    if (pull.cursor != null && pull.cursor.afterPage !== pull.pass.pagesAcknowledged) breaches.push(`pull ${pull.pullId}: the cursor was named by page ${pull.cursor.afterPage} and the pass has acknowledged ${pull.pass.pagesAcknowledged}`);
  }
  if (options.associations === true) {
    const found = new Map((await listAll(storage, K.association)).map((held) => [held.key, held.value]));
    for (const [key, value] of expected) if (canonicalizeJcs(found.get(key) ?? null) !== canonicalizeJcs(value)) breaches.push(`association ${key}: missing or different from what the sources give`);
    for (const key of found.keys()) if (!expected.has(key)) breaches.push(`association ${key}: not given by any source`);
  }
  return breaches;
}
