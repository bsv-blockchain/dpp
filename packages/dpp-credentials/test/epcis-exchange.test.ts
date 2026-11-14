import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EPCIS_DEFAULT_LIMITS,
  EPCIS_CONTEXT_IRI,
  localEventIdentity,
  parseEpcisSource,
} from '../src/epcis-source.js';
import {
  EPCIS_MAX_RECORDED_FINDINGS,
  EPCIS_RECORD_KINDS,
  checkEpcisExchangeInvariants,
  createMemoryEpcisStorage,
  deriveEpcisEventProjection,
  epcisConflictId,
  epcisEventAssociations,
  epcisImportId,
  epcisRequestDigest,
  exportEpcisSource,
  findEpcisAssociations,
  findEpcisImportByRequest,
  getEpcisConflict,
  getEpcisImport,
  importEpcisSource,
  listEpcisImports,
  rebuildEpcisAssociations,
  recoverEpcisExchange,
  resolveEpcisConflict,
  type EpcisImportOutcome,
  type EpcisImportRecord,
  type ImportEpcisSourceInput,
  type MemoryEpcisStorage,
} from '../src/epcis-exchange.js';
import type { JsonObject } from '../src/types.js';
import { CELL_A, ELECTROLYTE_LOT, MODULE, PACK, PACK_LINK, PALLET, SCRAP_CLASS, correctionEvents, epcisDocument, epcisQueryDocument, fiveEventList, refusedTransports, schemaInvalidDocument } from './epcis-fixture.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const compact = (value: unknown): Uint8Array => utf8(JSON.stringify(value));
const pretty = (value: unknown): Uint8Array => utf8(JSON.stringify(value, null, 2) + '\n');
const RECEIVED = '2026-03-10T00:00:00.000Z';

type Overrides = Partial<Omit<ImportEpcisSourceInput, 'storage' | 'bytes'>>;
const request = (storage: MemoryEpcisStorage, bytes: Uint8Array, over: Overrides = {}): ImportEpcisSourceInput => ({
  storage,
  sourceId: 'source-a',
  requestId: 'request-1',
  bytes,
  mediaType: 'application/ld+json',
  receivedAt: RECEIVED,
  provenance: { kind: 'file', filename: 'events.jsonld' },
  policy: { policyId: 'test-policy@1' },
  now: () => RECEIVED,
  ...over,
});

function retained(outcome: EpcisImportOutcome): Extract<EpcisImportOutcome, { outcome: 'retained' }> {
  if (outcome.outcome !== 'retained') throw new Error(`expected a retained import, got ${JSON.stringify(outcome)}`);
  return outcome;
}

/** Everything a memory store holds, as plain data, so two states can be compared. */
function snapshot(storage: MemoryEpcisStorage): { bytes: string[]; records: Record<string, Array<{ key: string; value: JsonObject }>> } {
  return {
    bytes: [...storage.state.bytes.keys()].sort(),
    records: Object.fromEntries([...storage.state.records].map(([kind, table]) => [kind, [...table].map(([key, held]) => ({ key, value: held.value })).sort((a, b) => (a.key < b.key ? -1 : 1))] as const).filter(([, rows]) => rows.length > 0)),
  };
}
const isEmpty = (storage: MemoryEpcisStorage): boolean => storage.state.bytes.size === 0 && [...storage.state.records.values()].every((table) => table.size === 0);
const count = (storage: MemoryEpcisStorage, kind: string): number => storage.state.records.get(kind)?.size ?? 0;

const commissioning = (): JsonObject => fiveEventList()[2] as JsonObject;

