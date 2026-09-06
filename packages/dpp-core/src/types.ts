import { DPP_OPS, DPP_OPS_V2 } from './constants.js'

export type DppOpV1 = (typeof DPP_OPS)[number]
export type DppOpV2 = (typeof DPP_OPS_V2)[number]
/** Every operation either record version carries. A version 1 state carries only a `DppOpV1`, a version 2 state only a `DppOpV2`. */
export type DppOp = DppOpV1 | DppOpV2

/** A transaction output by identifier and index; the shape both record versions and the report name outputs by. */
export interface Outpoint {
  txid: string
  outputIndex: number
}

/**
 * The signable content of one version 1 passport state - fields 1–12 of the
 * DPP Token Standard v1 layout (`spec/record-model.md` §3), before signatures.
 */
export interface DppStateData {
  /** Stable GS1-DL-style ID; immutable across the chain; primary lookup key. */
  passportId: string
  op: DppOpV1
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

/** The version 1 data, under the name the version 2 type sits beside. */
export type DppStateDataV1 = DppStateData

/**
 * The signable content of one version 2 passport state - fields 1–15 of the
 * layout in `spec/record-model-v2.md` §3, before signatures. The property
 * names shared with version 1 keep their meaning; `ownerIdentityKey` is the
 * controller key (field 6) and `previousTxid` the txid half of the predecessor
 * outpoint (field 13).
 */
export interface DppStateDataV2 {
  version: '2'
  passportId: string
  op: DppOpV2
  timestamp: string
  /** The controller key, field 6: the per-passport key that names who controls the lineage. */
  ownerIdentityKey: string
  actorIdentityKey: string
  actorKeyId: string
  /** Clear JSON or ''; at most MAX_EVENT_DATA_BYTES_V2 bytes. No property is reserved. */
  eventData: string
  /** Clear JSON, non-empty; at most MAX_PAYLOAD_PUBLIC_BYTES_V2 bytes. */
  payloadPublic: string
  payloadOwnerHash: string
  /** The predecessor's txid, hex; '' on ISSUE. With `previousOutputIndex`, field 13. */
  previousTxid: string
  /** The predecessor's output index; null on ISSUE. */
  previousOutputIndex: number | null
  /** The genesis outpoint of the lineage, field 12; null on ISSUE, which is the genesis. */
  lineageGenesis: Outpoint | null
  /** Field 14: '' or 64 lower-case hex, the BRC-69 scalar linking the actor's root to the previous controller key. */
  controlLinkage: string
  /** Field 15: '' or 64 lower-case hex, the SHA-256 commitment to the off-chain authorisation record the profile names. */
  authorisationCommitment: string
}

/** Either version's signable content. */
export type AnyDppStateData = DppStateDataV1 | DppStateDataV2

interface SignedFields {
  protocolMarker: string
  /** DER ECDSA, the actor's signature (field 13 in version 1, field 16 in version 2). */
  userSignature: number[]
  /** DER ECDSA, the publisher's countersignature (field 14 in version 1, field 17 in version 2). */
  serverSignature: number[]
}

/** A fully signed version 1 state: fields 1–14 decoded from a DPP output. */
export interface DppStateV1 extends DppStateDataV1, SignedFields {
  version: '1'
}

/** A fully signed version 2 state: fields 1–17 decoded from a DPP output. */
export interface DppStateV2 extends DppStateDataV2, SignedFields {}

/** A fully signed state of either version. Narrow on `version`. */
export type DppState = DppStateV1 | DppStateV2

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
   * invariant was not run: the option is off, or the state is not a version 1
   * TRANSFER. A report says "not applicable" for null rather than a vacuous pass.
   * Version 2 states prove control as part of linkage instead (`controlValid`
   * on the inspection).
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
