/**
 * Authorised operational recovery of an EPCIS exchange
 * (`spec/epcis-interoperability.md` section 8, `spec/portable-evidence.md`
 * section 2): everything a deployment needs to carry on somewhere else, taken
 * out of one store and put into another.
 *
 * What a recovery snapshot is: every retained original in its exact bytes,
 * and the durable records that cannot be rebuilt from them, which are the
 * import records with their request bindings and results, each observation,
 * each conflict decision, and the state of each pull with the pages it
 * acknowledged. It is carried as files with one inventory entry each, in the
 * existing categories of `dpp-evidence-package@1`, beside a descriptor,
 * `epcis-recovery.json`, that names every file the snapshot needs, the source
 * scopes it covers, the boundary it was taken at and what it leaves out. It
 * is not a second export format: the exporter that assembles a package lists
 * these entries in its own manifest and signs that.
 *
 * What it is not: public evidence. A recovery snapshot is for the operator
 * who is authorised to run the exchange. `exportEpcisPublicEvidence` is the
 * other path, and gives only what a public package may carry.
 *
 * Five rules shape the module.
 *
 * A snapshot is taken at a boundary. The storage interface has no snapshot
 * isolation, so the export reads every record it carries twice and keeps the
 * result only when each was at the same revision both times, with no
 * unfinished work journalled at either reading. What it read then stood
 * together at one moment. It refuses while work is journalled, and never
 * finishes or discards that work itself: recovery removes bytes and must run
 * alone, which an export cannot promise.
 *
 * Nothing is trusted because it was carried. A restore checks the descriptor
 * against the inventory, every file against its digest, every record against
 * the key its own content gives, and the whole snapshot against the
 * invariants of the exchange, before it writes anything.
 *
 * Identities are kept and locations are mapped. A restored import has the
 * `sourceId`, `importId`, `requestId` and `requestDigest` it had, so a retry
 * of an acknowledged request answers the same import and writes no receipt.
 * Only `bytesRef`, which says where a store keeps the bytes, is given the
 * destination's value, through a mapping that is checked and recorded.
 *
 * Nothing is overwritten. A destination record equal to the snapshot's is
 * left alone, which is what makes a restore safe to run again after a crash.
 * One that differs stops the restore before anything is written, with the
 * list of what collides.
 *
 * No credential is carried, in either form. A cursor is left out unless the
 * operator asks for it, and then only when its address carries nothing but
 * the standard query parameters.
 */
import { createRequire } from 'node:module';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { canonicalJcsBytes, canonicalizeJcs } from '../jcs.js';
import type { JsonObject } from '../types.js';
import { EpcisExchangeError, checkEpcisExchangeInvariants, rebuildEpcisAssociations, type EpcisRebuildReport } from './exchange.js';
import { EPCIS_PULL_REASON_OUTCOME, epcisQueryParameters, pullCompletion } from './pull.js';
import { credentialGuard, credentialProblem, type EpcisCredentialGuard, type EpcisSourceCredential } from './pull-transport.js';
import {
  EPCIS_IMPORT_VERSION,
  EPCIS_PULL_VERSION,
  EPCIS_QUERY_PARAMETERS,
  EPCIS_RECORD_KINDS,
  EPCIS_RECORD_VERSION,
  REBUILD_JOURNAL_KEY,
  conflictScopeKeyOf,
  epcisEventScopeKey,
  epcisImportId,
  epcisImportKey,
  addEvents,
  countEvents,
  latestRecordTime,
  noEvents,
  epcisPullDefinitionDigest,
  epcisPullId,
  epcisPullKey,
  epcisRequestDigest,
  epcisResolutionId,
  epcisRestoreId,
  importKeyOf,
  observationKey,
  pullKeyOf,
  pullPageKey,
  relocationKey,
  resolutionKey,
  restoreJournalKey,
  retentionKey,
  type EpcisImportRecord,
  type EpcisJournalRecord,
  type EpcisObservationRecord,
  type EpcisPullPageRecord,
  type EpcisPullRecord,
  type EpcisRelocationRecord,
  type EpcisResolutionRecord,
  type EpcisRestoreCounts,
  type EpcisRestoreRecord,
  type EpcisRetentionRecord,
} from './records.js';
import { createMemoryEpcisStorage, sha256Hex, type EpcisExchangeStorage, type EpcisStorageWrite, type EpcisStoredRecord } from './storage.js';
import { inTurn, listAll } from './turn.js';

/* ---------------------------------- format ------------------------------- */

export const EPCIS_RECOVERY_FORMAT = 'dpp-epcis-recovery';
export const EPCIS_RECOVERY_VERSION = '1';
/** The folder a snapshot sits in, inside a package, unless the exporter chooses another. */
export const EPCIS_RECOVERY_ROOT = 'epcis';
/** The descriptor's file name, directly under the snapshot's folder. */
export const EPCIS_RECOVERY_DESCRIPTOR = 'epcis-recovery.json';

/** The inventory category each kind of file is listed under. Both are existing categories of `dpp-evidence-package@1`. */
export const EPCIS_RECOVERY_CATEGORIES = {
  /** A retained original: the exact bytes a source supplied. */
  original: 'evidence',
  /** The descriptor and every durable record: what was recorded about the originals and about reaching their sources. */
  record: 'reports',
} as const;

/** The kinds of file a snapshot holds, as its descriptor names them. */
export type EpcisRecoveryFileKind = 'original' | 'import' | 'observation' | 'resolution' | 'pull' | 'pull-page' | 'public-import';

/** What an inventory entry's `representation` says for the descriptor and for each kind of file. A record's is its own contract and version. */
export const EPCIS_RECOVERY_REPRESENTATIONS = {
  descriptor: 'dpp-epcis-recovery@1',
  original: 'dpp-epcis-original@1',
  import: 'dpp-epcis-import@2',
  observation: 'dpp-epcis-observation@1',
  resolution: 'dpp-epcis-conflict-resolution@1',
  pull: 'dpp-epcis-pull@1',
  'pull-page': 'dpp-epcis-pull-page@1',
  /** An import record as a public package carries it: version 2 of the import contract, with `sourceLocation` reduced to its kind. */
  'public-import': 'dpp-epcis-public-import@1',
} as const;

/** What a snapshot does not carry or establish, in fixed words. Every snapshot carries exactly these, so none can claim more. */
export const EPCIS_RECOVERY_LIMITS = {
  /** No credential, key or secret-bearing address is carried. The destination's operator provisions them. */
  credentials: 'never-carried',
  /** The associations index and the retention entries are rebuilt at the destination from what is carried. */
  derivedIndexes: 'rebuilt-at-destination',
  /** Each record is restored as it was recorded. A later re-evaluation of a source is a separate result and replaces nothing. */
  interpretation: 'as-recorded',
  /** A carried original says what was received. It never says who made it or that an event in it happened. */
  origin: 'not-established',
} as const;

export type EpcisRecoveryAccess = 'authorised-recovery' | 'public-evidence';

/** What became of the cursor of one pull: it had none, it was left out, it is carried, or it was left out although cursors were asked for, because its address carries more than the standard query parameters. */
export type EpcisRecoveryCursorState = 'none' | 'excluded' | 'included' | 'excluded-non-standard';

export interface EpcisRecoveryScope {
  /** The source scope, exactly as the records name it. */
  sourceId: string;
  /** How many distinct originals the scope's imports retain. Bytes two scopes share are counted in each. */
  originals: number;
  imports: number;
  observations: number;
  resolutions: number;
  /** The pulls of the scope: the definition each query name is bound to, how the latest run ended and how far it got. */
  pulls: Array<{ pullId: string; queryId: string; definitionDigest: string; baseUrl: string; status: EpcisPullRecord['status']; pagesAcknowledged: number; cursor: EpcisRecoveryCursorState }>;
}

/** One thing a snapshot leaves out, and why. */
export interface EpcisRecoveryOmission {
  what: 'associations-index' | 'retention-entries' | 'journal' | 'restore-history' | 'credentials' | 'cursors' | 'other-scopes' | 'operational-records' | 'provenance';
  /** `derived`: rebuilt at the destination. `empty-at-boundary`: there was none when the snapshot was taken. `never-carried`: no snapshot holds it. `excluded`: left out of this one. `not-selected`: outside the scopes asked for. `not-public`: a public package may not carry it. */
  reason: 'derived' | 'empty-at-boundary' | 'never-carried' | 'excluded' | 'not-selected' | 'not-public';
  /** How many values were left out, where that can be counted. */
  count?: number;
}

/** The descriptor: what `epcis-recovery.json` holds. Every path in it is relative to the folder the descriptor is in. */
export interface EpcisRecoveryDescriptor {
  format: typeof EPCIS_RECOVERY_FORMAT;
  version: typeof EPCIS_RECOVERY_VERSION;
  /** Which of the two access paths this is. Only `authorised-recovery` can be restored. */
  access: EpcisRecoveryAccess;
  snapshot: {
    /** The SHA-256 of the canonical form of the format, the version, the access path and the inventory below: the same content has the same identity whenever it was exported. */
    snapshotId: string;
    takenAt: string;
    /** No unfinished work was journalled when the snapshot was taken. */
    boundary: 'no-unfinished-work';
    /** Every record carried was read twice at the same revision, so all of them stood together at one moment. */
    isolation: 'stable-revisions';
  };
  /** Whether every source scope the store held is covered, or only the ones asked for. */
  selection: 'all-scopes' | 'listed-scopes';
  scopes: EpcisRecoveryScope[];
  /** Whether the cursors of pulls were asked for. Each pull says what became of its own. */
  cursors: 'excluded' | 'included';
  /** Every file the snapshot needs. A snapshot missing one of them is not this snapshot. */
  inventory: Array<{ path: string; kind: EpcisRecoveryFileKind; sha256: string; byteLength: number }>;
  omitted: EpcisRecoveryOmission[];
  completeness: {
    /** `complete-for-scopes`: every retained original and durable record of the covered scopes at the boundary. `bounded`: only what the access policy allowed. */
    claim: 'complete-for-scopes' | 'bounded';
    /** True only for an authorised recovery snapshot: a deployment can be restored from it. */
    recoverable: boolean;
  };
  limits: typeof EPCIS_RECOVERY_LIMITS;
}

/** One inventory entry of a snapshot. It has the members of an inventory entry of `dpp-evidence-package@1`, so an exporter adds it to its manifest unchanged. */
export interface EpcisRecoveryInventoryEntry {
  path: string;
  category: (typeof EPCIS_RECOVERY_CATEGORIES)[keyof typeof EPCIS_RECOVERY_CATEGORIES];
  mediaType: string;
  byteLength: number;
  sha256: string;
  /** What the file is: the content address of an original, or the identity of a record. */
  represents: string;
  representation: (typeof EPCIS_RECOVERY_REPRESENTATIONS)[keyof typeof EPCIS_RECOVERY_REPRESENTATIONS];
}

type MaybePromise<T> = T | Promise<T>;
type Json = Record<string, unknown>;

const K = EPCIS_RECORD_KINDS;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;
const PATH = /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@-][A-Za-z0-9._@-]*)*$/u;
const PULL_ID = /^urn:bsv:dpp:epcis:pull:sha256:[0-9a-f]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const FILE_KINDS: readonly EpcisRecoveryFileKind[] = ['original', 'import', 'observation', 'resolution', 'pull', 'pull-page', 'public-import'];
const PULL_STATUSES: readonly string[] = ['running', 'exhausted', 'stopped-at-limit', 'failed'];
const CURSOR_STATES: readonly string[] = ['none', 'excluded', 'included', 'excluded-non-standard'];
const OMISSIONS: readonly string[] = ['associations-index', 'retention-entries', 'journal', 'restore-history', 'credentials', 'cursors', 'other-scopes', 'operational-records', 'provenance'];
const OMISSION_REASONS: readonly string[] = ['derived', 'empty-at-boundary', 'never-carried', 'excluded', 'not-selected', 'not-public'];
/** A batch of a restore never carries more records than this. */
const RESTORE_BATCH = 64;
/** How often a snapshot is read again when a record changed between its two readings. */
const STABLE_ATTEMPTS = 4;

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && PATH.test(value);
const systemClock = (): string => new Date().toISOString();
const toValue = (record: object): JsonObject => JSON.parse(JSON.stringify(record)) as JsonObject;
const sameJson = (a: unknown, b: unknown): boolean => canonicalizeJcs(a) === canonicalizeJcs(b);
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

function rootOf(root: string | undefined): string {
  const chosen = root ?? EPCIS_RECOVERY_ROOT;
  if (!isPath(chosen)) throw new TypeError(`root must be a relative folder with no empty, dot or dot-dot segment; got ${JSON.stringify(chosen)}`);
  return chosen;
}

/** The folder each kind of record file sits in, under the snapshot's folder. */
const FOLDER: Record<EpcisRecoveryFileKind, string> = {
  original: 'originals',
  import: 'records/import',
  observation: 'records/observation',
  resolution: 'records/resolution',
  pull: 'records/pull',
  'pull-page': 'records/pull-page',
  'public-import': 'records/public-import',
};

/** Where a file sits, relative to the descriptor: an original under its digest, a record under the key its content gives. */
const pathOf = (kind: EpcisRecoveryFileKind, name: string): string => (kind === 'original' ? `${FOLDER.original}/${name}` : `${FOLDER[kind]}/${name}.json`);

/** The identity of a snapshot: the digest of what it carries, so the same content has the same identity whenever it was exported. */
function snapshotIdOf(access: EpcisRecoveryAccess, inventory: EpcisRecoveryDescriptor['inventory']): string {
  return sha256Hex(canonicalizeJcs({ access, format: EPCIS_RECOVERY_FORMAT, inventory, version: EPCIS_RECOVERY_VERSION }));
}

/* ------------------------------- the descriptor -------------------------- */