describe('fidelity: what arrives is what is kept', () => {
  it('imports the five event types, extension members, multi-product events and class or quantity references, and exports the same bytes', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = pretty(epcisDocument(fiveEventList()));
    const { record, replayed } = retained(await importEpcisSource(request(storage, bytes)));
    expect(replayed).toBe(false);
    expect(record.events.map((e) => e.eventType)).toEqual(['TransformationEvent', 'TransformationEvent', 'ObjectEvent', 'AssociationEvent', 'AggregationEvent', 'TransactionEvent', 'ObjectEvent']);
    expect(record.documentValidity).toBe('valid');
    expect(record.state).toBe('evaluated');
    expect(record.events.every((e) => e.arrival === 'new')).toBe(true);
    // The sensor observation carries a member the schema does not name; it is listed, and it is still in the bytes.
    expect(record.events[6]!.preservedExtensions).toEqual(['example:note']);
    // A multi-product event keeps every product, and a quantity element stays a class reference.
    expect(record.events[0]!.identifiers.map((i) => i.value)).toEqual([CELL_A, 'urn:epc:id:sgtin:9521234.022222.CELL-B', MODULE]);
    expect(record.events[1]!.identifiers.map((i) => i.scheme)).toEqual(['gs1-sgtin', 'gs1-sgtin', 'gs1-lgtin', 'gs1-sgtin-pattern']);

    const exported = await exportEpcisSource(storage, record.importId);
    expect(exported?.kind).toBe('original');
    expect(Buffer.from(exported!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(exported!.sha256).toBe(record.sha256);
    expect(exported!.sha256).toBe(parseOk(bytes).sha256);
    expect(exported!.mediaType).toBe('application/ld+json');
    expect(exported!.byteLength).toBe(bytes.byteLength);
  });

  it('lists a document member the schema does not name and leaves it in the bytes', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact({ ...epcisDocument(fiveEventList()), 'example:batch': { note: 'B-1', count: 2 } });
    const { record } = retained(await importEpcisSource(request(storage, bytes)));
    expect(record.preservedExtensions).toEqual(['example:batch']);
    expect(record.documentValidity).toBe('valid');
    expect(new TextDecoder().decode((await exportEpcisSource(storage, record.importId))!.bytes)).toContain('"example:batch":{"note":"B-1","count":2}');
  });

  it('keeps unusual formatting, key order and a query envelope byte for byte', async () => {
    const storage = createMemoryEpcisStorage();
    const odd = utf8(`\n\t {"epcisBody" :{"queryResults":{"resultsBody":{"eventList":[ ${JSON.stringify(commissioning())} ]},"queryName":"SimpleEventQuery"}},\r\n"creationDate":"2026-03-03T07:00:00.000Z","schemaVersion":"2.0","type":"EPCISQueryDocument","@context":["${EPCIS_CONTEXT_IRI}"]}  \n\n`);
    const { record } = retained(await importEpcisSource(request(storage, odd, { mediaType: 'application/json; charset=utf-8' })));
    expect(record.mediaType).toBe('application/json');
    expect(record.envelope).toMatchObject({ type: 'EPCISQueryDocument', queryName: 'SimpleEventQuery' });
    expect(record.events[0]!.pointer).toBe('/epcisBody/queryResults/resultsBody/eventList/0');
    const exported = await exportEpcisSource(storage, record.importId);
    expect(Buffer.from(exported!.bytes).equals(Buffer.from(odd))).toBe(true);
  });

  it('records what the contract asks for and binds the request identifier to its digest', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    const { record } = retained(await importEpcisSource(request(storage, bytes)));
    const sha256 = parseOk(bytes).sha256;
    expect(record).toMatchObject({
      importVersion: '2',
      importId: epcisImportId('source-a', 'request-1'),
      requestId: 'request-1',
      requestDigest: epcisRequestDigest({ sourceId: 'source-a', mediaType: 'application/ld+json', byteLength: bytes.byteLength, sha256 }),
      idempotency: { scope: 'source', rule: 'request-digest-equal' },
      sourceId: 'source-a',
      receivedAt: RECEIVED,
      mediaType: 'application/ld+json',
      byteLength: bytes.byteLength,
      sha256,
      bytesRef: `sha256:${sha256}`,
      sourceLocation: { kind: 'file', filename: 'events.jsonld' },
      profileRefs: ['epcis-json@1'],
      policyId: 'test-policy@1',
      limits: EPCIS_DEFAULT_LIMITS,
    });
    expect(record.contextRefs).toEqual([
      { kind: 'iri', value: EPCIS_CONTEXT_IRI, digest: expect.stringMatching(/^[0-9a-f]{64}$/), pinned: true, scope: 'document' },
      { kind: 'inline', value: expect.stringMatching(/^urn:bsv:dpp:epcis:inline-context:sha256:/), digest: expect.stringMatching(/^[0-9a-f]{64}$/), pinned: true, scope: 'document' },
    ]);
    expect(record.events.every((e) => e.mapping.outcome === 'not-attempted')).toBe(true);
    expect(await getEpcisImport(storage, record.importId)).toEqual(record);
    expect(await findEpcisImportByRequest(storage, 'source-a', 'request-1')).toEqual(record);
    expect(await findEpcisImportByRequest(storage, 'source-a', 'request-2')).toBeUndefined();
    expect(await listEpcisImports(storage)).toEqual([record]);
    expect(await listEpcisImports(storage, { after: record.importId })).toEqual([]);
  });

  it('keeps the three kinds of identifier apart', async () => {
    const storage = createMemoryEpcisStorage();
    const hashShaped = 'ni:///sha-256;36abb3a2c0a726de32ac4beafec8dd2a3f2ad24c6ae6bbf0f8a2f0b7d1ba3d9f?ver=CBV2.0';
    const bytes = compact(epcisDocument([{ ...commissioning(), eventID: hashShaped }, fiveEventList()[6] as JsonObject]));
    const { record } = retained(await importEpcisSource(request(storage, bytes)));
    const [declared, undeclared] = record.events;
    // An eventID in the hash form is the identifier its source declared, and is recorded as nothing more.
    expect(declared).toMatchObject({ identityKind: 'event-id', eventId: hashShaped, identity: hashShaped });
    expect(undeclared!.eventId).toBeUndefined();
    expect(undeclared).toMatchObject({ identityKind: 'local', identity: localEventIdentity(record.sha256, '/epcisBody/eventList/1') });
    expect(undeclared!.identity).toMatch(/^urn:bsv:dpp:epcis:local-event:sha256:/);
    // No member of the record or of an observation presents anything as an event hash.
    const everything = JSON.stringify(snapshot(storage));
    expect(everything).not.toMatch(/eventHash|hashId|"ni"/i);
    expect(record.importId).toMatch(/^urn:bsv:dpp:epcis:import:sha256:/);
    // The local identity was not written into the retained source.
    expect(new TextDecoder().decode((await exportEpcisSource(storage, record.importId))!.bytes)).not.toContain('local-event');
  });

  it('does not let a declared eventID that imitates a local identity become that event', async () => {
    const storage = createMemoryEpcisStorage();
    const first = compact(epcisDocument([fiveEventList()[6] as JsonObject]));
    const local = retained(await importEpcisSource(request(storage, first))).record.events[0]!;
    expect(local.identityKind).toBe('local');
    const imitation = compact(epcisDocument([{ ...commissioning(), eventID: local.identity }]));
    const { record } = retained(await importEpcisSource(request(storage, imitation, { requestId: 'request-2' })));
    expect(record.events[0]).toMatchObject({ identityKind: 'event-id', identity: local.identity, arrival: 'new' });
    expect(record.state).toBe('evaluated');
    expect(await getEpcisConflict(storage, epcisConflictId('source-a', 'local', local.identity))).toBeUndefined();
  });

  it.each(refusedTransports())('refuses $id and keeps nothing', async (refusal) => {
    const storage = createMemoryEpcisStorage();
    const mediaType = refusal.id === 'refuse-unsupported-media-type' ? 'application/xml' : 'application/json';
    const outcome = await importEpcisSource(request(storage, refusal.bytes, { mediaType, policy: { policyId: 'test-policy@1', ...(refusal.limits == null ? {} : { limits: refusal.limits }) } }));
    expect(outcome).toMatchObject({ outcome: 'refused', reason: refusal.reason });
    expect(isEmpty(storage)).toBe(true);
    expect(await findEpcisImportByRequest(storage, 'source-a', 'request-1')).toBeUndefined();
  });

  it('refuses a string that has no canonical form, wherever it is, and keeps nothing', async () => {
    const storage = createMemoryEpcisStorage();
    const withSurrogate = (member: string): Uint8Array => utf8(JSON.stringify(epcisDocument([{ ...commissioning(), [member]: 'PLACEHOLDER' }])).replace('"PLACEHOLDER"', '"\\ud800"'));
    // In the body, and in the two members the body digest leaves out.
    for (const member of ['example:note', 'recordTime', 'errorDeclaration']) {
      const bytes = withSurrogate(member);
      expect(parseEpcisSource(bytes, { mediaType: 'application/json' }).ok, member).toBe(true);
      expect(await importEpcisSource(request(storage, bytes)), member).toMatchObject({ outcome: 'refused', reason: 'no-canonical-form' });
    }
    expect(isEmpty(storage)).toBe(true);
  });

  it('retains a document the schema rejects, with its findings, and keeps it out of everything described as valid', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(schemaInvalidDocument());
    const { record } = retained(await importEpcisSource(request(storage, bytes, { mediaType: 'application/json' })));
    expect(record.documentValidity).toBe('invalid');
    expect(record.state).toBe('evaluated');
    expect(record.events[0]!.validation.schema).toBe('fail');
    expect([...record.findings, ...record.events[0]!.validation.findings].some((f) => f.code.startsWith('schema:'))).toBe(true);
    const exported = await exportEpcisSource(storage, record.importId);
    expect(Buffer.from(exported!.bytes).equals(Buffer.from(bytes))).toBe(true);
    // It was received, so its events are observed; it is not valid, so the associations index does not offer it.
    expect(count(storage, EPCIS_RECORD_KINDS.observation)).toBe(1);
    expect(count(storage, EPCIS_RECORD_KINDS.association)).toBe(0);
    expect((await findEpcisAssociations(storage, { identifier: PACK, granularity: 'instance' })).associations).toEqual([]);
  });

  it('retains a document with a failed identifier check as invalid, though the schema accepts it', async () => {
    const storage = createMemoryEpcisStorage();
    const badCheckDigit = 'https://id.example.org/01/09521234123450/21/SER1';
    const { record } = retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), epcList: [badCheckDigit] }])))));
    expect(record.events[0]!.validation.schema).toBe('pass');
    expect(record.events[0]!.identifiers[0]).toMatchObject({ checkDigitValid: false });
    expect(record.documentValidity).toBe('invalid');
    expect(count(storage, EPCIS_RECORD_KINDS.association)).toBe(0);
  });

  it('tells a refusal from a retained failure: one leaves nothing, the other leaves the source and its findings', async () => {
    const refusedStore = createMemoryEpcisStorage();
    const retainedStore = createMemoryEpcisStorage();
    const refused = await importEpcisSource(request(refusedStore, utf8('{"type":"EPCISDocument","type":"EPCISDocument"}')));
    const kept = await importEpcisSource(request(retainedStore, compact({ type: 'EPCISDocument', schemaVersion: '2.0' })));
    expect(refused.outcome).toBe('refused');
    expect(kept.outcome).toBe('retained');
    expect(isEmpty(refusedStore)).toBe(true);
    expect(retainedStore.state.bytes.size).toBe(1);
    expect(retained(kept).record).toMatchObject({ documentValidity: 'invalid', events: [] });
    expect(retained(kept).record.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['context-missing', 'body-missing']));
  });

  it('retains a safely parsed document that is not an envelope, as bytes and nothing interpreted', async () => {
    const storage = createMemoryEpcisStorage();
    const { record } = retained(await importEpcisSource(request(storage, compact(commissioning()))));
    expect(record.envelope).toBeUndefined();
    expect(record.events).toEqual([]);
    expect(record.documentValidity).toBe('invalid');
    expect(record.findings.map((f) => f.code)).toContain('envelope-unrecognised');
  });

  it('reports a context this profile has not pinned without failing the document for it', async () => {
    const storage = createMemoryEpcisStorage();
    const document = { ...epcisDocument([commissioning()]), '@context': [EPCIS_CONTEXT_IRI, 'https://example.org/contexts/other.jsonld'] };
    const { record } = retained(await importEpcisSource(request(storage, compact(document))));
    expect(record.contextRefs[1]).toEqual({ kind: 'iri', value: 'https://example.org/contexts/other.jsonld', pinned: false, scope: 'document' });
    expect(record.findings.find((f) => f.code === 'context-unpinned')).toMatchObject({ severity: 'warning', path: '/@context' });
    expect(record.documentValidity).toBe('valid');
  });
});

