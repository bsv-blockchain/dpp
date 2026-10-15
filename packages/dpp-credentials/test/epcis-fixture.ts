/**
 * The neutral EPCIS fixtures of the epcis-json@1 and epcis-vsc@1 profiles,
 * and the generator of fixtures/vectors/dpp/interoperability/epcis/v1.json.
 * Every identifier is synthetic: the GS1 demonstration prefix 952, example.org
 * hosts, did:web:issuer.example issuers. Nothing here was copied from any
 * published event source; the shapes exercise the profile's rules, not a
 * vendor's encoding.
 */
import {
  EPCIS_CONTEXT_DIGEST,
  EPCIS_CONTEXT_IRI,
  classifyEventArrival,
  epcisEventBodyDigest,
  epcisSourceReference,
  localEventIdentity,
  parseEpcisSource,
  pinnedContextDigests,
  unresolvedCorrections,
  validateEpcisDocument,
  type EpcisLimits,
} from '../src/epcis-source.js';
import { mapEpcisEventWithReport } from '../src/epcis.js';
import { validateSealStructure } from '../src/validation.js';
import type { JsonObject, Seal } from '../src/types.js';
import { ISSUER, unsignedSeal } from './fixtures.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/* Identifiers under the demonstration prefix 952. */
export const PREFIX = '9521234';
export const PACK = 'urn:epc:id:sgtin:9521234.012345.SER1';
export const PACK_LINK = 'https://id.example.org/01/09521234123453/21/SER1';
export const CELL_A = 'urn:epc:id:sgtin:9521234.022222.CELL-A';
export const CELL_B = 'urn:epc:id:sgtin:9521234.022222.CELL-B';
export const MODULE = 'urn:epc:id:sgtin:9521234.044444.MOD-1';
export const ELECTROLYTE_LOT = 'urn:epc:class:lgtin:9521234.033333.LOT7';
export const SCRAP_CLASS = 'urn:epc:idpat:sgtin:9521234.055555.*';
export const PALLET = 'urn:epc:id:sscc:9521234.0000000001';
export const READ_POINT = 'urn:epc:id:sgln:9521234.00001.0';
export const ASSEMBLY_SITE = 'urn:epc:id:sgln:9521234.00002.0';
export const OWNING_PARTY_A = 'urn:epc:id:pgln:9521234.00003';
export const OWNING_PARTY_B = 'urn:epc:id:pgln:9521234.00004';
export const INLINE_CONTEXT = { example: 'https://example.org/vocab/' };
export const DOCUMENT_CONTEXT = [EPCIS_CONTEXT_IRI, INLINE_CONTEXT];
export const T0 = '2026-03-02T08:00:00.000Z';

const event = (type: string, fields: JsonObject, time = T0): JsonObject => ({
  type,
  eventTime: time,
  eventTimeZoneOffset: '+00:00',
  recordTime: '2026-03-02T09:00:00.000Z',
  ...fields,
});

/** Five event types, a two-stage transformation chain, grouping versus association, parties, sensors and an event without an eventID. */
export function fiveEventList(): JsonObject[] {
  return [
    event('TransformationEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000001', inputEPCList: [CELL_A, CELL_B], outputEPCList: [MODULE], bizStep: 'assembling', disposition: 'in_progress', readPoint: { id: READ_POINT }, bizLocation: { id: ASSEMBLY_SITE }, transformationID: 'urn:example:transformation:stage-1' }, '2026-03-01T08:00:00.000Z'),
    event('TransformationEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000002', inputEPCList: [MODULE], inputQuantityList: [{ epcClass: ELECTROLYTE_LOT, quantity: 4, uom: 'EA' }], outputEPCList: [PACK], outputQuantityList: [{ epcClass: SCRAP_CLASS, quantity: 0.5, uom: 'KGM' }], bizStep: 'assembling', disposition: 'in_progress', readPoint: { id: READ_POINT }, bizLocation: { id: ASSEMBLY_SITE }, transformationID: 'urn:example:transformation:stage-2' }, '2026-03-01T12:00:00.000Z'),
    event('ObjectEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000003', epcList: [PACK], action: 'ADD', bizStep: 'commissioning', disposition: 'active', readPoint: { id: READ_POINT }, bizLocation: { id: ASSEMBLY_SITE } }),
    event('AssociationEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000004', parentID: PACK, childEPCs: [CELL_A, CELL_B], action: 'ADD', bizStep: 'installing', disposition: 'active', readPoint: { id: READ_POINT } }, '2026-03-02T08:30:00.000Z'),
    event('AggregationEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000005', parentID: PALLET, childEPCs: [PACK], action: 'ADD', bizStep: 'packing', disposition: 'in_transit', readPoint: { id: READ_POINT } }, '2026-03-02T09:00:00.000Z'),
    event('TransactionEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-000000000006', bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000018:PO-77' }], epcList: [PACK], action: 'ADD', bizStep: 'shipping', disposition: 'in_transit', readPoint: { id: READ_POINT }, sourceList: [{ type: 'owning_party', source: OWNING_PARTY_A }], destinationList: [{ type: 'owning_party', destination: OWNING_PARTY_B }] }, '2026-03-02T10:00:00.000Z'),
    event('ObjectEvent', { epcList: [PACK], action: 'OBSERVE', bizStep: 'sensor_reporting', disposition: 'in_transit', sensorElementList: [{ sensorMetadata: { time: '2026-03-03T06:00:00.000Z', deviceID: 'urn:epc:id:giai:9521234.SENSOR-1' }, sensorReport: [{ type: 'Temperature', value: 27.5, uom: 'CEL' }] }], 'example:note': 'temperature observed in transit' }, '2026-03-03T06:00:00.000Z'),
  ];
}

