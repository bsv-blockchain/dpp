/**
 * The single-writer turn of an EPCIS exchange, and the paged read every part
 * of the module makes with it.
 *
 * Not part of the package's entry point: an application never takes a turn
 * itself. The calls that change a store, an import, a conflict decision, an
 * index rebuild, recovery and a restore, each take one, and so does a
 * recovery export while it reads.
 */
import type { EpcisExchangeStorage, EpcisStoredRecord } from './storage.js';

/** One call at a time per store in this process, so two imports never interleave their reads and writes. Other processes are held off by the expectations each batch carries. */
const turns = new WeakMap<object, Promise<unknown>>();

export function inTurn<T>(storage: EpcisExchangeStorage, run: () => Promise<T>): Promise<T> {
  const next = (turns.get(storage) ?? Promise.resolve()).then(run, run);
  turns.set(storage, next.catch(() => undefined));
  return next;
}

const PAGE = 200;

/** Every record of a kind, or of a key prefix within it, in key order. */
export async function listAll(storage: EpcisExchangeStorage, kind: string, prefix?: string): Promise<EpcisStoredRecord[]> {
  const out: EpcisStoredRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await storage.list(kind, { ...(prefix == null ? {} : { prefix }), ...(after == null ? {} : { after }), limit: PAGE });
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1]!.key;
  }
}
