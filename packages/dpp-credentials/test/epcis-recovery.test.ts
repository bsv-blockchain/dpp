/**
 * Authorised recovery of an EPCIS exchange: the snapshot, its public form and
 * the restore into another store.
 *
 * The fixture every part of this file builds on is one deployment with two
 * source scopes that share an event identifier, a conflict that was resolved
 * with both of its observations kept, and a pull of four pages that stopped
 * after its second page was retained and before its checkpoint moved. It is
 * exported from one storage adapter and restored into the other.
 *
 * Every identifier is synthetic, under the GS1 demonstration prefix 952, and
 * every server is the fixture server on 127.0.0.1.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  EPCIS_RECORD_KINDS,
  EPCIS_RECOVERY_CATEGORIES,
  EPCIS_RECOVERY_DESCRIPTOR,
  EPCIS_RECOVERY_LIMITS,
  EPCIS_RECOVERY_REPRESENTATIONS,
  EPCIS_RECOVERY_ROOT,
  EpcisStorageFault,
  checkEpcisExchangeInvariants,
  createMemoryEpcisState,
  createMemoryEpcisStorage,
  describeEpcisRecoveryOmission,
  epcisConflictId,
  epcisImportId,
  epcisPullId,
  epcisRecoveryDirectory,
  epcisRecoveryFiles,
  epcisRecoveryInconsistencies,
  epcisRecoveryProblems,
  epcisRestoreId,
  exportEpcisPublicEvidence,
  exportEpcisRecovery,
  exportEpcisSource,
  faultInjectingEpcisStorage,
  findEpcisAssociations,
  findEpcisImportByRequest,
  getEpcisConflict,
  getEpcisPull,
  importEpcisSource,
  listEpcisImports,
  listEpcisPullPages,
  listEpcisRelocations,
  listEpcisRestores,
  openFileEpcisStorage,
  pullEpcisEvents,
  recoverEpcisExchange,
  remapEpcisSourceEndpoint,
  resolveEpcisConflict,
  restoreEpcisRecovery,
  verifyEpcisRecovery,
  type EpcisExchangeStorage,
  type EpcisFetch,
  type EpcisImportRecord,
  type EpcisPullOutcome,
  type EpcisPullRecord,
  type EpcisPullResult,
  type EpcisPullSource,
  type EpcisRecoveryDescriptor,
  type EpcisRecoveryExportRefusal,
  type EpcisRecoveryInventoryEntry,
  type EpcisRecoveryRefusal,
  type EpcisSourceCredential,
  type ExportedEpcisRecovery,
  type FileEpcisStorage,
  type RestoreEpcisRecoveryInput,
  type RestoredEpcisRecovery,
} from '../src/epcis-exchange.js';
import { canonicalJcsBytes, canonicalizeJcs } from '../src/jcs.js';
import type { JsonObject } from '../src/types.js';
import { PACK, epcisDocument, fiveEventList } from './epcis-fixture.js';
import { pullEvents, startEpcisFixtureServer, type FixtureBehaviour, type FixtureServer } from './epcis-pull-server.js';

const AT = '2026-03-10T00:00:00.000Z';
const LATER = '2026-03-12T00:00:00.000Z';
/** The credential the pulled source is configured with. No exported byte may hold it, in any form. */
const SECRET = 'correct-horse-battery-staple-9f3b';
const SECRET_FORMS = [SECRET, encodeURIComponent(SECRET), Buffer.from(`operator:${SECRET}`).toString('base64'), Buffer.from(SECRET).toString('base64')];
/** A secret a source writes into the address of its next page. */
const URL_SECRET = 'sig-4c1d9e7a55b0aa31ffee';
const bearer = (): EpcisSourceCredential => ({ scheme: 'bearer', token: SECRET });
const realFetch: EpcisFetch = (url, init) => fetch(url, init);
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const bytesOf = (value: unknown): Uint8Array => utf8(JSON.stringify(value));

const repo = join(import.meta.dirname, '..', '..', '..');
const contract = (name: string): JsonObject => JSON.parse(readFileSync(join(repo, 'contracts', name), 'utf8')) as JsonObject;
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validateDescriptor = ajv.compile(contract('epcis-recovery.schema.json'));
const validateImport = ajv.compile(contract('epcis-import.schema.json'));
const validateRecord = ajv.compile(contract('epcis-exchange-records.schema.json'));
const validateManifest = ajv.compile(contract('evidence-package.schema.json'));

/* ---------------------------------- stores ------------------------------- */

type Adapter = 'memory' | 'file';

interface Store {
  adapter: Adapter;
  storage: EpcisExchangeStorage;
  /** The same durable state, opened again as a restarted process would open it. */
  reopen(): Promise<EpcisExchangeStorage>;
}

const folders: string[] = [];
const servers: FixtureServer[] = [];
const opened: FileEpcisStorage[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const storage of opened.splice(0)) storage.abandon();
});
afterAll(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });

async function newStore(adapter: Adapter): Promise<Store> {
  if (adapter === 'memory') {
    const state = createMemoryEpcisState();
    return { adapter, storage: createMemoryEpcisStorage(state), reopen: async () => createMemoryEpcisStorage(state) };
  }
  const dir = mkdtempSync(join(tmpdir(), 'dpp-epcis-recovery-'));
  folders.push(dir);
  const mine: FileEpcisStorage[] = [];
  const open = async (): Promise<FileEpcisStorage> => { const storage = await openFileEpcisStorage(dir, { fsync: false }); opened.push(storage); mine.push(storage); return storage; };
  return { adapter, storage: await open(), reopen: async () => { for (const storage of mine.splice(0)) storage.abandon(); return open(); } };
}

const other = (adapter: Adapter): Adapter => (adapter === 'memory' ? 'file' : 'memory');
/** Export from one adapter and restore into the other, both ways. */
const PAIRS: Array<[Adapter, Adapter]> = [['memory', 'file'], ['file', 'memory']];

type Held = { kind: string; key: string; value: JsonObject };

/** Every record of every kind, without revisions. */
async function dump(storage: EpcisExchangeStorage, kinds: readonly string[] = Object.values(EPCIS_RECORD_KINDS)): Promise<Held[]> {
  const out: Held[] = [];
  for (const kind of kinds) {
    let after: string | undefined;
    for (;;) {
      const page = await storage.list(kind, { ...(after == null ? {} : { after }), limit: 200 });
      for (const held of page) out.push({ kind, key: held.key, value: held.value });
      if (page.length < 200) break;
      after = page[page.length - 1]!.key;
    }
  }
  return out;
}
const kindOf = async <T = JsonObject>(storage: EpcisExchangeStorage, kind: string): Promise<T[]> => (await dump(storage, [kind])).map((held) => held.value as unknown as T);

/** Every original a store's imports retain, by digest, as the store holds it. */
async function originalsOf(storage: EpcisExchangeStorage): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const record of await kindOf<EpcisImportRecord>(storage, 'import')) {
    const bytes = await storage.getBytes(record.sha256);
    out.set(record.sha256, bytes == null ? 'missing' : Buffer.from(bytes).toString('latin1'));
  }
  return new Map([...out].sort());
}

/** The durable records a snapshot carries, and the two derived kinds a restore rebuilds. */
const CARRIED = ['import', 'observation', 'resolution', 'pull', 'pull-page'];
const DERIVED = ['retention', 'association'];

/** A record with its cursor material taken out, which is the one documented difference of a snapshot that excludes cursors. */
function withoutCursors({ kind, key, value }: Held): Held {
  const copy = structuredClone(value) as Record<string, any>;
  if (kind === 'import' && copy.sourceLocation?.query != null) delete copy.sourceLocation.query.nextPageToken;
  if (kind === 'pull-page') delete copy.query.nextPageToken;
  if (kind === 'pull') {
    delete copy.cursor;
    if (copy.pending != null) { delete copy.pending.next; delete copy.pending.query.nextPageToken; }
  }
  return { kind, key, value: copy };
}

/* --------------------------------- the fixture --------------------------- */

const commissioning = (): JsonObject => fiveEventList()[2] as JsonObject;
/** The event identifier two source scopes both use. */
const SHARED_EVENT = String(commissioning().eventID);
const CONFLICT_ID = epcisConflictId('source-a', 'event-id', SHARED_EVENT);
const FIRST = bytesOf(epcisDocument(fiveEventList()));
const CHANGED = bytesOf(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }]));
const OTHER = bytesOf(epcisDocument([{ ...commissioning(), bizStep: 'inspecting' }]));

const fileImport = (storage: EpcisExchangeStorage, sourceId: string, requestId: string, bytes: Uint8Array, now = AT) => importEpcisSource({ storage, sourceId, requestId, bytes, mediaType: 'application/ld+json', receivedAt: now, provenance: { kind: 'file', filename: `${requestId}.jsonld` }, policy: { policyId: 'test-policy@1' }, now: () => now });

const sourceOf = (server: FixtureServer, over: Partial<EpcisPullSource> = {}): EpcisPullSource => ({ sourceId: 'source-a', baseUrl: server.baseUrl, permittedOrigins: [server.origin], policy: { policyId: 'test-policy@1' }, localTest: true, credentials: () => bearer(), ...over });
const pull = (storage: EpcisExchangeStorage, source: EpcisPullSource, now = LATER): Promise<EpcisPullOutcome> => pullEpcisEvents({ storage, source, queryId: 'query-1', query: { perPage: 2 }, fetch: realFetch, now: () => now });
function ran(outcome: EpcisPullOutcome): EpcisPullResult {
  if (outcome.outcome === 'refused') throw new Error(`the pull was refused: ${JSON.stringify(outcome)}`);
  return outcome;
}

async function serve(behaviour: Partial<FixtureBehaviour> = {}): Promise<FixtureServer> {
  const server = await startEpcisFixtureServer(pullEvents(7), { requireAuthorization: `Bearer ${SECRET}`, ...behaviour });
  servers.push(server);
  return server;
}

/** A store that stops as its process would, in the batch that would move a pull's checkpoint past the given page. */
function stoppingAtCheckpoint(inner: EpcisExchangeStorage, sequence: number): EpcisExchangeStorage {
  return {
    putBytes: (digest, bytes) => inner.putBytes(digest, bytes),
    getBytes: (digest) => inner.getBytes(digest),
    deleteBytes: (digest) => inner.deleteBytes(digest),
    get: (kind, key) => inner.get(kind, key),
    list: (kind, options) => inner.list(kind, options),
    commit: async (writes) => {
      if (writes.some((write) => write.op === 'put' && write.kind === 'pull-page' && write.value.sequence === sequence)) throw new Error('the process stopped');
      return inner.commit(writes);
    },
  };
}

interface Built {
  store: Store;
  /** The store as its operator has it after the interruption: reopened, with recovery run. */
  storage: EpcisExchangeStorage;
  server: FixtureServer;
}

interface BuildOptions {
  /** The source writes a secret into the address of each next page. */
  signedLinks?: boolean;
  /** The source says its page tokens expire this many seconds after they are issued, at `AT`. */
  tokenTtlSeconds?: number;
  /** The source asks for no credential. */
  open?: boolean;
}

/**
 * The deployment being left: two source scopes sharing an event identifier, a
 * resolved conflict with both observations, and a pull of four pages that
 * stopped after its second page was retained and before its checkpoint moved.
 */
async function build(adapter: Adapter, options: BuildOptions = {}): Promise<Built> {
  const store = await newStore(adapter);
  const server = await serve({
    ...(options.open === true ? { requireAuthorization: undefined } : {}),
    ...(options.tokenTtlSeconds == null ? {} : { tokenTtlSeconds: options.tokenTtlSeconds, clock: () => Date.parse(AT) }),
    ...(options.signedLinks === true ? { pageHeaders: (headers: Record<string, string>) => { if (headers.Link != null && !headers.Link.includes('sig=')) headers.Link = headers.Link.replace('?', `?sig=${URL_SECRET}&`); } } : {}),
  });
  expect((await fileImport(store.storage, 'source-a', 'first', FIRST)).outcome).toBe('retained');
  const changed = await fileImport(store.storage, 'source-a', 'changed', CHANGED);
  expect(changed.outcome === 'retained' && changed.record.state).toBe('blocked');
  // The same event identifier under another source scope is another event: it is new there, and no conflict.
  const elsewhere = await fileImport(store.storage, 'source-b', 'other', OTHER);
  expect(elsewhere.outcome === 'retained' && elsewhere.record.events.map((event) => event.arrival)).toEqual(['new']);
  const conflict = (await getEpcisConflict(store.storage, CONFLICT_ID))!;
  const decided = await resolveEpcisConflict(store.storage, { conflictId: CONFLICT_ID, decision: 'The later body stands.', disposition: 'body-selected', selectedBodyDigest: conflict.observations[1]!.bodyDigest, decidedAt: AT, decidedBy: 'reviewer', now: () => AT });
  expect(decided.outcome).toBe('recorded');
  await expect(pull(stoppingAtCheckpoint(store.storage, 2), sourceOf(server), AT)).rejects.toThrow('the process stopped');
  const storage = await store.reopen();
  expect(await recoverEpcisExchange(storage, { now: () => AT })).toEqual({ actions: [], remaining: 0 });
  const interrupted = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
  expect([interrupted.status, interrupted.pagesAcknowledged, interrupted.pending?.page, interrupted.cursor?.afterPage]).toEqual(['running', 1, 2, 1]);
  return { store, storage, server };
}

function exportedOk(result: ExportedEpcisRecovery | EpcisRecoveryExportRefusal): ExportedEpcisRecovery {
  if (!result.ok) throw new Error(`the export was refused: ${JSON.stringify(result)}`);
  return result;
}
function restoredOk(result: RestoredEpcisRecovery | EpcisRecoveryRefusal): RestoredEpcisRecovery {
  if (!result.ok) throw new Error(`the restore was refused: ${JSON.stringify(result).slice(0, 2000)}`);
  return result;
}
const refusal = (result: { ok: boolean }): EpcisRecoveryRefusal & EpcisRecoveryExportRefusal => { expect(result.ok).toBe(false); return result as EpcisRecoveryRefusal & EpcisRecoveryExportRefusal; };

const takeSnapshot = async (storage: EpcisExchangeStorage, over: Partial<Parameters<typeof exportEpcisRecovery>[0]> = {}): Promise<ExportedEpcisRecovery> => exportedOk(await exportEpcisRecovery({ storage, now: () => AT, ...over }));
const restoreInto = (storage: EpcisExchangeStorage, snapshot: Pick<ExportedEpcisRecovery, 'files' | 'inventory'>, over: Partial<RestoreEpcisRecoveryInput> = {}) => restoreEpcisRecovery({ storage, source: epcisRecoveryFiles(snapshot.files), inventory: snapshot.inventory, now: () => LATER, ...over });

