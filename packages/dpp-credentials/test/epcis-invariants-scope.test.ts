import { afterEach, describe, expect, it } from 'vitest';
import {
  EPCIS_RECORD_KINDS,
  checkEpcisExchangeInvariants,
  createMemoryEpcisStorage,
  exportEpcisSource,
  importEpcisSource,
  listEpcisPullPages,
  getEpcisPull,
  pullEpcisEvents,
  type EpcisFetch,
  type EpcisImportOutcome,
  type MemoryEpcisStorage,
} from '../src/epcis-exchange.js';
import { epcisEventScopeKey, epcisPullKey, observationKey, pullPageKey } from '../src/epcis-exchange/records.js';
import type { JsonObject } from '../src/types.js';
import { epcisDocument, fiveEventList } from './epcis-fixture.js';
import { pullEvents, startEpcisFixtureServer, type FixtureServer } from './epcis-pull-server.js';

// The invariants check holds every record to the source scope it belongs to.
// Two scopes can hold the same bytes and the same event identifiers, so a
// record matched by identity alone could be accounted for by the other
// scope's import. Each test below builds a store that is sound, shows the
// check finds nothing, then moves one record across scopes and shows the
// check names it.

const AT = '2026-03-10T00:00:00.000Z';
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const K = EPCIS_RECORD_KINDS;

const servers: FixtureServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

function retained(outcome: EpcisImportOutcome): Extract<EpcisImportOutcome, { outcome: 'retained' }> {
  if (outcome.outcome !== 'retained') throw new Error(`expected a retained import, got ${JSON.stringify(outcome)}`);
  return outcome;
}

const importUnder = (storage: MemoryEpcisStorage, sourceId: string, bytes: Uint8Array): Promise<EpcisImportOutcome> =>
  importEpcisSource({ storage, sourceId, requestId: 'request-1', bytes, mediaType: 'application/ld+json', receivedAt: AT, provenance: { kind: 'file', filename: 'events.jsonld' }, policy: { policyId: 'test-policy@1' }, now: () => AT });

/** Overwrite one record with a changed copy, as a faulty writer or a bad restore would leave it. */
async function rewrite(storage: MemoryEpcisStorage, kind: string, key: string, change: (value: JsonObject) => JsonObject): Promise<void> {
  const held = await storage.get(kind, key);
  if (held == null) throw new Error(`no ${kind} record under ${key}`);
  const result = await storage.commit([{ op: 'put', kind, key, value: change(structuredClone(held.value)) }]);
  if (!result.committed) throw new Error('the rewrite was not committed');
}

describe('the invariants check compares source scopes', () => {
  it('names an observation that says it belongs to another source scope than its import', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = utf8(JSON.stringify(epcisDocument(fiveEventList())));
    const first = retained(await importUnder(storage, 'source-a', bytes));
    // The same bytes under a second scope: the same event identifiers, held apart.
    retained(await importUnder(storage, 'source-b', bytes));
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);

    const event = first.record.events.find((candidate) => candidate.identityKind === 'event-id')!;
    const key = observationKey(epcisEventScopeKey('source-a', event.identityKind, event.identity), event.observation!.sequence);
    await rewrite(storage, K.observation, key, (value) => ({ ...value, sourceId: 'source-b' }));

    const breaches = await checkEpcisExchangeInvariants(storage, { associations: true });
    expect(breaches).toEqual([`observation ${key}: it names the source scope "source-b", and its import belongs to "source-a"`]);
  });

  it('names a pull page accounted for by another source scope\'s import of the same bytes', async () => {
    const server = await startEpcisFixtureServer(pullEvents(2));
    servers.push(server);
    const storage = createMemoryEpcisStorage();
    const realFetch: EpcisFetch = (url, init) => fetch(url, init);
    const outcome = await pullEpcisEvents({ storage, source: { sourceId: 'source-a', baseUrl: server.baseUrl, permittedOrigins: [server.origin], policy: { policyId: 'test-policy@1' }, localTest: true }, queryId: 'query-1', query: { perPage: 2 }, fetch: realFetch, now: () => AT });
    expect(outcome.outcome).not.toBe('refused');
    const pull = (await getEpcisPull(storage, 'source-a', 'query-1'))!;
    const [page] = await listEpcisPullPages(storage, pull.pullId, { limit: 10 });
    expect(page).toBeDefined();

    // Another scope imports exactly the bytes of that page, as a file.
    const original = (await exportEpcisSource(storage, page!.importId))!;
    const other = retained(await importUnder(storage, 'source-b', original.bytes));
    expect(other.record.sha256).toBe(page!.sha256);
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);

    const key = pullPageKey(epcisPullKey('source-a', 'query-1'), page!.sequence);
    await rewrite(storage, K.pullPage, key, (value) => ({ ...value, importId: other.record.importId }));
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([
      `pull ${pull.pullId} page ${page!.sequence}: the pull belongs to the source scope "source-a", the page names "source-a" and its import belongs to "source-b"`,
    ]);

    // And a page that itself names another scope than its pull.
    await rewrite(storage, K.pullPage, key, (value) => ({ ...value, importId: page!.importId, sourceId: 'source-b' }));
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([
      `pull ${pull.pullId} page ${page!.sequence}: the pull belongs to the source scope "source-a", the page names "source-b" and its import belongs to "source-a"`,
    ]);
  });
});
