import { Hash, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
  EPCIS_CONTEXT_IRI,
  EPCIS_EVENT_CREDENTIAL_TYPES,
  EPCIS_EVENT_MEDIA_TYPE,
  EPCIS_EVENT_REPRESENTATION,
  EpcisEventHashError,
  VC_V2_CONTEXT,
  base64UrlDecode,
  base64UrlEncode,
  buildEpcisEventCredential,
  didKeyFromIdentityKey,
  epcisEventAnchorMetadata,
  epcisEventCredentialKey,
  epcisEventHashId,
  epcisEventSubjects,
  signEpcisEventCredential,
  signEpcisEventJws,
  verifyEpcisEventCredential,
  type EpcisEventCredential,
  type EpcisEventVerification,
} from '../src/index.js'

/**
 * The published vectors of the `epcis-event-vc@1` profile
 * (`spec/epcis-event-profile.md`), in the stack's vector format:
 *
 * - `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json`: the Event
 *   Hash ID under the `@1` scope rules, with the pre-hash string beside each
 *   hash so a reader in any language sees where it diverges, and refusals by
 *   name.
 * - `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json`: signed
 *   credentials with the published test scalars, their verification findings
 *   and the anchor fields a registry derives.
 *
 * Every identifier is synthetic: GS1 keys under the demonstration prefix 952,
 * hosts under example.org. The key scalars are published; nothing derived from
 * them will ever hold value.
 *
 * Each hash vector records what the two independent generators answered for
 * the same input on 9 November 2026: epcis2.js 2.7.3 (npm, Apache-2.0) and
 * epcis-event-hash-generator 1.9.3 (PyPI, MIT, by the algorithm's author at
 * GS1 Germany). Where one differs, the note names the defect or the clause
 * the reference follows; the vector is pinned on the clause, not on a vote.
 */

const JS = 'epcis2.js@2.7.3'
const PY = 'epcis-event-hash-generator@1.9.3'
const AGREES = 'agrees'

const EXTENSION_CONTEXT = { example: 'https://example.org/vocab/', ilmdx: 'https://example.org/ilmd/' }
const CONTEXT = [EPCIS_CONTEXT_IRI, EXTENSION_CONTEXT]

const READ_POINT = { id: 'urn:epc:id:sgln:9521234.00001.0' }
const BIZ_LOCATION = { id: 'urn:epc:id:sgln:9521234.00002.0' }
const SER1 = 'urn:epc:id:sgtin:9521234.012345.SER1'

