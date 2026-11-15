/**
 * @bsv/dpp-protocol - DPP protocol reference implementation.
 *
 * Single source of truth (build-guide hard rule 3) for:
 * - field layout encode/decode (`spec/record-model.md` §2-§3)
 * - the canonical signature preimage (§5)
 * - chain verification incl. SPV (§6, §8)
 * - owner-tier blob hash binding (§7)
 * - did:key for identity keys, and the derivation a verifier needs (`spec/identity.md`)
 * - the canonical bytes an attestation is signed and hashed over (`spec/rules.md` §4)
 * - the EPCIS lifecycle claim and its RFC 8785 bytes (`spec/epcis-lifecycle-claim.md`)
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
export * from './owner.js'
export * from './canonical.js'
export * from './attestation.js'
export * from './anchor.js'
export * from './evidence.js'
export * from './canonicalJson.js'
export * from './publisherPolicy.js'
export * from './evidencePackage.js'
export * from './acceptance.js'
export * from './registration.js'
export * from './jcs.js'
export * from './lifecycleEvent.js'
// `./epcisEvent.js`, the directly signed EPCIS event profile `epcis-event-vc@1`,
// is deliberately absent: the profile is parked while its representation is
// reconsidered (`spec/epcis-event-profile.md`). The module, its tests and its
// vectors stay in the repository as the parked record, and nothing here
// exports it. `./epcisShared.js`, the EPCIS helpers it shares with the
// lifecycle claim, is internal and not exported either.
