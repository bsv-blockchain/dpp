import { Hash, Signature, Utils } from '@bsv/sdk'
import { managedRecordVerificationKey } from './acceptance.js'
import { canonicalJson, CanonicalJsonError } from './canonicalJson.js'
import { MANAGED_CUSTODY_PROFILE, MANAGED_RECORD_PROTOCOL_ID } from './constants.js'
import type { DataSigner } from './signatures.js'
import type { Outpoint, SeventeenFieldState } from './types.js'

/**
 * The managed instruction record (`spec/managed-custody.md` §6): the evidence
 * a custodian retains that the passport's holder asked for the `UPDATE` or
 * `RETIRE` the custodian then wrote for them. After a committed `TRANSFER`
 * the holder is a recipient whose keys the custodian keeps, so nothing on
 * the chain distinguishes a state the holder asked for from one the
 * custodian wrote on its own; the record is what does, and the state commits
 * to it in field 15 exactly as a `TRANSFER` commits to its acceptance.
 *
 * What it is: custody-dependent evidence, like the acceptance record. The
 * custodian signs it; the holder's key never does. A reader learns that the
 * custodian attested to a request matching the state it wrote, and the record
 * says so in `evidenceKind`. What the holder asked, in the custodian's own
 * words or form, is committed by `requestDigest` and never carried.
 *
 * The signature is the one a version 2 acceptance record carries: the BRC-42
 * child of the custodian's identity key under `MANAGED_RECORD_PROTOCOL_ID`,
 * key identifier `requestId`, counterparty 'anyone', made with the BRC-100
 * `createSignature` operation and verified by anyone from `custodian`.
 */

export const MANAGED_INSTRUCTION_FORMAT = 'dpp-managed-instruction@1' as const
export { MANAGED_CUSTODY_PROFILE }

export type InstructedOperation = 'UPDATE' | 'RETIRE'

export interface ManagedInstructionClaim {
  instructionFormat: typeof MANAGED_INSTRUCTION_FORMAT
  /** Unique per request; a retry names the same request and never a second one. */
  requestId: string
  passportId: string
  lineageGenesis: Outpoint
  /** The tip the holder's request was made against; the state must spend exactly this. */
  expectedPredecessor: Outpoint
  /** The operation the holder asked for: the state's `op`. */
  operation: InstructedOperation
  /** The key the holder acts under in the state: field 7, the holder's identity key under linkage or the controller key itself under equality. */
  holderIdentityKey: string
  /** SHA-256, hex, of the holder's request as the custodian received it, in the custodian's own canonical form. */
  requestDigest: string
  requestedAt: string
  /** Always custodian-attested under this format; named so a reader never mistakes it for a holder signature. */
  evidenceKind: 'custodian-attested'
  /** The custodian's identity key, compressed hex, which signs the record. */
  custodian: string
}

export interface ManagedInstructionRecord extends ManagedInstructionClaim {
  /** DER ECDSA, lowercase hex, over SHA-256 of the canonical JSON of the record without this property, by the derived key. */
  signature: string
}