/** The events of the EPCIS source exchange vectors (`epcis/v1.json`, five-event-document), so the two files describe one supply chain. */
export const COMMISSIONING_EVENT = {
  type: 'ObjectEvent', eventTime: '2026-03-02T08:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z',
  eventID: 'urn:uuid:00000000-0000-4000-8000-000000000003',
  epcList: [SER1], action: 'ADD', bizStep: 'commissioning', disposition: 'active', readPoint: READ_POINT, bizLocation: BIZ_LOCATION,
}
const ASSOCIATION_EVENT = {
  type: 'AssociationEvent', eventTime: '2026-03-02T08:30:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z',
  eventID: 'urn:uuid:00000000-0000-4000-8000-000000000004',
  parentID: SER1, childEPCs: ['urn:epc:id:sgtin:9521234.022222.CELL-A', 'urn:epc:id:sgtin:9521234.022222.CELL-B'],
  action: 'ADD', bizStep: 'installing', disposition: 'active', readPoint: READ_POINT,
}
const TRANSFORMATION_STAGE_2 = {
  type: 'TransformationEvent', eventTime: '2026-03-01T12:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z',
  eventID: 'urn:uuid:00000000-0000-4000-8000-000000000002',
  inputEPCList: ['urn:epc:id:sgtin:9521234.044444.MOD-1'],
  inputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:9521234.033333.LOT7', quantity: 4, uom: 'EA' }],
  outputEPCList: [SER1],
  outputQuantityList: [{ epcClass: 'urn:epc:idpat:sgtin:9521234.055555.*', quantity: 0.5, uom: 'KGM' }],
  bizStep: 'assembling', disposition: 'in_progress', readPoint: READ_POINT, bizLocation: BIZ_LOCATION,
  transformationID: 'urn:example:transformation:stage-2',
}
const AGGREGATION_EVENT = {
  type: 'AggregationEvent', eventTime: '2026-03-02T09:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z',
  eventID: 'urn:uuid:00000000-0000-4000-8000-000000000005',
  parentID: 'urn:epc:id:sscc:9521234.0000000001', childEPCs: [SER1],
  action: 'ADD', bizStep: 'packing', disposition: 'in_transit', readPoint: READ_POINT,
}
const TRANSACTION_EVENT = {
  type: 'TransactionEvent', eventTime: '2026-03-02T10:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-02T09:00:00.000Z',
  eventID: 'urn:uuid:00000000-0000-4000-8000-000000000006',
  bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000018:PO-77' }],
  epcList: [SER1], action: 'ADD', bizStep: 'shipping', disposition: 'in_transit', readPoint: READ_POINT,
  sourceList: [{ type: 'owning_party', source: 'urn:epc:id:pgln:9521234.00003' }],
  destinationList: [{ type: 'owning_party', destination: 'urn:epc:id:pgln:9521234.00004' }],
}
const SENSOR_EVENT = {
  type: 'ObjectEvent', eventTime: '2026-03-03T06:00:00.000Z', eventTimeZoneOffset: '+00:00', recordTime: '2026-03-03T06:05:00.000Z',
  epcList: [SER1], action: 'OBSERVE', bizStep: 'sensor_reporting', disposition: 'in_transit',
  sensorElementList: [{
    sensorMetadata: { time: '2026-03-03T06:00:00.000Z', deviceID: 'urn:epc:id:giai:9521234.SENSOR-1' },
    sensorReport: [{ type: 'Temperature', value: 27.5, uom: 'CEL' }],
  }],
  'example:note': 'temperature observed in transit',
}
const ILMD_EVENT = {
  type: 'TransformationEvent', eventTime: '2026-03-08T08:00:00Z', eventTimeZoneOffset: '+00:00',
  inputEPCList: ['urn:epc:id:sgtin:9521234.022222.CELL-A'], outputEPCList: ['urn:epc:id:sgtin:9521234.044444.MOD-9'],
  outputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:9521234.033333.LOT8', quantity: 1, uom: 'EA' }],
  bizStep: 'commissioning', disposition: 'active', transformationID: 'urn:example:transformation:t9',
  ilmd: { 'ilmdx:lot': 'LOT8', 'ilmdx:bestBefore': '2027-01-01', 'ilmdx:nested': { 'ilmdx:a': '1', 'ilmdx:b': '2' } },
}
const SHIPPING_BARE = {
  type: 'ObjectEvent', eventTime: '2026-03-05T10:15:30Z', eventTimeZoneOffset: '+02:00',
  epcList: ['https://id.gs1.org/01/09521234000012/21/SER1'], action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit',
  readPoint: { id: 'https://id.gs1.org/414/9521234000012' },
  bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000005:PO-1' }],
  sourceList: [{ type: 'owning_party', source: 'https://id.gs1.org/417/9521234000036' }],
}
const SHIPPING_URIS = {
  ...SHIPPING_BARE, eventTime: '2026-03-05T10:15:30.000Z',
  bizStep: 'https://ref.gs1.org/cbv/BizStep-shipping', disposition: 'urn:epcglobal:cbv:disp:in_transit',
  bizTransactionList: [{ type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000005:PO-1' }],
  sourceList: [{ type: 'https://ref.gs1.org/cbv/SDT-owning_party', source: 'https://id.gs1.org/417/9521234000036' }],
}
const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'ObjectEvent', eventTime: '2026-03-05T10:15:30Z', eventTimeZoneOffset: '+02:00', epcList: [SER1], action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit', ...over,
})

interface HashCase {
  id: string
  description: string
  events: Record<string, unknown>[]
  context?: unknown
  oracles?: Record<string, string>
}