/**
 * The problems that make a value not a format 1 descriptor, one sentence
 * each, naming the member. Empty means the value has the descriptor's
 * structure. It is the hand-written twin of
 * `contracts/epcis-recovery.schema.json` and accepts and refuses what the
 * schema does. Rules that relate one member to another are
 * `epcisRecoveryInconsistencies`.
 */
export function epcisRecoveryProblems(value: unknown): string[] {
  const problems: string[] = [];
  const say = (sentence: string): void => { problems.push(sentence); };
  const name = (at: string): string => (at === '' ? 'the descriptor' : `\`${at}\``);
  const join = (at: string, key: string | number): string => (at === '' ? String(key) : `${at}.${key}`);
  const has = (object: Json, key: string): boolean => Object.hasOwn(object, key);
  const members = (candidate: unknown, at: string, required: readonly string[], optional: readonly string[] = []): Json | undefined => {
    if (!isObject(candidate)) { say(`${name(at)} must be an object.`); return undefined; }
    for (const key of required) if (!has(candidate, key)) say(`${name(at)} is missing the required member \`${key}\`.`);
    for (const key of Object.keys(candidate)) if (!required.includes(key) && !optional.includes(key)) say(`${name(at)} has a member the format does not define: \`${key}\`.`);
    return candidate;
  };
  const constant = (object: Json, key: string, at: string, expected: string): void => {
    if (has(object, key) && object[key] !== expected) say(`${name(join(at, key))} must be ${JSON.stringify(expected)}.`);
  };
  const oneOf = (object: Json, key: string, at: string, allowed: readonly string[]): void => {
    if (has(object, key) && !(typeof object[key] === 'string' && allowed.includes(object[key] as string))) say(`${name(join(at, key))} must be one of ${allowed.join(', ')}.`);
  };
  const text = (object: Json, key: string, at: string, pattern: RegExp | undefined, max: number, what: string): void => {
    if (!has(object, key)) return;
    const v = object[key];
    if (typeof v !== 'string' || v.length === 0 || v.length > max || (pattern != null && !pattern.test(v))) say(`${name(join(at, key))} must be ${what}.`);
  };
  const count = (object: Json, key: string, at: string): void => {
    if (has(object, key) && !(typeof object[key] === 'number' && Number.isInteger(object[key]) && (object[key] as number) >= 0)) say(`${name(join(at, key))} must be a whole number of at least 0.`);
  };
  const list = (object: Json, key: string, at: string, min: number, item: (entry: unknown, at: string) => void): void => {
    if (!has(object, key)) return;
    const v = object[key];
    const where = join(at, key);
    if (!Array.isArray(v)) { say(`${name(where)} must be a list.`); return; }
    if (v.length < min) say(`${name(where)} must list at least ${min} ${min === 1 ? 'entry' : 'entries'}.`);
    v.forEach((entry, index) => item(entry, join(where, index)));
  };
  const digestText = 'sixty-four lower-case hexadecimal characters';
  const nameText = 'text of 1 to 256 characters';

  const descriptor = members(value, '', ['format', 'version', 'access', 'snapshot', 'selection', 'scopes', 'cursors', 'inventory', 'omitted', 'completeness', 'limits']);
  if (descriptor == null) return problems;
  constant(descriptor, 'format', '', EPCIS_RECOVERY_FORMAT);
  constant(descriptor, 'version', '', EPCIS_RECOVERY_VERSION);
  oneOf(descriptor, 'access', '', ['authorised-recovery', 'public-evidence']);
  oneOf(descriptor, 'selection', '', ['all-scopes', 'listed-scopes']);
  oneOf(descriptor, 'cursors', '', ['excluded', 'included']);

  if (has(descriptor, 'snapshot')) {
    const snapshot = members(descriptor.snapshot, 'snapshot', ['snapshotId', 'takenAt', 'boundary', 'isolation']);
    if (snapshot != null) {
      text(snapshot, 'snapshotId', 'snapshot', SHA256, 64, digestText);
      text(snapshot, 'takenAt', 'snapshot', DATE_TIME, 64, 'an ISO 8601 date-time with a zone');
      constant(snapshot, 'boundary', 'snapshot', 'no-unfinished-work');
      constant(snapshot, 'isolation', 'snapshot', 'stable-revisions');
    }
  }

  list(descriptor, 'scopes', '', 1, (entry, at) => {
    const scope = members(entry, at, ['sourceId', 'originals', 'imports', 'observations', 'resolutions', 'pulls']);
    if (scope == null) return;
    text(scope, 'sourceId', at, undefined, 256, nameText);
    for (const key of ['originals', 'imports', 'observations', 'resolutions']) count(scope, key, at);
    list(scope, 'pulls', at, 0, (held, where) => {
      const pull = members(held, where, ['pullId', 'queryId', 'definitionDigest', 'baseUrl', 'status', 'pagesAcknowledged', 'cursor']);
      if (pull == null) return;
      text(pull, 'pullId', where, PULL_ID, 128, 'the identity of a pull');
      text(pull, 'queryId', where, undefined, 256, nameText);
      text(pull, 'definitionDigest', where, SHA256, 64, digestText);
      text(pull, 'baseUrl', where, undefined, 2048, 'text of 1 to 2048 characters');
      oneOf(pull, 'status', where, PULL_STATUSES);
      count(pull, 'pagesAcknowledged', where);
      oneOf(pull, 'cursor', where, CURSOR_STATES);
    });
  });

  list(descriptor, 'inventory', '', 1, (entry, at) => {
    const file = members(entry, at, ['path', 'kind', 'sha256', 'byteLength']);
    if (file == null) return;
    if (has(file, 'path') && !isPath(file.path)) say(`${name(join(at, 'path'))} must be a relative file name of at most 512 characters with no empty, dot or dot-dot segment.`);
    oneOf(file, 'kind', at, FILE_KINDS);
    text(file, 'sha256', at, SHA256, 64, digestText);
    count(file, 'byteLength', at);
  });

  list(descriptor, 'omitted', '', 0, (entry, at) => {
    const omitted = members(entry, at, ['what', 'reason'], ['count']);
    if (omitted == null) return;
    oneOf(omitted, 'what', at, OMISSIONS);
    oneOf(omitted, 'reason', at, OMISSION_REASONS);
    count(omitted, 'count', at);
  });

  if (has(descriptor, 'completeness')) {
    const completeness = members(descriptor.completeness, 'completeness', ['claim', 'recoverable']);
    if (completeness != null) {
      oneOf(completeness, 'claim', 'completeness', ['complete-for-scopes', 'bounded']);
      if (has(completeness, 'recoverable') && typeof completeness.recoverable !== 'boolean') say('`completeness.recoverable` must be true or false.');
    }
  }

  if (has(descriptor, 'limits')) {
    const limits = members(descriptor.limits, 'limits', Object.keys(EPCIS_RECOVERY_LIMITS));
    if (limits != null) for (const [key, expected] of Object.entries(EPCIS_RECOVERY_LIMITS)) constant(limits, key, 'limits', expected);
  }
  return problems;
}

/**
 * The ways a structurally valid descriptor contradicts itself, one sentence
 * each: a file or a scope listed twice, a file in the wrong folder for its
 * kind, an identity that is not the digest of the inventory, a count that the
 * inventory does not bear out, or a claim its access path cannot make. A
 * descriptor with any of them is refused when a snapshot is read.
 */
export function epcisRecoveryInconsistencies(descriptor: EpcisRecoveryDescriptor): string[] {
  const problems: string[] = [];
  const paths = descriptor.inventory.map((entry) => entry.path);
  for (const path of new Set(paths.filter((p, i) => paths.indexOf(p) !== i))) problems.push(`the file ${path} is listed twice.`);
  const sources = descriptor.scopes.map((scope) => scope.sourceId);
  for (const sourceId of new Set(sources.filter((s, i) => sources.indexOf(s) !== i))) problems.push(`the source scope ${JSON.stringify(sourceId)} is listed twice.`);
  for (const entry of descriptor.inventory) {
    const folder = `${FOLDER[entry.kind]}/`;
    const rest = entry.path.startsWith(folder) ? entry.path.slice(folder.length) : undefined;
    if (rest == null || rest.includes('/') || (entry.kind !== 'original' && !rest.endsWith('.json'))) problems.push(`the file ${entry.path} is not where a file of kind ${entry.kind} sits.`);
    else if (entry.kind === 'original' && rest !== entry.sha256) problems.push(`the original ${entry.path} is not named by its own digest.`);
  }
  if (descriptor.snapshot.snapshotId !== snapshotIdOf(descriptor.access, descriptor.inventory)) problems.push('the snapshot identity is not the digest of the inventory it names.');
  const held = (kind: EpcisRecoveryFileKind): number => descriptor.inventory.filter((entry) => entry.kind === kind).length;
  const said = (member: 'imports' | 'observations' | 'resolutions'): number => descriptor.scopes.reduce((sum, scope) => sum + scope[member], 0);
  const publicForm = descriptor.access === 'public-evidence';
  if (said('imports') !== held(publicForm ? 'public-import' : 'import')) problems.push('the scopes do not account for every import record in the inventory.');
  if (said('observations') !== held('observation')) problems.push('the scopes do not account for every observation in the inventory.');
  if (said('resolutions') !== held('resolution')) problems.push('the scopes do not account for every conflict decision in the inventory.');
  if (descriptor.scopes.reduce((sum, scope) => sum + scope.pulls.length, 0) !== held('pull')) problems.push('the scopes do not account for every pull in the inventory.');
  if (descriptor.scopes.reduce((sum, scope) => sum + scope.pulls.reduce((pages, pull) => pages + pull.pagesAcknowledged, 0), 0) !== held('pull-page')) problems.push('the scopes do not account for every acknowledged page in the inventory.');
  if (publicForm) {
    const operational = descriptor.inventory.find((entry) => entry.kind !== 'original' && entry.kind !== 'public-import');
    if (operational != null) problems.push(`a public form carries ${operational.path}, which is an operational record.`);
    if (descriptor.completeness.recoverable || descriptor.completeness.claim !== 'bounded') problems.push('a public form claims to be complete or recoverable.');
    if (descriptor.cursors !== 'excluded') problems.push('a public form says it carries cursors.');
  } else {
    if (held('public-import') > 0) problems.push('a recovery snapshot carries a public import record in place of the record itself.');
    if (!descriptor.completeness.recoverable || descriptor.completeness.claim !== 'complete-for-scopes') problems.push('a recovery snapshot does not claim what a recovery snapshot is.');
  }
  for (const scope of descriptor.scopes) {
    for (const pull of scope.pulls) {
      if (pull.cursor === 'included' && descriptor.cursors !== 'included') problems.push(`the pull ${pull.pullId} is said to carry its cursor in a snapshot that excludes cursors.`);
      if (pull.cursor === 'excluded-non-standard' && descriptor.cursors !== 'included') problems.push(`the pull ${pull.pullId} is said to have lost its cursor for its address in a snapshot that excludes every cursor.`);
      if (pull.cursor === 'excluded' && descriptor.cursors !== 'excluded') problems.push(`the pull ${pull.pullId} is said to have had its cursor left out in a snapshot that carries cursors.`);
    }
  }
  return problems;
}

/** One line of `completeness.withheld` for something a snapshot leaves out. */
export function describeEpcisRecoveryOmission(omitted: EpcisRecoveryOmission): string {
  return `epcis-exchange ${omitted.what} ${omitted.reason}${omitted.count == null ? '' : ` count:${omitted.count}`}`;
}

/* --------------------------------- snapshots ----------------------------- */

/** A snapshot in memory: the originals by digest, and every record by the storage key its own content gives. */
interface Snapshot {
  originals: Map<string, Uint8Array>;
  imports: Map<string, EpcisImportRecord>;
  observations: Map<string, EpcisObservationRecord>;
  resolutions: Map<string, EpcisResolutionRecord>;
  pulls: Map<string, EpcisPullRecord>;
  pages: Map<string, EpcisPullPageRecord>;
}

const emptySnapshot = (): Snapshot => ({ originals: new Map(), imports: new Map(), observations: new Map(), resolutions: new Map(), pulls: new Map(), pages: new Map() });

type RecordKind = Exclude<EpcisRecoveryFileKind, 'original'>;
type Refused<Code extends string> = { code: Code; detail: string };

/**
 * Why a file is not a record of the kind it is listed as, in a version this
 * module reads, or undefined when it is. A record of another type is
 * misfiled; a record of the right type in another version is unknown, and is
 * never guessed at.
 */
function recordProblem(kind: RecordKind, value: Json): Refused<'record-version-unknown' | 'record-misfiled'> | undefined {
  const typed = (recordType: string, version: string): Refused<'record-version-unknown' | 'record-misfiled'> | undefined => {
    if (value.recordType !== recordType) return { code: 'record-misfiled', detail: `it is ${value.recordType === undefined ? 'not a record with a type' : `a record of type ${String(value.recordType)}`}, and a ${kind} record is of type ${recordType}` };
    return value.recordVersion === version ? undefined : { code: 'record-version-unknown', detail: `it is ${recordType} version ${String(value.recordVersion)}, and this module reads version ${version}` };
  };
  if (kind === 'import' || kind === 'public-import') {
    if (value.recordType !== undefined || value.importVersion === undefined) return { code: 'record-misfiled', detail: 'it is not an import record' };
    return value.importVersion === EPCIS_IMPORT_VERSION ? undefined : { code: 'record-version-unknown', detail: `it is an import record of version ${String(value.importVersion)}, and this module reads version ${EPCIS_IMPORT_VERSION}` };
  }
  if (kind === 'observation') return typed('epcis-observation', EPCIS_RECORD_VERSION);
  if (kind === 'resolution') return typed('epcis-conflict-resolution', EPCIS_RECORD_VERSION);
  if (kind === 'pull') return typed('epcis-pull', EPCIS_PULL_VERSION);
  return typed('epcis-pull-page', EPCIS_PULL_VERSION);
}

