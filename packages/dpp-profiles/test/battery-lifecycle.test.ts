/**
 * The marked industrial-battery demonstration lifecycle (P09): a synthetic
 * passport under the GS1 demonstration prefix 952, carried from ACTIVATE to
 * RECYCLED through the native record, with a signed native lifecycle claim per
 * state, the conditional mapping of every state (`spec/rules.md` §2) and the
 * one verification report (`spec/verification.md`). No product exists; every
 * value is invented and says so.
 *
 * `fixtures/battery-lifecycle-v1.json` is generated here and held identical to
 * this generator's output; `REGENERATE_FIXTURES=1` rewrites it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Hash, PrivateKey, ProtoWallet, Transaction, Utils } from '@bsv/sdk'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  didKeyFromIdentityKey,
  ownerBlobHash,
  signLifecycleClaim,
  verifyPassportEvidence,
  type LifecycleClaim,
  type LifecycleEventType,
  type SignedLifecycleClaim,
} from '@bsv/dpp-core'
import { idKey, makeData, makerPriv, makerWallet, owner1Priv, owner1Wallet, owner2Priv, owner2Wallet, owner3Priv, owner3Wallet, serverPriv, signedState, stateTx } from '../../dpp-core/test/helpers.js'
import { buildGs1DigitalLink, gs1CheckDigit, isDemonstrationGtin, mapNativeOperation, parseGs1DigitalLink, readManifest, readPublicPayloadSchema, type LifecycleEvidence, type MappingResult, type NativeOperation } from '../src/index.js'

const FIXTURE_PATH = new URL('../../../fixtures/battery-lifecycle-v1.json', import.meta.url)
const CHECKED_AT = '2036-06-02T12:00:00Z'
const battery = readManifest('battery@2')
const stampKeys = new Set(battery.stamps.map((s) => s.key))

// Identifiers: the model's GTIN under the demonstration prefix, its check digit
// computed and never typed, and the item's serial under application identifier 21.
const MODEL_DIGITS = '952100000001'
const GTIN14 = `0${MODEL_DIGITS}${gs1CheckDigit(MODEL_DIGITS)}`
const SERIAL = 'BATT-0001'
const PASSPORT_ID = buildGs1DigitalLink('dpp.bsvb.net', GTIN14, SERIAL)
const OUTPUT_DIGITS = '952100000002'
const OUTPUT_GTIN14 = `0${OUTPUT_DIGITS}${gs1CheckDigit(OUTPUT_DIGITS)}`

const recyclerPriv = PrivateKey.fromHex('66'.repeat(32))
const recyclerWallet = new ProtoWallet(recyclerPriv)
const sha256Ref = (text: string): string => `sha256:${Utils.toHex(Hash.sha256(Utils.toArray(text, 'utf8')))}`
const OWNER_BLOB = [7, 7, 7, 7]

/** The public payload of the ACTIVATE state: every required battery@2 field, synthetic, industrial category. */
const PAYLOAD_V1: Record<string, unknown> = {
  profile: 'battery',
  profile_version: 2,
  notice: 'Demonstration passport: synthetic values under the GS1 demonstration prefix 952. No such product exists.',
  category: 'industrial',
  serial: SERIAL,
  modelName: 'DEMO-IND-48V-100',
  manufacturer: 'Demonstration Battery Works',
  manufacturerContact: 'passport@demo.invalid',
  manufacturingDate: '2026-05-20',
  manufacturingPlace: { site: 'Plant 1, Demonstration Park', country: 'DE' },
  chemistry: 'LFP',
  massKg: 48.5,
  ratedCapacityAh: 100,
  voltageNominal: 51.2,
  voltageMin: 40,
  voltageMax: 58.4,
  cRate: 1,
  powerOriginal: 5000,
  powerMax: 6000,
  expectedCycles: 6000,
  cycleLifeTest: 'IEC 62620 cycle test at 25 degrees, 1C, 80 percent depth of discharge',
  roundTripInitial: 96,
  roundTripAtHalfLife: 92,
  resistanceCell: 0.9,
  resistancePack: 14,
  idleTempLower: -20,
  idleTempUpper: 45,
  warrantyUntil: '2036-05-20',
  carbonFootprint: 61.5,
  carbonRawMaterials: 38.2,
  carbonProduction: 18.1,
  carbonDistribution: 2.7,
  carbonEndOfLife: 2.5,
  carbonClass: 'B',
  carbonStudyUrl: 'https://dpp.bsvb.net/demo/carbon-study',
  renewableShare: 42,
  criticalRawMaterials: ['lithium', 'natural-graphite', 'copper'],
  hazardousSubstances: [{ name: 'Lithium hexafluorophosphate', cas: '21324-40-3', concentration: 1.2 }],
  extinguishingAgent: ['water mist', 'class D powder'],
  substanceImpact: 'Electrolyte salts hydrolyse to hydrogen fluoride; keep dry and ventilated.',
  recycledCobaltPre: 0,
  recycledCobaltPost: 0,
  recycledLithiumPre: 4,
  recycledLithiumPost: 2,
  recycledNickelPre: 0,
  recycledNickelPost: 0,
  recycledLeadPre: 0,
  recycledLeadPost: 0,
  dueDiligenceReport: 'https://dpp.bsvb.net/demo/due-diligence',
  endOfLifeTreatment: 'Return through the maker\'s take-back scheme; hydrometallurgical recovery of lithium and copper.',
  endUserCollection: 'Collection points are listed on the maker\'s take-back page.',
  endUserWastePrevention: 'Never dispose of in household waste; keep the terminals covered.',
  separateCollectionSymbol: 'crossed-out wheeled bin',
  labelMeaning: 'The crossed-out bin marks separate collection; the chemistry mark names LFP.',
}
/** The reassessment: the round-trip efficiency at half life, measured rather than declared. */
const PAYLOAD_V2: Record<string, unknown> = { ...PAYLOAD_V1, roundTripAtHalfLife: 90 }

