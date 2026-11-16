// EPCIS lifecycle claims through the application: issued from EPCIS event
// data over the API, read back from each passport they bind, anchored by a
// registry once per bound passport, and found again by those anchors. The
// claim's findings are reported one by one, and the words the web page puts
// on them are held to the answers here.
//
// The old way, a native claim with one of four event types picked for a
// passport, is not reachable from the claim route. A historical native claim
// a deployment still holds reads as before, labelled as historical.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hash, Utils } from '@bsv/sdk'
import { signLifecycleClaim, type LifecycleClaim } from '@bsv/dpp-protocol'
import { verifyEpcisLifecycleClaim } from '@bsv/dpp-credentials/epcis-lifecycle'
import * as claimsModule from '../src/claims.js'
import { compareLifecycleProduct } from '../src/lifecycle.js'
import { mintPassportId } from '../src/identifiers.js'
import { samplePayload } from '../src/profiles.js'
import { HISTORICAL_LABEL, LIFECYCLE_NOTICE, correctionLabel, emptyEventForm, eventFromForm, findingRows, participationLabel, type LifecycleClaimView, type PassportClaimsReading } from '../../web/src/lib/lifecycle'
import { epcisDocument, startApp, testConfig, utf8, type Answer, type TestApp } from './epcis-fixtures.js'
import { PALLET, PARTY, PLACE, base, classOf, sgtinOf, startTestRegistry, type Json, type TestRegistry } from './lifecycle-fixtures.js'

const policy = { host: 'passports.example.com', prefix: '952' }
const P = {
  battery: mintPassportId(policy, '100000001', 'BAT-0001'),
  battery2: mintPassportId(policy, '100000001', 'BAT-0002'),
  moduleA: mintPassportId(policy, '100000002', 'MOD-A'),
  moduleB: mintPassportId(policy, '100000002', 'MOD-B'),
  pack: mintPassportId(policy, '100000003', 'PACK-01'),
  bystander: mintPassportId(policy, '100000004', 'OTHER-01'),
}

let api: TestApp
let registry: TestRegistry
const ref = (passportId: string): string => encodeURIComponent(passportId)
const claimsOf = async (passportId: string): Promise<PassportClaimsReading> => (await api.get(`/api/passports/${ref(passportId)}/claims`)).body as PassportClaimsReading
const issue = async (passportId: string, body: Json): Promise<Answer> => await api.post(`/api/passports/${ref(passportId)}/claims`, body)
const issued = async (passportId: string, body: Json): Promise<LifecycleClaimView> => {
  const answer = await issue(passportId, body)
  expect(answer.status, answer.text).toBe(200)
  return answer.body as LifecycleClaimView
}
const findOn = async (passportId: string, attestationId: string): Promise<LifecycleClaimView | undefined> => (await claimsOf(passportId)).lifecycle.find((c) => c.attestationId === attestationId)

beforeAll(async () => {
  registry = await startTestRegistry(() => ({ url: api.platform.devIndex!.url, submitToken: api.platform.devIndex!.submitToken }))
  api = await startApp({ config: testConfig({ REGISTRY_URL: registry.url }) })
  const brand = api.platform.parties.brand('dev-brand')
  await api.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: brand.identityKey, did: brand.did, createdAt: new Date().toISOString() })
  for (const passportId of Object.values(P)) await api.platform.writer.issue({ brandId: 'dev-brand', brand, passportId, profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
})
afterAll(async () => {
  await api?.close()
  await registry?.close()
})