// The protocol package ships these contracts for offline consumers. Resolve
// their references locally and compile each supported record version once.
const schemaRequire = createRequire(import.meta.url);
let recordValidators: Record<string, ValidateFunction> | undefined;
function structuralProblem(kind: string, value: Json): string | undefined {
  if (recordValidators == null) {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true });
    (addFormats as unknown as (a: Ajv2020) => void)(ajv);
    const imports = schemaRequire('@bsv/dpp-protocol/schemas/epcis-import.schema.json');
    const records = schemaRequire('@bsv/dpp-protocol/schemas/epcis-exchange-records.schema.json');
    const recovery = schemaRequire('@bsv/dpp-protocol/schemas/epcis-recovery.schema.json');
    ajv.addSchema([imports, records, recovery]);
    const validator = (id: string, definition: string): ValidateFunction => ajv.compile({ $ref: `${id}#/$defs/${definition}` });
    recordValidators = {
      import: validator(recovery.$id, 'operationalImport'), pull: validator(recovery.$id, 'operationalPull'),
      observation: validator(records.$id, 'observation'), resolution: validator(records.$id, 'conflictResolution'),
      'pull-page': validator(records.$id, 'pullPage'), restore: validator(records.$id, 'restore'),
    };
  }
  const validate = recordValidators[kind]!;
  if (validate(value)) return kind === 'pull' ? pullRecordProblem(value as unknown as EpcisPullRecord) : undefined;
  const error = validate.errors?.[0];
  return `${kind}${error?.instancePath ?? ''} ${error?.message ?? 'does not meet its record contract'}`;
}

/** Check the stored run before an export omits any private cursor, and again on receipt. */
function pullRecordProblem({ pass, pending, cursor, status, lastRun }: EpcisPullRecord): string | undefined {
  if (cursor != null && (cursor.afterPage !== pass.pagesAcknowledged || pass.exhausted)) return 'The active cursor does not follow the last acknowledged page of an unfinished pass.';
  if (pending?.next != null && (pending.next.afterPage !== pending.page || pending.last)) return 'The pending cursor does not follow its page.';
  if (status === 'running') {
    if ([lastRun.endedAt, lastRun.reason, lastRun.outcome, lastRun.completion, lastRun.detail].some(field => field !== undefined)) return 'A running pull carries a completed run summary.';
    // A crash can leave the final page acknowledged before the run ending was recorded.
    return undefined;
  }
  if (lastRun.endedAt == null || lastRun.detail == null || lastRun.reason == null) return 'A completed pull lacks its run ending.';
  if (lastRun.completion !== status || status !== pullCompletion(lastRun.reason) || lastRun.outcome !== EPCIS_PULL_REASON_OUTCOME[lastRun.reason]) return 'The run reason, outcome and completion disagree with the pull status.';
  if (pass.exhausted !== (status === 'exhausted')) return 'The completed run disagrees with the last acknowledged page of its pass.';
  return undefined;
}

/** The storage key a record's own content gives, or undefined when the content does not give one. A path never decides where a record goes. */
function keyOf(kind: RecordKind, value: Json): string | undefined {
  const text = (member: string): string | undefined => (typeof value[member] === 'string' && (value[member] as string).length > 0 ? (value[member] as string) : undefined);
  const sequence = typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence >= 1 ? value.sequence : undefined;
  if (kind === 'import' || kind === 'public-import') {
    const sourceId = text('sourceId');
    const requestId = text('requestId');
    if (sourceId == null || requestId == null || value.importId !== epcisImportId(sourceId, requestId)) return undefined;
    return epcisImportKey(sourceId, requestId);
  }
  if (kind === 'observation') {
    const sourceId = text('sourceId');
    const identity = text('identity');
    if (sourceId == null || identity == null || sequence == null || (value.identityKind !== 'event-id' && value.identityKind !== 'local')) return undefined;
    return observationKey(epcisEventScopeKey(sourceId, value.identityKind, identity), sequence);
  }
  if (kind === 'resolution') {
    const sourceId = text('sourceId');
    const identity = text('identity');
    const scopeKey = conflictScopeKeyOf(text('conflictId') ?? '');
    if (sourceId == null || identity == null || sequence == null || scopeKey == null || (value.identityKind !== 'event-id' && value.identityKind !== 'local')) return undefined;
    // A decision is filed under the event identity it names, and that is the identity its conflict is about.
    if (scopeKey !== epcisEventScopeKey(sourceId, value.identityKind, identity)) return undefined;
    return resolutionKey(scopeKey, sequence);
  }
  if (kind === 'pull') {
    const sourceId = text('sourceId');
    const queryId = text('queryId');
    if (sourceId == null || queryId == null || value.pullId !== epcisPullId(sourceId, queryId)) return undefined;
    return epcisPullKey(sourceId, queryId);
  }
  const pullKey = pullKeyOf(text('pullId') ?? '');
  return pullKey == null || sequence == null ? undefined : pullPageKey(pullKey, sequence);
}

/** What an inventory entry's `represents` says for a record: its own identity, never a storage key. */
function representsOf(kind: RecordKind, value: Json): string {
  if (kind === 'import' || kind === 'public-import') return String(value.importId);
  if (kind === 'observation') return `${String(value.sourceId)} ${String(value.identityKind)} ${String(value.identity)} #${String(value.sequence)}`;
  if (kind === 'resolution') return String(value.resolutionId);
  if (kind === 'pull') return String(value.pullId);
  return `${String(value.pullId)}#${String(value.sequence)}`;
}

/**
 * A record of the snapshot that depends on one the snapshot does not hold.
 * These are the two failures a recoverable export must never have: a
 * checkpoint ahead of the imports it stands on, and a decision without the
 * observations it decided between.
 */
function omission(snapshot: Snapshot): Refused<'checkpoint-imports-omitted' | 'resolution-observations-omitted' | 'snapshot-inconsistent'> | undefined {
  const pagesOf = new Map<string, number>();
  for (const [key, page] of snapshot.pages) {
    const pullKey = pullKeyOf(page.pullId) as string;
    const pull = snapshot.pulls.get(pullKey);
    if (pull == null) return { code: 'snapshot-inconsistent', detail: `the page record ${key} belongs to the pull ${page.pullId}, which the snapshot does not hold.` };
    // A page is its pull's, and a pull is one source scope's. Bytes two scopes both hold never make one scope's page out of the other's import.
    if (page.sourceId !== pull.sourceId) return { code: 'snapshot-inconsistent', detail: `the page record ${key} names the source scope ${JSON.stringify(page.sourceId)}, and its pull belongs to ${JSON.stringify(pull.sourceId)}. Two source scopes are never joined.` };
    pagesOf.set(pullKey, (pagesOf.get(pullKey) ?? 0) + 1);
    const held = snapshot.imports.get(importKeyOf(page.importId) ?? '');
    if (held == null || held.importId !== page.importId || held.sha256 !== page.sha256) return { code: 'checkpoint-imports-omitted', detail: `the pull ${page.pullId} acknowledged page ${page.sequence} as the import ${page.importId}, and the snapshot does not hold that import with those bytes. A checkpoint is never restored ahead of the imports it stands on.` };
    if (held.sourceId !== page.sourceId) return { code: 'snapshot-inconsistent', detail: `the pull ${page.pullId} of the source scope ${JSON.stringify(page.sourceId)} names as its page ${page.sequence} the import ${page.importId}, which belongs to ${JSON.stringify(held.sourceId)}. Two source scopes are never joined because they hold the same bytes.` };
    if (held.byteLength !== page.byteLength || held.mediaType !== page.mediaType || held.documentValidity !== page.documentValidity || !sameJson(countEvents(held, page.importReplayed), page.events)) return { code: 'snapshot-inconsistent', detail: `Page ${page.sequence} of ${page.pullId} contradicts its retained import.` };
  }
  for (const [key, pull] of snapshot.pulls) {
    const held = pagesOf.get(key) ?? 0;
    if (held !== pull.pagesAcknowledged) return { code: 'checkpoint-imports-omitted', detail: `the pull ${pull.pullId} acknowledged ${pull.pagesAcknowledged} pages and the snapshot holds ${held} of their page records. A checkpoint is never restored ahead of the pages and imports it stands on.` };
  }
  const decisionsById = new Map<string, EpcisResolutionRecord>();
  for (const resolution of snapshot.resolutions.values()) {
    const scopeKey = conflictScopeKeyOf(resolution.conflictId) as string;
    const previous = snapshot.resolutions.get(resolutionKey(scopeKey, resolution.sequence - 1));
    if (resolution.resolutionId !== epcisResolutionId(scopeKey, resolution.sequence)) return { code: 'snapshot-inconsistent', detail: 'The conflict decision ID differs from its scope and sequence.' };
    if ((resolution.sequence > 1 && previous == null) || resolution.supersedes !== previous?.resolutionId) return { code: 'snapshot-inconsistent', detail: `The decision ${resolution.resolutionId} does not follow its recorded predecessor.` };
    decisionsById.set(resolution.resolutionId, resolution);
    if (!Array.isArray(resolution.observations) || resolution.observations.length === 0) return { code: 'resolution-observations-omitted', detail: `the decision ${resolution.resolutionId} names no competing observation.` };
    const bodies = new Set(resolution.observations.map(reference => reference.bodyDigest));
    if (resolution.observations.some((reference, index) => reference.sequence !== index + 1) || resolution.bodyDigests.length !== bodies.size || resolution.bodyDigests.some(digest => !bodies.has(digest)) || (resolution.selectedBodyDigest != null && !bodies.has(resolution.selectedBodyDigest))) return { code: 'resolution-observations-omitted', detail: `The decision ${resolution.resolutionId} does not account for each competing observation and body.` };
    for (const reference of resolution.observations) {
      const held = snapshot.observations.get(observationKey(scopeKey, reference.sequence));
      if (held == null || held.bodyDigest !== reference.bodyDigest || held.importId !== reference.importId || held.pointer !== reference.pointer || held.sourceSha256 !== reference.sourceSha256) return { code: 'resolution-observations-omitted', detail: `the decision ${resolution.resolutionId} names observation ${reference.sequence} of ${JSON.stringify(resolution.identity)}, and the snapshot does not hold it. A decision is never restored without every observation it decided between.` };
    }
  }
  for (const record of snapshot.imports.values()) {
    for (const event of record.events) {
      const conflict = event.conflict;
      if (conflict?.state !== 'resolved') continue;
      const decision = decisionsById.get(conflict.resolutionId ?? '');
      if (decision == null || decision.conflictId !== conflict.conflictId || decision.sourceId !== record.sourceId || decision.identityKind !== event.identityKind || decision.identity !== event.identity || decision.decision !== conflict.resolution || decision.decidedAt !== conflict.resolvedAt) {
        return { code: 'snapshot-inconsistent', detail: `The resolved event at ${event.pointer} of ${record.importId} does not match a retained decision for that event.` };
      }
    }
  }
  return undefined;
}

/**
 * Every breach of the exchange's own invariants in a snapshot taken by
 * itself. The snapshot is laid out in a store in memory, with the retention
 * entries its import records give, and held to `checkEpcisExchangeInvariants`:
 * the one check, on exactly what is carried and nothing beside it.
 */