const KEY = /^0[23][0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const MAX_REQUEST_ID = 128

export type InstructionFailureReason = 'format' | 'signature-invalid' | 'custodian-unexpected' | 'state-mismatch'

export interface InstructionFailure { reason: InstructionFailureReason; detail: string }

export interface InstructionInspection {
  structureValid: boolean
  signatureValid: boolean | null
  /** SHA-256 of the complete signed record in canonical JSON: what the state commits to. Present when the record canonicalises. */
  commitment?: string
  failures: InstructionFailure[]
}

const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && Utils.toArray(value, 'utf8').length <= maximum && !CONTROL.test(value)

const outpointOk = (value: unknown): value is Outpoint =>
  typeof value === 'object' && value !== null && HEX64.test((value as Outpoint).txid ?? '') && Number.isInteger((value as Outpoint).outputIndex) && (value as Outpoint).outputIndex >= 0

const instant = (value: string): number => Date.parse(value)

/** The bytes the custodian signs: the record without `signature`, in canonical JSON, UTF-8. */
export function instructionSigningPreimage(claim: ManagedInstructionClaim | ManagedInstructionRecord): number[] {
  const { signature: _signature, ...unsigned } = claim as ManagedInstructionRecord
  return Utils.toArray(canonicalJson(unsigned), 'utf8')
}

/** The commitment an UPDATE or RETIRE carries in field 15: SHA-256 of the complete signed record, canonical JSON. */
export function instructionCommitment(record: ManagedInstructionRecord): string {
  return Utils.toHex(Hash.sha256(Utils.toArray(canonicalJson(record), 'utf8')))
}

function structure(value: unknown, failures: InstructionFailure[]): value is ManagedInstructionRecord {
  const fail = (reason: InstructionFailureReason, detail: string): void => { failures.push({ reason, detail }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('format', 'the record must be an object')
    return false
  }
  const r = value as Record<string, unknown>
  const allowed = new Set(['instructionFormat', 'requestId', 'passportId', 'lineageGenesis', 'expectedPredecessor', 'operation', 'holderIdentityKey', 'requestDigest', 'requestedAt', 'evidenceKind', 'custodian', 'signature'])
  for (const key of Object.keys(r)) if (!allowed.has(key)) fail('format', `unsupported property ${key}`)
  if (r.instructionFormat !== MANAGED_INSTRUCTION_FORMAT) fail('format', `instructionFormat is not ${MANAGED_INSTRUCTION_FORMAT}`)
  if (!text(r.requestId, MAX_REQUEST_ID)) fail('format', `requestId must be printable text of at most ${MAX_REQUEST_ID} bytes`)
  if (!text(r.passportId, 512)) fail('format', 'passportId must be printable text of at most 512 bytes')
  if (!outpointOk(r.lineageGenesis)) fail('format', 'lineageGenesis must be an outpoint')
  if (!outpointOk(r.expectedPredecessor)) fail('format', 'expectedPredecessor must be an outpoint')
  if (r.operation !== 'UPDATE' && r.operation !== 'RETIRE') fail('format', 'operation must be UPDATE or RETIRE')
  if (!KEY.test(String(r.holderIdentityKey ?? ''))) fail('format', 'holderIdentityKey must be a compressed public key')
  if (!HEX64.test(String(r.requestDigest ?? ''))) fail('format', 'requestDigest must be 64 lowercase hex characters')
  if (!TIME.test(String(r.requestedAt ?? '')) || !Number.isFinite(instant(String(r.requestedAt)))) fail('format', 'requestedAt must be an ISO date-time with a timezone')
  if (r.evidenceKind !== 'custodian-attested') fail('format', 'evidenceKind must be custodian-attested')
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
  return failures.length === 0
}

/**
 * Inspect a record on its own: structure, the custodian's signature and, when
 * the caller names the custodians it trusts, whether the signer is one of
 * them. Binding to the state that commits to it is `bindInstructionToState`.
 */
export function inspectManagedInstruction(value: unknown, options: { custodians?: readonly string[] } = {}): InstructionInspection {
  const failures: InstructionFailure[] = []
  const structureValid = structure(value, failures)
  if (!structureValid) return { structureValid, signatureValid: null, failures }
  const record = value as ManagedInstructionRecord
  let signatureValid: boolean | null = null
  let commitment: string | undefined
  try {
    const preimage = instructionSigningPreimage(record)
    signatureValid = managedRecordVerificationKey(record.custodian, record.requestId).verify(preimage, Signature.fromDER(Utils.toArray(record.signature, 'hex')))
    commitment = instructionCommitment(record)
  } catch (error) {
    signatureValid = error instanceof CanonicalJsonError ? null : false
    if (signatureValid === null) failures.push({ reason: 'format', detail: error instanceof Error ? error.message : 'the record has no canonical form' })
  }
  if (signatureValid === false) failures.push({ reason: 'signature-invalid', detail: `the signature does not verify under the child of custodian ${record.custodian} for the managed record protocol and request ${record.requestId}` })
  if (options.custodians != null && !options.custodians.includes(record.custodian)) {
    failures.push({ reason: 'custodian-unexpected', detail: `signed by ${record.custodian}, not a custodian the policy names` })
  }
  return { structureValid, signatureValid, ...(commitment == null ? {} : { commitment }), failures }
}

/**
 * Whether a version 2 or 3 UPDATE or RETIRE executed exactly the instruction
 * the record evidences: the operation asked for, the same passport and
 * lineage, the tip the request named, the holder who asked as the actor, the
 * record's own commitment in field 15, and a request no later than the
 * state. Every mismatch is named.
 */
export function bindInstructionToState(record: ManagedInstructionRecord, state: SeventeenFieldState): InstructionFailure[] {
  const failures: InstructionFailure[] = []
  const fail = (detail: string): void => { failures.push({ reason: 'state-mismatch', detail }) }
  if (state.op !== record.operation) fail(`the state is a ${state.op}, not the ${record.operation} the holder asked for`)
  if (state.passportId !== record.passportId) fail('the state names another passport')
  if (state.lineageGenesis == null || state.lineageGenesis.txid !== record.lineageGenesis.txid || state.lineageGenesis.outputIndex !== record.lineageGenesis.outputIndex) fail('the state names another lineage')
  if (state.previousTxid !== record.expectedPredecessor.txid || state.previousOutputIndex !== record.expectedPredecessor.outputIndex) fail('the state spends a tip other than the one the request named')
  if (state.actorIdentityKey !== record.holderIdentityKey) fail('the state was made by an actor other than the holder who asked')
  if (state.authorisationCommitment !== instructionCommitment(record)) fail('the state does not commit to this record')
  if (instant(record.requestedAt) > instant(state.timestamp)) fail('the state is timestamped before the request it executes')
  return failures
}

/**
 * Sign a claim as the custodian: `createSignature` under
 * `MANAGED_RECORD_PROTOCOL_ID`, the claim's `requestId` and counterparty
 * 'anyone', from the wallet whose identity key is `claim.custodian`. The
 * result is checked before it is returned, so a wallet holding another root
 * is refused.
 */
export async function signManagedInstruction(claim: ManagedInstructionClaim, signer: DataSigner): Promise<ManagedInstructionRecord> {
  const failures: InstructionFailure[] = []
  if (!structure({ ...claim, signature: '3006020101020101' }, failures)) {
    throw new Error(`instruction record is not well formed: ${failures.map((f) => f.detail).join('; ')}`)
  }
  const { signature: der } = await signer.createSignature({ data: instructionSigningPreimage(claim), protocolID: MANAGED_RECORD_PROTOCOL_ID, keyID: claim.requestId, counterparty: 'anyone' })
  const record: ManagedInstructionRecord = { ...claim, signature: Utils.toHex(der) }
  const inspection = inspectManagedInstruction(record)
  if (inspection.signatureValid !== true) throw new Error('the signer does not hold the custodian key the record names')
  return record
}
