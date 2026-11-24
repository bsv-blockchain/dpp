import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { checkEpcisExchangeInvariants, epcisPullId, getEpcisPull, importEpcisSource, listEpcisPullPages, pullEpcisEvents, listEpcisImports, openFileEpcisStorage, recoverEpcisExchange } from '../src/epcis-exchange.js';
import { pullEvents, startEpcisFixtureServer } from './epcis-pull-server.js';
import { epcisDocument, fiveEventList } from './epcis-fixture.js';

const fault = vi.hoisted(() => ({ inject: undefined as ((operation: string, path: string) => void) | undefined }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const path = String(args[0]);
      fault.inject?.('open', path);
      const handle = await fs.open(...args);
      if (fault.inject) {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => { fault.inject?.('sync', path); await sync(); });
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...data) => { fault.inject?.('write', path); await write(...data); });
      }
      return handle;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => { fault.inject?.('rename', String(args[1])); await fs.rename(...args); },
  };
});

const directories: string[] = [];
const directory = async () => { const dir = await mkdtemp(join(tmpdir(), 'epcis-flush-')); directories.push(dir); return dir; };
afterEach(async () => {
  fault.inject = undefined;
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode(JSON.stringify(epcisDocument(fiveEventList())));
const digest = createHash('sha256').update(bytes).digest('hex');
const receivedAt = '2026-03-10T00:00:00.000Z';
const request = { sourceId: 'source', requestId: 'request', bytes, mediaType: 'application/json', receivedAt, provenance: { kind: 'file' as const }, policy: { policyId: 'test@1' }, now: () => receivedAt };
const ioError = (code: string) => Object.assign(new Error('injected filesystem error'), { code });

it('allows initialisation to be retried after the format file flush fails', async () => {
  const dir = await directory();
  const error = ioError('EIO');
  fault.inject = (op, path) => { if (op === 'sync' && path.endsWith('.tmp')) throw error; };
  await expect(openFileEpcisStorage(dir)).rejects.toBe(error);
  fault.inject = undefined;
  const reopened = await openFileEpcisStorage(dir);
  await reopened.putBytes(digest, bytes);
  await reopened.close();
});

it.each(['sync', 'open'])('refuses byte acknowledgement when the destination directory %s fails, including on retry', async (operation) => {
  const dir = await directory();
  const storage = await openFileEpcisStorage(dir);
  const shard = join(dir, 'bytes', digest.slice(0, 2));
  const error = ioError(operation === 'sync' ? 'EIO' : 'EACCES');
  const fail = (op: string, path: string) => { if (op === operation && path === shard) throw error; };
  fault.inject = fail;
  await expect(storage.putBytes(digest, bytes)).rejects.toBe(error);
  storage.abandon();
  fault.inject = undefined;
  const retry = await openFileEpcisStorage(dir);
  fault.inject = fail;
  await expect(retry.putBytes(digest, bytes)).rejects.toBe(error);
  retry.abandon();
  fault.inject = undefined;
  const recovered = await openFileEpcisStorage(dir);
  await recovered.putBytes(digest, bytes);
  expect(await recovered.getBytes(digest)).toEqual(bytes);
  await recovered.close();
});

it('establishes journal durability on reopen before applying a previously unflushed journal', async () => {
  const dir = await directory();
  const store = await openFileEpcisStorage(dir);
  const error = ioError('EIO');
  fault.inject = (op, path) => { if (op === 'sync' && path === join(dir, 'journal')) throw error; };
  await expect(store.commit([{ op: 'put', kind: 'suite', key: 'held', value: { n: 1 } }])).rejects.toBe(error);
  store.abandon();
  await expect(openFileEpcisStorage(dir)).rejects.toBe(error);
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(join(dir, 'records'))).toEqual([]);
  expect(await readdir(join(dir, 'journal'))).toHaveLength(1);
  fault.inject = undefined;
  const reopened = await openFileEpcisStorage(dir);
  expect(await reopened.get('suite', 'held')).toMatchObject({ value: { n: 1 } });
  await reopened.close();
});

it.each([
  ['write', '/tmp/'], ['rename', '/journal/'], ['sync', '/tmp/'], ['sync', '/journal'], ['sync', '/records/journal/'],
])('recovers one receipt when a durable import encounters %s at %s', async (operation, target) => {
  const dir = await directory();
  const store = await openFileEpcisStorage(dir);
  const error = ioError('EIO');
  fault.inject = (op, path) => { if (op === operation && path.startsWith(join(dir, target))) throw error; };
  await expect(importEpcisSource({ storage: store, ...request })).rejects.toBe(error);
  // A partially applied journal must never be visible through the failed adapter.
  await expect(store.list('journal', { limit: 10 })).rejects.toBe(error);
  store.abandon();
  fault.inject = undefined;
  const reopened = await openFileEpcisStorage(dir);
  await recoverEpcisExchange(reopened, { now: request.now });
  expect(await importEpcisSource({ storage: reopened, ...request })).toMatchObject({ outcome: 'retained', record: { receivedAt } });
  expect(await importEpcisSource({ storage: reopened, ...request, receivedAt: '2026-03-11T00:00:00Z' })).toMatchObject({ outcome: 'retained', replayed: true, record: { receivedAt } });
  expect(await listEpcisImports(reopened, { limit: 10 })).toHaveLength(1);
  expect(await checkEpcisExchangeInvariants(reopened)).toEqual([]);
  await reopened.close();
});

it('allows the explicitly unsynchronised mode on a filesystem that refuses sync', async () => {
  const dir = await directory();
  fault.inject = (operation) => { if (operation === 'sync') throw ioError('EIO'); };
  const storage = await openFileEpcisStorage(dir, { fsync: false });
  expect(await importEpcisSource({ storage, ...request })).toMatchObject({ outcome: 'retained' });
  await storage.close();
});

it('recovers the whole page and checkpoint after the page directory flush fails', async () => {
  const dir = await directory();
  const storage = await openFileEpcisStorage(dir);
  const server = await startEpcisFixtureServer(pullEvents(3));
  try {
    const source = { sourceId: 'source', baseUrl: server.baseUrl, permittedOrigins: [server.origin], localTest: true, policy: request.policy };
    const query = { queryId: 'pages', query: { perPage: 2 }, source, fetch, now: request.now };
    const error = ioError('EIO');
    fault.inject = (op, path) => { if (op === 'sync' && path.startsWith(join(dir, 'records', 'pull-page'))) throw error; };
    await expect(pullEpcisEvents({ storage, ...query })).rejects.toBe(error);
    storage.abandon();
    fault.inject = undefined;
    const reopened = await openFileEpcisStorage(dir);
    await recoverEpcisExchange(reopened, { now: request.now });
    const pages = () => listEpcisPullPages(reopened, epcisPullId('source', 'pages'));
    expect((await getEpcisPull(reopened, 'source', 'pages'))?.pagesAcknowledged).toBe(1);
    expect((await pages()).map(page => page.sequence)).toEqual([1]);
    expect(await pullEpcisEvents({ storage: reopened, ...query })).toMatchObject({ outcome: 'ok' });
    expect((await pages()).map(page => page.sequence)).toEqual([1, 2]);
    expect(await listEpcisImports(reopened)).toHaveLength(2);
    expect(await checkEpcisExchangeInvariants(reopened)).toEqual([]);
    await reopened.close();
  } finally { await server.close(); }
});