async function breachesOf(snapshot: Snapshot): Promise<string[]> {
  const breaches: string[] = [];
  for (const record of snapshot.imports.values()) {
    if (record.requestDigest !== epcisRequestDigest({ sourceId: record.sourceId, mediaType: record.mediaType, byteLength: record.byteLength, sha256: record.sha256 })) breaches.push(`import ${record.importId}: its request digest is not the digest of its request`);
    if (typeof record.bytesRef !== 'string' || record.bytesRef.length === 0) breaches.push(`import ${record.importId}: it does not say where its bytes are held`);
  }
  const held = new Set([...snapshot.imports.values()].map((record) => record.sha256));
  for (const sha256 of snapshot.originals.keys()) if (!held.has(sha256)) breaches.push(`original ${sha256}: no import record retains it`);
  // An observation is filed under its own source scope, and it was made by an import of that scope. The store's check finds the import by its identity alone.
  for (const [key, observation] of snapshot.observations) {
    const owner = snapshot.imports.get(importKeyOf(observation.importId) ?? '');
    if (owner != null && owner.sha256 !== observation.sourceSha256) breaches.push(`observation ${key}: its source digest differs from its retained import`);
    if (owner != null && owner.sourceId !== observation.sourceId) breaches.push(`observation ${key}: it is filed under the source scope ${JSON.stringify(observation.sourceId)} and names an import of ${JSON.stringify(owner.sourceId)}`);
  }
  const pagesByPull = new Map<string, EpcisPullPageRecord[]>();
  for (const page of snapshot.pages.values()) {
    const pages = pagesByPull.get(page.pullId) ?? [];
    pages.push(page);
    pagesByPull.set(page.pullId, pages);
  }
  for (const pull of snapshot.pulls.values()) {
    const issue = (detail: string): void => { breaches.push(`pull ${pull.pullId}: ${detail}`); };
    const { pass, pending, query, source, recordTimeOverlapSeconds } = pull;
    const digest = epcisPullDefinitionDigest({ sourceId: pull.sourceId, baseUrl: source.baseUrl, query, recordTimeOverlapSeconds });
    if (source.sourceId !== pull.sourceId || pull.definitionDigest !== digest) issue('its recorded definition differs from its source and query');
    const pages = (pagesByPull.get(pull.pullId) ?? []).sort((a, b) => a.sequence - b.sequence);
    const current = pages.filter(page => page.pass === pass.number && page.attempt === pass.attempt);
    if (pass.pagesAcknowledged !== current.length || current.some((page, index) => page.page !== index + 1) || pass.exhausted !== (current.at(-1)?.last ?? false)) issue('its pass checkpoint differs from the durable pages');
    if (pull.runs !== pull.lastRun.run || pages.filter(page => page.run === pull.runs).length !== pull.lastRun.pagesAcknowledged) issue('its run checkpoint differs from the durable pages');

    const maximumByPass = new Map<number, string>();
    let watermark: { recordTime: string; pass: number } | undefined;
    let priorWatermark: string | undefined;
    const totals = { bytes: 0, events: noEvents() };
    for (const page of pages) {
      const receipt = snapshot.imports.get(importKeyOf(page.importId)!)!;
      const latest = latestRecordTime(receipt, maximumByPass.get(page.pass));
      if (latest != null) maximumByPass.set(page.pass, latest);
      if (page.last && query.eventIds == null && latest != null) {
        watermark = { recordTime: watermark != null && Date.parse(watermark.recordTime) > Date.parse(latest) ? watermark.recordTime : latest, pass: page.pass };
        if (page.pass < pass.number) priorWatermark = watermark.recordTime;
      }
      totals.bytes += page.byteLength;
      addEvents(totals.events, page.events);
    }
    if (!sameJson(totals, pull.totals) || pass.maxRecordTime !== maximumByPass.get(pass.number) || pull.watermark?.pass !== watermark?.pass || pull.watermark?.recordTime !== watermark?.recordTime) issue('its totals or record-time watermark differ from the durable pages');
    let from = query.recordTime?.from;
    if (pass.window.basis === 'watermark') {
      if (priorWatermark == null || pass.window.overlapSeconds !== recordTimeOverlapSeconds) issue('its record-time window has no matching prior watermark');
      else from = new Date(Math.max(Date.parse(priorWatermark) - recordTimeOverlapSeconds * 1000, from == null ? -Infinity : Date.parse(from))).toISOString();
    }
    if (pass.window.recordTimeFrom !== from || !sameJson(pass.parameters, epcisQueryParameters(query, from))) issue('its pass differs from its query bounds');
    if (pending != null && (pending.sequence !== pull.pagesAcknowledged + 1 || pending.page !== pass.pagesAcknowledged + 1 || pending.pass !== pass.number || pending.attempt !== pass.attempt || !sameJson(withoutToken(pending.query).query, pass.parameters))) issue('the pending page does not follow its durable checkpoint');
  }
  try {
    const staged = createMemoryEpcisStorage();
    for (const [sha256, bytes] of snapshot.originals) await staged.putBytes(sha256, bytes);
    const writes: EpcisStorageWrite[] = [];
    for (const [key, record] of snapshot.imports) {
      writes.push({ op: 'put', kind: K.import, key, value: toValue(record) });
      const retention: EpcisRetentionRecord = { recordType: 'epcis-retention', recordVersion: EPCIS_RECORD_VERSION, sha256: record.sha256, importId: record.importId };
      writes.push({ op: 'put', kind: K.retention, key: retentionKey(record.sha256, key), value: toValue(retention) });
    }
    for (const [key, record] of snapshot.observations) writes.push({ op: 'put', kind: K.observation, key, value: toValue(record) });
    for (const [key, record] of snapshot.resolutions) writes.push({ op: 'put', kind: K.resolution, key, value: toValue(record) });
    for (const [key, record] of snapshot.pulls) writes.push({ op: 'put', kind: K.pull, key, value: toValue(record) });
    for (const [key, record] of snapshot.pages) writes.push({ op: 'put', kind: K.pullPage, key, value: toValue(record) });
    await staged.commit(writes);
    breaches.push(...(await checkEpcisExchangeInvariants(staged)));
  } catch (cause) {
    breaches.push(`the snapshot could not be laid out: ${reasonOf(cause)}`);
  }
  return breaches;
}

/* ------------------------------ cursor exclusion ------------------------- */

/** True when an address carries nothing but the standard query parameters: no user information, no fragment, and no parameter this profile does not name, any of which may be a credential. */
function isStandardCursorTarget(target: unknown): boolean {
  if (typeof target !== 'string') return false;
  let url: URL;
  try { url = new URL(target); } catch { return false; }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return false;
  for (const name of url.searchParams.keys()) if (!(EPCIS_QUERY_PARAMETERS as readonly string[]).includes(name)) return false;
  return true;
}

interface Portable<T> { value: T; removed: number; cursor?: EpcisRecoveryCursorState }

const withoutToken = (query: Record<string, string>): { query: Record<string, string>; removed: number } => {
  if (query.nextPageToken === undefined) return { query, removed: 0 };
  const { nextPageToken: _token, ...rest } = query;
  return { query: rest, removed: 1 };
};

/** An import record as a snapshot carries it. With cursors excluded, the token a page was asked for with is left out of its provenance: it is the cursor that named the page. */
function portableImport(record: EpcisImportRecord, cursors: 'excluded' | 'included'): Portable<EpcisImportRecord> {
  if (cursors === 'included' || record.sourceLocation.kind !== 'query') return { value: record, removed: 0 };
  const { query, removed } = withoutToken(record.sourceLocation.query);
  return { value: removed === 0 ? record : { ...record, sourceLocation: { ...record.sourceLocation, query } }, removed };
}

function portablePage(record: EpcisPullPageRecord, cursors: 'excluded' | 'included'): Portable<EpcisPullPageRecord> {
  if (cursors === 'included') return { value: record, removed: 0 };
  const { query, removed } = withoutToken(record.query);
  return { value: removed === 0 ? record : { ...record, query }, removed };
}

/** A pull record as a snapshot carries it. A cursor that is left out leaves the pass to replay from its retained bounds, which is what the pull does whenever it finds none. */
function portablePull(record: EpcisPullRecord, cursors: 'excluded' | 'included'): Portable<EpcisPullRecord> {
  const targets = [record.cursor?.target, record.pending?.next?.target].filter((target) => target !== undefined);
  const value: EpcisPullRecord = { ...record, ...(record.pending == null ? {} : { pending: { ...record.pending } }) };
  let removed = 0;
  const dropCursors = (): void => {
    if (value.cursor != null) { delete value.cursor; removed += 1; }
    if (value.pending?.next != null) { delete value.pending.next; removed += 1; }
  };
  if (cursors === 'excluded') {
    dropCursors();
    if (value.pending != null) { const stripped = withoutToken(value.pending.query); value.pending.query = stripped.query; removed += stripped.removed; }
    return { value, removed, cursor: targets.length === 0 ? 'none' : 'excluded' };
  }
  if (targets.length === 0) return { value: record, removed: 0, cursor: 'none' };
  if (targets.every(isStandardCursorTarget)) return { value: record, removed: 0, cursor: 'included' };
  dropCursors();
  return { value, removed, cursor: 'excluded-non-standard' };
}

/**
 * Where the records of a snapshot do not carry what its descriptor says of
 * cursors, one sentence each. A descriptor that says cursors were left out is
 * what an operator reads before deciding how to keep a snapshot, so a restore
 * holds the records to it: no cursor and no page token where they are said to
 * be excluded, a cursor exactly where one is said to be carried, and never a
 * cursor whose address holds more than the standard query parameters.
 */
function cursorClaimProblems(descriptor: EpcisRecoveryDescriptor, snapshot: Snapshot): string[] {
  const problems: string[] = [];
  const said = new Map<string, EpcisRecoveryCursorState>();
  for (const scope of descriptor.scopes) for (const pull of scope.pulls) said.set(pull.pullId, pull.cursor);
  for (const pull of snapshot.pulls.values()) {
    const targets = [pull.cursor?.target, pull.pending?.next?.target].filter((target) => target !== undefined);
    if ((targets.length > 0) !== (said.get(pull.pullId) === 'included')) problems.push(`pull ${pull.pullId}: the descriptor says its cursor is ${said.get(pull.pullId) ?? 'not accounted for'}, and its record ${targets.length > 0 ? 'carries one' : 'carries none'}`);
    if (!targets.every(isStandardCursorTarget)) problems.push(`pull ${pull.pullId}: it carries a cursor whose address holds more than the standard query parameters`);
  }
  if (descriptor.cursors === 'excluded') {
    const hasToken = (query: Record<string, string> | undefined): boolean => query?.nextPageToken !== undefined;
    for (const record of snapshot.imports.values()) if (record.sourceLocation.kind === 'query' && hasToken(record.sourceLocation.query)) problems.push(`import ${record.importId}: its provenance carries a page token in a snapshot that excludes cursors`);
    for (const page of snapshot.pages.values()) if (hasToken(page.query)) problems.push(`pull ${page.pullId} page ${page.sequence}: it carries a page token in a snapshot that excludes cursors`);
    for (const pull of snapshot.pulls.values()) if (hasToken(pull.pending?.query)) problems.push(`pull ${pull.pullId}: its pending page carries a page token in a snapshot that excludes cursors`);
  }
  return problems;
}

/* --------------------------------- reading a store ----------------------- */

interface Collected {
  journal: EpcisStoredRecord[];
  imports: EpcisStoredRecord[];
  observations: EpcisStoredRecord[];
  resolutions: EpcisStoredRecord[];
  pulls: EpcisStoredRecord[];
  pages: EpcisStoredRecord[];
}

/** Everything a snapshot may carry, as the store holds it now. */
async function collect(storage: EpcisExchangeStorage): Promise<Collected> {
  return {
    journal: await listAll(storage, K.journal),
    imports: await listAll(storage, K.import),
    observations: await listAll(storage, K.observation),
    resolutions: await listAll(storage, K.resolution),
    pulls: await listAll(storage, K.pull),
    pages: await listAll(storage, K.pullPage),
  };
}

const sourceOf = (held: EpcisStoredRecord): unknown => held.value.sourceId;

/** The records of the scopes asked for, or of every scope. */
function within(collected: Collected, scopes: ReadonlySet<string> | undefined): Collected {
  if (scopes == null) return collected;
  const inScope = (list: EpcisStoredRecord[]): EpcisStoredRecord[] => list.filter((held) => typeof sourceOf(held) === 'string' && scopes.has(sourceOf(held) as string));
  return { journal: collected.journal, imports: inScope(collected.imports), observations: inScope(collected.observations), resolutions: inScope(collected.resolutions), pulls: inScope(collected.pulls), pages: inScope(collected.pages) };
}

/** Which records were read and at which revision. Two readings with the same answer read the same records. */
function fingerprint(collected: Collected): string {
  const of = (list: EpcisStoredRecord[]): Array<[string, string, number]> => list.map((held) => [held.kind, held.key, held.revision]);
  return JSON.stringify([of(collected.journal), of(collected.imports), of(collected.observations), of(collected.resolutions), of(collected.pulls), of(collected.pages)]);
}

/** The guards for the credentials an operator names, so that an export can be searched for each before it is handed over. */
function guardsOf(credentials: readonly EpcisSourceCredential[] | undefined): EpcisCredentialGuard[] {
  return (credentials ?? []).map((credential) => {
    const problem = credentialProblem(credential);
    if (problem != null) throw new TypeError(`credentials names a credential that cannot be searched for: ${problem}`);
    return credentialGuard(credential);
  });
}

/* ---------------------------------- export ------------------------------- */

export type EpcisRecoveryExportRefusalCode =
  /** Work is journalled as unfinished. Run `recoverEpcisExchange`, or finish the restore that is pending, and export again. */
  | 'unfinished-work'
  /** The store holds no source scope, so there is nothing to carry. */
  | 'no-source-scope'
  /** A source scope that was asked for holds no import and no pull in this store. */
  | 'scope-not-held'
  /** The store holds a record of a version this module does not read. It is not exported as if it were understood. */
  | 'record-version-unknown'
  /** The store breaks a promise of the exchange: an original is missing or altered, or a record depends on one that is not held. `breaches` lists them. */
  | 'store-inconsistent'
  /** A record kept changing between the two readings of the snapshot. Another writer is at work; export when the store is quiet. */
  | 'store-unstable'
  /** A file of the snapshot carries a credential the operator named. Nothing is handed over. */
  | 'credential-in-snapshot'
  /** The access policy allowed no import, so a public form would be empty. */
  | 'nothing-public';

export interface EpcisRecoveryExportRefusal {
  ok: false;
  code: EpcisRecoveryExportRefusalCode;
  /** One or more sentences for a person. It never repeats a credential. */
  detail: string;
  /** The source scope, for `scope-not-held`. */
  sourceId?: string;
  /** The file, for `credential-in-snapshot`. */
  path?: string;
  /** What is unfinished or broken, for `unfinished-work` and `store-inconsistent`. */
  breaches?: string[];
}

export interface ExportEpcisRecoveryInput {
  storage: EpcisExchangeStorage;
  /** The source scopes to cover, each exactly as its records name it. Default: every scope the store holds. */
  sourceIds?: readonly string[];
  /**
   * Whether the cursors of pulls are carried. `exclude`, the default, leaves
   * out every cursor and every page token, so each unfinished pass replays
   * from its retained bounds at the destination. `include` carries them for
   * an operator who will resume against the same endpoint; a cursor whose
   * address holds anything but the standard query parameters is left out
   * even then.
   */
  cursors?: 'exclude' | 'include';
  /**
   * The credentials this deployment was configured with, for a last check:
   * every exported byte is searched for each, in the forms a source could
   * echo it in, and an export that would carry one is refused. They are read
   * here and written nowhere.
   */
  credentials?: readonly EpcisSourceCredential[];
  /** The folder the snapshot sits in, inside the package. Default `epcis`. */
  root?: string;
  /** The clock for `takenAt`. The system clock by default. */
  now?: () => string;
}

export interface ExportedEpcisRecovery {
  ok: true;
  /** The folder the snapshot sits in. */
  root: string;
  descriptor: EpcisRecoveryDescriptor;
  /** Every file by its path in the package, the descriptor included, each in its exact bytes. */
  files: Map<string, Uint8Array>;
  /** One entry per file, in the order of `files`, for the manifest of the package that carries the snapshot. */
  inventory: EpcisRecoveryInventoryEntry[];
  /**
   * What the carrying manifest says beside its inventory: the disclosure the
   * snapshot needs, one snapshot declaration per source scope for
   * `completeness.snapshots`, and one line per omission for
   * `completeness.withheld`.
   */
  manifest: {
    disclosure: { scope: 'all-tiers' | 'public'; recoveryBackup: boolean };
    snapshots: Array<{ source: string; snapshotId: string; completeForSnapshot: boolean; scope: string }>;
    withheld: string[];
  };
}

