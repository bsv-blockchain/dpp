import type { WalletProtocol } from '@bsv/sdk'

/**
 * DPP Token Standard v1 - constants (`spec/record-model.md` §2-§3).
 *
 * Encoding decisions pinned by this reference implementation (the standard
 * fixes field order and semantics; byte encodings are pinned here):
 * - protocol_marker: UTF-8 "dpp"
 * - version: UTF-8 "1"
 * - passport_id, op, timestamp, actor_keyID, event_data, payload_public: UTF-8
 * - owner_identity_key, actor_identity_key: 33-byte compressed public key (raw)
 * - payload_owner_hash: 32-byte SHA-256 digest (raw). Zero-length when absent
 * - previous_txid: 32-byte txid, big-endian display order (raw). Zero-length at genesis
 * - user_signature, server_signature: DER-encoded ECDSA signature
 *
 * Zero-length fields are encoded as OP_0. Within the standard's value domain
 * this is unambiguous: no field may legitimately be the single byte 0x00.
 */

export const PROTOCOL_MARKER = 'dpp'
export const STANDARD_VERSION = '1'

/**
 * BRC-43 protocol ID under which both token signatures are created, always
 * with counterparty 'anyone' so any third party can derive the verification
 * key from on-chain data alone (§3 fields 7/8, §5).
 * - user_signature:   actor identity key + keyID = actor_keyID (field 8)
 * - server_signature: service identity key + keyID = passport_id (field 3)
 */
export const DPP_PROTOCOL_ID: WalletProtocol = [1, 'dpp token v1']

/**
 * Upper bounds on the two fields that are also BRC-42 key identifiers
 * (`spec/record-model.md` §3, §5): passport_id keys the server signature,
 * actor_keyID keys the user signature. A conforming wallet refuses a key
 * identifier above 800 characters, so an unbounded field would be a valid
 * record no wallet can sign; the standard bounds them tighter, in bytes of
 * UTF-8, and matches the anchor's subject bound for passport_id.
 */
export const MAX_PASSPORT_ID_BYTES = 512
export const MAX_ACTOR_KEY_ID_BYTES = 256

/** Total PushDrop fields per state (`spec/record-model.md` §3). */
export const FIELD_COUNT = 14

/** Zero-based indices into the 14-field layout. */
export const Field = {
  protocolMarker: 0,
  version: 1,
  passportId: 2,
  op: 3,
  timestamp: 4,
  ownerIdentityKey: 5,
  actorIdentityKey: 6,
  actorKeyId: 7,
  eventData: 8,
  payloadPublic: 9,
  payloadOwnerHash: 10,
  previousTxid: 11,
  userSignature: 12,
  serverSignature: 13,
} as const

export const DPP_OPS = [
  'ACTIVATE',
  'SOLD',
  'RESOLD',
  'REPAIRED',
  'RECYCLED',
  'EDIT',
  'TRANSFER',
] as const

/** Ops that may change payload_public / payload_owner_hash (§6 invariant 7). */
export const PAYLOAD_CHANGE_OPS: readonly string[] = ['ACTIVATE', 'EDIT', 'TRANSFER']

/** Ops on which event_data must be the empty string (§3 field 9). */
export const NO_EVENT_OPS: readonly string[] = ['ACTIVATE', 'EDIT']

/**
 * JSON property inside payload_public carrying the data-carrier reference
 * (chip UID). The lookup service indexes it alongside passport_id, as the
 * `uid` query key in `contracts/overlay.yaml`.
 */
export const PAYLOAD_DATA_CARRIER_KEY = 'dataCarrier'
