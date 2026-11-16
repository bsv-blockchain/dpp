import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { CBV_VERSION, EPCIS_DEFAULT_LIMITS, EPCIS_VERSION } from '../src/epcis-source.js';
import {
  CBV_WIRE_VERSION,
  EPCIS_PULL_LIMIT_CEILINGS,
  EPCIS_PULL_REASON_OUTCOME,
  EPCIS_RECORD_KINDS,
  EPCIS_WIRE_VERSION,
  EpcisStorageFault,
  checkEpcisExchangeInvariants,
  createMemoryEpcisState,
  createMemoryEpcisStorage,
  epcisConflictId,
  epcisPullId,
  epcisQueryParameters,
  exportEpcisSource,
  faultInjectingEpcisStorage,
  getEpcisConflict,
  getEpcisImport,
  getEpcisPull,
  isPrivateHost,
  listEpcisImports,
  listEpcisPullPages,
  openFileEpcisStorage,
  parseNextLink,
  pullEpcisEvents,
  recoverEpcisExchange,
  type EpcisExchangeStorage,
  type EpcisFetch,
  type EpcisPullLogEntry,
  type EpcisPullOutcome,
  type EpcisPullResult,
  type EpcisPullSource,
  type EpcisSourceCredential,
  type FileEpcisStorage,
  type PullEpcisEventsInput,
} from '../src/epcis-exchange.js';
import type { JsonObject } from '../src/types.js';
import { pullEvent, pullEventId, pullEvents, pullItem, pullTime, startEpcisFixtureServer, type FixtureBehaviour, type FixtureServer } from './epcis-pull-server.js';

const AT = '2026-03-10T00:00:00.000Z';
/** The credential every test configures. Nothing durable, returned or logged may ever contain it, in any form. */
const SECRET = 'correct-horse-battery-staple-9f3b';
const SECRET_FORMS = [SECRET, encodeURIComponent(SECRET), Buffer.from(`operator:${SECRET}`).toString('base64')];
const bearer = (): EpcisSourceCredential => ({ scheme: 'bearer', token: SECRET });

const realFetch: EpcisFetch = (url, init) => fetch(url, init);

const folders: string[] = [];
const servers: FixtureServer[] = [];
const opened: FileEpcisStorage[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const storage of opened.splice(0)) await storage.abandon();
});
afterAll(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });

async function serve(events: JsonObject[] = [], behaviour: Partial<FixtureBehaviour> = {}): Promise<FixtureServer> {
  const server = await startEpcisFixtureServer(events, behaviour);
  servers.push(server);
  return server;
}

/** A store, and the same store opened again as a restarted process would open it. */
interface Store {
  storage: EpcisExchangeStorage;
  reopen(): Promise<EpcisExchangeStorage>;
  /** Everything durable, as text: every record of every kind, and the retained bytes. */
  everything(): Promise<string>;
}

const stores: Array<[string, () => Promise<Store>]> = [
  ['the in-memory adapter', async () => {
    const state = createMemoryEpcisState();
    return {
      storage: createMemoryEpcisStorage(state),
      reopen: async () => createMemoryEpcisStorage(state),
      everything: async () => JSON.stringify([[...state.records].map(([kind, table]) => [kind, [...table]]), [...state.bytes].map(([digest, bytes]) => [digest, Buffer.from(bytes).toString('latin1')])]),
    };
  }],
  ['the file-system adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-epcis-pull-'));
    folders.push(dir);
    const open = async (): Promise<FileEpcisStorage> => { const storage = await openFileEpcisStorage(dir, { fsync: false }); opened.push(storage); return storage; };
    const read = (at: string): string => readdirSync(at).map((name) => { const path = join(at, name); return statSync(path).isDirectory() ? read(path) : `${name}\n${readFileSync(path, 'latin1')}`; }).join('\n');
    return {
      storage: await open(),
      reopen: async () => { for (const storage of opened.splice(0)) await storage.abandon(); return open(); },
      everything: async () => read(dir),
    };
  }],
];

const sourceOf = (server: FixtureServer, over: Partial<EpcisPullSource> = {}): EpcisPullSource => ({ sourceId: 'source-a', baseUrl: server.baseUrl, permittedOrigins: [server.origin], policy: { policyId: 'test-policy@1' }, localTest: true, ...over });
const pull = (storage: EpcisExchangeStorage, server: FixtureServer, over: Partial<PullEpcisEventsInput> = {}): Promise<EpcisPullOutcome> =>
  pullEpcisEvents({ storage, source: sourceOf(server), queryId: 'query-1', query: { perPage: 2 }, fetch: realFetch, now: () => AT, ...over });
const limited = (server: FixtureServer, limits: Partial<typeof EPCIS_DEFAULT_LIMITS>, over: Partial<EpcisPullSource> = {}): EpcisPullSource => sourceOf(server, { policy: { policyId: 'test-policy@1', limits }, ...over });

function ran(outcome: EpcisPullOutcome): EpcisPullResult {
  if (outcome.outcome === 'refused') throw new Error(`the pull was refused: ${JSON.stringify(outcome)}`);
  return outcome;
}