interface Assembly {
  access: EpcisRecoveryAccess;
  selection: EpcisRecoveryDescriptor['selection'];
  cursors: 'excluded' | 'included';
  scopes: EpcisRecoveryScope[];
  omitted: EpcisRecoveryOmission[];
  originals: Array<{ sha256: string; bytes: Uint8Array; mediaType: string }>;
  records: Array<{ kind: RecordKind; key: string; value: Json }>;
}

/** The files, the inventory and the descriptor of a snapshot. The same content gives the same bytes, apart from the time in the descriptor. */
function assemble(root: string, takenAt: string, parts: Assembly): ExportedEpcisRecovery {
  const files = new Map<string, Uint8Array>();
  const inventory: EpcisRecoveryInventoryEntry[] = [];
  const listed: EpcisRecoveryDescriptor['inventory'] = [];
  const add = (kind: EpcisRecoveryFileKind, name: string, mediaType: string, bytes: Uint8Array, represents: string): void => {
    const path = pathOf(kind, name);
    const sha256 = sha256Hex(bytes);
    files.set(`${root}/${path}`, bytes);
    inventory.push({ path: `${root}/${path}`, category: kind === 'original' ? EPCIS_RECOVERY_CATEGORIES.original : EPCIS_RECOVERY_CATEGORIES.record, mediaType, byteLength: bytes.byteLength, sha256, represents, representation: EPCIS_RECOVERY_REPRESENTATIONS[kind] });
    listed.push({ path, kind, sha256, byteLength: bytes.byteLength });
  };
  for (const original of [...parts.originals].sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1))) add('original', original.sha256, original.mediaType, Uint8Array.from(original.bytes), `sha256:${original.sha256}`);
  // A record is written in its canonical form, so that one record has one spelling and a reader can tell an edited file from an exported one.
  for (const record of parts.records) add(record.kind, record.key, 'application/json', canonicalJcsBytes(record.value), representsOf(record.kind, record.value));
  const snapshotId = snapshotIdOf(parts.access, listed);
  const recoverable = parts.access === 'authorised-recovery';
  const descriptor: EpcisRecoveryDescriptor = {
    format: EPCIS_RECOVERY_FORMAT,
    version: EPCIS_RECOVERY_VERSION,
    access: parts.access,
    snapshot: { snapshotId, takenAt, boundary: 'no-unfinished-work', isolation: 'stable-revisions' },
    selection: parts.selection,
    scopes: parts.scopes,
    cursors: parts.cursors,
    inventory: listed,
    omitted: parts.omitted,
    completeness: { claim: recoverable ? 'complete-for-scopes' : 'bounded', recoverable },
    limits: { ...EPCIS_RECOVERY_LIMITS },
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(descriptor, null, 2)}\n`);
  const path = `${root}/${EPCIS_RECOVERY_DESCRIPTOR}`;
  files.set(path, bytes);
  inventory.push({ path, category: EPCIS_RECOVERY_CATEGORIES.record, mediaType: 'application/json', byteLength: bytes.byteLength, sha256: sha256Hex(bytes), represents: `epcis exchange ${recoverable ? 'recovery snapshot' : 'public evidence'} ${snapshotId}`, representation: EPCIS_RECOVERY_REPRESENTATIONS.descriptor });
  return {
    ok: true,
    root,
    descriptor,
    files,
    inventory,
    manifest: {
      disclosure: recoverable ? { scope: 'all-tiers', recoveryBackup: true } : { scope: 'public', recoveryBackup: false },
      snapshots: parts.scopes.map((scope) => ({ source: `epcis-exchange:${scope.sourceId}`, snapshotId, completeForSnapshot: recoverable, scope: recoverable ? 'every retained original and durable record of the source scope at the snapshot boundary' : 'the originals and public records the access policy allowed' })),
      withheld: parts.omitted.map(describeEpcisRecoveryOmission),
    },
  };
}

/** The first file of an export that carries a credential the operator named, if any does. A path is searched as well as the bytes it names. */
function credentialCarrier(exported: ExportedEpcisRecovery, guards: readonly EpcisCredentialGuard[]): string | undefined {
  if (guards.length === 0) return undefined;
  for (const [path, bytes] of exported.files) if (guards.some((guard) => guard.carriesBytes(bytes) || guard.carries(path))) return path;
  const beside = JSON.stringify([exported.inventory, exported.manifest]);
  return guards.some((guard) => guard.carries(beside)) ? `${exported.root}/${EPCIS_RECOVERY_DESCRIPTOR}` : undefined;
}

type Reading =
  | { ok: true; collected: Collected; originals: Map<string, Uint8Array>; selection: EpcisRecoveryDescriptor['selection'] }
  | EpcisRecoveryExportRefusal;

/**
 * Read a store at a boundary. The records are read, the bytes they retain are
 * read, and the records are read again: the reading stands only when no work
 * is journalled and every record is at the revision it had the first time.
 * Revisions only grow for the kinds read here, since nothing removes them, so
 * what was read then stood together at the moment between the two readings.
 */
async function readAtBoundary(storage: EpcisExchangeStorage, sourceIds: readonly string[] | undefined): Promise<Reading> {
  const refuse = (code: EpcisRecoveryExportRefusalCode, detail: string, extra: Partial<EpcisRecoveryExportRefusal> = {}): EpcisRecoveryExportRefusal => ({ ok: false, code, detail, ...extra });
  const scopes = sourceIds == null ? undefined : new Set(sourceIds);
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt += 1) {
    const first = within(await collect(storage), scopes);
    if (first.journal.length > 0) {
      const unfinished = first.journal.map((held) => `${held.key}: unfinished ${(held.value as unknown as EpcisJournalRecord).entry}`);
      return refuse('unfinished-work', `The store has ${unfinished.length} unfinished ${unfinished.length === 1 ? 'piece' : 'pieces'} of work journalled, so it is not at a boundary a snapshot can be taken at. Run recoverEpcisExchange, or finish the restore that is pending, and export again.`, { breaches: unfinished });
    }
    const held = new Set<string>();
    for (const list of [first.imports, first.pulls]) for (const record of list) if (typeof sourceOf(record) === 'string') held.add(sourceOf(record) as string);
    if (held.size === 0 && scopes == null) return refuse('no-source-scope', 'The store holds no import and no pull, so there is no source scope to carry.');
    for (const sourceId of scopes ?? []) if (!held.has(sourceId)) return refuse('scope-not-held', `The store holds no import and no pull under the source scope ${JSON.stringify(sourceId)}. A scope is named exactly as its records name it.`, { sourceId });
    const originals = new Map<string, Uint8Array>();
    const missing: string[] = [];
    for (const record of first.imports) {
      const value = record.value as unknown as EpcisImportRecord;
      if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || originals.has(value.sha256)) continue;
      const bytes = await storage.getBytes(value.sha256);
      if (bytes == null) missing.push(`import ${String(value.importId)}: its bytes are not in the store`);
      else if (bytes.byteLength !== value.byteLength || sha256Hex(bytes) !== value.sha256) missing.push(`import ${String(value.importId)}: the bytes held do not match the digest they were recorded under`);
      else originals.set(value.sha256, bytes);
    }
    const second = within(await collect(storage), scopes);
    if (fingerprint(first) !== fingerprint(second)) continue;
    if (missing.length > 0) return refuse('store-inconsistent', 'The store does not hold every original its import records retain, so no snapshot of it is recoverable.', { breaches: missing });
    return { ok: true, collected: first, originals, selection: scopes == null ? 'all-scopes' : 'listed-scopes' };
  }
  return refuse('store-unstable', `A record changed between the two readings of the snapshot, ${STABLE_ATTEMPTS} times over. Another writer is at work on this store; export when it is quiet.`);
}

function checkedSourceIds(sourceIds: unknown): string[] | undefined {
  if (sourceIds === undefined) return undefined;
  if (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.some((sourceId) => typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 256 || CONTROL.test(sourceId))) throw new TypeError('sourceIds is a list of at least one source scope, each 1 to 256 characters without control characters');
  return [...new Set(sourceIds as string[])].sort();
}

/**
 * Export a recovery snapshot: every retained original and every durable
 * record of the source scopes asked for, at one boundary. A refusal is
 * returned, never thrown, and nothing in the store is changed either way.
 *
 * The associations index and the retention entries are not carried. They are
 * rebuilt at the destination from what is.
 *
 * The export holds the store's turn while it reads, so no import, decision or
 * recovery of this process runs meanwhile. A pull that is under way is not
 * stopped: its pull record is carried as it stood at the boundary, and at the
 * destination it resumes as an interrupted run does.
 */
export function exportEpcisRecovery(input: ExportEpcisRecoveryInput): Promise<ExportedEpcisRecovery | EpcisRecoveryExportRefusal> {
  if (input == null || typeof input !== 'object' || input.storage == null || typeof input.storage.commit !== 'function') throw new TypeError('an export is handed the storage it reads');
  if (input.cursors !== undefined && input.cursors !== 'exclude' && input.cursors !== 'include') throw new TypeError('cursors is exclude or include');
  const root = rootOf(input.root);
  const sourceIds = checkedSourceIds(input.sourceIds);
  const guards = guardsOf(input.credentials);
  const cursors = input.cursors === 'include' ? 'included' : 'excluded';
  const clock = input.now ?? systemClock;
  const { storage } = input;
  const refuse = (code: EpcisRecoveryExportRefusalCode, detail: string, extra: Partial<EpcisRecoveryExportRefusal> = {}): EpcisRecoveryExportRefusal => ({ ok: false, code, detail, ...extra });
  return inTurn(storage, async (): Promise<ExportedEpcisRecovery | EpcisRecoveryExportRefusal> => {
    const reading = await readAtBoundary(storage, sourceIds);
    if (!reading.ok) return reading;
    const { collected } = reading;

    const kinds: Array<[RecordKind, EpcisStoredRecord[]]> = [['import', collected.imports], ['observation', collected.observations], ['resolution', collected.resolutions], ['pull', collected.pulls], ['pull-page', collected.pages]];
    for (const [kind, list] of kinds) {
      for (const held of list) {
        const problem = recordProblem(kind, held.value);
        if (problem != null) return refuse('record-version-unknown', `The store holds a ${kind} record this module does not read: ${problem.detail}. It is not exported as if it were understood.`);
        const invalid = structuralProblem(kind, held.value);
        if (invalid) return refuse('store-inconsistent', invalid, { breaches: [`${kind} ${held.key}: ${invalid}`] });
        if (keyOf(kind, held.value) !== held.key) return refuse('store-inconsistent', `The store holds a ${kind} record that is not filed where its own content says.`, { breaches: [`${kind} ${held.key}: filed under a key that is not its own`] });
      }
    }

    // What is carried is the portable form of each record. It is that form that is checked, so the snapshot is held to the invariants exactly as it leaves.
    const snapshot = emptySnapshot();
    for (const [sha256, bytes] of reading.originals) snapshot.originals.set(sha256, bytes);
    let cursorsRemoved = 0;
    const cursorOf = new Map<string, EpcisRecoveryCursorState>();
    for (const held of collected.imports) { const portable = portableImport(held.value as unknown as EpcisImportRecord, cursors); cursorsRemoved += portable.removed; snapshot.imports.set(held.key, portable.value); }
    for (const held of collected.observations) snapshot.observations.set(held.key, held.value as unknown as EpcisObservationRecord);
    for (const held of collected.resolutions) snapshot.resolutions.set(held.key, held.value as unknown as EpcisResolutionRecord);
    for (const held of collected.pulls) { const portable = portablePull(held.value as unknown as EpcisPullRecord, cursors); cursorsRemoved += portable.removed; cursorOf.set(held.key, portable.cursor as EpcisRecoveryCursorState); snapshot.pulls.set(held.key, portable.value); }
    for (const held of collected.pages) { const portable = portablePage(held.value as unknown as EpcisPullPageRecord, cursors); cursorsRemoved += portable.removed; snapshot.pages.set(held.key, portable.value); }

    const omitted = omission(snapshot);
    if (omitted != null) return refuse('store-inconsistent', `The store itself is not consistent, so no snapshot of it is recoverable: ${omitted.detail}`, { breaches: [omitted.detail] });
    const breaches = await breachesOf(snapshot);
    if (breaches.length > 0) return refuse('store-inconsistent', 'The snapshot does not satisfy the invariants of the exchange, so it is not handed over.', { breaches });

    const sources = new Set<string>();
    for (const record of snapshot.imports.values()) sources.add(record.sourceId);
    for (const record of snapshot.pulls.values()) sources.add(record.sourceId);
    const scopes: EpcisRecoveryScope[] = [...sources].sort().map((sourceId) => ({
      sourceId,
      originals: new Set([...snapshot.imports.values()].filter((record) => record.sourceId === sourceId).map((record) => record.sha256)).size,
      imports: [...snapshot.imports.values()].filter((record) => record.sourceId === sourceId).length,
      observations: [...snapshot.observations.values()].filter((record) => record.sourceId === sourceId).length,
      resolutions: [...snapshot.resolutions.values()].filter((record) => record.sourceId === sourceId).length,
      pulls: [...snapshot.pulls].filter(([, record]) => record.sourceId === sourceId).map(([key, record]) => ({ pullId: record.pullId, queryId: record.queryId, definitionDigest: record.definitionDigest, baseUrl: record.source.baseUrl, status: record.status, pagesAcknowledged: record.pagesAcknowledged, cursor: cursorOf.get(key) as EpcisRecoveryCursorState })),
    }));
    const left: EpcisRecoveryOmission[] = [
      { what: 'associations-index', reason: 'derived' },
      { what: 'retention-entries', reason: 'derived' },
      { what: 'journal', reason: 'empty-at-boundary' },
      { what: 'restore-history', reason: 'never-carried' },
      { what: 'credentials', reason: 'never-carried' },
      ...(cursorsRemoved > 0 || cursors === 'excluded' ? [{ what: 'cursors' as const, reason: 'excluded' as const, count: cursorsRemoved }] : []),
      ...(reading.selection === 'listed-scopes' ? [{ what: 'other-scopes' as const, reason: 'not-selected' as const }] : []),
    ];
    const mediaTypeOf = new Map<string, string>();
    for (const record of snapshot.imports.values()) { const held = mediaTypeOf.get(record.sha256); if (held == null || record.mediaType < held) mediaTypeOf.set(record.sha256, record.mediaType); }
    const records: Assembly['records'] = [];
    for (const [key, value] of snapshot.imports) records.push({ kind: 'import', key, value: toValue(value) });
    for (const [key, value] of snapshot.observations) records.push({ kind: 'observation', key, value: toValue(value) });
    for (const [key, value] of snapshot.resolutions) records.push({ kind: 'resolution', key, value: toValue(value) });
    for (const [key, value] of snapshot.pulls) records.push({ kind: 'pull', key, value: toValue(value) });
    for (const [key, value] of snapshot.pages) records.push({ kind: 'pull-page', key, value: toValue(value) });
    const exported = assemble(root, clock(), {
      access: 'authorised-recovery',
      selection: reading.selection,
      cursors,
      scopes,
      omitted: left,
      originals: [...snapshot.originals].map(([sha256, bytes]) => ({ sha256, bytes, mediaType: mediaTypeOf.get(sha256) as string })),
      records,
    });
    const carrier = credentialCarrier(exported, guards);
    if (carrier != null) return refuse('credential-in-snapshot', `The file ${carrier} carries a credential this deployment was configured with. Nothing is handed over. Find how the credential reached a retained source or a record, and leave that source out or rotate the credential.`, { path: carrier });
    return exported;
  });
}

export interface ExportEpcisPublicEvidenceInput {
  storage: EpcisExchangeStorage;
  /**
   * The access policy: whether a public package may carry this import. It is
   * asked once for every import in scope, and there is no default, because
   * nothing here knows which sources a deployment may publish.
   */
  allow: (record: EpcisImportRecord) => boolean;
  /** The source scopes to read. Default: every scope the store holds. */
  sourceIds?: readonly string[];
  /** As for `exportEpcisRecovery`: every exported byte is searched for each credential named. */
  credentials?: readonly EpcisSourceCredential[];
  root?: string;
  now?: () => string;
}

/**
 * Export what a public evidence package may carry of an exchange: the
 * retained originals the access policy allows, each with its import record
 * as a public reader may see it.
 *
 * A public form never carries where a source was read from or how: an import
 * record's `sourceLocation` is reduced to its kind, so no endpoint, file
 * name, query or page token leaves. It carries no observation, no conflict
 * decision and no pull state, and so it cannot be restored: its descriptor
 * says `public-evidence`, claims no completeness, and `restoreEpcisRecovery`
 * refuses it by name.
 */
export function exportEpcisPublicEvidence(input: ExportEpcisPublicEvidenceInput): Promise<ExportedEpcisRecovery | EpcisRecoveryExportRefusal> {
  if (input == null || typeof input !== 'object' || input.storage == null || typeof input.storage.commit !== 'function') throw new TypeError('an export is handed the storage it reads');
  if (typeof input.allow !== 'function') throw new TypeError('allow is the access policy: a function that says whether a public package may carry an import');
  const root = rootOf(input.root);
  const sourceIds = checkedSourceIds(input.sourceIds);
  const guards = guardsOf(input.credentials);
  const clock = input.now ?? systemClock;
  const { storage } = input;
  const refuse = (code: EpcisRecoveryExportRefusalCode, detail: string, extra: Partial<EpcisRecoveryExportRefusal> = {}): EpcisRecoveryExportRefusal => ({ ok: false, code, detail, ...extra });
  return inTurn(storage, async (): Promise<ExportedEpcisRecovery | EpcisRecoveryExportRefusal> => {
    const reading = await readAtBoundary(storage, sourceIds);
    if (!reading.ok) return reading;
    const records: Assembly['records'] = [];
    const originals = new Map<string, { sha256: string; bytes: Uint8Array; mediaType: string }>();
    const scopes = new Map<string, EpcisRecoveryScope>();
    let withheld = 0;
    for (const held of reading.collected.imports) {
      const record = held.value as unknown as EpcisImportRecord;
      const problem = recordProblem('import', held.value);
      if (problem != null) return refuse('record-version-unknown', `The store holds an import record this module does not read: ${problem.detail}. It is not exported as if it were understood.`);
      // An import that is not yet evaluated has no results to show, and is not offered to the policy.
      if (record.state === 'received' || input.allow(structuredClone(record)) !== true) { withheld += 1; continue; }
      const bytes = reading.originals.get(record.sha256) as Uint8Array;
      const before = originals.get(record.sha256);
      if (before == null || record.mediaType < before.mediaType) originals.set(record.sha256, { sha256: record.sha256, bytes, mediaType: record.mediaType });
      const visible: EpcisImportRecord = { ...record, sourceLocation: { kind: record.sourceLocation.kind } as EpcisImportRecord['sourceLocation'] };
      records.push({ kind: 'public-import', key: held.key, value: toValue(visible) });
      const scope = scopes.get(record.sourceId) ?? { sourceId: record.sourceId, originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: [] };
      scope.imports += 1;
      scopes.set(record.sourceId, scope);
    }
    if (records.length === 0) return refuse('nothing-public', 'The access policy allowed no import, so there is nothing a public package may carry.');
    for (const scope of scopes.values()) scope.originals = new Set(records.filter((record) => record.value.sourceId === scope.sourceId).map((record) => record.value.sha256)).size;
    const exported = assemble(root, clock(), {
      access: 'public-evidence',
      selection: reading.selection,
      cursors: 'excluded',
      scopes: [...scopes.values()].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1)),
      omitted: [
        { what: 'operational-records', reason: 'not-public' },
        { what: 'provenance', reason: 'not-public' },
        { what: 'cursors', reason: 'not-public' },
        { what: 'credentials', reason: 'never-carried' },
        { what: 'associations-index', reason: 'derived' },
        ...(withheld > 0 ? [{ what: 'other-scopes' as const, reason: 'not-selected' as const, count: withheld }] : []),
      ],
      originals: [...originals.values()],
      records,
    });
    const carrier = credentialCarrier(exported, guards);
    if (carrier != null) return refuse('credential-in-snapshot', `The file ${carrier} carries a credential this deployment was configured with. Nothing is handed over.`, { path: carrier });
    return exported;
  });
}

/* --------------------------------- reading files ------------------------- */

/** Where a snapshot is read from: the bytes of one file by its path in the package, or `undefined` when the file is not there. */
export type EpcisRecoverySource = (path: string) => MaybePromise<Uint8Array | undefined>;

/** A snapshot held in memory, as the files of a package by path. Bytes may be a `Uint8Array` or the array of numbers the protocol package uses for package files. */
export function epcisRecoveryFiles(files: ReadonlyMap<string, Uint8Array | readonly number[]>): EpcisRecoverySource {
  return (path) => {
    const bytes = files.get(path);
    return bytes == null ? undefined : Uint8Array.from(bytes);
  };
}

/** A snapshot on disk: the folder a package was unpacked into. Nothing is read until a file is asked for, and a path that would leave the folder is never opened. */
export function epcisRecoveryDirectory(directory: string): EpcisRecoverySource {
  if (typeof directory !== 'string' || directory.length === 0) throw new TypeError('directory must be the path of a folder');
  const base = resolve(directory);
  return (path) => {
    if (!isPath(path)) return undefined;
    const target = resolve(base, ...path.split('/'));
    const inside = relative(base, target);
    if (inside === '' || inside.startsWith('..') || inside.split(sep).includes('..')) return undefined;
    try {
      return new Uint8Array(readFileSync(target));
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
      throw cause;
    }
  };
}

export type EpcisRecoveryRefusalCode =
  /** The folder holds no descriptor, so it is not a snapshot that can be read. */
  | 'descriptor-missing'
  /** The descriptor is not JSON, does not have the format's structure, or contradicts itself. */
  | 'descriptor-invalid'
  /** The descriptor says `public-evidence`. A public form carries no operational record and restores nothing. */
  | 'not-a-recovery-snapshot'
  /** The descriptor and the inventory of the package disagree: a file one names and the other does not, or names with another length, digest or category. */
  | 'descriptor-inventory-mismatch'
  /** An original the descriptor names is not in the package. */
  | 'original-missing'
  /** An original is not the bytes the descriptor names: its length or its SHA-256 differs. */
  | 'original-altered'
  /** A record the descriptor names is not in the package. */
  | 'record-missing'
  /** A record is not the bytes the descriptor names, or is not in the one spelling an export writes. */
  | 'record-altered'
  /** A record is of a version this module does not read. It is never restored as if it were understood. */
  | 'record-version-unknown'
  /** A record is filed as another kind, or under another name, than its own content gives. */
  | 'record-misfiled'
  /** A pull's checkpoint stands on an import or a page record the snapshot does not hold. */
  | 'checkpoint-imports-omitted'
  /** A conflict decision names an observation the snapshot does not hold. */
  | 'resolution-observations-omitted'
  /** The snapshot breaks an invariant of the exchange when taken by itself. `breaches` lists them. */
  | 'snapshot-inconsistent'
  /** The mapping from the snapshot's byte references to the destination's is not one to one, or gives a reference that cannot be recorded. */
  | 'relocation-invalid'
  /** The destination has unfinished work journalled, or another restore pending. Finish it first. */
  | 'destination-unfinished-work'
  /** The destination holds a record that differs from the snapshot's under the same identity. Nothing was written; `collisions` lists them. */
  | 'reconciliation-required'
  /** An original was put in the destination and did not read back as the bytes of its digest. */
  | 'destination-original-unverified'
  /** After the restore the destination breaks an invariant of the exchange. The restore is left unfinished; `breaches` lists them. */
  | 'destination-inconsistent';

/** One destination record a restore would not overwrite. */
export interface EpcisRestoreCollision {
  kind: 'import' | 'observation' | 'resolution' | 'pull' | 'pull-page' | 'relocation';
  /** The identity of the record, as its own content gives it. */
  identity: string;
  /** `request-bound-to-other-bytes`: the destination holds another import under the same source scope and request identifier. `record-differs`: the two records share an identity and differ in content. */
  reason: 'request-bound-to-other-bytes' | 'record-differs';
  sourceId?: string;
}

export interface EpcisRecoveryRefusal {
  ok: false;
  code: EpcisRecoveryRefusalCode;
  /** One or more sentences for a person. */
  detail: string;
  /** The file, by its path in the package, where the refusal is about one file. */
  path?: string;
  breaches?: string[];
  collisions?: EpcisRestoreCollision[];
}

/** A snapshot that was read and checked against its descriptor, its inventory and the invariants of the exchange. Nothing has been written anywhere. */
export interface VerifiedEpcisRecovery {
  ok: true;
  root: string;
  descriptor: EpcisRecoveryDescriptor;
  /** The SHA-256 of the descriptor file as it was read. */
  descriptorSha256: string;
  counts: EpcisRestoreCounts;
}

export interface VerifyEpcisRecoveryOptions {
  /**
   * The inventory of the package that carries the snapshot: the entries of
   * its signed manifest, as the caller verified it. Entries outside the
   * snapshot's folder are ignored. The snapshot is held to it as well as to
   * its own descriptor, so a file the manifest does not vouch for is never
   * restored.
   */
  inventory: ReadonlyArray<{ path: string; category?: string; byteLength: number; sha256: string }>;
  /** The folder the snapshot sits in, inside the package. Default `epcis`. */
  root?: string;
}

interface Opened extends VerifiedEpcisRecovery {
  snapshot: Snapshot;
}

async function open(source: EpcisRecoverySource, options: VerifyEpcisRecoveryOptions): Promise<Opened | EpcisRecoveryRefusal> {
  const root = rootOf(options?.root);
  if (typeof source !== 'function') throw new TypeError('source reads a file of the package by its path; see epcisRecoveryFiles and epcisRecoveryDirectory');
  if (!Array.isArray(options?.inventory)) throw new TypeError('inventory is the inventory of the package that carries the snapshot');
  const refuse = (code: EpcisRecoveryRefusalCode, detail: string, extra: Partial<EpcisRecoveryRefusal> = {}): EpcisRecoveryRefusal => ({ ok: false, code, detail, ...extra });
  const read = async (path: string): Promise<Uint8Array | undefined> => {
    const bytes = await source(path);
    return bytes instanceof Uint8Array ? bytes : undefined;
  };

  const at = `${root}/${EPCIS_RECOVERY_DESCRIPTOR}`;
  let descriptorBytes: Uint8Array | undefined;
  try { descriptorBytes = await read(at); } catch (cause) { return refuse('descriptor-missing', `The descriptor ${at} could not be read: ${reasonOf(cause)}.`, { path: at }); }
  if (descriptorBytes == null) return refuse('descriptor-missing', `There is no descriptor at ${at}, so there is no snapshot to read.`, { path: at });
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptorBytes)); } catch { return refuse('descriptor-invalid', `The descriptor ${at} is not UTF-8 JSON.`, { path: at }); }
  const problems = epcisRecoveryProblems(parsed);
  if (problems.length > 0) return refuse('descriptor-invalid', `The descriptor ${at} is not a format ${EPCIS_RECOVERY_VERSION} descriptor: ${problems.join(' ')}`, { path: at });
  const descriptor = parsed as EpcisRecoveryDescriptor;
  const inconsistencies = epcisRecoveryInconsistencies(descriptor);
  if (inconsistencies.length > 0) return refuse('descriptor-invalid', `The descriptor ${at} contradicts itself: ${inconsistencies.join(' ')}`, { path: at });
  if (descriptor.access !== 'authorised-recovery') return refuse('not-a-recovery-snapshot', `The descriptor ${at} describes public evidence. A public form carries no observation, decision or pull state and no provenance, so nothing can be restored from it. Ask the exporting operator for a recovery snapshot.`, { path: at });

  // The descriptor against the package's own inventory, both ways, before a single file is trusted.
  const descriptorSha256 = sha256Hex(descriptorBytes);
  const listed = new Map<string, { category?: string; byteLength: number; sha256: string }>();
  const mismatch = (path: string, detail: string): EpcisRecoveryRefusal => refuse('descriptor-inventory-mismatch', detail, { path });
  for (const entry of options.inventory) {
    if (!isObject(entry) || typeof entry.path !== 'string' || !entry.path.startsWith(`${root}/`)) continue;
    // Two entries for one path leave it open which bytes the package vouches for.
    if (listed.has(entry.path)) return mismatch(entry.path, `The inventory lists ${entry.path} twice, so it does not say which bytes the package vouches for.`);
    listed.set(entry.path, entry as { category?: string; byteLength: number; sha256: string });
  }
  const own = listed.get(at);
  if (own == null) return mismatch(at, `The inventory does not list the descriptor ${at}, so the package does not vouch for it.`);
  if (own.sha256 !== descriptorSha256 || own.byteLength !== descriptorBytes.byteLength) return mismatch(at, `The descriptor ${at} is not the file the inventory lists: its length or its SHA-256 differs.`);
  for (const entry of descriptor.inventory) {
    const path = `${root}/${entry.path}`;
    const held = listed.get(path);
    if (held == null) return mismatch(path, `The descriptor names ${path} and the inventory does not list it.`);
    if (held.sha256 !== entry.sha256 || held.byteLength !== entry.byteLength) return mismatch(path, `The descriptor and the inventory name different bytes for ${path}.`);
    const category = entry.kind === 'original' ? EPCIS_RECOVERY_CATEGORIES.original : EPCIS_RECOVERY_CATEGORIES.record;
    if (held.category !== undefined && held.category !== category) return mismatch(path, `The inventory lists ${path} under ${String(held.category)}, and a file of kind ${entry.kind} belongs under ${category}.`);
  }
  const named = new Set(descriptor.inventory.map((entry) => `${root}/${entry.path}`));
  for (const path of listed.keys()) if (path !== at && !named.has(path)) return mismatch(path, `The inventory lists ${path} in the snapshot's folder and the descriptor does not name it, so the snapshot is not the one its descriptor describes.`);

  // Every file against the length and digest the descriptor names, then every record against its own content.
  const snapshot = emptySnapshot();
  for (const entry of descriptor.inventory) {
    const path = `${root}/${entry.path}`;
    const original = entry.kind === 'original';
    let bytes: Uint8Array | undefined;
    try { bytes = await read(path); } catch (cause) { return refuse(original ? 'original-missing' : 'record-missing', `The file ${path} could not be read: ${reasonOf(cause)}.`, { path }); }
    if (bytes == null) return refuse(original ? 'original-missing' : 'record-missing', `The snapshot names ${path} and does not hold it. ${original ? 'An original that is missing cannot be recovered from its digest.' : 'A record that is missing cannot be rebuilt from the originals.'}`, { path });
    if (bytes.byteLength !== entry.byteLength || sha256Hex(bytes) !== entry.sha256) return refuse(original ? 'original-altered' : 'record-altered', `The file ${path} is not the bytes the descriptor names: its length or its SHA-256 differs.`, { path });
    if (original) { snapshot.originals.set(entry.sha256, bytes); continue; }
    const kind = entry.kind as RecordKind;
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return refuse('record-altered', `The record ${path} is not UTF-8 JSON.`, { path }); }
    let canonical: Uint8Array | undefined;
    try { canonical = isObject(value) ? canonicalJcsBytes(value) : undefined; } catch { canonical = undefined; }
    // One record has one spelling. A file that says the same in other bytes was not written by an export, and is not read as if it had been.
    if (canonical == null || canonical.byteLength !== bytes.byteLength || !canonical.every((byte, index) => byte === bytes[index])) return refuse('record-altered', `The record ${path} is not in the canonical form an export writes.`, { path });
    const record = value as Json;
    const unread = recordProblem(kind, record);
    if (unread != null) return refuse(unread.code, `The record ${path} is not one this module reads as a ${kind} record: ${unread.detail}. It is not restored as if it were understood.`, { path });
    const invalid = structuralProblem(kind, record);
    if (invalid) return refuse('snapshot-inconsistent', invalid, { path, breaches: [invalid] });
    const key = keyOf(kind, record);
    if (key == null || entry.path !== pathOf(kind, key)) return refuse('record-misfiled', `The record ${path} is not filed where its own content says a ${kind} record of that identity sits.`, { path });
    if (kind === 'import') snapshot.imports.set(key, record as unknown as EpcisImportRecord);
    else if (kind === 'observation') snapshot.observations.set(key, record as unknown as EpcisObservationRecord);
    else if (kind === 'resolution') snapshot.resolutions.set(key, record as unknown as EpcisResolutionRecord);
    else if (kind === 'pull') snapshot.pulls.set(key, record as unknown as EpcisPullRecord);
    else snapshot.pages.set(key, record as unknown as EpcisPullPageRecord);
  }

  for (const record of snapshot.imports.values()) {
    const held = snapshot.originals.get(record.sha256);
    if (held == null || held.byteLength !== record.byteLength) return refuse('original-missing', `The import ${record.importId} retains the bytes sha256:${String(record.sha256)}, and the snapshot does not carry them.`, { path: `${root}/${pathOf('original', String(record.sha256))}` });
  }
  const omitted = omission(snapshot);
  if (omitted != null) return refuse(omitted.code, omitted.detail);
  const covered = new Set(descriptor.scopes.map((scope) => scope.sourceId));
  const outside = [...snapshot.imports.values(), ...snapshot.observations.values(), ...snapshot.resolutions.values(), ...snapshot.pulls.values(), ...snapshot.pages.values()].find((record) => !covered.has(record.sourceId));
  if (outside != null) return refuse('snapshot-inconsistent', `The snapshot carries a record of the source scope ${JSON.stringify(outside.sourceId)}, which its descriptor does not cover.`, { breaches: [`a record of ${JSON.stringify(outside.sourceId)} is outside the covered scopes`] });
  // What the descriptor says each scope holds is what the records of that scope are, so a scope cannot be said to be covered and carried in part.
  for (const scope of descriptor.scopes) {
    const of = <T extends { sourceId: string }>(records: Map<string, T>): T[] => [...records.values()].filter((record) => record.sourceId === scope.sourceId);
    const pulls = of(snapshot.pulls);
    const imports = of(snapshot.imports);
    const accounted = imports.length === scope.imports && new Set(imports.map(record => record.sha256)).size === scope.originals
      && of(snapshot.observations).length === scope.observations && of(snapshot.resolutions).length === scope.resolutions && pulls.length === scope.pulls.length
      && scope.pulls.every((said) => pulls.some((record) => record.pullId === said.pullId && record.queryId === said.queryId && record.definitionDigest === said.definitionDigest && record.source?.baseUrl === said.baseUrl && record.status === said.status && record.pagesAcknowledged === said.pagesAcknowledged));
    if (!accounted) return refuse('snapshot-inconsistent', `The descriptor's account of the source scope ${JSON.stringify(scope.sourceId)} is not what the snapshot's records of that scope are.`, { breaches: [`scope ${JSON.stringify(scope.sourceId)}: the descriptor and the records disagree`] });
  }
  const claims = cursorClaimProblems(descriptor, snapshot);
  if (claims.length > 0) return refuse('snapshot-inconsistent', `The snapshot's records do not carry what its descriptor says of cursors: ${claims.slice(0, 5).join('; ')}${claims.length > 5 ? `; and ${claims.length - 5} more` : ''}.`, { breaches: claims });
  const breaches = await breachesOf(snapshot);
  if (breaches.length > 0) return refuse('snapshot-inconsistent', `The snapshot does not satisfy the invariants of the exchange when taken by itself: ${breaches.slice(0, 5).join('; ')}${breaches.length > 5 ? `; and ${breaches.length - 5} more` : ''}.`, { breaches });

  return {
    ok: true,
    root,
    descriptor,
    descriptorSha256,
    counts: { originals: snapshot.originals.size, imports: snapshot.imports.size, observations: snapshot.observations.size, resolutions: snapshot.resolutions.size, pulls: snapshot.pulls.size, pullPages: snapshot.pages.size },
    snapshot,
  };
}

