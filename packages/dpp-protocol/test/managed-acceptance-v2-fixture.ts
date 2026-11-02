import { ProtoWallet, Utils } from '@bsv/sdk'
import {
  MANAGED_RECORD_PROTOCOL_ID,
  acceptanceCommitment,
  acceptanceSigningPreimage,
  canonicalJson,
  signManagedAcceptance,
  type ManagedAcceptanceRecord,
} from '../src/index.js'
import { buildChainV2Fixture, controllerKeyOf, custodianPriv, custodianWallet, idKey, issuerPriv, recipientPriv, strangerPriv, strangerWallet } from './helpers-v2.js'

/**
 * One managed acceptance record (`spec/managed-custody.md` §3) under format
 * version 2, pinned byte for byte with the TRANSFER that commits to it, and
 * the records a verifier must refuse. Generated, never typed:
 * `fixtures/managed-acceptance-v2.json` is this function's output verbatim.
 *
 * The custodian signs with its wallet: the BRC-42 child of its identity key
 * for `[1, 'dpp managed record v1']`, key identifier `requestId`, counterparty
 * 'anyone', the BRC-100 `createSignature` operation. Version 1 signed with
 * the identity key directly; `managed-acceptance-v1.json` stays as that
 * version's pin and is not regenerated.
 *
 * The refusals are of three kinds, and a reader reports them apart. A record
 * whose bytes were changed after signing, or signed from another root, or
 * signed with the identity key directly as version 1 was, fails the
 * custodian's signature. A record the custodian signed but whose times or
 * names contradict each other fails its own structure. A record the custodian
 * signed, well formed, that does not describe the TRANSFER it is presented
 * with fails the binding: it evidences some acceptance, and not this one.
 */
export async function managedAcceptanceV2Fixture() {
  const { txs, states, outputIndexes, acceptance } = await buildChainV2Fixture()
  const transfer = states[2]
  if (transfer.version !== '2') throw new Error('fixture transfer is not version 2')
  const resign = async (edit: (r: ManagedAcceptanceRecord) => ManagedAcceptanceRecord): Promise<ManagedAcceptanceRecord> => {
    const { signature: _s, ...claim } = edit({ ...acceptance })
    return await signManagedAcceptance(claim, custodianWallet)
  }
  const derivedBy = async (wallet: ProtoWallet, preimage: number[]): Promise<string> =>
    Utils.toHex((await wallet.createSignature({ data: preimage, protocolID: MANAGED_RECORD_PROTOCOL_ID, keyID: acceptance.requestId, counterparty: 'anyone' })).signature)

  const tampered: ManagedAcceptanceRecord = { ...acceptance, termsDigest: 'ff'.repeat(32) }
  const strangerSigned: ManagedAcceptanceRecord = { ...acceptance, signature: await derivedBy(strangerWallet, acceptanceSigningPreimage(acceptance)) }
  const directlySigned: ManagedAcceptanceRecord = { ...acceptance, signature: Utils.toHex(custodianPriv.sign(acceptanceSigningPreimage(acceptance)).toDER() as number[]) }
  const destinationMismatch = await resign((r) => ({ ...r, acceptance: { ...r.acceptance, destinationKey: controllerKeyOf(strangerPriv) } }))
  const predecessorMismatch = await resign((r) => ({ ...r, expectedPredecessor: { txid: txs[0].id('hex'), outputIndex: 0 } }))
  const holderMismatch = await resign((r) => ({ ...r, offer: { ...r.offer, holderIdentityKey: idKey(strangerPriv) } }))

  // The expired record cannot be produced by the signer, which refuses it, so
  // the fixture carries it signed by hand under the same derivation.
  const expiredByHand: ManagedAcceptanceRecord = await (async () => {
    const claim = { ...acceptance, acceptance: { ...acceptance.acceptance, acceptedAt: '2026-09-16T10:00:00Z' } }
    const { signature: _s, ...unsigned } = claim
    return { ...unsigned, signature: await derivedBy(custodianWallet, acceptanceSigningPreimage(unsigned as ManagedAcceptanceRecord)) }
  })()

  return {
    custodianKey: idKey(custodianPriv),
    holderKey: idKey(issuerPriv),
    recipientKey: idKey(recipientPriv),
    signing: { protocolId: MANAGED_RECORD_PROTOCOL_ID, keyId: acceptance.requestId, counterparty: 'anyone', verificationKey: 'the BRC-42 child of custodianKey for protocolId, keyId and counterparty' },
    record: acceptance,
    canonicalUnsigned: canonicalJson({ ...acceptance, signature: undefined }),
    signingPreimageHex: Utils.toHex(acceptanceSigningPreimage(acceptance)),
    canonicalSigned: canonicalJson(acceptance),
    commitment: acceptanceCommitment(acceptance),
    transfer: {
      txid: txs[2].id('hex'),
      outputIndex: outputIndexes[2],
      rawTx: txs[2].toHex(),
      lineageGenesis: { txid: txs[0].id('hex'), outputIndex: 0 },
      predecessor: { txid: txs[1].id('hex'), outputIndex: 0 },
      authorisationCommitment: transfer.authorisationCommitment,
    },
    refusals: [
      { name: 'tamperedTerms', description: 'termsDigest changed after signing.', record: tampered, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'strangerSigned', description: 'Signed under the managed record protocol from a root other than the custodian the record names.', record: strangerSigned, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'directlySigned', description: "Signed with the custodian's identity key directly, with no derivation, as version 1 was: not a version 2 signature.", record: directlySigned, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'acceptedAfterExpiry', description: 'acceptedAt after expiresAt, signed by the custodian: the offer had expired.', record: expiredByHand, expected: { structureValid: false, signatureValid: null, reason: 'time-order' } },
      { name: 'destinationMismatch', description: 'A well-formed, custodian-signed record naming another destination: it does not describe this TRANSFER.', record: destinationMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'predecessorMismatch', description: 'A well-formed, custodian-signed record naming the genesis as the expected predecessor.', record: predecessorMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'holderMismatch', description: 'A well-formed, custodian-signed record naming a stranger as the offering holder.', record: holderMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
    ],
  }
}

export type ManagedAcceptanceV2Fixture = Awaited<ReturnType<typeof managedAcceptanceV2Fixture>>
