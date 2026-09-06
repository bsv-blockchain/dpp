import { describe, expect, it } from 'vitest';
import { EPCIS_TYPES, extractEpcisEvent, mapEpcisEvent, mapEpcisEventWithReport } from '../src/epcis.js';
import { EPCIS_SOURCE_VOCABULARY, epcisSourceReference, readEpcisSourceReference, validateEpcisDocument } from '../src/epcis-source.js';
import { validateSealStructure } from '../src/validation.js';
import type { JsonObject } from '../src/types.js';
import { ISSUER, NOW } from './fixtures.js';
import { ASSEMBLY_SITE, CELL_A, CELL_B, MAPPING_OPTIONS, OWNING_PARTY_B, PACK, PALLET, READ_POINT, T0, epcisDocument, fiveEventList } from './epcis-fixture.js';

const reference = epcisSourceReference({ sourceSha256: 'e'.repeat(64), mediaType: 'application/ld+json', pointer: '/epcisBody/eventList/2', eventId: 'urn:uuid:00000000-0000-4000-8000-000000000003', contextDigests: ['f'.repeat(64)] });

describe('mapEpcisEventWithReport', () => {
  it('maps the commissioning ObjectEvent losslessly into a structurally valid unsigned SEAL carrying the source reference beside the round-trip event', () => {
    const event = fiveEventList()[2] as JsonObject;
    const report = mapEpcisEventWithReport(event, { ...MAPPING_OPTIONS(), id: 'urn:uuid:00000000-0000-4000-8000-0000000000f2' }, { sourceReference: reference });
    expect(report.mapping).toBe('lossless');
    expect(report.missing).toEqual([]);
    expect(report.unmapped).toEqual([]);
    expect(report.preserved.sort()).toEqual(['action', 'bizLocation', 'bizStep', 'disposition', 'epcList', 'eventID', 'eventTime', 'eventTimeZoneOffset', 'readPoint', 'recordTime']);
    const seal = report.seal!;
    expect(validateSealStructure(seal, { requireProof: false }).valid).toBe(true);
    expect(seal.proof).toBeUndefined();
    expect(readEpcisSourceReference(seal)).toEqual(reference);
    expect(extractEpcisEvent(seal)).toEqual(event);
    expect(seal.eventVector.what.productIdentifiers).toEqual([{ scheme: 'EPC', value: PACK, schemeAuthority: 'GS1' }]);
    expect(seal.eventVector.where).toEqual({ jurisdiction: 'AU', readPoint: { id: READ_POINT }, businessLocation: { id: ASSEMBLY_SITE } });
    expect(seal.eventVector.when).toEqual({ eventTime: T0, recordedAt: '2026-03-02T09:00:00.000Z', timezone: '+00:00', timePrecision: 'millisecond' });
  });

  it('keeps mapEpcisEvent exactly as it was: the report wrapper adds nothing to a mapping made without a source reference', () => {
    const event = fiveEventList()[2] as JsonObject;
    const options = { ...MAPPING_OPTIONS(), id: 'urn:uuid:00000000-0000-4000-8000-0000000000f2' };
    expect(mapEpcisEventWithReport(event, options).seal).toEqual(mapEpcisEvent(event, options));
  });

  it.each(EPCIS_TYPES)('round-trips a %s through the report and preserves every source member', (type) => {
    const ids = [PACK];
    const fields: JsonObject = type === 'TransformationEvent' ? { inputEPCList: [CELL_A], outputEPCList: ids } : type === 'AssociationEvent' || type === 'AggregationEvent' ? { parentID: PALLET, childEPCs: ids } : type === 'TransactionEvent' ? { bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000018:PO-1' }], epcList: ids } : { epcList: ids };
    const event: JsonObject = { type, ...fields, eventTime: NOW, eventTimeZoneOffset: '+00:00', recordTime: NOW, action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit', 'example:custom': { nested: ['preserved', 5] } };
    const report = mapEpcisEventWithReport(event, MAPPING_OPTIONS());
    expect(report.mapping).toBe('transformed');
    expect(report.unmapped).toContain('extension:example:custom');
    expect(extractEpcisEvent(report.seal!)).toEqual(event);
  });

  it('names every loss: parties, transactions, sensors, quantities, a caller-decided transformation action, event-level context and multi-product events', () => {
    const [stageOne, stageTwo, , association, aggregation, transaction, sensor] = fiveEventList() as JsonObject[];
    const options = MAPPING_OPTIONS();
    expect(mapEpcisEventWithReport(stageOne!, options)).toMatchObject({ mapping: 'unsupported', missing: [expect.stringContaining('disposition "in_progress"')] });
    const stageTwoActive = { ...stageTwo!, disposition: 'active' };
    expect(mapEpcisEventWithReport(stageTwoActive, options)).toMatchObject({ mapping: 'transformed', unmapped: ['multi-product-event', 'quantities', 'transformation-action-decision', 'transformation-id'] });
    expect(mapEpcisEventWithReport(association!, options)).toMatchObject({ mapping: 'transformed', unmapped: ['multi-product-event'] });
    expect(mapEpcisEventWithReport(aggregation!, options)).toMatchObject({ mapping: 'transformed', unmapped: ['multi-product-event'] });
    expect(mapEpcisEventWithReport(transaction!, options)).toMatchObject({ mapping: 'transformed', unmapped: ['business-transactions', 'source-destination-parties'] });
    expect(mapEpcisEventWithReport(sensor!, options)).toMatchObject({ mapping: 'transformed', unmapped: ['extension:example:note', 'sensor-elements'] });
    expect(mapEpcisEventWithReport({ ...sensor!, '@context': ['https://example.org/ctx'] }, options).unmapped).toContain('event-level-context');
  });

  it('keeps grouping apart from association: the same children under a container and under a product map to distinct SEALs whose extensions carry the distinct event types', () => {
    const [, , , association, aggregation] = fiveEventList() as JsonObject[];
    const a = mapEpcisEventWithReport(association!, { ...MAPPING_OPTIONS(), id: 'urn:uuid:a' }).seal!;
    const g = mapEpcisEventWithReport(aggregation!, { ...MAPPING_OPTIONS(), id: 'urn:uuid:g' }).seal!;
    expect(a.eventVector.how.eventType).toBe('AssociationEvent');
    expect(g.eventVector.how.eventType).toBe('AggregationEvent');
    expect(extractEpcisEvent(a).parentID).toBe(PACK);
    expect(extractEpcisEvent(g).parentID).toBe(PALLET);
    expect(a.eventVector.what.productIdentifiers.map((p) => p.value)).toEqual([CELL_A, CELL_B, PACK]);
    expect(g.eventVector.what.productIdentifiers.map((p) => p.value)).toEqual([PACK, PALLET]);
  });

  it('constructs a TransactionEvent independently of the lifecycle document and maps it with its transaction preserved', () => {
    const event: JsonObject = { type: 'TransactionEvent', eventTime: T0, eventTimeZoneOffset: '+10:00', recordTime: T0, bizTransactionList: [{ type: 'inv', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000018:INV-9' }], epcList: [PACK], action: 'ADD', bizStep: 'retail_selling', disposition: 'active' };
    expect(validateEpcisDocument(epcisDocument([event])).schema).toBe('pass');
    const report = mapEpcisEventWithReport(event, MAPPING_OPTIONS());
    expect(report.mapping).toBe('transformed');
    expect(report.unmapped).toEqual(['business-transactions']);
    expect(report.seal!.eventVector.when.timezone).toBe('+10:00');
    expect(extractEpcisEvent(report.seal!).bizTransactionList).toEqual(event.bizTransactionList);
  });

  it('returns insufficient-data with the missing inputs named, and never fabricates them', () => {
    const options = MAPPING_OPTIONS();
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', epcList: [PACK], action: 'OBSERVE', bizStep: 'inspecting' }, options)).toMatchObject({ mapping: 'insufficient-data', missing: ['disposition'], unmapped: [] });
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', epcList: [PACK], action: 'OBSERVE' }, options)).toMatchObject({ mapping: 'insufficient-data', missing: ['eventTime', 'eventTimeZoneOffset', 'bizStep', 'disposition'] });
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', epcList: [], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active' }, options)).toMatchObject({ mapping: 'insufficient-data', missing: ['no product identifier the profile carries'] });
    const { recordedAt: _r, ...withoutRecordedAt } = options as typeof options & { recordedAt?: string };
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', epcList: [PACK], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active' }, withoutRecordedAt)).toMatchObject({ mapping: 'insufficient-data', missing: ['recordTime, and no recordedAt was supplied'] });
  });

  it('returns unsupported for an extension event type, an undecided transformation action, an unsupported action and an identifier scheme the profile does not carry', () => {
    const options = MAPPING_OPTIONS();
    const base: JsonObject = { eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, bizStep: 'inspecting', disposition: 'active' };
    expect(mapEpcisEventWithReport({ type: 'example:MaintenanceEvent', ...base, epcList: [PACK], action: 'OBSERVE' }, options)).toMatchObject({ mapping: 'unsupported', missing: [expect.stringContaining('outside the five types')] });
    const { transformationAction: _t, ...undecided } = options;
    expect(mapEpcisEventWithReport({ type: 'TransformationEvent', ...base, inputEPCList: [CELL_A], outputEPCList: [PACK] }, undecided)).toMatchObject({ mapping: 'unsupported', missing: ['a TransformationEvent has no action; the mapping decision transformationAction was not supplied'] });
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', ...base, epcList: [PACK], action: 'UPSERT' }, options)).toMatchObject({ mapping: 'unsupported', missing: ['action "UPSERT" is not ADD, OBSERVE or DELETE'] });
    expect(mapEpcisEventWithReport({ type: 'ObjectEvent', ...base, epcList: ['did:web:products.example:item:1'], action: 'ADD' }, options)).toMatchObject({ mapping: 'unsupported' });
  });

  it('attributes the SEAL to the configured issuer, never to a party or location the event names', () => {
    const event: JsonObject = { type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, epcList: [PACK], action: 'OBSERVE', bizStep: 'storing', disposition: 'active', bizLocation: { id: ASSEMBLY_SITE }, sourceList: [{ type: 'owning_party', source: OWNING_PARTY_B }] };
    const seal = mapEpcisEventWithReport(event, MAPPING_OPTIONS()).seal!;
    expect(seal.issuer).toBe(ISSUER);
    expect(seal.eventVector.who.actorDid).toBe(ISSUER);
    expect(JSON.stringify(seal.eventVector.who)).not.toContain(OWNING_PARTY_B);
    expect(seal.eventVector.where.businessLocation).toEqual({ id: ASSEMBLY_SITE });
  });

  it('refuses a source reference under another vocabulary and passes validation findings through', () => {
    const event = fiveEventList()[2] as JsonObject;
    const validation = validateEpcisDocument(epcisDocument([event]));
    const report = mapEpcisEventWithReport(event, MAPPING_OPTIONS(), { validation });
    expect(report.validation).toBe(validation);
    expect(() => mapEpcisEventWithReport(event, MAPPING_OPTIONS(), { sourceReference: { ...reference, vocabularyUrn: 'urn:other' } as never })).toThrow(/epcis-source vocabulary/);
    expect(EPCIS_SOURCE_VOCABULARY).toBe('urn:bsv:dpp:epcis-source:1');
  });
});
