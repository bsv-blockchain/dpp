/**
 * The generic anchor format moved into `@bsv/dpp-core` (its `anchor.ts`) so a
 * browser reader and `verifyPassportEvidence` can decode anchors without this
 * package's database and engine dependencies. Every name this module exported
 * is re-exported here unchanged, so the topic manager, the lookup service, the
 * fixtures and every consumer importing from `@bsv/dpp-overlay-topics` keep
 * working without an edit.
 */
export {
  ATTESTATION_ANCHOR_BASKET,
  ATTESTATION_ANCHOR_FIELD_COUNT,
  ATTESTATION_ANCHOR_PREFIX,
  ATTESTATION_ANCHOR_PROTOCOL,
  attestationAnchorFields,
  attestationAnchorSigningPreimage,
  buildAttestationAnchor,
  decodeAttestationAnchor,
  expectedAttestationLockingKey,
  inspectAttestationAnchor,
  type AnchorMetadata,
  type AnchorSigner,
  type AttestationAnchor,
  type AttestationAnchorInspection,
} from '@bsv/dpp-core'
