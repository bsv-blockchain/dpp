import { Hash, ProtoWallet, Utils } from '@bsv/sdk'
import {
  MANAGED_RECORD_PROTOCOL_ID,
  canonicalJson,
  instructionCommitment,
  instructionSigningPreimage,
  ownerBlobHash,
  signManagedInstruction,
  type DppStateV2,
  type ManagedInstructionClaim,
  type ManagedInstructionRecord,
} from '../src/index.js'
import {
  PASSPORT_ID_V2,
  PAYLOAD_V2_2,
  buildChainV2Fixture,
  controlLinkageOf,
  controllerKeyOf,
  custodianPriv,
  custodianWallet,
  idKey,
  makeDataV2,
  outpointOf,
  recipientPriv,
  signedStateV2,
  stateTxV2,
  strangerPriv,
  strangerWallet,
} from './helpers-v2.js'

/**
 * One managed instruction record (`spec/managed-custody.md` §6), pinned byte
 * for byte with the UPDATE that commits to it, and the records a verifier
 * must refuse. Generated, never typed: `fixtures/managed-instruction-v1.json`
 * is this function's output verbatim.
 *
 * The UPDATE here is an alternative fourth state of `chain-v2.json`: the
 * recipient, now the holder, asks the custodian to revise the owner tier, the
 * custodian records and signs the request, and writes the UPDATE for the
 * holder by linkage from the holder's managed identity, committing to the
 * record in field 15. The pinned lineage's own fourth and fifth states carry
 * no commitment, which is what the instruction rule refuses when selected.
 *
 * The custodian signs with its wallet: the BRC-42 child of its identity key
 * under the managed record protocol, key identifier `requestId`, counterparty
 * 'anyone'. A record signed with the identity key directly is refused.
 */
export async function managedInstructionV1Fixture() {
  const { txs, outputIndexes } = await buildChainV2Fixture()
  const lockKey = custodianPriv.toPublicKey()
  const genesis = outpointOf(txs[0], 0)
  const predecessor = outpointOf(txs[2], outputIndexes[2])
  const requestDigest = Utils.toHex(Hash.sha256(Utils.toArray(canonicalJson({ ask: 'revise the owner tier', note: 'service record added' }), 'utf8')))

  const claim: ManagedInstructionClaim = {
    instructionFormat: 'dpp-managed-instruction@1',
    requestId: 'request-0001',
    passportId: PASSPORT_ID_V2,
    lineageGenesis: genesis,
    expectedPredecessor: predecessor,
    operation: 'UPDATE',
    holderIdentityKey: idKey(recipientPriv),
    requestDigest,
    requestedAt: '2026-10-01T07:30:00Z',
    evidenceKind: 'custodian-attested',
    custodian: idKey(custodianPriv),
  }
  const record = await signManagedInstruction(claim, custodianWallet)

  const update = await signedStateV2(
    makeDataV2({
      op: 'UPDATE',
      timestamp: '2026-10-01T08:00:00Z',
      ownerIdentityKey: controllerKeyOf(recipientPriv),
      actorIdentityKey: idKey(recipientPriv),
      actorKeyId: 'recipient account',
      eventData: JSON.stringify({ eventType: 'Transformation', note: 'service record added' }),
      payloadPublic: PAYLOAD_V2_2,
      payloadOwnerHash: ownerBlobHash([80, 90, 100]),
      previousTxid: predecessor.txid,
      previousOutputIndex: predecessor.outputIndex,
      lineageGenesis: genesis,
      controlLinkage: controlLinkageOf(recipientPriv),
      authorisationCommitment: instructionCommitment(record),
    }),
    new ProtoWallet(recipientPriv)
  )
  const updateTx = stateTxV2(update, lockKey, { tx: txs[2], outputIndex: outputIndexes[2] })
  const state = update as DppStateV2

  const resign = async (edit: (r: ManagedInstructionRecord) => ManagedInstructionRecord): Promise<ManagedInstructionRecord> => {
    const { signature: _s, ...c } = edit({ ...record })
    return await signManagedInstruction(c, custodianWallet)
  }
  const derivedBy = async (wallet: ProtoWallet, preimage: number[]): Promise<string> => Utils.toHex((await wallet.createSignature({ data: preimage, protocolID: MANAGED_RECORD_PROTOCOL_ID, keyID: record.requestId, counterparty: 'anyone' })).signature)
  const tampered: ManagedInstructionRecord = { ...record, requestDigest: 'ff'.repeat(32) }
  const strangerSigned: ManagedInstructionRecord = { ...record, signature: await derivedBy(strangerWallet, instructionSigningPreimage(record)) }
  const directlySigned: ManagedInstructionRecord = { ...record, signature: Utils.toHex(custodianPriv.sign(instructionSigningPreimage(record)).toDER() as number[]) }
  const operationMismatch = await resign((r) => ({ ...r, operation: 'RETIRE' }))
  const predecessorMismatch = await resign((r) => ({ ...r, expectedPredecessor: genesis }))
  const holderMismatch = await resign((r) => ({ ...r, holderIdentityKey: idKey(strangerPriv) }))
  const requestedAfter = await resign((r) => ({ ...r, requestedAt: '2026-10-01T09:00:00Z' }))

  return {
    custodianKey: idKey(custodianPriv),
    holderKey: idKey(recipientPriv),
    record,
    canonicalUnsigned: canonicalJson({ ...record, signature: undefined }),
    signingPreimageHex: Utils.toHex(instructionSigningPreimage(record)),
    canonicalSigned: canonicalJson(record),
    commitment: instructionCommitment(record),
    update: {
      description: 'An alternative fourth state of chain-v2.json: the holder\'s UPDATE, written by the custodian by linkage from the holder\'s managed identity, committing to the record in field 15. It spends the pinned TRANSFER and stands in place of the pinned fourth state.',
      appendAfter: 2,
      txid: updateTx.id('hex'),
      outputIndex: 0,
      rawTx: updateTx.toHex(),
      lineageGenesis: genesis,
      predecessor,
      authorisationCommitment: state.authorisationCommitment,
    },
    refusals: [
      { name: 'tamperedRequest', description: 'requestDigest changed after signing.', record: tampered, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'strangerSigned', description: 'Signed under the managed record protocol from a root other than the custodian the record names.', record: strangerSigned, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'directlySigned', description: "Signed with the custodian's identity key directly, with no derivation: the signature of the superseded acceptance format, never valid for an instruction record.", record: directlySigned, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'operationMismatch', description: 'A well-formed, custodian-signed record asking for a RETIRE, presented with the UPDATE: it does not describe this state.', record: operationMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'predecessorMismatch', description: 'A well-formed, custodian-signed record naming the genesis as the expected predecessor.', record: predecessorMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'holderMismatch', description: 'A well-formed, custodian-signed record naming a stranger as the holder who asked.', record: holderMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'requestedAfterState', description: 'A well-formed, custodian-signed record whose request is timestamped after the state that would execute it.', record: requestedAfter, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
    ],
  }
}

export type ManagedInstructionV1Fixture = Awaited<ReturnType<typeof managedInstructionV1Fixture>>
