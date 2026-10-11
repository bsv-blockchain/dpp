import { Hash, Utils } from '@bsv/sdk'

/**
 * Owner-tier blob binding (`spec/record-model.md` §7): the encrypted owner-tier
 * blob lives off-chain. Its SHA-256 goes on-chain as payload_owner_hash
 * (field 11). The fetched ciphertext MUST hash to field 11 before any
 * decryption is attempted (§7); mismatch renders "Could not verify."
 */

/** SHA-256 of the ciphertext blob, hex - the value carried in field 11. */
export function ownerBlobHash(ciphertext: number[]): string {
  return Utils.toHex(Hash.sha256(ciphertext))
}

/** Check fetched ciphertext against the on-chain payload_owner_hash. */
export function verifyOwnerBlob(
  ciphertext: number[],
  payloadOwnerHash: string
): boolean {
  return payloadOwnerHash !== '' && ownerBlobHash(ciphertext) === payloadOwnerHash
}