describe('idempotency: one request, one receipt', () => {
  it('returns the same import for a repeated request and writes nothing more', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = pretty(epcisDocument(fiveEventList()));
    const first = retained(await importEpcisSource(request(storage, bytes)));
    const before = snapshot(storage);
    const second = retained(await importEpcisSource(request(storage, bytes, { receivedAt: '2026-03-11T00:00:00.000Z', provenance: { kind: 'file', filename: 'retry.jsonld' } })));
    expect(second.replayed).toBe(true);
    expect(second.record).toEqual(first.record);
    expect(snapshot(storage)).toEqual(before);
    expect(count(storage, EPCIS_RECORD_KINDS.import)).toBe(1);
  });

  it('treats the same request identifier with different bytes as a conflict and keeps the first', async () => {
    const storage = createMemoryEpcisStorage();
    const first = retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    const before = snapshot(storage);
    const other = compact(epcisDocument(fiveEventList().slice(0, 3)));
    const outcome = await importEpcisSource(request(storage, other));
    expect(outcome).toMatchObject({ outcome: 'request-conflict', requestId: 'request-1', existingImportId: first.record.importId, existingRequestDigest: first.record.requestDigest });
    expect(snapshot(storage)).toEqual(before);
    expect(storage.state.bytes.has(parseOk(other).sha256)).toBe(false);
  });

  it('compares a repeat by the request digest: the base media type is part of it, its parameters are not', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    retained(await importEpcisSource(request(storage, bytes, { mediaType: 'application/json' })));
    expect(retained(await importEpcisSource(request(storage, bytes, { mediaType: 'application/json; charset=utf-8' }))).replayed).toBe(true);
    expect((await importEpcisSource(request(storage, bytes, { mediaType: 'application/ld+json' }))).outcome).toBe('request-conflict');
  });

  it('scopes a request identifier to its source, and holds bytes two imports share once', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    const a = retained(await importEpcisSource(request(storage, bytes)));
    const b = retained(await importEpcisSource(request(storage, bytes, { sourceId: 'source-b' })));
    const c = retained(await importEpcisSource(request(storage, bytes, { requestId: 'request-2' })));
    expect(new Set([a.record.importId, b.record.importId, c.record.importId]).size).toBe(3);
    expect([a.replayed, b.replayed, c.replayed]).toEqual([false, false, false]);
    expect(storage.state.bytes.size).toBe(1);
    expect(count(storage, EPCIS_RECORD_KINDS.import)).toBe(3);
    expect(count(storage, EPCIS_RECORD_KINDS.retention)).toBe(3);
    expect(await checkEpcisExchangeInvariants(storage)).toEqual([]);
  });

  it('gives the same answer to two identical requests made at once', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    const [one, two] = await Promise.all([importEpcisSource(request(storage, bytes)), importEpcisSource(request(storage, bytes))]);
    expect([retained(one).replayed, retained(two).replayed].sort()).toEqual([false, true]);
    expect(retained(one).record).toEqual(retained(two).record);
    expect(count(storage, EPCIS_RECORD_KINDS.import)).toBe(1);
  });
});

