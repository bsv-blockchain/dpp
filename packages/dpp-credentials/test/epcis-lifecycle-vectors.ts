import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
  EPCIS_LIFECYCLE_CONTEXT,
  EPCIS_LIFECYCLE_KEY_ID,
  EPCIS_LIFECYCLE_MEDIA_TYPE,
  EPCIS_LIFECYCLE_PROTOCOL,
  EPCIS_LIFECYCLE_REPRESENTATION,
  assertEpcisLifecycleClaim,
  buildEpcisLifecycleAnchors,
  buildEpcisLifecycleClaim,
  epcisLifecycleAnchorMetadata,
  epcisLifecycleClaimBytes,
  epcisLifecycleSigningBytes,
  signEpcisLifecycleClaim,
  verifyEpcisLifecycleClaim,
  type BuildEpcisLifecycleClaimInput,
  type EpcisLifecycleAuthorityAnswer,
  type EpcisLifecycleClaim,
  type EpcisLifecycleIssuanceOptions,
  type EpcisLifecycleComparisonInput,
  type EpcisLifecycleVerification,
  type EpcisLifecycleVerificationOptions,
  type SignedEpcisLifecycleClaim,
} from '../src/epcis-lifecycle.js'
import { canonicalEpcisIdentifier, epcUriToDigitalLink } from '../src/epcis-lifecycle/shared.js'
import { buildAttestationAnchor, didKeyFromIdentityKey, type PartialCheck } from '@bsv/dpp-protocol'

/**
 * The published vectors of the EPCIS lifecycle claim, `dpp-epcis-lifecycle@1`
 * (`spec/epcis-lifecycle-claim.md`), in the stack's vector format:
 * `fixtures/vectors/dpp/epcis-lifecycle/v1.json`.
 *
 * Every identifier is synthetic: GS1 keys under the demonstration prefix 952,
 * hosts under example.org. The key scalars are published; nothing derived from
 * them will ever hold value. Every event is held to the pinned EPCIS 2.0.1
 * JSON schema, which the test set-up provisions from GS1 and the repository
 * does not carry.
 *
 * A vector's options are data, read the same way by `runVector` here and by
 * any reader in another language: `schema` applies the pinned EPCIS 2.0.1
 * schema; `comparison: "gs1-digital-link"` compares an identifier with a
 * passport by its canonical GS1 Digital Link (equal for an instance binding,
 * the same GTIN for a class binding); `authority` lists the (issuer, role,
 * passport) triples the resolver supports or refuses, any other question being
 * unavailable; `extension_rules_held` names the extension rules the verifier
 * holds, each of which passes; `anchors_hex` are anchor locking scripts;
 * `related` are other claims with whether they are complete;
 * `expected_passport_id` and `expected_event_id` are the passport and the
 * event the caller expects.
 */

const prefix = 9521234
export const sgtin = (item: string, serial: string): string => `urn:epc:id:sgtin:${prefix}.${item}.${serial}`
export const passportOf = (epc: string): string => epcUriToDigitalLink(epc)
const pgln = (n: string): string => `urn:epc:id:pgln:${prefix}.${n}`
const sgln = (n: string): string => `urn:epc:id:sgln:${prefix}.${n}.0`

export const ID = {
  battery: sgtin('054321', 'BAT-0001'),
  battery2: sgtin('054321', 'BAT-0002'),
  moduleA: sgtin('065432', 'MOD-A'),
  moduleB: sgtin('065432', 'MOD-B'),
  moduleC: sgtin('065432', 'MOD-C'),
  cell: sgtin('076543', 'CELL-0042'),
  cellLot: `urn:epc:class:lgtin:${prefix}.076543.LOT-7`,
  materialLot: `urn:epc:class:lgtin:${prefix}.087654.BM-2026-11`,
  ebike: sgtin('098765', 'EBIKE-01'),
  pallet: `urn:epc:id:sscc:${prefix}.0000000001`,
  sensor: `urn:epc:id:giai:${prefix}.SENSOR-1`,
}
export const P = {
  battery: passportOf(ID.battery),
  battery2: passportOf(ID.battery2),
  moduleA: passportOf(ID.moduleA),
  moduleB: passportOf(ID.moduleB),
  moduleC: passportOf(ID.moduleC),
  cell: passportOf(ID.cell),
}
export const PARTY = { maker: pgln('00001'), carrier: pgln('00002'), retailer: pgln('00003'), importer: pgln('00004'), recycler: pgln('00005'), repairer: pgln('00006') }
const PLACE = { factory: sgln('00001'), warehouse: sgln('00002'), shop: sgln('00003'), recycler: sgln('00005'), workshop: sgln('00006') }
const EXT = { example: 'https://example.org/dpp-ext/' }
export const SHREDDING_STEP = 'https://example.org/dpp-ext/BizStep-shredding'
export const SHREDDING_RULE = 'https://example.org/dpp-ext/rules/shredding@1'

export interface Signer { name: string; scalar: string; identityKey: string; issuer: string; party: string; wallet: ProtoWallet }
function signer(name: string, scalar: string, party: string): Signer {
  const priv = PrivateKey.fromHex(scalar)
  const identityKey = priv.toPublicKey().toString()
  return { name, scalar, identityKey, issuer: didKeyFromIdentityKey(identityKey), party, wallet: new ProtoWallet(priv) }
}
export const S = {
  maker: signer('maker', 'a1'.repeat(32), PARTY.maker),
  carrier: signer('carrier', 'a2'.repeat(32), PARTY.carrier),
  retailer: signer('retailer', 'a3'.repeat(32), PARTY.retailer),
  importer: signer('importer', 'a4'.repeat(32), PARTY.importer),
  recycler: signer('recycler', 'a5'.repeat(32), PARTY.recycler),
  repairer: signer('repairer', 'a6'.repeat(32), PARTY.repairer),
}
export const ANCHOR_SERVICE = { scalar: 'a7'.repeat(32), identityKey: PrivateKey.fromHex('a7'.repeat(32)).toPublicKey().toString(), wallet: new ProtoWallet(PrivateKey.fromHex('a7'.repeat(32))) }
/** Another anchoring service: anyone may anchor under a claim's identifier, so a verifier meets anchors the claim's own service never wrote. */
export const SECOND_ANCHOR_SERVICE = { scalar: 'a8'.repeat(32), identityKey: PrivateKey.fromHex('a8'.repeat(32)).toPublicKey().toString(), wallet: new ProtoWallet(PrivateKey.fromHex('a8'.repeat(32))) }

const uuid = (n: number): string => `urn:uuid:6b000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (day: number, hour = 9): string => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`
const base = (n: number, day: number): Record<string, unknown> => ({ eventTime: at(day), eventTimeZoneOffset: '+10:00', eventID: uuid(n) })

