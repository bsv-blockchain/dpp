/**
 * The query pull of the epcis-json@1 profile: one bounded run against the
 * standard events query of a configured source
 * (`spec/epcis-interoperability.md` section 3).
 *
 * What this is: a client of the standard query interface. It asks a source
 * for pages of events, hands each page to the same import path a file takes,
 * and keeps a durable record of how far it got.
 *
 * What this is not: an EPCIS repository, a capture interface, a subscription
 * or a crawler. It does not promise the complete history of a source, and a
 * run that stopped early never says it finished.
 *
 * A pull is one configured query against one source scope. It lives as long
 * as the caller keeps asking, in passes: each pass walks the source's pages
 * for one window of the query, over as many bounded runs as that takes.
 *
 * The durable steps of one run, in order:
 *
 *   1. the pull record       status `running`, the limits in force, the pass
 *                            and where it resumes
 *   then, for each page:
 *   2. the page noted        what was read and where the next page is, in the
 *                            pull record. The bytes are still in memory
 *   3. the import            the six durable steps of importEpcisSource
 *   4. the checkpoint        the page record and the pull record moved past
 *                            the page, in one batch
 *   and at the end:
 *   5. the pull record       how the run ended
 *
 * The checkpoint is step 4 and only step 4, and it follows the import. So
 * the pull record never points past a page that is not retained. A run that
 * stopped between steps 2 and 4 left a note: the next run finds the page's
 * receipt and finishes it without asking the source again, or finds none and
 * asks again from the checkpoint. Either way no page is skipped and no page
 * is acknowledged twice.
 */
import { EPCIS_DEFAULT_LIMITS, resolveEpcisLimits, type EpcisLimits } from '../epcis-source.js';
import { EPCIS_GS1_ARTEFACTS, Gs1ArtefactUnavailableError, readGs1Artefact } from '../gs1-artefacts.js';
import type { JsonObject } from '../types.js';
import { EpcisExchangeError, findEpcisImportByRequest, getEpcisImport, importEpcisSource, type EpcisImportPolicy, type EpcisImportRefusal } from './exchange.js';
import {
  CBV_WIRE_VERSION,
  EPCIS_WIRE_VERSION,
  credentialGuard,
  credentialProblem,
  fetchEpcisPage,
  type EpcisCredentialGuard,
  type EpcisFetch,
  type EpcisPageAnswer,
  type EpcisPullLogEntry,
  type EpcisSourceCredential,
  type EpcisTargetPolicy,
} from './pull-transport.js';
import {
  EPCIS_PULL_VERSION,
  EPCIS_RECORD_KINDS,
  epcisPullDefinitionDigest,
  epcisPullId,
  epcisPullKey,
  pullKeyOf,
  pullPageKey,
  type EpcisImportRecord,
  type EpcisPullCompletion,
  type EpcisPullEventCounts,
  type EpcisPullLeniency,
  type EpcisPullPageRecord,
  type EpcisPullPass,
  type EpcisPullPending,
  type EpcisPullQuery,
  type EpcisPullReason,
  type EpcisPullRecord,
  type EpcisPullRunSummary,
  type EpcisPullServerVersions,
  type EpcisPullSourceScope,
  type EpcisRetentionRecord,
  type EpcisSourceOutcome,
} from './records.js';
import { sha256Hex, type EpcisExchangeStorage, type EpcisStorageWrite } from './storage.js';

/* ---------------------------------- shape -------------------------------- */

/**
 * The most an operator may raise each limit to. The profile lets an operator
 * lower a limit or configure a bounded higher one, and these are this
 * build's bounds. A value past one is refused, not clamped.
 */
export const EPCIS_PULL_LIMIT_CEILINGS: EpcisLimits = {
  maxDocumentBytes: 16 * 1024 * 1024,
  maxEventsPerPage: 1000,
  maxJsonDepth: 128,
  maxContextDocuments: 64,
  maxContextBytes: 4 * 1024 * 1024,
  fetchTimeoutMs: 60_000,
  maxPullPages: 100,
  maxPullBytes: 200 * 1024 * 1024,
  maxPullSeconds: 600,
};

/** How far before the watermark a later pass begins, unless the caller says otherwise. */
export const EPCIS_PULL_DEFAULT_OVERLAP_SECONDS = 300;
export const EPCIS_PULL_MAX_OVERLAP_SECONDS = 86_400;
/** A run falls back to a replay at most this often. A second cursor that cannot be reused ends the run. */
export const EPCIS_PULL_MAX_REPLAYS_PER_RUN = 1;

/** The outcome each reason belongs to. A reason never appears under another outcome. */
export const EPCIS_PULL_REASON_OUTCOME: Record<EpcisPullReason, EpcisSourceOutcome> = {
  exhausted: 'ok',
  'page-limit': 'partial-history',
  'byte-limit': 'partial-history',
  'time-limit': 'partial-history',
  'cursor-unusable': 'partial-history',
  'pagination-malformed': 'partial-history',
  'pagination-target-refused': 'partial-history',
  'no-base-address': 'source-link-missing',
  'http-401': 'source-authentication-required',
  'http-403': 'source-forbidden',
  timeout: 'source-unavailable',
  'network-error': 'source-unavailable',
  'http-error': 'source-unavailable',
  'redirect-refused': 'source-unavailable',
  'redirect-limit': 'source-unavailable',
  'redirect-malformed': 'source-unavailable',
  'target-refused': 'source-unavailable',
  'media-type': 'unexpected-media-type',
  'html-body': 'unexpected-media-type',
  'page-oversized': 'invalid-source',
  'wire-version-missing': 'invalid-source',
  'wire-version-unsupported': 'invalid-source',
  'credential-echoed': 'invalid-source',
  'import-refused': 'invalid-source',
};

