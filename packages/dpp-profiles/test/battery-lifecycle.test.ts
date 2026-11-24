/**
 * The marked industrial-battery demonstration lifecycle (P09), read as
 * history. `fixtures/battery-lifecycle-v1.json` is a synthetic passport under
 * the GS1 demonstration prefix 952, carried from ACTIVATE to RECYCLED through
 * the native record, with a signed native lifecycle claim per state, the
 * conditional mapping of every state (`spec/rules.md` §2) and the one
 * verification report (`spec/verification.md`). No product exists; every
 * value is invented and says so.
 *
 * Its states and claims declare `battery@2`, which is retired
 * (`spec/profiles.md` §4). The file is therefore no longer generated: a
 * retired profile is issued under by nothing, this test included, and the
 * file keeps the bytes it was published with. What is held here is what a
 * reader meets today. Every signature, link and claim in it still verifies
 * and every check of the report answers as recorded, except the one that
 * asks about the profile: `schema` now says the profile is retired, where
 * the recorded report passed each state under the schema of the day.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Transaction } from '@bsv/sdk'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { findDppOutputs, verifyLifecycleClaim, verifyPassportEvidence, type SignedLifecycleClaim } from '@bsv/dpp-protocol'
import { RETIRED_PROFILE_REPLACEMENTS, gs1CheckDigit, isDemonstrationGtin, isRetiredProfile, mapNativeOperation, parseGs1DigitalLink, profilePayloadValidator, readManifest, readPublicPayloadSchema, type LifecycleEvidence, type MappingResult, type NativeOperation } from '../src/index.js'

const FIXTURE_PATH = new URL('../../../fixtures/battery-lifecycle-v1.json', import.meta.url)
/**
 * The SHA-256 the file was published with, as the conformance ledger pinned
 * it while the fixture's row was live. The row is in the ledger archive now,
 * and this constant is what holds the file to those bytes in every checkout.
 */
const PUBLISHED_SHA256 = 'eeea5a2bc1cac27e3a8f4d6cb43ac9c8a9602673922b87ddab40fe6ca3dee330'

interface RecordedState {
  index: number
  op: NativeOperation
  txid: string
  rawTx: string
  evidence: LifecycleEvidence
  mapping: MappingResult
  claim: SignedLifecycleClaim
}
interface RecordedCheck { name: string; status: string; reasonCode?: string; evidenceRefs?: string[]; detail?: unknown }
interface Fixture {
  profile: string
  identifiers: { gtin14: string; serial: string; passportId: string }
  keys: { publisher: string }
  states: RecordedState[]
  report: { checkedAt: string; checks: RecordedCheck[]; expectedSubject: { passportId: string }; limits: string[] }
}

const bytes = readFileSync(FIXTURE_PATH)
const fixture = JSON.parse(bytes.toString('utf8')) as Fixture
const transactions = fixture.states.map((s) => Transaction.fromHex(s.rawTx))
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)

/** The report a reader produces over the fixture's own bytes today, with the profile validator plugged in as the fixture's generator had it. */
const readToday = async (): Promise<Fixture['report']> => {
  const report = await verifyPassportEvidence(
    { tokenHistory: transactions, nativeClaims: fixture.states.map((s) => s.claim) },
    { passportId: fixture.identifiers.passportId, source: 'request-context' },
    { publisherKeys: [fixture.keys.publisher], chainTracker: 'scripts only', checkedAt: fixture.report.checkedAt, payloadValidator: profilePayloadValidator(ajv) }
  )
  // As a report travels: JSON, so an absent member and an undefined one read alike.
  return JSON.parse(JSON.stringify(report)) as Fixture['report']
}
const without = (report: Fixture['report'], name: string): unknown => ({ ...report, checks: report.checks.filter((c) => c.name !== name) })
const checkOf = (report: Fixture['report'], name: string): RecordedCheck => report.checks.find((c) => c.name === name)!