/**
 * Read a recovery snapshot and check it, without a destination: the
 * descriptor against the package's inventory, every file against its length
 * and digest, every record against its version and the place its own content
 * gives it, and the whole against the invariants of the exchange. A refusal
 * is returned, never thrown. `restoreEpcisRecovery` makes exactly these
 * checks before it writes anything.
 */
export async function verifyEpcisRecovery(source: EpcisRecoverySource, options: VerifyEpcisRecoveryOptions): Promise<VerifiedEpcisRecovery | EpcisRecoveryRefusal> {
  const opened = await open(source, options);
  if (!opened.ok) return opened;
  const { snapshot: _snapshot, ...verified } = opened;
  return verified;
}

/* ---------------------------------- restore ------------------------------ */

/** One original a restore placed: the reference the snapshot's records carry for it, the file that carried it, and the reference the restored records carry. */
export interface EpcisRelocation {
  sha256: string;
  byteLength: number;
  exportedRef: string;
  /** The file's path in the package. */
  path: string;
  destinationRef: string;
}

export interface RestoreEpcisRecoveryInput extends VerifyEpcisRecoveryOptions {
  /** The destination. Any adapter that passes the shared suite, and not the adapter the snapshot was taken from unless that is what the operator wants. */
  storage: EpcisExchangeStorage;
  source: EpcisRecoverySource;
  /**
   * How the destination names where it keeps an original: the `bytesRef` a
   * restored import record carries. Default: the content address,
   * `sha256:<hex>`, which is what an import into the destination writes.
   * Each original has one reference and no two share one.
   */
  locate?: (original: { sha256: string; byteLength: number; exportedRef: string }) => string;
  /** The clock for the times the restore records. The system clock by default. */
  now?: () => string;
}

