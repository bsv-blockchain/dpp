import { Utils } from '@bsv/sdk'
import {
  acceptanceCommitment,
  acceptanceSigningPreimage,
  canonicalJson,
  signManagedAcceptance,
  type ManagedAcceptanceRecord,
} from '../src/index.js'
import { buildChainV2Fixture, controllerKeyOf, custodianPriv, custodianSigner, idKey, issuerPriv, recipientPriv, strangerPriv } from './helpers-v2.js'

/**
 * One managed acceptance record (`spec/managed-custody.md` §3), pinned byte
 * for byte with the TRANSFER that commits to it, and the records a verifier
 * must refuse. Generated, never typed: `fixtures/managed-acceptance-v1.json`
 * is this function's output verbatim.
 *
 * The refusals are of three kinds, and a reader reports them apart. A record
 * whose bytes were changed after signing fails the custodian's signature. A
 * record the custodian signed but whose times or names contradict each other
 * fails its own structure. A record the custodian signed, well formed, that
 * does not describe the TRANSFER it is presented with fails the binding: it
 * evidences some acceptance, and not this one.
 */
export async function managedAcceptanceV1Fixture() {
  const { txs, states, outputIndexes, acceptance } = await buildChainV2Fixture()
  const transfer = states[2]
  if (transfer.version !== '2') throw new Error('fixture transfer is not version 2')
  const resign = async (edit: (r: ManagedAcceptanceRecord) => ManagedAcceptanceRecord): Promise<ManagedAcceptanceRecord> => {
    const { signature: _s, ...claim } = edit({ ...acceptance })
    return await signManagedAcceptance(claim, custodianSigner)
  }
  const stranger = { sign: (preimage: number[]) => strangerPriv.sign(preimage).toDER() as number[] }

  const tampered: ManagedAcceptanceRecord = { ...acceptance, termsDigest: 'ff'.repeat(32) }
  const strangerSigned: ManagedAcceptanceRecord = { ...acceptance, signature: Utils.toHex(stranger.sign(acceptanceSigningPreimage(acceptance))) }
  const destinationMismatch = await resign((r) => ({ ...r, acceptance: { ...r.acceptance, destinationKey: controllerKeyOf(strangerPriv) } }))
  const predecessorMismatch = await resign((r) => ({ ...r, expectedPredecessor: { txid: txs[0].id('hex'), outputIndex: 0 } }))
  const holderMismatch = await resign((r) => ({ ...r, offer: { ...r.offer, holderIdentityKey: idKey(strangerPriv) } }))

  // The expired record cannot be produced by the signer, which refuses it, so
  // the fixture carries it signed by hand over the same preimage rule.
  const expiredByHand: ManagedAcceptanceRecord = (() => {
    const claim = { ...acceptance, acceptance: { ...acceptance.acceptance, acceptedAt: '2026-09-16T10:00:00Z' } }
    const { signature: _s, ...unsigned } = claim
    return { ...unsigned, signature: Utils.toHex(custodianSigner.sign(acceptanceSigningPreimage(unsigned as ManagedAcceptanceRecord))) }
  })()

  return {
    custodianKey: idKey(custodianPriv),
    holderKey: idKey(issuerPriv),
    recipientKey: idKey(recipientPriv),
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
      { name: 'strangerSigned', description: "Signed by a key other than the custodian the record names.", record: strangerSigned, expected: { structureValid: true, signatureValid: false, reason: 'signature-invalid' } },
      { name: 'acceptedAfterExpiry', description: 'acceptedAt after expiresAt, signed by the custodian: the offer had expired.', record: expiredByHand, expected: { structureValid: false, signatureValid: null, reason: 'time-order' } },
      { name: 'destinationMismatch', description: 'A well-formed, custodian-signed record naming another destination: it does not describe this TRANSFER.', record: destinationMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'predecessorMismatch', description: 'A well-formed, custodian-signed record naming the genesis as the expected predecessor.', record: predecessorMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
      { name: 'holderMismatch', description: 'A well-formed, custodian-signed record naming a stranger as the offering holder.', record: holderMismatch, expected: { structureValid: true, signatureValid: true, reason: 'state-mismatch', bindingFails: true } },
    ],
  }
}
