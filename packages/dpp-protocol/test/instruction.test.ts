import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, PublicKey, Signature, Utils } from '@bsv/sdk'
import {
  MANAGED_INSTRUCTION_FORMAT,
  MANAGED_RECORD_PROTOCOL_ID,
  inspectManagedInstruction,
  instructionSigningPreimage,
  managedRecordVerificationKey,
  signManagedInstruction,
  type ManagedInstructionClaim,
  type ManagedInstructionRecord,
} from '../src/index.js'
import { PASSPORT_ID_V2, custodianPriv, custodianWallet, idKey, recipientPriv, strangerWallet } from './helpers-v2.js'

/**
 * The managed instruction record (`spec/managed-custody.md` §6) signs under
 * the same rule as a version 2 acceptance record: the custodian's wallet,
 * one derivation from its root. The pinned bytes are in `fixture-json.test.ts`.
 */
const claim: ManagedInstructionClaim = {
  instructionFormat: MANAGED_INSTRUCTION_FORMAT,
  requestId: 'request-0001',
  passportId: PASSPORT_ID_V2,
  lineageGenesis: { txid: 'aa'.repeat(32), outputIndex: 0 },
  expectedPredecessor: { txid: 'bb'.repeat(32), outputIndex: 1 },
  operation: 'UPDATE',
  holderIdentityKey: idKey(recipientPriv),
  requestDigest: 'cc'.repeat(32),
  requestedAt: '2026-10-01T07:30:00Z',
  evidenceKind: 'custodian-attested',
  custodian: idKey(custodianPriv),
}

describe('managed instruction record: the custodian signs with a derived key', () => {
  it('signs through createSignature and verifies against the child of custodian for the managed record protocol', async () => {
    const record = await signManagedInstruction(claim, custodianWallet)
    const child = new CachedKeyDeriver('anyone').derivePublicKey(MANAGED_RECORD_PROTOCOL_ID, claim.requestId, claim.custodian)
    expect(child.verify(instructionSigningPreimage(record), Signature.fromDER(record.signature, 'hex'))).toBe(true)
    expect(managedRecordVerificationKey(claim.custodian, claim.requestId).toString()).toBe(child.toString())
    expect(PublicKey.fromString(claim.custodian).verify(instructionSigningPreimage(record), Signature.fromDER(record.signature, 'hex'))).toBe(false)
    expect(inspectManagedInstruction(record, { custodians: [claim.custodian] })).toMatchObject({ structureValid: true, signatureValid: true, failures: [] })
  })

  it('refuses a record signed with the identity key directly', () => {
    const direct: ManagedInstructionRecord = { ...claim, signature: Utils.toHex(custodianPriv.sign(instructionSigningPreimage(claim)).toDER() as number[]) }
    const inspection = inspectManagedInstruction(direct)
    expect(inspection.structureValid).toBe(true)
    expect(inspection.signatureValid).toBe(false)
    expect(inspection.failures.map((f) => f.reason)).toEqual(['signature-invalid'])
  })

  it('refuses a malformed claim and a signer whose root is not the custodian', async () => {
    await expect(signManagedInstruction({ ...claim, requestDigest: 'nope' }, custodianWallet)).rejects.toThrow('not well formed')
    await expect(signManagedInstruction(claim, strangerWallet)).rejects.toThrow('does not hold the custodian key')
  })
})