/** Every byte an export hands over, as one text: each file, and everything said beside the files. */
const everyByte = (exported: ExportedEpcisRecovery): string => [...exported.files].map(([path, bytes]) => `${path}\n${Buffer.from(bytes).toString('latin1')}`).join('\n') + JSON.stringify([exported.inventory, exported.manifest, exported.descriptor, exported.root]);

/* ------------------------- a snapshot rewritten by hand ------------------- */

interface Editable {
  descriptor: Record<string, any>;
  files: Map<string, Uint8Array>;
  /** The paths of one kind, relative to the descriptor. */
  paths(kind: string): string[];
  read(path: string): Record<string, any>;
  write(path: string, value: unknown): void;
  remove(path: string): void;
  scope(sourceId: string): Record<string, any>;
}

/**
 * A snapshot changed by someone who then makes it agree with itself again:
 * every digest, the inventory and the snapshot identity are recomputed, so
 * only a check of what the records say can refuse it. This is the case a
 * signature cannot catch, because the exporter would sign what it wrote.
 */
function rewritten(exported: ExportedEpcisRecovery, edit: (snapshot: Editable) => void): { files: Map<string, Uint8Array>; inventory: EpcisRecoveryInventoryEntry[] } {
  const root = exported.root;
  const files = new Map<string, Uint8Array>([...exported.files].map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
  const descriptor = structuredClone(exported.descriptor) as Record<string, any>;
  const editable: Editable = {
    descriptor,
    files,
    paths: (kind) => (descriptor.inventory as Array<{ path: string; kind: string }>).filter((entry) => entry.kind === kind).map((entry) => entry.path),
    read: (path) => JSON.parse(new TextDecoder().decode(files.get(`${root}/${path}`)!)) as Record<string, any>,
    write: (path, value) => { files.set(`${root}/${path}`, canonicalJcsBytes(value)); },
    remove: (path) => { files.delete(`${root}/${path}`); descriptor.inventory = descriptor.inventory.filter((entry: { path: string }) => entry.path !== path); },
    scope: (sourceId) => descriptor.scopes.find((scope: { sourceId: string }) => scope.sourceId === sourceId),
  };
  edit(editable);
  descriptor.inventory = descriptor.inventory.map((entry: { path: string; kind: string }) => { const bytes = files.get(`${root}/${entry.path}`)!; return { path: entry.path, kind: entry.kind, sha256: sha256(bytes), byteLength: bytes.byteLength }; });
  descriptor.snapshot.snapshotId = sha256(canonicalizeJcs({ access: descriptor.access, format: descriptor.format, inventory: descriptor.inventory, version: descriptor.version }));
  files.set(`${root}/${EPCIS_RECOVERY_DESCRIPTOR}`, utf8(JSON.stringify(descriptor)));
  const inventory = [...files].map(([path, bytes]) => ({ path, category: path.startsWith(`${root}/originals/`) ? EPCIS_RECOVERY_CATEGORIES.original : EPCIS_RECOVERY_CATEGORIES.record, mediaType: 'application/json', byteLength: bytes.byteLength, sha256: sha256(bytes), represents: path, representation: EPCIS_RECOVERY_REPRESENTATIONS.descriptor })) as EpcisRecoveryInventoryEntry[];
  return { files, inventory };
}

/** A restore that must be refused, into a store that must be left empty. */
async function refusedRestore(snapshot: { files: Map<string, Uint8Array>; inventory: EpcisRecoveryInventoryEntry[] }, over: Partial<RestoreEpcisRecoveryInput> = {}): Promise<EpcisRecoveryRefusal> {
  const state = createMemoryEpcisState();
  const result = refusal(await restoreInto(createMemoryEpcisStorage(state), snapshot, over));
  expect([...state.records.values()].reduce((sum, table) => sum + table.size, 0), 'a refused restore writes no record').toBe(0);
  expect(state.bytes.size, 'a refused restore writes no bytes').toBe(0);
  // What verification alone says is what the restore said. Where the bytes go is the one thing only a restore decides.
  const verified = await verifyEpcisRecovery(epcisRecoveryFiles(snapshot.files), { inventory: snapshot.inventory, ...(over.root == null ? {} : { root: over.root }) });
  expect(verified.ok ? 'relocation-invalid' : verified.code).toBe(result.code);
  return result;
}

/* -------------------------------- the descriptor ------------------------- */

describe('the recovery descriptor: the schema and the hand-written check agree', () => {
  const digest = 'a'.repeat(64);
  const pullId = epcisPullId('source-a', 'query-1');
  const inventory = (): Array<Record<string, unknown>> => [
    { path: `originals/${digest}`, kind: 'original', sha256: digest, byteLength: 120 },
    { path: `records/import/${digest}.json`, kind: 'import', sha256: 'b'.repeat(64), byteLength: 900 },
    { path: `records/observation/${digest}.0000000001.json`, kind: 'observation', sha256: 'c'.repeat(64), byteLength: 300 },
    { path: `records/pull/${digest}.json`, kind: 'pull', sha256: 'd'.repeat(64), byteLength: 700 },
  ];
  const identity = (access: string, list: unknown): string => sha256(canonicalizeJcs({ access, format: 'dpp-epcis-recovery', inventory: list, version: '1' }));
  const base = (): Record<string, any> => ({
    format: 'dpp-epcis-recovery',
    version: '1',
    access: 'authorised-recovery',
    snapshot: { snapshotId: identity('authorised-recovery', inventory()), takenAt: AT, boundary: 'no-unfinished-work', isolation: 'stable-revisions' },
    selection: 'all-scopes',
    scopes: [{ sourceId: 'source-a', originals: 1, imports: 1, observations: 1, resolutions: 0, pulls: [{ pullId, queryId: 'query-1', definitionDigest: digest, baseUrl: 'https://events.example/epcis', status: 'stopped-at-limit', pagesAcknowledged: 0, cursor: 'excluded' }] }],
    cursors: 'excluded',
    inventory: inventory(),
    omitted: [{ what: 'associations-index', reason: 'derived' }, { what: 'cursors', reason: 'excluded', count: 2 }],
    completeness: { claim: 'complete-for-scopes', recoverable: true },
    limits: { ...EPCIS_RECOVERY_LIMITS },
  });
  const vary = (change: (descriptor: Record<string, any>) => void): Record<string, any> => { const descriptor = base(); change(descriptor); return descriptor; };

  const positives: Array<[string, unknown]> = [
    ['a snapshot of one scope', base()],
    ['a scope without a pull', vary((d) => { d.scopes[0].pulls = []; })],
    ['nothing said to be left out', vary((d) => { d.omitted = []; })],
    ['two scopes and listed selection', vary((d) => { d.selection = 'listed-scopes'; d.scopes.push({ sourceId: 'source-b', originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: [] }); })],
    ['cursors carried', vary((d) => { d.cursors = 'included'; d.scopes[0].pulls[0].cursor = 'included'; })],
    ['a public form', vary((d) => { d.access = 'public-evidence'; d.completeness = { claim: 'bounded', recoverable: false }; })],
    ['a time with an offset and fractions', vary((d) => { d.snapshot.takenAt = '2026-03-10T11:00:00.250+11:00'; })],
  ];
  const negatives: Array<[string, unknown]> = [
    ['not an object', 'snapshot'],
    ['an array', [base()]],
    ['null', null],
    ['another format name', vary((d) => { d.format = 'dpp-evidence-package'; })],
    ['an unknown descriptor version', vary((d) => { d.version = '2'; })],
    ['the version as a number', vary((d) => { d.version = 1; })],
    ['a member the format does not define', vary((d) => { d.credentials = { token: 'x' }; })],
    ['a signature of its own', vary((d) => { d.signature = { signer: '02' + 'a'.repeat(64), value: '00' }; })],
    ['an access path the format does not name', vary((d) => { d.access = 'everything'; })],
    ['no access member', vary((d) => { delete d.access; })],
    ['no snapshot member', vary((d) => { delete d.snapshot; })],
    ['a snapshot identity in upper case', vary((d) => { d.snapshot.snapshotId = 'A'.repeat(64); })],
    ['a snapshot without its time', vary((d) => { delete d.snapshot.takenAt; })],
    ['a time without a zone', vary((d) => { d.snapshot.takenAt = '2026-03-10T00:00:00'; })],
    ['a boundary the format does not name', vary((d) => { d.snapshot.boundary = 'best-effort'; })],
    ['an isolation the format does not name', vary((d) => { d.snapshot.isolation = 'none'; })],
    ['a snapshot member the format does not define', vary((d) => { d.snapshot.checkpoint = 4; })],
    ['a selection the format does not name', vary((d) => { d.selection = 'some'; })],
    ['no scope', vary((d) => { d.scopes = []; })],
    ['a scope without a source identifier', vary((d) => { delete d.scopes[0].sourceId; })],
    ['a scope with an empty source identifier', vary((d) => { d.scopes[0].sourceId = ''; })],
    ['a negative count', vary((d) => { d.scopes[0].imports = -1; })],
    ['a count that is not whole', vary((d) => { d.scopes[0].observations = 1.5; })],
    ['a scope with an endpoint credential', vary((d) => { d.scopes[0].credential = 'x'; })],
    ['a pull without its definition digest', vary((d) => { delete d.scopes[0].pulls[0].definitionDigest; })],
    ['a pull identity of another form', vary((d) => { d.scopes[0].pulls[0].pullId = 'pull-1'; })],
    ['a pull status the format does not name', vary((d) => { d.scopes[0].pulls[0].status = 'complete'; })],
    ['a pull that carries its cursor itself', vary((d) => { d.scopes[0].pulls[0].cursor = 'https://events.example/epcis/events?nextPageToken=t1'; })],
    ['a pull with a token member', vary((d) => { d.scopes[0].pulls[0].token = 't1'; })],
    ['a cursor mode the format does not name', vary((d) => { d.cursors = 'some'; })],
    ['no inventory member', vary((d) => { delete d.inventory; })],
    ['an empty inventory', vary((d) => { d.inventory = []; })],
    ['a path with a dot-dot segment', vary((d) => { d.inventory[0].path = `originals/../${digest}`; })],
    ['an absolute path', vary((d) => { d.inventory[0].path = '/etc/passwd'; })],
    ['a path with a backslash', vary((d) => { d.inventory[0].path = `originals\\${digest}`; })],
    ['a kind the format does not name', vary((d) => { d.inventory[1].kind = 'journal'; })],
    ['a file without its digest', vary((d) => { delete d.inventory[0].sha256; })],
    ['a file of negative length', vary((d) => { d.inventory[0].byteLength = -1; })],
    ['a file with its bytes written in', vary((d) => { d.inventory[0].bytes = 'e30='; })],
    ['an omission the format does not name', vary((d) => { d.omitted[0].what = 'everything-else'; })],
    ['a reason the format does not name', vary((d) => { d.omitted[0].reason = 'too-large'; })],
    ['an omission without a reason', vary((d) => { delete d.omitted[0].reason; })],
    ['no completeness member', vary((d) => { delete d.completeness; })],
    ['a claim the format does not name', vary((d) => { d.completeness.claim = 'complete'; })],
    ['recoverable as text', vary((d) => { d.completeness.recoverable = 'yes'; })],
    ['no limits member', vary((d) => { delete d.limits; })],
    ['limits without the origin limit', vary((d) => { delete d.limits.origin; })],
    ['a snapshot that claims to carry credentials', vary((d) => { d.limits.credentials = 'carried'; })],
    ['a snapshot that claims its sources are authentic', vary((d) => { d.limits.origin = 'established'; })],
    ['a limit the format does not name', vary((d) => { d.limits.signed = 'yes'; })],
  ];

  it.each(positives)('both accept %s', (_name, descriptor) => {
    expect(validateDescriptor(descriptor), JSON.stringify(validateDescriptor.errors)).toBe(true);
    expect(epcisRecoveryProblems(descriptor)).toEqual([]);
  });

  it.each(negatives)('both refuse %s', (_name, descriptor) => {
    expect(validateDescriptor(descriptor)).toBe(false);
    const problems = epcisRecoveryProblems(descriptor);
    expect(problems.length).toBeGreaterThan(0);
    for (const sentence of problems) expect(sentence).toMatch(/\.$/);
  });

  it('names the member each problem is at', () => {
    expect(epcisRecoveryProblems(vary((d) => { d.scopes[0].imports = -1; }))).toEqual(['`scopes.0.imports` must be a whole number of at least 0.']);
    expect(epcisRecoveryProblems(vary((d) => { d.limits.credentials = 'carried'; }))).toEqual(['`limits.credentials` must be "never-carried".']);
    expect(epcisRecoveryProblems(vary((d) => { d.signature = {}; }))).toEqual(['the descriptor has a member the format does not define: `signature`.']);
  });

  it('finds what a schema cannot: a contradiction between one member and another', () => {
    const said = (change: (descriptor: Record<string, any>) => void): string[] => epcisRecoveryInconsistencies(vary(change) as EpcisRecoveryDescriptor);
    expect(epcisRecoveryInconsistencies(base() as EpcisRecoveryDescriptor)).toEqual([]);
    expect(said((d) => { d.snapshot.snapshotId = digest; })).toEqual(['the snapshot identity is not the digest of the inventory it names.']);
    expect(said((d) => { d.scopes.push({ ...d.scopes[0], pulls: [], imports: 0, observations: 0 }); })).toEqual(['the source scope "source-a" is listed twice.']);
    expect(said((d) => { d.scopes[0].imports = 2; })).toEqual(['the scopes do not account for every import record in the inventory.']);
    expect(said((d) => { d.scopes[0].pulls[0].pagesAcknowledged = 3; })).toEqual(['the scopes do not account for every acknowledged page in the inventory.']);
    expect(said((d) => { d.scopes[0].pulls[0].cursor = 'included'; })).toEqual([`the pull ${pullId} is said to carry its cursor in a snapshot that excludes cursors.`]);
    expect(said((d) => { d.scopes[0].pulls[0].cursor = 'excluded-non-standard'; })).toEqual([`the pull ${pullId} is said to have lost its cursor for its address in a snapshot that excludes every cursor.`]);
    expect(said((d) => { d.cursors = 'included'; })).toEqual([`the pull ${pullId} is said to have had its cursor left out in a snapshot that carries cursors.`]);
    expect(said((d) => { d.completeness.recoverable = false; })).toEqual(['a recovery snapshot does not claim what a recovery snapshot is.']);
    const moved = said((d) => { d.inventory[0].path = `records/import/${digest}`; });
    expect(moved).toEqual(expect.arrayContaining([`the file records/import/${digest} is not where a file of kind original sits.`]));
    const twice = said((d) => { d.inventory.push({ ...d.inventory[2] }); });
    expect(twice).toEqual(expect.arrayContaining([`the file records/observation/${digest}.0000000001.json is listed twice.`]));
    // A public form can claim nothing a recovery snapshot claims, and can hold no operational record.
    const publicForm = said((d) => { d.access = 'public-evidence'; d.snapshot.snapshotId = identity('public-evidence', d.inventory); });
    expect(publicForm).toEqual(expect.arrayContaining(['a public form claims to be complete or recoverable.', expect.stringMatching(/^a public form carries records\/import\//)]));
  });

  it('says each omission in one line of a manifest', () => {
    expect(describeEpcisRecoveryOmission({ what: 'cursors', reason: 'excluded', count: 3 })).toBe('epcis-exchange cursors excluded count:3');
    expect(describeEpcisRecoveryOmission({ what: 'associations-index', reason: 'derived' })).toBe('epcis-exchange associations-index derived');
  });
});

/* ----------------------------------- export ------------------------------ */

describe.each(['memory', 'file'] as Adapter[])('exporting a recovery snapshot from the %s adapter', (adapter) => {
  it('carries every original in its exact bytes and every durable record, and names all of it in a descriptor both checks accept', async () => {
    const { storage } = await build(adapter);
    const exported = await takeSnapshot(storage);
    const { descriptor } = exported;

    expect(validateDescriptor(descriptor), JSON.stringify(validateDescriptor.errors)).toBe(true);
    expect(epcisRecoveryProblems(descriptor)).toEqual([]);
    expect(epcisRecoveryInconsistencies(descriptor)).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode(exported.files.get(`epcis/${EPCIS_RECOVERY_DESCRIPTOR}`)!))).toEqual(descriptor);
    expect(exported.root).toBe(EPCIS_RECOVERY_ROOT);

    // Every original, byte for byte, under its own digest.
    const originals = await originalsOf(storage);
    expect(originals.size).toBe(5);
    for (const [digest, bytes] of originals) {
      const carried = exported.files.get(`epcis/originals/${digest}`)!;
      expect(Buffer.from(carried).toString('latin1')).toBe(bytes);
      expect(sha256(carried)).toBe(digest);
      expect(exported.inventory.find((entry) => entry.path === `epcis/originals/${digest}`)).toEqual({ path: `epcis/originals/${digest}`, category: 'evidence', mediaType: 'application/ld+json', byteLength: carried.byteLength, sha256: digest, represents: `sha256:${digest}`, representation: 'dpp-epcis-original@1' });
    }

    // Every durable record, each under the key the store holds it at, in canonical JSON, and valid under its contract.
    const held = (await dump(storage, CARRIED)).map(withoutCursors);
    const folder: Record<string, string> = { import: 'records/import', observation: 'records/observation', resolution: 'records/resolution', pull: 'records/pull', 'pull-page': 'records/pull-page' };
    for (const record of held) {
      const bytes = exported.files.get(`epcis/${folder[record.kind]}/${record.key}.json`)!;
      expect(bytes, `${record.kind} ${record.key}`).toBeDefined();
      expect(Buffer.from(bytes).equals(Buffer.from(canonicalJcsBytes(record.value)))).toBe(true);
      const validate = record.kind === 'import' ? validateImport : validateRecord;
      expect(validate(JSON.parse(new TextDecoder().decode(bytes))), `${record.kind}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
    expect(descriptor.inventory.map((entry) => entry.kind).reduce<Record<string, number>>((counts, kind) => ({ ...counts, [kind]: (counts[kind] ?? 0) + 1 }), {})).toEqual({ original: 5, import: 5, observation: 13, resolution: 1, pull: 1, 'pull-page': 1 });
    expect(exported.files.size).toBe(descriptor.inventory.length + 1);
    expect(exported.inventory.map((entry) => entry.path)).toEqual([...exported.files.keys()]);
    for (const entry of exported.inventory) {
      const bytes = exported.files.get(entry.path)!;
      expect([entry.byteLength, entry.sha256]).toEqual([bytes.byteLength, sha256(bytes)]);
      expect(entry.category).toBe(entry.path.startsWith('epcis/originals/') ? 'evidence' : 'reports');
      expect(Object.values(EPCIS_RECOVERY_REPRESENTATIONS)).toContain(entry.representation);
    }
    expect(exported.inventory.at(-1)).toMatchObject({ path: 'epcis/epcis-recovery.json', category: 'reports', representation: 'dpp-epcis-recovery@1' });

    // What is derived is not carried, and the descriptor says so.
    expect([...exported.files.keys()].filter((path) => /association|retention|journal|restore|relocation/.test(path))).toEqual([]);
    expect(descriptor.omitted).toEqual([
      { what: 'associations-index', reason: 'derived' },
      { what: 'retention-entries', reason: 'derived' },
      { what: 'journal', reason: 'empty-at-boundary' },
      { what: 'restore-history', reason: 'never-carried' },
      { what: 'credentials', reason: 'never-carried' },
      { what: 'cursors', reason: 'excluded', count: 4 },
    ]);

    // The covered scopes, the boundary and the claim.
    const pulled = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
    expect(descriptor.scopes).toEqual([
      { sourceId: 'source-a', originals: 4, imports: 4, observations: 12, resolutions: 1, pulls: [{ pullId: pulled.pullId, queryId: 'query-1', definitionDigest: pulled.definitionDigest, baseUrl: pulled.source.baseUrl, status: 'running', pagesAcknowledged: 1, cursor: 'excluded' }] },
      { sourceId: 'source-b', originals: 1, imports: 1, observations: 1, resolutions: 0, pulls: [] },
    ]);
    expect(descriptor.selection).toBe('all-scopes');
    expect(descriptor.snapshot).toEqual({ snapshotId: expect.stringMatching(/^[0-9a-f]{64}$/), takenAt: AT, boundary: 'no-unfinished-work', isolation: 'stable-revisions' });
    expect(descriptor.completeness).toEqual({ claim: 'complete-for-scopes', recoverable: true });
    expect(descriptor.limits).toEqual(EPCIS_RECOVERY_LIMITS);
    expect(exported.manifest).toEqual({
      disclosure: { scope: 'all-tiers', recoveryBackup: true },
      snapshots: ['source-a', 'source-b'].map((sourceId) => ({ source: `epcis-exchange:${sourceId}`, snapshotId: descriptor.snapshot.snapshotId, completeForSnapshot: true, scope: 'every retained original and durable record of the source scope at the snapshot boundary' })),
      withheld: descriptor.omitted.map(describeEpcisRecoveryOmission),
    });
  });

  it('changes nothing in the store, and gives the same bytes for the same store', async () => {
    const { storage } = await build(adapter);
    const before = await dump(storage);
    const first = await takeSnapshot(storage);
    const second = await takeSnapshot(storage);
    expect(await dump(storage)).toEqual(before);
    expect([...second.files].map(([path, bytes]) => [path, sha256(bytes)])).toEqual([...first.files].map(([path, bytes]) => [path, sha256(bytes)]));
    // The identity is of the content: the same snapshot taken later is the same snapshot.
    const later = await takeSnapshot(storage, { now: () => LATER });
    expect(later.descriptor.snapshot.snapshotId).toBe(first.descriptor.snapshot.snapshotId);
    expect(later.descriptor.snapshot.takenAt).toBe(LATER);
  });

  it('covers only the source scopes it is asked for, and says the others were left out', async () => {
    const { storage } = await build(adapter);
    const exported = await takeSnapshot(storage, { sourceIds: ['source-b'] });
    expect(exported.descriptor.selection).toBe('listed-scopes');
    expect(exported.descriptor.scopes.map((scope) => scope.sourceId)).toEqual(['source-b']);
    expect(exported.descriptor.omitted).toContainEqual({ what: 'other-scopes', reason: 'not-selected' });
    expect(exported.descriptor.inventory.map((entry) => entry.kind).sort()).toEqual(['import', 'observation', 'original']);
    // The scope is whole by itself: it restores, and nothing of the other scope came with it.
    const destination = await newStore(other(adapter));
    restoredOk(await restoreInto(destination.storage, exported));
    expect(new Set((await dump(destination.storage, [...CARRIED, 'association'])).map((held) => held.value.sourceId))).toEqual(new Set(['source-b']));
    expect((await dump(destination.storage, ['retention'])).length).toBe(1);

    expect(refusal(await exportEpcisRecovery({ storage, sourceIds: ['source-c'] }))).toMatchObject({ code: 'scope-not-held', sourceId: 'source-c' });
    expect(refusal(await exportEpcisRecovery({ storage: (await newStore('memory')).storage }))).toMatchObject({ code: 'no-source-scope' });
    expect(() => exportEpcisRecovery({ storage, sourceIds: [] })).toThrow(TypeError);
    expect(() => exportEpcisRecovery({ storage, root: '../elsewhere' })).toThrow(TypeError);
    expect(() => exportEpcisRecovery({ storage, cursors: 'some' as 'include' })).toThrow(TypeError);
  });

  it('refuses while work is journalled as unfinished, and exports once recovery has run', async () => {
    const { store, storage } = await build(adapter);
    // An import that stopped after its receipt: acknowledged to no one yet, and journalled.
    await expect(fileImport(faultInjectingEpcisStorage(storage, { at: 3, when: 'after' }).storage, 'source-b', 'stopped', bytesOf(epcisDocument(fiveEventList().slice(0, 2))))).rejects.toBeInstanceOf(EpcisStorageFault);
    const reopened = await store.reopen();
    const before = await dump(reopened);
    const refused = refusal(await exportEpcisRecovery({ storage: reopened }));
    expect(refused.code).toBe('unfinished-work');
    expect(refused.breaches).toEqual([expect.stringMatching(/^import\.[0-9a-f]{64}: unfinished import$/)]);
    // The export finished nothing and discarded nothing: that is recovery's work, and it runs alone.
    expect(await dump(reopened)).toEqual(before);
    expect((await recoverEpcisExchange(reopened, { now: () => AT })).remaining).toBe(0);
    const exported = await takeSnapshot(reopened);
    expect(exported.descriptor.scopes.find((scope) => scope.sourceId === 'source-b')!.imports).toBe(2);
  });

  it('refuses a store that is not consistent, and a record of a version it does not read', async () => {
    const lost = await build(adapter);
    const first = (await findEpcisImportByRequest(lost.storage, 'source-a', 'first'))!;
    await lost.storage.deleteBytes(first.sha256);
    expect(refusal(await exportEpcisRecovery({ storage: lost.storage }))).toMatchObject({ code: 'store-inconsistent', breaches: [`import ${first.importId}: its bytes are not in the store`] });

    // A checkpoint whose import is gone: the page record stays, the import it names does not.
    const ahead = await build(adapter);
    const [page] = await listEpcisPullPages(ahead.storage, epcisPullId('source-a', 'query-1'));
    const imports = await dump(ahead.storage, ['import']);
    const named = imports.find((held) => held.value.importId === page!.importId)!;
    await ahead.storage.commit([{ op: 'delete', kind: 'import', key: named.key }]);
    const refused = refusal(await exportEpcisRecovery({ storage: ahead.storage }));
    expect(refused.code).toBe('store-inconsistent');
    expect(refused.detail).toContain('A checkpoint is never restored ahead of the imports it stands on');

    const versioned = await build(adapter);
    const [any] = await dump(versioned.storage, ['observation']);
    await versioned.storage.commit([{ op: 'put', kind: 'observation', key: any!.key, value: { ...any!.value, recordVersion: '2' } }]);
    expect(refusal(await exportEpcisRecovery({ storage: versioned.storage }))).toMatchObject({ code: 'record-version-unknown' });
  });

  it('fits the manifest of an evidence package as that contract stands: its entries, its disclosure, its snapshot declarations and its withheld lines', async () => {
    const { storage } = await build(adapter);
    const recovery = await takeSnapshot(storage);
    const open = exportedOk(await exportEpcisPublicEvidence({ storage, allow: () => true, now: () => AT }));
    for (const [form, exported] of [['recovery', recovery], ['public', open]] as const) {
      // The manifest an exporter would sign, with nothing added to the contract: the snapshot supplies the inventory and what is said beside it.
      const manifest = {
        format: 'dpp-evidence-package',
        version: '1',
        passportId: 'https://passports.example/01/09521234543213/21/SER1',
        exportedAt: AT,
        exporter: { id: `02${'a'.repeat(64)}`, role: 'writer' },
        disclosure: exported.manifest.disclosure,
        completeness: { snapshots: exported.manifest.snapshots, withheld: exported.manifest.withheld, absent: [] },
        sources: [],
        inventory: exported.inventory,
        signature: { suite: 'bsv-ecdsa-der', signer: `03${'b'.repeat(64)}`, value: '3006020101020101' },
      };
      expect(validateManifest(manifest), `${form}: ${JSON.stringify(validateManifest.errors)}`).toBe(true);
      expect(new Set(exported.inventory.map((entry) => entry.category)), form).toEqual(new Set(['evidence', 'reports']));
      expect(new Set(exported.inventory.map((entry) => entry.path)).size, form).toBe(exported.inventory.length);
      expect(exported.manifest.withheld.every((line) => line.startsWith('epcis-exchange ')), form).toBe(true);
    }
    // The two access paths say different things of themselves, in the members the contract already has.
    expect(recovery.manifest.disclosure).toEqual({ scope: 'all-tiers', recoveryBackup: true });
    expect(open.manifest.disclosure).toEqual({ scope: 'public', recoveryBackup: false });
    expect(open.inventory.some((entry) => /observation|resolution|pull/.test(entry.representation))).toBe(false);
  });
});

describe('the snapshot boundary', () => {
  const delegating = (inner: EpcisExchangeStorage, beforeList: (kind: string) => Promise<void>): EpcisExchangeStorage => ({
    putBytes: (digest, bytes) => inner.putBytes(digest, bytes),
    getBytes: (digest) => inner.getBytes(digest),
    deleteBytes: (digest) => inner.deleteBytes(digest),
    get: (kind, key) => inner.get(kind, key),
    commit: (writes) => inner.commit(writes),
    list: async (kind, options) => { if (options.after == null) await beforeList(kind); return inner.list(kind, options); },
  });

  it('never carries a checkpoint ahead of its imports, when another writer moves the checkpoint while the store is being read', async () => {
    const { storage, server } = await build('memory');
    // Another process: it shares the store and not this process's turn. It finishes the page that was pending and reads one more,
    // after the export has read the imports and before it reads the pull. A single reading would hold a checkpoint two imports ahead.
    let readings = 0;
    let importsAtFirstReading = 0;
    const racing = delegating(storage, async (kind) => {
      if (kind === 'import' && readings === 0) importsAtFirstReading = (await dump(storage, ['import'])).length;
      if (kind !== 'pull') return;
      readings += 1;
      if (readings === 1) expect(ran(await pull(storage, sourceOf(server, { policy: { policyId: 'test-policy@1', limits: { maxPullPages: 1 } } }), AT)).reason).toBe('page-limit');
    });
    const exported = await takeSnapshot(racing);
    expect(readings).toBeGreaterThanOrEqual(4);
    const kinds = exported.descriptor.inventory.map((entry) => entry.kind);
    expect(importsAtFirstReading).toBe(5);
    expect(kinds.filter((kind) => kind === 'import').length).toBe(6);
    expect(exported.descriptor.scopes[0]!.pulls[0]!.pagesAcknowledged).toBe(3);
    expect(kinds.filter((kind) => kind === 'pull-page').length).toBe(3);
    expect((await verifyEpcisRecovery(epcisRecoveryFiles(exported.files), { inventory: exported.inventory })).ok).toBe(true);
    restoredOk(await restoreInto((await newStore('file')).storage, exported));
  });

  it('gives up by name when the store never holds still', async () => {
    const { storage } = await build('memory');
    const [held] = await dump(storage, ['pull']);
    const restless = delegating(storage, async (kind) => { if (kind === 'pull-page') await storage.commit([{ op: 'put', kind: 'pull', key: held!.key, value: held!.value }]); });
    expect(refusal(await exportEpcisRecovery({ storage: restless }))).toMatchObject({ code: 'store-unstable' });
  });
});

/* ------------------------ authorised and public, and secrets -------------- */

describe('what leaves: credentials, cursors and the public form', () => {
  it('carries no credential, no page token and no secret-bearing address in any byte of either form', async () => {
    const { storage, server } = await build('memory', { signedLinks: true });
    // What was there to leak: the tokens the source issued, and the secret it wrote into its next-page addresses.
    const pulled = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
    const tokens = [...new Set([pulled.cursor!.token!, pulled.pending!.next!.token!, ...server.pageRequests().flatMap((request) => (request.query.nextPageToken == null ? [] : [request.query.nextPageToken]))])];
    expect(tokens.length).toBe(2);
    const stored = JSON.stringify(await dump(storage));
    for (const token of tokens) expect(stored).toContain(token);
    expect(stored).toContain(URL_SECRET);
    expect(pulled.cursor!.target).toContain(`sig=${URL_SECRET}`);
    expect(server.pageRequests().every((request) => request.headers.authorization === `Bearer ${SECRET}`)).toBe(true);

    const recovery = await takeSnapshot(storage, { credentials: [bearer()] });
    const open = exportedOk(await exportEpcisPublicEvidence({ storage, allow: () => true, credentials: [bearer()], now: () => AT }));
    for (const [form, exported] of [['recovery', recovery], ['public', open]] as const) {
      const bytes = everyByte(exported);
      for (const secret of [...SECRET_FORMS, URL_SECRET, ...tokens]) expect(bytes.includes(secret), `${form}: ${secret}`).toBe(false);
      expect(bytes).not.toContain('nextPageToken');
      expect(bytes).not.toMatch(/authorization|bearer/i);
    }
    expect(recovery.descriptor.cursors).toBe('excluded');
    expect(recovery.descriptor.scopes[0]!.pulls[0]!.cursor).toBe('excluded');
    // The cursor of the checkpoint, the cursor the pending page named, and the token in the provenance of the pending page and of the page it was read as.
    expect(recovery.descriptor.omitted).toContainEqual({ what: 'cursors', reason: 'excluded', count: 4 });

    // Asked for, cursors are carried only when their address holds nothing but the standard parameters. This source's do not.
    const asked = await takeSnapshot(storage, { cursors: 'include', credentials: [bearer()] });
    const carried = everyByte(asked);
    for (const secret of [...SECRET_FORMS, URL_SECRET]) expect(carried.includes(secret), secret).toBe(false);
    expect(asked.descriptor.cursors).toBe('included');
    expect(asked.descriptor.scopes[0]!.pulls[0]!.cursor).toBe('excluded-non-standard');
    const record = JSON.parse(new TextDecoder().decode(asked.files.get(`epcis/${asked.descriptor.inventory.find((entry) => entry.kind === 'pull')!.path}`)!)) as EpcisPullRecord;
    expect([record.cursor, record.pending?.next]).toEqual([undefined, undefined]);
    // Such a snapshot still restores and resumes: the pass replays from its bounds.
    const destination = await newStore('file');
    restoredOk(await restoreInto(destination.storage, asked));
    expect(ran(await pull(destination.storage, sourceOf(server))).replay?.reason).toBe('cursor-missing');
  });

  it('carries cursors when asked and their addresses are standard, and by default leaves every one out', async () => {
    const { storage } = await build('file');
    const source = (await dump(storage, CARRIED));
    const read = (exported: ExportedEpcisRecovery): Held[] => exported.descriptor.inventory.filter((entry) => entry.kind !== 'original').map((entry) => ({ kind: entry.kind, key: entry.path.split('/').at(-1)!.replace(/\.json$/, ''), value: JSON.parse(new TextDecoder().decode(exported.files.get(`epcis/${entry.path}`)!)) as JsonObject }));

    const asked = await takeSnapshot(storage, { cursors: 'include' });
    expect(asked.descriptor.scopes[0]!.pulls[0]!.cursor).toBe('included');
    expect(asked.descriptor.omitted.some((omitted) => omitted.what === 'cursors')).toBe(false);
    // With cursors carried, every record leaves exactly as it is stored.
    expect(read(asked)).toEqual(source);

    const byDefault = await takeSnapshot(storage);
    expect(read(byDefault)).toEqual(source.map(withoutCursors));
    expect(read(byDefault)).not.toEqual(source);
    const record = read(byDefault).find((held) => held.kind === 'pull')!.value as unknown as EpcisPullRecord;
    expect([record.cursor, record.pending?.next, record.pending?.query.nextPageToken]).toEqual([undefined, undefined, undefined]);
    // Everything that is not a cursor is kept: the query definition and bounds, the limits, the run, the pass and the page that was pending.
    const stored = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
    expect({ ...record, pending: { ...record.pending, next: stored.pending!.next, query: stored.pending!.query }, cursor: stored.cursor }).toEqual(stored);
    expect(byDefault.descriptor.snapshot.snapshotId).not.toBe(asked.descriptor.snapshot.snapshotId);
  });

  it('refuses to hand over a snapshot that holds a credential the operator named, and says where without repeating it', async () => {
    const { storage } = await build('memory');
    const leaking = bytesOf(epcisDocument([{ ...(fiveEventList()[0] as JsonObject), 'example:note': `call back with ${SECRET}` }]));
    expect((await fileImport(storage, 'source-b', 'leaking', leaking)).outcome).toBe('retained');
    const refused = refusal(await exportEpcisRecovery({ storage, credentials: [bearer()] }));
    expect(refused).toMatchObject({ code: 'credential-in-snapshot', path: `epcis/originals/${sha256(leaking)}` });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(refusal(await exportEpcisPublicEvidence({ storage, allow: () => true, credentials: [bearer()] }))).toMatchObject({ code: 'credential-in-snapshot' });
    // A public form that leaves the source out carries nothing of it.
    expect((await exportEpcisPublicEvidence({ storage, allow: (record) => record.requestId !== 'leaking', credentials: [bearer()] })).ok).toBe(true);
    expect(() => exportEpcisRecovery({ storage, credentials: [{ scheme: 'bearer', token: 'short' }] })).toThrow(TypeError);
  });

  it('gives a public package the originals the access policy allows and their records without provenance, and nothing operational', async () => {
    const { storage } = await build('memory');
    const page = (await kindOf<EpcisImportRecord>(storage, 'import')).find((record) => record.sourceLocation.kind === 'query' && record.sourceLocation.page === 2)!;
    const allowed = new Set([epcisImportId('source-a', 'first'), epcisImportId('source-b', 'other'), page.importId]);
    const asked: string[] = [];
    const exported = exportedOk(await exportEpcisPublicEvidence({ storage, allow: (record) => { asked.push(record.importId); return allowed.has(record.importId); }, now: () => AT }));
    expect(asked.length).toBe(5);
    const { descriptor } = exported;
    expect(validateDescriptor(descriptor), JSON.stringify(validateDescriptor.errors)).toBe(true);
    expect(epcisRecoveryProblems(descriptor)).toEqual([]);
    expect(epcisRecoveryInconsistencies(descriptor)).toEqual([]);
    expect(descriptor.access).toBe('public-evidence');
    expect(descriptor.completeness).toEqual({ claim: 'bounded', recoverable: false });
    expect(descriptor.inventory.map((entry) => entry.kind).sort()).toEqual(['original', 'original', 'original', 'public-import', 'public-import', 'public-import']);
    expect(descriptor.scopes).toEqual([
      { sourceId: 'source-a', originals: 2, imports: 2, observations: 0, resolutions: 0, pulls: [] },
      { sourceId: 'source-b', originals: 1, imports: 1, observations: 0, resolutions: 0, pulls: [] },
    ]);
    expect(descriptor.omitted).toEqual([
      { what: 'operational-records', reason: 'not-public' },
      { what: 'provenance', reason: 'not-public' },
      { what: 'cursors', reason: 'not-public' },
      { what: 'credentials', reason: 'never-carried' },
      { what: 'associations-index', reason: 'derived' },
      { what: 'other-scopes', reason: 'not-selected', count: 2 },
    ]);
    expect(exported.manifest.disclosure).toEqual({ scope: 'public', recoveryBackup: false });
    expect(exported.manifest.snapshots.every((snapshot) => snapshot.completeForSnapshot === false)).toBe(true);

    for (const entry of descriptor.inventory.filter((file) => file.kind === 'public-import')) {
      const record = JSON.parse(new TextDecoder().decode(exported.files.get(`epcis/${entry.path}`)!)) as EpcisImportRecord;
      const stored = (await kindOf<EpcisImportRecord>(storage, 'import')).find((held) => held.importId === record.importId)!;
      expect(allowed.has(record.importId)).toBe(true);
      // The record is the stored one with where and how it was read left out: no file name, endpoint, query or page.
      expect(record).toEqual({ ...stored, sourceLocation: { kind: stored.sourceLocation.kind } });
      expect(validateImport(record), JSON.stringify(validateImport.errors)).toBe(true);
      expect(Buffer.from(exported.files.get(`epcis/originals/${record.sha256}`)!).equals(Buffer.from((await exportEpcisSource(storage, record.importId))!.bytes))).toBe(true);
      expect(exported.inventory.find((file) => file.path === `epcis/${entry.path}`)).toMatchObject({ category: 'reports', representation: 'dpp-epcis-public-import@1', represents: record.importId });
    }
    const bytes = everyByte(exported);
    expect(bytes).not.toContain('127.0.0.1');
    expect(bytes).not.toContain('first.jsonld');

    // A public form is not a recovery backup: it restores nothing, by name.
    expect((await refusedRestore(exported)).code).toBe('not-a-recovery-snapshot');
    expect(refusal(await exportEpcisPublicEvidence({ storage, allow: () => false }))).toMatchObject({ code: 'nothing-public' });
    expect(() => exportEpcisPublicEvidence({ storage } as unknown as Parameters<typeof exportEpcisPublicEvidence>[0])).toThrow(TypeError);
  });
});

/* ---------------------------- refusals of a restore ----------------------- */

describe('a snapshot that is refused, each by its own name', () => {
  let exported: ExportedEpcisRecovery;
  let source: EpcisExchangeStorage;
  const prepared = async (): Promise<void> => { const built = await build('memory'); source = built.storage; exported = await takeSnapshot(source); };

  it('accepts the snapshot as exported, from memory and from a folder, and by verification alone', async () => {
    await prepared();
    const verified = await verifyEpcisRecovery(epcisRecoveryFiles(exported.files), { inventory: exported.inventory });
    expect(verified).toEqual({ ok: true, root: 'epcis', descriptor: exported.descriptor, descriptorSha256: sha256(exported.files.get('epcis/epcis-recovery.json')!), counts: { originals: 5, imports: 5, observations: 13, resolutions: 1, pulls: 1, pullPages: 1 } });
    // The protocol package holds package files as arrays of numbers; the same reader takes them.
    expect((await verifyEpcisRecovery(epcisRecoveryFiles(new Map([...exported.files].map(([path, bytes]) => [path, [...bytes]]))), { inventory: exported.inventory })).ok).toBe(true);
    // A larger manifest lists other files too. Those outside the snapshot's folder are none of its business.
    expect((await verifyEpcisRecovery(epcisRecoveryFiles(exported.files), { inventory: [...exported.inventory, { path: 'profiles/profile-bundle.json', byteLength: 2, sha256: 'e'.repeat(64) }] })).ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'dpp-epcis-snapshot-'));
    folders.push(dir);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    for (const [path, bytes] of exported.files) { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), bytes); }
    expect((await verifyEpcisRecovery(epcisRecoveryDirectory(dir), { inventory: exported.inventory })).ok).toBe(true);
    expect(await epcisRecoveryDirectory(dir)('../outside')).toBeUndefined();
    await expect(verifyEpcisRecovery(epcisRecoveryFiles(exported.files), {} as never)).rejects.toThrow(TypeError);
  });

  it('checkpoint-imports-omitted: a pull whose checkpoint stands on an import or a page the snapshot leaves out', async () => {
    await prepared();
    const [page] = await listEpcisPullPages(source, epcisPullId('source-a', 'query-1'));
    const withoutImport = rewritten(exported, (snapshot) => {
      const path = snapshot.paths('import').find((candidate) => snapshot.read(candidate).importId === page!.importId)!;
      const owned = snapshot.paths('observation').filter((candidate) => snapshot.read(candidate).importId === page!.importId);
      snapshot.remove(`originals/${page!.sha256}`);
      snapshot.remove(path);
      for (const observation of owned) snapshot.remove(observation);
      const scope = snapshot.scope('source-a');
      scope.imports -= 1; scope.originals -= 1; scope.observations -= owned.length;
    });
    const refused = await refusedRestore(withoutImport);
    expect(refused.code).toBe('checkpoint-imports-omitted');
    expect(refused.detail).toContain(page!.importId);

    const withoutPage = rewritten(exported, (snapshot) => { snapshot.remove(snapshot.paths('pull-page')[0]!); });
    // The descriptor itself no longer accounts for the page the pull says it acknowledged.
    expect((await refusedRestore(withoutPage)).code).toBe('descriptor-invalid');
    const withoutPageAndSaidSo = rewritten(exported, (snapshot) => { snapshot.remove(snapshot.paths('pull-page')[0]!); snapshot.scope('source-a').pulls[0].pagesAcknowledged = 0; });
    expect((await refusedRestore(withoutPageAndSaidSo)).code).toBe('checkpoint-imports-omitted');
  });

  it('resolution-observations-omitted: a decision whose competing observation the snapshot leaves out', async () => {
    await prepared();
    const conflict = (await getEpcisConflict(source, CONFLICT_ID))!;
    expect(conflict.resolutions[0]!.observations.length).toBe(2);
    for (const sequence of [1, 2]) {
      const without = rewritten(exported, (snapshot) => {
        const path = snapshot.paths('observation').find((candidate) => { const record = snapshot.read(candidate); return record.sourceId === 'source-a' && record.identity === SHARED_EVENT && record.sequence === sequence; })!;
        snapshot.remove(path);
        snapshot.scope('source-a').observations -= 1;
      });
      const refused = await refusedRestore(without);
      expect(refused.code, `observation ${sequence}`).toBe('resolution-observations-omitted');
      expect(refused.detail).toContain(conflict.resolutions[0]!.resolutionId);
    }
  });

  it('original-missing and original-altered: an original that is absent, or is not the bytes it is named by', async () => {
    await prepared();
    const path = `epcis/${exported.descriptor.inventory.find((entry) => entry.kind === 'original')!.path}`;
    const missing = new Map(exported.files);
    missing.delete(path);
    expect(await refusedRestore({ files: missing, inventory: exported.inventory })).toMatchObject({ code: 'original-missing', path });

    const altered = new Map(exported.files);
    const bytes = Uint8Array.from(altered.get(path)!);
    bytes[10] = bytes[10]! ^ 1;
    altered.set(path, bytes);
    expect(await refusedRestore({ files: altered, inventory: exported.inventory })).toMatchObject({ code: 'original-altered', path });
    const truncated = new Map(exported.files);
    truncated.set(path, exported.files.get(path)!.subarray(0, 40));
    expect(await refusedRestore({ files: truncated, inventory: exported.inventory })).toMatchObject({ code: 'original-altered', path });

    // A snapshot rewritten to leave an original out, with its import record kept: the record depends on bytes that are not carried.
    const dropped = rewritten(exported, (snapshot) => { snapshot.remove(snapshot.paths('original')[0]!); });
    expect((await refusedRestore(dropped)).code).toBe('original-missing');
  });

  it('record-missing and record-altered: a record that is absent, changed, or not in the form an export writes', async () => {
    await prepared();
    const path = `epcis/${exported.descriptor.inventory.find((entry) => entry.kind === 'resolution')!.path}`;
    const missing = new Map(exported.files);
    missing.delete(path);
    expect(await refusedRestore({ files: missing, inventory: exported.inventory })).toMatchObject({ code: 'record-missing', path });

    const altered = new Map(exported.files);
    altered.set(path, utf8(new TextDecoder().decode(exported.files.get(path)!).replace('The later body stands.', 'The first body stands.')));
    expect(await refusedRestore({ files: altered, inventory: exported.inventory })).toMatchObject({ code: 'record-altered', path });

    // The same record in another spelling, with every digest made to agree: an export writes one spelling, and this is not it.
    const respelt = rewritten(exported, (snapshot) => { const relative = snapshot.paths('resolution')[0]!; snapshot.files.set(`epcis/${relative}`, utf8(JSON.stringify(snapshot.read(relative), null, 2))); });
    expect(await refusedRestore(respelt)).toMatchObject({ code: 'record-altered', path });
    const twice = rewritten(exported, (snapshot) => { const relative = snapshot.paths('resolution')[0]!; snapshot.files.set(`epcis/${relative}`, utf8(`{"decision":"Another decision.",${new TextDecoder().decode(snapshot.files.get(`epcis/${relative}`)!).slice(1)}`)); });
    expect(await refusedRestore(twice)).toMatchObject({ code: 'record-altered', path });
  });

  it('descriptor-inventory-mismatch: a descriptor and an inventory that do not name the same files', async () => {
    await prepared();
    const some = exported.inventory.find((entry) => entry.path.includes('/records/observation/'))!;
    const without = exported.inventory.filter((entry) => entry !== some);
    expect(await refusedRestore({ files: exported.files, inventory: without })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: some.path });
    const differing = exported.inventory.map((entry) => (entry === some ? { ...entry, sha256: 'f'.repeat(64) } : entry));
    expect(await refusedRestore({ files: exported.files, inventory: differing })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: some.path });
    const recategorised = exported.inventory.map((entry) => (entry === some ? { ...entry, category: 'evidence' as const } : entry));
    expect(await refusedRestore({ files: exported.files, inventory: recategorised })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: some.path });
    // A file the inventory vouches for in the snapshot's folder that the descriptor does not name.
    const extra = [...exported.inventory, { ...some, path: 'epcis/records/observation/extra.json' }];
    expect(await refusedRestore({ files: exported.files, inventory: extra })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: 'epcis/records/observation/extra.json' });
    // One path listed twice leaves it open which bytes the package vouches for, whichever entry comes first.
    for (const twice of [[...exported.inventory, { ...some, sha256: 'f'.repeat(64) }], [{ ...some, sha256: 'f'.repeat(64) }, ...exported.inventory]]) expect(await refusedRestore({ files: exported.files, inventory: twice })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: some.path });
    // A descriptor the inventory does not vouch for: swapped for another, or not listed at all.
    const swapped = new Map(exported.files);
    swapped.set('epcis/epcis-recovery.json', utf8(JSON.stringify({ ...exported.descriptor, selection: 'listed-scopes' })));
    expect(await refusedRestore({ files: swapped, inventory: exported.inventory })).toMatchObject({ code: 'descriptor-inventory-mismatch', path: 'epcis/epcis-recovery.json' });
    expect(await refusedRestore({ files: exported.files, inventory: exported.inventory.filter((entry) => !entry.path.endsWith(EPCIS_RECOVERY_DESCRIPTOR)) })).toMatchObject({ code: 'descriptor-inventory-mismatch' });
  });

  it('record-version-unknown and record-misfiled: a record of another version, of another type, or under a name that is not its own', async () => {
    await prepared();
    const versions: Array<[string, (record: Record<string, any>) => void]> = [
      ['observation', (record) => { record.recordVersion = '2'; }],
      ['resolution', (record) => { record.recordVersion = '2'; }],
      ['pull', (record) => { record.recordVersion = '2'; }],
      ['pull-page', (record) => { record.recordVersion = '0'; }],
      ['import', (record) => { record.importVersion = '3'; }],
    ];
    for (const [kind, change] of versions) {
      const bumped = rewritten(exported, (snapshot) => { const path = snapshot.paths(kind)[0]!; const record = snapshot.read(path); change(record); snapshot.write(path, record); });
      expect((await refusedRestore(bumped)).code, kind).toBe('record-version-unknown');
    }
    // An observation presented as a decision.
    const retyped = rewritten(exported, (snapshot) => { snapshot.write(snapshot.paths('resolution')[0]!, snapshot.read(snapshot.paths('observation')[0]!)); });
    expect((await refusedRestore(retyped)).code).toBe('record-misfiled');
    // A record moved to another name: where a record goes is decided by its content, never by its path.
    const renamed = rewritten(exported, (snapshot) => {
      const from = snapshot.paths('observation')[0]!;
      const to = `records/observation/${'a'.repeat(64)}.0000000001.json`;
      snapshot.files.set(`epcis/${to}`, snapshot.files.get(`epcis/${from}`)!);
      snapshot.files.delete(`epcis/${from}`);
      snapshot.descriptor.inventory.find((entry: { path: string }) => entry.path === from).path = to;
    });
    expect((await refusedRestore(renamed)).code).toBe('record-misfiled');
    // A record rewritten to belong to another source scope no longer has the identity it is filed under.
    const rescoped = rewritten(exported, (snapshot) => { const path = snapshot.paths('import').find((candidate) => snapshot.read(candidate).sourceId === 'source-b')!; snapshot.write(path, { ...snapshot.read(path), sourceId: 'source-a' }); });
    expect((await refusedRestore(rescoped)).code).toBe('record-misfiled');
  });

  it('snapshot-inconsistent: a snapshot that breaks an invariant of the exchange when taken by itself', async () => {
    await prepared();
    // An observation no decision names, left out: the import that made it still says it did.
    const without = rewritten(exported, (snapshot) => {
      const path = snapshot.paths('observation').find((candidate) => { const record = snapshot.read(candidate); return record.sourceId === 'source-b'; })!;
      snapshot.remove(path);
      snapshot.scope('source-b').observations -= 1;
    });
    const refused = await refusedRestore(without);
    expect(refused.code).toBe('snapshot-inconsistent');
    expect(refused.breaches).toEqual([expect.stringContaining('its observation is not held')]);
    // An import whose request binding was changed.
    const rebound = rewritten(exported, (snapshot) => { const path = snapshot.paths('import')[0]!; snapshot.write(path, { ...snapshot.read(path), requestDigest: 'e'.repeat(64) }); });
    expect(await refusedRestore(rebound)).toMatchObject({ code: 'snapshot-inconsistent', breaches: [expect.stringContaining('its request digest is not the digest of its request')] });
    // A scope the descriptor says it covers, carried in part.
    const miscounted = rewritten(exported, (snapshot) => { snapshot.scope('source-a').imports -= 1; snapshot.scope('source-b').imports += 1; });
    expect((await refusedRestore(miscounted)).code).toBe('snapshot-inconsistent');
    // A pull the descriptor describes as bound to another address, or as ended another way, than its record says.
    const readdressed = rewritten(exported, (snapshot) => { snapshot.scope('source-a').pulls[0].baseUrl = 'https://events.example/epcis'; });
    expect((await refusedRestore(readdressed)).code).toBe('snapshot-inconsistent');
    const restated = rewritten(exported, (snapshot) => { snapshot.scope('source-a').pulls[0].status = 'exhausted'; });
    expect((await refusedRestore(restated)).code).toBe('snapshot-inconsistent');
  });

  it('snapshot-inconsistent: a record of one source scope made to stand on a record of another', async () => {
    // Two scopes read from one endpoint hold the same page bytes, each under its own import.
    const { storage, server } = await build('memory');
    expect(ran(await pull(storage, sourceOf(server, { sourceId: 'source-c' }), AT)).outcome).toBe('ok');
    const shared = await takeSnapshot(storage);
    const [page] = await listEpcisPullPages(storage, epcisPullId('source-a', 'query-1'));
    const theirs = (await kindOf<EpcisImportRecord>(storage, 'import')).find((record) => record.sourceId === 'source-c' && record.sha256 === page!.sha256)!;
    // The first scope's page is pointed at the other scope's import of the same bytes. Every digest agrees and no import is missing.
    const joined = rewritten(shared, (snapshot) => { const path = snapshot.paths('pull-page').find((candidate) => snapshot.read(candidate).pullId === page!.pullId)!; snapshot.write(path, { ...snapshot.read(path), importId: theirs.importId }); });
    const refused = await refusedRestore(joined);
    expect(refused.code).toBe('snapshot-inconsistent');
    expect(refused.detail).toContain('Two source scopes are never joined because they hold the same bytes');
    const reassigned = rewritten(shared, (snapshot) => { const path = snapshot.paths('pull-page').find((candidate) => snapshot.read(candidate).pullId === page!.pullId)!; snapshot.write(path, { ...snapshot.read(path), sourceId: 'source-c' }); });
    expect(await refusedRestore(reassigned)).toMatchObject({ code: 'snapshot-inconsistent', detail: expect.stringContaining('Two source scopes are never joined') });

    // An observation one scope made, filed a second time under the scope that shares the event identifier: the other scope would gain a body it never received.
    await prepared();
    const scopeKey = epcisConflictId('source-b', 'event-id', SHARED_EVENT).split(':').at(-1)!;
    const borrowed = rewritten(exported, (snapshot) => {
      const from = snapshot.paths('observation').find((candidate) => { const record = snapshot.read(candidate); return record.sourceId === 'source-a' && record.identity === SHARED_EVENT && record.sequence === 2; })!;
      const to = `records/observation/${scopeKey}.0000000002.json`;
      snapshot.write(to, { ...snapshot.read(from), sourceId: 'source-b' });
      snapshot.descriptor.inventory.push({ path: to, kind: 'observation' });
      snapshot.scope('source-b').observations += 1;
    });
    expect(await refusedRestore(borrowed)).toMatchObject({ code: 'snapshot-inconsistent', breaches: expect.arrayContaining([expect.stringContaining('it is filed under the source scope "source-b" and names an import of "source-a"')]) });
  });

  it('snapshot-inconsistent: records that carry cursor material the descriptor says was left out, or a cursor no snapshot may carry', async () => {
    const { storage } = await build('memory');
    const carried = await takeSnapshot(storage, { cursors: 'include' });
    // The records of a snapshot that carries cursors, under a descriptor that says it carries none.
    const understated = rewritten(carried, (snapshot) => { snapshot.descriptor.cursors = 'excluded'; snapshot.scope('source-a').pulls[0].cursor = 'excluded'; snapshot.descriptor.omitted.push({ what: 'cursors', reason: 'excluded', count: 4 }); });
    const refused = await refusedRestore(understated);
    expect(refused.code).toBe('snapshot-inconsistent');
    expect(refused.breaches).toEqual(expect.arrayContaining([expect.stringContaining('the descriptor says its cursor is excluded, and its record carries one'), expect.stringContaining('its provenance carries a page token in a snapshot that excludes cursors'), expect.stringContaining('its pending page carries a page token in a snapshot that excludes cursors')]));
    // A cursor written back into a snapshot whose descriptor says it has none.
    const byDefault = await takeSnapshot(storage);
    const stored = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
    const slipped = rewritten(byDefault, (snapshot) => { const path = snapshot.paths('pull')[0]!; snapshot.write(path, { ...snapshot.read(path), cursor: stored.cursor }); });
    expect((await refusedRestore(slipped)).code).toBe('snapshot-inconsistent');
    // A cursor whose address holds a secret, in a snapshot that says cursors are carried: an export never writes one, and a restore never takes one.
    const signed = rewritten(carried, (snapshot) => { const path = snapshot.paths('pull')[0]!; const record = snapshot.read(path); record.cursor.target = `${record.cursor.target}&sig=${URL_SECRET}`; snapshot.write(path, record); });
    expect(await refusedRestore(signed)).toMatchObject({ code: 'snapshot-inconsistent', breaches: [expect.stringContaining('a cursor whose address holds more than the standard query parameters')] });
  });

  it('descriptor-missing and descriptor-invalid: no descriptor, or one that is not a format 1 descriptor', async () => {
    await prepared();
    const without = new Map(exported.files);
    without.delete('epcis/epcis-recovery.json');
    expect(await refusedRestore({ files: without, inventory: exported.inventory })).toMatchObject({ code: 'descriptor-missing', path: 'epcis/epcis-recovery.json' });
    expect((await refusedRestore(exported, { root: 'elsewhere' })).code).toBe('descriptor-missing');
    const replace = (text: string) => { const files = new Map(exported.files); files.set('epcis/epcis-recovery.json', utf8(text)); return { files, inventory: exported.inventory }; };
    expect((await refusedRestore(replace('not json'))).code).toBe('descriptor-invalid');
    const later = await refusedRestore(replace(JSON.stringify({ ...exported.descriptor, version: '2' })));
    expect(later.code).toBe('descriptor-invalid');
    expect(later.detail).toContain('`version` must be "1".');
    expect((await refusedRestore(replace(JSON.stringify({ ...exported.descriptor, snapshot: { ...exported.descriptor.snapshot, snapshotId: 'e'.repeat(64) } })))).code).toBe('descriptor-invalid');
  });

  it('relocation-invalid: a mapping of byte references that is not one to one', async () => {
    await prepared();
    expect((await refusedRestore(exported, { locate: () => 'the-same-place' })).code).toBe('relocation-invalid');
    expect((await refusedRestore(exported, { locate: () => '' })).code).toBe('relocation-invalid');
    expect((await refusedRestore(exported, { locate: () => { throw new Error('no room'); } })).detail).toContain('no room');
    // Two imports of the snapshot that name the same bytes by two references.
    const split = rewritten(exported, (snapshot) => { const path = snapshot.paths('import')[0]!; snapshot.write(path, { ...snapshot.read(path), bytesRef: 'store-a:first' }); snapshot.write(snapshot.paths('import')[1]!, { ...snapshot.read(snapshot.paths('import')[1]!), bytesRef: 'store-a:first' }); });
    expect((await refusedRestore(split)).code).toBe('relocation-invalid');
    await expect(restoreEpcisRecovery({ storage: undefined as never, source: epcisRecoveryFiles(exported.files), inventory: exported.inventory })).rejects.toThrow(TypeError);
  });
});

/* ----------------------------------- restore ------------------------------ */

describe.each(PAIRS)('the exit: exported from the %s adapter and restored into the %s adapter', (from, to) => {
  it('holds the same originals, the same records and a rebuilt index equal to the source\'s', async () => {
    const { storage: source } = await build(from);
    const sourceRecords = await dump(source, CARRIED);
    const sourceDerived = await dump(source, DERIVED);
    const exported = await takeSnapshot(source, { cursors: 'include' });
    const before = [...exported.files].map(([path, bytes]) => [path, sha256(bytes)]);

    const destination = await newStore(to);
    const restored = restoredOk(await restoreInto(destination.storage, exported));
    expect(restored.outcome).toBe('restored');
    expect(restored.snapshotId).toBe(exported.descriptor.snapshot.snapshotId);
    expect(restored.sourceIds).toEqual(['source-a', 'source-b']);
    expect(restored.written).toEqual({ originals: 5, imports: 5, observations: 13, resolutions: 1, pulls: 1, pullPages: 1 });
    expect(restored.unchanged).toEqual({ originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: 0, pullPages: 0 });

    // The same originals, byte for byte, read back from the destination under their digests and through each import.
    expect(await originalsOf(destination.storage)).toEqual(await originalsOf(source));
    for (const record of await kindOf<EpcisImportRecord>(source, 'import')) {
      const [there, here] = [await exportEpcisSource(source, record.importId), await exportEpcisSource(destination.storage, record.importId)];
      expect(Buffer.from(here!.bytes).equals(Buffer.from(there!.bytes))).toBe(true);
      expect([here!.sha256, here!.mediaType, here!.byteLength]).toEqual([there!.sha256, there!.mediaType, there!.byteLength]);
    }
    // The same records under the same keys. With the content address as the destination's reference and cursors carried, nothing differs at all.
    expect(await dump(destination.storage, CARRIED)).toEqual(sourceRecords);
    // What is derived was rebuilt, and is what the source had built as its sources arrived.
    expect(await dump(destination.storage, DERIVED)).toEqual(sourceDerived);
    expect(sourceDerived.filter((held) => held.kind === 'association').length).toBeGreaterThan(20);
    expect(restored.associations).toMatchObject({ importsRead: 5, importsIndexed: 5, associationsRemoved: 0 });
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
    expect(await dump(destination.storage, ['journal'])).toEqual([]);
    expect(await recoverEpcisExchange(destination.storage, { now: () => LATER })).toEqual({ actions: [], remaining: 0 });

    // The snapshot is unchanged, and the destination records which snapshot it holds and where each original went.
    expect([...exported.files].map(([path, bytes]) => [path, sha256(bytes)])).toEqual(before);
    const [record] = await listEpcisRestores(destination.storage);
    expect(record).toEqual(restored.restore);
    expect(record).toEqual({
      recordType: 'epcis-restore', recordVersion: '1', restoreId: epcisRestoreId(restored.snapshotId), snapshotId: restored.snapshotId, descriptorSha256: sha256(exported.files.get('epcis/epcis-recovery.json')!),
      snapshotTakenAt: AT, sourceIds: ['source-a', 'source-b'], cursors: 'included', counts: { originals: 5, imports: 5, observations: 13, resolutions: 1, pulls: 1, pullPages: 1 }, startedAt: LATER, restoredAt: LATER,
    });
    expect(validateRecord(record), JSON.stringify(validateRecord.errors)).toBe(true);
    const relocations = await listEpcisRelocations(destination.storage, restored.snapshotId);
    expect(relocations.map((relocation) => ({ sha256: relocation.sha256, byteLength: relocation.byteLength, exportedRef: relocation.exportedRef, path: `epcis/${relocation.path}`, destinationRef: relocation.destinationRef }))).toEqual(restored.relocations);
    for (const relocation of relocations) {
      expect(validateRecord(relocation), JSON.stringify(validateRecord.errors)).toBe(true);
      expect([relocation.exportedRef, relocation.destinationRef, relocation.path]).toEqual([`sha256:${relocation.sha256}`, `sha256:${relocation.sha256}`, `originals/${relocation.sha256}`]);
    }
    expect(relocations.length).toBe(5);
  });

  it('preserves identities, receipt times, provenance, decisions and query bounds, and never merges two scopes that share an event identifier', async () => {
    const { storage: source } = await build(from);
    const destination = await newStore(to);
    restoredOk(await restoreInto(destination.storage, await takeSnapshot(source)));

    for (const [sourceId, requestId] of [['source-a', 'first'], ['source-a', 'changed'], ['source-b', 'other']] as const) {
      const [there, here] = [(await findEpcisImportByRequest(source, sourceId, requestId))!, (await findEpcisImportByRequest(destination.storage, sourceId, requestId))!];
      expect(here).toEqual(there);
      expect([here.importId, here.requestId, here.requestDigest, here.receivedAt, here.policyId, here.profileRefs, here.sourceLocation]).toEqual([epcisImportId(sourceId, requestId), requestId, there.requestDigest, AT, 'test-policy@1', ['epcis-json@1'], { kind: 'file', filename: `${requestId}.jsonld` }]);
      expect(here.idempotency).toEqual({ scope: 'source', rule: 'request-digest-equal' });
    }
    // The decision, with its disposition, its time, who made it and both observations it decided between.
    const [there, here] = [(await getEpcisConflict(source, CONFLICT_ID))!, (await getEpcisConflict(destination.storage, CONFLICT_ID))!];
    expect(here).toEqual(there);
    expect(here.state).toBe('resolved');
    expect(here.observations.map((observation) => [observation.sequence, observation.arrival, observation.importId])).toEqual([[1, 'new', epcisImportId('source-a', 'first')], [2, 'conflict', epcisImportId('source-a', 'changed')]]);
    expect(here.resolutions).toEqual([expect.objectContaining({ decision: 'The later body stands.', disposition: 'body-selected', decidedAt: AT, decidedBy: 'reviewer', selectedBodyDigest: here.observations[1]!.bodyDigest, observations: [expect.objectContaining({ sequence: 1 }), expect.objectContaining({ sequence: 2 })] })]);
    expect((await findEpcisImportByRequest(destination.storage, 'source-a', 'changed'))!.state).toBe('evaluated');

    // The other scope holds the same event identifier as one event with one body. It is no part of the conflict and was not merged into it.
    expect(await getEpcisConflict(destination.storage, epcisConflictId('source-b', 'event-id', SHARED_EVENT))).toBeUndefined();
    const observations = (await kindOf(destination.storage, 'observation')).filter((observation) => observation.identity === SHARED_EVENT);
    expect(observations.map((observation) => [observation.sourceId, observation.sequence]).sort()).toEqual([['source-a', 1], ['source-a', 2], ['source-b', 1]]);
    const byScope = async (sourceId: string): Promise<string[]> => (await findEpcisAssociations(destination.storage, { identifier: PACK, granularity: 'instance', sourceId })).associations.filter((association) => association.identity === SHARED_EVENT).map((association) => association.importId);
    expect(await byScope('source-a')).toEqual(expect.arrayContaining([epcisImportId('source-a', 'first'), epcisImportId('source-a', 'changed')]));
    expect(await byScope('source-b')).toEqual([epcisImportId('source-b', 'other')]);

    // The pull: its identity, the query and its bounds, the limits, the run and the pass, the page that was pending and the pages acknowledged.
    const [pulledThere, pulledHere] = [(await getEpcisPull(source, 'source-a', 'query-1'))!, (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!];
    expect(pulledHere).toEqual(withoutCursors({ kind: 'pull', key: '', value: pulledThere as unknown as JsonObject }).value);
    expect([pulledHere.pullId, pulledHere.definitionDigest, pulledHere.query, pulledHere.pass.parameters, pulledHere.limits, pulledHere.status, pulledHere.pagesAcknowledged, pulledHere.pending?.page]).toEqual([epcisPullId('source-a', 'query-1'), pulledThere.definitionDigest, { perPage: 2 }, { perPage: '2' }, pulledThere.limits, 'running', 1, 2]);
    expect(pulledHere.source.credentialsConfigured).toBe(true);
    expect(await listEpcisPullPages(destination.storage, pulledHere.pullId)).toEqual(await listEpcisPullPages(source, pulledThere.pullId));
    // The default snapshot leaves cursors out, and that is the one difference in the records.
    expect(await dump(destination.storage, CARRIED)).toEqual((await dump(source, CARRIED)).map(withoutCursors));
    expect((await listEpcisRestores(destination.storage))[0]!.cursors).toBe('excluded');
  });

  it('relocates byte references through a checked mapping, changes nothing else, and records where each original went', async () => {
    const { storage: source } = await build(from);
    const exported = await takeSnapshot(source, { cursors: 'include' });
    const destination = await newStore(to);
    const located: Array<{ sha256: string; byteLength: number; exportedRef: string }> = [];
    const restored = restoredOk(await restoreInto(destination.storage, exported, { locate: (original) => { located.push(original); return `vault-b:${original.sha256.slice(0, 2)}/${original.sha256}`; } }));
    expect(located.map((original) => original.exportedRef)).toEqual(located.map((original) => `sha256:${original.sha256}`));

    const there = await dump(source, CARRIED);
    const here = await dump(destination.storage, CARRIED);
    // Everything but the reference is as it was: the one member that says where a store keeps bytes.
    expect(here.map((held) => (held.kind === 'import' ? { ...held, value: { ...held.value, bytesRef: `sha256:${String(held.value.sha256)}` } } : held))).toEqual(there);
    for (const held of here.filter((record) => record.kind === 'import')) expect(held.value.bytesRef).toBe(`vault-b:${String(held.value.sha256).slice(0, 2)}/${String(held.value.sha256)}`);
    expect(restored.relocations).toEqual(located.map((original) => ({ ...original, path: `epcis/originals/${original.sha256}`, destinationRef: `vault-b:${original.sha256.slice(0, 2)}/${original.sha256}` })));
    expect((await listEpcisRelocations(destination.storage, restored.snapshotId)).map((relocation) => relocation.destinationRef)).toEqual(restored.relocations.map((relocation) => relocation.destinationRef));
    // The bytes are where the store keeps them whatever the reference says, and they are the exported bytes.
    expect(await originalsOf(destination.storage)).toEqual(await originalsOf(source));
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
    // The exported snapshot still names its bytes its own way.
    for (const entry of exported.descriptor.inventory.filter((file) => file.kind === 'import')) expect(JSON.parse(new TextDecoder().decode(exported.files.get(`epcis/${entry.path}`)!)).bytesRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The same snapshot under another mapping is not the same restore: it collides, and nothing is overwritten.
    const again = refusal(await restoreInto(destination.storage, exported));
    expect(again.code).toBe('reconciliation-required');
    expect(new Set(again.collisions!.map((collision) => collision.kind))).toEqual(new Set(['relocation', 'import']));
    expect(await dump(destination.storage, CARRIED)).toEqual(here);
  });

  it('answers a retry of an acknowledged request with the same import and no new receipt, and still refuses the request with other bytes', async () => {
    const { storage: source } = await build(from);
    const destination = await newStore(to);
    restoredOk(await restoreInto(destination.storage, await takeSnapshot(source)));
    const before = await dump(destination.storage);
    const acknowledged = (await findEpcisImportByRequest(source, 'source-a', 'first'))!;

    // The same request again, as a client that never heard the answer would send it, at a later time.
    const counting = faultInjectingEpcisStorage(destination.storage);
    const retried = await fileImport(counting.storage, 'source-a', 'first', FIRST, LATER);
    expect(retried).toEqual({ outcome: 'retained', replayed: true, resumed: false, record: acknowledged });
    expect(counting.calls(), 'a retry writes nothing: no receipt, no observation, no index entry').toEqual([]);
    expect(await dump(destination.storage)).toEqual(before);
    expect((await listEpcisImports(destination.storage, { limit: 100 })).length).toBe(5);

    // The same request identifier with other bytes conflicts, and the restored import stands.
    const conflicting = await fileImport(destination.storage, 'source-a', 'first', CHANGED, LATER);
    expect(conflicting).toMatchObject({ outcome: 'request-conflict', existingImportId: acknowledged.importId, existingRequestDigest: acknowledged.requestDigest });
    expect(await dump(destination.storage)).toEqual(before);
    // Under the other scope the same request identifier was never used: it is a new request there, not a retry of this one.
    const elsewhere = await fileImport(destination.storage, 'source-b', 'first', FIRST, LATER);
    expect(elsewhere).toMatchObject({ outcome: 'retained', replayed: false, record: { importId: epcisImportId('source-b', 'first'), receivedAt: LATER } });
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
  });

  it('resumes the interrupted pull after credentials are provisioned again, replaying from its bounds without skipping a page or starting a new source', async () => {
    const { storage: source, server } = await build(from);
    const destination = await newStore(to);
    restoredOk(await restoreInto(destination.storage, await takeSnapshot(source)));
    const requestsBefore = server.pageRequests().length;

    // No credential travelled with the snapshot. Until the operator configures one, the source refuses, and nothing is lost by asking.
    const unauthenticated = ran(await pull(destination.storage, sourceOf(server, { credentials: undefined })));
    expect([unauthenticated.outcome, unauthenticated.reason]).toEqual(['source-authentication-required', 'http-401']);
    // The page that was retained and not acknowledged is acknowledged from its receipt, without asking the source for it again.
    expect(unauthenticated.pages.map((page) => [page.sequence, page.page, page.importReplayed])).toEqual([[2, 2, false]]);
    expect(unauthenticated.replay).toMatchObject({ reason: 'cursor-missing', pagesAcknowledgedBefore: 2 });

    const resumed = ran(await pull(destination.storage, sourceOf(server)));
    expect([resumed.outcome, resumed.reason, resumed.exhausted, resumed.run.resumed]).toEqual(['ok', 'exhausted', true, true]);
    // From the retained bounds: the two pages already held are recognised as they arrive again, and the two that were never read are read.
    expect(resumed.pages.map((page) => [page.sequence, page.attempt, page.page, page.importReplayed])).toEqual([[3, 2, 1, true], [4, 2, 2, true], [5, 2, 3, false], [6, 2, 4, false]]);
    expect(server.pageRequests().slice(requestsBefore + 1).map((request) => request.query.nextPageToken == null)).toEqual([true, false, false, false]);
    expect(resumed.events).toEqual({ total: 7, new: 3, duplicate: 4, newObservation: 0, conflict: 0 });

    // The same logical source and the same pull, and every event of the source held exactly once.
    const pulled = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    expect([pulled.pullId, pulled.status, pulled.pagesAcknowledged, pulled.pass.attempt]).toEqual([epcisPullId('source-a', 'query-1'), 'exhausted', 6, 2]);
    expect((await dump(destination.storage, ['pull'])).length).toBe(1);
    const fromPull = (await kindOf(destination.storage, 'observation')).filter((observation) => String(observation.identity).startsWith('urn:uuid:00000000-0000-4000-8000-00000000010'));
    expect(fromPull.map((observation) => [observation.sourceId, observation.sequence])).toEqual(Array.from({ length: 7 }, () => ['source-a', 1]));
    expect((await listEpcisImports(destination.storage, { limit: 100 })).length).toBe(7);
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
    // Nothing the credential touched was written.
    expect(JSON.stringify(await dump(destination.storage))).not.toContain(SECRET);
  });

  it('resumes from a carried cursor at the same endpoint, and replays when the cursor has expired', async () => {
    const live = await build(from);
    const liveDestination = await newStore(to);
    restoredOk(await restoreInto(liveDestination.storage, await takeSnapshot(live.storage, { cursors: 'include' })));
    const requestsBefore = live.server.pageRequests().length;
    const resumed = ran(await pull(liveDestination.storage, sourceOf(live.server)));
    expect([resumed.outcome, resumed.reason, resumed.replay]).toEqual(['ok', 'exhausted', undefined]);
    // No page is asked for twice: the pending page is finished from its receipt and the cursor it named leads to the third.
    expect(resumed.pages.map((page) => [page.sequence, page.attempt, page.page, page.importReplayed])).toEqual([[2, 1, 2, false], [3, 1, 3, false], [4, 1, 4, false]]);
    expect(live.server.pageRequests().slice(requestsBefore).every((request) => request.query.nextPageToken != null)).toBe(true);
    expect(live.server.pageRequests().length - requestsBefore).toBe(2);

    const stale = await build(from, { tokenTtlSeconds: 60 });
    // Time passes at the source as it does for the operator: the cursor it issued at the time of the export has run out by the time of the restore.
    stale.server.behaviour.clock = () => Date.parse(LATER);
    const staleDestination = await newStore(to);
    const exported = await takeSnapshot(stale.storage, { cursors: 'include' });
    restoredOk(await restoreInto(staleDestination.storage, exported));
    expect((await getEpcisPull(staleDestination.storage, 'source-a', 'query-1'))!.cursor!.expiresAt).toBe('2026-03-10T00:01:00.000Z');
    const replayed = ran(await pull(staleDestination.storage, sourceOf(stale.server)));
    expect([replayed.outcome, replayed.reason, replayed.replay?.reason]).toEqual(['ok', 'exhausted', 'cursor-expired']);
    expect(replayed.pages.map((page) => [page.page, page.importReplayed])).toEqual([[2, false], [1, true], [2, true], [3, false], [4, false]]);
    expect((await listEpcisImports(staleDestination.storage, { limit: 100 })).length).toBe(7);
    expect(await checkEpcisExchangeInvariants(staleDestination.storage, { associations: true })).toEqual([]);
  });

  it('keeps the logical source when its operator declares the same source at another endpoint, and holds a cursor to the permitted origins', async () => {
    const { storage: source, server: old } = await build(from);
    const destination = await newStore(to);
    restoredOk(await restoreInto(destination.storage, await takeSnapshot(source, { cursors: 'include' })));
    const moved = await serve();
    const before = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    expect(new URL(before.cursor!.target).origin).toBe(old.origin);

    // Pointing the same query name at another address without saying so is refused: nothing lets a name drift onto another source.
    expect(await pull(destination.storage, sourceOf(moved))).toMatchObject({ outcome: 'refused', reason: 'pull-conflict' });
    expect(await getEpcisPull(destination.storage, 'source-a', 'query-1')).toEqual(before);

    const remap = { storage: destination.storage, sourceId: 'source-a', baseUrl: moved.baseUrl, permittedOrigins: [moved.origin], localTest: true, remappedAt: LATER, remappedBy: 'operator', now: () => LATER };
    const remapped = await remapEpcisSourceEndpoint(remap);
    const after = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    // The cursor names an address at the old origin, which the new configuration does not permit. It is dropped, never sent.
    expect(remapped).toEqual({ outcome: 'remapped', sourceId: 'source-a', pulls: [{ pullId: before.pullId, queryId: 'query-1', changed: true, from: { baseUrl: old.baseUrl, definitionDigest: before.definitionDigest }, to: { baseUrl: moved.baseUrl, definitionDigest: after.definitionDigest }, cursor: 'dropped' }] });
    expect(after).toEqual({ ...before, definitionDigest: after.definitionDigest, source: { ...before.source, baseUrl: moved.baseUrl, permittedOrigins: [moved.origin] }, cursor: undefined, pending: { ...before.pending, next: undefined }, endpointRemaps: [{ remappedAt: LATER, remappedBy: 'operator', from: { baseUrl: old.baseUrl, definitionDigest: before.definitionDigest }, to: { baseUrl: moved.baseUrl, definitionDigest: after.definitionDigest }, cursor: 'dropped' }], updatedAt: LATER });
    expect(after.definitionDigest).not.toBe(before.definitionDigest);
    expect(validateRecord(JSON.parse(JSON.stringify(after))), JSON.stringify(validateRecord.errors)).toBe(true);
    // Declared twice, it is declared once.
    expect(await remapEpcisSourceEndpoint(remap)).toMatchObject({ outcome: 'remapped', pulls: [{ changed: false }] });
    expect((await getEpcisPull(destination.storage, 'source-a', 'query-1'))!.endpointRemaps!.length).toBe(1);

    const oldRequests = old.pageRequests().length;
    const resumed = ran(await pull(destination.storage, sourceOf(moved)));
    expect([resumed.outcome, resumed.reason, resumed.replay?.reason]).toEqual(['ok', 'exhausted', 'cursor-missing']);
    expect(old.pageRequests().length, 'nothing was asked of the old endpoint').toBe(oldRequests);
    expect(moved.pageRequests().length).toBe(4);
    // One source scope and one pull, as before. Each import says where it was really read from.
    const pulled = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    expect([pulled.pullId, pulled.sourceId, pulled.status, pulled.pagesAcknowledged]).toEqual([before.pullId, 'source-a', 'exhausted', 6]);
    expect((await dump(destination.storage, ['pull'])).length).toBe(1);
    const pages = (await kindOf<EpcisImportRecord>(destination.storage, 'import')).filter((record) => record.sourceLocation.kind === 'query');
    expect(new Set(pages.map((record) => record.sourceId))).toEqual(new Set(['source-a']));
    expect(pages.map((record) => record.sourceLocation.kind === 'query' && [record.sourceLocation.page, record.sourceLocation.origin]).sort()).toEqual([[1, old.origin], [2, old.origin], [3, moved.origin], [4, moved.origin]]);
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
    // The record of the move travels with the pull in a later snapshot.
    expect((await takeSnapshot(destination.storage)).descriptor.scopes[0]!.pulls[0]).toMatchObject({ baseUrl: moved.baseUrl, definitionDigest: after.definitionDigest, status: 'exhausted' });

    expect(await remapEpcisSourceEndpoint({ ...remap, sourceId: 'source-b' })).toMatchObject({ outcome: 'refused', reason: 'no-pull' });
    expect(await remapEpcisSourceEndpoint({ ...remap, baseUrl: `http://operator:${SECRET}@127.0.0.1:1/epcis` })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await remapEpcisSourceEndpoint({ ...remap, permittedOrigins: [] })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await remapEpcisSourceEndpoint({ ...remap, remappedAt: 'yesterday' })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
  });

  it('never merges two source scopes that are read from the same endpoint', async () => {
    const { storage: source, server } = await build(from);
    // A second configured source at the same address, run to its end. Its pages are the same bytes as the first scope's.
    expect(ran(await pull(source, sourceOf(server, { sourceId: 'source-c' }), AT)).outcome).toBe('ok');
    const exported = await takeSnapshot(source);
    expect(exported.descriptor.scopes.map((scope) => [scope.sourceId, scope.originals, scope.imports, scope.pulls.map((held) => [held.baseUrl, held.status, held.pagesAcknowledged])])).toEqual([
      ['source-a', 4, 4, [[server.baseUrl, 'running', 1]]],
      ['source-b', 1, 1, []],
      ['source-c', 4, 4, [[server.baseUrl, 'exhausted', 4]]],
    ]);
    // Bytes two scopes share are carried once, and each scope's import of them is its own record.
    expect(exported.descriptor.inventory.filter((entry) => entry.kind === 'original').length).toBe(7);
    expect(exported.descriptor.inventory.filter((entry) => entry.kind === 'import').length).toBe(9);

    const destination = await newStore(to);
    expect(restoredOk(await restoreInto(destination.storage, exported)).written).toMatchObject({ originals: 7, imports: 9, pulls: 2, pullPages: 5 });
    expect(await dump(destination.storage, [...CARRIED, ...DERIVED])).toEqual([...(await dump(source, CARRIED)).map(withoutCursors), ...(await dump(source, DERIVED))]);
    const [first, third] = [(await getEpcisPull(destination.storage, 'source-a', 'query-1'))!, (await getEpcisPull(destination.storage, 'source-c', 'query-1'))!];
    expect(first.pullId).not.toBe(third.pullId);
    expect([first.source.baseUrl, first.pagesAcknowledged, third.source.baseUrl, third.pagesAcknowledged]).toEqual([server.baseUrl, 1, server.baseUrl, 4]);

    // The first scope's pull finishes under its own scope. What the other scope holds of the same pages is not taken for its own.
    const resumed = ran(await pull(destination.storage, sourceOf(server)));
    expect(resumed.pages.map((page) => [page.page, page.importReplayed])).toEqual([[2, false], [1, true], [2, true], [3, false], [4, false]]);
    expect((await getEpcisPull(destination.storage, 'source-c', 'query-1'))).toEqual(third);
    const pages = (await kindOf<EpcisImportRecord>(destination.storage, 'import')).filter((record) => record.sourceLocation.kind === 'query');
    expect(pages.map((record) => record.sourceId).sort()).toEqual(['source-a', 'source-a', 'source-a', 'source-a', 'source-c', 'source-c', 'source-c', 'source-c']);
    const observed = (await kindOf(destination.storage, 'observation')).filter((observation) => String(observation.identity).startsWith('urn:uuid:00000000-0000-4000-8000-00000000010'));
    expect(observed.map((observation) => [observation.sourceId, observation.sequence]).sort()).toEqual([...Array.from({ length: 7 }, () => ['source-a', 1]), ...Array.from({ length: 7 }, () => ['source-c', 1])]);
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
  });

  it('keeps a cursor whose origin the new configuration still permits, and uses it', async () => {
    const { storage: source, server: old } = await build(from, { open: true });
    const destination = await newStore(to);
    restoredOk(await restoreInto(destination.storage, await takeSnapshot(source, { cursors: 'include' })));
    const moved = await serve({ requireAuthorization: undefined });
    const remapped = await remapEpcisSourceEndpoint({ storage: destination.storage, sourceId: 'source-a', baseUrl: moved.baseUrl, permittedOrigins: [moved.origin, old.origin], localTest: true, remappedAt: LATER, now: () => LATER });
    expect(remapped).toMatchObject({ outcome: 'remapped', pulls: [{ changed: true, cursor: 'kept' }] });
    const oldRequests = old.pageRequests().length;
    const resumed = ran(await pull(destination.storage, sourceOf(moved, { permittedOrigins: [moved.origin, old.origin], credentials: undefined })));
    expect([resumed.outcome, resumed.reason, resumed.replay]).toEqual(['ok', 'exhausted', undefined]);
    // The cursor's address is at the old origin, which is still permitted: the remaining pages are read there.
    expect(old.pageRequests().length - oldRequests).toBe(2);
    expect(moved.pageRequests().length).toBe(0);
  });
});

describe('a carried cursor at the destination', () => {
  it('is never requested when its origin is not one the destination permits, and is dropped when the operator declares the configuration', async () => {
    const { storage: source, server } = await build('memory');
    const stranger = await serve();
    // A snapshot whose cursors lead somewhere the destination's operator never permitted. Every digest agrees, so only the check before a request can stop it.
    const elsewhere = (target: string): string => target.replace(server.origin, stranger.origin);
    const redirected = rewritten(await takeSnapshot(source, { cursors: 'include' }), (snapshot) => {
      const path = snapshot.paths('pull')[0]!;
      const record = snapshot.read(path);
      record.cursor.target = elsewhere(record.cursor.target);
      record.pending.next.target = elsewhere(record.pending.next.target);
      snapshot.write(path, record);
    });
    const destination = await newStore('file');
    restoredOk(await restoreInto(destination.storage, redirected));
    expect(new URL((await getEpcisPull(destination.storage, 'source-a', 'query-1'))!.pending!.next!.target).origin).toBe(stranger.origin);

    for (const attempt of [1, 2]) {
      const stopped = ran(await pull(destination.storage, sourceOf(server)));
      expect([stopped.outcome, stopped.reason], `run ${attempt}`).toEqual(['partial-history', 'pagination-target-refused']);
      // The page that was retained is acknowledged from its receipt in the first run. Nothing further is read, and nothing is skipped.
      expect(stopped.pages.map((page) => page.sequence), `run ${attempt}`).toEqual(attempt === 1 ? [2] : []);
    }
    expect(stranger.pageRequests().length, 'nothing was asked of the origin that is not permitted').toBe(0);
    expect(server.pageRequests().every((request) => request.headers.authorization === `Bearer ${SECRET}`)).toBe(true);

    // The operator declares where the source is reached and which origins are permitted. The address is the one the pull is bound to; the cursor is not permitted, so it goes.
    const declaration = { storage: destination.storage, sourceId: 'source-a', baseUrl: server.baseUrl, permittedOrigins: [server.origin], localTest: true, remappedAt: LATER, now: () => LATER };
    const before = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    const declared = await remapEpcisSourceEndpoint(declaration);
    expect(declared).toEqual({ outcome: 'remapped', sourceId: 'source-a', pulls: [{ pullId: before.pullId, queryId: 'query-1', changed: true, from: { baseUrl: server.baseUrl, definitionDigest: before.definitionDigest }, to: { baseUrl: server.baseUrl, definitionDigest: before.definitionDigest }, cursor: 'dropped' }] });
    const after = (await getEpcisPull(destination.storage, 'source-a', 'query-1'))!;
    expect([after.cursor, after.definitionDigest, after.pagesAcknowledged, after.endpointRemaps?.length]).toEqual([undefined, before.definitionDigest, 2, 1]);
    expect(validateRecord(JSON.parse(JSON.stringify(after))), JSON.stringify(validateRecord.errors)).toBe(true);
    expect(await remapEpcisSourceEndpoint(declaration)).toMatchObject({ outcome: 'remapped', pulls: [{ changed: false, cursor: 'none' }] });

    const resumed = ran(await pull(destination.storage, sourceOf(server)));
    expect([resumed.outcome, resumed.reason, resumed.replay?.reason]).toEqual(['ok', 'exhausted', 'cursor-missing']);
    expect(resumed.pages.map((page) => [page.page, page.importReplayed])).toEqual([[1, true], [2, true], [3, false], [4, false]]);
    expect(stranger.pageRequests().length).toBe(0);
    expect((await listEpcisImports(destination.storage, { limit: 100 })).length).toBe(7);
    expect(await checkEpcisExchangeInvariants(destination.storage, { associations: true })).toEqual([]);
  });
});

/* ------------------------- repeats, crashes and collisions ---------------- */

describe.each(PAIRS)('restoring more than once: from the %s adapter into the %s adapter', (from, to) => {
  it('is a no-op the second time, and writes nothing', async () => {
    const { storage: source } = await build(from);
    const exported = await takeSnapshot(source);
    const destination = await newStore(to);
    const first = restoredOk(await restoreInto(destination.storage, exported));
    const before = await dump(destination.storage);
    const counting = faultInjectingEpcisStorage(destination.storage);
    const second = restoredOk(await restoreInto(counting.storage, exported, { now: () => '2026-04-01T00:00:00.000Z' }));
    expect(second).toEqual({ ok: true, outcome: 'unchanged', snapshotId: first.snapshotId, sourceIds: first.sourceIds, written: { originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: 0, pullPages: 0 }, unchanged: first.written, relocations: first.relocations, restore: first.restore });
    expect(counting.calls()).toEqual([]);
    expect(await dump(destination.storage)).toEqual(before);
    // Into the store it was taken from, a snapshot that carries its cursors finds every record already there and adds only the record of the restore.
    const revisions = async (kind: string): Promise<Array<[string, number]>> => (await source.list(kind, { limit: 200 })).map((held) => [held.key, held.revision]);
    const untouched = [await revisions('import'), await revisions('retention'), await revisions('observation'), await revisions('pull')];
    const home = restoredOk(await restoreInto(source, await takeSnapshot(source, { cursors: 'include' })));
    expect([home.outcome, home.written]).toEqual(['restored', { originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: 0, pullPages: 0 }]);
    // Equal records were not written again, the entries that say which import retains which bytes among them.
    expect([await revisions('import'), await revisions('retention'), await revisions('observation'), await revisions('pull')]).toEqual(untouched);
    expect(await checkEpcisExchangeInvariants(source, { associations: true })).toEqual([]);
  });

  it('resumes to the same store after a crash before or after any durable call', async () => {
    const { storage: source } = await build(from);
    const exported = await takeSnapshot(source);
    const everything = async (storage: EpcisExchangeStorage): Promise<unknown> => [await dump(storage), [...(await originalsOf(storage))]];

    // The uninterrupted restore is the measure: the store it leaves, and how many durable calls it made.
    const control = await newStore(to);
    const counting = faultInjectingEpcisStorage(control.storage);
    expect(restoredOk(await restoreInto(counting.storage, exported)).outcome).toBe('restored');
    const steps = counting.calls();
    const controlStore = await everything(control.storage);
    expect(steps.filter((step) => step === 'putBytes').length).toBe(5);
    expect(steps.length).toBeGreaterThanOrEqual(20);

    for (let at = 1; at <= steps.length; at += 1) {
      for (const when of ['before', 'after'] as const) {
        const where = `${when} durable call ${at} of ${steps.length} (${steps[at - 1]})`;
        const destination = await newStore(to);
        await expect(restoreInto(faultInjectingEpcisStorage(destination.storage, { at, when }).storage, exported), where).rejects.toBeInstanceOf(EpcisStorageFault);
        const reopened = await destination.reopen();
        const journalled = (await dump(reopened, ['journal'])).map((held) => held.value.entry);
        if (journalled.includes('restore')) {
          // An unfinished restore is visible: the store says so, a snapshot of it is refused, and recovery leaves the restore to be run again.
          expect((await checkEpcisExchangeInvariants(reopened)).some((breach) => breach.endsWith(': unfinished restore')), where).toBe(true);
          expect(refusal(await exportEpcisRecovery({ storage: reopened })).code, where).toBe('unfinished-work');
          expect((await listEpcisRestores(reopened)).length, where).toBe(0);
          if (at % 2 === 0) {
            const recovery = await recoverEpcisExchange(reopened, { now: () => LATER });
            expect(recovery.actions.filter((action) => action.action === 'restore-pending'), where).toEqual([{ action: 'restore-pending', snapshotId: exported.descriptor.snapshot.snapshotId }]);
            expect(recovery.remaining, where).toBe(1);
          }
        }
        const again = restoredOk(await restoreInto(reopened, exported));
        expect(again.outcome, where).toBe(journalled.includes('restore') ? 'resumed' : journalled.length === 0 && at === steps.length && when === 'after' ? 'unchanged' : 'restored');
        expect(await everything(reopened), where).toEqual(controlStore);
        expect(await checkEpcisExchangeInvariants(reopened, { associations: true }), where).toEqual([]);
        expect(await recoverEpcisExchange(reopened, { now: () => LATER }), where).toEqual({ actions: [], remaining: 0 });
      }
    }
  }, 300_000);

  it('never overwrites a destination record that differs: it stops before writing and says what collides', async () => {
    const { storage: source } = await build(from);
    const exported = await takeSnapshot(source);

    // The destination already acknowledged another document under the same source scope and request identifier.
    const taken = await newStore(to);
    expect((await fileImport(taken.storage, 'source-a', 'first', OTHER, LATER)).outcome).toBe('retained');
    const before = [await dump(taken.storage), [...(await originalsOf(taken.storage))]];
    const refused = refusal(await restoreInto(taken.storage, exported));
    expect(refused.code).toBe('reconciliation-required');
    expect(refused.collisions).toContainEqual({ kind: 'import', identity: epcisImportId('source-a', 'first'), reason: 'request-bound-to-other-bytes', sourceId: 'source-a' });
    // The event both documents carry is also held there already, as another observation of it.
    expect(refused.collisions!.filter((collision) => collision.kind === 'observation')).toEqual([expect.objectContaining({ reason: 'record-differs', sourceId: 'source-a' })]);
    expect([await dump(taken.storage), [...(await originalsOf(taken.storage))]]).toEqual(before);
    expect((await findEpcisImportByRequest(taken.storage, 'source-a', 'first'))!.sha256).toBe(sha256(OTHER));

    // A destination that has moved on since the snapshot: its pull is further along than the snapshot's.
    const ahead = await build(to);
    const snapshot = await takeSnapshot(ahead.storage, { cursors: 'include' });
    expect(ran(await pull(ahead.storage, sourceOf(ahead.server))).outcome).toBe('ok');
    const moved = await dump(ahead.storage);
    const stale = refusal(await restoreInto(ahead.storage, snapshot));
    expect(stale.code).toBe('reconciliation-required');
    expect(stale.collisions).toEqual([{ kind: 'pull', identity: epcisPullId('source-a', 'query-1'), reason: 'record-differs', sourceId: 'source-a' }]);
    expect(await dump(ahead.storage)).toEqual(moved);
  });

  it('restores beside another source scope without touching it, and refuses a destination with unfinished work', async () => {
    const { storage: source } = await build(from);
    const exported = await takeSnapshot(source);

    // A destination that already serves another source which uses the same event identifier and the same request identifier.
    const shared = await newStore(to);
    const theirs = await fileImport(shared.storage, 'source-c', 'first', CHANGED, LATER);
    expect(theirs.outcome).toBe('retained');
    const before = (await dump(shared.storage, CARRIED)).filter((held) => held.value.sourceId === 'source-c');
    restoredOk(await restoreInto(shared.storage, exported));
    expect((await dump(shared.storage, CARRIED)).filter((held) => held.value.sourceId === 'source-c')).toEqual(before);
    expect((await kindOf(shared.storage, 'observation')).filter((observation) => observation.identity === SHARED_EVENT).map((observation) => [observation.sourceId, observation.sequence]).sort()).toEqual([['source-a', 1], ['source-a', 2], ['source-b', 1], ['source-c', 1]]);
    expect(await getEpcisConflict(shared.storage, epcisConflictId('source-c', 'event-id', SHARED_EVENT))).toBeUndefined();
    expect(await checkEpcisExchangeInvariants(shared.storage, { associations: true })).toEqual([]);

    const busy = await newStore(to);
    await expect(fileImport(faultInjectingEpcisStorage(busy.storage, { at: 3, when: 'after' }).storage, 'source-c', 'stopped', FIRST)).rejects.toBeInstanceOf(EpcisStorageFault);
    const reopened = await busy.reopen();
    const held = await dump(reopened);
    expect(refusal(await restoreInto(reopened, exported))).toMatchObject({ code: 'destination-unfinished-work', breaches: [expect.stringMatching(/^import\.[0-9a-f]{64}: unfinished import$/)] });
    expect(await dump(reopened)).toEqual(held);
    expect((await recoverEpcisExchange(reopened, { now: () => LATER })).remaining).toBe(0);
    expect(restoredOk(await restoreInto(reopened, exported)).outcome).toBe('restored');
  });
});

describe('the records a restore keeps', () => {
  it('holds the journal entry of an unfinished restore to the exchange records contract', async () => {
    const { storage: source } = await build('memory');
    const exported = await takeSnapshot(source);
    const state = createMemoryEpcisState();
    await expect(restoreInto(faultInjectingEpcisStorage(createMemoryEpcisStorage(state), { at: 1, when: 'after' }).storage, exported)).rejects.toBeInstanceOf(EpcisStorageFault);
    const [entry] = await dump(createMemoryEpcisStorage(state), ['journal']);
    expect(entry!.value).toEqual({ recordType: 'epcis-journal', recordVersion: '1', entry: 'restore', snapshotId: exported.descriptor.snapshot.snapshotId, startedAt: LATER });
    expect(validateRecord(entry!.value), JSON.stringify(validateRecord.errors)).toBe(true);
    expect(validateRecord({ recordType: 'epcis-journal', recordVersion: '1', entry: 'restore', startedAt: LATER })).toBe(false);
    expect(validateRecord({ recordType: 'epcis-restore', recordVersion: '1' })).toBe(false);
    expect(validateRecord({ recordType: 'epcis-relocation', recordVersion: '2', snapshotId: 'a'.repeat(64), sha256: 'b'.repeat(64), byteLength: 1, exportedRef: 'x', path: 'originals/x', destinationRef: 'y' })).toBe(false);
  });
});
