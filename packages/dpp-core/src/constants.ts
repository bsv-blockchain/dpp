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
 * BRC-43 protocol ID of the owner key (`spec/custody.md` §2, `spec/record-model.md`
 * §3 field 6): field 6 SHOULD be the owner's root derived under this protocol
 * with keyID = passport_id and counterparty 'self', one level, so a BRC-100
 * wallet produces it with getPublicKey and spends a tip locked to it with the
 * PushDrop unlock (`spec/custody.md` §3). 'self' is what makes holdings
 * unlinkable: nobody but the root can compute or confirm the child.
 */
export const OWNER_PROTOCOL_ID: WalletProtocol = [1, 'dpp owner v1']

/**
 * The event_data property a TRANSFER carries to prove, under the optional
 * owner-signed transfer invariant (`spec/custody.md` §4), that the actor's root
 * derived the previous owner key: the BRC-69 specific key linkage, 64 lower-case
 * hex characters. Reserved on TRANSFER; meaningless elsewhere.
 */
export const OWNER_LINKAGE_KEY = 'owner_linkage'

/** The one accepted spelling of the linkage scalar: one value, one spelling. */
export const OWNER_LINKAGE_HEX = /^[0-9a-f]{64}$/

/**
 * What a BRC-100 wallet encrypts the linkage under when it reveals it
 * (revealSpecificKeyLinkage: `[2, 'specific linkage revelation <level> <name>']`
 * of the target protocol, keyID = the target keyID, counterparty = the
 * verifier). The verifier decrypts with the prover as counterparty.
 */
export const OWNER_LINKAGE_REVELATION_PROTOCOL_ID: WalletProtocol = [
  2,
  `specific linkage revelation ${OWNER_PROTOCOL_ID[0]} ${OWNER_PROTOCOL_ID[1]}`,
]

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

/*
 * DPP Token Standard version 2 (`spec/record-model-v2.md`). A second wire
 * contract beside version 1, never a reinterpretation of it: a reader decodes
 * each version under its own rules, and a version 1 state keeps the meaning
 * it had when it was written. What version 2 adds is stated once here and
 * enforced in the codec, the preimages and the transition rules.
 *
 * - Four operations: ISSUE, UPDATE, TRANSFER, RETIRE. Sector events live on
 *   the attestation rail, not in the token.
 * - Seventeen fields: the fourteen of version 1 with the predecessor named as
 *   an outpoint, the lineage bound to its genesis outpoint, the control proof
 *   carried as its own field and a commitment to off-chain authorisation
 *   evidence.
 * - Both signature preimages are length-framed and domain-tagged, so two
 *   different field tuples never share signed bytes and a signature made for
 *   one purpose or version never verifies for another.
 * - Retirement is terminal under the DPP validity rules: no state may follow
 *   a RETIRE. The simple locking script does not make a later Bitcoin spend
 *   impossible; a reader refuses what such a spend would carry.
 */

export const STANDARD_VERSION_V2 = '2'

/** The record versions a reader of this release decodes; any other value is refused by name. */
export const SUPPORTED_VERSIONS = ['1', '2'] as const
export type DppVersion = (typeof SUPPORTED_VERSIONS)[number]

/**
 * BRC-43 protocol ID of both version 2 record signatures, counterparty
 * 'anyone' as in version 1. Distinct from `DPP_PROTOCOL_ID` so a key derived
 * for one version signs nothing under the other.
 */
export const DPP_PROTOCOL_ID_V2: WalletProtocol = [1, 'dpp token v2']

/** Total PushDrop fields per version 2 state. */
export const FIELD_COUNT_V2 = 17

/** Zero-based indices into the seventeen-field layout. */
export const FieldV2 = {
  protocolMarker: 0,
  version: 1,
  passportId: 2,
  op: 3,
  timestamp: 4,
  controllerKey: 5,
  actorIdentityKey: 6,
  actorKeyId: 7,
  eventData: 8,
  payloadPublic: 9,
  payloadOwnerHash: 10,
  lineageGenesis: 11,
  previousOutpoint: 12,
  controlLinkage: 13,
  authorisationCommitment: 14,
  actorSignature: 15,
  publisherSignature: 16,
} as const

export const DPP_OPS_V2 = ['ISSUE', 'UPDATE', 'TRANSFER', 'RETIRE'] as const

/** Version 2 ops that may change payload_public / payload_owner_hash. RETIRE changes neither. */
export const PAYLOAD_CHANGE_OPS_V2: readonly string[] = ['ISSUE', 'UPDATE', 'TRANSFER']

/** Version 2 ops whose actor must prove control of the predecessor. */
export const CONTROL_PROOF_OPS_V2: readonly string[] = ['UPDATE', 'TRANSFER', 'RETIRE']

/**
 * The domain tags that open the two version 2 preimages. Each preimage is the
 * tag, then every signed field, each as a Bitcoin VarInt length followed by
 * its bytes (`spec/record-model-v2.md` §5), so the actor preimage and the
 * publisher preimage of one state, and the preimages of any two states,
 * never share bytes by accident.
 */
export const RECORD_V2_ACTOR_TAG = 'dpp-record-v2/actor-signature'
export const RECORD_V2_PUBLISHER_TAG = 'dpp-record-v2/publisher-signature'

/**
 * Byte bounds on the two JSON fields, in UTF-8 bytes (§3). Version 1 left
 * them unbounded; version 2 keeps on-chain data intentional. A profile may
 * bound them tighter, never wider.
 */
export const MAX_EVENT_DATA_BYTES_V2 = 4096
export const MAX_PAYLOAD_PUBLIC_BYTES_V2 = 65535

/** An outpoint field: the 32-byte txid in display order, then the output index as four big-endian bytes. */
export const OUTPOINT_FIELD_BYTES = 36

/** The custody profile Part B delivers: managed custody with explicit recipient acceptance (`spec/managed-custody.md`). */
export const MANAGED_CUSTODY_PROFILE = 'managed-custody@1'