describe('corrections: arrivals are classified and nothing is overwritten', () => {
  const second = { requestId: 'request-2' };

  it('names a second arrival of the same events a duplicate and records no second observation', async () => {
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, pretty(epcisDocument(fiveEventList())))));
    const observations = count(storage, EPCIS_RECORD_KINDS.observation);
    const again = retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())), second))).record;
    // Reformatted bytes are a different source with the same events. The one event without an eventID takes its identity from the source, so it is new.
    expect(again.events.map((e) => e.arrival)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'new']);
    expect(again.events[0]!.observation).toEqual({ sequence: 1, importId: epcisImportId('source-a', 'request-1'), pointer: '/epcisBody/eventList/0' });
    expect(again.state).toBe('evaluated');
    expect(count(storage, EPCIS_RECORD_KINDS.observation)).toBe(observations + 1);
    expect(storage.state.bytes.size).toBe(2);
  });

  it('records a changed repository observation of the same event beside the first', async () => {
    const storage = createMemoryEpcisStorage();
    const firstBytes = compact(epcisDocument([commissioning()]));
    const first = retained(await importEpcisSource(request(storage, firstBytes))).record;
    const later = retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), recordTime: '2026-03-09T00:00:00.000Z' }])), second))).record;
    expect(later.events[0]).toMatchObject({ arrival: 'new-observation', recordTime: '2026-03-09T00:00:00.000Z', bodyDigest: first.events[0]!.bodyDigest, observation: { sequence: 2 } });
    expect(later.events[0]!.conflict).toBeUndefined();
    expect(later.state).toBe('evaluated');
    expect(await getEpcisImport(storage, first.importId)).toEqual(first);
    expect(Buffer.from((await exportEpcisSource(storage, first.importId))!.bytes).equals(Buffer.from(firstBytes))).toBe(true);
    expect(await getEpcisConflict(storage, epcisConflictId('source-a', 'event-id', first.events[0]!.identity))).toBeUndefined();
  });

  it('compares a record time that is not a string as the value it is', async () => {
    const storage = createMemoryEpcisStorage();
    const at = (recordTime: unknown, requestId: string) => importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), recordTime }])), { requestId }));
    // The schema rejects both documents, and they are retained. Two different values are two observations, never a repeat.
    expect(retained(await at(1, 'request-1')).record.events[0]).toMatchObject({ arrival: 'new' });
    expect(retained(await at(2, 'request-2')).record.events[0]).toMatchObject({ arrival: 'new-observation', observation: { sequence: 2 } });
    expect(retained(await at(1, 'request-3')).record.events[0]).toMatchObject({ arrival: 'duplicate', observation: { sequence: 1 } });
    expect(retained(await at('1', 'request-4')).record.events[0]).toMatchObject({ arrival: 'new-observation', recordTime: '1' });
    expect([...storage.state.records.get(EPCIS_RECORD_KINDS.observation)!.values()].map((held) => held.value.recordTime)).toEqual([1, 2, '1']);
  });

  it('retains an error declaration as a further observation and never replaces the event it repeats', async () => {
    const storage = createMemoryEpcisStorage();
    const { declared } = correctionEvents();
    const { errorDeclaration, ...original } = declared;
    const firstBytes = compact(epcisDocument([original]));
    const first = retained(await importEpcisSource(request(storage, firstBytes))).record;
    const declaredBytes = compact(epcisDocument([declared]));
    const later = retained(await importEpcisSource(request(storage, declaredBytes, second))).record;
    expect(later.events[0]).toMatchObject({
      arrival: 'new-observation',
      errorDeclaration: { declarationTime: '2026-03-04T10:00:00.000Z', reason: 'incorrect_data', correctiveEventIDs: ['urn:uuid:00000000-0000-4000-8000-00000000000b'], resolution: 'unresolved', missing: ['urn:uuid:00000000-0000-4000-8000-00000000000b'] },
    });
    // The observation holds the declaration exactly as present, and the earlier source is untouched.
    const observations = [...storage.state.records.get(EPCIS_RECORD_KINDS.observation)!.values()].map((held) => held.value);
    expect(observations.map((o) => o.errorDeclaration)).toEqual([undefined, errorDeclaration]);
    expect(await getEpcisImport(storage, first.importId)).toEqual(first);
    expect(new TextDecoder().decode((await exportEpcisSource(storage, first.importId))!.bytes)).not.toContain('errorDeclaration');
    expect(new TextDecoder().decode((await exportEpcisSource(storage, later.importId))!.bytes)).toContain('"correctiveEventIDs"');
  });

  it('resolves a correction only when the event it references is held under the same source', async () => {
    const { declared, corrective } = correctionEvents();
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, compact(epcisDocument([corrective])))));
    const held = retained(await importEpcisSource(request(storage, compact(epcisDocument([declared])), second))).record;
    expect(held.events[0]!.errorDeclaration).toMatchObject({ resolution: 'resolved' });
    expect(held.events[0]!.errorDeclaration!.missing).toBeUndefined();

    // The same corrective event held under another source does not resolve it: scopes are not merged.
    const elsewhere = retained(await importEpcisSource(request(storage, compact(epcisDocument([declared])), { sourceId: 'source-b' }))).record;
    expect(elsewhere.events[0]!.errorDeclaration).toMatchObject({ resolution: 'unresolved', missing: [String(corrective.eventID)] });

    // Both in one document resolve within it.
    const together = retained(await importEpcisSource(request(createMemoryEpcisStorage(), compact(epcisDocument([declared, corrective]))))).record;
    expect(together.events[0]!.errorDeclaration).toMatchObject({ resolution: 'resolved' });
  });

  it('keeps both bodies when one eventID arrives with a different body in one source scope', async () => {
    const storage = createMemoryEpcisStorage();
    const firstBytes = compact(epcisDocument([commissioning()]));
    const first = retained(await importEpcisSource(request(storage, firstBytes))).record;
    const changedBytes = compact(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }]));
    const changed = retained(await importEpcisSource(request(storage, changedBytes, second))).record;
    const conflictId = epcisConflictId('source-a', 'event-id', String(commissioning().eventID));
    expect(changed.state).toBe('blocked');
    expect(changed.events[0]).toMatchObject({
      arrival: 'conflict',
      observation: { sequence: 2, importId: changed.importId },
      conflict: { conflictId, withImportId: first.importId, withPointer: '/epcisBody/eventList/0', withBodyDigest: first.events[0]!.bodyDigest, state: 'open' },
    });
    expect(changed.events[0]!.bodyDigest).not.toBe(first.events[0]!.bodyDigest);
    // Nothing was overwritten: the first record and both sources are as they were.
    expect(await getEpcisImport(storage, first.importId)).toEqual(first);
    expect(Buffer.from((await exportEpcisSource(storage, first.importId))!.bytes).equals(Buffer.from(firstBytes))).toBe(true);
    expect(Buffer.from((await exportEpcisSource(storage, changed.importId))!.bytes).equals(Buffer.from(changedBytes))).toBe(true);
    const conflict = await getEpcisConflict(storage, conflictId);
    expect(conflict).toMatchObject({ conflictId, sourceId: 'source-a', identityKind: 'event-id', state: 'open', resolutions: [] });
    expect(conflict!.bodyDigests).toHaveLength(2);
    expect(conflict!.observations.map((o) => [o.sequence, o.importId, o.arrival])).toEqual([[1, first.importId, 'new'], [2, changed.importId, 'conflict']]);
  });

  it('never merges two source scopes because they share an eventID', async () => {
    const storage = createMemoryEpcisStorage();
    const a = retained(await importEpcisSource(request(storage, compact(epcisDocument([commissioning()]))))).record;
    const b = retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }])), { sourceId: 'source-b' }))).record;
    expect(a.events[0]!.arrival).toBe('new');
    expect(b.events[0]!.arrival).toBe('new');
    expect(b.state).toBe('evaluated');
    expect(b.events[0]!.conflict).toBeUndefined();
    expect(await getEpcisConflict(storage, epcisConflictId('source-a', 'event-id', String(commissioning().eventID)))).toBeUndefined();
    expect(await getEpcisConflict(storage, epcisConflictId('source-b', 'event-id', String(commissioning().eventID)))).toBeUndefined();
  });

  it('compares a repeated eventID inside one document the same way', async () => {
    const storage = createMemoryEpcisStorage();
    const { record } = retained(await importEpcisSource(request(storage, compact(epcisDocument([commissioning(), { ...commissioning(), disposition: 'in_transit' }, commissioning()])))));
    expect(record.events.map((e) => e.arrival)).toEqual(['new', 'conflict', 'duplicate']);
    expect(record.events[1]!.conflict).toMatchObject({ withImportId: record.importId, withPointer: '/epcisBody/eventList/0', state: 'open' });
    expect(record.events[2]!.observation).toEqual({ sequence: 1, importId: record.importId, pointer: '/epcisBody/eventList/0' });
    expect(record.state).toBe('blocked');
    expect(record.findings.map((f) => f.code)).toContain('event-id-repeated');
  });

  describe('a conflict decision', () => {
    async function conflicted(): Promise<{ storage: MemoryEpcisStorage; first: EpcisImportRecord; changed: EpcisImportRecord; conflictId: string }> {
      const storage = createMemoryEpcisStorage();
      const first = retained(await importEpcisSource(request(storage, compact(epcisDocument([commissioning()]))))).record;
      const changed = retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }])), second))).record;
      return { storage, first, changed, conflictId: epcisConflictId('source-a', 'event-id', String(commissioning().eventID)) };
    }
    const decision = { decision: 'The repository confirmed the second body; the first was a keying error.', disposition: 'body-selected' as const, decidedAt: '2026-03-12T09:00:00.000Z', decidedBy: 'operations reviewer' };

    it('records the decision with every competing observation and changes none of them', async () => {
      const { storage, first, changed, conflictId } = await conflicted();
      const observationsBefore = structuredClone([...storage.state.records.get(EPCIS_RECORD_KINDS.observation)!]);
      const bytesBefore = [...storage.state.bytes].map(([digest, bytes]) => [digest, Buffer.from(bytes).toString('hex')]);
      const outcome = await resolveEpcisConflict(storage, { conflictId, ...decision, selectedBodyDigest: changed.events[0]!.bodyDigest });
      if (outcome.outcome !== 'recorded') throw new Error(JSON.stringify(outcome));
      expect(outcome.replayed).toBe(false);
      expect(outcome.resolution).toMatchObject({
        recordType: 'epcis-conflict-resolution',
        recordVersion: '1',
        conflictId,
        sequence: 1,
        decision: decision.decision,
        disposition: 'body-selected',
        selectedBodyDigest: changed.events[0]!.bodyDigest,
        decidedAt: decision.decidedAt,
        decidedBy: 'operations reviewer',
        observations: [
          { sequence: 1, importId: first.importId, pointer: '/epcisBody/eventList/0', sourceSha256: first.sha256, bodyDigest: first.events[0]!.bodyDigest },
          { sequence: 2, importId: changed.importId, pointer: '/epcisBody/eventList/0', sourceSha256: changed.sha256, bodyDigest: changed.events[0]!.bodyDigest },
        ],
      });
      expect(outcome.resolution.bodyDigests).toEqual([first.events[0]!.bodyDigest, changed.events[0]!.bodyDigest].sort());
      // Both observations and both sources are exactly as they were.
      expect([...storage.state.records.get(EPCIS_RECORD_KINDS.observation)!]).toEqual(observationsBefore);
      expect([...storage.state.bytes].map(([digest, bytes]) => [digest, Buffer.from(bytes).toString('hex')])).toEqual(bytesBefore);
      expect(await getEpcisImport(storage, first.importId)).toEqual(first);
      // The import that was blocked is released, and says by which decision.
      const released = await getEpcisImport(storage, changed.importId);
      expect(released!.state).toBe('evaluated');
      expect(released!.events[0]!.conflict).toMatchObject({ state: 'resolved', resolutionId: outcome.resolution.resolutionId, resolution: decision.decision, resolvedAt: decision.decidedAt });
      const conflict = await getEpcisConflict(storage, conflictId);
      expect(conflict).toMatchObject({ state: 'resolved', currentResolutionId: outcome.resolution.resolutionId });
      expect(conflict!.observations).toHaveLength(2);
      expect(await checkEpcisExchangeInvariants(storage)).toEqual([]);
    });

    it('answers a repeated decision with the one already recorded', async () => {
      const { storage, changed, conflictId } = await conflicted();
      const input = { conflictId, ...decision, selectedBodyDigest: changed.events[0]!.bodyDigest };
      const first = await resolveEpcisConflict(storage, input);
      const again = await resolveEpcisConflict(storage, input);
      expect(again).toMatchObject({ outcome: 'recorded', replayed: true });
      expect(again.outcome === 'recorded' && first.outcome === 'recorded' && again.resolution).toEqual(first.outcome === 'recorded' && first.resolution);
      expect(count(storage, EPCIS_RECORD_KINDS.resolution)).toBe(1);
    });

    it('keeps the conflict settled for a body the decision covers and reopens it for one it does not', async () => {
      const { storage, changed, conflictId } = await conflicted();
      const settled = await resolveEpcisConflict(storage, { conflictId, ...decision, selectedBodyDigest: changed.events[0]!.bodyDigest });
      if (settled.outcome !== 'recorded') throw new Error('not recorded');
      const repeat = retained(await importEpcisSource(request(storage, pretty(epcisDocument([commissioning()])), { requestId: 'request-3' }))).record;
      expect(repeat.events[0]!.arrival).toBe('duplicate');
      expect(repeat.state).toBe('evaluated');
      expect((await getEpcisConflict(storage, conflictId))!.state).toBe('resolved');

      const third = retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), disposition: 'returned' }])), { requestId: 'request-4' }))).record;
      expect(third.events[0]).toMatchObject({ arrival: 'conflict', conflict: { state: 'open' } });
      expect(third.state).toBe('blocked');
      expect((await getEpcisConflict(storage, conflictId))!).toMatchObject({ state: 'open' });

      const next = await resolveEpcisConflict(storage, { conflictId, decision: 'All three are kept; none is relied on until the source answers.', disposition: 'none-relied-on', decidedAt: '2026-03-13T09:00:00.000Z' });
      if (next.outcome !== 'recorded') throw new Error('not recorded');
      expect(next.resolution).toMatchObject({ sequence: 2, supersedes: settled.resolution.resolutionId });
      expect(next.resolution.observations).toHaveLength(3);
      const conflict = await getEpcisConflict(storage, conflictId);
      expect(conflict!.state).toBe('resolved');
      // The earlier decision is kept beside the one that replaced it.
      expect(conflict!.resolutions.map((r) => r.resolutionId)).toEqual([settled.resolution.resolutionId, next.resolution.resolutionId]);
      expect((await getEpcisImport(storage, third.importId))!.state).toBe('evaluated');
      expect(await checkEpcisExchangeInvariants(storage)).toEqual([]);
    });

    it('refuses a decision where there is no conflict, or one that selects a body that is not competing', async () => {
      const { storage, conflictId } = await conflicted();
      expect(await resolveEpcisConflict(storage, { conflictId: epcisConflictId('source-a', 'event-id', 'urn:uuid:nothing'), ...decision, disposition: 'all-retained' })).toMatchObject({ outcome: 'refused', reason: 'no-conflict' });
      expect(await resolveEpcisConflict(storage, { conflictId, ...decision, selectedBodyDigest: 'f'.repeat(64) })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      expect(await resolveEpcisConflict(storage, { conflictId, ...decision })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      expect(await resolveEpcisConflict(storage, { conflictId, ...decision, decision: '', disposition: 'all-retained' })).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
      expect(count(storage, EPCIS_RECORD_KINDS.resolution)).toBe(0);
    });
  });
});

