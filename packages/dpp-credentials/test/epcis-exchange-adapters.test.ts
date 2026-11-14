import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EPCIS_RECORD_KINDS,
  EpcisStorageError,
  EpcisStorageFault,
  checkEpcisExchangeInvariants,
  createMemoryEpcisState,
  createMemoryEpcisStorage,
  epcisStorageAdapterSuite,
  exportEpcisSource,
  findEpcisImportByRequest,
  importEpcisSource,
  openFileEpcisStorage,
  recoverEpcisExchange,
  runEpcisStorageAdapterSuite,
  type EpcisExchangeStorage,
  type EpcisImportOutcome,
  type EpcisStorageAdapterHarness,
  type FileEpcisStorage,
  type FileEpcisStorageStep,
} from '../src/epcis-exchange.js';
import type { JsonObject } from '../src/types.js';
import { epcisDocument, fiveEventList } from './epcis-fixture.js';

const folders: string[] = [];
const folder = (): string => { const dir = mkdtempSync(join(tmpdir(), 'dpp-epcis-exchange-')); folders.push(dir); return dir; };
afterAll(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });

const memoryHarness = (): EpcisStorageAdapterHarness => {
  // One state, a new adapter on each open: a restart that kept its storage.
  const state = createMemoryEpcisState();
  return { open: async () => createMemoryEpcisStorage(state) };
};