const HASH_CASES: HashCase[] = [
  { id: 'object-event-commissioning', description: 'The commissioning ObjectEvent of the source exchange vectors: sgtin, bare CBV terms, sgln read point and business location, a UUID eventID and a recordTime, which the hash ignores.', events: [COMMISSIONING_EVENT], oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'association-event', description: 'An AssociationEvent: parentID and two child EPCs sorted by code point.', events: [ASSOCIATION_EVENT], oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'transformation-event-ilmd-and-quantities', description: 'A TransformationEvent with an lgtin class in an output quantity, an integer quantity and nested ILMD under an inline prefix declaration.', events: [ILMD_EVENT], context: CONTEXT, oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'transformation-event-two-stage', description: 'The second transformation of the source exchange vectors: input and output EPC and quantity lists, an sgtin pattern as a class, a decimal quantity, and a transformationID that is an opaque URN.', events: [TRANSFORMATION_STAGE_2], oracles: { [JS]: 'differs: formats the transformationID urn:example:transformation:stage-2 as a timestamp (2001-02-01T00:00:00.000Z); rules 8 and 9 apply to timestamps only', [PY]: AGREES } },
  { id: 'aggregation-event-sscc-parent', description: 'An AggregationEvent whose parent is an SSCC: the extension digit leads the serial reference once, then the company prefix, the reference and the check digit (18 digits).', events: [AGGREGATION_EVENT], oracles: { [JS]: 'differs: converts the SSCC to 19 digits, carrying the extension digit twice (0952123400000000017); rule 16 and the Digital Link canonical form give 18', [PY]: AGREES } },
  { id: 'transaction-event-source-destination', description: 'A TransactionEvent with a business transaction, a source and a destination: source list before destination list, as the canonical property order says.', events: [TRANSACTION_EVENT], oracles: { [JS]: AGREES, [PY]: 'differs: writes destinationList before sourceList; the canonical property order is sourceList (21) then destinationList (22)' } },
  { id: 'object-event-sensor-report', description: 'A sensor observation without an eventID: sensorMetadata, a bare measurement type expanded to its GS1 Web Vocabulary URI, a decimal value and an event-level extension.', events: [SENSOR_EVENT], context: CONTEXT, oracles: { [JS]: AGREES, [PY]: 'differs: leaves the bare measurement type Temperature unexpanded; rule 15 expands every bare standard vocabulary value' } },
  { id: 'vocabulary-spellings', description: 'One shipping event in two spellings, bare CBV terms and Web URI or urn:epcglobal:cbv forms, with and without milliseconds: both hash alike, so the expected values hold for each event in the list.', events: [SHIPPING_BARE, SHIPPING_URIS], oracles: { [JS]: 'differs: keeps urn:epcglobal:cbv values unexpanded; rule 14 expands them to their Web URIs', [PY]: AGREES } },
  { id: 'epc-schemes-and-typed-lists', description: 'The EPC schemes of the @1 subset beside sgtin (grai, giai, gsrn, gdti, cpi, an sgln with and without an extension, a pgln source), two typed business transactions and a persistent disposition.', events: [base({
    epcList: [SER1, 'urn:epc:id:grai:9521234.00001.A1', 'urn:epc:id:giai:9521234.TOOL-9', 'urn:epc:id:gsrn:9521234.0000000001', 'urn:epc:id:gdti:9521234.00001.DOC7', 'urn:epc:id:cpi:9521234.PART-1.42'],
    readPoint: READ_POINT, bizLocation: { id: 'urn:epc:id:sgln:9521234.00002.EXT1' },
    bizTransactionList: [{ type: 'po', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000005:PO-1' }, { type: 'inv', bizTransaction: 'urn:epcglobal:cbv:bt:9521234000005:INV-77' }],
    sourceList: [{ type: 'owning_party', source: 'urn:epc:id:pgln:9521234.00003' }],
    persistentDisposition: { set: ['completeness_verified'], unset: ['completeness_inferred'] },
  })], oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'digital-link-constrained-canonical-form', description: 'GS1 Digital Link URIs in constrained canonical form (rule 17): a custom domain and query dropped, a consumer product variant and a lot dropped in favour of the serial, a lot kept when it is the finest qualifier, a variant alone reduced to the key, a GLN extension kept, an SSCC kept.', events: [base({
    epcList: ['https://example.com/01/09521234000012/21/ABC?linkType=all', 'https://id.gs1.org/01/09521234000012/22/CPV1/10/LOT1/21/S1', 'https://id.gs1.org/414/9521234000050/254/EXT', 'https://id.gs1.org/01/09521234000012/10/LOT2', 'https://id.gs1.org/01/09521234000012/22/CPV9', 'https://id.gs1.org/00/095212340000000013'],
  })], oracles: { [JS]: 'differs: keeps the consumer product variant (22) in the path and does not reduce to the most fine-grained key and qualifier pair', [PY]: AGREES } },
  { id: 'non-gs1-identifiers-and-certification-info', description: 'Identifiers that are not GS1 (an HTTPS URL without a GS1 key, a UUID URN) are carried verbatim, certificationInfo follows the time zone offset, and an opaque transformationID stays as written.', events: [base({
    certificationInfo: 'https://example.org/certificates/battery-safety',
    epcList: [SER1, 'https://example.org/items/plain-identifier', 'urn:uuid:7b9e2c3a-6d1f-4a8b-9c2d-0e1f2a3b4c5d'],
    transformationID: 'urn:example:transformation:stage-one',
  })], oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'event-level-extensions', description: 'Event-level user extensions (rule 19): a padded string trimmed, a nested object, a list, a number and a boolean, each named {namespace}localName and sorted.', events: [base({
    'example:note': '  padded note  ', 'example:grade': { 'example:value': 'A', 'example:scale': 'letters' }, 'example:tags': ['b', 'a'], 'example:count': 3, 'example:flag': true,
  })], context: CONTEXT, oracles: { [JS]: AGREES, [PY]: 'differs: writes the boolean as True, the Python spelling; JSON booleans are true and false' } },
  { id: 'read-point-and-biz-location-extensions', description: 'Extensions inside readPoint and bizLocation (rule 20): prefixed with the field name and appended among the event-level extensions, sorted, not written inline after the id.', events: [base({
    readPoint: { ...READ_POINT, 'example:dock': 'D4' }, bizLocation: { ...BIZ_LOCATION, 'example:zone': 'Z1' },
  })], context: CONTEXT, oracles: { [JS]: AGREES, [PY]: 'differs: writes the extension inline after the id without the field-name prefix; rule 20 prefixes it and rule 19 appends it with the other extensions' } },
  { id: 'empty-lists-and-ignored-members', description: 'An empty quantityList and an empty bizTransactionList add nothing, not even their names (rule 4); eventID and recordTime are not hashed. The event hashes exactly as it would without them.', events: [base({ quantityList: [], bizTransactionList: [], eventID: 'urn:uuid:7b9e2c3a-6d1f-4a8b-9c2d-0e1f2a3b4c5e', recordTime: '2026-03-05T10:20:00Z' }), base()], oracles: { [JS]: 'differs: fails on an empty list (res.customFields is not iterable)', [PY]: AGREES } },
  { id: 'timestamp-forms', description: 'Timestamps (rules 8 and 9): a time with an offset is expressed in UTC with Z, a fraction is carried to three digits, a missing fraction is zero-filled; eventTimeZoneOffset stays as written.', events: [base({ eventTime: '2026-03-05T12:15:30+02:00', eventTimeZoneOffset: '+02:00' }), base({ eventTime: '2026-03-05T10:15:30.000Z', eventTimeZoneOffset: '+02:00' })], oracles: { [JS]: AGREES, [PY]: AGREES } },
  { id: 'refuse-error-declaration', description: 'An event carrying an errorDeclaration computes no hash ID of its own (CBV 2.0 §8.9.2) and is not signable under @1.', events: [base({ eventID: 'urn:uuid:00000000-0000-4000-8000-00000000a009', errorDeclaration: { declarationTime: '2026-03-12T09:00:00Z', reason: 'incorrect_data', correctiveEventIDs: ['urn:uuid:00000000-0000-4000-8000-00000000a00a'] } })] },
  { id: 'refuse-unsupported-epc-scheme', description: 'An EPC scheme outside the @1 subset (gid) is refused rather than hashed over an unconverted value.', events: [base({ epcList: ['urn:epc:id:gid:95212.34.56', SER1] })] },
  { id: 'refuse-digital-link-gtin-not-fourteen-digits', description: 'A Digital Link whose GTIN is not 14 digits is refused under @1: the reference generators neither pad nor agree.', events: [base({ epcList: ['https://id.gs1.org/01/9521234000012/21/SER2'] })] },
  { id: 'refuse-digital-link-short-names', description: 'Digital Link short names (/gtin/, /ser/) are outside the @1 subset.', events: [base({ epcList: ['https://brand.example/gtin/09521234000012/ser/Q'] })] },
  { id: 'refuse-undeclared-prefix', description: 'An extension member whose prefix no carried context declares cannot be named (rule 19).', events: [base({ 'undeclared:note': 'x' })] },
  { id: 'refuse-unprefixed-member', description: 'An event-level member that is neither a standard member nor a prefixed extension has no namespace to hash under.', events: [base({ note: 'x' })] },
  { id: 'refuse-sensor-extension', description: 'An extension inside sensorMetadata or sensorReport has no agreed pre-hash form under @1: the text names the field as an extension point and the reference generators disagree on the prefix.', events: [base({ sensorElementList: [{ sensorMetadata: { time: '2026-03-05T08:00:00Z', 'example:fw': '1.2' }, sensorReport: [{ type: 'Temperature', value: 26, uom: 'CEL' }] }] })], context: CONTEXT },
  { id: 'refuse-compact-iri-vocabulary', description: 'A vocabulary value spelled as a compact IRI (gs1:Humidity) is refused: the generators keep it verbatim where JSON-LD would expand it.', events: [base({ sensorElementList: [{ sensorReport: [{ type: 'gs1:Humidity', value: 50, uom: 'A93' }] }] })] },
  { id: 'refuse-extension-event-type', description: 'An extension event type is retained by the source exchange and signed by nobody under @1.', events: [base({ type: 'ExtensionEvent' })] },
  { id: 'refuse-event-level-context', description: 'A @context inside the event is refused; the credential carries the contexts.', events: [base({ '@context': ['https://ref.gs1.org/epcis/'] })] },
  { id: 'refuse-certification-info-list', description: 'A list of certifications has no agreed pre-hash form under @1.', events: [base({ certificationInfo: ['https://example.org/certificates/a', 'https://example.org/certificates/b'] })] },
  { id: 'refuse-serial-outside-subset', description: 'An EPC serial with characters outside the @1 subset (percent-encoding) is refused rather than encoded two ways.', events: [base({ epcList: ['urn:epc:id:sgtin:9521234.012345.SER%2F2'] })] },
  { id: 'invalid-missing-event-time', description: 'Not an EPCIS event: eventTime is required.', events: [(() => { const { eventTime: _e, ...rest } = base(); return rest })()] },
  { id: 'invalid-timestamp', description: 'A calendar date that does not exist is not a timestamp.', events: [base({ eventTime: '2026-02-30T10:15:30Z' })] },
  { id: 'invalid-action', description: 'action is ADD, OBSERVE or DELETE.', events: [base({ action: 'UPDATE' })] },
]

function hashExpected(c: HashCase): Record<string, unknown> {
  const results = c.events.map((event) => {
    try {
      const { hashId, preHash } = epcisEventHashId(event, c.context)
      return { ok: true as const, hashId, preHash, subjects: epcisEventSubjects(event) }
    } catch (cause) {
      if (cause instanceof EpcisEventHashError) return { ok: false as const, code: cause.code, path: cause.path }
      throw cause
    }
  })
  const first = results[0]
  if (!first.ok) {
    for (const r of results) if (r.ok || r.code !== first.code) throw new Error(`${c.id}: every event must refuse alike`)
    return { refused: { code: first.code, path: first.path } }
  }
  for (const r of results) if (!r.ok || r.hashId !== first.hashId) throw new Error(`${c.id}: every event must hash alike`)
  return { hash_id: first.hashId, pre_hash: first.preHash, subjects: first.subjects }
}

export function epcisEventHashVectors(): Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> } {
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.interoperability.epcis.hash.v1',
    name: 'DPP epcis-event-vc@1: the CBV 2.0 Event Hash ID under the @1 scope rules, with pre-hash strings and refusals by name',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-protocol@0.3.0',
    parity_class: 'required',
    notes: 'CBV 2.0 §8.9.2 (release 2.0, ratified June 2022) with certificationInfo after eventTimeZoneOffset as the reference generators place it. Every identifier uses the GS1 demonstration prefix 952 and example.org hosts. Each positive vector records what epcis2.js 2.7.3 and epcis-event-hash-generator 1.9.3 answered for the same input on 9 November 2026 under the pinned EPCIS 2.0.1 context served offline; a difference is named with the clause the reference follows. Where every event in a vector hashes alike, the expected values hold for each.',
    vectors: HASH_CASES.map((c) => ({
      id: c.id,
      description: c.description,
      input: { events: c.events, ...(c.context == null ? {} : { context: c.context }) },
      expected: hashExpected(c),
      ...(c.oracles == null ? {} : { oracles: c.oracles }),
    })),
  }
}