/** Every record of every kind, without revisions. */
async function dump(storage: EpcisExchangeStorage): Promise<Array<{ kind: string; key: string; value: JsonObject }>> {
  const out: Array<{ kind: string; key: string; value: JsonObject }> = [];
  for (const kind of Object.values(EPCIS_RECORD_KINDS)) {
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
const kindOf = async (storage: EpcisExchangeStorage, kind: string): Promise<JsonObject[]> => (await dump(storage)).filter((held) => held.kind === kind).map((held) => held.value);
const observedIds = async (storage: EpcisExchangeStorage): Promise<string[]> => (await kindOf(storage, 'observation')).map((o) => `${String(o.sourceId)} ${String(o.identity)} ${String(o.sequence)}`).sort();
/** What two stores must agree on whatever the number of runs it took: everything but the run bookkeeping. */
function withoutRuns(records: Array<{ kind: string; key: string; value: JsonObject }>): unknown {
  return records.map(({ kind, key, value }) => {
    if (kind === 'pull') { const { runs: _runs, lastRun: _lastRun, ...rest } = value; return { kind, key, value: rest }; }
    if (kind === 'pull-page') { const { run: _run, ...rest } = value; return { kind, key, value: rest }; }
    return { kind, key, value };
  });
}

/** A transport that counts what is read from each body, to show a body is abandoned at its limit and not after it. */
function countingFetch(): { fetch: EpcisFetch; read(): number; calls(): number } {
  let read = 0;
  let calls = 0;
  return {
    read: () => read,
    calls: () => calls,
    fetch: async (url, init) => {
      calls += 1;
      const response = await fetch(url, init);
      return {
        status: response.status,
        headers: response.headers,
        body: response.body == null ? null : {
          getReader: () => {
            const reader = response.body!.getReader();
            return { read: async () => { const chunk = await reader.read(); read += chunk.value?.byteLength ?? 0; return chunk; }, cancel: (reason?: unknown) => reader.cancel(reason), releaseLock: () => reader.releaseLock() };
          },
        },
      };
    },
  };
}

describe.each(stores)('pullEpcisEvents over %s', (_name, newStore) => {
  describe('a run against a source that behaves', () => {
    it('reads every page through the import path, with provenance that names the query, and says the pages were exhausted', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5));
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted', completion: 'exhausted', exhausted: true, localTest: true, sourceId: 'source-a', queryId: 'query-1' });
      expect(result.pages.map((page) => [page.sequence, page.page, page.events.total, page.last])).toEqual([[1, 1, 2, false], [2, 2, 2, false], [3, 3, 1, true]]);
      expect(result.events).toEqual({ total: 5, new: 5, duplicate: 0, newObservation: 0, conflict: 0 });
      expect(result.run).toMatchObject({ run: 1, pagesFetched: 3, pagesAcknowledged: 3, replays: 0, resumed: false, outcome: 'ok', reason: 'exhausted', completion: 'exhausted' });
      expect(result.server).toEqual({ epcis: '2.0.0', cbv: '2.0.0' });
      expect(result.leniencies).toEqual([]);
      expect(result.limits).toEqual(EPCIS_DEFAULT_LIMITS);
      expect(result.limitOverrides).toEqual([]);
      // A result never says the history is complete, however the run ended.
      expect(result.completenessLimits[0]).toContain('not the complete history');

      // Each page is an import like any other: its exact bytes, its record, its provenance.
      for (const page of result.pages) {
        const record = (await getEpcisImport(storage, page.importId))!;
        expect(record.sourceLocation).toEqual({ kind: 'query', origin: server.origin, query: page.query, page: page.page });
        expect(record).toMatchObject({ sourceId: 'source-a', documentValidity: 'valid', state: 'evaluated', sha256: page.sha256, envelope: { type: 'EPCISQueryDocument' } });
        expect(record.progress).toMatchObject({ pagesRead: page.page, complete: false });
        expect((await exportEpcisSource(storage, page.importId))!.sha256).toBe(page.sha256);
      }
      expect(result.pages[0]!.query).toEqual({ perPage: '2' });
      expect(result.pages[1]!.query).toMatchObject({ perPage: '2', nextPageToken: expect.any(String) });

      // What was asked: the standard query, with the two version headers, and nothing provider-specific.
      const asked = server.pageRequests();
      expect(asked).toHaveLength(3);
      expect(asked.map((request) => Object.keys(request.query).sort())).toEqual([['perPage'], ['nextPageToken', 'perPage'], ['nextPageToken', 'perPage']]);
      // The versions asked under are the pinned ones, three parts each, whatever version the source then reports.
      for (const request of asked) expect(request.headers).toMatchObject({ 'gs1-epcis-version': '2.0.1', 'gs1-cbv-version': '2.0.0', accept: 'application/ld+json, application/json' });
      expect(asked.every((request) => request.headers.authorization === undefined)).toBe(true);

      const state = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
      expect(state).toEqual(result.pull);
      expect(state).toMatchObject({ recordType: 'epcis-pull', recordVersion: '1', pullId: epcisPullId('source-a', 'query-1'), status: 'exhausted', pagesAcknowledged: 3, runs: 1, pass: { number: 1, attempt: 1, exhausted: true, pagesAcknowledged: 3, parameters: { perPage: '2' }, window: { basis: 'query-bounds' } }, watermark: { recordTime: pullTime(5), pass: 1 }, source: { sourceId: 'source-a', baseUrl: server.baseUrl, permittedOrigins: [server.origin], localTest: true, credentialsConfigured: false } });
      expect(state.cursor).toBeUndefined();
      expect(state.pending).toBeUndefined();
      expect(await listEpcisPullPages(storage, state.pullId)).toEqual(result.pages);
      expect(await listEpcisPullPages(storage, state.pullId, { after: 2 })).toEqual([result.pages[2]]);
      expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    });

    it('answers ok with no events for a query that matched nothing', async () => {
      const { storage } = await newStore();
      const server = await serve([]);
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted', completion: 'exhausted', exhausted: true, events: { total: 0 } });
      // The empty answer is retained like any page: it is the evidence that the query was answered.
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]).toMatchObject({ page: 1, last: true, events: { total: 0 }, leniencies: [] });
      expect((await getEpcisImport(storage, result.pages[0]!.importId))!.events).toEqual([]);
      expect(result.pull!.watermark).toBeUndefined();
    });

    it('sends the filters the profile selects under their standard names', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(6));
      const query = { matchAnyEPC: [pullItem(4), pullItem(2), pullItem(6)], eventTypes: ['ObjectEvent'], eventTime: { from: pullTime(2, 8), until: pullTime(6, 8) }, recordTime: { from: pullTime(1) }, perPage: 2 };
      const result = ran(await pull(storage, server, { query }));
      expect(server.pageRequests()[0]!.query).toEqual({ MATCH_anyEPC: [pullItem(2), pullItem(4), pullItem(6)].join('|'), eventType: 'ObjectEvent', GE_eventTime: pullTime(2, 8), LT_eventTime: pullTime(6, 8), GE_recordTime: pullTime(1), perPage: '2' });
      // Event 6 is at the upper bound of the event time, which is exclusive.
      expect(result.events.total).toBe(2);
      expect(result.pull!.query).toEqual({ ...query, matchAnyEPC: [pullItem(2), pullItem(4), pullItem(6)] });
      expect(result.completenessLimits.join(' ')).toMatch(/record time cannot discover every retrospective error declaration/);
      expect(result.completenessLimits.join(' ')).toMatch(/does not retrieve the transformations/);
      expect(epcisQueryParameters({ eventIds: ['b', 'a'], perPage: 5 })).toEqual({ EQ_eventID: 'b|a', perPage: '5' });
    });

    it('asks under the pinned EPCIS and CBV versions by default, and under the versions a source is configured with', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(1));
      expect([EPCIS_WIRE_VERSION, CBV_WIRE_VERSION]).toEqual([EPCIS_VERSION, CBV_VERSION]);
      expect([EPCIS_WIRE_VERSION, CBV_WIRE_VERSION]).toEqual(['2.0.1', '2.0.0']);
      const byDefault = ran(await pull(storage, server));
      expect(server.pageRequests().at(-1)!.headers).toMatchObject({ 'gs1-epcis-version': EPCIS_VERSION, 'gs1-cbv-version': CBV_VERSION });
      expect(byDefault.pull!.source.wireVersions).toEqual({ epcis: EPCIS_VERSION, cbv: CBV_VERSION });
      // Each is configured on its own, and what was sent is what the record says was sent.
      const configured = ran(await pull(storage, server, { queryId: 'other-versions', source: sourceOf(server, { wireVersions: { epcis: '2.0.0' } }) }));
      expect(server.pageRequests().at(-1)!.headers).toMatchObject({ 'gs1-epcis-version': '2.0.0', 'gs1-cbv-version': CBV_VERSION });
      expect(configured.pull!.source.wireVersions).toEqual({ epcis: '2.0.0', cbv: CBV_VERSION });
      const both = ran(await pull(storage, server, { queryId: 'both-versions', source: sourceOf(server, { wireVersions: { epcis: '2.0', cbv: '2.0.1' } }) }));
      expect(server.pageRequests().at(-1)!.headers).toMatchObject({ 'gs1-epcis-version': '2.0', 'gs1-cbv-version': '2.0.1' });
      expect(both.pull!.source.wireVersions).toEqual({ epcis: '2.0', cbv: '2.0.1' });
    });

    it('sends a credential to the origin it was configured for, and records only that one was configured', async () => {
      const { storage, everything } = await newStore();
      const server = await serve(pullEvents(3), { requireAuthorization: `Bearer ${SECRET}` });
      const result = ran(await pull(storage, server, { source: sourceOf(server, { credentials: bearer }) }));
      expect(result).toMatchObject({ outcome: 'ok', pull: { source: { credentialsConfigured: true } } });
      expect(server.pageRequests().every((request) => request.headers.authorization === `Bearer ${SECRET}`)).toBe(true);
      const text = `${JSON.stringify(result)}${await everything()}`;
      for (const form of SECRET_FORMS) expect(text).not.toContain(form);
    });

    it.each([
      ['basic', { scheme: 'basic', username: 'operator', password: SECRET } as EpcisSourceCredential, { authorization: `Basic ${Buffer.from(`operator:${SECRET}`).toString('base64')}` }],
      ['a named header', { scheme: 'header', name: 'X-Api-Key', value: SECRET } as EpcisSourceCredential, { 'x-api-key': SECRET }],
    ])('sends a %s credential', async (_scheme, credential, headers) => {
      const { storage, everything } = await newStore();
      const server = await serve(pullEvents(1));
      ran(await pull(storage, server, { source: sourceOf(server, { credentials: async () => credential }) }));
      expect(server.pageRequests()[0]!.headers).toMatchObject(headers);
      const text = await everything();
      for (const form of SECRET_FORMS) expect(text).not.toContain(form);
    });
  });

  describe('limits', () => {
    it('stops at the page limit, says so, and continues from the checkpoint after a restart', async () => {
      const { storage, reopen } = await newStore();
      const server = await serve(pullEvents(5));
      const first = ran(await pull(storage, server, { source: limited(server, { maxPullPages: 2 }) }));
      expect(first).toMatchObject({ outcome: 'partial-history', reason: 'page-limit', completion: 'stopped-at-limit', exhausted: false, events: { total: 4, new: 4 } });
      expect(first.limits.maxPullPages).toBe(2);
      expect(first.limitOverrides).toEqual([{ limit: 'maxPullPages', default: 10, value: 2 }]);
      expect(first.completenessLimits.join(' ')).toMatch(/stopped at its page limit/);
      expect(first.pull).toMatchObject({ status: 'stopped-at-limit', pagesAcknowledged: 2, cursor: { afterPage: 2, token: expect.any(String) }, limits: { maxPullPages: 2 }, limitOverrides: first.limitOverrides });
      expect(first.pull!.watermark).toBeUndefined();

      // A restarted process, with the same store.
      const again = await reopen();
      const second = ran(await pull(again, server, { source: limited(server, { maxPullPages: 2 }) }));
      expect(second).toMatchObject({ outcome: 'ok', reason: 'exhausted', run: { run: 2, resumed: true, pagesFetched: 1 }, events: { total: 1, new: 1 } });
      expect(second.pages.map((page) => [page.sequence, page.run, page.page])).toEqual([[3, 2, 3]]);
      // Three requests in all: no page was asked for twice and none was skipped.
      expect(server.pageRequests()).toHaveLength(3);
      expect(server.pageRequests()[2]!.query.nextPageToken).toBe(first.pull!.cursor!.token);
      expect(await observedIds(again)).toHaveLength(5);
      expect(await checkEpcisExchangeInvariants(again, { associations: true })).toEqual([]);
    });

    it('stops at the byte limit before it holds a page that would pass it', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5));
      const size = ran(await pull(storage, server, { queryId: 'sizing' })).pages[0]!.byteLength;
      const first = ran(await pull(storage, server, { source: limited(server, { maxPullBytes: size + 10 }) }));
      expect(first).toMatchObject({ outcome: 'partial-history', reason: 'byte-limit', completion: 'stopped-at-limit', run: { pagesAcknowledged: 1 } });
      expect(first.completenessLimits.join(' ')).toMatch(/stopped at its byte limit/);
      expect(first.pull!.cursor).toMatchObject({ afterPage: 1 });
      const second = ran(await pull(storage, server));
      expect(second).toMatchObject({ outcome: 'ok', run: { resumed: true, pagesAcknowledged: 2 } });
    });

    it('stops at the time limit', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5));
      let now = Date.parse(AT);
      // Each page takes forty seconds by the run's clock.
      const log = (entry: EpcisPullLogEntry): void => { if (entry.event === 'checkpoint') now += 40_000; };
      const result = ran(await pull(storage, server, { now: () => new Date(now).toISOString(), log }));
      expect(result).toMatchObject({ outcome: 'partial-history', reason: 'time-limit', completion: 'stopped-at-limit', run: { pagesAcknowledged: 2 } });
      expect(result.completenessLimits.join(' ')).toMatch(/stopped at its time limit/);
    });

    it('refuses a limit past its ceiling, and a query it cannot bound', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(1));
      for (const [limit, ceiling] of Object.entries(EPCIS_PULL_LIMIT_CEILINGS)) {
        expect(await pull(storage, server, { source: limited(server, { [limit]: ceiling + 1 }) }), limit).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
        expect((await pull(storage, server, { source: limited(server, { [limit]: ceiling }), queryId: `ceiling-${limit.toLowerCase()}`, query: {} })).outcome, limit).not.toBe('refused');
      }
      expect(await pull(storage, server, { query: { perPage: 101 } })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      expect(await pull(storage, server, { source: limited(server, { maxPullPages: 0 }) })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      // With nothing set the page size asked for is the page event limit in force.
      const defaults = ran(await pull(storage, server, { queryId: 'defaults', query: {} }));
      expect(defaults.pull!.query.perPage).toBe(100);
    });

    it('refuses a page with more events than the limit, or nested too deep, through the import path, and keeps nothing of it', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(3), { pageDocument: (document) => ({ ...document, epcisBody: { queryResults: { queryName: 'SimpleEventQuery', resultsBody: { eventList: pullEvents(3) } } } }) });
      const many = ran(await pull(storage, server, { source: limited(server, { maxEventsPerPage: 2 }) }));
      expect(many).toMatchObject({ outcome: 'invalid-source', reason: 'import-refused', importRefusal: 'too-many-events', completion: 'failed', pages: [] });
      const deep = ran(await pull(storage, server, { queryId: 'deep', source: limited(server, { maxJsonDepth: 3 }) }));
      expect(deep).toMatchObject({ outcome: 'invalid-source', reason: 'import-refused', importRefusal: 'depth' });
      expect(await listEpcisImports(storage)).toEqual([]);
      expect(many.pull).toMatchObject({ status: 'failed', pagesAcknowledged: 0 });
      expect(many.pull!.pending).toBeUndefined();
    });
  });

  describe('resume and replay', () => {
    it('replays the pass from its bounds when the cursor has expired, without sending the expired cursor', async () => {
      const { storage } = await newStore();
      let now = Date.parse(AT);
      const server = await serve(pullEvents(5), { tokenTtlSeconds: 60, clock: () => now, creationDate: 'changing' });
      // Two minutes pass after the second page is acknowledged, so the cursor it named is past its expiry.
      const log = (entry: EpcisPullLogEntry): void => { if (entry.event === 'checkpoint' && entry.attempt === 1 && entry.page === 2) now += 120_000; };
      const result = ran(await pull(storage, server, { now: () => new Date(now).toISOString(), log, source: limited(server, { maxPullSeconds: 600 }) }));
      expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted', run: { replays: 1, pagesFetched: 5, pagesAcknowledged: 5 }, replay: { reason: 'cursor-expired', pass: 1, attempt: 1, pagesAcknowledgedBefore: 2 } });
      expect(result.pages.map((page) => [page.sequence, page.attempt, page.page])).toEqual([[1, 1, 1], [2, 1, 2], [3, 2, 1], [4, 2, 2], [5, 2, 3]]);
      // The same logical source: one pull, one pass, a second traversal. What was held is recognised.
      expect(result.events).toEqual({ total: 9, new: 5, duplicate: 4, newObservation: 0, conflict: 0 });
      expect(await observedIds(storage)).toHaveLength(5);
      expect(result.pull).toMatchObject({ pass: { number: 1, attempt: 2, exhausted: true }, pagesAcknowledged: 5 });
      // The cursor recorded after page 2 was never sent: the third request is the first page again.
      expect(server.pageRequests().map((request) => request.query.nextPageToken == null)).toEqual([true, false, true, false, false]);
      expect(result.pages[1]!.server).toBeDefined();
      expect(result.completenessLimits.join(' ')).toMatch(/replayed from its bounds/);
      expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    });

    it('replays when the source rejects the cursor, and writes no second import for a page it already holds', async () => {
      const { storage } = await newStore();
      let uses = 0;
      const server = await serve(pullEvents(5), { rejectToken: () => { uses += 1; return uses === 2 ? 410 : undefined; } });
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'ok', run: { replays: 1 }, replay: { reason: 'cursor-rejected', pagesAcknowledgedBefore: 2 } });
      expect(result.pages.map((page) => [page.attempt, page.page, page.importReplayed, page.events.duplicate])).toEqual([[1, 1, false, 0], [1, 2, false, 0], [2, 1, true, 2], [2, 2, true, 2], [2, 3, false, 0]]);
      // The replayed pages arrived with the bytes already held, so they answer the imports that hold them.
      expect(result.pages[2]!.importId).toBe(result.pages[0]!.importId);
      expect(await listEpcisImports(storage)).toHaveLength(3);
      expect(await observedIds(storage)).toHaveLength(5);
      expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    });

    it.each([400, 404, 410])('takes status %i for a cursor as a rejected cursor', async (status) => {
      const { storage } = await newStore();
      let uses = 0;
      const server = await serve(pullEvents(3), { rejectToken: () => { uses += 1; return uses === 1 ? status : undefined; } });
      expect(ran(await pull(storage, server))).toMatchObject({ outcome: 'ok', replay: { reason: 'cursor-rejected' } });
    });

    it('ends the run when a second cursor cannot be reused, and never reports the pass as exhausted', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5), { rejectToken: () => 410 });
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'partial-history', reason: 'cursor-unusable', completion: 'failed', exhausted: false, run: { replays: 1 } });
      expect(result.pull).toMatchObject({ status: 'failed', pass: { exhausted: false } });
      expect(await observedIds(storage)).toHaveLength(2);
    });

    it('replays when the cursor is missing from the state', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5));
      ran(await pull(storage, server, { source: limited(server, { maxPullPages: 1 }) }));
      const held = (await storage.get('pull', (await dump(storage)).find((record) => record.kind === 'pull')!.key))!;
      const { cursor: _cursor, ...withoutCursor } = held.value;
      await storage.commit([{ op: 'put', kind: 'pull', key: held.key, value: withoutCursor, expect: held.revision }]);
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'ok', replay: { reason: 'cursor-missing', pagesAcknowledgedBefore: 1 }, events: { total: 5, new: 3, duplicate: 2 } });
      expect(await observedIds(storage)).toHaveLength(5);
    });

    it('continues after a failure from the page it had not acknowledged', async () => {
      const { storage } = await newStore();
      let failing = true;
      const server = await serve(pullEvents(5), { intercept: (request, response) => { if (!failing || request.query.nextPageToken == null) return false; response.writeHead(503).end('unavailable'); return true; } });
      const first = ran(await pull(storage, server));
      expect(first).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 503, completion: 'failed', exhausted: false, run: { pagesAcknowledged: 1 } });
      expect(first.completenessLimits.join(' ')).toMatch(/ended as http-error/);
      failing = false;
      const second = ran(await pull(storage, server));
      expect(second).toMatchObject({ outcome: 'ok', run: { resumed: true, pagesAcknowledged: 2 } });
      expect(await observedIds(storage)).toHaveLength(5);
      // Page 1 was asked for once.
      expect(server.pageRequests().filter((request) => request.query.nextPageToken == null)).toHaveLength(1);
    });
  });

  describe('a crash', () => {
    /** The durable calls of a run, each with the kinds its batch wrote. */
    function tracing(inner: EpcisExchangeStorage): { storage: EpcisExchangeStorage; calls: string[][] } {
      const calls: string[][] = [];
      return {
        calls,
        storage: {
          ...inner,
          putBytes: (sha256, bytes) => { calls.push(['bytes']); return inner.putBytes(sha256, bytes); },
          deleteBytes: (sha256) => { calls.push(['bytes']); return inner.deleteBytes(sha256); },
          commit: (writes) => { calls.push(writes.map((write) => write.kind)); return inner.commit(writes); },
          get: (kind, key) => inner.get(kind, key),
          list: (kind, options) => inner.list(kind, options),
          getBytes: (sha256) => inner.getBytes(sha256),
        },
      };
    }

    it('before and after every durable call of a run: the run resumes to the store an uninterrupted run leaves', async () => {
      // One source for every run, so that the stores can be compared whole. It answers a page the same way however often it is asked.
      const server = await serve(pullEvents(5));
      const control = await newStore();
      const traced = tracing(control.storage);
      ran(await pull(traced.storage, server));
      const expected = withoutRuns(await dump(control.storage));
      const steps = traced.calls;
      // Three pages, each noted, imported and then acknowledged, between the record of the run's start and of its end.
      expect(steps.filter((kinds) => kinds.includes('pull-page'))).toHaveLength(3);
      expect(steps.length).toBeGreaterThanOrEqual(3 * 7 + 2);

      for (let at = 1; at <= steps.length; at += 1) {
        for (const when of ['before', 'after'] as const) {
          for (const path of ['resume', 'recover'] as const) {
            const where = `${when} durable call ${at} of ${steps.length} (${steps[at - 1]!.join('+')}), then ${path}`;
            const store = await newStore();
            await expect(pull(faultInjectingEpcisStorage(store.storage, { at, when }).storage, server), where).rejects.toBeInstanceOf(EpcisStorageFault);
            const reopened = await store.reopen();
            // The checkpoint never points past what is retained, at the moment of the crash.
            const state = await getEpcisPull(reopened, 'source-a', 'query-1');
            const acknowledged = state == null ? [] : await listEpcisPullPages(reopened, state.pullId);
            expect(acknowledged.length, where).toBe(state?.pagesAcknowledged ?? 0);
            for (const page of acknowledged) expect((await exportEpcisSource(reopened, page.importId))!.sha256, where).toBe(page.sha256);
            expect(state?.cursor?.afterPage ?? 0, where).toBeLessThanOrEqual(acknowledged.length);
            if (path === 'recover') expect((await recoverEpcisExchange(reopened, { now: () => AT })).remaining, where).toBe(0);
            if (state?.status === 'exhausted') {
              // The run's end was durable and only its answer was lost. The store is already the uninterrupted one, and a further call would begin the next pass.
              expect(at === steps.length && when === 'after', where).toBe(true);
              expect(withoutRuns(await dump(reopened)), where).toEqual(expected);
              continue;
            }

            const resumed = ran(await pull(reopened, server));
            expect(resumed, where).toMatchObject({ outcome: 'ok', reason: 'exhausted' });
            expect(withoutRuns(await dump(reopened)), where).toEqual(expected);
            expect(await checkEpcisExchangeInvariants(reopened, { associations: true }), where).toEqual([]);
            // No page was lost or skipped, and none has two receipts.
            expect(await observedIds(reopened), where).toHaveLength(5);
            expect(await listEpcisImports(reopened), where).toHaveLength(3);
            expect((await listEpcisPullPages(reopened, resumed.pull!.pullId)).map((page) => page.page), where).toEqual([1, 2, 3]);
          }
        }
      }
    }, 240_000);

    it.each(['before', 'after'] as const)('%s the checkpoint write that follows a page\'s import: the page is not asked for again and has one receipt', async (when) => {
      // A live repository stamps each answer, so a page read twice would differ in its bytes and could not be told from a new one by them.
      const probeStore = await newStore();
      const probe = tracing(probeStore.storage);
      ran(await pull(probe.storage, await serve(pullEvents(5), { creationDate: 'changing' })));
      // The second page's checkpoint: the second batch that writes a page record.
      const at = probe.calls.map((kinds, index) => (kinds.includes('pull-page') ? index + 1 : 0)).filter((index) => index > 0)[1]!;

      const store = await newStore();
      const server = await serve(pullEvents(5), { creationDate: 'changing' });
      await expect(pull(faultInjectingEpcisStorage(store.storage, { at, when }).storage, server)).rejects.toBeInstanceOf(EpcisStorageFault);
      expect(server.pageRequests()).toHaveLength(2);
      const reopened = await store.reopen();
      const crashed = (await getEpcisPull(reopened, 'source-a', 'query-1'))!;
      // Before the write the checkpoint is still behind the retained page. After it, it is exactly at it. It is never ahead.
      expect(crashed.pagesAcknowledged).toBe(when === 'before' ? 1 : 2);
      expect(crashed.pending == null).toBe(when === 'after');
      expect(await listEpcisImports(reopened)).toHaveLength(2);

      const resumed = ran(await pull(reopened, server));
      expect(resumed).toMatchObject({ outcome: 'ok', run: { resumed: true, pagesFetched: 1 } });
      // Only the third page was asked for: the second was finished from its receipt.
      expect(server.pageRequests()).toHaveLength(3);
      expect(server.pageRequests()[2]!.query.nextPageToken).toBeDefined();
      expect(await listEpcisImports(reopened)).toHaveLength(3);
      expect((await listEpcisPullPages(reopened, resumed.pull!.pullId)).map((page) => [page.sequence, page.page])).toEqual([[1, 1], [2, 2], [3, 3]]);
      expect(await observedIds(reopened)).toHaveLength(5);
      expect(await checkEpcisExchangeInvariants(reopened, { associations: true })).toEqual([]);
    });
  });

  describe('duplicates, conflicts and corrections', () => {
    it('classifies a repeat and a changed body that arrive on later pages', async () => {
      const { storage } = await newStore();
      const changed = pullEvent(2, { disposition: 'in_transit' });
      const server = await serve([pullEvent(1), pullEvent(2), pullEvent(1), pullEvent(3), changed]);
      const result = ran(await pull(storage, server));
      expect(result.pages.map((page) => page.events)).toEqual([
        { total: 2, new: 2, duplicate: 0, newObservation: 0, conflict: 0 },
        { total: 2, new: 1, duplicate: 1, newObservation: 0, conflict: 0 },
        { total: 1, new: 0, duplicate: 0, newObservation: 0, conflict: 1 },
      ]);
      const conflict = (await getEpcisConflict(storage, epcisConflictId('source-a', 'event-id', pullEventId(2))))!;
      expect(conflict).toMatchObject({ state: 'open' });
      expect(conflict.observations).toHaveLength(2);
      expect((await getEpcisImport(storage, result.pages[2]!.importId))!.state).toBe('blocked');
      // The run still says what the source did: its pages were exhausted. The conflict is the import's to show.
      expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted' });
    });

    it('classifies a repeat and a changed body that arrive in a later run', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(3), { creationDate: 'changing' });
      ran(await pull(storage, server));
      server.events.push(pullEvent(3, { disposition: 'in_transit', recordTime: pullTime(40) }));
      const second = ran(await pull(storage, server, { window: 'query-bounds' }));
      expect(second).toMatchObject({ outcome: 'ok', pull: { pass: { number: 2, window: { basis: 'query-bounds' } } }, events: { total: 4, new: 0, duplicate: 3, conflict: 1 } });
      expect(await getEpcisConflict(storage, epcisConflictId('source-a', 'event-id', pullEventId(3)))).toMatchObject({ state: 'open' });
      expect(await observedIds(storage)).toHaveLength(4);
    });

    it('receives a correction in a later run, from a window that overlaps the watermark by a bounded margin', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(4), { creationDate: 'changing' });
      const first = ran(await pull(storage, server, { recordTimeOverlapSeconds: 120 }));
      expect(first.pull).toMatchObject({ watermark: { recordTime: pullTime(4), pass: 1 }, recordTimeOverlapSeconds: 120 });

      // The source later declares event 2 in error, and records a new event.
      server.events.push(pullEvent(2, { recordTime: pullTime(30), errorDeclaration: { declarationTime: pullTime(30), reason: 'incorrect_data', correctiveEventIDs: [pullEventId(5)] } }), pullEvent(5, { recordTime: pullTime(31) }));
      const second = ran(await pull(storage, server, { recordTimeOverlapSeconds: 120 }));
      // Two minutes before the watermark: events 2, 3 and 4 are read again and recognised.
      expect(server.pageRequests().at(-1)!.query.GE_recordTime).toBe(pullTime(2));
      expect(second).toMatchObject({ outcome: 'ok', events: { total: 5, new: 1, duplicate: 3, newObservation: 1, conflict: 0 } });
      expect(second.pull).toMatchObject({ pass: { number: 2, attempt: 1, window: { basis: 'watermark', recordTimeFrom: pullTime(2), overlapSeconds: 120 } }, watermark: { recordTime: pullTime(31), pass: 2 } });
      // The declaration is a further observation of event 2. The first observation stands beside it.
      const observations = (await kindOf(storage, 'observation')).filter((o) => o.identity === pullEventId(2));
      expect(observations.map((o) => [o.sequence, o.arrival, o.errorDeclaration != null])).toEqual([[1, 'new', false], [2, 'new-observation', true]]);
      // A watermark bounds the next request. It is not evidence that every correction arrived.
      expect(second.completenessLimits.join(' ')).toMatch(/a watermark does not show that every correction was received/);
      expect(second.exhausted).toBe(true);
    });

    it('refreshes named events by identifier, whatever the watermark', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(4));
      ran(await pull(storage, server, { recordTimeOverlapSeconds: 60 }));
      // A correction the source recorded with a time before the window of the next pass: a record-time bound never asks for it.
      server.events.push(pullEvent(1, { recordTime: pullTime(1), errorDeclaration: { declarationTime: pullTime(50), reason: 'did_not_occur', correctiveEventIDs: [] } }));
      const later = ran(await pull(storage, server, { recordTimeOverlapSeconds: 60 }));
      expect(server.pageRequests().at(-1)!.query.GE_recordTime).toBe(pullTime(3));
      expect(later.events).toMatchObject({ total: 2, duplicate: 2, newObservation: 0 });

      const refresh = { queryId: 'refresh-1', query: { eventIds: [pullEventId(1), pullEventId(3)] } };
      const result = ran(await pull(storage, server, refresh));
      expect(server.pageRequests().at(-1)!.query).toEqual({ EQ_eventID: `${pullEventId(1)}|${pullEventId(3)}`, perPage: '100' });
      expect(result).toMatchObject({ outcome: 'ok', events: { total: 3, duplicate: 2, newObservation: 1 } });
      // A refresh keeps no watermark and always asks for exactly its events.
      expect(result.pull!.watermark).toBeUndefined();
      const again = ran(await pull(storage, server, refresh));
      expect(again.pull!.pass).toMatchObject({ number: 2, window: { basis: 'query-bounds' } });
      expect(server.pageRequests().at(-1)!.query.GE_recordTime).toBeUndefined();
    });

    it('keeps two source scopes apart when they use one event identifier', async () => {
      const { storage } = await newStore();
      const a = await serve([pullEvent(1)]);
      const b = await serve([pullEvent(1, { disposition: 'in_transit' })]);
      const first = ran(await pull(storage, a));
      const second = ran(await pull(storage, b, { source: sourceOf(b, { sourceId: 'source-b' }) }));
      expect(first.events).toMatchObject({ new: 1, conflict: 0 });
      expect(second.events).toMatchObject({ new: 1, conflict: 0 });
      expect(await getEpcisConflict(storage, epcisConflictId('source-a', 'event-id', pullEventId(1)))).toBeUndefined();
      expect(await getEpcisConflict(storage, epcisConflictId('source-b', 'event-id', pullEventId(1)))).toBeUndefined();
      expect(await observedIds(storage)).toEqual([`source-a ${pullEventId(1)} 1`, `source-b ${pullEventId(1)} 1`]);
      // One query name under two sources is two pulls.
      expect(first.pull!.pullId).not.toBe(second.pull!.pullId);
    });

    it('takes two runs of one pull in turn', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5));
      const [first, second] = await Promise.all([pull(storage, server), pull(storage, server, { window: 'query-bounds' })]);
      expect([ran(first).run.run, ran(second).run.run]).toEqual([1, 2]);
      expect(ran(second).pull!.pass.number).toBe(2);
      expect(await observedIds(storage)).toHaveLength(5);
      expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    });
  });

  describe('a source that is hostile or broken', () => {
    const nothingRetained = async (storage: EpcisExchangeStorage): Promise<void> => {
      expect(await listEpcisImports(storage)).toEqual([]);
      expect(await kindOf(storage, 'observation')).toEqual([]);
      expect(await kindOf(storage, 'pull-page')).toEqual([]);
      expect(await kindOf(storage, 'journal')).toEqual([]);
    };

    it('names an authentication failure and a refusal, and keeps nothing', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(3), { requireAuthorization: `Bearer ${SECRET}` });
      expect(ran(await pull(storage, server))).toMatchObject({ outcome: 'source-authentication-required', reason: 'http-401', status: 401, completion: 'failed', exhausted: false });
      expect(ran(await pull(storage, server, { queryId: 'wrong', source: sourceOf(server, { credentials: () => ({ scheme: 'bearer', token: 'another-token-entirely' }) }) }))).toMatchObject({ outcome: 'source-authentication-required', reason: 'http-401' });
      server.behaviour.forbid = true;
      expect(ran(await pull(storage, server, { queryId: 'forbidden', source: sourceOf(server, { credentials: bearer }) }))).toMatchObject({ outcome: 'source-forbidden', reason: 'http-403', status: 403 });
      await nothingRetained(storage);
      expect(await getEpcisPull(storage, 'source-a', 'query-1')).toMatchObject({ status: 'failed', pagesAcknowledged: 0, lastRun: { outcome: 'source-authentication-required' } });
    });

    it('refuses an HTML page with status 200, under either media type, and keeps nothing', async () => {
      const { storage } = await newStore();
      const html = '<!DOCTYPE html><html><body><form>Sign in</form></body></html>';
      const server = await serve(pullEvents(3), { intercept: (_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'GS1-EPCIS-Version': '2.0.0' }).end(html); return true; } });
      expect(ran(await pull(storage, server))).toMatchObject({ outcome: 'unexpected-media-type', reason: 'media-type', status: 200, completion: 'failed' });
      server.behaviour.intercept = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'GS1-EPCIS-Version': '2.0.0' }).end(`\n  ${html}`); return true; };
      expect(ran(await pull(storage, server, { queryId: 'mislabelled' }))).toMatchObject({ outcome: 'unexpected-media-type', reason: 'html-body', status: 200 });
      server.behaviour.intercept = (_request, response) => { response.writeHead(200).end('{}'); return true; };
      expect(ran(await pull(storage, server, { queryId: 'untyped' }))).toMatchObject({ outcome: 'unexpected-media-type', reason: 'media-type' });
      await nothingRetained(storage);
    });

    it('refuses a redirect to an origin that is not permitted before requesting it, so no credential leaves', async () => {
      const { storage } = await newStore();
      const elsewhere = await serve(pullEvents(3));
      const server = await serve(pullEvents(3), { intercept: (request, response) => { response.writeHead(302, { location: `${elsewhere.baseUrl}/events?perPage=${request.query.perPage}` }).end(); return true; } });
      const result = ran(await pull(storage, server, { source: sourceOf(server, { credentials: bearer }) }));
      expect(result).toMatchObject({ outcome: 'source-unavailable', reason: 'redirect-refused', completion: 'failed' });
      expect(result.detail).toContain('is not one this source permits');
      // The other origin was never contacted at all.
      expect(elsewhere.requests).toEqual([]);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
      await nothingRetained(storage);
    });

    it('follows a redirect to a second permitted origin without the credential', async () => {
      const { storage } = await newStore();
      const mirror = await serve(pullEvents(3));
      const server = await serve([], { intercept: (request, response) => { response.writeHead(307, { location: `${mirror.baseUrl}/events?perPage=${request.query.perPage}` }).end(); return true; } });
      const result = ran(await pull(storage, server, { source: sourceOf(server, { credentials: bearer, permittedOrigins: [server.origin, mirror.origin] }) }));
      expect(result).toMatchObject({ outcome: 'ok', events: { total: 3 } });
      expect(mirror.requests.length).toBeGreaterThan(0);
      // The credential was configured for the base address's origin. The mirror never saw it, on the redirect or on the pages after it.
      for (const request of mirror.requests) for (const value of Object.values(request.headers)) for (const form of SECRET_FORMS) expect(String(value)).not.toContain(form);
      expect(mirror.requests.every((request) => request.headers.authorization === undefined)).toBe(true);
      // Provenance names the configured origin, which is what the source scope is.
      expect((await getEpcisImport(storage, result.pages[0]!.importId))!.sourceLocation).toMatchObject({ kind: 'query', origin: server.origin });
    });

    it('follows a chain of permitted redirects, and stops at the fourth', async () => {
      const { storage } = await newStore();
      const hop = (to: string) => (request: { path: string; query: Record<string, string> }): string => `${to}?${new URLSearchParams(request.query).toString()}`;
      const server = await serve(pullEvents(3), {
        intercept: (request, response) => {
          const next: Record<string, [number, string]> = { '/chain/events': [302, hop('/second/events')(request)], '/second/events': [307, hop('/third/events')(request)], '/third/events': [308, hop('/epcis/events')(request)], '/loop/events': [302, hop('/loop/events')(request)] };
          const redirect = next[request.path];
          if (redirect == null) return false;
          response.writeHead(redirect[0], { location: redirect[1] }).end();
          return true;
        },
      });
      const result = ran(await pull(storage, server, { source: sourceOf(server, { baseUrl: `${server.origin}/chain` }) }));
      expect(result).toMatchObject({ outcome: 'ok', events: { total: 3 } });
      expect(server.requests.slice(0, 4).map((request) => request.path)).toEqual(['/chain/events', '/second/events', '/third/events', '/epcis/events']);
      const looping = ran(await pull(storage, server, { queryId: 'loop', source: sourceOf(server, { baseUrl: `${server.origin}/loop` }) }));
      expect(looping).toMatchObject({ outcome: 'source-unavailable', reason: 'redirect-limit' });
      const lost = await serve([], { intercept: (_request, response) => { response.writeHead(302).end(); return true; } });
      expect(ran(await pull(storage, lost, { queryId: 'lost' }))).toMatchObject({ outcome: 'source-unavailable', reason: 'redirect-malformed' });
    });

    it('abandons an oversized page while reading it, and keeps nothing', async () => {
      const { storage } = await newStore();
      const chunk = Buffer.from(`${' '.repeat(16 * 1024 - 1)}\n`);
      const server = await serve([], {
        intercept: (_request, response) => {
          response.writeHead(200, { 'content-type': 'application/json', 'GS1-EPCIS-Version': '2.0.0' });
          // Eight megabytes with no declared length, sent as fast as the client takes them.
          let sent = 0;
          const more = (): void => { while (sent < 512 && !response.destroyed) { sent += 1; if (!response.write(chunk)) { response.once('drain', more); return; } } response.end(); };
          more();
          return true;
        },
      });
      const transport = countingFetch();
      const result = ran(await pull(storage, server, { fetch: transport.fetch, source: limited(server, { maxDocumentBytes: 64 * 1024 }) }));
      expect(result).toMatchObject({ outcome: 'invalid-source', reason: 'page-oversized', completion: 'failed' });
      // Read to the limit and one chunk past it at most: far short of what was offered.
      expect(transport.read()).toBeLessThan(1024 * 1024);
      await nothingRetained(storage);
    });

    it('refuses a page whose declared length is past the limit without reading it', async () => {
      const { storage } = await newStore();
      const server = await serve([], { intercept: (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'content-length': '200000', 'GS1-EPCIS-Version': '2.0.0' }).end(Buffer.alloc(200_000, 0x20)); return true; } });
      const transport = countingFetch();
      expect(ran(await pull(storage, server, { fetch: transport.fetch, source: limited(server, { maxDocumentBytes: 64 * 1024 }) }))).toMatchObject({ outcome: 'invalid-source', reason: 'page-oversized' });
      expect(transport.read()).toBe(0);
    });

    it('bounds what a compressed page expands to while it is read', async () => {
      const { storage } = await newStore();
      // Thirty-two megabytes that travel as a few tens of kilobytes.
      const bomb = gzipSync(Buffer.alloc(32 * 1024 * 1024, 0x20));
      expect(bomb.byteLength).toBeLessThan(64 * 1024);
      const server = await serve([], { intercept: (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'GS1-EPCIS-Version': '2.0.0' }).end(bomb); return true; } });
      const transport = countingFetch();
      const result = ran(await pull(storage, server, { fetch: transport.fetch }));
      expect(result).toMatchObject({ outcome: 'invalid-source', reason: 'page-oversized' });
      // The default page limit is 2 MiB. The count is of expanded bytes, and it stopped just past the limit.
      expect(transport.read()).toBeGreaterThan(EPCIS_DEFAULT_LIMITS.maxDocumentBytes);
      expect(transport.read()).toBeLessThan(EPCIS_DEFAULT_LIMITS.maxDocumentBytes + 4 * 1024 * 1024);
      await nothingRetained(storage);
    });

    it('gives up on a source that does not answer in time, and on one that stops sending', async () => {
      const { storage } = await newStore();
      const waits: Array<ReturnType<typeof setTimeout>> = [];
      const server = await serve(pullEvents(3), { intercept: async () => { await new Promise<void>((resolve) => { waits.push(setTimeout(resolve, 3000)); }); return false; } });
      const started = Date.now();
      const silent = ran(await pull(storage, server, { source: limited(server, { fetchTimeoutMs: 150 }) }));
      expect(silent).toMatchObject({ outcome: 'source-unavailable', reason: 'timeout', completion: 'failed' });
      expect(silent.detail).toContain('150 ms');
      server.behaviour.intercept = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'GS1-EPCIS-Version': '2.0.0' }); response.write('{"type":'); return true; };
      const stalled = ran(await pull(storage, server, { queryId: 'stalled', source: limited(server, { fetchTimeoutMs: 150 }) }));
      expect(stalled).toMatchObject({ outcome: 'source-unavailable', reason: 'timeout' });
      expect(Date.now() - started).toBeLessThan(2500);
      for (const wait of waits) clearTimeout(wait);
      await nothingRetained(storage);
    });

    it('names a source that cannot be reached and one that answers an error', async () => {
      const { storage } = await newStore();
      const gone = await serve([]);
      await gone.close();
      expect(ran(await pull(storage, gone))).toMatchObject({ outcome: 'source-unavailable', reason: 'network-error', completion: 'failed' });
      const server = await serve([], { intercept: (_request, response) => { response.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}'); return true; } });
      expect(ran(await pull(storage, server, { queryId: 'error' }))).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 500 });
      server.behaviour.intercept = (_request, response) => { response.writeHead(204).end(); return true; };
      expect(ran(await pull(storage, server, { queryId: 'no-content' }))).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 204 });
      server.behaviour.intercept = (_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'GS1-EPCIS-Version': '2.0.0' }).end('{"type":"EPCISQueryDocument",'); return true; };
      expect(ran(await pull(storage, server, { queryId: 'truncated' }))).toMatchObject({ outcome: 'invalid-source', reason: 'import-refused', importRefusal: 'malformed-json' });
      await nothingRetained(storage);
    });

    it.each([
      ['a target that does not parse', '<http://[not-an-address>; rel="next"', 'pagination-malformed'],
      ['two different next pages', '</epcis/events?nextPageToken=a>; rel="next", </epcis/events?nextPageToken=b>; rel="next"', 'pagination-malformed'],
      ['an unclosed target', '</epcis/events?nextPageToken=a; rel="next"', 'pagination-malformed'],
      ['a token with a control character', '</epcis/events?nextPageToken=a%0Ab>; rel="next"', 'pagination-malformed'],
      ['a scheme that is refused', '<ftp://127.0.0.1/epcis/events?nextPageToken=a>; rel="next"', 'pagination-target-refused'],
      ['an address with user information', '<http://user:pass@127.0.0.1/epcis/events?nextPageToken=a>; rel="next"', 'pagination-target-refused'],
    ])('retains the page and ends the run when the next link is %s', async (_what, link, reason) => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5), { pageHeaders: (headers) => { headers.Link = link; } });
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'partial-history', reason, completion: 'failed', exhausted: false, run: { pagesAcknowledged: 1 } });
      // The page that was answered is evidence and is kept. The run does not say the source was exhausted.
      expect(result.pull).toMatchObject({ status: 'failed', pagesAcknowledged: 1, pass: { exhausted: false } });
      expect(result.pull!.cursor).toBeUndefined();
      expect(await observedIds(storage)).toHaveLength(2);
    });

    it('ends the run when the source names a page it already gave, or a next page on another origin', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(5), { pageHeaders: (headers, request) => { headers.Link = `</epcis/events?${new URLSearchParams(request.query).toString()}>; rel="next"`; } });
      expect(ran(await pull(storage, server))).toMatchObject({ outcome: 'partial-history', reason: 'pagination-malformed', run: { pagesFetched: 1 } });

      const elsewhere = await serve(pullEvents(3));
      const leading = await serve(pullEvents(5), { pageHeaders: (headers) => { headers.Link = `<${elsewhere.baseUrl}/events?nextPageToken=1>; rel="next"`; } });
      const result = ran(await pull(storage, leading, { queryId: 'leading', source: sourceOf(leading, { credentials: bearer }) }));
      expect(result).toMatchObject({ outcome: 'partial-history', reason: 'pagination-target-refused', run: { pagesAcknowledged: 1 } });
      expect(elsewhere.requests).toEqual([]);
    });

    it('refuses an answer that carries the credential it was sent, wherever it is carried, and records it nowhere', async () => {
      const { storage, everything } = await newStore();
      const logs: EpcisPullLogEntry[] = [];
      const results: EpcisPullOutcome[] = [];
      const echo = (request: { headers: Record<string, unknown> }): string => String(request.headers.authorization);
      const hostile: Array<[string, Partial<FixtureBehaviour>, object]> = [
        ['in the next link', { pageHeaders: (headers, request) => { headers.Link = `</epcis/events?nextPageToken=${encodeURIComponent(echo(request))}>; rel="next"`; } }, { outcome: 'invalid-source', reason: 'credential-echoed' }],
        ['in the next link, with every character escaped', { pageHeaders: (headers, request) => { headers.Link = `</epcis/events?nextPageToken=${[...echo(request)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')}>; rel="next"`; } }, { outcome: 'invalid-source', reason: 'credential-echoed' }],
        ['in a redirect, with every character escaped', { intercept: (request, response) => { response.writeHead(302, { location: `/epcis/events?token=${[...echo(request)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')}` }).end(); return true; } }, { outcome: 'invalid-source', reason: 'credential-echoed' }],
        ['in the body', { pageDocument: (document, request) => ({ ...document, 'example:seen': echo(request) }) }, { outcome: 'invalid-source', reason: 'credential-echoed' }],
        ['in a redirect', { intercept: (request, response) => { response.writeHead(302, { location: `/epcis/events?token=${encodeURIComponent(echo(request))}` }).end(); return true; } }, { outcome: 'invalid-source', reason: 'credential-echoed' }],
        ['in an error', { intercept: (request, response) => { response.writeHead(500, { 'content-type': 'text/plain' }).end(`failed for ${echo(request)}`); return true; } }, { outcome: 'source-unavailable', reason: 'http-error' }],
        ['in a version header', { pageHeaders: (headers, request) => { headers['GS1-EPCIS-Version'] = echo(request); } }, { outcome: 'invalid-source', reason: 'wire-version-unsupported' }],
        ['in the media type', { pageHeaders: (headers, request) => { headers['content-type'] = `application/x-${SECRET}; note="${echo(request)}"`; } }, { outcome: 'unexpected-media-type', reason: 'media-type' }],
        ['in the cursor expiry', { pageHeaders: (headers, request) => { headers['GS1-Next-Page-Token-Expires'] = echo(request); } }, { outcome: 'ok', reason: 'exhausted' }],
      ];
      for (const [what, behaviour, expected] of hostile) {
        const server = await serve(pullEvents(3), behaviour);
        const result = await pull(storage, server, { queryId: `echo ${what}`, source: sourceOf(server, { credentials: bearer }), log: (entry) => logs.push(entry) });
        expect(result, what).toMatchObject(expected);
        results.push(result);
      }
      // A provider that fails, with the secret in its own message.
      const failing = await serve(pullEvents(1));
      results.push(await pull(storage, failing, { queryId: 'failing provider', source: sourceOf(failing, { credentials: () => { throw new Error(`could not read ${SECRET}`); } }), log: (entry) => logs.push(entry) }));
      expect(results.at(-1)).toMatchObject({ outcome: 'refused', reason: 'credentials-unavailable' });
      // A credential written where configuration goes.
      results.push(await pull(storage, failing, { queryId: SECRET, source: sourceOf(failing, { credentials: bearer }) }));
      results.push(await pull(storage, failing, { queryId: 'in a filter', query: { matchAnyEPC: [`urn:example:${SECRET}`] }, source: sourceOf(failing, { credentials: bearer }) }));
      expect(results.slice(-2)).toEqual([expect.objectContaining({ outcome: 'refused', reason: 'invalid-request' }), expect.objectContaining({ outcome: 'refused', reason: 'invalid-request' })]);
      expect(failing.requests).toEqual([]);

      expect(logs.length).toBeGreaterThan(10);
      expect(logs.some((entry) => entry.credentialSent === true)).toBe(true);
      const text = `${JSON.stringify(results)}\n${JSON.stringify(logs)}\n${await everything()}`;
      for (const form of SECRET_FORMS) expect(text).not.toContain(form);
      // Nor spelled in percent escapes, which decode to it.
      expect(decodeURIComponent(text.replace(/%(?![0-9a-fA-F]{2})/g, '%25'))).not.toContain(SECRET);
      expect(text).not.toMatch(/authorization|bearer /i);
    });
  });

  describe('leniencies', () => {
    /** The events and bodies a strict source leaves, which each leniency must leave too. */
    const strictly = async (events: JsonObject[]): Promise<string[]> => {
      const { storage } = await newStore();
      ran(await pull(storage, await serve(events)));
      return (await kindOf(storage, 'observation')).map((o) => `${String(o.identity)} ${String(o.bodyDigest)}`).sort();
    };
    const retainedBy = async (storage: EpcisExchangeStorage): Promise<string[]> => (await kindOf(storage, 'observation')).map((o) => `${String(o.identity)} ${String(o.bodyDigest)}`).sort();

    it.each([
      ['a next link whose relation is not quoted', { linkRelation: 'unquoted' } as Partial<FixtureBehaviour>, 'link-relation-unquoted'],
      ['a next page token that is a bare number', { tokenStyle: 'numeric' } as Partial<FixtureBehaviour>, 'next-page-token-numeric'],
      ['a source that sends no vocabulary version header', { cbvVersion: null } as Partial<FixtureBehaviour>, 'cbv-version-header-absent'],
      ['a full last page followed by an empty page', { emptyTailPage: true } as Partial<FixtureBehaviour>, 'empty-final-page'],
      ['a cursor expiry that cannot be read as a time', { pageHeaders: (headers) => { if (headers.Link != null) headers['GS1-Next-Page-Token-Expires'] = '1773100800'; } } as Partial<FixtureBehaviour>, 'cursor-expiry-unreadable'],
    ])('accepts %s, records it, and retains exactly what a strict source would give', async (_what, behaviour, leniency) => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(4), behaviour);
      const result = ran(await pull(storage, server));
      expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted', events: { total: 4, new: 4 } });
      expect(result.leniencies).toEqual([leniency]);
      expect(result.pages.some((page) => page.leniencies.includes(leniency as never))).toBe(true);
      expect(await retainedBy(storage)).toEqual(await strictly(pullEvents(4)));
      expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    });

    it('reads the empty page after a full last page as the end, and keeps it', async () => {
      const { storage } = await newStore();
      const result = ran(await pull(storage, await serve(pullEvents(4), { emptyTailPage: true })));
      expect(result.pages.map((page) => [page.page, page.events.total, page.last, page.leniencies])).toEqual([[1, 2, false, []], [2, 2, false, []], [3, 0, true, ['empty-final-page']]]);
    });

    describe('a list sent as repeated parameters', () => {
      /** Three event types and three items, so each of the two lists holds more than one value. */
      const mixed = (): JsonObject[] => [pullEvent(1), pullEvent(2, { type: 'AggregationEvent', parentID: pullItem(2), childEPCs: [pullItem(20)], epcList: undefined }), pullEvent(3), pullEvent(4, { type: 'TransactionEvent', bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000004:PO-1' }] }), pullEvent(5)];
      const query = { eventTypes: ['ObjectEvent', 'AggregationEvent'], matchAnyEPC: [pullItem(1), pullItem(2), pullItem(3), pullItem(5)], perPage: 2 };
      const repeating = (server: FixtureServer, over: Partial<EpcisPullSource> = {}): EpcisPullSource => sourceOf(server, { repeatListParameters: true, ...over });

      it('sends a list pipe-delimited by default, which a source that reads only repeated parameters answers with an error', async () => {
        const { storage } = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated' });
        const result = ran(await pull(storage, server, { query }));
        expect(result).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 500, completion: 'failed', pages: [], leniencies: [] });
        expect(server.pageRequests()[0]!.queryAll).toMatchObject({ eventType: ['AggregationEvent|ObjectEvent'], MATCH_anyEPC: [[pullItem(1), pullItem(2), pullItem(3), pullItem(5)].join('|')] });
        expect(result.pull!.source).not.toHaveProperty('repeatListParameters');
        expect(await listEpcisImports(storage)).toEqual([]);
      });

      it('makes the same query succeed when the source is configured for it, and records the leniency in the pull record, each page and the result', async () => {
        const { storage } = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated' });
        // The query that failed, under the same name: how a list is written is the operator's to change without making a new pull.
        expect(ran(await pull(storage, server, { query }))).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error' });
        const result = ran(await pull(storage, server, { query, source: repeating(server) }));
        expect(result).toMatchObject({ outcome: 'ok', reason: 'exhausted', events: { total: 4, new: 4 }, leniencies: ['list-parameters-repeated'] });
        expect(result.pull!.source).toMatchObject({ repeatListParameters: true });
        expect(result.pages).toHaveLength(2);
        expect(result.pages.every((page) => page.leniencies.includes('list-parameters-repeated'))).toBe(true);
        expect((await getEpcisPull(storage, 'source-a', 'query-1'))!.source.repeatListParameters).toBe(true);

        // One parameter per value on the wire, on the first page and on the page the source's own link names.
        const [, first, second] = server.pageRequests();
        expect(first!.queryAll).toEqual({ MATCH_anyEPC: [pullItem(1), pullItem(2), pullItem(3), pullItem(5)], eventType: ['AggregationEvent', 'ObjectEvent'], perPage: ['2'] });
        expect(second!.queryAll).toMatchObject({ eventType: ['AggregationEvent', 'ObjectEvent'], nextPageToken: [expect.any(String)] });
        // What is recorded has one form whatever was sent: the query, the pass and each page's provenance keep the list in one value.
        const recorded = { MATCH_anyEPC: [pullItem(1), pullItem(2), pullItem(3), pullItem(5)].join('|'), eventType: 'AggregationEvent|ObjectEvent', perPage: '2' };
        expect(result.pull!.pass.parameters).toEqual(recorded);
        expect(result.pages[0]!.query).toEqual(recorded);
        expect((await getEpcisImport(storage, result.pages[0]!.importId))!.sourceLocation).toMatchObject({ kind: 'query', query: recorded });
        expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
      });

      it('retains exactly what the pipe-delimited query retains from a source that reads that form', async () => {
        const piped = await newStore();
        expect(ran(await pull(piped.storage, await serve(mixed()), { query }))).toMatchObject({ outcome: 'ok', events: { total: 4 }, leniencies: [] });
        const repeated = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated' });
        ran(await pull(repeated.storage, server, { query, source: repeating(server) }));
        expect(await retainedBy(repeated.storage)).toEqual(await retainedBy(piped.storage));
        expect(await retainedBy(repeated.storage)).toHaveLength(4);
      });

      it('continues after a restart in the middle, still sending nothing pipe-delimited', async () => {
        const { storage, reopen } = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated' });
        const first = ran(await pull(storage, server, { query, source: limited(server, { maxPullPages: 1 }, { repeatListParameters: true }) }));
        expect(first).toMatchObject({ outcome: 'partial-history', reason: 'page-limit', leniencies: ['list-parameters-repeated'] });
        const second = ran(await pull(await reopen(), server, { query, source: repeating(server) }));
        expect(second).toMatchObject({ outcome: 'ok', reason: 'exhausted', leniencies: ['list-parameters-repeated'], run: { resumed: true } });
        expect(first.events.total + second.events.total).toBe(4);
        expect(server.pageRequests().every((request) => Object.values(request.queryAll).flat().every((value) => !value.includes('|')))).toBe(true);
      });

      it('records no leniency when every list holds one value, since nothing is sent differently', async () => {
        const { storage } = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated' });
        const result = ran(await pull(storage, server, { query: { eventTypes: ['ObjectEvent'], eventIds: [pullEventId(1)], perPage: 2 }, source: repeating(server) }));
        expect(result).toMatchObject({ outcome: 'ok', events: { total: 1 }, leniencies: [] });
        expect(result.pages[0]!.leniencies).toEqual([]);
        // The configuration is still recorded as it was.
        expect(result.pull!.source.repeatListParameters).toBe(true);
      });

      it('says how it asked even when the run fails before a page is held', async () => {
        const { storage } = await newStore();
        const server = await serve(mixed(), { listParameters: 'repeated', forbid: true });
        expect(ran(await pull(storage, server, { query, source: repeating(server) }))).toMatchObject({ outcome: 'source-forbidden', pages: [], leniencies: ['list-parameters-repeated'] });
      });
    });

    it('follows a relative next link, which is no leniency', async () => {
      const { storage } = await newStore();
      const result = ran(await pull(storage, await serve(pullEvents(4), { linkTarget: 'relative' })));
      expect(result).toMatchObject({ outcome: 'ok', events: { total: 4 }, leniencies: [] });
    });

    it('records the versions the source reports, and accepts a later patch version', async () => {
      const { storage } = await newStore();
      const result = ran(await pull(storage, await serve(pullEvents(1), { epcisVersion: '2.0.1', cbvVersion: null })));
      expect(result.server).toEqual({ epcis: '2.0.1' });
      expect(result.pages[0]!.server).toEqual({ epcis: '2.0.1' });
    });

    it.each([
      ['no EPCIS version header', { epcisVersion: null } as Partial<FixtureBehaviour>, 'wire-version-missing'],
      ['another EPCIS version', { epcisVersion: '1.2' } as Partial<FixtureBehaviour>, 'wire-version-unsupported'],
      ['another vocabulary version', { cbvVersion: '1.2.3' } as Partial<FixtureBehaviour>, 'wire-version-unsupported'],
    ])('is not lenient about %s', async (_what, behaviour, reason) => {
      const { storage } = await newStore();
      const result = ran(await pull(storage, await serve(pullEvents(2), behaviour)));
      expect(result).toMatchObject({ outcome: 'invalid-source', reason, completion: 'failed', pages: [] });
      expect(await listEpcisImports(storage)).toEqual([]);
    });
  });

  describe('requests it refuses, before anything is requested or written', () => {
    it('refuses plain http and private addresses unless the local-test option is set, and records the option when it is', async () => {
      const { storage } = await newStore();
      const never = vi.fn<EpcisFetch>(() => { throw new Error('nothing may be requested'); });
      const at = (baseUrl: string, over: Partial<PullEpcisEventsInput> = {}): Promise<EpcisPullOutcome> =>
        pullEpcisEvents({ storage, source: { sourceId: 'source-a', baseUrl, permittedOrigins: [new URL(baseUrl).origin], policy: { policyId: 'test-policy@1' } }, queryId: `at ${baseUrl}`, query: {}, fetch: never, now: () => AT, ...over });
      for (const baseUrl of ['http://events.example.org/epcis', 'https://10.0.0.5/epcis', 'https://192.168.1.20:8443/epcis', 'https://127.0.0.1/epcis', 'https://localhost/epcis', 'https://[::1]/epcis', 'https://169.254.169.254/latest', 'https://repository.internal/epcis', 'https://[::ffff:10.0.0.1]/epcis']) {
        const result = ran(await at(baseUrl));
        expect(result, baseUrl).toMatchObject({ outcome: 'source-unavailable', reason: 'target-refused', completion: 'failed', localTest: false, pull: { source: { localTest: false } } });
      }
      // A public name that resolves to a private address, when the caller can say what it resolves to.
      expect(ran(await at('https://events.example.org/epcis', { resolveHost: async () => ['93.184.216.34', '10.1.2.3'] }))).toMatchObject({ outcome: 'source-unavailable', reason: 'target-refused' });
      expect(never).not.toHaveBeenCalled();

      const server = await serve(pullEvents(1));
      expect(ran(await pull(storage, server))).toMatchObject({ outcome: 'ok', localTest: true, pull: { source: { localTest: true } } });
      expect(ran(await pull(storage, server, { queryId: 'not-local', source: sourceOf(server, { localTest: false }) }))).toMatchObject({ outcome: 'source-unavailable', reason: 'target-refused', localTest: false });
    });

    it('answers source-link-missing for a source with no base address, and writes nothing', async () => {
      const { storage } = await newStore();
      const never = vi.fn<EpcisFetch>(() => { throw new Error('nothing may be requested'); });
      const result = ran(await pullEpcisEvents({ storage, source: { sourceId: 'source-a', permittedOrigins: [], policy: { policyId: 'test-policy@1' } }, queryId: 'query-1', query: {}, fetch: never }));
      expect(result).toMatchObject({ outcome: 'source-link-missing', reason: 'no-base-address', completion: 'failed', exhausted: false, pages: [] });
      expect(result.pull).toBeUndefined();
      expect(await dump(storage)).toEqual([]);
      expect(never).not.toHaveBeenCalled();
    });

    it('refuses a malformed request by name', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(1));
      const cases: Array<[string, Partial<PullEpcisEventsInput>]> = [
        ['a base address with user information', { source: sourceOf(server, { baseUrl: server.baseUrl.replace('http://', 'http://user:password@') }) }],
        ['a base address with a query', { source: sourceOf(server, { baseUrl: `${server.baseUrl}?key=value` }) }],
        ['a base address whose origin is not listed', { source: sourceOf(server, { permittedOrigins: ['https://events.example.org'] }) }],
        ['a permitted origin with a path', { source: sourceOf(server, { permittedOrigins: [server.origin, 'https://events.example.org/epcis'] }) }],
        ['a credential in place of a provider', { source: sourceOf(server, { credentials: bearer() as never }) }],
        ['a query member the profile does not select', { query: { LT_recordTime: AT } as never }],
        ['an upper bound on record time', { query: { recordTime: { from: AT, until: AT } as never } }],
        ['a time without a zone', { query: { eventTime: { from: '2026-03-02T08:00:00' } } }],
        ['a value with the list separator', { query: { eventIds: ['urn:a|urn:b'] } }],
        ['an empty list', { query: { matchAnyEPC: [] } }],
        ['an overlap past a day', { recordTimeOverlapSeconds: 86_401 }],
        ['an unknown window', { window: 'everything' as never }],
        ['a wire version that is not one', { source: sourceOf(server, { wireVersions: { epcis: 'latest' } }) }],
        ['a list encoding that is not a switch', { source: sourceOf(server, { repeatListParameters: 'repeated' as never }) }],
        ['no query name', { queryId: '' }],
        ['no transport', { fetch: undefined as never }],
      ];
      for (const [what, over] of cases) expect(await pull(storage, server, over), what).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      expect(await pull(storage, server, { source: sourceOf(server, { credentials: () => ({ scheme: 'bearer', token: 'short' }) }) })).toMatchObject({ outcome: 'refused', reason: 'credentials-unavailable' });
      expect(server.requests).toEqual([]);
      expect(await dump(storage)).toEqual([]);
    });

    it('refuses the same query name with another definition, and the earlier pull stands', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(3));
      const first = ran(await pull(storage, server));
      const asked = server.requests.length;
      expect(await pull(storage, server, { query: { perPage: 3 } })).toMatchObject({ outcome: 'refused', reason: 'pull-conflict' });
      expect(await pull(storage, server, { recordTimeOverlapSeconds: 10 })).toMatchObject({ outcome: 'refused', reason: 'pull-conflict' });
      expect(server.requests).toHaveLength(asked);
      expect(await getEpcisPull(storage, 'source-a', 'query-1')).toEqual(first.pull);
      // Limits and permitted origins are the operator's to change without making a new source.
      expect(ran(await pull(storage, server, { source: limited(server, { maxPullPages: 5 }, { permittedOrigins: [server.origin, 'https://mirror.example.org'] }) })).pull).toMatchObject({ limits: { maxPullPages: 5 }, source: { permittedOrigins: ['https://mirror.example.org', server.origin].sort() } });
    });

    it('refuses to run without the pinned GS1 schema, before the source is asked', async () => {
      const { storage } = await newStore();
      const server = await serve(pullEvents(1));
      const empty = mkdtempSync(join(tmpdir(), 'dpp-epcis-pull-gs1-'));
      folders.push(empty);
      const outcome = await pull(storage, server, { artefactsDir: empty });
      expect(outcome).toMatchObject({ outcome: 'refused', reason: 'gs1-artefact-unavailable' });
      if (outcome.outcome === 'refused') expect(outcome.remedy).toContain('dpp-gs1-artefacts fetch');
      expect(server.requests).toEqual([]);
      expect(await dump(storage)).toEqual([]);
    });
  });
});