export interface RestoredEpcisRecovery {
  ok: true;
  /** `restored`: the snapshot was written. `resumed`: an earlier restore of it had stopped, and this call finished it. `unchanged`: the destination already held the whole snapshot and its restore record, so nothing was written. */
  outcome: 'restored' | 'resumed' | 'unchanged';
  snapshotId: string;
  /** Every source scope the snapshot covered. */
  sourceIds: string[];
  /** How many records of each kind this call wrote, and how many it found already equal. */
  written: EpcisRestoreCounts;
  unchanged: EpcisRestoreCounts;
  /** Where each original went. The same is recorded durably, one relocation record per original. */
  relocations: EpcisRelocation[];
  /** What the index rebuild did. Absent when nothing was written. */
  associations?: EpcisRebuildReport;
  /** The record of the restore, as the destination holds it. */
  restore: EpcisRestoreRecord;
}

interface Planned {
  kind: string;
  key: string;
  value: JsonObject;
  collision: EpcisRestoreCollision;
  counted: keyof EpcisRestoreCounts | undefined;
}

const noCounts = (): EpcisRestoreCounts => ({ originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: 0, pullPages: 0 });

/**
 * Restore a recovery snapshot into a store.
 *
 * In order: the snapshot is read and checked as `verifyEpcisRecovery` checks
 * it; the destination is compared with it, record by record; and only then
 * is anything written. A refusal is returned, never thrown, and a refusal
 * before the comparison ends has written nothing.
 *
 * The durable steps, in order:
 *
 *   1. journal `restore`     the store says a restore is unfinished
 *   2. the originals         each put, read back and held to its digest,
 *                            then its relocation record
 *   3. the imports           each with its retention entry and the
 *                            observations it made, in one batch
 *   4. the decisions
 *   5. the pages, then the pulls, so no checkpoint precedes its pages
 *   6. the associations      rebuilt from what is now held
 *   7. the restore record    written as the journal entry is cleared
 *
 * Every write names a record by the key its own content gives and expects
 * the place to be free, so a restore stopped at any step is run again with
 * the same snapshot and finishes: what is already there and equal is left.
 * Until step 7 the store says it is unfinished, an export of it is refused,
 * and `recoverEpcisExchange` reports the restore as pending.
 *
 * A restore runs alone on its destination: begin accepting imports and
 * pulls when it has answered.
 *
 * Credentials are not restored, because none are carried. The operator
 * configures them at the destination before a pull is run.
 */
