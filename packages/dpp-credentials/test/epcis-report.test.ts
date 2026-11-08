import { describe, expect, it } from 'vitest';
import { CBV_DISPOSITION_CROSSWALK, EPCIS_TYPES, extractEpcisEvent, mapEpcisEvent, mapEpcisEventWithReport } from '../src/epcis.js';
import { EPCIS_SOURCE_VOCABULARY, epcisSourceReference, readEpcisSourceReference, validateEpcisDocument } from '../src/epcis-source.js';
import { validateSealStructure } from '../src/validation.js';
import type { JsonObject } from '../src/types.js';
import { ISSUER, NOW } from './fixtures.js';
import { ASSEMBLY_SITE, CELL_A, CELL_B, MAPPING_OPTIONS, OWNING_PARTY_B, PACK, PALLET, READ_POINT, T0, correctionEvents, epcisDocument, fiveEventList } from './epcis-fixture.js';

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

  it('refuses under epcis-vsc@1 an inspection, a repair or a sensor reading that reports active, as its maintenance-observation limit says', () => {
    const options = MAPPING_OPTIONS();
    const observation = (bizStep: string, disposition: string, extra: JsonObject = {}): JsonObject => ({ type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, epcList: [PACK], action: 'OBSERVE', bizStep, disposition, ...extra });
    for (const step of ['repairing', 'inspecting', 'sensor_reporting', 'urn:epcglobal:cbv:bizstep:repairing', 'https://ref.gs1.org/cbv/BizStep-inspecting']) {
      const report = mapEpcisEventWithReport(observation(step, 'active'), options);
      expect(report, step).toMatchObject({ profile: 'epcis-vsc@1', mapping: 'unsupported', unmapped: [] });
      expect(report.missing, step).toEqual([expect.stringMatching(/^maintenance-observation: /)]);
      expect(report.seal).toBeUndefined();
    }
    // A repair recorded as a transformation is a repair too.
    expect(mapEpcisEventWithReport({ type: 'TransformationEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, inputEPCList: [CELL_A], outputEPCList: [PACK], bizStep: 'repairing', disposition: 'active' }, options).mapping).toBe('unsupported');
    // A maintenance step that reports a custody state is a custody step, as the published vectors pin.
    expect(mapEpcisEventWithReport(observation('sensor_reporting', 'in_transit', { sensorElementList: [{ sensorReport: [{ type: 'Temperature', value: 4.5, uom: 'CEL' }] }] }), options)).toMatchObject({ mapping: 'transformed', unmapped: ['sensor-elements'] });
    expect(mapEpcisEventWithReport(observation('inspecting', 'in_transit'), options).mapping).toBe('lossless');
    // Other steps that report active are unchanged under epcis-vsc@1, and so is an ObjectEvent that commissions or decommissions its objects at a maintenance step: it is not an observation.
    expect(mapEpcisEventWithReport(observation('storing', 'active'), options).mapping).toBe('lossless');
    for (const action of ['ADD', 'DELETE']) expect(mapEpcisEventWithReport(observation('repairing', 'active', { action }), options).mapping, action).toBe('lossless');
    // The plain mapper is unchanged: it still builds the SEAL the report refuses.
    expect(mapEpcisEvent(observation('repairing', 'active'), options).eventVector.how.disposition).toBe('active');
  });
});

describe('mapEpcisEventWithReport under epcis-vsc@2', () => {
  const v2 = { profile: 'epcis-vsc@2' as const };
  const options = MAPPING_OPTIONS();
  const object = (action: string, disposition: string | undefined, bizStep = 'other', extra: JsonObject = {}): JsonObject => ({ type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, epcList: [PACK], action, bizStep, ...(disposition == null ? {} : { disposition }), ...extra });

  it('carries the five dispositions CBV shares with the VSC custody model verbatim, active only on an ObjectEvent that commissions its objects', () => {
    for (const [disposition, action] of [['active', 'ADD'], ['in_transit', 'OBSERVE'], ['returned', 'OBSERVE'], ['dispensed', 'OBSERVE'], ['destroyed', 'DELETE']] as const) {
      const report = mapEpcisEventWithReport(object(action, disposition), options, v2);
      expect(report, disposition).toMatchObject({ profile: 'epcis-vsc@2', mapping: 'lossless', missing: [] });
      expect(report.seal!.eventVector.how.disposition).toBe(disposition);
      expect(validateSealStructure(report.seal!, { requireProof: false }).valid).toBe(true);
    }
    for (const spelling of ['urn:epcglobal:cbv:disp:active', 'https://ref.gs1.org/cbv/Disp-active']) {
      const report = mapEpcisEventWithReport(object('ADD', spelling), options, v2);
      expect(report.seal!.eventVector.how.disposition).toBe('active');
      expect(extractEpcisEvent(report.seal!).disposition).toBe(spelling);
    }
  });

  it('classifies every CBV 2.0 disposition and refuses each one it cannot carry by the mapping limit it cites', () => {
    const carried = new Set(['active', 'in_transit', 'returned', 'dispensed', 'destroyed']);
    for (const [term, entry] of Object.entries(CBV_DISPOSITION_CROSSWALK)) {
      const report = mapEpcisEventWithReport(object('OBSERVE', term), options, v2);
      if (carried.has(term) && term !== 'active') { expect(report.mapping, term).toBe('lossless'); continue }
      expect(report.mapping, term).toBe('unsupported');
      const limit = entry.effect === 'unnamed-transition' ? 'custody-transition-unnamed' : 'custody-neutral';
      expect(report.missing, term).toEqual([expect.stringMatching(new RegExp(`^${limit}: `))]);
    }
    expect(Object.keys(CBV_DISPOSITION_CROSSWALK)).toHaveLength(38);
    expect(Object.entries(CBV_DISPOSITION_CROSSWALK).filter(([, e]) => e.replacedBy != null).map(([t]) => t)).toEqual(['non_sellable_expired', 'non_sellable_damaged', 'non_sellable_disposed', 'non_sellable_no_pedigree_match', 'non_sellable_recalled']);
  });

  it('refuses a maintenance observation as custody-neutral and maps a maintenance step that reports a custody state', () => {
    expect(mapEpcisEventWithReport(object('OBSERVE', 'active', 'repairing'), options, v2).missing).toEqual([expect.stringMatching(/^custody-neutral: disposition "active" on an ObjectEvent whose action is OBSERVE/)]);
    expect(mapEpcisEventWithReport(object('OBSERVE', 'in_progress', 'repairing'), options, v2).missing).toEqual([expect.stringMatching(/^custody-neutral: /)]);
    expect(mapEpcisEventWithReport(object('OBSERVE', 'conformant', 'inspecting'), options, v2).mapping).toBe('unsupported');
    expect(mapEpcisEventWithReport(object('OBSERVE', 'in_transit', 'inspecting'), options, v2).mapping).toBe('lossless');
    const sensor = fiveEventList()[6] as JsonObject;
    expect(mapEpcisEventWithReport(sensor, options, v2)).toMatchObject({ mapping: 'transformed', unmapped: ['extension:example:note', 'sensor-elements'] });
    // An origin needs an ObjectEvent that commissions its objects: active under OBSERVE or DELETE is refused, and so is the attribution case epcis-vsc@1 maps.
    expect(mapEpcisEventWithReport(object('DELETE', 'active'), options, v2).mapping).toBe('unsupported');
    expect(mapEpcisEventWithReport(object('OBSERVE', 'active', 'storing'), options, v2).mapping).toBe('unsupported');
    expect(mapEpcisEventWithReport(object('OBSERVE', 'active', 'storing'), options).mapping).toBe('lossless');
  });

  it('carries active only on an ObjectEvent that commissions its objects, and refuses a disposition its action contradicts', () => {
    const typed = (type: string, action: string | undefined, disposition: string, fields: JsonObject): JsonObject => ({ type, eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, ...(action == null ? {} : { action }), bizStep: 'other', disposition, ...fields });
    const others: Array<[string, string | undefined, JsonObject]> = [
      ['AggregationEvent', 'ADD', { parentID: PALLET, childEPCs: [PACK] }],
      ['AssociationEvent', 'ADD', { parentID: PACK, childEPCs: [CELL_A] }],
      ['TransactionEvent', 'ADD', { epcList: [PACK], bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000018:PO-77' }] }],
      ['TransformationEvent', undefined, { inputEPCList: [CELL_A], outputEPCList: [PACK] }],
    ];
    expect(mapEpcisEventWithReport(object('ADD', 'active', 'commissioning'), options, v2).seal!.eventVector.how.disposition).toBe('active');
    for (const [type, action, fields] of others) {
      expect(mapEpcisEventWithReport(typed(type, action, 'active', fields), options, v2).missing, type).toEqual([expect.stringMatching(/^custody-neutral: disposition "active" on an? (Aggregation|Association|Transaction|Transformation)Event/)]);
      // ADD on these types adds to an aggregation, association or transaction and leaves a transit state carried.
      expect(mapEpcisEventWithReport(typed(type, action, 'in_transit', fields), options, v2).seal?.eventVector.how.disposition, type).toBe('in_transit');
    }
    for (const disposition of ['in_transit', 'returned', 'dispensed', 'destroyed']) expect(mapEpcisEventWithReport(object('ADD', disposition, 'commissioning'), options, v2).missing, disposition).toEqual([expect.stringMatching(/^lifecycle-conflict: an ObjectEvent whose action is ADD/)]);
    for (const disposition of ['in_transit', 'returned']) expect(mapEpcisEventWithReport(object('DELETE', disposition, 'decommissioning'), options, v2).missing, disposition).toEqual([expect.stringMatching(/^lifecycle-conflict: an ObjectEvent whose action is DELETE/)]);
    for (const disposition of ['dispensed', 'destroyed']) expect(mapEpcisEventWithReport(object('DELETE', disposition, 'destroying'), options, v2).mapping, disposition).toBe('lossless');
    expect(mapEpcisEventWithReport(typed('AggregationEvent', 'DELETE', 'in_transit', { parentID: PALLET, childEPCs: [PACK] }), options, v2).seal?.eventVector.how.disposition).toBe('in_transit');
    // The association of the five-event document reports active for a pack its commissioning event already opened.
    expect(mapEpcisEventWithReport(fiveEventList()[3] as JsonObject, options, v2).missing).toEqual([expect.stringMatching(/^custody-neutral: /)]);
  });

  it('refuses an event that carries an error declaration, which epcis-vsc@1 maps with the loss named', () => {
    const { declared, corrective, orphanDeclared } = correctionEvents();
    for (const e of [declared, orphanDeclared]) {
      expect(mapEpcisEventWithReport(e, options, v2)).toMatchObject({ mapping: 'unsupported', unmapped: [], missing: [expect.stringMatching(/^error-declaration: /)] });
      expect(mapEpcisEventWithReport(e, options, v2).seal).toBeUndefined();
    }
    expect(mapEpcisEventWithReport(declared, options)).toMatchObject({ mapping: 'transformed', unmapped: ['error-declaration'] });
    expect(mapEpcisEventWithReport(corrective, options, v2).seal!.eventVector.how.disposition).toBe('returned');
  });

  it('names a hand-over at the destination that no CBV disposition carries', () => {
    for (const [step, disposition] of [['receiving', 'in_progress'], ['receiving', 'sellable_not_accessible'], ['urn:epcglobal:cbv:bizstep:receiving', undefined], ['accepting', 'active']] as const) {
      expect(mapEpcisEventWithReport(object('OBSERVE', disposition, step), options, v2).missing, `${step} ${disposition}`).toEqual([expect.stringMatching(/^custody-destination-unnamed: /)]);
    }
    expect(mapEpcisEventWithReport(object('OBSERVE', 'returned', 'receiving'), options, v2).mapping).toBe('lossless');
    expect(mapEpcisEventWithReport(object('OBSERVE', 'retail_sold', 'receiving'), options, v2).missing).toEqual([expect.stringMatching(/^custody-transition-unnamed: /)]);
  });

  it('refuses a disposition outside CBV 2.0, the four VSC-only terms among them, and never writes one', () => {
    for (const disposition of ['stored', 'transshipped', 'transformed', 'received', 'urn:epcglobal:cbv:disp:received', 'urn:epcglobal:cbv:disp:sold', 'https://example.org/disp/sold', 'Active']) {
      expect(mapEpcisEventWithReport(object('OBSERVE', disposition), options, v2).missing, disposition).toEqual([expect.stringMatching(/^non-cbv-disposition: /)]);
      expect(mapEpcisEventWithReport(object('OBSERVE', disposition), options).mapping, disposition).toBe(['stored', 'transshipped', 'transformed', 'received', 'urn:epcglobal:cbv:disp:received'].includes(disposition) ? 'lossless' : 'unsupported');
    }
  });

  it('refuses an OBSERVE event without a disposition as custody-neutral and keeps an ADD or DELETE without one insufficient', () => {
    expect(mapEpcisEventWithReport(object('OBSERVE', undefined, 'inspecting'), options, v2)).toMatchObject({ mapping: 'unsupported', missing: [expect.stringMatching(/^custody-neutral: an OBSERVE event without a disposition/)] });
    expect(mapEpcisEventWithReport(object('OBSERVE', undefined, 'inspecting'), options)).toMatchObject({ mapping: 'insufficient-data', missing: ['disposition'] });
    for (const action of ['ADD', 'DELETE']) expect(mapEpcisEventWithReport(object(action, undefined), options, v2)).toMatchObject({ mapping: 'insufficient-data', missing: ['disposition'] });
  });

  it('decides the event type and the action before the crosswalk, and the remaining checks after it, as epcis-vsc@1 does', () => {
    expect(mapEpcisEventWithReport({ ...object('OBSERVE', 'conformant'), type: 'example:MaintenanceEvent' }, options, v2).missing).toEqual([expect.stringContaining('outside the five types')]);
    const { transformationAction: _t, ...undecided } = options;
    expect(mapEpcisEventWithReport({ type: 'TransformationEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, inputEPCList: [CELL_A], outputEPCList: [PACK], bizStep: 'repairing', disposition: 'in_progress' }, undecided, v2).missing).toEqual(['a TransformationEvent has no action; the mapping decision transformationAction was not supplied']);
    expect(mapEpcisEventWithReport(object('UPSERT', 'in_transit'), options, v2).missing).toEqual(['action "UPSERT" is not ADD, OBSERVE or DELETE']);
    expect(mapEpcisEventWithReport({ ...object('ADD', 'active'), eventTime: undefined } as unknown as JsonObject, options, v2)).toMatchObject({ mapping: 'insufficient-data', missing: ['eventTime'] });
    expect(mapEpcisEventWithReport(object('ADD', 'active', 'commissioning', { epcList: ['did:web:products.example:item:1'] }), options, v2).mapping).toBe('unsupported');
  });

  it('binds the source reference to the profile the report is made under', () => {
    const event = fiveEventList()[2] as JsonObject;
    const v2Reference = epcisSourceReference({ sourceSha256: 'e'.repeat(64), mediaType: 'application/ld+json', pointer: '/epcisBody/eventList/2', contextDigests: ['f'.repeat(64)], mappingProfile: 'epcis-vsc@2' });
    const report = mapEpcisEventWithReport(event, options, { ...v2, sourceReference: v2Reference });
    expect(report.mapping).toBe('lossless');
    expect(readEpcisSourceReference(report.seal!)?.mappingProfile).toBe('epcis-vsc@2');
    expect(() => mapEpcisEventWithReport(event, options, { ...v2, sourceReference: reference })).toThrow(/mapping profile/);
    expect(() => mapEpcisEventWithReport(event, options, { sourceReference: v2Reference })).toThrow(/mapping profile/);
    expect(() => mapEpcisEventWithReport(event, options, { profile: 'epcis-vsc@3' as never })).toThrow(/not one this package implements/);
  });

  it('keeps the epcis-vsc@1 losses and attribution: parties stay in the extension and the issuer is the actor', () => {
    const event: JsonObject = object('OBSERVE', 'in_transit', 'shipping', { bizLocation: { id: ASSEMBLY_SITE }, sourceList: [{ type: 'owning_party', source: OWNING_PARTY_B }] });
    const report = mapEpcisEventWithReport(event, options, v2);
    expect(report).toMatchObject({ mapping: 'transformed', unmapped: ['source-destination-parties'] });
    expect(report.seal!.eventVector.who.actorDid).toBe(ISSUER);
    expect(JSON.stringify(report.seal!.eventVector.who)).not.toContain(OWNING_PARTY_B);
  });
});
