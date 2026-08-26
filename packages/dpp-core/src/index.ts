/**
 * @bsv/dpp-core - DPP Token Standard v1 reference implementation.
 *
 * Single source of truth (build-guide hard rule 3) for:
 * - field layout encode/decode (`spec/record-model.md` §2-§3)
 * - the canonical signature preimage (§5)
 * - chain verification incl. SPV (§6, §8)
 * - owner-tier blob hash binding (§7)
 * - did:key for identity keys, and the derivation a verifier needs (`spec/identity.md`)
 * - the canonical bytes an attestation is signed and hashed over (`spec/rules.md` §4)
 *
 * Imported by the overlay topic manager and every consuming application.
 */

export * from './constants.js'
export * from './types.js'
export * from './codec.js'
export * from './signatures.js'
export * from './transition.js'
export * from './verifyChain.js'
export * from './blob.js'
export * from './did.js'
export * from './canonical.js'