/** A configured source: where it is, where its requests may go, the limits in force and how its credential is obtained. */
export interface EpcisPullSource {
  /** The configured origin the events are scoped under. It names an origin, never an account. */
  sourceId: string;
  /** The address the events query is made under: `<baseUrl>/events`. Without user information, a query or a fragment. Absent when no EPCIS link is known for the source. */
  baseUrl?: string;
  /** Every origin a request may be made to, the base address's own included. A redirect or a next page anywhere else is refused before it is requested. */
  permittedOrigins: string[];
  /** The named operator policy and the limits it sets. Limits it does not name take the profile's defaults. */
  policy: EpcisImportPolicy;
  /**
   * How the credential is obtained, when the source needs one. Called once as
   * a run begins, on the server. The credential is sent to the base
   * address's origin and to no other, and is written nowhere.
   */
  credentials?: () => EpcisSourceCredential | undefined | Promise<EpcisSourceCredential | undefined>;
  /** Permits plain http and private addresses. For local tests only, and recorded in every result. */
  localTest?: boolean;
  /** The versions sent in GS1-EPCIS-Version and GS1-CBV-Version, when not the defaults. */
  wireVersions?: { epcis?: string; cbv?: string };
}

/** The query as a caller writes it. `perPage` defaults to the page event limit in force. */
export interface EpcisPullQueryInput {
  matchAnyEPC?: string[];
  eventTypes?: string[];
  eventTime?: { from?: string; until?: string };
  recordTime?: { from?: string };
  eventIds?: string[];
  perPage?: number;
}

