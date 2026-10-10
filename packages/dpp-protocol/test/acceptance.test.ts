import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Hash, PublicKey, Signature, Transaction, Utils } from '@bsv/sdk'
import {
  MANAGED_ACCEPTANCE_FORMAT,
  acceptanceCommitment,
  acceptanceSigningPreimage,
  bindAcceptanceToState,
  canonicalJson,
  findDppOutputs,
  inspectManagedAcceptance,
  signManagedAcceptance,
  verifyPassportEvidence,
  type ManagedAcceptanceRecord,
} from '../src/index.js'
import { custodianPriv, custodianSigner, idKey, strangerPriv } from './helpers-v2.js'

/**
 * The managed acceptance record (`spec/managed-custody.md` §3), read from the
 * published fixture the way an external reader does, and its place in the
 * one verification report.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')
const F = JSON.parse(readFileSync(join(FIXTURES, 'managed-acceptance-v1.json'), 'utf8'))
const CHAIN = JSON.parse(readFileSync(join(FIXTURES, 'chain-v2.json'), 'utf8'))
const record = F.record as ManagedAcceptanceRecord
const transferTx = Transaction.fromHex(F.transfer.rawTx)
const transfer = findDppOutputs(transferTx)[0].state
if (transfer.version !== '2') throw new Error('fixture transfer is not version 2')

describe('managed-acceptance-v1 fixture: the custodian reproduces every byte', () => {
  it('pins the canonical forms, the preimage, the signature and the commitment', () => {
    const { signature, ...unsigned } = record
    expect(canonicalJson(unsigned)).toBe(F.canonicalUnsigned)
    expect(Utils.toHex(acceptanceSigningPreimage(record))).toBe(F.signingPreimageHex)
    expect(Utils.toHex(Utils.toArray(F.canonicalUnsigned, 'utf8'))).toBe(F.signingPreimageHex)
    expect(canonicalJson(record)).toBe(F.canonicalSigned)
    expect(acceptanceCommitment(record)).toBe(F.commitment)
    expect(Utils.toHex(Hash.sha256(Utils.toArray(F.canonicalSigned, 'utf8')))).toBe(F.commitment)
    // The signature is the custodian key's own, over SHA-256 of the preimage, with no derivation.
    expect(PublicKey.fromString(F.custodianKey).verify(Utils.toArray(F.signingPreimageHex, 'hex'), Signature.fromDER(signature, 'hex'))).toBe(true)
    expect(idKey(custodianPriv)).toBe(F.custodianKey)
  })

  it('re-signs to the same bytes with RFC 6979', async () => {
    const { signature: _s, ...claim } = record
    const again = await signManagedAcceptance(claim, custodianSigner)
    expect(again.signature).toBe(record.signature)
  })

  it('the TRANSFER carries the commitment and binds to the record', () => {
    expect(F.transfer.authorisationCommitment).toBe(F.commitment)
    expect(transfer.authorisationCommitment).toBe(F.commitment)
    expect(bindAcceptanceToState(record, transfer)).toEqual([])
    const inspection = inspectManagedAcceptance(record, { custodians: [F.custodianKey] })
    expect(inspection).toMatchObject({ structureValid: true, signatureValid: true, commitment: F.commitment, failures: [] })
  })
})

describe('managed-acceptance-v1 fixture: the reader refuses what it must', () => {
  it.each((F.refusals as Array<{ name: string; record: unknown; expected: { structureValid: boolean; signatureValid: boolean | null; reason: string; bindingFails?: boolean } }>).map((r) => [r.name, r] as const))('refuses %s', (_name, r) => {
    const inspection = inspectManagedAcceptance(r.record)
    expect(inspection.structureValid).toBe(r.expected.structureValid)
    expect(inspection.signatureValid).toBe(r.expected.signatureValid)
    const reasons = inspection.failures.map((f) => f.reason)
    if (r.expected.bindingFails) {
      expect(reasons).toEqual([])
      const binding = bindAcceptanceToState(r.record as ManagedAcceptanceRecord, transfer)
      expect(binding.length).toBeGreaterThan(0)
      expect(binding.every((f) => f.reason === 'state-mismatch')).toBe(true)
    } else {
      expect(reasons).toContain(r.expected.reason)
    }
  })

  it('refuses a custodian the policy does not name', () => {
    const inspection = inspectManagedAcceptance(record, { custodians: [idKey(strangerPriv)] })
    expect(inspection.signatureValid).toBe(true)
    expect(inspection.failures.map((f) => f.reason)).toEqual(['custodian-unexpected'])
  })

  it('refuses unknown properties, account identifiers and secrets by shape', () => {
    const withAccount = { ...record, accountId: 'user_123' }
    expect(inspectManagedAcceptance(withAccount).failures.map((f) => f.detail)).toContain('unsupported property accountId')
    const withCode = { ...record, offer: { ...record.offer, recipientRef: 'not-a-digest' } }
    expect(inspectManagedAcceptance(withCode).structureValid).toBe(false)
    expect(MANAGED_ACCEPTANCE_FORMAT).toBe('dpp-managed-acceptance@1')
  })

  it('the signer refuses a malformed claim and a key that is not the custodian', async () => {
    const { signature: _s, ...claim } = record
    await expect(signManagedAcceptance({ ...claim, termsDigest: 'nope' }, custodianSigner)).rejects.toThrow('not well formed')
    await expect(signManagedAcceptance(claim, { sign: (p) => strangerPriv.sign(p).toDER() as number[] })).rejects.toThrow('does not hold the custodian key')
  })
})

describe('acceptance evidence in the one verification report', () => {
  const chain = CHAIN.states.map((s: { rawTx: string }) => Transaction.fromHex(s.rawTx))
  const asked = { passportId: CHAIN.states[0].data.passportId, source: 'request-context' as const }
  const by = (report: Awaited<ReturnType<typeof verifyPassportEvidence>>, name: string) => report.checks.find((c) => c.name === name)!

  it('leaves availability unknown when the committed record is not supplied, and passes it when it is', async () => {
    const without = await verifyPassportEvidence({ tokenHistory: chain }, asked, { chainTracker: 'scripts only', managedAcceptance: { required: true }, checkedAt: '2027-06-01T12:00:00Z' })
    expect(by(without, 'linkage').status).toBe('pass')
    expect(by(without, 'evidenceAvailability')).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
    expect(without.limits.some((l) => l.includes('custody-dependent evidence'))).toBe(true)
    const withRecord = await verifyPassportEvidence({ tokenHistory: chain, acceptanceRecords: [record] }, asked, { chainTracker: 'scripts only', managedAcceptance: { required: true }, checkedAt: '2027-06-01T12:00:00Z' })
    expect(by(withRecord, 'evidenceAvailability').status).toBe('pass')
    expect(by(withRecord, 'evidenceAvailability').evidenceRefs).toContain(`acceptance:sha256:${F.commitment}`)
  })

  it('fails availability for a record that does not bind, and authority for a custodian the policy does not name', async () => {
    const mismatch = F.refusals.find((r: { name: string }) => r.name === 'destinationMismatch').record
    const report = await verifyPassportEvidence({ tokenHistory: chain, acceptanceRecords: [mismatch] }, asked, { chainTracker: 'scripts only', checkedAt: '2027-06-01T12:00:00Z' })
    expect(by(report, 'evidenceAvailability')).toMatchObject({ status: 'fail', reasonCode: 'referenced-artefact-mismatch' })
    const unauthorised = await verifyPassportEvidence({ tokenHistory: chain, acceptanceRecords: [record] }, asked, {
      chainTracker: 'scripts only',
      checkedAt: '2027-06-01T12:00:00Z',
      authority: { required: true, genesisIssuers: [CHAIN.issuerKey], acceptanceCustodians: [idKey(strangerPriv)] },
    })
    expect(by(unauthorised, 'evidenceAvailability').status).toBe('pass')
    expect(by(unauthorised, 'issuerAuthority')).toMatchObject({ status: 'fail', reasonCode: 'authority-unconfirmed' })
  })
})
