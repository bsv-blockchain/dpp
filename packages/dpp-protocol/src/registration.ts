import { CachedKeyDeriver, PublicKey, Signature, Utils, type WalletProtocol } from '@bsv/sdk'
import { canonicalJson, CanonicalJsonError } from './canonicalJson.js'
import type { DataSigner } from './signatures.js'

/**
 * The index registration request (`spec/services.md` section 2): what an
 * application's wallet signs to ask an index to admit states its publisher
 * key countersigns. The index that accepts it appends a policy version naming
 * the key (`publisherPolicy.ts`, `appendPublisherVersion`) and hands back the
 * application's write credentials.
 *
 * The request verifies from itself. Its signature is by the BRC-42 child of
 * `publisherKey` for `INDEX_REGISTRATION_PROTOCOL_ID`, key identifier the
 * request's own `indexUrl` and counterparty 'anyone': a BRC-100 wallet signs
 * it with `createSignature`, a stranger derives the verification key from the
 * request, and a request signed for one index is useless at another, because
 * the index compares `indexUrl` with its own address and the derivation
 * changes with it. `requestedAt` bounds replay to a clock window the index
 * chooses, and the index's own record of which keys registered stops a second
 * collection of credentials.
 *
 * The object is flat and every value is a string, so its canonical form under
 * `canonicalJson` (keys sorted by code point, no whitespace) is the same bytes
 * the flat form of `spec/rules.md` section 4 would give; it is cited as the
 * nested form because the acceptance record it mirrors is.
 */

export const INDEX_REGISTRATION_FORMAT = 'dpp-index-registration@1' as const
export const INDEX_REGISTRATION_PROTOCOL_ID: WalletProtocol = [1, 'dpp index registration v1']

export interface RegistrationClaim {
  registrationFormat: typeof INDEX_REGISTRATION_FORMAT
  /** The index's public address as the application configured it, http or https, at most 512 bytes. */
  indexUrl: string
  /** The key the application's states will be countersigned by: compressed, lower-case hex. */
  publisherKey: string
  network: 'main' | 'test'
  /** The custody profile the application writes under, for example managed-custody@2. */
  custodyProfile: string
  /** The application's name for the operator's eyes: printable text of at most 128 bytes. */
  label: string
  /** ISO 8601 with a timezone. */
  requestedAt: string
}

export interface RegistrationRequest extends RegistrationClaim {
  /** DER ECDSA, lower-case hex, over SHA-256 of the canonical JSON of the request without this property. */
  signature: string
}

export type RegistrationFailureReason =
  | 'format'
  | 'signature-invalid'
  | 'index-url-mismatch'
  | 'network-mismatch'
  | 'custody-profile-mismatch'
  | 'request-stale'

export interface RegistrationFailure { reason: RegistrationFailureReason; detail: string }

export interface RegistrationExpectations {
  now: Date
  /** The index's own address; unset, the request's indexUrl is not compared. */
  indexUrl?: string
  network?: string
  custodyProfile?: string
  /** How far from `now` requestedAt may lie, either way. Default ten minutes. */
  windowMs?: number
}

export interface RegistrationInspection {
  valid: boolean
  failures: RegistrationFailure[]
  /** The request as typed, when its shape and signature hold. */
  request?: RegistrationRequest
}

export const DEFAULT_REGISTRATION_WINDOW_MS = 10 * 60 * 1000
const MAX_INDEX_URL_BYTES = 512
const MAX_LABEL_BYTES = 128
const KEY = /^0[23][0-9a-f]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const ALLOWED = new Set(['registrationFormat', 'indexUrl', 'publisherKey', 'network', 'custodyProfile', 'label', 'requestedAt', 'signature'])

/** Deriver for counterparty-'anyone' verification keys: the verifier's own key is 1, so anyone computes the child. */
const anyone = new CachedKeyDeriver('anyone')

/** The key a request's signature verifies under: the BRC-42 child of the publisher key for the registration protocol, the index URL and counterparty 'anyone'. */
export function registrationVerificationKey(publisherKey: string, indexUrl: string): PublicKey {
  return anyone.derivePublicKey(INDEX_REGISTRATION_PROTOCOL_ID, indexUrl, publisherKey)
}

/** The bytes the wallet signs: the request without `signature`, in canonical JSON, UTF-8. */
export function registrationSigningPreimage(claim: RegistrationClaim | RegistrationRequest): number[] {
  const { signature: _signature, ...unsigned } = claim as RegistrationRequest
  return Utils.toArray(canonicalJson(unsigned), 'utf8')
}

const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && Utils.toArray(value, 'utf8').length <= maximum && !CONTROL.test(value)

/** An http or https URL with a host: the grammar alone, since this package runs where no URL parser is assumed. */
const INDEX_URL = /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/

const indexUrlOk = (value: unknown): value is string => text(value, MAX_INDEX_URL_BYTES) && INDEX_URL.test(value)