export interface PullEpcisEventsInput {
  storage: EpcisExchangeStorage;
  source: EpcisPullSource;
  /** The caller's name for this configured query. Unique within one `sourceId`, and bound to the query's definition. */
  queryId: string;
  query: EpcisPullQueryInput;
  /** The transport. Nothing is requested except through it. */
  fetch: EpcisFetch;
  /** How far before the watermark a later pass begins. 300 seconds by default, at most one day. */
  recordTimeOverlapSeconds?: number;
  /** Where a new pass begins once the one before it is exhausted: at the watermark less the overlap, or at the query's own bounds again. Ignored while a pass is unfinished. */
  window?: 'watermark' | 'query-bounds';
  /** The folder the pinned GS1 schema is read from; see gs1-artefacts.ts for the default. */
  artefactsDir?: string;
  /** The clock, as ISO 8601 date-times. The system clock by default. */
  now?: () => string;
  /** Receives one entry per request, page, replay, checkpoint and run. No entry carries a credential. */
  log?: (entry: EpcisPullLogEntry) => void;
  /** The addresses a host name resolves to, so that a name leading to a private address is refused. The transport must connect to an address that was checked. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

/** Nothing was requested and nothing was written. */
export interface EpcisPullRefusal {
  outcome: 'refused';
  reason: 'invalid-request' | 'pull-conflict' | 'gs1-artefact-unavailable' | 'credentials-unavailable';
  detail: string;
  remedy?: string;
}

export interface EpcisPullResult {
  /** One of the eight source outcomes. */
  outcome: EpcisSourceOutcome;
  /** The named cause within the outcome. */
  reason: EpcisPullReason;
  /** Whether the source's pages were exhausted, a run limit stopped the run, or it failed. */
  completion: EpcisPullCompletion;
  /** True only when the source named no further page for the pass. It is never a statement that the source's history is complete. */
  exhausted: boolean;
  detail: string;
  /** The status the source answered, when a status ended the run. */
  status?: number;
  /** Why the import path refused a page, when the reason is `import-refused`. */
  importRefusal?: EpcisImportRefusal | 'request-conflict';
  sourceId: string;
  queryId: string;
  /** The durable state after the run. Absent only when the source has no base address, so nothing was begun. */
  pull?: EpcisPullRecord;
  run: EpcisPullRunSummary;
  /** The pages this run acknowledged, in order. */
  pages: EpcisPullPageRecord[];
  /** How the events of those pages arrived. */
  events: EpcisPullEventCounts;
  /** The limits in force, and each one the operator set away from the default. */
  limits: EpcisLimits;
  limitOverrides: Array<{ limit: string; default: number; value: number }>;
  /** True when plain http and private addresses were permitted. */
  localTest: boolean;
  /** The versions the source reported on the last page read. */
  server: EpcisPullServerVersions;
  /** Every leniency a page of this run needed. */
  leniencies: EpcisPullLeniency[];
  /** Set when this run fell back to a replay. */
  replay?: EpcisPullRecord['replay'];
  /** Every reason the retained events are not the complete history of the source. Never empty. */
  completenessLimits: string[];
}

export type EpcisPullOutcome = EpcisPullRefusal | EpcisPullResult;

/* --------------------------------- helpers ------------------------------- */

const K = EPCIS_RECORD_KINDS;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const WIRE_VERSION = /^\d{1,3}\.\d{1,3}(\.\d{1,4})?$/;
const MAX_LIST = 100;
const MAX_VALUE = 2048;
const MAX_PARAMETER = 4096;
const STOP_LIMITS: readonly EpcisPullReason[] = ['page-limit', 'byte-limit', 'time-limit'];

const systemClock = (): string => new Date().toISOString();
const toValue = (record: object): JsonObject => JSON.parse(JSON.stringify(record)) as JsonObject;
const noEvents = (): EpcisPullEventCounts => ({ total: 0, new: 0, duplicate: 0, newObservation: 0, conflict: 0 });
const refused = (reason: EpcisPullRefusal['reason'], detail: string, remedy?: string): EpcisPullRefusal => ({ outcome: 'refused', reason, detail, ...(remedy == null ? {} : { remedy }) });

/** One run at a time for each pull in this process. Another process is held off by the revision every batch expects. */
const turns = new WeakMap<object, Map<string, Promise<unknown>>>();
function inTurn<T>(storage: EpcisExchangeStorage, key: string, run: () => Promise<T>): Promise<T> {
  let byPull = turns.get(storage);
  if (byPull == null) { byPull = new Map(); turns.set(storage, byPull); }
  const next = (byPull.get(key) ?? Promise.resolve()).then(run, run);
  byPull.set(key, next.catch(() => undefined));
  return next;
}

/** The standard query parameters of a query, by their names in the REST binding. A list is one parameter whose values are separated by `|`. Nothing provider-specific is ever sent. */
export function epcisQueryParameters(query: EpcisPullQuery, recordTimeFrom: string | undefined = query.recordTime?.from): Record<string, string> {
  const parameters: Record<string, string> = {};
  if (query.matchAnyEPC != null && query.matchAnyEPC.length > 0) parameters.MATCH_anyEPC = query.matchAnyEPC.join('|');
  if (query.eventTypes != null && query.eventTypes.length > 0) parameters.eventType = query.eventTypes.join('|');
  if (query.eventTime?.from != null) parameters.GE_eventTime = query.eventTime.from;
  if (query.eventTime?.until != null) parameters.LT_eventTime = query.eventTime.until;
  if (recordTimeFrom != null) parameters.GE_recordTime = recordTimeFrom;
  if (query.eventIds != null && query.eventIds.length > 0) parameters.EQ_eventID = query.eventIds.join('|');
  parameters.perPage = String(query.perPage);
  return parameters;
}

function eventsAddress(baseUrl: string, parameters: Record<string, string>): string {
  const url = new URL(`${baseUrl}/events`);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  return url.toString();
}

/* ------------------------------- the request ----------------------------- */

interface Prepared {
  key: string;
  sourceId: string;
  queryId: string;
  /** Undefined when the source has no base address. */
  baseUrl?: string;
  baseOrigin?: string;
  permittedOrigins: string[];
  localTest: boolean;
  wireVersions: { epcis: string; cbv: string };
  query: EpcisPullQuery;
  overlap: number;
  policyId: string;
  limits: EpcisLimits;
  limitOverrides: Array<{ limit: string; default: number; value: number }>;
}

function prepare(input: PullEpcisEventsInput): EpcisPullRefusal | Prepared {
  const bad = (detail: string): EpcisPullRefusal => refused('invalid-request', detail);
  const name = (value: unknown, what: string): string | undefined => (typeof value !== 'string' || value.length < 1 || value.length > 256 || CONTROL.test(value) ? `${what} is 1 to 256 characters without control characters` : undefined);
  if (input == null || typeof input !== 'object') return bad('a pull is described by an object');
  if (input.storage == null || typeof input.storage.commit !== 'function') return bad('a pull is handed the storage it writes to');
  if (typeof input.fetch !== 'function') return bad('a pull is handed the transport it requests through');
  const { source } = input;
  if (source == null || typeof source !== 'object') return bad('a pull names its configured source');
  const problem = name(source.sourceId, 'source.sourceId') ?? name(input.queryId, 'queryId');
  if (problem != null) return bad(problem);
  if (source.policy == null || typeof source.policy !== 'object') return bad('the policy in force is named');
  const policyProblem = name(source.policy.policyId, 'source.policy.policyId');
  if (policyProblem != null) return bad(policyProblem);
  if (source.credentials !== undefined && typeof source.credentials !== 'function') return bad('source.credentials is a function that obtains the credential, never the credential itself');
  if (source.localTest !== undefined && typeof source.localTest !== 'boolean') return bad('source.localTest is true or false');

  let limits: EpcisLimits;
  try { limits = resolveEpcisLimits(source.policy.limits ?? {}); } catch (error) { return bad((error as Error).message); }
  const limitOverrides: Prepared['limitOverrides'] = [];
  for (const [limit, value] of Object.entries(limits) as Array<[keyof EpcisLimits, number]>) {
    if (value > EPCIS_PULL_LIMIT_CEILINGS[limit]) return bad(`the limit ${limit} is set to ${value}, past the ${EPCIS_PULL_LIMIT_CEILINGS[limit]} this build permits an operator to raise it to`);
    if (value !== EPCIS_DEFAULT_LIMITS[limit]) limitOverrides.push({ limit, default: EPCIS_DEFAULT_LIMITS[limit], value });
  }

  const wire = { epcis: source.wireVersions?.epcis ?? EPCIS_WIRE_VERSION, cbv: source.wireVersions?.cbv ?? CBV_WIRE_VERSION };
  if (typeof wire.epcis !== 'string' || typeof wire.cbv !== 'string' || !WIRE_VERSION.test(wire.epcis) || !WIRE_VERSION.test(wire.cbv)) return bad('source.wireVersions names versions as digits and dots, such as 2.0.0');

  if (!Array.isArray(source.permittedOrigins) || source.permittedOrigins.length > 16) return bad('source.permittedOrigins is a list of at most 16 origins');
  const permittedOrigins: string[] = [];
  for (const origin of source.permittedOrigins) {
    let parsed: URL | undefined;
    try { parsed = new URL(String(origin)); } catch { /* reported below */ }
    if (typeof origin !== 'string' || parsed == null || parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return bad('each permitted origin is exactly a scheme, a host and a port, such as https://events.example.org');
    if (!permittedOrigins.includes(origin)) permittedOrigins.push(origin);
  }
  permittedOrigins.sort();

  let baseUrl: string | undefined;
  let baseOrigin: string | undefined;
  if (source.baseUrl != null && source.baseUrl !== '') {
    let url: URL;
    try { url = new URL(String(source.baseUrl)); } catch { return bad('source.baseUrl does not parse as an address'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return bad('source.baseUrl is an https address, or an http one under the local-test option');
    if (url.username !== '' || url.password !== '') return bad('source.baseUrl carries user information; a credential is configured through source.credentials and never written into an address');
    if (url.search !== '' || url.hash !== '') return bad('source.baseUrl carries no query and no fragment');
    baseOrigin = url.origin;
    baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    if (!permittedOrigins.includes(baseOrigin)) return bad(`source.permittedOrigins does not list ${baseOrigin}, the origin of the base address; every origin a request may go to is named`);
  }

  const q = input.query as unknown;
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return bad('query is an object');
  const given = q as Record<string, unknown>;
  const unknown = Object.keys(given).filter((member) => !['matchAnyEPC', 'eventTypes', 'eventTime', 'recordTime', 'eventIds', 'perPage'].includes(member));
  if (unknown.length > 0) return bad(`query has no member ${unknown.join(', ')}; the profile selects matchAnyEPC, eventTypes, eventTime, recordTime, eventIds and perPage`);
  const query: EpcisPullQuery = { perPage: limits.maxEventsPerPage };
  for (const member of ['matchAnyEPC', 'eventTypes', 'eventIds'] as const) {
    const list = given[member];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_LIST) return bad(`query.${member} is a list of 1 to ${MAX_LIST} values`);
    for (const value of list) if (typeof value !== 'string' || value.length < 1 || value.length > MAX_VALUE || CONTROL.test(value) || value.includes('|')) return bad(`each value of query.${member} is 1 to ${MAX_VALUE} characters without control characters or the separator |`);
    const values = [...new Set(list as string[])].sort();
    if (values.join('|').length > MAX_PARAMETER) return bad(`query.${member} is longer than ${MAX_PARAMETER} characters once joined`);
    query[member] = values;
  }
  const time = (value: unknown, what: string): string | undefined => (typeof value !== 'string' || !DATE_TIME.test(value) || Number.isNaN(Date.parse(value)) ? `${what} is an ISO 8601 date-time with a zone` : undefined);
  const range = (member: 'eventTime' | 'recordTime', bounds: readonly string[]): string | undefined => {
    const value = given[member];
    if (value === undefined) return undefined;
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return `query.${member} is an object`;
    const extra = Object.keys(value).filter((bound) => !bounds.includes(bound));
    if (extra.length > 0) return `query.${member} has no member ${extra.join(', ')}; the profile selects ${bounds.join(' and ')}`;
    const out: Record<string, string> = {};
    for (const bound of bounds) {
      const at = (value as Record<string, unknown>)[bound];
      if (at === undefined) continue;
      const wrong = time(at, `query.${member}.${bound}`);
      if (wrong != null) return wrong;
      out[bound] = at as string;
    }
    if (Object.keys(out).length > 0) query[member] = out;
    return undefined;
  };
  const rangeProblem = range('eventTime', ['from', 'until']) ?? range('recordTime', ['from']);
  if (rangeProblem != null) return bad(rangeProblem);
  if (given.perPage !== undefined) {
    if (!Number.isSafeInteger(given.perPage) || (given.perPage as number) < 1 || (given.perPage as number) > limits.maxEventsPerPage) return bad(`query.perPage is 1 to ${limits.maxEventsPerPage}, the page event limit in force`);
    query.perPage = given.perPage as number;
  }

  const overlap = input.recordTimeOverlapSeconds ?? EPCIS_PULL_DEFAULT_OVERLAP_SECONDS;
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap > EPCIS_PULL_MAX_OVERLAP_SECONDS) return bad(`recordTimeOverlapSeconds is 0 to ${EPCIS_PULL_MAX_OVERLAP_SECONDS}`);
  if (input.window !== undefined && input.window !== 'watermark' && input.window !== 'query-bounds') return bad('window is watermark or query-bounds');

  return {
    key: epcisPullKey(source.sourceId, input.queryId),
    sourceId: source.sourceId,
    queryId: input.queryId,
    ...(baseUrl == null ? {} : { baseUrl, baseOrigin: baseOrigin as string }),
    permittedOrigins,
    localTest: source.localTest === true,
    wireVersions: wire,
    query,
    overlap,
    policyId: source.policy.policyId,
    limits,
    limitOverrides,
  };
}

/* ---------------------------------- the run ------------------------------ */

function countEvents(record: EpcisImportRecord, importReplayed: boolean): EpcisPullEventCounts {
  const counts = noEvents();
  for (const event of record.events) {
    counts.total += 1;
    // A page that answered an import already held added nothing: each of its events repeats one that is held.
    if (importReplayed || event.arrival === 'duplicate') counts.duplicate += 1;
    else if (event.arrival === 'new') counts.new += 1;
    else if (event.arrival === 'new-observation') counts.newObservation += 1;
    else if (event.arrival === 'conflict') counts.conflict += 1;
  }
  return counts;
}

const addEvents = (to: EpcisPullEventCounts, from: EpcisPullEventCounts): void => { for (const member of Object.keys(to) as Array<keyof EpcisPullEventCounts>) to[member] += from[member]; };

/** The latest of the record times a page's events carry, when any can be read as a time. */
function latestRecordTime(record: EpcisImportRecord, floor: string | undefined): string | undefined {
  let latest = floor == null ? Number.NEGATIVE_INFINITY : Date.parse(floor);
  for (const event of record.events) {
    const at = event.recordTime == null ? Number.NaN : Date.parse(event.recordTime);
    if (!Number.isNaN(at) && at > latest) latest = at;
  }
  return latest === Number.NEGATIVE_INFINITY ? undefined : new Date(latest).toISOString();
}

/** A query page import of this pull that already holds exactly these bytes, if there is one. */
async function heldPageImport(storage: EpcisExchangeStorage, key: string, sourceId: string, sha256: string, mediaType: string): Promise<EpcisImportRecord | undefined> {
  let after: string | undefined;
  for (;;) {
    const page = await storage.list(K.retention, { prefix: `${sha256}.`, ...(after == null ? {} : { after }), limit: 50 });
    for (const held of page) {
      const record = await getEpcisImport(storage, (held.value as unknown as EpcisRetentionRecord).importId);
      if (record != null && record.sourceId === sourceId && record.mediaType === mediaType && record.requestId.startsWith(`pull.${key}.`)) return record;
    }
    if (page.length < 50) return undefined;
    after = page[page.length - 1]!.key;
  }
}

function completenessLimits(state: EpcisPullRecord, completion: EpcisPullCompletion, reason: EpcisPullReason): string[] {
  const out = ['the retained events are what the query matched when each page was answered; they are not the complete history of the source'];
  const { parameters, window } = state.pass;
  if (parameters.GE_recordTime != null) out.push('a bound on record time cannot discover every retrospective error declaration; refresh the events that matter by identifier');
  if (window.basis === 'watermark') out.push(`this pass asked only for events recorded since ${window.recordTimeFrom}, the watermark less ${window.overlapSeconds} seconds; a watermark does not show that every correction was received`);
  if (parameters.MATCH_anyEPC != null) out.push('a query for exact identifiers does not retrieve the transformations that made its inputs; retrieving further identifiers needs its own query');
  if (parameters.EQ_eventID != null) out.push('a refresh by event identifier reads only the events it names');
  if (state.replay != null && state.replay.pass === state.pass.number) out.push('a cursor could not be reused and the pass was replayed from its bounds; pages may have been cut at other places than before');
  if (completion === 'stopped-at-limit') out.push(`the run stopped at its ${reason.replace('-limit', '')} limit before the source's pages were exhausted`);
  if (completion === 'failed') out.push(`the run ended as ${reason} before the source's pages were exhausted`);
  return out;
}

/**
 * Pull events from a configured source: one bounded run.
 *
 * The first call for a `queryId` begins the query at its own bounds. A call
 * while a pass is unfinished continues it from the checkpoint. A call after
 * a pass was exhausted begins the next pass, at the watermark less the
 * overlap margin unless `window` says otherwise. The same `queryId` with
 * another definition is refused.
 *
 * Every page goes through `importEpcisSource`, so a page is refused, retained
 * and classified exactly as a file is. Nothing here signs, issues, anchors
 * or moves anything.
 */
export function pullEpcisEvents(input: PullEpcisEventsInput): Promise<EpcisPullOutcome> {
  const prepared = prepare(input);
  if ('outcome' in prepared) return Promise.resolve(prepared);
  return inTurn(input.storage, prepared.key, () => run(input, prepared));
}

async function run(input: PullEpcisEventsInput, prepared: Prepared): Promise<EpcisPullOutcome> {
  const { storage } = input;
  const clock = input.now ?? systemClock;
  const { key, sourceId, queryId, limits, limitOverrides, query } = prepared;
  const startedAt = clock();
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return refused('invalid-request', 'now answers ISO 8601 date-times');

  const summary: EpcisPullRunSummary = { run: 1, startedAt, pagesFetched: 0, pagesAcknowledged: 0, bytesRead: 0, replays: 0, resumed: false };
  const pages: EpcisPullPageRecord[] = [];
  const events = noEvents();
  const leniencies = new Set<EpcisPullLeniency>();
  let server: EpcisPullServerVersions = {};

  if (prepared.baseUrl == null || prepared.baseOrigin == null) {
    const detail = `source ${sourceId} has no base address: no EPCIS link is known for it, so nothing was requested`;
    return {
      outcome: 'source-link-missing', reason: 'no-base-address', completion: 'failed', exhausted: false, detail, sourceId, queryId,
      run: { ...summary, endedAt: clock(), outcome: 'source-link-missing', reason: 'no-base-address', completion: 'failed', detail },
      pages, events, limits, limitOverrides, localTest: prepared.localTest, server, leniencies: [],
      completenessLimits: ['nothing was requested, so nothing is known about what the source holds'],
    };
  }
  const { baseUrl, baseOrigin } = prepared;

  // The schema is checked before anything is asked of the source: a page that cannot be validated is never fetched.
  try { readGs1Artefact(EPCIS_GS1_ARTEFACTS[0], input.artefactsDir == null ? {} : { dir: input.artefactsDir }); } catch (error) {
    if (error instanceof Gs1ArtefactUnavailableError) return refused('gs1-artefact-unavailable', error.message, error.remedy);
    throw error;
  }

  let guard: EpcisCredentialGuard;
  let credentialsConfigured = false;
  try {
    const credential = input.source.credentials == null ? undefined : await input.source.credentials();
    if (credential != null) {
      const wrong = credentialProblem(credential);
      if (wrong != null) return refused('credentials-unavailable', wrong);
      credentialsConfigured = true;
    }
    guard = credentialGuard(credential);
  } catch {
    // The provider's own message is not repeated: it may quote what it failed to read.
    return refused('credentials-unavailable', 'the credential for this source could not be obtained');
  }
  const configured = [sourceId, queryId, prepared.policyId, baseUrl, ...prepared.permittedOrigins, ...Object.values(epcisQueryParameters(query))];
  if (configured.some((value) => guard.carries(value))) return refused('invalid-request', 'a configured name, address or query value carries the credential; a credential is configured through source.credentials only');

  const log = (entry: EpcisPullLogEntry): void => { try { input.log?.({ at: clock(), ...entry }); } catch { /* a logger never ends a run */ } };
  const policy: EpcisTargetPolicy = { permittedOrigins: prepared.permittedOrigins, localTest: prepared.localTest, ...(input.resolveHost == null ? {} : { resolveHost: input.resolveHost }) };
  const scope: EpcisPullSourceScope = { sourceId, baseUrl, permittedOrigins: prepared.permittedOrigins, localTest: prepared.localTest, credentialsConfigured, wireVersions: prepared.wireVersions };
  const definitionDigest = epcisPullDefinitionDigest({ sourceId, baseUrl, query, recordTimeOverlapSeconds: prepared.overlap });

  /* ---- step 1: the pull record ---- */

  const held = await storage.get(K.pull, key);
  let revision: number | undefined = held?.revision;
  let state: EpcisPullRecord;
  const firstPass = (number: number, basis: 'query-bounds' | 'watermark', from: string | undefined): EpcisPullPass => ({
    number,
    attempt: 1,
    parameters: epcisQueryParameters(query, from),
    window: { basis, ...(from == null ? {} : { recordTimeFrom: from }), ...(basis === 'watermark' ? { overlapSeconds: prepared.overlap } : {}) },
    startedAt,
    pagesAcknowledged: 0,
    exhausted: false,
  });
  if (held == null) {
    state = {
      recordType: 'epcis-pull', recordVersion: EPCIS_PULL_VERSION, pullId: epcisPullId(sourceId, queryId), sourceId, queryId, definitionDigest, source: scope, query,
      recordTimeOverlapSeconds: prepared.overlap, policyId: prepared.policyId, limits: { ...limits }, limitOverrides, status: 'running',
      pass: firstPass(1, 'query-bounds', query.recordTime?.from), pagesAcknowledged: 0, runs: 1, lastRun: summary,
      totals: { bytes: 0, events: noEvents() }, completenessLimits: [], createdAt: startedAt, updatedAt: startedAt,
    };
  } else {
    state = held.value as unknown as EpcisPullRecord;
    // A record another version wrote is not guessed at: its checkpoint may mean something this version does not know.
    if (state.recordType !== 'epcis-pull' || state.recordVersion !== EPCIS_PULL_VERSION) throw new EpcisExchangeError('record-unreadable', `the pull record of ${queryId} is version ${String(state.recordVersion)}, and this module reads and writes version ${EPCIS_PULL_VERSION}`);
    if (state.definitionDigest !== definitionDigest) return refused('pull-conflict', `query ${queryId} under ${sourceId} is already bound to another base address, query or overlap margin; the earlier pull stands, and another definition takes another queryId`);
    summary.run = state.runs + 1;
    // A pass that was exhausted by a run whose end was never recorded is not begun again: this run records that end.
    if (state.pass.exhausted && state.status !== 'running') {
      // The pass before was exhausted, so this run begins the next one. A refresh by identifier always asks for exactly its events again.
      const watermark = query.eventIds == null && input.window !== 'query-bounds' ? state.watermark : undefined;
      if (watermark == null) state.pass = firstPass(state.pass.number + 1, 'query-bounds', query.recordTime?.from);
      else {
        const from = Math.max(Date.parse(watermark.recordTime) - prepared.overlap * 1000, query.recordTime?.from == null ? Number.NEGATIVE_INFINITY : Date.parse(query.recordTime.from));
        state.pass = firstPass(state.pass.number + 1, 'watermark', new Date(from).toISOString());
      }
      delete state.cursor;
      delete state.pending;
    } else {
      summary.resumed = true;
    }
    state = { ...state, source: scope, policyId: prepared.policyId, limits: { ...limits }, limitOverrides, status: 'running', runs: summary.run, lastRun: summary };
  }

  const write = async (extra: EpcisStorageWrite[] = []): Promise<void> => {
    state.updatedAt = clock();
    state.lastRun = summary;
    const result = await storage.commit([...extra, { op: 'put', kind: K.pull, key, value: toValue(state), expect: revision ?? 'absent' }]);
    if (!result.committed) throw new EpcisExchangeError('storage-contention', `the pull record of ${queryId} could not be written: ${result.failed.kind}/${result.failed.key} was expected at ${result.failed.expected} and is at ${result.failed.found}; another run of the same pull is writing`);
    revision = (revision ?? 0) + 1;
  };
  await write();
  log({ event: 'run-start', sourceId, queryId, run: summary.run, pass: state.pass.number, attempt: state.pass.attempt, resumed: summary.resumed, localTest: prepared.localTest, credentialsConfigured });

  /* ---- step 5: how the run ended ---- */

  const finish = async (reason: EpcisPullReason, detail: string, extra: { status?: number; importRefusal?: EpcisPullResult['importRefusal'] } = {}): Promise<EpcisPullResult> => {
    const outcome = EPCIS_PULL_REASON_OUTCOME[reason];
    const completion: EpcisPullCompletion = reason === 'exhausted' ? 'exhausted' : STOP_LIMITS.includes(reason) ? 'stopped-at-limit' : 'failed';
    const safe = guard.redact(detail);
    Object.assign(summary, { endedAt: clock(), outcome, reason, completion, detail: safe });
    state.status = completion;
    state.completenessLimits = completenessLimits(state, completion, reason);
    await write();
    log({ event: 'run-end', sourceId, queryId, run: summary.run, outcome, reason, completion, pagesFetched: summary.pagesFetched, pagesAcknowledged: summary.pagesAcknowledged, bytesRead: summary.bytesRead });
    const replayedNow = state.replay != null && summary.replays > 0 ? state.replay : undefined;
    return {
      outcome, reason, completion, exhausted: completion === 'exhausted', detail: safe, ...extra, sourceId, queryId,
      pull: toValue(state) as unknown as EpcisPullRecord, run: { ...summary }, pages, events, limits, limitOverrides, localTest: prepared.localTest, server, leniencies: [...leniencies].sort(),
      ...(replayedNow == null ? {} : { replay: replayedNow }), completenessLimits: state.completenessLimits,
    };
  };

  /* ---- steps 3 and 4: the import, then the checkpoint ---- */

  type Ended = { reason: EpcisPullReason; detail: string; importRefusal?: EpcisPullResult['importRefusal'] };
  const importAndAcknowledge = async (pending: EpcisPullPending, bytes: Uint8Array): Promise<Ended | undefined> => {
    const outcome = await importEpcisSource({
      storage, sourceId, requestId: pending.requestId, bytes, mediaType: pending.mediaType, receivedAt: pending.receivedAt,
      provenance: { kind: 'query', origin: baseOrigin, query: pending.query, page: pending.page },
      policy: { policyId: prepared.policyId, limits },
      ...(input.artefactsDir == null ? {} : { artefactsDir: input.artefactsDir }),
      now: clock,
    });
    if (outcome.outcome !== 'retained') {
      // Nothing of the page is held, so the checkpoint stays where it was and the note is dropped.
      delete state.pending;
      const importRefusal = outcome.outcome === 'refused' ? outcome.reason : 'request-conflict';
      return { reason: 'import-refused', detail: `page ${pending.page} was refused before retention as ${importRefusal}: ${outcome.detail}`, importRefusal };
    }
    const { record } = outcome;
    const counts = countEvents(record, pending.importReplayed);
    const pageLeniencies = [...pending.leniencies];
    if (pending.last && record.events.length === 0 && pending.page > 1) pageLeniencies.push('empty-final-page');
    const page: EpcisPullPageRecord = {
      recordType: 'epcis-pull-page', recordVersion: EPCIS_PULL_VERSION, pullId: state.pullId, sourceId, sequence: pending.sequence, run: summary.run, pass: pending.pass, attempt: pending.attempt, page: pending.page,
      importId: record.importId, importReplayed: pending.importReplayed, sha256: record.sha256, byteLength: record.byteLength, mediaType: record.mediaType, receivedAt: pending.receivedAt, query: pending.query,
      documentValidity: record.documentValidity, events: counts, last: pending.last, server: pending.server, leniencies: pageLeniencies,
    };
    state.pagesAcknowledged = pending.sequence;
    state.pass.pagesAcknowledged = pending.page;
    state.pass.exhausted = pending.last;
    const latest = latestRecordTime(record, state.pass.maxRecordTime);
    if (latest != null) state.pass.maxRecordTime = latest;
    if (pending.next == null) delete state.cursor;
    else state.cursor = { ...pending.next, afterPage: pending.page };
    state.totals.bytes += record.byteLength;
    addEvents(state.totals.events, counts);
    if (pending.last && query.eventIds == null && state.pass.maxRecordTime != null) {
      const before = state.watermark == null ? Number.NEGATIVE_INFINITY : Date.parse(state.watermark.recordTime);
      state.watermark = { recordTime: new Date(Math.max(before, Date.parse(state.pass.maxRecordTime))).toISOString(), pass: state.pass.number, establishedAt: clock() };
    }
    delete state.pending;
    summary.pagesAcknowledged += 1;
    await write([{ op: 'put', kind: K.pullPage, key: pullPageKey(key, page.sequence), value: toValue(page), expect: 'absent' }]);
    pages.push(page);
    addEvents(events, counts);
    for (const leniency of pageLeniencies) leniencies.add(leniency);
    server = pending.server;
    log({ event: 'checkpoint', sourceId, queryId, sequence: page.sequence, pass: page.pass, attempt: page.attempt, page: page.page, importId: page.importId, events: counts.total, last: page.last });
    return pending.nextProblem == null ? undefined : { reason: pending.nextProblem.reason, detail: `page ${pending.page} is retained, and the page after it cannot be asked for: ${pending.nextProblem.detail}` };
  };

  // A page an earlier run read and did not acknowledge. With its receipt held it is finished from the retained bytes; without one it was never retained and is asked for again.
  if (state.pending != null) {
    const pending = state.pending;
    const receipt = await findEpcisImportByRequest(storage, sourceId, pending.requestId);
    const bytes = receipt != null && receipt.sha256 === pending.sha256 ? await storage.getBytes(pending.sha256) : undefined;
    if (bytes == null) delete state.pending;
    else {
      const ended = await importAndAcknowledge(pending, bytes);
      if (ended != null) return finish(ended.reason, ended.detail, ended.importRefusal == null ? {} : { importRefusal: ended.importRefusal });
    }
  }

  const asked = new Set<string>();
  const replay = (reason: NonNullable<EpcisPullRecord['replay']>['reason']): boolean => {
    if (summary.replays >= EPCIS_PULL_MAX_REPLAYS_PER_RUN) return false;
    summary.replays += 1;
    state.replay = { reason, decidedAt: clock(), pass: state.pass.number, attempt: state.pass.attempt, pagesAcknowledgedBefore: state.pass.pagesAcknowledged };
    // The same pass, from its retained bounds: the same source, the same query, a new traversal. What is already held is recognised as it arrives again.
    state.pass.attempt += 1;
    state.pass.pagesAcknowledged = 0;
    delete state.cursor;
    asked.clear();
    log({ event: 'replay', sourceId, queryId, reason, pass: state.pass.number, attempt: state.pass.attempt });
    return true;
  };

  for (;;) {
    if (state.pass.exhausted) return finish('exhausted', `the source named no further page after page ${state.pass.pagesAcknowledged} of pass ${state.pass.number}; the query's pages are exhausted within its bounds`);
    if (summary.pagesFetched >= limits.maxPullPages) return finish('page-limit', `the run read ${summary.pagesFetched} pages, its limit, and the source named a further page`);
    if (summary.bytesRead >= limits.maxPullBytes) return finish('byte-limit', `the run read ${summary.bytesRead} bytes, its limit, and the source named a further page`);
    const runMsLeft = limits.maxPullSeconds * 1000 - (Date.parse(clock()) - startedMs);
    if (runMsLeft <= 0) return finish('time-limit', `the run reached its ${limits.maxPullSeconds} second limit before the source's pages were exhausted`);

    /* ---- the request ---- */

    let target: string;
    const cursor = state.cursor;
    if (cursor != null) {
      if (cursor.expiresAt != null && Date.parse(clock()) >= Date.parse(cursor.expiresAt)) {
        if (!replay('cursor-expired')) return finish('cursor-unusable', 'a second cursor could not be reused in one run: it had expired');
        continue;
      }
      target = cursor.target;
    } else if (state.pass.pagesAcknowledged > 0) {
      if (!replay('cursor-missing')) return finish('cursor-unusable', 'a second cursor could not be reused in one run: none was recorded');
      continue;
    } else {
      target = eventsAddress(baseUrl, state.pass.parameters);
    }
    const answer: EpcisPageAnswer = await fetchEpcisPage({
      url: target, usesCursor: cursor != null, credentialOrigin: baseOrigin, policy, guard, wireVersions: prepared.wireVersions,
      maxPageBytes: limits.maxDocumentBytes, bytesLeft: limits.maxPullBytes - summary.bytesRead, timeoutMs: limits.fetchTimeoutMs, runMsLeft, asked, fetch: input.fetch, log,
    });
    if (!answer.ok) {
      if (answer.cursorRejected === true && replay('cursor-rejected')) continue;
      return finish(answer.reason, answer.detail, answer.status == null ? {} : { status: answer.status });
    }
    asked.add(target);
    summary.pagesFetched += 1;
    summary.bytesRead += answer.bytes.byteLength;

    /* ---- step 2: the page noted ---- */

    const page = state.pass.pagesAcknowledged + 1;
    const sha256 = sha256Hex(answer.bytes);
    const again = await heldPageImport(storage, key, sourceId, sha256, answer.mediaType);
    const pending: EpcisPullPending = {
      sequence: state.pagesAcknowledged + 1, pass: state.pass.number, attempt: state.pass.attempt, page,
      requestId: again?.requestId ?? `pull.${key}.${state.pass.number}.${state.pass.attempt}.${page}`, importReplayed: again != null,
      sha256, byteLength: answer.bytes.byteLength, mediaType: answer.mediaType, receivedAt: clock(),
      query: { ...state.pass.parameters, ...(cursor?.token == null ? {} : { nextPageToken: cursor.token }) },
      ...(answer.next == null ? {} : { next: { ...answer.next, afterPage: page } }), last: answer.last,
      ...(answer.nextProblem == null ? {} : { nextProblem: { reason: answer.nextProblem.reason, detail: guard.redact(answer.nextProblem.detail) } }),
      server: answer.server, leniencies: answer.leniencies,
    };
    state.pending = pending;
    await write();

    const ended = await importAndAcknowledge(pending, answer.bytes);
    if (ended != null) return finish(ended.reason, ended.detail, ended.importRefusal == null ? {} : { importRefusal: ended.importRefusal });
  }
}

/* ---------------------------------- reading ------------------------------ */

/** The durable state of a pull, or undefined when the query was never run under the source. */
export async function getEpcisPull(storage: EpcisExchangeStorage, sourceId: string, queryId: string): Promise<EpcisPullRecord | undefined> {
  const held = await storage.get(K.pull, epcisPullKey(sourceId, queryId));
  return held == null ? undefined : (held.value as unknown as EpcisPullRecord);
}

/** The pages a pull acknowledged, in order. Pass the last page's `sequence` as `after`. */
export async function listEpcisPullPages(storage: EpcisExchangeStorage, pullId: string, options: { after?: number; limit?: number } = {}): Promise<EpcisPullPageRecord[]> {
  const key = pullKeyOf(pullId);
  if (key == null) return [];
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
  const page = await storage.list(K.pullPage, { prefix: `${key}.`, ...(options.after == null ? {} : { after: pullPageKey(key, options.after) }), limit });
  return page.map((held) => held.value as unknown as EpcisPullPageRecord);
}