/** The simulated crashes are made by the test, so the flush to the device adds nothing but time. One case below runs with it on. */
const fileHarness = (fsync = false) => (): EpcisStorageAdapterHarness => {
  const dir = folder();
  return {
    open: () => openFileEpcisStorage(dir, { fsync }),
    abandon: (storage) => (storage as FileEpcisStorage).abandon(),
    destroy: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe.each([
  ['the in-memory adapter', memoryHarness],
  ['the file-system adapter', fileHarness()],
])('the shared adapter suite: %s', (_name, harness) => {
  const cases = epcisStorageAdapterSuite(harness);
  it('covers the interface and every crash', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
    expect(cases.filter((test) => test.name.startsWith('crash:')).length).toBe(5);
  });
  for (const test of cases) it(test.name, test.run, 120_000);
});

describe('the shared adapter suite, used as an application would', () => {
  it('reports every case when it is run without a test framework', async () => {
    const report = await runEpcisStorageAdapterSuite(memoryHarness);
    expect(report.results.filter((result) => !result.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);

  it('fails an adapter that answers before a batch is whole', async () => {
    // An adapter whose commit applies writes one at a time and stops at a failed expectation: it compiles, and it is wrong.
    const broken = (): EpcisStorageAdapterHarness => {
      const state = createMemoryEpcisState();
      return {
        open: async () => {
          const inner = createMemoryEpcisStorage(state);
          return {
            ...inner,
            commit: async (writes) => {
              for (const write of writes) {
                const result = await inner.commit([write]);
                if (!result.committed) return result;
              }
              return { committed: true };
            },
          } satisfies EpcisExchangeStorage;
        },
      };
    };
    const report = await runEpcisStorageAdapterSuite(broken);
    expect(report.ok).toBe(false);
    expect(report.results.filter((result) => !result.ok).map((result) => result.name)).toEqual(expect.arrayContaining(['commit: a failed expectation is answered, and nothing of the batch is written']));
  }, 120_000);

  it('fails an adapter that loses what it acknowledged', async () => {
    // An adapter that keeps records in the process and forgets them on a restart.
    const forgetful = (): EpcisStorageAdapterHarness => {
      const state = createMemoryEpcisState();
      return { open: async () => createMemoryEpcisStorage({ bytes: state.bytes, records: new Map() }) };
    };
    const report = await runEpcisStorageAdapterSuite(forgetful);
    expect(report.ok).toBe(false);
    expect(report.results.find((result) => result.name === 'exchange: an acknowledged import is whole after a reopen without a close')?.ok).toBe(false);
  }, 120_000);
});

describe('the file-system adapter', () => {
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  const AT = '2026-03-10T00:00:00.000Z';
  const documentBytes = utf8(JSON.stringify(epcisDocument(fiveEventList()), null, 2));
  const request = (storage: EpcisExchangeStorage, requestId = 'request-1', bytes = documentBytes) => ({ storage, sourceId: 'source-a', requestId, bytes, mediaType: 'application/ld+json', receivedAt: AT, provenance: { kind: 'file' as const }, policy: { policyId: 'test-policy@1' }, now: () => AT });
  const record = (outcome: EpcisImportOutcome) => { if (outcome.outcome !== 'retained') throw new Error(JSON.stringify(outcome)); return outcome.record; };
  const dump = async (storage: EpcisExchangeStorage): Promise<Array<[string, string, JsonObject]>> => {
    const out: Array<[string, string, JsonObject]> = [];
    for (const kind of Object.values(EPCIS_RECORD_KINDS)) for (const held of await storage.list(kind, { limit: 100_000 })) out.push([kind, held.key, held.value]);
    return out;
  };

  it('keeps an import across a clean close and a reopen, flushing to the device', async () => {
    const dir = folder();
    const first = await openFileEpcisStorage(dir);
    const imported = record(await importEpcisSource(request(first)));
    await first.close();
    await expect(first.get('import', 'aaaa')).rejects.toMatchObject({ code: 'closed' });
    const second = await openFileEpcisStorage(dir);
    expect(second.reopened).toEqual({ journalsApplied: 0, temporariesRemoved: 0, staleLockReplaced: false });
    expect(await findEpcisImportByRequest(second, 'source-a', 'request-1')).toEqual(imported);
    expect(Buffer.from((await exportEpcisSource(second, imported.importId))!.bytes).equals(Buffer.from(documentBytes))).toBe(true);
    // The bytes on disk are the bytes that arrived, under their digest.
    expect(readFileSync(join(dir, 'bytes', imported.sha256.slice(0, 2), imported.sha256)).equals(Buffer.from(documentBytes))).toBe(true);
    expect(await checkEpcisExchangeInvariants(second, { associations: true })).toEqual([]);
    await second.close();
  });

  it('lets one process use a folder at a time, and takes over a lock its holder left behind', async () => {
    const dir = folder();
    const first = await openFileEpcisStorage(dir, { fsync: false });
    await expect(openFileEpcisStorage(dir, { fsync: false })).rejects.toMatchObject({ code: 'locked' });
    first.abandon();
    await expect(first.get('import', 'aaaa')).rejects.toBeInstanceOf(EpcisStorageError);
    const second = await openFileEpcisStorage(dir, { fsync: false });
    expect(second.reopened.staleLockReplaced).toBe(true);
    await second.close();
    // A lock naming a process that no longer exists is replaced too.
    writeFileSync(join(dir, 'lock'), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    const third = await openFileEpcisStorage(dir, { fsync: false });
    expect(third.reopened.staleLockReplaced).toBe(true);
    await third.close();
    expect(readdirSync(dir)).not.toContain('lock');
  });

  it('refuses a folder that is not an exchange folder, and a journal file that is damaged', async () => {
    const foreign = folder();
    writeFileSync(join(foreign, 'notes.txt'), 'something else lives here');
    await expect(openFileEpcisStorage(foreign)).rejects.toMatchObject({ code: 'corrupt' });
    expect(readdirSync(foreign)).toEqual(['notes.txt']);

    const dir = folder();
    const storage = await openFileEpcisStorage(dir, { fsync: false });
    await storage.commit([{ op: 'put', kind: 'suite', key: 'held', value: { n: 1 } }]);
    await storage.close();
    writeFileSync(join(dir, 'journal', '00000000000000000001.json'), JSON.stringify({ journalVersion: '1', sha256: '0'.repeat(64), writes: [{ op: 'put', kind: 'suite', key: 'held', revision: 9, value: { n: 9 } }] }));
    await expect(openFileEpcisStorage(dir, { fsync: false })).rejects.toMatchObject({ code: 'corrupt' });
    // It was not half applied: the record is as it was.
    rmSync(join(dir, 'journal', '00000000000000000001.json'));
    const again = await openFileEpcisStorage(dir, { fsync: false });
    expect((await again.get('suite', 'held'))!.value).toEqual({ n: 1 });
    await again.close();
  });

  it('applies a batch whole when it is stopped at any file-system step and reopened', async () => {
    const writes = [
      { op: 'put' as const, kind: 'suite', key: 'one.record', value: { n: 1 } },
      { op: 'put' as const, kind: 'suite', key: 'two.record', value: { n: 2 }, expect: 1 },
      { op: 'delete' as const, kind: 'suite', key: 'three.record' },
    ];
    const seed = async (storage: EpcisExchangeStorage): Promise<void> => { await storage.commit([{ op: 'put', kind: 'suite', key: 'two.record', value: { n: 0 } }, { op: 'put', kind: 'suite', key: 'three.record', value: { n: 3 } }]); };
    const before = [['three.record', 1, 3], ['two.record', 1, 0]];
    const after = [['one.record', 1, 1], ['two.record', 2, 2]];
    const steps: FileEpcisStorageStep[] = [];
    {
      const dir = folder();
      const counting = await openFileEpcisStorage(dir, { fsync: false });
      await seed(counting);
      await counting.close();
      const traced = await openFileEpcisStorage(dir, { fsync: false, interrupt: (step) => { steps.push(step); } });
      await traced.commit(writes);
      await traced.close();
    }
    expect(steps).toEqual(['journal-write', 'journal-commit', 'record-write', 'record-name', 'record-write', 'record-name', 'record-delete', 'journal-clear']);
    for (let at = 0; at < steps.length; at += 1) {
      const dir = folder();
      const seeded = await openFileEpcisStorage(dir, { fsync: false });
      await seed(seeded);
      await seeded.close();
      let seen = 0;
      const stopping = await openFileEpcisStorage(dir, { fsync: false, interrupt: () => { if (seen++ === at) throw new EpcisStorageFault(at + 1, 'before', steps[at]!); } });
      await expect(stopping.commit(writes)).rejects.toBeInstanceOf(EpcisStorageFault);
      await expect(stopping.get('suite', 'one.record')).rejects.toBeInstanceOf(EpcisStorageFault);
      const reopened = await openFileEpcisStorage(dir, { fsync: false });
      const held = (await reopened.list('suite', { limit: 10 })).map((r) => [r.key, r.revision, r.value.n]);
      // Before the journal file has its name the batch never happened. From then on it always completes.
      const committed = at >= 2;
      expect(held, `stopped before ${steps[at]} (step ${at + 1})`).toEqual(committed ? after : before);
      expect(reopened.reopened.journalsApplied, steps[at]).toBe(committed ? 1 : 0);
      expect(readdirSync(join(dir, 'journal'))).toEqual([]);
      expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
      await reopened.close();
    }
  });

  it('never shows half of a source: bytes stopped before they have their name are not there', async () => {
    const bytes = utf8('exact bytes');
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(bytes).digest('hex');
    for (const stopAt of ['bytes-write', 'bytes-name'] as const) {
      const dir = folder();
      const stopping = await openFileEpcisStorage(dir, { fsync: false, interrupt: (step) => { if (step === stopAt) throw new EpcisStorageFault(1, 'before', step); } });
      await expect(stopping.putBytes(digest, bytes)).rejects.toBeInstanceOf(EpcisStorageFault);
      const reopened = await openFileEpcisStorage(dir, { fsync: false });
      expect(await reopened.getBytes(digest), stopAt).toBeUndefined();
      expect(reopened.reopened.temporariesRemoved).toBe(stopAt === 'bytes-name' ? 1 : 0);
      await reopened.putBytes(digest, bytes);
      expect(Buffer.from((await reopened.getBytes(digest))!).toString()).toBe('exact bytes');
      await reopened.close();
    }
  });

  it('gives the same store when an import is stopped at every file-system step, then recovered and retried', async () => {
    // The uninterrupted import is the measure, and its trace is the list of places to stop.
    const steps: FileEpcisStorageStep[] = [];
    const controlDir = folder();
    const control = await openFileEpcisStorage(controlDir, { fsync: false, interrupt: (step) => { steps.push(step); } });
    const controlRecord = record(await importEpcisSource(request(control)));
    const controlStore = await dump(control);
    await control.close();
    expect(steps.length).toBeGreaterThan(60);
    expect(new Set(steps)).toEqual(new Set(['journal-write', 'journal-commit', 'record-write', 'record-name', 'record-delete', 'journal-clear', 'bytes-write', 'bytes-name']));

    const outcomes = { discarded: 0, finished: 0 };
    for (let at = 0; at < steps.length; at += 1) {
      const where = `stopped before file-system step ${at + 1} of ${steps.length} (${steps[at]})`;
      const dir = folder();
      let seen = 0;
      const stopping = await openFileEpcisStorage(dir, { fsync: false, interrupt: () => { if (seen++ === at) throw new EpcisStorageFault(at + 1, 'before', steps[at]!); } });
      await expect(importEpcisSource(request(stopping)), where).rejects.toBeInstanceOf(EpcisStorageFault);

      const reopened = await openFileEpcisStorage(dir, { fsync: false });
      const report = await recoverEpcisExchange(reopened, { now: () => AT });
      expect(report.remaining, where).toBe(0);
      expect(await checkEpcisExchangeInvariants(reopened, { associations: true }), where).toEqual([]);
      const held = await findEpcisImportByRequest(reopened, 'source-a', 'request-1');
      if (held == null) {
        // No receipt: nothing of the request is left, bytes included.
        outcomes.discarded += 1;
        expect(await reopened.getBytes(controlRecord.sha256), where).toBeUndefined();
        expect(await dump(reopened), where).toEqual([]);
      } else {
        // A receipt: recovery finished the import to the same result, and the source is whole.
        outcomes.finished += 1;
        expect(held, where).toEqual(controlRecord);
        expect(Buffer.from((await exportEpcisSource(reopened, held.importId))!.bytes).equals(Buffer.from(documentBytes)), where).toBe(true);
      }
      const retried = await importEpcisSource(request(reopened));
      expect(record(retried), where).toEqual(controlRecord);
      expect(await dump(reopened), where).toEqual(controlStore);
      await reopened.close();
    }
    // Both sides of the receipt were stopped at.
    expect(outcomes.discarded).toBeGreaterThan(3);
    expect(outcomes.finished).toBeGreaterThan(40);
  }, 240_000);
});
