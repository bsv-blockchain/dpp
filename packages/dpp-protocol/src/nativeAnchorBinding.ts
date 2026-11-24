import { Utils } from '@bsv/sdk'
import type { AnchorMetadata } from './anchor.js'
import { LIFECYCLE_MEDIA_TYPE, type SignedLifecycleClaim } from './attestation.js'
import { CanonicalError, canonicalBytes } from './canonical.js'

/** Read the native flat object only if its complete input has the unique encoding of spec/rules.md §4. */
export function parseCanonicalClaimBytes(bytes: number[]): object {
  const value: unknown = JSON.parse(Utils.toUTF8Strict(bytes))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalError('a native claim must be a flat object')
  }
  // Duplicate member names, including escaped spellings, cannot survive a
  // canonical round trip. Compare bytes to cover encoding and whitespace too.
  const canonical = canonicalBytes(value)
  if (canonical.length !== bytes.length || canonical.some((byte, index) => byte !== bytes[index])) {
    throw new CanonicalError('the supplied native claim must use restricted canonical JSON')
  }
  return value
}

/** Compare the native content metadata after the complete signed claim and its digest have verified. */
export function nativeAnchorMetadataMismatches(meta: AnchorMetadata, claim: SignedLifecycleClaim, digest: string): string[] {
  const mismatches: string[] = []
  if (meta.issuer !== claim.issuer) mismatches.push('issuer')
  if (meta.subject !== claim.passportId) mismatches.push('subject')
  if (meta.attestationType !== claim.eventType) mismatches.push('attestationType')
  if (meta.attestationId !== `urn:sha256:${digest}`) mismatches.push('attestationId')
  if (meta.mediaType !== LIFECYCLE_MEDIA_TYPE) mismatches.push('mediaType')
  return mismatches
}