export function epcisDocument(eventList: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    '@context': DOCUMENT_CONTEXT,
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: '2026-03-03T07:00:00.000Z',
    ...extra,
    epcisBody: { eventList },
  };
}

export function epcisQueryDocument(eventList: JsonObject[]): JsonObject {
  return {
    '@context': [EPCIS_CONTEXT_IRI],
    type: 'EPCISQueryDocument',
    schemaVersion: '2.0',
    creationDate: '2026-03-03T07:00:00.000Z',
    epcisBody: { queryResults: { queryName: 'SimpleEventQuery', resultsBody: { eventList } } },
  };
}

/** A declared error and the corrective event that replaces it, plus a declaration whose corrective event is not supplied. */
export function correctionEvents(): { declared: JsonObject; corrective: JsonObject; orphanDeclared: JsonObject } {
  const declared = event('ObjectEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-00000000000a', epcList: [PACK], action: 'OBSERVE', bizStep: 'receiving', disposition: 'in_transit', readPoint: { id: READ_POINT }, errorDeclaration: { declarationTime: '2026-03-04T10:00:00.000Z', reason: 'incorrect_data', correctiveEventIDs: ['urn:uuid:00000000-0000-4000-8000-00000000000b'] } }, '2026-03-04T08:00:00.000Z');
  const corrective = event('ObjectEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-00000000000b', epcList: [PACK], action: 'OBSERVE', bizStep: 'receiving', disposition: 'returned', readPoint: { id: READ_POINT } }, '2026-03-04T08:00:00.000Z');
  const orphanDeclared = event('ObjectEvent', { eventID: 'urn:uuid:00000000-0000-4000-8000-00000000000c', epcList: [PACK], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active', errorDeclaration: { declarationTime: '2026-03-05T10:00:00.000Z', reason: 'did_not_occur', correctiveEventIDs: ['urn:uuid:00000000-0000-4000-8000-00000000000d'] } }, '2026-03-05T08:00:00.000Z');
  return { declared, corrective, orphanDeclared };
}

/** A document the pinned schema rejects (an ObjectEvent without its action, a zone offset the pattern refuses) that is still safe to retain. */
export function schemaInvalidDocument(): JsonObject {
  return epcisDocument([{ type: 'ObjectEvent', eventID: 'urn:uuid:00000000-0000-4000-8000-000000000021', eventTime: T0, eventTimeZoneOffset: '+0:00', epcList: [PACK], bizStep: 'commissioning', disposition: 'active' }]);
}

/** The bytes of a transport that must be refused before anything is retained. */
export function refusedTransports(): Array<{ id: string; description: string; bytes: Uint8Array; reason: string; limits?: Partial<EpcisLimits> }> {
  const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth);
  return [
    { id: 'refuse-duplicate-key', description: 'A member name repeated within one object is refused before parsing, whatever the values.', bytes: utf8('{"type":"EPCISDocument","schemaVersion":"2.0","type":"EPCISDocument"}'), reason: 'duplicate-key' },
    { id: 'refuse-malformed-utf8', description: 'A byte sequence that is not well-formed UTF-8 is refused before parsing.', bytes: new Uint8Array([0x7b, 0x22, 0x74, 0x79, 0x70, 0x65, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), reason: 'malformed-utf8' },
    { id: 'refuse-depth', description: 'A container nested past the depth limit (64) is refused.', bytes: utf8(`{"type":"EPCISDocument","a":${nested(65)}}`), reason: 'depth' },
    { id: 'refuse-non-finite-number', description: 'A number literal a double cannot carry (here one that overflows to infinity) is refused.', bytes: utf8('{"type":"EPCISDocument","value":1e999}'), reason: 'unsafe-number' },
    { id: 'refuse-precision-loss', description: 'A number literal whose decimal digits a double cannot carry exactly is refused rather than silently rounded.', bytes: utf8('{"type":"EPCISDocument","value":9007199254740993}'), reason: 'unsafe-number' },
    { id: 'refuse-oversized', description: 'A document over the byte limit is refused; the limit here is lowered to 64 bytes so the vector stays small.', bytes: utf8(JSON.stringify(epcisDocument([]))), reason: 'oversized', limits: { maxDocumentBytes: 64 } },
    { id: 'refuse-too-many-events', description: 'More events than the per-document limit (lowered to 2 here) is refused; a larger source is split, never truncated.', bytes: utf8(JSON.stringify(epcisDocument(fiveEventList().slice(0, 3)))), reason: 'too-many-events', limits: { maxEventsPerPage: 2 } },
    { id: 'refuse-unsupported-media-type', description: 'An XML media type is refused by name; this profile reads JSON and JSON-LD only.', bytes: utf8('<epcis/>'), reason: 'unsupported-media-type' },
  ];
}

export const MAPPING_OPTIONS = () => {
  const base = unsignedSeal();
  return { issuer: ISSUER, assertionMethod: `${ISSUER}#ed`, actorRole: 'manufacturer', jurisdiction: 'AU', issuedAt: T0, credentialStatus: base.credentialStatus, chainOfCustody: base.chainOfCustody, transformationAction: 'ADD' as const };
};

export function contextDigestsOf(document: JsonObject): string[] {
  return pinnedContextDigests(document['@context']).digests;
}

/**
 * The published vector file: parse outcomes, digests, arrival rules,
 * validation findings and mapping outcomes for every fixture above, in the
 * stack's vector format, generated so the file cannot drift from the code.
 */
export function epcisInteroperabilityVectors(): Record<string, unknown> {
  const vectors: Array<Record<string, unknown>> = [];
  const documentBytes = utf8(JSON.stringify(epcisDocument(fiveEventList()), null, 2) + '\n');
  const parsed = parseEpcisSource(documentBytes, { mediaType: 'application/ld+json' });
  if (!parsed.ok) throw new Error(parsed.detail);
  const contextDigests = contextDigestsOf(parsed.document);
  const validation = validateEpcisDocument(parsed.document, { events: parsed.events });
  vectors.push({
    id: 'five-event-document',
    description: 'A neutral EPCISDocument carrying a two-stage TransformationEvent chain, a commissioning ObjectEvent, an AssociationEvent (component membership), an AggregationEvent (shipping container), a separately constructed TransactionEvent with parties, and a sensor observation without an eventID. Parsed under the default limits, validated against the pinned 2.0.1 schema, every event digested and identified.',
    input: { media_type: 'application/ld+json', document: JSON.parse(new TextDecoder().decode(documentBytes)) },
    expected: {
      accepted: true,
      sha256_hex: parsed.sha256,
      envelope: parsed.envelope,
      schema: validation.schema,
      finding_codes: validation.findings.map((f) => f.code),
      context_digests_hex: contextDigests,
      events: parsed.events.map((e) => {
        const record = ((parsed.document.epcisBody as JsonObject).eventList as JsonObject[])[e.index] as JsonObject;
        const entry = validation.events.find((v) => v.pointer === e.pointer);
        return {
          pointer: e.pointer,
          type: e.type,
          identity_kind: e.identityKind,
          ...(e.eventId == null ? { local_identity: e.localIdentity } : { event_id: e.eventId }),
          body_digest_hex: epcisEventBodyDigest(record, contextDigests),
          identifiers: entry?.identifiers.map((i) => ({ path: i.path, scheme: i.scheme, ...(i.gtin == null ? {} : { gtin: i.gtin }), ...(i.serial == null ? {} : { serial: i.serial }), ...(i.lot == null ? {} : { lot: i.lot }), ...(i.problem == null ? {} : { problem: i.problem }) })),
          preserved_extensions: entry?.preservedExtensions,
        };
      }),
    },
    tags: ['epcis', 'happy-path'],
  });

  const queryBytes = utf8(JSON.stringify(epcisQueryDocument(fiveEventList().slice(2, 4))));
  const query = parseEpcisSource(queryBytes, { mediaType: 'application/json' });
  if (!query.ok) throw new Error(query.detail);
  vectors.push({
    id: 'query-document-page',
    description: 'One page of a standard query result: the same events under the EPCISQueryDocument envelope, located at the query result pointer.',
    input: { media_type: 'application/json', document: JSON.parse(new TextDecoder().decode(queryBytes)) },
    expected: { accepted: true, sha256_hex: query.sha256, envelope: query.envelope, event_pointers: query.events.map((e) => e.pointer), schema: validateEpcisDocument(query.document, { events: query.events }).schema },
    tags: ['epcis', 'happy-path'],
  });

  const commissioning = fiveEventList()[2] as JsonObject;
  const reordered: JsonObject = Object.fromEntries(Object.entries(commissioning).reverse());
  const changed: JsonObject = { ...commissioning, disposition: 'in_transit' };
  const observed: JsonObject = { ...commissioning, recordTime: '2026-03-09T00:00:00.000Z', errorDeclaration: { declarationTime: '2026-03-09T00:00:00.000Z', reason: 'incorrect_data', correctiveEventIDs: [] } };
  const digest = (e: JsonObject) => epcisEventBodyDigest(e, contextDigests);
  const observation = (e: JsonObject) => ({ identity: String(e.eventID), bodyDigest: digest(e), ...(typeof e.recordTime === 'string' ? { recordTime: e.recordTime } : {}), ...(e.errorDeclaration == null ? {} : { errorDeclaration: e.errorDeclaration }) });
  vectors.push({
    id: 'event-body-digest-and-arrival',
    description: 'The canonical event-body digest ignores formatting and member order, excludes recordTime and errorDeclaration, and includes the sorted context digests; a changed recordTime or error declaration is a new observation, a changed body is a conflict.',
    input: { context_digests_hex: contextDigests, event: commissioning, reordered_spelling: reordered, changed_body: changed, later_observation: observed },
    expected: {
      body_digest_hex: digest(commissioning),
      reordered_spelling_digest_hex: digest(reordered),
      changed_body_digest_hex: digest(changed),
      later_observation_digest_hex: digest(observed),
      arrival_reordered: classifyEventArrival(observation(commissioning), observation(reordered)),
      arrival_changed_body: classifyEventArrival(observation(commissioning), observation(changed)),
      arrival_later_observation: classifyEventArrival(observation(commissioning), observation(observed)),
    },
    tags: ['epcis', 'happy-path'],
  });

  const sensor = fiveEventList()[6] as JsonObject;
  vectors.push({
    id: 'local-identity-without-event-id',
    description: 'An event without an eventID is valid EPCIS; its local ingestion identity is derived from the source digest and the event pointer, labelled local and never inserted into the source.',
    input: { source_sha256_hex: parsed.sha256, pointer: '/epcisBody/eventList/6', event: sensor },
    expected: { local_identity: localEventIdentity(parsed.sha256, '/epcisBody/eventList/6'), event_unchanged: sensor },
    tags: ['epcis', 'happy-path'],
  });

  const { declared, corrective, orphanDeclared } = correctionEvents();
  const withCorrection = epcisDocument([declared, corrective]);
  const withOrphan = epcisDocument([orphanDeclared]);
  const correctionValidation = validateEpcisDocument(withCorrection);
  const orphanValidation = validateEpcisDocument(withOrphan);
  vectors.push({
    id: 'error-declaration-resolved-and-unresolved',
    description: 'An error declaration is retained with its corrective event references; when the corrective event is held the declaration is resolved, when it is absent it stays unresolved. Neither is a VSC correction or an authority grant.',
    input: { with_corrective_event: withCorrection, with_absent_corrective_event: withOrphan },
    expected: {
      with_corrective_event_schema: correctionValidation.schema,
      resolved_unresolved: unresolvedCorrections(correctionValidation, new Set([String(declared.eventID), String(corrective.eventID)])),
      absent_unresolved: unresolvedCorrections(orphanValidation, new Set([String(orphanDeclared.eventID)])),
    },
    tags: ['epcis', 'error-case'],
  });

  const invalidBytes = utf8(JSON.stringify(schemaInvalidDocument()));
  const invalid = parseEpcisSource(invalidBytes, { mediaType: 'application/json' });
  if (!invalid.ok) throw new Error(invalid.detail);
  const invalidValidation = validateEpcisDocument(invalid.document, { events: invalid.events });
  vectors.push({
    id: 'schema-invalid-safe-transport',
    description: 'A document the pinned schema rejects (no action on an ObjectEvent, a malformed zone offset) is safe to parse and is retained with failed findings; it is never publishable on that basis and never repaired.',
    input: { media_type: 'application/json', document: JSON.parse(new TextDecoder().decode(invalidBytes)) },
    expected: { accepted: true, retained: true, sha256_hex: invalid.sha256, schema: invalidValidation.schema, finding_paths: invalidValidation.findings.map((f) => f.path).filter((p, i, all) => all.indexOf(p) === i) },
    tags: ['epcis', 'error-case'],
  });

  for (const refusal of refusedTransports()) {
    const mediaType = refusal.id === 'refuse-unsupported-media-type' ? 'application/xml' : 'application/json';
    const result = parseEpcisSource(refusal.bytes, { mediaType, ...(refusal.limits == null ? {} : { limits: refusal.limits }) });
    vectors.push({
      id: refusal.id,
      description: refusal.description,
      input: { bytes_hex: Buffer.from(refusal.bytes).toString('hex'), media_type: mediaType, ...(refusal.limits == null ? {} : { limits: refusal.limits }) },
      expected: { accepted: false, reason: result.ok ? 'accepted' : result.reason },
      tags: ['epcis', 'error-case'],
    });
  }

  const options = MAPPING_OPTIONS();
  const mappingVectors = fiveEventList().map((record, index) => {
    const pointer = `/epcisBody/eventList/${index}`;
    const reference = epcisSourceReference({ sourceSha256: parsed.sha256, mediaType: 'application/ld+json', pointer, ...(typeof record.eventID === 'string' ? { eventId: record.eventID } : {}), contextDigests });
    const report = mapEpcisEventWithReport(record, { ...options, id: `urn:uuid:00000000-0000-4000-8000-0000000000f${index}` }, { sourceReference: reference });
    return { pointer, type: record.type, mapping: report.mapping, missing: report.missing, unmapped: report.unmapped, ...(report.seal == null ? {} : { seal: report.seal, seal_structure_valid: validateSealStructure(report.seal, { requireProof: false }).valid }) };
  });
  vectors.push({
    id: 'mapping-outcomes',
    description: 'Every event of the five-event document mapped into the VSC profile with an explicit outcome: the commissioning ObjectEvent is lossless and yields a structurally valid unsigned SEAL carrying the source reference; events with parties, transactions, sensors, quantities or a caller-decided transformation action are transformed with their losses named; an in_progress disposition the custody model does not name is unsupported. No SEAL is issued, and nothing touches a token.',
    input: { source_sha256_hex: parsed.sha256, context_digests_hex: contextDigests, issuer: ISSUER, transformation_action: 'ADD' },
    expected: { outcomes: mappingVectors },
    tags: ['epcis', 'vsc-mapping'],
  });

  const insufficient: JsonObject = { type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', epcList: [PACK], action: 'OBSERVE', bizStep: 'inspecting' };
  const partyOnly: JsonObject = { type: 'ObjectEvent', eventTime: T0, eventTimeZoneOffset: '+00:00', recordTime: T0, epcList: [PACK], action: 'OBSERVE', bizStep: 'storing', disposition: 'active', bizLocation: { id: ASSEMBLY_SITE }, sourceList: [{ type: 'owning_party', source: OWNING_PARTY_B }] };
  const insufficientReport = mapEpcisEventWithReport(insufficient, options);
  const partyReport = mapEpcisEventWithReport(partyOnly, { ...options, id: 'urn:uuid:00000000-0000-4000-8000-0000000000fa' });
  vectors.push({
    id: 'evidence-only-and-attribution',
    description: 'Valid EPCIS that lacks a disposition is insufficient-data and stays evidence only; an event naming an owning party and a business location maps with the configured issuer as actor, never with the party or location the event names.',
    input: { insufficient_event: insufficient, party_event: partyOnly, issuer: ISSUER },
    expected: {
      insufficient: { mapping: insufficientReport.mapping, missing: insufficientReport.missing },
      party: { mapping: partyReport.mapping, unmapped: partyReport.unmapped, actor_did: (partyReport.seal as Seal).eventVector.who.actorDid, issuer: (partyReport.seal as Seal).issuer },
    },
    tags: ['epcis', 'vsc-mapping', 'error-case'],
  });

  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.interoperability.epcis.v1',
    name: 'EPCIS 2.0.1 source exchange (epcis-json@1) and explicit VSC mapping (epcis-vsc@1)',
    version: '1.0.0',
    reference_impl: 'vsc@0.2.0',
    parity_class: 'required',
    brc: [],
    notes: `Pinned EPCIS 2.0.1 JSON Schema 0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af and context ${EPCIS_CONTEXT_DIGEST}. Every identifier uses the GS1 demonstration prefix 952 and example.org hosts.`,
    vectors,
  };
}