describe('issuing from EPCIS event data, all five types', () => {
  it('commissioning: an ObjectEvent with ADD, signed by the member as observer, every finding on its own', async () => {
    const event = { type: 'ObjectEvent', ...base(2), epcList: [P.battery], action: 'ADD', bizStep: 'commissioning', disposition: 'active', readPoint: { id: PLACE.factory }, bizLocation: { id: PLACE.factory } }
    const view = await issued(P.battery, { event, assertedRole: 'observer' })
    expect(view).toMatchObject({ claimFormat: 'dpp-epcis-lifecycle@1', eventType: 'ObjectEvent', participation: 'item', foundBy: ['this-application'], held: true, assertedRole: 'observer', authorityScope: [P.battery] })
    expect(view.event).toEqual(event)
    const f = view.findings!
    expect([f.eventStructure.status, f.eventSemantics.status, f.productBinding.status, f.signature.status]).toEqual(['pass', 'pass', 'pass', 'pass'])
    // Nothing here holds authority evidence, and a valid signature is not that evidence.
    expect(f.authority).toMatchObject({ status: 'unavailable', reasonCode: 'authority-unavailable' })
    expect([f.possession.status, f.ownership.status]).toEqual(['not-asserted', 'not-asserted'])
    // Not sent to a registry: no anchor and no inclusion, and they say so.
    expect([f.anchorCommitment.status, f.inclusion.status]).toEqual(['unknown', 'unknown'])
    expect(f.correction.status).toBe('none')
    // The bytes are retrievable exactly, and verify without this application.
    const bytes = await api.get(`/api/lifecycle-claims/${ref(view.attestationId)}`)
    expect(bytes.headers.get('content-type')).toMatch(/^application\/json/)
    expect(`urn:sha256:${Utils.toHex(Hash.sha256(Array.from(bytes.bytes)))}`).toBe(view.attestationId)
    expect((await verifyEpcisLifecycleClaim(bytes.text)).findings.signature.status).toBe('pass')
  })

  it('manufacturing: a TransformationEvent has no action, binds its inputs and output, and reads back from each of them', async () => {
    const event = { type: 'TransformationEvent', ...base(3), inputEPCList: [P.moduleA, sgtinOf(P.moduleB)], outputEPCList: [P.pack], bizStep: 'commissioning', disposition: 'active', readPoint: { id: PLACE.factory } }
    const view = await issued(P.pack, { event, assertedRole: 'observer', submit: true })
    expect(view.event).not.toHaveProperty('action')
    expect(view.boundPassports).toEqual([P.moduleA, P.moduleB, P.pack].sort())
    // The registry anchored the exact bytes once per bound passport, in one transaction.
    expect(view.record?.registry).toMatchObject({ accepted: true, attestationId: view.attestationId })
    expect(registry.anchors.at(-1)!.outputs).toHaveLength(3)
    for (const passportId of [P.moduleA, P.moduleB, P.pack]) {
      const found = await findOn(passportId, view.attestationId)
      expect(found, passportId).toMatchObject({ participation: 'item', foundBy: ['anchor', 'this-application'] })
      expect(found!.findings!.anchorCommitment.status).toBe('pass')
      expect(found!.findings!.anchorCommitment.detail).toMatchObject({ coveredPassports: [P.moduleA, P.moduleB, P.pack].sort(), uncoveredPassports: [] })
      // Nothing in this test is mined, and nothing is said about inclusion.
      expect(found!.findings!.inclusion.status).toBe('unknown')
    }
    // An EPC URN of the module binds the same passport as its Digital Link: the identity rules compare the item, not the spelling.
    expect((await findOn(P.moduleB, view.attestationId))!.bindingsHere).toEqual([expect.objectContaining({ field: 'inputEPCList', identifier: sgtinOf(P.moduleB), level: 'instance', status: 'pass' })])
    // An action on a transformation is refused, as EPCIS 2.0.1 refuses it. Nothing is signed.
    const refused = await issue(P.pack, { event: { ...event, ...base(3), action: 'ADD' }, assertedRole: 'observer' })
    expect(refused.status).toBe(409)
  })

  it('packing: an AggregationEvent keeps the container and its contents, and binds each content passport', async () => {
    const view = await issued(P.battery, { event: { type: 'AggregationEvent', ...base(4), parentID: PALLET, childEPCs: [P.battery, P.battery2], action: 'ADD', bizStep: 'packing', disposition: 'in_progress', readPoint: { id: PLACE.factory } }, assertedRole: 'observer' })
    expect(view.boundPassports).toEqual([P.battery, P.battery2].sort())
    expect((await findOn(P.battery2, view.attestationId))?.participation).toBe('item')
    expect((view.event as Json).parentID).toBe(PALLET)
  })

  it('a TransactionEvent associates the item with a named business transaction, not with a sale', async () => {
    const view = await issued(P.battery, { event: { type: 'TransactionEvent', ...base(5), bizTransactionList: [{ type: 'po', bizTransaction: 'https://example.org/orders/PO-1001' }], epcList: [P.battery], action: 'ADD', bizStep: 'accepting', disposition: 'in_progress' }, assertedRole: 'authorised-reporter' })
    expect(view.eventType).toBe('TransactionEvent')
    expect([view.findings!.ownership.status, view.findings!.possession.status]).toEqual(['not-asserted', 'not-asserted'])
  })

  it('an AssociationEvent records an assembly and binds parent and component', async () => {
    const view = await issued(P.pack, { event: { type: 'AssociationEvent', ...base(6), parentID: P.pack, childEPCs: [P.battery2], action: 'ADD', bizStep: 'assembling', disposition: 'active', readPoint: { id: PLACE.workshop } }, assertedRole: 'observer' })
    expect(view.bindingsHere).toEqual([expect.objectContaining({ field: 'parentID', identifier: P.pack, status: 'pass' })])
    expect((await findOn(P.battery2, view.attestationId))?.bindingsHere).toEqual([expect.objectContaining({ field: 'childEPCs', status: 'pass' })])
  })
})

