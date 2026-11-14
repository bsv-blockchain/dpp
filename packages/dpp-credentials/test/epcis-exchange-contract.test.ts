import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  EPCIS_IMPORT_VERSION,
  EPCIS_RECORD_KINDS,
  EPCIS_RECORD_VERSION,
  createMemoryEpcisStorage,
  epcisConflictId,
  faultInjectingEpcisStorage,
  importEpcisSource,
  rebuildEpcisAssociations,
  resolveEpcisConflict,
  type EpcisExchangeStorage,
  type MemoryEpcisStorage,
} from '../src/epcis-exchange.js';
import type { JsonObject } from '../src/types.js';
import { correctionEvents, epcisDocument, epcisQueryDocument, fiveEventList, schemaInvalidDocument } from './epcis-fixture.js';

const repo = join(import.meta.dirname, '..', '..', '..');
const contract = (name: string): { text: string; schema: JsonObject } => { const text = readFileSync(join(repo, 'contracts', name), 'utf8'); return { text, schema: JSON.parse(text) as JsonObject }; };
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const importV2 = contract('epcis-import.schema.json');
const importV1 = contract('epcis-import-v1.schema.json');
const records = contract('epcis-exchange-records.schema.json');
const validateImport = ajv.compile(importV2.schema);
const validateImportV1 = ajv.compile(importV1.schema);
const validateRecord = ajv.compile(records.schema);

const AT = '2026-03-10T00:00:00.000Z';
const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const request = (storage: EpcisExchangeStorage, requestId: string, document: unknown, sourceId = 'source-a') => ({ storage, sourceId, requestId, bytes: bytesOf(document), mediaType: 'application/ld+json', receivedAt: AT, provenance: { kind: 'file' as const, filename: `${requestId}.json` }, policy: { policyId: 'test-policy@1' }, now: () => AT });
const commissioning = (): JsonObject => fiveEventList()[2] as JsonObject;

/** A store that has seen every situation the module records, and every record it held on the way, the unfinished ones included. */
async function exercised(): Promise<{ storage: MemoryEpcisStorage; seen: Map<string, JsonObject[]> }> {
  const storage = createMemoryEpcisStorage();
  const seen = new Map<string, JsonObject[]>();
  const look = (): void => { for (const [kind, table] of storage.state.records) for (const held of table.values()) seen.set(kind, [...(seen.get(kind) ?? []), structuredClone(held.value)]); };
  const { declared, corrective } = correctionEvents();
  await importEpcisSource(request(storage, 'five', epcisDocument(fiveEventList())));
  await importEpcisSource(request(storage, 'query', epcisQueryDocument(fiveEventList().slice(2, 4))));
  await importEpcisSource(request(storage, 'corrections', epcisDocument([declared, corrective])));
  await importEpcisSource(request(storage, 'invalid', schemaInvalidDocument()));
  await importEpcisSource(request(storage, 'not-an-envelope', commissioning()));
  await importEpcisSource(request(storage, 'unpinned', { ...epcisDocument([commissioning()]), '@context': ['https://example.org/contexts/other.jsonld'] }));
  await importEpcisSource(request(storage, 'changed', epcisDocument([{ ...commissioning(), disposition: 'in_transit' }])));
  await importEpcisSource(request(storage, 'observed-again', epcisDocument([{ ...commissioning(), recordTime: '2026-03-09T00:00:00.000Z' }])));
  await importEpcisSource(request(storage, 'no-type', epcisDocument([{ eventTime: AT, eventTimeZoneOffset: '+00:00', eventID: 'not a uri at all' }])));
  look();
  // Stop an import at each durable step, so the journal entries and a received record are seen as they are stored.
  for (let at = 1; at <= 8; at += 1) {
    await importEpcisSource({ ...request(storage, `stopped-${at}`, epcisDocument(fiveEventList().slice(0, at % 3 + 1))), storage: faultInjectingEpcisStorage(storage, { at, when: 'after' }).storage }).catch(() => undefined);
    look();
  }
  // A request that stopped before its receipt, then made again with other bytes: the first bytes are noted for recovery.
  await importEpcisSource({ ...request(storage, 'replaced', epcisDocument(fiveEventList().slice(0, 2))), storage: faultInjectingEpcisStorage(storage, { at: 2, when: 'after' }).storage }).catch(() => undefined);
  await importEpcisSource(request(storage, 'replaced', epcisDocument(fiveEventList().slice(0, 1))));
  look();
  const conflictId = epcisConflictId('source-a', 'event-id', String(commissioning().eventID));
  await resolveEpcisConflict(faultInjectingEpcisStorage(storage, { at: 1, when: 'after' }).storage, { conflictId, decision: 'The later body stands.', disposition: 'body-selected', selectedBodyDigest: (seen.get('observation') ?? []).find((o) => o.arrival === 'conflict')!.bodyDigest as string, decidedAt: AT, decidedBy: 'reviewer', now: () => AT }).catch(() => undefined);
  look();
  await resolveEpcisConflict(storage, { conflictId, decision: 'All of them are kept.', disposition: 'all-retained', decidedAt: '2026-03-11T00:00:00.000Z', now: () => AT });
  await rebuildEpcisAssociations(faultInjectingEpcisStorage(storage, { at: 2, when: 'after' }).storage, { now: () => AT }).catch(() => undefined);
  look();
  return { storage, seen };
}

