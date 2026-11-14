/**
 * The shared suite every storage adapter must pass.
 *
 * The storage interface (storage.ts) is a list of promises, and a type
 * cannot check them. This suite does. It first holds an adapter to each
 * promise directly. It then runs real imports, a conflict decision and an
 * index rebuild over the adapter, stops the store before and after every
 * durable call, reopens it, and checks that no acknowledged source was lost,
 * that nothing is half recorded, and that finishing the work gives exactly
 * the store an uninterrupted run gives.
 *
 * The package runs it against both adapters it ships. An application runs
 * it against its own:
 *
 *   for (const test of epcisStorageAdapterSuite(() => myHarness())) it(test.name, test.run)
 *
 * It uses `node:assert` and no test framework, so it runs under any. The
 * pinned GS1 schema must be provisioned first: the imports it runs validate
 * for real.
 */
import assert from 'node:assert/strict';
import { EPCIS_CONTEXT_IRI } from '../epcis-source.js';
import type { JsonObject } from '../types.js';
import {
  checkEpcisExchangeInvariants,
  exportEpcisSource,
  findEpcisImportByRequest,
  getEpcisConflict,
  importEpcisSource,
  rebuildEpcisAssociations,
  recoverEpcisExchange,
  resolveEpcisConflict,
  type EpcisImportOutcome,
} from './exchange.js';
import { EPCIS_RECORD_KINDS, epcisConflictId, type EpcisImportRecord } from './records.js';
import { EpcisStorageError, EpcisStorageFault, faultInjectingEpcisStorage, sha256Hex, type EpcisExchangeStorage } from './storage.js';

export interface EpcisStorageAdapterHarness {
  /** Open the store. Called again after a simulated crash, and must then open the same durable state. */
  open(): Promise<EpcisExchangeStorage>;
  /** Drop a store without closing it, as a process that died would, so that `open` can be called again. */
  abandon?(storage: EpcisExchangeStorage): Promise<void> | void;
  /** Remove everything this harness made. */
  destroy?(): Promise<void> | void;
}

export interface EpcisStorageAdapterSuiteOptions {
  /** The folder the pinned GS1 schema is read from, when it is not the default. */
  artefactsDir?: string;
}

export interface EpcisStorageAdapterCase {
  name: string;
  run(): Promise<void>;
}