describe('bounds: every limit is enforced and disclosed', () => {
  const limited = (limits: Partial<typeof EPCIS_DEFAULT_LIMITS>): Overrides => ({ policy: { policyId: 'test-policy@1', limits } });
  const document = (): JsonObject => epcisDocument(fiveEventList());

  it.each([
    ['maxDocumentBytes', { maxDocumentBytes: 64 }, 'oversized', compact(document())],
    ['maxEventsPerPage', { maxEventsPerPage: 6 }, 'too-many-events', compact(document())],
    ['maxJsonDepth', { maxJsonDepth: 4 }, 'depth', compact(document())],
    ['maxContextDocuments', { maxContextDocuments: 1 }, 'too-many-contexts', compact(document())],
    ['maxContextBytes', { maxContextBytes: 8 }, 'contexts-oversized', compact(document())],
  ] as const)('enforces %s', async (name, limits, reason, bytes) => {
    const storage = createMemoryEpcisStorage();
    const outcome = await importEpcisSource(request(storage, bytes, limited(limits)));
    expect(outcome).toMatchObject({ outcome: 'refused', reason, limits: { ...EPCIS_DEFAULT_LIMITS, ...limits } });
    if (outcome.outcome === 'refused') expect(outcome.detail).toContain(String(limits[name as keyof typeof limits]));
    expect(isEmpty(storage)).toBe(true);
    // One more than the limit is refused; exactly the limit is not.
    expect((await importEpcisSource(request(createMemoryEpcisStorage(), bytes))).outcome).toBe('retained');
  });

  it('accepts a document exactly at each limit', async () => {
    const bytes = compact(document());
    const contexts = retained(await importEpcisSource(request(createMemoryEpcisStorage(), bytes))).record.contextRefs;
    expect(contexts).toHaveLength(2);
    const inlineBytes = JSON.stringify({ example: 'https://example.org/vocab/' }).length;
    const exact = { maxDocumentBytes: bytes.byteLength, maxEventsPerPage: 7, maxContextDocuments: 2, maxContextBytes: inlineBytes };
    const outcome = retained(await importEpcisSource(request(createMemoryEpcisStorage(), bytes, limited(exact))));
    expect(outcome.record.limits).toEqual({ ...EPCIS_DEFAULT_LIMITS, ...exact });
  });

  it('discloses the limits that govern a later pull without applying them to a file', async () => {
    const { record } = retained(await importEpcisSource(request(createMemoryEpcisStorage(), compact(document()), limited({ maxPullPages: 1, maxPullBytes: 1, maxPullSeconds: 1, fetchTimeoutMs: 1 }))));
    expect(record.limits).toMatchObject({ maxPullPages: 1, maxPullBytes: 1, maxPullSeconds: 1, fetchTimeoutMs: 1 });
    expect(Object.keys(record.limits).sort()).toEqual(Object.keys(EPCIS_DEFAULT_LIMITS).sort());
  });

  it('refuses a limit that is not a positive integer, and a request it cannot record', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(document());
    expect(await importEpcisSource(request(storage, bytes, limited({ maxJsonDepth: 0 })))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await importEpcisSource(request(storage, bytes, { requestId: '' }))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await importEpcisSource(request(storage, bytes, { requestId: 'r'.repeat(257) }))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await importEpcisSource(request(storage, bytes, { sourceId: 's'.repeat(257) }))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await importEpcisSource(request(storage, bytes, { receivedAt: 'yesterday' }))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(await importEpcisSource(request(storage, bytes, { policy: { policyId: '' } }))).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    expect(isEmpty(storage)).toBe(true);
  });

  it('refuses provenance that could carry a secret or that it does not know how to record', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = compact(document());
    for (const provenance of [
      { kind: 'file', token: 'secret' },
      { kind: 'file', filename: 'https://user:password@example.org/events.json' },
      { kind: 'file', filename: 'events.json?access_token=abc' },
      { kind: 'query', origin: 'https://example.org' },
      { kind: 'file', filename: 'x'.repeat(1025) },
    ]) {
      expect(await importEpcisSource(request(storage, bytes, { provenance: provenance as never })), JSON.stringify(provenance)).toMatchObject({ outcome: 'refused', reason: 'invalid-request' });
    }
    expect(isEmpty(storage)).toBe(true);
  });

  it('stays bounded on hostile input', async () => {
    const storage = createMemoryEpcisStorage();
    const started = Date.now();
    // Nesting far past the depth limit, with and without an envelope around it.
    const deep = utf8(`{"type":"EPCISDocument","a":${'['.repeat(200_000)}${']'.repeat(200_000)}}`);
    const deepOutcome = await importEpcisSource(request(storage, deep));
    expect(deepOutcome.outcome).toBe('refused');
    if (deepOutcome.outcome === 'refused') expect(['depth', 'malformed-json']).toContain(deepOutcome.reason);
    // Far more events than the limit, inside the byte limit.
    const event = { type: 'ObjectEvent', eventTime: '2026-03-02T08:00:00.000Z', eventTimeZoneOffset: '+00:00', epcList: [PACK], action: 'OBSERVE' };
    const many = compact(epcisDocument(Array.from({ length: 12_000 }, () => event)));
    expect(many.byteLength).toBeLessThan(EPCIS_DEFAULT_LIMITS.maxDocumentBytes);
    expect(await importEpcisSource(request(storage, many))).toMatchObject({ outcome: 'refused', reason: 'too-many-events' });
    // A document over the byte limit is refused by its length, before it is decoded.
    const oversized = new Uint8Array(EPCIS_DEFAULT_LIMITS.maxDocumentBytes + 1).fill(0x20);
    expect(await importEpcisSource(request(storage, oversized))).toMatchObject({ outcome: 'refused', reason: 'oversized' });
    // A long run of digits and a number a double cannot carry.
    expect(await importEpcisSource(request(storage, utf8(`{"type":"EPCISDocument","n":${'9'.repeat(500_000)}}`)))).toMatchObject({ outcome: 'refused', reason: 'unsafe-number' });
    // Identifiers that cannot be read are findings, never an exception, and the findings kept do not outgrow the document.
    const unreadable = compact(epcisDocument([{ ...commissioning(), epcList: ['https://id.example.org/01/09521234123453/21/%E0%A4%A', ...Array.from({ length: 20_000 }, (_, i) => `not a uri ${i}`)] }]));
    const noisy = retained(await importEpcisSource(request(createMemoryEpcisStorage(), unreadable))).record;
    expect(noisy.documentValidity).toBe('invalid');
    expect(noisy.events[0]!.identifiers[0]).toMatchObject({ problem: 'a qualifier is not valid percent-encoding' });
    const kept = noisy.findings.length + noisy.events[0]!.validation.findings.length;
    expect(kept).toBe(EPCIS_MAX_RECORDED_FINDINGS);
    expect(noisy.findings.at(-1)).toMatchObject({ code: 'findings-truncated', severity: 'info' });
    expect(noisy.findings.at(-1)!.message).toMatch(/^\d{5,} findings were made/);
    // One event naming a very large number of identifiers is retained and indexed in bounded batches.
    const wide = compact(epcisDocument([{ ...commissioning(), epcList: Array.from({ length: 20_000 }, (_, i) => `urn:epc:id:sgtin:9521234.012345.S${i}`) }]));
    expect(wide.byteLength).toBeLessThan(EPCIS_DEFAULT_LIMITS.maxDocumentBytes);
    const largest = { writes: 0 };
    const commit = storage.commit.bind(storage);
    storage.commit = async (writes) => { largest.writes = Math.max(largest.writes, writes.length); return commit(writes); };
    const widest = retained(await importEpcisSource(request(storage, wide, { requestId: 'wide' }))).record;
    expect(widest.events[0]!.identifiers).toHaveLength(20_000);
    expect(count(storage, EPCIS_RECORD_KINDS.association)).toBe(20_000);
    expect(largest.writes).toBeLessThanOrEqual(256);
    expect(storage.state.bytes.size).toBe(1);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
});

describe('the pinned GS1 schema', () => {
  it('refuses an import with no side effect when the schema has not been provisioned, and says how to provision it', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dpp-gs1-empty-'));
    try {
      const storage = createMemoryEpcisStorage();
      const outcome = await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())), { artefactsDir: empty }));
      expect(outcome).toMatchObject({ outcome: 'refused', reason: 'gs1-artefact-unavailable' });
      if (outcome.outcome === 'refused') {
        expect(outcome.remedy).toContain('dpp-gs1-artefacts fetch');
        expect(outcome.remedy).toContain(empty);
        expect(outcome.detail).toContain('epcis-json-schema');
      }
      expect(isEmpty(storage)).toBe(true);
      // A transport refusal is still named for what it is: the schema is not needed to refuse unsafe bytes.
      expect(await importEpcisSource(request(storage, utf8('{"a":1,"a":2}'), { artefactsDir: empty }))).toMatchObject({ outcome: 'refused', reason: 'duplicate-key' });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('export: the original, or a projection labelled as one', () => {
  it('returns the retained original and nothing else', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = pretty(epcisDocument(fiveEventList()));
    const { record } = retained(await importEpcisSource(request(storage, bytes)));
    const exported = await exportEpcisSource(storage, record.importId);
    expect(exported).toEqual({ kind: 'original', importId: record.importId, bytes, mediaType: 'application/ld+json', sha256: record.sha256, byteLength: bytes.byteLength });
    expect(await exportEpcisSource(storage, epcisImportId('source-a', 'unknown'))).toBeUndefined();
    expect(await exportEpcisSource(storage, 'not an import id')).toBeUndefined();
  });

  it('refuses to export bytes that no longer match the digest they were recorded under', async () => {
    const storage = createMemoryEpcisStorage();
    const { record } = retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    storage.state.bytes.get(record.sha256)![0] = 0x20;
    await expect(exportEpcisSource(storage, record.importId)).rejects.toMatchObject({ code: 'retained-bytes-mismatch' });
    storage.state.bytes.delete(record.sha256);
    await expect(exportEpcisSource(storage, record.importId)).rejects.toMatchObject({ code: 'retained-bytes-missing' });
  });

  it('labels a projection derived, gives it its own digest and never offers it as the original', async () => {
    const storage = createMemoryEpcisStorage();
    const bytes = pretty(epcisDocument(fiveEventList()));
    const { record } = retained(await importEpcisSource(request(storage, bytes)));
    const derived = await deriveEpcisEventProjection(storage, record.importId);
    expect(derived).toMatchObject({ kind: 'derived', derived: true, projection: 'urn:bsv:dpp:epcis:projection:events:1', mediaType: 'application/json', derivedFrom: { importId: record.importId, sha256: record.sha256, mediaType: 'application/ld+json' } });
    expect(derived!.sha256).not.toBe(record.sha256);
    expect(derived!.sha256).toBe(parseDigest(derived!.bytes));
    const body = JSON.parse(new TextDecoder().decode(derived!.bytes)) as JsonObject;
    expect(body).toMatchObject({ derived: true, projection: 'urn:bsv:dpp:epcis:projection:events:1', derivedFrom: { importId: record.importId, sha256: record.sha256 } });
    // It is not an EPCIS envelope and cannot be imported as the source it came from.
    expect(body.type).toBeUndefined();
    expect(body['@context']).toBeUndefined();
    expect((body.events as JsonObject[]).map((e) => e.pointer)).toEqual(record.events.map((e) => e.pointer));
    expect((body.events as JsonObject[])[6]!.event).toEqual(fiveEventList()[6]);
    // Asking for the original still answers the original.
    const original = await exportEpcisSource(storage, record.importId);
    expect(original!.kind).toBe('original');
    expect(Buffer.from(original!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(await deriveEpcisEventProjection(storage, epcisImportId('source-a', 'unknown'))).toBeUndefined();
  });
});

describe('the associations index', () => {
  const lookup = async (storage: MemoryEpcisStorage, identifier: string, granularity: 'instance' | 'class', sourceId?: string) =>
    (await findEpcisAssociations(storage, { identifier, granularity, ...(sourceId == null ? {} : { sourceId }) })).associations.map((a) => [a.pointer.split('/').at(-1), a.role]);

  it('keeps the role of every relationship', async () => {
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    expect(await lookup(storage, PACK, 'instance')).toEqual([
      ['1', 'transformation-output'],
      ['2', 'object'],
      ['3', 'association-parent'],
      ['4', 'aggregation-child'],
      ['5', 'transaction-object'],
      ['6', 'object'],
    ]);
    expect(await lookup(storage, MODULE, 'instance')).toEqual([['0', 'transformation-output'], ['1', 'transformation-input']]);
    expect(await lookup(storage, CELL_A, 'instance')).toEqual([['0', 'transformation-input'], ['3', 'association-child']]);
    expect(await lookup(storage, PALLET, 'instance')).toEqual([['4', 'aggregation-parent']]);
  });

  it('never records a class or quantity reference as an individual item taking part', async () => {
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    expect(await lookup(storage, ELECTROLYTE_LOT, 'class')).toEqual([['1', 'transformation-input-quantity']]);
    expect(await lookup(storage, SCRAP_CLASS, 'class')).toEqual([['1', 'transformation-output-quantity']]);
    expect(await lookup(storage, ELECTROLYTE_LOT, 'instance')).toEqual([]);
    expect(await lookup(storage, SCRAP_CLASS, 'instance')).toEqual([]);
    expect(await lookup(storage, PACK, 'class')).toEqual([]);
    const [lot] = (await findEpcisAssociations(storage, { identifier: ELECTROLYTE_LOT, granularity: 'class' })).associations;
    expect(lot).toMatchObject({ granularity: 'class', scheme: 'gs1-lgtin', lot: 'LOT7', quantity: 4, uom: 'EA', errorDeclared: false });
    // No entry anywhere is an instance entry for a class identifier or a quantity role.
    for (const held of storage.state.records.get(EPCIS_RECORD_KINDS.association)!.values()) {
      const entry = held.value;
      if (String(entry.role).endsWith('-quantity') || /^urn:epc:(class|idpat):/.test(String(entry.identifier))) expect(entry.granularity).toBe('class');
    }
  });

  it('reads the granularity from the identifier in an identifier list, and from the list in a quantity list', () => {
    const event = { type: 'ObjectEvent', epcList: [PACK, ELECTROLYTE_LOT, PACK_LINK, 'https://id.example.org/01/09521234123453', 'https://id.example.org/01/09521234123453/10/LOT7', 'not a uri'], quantityList: [{ epcClass: PACK, quantity: 1 }] };
    expect(epcisEventAssociations(event, '/e').map((a) => [a.identifier, a.granularity, a.role])).toEqual([
      [PACK, 'instance', 'object'],
      [ELECTROLYTE_LOT, 'class', 'object'],
      [PACK_LINK, 'instance', 'object'],
      ['https://id.example.org/01/09521234123453', 'class', 'object'],
      ['https://id.example.org/01/09521234123453/10/LOT7', 'class', 'object'],
      [PACK, 'class', 'object-quantity'],
    ]);
    expect(epcisEventAssociations({ type: 'example:CustomEvent', epcList: [PACK] }, '/e')).toEqual([]);
  });

  it('matches an identifier exactly as written, filters by source and pages', async () => {
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    retained(await importEpcisSource(request(storage, compact(epcisDocument([commissioning()])), { sourceId: 'source-b' })));
    // The Digital Link form of the same item is another string; no equivalence is inferred.
    expect(await lookup(storage, PACK_LINK, 'instance')).toEqual([]);
    expect(await lookup(storage, PACK, 'instance', 'source-b')).toEqual([['0', 'object']]);
    expect((await lookup(storage, PACK, 'instance')).length).toBe(7);
    const first = await findEpcisAssociations(storage, { identifier: PACK, granularity: 'instance', limit: 3 });
    expect(first.associations).toHaveLength(3);
    const rest = await findEpcisAssociations(storage, { identifier: PACK, granularity: 'instance', limit: 10, after: first.next! });
    expect(rest.associations).toHaveLength(4);
    expect(rest.next).toBeUndefined();
  });

  it('marks an event that carries an error declaration', async () => {
    const storage = createMemoryEpcisStorage();
    const { declared, corrective } = correctionEvents();
    retained(await importEpcisSource(request(storage, compact(epcisDocument([declared, corrective])))));
    const found = (await findEpcisAssociations(storage, { identifier: PACK, granularity: 'instance' })).associations;
    expect(found.map((a) => a.errorDeclared)).toEqual([true, false]);
  });

  it('rebuilds from the retained sources and records to exactly what was built as they arrived', async () => {
    const storage = createMemoryEpcisStorage();
    const { declared, corrective } = correctionEvents();
    retained(await importEpcisSource(request(storage, pretty(epcisDocument(fiveEventList())))));
    retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())), { requestId: 'request-2' })));
    retained(await importEpcisSource(request(storage, compact(epcisDocument([declared, corrective])), { requestId: 'request-3' })));
    retained(await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }])), { requestId: 'request-4' })));
    retained(await importEpcisSource(request(storage, compact(schemaInvalidDocument()), { requestId: 'request-5' })));
    retained(await importEpcisSource(request(storage, compact(epcisQueryDocument(fiveEventList().slice(2, 4))), { sourceId: 'source-b' })));
    const incremental = snapshot(storage);
    expect(incremental.records[EPCIS_RECORD_KINDS.association]!.length).toBeGreaterThan(30);

    // Lose the index entirely, then damage it: a rebuild restores it either way.
    storage.state.records.get(EPCIS_RECORD_KINDS.association)!.clear();
    const report = await rebuildEpcisAssociations(storage, { now: () => RECEIVED });
    expect(report).toMatchObject({ importsRead: 6, importsIndexed: 5, associationsWritten: incremental.records[EPCIS_RECORD_KINDS.association]!.length });
    expect(snapshot(storage)).toEqual(incremental);

    const table = storage.state.records.get(EPCIS_RECORD_KINDS.association)!;
    const [someKey] = table.keys();
    table.delete(someKey!);
    table.set('0000stray.entry', { revision: 1, value: { recordType: 'epcis-association', identifier: 'urn:example:stray' } });
    await rebuildEpcisAssociations(storage, { now: () => RECEIVED });
    expect(snapshot(storage)).toEqual(incremental);
  });
});