// ---------------------------------------------------------------------------
// Credential vectors
// ---------------------------------------------------------------------------

const PARTY_A_SCALAR = '7a'.repeat(32)
const PARTY_B_SCALAR = '7b'.repeat(32)
const CHECKED_AT = '2026-11-09T12:00:00Z'
const VALID_FROM = '2026-11-09T00:00:00Z'

interface Party { scalar: string; identityKey: string; credentialKey: string; issuer: string; kid: string; wallet: ProtoWallet }

function party(scalar: string): Party {
  const priv = PrivateKey.fromHex(scalar)
  const identityKey = priv.toPublicKey().toString()
  const credentialKey = epcisEventCredentialKey(identityKey)
  const issuer = didKeyFromIdentityKey(credentialKey)
  return { scalar, identityKey, credentialKey, issuer, kid: `${issuer}#${issuer.slice('did:key:'.length)}`, wallet: new ProtoWallet(priv) }
}

function tamper(jws: string, change: (payload: Record<string, any>) => void): string {
  const [h, p, s] = jws.split('.')
  const payload = JSON.parse(Utils.toUTF8(base64UrlDecode(p)))
  change(payload)
  return `${h}.${base64UrlEncode(Utils.toArray(JSON.stringify(payload), 'utf8'))}.${s}`
}