describe('the pull records and their contract', () => {
  const repo = join(import.meta.dirname, '..', '..', '..');
  const schema = (name: string): JsonObject => JSON.parse(readFileSync(join(repo, 'contracts', name), 'utf8')) as JsonObject;
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  const validateImport = ajv.compile(schema('epcis-import.schema.json'));
  const validateRecord = ajv.compile(schema('epcis-exchange-records.schema.json'));

  it('validates every pull record, page record and page import the module writes, the unfinished ones included', async () => {
    const storage = createMemoryEpcisStorage();
    const seen = new Map<string, JsonObject[]>();
    // Every value of every batch is looked at as it is written, so states that exist only between two steps are checked too.
    const watching: EpcisExchangeStorage = { ...storage, commit: (writes) => { for (const write of writes) if (write.op === 'put') seen.set(write.kind, [...(seen.get(write.kind) ?? []), structuredClone(write.value)]); return storage.commit(writes); } };
    let now = Date.parse(AT);
    const clock = (): string => new Date(now).toISOString();
    const server = await serve(pullEvents(7), { tokenTtlSeconds: 60, clock: () => now, creationDate: 'changing', cbvVersion: null, linkRelation: 'unquoted' });
    const options = { source: limited(server, { maxPullPages: 3, maxPullSeconds: 600 }, { credentials: bearer }), now: clock };
    ran(await pull(watching, server, options));
    now += 120_000;
    ran(await pull(watching, server, options));
    ran(await pull(watching, server, options));
    server.events.push(pullEvent(8, { recordTime: pullTime(40) }));
    ran(await pull(watching, server, options));
    ran(await pull(watching, server, { ...options, queryId: 'refresh', query: { eventIds: [pullEventId(1)], matchAnyEPC: [pullItem(1)], eventTypes: ['ObjectEvent'], eventTime: { from: pullTime(0, 8), until: pullTime(59, 8) }, recordTime: { from: pullTime(0) } } }));
    const failing = await serve(pullEvents(3), { pageHeaders: (headers) => { headers.Link = '<http://[bad>; rel="next"'; } });
    ran(await pull(watching, failing, { queryId: 'failing' }));
    ran(await pull(watching, await serve([], { forbid: true }), { queryId: 'forbidden' }));
    const repeating = await serve(pullEvents(3), { listParameters: 'repeated' });
    ran(await pull(watching, repeating, { queryId: 'repeated', query: { eventIds: [pullEventId(1), pullEventId(2), pullEventId(3)], perPage: 2 }, source: sourceOf(repeating, { repeatListParameters: true }) }));

    const pulls = seen.get('pull') ?? [];
    const pages = seen.get('pull-page') ?? [];
    expect(pulls.length).toBeGreaterThan(20);
    expect(pages.length).toBeGreaterThan(8);
    for (const record of [...pulls, ...pages]) expect(validateRecord(record), `${JSON.stringify(record).slice(0, 400)} ${JSON.stringify(validateRecord.errors)}`).toBe(true);
    for (const record of seen.get('import') ?? []) expect(validateImport(record), JSON.stringify(validateImport.errors)).toBe(true);
    expect((seen.get('import') ?? []).every((record) => (record.sourceLocation as JsonObject).kind === 'query')).toBe(true);
    // Every state the contract must be able to say was seen.
    expect(new Set(pulls.map((record) => record.status))).toEqual(new Set(['running', 'exhausted', 'stopped-at-limit', 'failed']));
    expect(pulls.some((record) => record.pending != null)).toBe(true);
    // The configured leniency is in the contract where it is recorded: the source scope, a page read ahead of its checkpoint and each page record.
    expect(pulls.some((record) => (record.source as JsonObject).repeatListParameters === true)).toBe(true);
    expect(pulls.some((record) => ((record.pending as JsonObject | undefined)?.leniencies as string[] | undefined)?.includes('list-parameters-repeated') === true)).toBe(true);
    expect(pages.filter((record) => (record.leniencies as string[]).includes('list-parameters-repeated'))).toHaveLength(2);
    expect(pulls.some((record) => record.cursor != null && (record.cursor as JsonObject).expiresAt != null)).toBe(true);
    expect(pulls.some((record) => record.replay != null)).toBe(true);
    expect(pulls.some((record) => record.watermark != null && ((record.pass as JsonObject).window as JsonObject).basis === 'watermark')).toBe(true);
    expect(pulls.some((record) => (record.pending as JsonObject | undefined)?.nextProblem != null)).toBe(true);
    expect(pages.some((record) => record.importReplayed === true) || pages.some((record) => (record.events as JsonObject).duplicate !== 0)).toBe(true);
    expect(new Set([...pulls, ...pages].map((record) => record.recordVersion))).toEqual(new Set(['1']));

    // The contract refuses what a pull record must never be.
    const pullRecord = pulls.at(-1)!;
    expect(validateRecord({ ...pullRecord, status: 'complete' })).toBe(false);
    expect(validateRecord({ ...pullRecord, credential: 'anything' })).toBe(false);
    expect(validateRecord({ ...pullRecord, source: { ...(pullRecord.source as JsonObject), token: 'anything' } })).toBe(false);
    expect(validateRecord({ ...pullRecord, recordVersion: '2' })).toBe(false);
    const { definitionDigest: _digest, ...unbound } = pullRecord;
    expect(validateRecord(unbound)).toBe(false);
    expect(validateRecord({ ...pages[0]!, importId: undefined })).toBe(false);
  });

  it('gives each reason one outcome, and names all eight outcomes', () => {
    expect(new Set(Object.values(EPCIS_PULL_REASON_OUTCOME))).toEqual(new Set(['source-link-missing', 'source-authentication-required', 'source-forbidden', 'source-unavailable', 'unexpected-media-type', 'invalid-source', 'partial-history', 'ok']));
    expect(Object.entries(EPCIS_PULL_REASON_OUTCOME).filter(([, outcome]) => outcome === 'ok')).toEqual([['exhausted', 'ok']]);
    const importSchema = schema('epcis-import.schema.json');
    expect(new Set(((importSchema.$defs as JsonObject).sourceOutcome as JsonObject).enum as string[])).toEqual(new Set(Object.values(EPCIS_PULL_REASON_OUTCOME)));
  });
});