describe('recovery', () => {
  it('has nothing to do on a store that was never interrupted', async () => {
    const storage = createMemoryEpcisStorage();
    retained(await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList())))));
    const before = snapshot(storage);
    expect(await recoverEpcisExchange(storage, { now: () => RECEIVED })).toEqual({ actions: [], remaining: 0 });
    expect(snapshot(storage)).toEqual(before);
    expect(await checkEpcisExchangeInvariants(storage)).toEqual([]);
  });

  it('finishes an import that stopped after its receipt, without needing the GS1 schema again', async () => {
    const { faultInjectingEpcisStorage } = await import('../src/epcis-exchange.js');
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    // Stop after the receipt is durable and before any event result is.
    const faulty = faultInjectingEpcisStorage(storage, { at: 3, when: 'after' });
    await expect(importEpcisSource({ ...request(storage, bytes), storage: faulty.storage })).rejects.toThrow(/simulated crash/);
    expect(faulty.calls()).toEqual(['commit', 'putBytes', 'commit']);
    const received = (await findEpcisImportByRequest(storage, 'source-a', 'request-1'))!;
    expect(received.state).toBe('received');
    expect(received.events.every((e) => e.arrival === undefined)).toBe(true);
    expect((await checkEpcisExchangeInvariants(storage)).length).toBeGreaterThan(0);
    // The receipt already holds the validation, so recovery reads the retained bytes and no GS1 file.
    const empty = mkdtempSync(join(tmpdir(), 'dpp-gs1-empty-'));
    const before = process.env.DPP_GS1_ARTEFACTS_DIR;
    process.env.DPP_GS1_ARTEFACTS_DIR = empty;
    let finished;
    try { finished = await recoverEpcisExchange(storage, { now: () => RECEIVED }); } finally { process.env.DPP_GS1_ARTEFACTS_DIR = before; rmSync(empty, { recursive: true, force: true }); }
    expect(finished).toEqual({ actions: [{ action: 'import-finished', importId: epcisImportId('source-a', 'request-1'), from: 'received', state: 'evaluated' }], remaining: 0 });
    const record = (await findEpcisImportByRequest(storage, 'source-a', 'request-1'))!;
    expect(record).toEqual(retained(await importEpcisSource(request(createMemoryEpcisStorage(), bytes))).record);
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    // The retry is answered with the same import and writes nothing.
    const again = retained(await importEpcisSource(request(storage, bytes)));
    expect(again).toMatchObject({ replayed: true, resumed: false });
    expect(again.record).toEqual(record);
  });

  it('discards a request that stopped before its receipt, and leaves bytes another import holds', async () => {
    const { faultInjectingEpcisStorage } = await import('../src/epcis-exchange.js');
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    const faulty = faultInjectingEpcisStorage(storage, { at: 2, when: 'after' });
    await expect(importEpcisSource({ ...request(storage, bytes), storage: faulty.storage })).rejects.toThrow(/simulated crash/);
    expect(storage.state.bytes.size).toBe(1);
    expect(await findEpcisImportByRequest(storage, 'source-a', 'request-1')).toBeUndefined();
    const report = await recoverEpcisExchange(storage, { now: () => RECEIVED });
    expect(report).toEqual({ actions: [{ action: 'intake-discarded', importId: epcisImportId('source-a', 'request-1'), sha256: parseOk(bytes).sha256, bytesRemoved: true }], remaining: 0 });
    expect(isEmpty(storage)).toBe(true);

    // The same stop, when an acknowledged import already holds those bytes: they stay.
    const held = retained(await importEpcisSource(request(storage, bytes, { requestId: 'request-held' }))).record;
    const again = faultInjectingEpcisStorage(storage, { at: 2, when: 'after' });
    await expect(importEpcisSource({ ...request(storage, bytes), storage: again.storage })).rejects.toThrow(/simulated crash/);
    expect((await recoverEpcisExchange(storage, { now: () => RECEIVED })).actions).toEqual([expect.objectContaining({ action: 'intake-discarded', bytesRemoved: false })]);
    expect(Buffer.from((await exportEpcisSource(storage, held.importId))!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(await checkEpcisExchangeInvariants(storage)).toEqual([]);
  });

  it('replaces a request that stopped before its receipt when other bytes arrive under it', async () => {
    const { faultInjectingEpcisStorage } = await import('../src/epcis-exchange.js');
    const storage = createMemoryEpcisStorage();
    const abandoned = compact(epcisDocument(fiveEventList()));
    await expect(importEpcisSource({ ...request(storage, abandoned), storage: faultInjectingEpcisStorage(storage, { at: 2, when: 'after' }).storage })).rejects.toThrow(/simulated crash/);
    expect(storage.state.bytes.has(parseOk(abandoned).sha256)).toBe(true);
    // Nothing was acknowledged for the first bytes, so the request identifier is not bound to them.
    const bytes = compact(epcisDocument([commissioning()]));
    const outcome = retained(await importEpcisSource(request(storage, bytes)));
    expect(outcome).toMatchObject({ replayed: false, resumed: false });
    expect(outcome.record.sha256).toBe(parseOk(bytes).sha256);
    // An import never removes bytes: the ones the stopped attempt left are noted, and recovery removes them.
    expect(storage.state.bytes.size).toBe(2);
    expect(await recoverEpcisExchange(storage)).toEqual({ actions: [{ action: 'bytes-discarded', sha256: parseOk(abandoned).sha256, bytesRemoved: true }], remaining: 0 });
    expect([...storage.state.bytes.keys()]).toEqual([outcome.record.sha256]);
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([]);
    expect(await getEpcisImport(storage, outcome.record.importId)).toEqual(outcome.record);
  });

  it('resumes an unfinished import when the same request is made again', async () => {
    const { faultInjectingEpcisStorage } = await import('../src/epcis-exchange.js');
    const storage = createMemoryEpcisStorage();
    const bytes = compact(epcisDocument(fiveEventList()));
    await expect(importEpcisSource({ ...request(storage, bytes), storage: faultInjectingEpcisStorage(storage, { at: 4, when: 'before' }).storage })).rejects.toThrow(/simulated crash/);
    const resumed = retained(await importEpcisSource(request(storage, bytes)));
    expect(resumed).toMatchObject({ replayed: true, resumed: true });
    expect(resumed.record.state).toBe('evaluated');
    expect(count(storage, EPCIS_RECORD_KINDS.import)).toBe(1);
    // Different bytes under the same request are still a conflict while the first is unfinished.
    const other = createMemoryEpcisStorage();
    await expect(importEpcisSource({ ...request(other, bytes), storage: faultInjectingEpcisStorage(other, { at: 4, when: 'before' }).storage })).rejects.toThrow(/simulated crash/);
    expect((await importEpcisSource(request(other, compact(epcisDocument([commissioning()]))))).outcome).toBe('request-conflict');
  });
});