/* -------------------------------- fixtures ------------------------------- */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const AT = '2026-03-10T00:00:00.000Z';
// Synthetic identifiers under the GS1 demonstration prefix 952.
const ITEM = 'urn:epc:id:sgtin:9521234.012345.SUITE-1';
const PART = 'urn:epc:id:sgtin:9521234.022222.SUITE-2';
const LOT = 'urn:epc:class:lgtin:9521234.033333.SUITE-LOT';
const uuid = (n: number): string => `urn:uuid:00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = (type: string, n: number | undefined, fields: JsonObject): JsonObject => ({ type, eventTime: '2026-03-02T08:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z', ...(n == null ? {} : { eventID: uuid(n) }), ...fields });
const made = (): JsonObject => base('TransformationEvent', 1, { inputEPCList: [PART], inputQuantityList: [{ epcClass: LOT, quantity: 2, uom: 'EA' }], outputEPCList: [ITEM], bizStep: 'assembling', disposition: 'in_progress' });
const commissioned = (): JsonObject => base('ObjectEvent', 2, { epcList: [ITEM], action: 'ADD', bizStep: 'commissioning', disposition: 'active' });
const observed = (): JsonObject => base('ObjectEvent', undefined, { epcList: [ITEM], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active', 'example:note': 'seen on the line' });
const shipped = (): JsonObject => base('ObjectEvent', 4, { epcList: [ITEM], action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit' });
const envelope = (eventList: JsonObject[]): Uint8Array => utf8(JSON.stringify({ '@context': [EPCIS_CONTEXT_IRI, { example: 'https://example.org/vocab/' }], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-03-03T07:00:00.000Z', epcisBody: { eventList } }, null, 1));

/** Three events: one with a class quantity, one plain, one without an eventID. */
const FIRST = envelope([made(), commissioned(), observed()]);
/** Against FIRST: a repeat, a changed body under a held eventID, a changed record time, and a new event. */
const SECOND = envelope([made(), { ...commissioned(), disposition: 'in_transit' }, { ...made(), recordTime: '2026-03-08T09:00:00.000Z' }, shipped()]);
const CONFLICT_ID = epcisConflictId('suite-source', 'event-id', uuid(2));

/* --------------------------------- the suite ----------------------------- */

export function epcisStorageAdapterSuite(newHarness: () => Promise<EpcisStorageAdapterHarness> | EpcisStorageAdapterHarness, options: EpcisStorageAdapterSuiteOptions = {}): EpcisStorageAdapterCase[] {
  const request = (storage: EpcisExchangeStorage, requestId: string, bytes: Uint8Array) => ({
    storage,
    sourceId: 'suite-source',
    requestId,
    bytes,
    mediaType: 'application/ld+json',
    receivedAt: AT,
    provenance: { kind: 'file' as const, filename: `${requestId}.jsonld` },
    policy: { policyId: 'adapter-suite@1' },
    now: () => AT,
    ...(options.artefactsDir == null ? {} : { artefactsDir: options.artefactsDir }),
  });
  const retained = (outcome: EpcisImportOutcome): EpcisImportRecord => {
    assert.equal(outcome.outcome, 'retained', `the import was not retained: ${JSON.stringify(outcome).slice(0, 400)}`);
    return (outcome as Extract<EpcisImportOutcome, { outcome: 'retained' }>).record;
  };
  const acknowledge = async (storage: EpcisExchangeStorage, requestId: string, bytes: Uint8Array): Promise<EpcisImportRecord> => retained(await importEpcisSource(request(storage, requestId, bytes)));

  /** Every record of every kind this module writes, without revisions: what two stores must agree on to be the same store. */
  const dump = async (storage: EpcisExchangeStorage): Promise<Array<{ kind: string; key: string; value: JsonObject }>> => {
    const out: Array<{ kind: string; key: string; value: JsonObject }> = [];
    for (const kind of Object.values(EPCIS_RECORD_KINDS)) {
      let after: string | undefined;
      for (;;) {
        const page = await storage.list(kind, { ...(after == null ? {} : { after }), limit: 100 });
        for (const held of page) out.push({ kind, key: held.key, value: held.value });
        if (page.length < 100) break;
        after = page[page.length - 1]!.key;
      }
    }
    return out;
  };

  /** Run a case on a fresh store and remove it afterwards, whatever happened. */
  const withStore = async (run: (harness: EpcisStorageAdapterHarness, storage: EpcisExchangeStorage) => Promise<void>): Promise<void> => {
    const harness = await newHarness();
    try { await run(harness, await harness.open()); } finally { await harness.destroy?.(); }
  };
  const reopen = async (harness: EpcisStorageAdapterHarness, storage: EpcisExchangeStorage): Promise<EpcisExchangeStorage> => {
    await harness.abandon?.(storage);
    return harness.open();
  };

  const record = (n: number): JsonObject => ({ n, nested: { list: [1, 'two', null, true], text: 'café ☃' } });
  const cases: EpcisStorageAdapterCase[] = [];
  const add = (name: string, run: () => Promise<void>): void => { cases.push({ name, run }); };

  /* ---- the six promises of the interface ---- */

  add('bytes: holds exactly what was put, under its digest, and across a reopen', () => withStore(async (harness, storage) => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
    const digest = sha256Hex(bytes);
    assert.equal(await storage.getBytes(digest), undefined);
    await storage.putBytes(digest, bytes);
    await storage.putBytes(digest, bytes);
    assert.deepEqual([...(await storage.getBytes(digest))!], [...bytes]);
    const empty = new Uint8Array(0);
    await storage.putBytes(sha256Hex(empty), empty);
    assert.equal((await storage.getBytes(sha256Hex(empty)))!.byteLength, 0);
    const again = await reopen(harness, storage);
    assert.deepEqual([...(await again.getBytes(digest))!], [...bytes]);
    await again.deleteBytes(digest);
    await again.deleteBytes(digest);
    assert.equal(await again.getBytes(digest), undefined);
    assert.equal((await again.getBytes(sha256Hex(empty)))!.byteLength, 0);
  }));

  add('bytes: refuses bytes that do not have the digest they are stored under', () => withStore(async (_harness, storage) => {
    const bytes = utf8('exact');
    await assert.rejects(storage.putBytes(sha256Hex(utf8('other')), bytes), (error: unknown) => error instanceof EpcisStorageError && error.code === 'digest-mismatch');
    await assert.rejects(storage.putBytes('not-a-digest', bytes), (error: unknown) => error instanceof EpcisStorageError && error.code === 'invalid-digest');
    assert.equal(await storage.getBytes(sha256Hex(utf8('other'))), undefined);
  }));

  add('records: a put is read back whole, with a revision that counts its writes', () => withStore(async (harness, storage) => {
    assert.equal(await storage.get('suite', 'key-one'), undefined);
    assert.deepEqual(await storage.commit([{ op: 'put', kind: 'suite', key: 'key-one', value: record(1) }]), { committed: true });
    assert.deepEqual(await storage.get('suite', 'key-one'), { kind: 'suite', key: 'key-one', revision: 1, value: record(1) });
    await storage.commit([{ op: 'put', kind: 'suite', key: 'key-one', value: record(2) }]);
    assert.deepEqual(await storage.get('suite', 'key-one'), { kind: 'suite', key: 'key-one', revision: 2, value: record(2) });
    // The same key under another kind is another record.
    assert.equal(await storage.get('other', 'key-one'), undefined);
    const again = await reopen(harness, storage);
    assert.deepEqual(await again.get('suite', 'key-one'), { kind: 'suite', key: 'key-one', revision: 2, value: record(2) });
    await again.commit([{ op: 'delete', kind: 'suite', key: 'key-one' }, { op: 'delete', kind: 'suite', key: 'never-held' }]);
    assert.equal(await again.get('suite', 'key-one'), undefined);
    // A record put again after a delete starts a new count.
    await again.commit([{ op: 'put', kind: 'suite', key: 'key-one', value: record(3), expect: 'absent' }]);
    assert.equal((await again.get('suite', 'key-one'))!.revision, 1);
  }));

  add('records: what is handed in and what is handed out are copies', () => withStore(async (_harness, storage) => {
    const value = record(1);
    await storage.commit([{ op: 'put', kind: 'suite', key: 'copy', value }]);
    (value.nested as JsonObject).text = 'changed after the commit';
    const read = (await storage.get('suite', 'copy'))!;
    assert.deepEqual(read.value, record(1));
    (read.value.nested as JsonObject).text = 'changed after the read';
    assert.deepEqual((await storage.get('suite', 'copy'))!.value, record(1));
    assert.deepEqual((await storage.list('suite', { limit: 10 }))[0]!.value, record(1));
  }));

  add('records: a list is in key order, by prefix, after a key and up to a limit', () => withStore(async (harness, storage) => {
    const keys = ['aaaa', 'aaab', 'aa.a', 'aa-a', 'aa_a', 'aa..', 'ab00', 'b000', '0zzz', 'aaaa.1', 'aaaa-1', 'aaaa_1', 'aaaa1', 'zz-z.long-key_with.every-kind.of_character-0123456789'];
    await storage.commit(keys.map((key, n) => ({ op: 'put' as const, kind: 'suite', key, value: { n } })));
    await storage.commit([{ op: 'put', kind: 'other', key: 'aaaa', value: { n: -1 } }]);
    const ordered = [...keys].sort();
    const read = await reopen(harness, storage);
    assert.deepEqual((await read.list('suite', { limit: 100 })).map((held) => held.key), ordered);
    assert.deepEqual((await read.list('suite', { limit: 100 })).map((held) => held.value.n), ordered.map((key) => keys.indexOf(key)));
    assert.deepEqual((await read.list('suite', { limit: 3 })).map((held) => held.key), ordered.slice(0, 3));
    for (const prefix of ['a', 'aa', 'aaa', 'aaaa', 'aaaa.', 'aa.', 'b', 'zz-z.long', 'nothing']) {
      assert.deepEqual((await read.list('suite', { prefix, limit: 100 })).map((held) => held.key), ordered.filter((key) => key.startsWith(prefix)), `prefix ${prefix}`);
    }
    for (const after of ordered) {
      assert.deepEqual((await read.list('suite', { after, limit: 100 })).map((held) => held.key), ordered.filter((key) => key > after), `after ${after}`);
      assert.deepEqual((await read.list('suite', { prefix: 'aa', after, limit: 2 })).map((held) => held.key), ordered.filter((key) => key.startsWith('aa') && key > after).slice(0, 2), `prefix aa after ${after}`);
    }
    // Paging with the last key seen reads every record exactly once.
    const paged: string[] = [];
    for (let after: string | undefined; ;) {
      const page = await read.list('suite', { ...(after == null ? {} : { after }), limit: 4 });
      paged.push(...page.map((held) => held.key));
      if (page.length < 4) break;
      after = page[page.length - 1]!.key;
    }
    assert.deepEqual(paged, ordered);
    assert.deepEqual(await read.list('empty', { limit: 5 }), []);
  }));

  add('commit: a failed expectation is answered, and nothing of the batch is written', () => withStore(async (harness, storage) => {
    await storage.commit([{ op: 'put', kind: 'suite', key: 'held', value: record(1) }]);
    const refused = await storage.commit([
      { op: 'put', kind: 'suite', key: 'new-one', value: record(2), expect: 'absent' },
      { op: 'put', kind: 'suite', key: 'held', value: record(3), expect: 'absent' },
      { op: 'put', kind: 'suite', key: 'new-two', value: record(4) },
    ]);
    assert.deepEqual(refused, { committed: false, failed: { kind: 'suite', key: 'held', expected: 'absent', found: 1 } });
    assert.deepEqual((await storage.list('suite', { limit: 10 })).map((held) => [held.key, held.revision, held.value.n]), [['held', 1, 1]]);
    assert.deepEqual(await storage.commit([{ op: 'put', kind: 'suite', key: 'held', value: record(5), expect: 2 }]), { committed: false, failed: { kind: 'suite', key: 'held', expected: 2, found: 1 } });
    assert.deepEqual(await storage.commit([{ op: 'put', kind: 'suite', key: 'absent', value: record(5), expect: 1 }]), { committed: false, failed: { kind: 'suite', key: 'absent', expected: 1, found: 'absent' } });
    assert.deepEqual(await storage.commit([{ op: 'delete', kind: 'suite', key: 'held', expect: 7 }, { op: 'put', kind: 'suite', key: 'new-one', value: record(2) }]), { committed: false, failed: { kind: 'suite', key: 'held', expected: 7, found: 1 } });
    assert.deepEqual(await storage.commit([{ op: 'put', kind: 'suite', key: 'held', value: record(6), expect: 1 }, { op: 'put', kind: 'suite', key: 'new-one', value: record(2), expect: 'absent' }]), { committed: true });
    assert.deepEqual(await storage.commit([{ op: 'delete', kind: 'suite', key: 'new-one', expect: 1 }]), { committed: true });
    const again = await reopen(harness, storage);
    assert.deepEqual((await again.list('suite', { limit: 10 })).map((held) => [held.key, held.revision, held.value.n]), [['held', 2, 6]]);
  }));

  add('commit: a large batch is applied whole and survives a reopen without a close', () => withStore(async (harness, storage) => {
    const writes = Array.from({ length: 300 }, (_, n) => ({ op: 'put' as const, kind: 'suite', key: `batch.${String(n).padStart(4, '0')}`, value: record(n) }));
    assert.deepEqual(await storage.commit(writes), { committed: true });
    assert.deepEqual(await storage.commit([]), { committed: true });
    const again = await reopen(harness, storage);
    const read = [...(await again.list('suite', { limit: 200 })), ...(await again.list('suite', { after: 'batch.0199', limit: 200 }))];
    assert.deepEqual(read.map((held) => held.value.n), writes.map((write) => write.value.n));
    // Every write of one batch, or none: a failed expectation at the end leaves the first 299 unwritten too.
    const refused = await again.commit([...writes.map((write) => ({ ...write, value: record(-1) })), { op: 'put' as const, kind: 'suite', key: 'batch.0000.guard', value: record(0), expect: 3 }]);
    assert.equal(refused.committed, false);
    assert.equal((await again.list('suite', { limit: 400 })).filter((held) => held.value.n === -1).length, 0);
  }));

  add('calls: a malformed kind, key, value or batch is refused before anything is written', () => withStore(async (_harness, storage) => {
    const invalid = (code: string) => (error: unknown): boolean => error instanceof EpcisStorageError && error.code === code;
    for (const key of ['abc', '../escape', 'Upper-case', 'with space', '.hidden', 'a/b/c/d', 'x'.repeat(201)]) {
      await assert.rejects(storage.commit([{ op: 'put', kind: 'suite', key, value: {} }]), invalid('invalid-key'), key);
      await assert.rejects(storage.get('suite', key), invalid('invalid-key'), key);
    }
    for (const kind of ['', 'Upper', '../up', 'with space', 'x'.repeat(33)]) await assert.rejects(storage.commit([{ op: 'put', kind, key: 'good-key', value: {} }]), invalid('invalid-kind'), kind);
    await assert.rejects(storage.commit([{ op: 'put', kind: 'suite', key: 'good-key', value: [] as unknown as JsonObject }]), invalid('invalid-value'));
    await assert.rejects(storage.commit([{ op: 'put', kind: 'suite', key: 'good-key', value: {} }, { op: 'delete', kind: 'suite', key: 'good-key' }]), invalid('duplicate-write'));
    await assert.rejects(storage.list('suite', { limit: 0 }), invalid('invalid-limit'));
    assert.deepEqual(await storage.list('suite', { limit: 10 }), []);
  }));

  /* ---- the exchange over the adapter ---- */

  add('exchange: an acknowledged import is whole after a reopen without a close', () => withStore(async (harness, storage) => {
    const first = await acknowledge(storage, 'first', FIRST);
    const again = await reopen(harness, storage);
    assert.deepEqual(await findEpcisImportByRequest(again, 'suite-source', 'first'), first);
    const exported = await exportEpcisSource(again, first.importId);
    assert.deepEqual([...exported!.bytes], [...FIRST]);
    assert.equal(exported!.sha256, sha256Hex(FIRST));
    assert.deepEqual(await recoverEpcisExchange(again, { now: () => AT }), { actions: [], remaining: 0 });
    assert.deepEqual(await checkEpcisExchangeInvariants(again, { associations: true }), []);
  }));

  interface Scenario {
    name: string;
    /** Imports acknowledged before the one that is interrupted. */
    seed: Array<[string, Uint8Array]>;
    requestId: string;
    bytes: Uint8Array;
    /** True when a seeded import retains the same bytes, so they must survive whatever happens to this one. */
    sharedBytes: boolean;
    expect: (record: EpcisImportRecord) => void;
  }
  const scenarios: Scenario[] = [
    { name: 'a first import', seed: [], requestId: 'first', bytes: FIRST, sharedBytes: false, expect: (r) => { assert.deepEqual(r.events.map((e) => e.arrival), ['new', 'new', 'new']); assert.equal(r.state, 'evaluated'); } },
    { name: 'an import that repeats, changes and adds to what is held', seed: [['first', FIRST]], requestId: 'second', bytes: SECOND, sharedBytes: false, expect: (r) => { assert.deepEqual(r.events.map((e) => e.arrival), ['duplicate', 'conflict', 'new-observation', 'new']); assert.equal(r.state, 'blocked'); } },
    { name: 'the same bytes under another request', seed: [['first', FIRST]], requestId: 'again', bytes: FIRST, sharedBytes: true, expect: (r) => { assert.deepEqual(r.events.map((e) => e.arrival), ['duplicate', 'duplicate', 'duplicate']); } },
  ];

  for (const scenario of scenarios) {
    add(`crash: ${scenario.name}, stopped before and after every durable step, then retried or recovered`, async () => {
      // The uninterrupted run is the measure: its record, its whole store, and how many durable calls it made.
      let control: EpcisImportRecord | undefined;
      let controlStore: Awaited<ReturnType<typeof dump>> = [];
      let steps: string[] = [];
      let seedStore: Awaited<ReturnType<typeof dump>> = [];
      await withStore(async (_harness, storage) => {
        for (const [requestId, bytes] of scenario.seed) await acknowledge(storage, requestId, bytes);
        seedStore = await dump(storage);
        const counting = faultInjectingEpcisStorage(storage);
        control = retained(await importEpcisSource(request(counting.storage, scenario.requestId, scenario.bytes)));
        scenario.expect(control);
        steps = counting.calls();
        controlStore = await dump(storage);
        assert.deepEqual(await checkEpcisExchangeInvariants(storage, { associations: true }), []);
      });
      assert.ok(steps.length >= 5 && steps.includes('putBytes'), `an import makes its durable calls through the storage it was handed: ${steps.join(', ')}`);
      const digest = sha256Hex(scenario.bytes);

      for (let at = 1; at <= steps.length; at += 1) {
        for (const when of ['before', 'after'] as const) {
          for (const path of ['retry', 'recover'] as const) {
            const where = `${when} durable call ${at} of ${steps.length} (${steps[at - 1]}), then ${path}`;
            await withStore(async (harness, storage) => {
              const seeded: EpcisImportRecord[] = [];
              for (const [requestId, bytes] of scenario.seed) seeded.push(await acknowledge(storage, requestId, bytes));
              const faulty = faultInjectingEpcisStorage(storage, { at, when });
              await assert.rejects(importEpcisSource(request(faulty.storage, scenario.requestId, scenario.bytes)), (error: unknown) => error instanceof EpcisStorageFault, where);
              const reopened = await reopen(harness, storage);

              // Nothing that was acknowledged before the crash was lost.
              for (const earlier of seeded) {
                assert.deepEqual(await findEpcisImportByRequest(reopened, 'suite-source', earlier.requestId), earlier, where);
                assert.equal((await exportEpcisSource(reopened, earlier.importId))!.sha256, earlier.sha256, where);
              }
              if (path === 'recover') {
                const report = await recoverEpcisExchange(reopened, { now: () => AT });
                assert.equal(report.remaining, 0, where);
                assert.deepEqual(await checkEpcisExchangeInvariants(reopened, { associations: true }), [], where);
                const held = await findEpcisImportByRequest(reopened, 'suite-source', scenario.requestId);
                if (held == null) {
                  // The request never reached its receipt: nothing of it is left, and bytes another import holds are untouched.
                  assert.equal((await reopened.getBytes(digest)) != null, scenario.sharedBytes, where);
                  assert.deepEqual(await dump(reopened), seedStore, where);
                } else {
                  // It reached its receipt: recovery finished it, to the same result.
                  assert.deepEqual(held, control, where);
                  assert.deepEqual([...(await exportEpcisSource(reopened, held.importId))!.bytes], [...scenario.bytes], where);
                }
              }
              const retried = await importEpcisSource(request(reopened, scenario.requestId, scenario.bytes));
              assert.deepEqual(retained(retried), control, where);
              // The same store as the uninterrupted run: one receipt, the same observations, the same index, nothing pending.
              assert.deepEqual(await dump(reopened), controlStore, where);
              assert.deepEqual(await checkEpcisExchangeInvariants(reopened, { associations: true }), [], where);
              assert.deepEqual(await recoverEpcisExchange(reopened, { now: () => AT }), { actions: [], remaining: 0 }, where);
              assert.deepEqual([...(await exportEpcisSource(reopened, control!.importId))!.bytes], [...scenario.bytes], where);
            });
          }
        }
      }
    });
  }

  add('crash: a conflict decision, stopped before and after every durable step, then repeated or recovered', async () => {
    const decide = (storage: EpcisExchangeStorage) => resolveEpcisConflict(storage, { conflictId: CONFLICT_ID, decision: 'The later body stands.', disposition: 'all-retained', decidedAt: AT, decidedBy: 'adapter suite', now: () => AT });
    const seed = async (storage: EpcisExchangeStorage): Promise<void> => { await acknowledge(storage, 'first', FIRST); await acknowledge(storage, 'second', SECOND); };
    let controlStore: Awaited<ReturnType<typeof dump>> = [];
    let steps: string[] = [];
    await withStore(async (_harness, storage) => {
      await seed(storage);
      const before = await dump(storage);
      const counting = faultInjectingEpcisStorage(storage);
      const outcome = await decide(counting.storage);
      assert.equal(outcome.outcome, 'recorded');
      steps = counting.calls();
      controlStore = await dump(storage);
      assert.equal((await findEpcisImportByRequest(storage, 'suite-source', 'second'))!.state, 'evaluated');
      // The decision changed no observation and no source.
      const observations = (list: typeof before) => list.filter((held) => held.kind === EPCIS_RECORD_KINDS.observation);
      assert.deepEqual(observations(controlStore), observations(before));
      assert.equal((await getEpcisConflict(storage, CONFLICT_ID))!.observations.length, 2);
    });
    assert.ok(steps.length >= 3);
    for (let at = 1; at <= steps.length; at += 1) {
      for (const when of ['before', 'after'] as const) {
        for (const path of ['repeat', 'recover'] as const) {
          const where = `${when} durable call ${at} of ${steps.length}, then ${path}`;
          await withStore(async (harness, storage) => {
            await seed(storage);
            await assert.rejects(decide(faultInjectingEpcisStorage(storage, { at, when }).storage), (error: unknown) => error instanceof EpcisStorageFault, where);
            const reopened = await reopen(harness, storage);
            if (path === 'recover') {
              assert.equal((await recoverEpcisExchange(reopened, { now: () => AT })).remaining, 0, where);
              assert.deepEqual(await checkEpcisExchangeInvariants(reopened), [], where);
              // Either the decision was never recorded, or it is recorded and fully applied. Never one without the other.
              const conflict = (await getEpcisConflict(reopened, CONFLICT_ID))!;
              const second = (await findEpcisImportByRequest(reopened, 'suite-source', 'second'))!;
              assert.equal(second.state, conflict.resolutions.length === 0 ? 'blocked' : 'evaluated', where);
            }
            const outcome = await decide(reopened);
            assert.equal(outcome.outcome, 'recorded', where);
            assert.deepEqual(await dump(reopened), controlStore, where);
            assert.equal((await getEpcisConflict(reopened, CONFLICT_ID))!.resolutions.length, 1, where);
            assert.deepEqual(await recoverEpcisExchange(reopened, { now: () => AT }), { actions: [], remaining: 0 }, where);
          });
        }
      }
    }
  });

  add('crash: an index rebuild, stopped before and after every durable step, then recovered', async () => {
    const seed = async (storage: EpcisExchangeStorage): Promise<void> => { await acknowledge(storage, 'first', FIRST); await acknowledge(storage, 'second', SECOND); };
    let controlStore: Awaited<ReturnType<typeof dump>> = [];
    let steps: string[] = [];
    await withStore(async (_harness, storage) => {
      await seed(storage);
      controlStore = await dump(storage);
      const counting = faultInjectingEpcisStorage(storage);
      await rebuildEpcisAssociations(counting.storage, { now: () => AT });
      steps = counting.calls();
      // A rebuild from the sources and records gives the index that was built as they arrived.
      assert.deepEqual(await dump(storage), controlStore);
    });
    assert.ok(controlStore.some((held) => held.kind === EPCIS_RECORD_KINDS.association));
    for (let at = 1; at <= steps.length; at += 1) {
      for (const when of ['before', 'after'] as const) {
        const where = `${when} durable call ${at} of ${steps.length}`;
        await withStore(async (harness, storage) => {
          await seed(storage);
          await assert.rejects(rebuildEpcisAssociations(faultInjectingEpcisStorage(storage, { at, when }).storage, { now: () => AT }), (error: unknown) => error instanceof EpcisStorageFault, where);
          const reopened = await reopen(harness, storage);
          assert.equal((await recoverEpcisExchange(reopened, { now: () => AT })).remaining, 0, where);
          assert.deepEqual(await dump(reopened), controlStore, where);
          assert.deepEqual(await checkEpcisExchangeInvariants(reopened, { associations: true }), [], where);
        });
      }
    }
  });

  return cases;
}

export interface EpcisStorageAdapterSuiteReport {
  ok: boolean;
  results: Array<{ name: string; ok: boolean; error?: string }>;
}

/** Run the whole suite without a test framework and report each case. For a script or a start-up check; a test runner registers the cases instead. */
export async function runEpcisStorageAdapterSuite(newHarness: () => Promise<EpcisStorageAdapterHarness> | EpcisStorageAdapterHarness, options: EpcisStorageAdapterSuiteOptions = {}): Promise<EpcisStorageAdapterSuiteReport> {
  const results: EpcisStorageAdapterSuiteReport['results'] = [];
  for (const test of epcisStorageAdapterSuite(newHarness, options)) {
    try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { ok: results.every((result) => result.ok), results };
}
