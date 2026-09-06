import { describe, expect, it } from 'vitest';
import {
  EPCIS_CONTEXT_DIGEST,
  EPCIS_CONTEXT_IRI,
  EPCIS_DEFAULT_LIMITS,
  classifyEpcisIdentifier,
  classifyEventArrival,
  contextReferences,
  epcisEventBodyDigest,
  epcisSourceReference,
  localEventIdentity,
  numberLiteralIsExact,
  parseEpcisSource,
  pinnedContextDigests,
  preservedEventExtensions,
  readEpcisSourceReference,
  resolveEpcisLimits,
  unresolvedCorrections,
  validateEpcisDocument,
} from '../src/epcis-source.js';
import { mapEpcisEvent } from '../src/epcis.js';
import type { JsonObject } from '../src/types.js';
import { CELL_A, MAPPING_OPTIONS, PACK, PACK_LINK, correctionEvents, epcisDocument, epcisQueryDocument, fiveEventList, refusedTransports, schemaInvalidDocument } from './epcis-fixture.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const bytesOf = (value: unknown, pretty = false): Uint8Array => utf8(pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value));
const okOrThrow = (result: ReturnType<typeof parseEpcisSource>) => { if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`); return result; };

describe('parseEpcisSource', () => {
  it('reads an EPCISDocument without changing it and points at every event', () => {
    const document = epcisDocument(fiveEventList());
    const bytes = bytesOf(document, true);
    const result = okOrThrow(parseEpcisSource(bytes, { mediaType: 'application/ld+json; charset=utf-8' }));
    expect(result.document).toEqual(document);
    expect(result.mediaType).toBe('application/ld+json');
    expect(result.byteLength).toBe(bytes.byteLength);
    expect(result.envelope).toEqual({ type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-03-03T07:00:00.000Z', hasHeader: false, hasMasterData: false });
    expect(result.events.map((e) => e.pointer)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `/epcisBody/eventList/${i}`));
    expect(result.events.map((e) => e.type)).toEqual(['TransformationEvent', 'TransformationEvent', 'ObjectEvent', 'AssociationEvent', 'AggregationEvent', 'TransactionEvent', 'ObjectEvent']);
    expect(result.events[6]).toMatchObject({ identityKind: 'local', localIdentity: localEventIdentity(result.sha256, '/epcisBody/eventList/6') });
    expect(result.events[2]).toMatchObject({ identityKind: 'event-id', eventId: 'urn:uuid:00000000-0000-4000-8000-000000000003' });
    expect(result.context.document).toEqual(document['@context']);
    expect(result.findings).toEqual([]);
  });

  it('locates query results at the query envelope pointer and records the query name', () => {
    const result = okOrThrow(parseEpcisSource(bytesOf(epcisQueryDocument(fiveEventList().slice(2, 4))), { mediaType: 'application/json' }));
    expect(result.envelope?.type).toBe('EPCISQueryDocument');
    expect(result.envelope?.queryName).toBe('SimpleEventQuery');
    expect(result.events.map((e) => e.pointer)).toEqual(['/epcisBody/queryResults/resultsBody/eventList/0', '/epcisBody/queryResults/resultsBody/eventList/1']);
  });

  it('retains a safely parsed document that is not an envelope, with the finding', () => {
    const result = okOrThrow(parseEpcisSource(bytesOf({ type: 'ObjectEvent', eventTime: '2026-01-01T00:00:00Z' }), { mediaType: 'application/json' }));
    expect(result.envelope).toBeUndefined();
    expect(result.events).toEqual([]);
    expect(result.findings.map((f) => f.code)).toEqual(['envelope-unrecognised']);
  });

  it('accepts a bare event only under caller-supplied envelope facts', () => {
    const event = fiveEventList()[2] as JsonObject;
    const result = okOrThrow(parseEpcisSource(bytesOf(event), { mediaType: 'application/json', singleEvent: { envelopeType: 'EPCISDocument', contextDeclarations: [EPCIS_CONTEXT_IRI] } }));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.pointer).toBe('');
    expect(result.findings.map((f) => f.code)).toEqual(['single-event']);
    expect(result.context.document).toEqual([EPCIS_CONTEXT_IRI]);
  });

  it('names what an envelope lacks without deciding for the caller', () => {
    const result = okOrThrow(parseEpcisSource(bytesOf({ type: 'EPCISDocument', schemaVersion: '1.2', epcisBody: {} }), { mediaType: 'application/json' }));
    expect(result.findings.map((f) => f.code).sort()).toEqual(['context-missing', 'event-list-missing', 'schema-version-unsupported']);
    expect(result.events).toEqual([]);
  });

  it('flags a repeated eventID within one document without merging the bodies', () => {
    const [a, b] = fiveEventList().slice(2, 4) as JsonObject[];
    const result = okOrThrow(parseEpcisSource(bytesOf(epcisDocument([a as JsonObject, { ...(b as JsonObject), eventID: a?.eventID }])), { mediaType: 'application/json' }));
    expect(result.events).toHaveLength(2);
    expect(result.findings.map((f) => f.code)).toEqual(['event-id-repeated']);
  });

  it.each(refusedTransports())('refuses $id before anything is retained', (refusal) => {
    const result = parseEpcisSource(refusal.bytes, { mediaType: refusal.id === 'refuse-unsupported-media-type' ? 'application/xml' : 'application/json', ...(refusal.limits == null ? {} : { limits: refusal.limits }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(refusal.reason);
  });

  it('refuses malformed JSON, a non-object root and an oversized document at the default limit', () => {
    expect(parseEpcisSource(utf8('{"type":'), { mediaType: 'application/json' })).toMatchObject({ ok: false, reason: 'malformed-json' });
    expect(parseEpcisSource(utf8('[1]'), { mediaType: 'application/json' })).toMatchObject({ ok: false, reason: 'not-an-object' });
    const big = new Uint8Array(EPCIS_DEFAULT_LIMITS.maxDocumentBytes + 1).fill(0x20);
    expect(parseEpcisSource(big, { mediaType: 'application/json' })).toMatchObject({ ok: false, reason: 'oversized' });
  });

  it('refuses a limit that is not a positive integer', () => {
    expect(() => resolveEpcisLimits({ maxJsonDepth: 0 })).toThrow(/positive integer/);
    expect(() => resolveEpcisLimits({ maxDocumentBytes: 1.5 })).toThrow(/positive integer/);
    expect(resolveEpcisLimits({ maxEventsPerPage: 500 }).maxEventsPerPage).toBe(500);
  });

  it('accepts exactly the number literals a double carries without changing their digits', () => {
    for (const exact of ['0', '-0', '4.50', '0.1', '1E30', '2e-3', '27.5', '9007199254740992', '100', '1.10', '0.000000000000000000000000001']) expect(numberLiteralIsExact(exact), exact).toBe(true);
    for (const lossy of ['9007199254740993', '333333333.33333329', '0.1000000000000000055511151231257827', '1e999']) expect(numberLiteralIsExact(lossy), lossy).toBe(false);
    expect(parseEpcisSource(utf8('{"type":"EPCISDocument","v":[4.50,27.5,-0]}'), { mediaType: 'application/json' }).ok).toBe(true);
  });
});

describe('validateEpcisDocument', () => {
  it('passes the neutral five-event document against the pinned 2.0.1 schema and reads every identifier', () => {
    const document = epcisDocument(fiveEventList());
    const parsed = okOrThrow(parseEpcisSource(bytesOf(document), { mediaType: 'application/json' }));
    const validation = validateEpcisDocument(parsed.document, { events: parsed.events });
    expect(validation.findings).toEqual([]);
    expect(validation.schema).toBe('pass');
    expect(validation.events).toHaveLength(7);
    const transformation = validation.events[1]!;
    expect(transformation.identifiers.map((i) => [i.scheme, i.gtin, i.serial ?? i.lot])).toEqual([
      ['gs1-sgtin', '09521234444442', 'MOD-1'],
      ['gs1-sgtin', '09521234123453', 'SER1'],
      ['gs1-lgtin', '09521234333333', 'LOT7'],
      ['gs1-sgtin-pattern', '09521234555551', undefined],
    ]);
    const association = validation.events[3]!;
    expect(association.identifiers.map((i) => i.path)).toEqual(['/epcisBody/eventList/3/childEPCs/0', '/epcisBody/eventList/3/childEPCs/1', '/epcisBody/eventList/3/parentID']);
    expect(validation.events[4]!.identifiers.find((i) => i.path.endsWith('parentID'))).toMatchObject({ scheme: 'epc-other' });
    expect(validation.events[6]!.preservedExtensions).toEqual(['example:note']);
    expect(validation.preservedExtensions).toEqual([]);
    expect(document).toEqual(epcisDocument(fiveEventList()));
  });

  it('fails the schema for a safely retained document and names the paths, repairing nothing', () => {
    const document = schemaInvalidDocument();
    const before = JSON.stringify(document);
    const validation = validateEpcisDocument(document);
    expect(validation.schema).toBe('fail');
    const paths = new Set(validation.findings.map((f) => f.path));
    expect(paths.has('/epcisBody/eventList/0/eventTimeZoneOffset')).toBe(true);
    expect([...paths].some((p) => p.startsWith('/epcisBody/eventList/0'))).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('classifies claimed GS1 identifiers by grammar and keeps every other scheme as declared', () => {
    expect(classifyEpcisIdentifier('/x', PACK)).toEqual({ path: '/x', value: PACK, scheme: 'gs1-sgtin', gtin: '09521234123453', serial: 'SER1', checkDigitValid: true });
    expect(classifyEpcisIdentifier('/x', PACK_LINK)).toEqual({ path: '/x', value: PACK_LINK, scheme: 'gs1-digital-link', gtin: '09521234123453', serial: 'SER1', checkDigitValid: true });
    expect(classifyEpcisIdentifier('/x', 'https://id.example.org/01/09521234123457/21/SER1')).toMatchObject({ scheme: 'gs1-digital-link', checkDigitValid: false, problem: 'the GTIN check digit does not hold' });
    expect(classifyEpcisIdentifier('/x', 'https://id.example.org/01/9521234123453/10/LOT7')).toMatchObject({ scheme: 'gs1-digital-link', gtin: '09521234123453', lot: 'LOT7', checkDigitValid: true });
    expect(classifyEpcisIdentifier('/x', 'urn:epc:id:sgtin:95212.012345.1')).toMatchObject({ scheme: 'gs1-sgtin', problem: 'company prefix and item reference do not total thirteen digits' });
    expect(classifyEpcisIdentifier('/x', 'urn:epc:id:sscc:9521234.0000000001')).toEqual({ path: '/x', value: 'urn:epc:id:sscc:9521234.0000000001', scheme: 'epc-other' });
    expect(classifyEpcisIdentifier('/x', 'https://example.org/8006/095212341234580102/8026/1')).toEqual({ path: '/x', value: 'https://example.org/8006/095212341234580102/8026/1', scheme: 'other' });
    expect(classifyEpcisIdentifier('/x', 'did:web:products.example:item:1')).toEqual({ path: '/x', value: 'did:web:products.example:item:1', scheme: 'other' });
    expect(classifyEpcisIdentifier('/x', 'not a uri')).toMatchObject({ scheme: 'other', problem: 'not a URI' });
    expect(classifyEpcisIdentifier('/x', 42)).toMatchObject({ scheme: 'other', problem: 'not a URI' });
  });

  it('reports a non-URI identifier as an error and a failing check digit as a warning', () => {
    const document = epcisDocument([{ ...(fiveEventList()[2] as JsonObject), epcList: ['not a uri', 'https://id.example.org/01/09521234123457/21/X'] }]);
    const validation = validateEpcisDocument(document);
    const identifierFindings = validation.findings.filter((f) => f.code === 'identifier');
    expect(identifierFindings.map((f) => f.severity)).toEqual(['error', 'warning']);
  });

  it('lists members the schema does not name for the type as preserved extensions', () => {
    expect(preservedEventExtensions({ type: 'ObjectEvent', action: 'ADD', 'example:a': 1, ilmd: {}, sensorElementList: [] })).toEqual(['example:a']);
    expect(preservedEventExtensions({ type: 'AggregationEvent', ilmd: {} })).toEqual(['ilmd']);
    expect(validateEpcisDocument(epcisDocument([], { 'example:batch': 'B1' })).preservedExtensions).toEqual(['example:batch']);
  });

  it('retains error declarations and reports unresolved corrections without resolving them', () => {
    const { declared, corrective, orphanDeclared } = correctionEvents();
    const validation = validateEpcisDocument(epcisDocument([declared, corrective, orphanDeclared]));
    expect(validation.schema).toBe('pass');
    expect(validation.events[0]!.errorDeclaration).toEqual({ declarationTime: '2026-03-04T10:00:00.000Z', reason: 'incorrect_data', correctiveEventIDs: ['urn:uuid:00000000-0000-4000-8000-00000000000b'] });
    const held = new Set([String(declared.eventID), String(corrective.eventID), String(orphanDeclared.eventID)]);
    expect(unresolvedCorrections(validation, held)).toEqual([{ pointer: '/epcisBody/eventList/2', missing: ['urn:uuid:00000000-0000-4000-8000-00000000000d'] }]);
    expect(unresolvedCorrections(validation, new Set())).toHaveLength(2);
  });
});

describe('digests, identities and references', () => {
  const contexts = [EPCIS_CONTEXT_DIGEST];
  const commissioning = fiveEventList()[2] as JsonObject;

  it('digests the event body the same under any formatting or member order, and differently when the body changes', () => {
    const reordered = Object.fromEntries(Object.entries(commissioning).reverse());
    expect(epcisEventBodyDigest(reordered, contexts)).toBe(epcisEventBodyDigest(commissioning, contexts));
    expect(epcisEventBodyDigest({ ...commissioning, recordTime: '2030-01-01T00:00:00Z' }, contexts)).toBe(epcisEventBodyDigest(commissioning, contexts));
    expect(epcisEventBodyDigest({ ...commissioning, errorDeclaration: { declarationTime: '2030-01-01T00:00:00Z' } }, contexts)).toBe(epcisEventBodyDigest(commissioning, contexts));
    expect(epcisEventBodyDigest({ ...commissioning, disposition: 'in_transit' }, contexts)).not.toBe(epcisEventBodyDigest(commissioning, contexts));
    expect(epcisEventBodyDigest(commissioning, [])).not.toBe(epcisEventBodyDigest(commissioning, contexts));
    expect(epcisEventBodyDigest(commissioning, ['a'.repeat(64), 'b'.repeat(64)])).toBe(epcisEventBodyDigest(commissioning, ['b'.repeat(64), 'a'.repeat(64)]));
    expect(() => epcisEventBodyDigest(commissioning, ['nope'])).toThrow(/64 lower-case hex/);
  });

  it('classifies an arrival within one scoped identity', () => {
    const base = { identity: 'urn:uuid:1', bodyDigest: 'a'.repeat(64), recordTime: '2026-01-01T00:00:00Z' };
    expect(classifyEventArrival(base, { ...base })).toBe('duplicate');
    expect(classifyEventArrival(base, { ...base, recordTime: '2026-01-02T00:00:00Z' })).toBe('new-observation');
    expect(classifyEventArrival(base, { ...base, errorDeclaration: { declarationTime: '2026-01-02T00:00:00Z' } })).toBe('new-observation');
    expect(classifyEventArrival(base, { ...base, bodyDigest: 'b'.repeat(64) })).toBe('conflict');
    expect(() => classifyEventArrival(base, { ...base, identity: 'urn:uuid:2' })).toThrow(/one scoped event identity/);
  });

  it('derives a local identity from the source digest and pointer, and refuses a malformed digest', () => {
    const id = localEventIdentity('c'.repeat(64), '/epcisBody/eventList/6');
    expect(id).toMatch(/^urn:bsv:dpp:epcis:local-event:sha256:[0-9a-f]{64}$/);
    expect(localEventIdentity('c'.repeat(64), '/epcisBody/eventList/7')).not.toBe(id);
    expect(() => localEventIdentity('C'.repeat(64), '/x')).toThrow();
  });

  it('pins the EPCIS context by IRI, digests inline contexts, and names unpinned IRIs', () => {
    const refs = contextReferences([EPCIS_CONTEXT_IRI, { example: 'https://example.org/vocab/' }, 'https://example.org/other-context']);
    expect(refs[0]).toEqual({ kind: 'iri', value: EPCIS_CONTEXT_IRI, digest: EPCIS_CONTEXT_DIGEST, pinned: true });
    expect(refs[1]).toMatchObject({ kind: 'inline', pinned: true });
    expect(refs[2]).toEqual({ kind: 'iri', value: 'https://example.org/other-context', pinned: false });
    expect(pinnedContextDigests([EPCIS_CONTEXT_IRI, 'https://example.org/other-context'])).toEqual({ digests: [EPCIS_CONTEXT_DIGEST], unpinned: ['https://example.org/other-context'] });
    expect(contextReferences(undefined)).toEqual([]);
  });

  it('builds and reads the source-reference extension a mapped SEAL carries', () => {
    const reference = epcisSourceReference({ sourceSha256: 'd'.repeat(64), mediaType: 'application/ld+json; charset=utf-8', pointer: '/epcisBody/eventList/2', eventId: 'urn:uuid:1', contextDigests: ['b'.repeat(64), 'a'.repeat(64)] });
    expect(reference).toEqual({ vocabularyUrn: 'urn:bsv:dpp:epcis-source:1', sourceDigest: 'd'.repeat(64), mediaType: 'application/ld+json', eventPointer: '/epcisBody/eventList/2', eventId: 'urn:uuid:1', contextDigests: ['a'.repeat(64), 'b'.repeat(64)], mappingProfile: 'epcis-vsc@1' });
    const seal = mapEpcisEvent(commissioning, MAPPING_OPTIONS());
    expect(readEpcisSourceReference(seal)).toBeUndefined();
    seal.extensions['+Dn']['urn:bsv:dpp:epcis-source:1'] = reference;
    expect(readEpcisSourceReference(seal)).toEqual(reference);
    expect(() => epcisSourceReference({ sourceSha256: 'x', mediaType: 'application/json', pointer: '', contextDigests: [] })).toThrow();
    expect(() => epcisSourceReference({ sourceSha256: 'd'.repeat(64), mediaType: 'application/xml', pointer: '', contextDigests: [] })).toThrow();
  });

  it('keeps the component identifiers apart from the pack across the two-stage transformation chain', () => {
    const [stageOne, stageTwo] = fiveEventList() as JsonObject[];
    expect(stageOne?.outputEPCList).toEqual(['urn:epc:id:sgtin:9521234.044444.MOD-1']);
    expect(stageTwo?.inputEPCList).toEqual(['urn:epc:id:sgtin:9521234.044444.MOD-1']);
    expect(stageTwo?.outputEPCList).toEqual([PACK]);
    expect((stageOne?.inputEPCList as string[]).includes(CELL_A)).toBe(true);
    expect(epcisEventBodyDigest(stageOne!, contexts)).not.toBe(epcisEventBodyDigest(stageTwo!, contexts));
  });
});
