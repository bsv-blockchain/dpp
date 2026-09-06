import { Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import { canonicalJson, CanonicalJsonError } from './canonicalJson.js'
import { MANAGED_CUSTODY_PROFILE } from './constants.js'
import type { DppStateV2, Outpoint } from './types.js'

/**
 * The managed acceptance record (`spec/managed-custody.md` §3): the evidence a
 * custodian retains that the current holder offered a transfer and the
 * intended recipient accepted it through the application, before the
 * custodian spent the tip. A version 2 TRANSFER under the profile carries
 * `authorisation_commitment` equal to the SHA-256 of this record's canonical
 * JSON, signature included, so the on-chain state binds the acceptance and the
 * record binds the exact predecessor, destination key, terms and expiry.
 *
 * What it is: custody-dependent evidence. The custodian signs it; the
 * recipient's key never does. A reader learns that the custodian observed an
 * acceptance under these terms and that the transfer it executed matches them.
 * It is not a signature made with a key the recipient controls, and the record
 * says so in `acceptance.evidenceKind`. A profile that needs recipient-signed
 * acceptance is a later profile with its own record format.
 *
 * What stays out: application account identifiers, claim codes, names and
 * contact details. The recipient is named by the identity key the destination
 * derives from, and a claim code by its SHA-256, so the record can be exported
 * with the passport's public evidence.
 */

export const MANAGED_ACCEPTANCE_FORMAT = 'dpp-managed-acceptance@1' as const
export { MANAGED_CUSTODY_PROFILE }

export type OfferMechanism = 'claim-code' | 'named-recipient'

export interface ManagedAcceptanceClaim {
  acceptanceFormat: typeof MANAGED_ACCEPTANCE_FORMAT
  /** Unique per offer; a retry names the same request and never a second one. */
  requestId: string
  passportId: string
  lineageGenesis: Outpoint
  /** The tip the offer was made against; the TRANSFER must spend exactly this. */
  expectedPredecessor: Outpoint
  /** SHA-256, hex, of the terms as the application presented them to the recipient (the story word, a note, revised restricted values), in the application's own canonical form. */
  termsDigest: string
  offer: {
    /** The current holder's actor identity key, the key field 7 of the TRANSFER carries. */
    holderIdentityKey: string
    createdAt: string
    expiresAt: string
    mechanism: OfferMechanism
    /** claim-code: SHA-256 of the code, hex; named-recipient: the recipient's identity key. Absent when the mechanism carries nothing to reference. */
    recipientRef?: string
  }
  acceptance: {
    /** The recipient's actor identity key, from which the destination derives. */
    recipientIdentityKey: string
    /** The controller key the TRANSFER moves control to: field 6 of the TRANSFER. */
    destinationKey: string
    acceptedAt: string
    /** Always custodian-attested under this format; named so a reader never mistakes it for a recipient signature. */
    evidenceKind: 'custodian-attested'
  }
  /** The custodian's identity key, compressed hex, which signs the record. */
  custodian: string
}

export interface ManagedAcceptanceRecord extends ManagedAcceptanceClaim {
  /** DER ECDSA, lowercase hex, over SHA-256 of the canonical JSON of the record without this property. */
  signature: string
}

export interface AcceptanceSigner {
  sign(preimage: number[]): Promise<number[]> | number[]
}

const KEY = /^0[23][0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const MAX_REQUEST_ID = 128

export type AcceptanceFailureReason =
  | 'format'
  | 'time-order'
  | 'signature-invalid'
  | 'custodian-unexpected'
  | 'state-mismatch'

export interface AcceptanceFailure { reason: AcceptanceFailureReason; detail: string }

export interface AcceptanceInspection {
  /** The record has the declared shape and its own declarations agree. */
  structureValid: boolean
  /** The custodian's signature over the canonical record, or null when the record could not be canonicalised. */
  signatureValid: boolean | null
  /** SHA-256 of the complete signed record in canonical JSON: what a TRANSFER commits to. Present when the record canonicalises. */
  commitment?: string
  failures: AcceptanceFailure[]
}

const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && Utils.toArray(value, 'utf8').length <= maximum && !CONTROL.test(value)

const outpointOk = (value: unknown): value is Outpoint =>
  typeof value === 'object' && value !== null && HEX64.test((value as Outpoint).txid ?? '') && Number.isInteger((value as Outpoint).outputIndex) && (value as Outpoint).outputIndex >= 0

const instant = (value: string): number => Date.parse(value)

/** The bytes the custodian signs: the record without `signature`, in canonical JSON, UTF-8. */
export function acceptanceSigningPreimage(claim: ManagedAcceptanceClaim | ManagedAcceptanceRecord): number[] {
  const { signature: _signature, ...unsigned } = claim as ManagedAcceptanceRecord
  return Utils.toArray(canonicalJson(unsigned), 'utf8')
}

/** The commitment a TRANSFER carries in field 15: SHA-256 of the complete signed record, canonical JSON. */
export function acceptanceCommitment(record: ManagedAcceptanceRecord): string {
  return Utils.toHex(Hash.sha256(Utils.toArray(canonicalJson(record), 'utf8')))
}

function structure(value: unknown, failures: AcceptanceFailure[]): value is ManagedAcceptanceRecord {
  const fail = (reason: AcceptanceFailureReason, detail: string): void => { failures.push({ reason, detail }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('format', 'the record must be an object')
    return false
  }
  const r = value as Record<string, unknown>
  const allowed = new Set(['acceptanceFormat', 'requestId', 'passportId', 'lineageGenesis', 'expectedPredecessor', 'termsDigest', 'offer', 'acceptance', 'custodian', 'signature'])
  for (const key of Object.keys(r)) if (!allowed.has(key)) fail('format', `unsupported property ${key}`)
  if (r.acceptanceFormat !== MANAGED_ACCEPTANCE_FORMAT) fail('format', `acceptanceFormat is not ${MANAGED_ACCEPTANCE_FORMAT}`)
  if (!text(r.requestId, MAX_REQUEST_ID)) fail('format', `requestId must be printable text of at most ${MAX_REQUEST_ID} bytes`)
  if (!text(r.passportId, 512)) fail('format', 'passportId must be printable text of at most 512 bytes')
  if (!outpointOk(r.lineageGenesis)) fail('format', 'lineageGenesis must be an outpoint')
  if (!outpointOk(r.expectedPredecessor)) fail('format', 'expectedPredecessor must be an outpoint')
  if (!HEX64.test(String(r.termsDigest ?? ''))) fail('format', 'termsDigest must be 64 lowercase hex characters')
  const offer = r.offer as Record<string, unknown> | undefined
  if (offer == null || typeof offer !== 'object' || Array.isArray(offer)) fail('format', 'offer must be an object')
  else {
    for (const key of Object.keys(offer)) if (!['holderIdentityKey', 'createdAt', 'expiresAt', 'mechanism', 'recipientRef'].includes(key)) fail('format', `unsupported offer property ${key}`)
    if (!KEY.test(String(offer.holderIdentityKey ?? ''))) fail('format', 'offer.holderIdentityKey must be a compressed public key')
    if (!TIME.test(String(offer.createdAt ?? '')) || !Number.isFinite(instant(String(offer.createdAt)))) fail('format', 'offer.createdAt must be an ISO date-time with a timezone')
    if (!TIME.test(String(offer.expiresAt ?? '')) || !Number.isFinite(instant(String(offer.expiresAt)))) fail('format', 'offer.expiresAt must be an ISO date-time with a timezone')
    if (offer.mechanism !== 'claim-code' && offer.mechanism !== 'named-recipient') fail('format', 'offer.mechanism must be claim-code or named-recipient')
    if (offer.recipientRef !== undefined && !(offer.mechanism === 'claim-code' ? HEX64.test(String(offer.recipientRef)) : KEY.test(String(offer.recipientRef)))) {
      fail('format', 'offer.recipientRef must be a SHA-256 for a claim code or a compressed key for a named recipient')
    }
  }
  const acceptance = r.acceptance as Record<string, unknown> | undefined
  if (acceptance == null || typeof acceptance !== 'object' || Array.isArray(acceptance)) fail('format', 'acceptance must be an object')
  else {
    for (const key of Object.keys(acceptance)) if (!['recipientIdentityKey', 'destinationKey', 'acceptedAt', 'evidenceKind'].includes(key)) fail('format', `unsupported acceptance property ${key}`)
    if (!KEY.test(String(acceptance.recipientIdentityKey ?? ''))) fail('format', 'acceptance.recipientIdentityKey must be a compressed public key')
    if (!KEY.test(String(acceptance.destinationKey ?? ''))) fail('format', 'acceptance.destinationKey must be a compressed public key')
    if (!TIME.test(String(acceptance.acceptedAt ?? '')) || !Number.isFinite(instant(String(acceptance.acceptedAt)))) fail('format', 'acceptance.acceptedAt must be an ISO date-time with a timezone')
    if (acceptance.evidenceKind !== 'custodian-attested') fail('format', 'acceptance.evidenceKind must be custodian-attested')
  }
  if (!KEY.test(String(r.custodian ?? ''))) fail('format', 'custodian must be a compressed public key')
  if (typeof r.signature !== 'string' || !/^(?:[0-9a-f]{2}){8,72}$/.test(r.signature)) fail('format', 'signature must be lowercase DER hex')
  else {
    try {
      const der = Signature.fromDER(r.signature, 'hex')
      if (Utils.toHex(der.toDER() as number[]) !== r.signature) fail('format', 'signature must use canonical DER')
    } catch {
      fail('format', 'signature is not DER')
    }
  }
  if (failures.length > 0) return false
  const record = value as ManagedAcceptanceRecord
  const created = instant(record.offer.createdAt)
  const accepted = instant(record.acceptance.acceptedAt)
  const expires = instant(record.offer.expiresAt)
  if (!(created <= accepted)) fail('time-order', 'acceptedAt precedes createdAt')
  if (!(accepted <= expires)) fail('time-order', 'acceptedAt is after expiresAt: the offer had expired')
  if (record.offer.mechanism === 'named-recipient' && record.offer.recipientRef != null && record.offer.recipientRef !== record.acceptance.recipientIdentityKey) {
    fail('state-mismatch', 'the named recipient is not the accepting identity')
  }
  return failures.length === 0
}

/**
 * Inspect a record on its own: structure, the custodian's signature and, when
 * the caller names the custodians it trusts, whether the signer is one of
 * them. Binding to the TRANSFER that commits to it is `bindAcceptanceToState`.
 */
export function inspectManagedAcceptance(value: unknown, options: { custodians?: readonly string[] } = {}): AcceptanceInspection {
  const failures: AcceptanceFailure[] = []
  const structureValid = structure(value, failures)
  if (!structureValid) return { structureValid, signatureValid: null, failures }
  const record = value as ManagedAcceptanceRecord
  let signatureValid: boolean | null = null
  let commitment: string | undefined
  try {
    const preimage = acceptanceSigningPreimage(record)
    signatureValid = PublicKey.fromString(record.custodian).verify(preimage, Signature.fromDER(Utils.toArray(record.signature, 'hex')))
    commitment = acceptanceCommitment(record)
  } catch (error) {
    signatureValid = error instanceof CanonicalJsonError ? null : false
    if (signatureValid === null) failures.push({ reason: 'format', detail: error instanceof Error ? error.message : 'the record has no canonical form' })
  }
  if (signatureValid === false) failures.push({ reason: 'signature-invalid', detail: `the signature does not verify under custodian ${record.custodian}` })
  if (options.custodians != null && !options.custodians.includes(record.custodian)) {
    failures.push({ reason: 'custodian-unexpected', detail: `signed by ${record.custodian}, not a custodian the policy names` })
  }
  return { structureValid, signatureValid, ...(commitment == null ? {} : { commitment }), failures }
}

/**
 * Whether a version 2 TRANSFER executed exactly the acceptance the record
 * evidences: same passport and lineage, the tip the offer named, the
 * destination the recipient accepted, the holder who offered as the actor,
 * and the record's own commitment in field 15. Every mismatch is named.
 */
export function bindAcceptanceToState(record: ManagedAcceptanceRecord, state: DppStateV2): AcceptanceFailure[] {
  const failures: AcceptanceFailure[] = []
  const fail = (detail: string): void => { failures.push({ reason: 'state-mismatch', detail }) }
  if (state.op !== 'TRANSFER') fail(`the state is a ${state.op}, not a TRANSFER`)
  if (state.passportId !== record.passportId) fail('the state names another passport')
  if (state.lineageGenesis == null || state.lineageGenesis.txid !== record.lineageGenesis.txid || state.lineageGenesis.outputIndex !== record.lineageGenesis.outputIndex) fail('the state names another lineage')
  if (state.previousTxid !== record.expectedPredecessor.txid || state.previousOutputIndex !== record.expectedPredecessor.outputIndex) fail('the state spends a tip other than the one the offer named')
  if (state.ownerIdentityKey !== record.acceptance.destinationKey) fail('the state moves control to a key other than the accepted destination')
  if (state.actorIdentityKey !== record.offer.holderIdentityKey) fail('the state was made by an actor other than the holder who offered')
  if (state.authorisationCommitment !== acceptanceCommitment(record)) fail('the state does not commit to this record')
  if (instant(record.acceptance.acceptedAt) > instant(state.timestamp)) fail('the state is timestamped before the acceptance it executes')
  return failures
}

/** Sign a claim as the custodian. The signer's key must be `claim.custodian`; the result is checked before it is returned. */
export async function signManagedAcceptance(claim: ManagedAcceptanceClaim, signer: AcceptanceSigner): Promise<ManagedAcceptanceRecord> {
  const failures: AcceptanceFailure[] = []
  // A well-formed placeholder (r = 1, s = 1) stands in for the signature while the claim's own shape is checked.
  if (!structure({ ...claim, signature: '3006020101020101' }, failures)) {
    throw new Error(`acceptance record is not well formed: ${failures.map((f) => f.detail).join('; ')}`)
  }
  const der = await signer.sign(acceptanceSigningPreimage(claim))
  const record: ManagedAcceptanceRecord = { ...claim, signature: Utils.toHex(der) }
  const inspection = inspectManagedAcceptance(record)
  if (inspection.signatureValid !== true) throw new Error('the signer does not hold the custodian key the record names')
  return record
}