describe('the representative cases', () => {
  it('shipping with separate owning and possessing roles: possession passes to the carrier, ownership to the retailer, and each is its own finding', async () => {
    const event = {
      type: 'ObjectEvent', ...base(7), epcList: [P.battery], action: 'OBSERVE', bizStep: 'shipping', disposition: 'in_transit', readPoint: { id: PLACE.factory },
      sourceList: [{ type: 'owning_party', source: PARTY.maker }, { type: 'possessing_party', source: PARTY.maker }],
      destinationList: [{ type: 'owning_party', destination: PARTY.retailer }, { type: 'possessing_party', destination: PARTY.carrier }],
    }
    const view = await issued(P.battery, { event, assertedRole: 'custodian', issuerParty: PARTY.carrier })
    expect(view.findings!.possession).toMatchObject({ status: 'asserted', from: [PARTY.maker], to: [PARTY.carrier] })
    expect(view.findings!.ownership).toMatchObject({ status: 'asserted', from: [PARTY.maker], to: [PARTY.retailer] })
    // The carrier's role is stated by the event, and nothing here supports it: unavailable, never supported.
    expect(view.findings!.authority.status).toBe('unavailable')
    // A custodian whose party the event does not name as possessing is refused before anything is signed.
    const contradicted = await issue(P.battery, { event: { ...event, ...base(7) }, assertedRole: 'custodian', issuerParty: PARTY.repairer })
    expect([contradicted.status, contradicted.body.error]).toEqual([409, 'claim-refused'])
    expect(contradicted.body.description).toContain('x-party-role-contradicted')
  })

  it('possession without ownership: receiving by a carrier asserts possession and says nothing of ownership', async () => {
    const view = await issued(P.battery, { event: { type: 'ObjectEvent', ...base(8), epcList: [P.battery], action: 'OBSERVE', bizStep: 'receiving', disposition: 'in_progress', readPoint: { id: PLACE.shop }, sourceList: [{ type: 'possessing_party', source: PARTY.carrier }], destinationList: [{ type: 'possessing_party', destination: PARTY.retailer }] }, assertedRole: 'observer' })
    expect(view.findings!.possession.status).toBe('asserted')
    expect(view.findings!.ownership.status).toBe('not-asserted')
    const rows = findingRows(view.findings!)
    expect(rows.find((r) => r.key === 'ownership')!.sentence).toContain('Nothing about ownership is inferred from possession')
  })

  it('repair without a new product: the same item is observed, no passport is created and the passport is not written', async () => {
    const before = await api.platform.store.listPassports()
    const journal = JSON.stringify(await api.platform.store.getPassport(P.battery))
    const view = await issued(P.battery, { event: { type: 'ObjectEvent', ...base(9), epcList: [P.battery], action: 'OBSERVE', bizStep: 'repairing', disposition: 'active', readPoint: { id: PLACE.workshop } }, assertedRole: 'observer' })
    expect(view.boundPassports).toEqual([P.battery])
    expect((await api.platform.store.listPassports()).length).toBe(before.length)
    // A claim is on its own rail: the passport's journal is as it was.
    expect(JSON.stringify(await api.platform.store.getPassport(P.battery))).toBe(journal)
  })

  it('a sensor observation keeps its decimal readings byte for byte', async () => {
    const sensorElementList = [{ sensorMetadata: { time: '2026-03-10T04:00:00.000Z' }, sensorReport: [{ type: 'Temperature', value: 21.5, uom: 'CEL' }, { type: 'Temperature', minValue: -3.75, maxValue: 38.125, uom: 'CEL' }] }]
    const view = await issued(P.battery, { event: { type: 'ObjectEvent', ...base(10), epcList: [P.battery], action: 'OBSERVE', bizStep: 'sensor_reporting', readPoint: { id: PLACE.warehouse }, sensorElementList }, assertedRole: 'observer' })
    expect((view.event as Json).sensorElementList).toEqual(sensorElementList)
    expect((await api.get(`/api/lifecycle-claims/${ref(view.attestationId)}`)).text).toContain('"maxValue":38.125')
  })

  it('a class-level reference binds at class level only, and is never shown as the item taking part', async () => {
    const view = await issued(P.pack, { event: { type: 'ObjectEvent', ...base(11), epcList: [P.pack], quantityList: [{ epcClass: classOf(P.battery), quantity: 2, uom: 'H87' }], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant' }, assertedRole: 'observer' })
    // Both batteries share the class, so both are bound at class level; neither is an item participant.
    expect(view.itemParticipants).toEqual([P.pack])
    const onBattery = await findOn(P.battery, view.attestationId)
    expect(onBattery).toMatchObject({ participation: 'class' })
    expect(onBattery!.itemParticipants).not.toContain(P.battery)
    expect(onBattery!.bindingsHere).toEqual([expect.objectContaining({ field: 'quantityList', level: 'class', status: 'pass' })])
    expect(participationLabel(onBattery!).sentence).toContain('does not say this item took part')
    // A class written into a list of individual objects binds nothing, so an event that names only that is refused.
    const classOnly = await issue(P.battery, { event: { type: 'ObjectEvent', ...base(11), epcList: [classOf(P.battery)], action: 'OBSERVE', bizStep: 'inspecting' }, assertedRole: 'observer' })
    expect([classOnly.status, classOnly.body.error]).toEqual([409, 'event-binds-no-passport'])
    expect(classOnly.body.unbound[0].reason).toContain('names a class of products inside a list of individual objects')
    // The comparison itself, as the profiles package's identity rules read it.
    expect(compareLifecycleProduct({ passportId: P.battery, identifier: classOf(P.battery), level: 'instance' }).status).toBe('fail')
    expect(compareLifecycleProduct({ passportId: P.battery, identifier: sgtinOf(P.battery).replace('BAT-0001', 'BAT-9999'), level: 'instance' }).status).toBe('fail')
  })

  it('an imported event is signed with a source link back to the import, and never as the observer', async () => {
    const event = { type: 'ObjectEvent', ...base(12), recordTime: '2026-03-12T10:00:00.000Z', epcList: [P.battery2], action: 'OBSERVE', bizStep: 'receiving', disposition: 'in_progress', 'example:dock': 'D4', readPoint: { id: PLACE.shop } }
    const uploaded = await api.upload('/api/epcis/imports?requestId=lifecycle-import-1', utf8(JSON.stringify(epcisDocument([event]))))
    expect(uploaded.status).toBe(201)
    const record = uploaded.body.record as { importId: string; sha256: string; events: Array<{ pointer: string }> }
    const imported = { importId: record.importId, pointer: record.events[0]!.pointer }
    const asObserver = await issue(P.battery2, { imported, assertedRole: 'observer' })
    expect([asObserver.status, asObserver.body.error]).toEqual([409, 'importer-not-observer'])
    const view = await issued(P.battery2, { imported, assertedRole: 'authorised-reporter' })
    expect(view.source).toMatchObject({ relation: 'imported', sourceDigest: record.sha256, eventPointer: imported.pointer })
    expect(view.record?.importedFrom).toEqual(imported)
    // The event is the one received, extension member and all, read under the document's own prefix.
    expect(view.event).toEqual(event)
    expect(view.findings!.eventStructure.status).toBe('pass')
    // Signing it changed nothing in the exchange: the original is returned byte for byte.
    expect((await api.get(`/api/epcis/imports/${ref(record.importId)}/original`)).text).toBe(JSON.stringify(epcisDocument([event])))
  })

  it('an error declaration is a new claim; the original is kept unchanged and shows as declared in error', async () => {
    const original = await issued(P.battery, { event: { type: 'ObjectEvent', ...base(13), epcList: [P.battery], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'non_conformant', readPoint: { id: PLACE.workshop } }, assertedRole: 'observer' })
    const bytesBefore = (await api.get(`/api/lifecycle-claims/${ref(original.attestationId)}`)).text
    const declaration = await issued(P.battery, { correctionOf: original.attestationId, reason: 'incorrect_data' })
    expect(declaration.declaresError).toBe(true)
    expect((declaration.event as Json).errorDeclaration).toMatchObject({ reason: 'incorrect_data' })
    expect(correctionLabel(declaration)?.label).toBe('Declares an earlier event in error')
    const reread = await findOn(P.battery, original.attestationId)
    expect(reread!.findings!.correction).toMatchObject({ status: 'declared-in-error', detail: expect.objectContaining({ declaredBy: declaration.attestationId }) })
    expect(correctionLabel(reread!)?.label).toBe('Declared in error')
    expect(findingRows(reread!.findings!).find((r) => r.key === 'correction')!.sentence).toContain('kept exactly as it was signed')
    expect((await api.get(`/api/lifecycle-claims/${ref(original.attestationId)}`)).text).toBe(bytesBefore)
    // A second declaration of the declaration is refused.
    expect((await issue(P.battery, { correctionOf: declaration.attestationId })).body.error).toBe('claim-is-declaration')
  })
})

describe('discovery from verified claims', () => {
  it('an anchor that names a passport the claim does not bind makes it no participant', async () => {
    const view = await issued(P.battery, { event: { type: 'ObjectEvent', ...base(14), epcList: [P.battery], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant' }, assertedRole: 'observer', submit: true })
    await registry.anchorUnder(view.attestationId, P.bystander)
    const reading = await claimsOf(P.bystander)
    const found = reading.lifecycle.find((c) => c.attestationId === view.attestationId)
    expect(found).toMatchObject({ foundBy: ['anchor'], held: true, participation: 'not-established', bindingsHere: [] })
    expect(found!.findings!.productBinding).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
    expect(found!.findings!.anchorCommitment.status).toBe('fail')
    expect(participationLabel(found!).sentence).toContain("An anchor's subject alone never makes a passport part of an event")
  })

  it('a claim held only by the registry is found by its anchor and read from the registry\'s bytes', async () => {
    const view = await issued(P.moduleA, { event: { type: 'ObjectEvent', ...base(15), epcList: [P.moduleA], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant' }, assertedRole: 'observer', submit: true })
    // This application forgets it; the registry and the index still hold it.
    const store = api.platform.store as unknown as { claims: Map<string, unknown> }
    store.claims.delete(view.record!.id)
    const found = await findOn(P.moduleA, view.attestationId)
    expect(found).toMatchObject({ foundBy: ['anchor'], held: true, participation: 'item' })
    expect(found!.findings!.anchorCommitment.status).toBe('pass')
    expect(found!.record).toBeUndefined()
  })
})

describe('the cutover from the four categories', () => {
  it('refuses a request for a four-category claim and signs nothing', async () => {
    const count = (await api.platform.store.listClaims()).length
    for (const eventType of ['Origin', 'Transfer', 'Transformation', 'Disposition']) {
      const answer = await issue(P.battery, { eventType })
      expect([answer.status, answer.body.error]).toEqual([400, 'four-category-claims-retired'])
    }
    expect((await api.platform.store.listClaims()).length).toBe(count)
  })

  it('leaves no path from the claim route to the four-category claim: no event-type list, no native signing', () => {
    expect(Object.keys(claimsModule)).not.toContain('EVENT_TYPES')
    expect(Object.keys(claimsModule)).toEqual(expect.arrayContaining(['Claims', 'ASSERTED_ROLES']))
    const src = (file: string): string => readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8')
    for (const file of ['claims.ts', 'server.ts', 'lifecycle.ts']) {
      expect(src(file), file).not.toMatch(/\bsignLifecycleClaim\b|\bLifecycleEventType\b|'Origin'|'Disposition'|mapOperation|eventMappings/)
    }
  })

  it('writes no claim for a passport operation: an update and a hand-on leave the claims as they were', async () => {
    const before = (await api.platform.store.listClaims({ passportId: P.bystander })).length
    expect((await api.post(`/api/passports/${ref(P.bystander)}/update`, { payload: samplePayload('general@2', true) })).status).toBe(200)
    expect((await api.post(`/api/passports/${ref(P.bystander)}/offer`, { terms: { word: 'Sold' } })).status).toBe(200)
    expect((await api.platform.store.listClaims({ passportId: P.bystander })).length).toBe(before)
  })

  it('refuses an event that names none of the passports, and one that does not name the passport it is issued from', async () => {
    const none = await issue(P.battery, { event: { type: 'ObjectEvent', ...base(16), epcList: ['urn:epc:id:sgtin:9521234.012345.NOT-HERE'], action: 'OBSERVE' }, assertedRole: 'observer' })
    expect([none.status, none.body.error]).toEqual([409, 'event-binds-no-passport'])
    const other = await issue(P.battery, { event: { type: 'ObjectEvent', ...base(16), epcList: [P.pack], action: 'OBSERVE' }, assertedRole: 'observer' })
    expect([other.status, other.body.error]).toEqual([409, 'passport-not-bound'])
    const noRole = await issue(P.battery, { event: { type: 'ObjectEvent', ...base(16), epcList: [P.battery], action: 'OBSERVE' } })
    expect([noRole.status, noRole.body.error]).toEqual([400, 'asserted-role-required'])
  })

  it('still reads a historical native claim under its own rules, labelled as historical', async () => {
    const issuer = api.platform.parties.member('before-the-move')
    const tip = (await api.platform.store.getPassport(P.bystander))!.states[0]!
    const claim: LifecycleClaim = { claimFormat: 'dpp-lifecycle-v1', passportId: P.bystander, recordId: `${tip.txid}:${tip.outputIndex}`, eventType: 'Disposition', timestamp: '2026-03-01T00:00:00Z', issuer: issuer.did, issuerKeyId: 'before-the-move', profile: 'general', profile_version: 2 }
    const signed = await signLifecycleClaim(claim, issuer.wallet)
    // A record as this application wrote it before the move: no claimFormat member of its own.
    await api.platform.store.saveClaim({ id: 'claim-historical-1', passportId: P.bystander, issuer: signed.issuer, issuedBy: issuer.name, claim: signed, createdAt: claim.timestamp })
    const reading = await claimsOf(P.bystander)
    expect(reading.historical).toEqual([expect.objectContaining({ claimFormat: 'dpp-lifecycle-v1', historical: true, id: 'claim-historical-1', signature: 'verified', claim: signed })])
    expect(HISTORICAL_LABEL).toBe('Historical native claim')
  })
})

describe('the words the page uses', () => {
  it('reports unknown as unknown and never words an anchor as proof of the event, of ownership or of compliance', async () => {
    const reading = await claimsOf(P.pack)
    const anchored = reading.lifecycle.find((c) => c.findings?.anchorCommitment.status === 'pass')!
    const rows = findingRows(anchored.findings!)
    expect(rows.map((r) => r.key)).toEqual(['eventStructure', 'eventSemantics', 'productBinding', 'signature', 'authority', 'possession', 'ownership', 'anchorCommitment', 'inclusion', 'correction'])
    expect(rows.find((r) => r.key === 'anchorCommitment')!.sentence).toMatch(/not that the event happened, not who owns the product, and not compliance/)
    expect(rows.find((r) => r.key === 'inclusion')).toMatchObject({ status: 'unknown', tone: 'unknown' })
    expect(rows.find((r) => r.key === 'inclusion')!.sentence).toMatch(/^Unknown/)
    expect(rows.find((r) => r.key === 'authority')).toMatchObject({ status: 'unavailable', tone: 'unknown' })
    expect(LIFECYCLE_NOTICE).toContain('Neither proves the event happened')
    for (const row of rows) expect(row.sentence).not.toMatch(/\bproves? (the event|ownership|compliance)\b/)
  })

  it('builds the event the form describes, with no action on a transformation and nothing the member did not enter', () => {
    const form = { ...emptyEventForm(P.battery, new Date('2026-03-20T10:00:00.000Z'), 'urn:uuid:6c000000-0000-4000-8000-0000000000ff'), type: 'TransformationEvent' as const, inputEPCList: `${P.moduleA}\n${P.moduleB}`, outputEPCList: P.pack, bizStep: 'commissioning', outputQuantityList: `${classOf(P.pack)} 2 H87` }
    expect(eventFromForm(form)).toEqual({ event: { type: 'TransformationEvent', eventTime: '2026-03-20T10:00:00.000Z', eventTimeZoneOffset: '+00:00', eventID: 'urn:uuid:6c000000-0000-4000-8000-0000000000ff', inputEPCList: [P.moduleA, P.moduleB], outputEPCList: [P.pack], outputQuantityList: [{ epcClass: classOf(P.pack), quantity: 2, uom: 'H87' }], bizStep: 'commissioning' } })
    const shipping = { ...emptyEventForm(P.battery, new Date('2026-03-20T10:00:00.000Z'), 'urn:uuid:6c000000-0000-4000-8000-0000000000fe'), bizStep: 'shipping', sourceList: `owning_party ${PARTY.maker}\npossessing_party ${PARTY.maker}`, destinationList: `possessing_party ${PARTY.carrier}` }
    expect(eventFromForm(shipping)).toMatchObject({ event: { action: 'OBSERVE', epcList: [P.battery], sourceList: [{ type: 'owning_party', source: PARTY.maker }, { type: 'possessing_party', source: PARTY.maker }], destinationList: [{ type: 'possessing_party', destination: PARTY.carrier }] } })
    expect(eventFromForm({ ...shipping, sensorElementList: '{not json' })).toEqual({ problems: ['the sensor elements are not JSON'] })
  })

  it('issues the event the form builds, through the API', async () => {
    const form = { ...emptyEventForm(P.battery2, new Date('2026-03-21T10:00:00.000Z')), bizStep: 'inspecting', disposition: 'conformant' }
    const built = eventFromForm(form)
    if (!('event' in built)) throw new Error(built.problems.join('; '))
    const view = await issued(P.battery2, { event: built.event, assertedRole: 'observer' })
    expect(view.event).toEqual(built.event)
  })
})