export async function restoreEpcisRecovery(input: RestoreEpcisRecoveryInput): Promise<RestoredEpcisRecovery | EpcisRecoveryRefusal> {
  if (input == null || typeof input !== 'object' || input.storage == null || typeof input.storage.commit !== 'function') throw new TypeError('a restore is handed the storage it writes to');
  if (input.locate !== undefined && typeof input.locate !== 'function') throw new TypeError('locate is a function from an original to the reference the destination keeps it under');
  const { storage } = input;
  const clock = input.now ?? systemClock;
  const refuse = (code: EpcisRecoveryRefusalCode, detail: string, extra: Partial<EpcisRecoveryRefusal> = {}): EpcisRecoveryRefusal => ({ ok: false, code, detail, ...extra });

  const opened = await open(input.source, input);
  if (!opened.ok) return opened;
  const { snapshot, descriptor, root } = opened;
  const { snapshotId } = descriptor.snapshot;

  /* ---- the relocation: one checked reference per original, each way ---- */

  const exportedRefOf = new Map<string, string>();
  const digestOfRef = new Map<string, string>();
  for (const record of snapshot.imports.values()) {
    const before = exportedRefOf.get(record.sha256);
    const other = digestOfRef.get(record.bytesRef);
    if ((before != null && before !== record.bytesRef) || (other != null && other !== record.sha256)) return refuse('relocation-invalid', `The snapshot's import records do not name their bytes one to one: ${JSON.stringify(record.bytesRef)} and sha256:${record.sha256} are each paired with another.`);
    exportedRefOf.set(record.sha256, record.bytesRef);
    digestOfRef.set(record.bytesRef, record.sha256);
  }
  const relocations: EpcisRelocation[] = [];
  const destinationRefOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const sha256 of [...snapshot.originals.keys()].sort()) {
    const original = { sha256, byteLength: (snapshot.originals.get(sha256) as Uint8Array).byteLength, exportedRef: exportedRefOf.get(sha256) as string };
    let destinationRef: unknown;
    try { destinationRef = input.locate == null ? `sha256:${sha256}` : input.locate({ ...original }); } catch (cause) { return refuse('relocation-invalid', `The destination could not say where it keeps sha256:${sha256}: ${reasonOf(cause)}.`); }
    if (typeof destinationRef !== 'string' || destinationRef.length < 1 || destinationRef.length > 2048 || CONTROL.test(destinationRef)) return refuse('relocation-invalid', `The reference the destination gave for sha256:${sha256} is not text of 1 to 2048 characters without control characters.`);
    if (taken.has(destinationRef)) return refuse('relocation-invalid', `The destination gave the reference ${JSON.stringify(destinationRef)} to two originals. Each original has its own.`);
    taken.add(destinationRef);
    destinationRefOf.set(sha256, destinationRef);
    relocations.push({ ...original, path: `${root}/${pathOf('original', sha256)}`, destinationRef });
  }

  /* ---- the plan: every record under the key its own content gives ---- */

  const planned: Planned[] = [];
  const plan = (kind: string, key: string, value: object, collision: EpcisRestoreCollision, counted?: keyof EpcisRestoreCounts): Planned => {
    const entry: Planned = { kind, key, value: toValue(value), collision, counted };
    planned.push(entry);
    return entry;
  };
  const relocationPlans = relocations.map((relocation) => {
    const record: EpcisRelocationRecord = { recordType: 'epcis-relocation', recordVersion: EPCIS_RECORD_VERSION, snapshotId, sha256: relocation.sha256, byteLength: relocation.byteLength, exportedRef: relocation.exportedRef, path: relocation.path.slice(root.length + 1), destinationRef: relocation.destinationRef };
    return plan(K.relocation, relocationKey(snapshotId, relocation.sha256), record, { kind: 'relocation', identity: `sha256:${relocation.sha256}`, reason: 'record-differs' });
  });
  const observationsOf = new Map<string, Planned[]>();
  for (const [key, record] of snapshot.observations) {
    const entry = plan(K.observation, key, record, { kind: 'observation', identity: representsOf('observation', record as unknown as Json), reason: 'record-differs', sourceId: record.sourceId }, 'observations');
    observationsOf.set(record.importId, [...(observationsOf.get(record.importId) ?? []), entry]);
  }
  const importPlans = [...snapshot.imports].map(([key, record]) => {
    // The one member of an import record that says where a store keeps things. Everything that says what was received, when and under which request is carried as it is.
    const relocated: EpcisImportRecord = { ...record, bytesRef: destinationRefOf.get(record.sha256) as string };
    return { key, record: relocated, entry: plan(K.import, key, relocated, { kind: 'import', identity: record.importId, reason: 'record-differs', sourceId: record.sourceId }, 'imports') };
  });
  const resolutionPlans = [...snapshot.resolutions].map(([key, record]) => plan(K.resolution, key, record, { kind: 'resolution', identity: record.resolutionId, reason: 'record-differs', sourceId: record.sourceId }, 'resolutions'));
  const pagePlans = [...snapshot.pages].map(([key, record]) => plan(K.pullPage, key, record, { kind: 'pull-page', identity: representsOf('pull-page', record as unknown as Json), reason: 'record-differs', sourceId: record.sourceId }, 'pullPages'));
  const pullPlans = [...snapshot.pulls].map(([key, record]) => plan(K.pull, key, record, { kind: 'pull', identity: record.pullId, reason: 'record-differs', sourceId: record.sourceId }, 'pulls'));

  const journalKey = restoreJournalKey(snapshotId);
  const written = noCounts();
  const unchanged = noCounts();

  type First =
    | EpcisRecoveryRefusal
    | { ok: true; unchanged: true; restore: EpcisRestoreRecord }
    | { ok: true; unchanged: false; resumed: boolean; startedAt: string };

  const first = await inTurn(storage, async (): Promise<First> => {
    /* ---- the destination, before anything is written ---- */

    const journal = await listAll(storage, K.journal);
    const own = journal.find((held) => held.key === journalKey);
    // An index rebuild this restore began is finished by the rebuild below. Any other unfinished work is not this restore's to finish.
    const foreign = journal.filter((held) => held.key !== journalKey && !(own != null && held.key === REBUILD_JOURNAL_KEY));
    if (foreign.length > 0) return refuse('destination-unfinished-work', `The destination has unfinished work journalled (${foreign.map((held) => held.key).join(', ')}). Run recoverEpcisExchange on it, or finish the restore that is pending, and restore again.`, { breaches: foreign.map((held) => `${held.key}: unfinished ${(held.value as unknown as EpcisJournalRecord).entry}`) });

    const collisions: EpcisRestoreCollision[] = [];
    const absent = new Set<Planned>();
    for (const entry of planned) {
      const held = await storage.get(entry.kind, entry.key);
      if (held == null) { absent.add(entry); continue; }
      if (sameJson(held.value, entry.value)) continue;
      // Two imports under one source scope and request identifier with other bytes are the conflict an import itself would report.
      const otherBytes = entry.kind === K.import && held.value.requestDigest !== entry.value.requestDigest;
      collisions.push(otherBytes ? { ...entry.collision, reason: 'request-bound-to-other-bytes' } : entry.collision);
    }
    if (collisions.length > 0) return refuse('reconciliation-required', `The destination already holds ${collisions.length} ${collisions.length === 1 ? 'record that differs' : 'records that differ'} from the snapshot's under the same identity. Nothing was written and nothing is overwritten: restore into an empty store, or reconcile each one by hand.`, { collisions });

    const finished = await storage.get(K.restore, snapshotId);
    if (finished != null) {
      const receipt = finished.value;
      const invalid = structuralProblem('restore', receipt);
      if (invalid || receipt.snapshotId !== snapshotId || receipt.restoreId !== epcisRestoreId(snapshotId) || !sameJson(receipt.counts, opened.counts) || !sameJson(receipt.sourceIds, descriptor.scopes.map(scope => scope.sourceId))) return refuse('destination-inconsistent', invalid ?? 'The previous restore receipt differs from the snapshot it names.');
    }
    if (own == null && finished != null && absent.size === 0) {
      for (const [sha256, bytes] of snapshot.originals) {
        const held = await storage.getBytes(sha256);
        if (held == null || held.byteLength !== bytes.byteLength || sha256Hex(held) !== sha256) return refuse('destination-original-unverified', `The destination records this snapshot as restored and does not hold the bytes sha256:${sha256} as they were exported.`);
      }
      for (const entry of planned) if (entry.counted != null) unchanged[entry.counted] += 1;
      unchanged.originals = snapshot.originals.size;
      return { ok: true, unchanged: true, restore: finished.value as unknown as EpcisRestoreRecord };
    }

    /* ---- the writes ---- */

    const commit = async (writes: EpcisStorageWrite[], what: string): Promise<void> => {
      if (writes.length === 0) return;
      const result = await storage.commit(writes);
      if (!result.committed) throw new EpcisExchangeError('storage-contention', `${what} could not be written: ${result.failed.kind}/${result.failed.key} was expected at ${String(result.failed.expected)} and is at ${String(result.failed.found)}. Another writer is at work on the destination; a restore runs alone`);
    };
    const put = (entry: Planned): EpcisStorageWrite[] => {
      const fresh = absent.has(entry);
      if (entry.counted != null) (fresh ? written : unchanged)[entry.counted] += 1;
      return fresh ? [{ op: 'put', kind: entry.kind, key: entry.key, value: entry.value, expect: 'absent' }] : [];
    };
    const inBatches = async (entries: Planned[], what: string): Promise<void> => {
      for (let start = 0; start < entries.length; start += RESTORE_BATCH) await commit(entries.slice(start, start + RESTORE_BATCH).flatMap(put), what);
    };

    // Step 1.
    const startedAt = own == null ? clock() : String((own.value as unknown as { startedAt?: unknown }).startedAt);
    if (own == null) await commit([{ op: 'put', kind: K.journal, key: journalKey, value: { recordType: 'epcis-journal', recordVersion: EPCIS_RECORD_VERSION, entry: 'restore', snapshotId, startedAt }, expect: 'absent' }], 'the journal');
    // Step 2. An original is counted as written when the destination did not hold it.
    for (const [sha256, bytes] of [...snapshot.originals].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const before = await storage.getBytes(sha256);
      if (before == null) await storage.putBytes(sha256, bytes);
      const held = before ?? (await storage.getBytes(sha256));
      if (held == null || held.byteLength !== bytes.byteLength || sha256Hex(held) !== sha256) return refuse('destination-original-unverified', `The bytes sha256:${sha256} were put in the destination and did not read back as the bytes of that digest. The restore is left unfinished.`);
      (before == null ? written : unchanged).originals += 1;
    }
    await inBatches(relocationPlans, 'the relocation records');
    // Step 3. An import, the entry that says it retains its bytes, and the observations it made: together or not at all.
    for (const { key, record, entry } of importPlans) {
      const retention: EpcisRetentionRecord = { recordType: 'epcis-retention', recordVersion: EPCIS_RECORD_VERSION, sha256: record.sha256, importId: record.importId };
      const retainedAt = retentionKey(record.sha256, key);
      // The retention entry is derived from the import record. One that is there and equal is left alone, as every other record is.
      const retained = await storage.get(K.retention, retainedAt);
      const retain: EpcisStorageWrite[] = retained != null && sameJson(retained.value, retention) ? [] : [{ op: 'put', kind: K.retention, key: retainedAt, value: toValue(retention) }];
      await commit([...put(entry), ...retain, ...(observationsOf.get(record.importId) ?? []).flatMap(put)], `the import ${record.importId}`);
    }
    // Step 4.
    await inBatches(resolutionPlans, 'the conflict decisions');
    // Step 5. The pull record holds the checkpoint, so it follows every page it acknowledged.
    await inBatches(pagePlans, 'the page records');
    for (const entry of pullPlans) await commit(put(entry), `the pull ${entry.collision.identity}`);
    return { ok: true, unchanged: false, resumed: own != null, startedAt };
  });
  if (!first.ok) return first;
  const sourceIds = descriptor.scopes.map((scope) => scope.sourceId);
  if (first.unchanged) return { ok: true, outcome: 'unchanged', snapshotId, sourceIds, written, unchanged, relocations, restore: first.restore };

  // Step 6. Only what is derived is rebuilt, and from what the destination now holds.
  const associations = await rebuildEpcisAssociations(storage, { now: clock });

  // Step 7.
  return inTurn(storage, async (): Promise<RestoredEpcisRecovery | EpcisRecoveryRefusal> => {
    const pending = await storage.get(K.journal, journalKey);
    const breaches = (await checkEpcisExchangeInvariants(storage, { associations: true })).filter((breach) => breach !== `journal ${journalKey}: unfinished restore`);
    if (breaches.length > 0) return refuse('destination-inconsistent', `After the restore the destination does not satisfy the invariants of the exchange: ${breaches.slice(0, 5).join('; ')}${breaches.length > 5 ? `; and ${breaches.length - 5} more` : ''}. The restore is left unfinished.`, { breaches });
    const restore: EpcisRestoreRecord = {
      recordType: 'epcis-restore',
      recordVersion: EPCIS_RECORD_VERSION,
      restoreId: epcisRestoreId(snapshotId),
      snapshotId,
      descriptorSha256: opened.descriptorSha256,
      snapshotTakenAt: descriptor.snapshot.takenAt,
      sourceIds,
      cursors: descriptor.cursors,
      counts: opened.counts,
      startedAt: first.startedAt,
      restoredAt: clock(),
    };
    const result = await storage.commit([
      { op: 'put', kind: K.restore, key: snapshotId, value: toValue(restore) },
      ...(pending == null ? [] : [{ op: 'delete' as const, kind: K.journal, key: journalKey, expect: pending.revision }]),
    ]);
    if (!result.committed) throw new EpcisExchangeError('storage-contention', 'the restore record could not be written: another writer is at work on the destination; a restore runs alone');
    return { ok: true, outcome: first.resumed ? 'resumed' : 'restored', snapshotId, sourceIds, written, unchanged, relocations, associations, restore };
  });
}

/** The restores a store records, oldest snapshot identity first. Each says which snapshot the records it holds came from. */
export async function listEpcisRestores(storage: EpcisExchangeStorage): Promise<EpcisRestoreRecord[]> {
  return (await listAll(storage, K.restore)).map((held) => held.value as unknown as EpcisRestoreRecord);
}

/** Where a restore placed each original of a snapshot: the reference it was exported under and the one this store's records carry. */
export async function listEpcisRelocations(storage: EpcisExchangeStorage, snapshotId: string): Promise<EpcisRelocationRecord[]> {
  if (typeof snapshotId !== 'string' || !SHA256.test(snapshotId)) return [];
  return (await listAll(storage, K.relocation, `${snapshotId}.`)).map((held) => held.value as unknown as EpcisRelocationRecord);
}