function rehead(jws: string, header: Record<string, unknown>): string {
  const [, p, s] = jws.split('.')
  return `${base64UrlEncode(Utils.toArray(JSON.stringify(header), 'utf8'))}.${p}.${s}`
}

const pick = (p: { status: string; reasonCode?: string }): Record<string, unknown> => ({ status: p.status, ...(p.reasonCode == null ? {} : { reason_code: p.reasonCode }) })

function expectedOf(v: EpcisEventVerification): Record<string, unknown> {
  const out: Record<string, unknown> = {
    proof: pick(v.proof), schema: pick(v.schema), time: pick(v.time), status: pick(v.status), authority: pick(v.authority),
    digest_hex: v.digest,
  }
  if (v.id != null) out.id = v.id
  if (v.issuer != null) out.issuer = v.issuer
  if (v.hashId != null) out.hash_id = v.hashId
  if (v.subjects != null) out.subjects = v.subjects
  if (v.attestationType != null) out.attestation_type = v.attestationType
  if (v.verificationKey != null) out.verification_key_hex = v.verificationKey
  try { out.anchor = epcisEventAnchorMetadata(v) } catch { /* no anchor fields for a credential whose hash did not hold */ }
  return out
}

interface CredentialCase {
  id: string
  description: string
  jws: string
  resolverKeys?: Record<string, string>
  checkedAt?: string
  pairRule?: string
  expectedWithoutResolver?: boolean
}