describe('the pieces a pull is made of', () => {
  it('reads the next relation of a Link header, quoted or not, and refuses what it cannot read', () => {
    const page = 'https://events.example.org/epcis/events?perPage=2';
    const next = 'https://events.example.org/epcis/events?perPage=2&nextPageToken=abc';
    expect(parseNextLink(null, page)).toEqual({ kind: 'none' });
    expect(parseNextLink('', page)).toEqual({ kind: 'none' });
    expect(parseNextLink(`<${next}>; rel="next"`, page)).toEqual({ kind: 'next', target: next, unquoted: false });
    expect(parseNextLink(`<${next}>; rel=next`, page)).toEqual({ kind: 'next', target: next, unquoted: true });
    expect(parseNextLink(`<${next}>;REL=NEXT;title="a, b"`, page)).toEqual({ kind: 'next', target: next, unquoted: true });
    expect(parseNextLink('<events?perPage=2&nextPageToken=abc>; rel="next"', page)).toEqual({ kind: 'next', target: next, unquoted: false });
    expect(parseNextLink(`<https://events.example.org/first>; rel="first", <${next}>; rel="prev next"`, page)).toEqual({ kind: 'next', target: next, unquoted: false });
    // A comma inside a target or a quoted parameter does not end the link.
    expect(parseNextLink(`<https://events.example.org/a,b>; rel="last"; title="one, two", <${next}>; rel="next"`, page)).toEqual({ kind: 'next', target: next, unquoted: false });
    expect(parseNextLink('<https://events.example.org/other>; rel="last"', page)).toEqual({ kind: 'none' });
    expect(parseNextLink(`<${next}>; rel="nextish"`, page)).toEqual({ kind: 'none' });
    expect(parseNextLink(`<${next}>; rel="next", <${next}>; rel=next`, page)).toMatchObject({ kind: 'next', target: next });
    expect(parseNextLink(`<${next}>; rel="next", <${next}x>; rel="next"`, page).kind).toBe('malformed');
    expect(parseNextLink(`<${next}; rel="next"`, page).kind).toBe('malformed');
    expect(parseNextLink('<http://[bad>; rel="next"', page).kind).toBe('malformed');
    expect(parseNextLink(`<${next}>; rel="next"${' '.repeat(9000)}`, page).kind).toBe('malformed');
  });

  it('tells a private or local host from a public one', () => {
    for (const host of ['localhost', 'app.localhost', 'db.internal', 'printer.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '[::1]', '[::]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]', '[::ffff:192.168.1.1]', '[64:ff9b::a00:1]', '[not:an:address]']) expect(isPrivateHost(host), host).toBe(true);
    for (const host of ['events.example.org', '93.184.216.34', '172.32.0.1', '100.128.0.1', '[2001:db8::1]', '[2606:4700::1111]']) expect(isPrivateHost(host), host).toBe(false);
  });

  it('never uses the global transport: only the one it is handed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('the pull must request through the transport it was handed'); }));
    const storage = createMemoryEpcisStorage();
    const server = await serve(pullEvents(3));
    const { Agent, request } = await import('node:http');
    void Agent;
    // A transport that is not the standard one at all: it only has to answer in the same shape.
    const byHand: EpcisFetch = (url) => new Promise((resolve, reject) => {
      request(url, { method: 'GET', headers: { 'gs1-epcis-version': '2.0.0' } }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => {
          let handed = false;
          resolve({
            status: incoming.statusCode ?? 0,
            headers: { get: (name) => { const value = incoming.headers[name.toLowerCase()]; return value == null ? null : String(value); } },
            body: { getReader: () => ({ read: async () => (handed ? { done: true } : ((handed = true), { done: false, value: new Uint8Array(Buffer.concat(chunks)) })), cancel: async () => undefined, releaseLock: () => undefined }) },
          });
        });
      }).on('error', reject).end();
    });
    const result = ran(await pull(storage, server, { fetch: byHand }));
    expect(result).toMatchObject({ outcome: 'ok', events: { total: 3 } });
    // Nothing a pull returns or keeps names a token operation, a key or a verdict about who made an event.
    const text = JSON.stringify([result, [...storage.state.records].map(([kind, table]) => [kind, [...table]])]);
    expect(text).not.toMatch(/\bsigned\b|\bsignature\b|\bauthentic|\btrusted\b|\bverified\b|\btxid\b|\boutpoint\b|\bprivate\s?key\b|\bISSUE\b|\bTRANSFER\b|\bRETIRE\b/i);
  });
});
