/**
 * The durable file-system adapter for an EPCIS exchange.
 *
 * One folder, one process. Every file reaches its final name by a rename
 * from a temporary file, so a reader never sees half of one. A batch is made
 * atomic by a journal: the whole batch is written to one journal file first,
 * and that rename is the moment the batch is committed. The writes are then
 * applied one by one and the journal file is removed. A store that stopped
 * anywhere in between finds the journal file when it is reopened and applies
 * it again, which is safe because every write in it is a whole value.
 *
 *   <dir>/format.json                         what this folder is
 *   <dir>/lock                                the process that has it open
 *   <dir>/bytes/<aa>/<sha256>                 exact source bytes
 *   <dir>/records/<kind>/<hex of key[0..2]>/<hex of key[2..4]>/<key>.json
 *   <dir>/journal/<sequence>.json             a committed batch not yet applied
 *   <dir>/tmp/                                files on their way to a name
 *
 * It is a reference adapter: correct, small and slow next to a database. It
 * passes the shared adapter suite, which is the only claim it makes.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { JsonObject } from '../types.js';
import {
  EPCIS_STORAGE_KEY,
  EPCIS_STORAGE_KIND,
  EpcisStorageError,
  assertStorageBytes,
  assertStorageDigest,
  assertStorageList,
  assertStorageName,
  checkedWrites,
  sha256Hex,
  type EpcisCommitResult,
  type EpcisExchangeStorage,
  type EpcisStorageWrite,
  type EpcisStoredRecord,
  type EpcisWriteExpectation,
} from './storage.js';

export const FILE_EPCIS_STORAGE_FORMAT = { format: 'dpp-epcis-exchange-files', version: '1' } as const;

/** The file-system steps a write goes through, in the order they happen. A test stops the adapter before any one of them. */
export type FileEpcisStorageStep =
  | 'bytes-write'
  | 'bytes-name'
  | 'bytes-delete'
  | 'journal-write'
  | 'journal-commit'
  | 'record-write'
  | 'record-name'
  | 'record-delete'
  | 'journal-clear';

export interface FileEpcisStorageOptions {
  /**
   * Flush every file and folder to the device before a write is answered.
   * On by default. Off only for a test that simulates crashes itself: without
   * it a power loss can undo a write the caller was told had happened.
   */
  fsync?: boolean;
  /**
   * Called before each file-system step. A test throws from it to stop the
   * adapter exactly where a crash would. Once it throws, this adapter answers
   * nothing more and the folder is left as it was at that step.
   */
  interrupt?: (step: FileEpcisStorageStep) => void;
}

export interface FileEpcisStorage extends EpcisExchangeStorage {
  readonly dir: string;
  /** What opening the folder had to repair. */
  readonly reopened: { journalsApplied: number; temporariesRemoved: number; staleLockReplaced: boolean };
  /** Release the folder. A store that is not closed leaves its lock, which the next open in a live process refuses and the next open after the process has gone replaces. */
  close(): Promise<void>;
  /** Stop answering and leave the folder exactly as it is, lock included, the way a process that died would. For tests of recovery. */
  abandon(): void;
}

interface JournalFile {
  journalVersion: '1';
  /** SHA-256 of the canonical text of `writes`, so a damaged journal file is recognised and never half applied. */
  sha256: string;
  writes: Array<{ op: 'put'; kind: string; key: string; revision: number; value: JsonObject } | { op: 'delete'; kind: string; key: string }>;
}