// ---------------------------------------------------------------------------
// The events: every one of the five types, and the representative cases
// ---------------------------------------------------------------------------

export const EVENTS = {
  commissioning: { type: 'ObjectEvent', ...base(1, 2), epcList: [ID.battery], action: 'ADD', bizStep: 'commissioning', disposition: 'active', readPoint: { id: PLACE.factory }, bizLocation: { id: PLACE.factory }, ilmd: { 'example:chemistry': 'LFP', 'example:nominalCapacityAh': 52.5 } },
  manufacturing: {
    type: 'TransformationEvent', ...base(2, 1),
    inputEPCList: [ID.moduleA, ID.moduleB], inputQuantityList: [{ epcClass: ID.cellLot, quantity: 192, uom: 'H87' }],
    outputEPCList: [ID.battery2], bizStep: 'commissioning', disposition: 'active', readPoint: { id: PLACE.factory }, transformationID: 'urn:uuid:6b000000-0000-4000-9000-000000000001',
  },
  shipping: { type: 'ObjectEvent', ...base(3, 3), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit', readPoint: { id: PLACE.factory }, sourceList: [{ type: 'location', source: PLACE.factory }], destinationList: [{ type: 'location', destination: PLACE.shop }] },
  receiving: { type: 'ObjectEvent', ...base(4, 5), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'receiving', disposition: 'in_progress', readPoint: { id: PLACE.shop }, bizLocation: { id: PLACE.shop } },
  packing: { type: 'AggregationEvent', ...base(5, 3), parentID: ID.pallet, childEPCs: [ID.battery], action: 'ADD', bizStep: 'packing', disposition: 'in_progress', readPoint: { id: PLACE.factory } },
  unpacking: { type: 'AggregationEvent', ...base(6, 5), parentID: ID.pallet, childEPCs: [ID.battery], action: 'DELETE', bizStep: 'unpacking', disposition: 'in_progress', readPoint: { id: PLACE.shop } },
  assembly: { type: 'AssociationEvent', ...base(7, 6), parentID: ID.ebike, childEPCs: [ID.battery], action: 'ADD', bizStep: 'assembling', disposition: 'active', readPoint: { id: PLACE.workshop } },
  repair: { type: 'ObjectEvent', ...base(8, 8), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'repairing', disposition: 'active', readPoint: { id: PLACE.workshop } },
  moduleRemoved: { type: 'AssociationEvent', ...base(9, 8), parentID: ID.battery2, childEPCs: [ID.moduleB], action: 'DELETE', bizStep: 'removing', disposition: 'needs_replacement', readPoint: { id: PLACE.workshop } },
  moduleInstalled: { type: 'AssociationEvent', ...base(10, 8), parentID: ID.battery2, childEPCs: [ID.moduleC], action: 'ADD', bizStep: 'installing', disposition: 'active', readPoint: { id: PLACE.workshop } },
  inspection: { type: 'ObjectEvent', ...base(11, 9), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant', readPoint: { id: PLACE.workshop }, bizTransactionList: [{ type: 'testres', bizTransaction: 'https://example.org/reports/inspection/0001' }] },
  purchaseOrder: { type: 'TransactionEvent', ...base(12, 4), bizTransactionList: [{ type: 'po', bizTransaction: 'https://example.org/orders/PO-1001' }], epcList: [ID.battery], action: 'ADD', bizStep: 'accepting', disposition: 'in_progress', readPoint: { id: PLACE.shop } },
  ownershipAndPossession: {
    type: 'ObjectEvent', ...base(13, 3), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'departing', disposition: 'in_transit', readPoint: { id: PLACE.factory },
    sourceList: [{ type: 'owning_party', source: PARTY.maker }, { type: 'possessing_party', source: PARTY.maker }],
    destinationList: [{ type: 'owning_party', destination: PARTY.retailer }, { type: 'possessing_party', destination: PARTY.carrier }],
  },
  sensor: {
    type: 'ObjectEvent', ...base(14, 4), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'sensor_reporting', readPoint: { id: PLACE.warehouse },
    sensorElementList: [{
      sensorMetadata: { time: at(14, 4), deviceID: ID.sensor },
      sensorReport: [{ type: 'Temperature', value: 21.5, uom: 'CEL' }, { type: 'RelativeHumidity', value: 45.25, uom: 'P1' }, { type: 'Temperature', minValue: -3.75, maxValue: 38.125, uom: 'CEL' }],
    }],
  },
  possessionOnly: {
    type: 'ObjectEvent', ...base(15, 4), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'arriving', disposition: 'in_progress', readPoint: { id: PLACE.shop },
    sourceList: [{ type: 'possessing_party', source: PARTY.carrier }], destinationList: [{ type: 'possessing_party', destination: PARTY.retailer }],
  },
  saleLabel: { type: 'ObjectEvent', ...base(16, 7), epcList: [ID.battery], action: 'OBSERVE', bizStep: 'retail_selling', disposition: 'retail_sold', readPoint: { id: PLACE.shop } },
  collection: {
    type: 'ObjectEvent', ...base(20, 10), epcList: [ID.battery2], action: 'OBSERVE', bizStep: 'collecting', disposition: 'in_progress', bizLocation: { id: PLACE.recycler },
    sourceList: [{ type: 'possessing_party', source: PARTY.retailer }], destinationList: [{ type: 'possessing_party', destination: PARTY.recycler }],
  },
  disassembly: { type: 'AssociationEvent', ...base(21, 11), parentID: ID.battery2, childEPCs: [ID.moduleA, ID.moduleC], action: 'DELETE', bizStep: 'disassembling', disposition: 'inactive', readPoint: { id: PLACE.recycler } },
  shredding: {
    type: 'TransformationEvent', ...base(22, 12), inputEPCList: [ID.moduleA, ID.moduleC], outputQuantityList: [{ epcClass: ID.materialLot, quantity: 12.5, uom: 'KGM' }],
    bizStep: SHREDDING_STEP, disposition: 'destroyed', readPoint: { id: PLACE.recycler },
  },
  endOfLife: { type: 'ObjectEvent', ...base(23, 13), epcList: [ID.battery2], action: 'DELETE', bizStep: 'decommissioning', disposition: 'inactive', readPoint: { id: PLACE.recycler } },
} as const satisfies Record<string, Record<string, unknown>>

type Ev = Record<string, unknown>
const event = (e: Ev): Record<string, unknown> => JSON.parse(JSON.stringify(e))
const issued = (e: Ev): string => new Date(Date.parse(e.eventTime as string) + 3600_000).toISOString()

export function input(who: Signer, e: Ev, bindings: BuildEpcisLifecycleClaimInput['bindings'], over: Partial<BuildEpcisLifecycleClaimInput> = {}): BuildEpcisLifecycleClaimInput {
  return {
    event: event(e), bindings, issuer: who.issuer, issuerParty: who.party, assertedRole: 'observer',
    authorityScope: [...new Set(bindings.map((b) => b.passportId))], issuedAt: issued(e), ...over,
  }
}
export const bind = (passportId: string, field: BuildEpcisLifecycleClaimInput['bindings'][number]['field'], identifier: string, level: 'instance' | 'class' = 'instance'): BuildEpcisLifecycleClaimInput['bindings'][number] => ({ passportId, field, identifier, level })

/** The synthetic issuing authority and pinned checks for independently reproducible signed vectors. */
export function fixtureIssuancePolicy(who: Signer): EpcisLifecycleIssuanceOptions {
  return {
    eventSchemaValidator: pinnedSchemaValidator,
    compareProduct: gs1Comparison,
    extensionRules: { [SHREDDING_RULE]: () => ({ status: 'pass' }) },
    authorityResolver: (q) => ({ status: q.issuerKey === who.identityKey && Object.values(P).includes(q.passportId) ? 'supported' : 'unsupported' }),
  }
}

export async function issue(who: Signer, i: BuildEpcisLifecycleClaimInput): Promise<SignedEpcisLifecycleClaim> {
  return signEpcisLifecycleClaim(buildEpcisLifecycleClaim(i), who.wallet, fixtureIssuancePolicy(who))
}

/** Sign without the issuance rules, as a careless or hostile issuer could: how the refusals a verifier must make are reached. */
export async function signUnchecked(who: Signer, claim: EpcisLifecycleClaim): Promise<SignedEpcisLifecycleClaim> {
  const { signature } = await who.wallet.createSignature({ data: epcisLifecycleSigningBytes(claim), protocolID: EPCIS_LIFECYCLE_PROTOCOL, keyID: EPCIS_LIFECYCLE_KEY_ID, counterparty: 'anyone' })
  return { ...claim, signature: Utils.toHex(signature) }
}

/** The envelope buildEpcisLifecycleClaim would make, without its rules. */
export function unchecked(i: BuildEpcisLifecycleClaimInput): EpcisLifecycleClaim {
  return {
    claimFormat: 'dpp-epcis-lifecycle@1', event: i.event,
    eventContext: [{ iri: EPCIS_LIFECYCLE_CONTEXT.iri, sha256: EPCIS_LIFECYCLE_CONTEXT.sha256 }],
    eventSchema: { uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json', sha256: '0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af' },
    bindings: i.bindings, issuer: i.issuer, ...(i.issuerParty == null ? {} : { issuerParty: i.issuerParty }), assertedRole: i.assertedRole,
    authorityScope: i.authorityScope, issuedAt: i.issuedAt, ...(i.source == null ? {} : { source: i.source }), ...(i.requiredExtensions == null ? {} : { requiredExtensions: i.requiredExtensions }),
  }
}

export const text = (claim: SignedEpcisLifecycleClaim): string => Utils.toUTF8(epcisLifecycleClaimBytes(claim))

// ---------------------------------------------------------------------------
// The data options, read into verification options
// ---------------------------------------------------------------------------

let schemaCheck: ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null } | undefined

/** The pinned EPCIS 2.0.1 schema over the event in a minimal document, from the folder the test set-up provisioned. */
export function pinnedSchemaValidator(event: Record<string, unknown>): PartialCheck {
  if (schemaCheck == null) {
    const dir = process.env.DPP_GS1_ARTEFACTS_DIR
    if (dir == null || dir === '') throw new Error('the pinned EPCIS schema was not provisioned')
    const ajv = new Ajv({ allErrors: true, strict: false })
    ;(addFormats as unknown as (a: Ajv) => void)(ajv)
    schemaCheck = ajv.compile(JSON.parse(readFileSync(join(dir, 'epcis-json-schema-2.0.1.json'), 'utf8')))
  }
  const document = { '@context': [EPCIS_LIFECYCLE_CONTEXT.iri, EXT], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-11-30T00:00:00.000Z', epcisBody: { eventList: [event] } }
  if (schemaCheck(document)) return { status: 'pass' }
  return { status: 'fail', reasonCode: 'schema-invalid', detail: (schemaCheck.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`) }
}

/** An identifier denotes the passport when its canonical GS1 Digital Link is the passport identifier (instance), or carries the passport's GTIN (class). */
export function gs1Comparison(i: EpcisLifecycleComparisonInput): PartialCheck {
  let link: string
  try { link = canonicalEpcisIdentifier(i.identifier) } catch (cause) { return { status: 'unknown', reasonCode: 'x-comparison-unsupported', detail: String(cause) } }
  if (i.level === 'instance') return link === i.passportId ? { status: 'pass' } : { status: 'fail', reasonCode: 'subject-mismatch', detail: `${i.identifier} is not ${i.passportId}` }
  const gtin = (u: string): string | undefined => /\/01\/(\d{14})/.exec(u)?.[1]
  return gtin(link) != null && gtin(link) === gtin(i.passportId) ? { status: 'pass', detail: 'the class carries the passport\'s GTIN' } : { status: 'fail', reasonCode: 'subject-mismatch', detail: `${i.identifier} is not the class of ${i.passportId}` }
}

export interface VectorOptions {
  schema?: boolean
  comparison?: 'gs1-digital-link'
  authority?: Array<{ issuer: string; role: string; passport_id: string; answer: 'supported' | 'unsupported' }>
  extension_rules_held?: string[]
  anchors_hex?: string[]
  related?: { claims: string[]; complete: boolean }
  expected_passport_id?: string
  expected_event_id?: string
}

export function optionsOf(o: VectorOptions): EpcisLifecycleVerificationOptions {
  return {
    ...(o.schema ? { eventSchemaValidator: pinnedSchemaValidator } : {}),
    ...(o.comparison === 'gs1-digital-link' ? { compareProduct: gs1Comparison } : {}),
    ...(o.authority == null ? {} : {
      authorityResolver: (q): EpcisLifecycleAuthorityAnswer => {
        const hit = o.authority!.find((a) => a.issuer === q.issuer && a.role === q.role && a.passport_id === q.passportId)
        return hit == null ? { status: 'unavailable', detail: 'the resolver holds no evidence for this question' } : { status: hit.answer }
      },
    }),
    ...(o.extension_rules_held == null ? {} : { extensionRules: Object.fromEntries(o.extension_rules_held.map((rule) => [rule, (): PartialCheck => ({ status: 'pass' })])) }),
    ...(o.anchors_hex == null ? {} : { anchors: o.anchors_hex.map((lockingScript) => ({ lockingScript })) }),
    ...(o.related == null ? {} : { related: o.related }),
    ...(o.expected_passport_id == null && o.expected_event_id == null ? {} : { expected: { ...(o.expected_passport_id == null ? {} : { passportId: o.expected_passport_id }), ...(o.expected_event_id == null ? {} : { eventId: o.expected_event_id }) } }),
  }
}

const pick = (f: { status: string; reasonCode?: string }): Record<string, unknown> => ({ status: f.status, ...(f.reasonCode == null ? {} : { reason_code: f.reasonCode }) })

export function expectedOf(v: EpcisLifecycleVerification): Record<string, unknown> {
  const f = v.findings
  return {
    digest_hex: v.digest,
    ...(v.attestationId == null ? {} : { attestation_id: v.attestationId }),
    ...(v.eventId == null ? {} : { event_id: v.eventId }),
    ...(v.eventType == null ? {} : { event_type: v.eventType }),
    findings: {
      event_structure: pick(f.eventStructure), event_semantics: pick(f.eventSemantics), product_binding: pick(f.productBinding), signature: pick(f.signature),
      authority: pick(f.authority), possession: { ...pick(f.possession), from: f.possession.from, to: f.possession.to }, ownership: { ...pick(f.ownership), from: f.ownership.from, to: f.ownership.to },
      anchor_commitment: pick(f.anchorCommitment), inclusion: pick(f.inclusion), correction: pick(f.correction),
    },
    bound_passports: v.boundPassports,
    item_participants: v.itemParticipants,
    bindings: v.bindings.map((b) => ({ passport_id: b.passportId, field: b.field, identifier: b.identifier, level: b.level, ...pick(b) })),
    extensions: v.extensions,
    terms: v.terms,
    ...(v.relations.length === 0 ? {} : { relations: v.relations.map((r) => ({ digest_hex: r.digest, relation: r.relation })) }),
  }
}

export async function runVector(claim: string, options: VectorOptions): Promise<EpcisLifecycleVerification> {
  return verifyEpcisLifecycleClaim(claim, optionsOf(options))
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

interface Case { id: string; description: string; claim: string; options: VectorOptions; tags: string[] }
interface Refusal { id: string; description: string; claim: EpcisLifecycleClaim; tags: string[] }

const FULL = (who: Signer, passports: string[], role = 'observer'): VectorOptions => ({ schema: true, comparison: 'gs1-digital-link', authority: passports.map((p) => ({ issuer: who.issuer, role, passport_id: p, answer: 'supported' as const })) })

export async function lifecycleClaims() {
  const c = {
    commissioning: await issue(S.maker, input(S.maker, EVENTS.commissioning, [bind(P.battery, 'epcList', ID.battery)], { extensionContexts: [EXT] })),
    manufacturing: await issue(S.maker, input(S.maker, EVENTS.manufacturing, [
      bind(P.battery2, 'outputEPCList', ID.battery2), bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleB, 'inputEPCList', ID.moduleB), bind(P.cell, 'inputQuantityList', ID.cellLot, 'class'),
    ], { authorityScope: [P.battery2, P.moduleA, P.moduleB] })),
    shipping: await issue(S.maker, input(S.maker, EVENTS.shipping, [bind(P.battery, 'epcList', ID.battery)])),
    receiving: await issue(S.retailer, input(S.retailer, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)])),
    packing: await issue(S.maker, input(S.maker, EVENTS.packing, [bind(P.battery, 'childEPCs', ID.battery)])),
    unpacking: await issue(S.retailer, input(S.retailer, EVENTS.unpacking, [bind(P.battery, 'childEPCs', ID.battery)])),
    assembly: await issue(S.maker, input(S.maker, EVENTS.assembly, [bind(P.battery, 'childEPCs', ID.battery)])),
    repair: await issue(S.repairer, input(S.repairer, EVENTS.repair, [bind(P.battery, 'epcList', ID.battery)])),
    moduleRemoved: await issue(S.repairer, input(S.repairer, EVENTS.moduleRemoved, [bind(P.battery2, 'parentID', ID.battery2), bind(P.moduleB, 'childEPCs', ID.moduleB)])),
    moduleInstalled: await issue(S.repairer, input(S.repairer, EVENTS.moduleInstalled, [bind(P.battery2, 'parentID', ID.battery2), bind(P.moduleC, 'childEPCs', ID.moduleC)])),
    inspection: await issue(S.repairer, input(S.repairer, EVENTS.inspection, [bind(P.battery, 'epcList', ID.battery)])),
    purchaseOrder: await issue(S.retailer, input(S.retailer, EVENTS.purchaseOrder, [bind(P.battery, 'epcList', ID.battery)])),
    ownershipAndPossession: await issue(S.maker, input(S.maker, EVENTS.ownershipAndPossession, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'owner' })),
    sensor: await issue(S.carrier, input(S.carrier, EVENTS.sensor, [bind(P.battery, 'epcList', ID.battery)])),
    possessionOnly: await issue(S.carrier, input(S.carrier, EVENTS.possessionOnly, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'custodian' })),
    saleLabel: await issue(S.retailer, input(S.retailer, EVENTS.saleLabel, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'owner' })),
    collection: await issue(S.recycler, input(S.recycler, EVENTS.collection, [bind(P.battery2, 'epcList', ID.battery2)], { assertedRole: 'custodian' })),
    disassembly: await issue(S.recycler, input(S.recycler, EVENTS.disassembly, [bind(P.battery2, 'parentID', ID.battery2), bind(P.moduleA, 'childEPCs', ID.moduleA), bind(P.moduleC, 'childEPCs', ID.moduleC)])),
    shredding: await issue(S.recycler, input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleC, 'inputEPCList', ID.moduleC)], { requiredExtensions: [SHREDDING_RULE] })),
    endOfLife: await issue(S.recycler, input(S.recycler, EVENTS.endOfLife, [bind(P.battery2, 'epcList', ID.battery2)])),
  }
  const importedSource = { relation: 'imported' as const, sourceDigest: 'c1'.repeat(32), mediaType: 'application/json' as const, eventPointer: '/epcisBody/eventList/0', localEventIdentity: `urn:bsv:dpp:epcis:local-event:sha256:${'c2'.repeat(32)}`, sourceParty: PARTY.maker }
  const n = {
    // Product binding.
    wrongPassport: await signUnchecked(S.maker, unchecked(input(S.maker, EVENTS.shipping, [bind(P.battery2, 'epcList', ID.battery)]))),
    identifierAbsent: await signUnchecked(S.maker, unchecked(input(S.maker, EVENTS.shipping, [bind(P.battery2, 'epcList', ID.battery2)]))),
    classAsItem: await signUnchecked(S.maker, unchecked(input(S.maker, EVENTS.manufacturing, [bind(P.cell, 'inputQuantityList', ID.cellLot, 'instance')]))),
    lotInEpcList: await signUnchecked(S.maker, unchecked(input(S.maker, { ...EVENTS.receiving, epcList: [ID.cellLot] }, [bind(P.cell, 'epcList', ID.cellLot)]))),
    // Context and profile digest bindings, signed after the change.
    contextDigest: await signUnchecked(S.maker, { ...unchecked(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)])), eventContext: [{ iri: EPCIS_LIFECYCLE_CONTEXT.iri, sha256: 'ee'.repeat(32) }] }),
    profileDigest: await signUnchecked(S.maker, { ...unchecked(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)])), eventSchema: { uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json', sha256: 'ef'.repeat(32) } }),
    // Event identity.
    noEventId: await signUnchecked(S.maker, unchecked(input(S.maker, (({ eventID: _e, ...rest }) => rest)(EVENTS.receiving), [bind(P.battery, 'epcList', ID.battery)]))),
    digestAsCbvHash: await signUnchecked(S.importer, unchecked(input(S.importer, { ...EVENTS.receiving, eventID: `ni:///sha-256;${'c1'.repeat(32)}?ver=CBV2.0` }, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'authorised-reporter', source: importedSource }))),
    localIdentityAsEventId: await signUnchecked(S.importer, unchecked(input(S.importer, { ...EVENTS.receiving, eventID: importedSource.localEventIdentity }, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'authorised-reporter', source: importedSource }))),
    // Authority.
    importerAsObserver: await signUnchecked(S.importer, unchecked(input(S.importer, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)], { source: importedSource }))),
    importerAsReporter: await issue(S.importer, input(S.importer, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'authorised-reporter', source: importedSource })),
    ownerContradicted: await signUnchecked(S.carrier, unchecked(input(S.carrier, EVENTS.ownershipAndPossession, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'owner' }))),
    scopeWithoutBinding: await signUnchecked(S.maker, unchecked(input(S.maker, EVENTS.shipping, [bind(P.battery, 'epcList', ID.battery)], { authorityScope: [P.battery, P.battery2] }))),
    // Duplicates, conflicts and corrections.
    conflictingReceipt: await issue(S.retailer, input(S.retailer, { ...EVENTS.receiving, readPoint: { id: PLACE.warehouse }, bizLocation: { id: PLACE.warehouse } }, [bind(P.battery, 'epcList', ID.battery)])),
    restatedReceipt: await issue(S.retailer, input(S.retailer, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: at(5, 12) })),
    secondObserverReceipt: await issue(S.carrier, input(S.carrier, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)])),
    inspectionDeclaredInError: await issue(S.repairer, input(S.repairer, { ...EVENTS.inspection, errorDeclaration: { declarationTime: at(12, 9), reason: 'incorrect_data', correctiveEventIDs: [uuid(111)] } }, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: at(12, 10) })),
    correctiveInspection: await issue(S.repairer, input(S.repairer, { ...EVENTS.inspection, eventID: uuid(111), disposition: 'non_conformant' }, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: at(12, 10) })),
    declarationByAnother: await issue(S.carrier, input(S.carrier, { ...EVENTS.inspection, errorDeclaration: { declarationTime: at(12, 9), reason: 'did_not_occur' } }, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: at(12, 10) })),
    malformedDeclaration: await signUnchecked(S.repairer, unchecked(input(S.repairer, { ...EVENTS.inspection, errorDeclaration: { reason: 'incorrect_data' } }, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: at(12, 10) }))),
    // Extensions.
    shreddingWithoutRule: await signUnchecked(S.recycler, unchecked(input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleC, 'inputEPCList', ID.moduleC)]))),
  }
  return { c, n }
}