describe('the industrial-battery demonstration lifecycle (P09), a historical fixture', () => {
  it('is the file that was published, byte for byte, and is not regenerated', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PUBLISHED_SHA256)
    expect(fixture.profile).toBe('battery@2')
    expect(isRetiredProfile(fixture.profile)).toBe(true)
  })

  it('carries a demonstration GTIN with a correct check digit and a Digital Link the parser reads back', () => {
    const { gtin14, serial, passportId } = fixture.identifiers
    expect(isDemonstrationGtin(gtin14)).toBe(true)
    expect(gtin14.at(-1)).toBe(String(gs1CheckDigit(gtin14.slice(1, -1))))
    expect(parseGs1DigitalLink(passportId)).toMatchObject({ gtin: gtin14, serial })
  })

  it('declares battery@2 in every state, with a payload the frozen battery@2 public schema still accepts', () => {
    // The frozen schema is read as a file, to show the payloads kept their meaning. It is not how a reader checks them now.
    const strict = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true })
    addFormats(strict)
    const validate = strict.compile(readPublicPayloadSchema('battery@2') as object)
    for (const tx of transactions) {
      const payload = JSON.parse(findDppOutputs(tx)[0]!.state.payloadPublic) as Record<string, unknown>
      expect([payload.profile, payload.profile_version]).toEqual(['battery', 2])
      expect(validate(payload), JSON.stringify(validate.errors)).toBe(true)
    }
  })

  it('keeps every signed claim as it was signed: each still verifies and names battery@2', () => {
    for (const { claim, txid } of fixture.states) {
      expect(verifyLifecycleClaim(claim).signature, txid).toBe('verified')
      expect([claim.profile, claim.profile_version]).toEqual(['battery', 2])
      expect(claim.recordId).toBe(`${txid}:0`)
    }
  })

  it('records the mapping of every state as the rules say: evidence carries a transfer, a token transfer alone carries nothing', () => {
    expect(fixture.states.map((s) => [s.op, s.mapping.outcome])).toEqual([
      ['ACTIVATE', 'transformed'],
      ['SOLD', 'lossless'],
      ['TRANSFER', 'insufficient-data'],
      ['REPAIRED', 'lossless'],
      ['EDIT', 'transformed'],
      ['RECYCLED', 'lossless'],
    ])
    expect(fixture.states[2]!.mapping.missingEvidence).toEqual(['custodyRecord'])
    expect(fixture.states[0]!.mapping.unmappedFields.length).toBeGreaterThan(0)
    expect(fixture.states[0]!.mapping.losses.every((l) => l.startsWith('no external semantic field for '))).toBe(true)
    expect(fixture.states[4]!.mapping.losses[0]).toMatch(/metadata revision/)
    // The mapping reads a manifest and judges no payload, so the recorded results are still what it gives for the frozen manifest.
    const battery = readManifest('battery@2')
    for (const s of fixture.states) {
      const payloadKeys = [...s.mapping.mappedFields.map((f) => f.key), ...s.mapping.unmappedFields]
      const again = JSON.parse(JSON.stringify(mapNativeOperation(battery, { nativeOperation: s.op, payloadKeys, evidence: s.evidence }))) as MappingResult
      expect(again).toEqual(s.mapping)
      if (s.mapping.outcome !== 'lossless') expect(s.mapping.losses.length).toBeGreaterThan(0)
    }
  })

  it('still verifies as a chain with a signed native claim per state: every check but schema answers exactly as recorded', async () => {
    const today = await readToday()
    const statusLimit = 'A credential status observation is only as fresh as its source.'
    expect(today.limits).toContain(statusLimit)
    const originalLimits = today.limits.filter((limit) => limit !== statusLimit)
    expect(without({ ...today, limits: originalLimits }, 'schema')).toEqual(without(fixture.report, 'schema'))
    const byName = Object.fromEntries(today.checks.map((c) => [c.name, c]))
    expect(today.expectedSubject.passportId).toBe(fixture.identifiers.passportId)
    for (const name of ['recordEncoding', 'actorSignatures', 'publisherSignatures', 'linkage', 'nativeAttestationSignature', 'subjectBinding']) {
      expect(byName[name]?.status, name).toBe('pass')
    }
    // No proof travels with the fixture and no anchor was supplied: both are unknown, never a pass by omission.
    expect(byName.inclusion!.status).toBe('unknown')
    expect(byName.anchorSignature!.status).toBe('unknown')
  })

  it('reports the retired profile under schema: unknown for every state, never a pass and never a failure', async () => {
    const recorded = checkOf(fixture.report, 'schema')
    const schema = checkOf(await readToday(), 'schema')
    expect(schema.status).toBe('unknown')
    expect(schema.reasonCode).toBe('schema-unavailable')
    expect(schema.evidenceRefs).toEqual(recorded.evidenceRefs)
    const retired = { profile: 'battery@2', cause: 'profile-retired', replacedBy: RETIRED_PROFILE_REPLACEMENTS['battery@2'], steps: [] }
    // One part per state, then one per claim. The claims had no validator when the fixture was made and have none now.
    expect(schema.detail).toEqual([...fixture.states.map(() => retired), ...fixture.states.map(() => 'battery@2')])
    expect(recorded.detail).toEqual([...fixture.states.map(() => 'battery@2'), ...fixture.states.map(() => 'battery@2')])
  })
})