describe('two writers on one store', () => {
  /** A second handle on the same state, as another process would have, and a first handle that lets it in at a chosen moment. */
  function interleaved(when: (writes: readonly { kind: string }[]) => boolean, other: (second: MemoryEpcisStorage) => Promise<unknown>): { first: MemoryEpcisStorage; second: MemoryEpcisStorage; entered: () => number } {
    const first = createMemoryEpcisStorage();
    const second = createMemoryEpcisStorage(first.state);
    const commit = first.commit.bind(first);
    let entered = 0;
    first.commit = async (writes) => {
      if (entered === 0 && when(writes)) { entered += 1; await other(second); }
      return commit(writes);
    };
    return { first, second, entered: () => entered };
  }

  it('classifies again when another writer records the same event first', async () => {
    const bytes = compact(epcisDocument([commissioning()]));
    const { first, second, entered } = interleaved(
      (writes) => writes.some((write) => write.kind === EPCIS_RECORD_KINDS.observation),
      (other) => importEpcisSource(request(other, pretty(epcisDocument([commissioning()])), { requestId: 'request-other' })),
    );
    const mine = retained(await importEpcisSource(request(first, bytes))).record;
    expect(entered()).toBe(1);
    // The other writer took the first place under the identity, so this arrival is a repeat of it, not a second first.
    expect(mine.events[0]).toMatchObject({ arrival: 'duplicate', observation: { sequence: 1, importId: epcisImportId('source-a', 'request-other') } });
    expect((await findEpcisImportByRequest(second, 'source-a', 'request-other'))!.events[0]!.arrival).toBe('new');
    expect(count(first, EPCIS_RECORD_KINDS.observation)).toBe(1);
    expect(await checkEpcisExchangeInvariants(first, { associations: true })).toEqual([]);
  });

  it('answers the other writer\'s import when both make the same request', async () => {
    const bytes = compact(epcisDocument(fiveEventList()));
    const { first, second, entered } = interleaved(
      (writes) => writes.some((write) => write.kind === EPCIS_RECORD_KINDS.import),
      (other) => importEpcisSource(request(other, bytes)),
    );
    const mine = retained(await importEpcisSource(request(first, bytes)));
    expect(entered()).toBe(1);
    expect(mine.replayed).toBe(true);
    expect(mine.record).toEqual(await findEpcisImportByRequest(second, 'source-a', 'request-1'));
    expect(count(first, EPCIS_RECORD_KINDS.import)).toBe(1);
    expect(count(first, EPCIS_RECORD_KINDS.observation)).toBe(7);
    expect(await checkEpcisExchangeInvariants(first, { associations: true })).toEqual([]);
  });

  it('answers a conflict when the other writer bound the request to other bytes first', async () => {
    const { first, entered } = interleaved(
      (writes) => writes.some((write) => write.kind === EPCIS_RECORD_KINDS.import),
      (other) => importEpcisSource(request(other, compact(epcisDocument([commissioning()])))),
    );
    const mine = await importEpcisSource(request(first, compact(epcisDocument(fiveEventList()))));
    expect(entered()).toBe(1);
    expect(mine.outcome).toBe('request-conflict');
    expect(count(first, EPCIS_RECORD_KINDS.import)).toBe(1);
    // What the losing request had put down is cleared by recovery, and the winner is whole.
    const report = await recoverEpcisExchange(first, { now: () => RECEIVED });
    expect(report.remaining).toBe(0);
    expect(await checkEpcisExchangeInvariants(first, { associations: true })).toEqual([]);
    expect(first.state.bytes.size).toBe(1);
  });
});

