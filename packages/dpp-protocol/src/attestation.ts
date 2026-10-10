import { CachedKeyDeriver, Hash, Signature, Utils, type WalletProtocol } from '@bsv/sdk'
import { canonicalBytes } from './canonical.js'
import { identityKeyFromDidKey } from './did.js'
import type { DataSigner } from './signatures.js'

export const LIFECYCLE_CLAIM_FORMAT = 'dpp-lifecycle-v1' as const
export const LIFECYCLE_CLAIM_PROTOCOL: WalletProtocol = [1, 'dpp attestation v1']
export const LIFECYCLE_REPRESENTATION = 'dpp-lifecycle-json-v1' as const
export const LIFECYCLE_MEDIA_TYPE = 'application/json' as const
export type LifecycleEventType = 'Origin' | 'Transfer' | 'Transformation' | 'Disposition'

/** Native token-operation evidence. This is a different format from a VSC SEAL. */
export interface LifecycleClaim {
  claimFormat: typeof LIFECYCLE_CLAIM_FORMAT
  passportId: string
  recordId: string
  eventType: LifecycleEventType
  timestamp: string
  issuer: string
  issuerKeyId: string
  issuerKeyDid?: string
  profile: string
  profile_version: number
}

export interface SignedLifecycleClaim extends LifecycleClaim { signature: string }

export interface LifecycleClaimVerification {
  signature: 'verified' | 'invalid'
  identityBinding: 'key-identified' | 'requires-resolution'
  issuerKey?: string
  reason?: string
}

const allowed = new Set([
  'claimFormat', 'passportId', 'recordId', 'eventType', 'timestamp', 'issuer',
  'issuerKeyId', 'issuerKeyDid', 'profile', 'profile_version', 'signature',
])
const types = new Set(['Origin', 'Transfer', 'Transformation', 'Disposition'])
const anyone = new CachedKeyDeriver('anyone')

function text(value: unknown, field: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${field} must be nonempty printable text`)
  }
  const bytes = Utils.toArray(value, 'utf8')
  if (bytes.length > maximum || Utils.toUTF8(bytes) !== value) throw new Error(`${field} exceeds its UTF-8 bound`)
}

function validate(value: unknown, signed: boolean): asserts value is LifecycleClaim {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('claim must be an object')
  const claim = value as Record<string, unknown>
  for (const field of Object.keys(claim)) {
    if (!allowed.has(field) || (!signed && field === 'signature')) throw new Error(`unsupported claim field ${field}`)
  }
  if (claim.claimFormat !== LIFECYCLE_CLAIM_FORMAT) throw new Error('unsupported claimFormat')
  for (const field of ['passportId', 'recordId', 'issuer'] as const) text(claim[field], field, 512)
  for (const field of ['issuerKeyId', 'profile'] as const) text(claim[field], field, 256)
  if (typeof claim.eventType !== 'string' || !types.has(claim.eventType)) throw new Error('unsupported eventType')
  if (!Number.isSafeInteger(claim.profile_version) || (claim.profile_version as number) < 1) throw new Error('invalid profile_version')
  text(claim.timestamp, 'timestamp', 64)
  const date = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(claim.timestamp)
  if (!date || !Number.isFinite(Date.parse(claim.timestamp))) throw new Error('timestamp must be an ISO date-time with timezone')
  const days = new Date(Date.UTC(Number(date[1]), Number(date[2]), 0)).getUTCDate()
  if (Number(date[3]) < 1 || Number(date[3]) > days) throw new Error('timestamp contains an invalid calendar day')
  if (!/^did:[a-z0-9]+:(?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})*(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})$/.test(claim.issuer as string)) throw new Error('issuer must be a DID without a path, query or fragment')
  if ((claim.issuer as string).startsWith('did:key:')) {
    if (claim.issuerKeyDid !== undefined) throw new Error('did:key issuer must omit issuerKeyDid')
    identityKeyFromDidKey(claim.issuer as string)
  } else {
    text(claim.issuerKeyDid, 'issuerKeyDid', 256)
    identityKeyFromDidKey(claim.issuerKeyDid)
  }
  if (signed) {
    if (typeof claim.signature !== 'string' || !/^(?:[0-9a-f]{2}){8,72}$/.test(claim.signature)) throw new Error('signature must be lowercase DER hex')
    const signature = Signature.fromDER(claim.signature, 'hex')
    if (Utils.toHex(signature.toDER() as number[]) !== claim.signature) throw new Error('signature must use canonical DER')
  }
  canonicalBytes(claim)
}

export function assertSignedLifecycleClaim(value: unknown): asserts value is SignedLifecycleClaim {
  validate(value, true)
}

export async function signLifecycleClaim(claim: LifecycleClaim, signer: DataSigner): Promise<SignedLifecycleClaim> {
  validate(claim, false)
  const { signature } = await signer.createSignature({
    data: canonicalBytes(claim), protocolID: LIFECYCLE_CLAIM_PROTOCOL,
    keyID: claim.passportId, counterparty: 'anyone',
  })
  const signed = { ...claim, signature: Utils.toHex(signature) }
  if (verifyLifecycleClaim(signed).signature !== 'verified') throw new Error('signer does not match the declared issuer key')
  return signed
}

/** This checks native signature attribution; DID authority and status are separate checks. */
export function verifyLifecycleClaim(
  value: unknown,
  expected: { passportId?: string; recordId?: string } = {},
): LifecycleClaimVerification {
  try {
    assertSignedLifecycleClaim(value)
    if (expected.passportId !== undefined && value.passportId !== expected.passportId) throw new Error('passportId does not match the requested subject')
    if (expected.recordId !== undefined && value.recordId !== expected.recordId) throw new Error('recordId does not match the requested state')
    const issuerKey = identityKeyFromDidKey(value.issuerKeyDid ?? value.issuer)
    const { signature, ...claim } = value
    const publicKey = anyone.derivePublicKey(LIFECYCLE_CLAIM_PROTOCOL, value.passportId, issuerKey)
    if (!publicKey.verify(canonicalBytes(claim), Signature.fromDER(signature, 'hex'))) throw new Error('native claim signature does not verify')
    return {
      signature: 'verified', issuerKey,
      identityBinding: value.issuer.startsWith('did:key:') ? 'key-identified' : 'requires-resolution',
    }
  } catch (error) {
    return { signature: 'invalid', identityBinding: 'requires-resolution', reason: error instanceof Error ? error.message : 'invalid claim' }
  }
}

/** The commitment includes the signature. Signing and anchoring have different preimages. */
export function lifecycleClaimBytes(claim: SignedLifecycleClaim): number[] {
  assertSignedLifecycleClaim(claim)
  return canonicalBytes(claim)
}

export function lifecycleClaimDigest(claim: SignedLifecycleClaim): string {
  return Utils.toHex(Hash.sha256(lifecycleClaimBytes(claim)))
}
