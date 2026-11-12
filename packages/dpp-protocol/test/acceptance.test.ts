import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, Hash, PublicKey, Signature, Transaction, Utils } from '@bsv/sdk'
import {
  ACCEPTANCE_COMMITMENT_REFUSAL,
  MANAGED_ACCEPTANCE_FORMAT,
  MANAGED_ACCEPTANCE_FORMAT_V1,
  MANAGED_RECORD_PROTOCOL_ID,
  acceptanceCommitment,
  acceptanceSigningPreimage,
  bindAcceptanceToState,
  canonicalJson,
  findDppOutputs,
  inspectManagedAcceptance,
  managedRecordVerificationKey,
  signManagedAcceptance,
  verifyChain,
  verifyPassportEvidence,
  type ManagedAcceptanceClaim,
  type ManagedAcceptanceRecord,
} from '../src/index.js'
import { custodianPriv, custodianWallet, idKey, strangerPriv, strangerWallet } from './helpers-v2.js'

/**
 * The managed acceptance record (`spec/managed-custody.md` §3): the frozen
 * version 1 fixture read the way an external reader does, the version 2 rule
 * under which the custodian signs with a derived key, and the record's place
 * in the one verification report.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')
const F = JSON.parse(readFileSync(join(FIXTURES, 'managed-acceptance-v1.json'), 'utf8'))
const F2 = JSON.parse(readFileSync(join(FIXTURES, 'managed-acceptance-v2.json'), 'utf8'))
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

  it('re-signs to the same bytes with RFC 6979 under the version 1 rule, the custodian key directly', () => {
    // The package no longer writes version 1 records; the pin is reproduced here with the raw test key.
    const again = Utils.toHex(custodianPriv.sign(Utils.toArray(F.signingPreimageHex, 'hex')).toDER() as number[])
    expect(again).toBe(record.signature)
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
    expect(MANAGED_ACCEPTANCE_FORMAT_V1).toBe('dpp-managed-acceptance@1')
    expect(MANAGED_ACCEPTANCE_FORMAT).toBe('dpp-managed-acceptance@2')
  })

  it('names the profile without a version in the commitment refusal, which is the same under both versions', () => {
    expect(ACCEPTANCE_COMMITMENT_REFUSAL).toBe('TRANSFER carries no authorisation_commitment under the managed-custody profile')
  })
})

describe('managed-acceptance@2: the custodian signs with a derived key (managed-custody.md §3)', () => {
  const { signature: _v1, ...v1 } = record
  const claim: ManagedAcceptanceClaim = { ...v1, acceptanceFormat: MANAGED_ACCEPTANCE_FORMAT }

  it('signs a @2 claim through createSignature and verifies against the child of custodian for the managed record protocol', async () => {
    const signed = await signManagedAcceptance(claim, custodianWallet)
    expect(signed.acceptanceFormat).toBe('dpp-managed-acceptance@2')
    const child = new CachedKeyDeriver('anyone').derivePublicKey(MANAGED_RECORD_PROTOCOL_ID, claim.requestId, claim.custodian)
    expect(MANAGED_RECORD_PROTOCOL_ID).toEqual([1, 'dpp managed record v1'])
    expect(child.verify(acceptanceSigningPreimage(signed), Signature.fromDER(signed.signature, 'hex'))).toBe(true)
    expect(managedRecordVerificationKey(claim.custodian, claim.requestId).toString()).toBe(child.toString())
    // The identity key itself does not verify it: the signature is one derivation away from the root.
    expect(PublicKey.fromString(claim.custodian).verify(acceptanceSigningPreimage(signed), Signature.fromDER(signed.signature, 'hex'))).toBe(false)
    expect(inspectManagedAcceptance(signed, { custodians: [claim.custodian] })).toMatchObject({ structureValid: true, signatureValid: true, failures: [] })
  })

  it('refuses a @2 record signed with the identity key directly', () => {
    const direct: ManagedAcceptanceRecord = { ...claim, signature: Utils.toHex(custodianPriv.sign(acceptanceSigningPreimage(claim)).toDER() as number[]) }
    const inspection = inspectManagedAcceptance(direct)
    expect(inspection.structureValid).toBe(true)
    expect(inspection.signatureValid).toBe(false)
    expect(inspection.failures.map((f) => f.reason)).toEqual(['signature-invalid'])
  })

  it('still reads the frozen @1 fixture against the custodian key directly', () => {
    expect(inspectManagedAcceptance(record)).toMatchObject({ structureValid: true, signatureValid: true, commitment: F.commitment, failures: [] })
    const asV2: ManagedAcceptanceRecord = { ...record, acceptanceFormat: MANAGED_ACCEPTANCE_FORMAT }
    expect(inspectManagedAcceptance(asV2).signatureValid).toBe(false)
  })

  it('refuses to sign a @1 claim: the package writes version 2 only', async () => {
    await expect(signManagedAcceptance(v1, custodianWallet)).rejects.toThrow('dpp-managed-acceptance@2')
  })

  it('refuses a malformed claim and a signer whose root is not the custodian', async () => {
    await expect(signManagedAcceptance({ ...claim, termsDigest: 'nope' }, custodianWallet)).rejects.toThrow('not well formed')
    await expect(signManagedAcceptance(claim, strangerWallet)).rejects.toThrow('does not hold the custodian key')
  })
})

describe('managed-acceptance-v2 fixture: the reader refuses what it must', () => {
  // The version 2 refusals, each with its three verdicts, read from the
  // published file the way an external reader does.
  const transferV2 = findDppOutputs(Transaction.fromHex(F2.transfer.rawTx))[0].state
  if (transferV2.version !== '2') throw new Error('fixture transfer is not version 2')

  it('binds the pinned record to the TRANSFER that commits to it', () => {
    expect(inspectManagedAcceptance(F2.record, { custodians: [F2.custodianKey] })).toMatchObject({ structureValid: true, signatureValid: true, commitment: F2.commitment, failures: [] })
    expect(bindAcceptanceToState(F2.record as ManagedAcceptanceRecord, transferV2)).toEqual([])
  })

  it.each((F2.refusals as Array<{ name: string; record: unknown; expected: { structureValid: boolean; signatureValid: boolean | null; reason: string; bindingFails?: boolean } }>).map((r) => [r.name, r] as const))('refuses %s', (_name, r) => {
    const inspection = inspectManagedAcceptance(r.record)
    expect(inspection.structureValid).toBe(r.expected.structureValid)
    expect(inspection.signatureValid).toBe(r.expected.signatureValid)
    const reasons = inspection.failures.map((f) => f.reason)
    if (r.expected.bindingFails) {
      expect(reasons).toEqual([])
      const binding = bindAcceptanceToState(r.record as ManagedAcceptanceRecord, transferV2)
      expect(binding.length).toBeGreaterThan(0)
      expect(binding.every((f) => f.reason === 'state-mismatch')).toBe(true)
    } else {
      expect(reasons).toContain(r.expected.reason)
    }
  })
})

describe('acceptance evidence in the one verification report', () => {
  // The pinned chain's TRANSFER commits to the version 2 record.
  const record = F2.record as ManagedAcceptanceRecord
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
    expect(by(withRecord, 'evidenceAvailability').evidenceRefs).toContain(`acceptance:sha256:${F2.commitment}`)
  })

  it('fails availability for a record that does not bind, and authority for a custodian the policy does not name', async () => {
    const mismatch = F2.refusals.find((r: { name: string }) => r.name === 'destinationMismatch').record
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

  it('reads a managed-custody@1 lineage end to end: the frozen @1 record and the TRANSFER that commits to it', async () => {
    // managed-custody@1 is read and never written (`spec/managed-custody.md`
    // §9), so the acceptance records written under it keep verifying: the
    // pinned chain's first two states, then the @1 fixture's TRANSFER.
    const lineage = [...chain.slice(0, 2), transferTx]
    const verified = await verifyChain(lineage, { chainTracker: 'scripts only', managedAcceptance: true })
    expect(verified.error).toBeUndefined()
    expect(verified.valid).toBe(true)
    for (const managedAcceptance of [{ required: true }, undefined]) {
      const report = await verifyPassportEvidence({ tokenHistory: lineage, acceptanceRecords: [F.record] }, asked, {
        chainTracker: 'scripts only',
        checkedAt: '2027-06-01T12:00:00Z',
        ...(managedAcceptance == null ? {} : { managedAcceptance }),
        authority: { required: true, genesisIssuers: [CHAIN.issuerKey], acceptanceCustodians: [F.custodianKey] },
      })
      expect(by(report, 'linkage').status).toBe('pass')
      expect(by(report, 'evidenceAvailability').status).toBe('pass')
      expect(by(report, 'evidenceAvailability').evidenceRefs).toContain(`acceptance:sha256:${F.commitment}`)
      expect(by(report, 'issuerAuthority').status).toBe('pass')
    }
  })
})