function structure(value: unknown, failures: RegistrationFailure[]): value is RegistrationRequest {
  const fail = (detail: string): void => { failures.push({ reason: 'format', detail }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('the request must be an object')
    return false
  }
  const r = value as Record<string, unknown>
  for (const key of Object.keys(r)) if (!ALLOWED.has(key)) fail(`unsupported property ${key}`)
  if (r.registrationFormat !== INDEX_REGISTRATION_FORMAT) fail(`registrationFormat is not ${INDEX_REGISTRATION_FORMAT}`)
  if (!indexUrlOk(r.indexUrl)) fail(`indexUrl must be an http or https URL of at most ${MAX_INDEX_URL_BYTES} bytes`)
  if (!KEY.test(String(r.publisherKey ?? ''))) fail('publisherKey must be a compressed public key in lower-case hex')
  if (r.network !== 'main' && r.network !== 'test') fail('network must be main or test')
  if (!text(r.custodyProfile, MAX_LABEL_BYTES)) fail(`custodyProfile must be printable text of at most ${MAX_LABEL_BYTES} bytes`)
  if (!text(r.label, MAX_LABEL_BYTES)) fail(`label must be printable text of at most ${MAX_LABEL_BYTES} bytes`)
  if (!TIME.test(String(r.requestedAt ?? '')) || !Number.isFinite(Date.parse(String(r.requestedAt)))) fail('requestedAt must be an ISO date-time with a timezone')
  if (typeof r.signature !== 'string' || !/^(?:[0-9a-f]{2}){8,72}$/.test(r.signature)) fail('signature must be lowercase DER hex')
  else {
    try {
      const der = Signature.fromDER(r.signature, 'hex')
      if (Utils.toHex(der.toDER() as number[]) !== r.signature) fail('signature must use canonical DER')
    } catch {
      fail('signature is not DER')
    }
  }
  return failures.length === 0
}

/**
 * Inspect a request on its own: shape, the signature under the key the
 * request itself names, and then each expectation the index states. Every
 * mismatch is named; the shape failures come alone, because nothing after
 * them is meaningful.
 */
export function inspectRegistration(value: unknown, expectations: RegistrationExpectations): RegistrationInspection {
  const failures: RegistrationFailure[] = []
  if (!structure(value, failures)) return { valid: false, failures }
  const request = value as RegistrationRequest
  let signatureValid = false
  try {
    signatureValid = registrationVerificationKey(request.publisherKey, request.indexUrl).verify(registrationSigningPreimage(request), Signature.fromDER(Utils.toArray(request.signature, 'hex')))
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      failures.push({ reason: 'format', detail: error.message })
      return { valid: false, failures }
    }
  }
  if (!signatureValid) {
    failures.push({ reason: 'signature-invalid', detail: `the signature does not verify under the child of ${request.publisherKey} for the index registration protocol and index URL ${request.indexUrl}` })
    return { valid: false, failures }
  }
  if (expectations.indexUrl != null && request.indexUrl !== expectations.indexUrl) {
    failures.push({ reason: 'index-url-mismatch', detail: `the request is for ${request.indexUrl}, not this index` })
  }
  if (expectations.network != null && request.network !== expectations.network) {
    failures.push({ reason: 'network-mismatch', detail: `the request names network ${request.network}; this index serves ${expectations.network}` })
  }
  if (expectations.custodyProfile != null && request.custodyProfile !== expectations.custodyProfile) {
    failures.push({ reason: 'custody-profile-mismatch', detail: `the request names custody profile ${request.custodyProfile}; this index admits under ${expectations.custodyProfile}` })
  }
  const window = expectations.windowMs ?? DEFAULT_REGISTRATION_WINDOW_MS
  if (Math.abs(Date.parse(request.requestedAt) - expectations.now.getTime()) > window) {
    failures.push({ reason: 'request-stale', detail: `requestedAt ${request.requestedAt} is more than ${window} ms from the index's clock` })
  }
  return { valid: failures.length === 0, failures, request }
}

/**
 * Sign a claim as the application: `createSignature` under
 * `INDEX_REGISTRATION_PROTOCOL_ID`, the claim's `indexUrl` and counterparty
 * 'anyone', from the wallet whose identity key is `claim.publisherKey`. The
 * result is checked before it is returned, so a wallet holding another root
 * is refused.
 */
export async function signRegistration(claim: RegistrationClaim, signer: DataSigner): Promise<RegistrationRequest> {
  const failures: RegistrationFailure[] = []
  // A well-formed placeholder (r = 1, s = 1) stands in for the signature while the claim's own shape is checked.
  if (!structure({ ...claim, signature: '3006020101020101' }, failures)) {
    throw new Error(`registration request is not well formed: ${failures.map((f) => f.detail).join('; ')}`)
  }
  const { signature: der } = await signer.createSignature({ data: registrationSigningPreimage(claim), protocolID: INDEX_REGISTRATION_PROTOCOL_ID, keyID: claim.indexUrl, counterparty: 'anyone' })
  const request: RegistrationRequest = { ...claim, signature: Utils.toHex(der) }
  const inspection = inspectRegistration(request, { now: new Date(claim.requestedAt), windowMs: Number.MAX_SAFE_INTEGER })
  if (!inspection.valid) throw new Error('the signer does not hold the publisher key the request names')
  return request
}