const EVENT_TYPE: Record<NativeOperation, LifecycleEventType> = { ACTIVATE: 'Origin', SOLD: 'Transfer', RESOLD: 'Transfer', TRANSFER: 'Transfer', REPAIRED: 'Transformation', EDIT: 'Transformation', RECYCLED: 'Disposition' }

interface DemonstrationState {
  index: number
  op: NativeOperation
  timestamp: string
  txid: string
  outputIndex: number
  rawTx: string
  actor: string
  owner: string
  eventData: string
  /** The facets put forward for the mapping, each a reference to a record. */
  evidence: LifecycleEvidence
  mapping: MappingResult
  claim: SignedLifecycleClaim
}

export async function buildBatteryLifecycle(): Promise<Record<string, unknown>> {
  const lockKey = makerPriv.toPublicKey()
  const states: DemonstrationState[] = []
  let prevTx: ReturnType<typeof stateTx> | undefined
  let prevIndex = 0

  const add = async (
    op: NativeOperation,
    data: Parameters<typeof makeData>[0],
    actorWallet: ProtoWallet,
    actorPriv: PrivateKey,
    evidenceFor: (outpoint: string) => LifecycleEvidence,
    payloadKeys: string[]
  ): Promise<void> => {
    const state = await signedState(makeData({ passportId: PASSPORT_ID, ...data, previousTxid: prevTx?.id('hex') ?? '' }), actorWallet)
    const tx = stateTx(state, lockKey, prevTx == null ? undefined : { tx: prevTx, outputIndex: prevIndex })
    const txid = tx.id('hex')
    const outpoint = `${txid}:0`
    const evidence = evidenceFor(outpoint)
    const mapping = mapNativeOperation(battery, { nativeOperation: op, payloadKeys, evidence })
    const unsigned: LifecycleClaim = {
      claimFormat: 'dpp-lifecycle-v1',
      passportId: PASSPORT_ID,
      recordId: outpoint,
      eventType: EVENT_TYPE[op],
      timestamp: state.timestamp,
      issuer: didKeyFromIdentityKey(idKey(actorPriv)),
      issuerKeyId: `demo/${op.toLowerCase()}`,
      profile: 'battery',
      profile_version: 2,
    }
    const claim = await signLifecycleClaim(unsigned, actorWallet)
    states.push({ index: states.length, op, timestamp: state.timestamp, txid, outputIndex: 0, rawTx: tx.toHex(), actor: state.actorIdentityKey, owner: state.ownerIdentityKey, eventData: state.eventData, evidence, mapping, claim })
    prevTx = tx
    prevIndex = 0
  }

  const fieldKeys = (payload: Record<string, unknown>): string[] => Object.keys(payload).filter((k) => !stampKeys.has(k))

  // Manufacture. The origin facets are the maker's own declarations in the
  // signed payload, referenced by pointer into the state, not restated.
  await add('ACTIVATE', {
    op: 'ACTIVATE', timestamp: '2026-05-21T08:00:00Z', ownerIdentityKey: idKey(owner1Priv), actorIdentityKey: idKey(makerPriv), actorKeyId: 'maker line 1',
    eventData: '', payloadPublic: JSON.stringify(PAYLOAD_V1), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, makerWallet, makerPriv, (o) => ({ facility: `${o}#/manufacturingPlace`, time: `${o}#/manufacturingDate`, responsibleParty: `${o}#/manufacturer` }), fieldKeys(PAYLOAD_V1))

  // Sale with movement evidence: dispatch and receipt documents, by digest.
  const movement = { source: sha256Ref('dispatch note DN-2026-0421, Plant 1, Demonstration Park'), destination: sha256Ref('goods receipt GR-2026-0517, Demonstration Solar Farm, Site B') }
  await add('SOLD', {
    op: 'SOLD', timestamp: '2026-06-02T10:00:00Z', ownerIdentityKey: idKey(owner1Priv), actorIdentityKey: idKey(makerPriv), actorKeyId: 'maker sales 1',
    eventData: JSON.stringify(movement),
    payloadPublic: JSON.stringify(PAYLOAD_V1), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, makerWallet, makerPriv, () => movement, [])

  // A change of token control with nothing else: the owner hands the passport
  // to a new owner and no custody record exists. The token moved; nothing says
  // the battery did.
  await add('TRANSFER', {
    op: 'TRANSFER', timestamp: '2027-02-14T09:00:00Z', ownerIdentityKey: idKey(owner2Priv), actorIdentityKey: idKey(owner1Priv), actorKeyId: 'owner transfer 1',
    eventData: '', payloadPublic: JSON.stringify(PAYLOAD_V1), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, owner1Wallet, owner1Priv, () => ({}), [])

  // Repair by a service party that is neither maker nor owner.
  const repair = { workDone: sha256Ref('work order WO-2027-0311: battery management board replaced, cells rebalanced'), performedBy: didKeyFromIdentityKey(idKey(owner3Priv)), performedAt: '2027-03-11T14:00:00Z' }
  await add('REPAIRED', {
    op: 'REPAIRED', timestamp: '2027-03-11T15:00:00Z', ownerIdentityKey: idKey(owner2Priv), actorIdentityKey: idKey(owner3Priv), actorKeyId: 'repair service 1',
    eventData: JSON.stringify(repair),
    payloadPublic: JSON.stringify(PAYLOAD_V1), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, owner3Wallet, owner3Priv, () => repair, [])

  // Reassessment: a measured value replaces a declared one. A metadata
  // revision, never a physical transformation.
  await add('EDIT', {
    op: 'EDIT', timestamp: '2029-05-20T08:00:00Z', ownerIdentityKey: idKey(owner2Priv), actorIdentityKey: idKey(owner2Priv), actorKeyId: 'owner reassessment 1',
    eventData: '', payloadPublic: JSON.stringify(PAYLOAD_V2), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, owner2Wallet, owner2Priv, () => ({}), ['roundTripAtHalfLife'])

  // Recycling as a process whose outputs carry new identities.
  const outputs = [buildGs1DigitalLink('dpp.bsvb.net', OUTPUT_GTIN14, 'BLACKMASS-0001')]
  await add('RECYCLED', {
    op: 'RECYCLED', timestamp: '2036-06-01T09:00:00Z', ownerIdentityKey: idKey(owner2Priv), actorIdentityKey: idKey(recyclerPriv), actorKeyId: 'recycler intake 1',
    eventData: JSON.stringify({ dispositionKind: 'process-with-outputs', outputs }),
    payloadPublic: JSON.stringify(PAYLOAD_V2), payloadOwnerHash: ownerBlobHash(OWNER_BLOB),
  }, recyclerWallet, recyclerPriv, () => ({ dispositionKind: 'process-with-outputs', outputs }), [])

  const txs = states.map((s) => Transaction.fromHex(s.rawTx))
  const report = await verifyPassportEvidence(
    { tokenHistory: txs, nativeClaims: states.map((s) => s.claim) },
    { passportId: PASSPORT_ID, source: 'request-context' },
    { publisherKeys: [idKey(serverPriv)], chainTracker: 'scripts only', checkedAt: CHECKED_AT }
  )

  return {
    fixtureVersion: 1,
    description: 'A synthetic industrial-battery lifecycle under the GS1 demonstration prefix 952: manufacture, sale with movement evidence, a token transfer with no custody evidence, repair, reassessment and recycling into new identities. Nothing here describes a real product.',
    profile: 'battery@2',
    identifiers: {
      gtin14: GTIN14,
      serial: SERIAL,
      passportId: PASSPORT_ID,
      note: 'The prefix 952 is the GS1 demonstration range; a valid check digit proves spelling, never allocation (spec/profiles.md section 4).',
    },
    keys: { maker: idKey(makerPriv), publisher: idKey(serverPriv), owner1: idKey(owner1Priv), owner2: idKey(owner2Priv), repairer: idKey(owner3Priv), recycler: idKey(recyclerPriv) },
    states,
    report,
    notes: [
      'The SOLD state carries dispatch and receipt evidence by digest, so it maps losslessly to a physical transfer.',
      'The TRANSFER state changes token control and nothing else: its mapping is insufficient-data with custodyRecord missing, because a token transfer never implies delivery or custody.',
      'The EDIT state is a reassessment of a declared value and maps to a metadata revision, transformed, never to a physical transformation.',
      'The RECYCLED state names the outputs that carry new identities, distinguishing a process from disposal.',
      'The ACTIVATE mapping is transformed: the fields without a semantic URI in battery@2 are listed as losses rather than dropped.',
    ],
  }
}

describe('the industrial-battery demonstration lifecycle (P09)', () => {
  it('is generated deterministically and pinned as fixtures/battery-lifecycle-v1.json', async () => {
    const once = JSON.stringify(await buildBatteryLifecycle(), null, 2) + '\n'
    const twice = JSON.stringify(await buildBatteryLifecycle(), null, 2) + '\n'
    expect(twice).toBe(once)
    if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(FIXTURE_PATH, once)
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(once)
  })

  it('carries a demonstration GTIN with a computed check digit and a Digital Link the parser reads back', () => {
    expect(isDemonstrationGtin(GTIN14)).toBe(true)
    expect(parseGs1DigitalLink(PASSPORT_ID)).toMatchObject({ gtin: GTIN14, serial: SERIAL })
  })

  it('has a public payload that validates against the frozen battery@2 public schema', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true })
    addFormats(ajv)
    const validate = ajv.compile(readPublicPayloadSchema('battery@2') as object)
    expect(validate(PAYLOAD_V1), JSON.stringify(validate.errors)).toBe(true)
    expect(validate(PAYLOAD_V2), JSON.stringify(validate.errors)).toBe(true)
  })

  it('maps every state as the rules say: evidence carries a transfer, a token transfer alone carries nothing', async () => {
    const fixture = await buildBatteryLifecycle()
    const states = fixture.states as DemonstrationState[]
    const outcomes = states.map((s) => [s.op, s.mapping.outcome])
    expect(outcomes).toEqual([
      ['ACTIVATE', 'transformed'],
      ['SOLD', 'lossless'],
      ['TRANSFER', 'insufficient-data'],
      ['REPAIRED', 'lossless'],
      ['EDIT', 'transformed'],
      ['RECYCLED', 'lossless'],
    ])
    expect(states[2].mapping.missingEvidence).toEqual(['custodyRecord'])
    expect(states[0].mapping.unmappedFields.length).toBeGreaterThan(0)
    expect(states[0].mapping.losses.every((l) => l.startsWith('no external semantic field for '))).toBe(true)
    expect(states[4].mapping.losses[0]).toMatch(/metadata revision/)
    for (const s of states) if (s.mapping.outcome !== 'lossless') expect(s.mapping.losses.length).toBeGreaterThan(0)
  })

  it('verifies as a chain with a signed native claim per state under the one report', async () => {
    const fixture = await buildBatteryLifecycle()
    const report = fixture.report as { checks: Array<{ name: string; status: string; reasonCode?: string }>; expectedSubject: { passportId: string } }
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]))
    expect(report.expectedSubject.passportId).toBe(PASSPORT_ID)
    for (const name of ['recordEncoding', 'actorSignatures', 'publisherSignatures', 'linkage', 'nativeAttestationSignature', 'subjectBinding']) {
      expect(byName[name]?.status, name).toBe('pass')
    }
    // No proof travels with the fixture and no anchor was supplied: both are unknown, never a pass by omission.
    expect(byName.inclusion.status).toBe('unknown')
    expect(byName.anchorSignature.status).toBe('unknown')
  })
})