describe('boundaries', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const src = resolve(import.meta.dirname, '..', 'src');
  /** Every module the entry point reaches, by following its imports, and every package or built-in any of them names. */
  function importGraph(entry: string): { files: string[]; external: string[] } {
    const files = new Set<string>();
    const external = new Set<string>();
    const visit = (file: string): void => {
      if (files.has(file)) return;
      files.add(file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
        const specifier = (match[1] ?? match[2] ?? match[3])!;
        if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
        else external.add(specifier);
      }
    };
    visit(entry);
    return { files: [...files].map((f) => f.slice(src.length + 1)).sort(), external: [...external].sort() };
  }

  it('reaches no signing, wallet or chain code', () => {
    const graph = importGraph(join(src, 'epcis-exchange.ts'));
    expect(graph.external).toEqual(['ajv', 'ajv-formats', 'node:assert/strict', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:os', 'node:path']);
    expect(graph.files).toEqual([
      'epcis-exchange.ts',
      'epcis-exchange/adapter-suite.ts',
      'epcis-exchange/exchange.ts',
      'epcis-exchange/file-storage.ts',
      'epcis-exchange/records.ts',
      'epcis-exchange/storage.ts',
      'epcis-source.ts',
      'gs1-artefacts.ts',
      'jcs.ts',
      'types.ts',
    ]);
    // The credential verifier and the did:web resolver of this package are not reached either.
    expect(graph.files).not.toContain('exchange.ts');
    expect(graph.files).not.toContain('did-web.ts');
    for (const file of graph.files) {
      const text = readFileSync(join(src, file), 'utf8');
      // node:crypto is used for digests and random names only.
      expect(text, file).not.toMatch(/createSign|createVerify|createPrivateKey|createPublicKey|generateKeyPair|createHmac|createCipher|\.sign\(|subtle\b/);
      expect(text, file).not.toMatch(/['"]@bsv\/|wallet|broadcast|createAction|new Transaction|Transaction\.from|PrivateKey|jsonld-signatures|digitalbazaar/i);
      if (file.startsWith('epcis-exchange')) expect(text, file).not.toMatch(/\bfetch\(|node:https?|node:net|node:child_process/);
    }
  });

  it('does not fetch, and never describes a source as signed or authentic', async () => {
    const fetched = vi.fn(() => { throw new Error('the exchange must not fetch'); });
    vi.stubGlobal('fetch', fetched);
    const storage = createMemoryEpcisStorage();
    const first = await importEpcisSource(request(storage, compact(epcisDocument(fiveEventList()))));
    const changed = await importEpcisSource(request(storage, compact(epcisDocument([{ ...commissioning(), disposition: 'in_transit' }])), { requestId: 'request-2' }));
    const invalid = await importEpcisSource(request(storage, compact(schemaInvalidDocument()), { requestId: 'request-3' }));
    const refused = await importEpcisSource(request(storage, utf8('{'), { requestId: 'request-4' }));
    const conflictId = epcisConflictId('source-a', 'event-id', String(commissioning().eventID));
    const resolution = await resolveEpcisConflict(storage, { conflictId, decision: 'Both are kept.', disposition: 'all-retained', decidedAt: RECEIVED });
    const derived = await deriveEpcisEventProjection(storage, retained(first).record.importId);
    const exported = await exportEpcisSource(storage, retained(first).record.importId);
    const answers = [first, changed, invalid, refused, resolution, await getEpcisConflict(storage, conflictId), { ...derived, bytes: new TextDecoder().decode(derived!.bytes) }, { ...exported, bytes: undefined }, await recoverEpcisExchange(storage), await rebuildEpcisAssociations(storage), await findEpcisAssociations(storage, { identifier: PACK, granularity: 'instance' }), snapshot(storage)];
    expect(fetched).not.toHaveBeenCalled();
    const text = JSON.stringify(answers);
    expect(text).not.toMatch(/\bsigned\b|\bsignature\b|\bauthentic|\bauthenticated\b|\btrusted\b|\bverified\b|\bproof\b|\bcustody\b|\bowner\b/i);
    // No record names a token operation, a key or a transaction.
    expect(text).not.toMatch(/\btxid\b|\boutpoint\b|\bprivate\s?key\b|\bISSUE\b|\bTRANSFER\b|\bRETIRE\b/);
  });
});

function parseOk(bytes: Uint8Array): Extract<ReturnType<typeof parseEpcisSource>, { ok: true }> {
  const parsed = parseEpcisSource(bytes, { mediaType: 'application/json' });
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed;
}

function parseDigest(bytes: Uint8Array): string {
  // The digest of arbitrary bytes, through the same function the module uses for a source.
  return parseEpcisSource(bytes, { mediaType: 'application/json' }).ok ? parseOk(bytes).sha256 : '';
}