describe('the durable record schemas', () => {
  it('validates every import record the module writes against version 2 of the import contract', async () => {
    const { seen } = await exercised();
    const imports = seen.get(EPCIS_RECORD_KINDS.import)!;
    expect(new Set(imports.map((r) => r.state))).toEqual(new Set(['received', 'evaluated', 'blocked']));
    expect(new Set(imports.map((r) => r.documentValidity))).toEqual(new Set(['valid', 'invalid']));
    for (const record of imports) {
      expect(validateImport(record), `${String(record.requestId)}: ${JSON.stringify(validateImport.errors)}`).toBe(true);
      expect(record.importVersion).toBe(EPCIS_IMPORT_VERSION);
      expect(record.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    }
    // Situations the contract must be able to say: an open and a resolved conflict, a duplicate, an error declaration, an event without a type.
    const events = imports.flatMap((r) => r.events as JsonObject[]);
    expect(new Set(events.map((e) => e.arrival))).toEqual(new Set([undefined, 'new', 'duplicate', 'new-observation', 'conflict']));
    expect(new Set(events.flatMap((e) => (e.conflict == null ? [] : [(e.conflict as JsonObject).state])))).toEqual(new Set(['open', 'resolved']));
    expect(events.some((e) => e.errorDeclaration != null)).toBe(true);
    expect(events.some((e) => e.eventType === '' && e.eventId === 'not a uri at all')).toBe(true);
  });

  it('validates every other durable record against the exchange records contract, each with its type and version', async () => {
    const { seen } = await exercised();
    const expected: Record<string, string> = { observation: 'epcis-observation', resolution: 'epcis-conflict-resolution', association: 'epcis-association', retention: 'epcis-retention', journal: 'epcis-journal' };
    for (const [kind, recordType] of Object.entries(expected)) {
      const held = seen.get(kind) ?? [];
      expect(held.length, kind).toBeGreaterThan(0);
      for (const record of held) {
        expect(record.recordType, kind).toBe(recordType);
        expect(record.recordVersion, kind).toBe(EPCIS_RECORD_VERSION);
        expect(validateRecord(record), `${kind}: ${JSON.stringify(record).slice(0, 300)} ${JSON.stringify(validateRecord.errors)}`).toBe(true);
      }
    }
    expect(new Set((seen.get('journal') ?? []).map((j) => j.entry))).toEqual(new Set(['intake', 'import', 'resolution', 'rebuild', 'discard']));
    expect((seen.get('resolution') ?? []).map((r) => r.disposition).sort()).toEqual(expect.arrayContaining(['all-retained', 'body-selected']));
    // Every kind the module writes has a schema: nothing durable is outside the two contracts.
    expect([...seen.keys()].sort()).toEqual(Object.values(EPCIS_RECORD_KINDS).sort());
  });

  it('refuses records the contracts do not allow', async () => {
    const { seen } = await exercised();
    const record = seen.get(EPCIS_RECORD_KINDS.import)!.find((r) => r.state === 'evaluated')!;
    const without = (member: string): JsonObject => { const { [member]: _dropped, ...rest } = record; return rest; };
    for (const member of ['requestDigest', 'idempotency', 'documentValidity', 'limits', 'importId', 'sha256', 'byteLength', 'receivedAt']) expect(validateImport(without(member)), member).toBe(false);
    expect(validateImport({ ...record, importVersion: '1' })).toBe(false);
    expect(validateImport({ ...record, idempotency: { scope: 'source', rule: 'anything' } })).toBe(false);
    expect(validateImport({ ...record, documentValidity: 'authentic' })).toBe(false);
    expect(validateImport({ ...record, signedBy: 'someone' })).toBe(false);
    expect(validateImport({ ...record, idempotency: { scope: 'store', rule: 'request-digest-equal' } })).toBe(true);

    const resolution = seen.get('resolution')!.find((r) => r.disposition === 'body-selected')!;
    const { selectedBodyDigest: _selected, ...unselected } = resolution;
    expect(validateRecord(unselected)).toBe(false);
    expect(validateRecord({ ...resolution, disposition: 'all-retained' })).toBe(false);
    expect(validateRecord({ ...resolution, observations: [] })).toBe(false);
    expect(validateRecord({ ...resolution, recordVersion: '2' })).toBe(false);
    const association = seen.get('association')![0]!;
    expect(validateRecord({ ...association, granularity: 'item' })).toBe(false);
    expect(validateRecord({ ...association, role: 'participant' })).toBe(false);
    expect(validateRecord({ recordType: 'epcis-journal', recordVersion: '1', entry: 'intake', startedAt: AT })).toBe(false);
    expect(validateRecord({ recordType: 'something-else', recordVersion: '1' })).toBe(false);
  });

  it('keeps version 1 of the import contract as it was published, for records stored under it', () => {
    // Undo the two edits the kept copy says it carries. What is left is the published version 1, byte for byte.
    const lines = importV1.text.split('\n');
    const comment = lines.findIndex((line) => line.startsWith('  "$comment": '));
    expect(comment).toBe(3);
    lines.splice(comment, 1);
    const restored = lines.join('\n').replace('contracts/epcis-import-v1.schema.json"', 'contracts/epcis-import.schema.json"');
    expect(createHash('sha256').update(restored).digest('hex')).toBe('7406e539087a08b5b6673d6e8c86f9e8f6797a2ef3af9b0b27091e5d1ce9482b');
    expect((importV1.schema.properties as JsonObject).importVersion).toEqual({ const: '1' });
    expect((importV2.schema.properties as JsonObject).importVersion).toEqual({ const: '2' });
    expect(importV1.schema.$id).not.toBe(importV2.schema.$id);
    expect(importV1.schema.required).not.toContain('requestDigest');
    expect(importV2.schema.required).toEqual(expect.arrayContaining(['requestDigest', 'idempotency', 'documentValidity', 'limits']));

    // A record as version 1 allowed it, without a request digest, still validates under version 1 and is not a version 2 record.
    const stored = {
      importVersion: '1', importId: 'imp-1', requestId: 'req-1', sourceId: 'source-a', receivedAt: AT, mediaType: 'application/json', byteLength: 2, sha256: 'a'.repeat(64), bytesRef: `sha256:${'a'.repeat(64)}`,
      sourceLocation: { kind: 'file' }, contextRefs: [], profileRefs: ['epcis-json@1'], policyId: 'policy@1', state: 'evaluated', events: [], progress: { pagesRead: 1, complete: true, completenessLimits: [] },
    };
    expect(validateImportV1(stored), JSON.stringify(validateImportV1.errors)).toBe(true);
    expect(validateImport(stored)).toBe(false);
    expect(validateImport({ ...stored, importVersion: '2' })).toBe(false);
  });
});