export async function epcisEventCredentialVectors(): Promise<Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> }> {
  const a = party(PARTY_A_SCALAR)
  const b = party(PARTY_B_SCALAR)
  const credential = (issuer: string, event: Record<string, unknown>, over: Partial<EpcisEventCredential> = {}): EpcisEventCredential => ({
    ...buildEpcisEventCredential({ event, issuer, validFrom: VALID_FROM }), ...over,
  })
  const positive = await signEpcisEventCredential(credential(a.issuer, COMMISSIONING_EVENT), { kid: a.kid, signer: a.wallet })
  const positiveCredential = credential(a.issuer, COMMISSIONING_EVENT)
  const reEncoded = await signEpcisEventJws(JSON.stringify({
    credentialSubject: positiveCredential.credentialSubject, validFrom: positiveCredential.validFrom, issuer: positiveCredential.issuer,
    id: positiveCredential.id, type: positiveCredential.type, '@context': positiveCredential['@context'],
  }, null, 1), { kid: a.kid, signer: a.wallet })
  const secondIssuer = await signEpcisEventCredential(credential(b.issuer, COMMISSIONING_EVENT), { kid: b.kid, signer: b.wallet })
  const { hashId } = epcisEventHashId(COMMISSIONING_EVENT)
  const eventIdNotItsHash = await signEpcisEventJws(JSON.stringify({
    '@context': [VC_V2_CONTEXT, EPCIS_CONTEXT_IRI], type: [...EPCIS_EVENT_CREDENTIAL_TYPES], id: hashId, issuer: a.issuer, validFrom: VALID_FROM,
    credentialSubject: { ...COMMISSIONING_EVENT, eventID: `ni:///sha-256;${'0'.repeat(64)}?ver=CBV2.0` },
  }), { kid: a.kid, signer: a.wallet })
  const errorDeclaration = await signEpcisEventJws(JSON.stringify({
    '@context': [VC_V2_CONTEXT, EPCIS_CONTEXT_IRI], type: [...EPCIS_EVENT_CREDENTIAL_TYPES], id: hashId, issuer: a.issuer, validFrom: VALID_FROM,
    credentialSubject: { ...COMMISSIONING_EVENT, errorDeclaration: { declarationTime: '2026-03-12T09:00:00Z', reason: 'incorrect_data' } },
  }), { kid: a.kid, signer: a.wallet })
  const unsupportedIdentifier = await signEpcisEventJws(JSON.stringify({
    '@context': [VC_V2_CONTEXT, EPCIS_CONTEXT_IRI], type: [...EPCIS_EVENT_CREDENTIAL_TYPES], id: hashId, issuer: a.issuer, validFrom: VALID_FROM,
    credentialSubject: { ...COMMISSIONING_EVENT, epcList: ['urn:epc:id:gid:95212.34.56'] },
  }), { kid: a.kid, signer: a.wallet })
  const multiObject = await signEpcisEventCredential(credential(a.issuer, TRANSACTION_EVENT), { kid: a.kid, signer: a.wallet })
  const notYetValid = await signEpcisEventCredential(credential(a.issuer, COMMISSIONING_EVENT, { validFrom: '2026-12-01T00:00:00Z' }), { kid: a.kid, signer: a.wallet })
  const expired = await signEpcisEventCredential(credential(a.issuer, COMMISSIONING_EVENT, { validUntil: '2026-11-09T06:00:00Z' }), { kid: a.kid, signer: a.wallet })
  const withStatus = await signEpcisEventCredential(credential(a.issuer, COMMISSIONING_EVENT, {
    credentialStatus: { id: 'https://issuer.example/status/1#7', type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '7', statusListCredential: 'https://issuer.example/status/1' },
  }), { kid: a.kid, signer: a.wallet })
  const sensor = await signEpcisEventCredential(await Promise.resolve(buildEpcisEventCredential({ event: SENSOR_EVENT, extensionContexts: [EXTENSION_CONTEXT], issuer: a.issuer, validFrom: VALID_FROM })), { kid: a.kid, signer: a.wallet })
  const didWebKid = 'did:web:issuer.example#credential'
  const didWeb = await signEpcisEventCredential(credential('did:web:issuer.example', COMMISSIONING_EVENT), { kid: didWebKid, signer: a.wallet })
  const [headerPart] = positive.split('.')
  const header = JSON.parse(Utils.toUTF8(base64UrlDecode(headerPart)))

  const cases: CredentialCase[] = [
    { id: 'positive', description: 'The commissioning event signed by party A under its one published credential key, the BRC-42 child of its identity key under [1, "dpp epcis event v1"] and the key identifier "credential", published as a did:key. The hash ID is the credential id, the signature verifies against the kid, the interval includes checkedAt, no status entry, no authority policy.', jws: positive },
    { id: 're-encoded-copy', description: 'The same credential serialised with another member order and whitespace, signed by the same party: a different byte string with a different digest and the same id. Its proof holds. A registry that already holds a credential for this hash ID and issuer refuses it: one party signs one event once, unless the bytes are equal.', jws: reEncoded, pairRule: 'refused: a second byte string for a hash ID and issuer the registry already holds' },
    { id: 'second-issuer', description: 'The same event signed by party B: a second attestation of one hash ID by another issuer, accepted beside the first.', jws: secondIssuer, pairRule: 'accepted: a different issuer for the same hash ID' },
    { id: 'tampered-record-time', description: "The positive credential with the subject's recordTime changed after signing: the hash ID still holds, because recordTime is not hashed, and the signature fails.", jws: tamper(positive, (p) => { p.credentialSubject.recordTime = '2026-03-02T09:30:00.000Z' }) },
    { id: 'tampered-biz-step', description: 'The positive credential with the subject\'s bizStep changed after signing: the subject no longer hashes to the id (and the signature fails); the proof reports the hash mismatch first.', jws: tamper(positive, (p) => { p.credentialSubject.bizStep = 'decommissioning' }) },
    { id: 'kid-of-another-party', description: 'The positive credential re-headed with party B\'s kid: a kid that names no verification method of the issuer fails the proof before any key is tried.', jws: rehead(positive, { ...header, kid: b.kid }) },
    { id: 'event-id-not-its-hash', description: 'A subject whose eventID is a hash ID other than the one it hashes to: the credential id is right and the subject contradicts it.', jws: eventIdNotItsHash },
    { id: 'error-declaration', description: 'A subject carrying an errorDeclaration cannot be hashed under @1 and the proof fails by that name.', jws: errorDeclaration },
    { id: 'unsupported-identifier', description: 'A subject naming an EPC scheme outside the @1 subset: the hash is uncomputable and the proof fails by that name.', jws: unsupportedIdentifier },
    { id: 'multi-object-subject', description: 'The transaction event names one EPC, a source party and a destination party; the subjects are the object identifiers only, sorted, and the anchor subject is the first.', jws: multiObject },
    { id: 'sensor-event-with-extension-context', description: 'The sensor observation under an inline prefix declaration carried as the third context entry.', jws: sensor },
    { id: 'not-yet-valid', description: 'validFrom after checkedAt.', jws: notYetValid },
    { id: 'expired', description: 'validUntil before checkedAt.', jws: expired },
    { id: 'status-entry-without-verifier', description: 'A credential with a Bitstring Status List entry verified without a status verifier: status is unknown, never passed.', jws: withStatus },
    { id: 'alg-es256', description: 'The positive credential re-headed as ES256: another suite, reported unsupported, not failed.', jws: rehead(positive, { ...header, alg: 'ES256' }) },
    { id: 'malformed-two-parts', description: 'Two parts are not a compact JWS.', jws: positive.split('.').slice(0, 2).join('.') },
    { id: 'unknown-credential-member', description: 'A member the profile does not define (name) is a shape failure.', jws: tamper(positive, (p) => { p.name = 'Commissioning' }) },
    { id: 'did-web-issuer-with-resolver', description: 'A did:web issuer whose kid resolves through the caller\'s resolver to party A\'s credential key: the proof holds; without a resolver it is unknown.', jws: didWeb, resolverKeys: { [didWebKid]: a.credentialKey }, expectedWithoutResolver: true },
  ]

  const vectors = []
  for (const c of cases) {
    const checkedAt = c.checkedAt ?? CHECKED_AT
    const verification = await verifyEpcisEventCredential(c.jws, { checkedAt, resolveKey: (kid) => c.resolverKeys?.[kid] })
    const expected = expectedOf(verification)
    if (c.pairRule != null) expected.pair_rule = c.pairRule
    if (c.expectedWithoutResolver) {
      const without = await verifyEpcisEventCredential(c.jws, { checkedAt })
      expected.without_resolver = { proof: pick(without.proof) }
    }
    vectors.push({
      id: c.id,
      description: c.description,
      input: { representation: EPCIS_EVENT_REPRESENTATION, media_type: EPCIS_EVENT_MEDIA_TYPE, jws: c.jws, checked_at: checkedAt, ...(c.resolverKeys == null ? {} : { resolver_keys_hex: c.resolverKeys }) },
      expected,
    })
  }
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.exchange.epcis-event-vc.v1',
    name: 'DPP exchange profile epcis-event-vc@1: EPCIS events as VC 2.0 credentials keyed by their Event Hash ID, signed ES256K as compact JWS by the party\'s published credential key, with their findings and anchor fields',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-protocol@0.3.0',
    parity_class: 'required',
    notes: 'checkedAt is fixed so the time findings are reproducible. Two parties sign: their identity key scalars are published in keys, the credential key of each is the BRC-42 child under [1, "dpp epcis event v1"] with key identifier "credential" and counterparty anyone, and each issuer is the did:key of that credential key. Nothing derived from these scalars will ever hold value. The JWS bytes are the committed representation: digest_hex is SHA-256 over the exact string.',
    keys: {
      party_a: { identity_private_key_hex: a.scalar, identity_key_hex: a.identityKey, credential_key_hex: a.credentialKey, issuer: a.issuer, kid: a.kid },
      party_b: { identity_private_key_hex: b.scalar, identity_key_hex: b.identityKey, credential_key_hex: b.credentialKey, issuer: b.issuer, kid: b.kid },
    },
    vectors,
  }
}

/** The JWS digest, for callers that pin the exact bytes. */
export const jwsDigest = (jws: string): string => Utils.toHex(Hash.sha256(Utils.toArray(jws, 'utf8')))