export async function lifecycleEventVectors(): Promise<Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> }> {
  const { c, n } = await lifecycleClaims()
  const anchors = (await buildEpcisLifecycleAnchors(c.manufacturing, ANCHOR_SERVICE.identityKey, ANCHOR_SERVICE.wallet)).map((s) => s.toHex())
  // Anchors another service wrote under the manufacturing claim's identifier: one about a passport the claim does not bind, one that names a bound passport with another attestation type.
  const secondService = epcisLifecycleAnchorMetadata(c.manufacturing, SECOND_ANCHOR_SERVICE.identityKey)
  const strayAnchor = (await buildAttestationAnchor({ ...secondService[0]!, subject: P.battery }, SECOND_ANCHOR_SERVICE.wallet)).toHex()
  const mismatchedAnchor = (await buildAttestationAnchor({ ...secondService.find((m) => m.subject === P.moduleA)!, attestationType: 'ObjectEvent' }, SECOND_ANCHOR_SERVICE.wallet)).toHex()
  const altered = text(c.commissioning).replace('"bizStep":"commissioning"', '"bizStep":"decommissioning"')
  const spaced = text(c.commissioning).replace(/^\{/, '{ ')

  const cases: Case[] = [
    { id: 'object-event-commissioning', tags: ['happy-path'], description: 'Creation: an ObjectEvent ADD with the CBV business step commissioning, signed by the maker as observer, with two extension members in ilmd under an inline prefix declaration. Every finding the verifier can establish passes; possession and ownership are not asserted; no anchor, inclusion evidence or related claim was supplied.', claim: text(c.commissioning), options: FULL(S.maker, [P.battery]) },
    { id: 'transformation-event-manufacturing', tags: ['happy-path'], description: 'Manufacturing: a TransformationEvent with no action, consuming two module instances and a quantity of a cell lot and producing the battery. Three item participants; the cell passport is bound at class level through the lot and is not an item participant. The anchors are one per bound passport, in one set, by the anchoring service.', claim: text(c.manufacturing), options: { ...FULL(S.maker, [P.battery2, P.moduleA, P.moduleB]), anchors_hex: anchors } },
    { id: 'object-event-shipping', tags: ['happy-path'], description: 'Shipping: an ObjectEvent OBSERVE with location source and destination. No party role is named, so neither possession nor ownership is asserted, and nothing implies a sale.', claim: text(c.shipping), options: FULL(S.maker, [P.battery]) },
    { id: 'object-event-receiving', tags: ['happy-path'], description: 'Receiving: an ObjectEvent OBSERVE at the shop, signed by the retailer.', claim: text(c.receiving), options: FULL(S.retailer, [P.battery]) },
    { id: 'aggregation-event-packing', tags: ['happy-path'], description: 'Packing: an AggregationEvent ADD with its parent pallet and the battery as a child.', claim: text(c.packing), options: FULL(S.maker, [P.battery]) },
    { id: 'aggregation-event-unpacking', tags: ['happy-path'], description: 'Unpacking: an AggregationEvent DELETE.', claim: text(c.unpacking), options: FULL(S.retailer, [P.battery]) },
    { id: 'association-event-assembly', tags: ['happy-path'], description: 'Assembly: an AssociationEvent ADD with the business step assembling, the battery as a recognisable component of the e-bike.', claim: text(c.assembly), options: FULL(S.maker, [P.battery]) },
    { id: 'object-event-repair', tags: ['happy-path'], description: 'Identity-preserving repair: an ObjectEvent OBSERVE with the business step repairing. The battery keeps its identity; no new product is asserted.', claim: text(c.repair), options: FULL(S.repairer, [P.battery]) },
    { id: 'association-event-component-removed', tags: ['happy-path'], description: 'Reversible component association, first half: an AssociationEvent DELETE removing a module from the battery.', claim: text(c.moduleRemoved), options: FULL(S.repairer, [P.battery2, P.moduleB]) },
    { id: 'association-event-component-installed', tags: ['happy-path'], description: 'Reversible component association, second half: an AssociationEvent ADD installing the replacement module.', claim: text(c.moduleInstalled), options: FULL(S.repairer, [P.battery2, P.moduleC]) },
    { id: 'object-event-inspection', tags: ['happy-path'], description: 'Inspection: an ObjectEvent OBSERVE with the business step inspecting and a linked test result as a business transaction of type testres.', claim: text(c.inspection), options: FULL(S.repairer, [P.battery]) },
    { id: 'transaction-event-purchase-order', tags: ['happy-path'], description: 'A business-transaction association: a TransactionEvent ADD associating the battery with a purchase order, not a sale.', claim: text(c.purchaseOrder), options: FULL(S.retailer, [P.battery]) },
    { id: 'separate-ownership-and-possession', tags: ['happy-path'], description: 'Separate roles: ownership passes from the maker to the retailer while possession passes from the maker to the carrier. The maker signs as owner, and its party is among the owning parties. Each role is its own finding.', claim: text(c.ownershipAndPossession), options: FULL(S.maker, [P.battery], 'owner') },
    { id: 'sensor-observation', tags: ['happy-path'], description: 'A sensor observation: an ObjectEvent OBSERVE with the business step sensor_reporting and a sensorElementList whose decimal readings are carried exactly by RFC 8785.', claim: text(c.sensor), options: FULL(S.carrier, [P.battery]) },
    { id: 'possession-without-ownership', tags: ['happy-path'], description: 'Possession without ownership: the carrier, signing as custodian, hands the battery to the retailer. Possession is asserted; ownership is not, and is not inferred.', claim: text(c.possessionOnly), options: FULL(S.carrier, [P.battery], 'custodian') },
    { id: 'sale-label-asserts-no-ownership', tags: ['happy-path'], description: 'A retail sale observed at the till, signed by the retailer as owner: the business step retail_selling and the disposition retail_sold assert no ownership, so the ownership finding is not-asserted whatever the role.', claim: text(c.saleLabel), options: FULL(S.retailer, [P.battery], 'owner') },
    { id: 'recycling-1-collection', tags: ['happy-path'], description: 'Recycling, step 1 of 4: the recycler collects the battery as custodian; possession passes from the retailer to the recycler.', claim: text(c.collection), options: FULL(S.recycler, [P.battery2], 'custodian') },
    { id: 'recycling-2-disassembly', tags: ['happy-path'], description: 'Recycling, step 2 of 4: an AssociationEvent DELETE disassembling the battery into its two modules; the same identifiers link it to step 1.', claim: text(c.disassembly), options: FULL(S.recycler, [P.battery2, P.moduleA, P.moduleC]) },
    { id: 'recycling-3-shredding-with-rule', tags: ['happy-path'], description: 'Recycling, step 3 of 4: a TransformationEvent consuming the two modules into a quantity of recovered material. Pinned CBV 2.0 has no recycling step, so the business step is an extension term, reported as one, under a required extension rule the verifier holds. The material is a class: no item participates through it.', claim: text(c.shredding), options: { ...FULL(S.recycler, [P.moduleA, P.moduleC]), extension_rules_held: [SHREDDING_RULE] } },
    { id: 'recycling-3-shredding-rule-unavailable', tags: ['error-case'], description: 'The same claim read by a verifier that does not hold the required extension rule: event semantics is unavailable, never passed.', claim: text(c.shredding), options: FULL(S.recycler, [P.moduleA, P.moduleC]) },
    { id: 'recycling-4-end-of-life', tags: ['happy-path'], description: 'Recycling, step 4 of 4: an ObjectEvent DELETE decommissioning the battery identity.', claim: text(c.endOfLife), options: FULL(S.recycler, [P.battery2]) },
    { id: 'without-caller-evidence', tags: ['error-case'], description: 'The commissioning claim with nothing from the caller: the signature passes, and the schema, product comparison and authority stay unknown or unavailable, never passed.', claim: text(c.commissioning), options: {} },
    { id: 'extension-term-without-rule', tags: ['error-case'], description: 'The same shredding event in a claim that lists no extension rule, read by a verifier that holds the shredding rule: the extension business step has no rule to be checked by, so event semantics is unavailable. An issuer does not get the semantics passed by leaving the rule out.', claim: text(n.shreddingWithoutRule), options: { ...FULL(S.recycler, [P.moduleA, P.moduleC]), extension_rules_held: [SHREDDING_RULE] } },
    { id: 'binding-to-another-passport', tags: ['error-case'], description: 'Incorrect product binding: the battery identifier bound to another passport. The identifier is where the binding says, and the comparison fails it.', claim: text(n.wrongPassport), options: FULL(S.maker, [P.battery2]) },
    { id: 'binding-identifier-absent', tags: ['error-case'], description: 'Incorrect product binding, signed without the issuance rules: the bound identifier is not in the field the binding names.', claim: text(n.identifierAbsent), options: FULL(S.maker, [P.battery2]) },
    { id: 'class-reference-as-item', tags: ['error-case'], description: 'A class-level reference standing in for an item: an instance binding through a quantity list. Refused as binding; no participation is fabricated.', claim: text(n.classAsItem), options: FULL(S.maker, [P.cell]) },
    { id: 'lot-in-epc-list-as-item', tags: ['error-case'], description: 'A lot identifier carried in epcList and bound as an instance: the identifier itself names a class, so it cannot stand in for an item.', claim: text(n.lotInEpcList), options: FULL(S.maker, [P.cell]) },
    { id: 'altered-secured-bytes', tags: ['error-case'], description: 'The commissioning claim with its business step changed after signing: still canonical, and the signature fails.', claim: altered, options: FULL(S.maker, [P.battery]) },
    { id: 'non-canonical-bytes', tags: ['error-case'], description: 'The commissioning claim with one space inserted: not the RFC 8785 form of its own parse, so nothing it says is read.', claim: spaced, options: FULL(S.maker, [P.battery]) },
    { id: 'altered-context-digest', tags: ['error-case'], description: 'The pinned context bound under another digest, signed after the change: the signature holds and the structure fails on the context binding.', claim: text(n.contextDigest), options: FULL(S.maker, [P.battery]) },
    { id: 'altered-profile-digest', tags: ['error-case'], description: 'The event profile bound under another digest, signed after the change: the structure fails on the profile binding.', claim: text(n.profileDigest), options: FULL(S.maker, [P.battery]) },
    { id: 'event-id-not-expected', tags: ['error-case'], description: 'The receiving claim read by a caller expecting another eventID.', claim: text(c.receiving), options: { ...FULL(S.retailer, [P.battery]), expected_event_id: uuid(999) } },
    { id: 'event-id-missing', tags: ['error-case'], description: 'An event without its eventID: the claim never mints one.', claim: text(n.noEventId), options: FULL(S.maker, [P.battery]) },
    { id: 'source-digest-relabelled-as-cbv-hash', tags: ['error-case'], description: 'An importer presents the source document digest as a CBV 2.0 Event Hash ID in eventID. No CBV hash is selected, and a digest is never relabelled as one.', claim: text(n.digestAsCbvHash), options: FULL(S.importer, [P.battery], 'authorised-reporter') },
    { id: 'local-identity-as-event-id', tags: ['error-case'], description: 'An importer presents its source-scoped import identity as the eventID.', claim: text(n.localIdentityAsEventId), options: FULL(S.importer, [P.battery], 'authorised-reporter') },
    { id: 'valid-signature-unsupported-authority', tags: ['error-case'], description: 'The repair claim with a resolver that does not support the repairer as observer for this passport: the signature passes and the authority is refused.', claim: text(c.repair), options: { schema: true, comparison: 'gs1-digital-link', authority: [{ issuer: S.repairer.issuer, role: 'observer', passport_id: P.battery, answer: 'unsupported' }] } },
    { id: 'importer-signing-as-observer', tags: ['error-case'], description: 'An importer signs an event its source link says came from the maker, as observer: refused as contradictory, whatever a resolver says.', claim: text(n.importerAsObserver), options: FULL(S.importer, [P.battery]) },
    { id: 'importer-as-authorised-reporter', tags: ['happy-path'], description: 'The same imported event signed by the importer as authorised-reporter, with the source link and its digest kept beside the event and distinct from the eventID.', claim: text(n.importerAsReporter), options: FULL(S.importer, [P.battery], 'authorised-reporter') },
    { id: 'owner-contradicted-by-party-roles', tags: ['error-case'], description: 'The carrier signs as owner an event whose owning parties are the maker and the retailer: refused as contradictory party roles.', claim: text(n.ownerContradicted), options: FULL(S.carrier, [P.battery], 'owner') },
    { id: 'authority-scope-without-binding', tags: ['error-case'], description: 'An authority scope naming a passport no binding names: refused.', claim: text(n.scopeWithoutBinding), options: FULL(S.maker, [P.battery, P.battery2]) },
    { id: 'duplicate-and-conflicting-observations', tags: ['error-case'], description: 'The receiving claim read beside itself (the same claim), a claim by the same issuer under the same eventID with another body (a conflict, never merged), the same body in other bytes (a restatement) and another issuer\'s claim of the same event (its own attestation).', claim: text(c.receiving), options: { ...FULL(S.retailer, [P.battery]), related: { claims: [text(c.receiving), text(n.conflictingReceipt), text(n.restatedReceipt), text(n.secondObserverReceipt)], complete: true } } },
    { id: 'error-declaration-applies', tags: ['happy-path'], description: 'The inspection claim with its issuer\'s error declaration and the corrective inspection among the related claims: the correction state is declared-in-error, naming the corrective claim; the original is unaltered.', claim: text(c.inspection), options: { ...FULL(S.repairer, [P.battery]), related: { claims: [text(n.inspectionDeclaredInError), text(n.correctiveInspection)], complete: true } } },
    { id: 'error-declaration-itself', tags: ['happy-path'], description: 'The declaration is its own claim, carrying the original eventID and the errorDeclaration; it verifies, and its own correction state is declared-in-error.', claim: text(n.inspectionDeclaredInError), options: FULL(S.repairer, [P.battery]) },
    { id: 'error-declaration-by-another-issuer', tags: ['error-case'], description: 'Another issuer declares the inspection in error, and no resolver supports it: the correction state stays unknown.', claim: text(c.inspection), options: { ...FULL(S.repairer, [P.battery]), related: { claims: [text(n.declarationByAnother)], complete: true } } },
    { id: 'error-declaration-by-unsound-claim', tags: ['error-case'], description: 'The original issuer signs a declaration whose errorDeclaration lacks its declaration time, so the declaring claim fails its own event structure. It declares nothing in error, and because it is not passed over as absent, the correction state is unknown, not none.', claim: text(c.inspection), options: { ...FULL(S.repairer, [P.battery]), related: { claims: [text(n.malformedDeclaration)], complete: true } } },
    { id: 'no-declaration-in-a-complete-set', tags: ['happy-path'], description: 'The inspection read beside a complete set that holds no declaration for it: the correction state is none.', claim: text(c.inspection), options: { ...FULL(S.repairer, [P.battery]), related: { claims: [text(n.correctiveInspection)], complete: true } } },
    { id: 'anchor-about-unbound-subject', tags: ['happy-path'], description: 'The manufacturing claim with its four anchors and a fifth, by another anchoring service under the same identifier, about a passport the claim does not bind. The fifth is set aside: the anchor commitment passes for the bound passports.', claim: text(c.manufacturing), options: { ...FULL(S.maker, [P.battery2, P.moduleA, P.moduleB]), anchors_hex: [...anchors, strayAnchor] } },
    { id: 'anchor-about-unbound-subject-read-from-it', tags: ['error-case'], description: 'The same claim and anchors read by a caller that expects the passport the fifth anchor names. The claim does not bind that passport, so the binding fails and so does the anchor commitment, on the one anchor that names it.', claim: text(c.manufacturing), options: { ...FULL(S.maker, [P.battery2, P.moduleA, P.moduleB]), anchors_hex: [...anchors, strayAnchor], expected_passport_id: P.battery } },
    { id: 'anchor-mismatch-on-bound-passport', tags: ['error-case'], description: 'The manufacturing claim with its four anchors and a fifth that names a bound passport, module A, under another attestation type: a mismatch on an anchor that names a bound passport fails the anchor commitment.', claim: text(c.manufacturing), options: { ...FULL(S.maker, [P.battery2, P.moduleA, P.moduleB]), anchors_hex: [...anchors, mismatchedAnchor] } },
    { id: 'anchor-mismatch-on-another-bound-passport', tags: ['happy-path'], description: 'The same claim and anchors read by a caller that expects the battery passport: each passport is judged on the anchors that name it, so the mismatched anchor for module A does not fail the battery.', claim: text(c.manufacturing), options: { ...FULL(S.maker, [P.battery2, P.moduleA, P.moduleB]), anchors_hex: [...anchors, mismatchedAnchor], expected_passport_id: P.battery2 } },
  ]

  const refusals: Refusal[] = [
    { id: 'refused-sale-label-without-object', tags: ['error-case'], description: 'An event built only from a token sale: a business step and a disposition, no object. Never issued.', claim: unchecked(input(S.retailer, { type: 'ObjectEvent', ...base(90, 7), epcList: [], action: 'OBSERVE', bizStep: 'retail_selling', disposition: 'retail_sold' }, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'owner' })) },
    { id: 'refused-transformation-from-metadata-edit', tags: ['error-case'], description: 'A physical transformation derived from a metadata edit: a TransformationEvent with no inputs or outputs. Never issued.', claim: unchecked(input(S.maker, { type: 'TransformationEvent', ...base(91, 7), bizStep: 'other' }, [bind(P.battery, 'outputEPCList', ID.battery)])) },
    { id: 'refused-custody-from-token-transfer', tags: ['error-case'], description: 'A custody change derived from a token transfer: party roles and no object. Never issued.', claim: unchecked(input(S.carrier, { type: 'ObjectEvent', ...base(92, 7), action: 'OBSERVE', quantityList: [], sourceList: [{ type: 'possessing_party', source: PARTY.maker }], destinationList: [{ type: 'possessing_party', destination: PARTY.carrier }] }, [bind(P.battery, 'epcList', ID.battery)], { assertedRole: 'custodian' })) },
    { id: 'refused-transformation-with-action', tags: ['error-case'], description: 'A TransformationEvent given an action because other types have one. Never issued.', claim: unchecked(input(S.maker, { ...EVENTS.manufacturing, action: 'ADD' }, [bind(P.battery2, 'outputEPCList', ID.battery2)])) },
    { id: 'refused-aggregation-without-parent', tags: ['error-case'], description: 'An AggregationEvent ADD without its parentID. Never issued.', claim: unchecked(input(S.maker, (({ parentID: _p, ...rest }) => rest)(EVENTS.packing), [bind(P.battery, 'childEPCs', ID.battery)])) },
    { id: 'refused-extension-event-type', tags: ['error-case'], description: 'An event type outside the five. Never issued.', claim: unchecked(input(S.maker, { ...EVENTS.receiving, type: 'ExtendedEvent' }, [bind(P.battery, 'epcList', ID.battery)])) },
    { id: 'refused-importer-as-observer', tags: ['error-case'], description: 'The importer-as-observer claim, refused before signing.', claim: unchecked(input(S.importer, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)], { source: importedSourceOf() })) },
  ]

  const vectors: Array<Record<string, unknown> & { id: string }> = []
  for (const k of cases) {
    const v = await runVector(k.claim, k.options)
    vectors.push({ id: k.id, description: k.description, input: { representation: EPCIS_LIFECYCLE_REPRESENTATION, media_type: EPCIS_LIFECYCLE_MEDIA_TYPE, claim: k.claim, options: k.options }, expected: expectedOf(v), tags: k.tags })
  }
  for (const r of refusals) {
    let refused = false
    let reasons: string[] = []
    try { assertEpcisLifecycleClaim(r.claim) } catch (cause) { refused = true; reasons = [...new Set([...(cause as Error).message.matchAll(/(x-[a-z-]+|schema-invalid):/g)].map((m) => m[1]))] }
    vectors.push({ id: r.id, description: r.description, input: { unsigned_claim: r.claim, operation: 'issue' }, expected: { refused, reason_codes: reasons }, tags: r.tags })
  }

  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.epcis-lifecycle.v1',
    name: 'DPP EPCIS lifecycle claim dpp-epcis-lifecycle@1: one EPCIS 2.0.1 event in a signed envelope over RFC 8785 bytes, with its findings kept separate',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-protocol@0.3.0',
    parity_class: 'required',
    notes: 'Each claim is the exact RFC 8785 text of the signed envelope; digest_hex is SHA-256 over its UTF-8 bytes and attestation_id is urn:sha256: and that digest. Signers derive their key under [1, "dpp epcis lifecycle v1"], key identifier "event", counterparty anyone; each issuer is the did:key of the identity key whose scalar is published under keys, and nothing derived from these scalars will ever hold value. Options are data: schema applies the pinned EPCIS 2.0.1 JSON schema to the event inside a minimal EPCISDocument; comparison "gs1-digital-link" passes an instance binding whose identifier\'s canonical GS1 Digital Link is the passport identifier and a class binding whose class carries the passport\'s GTIN; authority lists the (issuer, role, passport_id) triples a resolver answers, every other question being unavailable; extension_rules_held names the rules the verifier holds, each passing; anchors_hex are anchor locking scripts; related lists other claims with whether the set is complete; expected_passport_id and expected_event_id are the passport and the event the caller expects. An issue vector names the reasons buildEpcisLifecycleClaim refuses with.',
    keys: Object.fromEntries([...Object.values(S).map((s) => [s.name, { identity_private_key_hex: s.scalar, identity_key_hex: s.identityKey, issuer: s.issuer, party: s.party }]), ['anchoring_service', { identity_private_key_hex: ANCHOR_SERVICE.scalar, identity_key_hex: ANCHOR_SERVICE.identityKey }], ['second_anchoring_service', { identity_private_key_hex: SECOND_ANCHOR_SERVICE.scalar, identity_key_hex: SECOND_ANCHOR_SERVICE.identityKey }]]),
    vectors,
  }
}

function importedSourceOf() {
  return { relation: 'imported' as const, sourceDigest: 'c1'.repeat(32), mediaType: 'application/json' as const, eventPointer: '/epcisBody/eventList/0', localEventIdentity: `urn:bsv:dpp:epcis:local-event:sha256:${'c2'.repeat(32)}`, sourceParty: PARTY.maker }
}
