import { DPP_OPS } from './constants.js'

export type DppOp = (typeof DPP_OPS)[number]

/**
 * The signable content of one passport state - fields 1–12 of the
 * DPP Token Standard v1 layout (`spec/record-model.md` §3), before signatures.
 */
export interface DppStateData {
  /** Stable GS1-DL-style ID; immutable across the chain; primary lookup key. */
  passportId: string
  op: DppOp
  /** Actor-asserted ISO 8601; bounded by neighbouring blocks (§3 field 5). */
  timestamp: string
  /** Current owner's compressed public key, hex; SHOULD be the owner's BRC-42 child under OWNER_PROTOCOL_ID (§3 field 6). */
  ownerIdentityKey: string
  /** Compressed public key, hex, of who performed this state change. */
  actorIdentityKey: string
  /** Published keyID for the actor signature; enables open verification. */
  actorKeyId: string
  /** Clear JSON event metadata; '' on ACTIVATE and EDIT. */
  eventData: string
  /** Clear JSON, the record's public tier (`spec/record-model.md` §3 field 10). */
  payloadPublic: string
  /** SHA-256 hex of the off-chain owner-tier ciphertext blob; '' if none. */
  payloadOwnerHash: string
  /** Prior tip txid, hex; '' at genesis. Must equal the spent outpoint's txid. */
  previousTxid: string
}

/** A fully signed state: fields 1–14 decoded from a DPP output. */
export interface DppState extends DppStateData {
  protocolMarker: string
  version: string
  /** DER ECDSA, actor signature over fields 1–12 (counterparty 'anyone'). */
  userSignature: number[]
  /** DER ECDSA, service signature over fields 1–13 (admission policy, §5). */
  serverSignature: number[]
}

/** One link of a passport chain as needed for verification. */
export interface DppChainEntry {
  state: DppState
  txid: string
  /** Output index of the DPP output within its transaction. */
  outputIndex: number
}

export type SpvStatus = 'verified' | 'pending'

export interface StateCheck {
  txid: string
  op: DppOp
  userSignatureValid: boolean
  serverSignatureValid: boolean | null
  linkageValid: boolean
  /**
   * The optional owner-signed transfer (`spec/custody.md` §4). null when the
   * invariant was not run: the option is off, or the state is not a TRANSFER.
   * A report says "not applicable" for null rather than a vacuous pass.
   */
  ownerConsentValid: boolean | null
  spv: SpvStatus | 'failed'
}

export interface ChainVerifyResult {
  valid: boolean
  /**
   * 'verified' only when the chain is valid and every state proved against
   * block headers. 'pending' covers both an unmined state and one that could
   * not be checked, because to a reader those are the same sentence:
   * inclusion is not proved yet. A chain that fails verification also says
   * 'pending', whatever its proofs said, so no consumer can print "inclusion
   * proved" beside "could not verify"; the per-state detail in `states`
   * keeps 'failed' where a proof was refuted.
   */
  spv: SpvStatus
  states: StateCheck[]
  /** Human-readable reason for the first failure, when valid === false. */
  error?: string
  /**
   * Set when the chain tracker could not answer at least once, carrying the
   * first such error. Operational signal only: an outage leaves SPV 'pending'
   * rather than 'failed', and this is how a caller can tell the two apart.
   */
  spvUnavailable?: string
}