/** Folders open in this process. A lock left by this process for a folder that is not here was left by a store that stopped without closing. */
const openFolders = new Set<string>();

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function openFileEpcisStorage(dir: string, options: FileEpcisStorageOptions = {}): Promise<FileEpcisStorage> {
  const root = resolve(dir);
  const fsync = options.fsync ?? true;
  const paths = { format: join(root, 'format.json'), lock: join(root, 'lock'), bytes: join(root, 'bytes'), records: join(root, 'records'), journal: join(root, 'journal'), tmp: join(root, 'tmp') };

  const syncFolder = async (folder: string): Promise<void> => {
    if (!fsync) return;
    // Flushing a folder is what makes a rename survive a power loss. A platform that cannot open a folder for it has no such step to take.
    let handle;
    try { handle = await open(folder, 'r'); } catch { return; }
    try { await handle.sync(); } catch { /* not supported here */ } finally { await handle.close(); }
  };
  const writeWhole = async (path: string, content: Uint8Array | string): Promise<void> => {
    const handle = await open(path, 'wx');
    try { await handle.writeFile(content); if (fsync) await handle.sync(); } finally { await handle.close(); }
  };
  const temporary = (): string => join(paths.tmp, `${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  /** Make a folder and every missing folder above it. A new folder survives a power loss only once the folder that lists it is flushed, so each one made is. */
  const ensureFolder = async (folder: string): Promise<void> => {
    const first = await mkdir(folder, { recursive: true });
    if (first == null || !fsync) return;
    for (let made = folder; ; made = dirname(made)) {
      await syncFolder(dirname(made));
      if (resolve(made) === resolve(first)) break;
    }
  };

  /* ---- the lock: one process per folder ---- */
  await mkdir(root, { recursive: true });
  let staleLockReplaced = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(paths.lock, JSON.stringify({ pid: process.pid, openedAt: new Date().toISOString() }), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw new EpcisStorageError('locked', `${root} could not be locked: ${(error as Error).message}`);
      let holder: { pid?: unknown } = {};
      try { holder = JSON.parse(await readFile(paths.lock, 'utf8')) as { pid?: unknown }; } catch { /* an unreadable lock was left mid-write by a process that is gone */ }
      const pid = typeof holder.pid === 'number' ? holder.pid : undefined;
      const live = pid === process.pid ? openFolders.has(root) : pid != null && processIsAlive(pid);
      if (live) throw new EpcisStorageError('locked', `${root} is open in process ${pid}; one process uses a folder at a time`);
      await rm(paths.lock, { force: true });
      staleLockReplaced = true;
    }
  }
  openFolders.add(root);

  let closed = false;
  let stopped: unknown;
  const release = async (): Promise<void> => { openFolders.delete(root); await rm(paths.lock, { force: true }); };

  try {
    /* ---- the folder ---- */
    let format: unknown;
    try { format = JSON.parse(await readFile(paths.format, 'utf8')); } catch (error) { if (!isMissing(error)) throw new EpcisStorageError('corrupt', `${paths.format} cannot be read`); }
    if (format === undefined) {
      const entries = (await readdir(root)).filter((name) => name !== 'lock');
      if (entries.length > 0) throw new EpcisStorageError('corrupt', `${root} is not empty and is not an EPCIS exchange folder`);
      await mkdir(paths.tmp, { recursive: true });
      const pending = temporary();
      await writeWhole(pending, JSON.stringify(FILE_EPCIS_STORAGE_FORMAT));
      await rename(pending, paths.format);
      await syncFolder(root);
    } else if ((format as { format?: unknown }).format !== FILE_EPCIS_STORAGE_FORMAT.format || (format as { version?: unknown }).version !== FILE_EPCIS_STORAGE_FORMAT.version) {
      throw new EpcisStorageError('corrupt', `${root} holds format ${JSON.stringify(format)}, which this adapter does not read`);
    }
    for (const folder of [paths.bytes, paths.records, paths.journal, paths.tmp]) await ensureFolder(folder);
  } catch (error) {
    await release();
    throw error;
  }

  const step = (name: FileEpcisStorageStep): void => {
    if (options.interrupt == null) return;
    try { options.interrupt(name); } catch (error) {
      // A stopped store keeps its lock file, as a dead process would, and leaves the list of open folders so the next open can tell.
      stopped = error;
      openFolders.delete(root);
      throw error;
    }
  };
  const usable = (): void => {
    if (stopped != null) throw stopped;
    if (closed) throw new EpcisStorageError('closed', `${root} was closed`);
  };

  const bytesPath = (sha256: string): string => join(paths.bytes, sha256.slice(0, 2), sha256);
  // The two folder levels are the first four characters of the key, written as hex so that no key can name `..` or a folder a file system treats specially. Hex keeps their order.
  const level = (text: string): string => Buffer.from(text, 'utf8').toString('hex');
  const recordFolder = (kind: string, key: string): string => join(paths.records, kind, level(key.slice(0, 2)), level(key.slice(2, 4)));
  const recordPath = (kind: string, key: string): string => join(recordFolder(kind, key), `${key}.json`);

  const readRecord = async (kind: string, key: string): Promise<EpcisStoredRecord | undefined> => {
    let text: string;
    try { text = await readFile(recordPath(kind, key), 'utf8'); } catch (error) { if (isMissing(error)) return undefined; throw error; }
    let held: { key?: unknown; revision?: unknown; value?: unknown };
    try { held = JSON.parse(text) as typeof held; } catch { throw new EpcisStorageError('corrupt', `${recordPath(kind, key)} is not JSON`); }
    if (held.key !== key || typeof held.revision !== 'number' || held.value == null || typeof held.value !== 'object') throw new EpcisStorageError('corrupt', `${recordPath(kind, key)} does not hold the record it is named for`);
    return { kind, key, revision: held.revision, value: held.value as JsonObject };
  };

  /** Apply one journalled write. Whole values and tolerant deletes make a second application harmless. */
  const apply = async (write: JournalFile['writes'][number]): Promise<void> => {
    const path = recordPath(write.kind, write.key);
    if (write.op === 'delete') {
      step('record-delete');
      try { await unlink(path); } catch (error) { if (!isMissing(error)) throw error; }
      await syncFolder(dirname(path));
      return;
    }
    step('record-write');
    const pending = temporary();
    await writeWhole(pending, JSON.stringify({ key: write.key, revision: write.revision, value: write.value }));
    await ensureFolder(dirname(path));
    step('record-name');
    await rename(pending, path);
    await syncFolder(dirname(path));
  };

  const journalDigest = (writes: JournalFile['writes']): string => sha256Hex(JSON.stringify(writes));

  /* ---- reopening: finish what a stopped store had committed ---- */
  let temporariesRemoved = 0;
  let journalsApplied = 0;
  try {
    for (const name of await readdir(paths.tmp)) { await rm(join(paths.tmp, name), { force: true }); temporariesRemoved += 1; }
    for (const name of (await readdir(paths.journal)).sort()) {
      const path = join(paths.journal, name);
      let journal: JournalFile;
      try { journal = JSON.parse(await readFile(path, 'utf8')) as JournalFile; } catch { throw new EpcisStorageError('corrupt', `${path} is not a readable journal file`); }
      if (journal.journalVersion !== '1' || !Array.isArray(journal.writes) || journal.sha256 !== journalDigest(journal.writes)) throw new EpcisStorageError('corrupt', `${path} does not match its own digest`);
      for (const write of journal.writes) {
        if (!EPCIS_STORAGE_KIND.test(write.kind) || !EPCIS_STORAGE_KEY.test(write.key)) throw new EpcisStorageError('corrupt', `${path} names a record this adapter could not have written`);
        await apply(write);
      }
      await unlink(path);
      await syncFolder(paths.journal);
      journalsApplied += 1;
    }
  } catch (error) {
    if (stopped == null) await release();
    throw error;
  }

  /* ---- one write at a time ---- */
  let tail: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  };
  let sequence = Date.now() * 1000;

  const listFolder = async (folder: string): Promise<string[]> => {
    try { return (await readdir(folder)).sort(); } catch (error) { if (isMissing(error)) return []; throw error; }
  };

  return {
    dir: root,
    reopened: { journalsApplied, temporariesRemoved, staleLockReplaced },

    putBytes: (sha256, bytes) => inTurn(async () => {
      usable();
      assertStorageBytes(sha256, bytes);
      const path = bytesPath(sha256);
      try { await (await open(path, 'r')).close(); return; } catch (error) { if (!isMissing(error)) throw error; }
      step('bytes-write');
      const pending = temporary();
      await writeWhole(pending, bytes);
      await ensureFolder(dirname(path));
      step('bytes-name');
      await rename(pending, path);
      await syncFolder(dirname(path));
    }),

    getBytes: async (sha256) => {
      usable();
      assertStorageDigest(sha256);
      try { return new Uint8Array(await readFile(bytesPath(sha256))); } catch (error) { if (isMissing(error)) return undefined; throw error; }
    },

    deleteBytes: (sha256) => inTurn(async () => {
      usable();
      assertStorageDigest(sha256);
      step('bytes-delete');
      try { await unlink(bytesPath(sha256)); } catch (error) { if (!isMissing(error)) throw error; }
      await syncFolder(dirname(bytesPath(sha256)));
    }),

    // A read waits for the write in progress, so it never sees a batch half applied.
    get: (kind, key) => inTurn(async () => {
      usable();
      assertStorageName(kind, key);
      return readRecord(kind, key);
    }),

    list: (kind, options) => inTurn(async () => {
      usable();
      assertStorageList(kind, options);
      const prefix = options.prefix ?? '';
      const after = options.after;
      const out: EpcisStoredRecord[] = [];
      const base = join(paths.records, kind);
      // Walking the two folder levels in order is walking the keys in order, so a page stops as soon as it is full.
      for (const first of await listFolder(base)) {
        if (!first.startsWith(level(prefix.slice(0, 2))) || (after != null && first < level(after.slice(0, 2)))) continue;
        for (const second of await listFolder(join(base, first))) {
          if (!second.startsWith(level(prefix.slice(2, 4))) || (after != null && first + second < level(after.slice(0, 4)))) continue;
          const keys = (await listFolder(join(base, first, second))).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
          for (const key of keys) {
            if (!key.startsWith(prefix) || (after != null && key <= after)) continue;
            const held = await readRecord(kind, key);
            if (held != null) out.push(held);
            if (out.length === options.limit) return out;
          }
        }
      }
      return out;
    }),

    commit: (writes) => inTurn(async (): Promise<EpcisCommitResult> => {
      usable();
      const batch: EpcisStorageWrite[] = checkedWrites(writes);
      const journal: JournalFile['writes'] = [];
      for (const write of batch) {
        const held = await readRecord(write.kind, write.key);
        const found: EpcisWriteExpectation = held?.revision ?? 'absent';
        if (write.expect !== undefined && write.expect !== found) return { committed: false, failed: { kind: write.kind, key: write.key, expected: write.expect, found } };
        journal.push(write.op === 'delete' ? { op: 'delete', kind: write.kind, key: write.key } : { op: 'put', kind: write.kind, key: write.key, revision: (held?.revision ?? 0) + 1, value: write.value });
      }
      if (journal.length === 0) return { committed: true };
      step('journal-write');
      const pending = temporary();
      const content: JournalFile = { journalVersion: '1', sha256: journalDigest(journal), writes: journal };
      await writeWhole(pending, JSON.stringify(content));
      sequence += 1;
      const path = join(paths.journal, `${String(sequence).padStart(20, '0')}.json`);
      // This rename is the commit. Before it the batch never happened; after it the batch will be applied, now or when the folder is next opened.
      step('journal-commit');
      await rename(pending, path);
      await syncFolder(paths.journal);
      for (const write of journal) await apply(write);
      step('journal-clear');
      await unlink(path);
      await syncFolder(paths.journal);
      return { committed: true };
    }),

    close: () => inTurn(async () => {
      if (closed || stopped != null) return;
      closed = true;
      await release();
    }),

    abandon: () => {
      if (closed || stopped != null) return;
      stopped = new EpcisStorageError('closed', `${root} was abandoned`);
      openFolders.delete(root);
    },
  };
}
