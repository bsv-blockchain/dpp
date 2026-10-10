import { LockingScript, OP, PublicKey, Utils, type ScriptChunk } from '@bsv/sdk'
import {
  CARRIER_AMOUNT,
  CARRIER_TOKEN_ID_BYTES,
  DPP_OPS,
  DPP_OPS_V2,
  FIELD_COUNT,
  FIELD_COUNT_V2,
  MAX_ACTOR_KEY_ID_BYTES,
  MAX_EVENT_DATA_BYTES_V2,
  MAX_PASSPORT_ID_BYTES,
  MAX_PAYLOAD_PUBLIC_BYTES_V2,
  NO_EVENT_OPS,
  OUTPOINT_FIELD_BYTES,
  PROTOCOL_MARKER,
  STANDARD_VERSION,
  STANDARD_VERSION_V2,
  STANDARD_VERSION_V3,
} from './constants.js'
import type {
  CarrierPrefix,
  DppOpV1,
  DppOpV2,
  DppState,
  DppStateData,
  DppStateDataV2,
  DppStateDataV3,
  DppStateV1,
  DppStateV2,
  DppStateV3,
  Outpoint,
  SeventeenFieldData,
  SeventeenFieldState,
} from './types.js'

/** Thrown when a script does not carry a well-formed DPP output of a version this reader decodes. */
export class DppFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DppFormatError'
  }
}

/**
 * Minimal-push encoding, verbatim from @bsv/sdk's PushDrop template (it is
 * module-local there and not exported). Produces scripts byte-identical to
 * PushDrop.lock() so connected-path wallets and explorers see the same shape.
 */
function minimalChunk(data: number[]): ScriptChunk {
  if (data.length === 0) return { op: 0 }
  if (data.length === 1 && data[0] === 0) return { op: 0 }
  if (data.length === 1 && data[0] > 0 && data[0] <= 16) return { op: 0x50 + data[0] }
  if (data.length === 1 && data[0] === 0x81) return { op: 0x4f }
  if (data.length <= 75) return { op: data.length, data }
  if (data.length <= 255) return { op: 0x4c, data }
  if (data.length <= 65535) return { op: 0x4d, data }
  return { op: 0x4e, data }
}

/**
 * Inverse of minimal-push encoding for a single chunk. Unlike the SDK's
 * PushDrop.decode, OP_0 maps to the EMPTY field (not [0x00]) - the standard's
 * value domain has zero-length fields but never a lone 0x00 byte.
 * Non-minimal pushes are accepted (tolerant read; field bytes, and therefore
 * signature preimages, are unaffected by push encoding).
 */
function chunkToField(chunk: ScriptChunk): number[] | null {
  if (chunk.data != null && chunk.data.length > 0) {
    return chunk.op >= 1 && chunk.op <= 0x4e ? chunk.data : null
  }
  if (chunk.op === 0) return []
  if (chunk.op >= 0x51 && chunk.op <= 0x60) return [chunk.op - 0x50]
  if (chunk.op === 0x4f) return [0x81]
  return null
}

/** Whether signable content, of any version, is version 2. */
export function isV2Data(d: object): d is DppStateDataV2 {
  return (d as { version?: unknown }).version === STANDARD_VERSION_V2
}

/** Whether signable content, of any version, is version 3: the carried body (`spec/token-carrier.md`). */
export function isV3Data(d: object): d is DppStateDataV3 {
  return (d as { version?: unknown }).version === STANDARD_VERSION_V3
}

/** Whether signable content carries the seventeen-field layout, under version 2 or version 3. */
export function isSeventeenFieldData(d: object): d is SeventeenFieldData {
  return isV2Data(d) || isV3Data(d)
}

/** Fields 1–12 (the signable content) of a version 1 state as raw wire bytes, in standard order. */
export function dataFields(d: DppStateData): number[][] {
  return [
    Utils.toArray(PROTOCOL_MARKER, 'utf8'),
    Utils.toArray(STANDARD_VERSION, 'utf8'),
    Utils.toArray(d.passportId, 'utf8'),
    Utils.toArray(d.op, 'utf8'),
    Utils.toArray(d.timestamp, 'utf8'),
    Utils.toArray(d.ownerIdentityKey, 'hex'),
    Utils.toArray(d.actorIdentityKey, 'hex'),
    Utils.toArray(d.actorKeyId, 'utf8'),
    Utils.toArray(d.eventData, 'utf8'),
    Utils.toArray(d.payloadPublic, 'utf8'),
    Utils.toArray(d.payloadOwnerHash, 'hex'),
    Utils.toArray(d.previousTxid, 'hex'),
  ]
}

/** An outpoint as the version 2 fields 12 and 13 carry it: 32 txid bytes in display order, then a big-endian uint32 index. */
export function outpointFieldBytes(outpoint: Outpoint | null): number[] {
  if (outpoint == null) return []
  const txid = Utils.toArray(outpoint.txid, 'hex')
  if (txid.length !== 32) throw new DppFormatError('an outpoint txid must be 32 bytes')
  const index = outpoint.outputIndex
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new DppFormatError('an outpoint output index must be an unsigned 32-bit integer')
  }
  return [...txid, (index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff]
}

/**
 * Fields 1–15 (the signable content) of a seventeen-field state as raw wire
 * bytes, in standard order. The version string is the data's own: `2` for a
 * version 2 state, `3` for a carried version 3 body (`spec/token-carrier.md` §4).
 */
export function dataFieldsV2(d: SeventeenFieldData): number[][] {
  const predecessor: Outpoint | null =
    d.previousTxid === '' ? null : { txid: d.previousTxid, outputIndex: d.previousOutputIndex ?? -1 }
  return [
    Utils.toArray(PROTOCOL_MARKER, 'utf8'),
    Utils.toArray(d.version, 'utf8'),
    Utils.toArray(d.passportId, 'utf8'),
    Utils.toArray(d.op, 'utf8'),
    Utils.toArray(d.timestamp, 'utf8'),
    Utils.toArray(d.ownerIdentityKey, 'hex'),
    Utils.toArray(d.actorIdentityKey, 'hex'),
    Utils.toArray(d.actorKeyId, 'utf8'),
    Utils.toArray(d.eventData, 'utf8'),
    Utils.toArray(d.payloadPublic, 'utf8'),
    Utils.toArray(d.payloadOwnerHash, 'hex'),
    outpointFieldBytes(d.lineageGenesis),
    outpointFieldBytes(predecessor),
    Utils.toArray(d.controlLinkage, 'hex'),
    Utils.toArray(d.authorisationCommitment, 'hex'),
  ]
}

/** All fields of a state as raw wire bytes: 14 for version 1, 17 for versions 2 and 3. */
export function stateToFields(s: DppState): number[][] {
  const data = s.version === STANDARD_VERSION ? dataFields(s) : dataFieldsV2(s)
  return [...data, [...s.userSignature], [...s.serverSignature]]
}

/** The 32 token id bytes a value output pushes: the deploy txid in internal byte order (`spec/token-carrier.md` §3). */
export function tokenIdWireBytes(deployTxid: string): number[] {
  const bytes = Utils.toArray(deployTxid, 'hex')
  if (bytes.length !== CARRIER_TOKEN_ID_BYTES) throw new DppFormatError('a token id is the 32-byte deploy txid')
  return bytes.reverse()
}

/** The display form of a token id read from the wire: the deploy txid in display order. */
export function tokenIdFromWireBytes(bytes: readonly number[]): string {
  if (bytes.length !== CARRIER_TOKEN_ID_BYTES) throw new DppFormatError('a token id is the 32-byte deploy txid')
  return Utils.toHex([...bytes].reverse())
}

/**
 * The token prefix of a carried state (`spec/token-carrier.md` §2, §3): the
 * token id or OP_0, the amount of one unit as OP_1, and OP_2DROP. No payload
 * is written; the body's first chunk is a 33-byte push followed by
 * OP_CHECKSIG, which the prefix's encoder rule says can never be read as one.
 */
export function carrierPrefixChunks(carrier: CarrierPrefix): ScriptChunk[] {
  const id: ScriptChunk =
    carrier.role === 'deploy' || carrier.tokenId == null
      ? { op: 0 }
      : { op: CARRIER_TOKEN_ID_BYTES, data: tokenIdWireBytes(carrier.tokenId) }
  return [id, { op: 0x50 + CARRIER_AMOUNT }, { op: OP.OP_2DROP }]
}

/**
 * The prefix a version 3 state is carried behind, read from the state itself:
 * a genesis (no predecessor) is the deploy; every later state is a value
 * output naming the lineage genesis as its token id, which the verifier holds
 * field 12 to (`spec/token-carrier.md` §5). The genesis outpoint's index is 0
 * because a deploy is output 0 of its transaction; a state naming another
 * index cannot be carried, and the builder says so rather than guessing.
 */
export function carrierPrefixFor(state: Pick<DppStateDataV3, 'previousTxid' | 'lineageGenesis'>): CarrierPrefix {
  if (state.previousTxid === '') return { role: 'deploy', tokenId: null }
  if (state.lineageGenesis == null) throw new DppFormatError('a carried state after the genesis names its lineage genesis')
  if (state.lineageGenesis.outputIndex !== 0) throw new DppFormatError('a carried lineage begins at output 0 of its deploy')
  return { role: 'value', tokenId: state.lineageGenesis.txid }
}

/**
 * Build the DPP locking script: <33-byte key> OP_CHECKSIG <fields> drops.
 * Custody-neutral (`spec/record-model.md` §2): the locking key may be treasury-derived or user-held.
 * The drop tail is one OP_2DROP per pair of fields and one OP_DROP for an odd
 * field left over: seven OP_2DROP for version 1, eight and an OP_DROP for
 * versions 2 and 3. A version 3 body is carried behind its token prefix
 * (`spec/token-carrier.md` §2), derived from the state unless `carrier`
 * names one, which a fixture does to pin what a reader refuses.
 */
export function buildLockingScript(
  state: DppState,
  lockingPublicKey: PublicKey | string,
  carrier?: CarrierPrefix
): LockingScript {
  const pub =
    typeof lockingPublicKey === 'string'
      ? PublicKey.fromString(lockingPublicKey)
      : lockingPublicKey
  const pubBytes = pub.encode(true) as number[]
  const fields = stateToFields(state)
  const prefix = state.version === STANDARD_VERSION_V3 ? carrierPrefixChunks(carrier ?? carrierPrefixFor(state)) : []
  const chunks: ScriptChunk[] = [
    ...prefix,
    { op: pubBytes.length, data: pubBytes },
    { op: OP.OP_CHECKSIG },
    ...fields.map(minimalChunk),
  ]
  let undropped = fields.length
  while (undropped > 1) {
    chunks.push({ op: OP.OP_2DROP })
    undropped -= 2
  }
  if (undropped !== 0) chunks.push({ op: OP.OP_DROP })
  return new LockingScript(chunks)
}

const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Date.parse refuses most out-of-range components (month 13, hour 25,
 * minute 60) but rolls overflow days forward (2026-02-30 parses as 2 March)
 * and accepts the legacy 24:00 spelling of midnight. The spec demands a real
 * calendar instant: the digits must BE the date they claim.
 */
function isRealInstant(match: RegExpExecArray): boolean {
  const [year, month, day, hour] = [match[1], match[2], match[3], match[4]].map(Number)
  if (hour > 23) return false
  const cal = new Date(0)
  cal.setUTCFullYear(year, month - 1, day)
  return (
    cal.getUTCFullYear() === year &&
    cal.getUTCMonth() === month - 1 &&
    cal.getUTCDate() === day
  )
}

/**
 * Decode a UTF-8 declared field strictly: the bytes must decode and re-encode
 * to themselves. Utils.toUTF8 is lossy (invalid sequences become U+FFFD), so
 * without this check a mangled field slips through decode and only dies at
 * signature verification - and §2 says encoding violations refuse at decode.
 * The round trip is also what lets the signature preimages be recomputed from
 * decoded fields: for accepted states, decoded text and wire bytes are one.
 */
function utf8Field(bytes: number[], name: string): string {
  const text = Utils.toUTF8(bytes)
  const roundTrip = Utils.toArray(text, 'utf8')
  if (
    roundTrip.length !== bytes.length ||
    roundTrip.some((b, i) => b !== bytes[i])
  ) {
    throw new DppFormatError(`${name} must be valid UTF-8`)
  }
  return text
}

function identityKeyHex(bytes: number[], name: string): string {
  if (bytes.length !== 33) {
    throw new DppFormatError(`${name} must be a 33-byte compressed public key`)
  }
  const hex = Utils.toHex(bytes)
  let parsed: PublicKey
  try {
    parsed = PublicKey.fromString(hex)
  } catch {
    throw new DppFormatError(`${name} is not a valid public key`)
  }
  // The SDK accepts x >= p by reducing it mod p. Require the canonical SEC1
  // encoding so on-chain bytes are the unique representation of the key.
  if (parsed.toString() !== hex) {
    throw new DppFormatError(`${name} is not a canonical compressed public key`)
  }
  return hex
}

function digestHex(bytes: number[], name: string): string {
  if (bytes.length === 0) return ''
  if (bytes.length !== 32) {
    throw new DppFormatError(`${name} must be empty or 32 bytes`)
  }
  return Utils.toHex(bytes)
}

/** A version 2 outpoint field: empty, or exactly 36 bytes. */
function outpointField(bytes: number[], name: string): Outpoint | null {
  if (bytes.length === 0) return null
  if (bytes.length !== OUTPOINT_FIELD_BYTES) {
    throw new DppFormatError(`${name} must be empty or ${OUTPOINT_FIELD_BYTES} bytes`)
  }
  const txid = Utils.toHex(bytes.slice(0, 32))
  const outputIndex = ((bytes[32] << 24) >>> 0) + (bytes[33] << 16) + (bytes[34] << 8) + bytes[35]
  return { txid, outputIndex }
}

function requireJson(text: string, name: string): void {
  try {
    JSON.parse(text)
  } catch {
    throw new DppFormatError(`${name} must be valid JSON`)
  }
}

function timestampField(bytes: number[]): string {
  const timestamp = Utils.toUTF8(bytes)
  const isoMatch = ISO_8601.exec(timestamp)
  if (isoMatch == null || Number.isNaN(Date.parse(timestamp))) {
    throw new DppFormatError('timestamp must be ISO 8601')
  }
  if (!isRealInstant(isoMatch)) {
    throw new DppFormatError('timestamp must name a real calendar instant')
  }
  return timestamp
}

/** No field of either version may be the single byte 0x00 (`spec/record-model.md` §2). */
function refuseLoneNul(fields: number[][]): void {
  // Minimal writing encodes it as OP_0, which reads back as the empty field,
  // so it can only arrive by a non-minimal push; admitting it would give one
  // value two spellings.
  fields.forEach((f, i) => {
    if (f.length === 1 && f[0] === 0) {
      throw new DppFormatError(`field ${i + 1} is the single byte 0x00`)
    }
  })
}

function passportIdField(bytes: number[]): string {
  // Bounded in bytes, before decoding: the field is the server signature's
  // BRC-42 key identifier and a wallet refuses one above 800 characters (§3).
  if (bytes.length > MAX_PASSPORT_ID_BYTES) {
    throw new DppFormatError(`passport_id exceeds ${MAX_PASSPORT_ID_BYTES} bytes`)
  }
  const passportId = utf8Field(bytes, 'passport_id')
  if (passportId.length === 0) throw new DppFormatError('passport_id must be non-empty')
  return passportId
}

function actorKeyIdField(bytes: number[]): string {
  // Same reason as passport_id: the user signature's BRC-42 key identifier.
  if (bytes.length > MAX_ACTOR_KEY_ID_BYTES) {
    throw new DppFormatError(`actor_keyID exceeds ${MAX_ACTOR_KEY_ID_BYTES} bytes`)
  }
  const actorKeyId = utf8Field(bytes, 'actor_keyID')
  if (actorKeyId.length === 0) throw new DppFormatError('actor_keyID must be non-empty')
  return actorKeyId
}

/** Validate and type raw version 1 fields per `spec/record-model.md` §2-§3. Throws DppFormatError. */
export function fieldsToState(fields: number[][]): DppStateV1 {
  if (fields.length !== FIELD_COUNT) {
    throw new DppFormatError(`expected ${FIELD_COUNT} fields, found ${fields.length}`)
  }
  refuseLoneNul(fields)
  const marker = Utils.toUTF8(fields[0])
  if (marker !== PROTOCOL_MARKER) {
    throw new DppFormatError(`protocol_marker must be "${PROTOCOL_MARKER}"`)
  }
  const version = Utils.toUTF8(fields[1])
  if (version !== STANDARD_VERSION) {
    throw new DppFormatError(
      version === STANDARD_VERSION_V2
        ? `version "${STANDARD_VERSION_V2}" is carried by the ${FIELD_COUNT_V2}-field layout, not the ${FIELD_COUNT}-field one`
        : `unsupported standard version "${version}"`
    )
  }
  const passportId = passportIdField(fields[2])
  const op = Utils.toUTF8(fields[3]) as DppOpV1
  if (!(DPP_OPS as readonly string[]).includes(op)) {
    throw new DppFormatError(`unknown op "${op}"`)
  }
  const timestamp = timestampField(fields[4])
  const ownerIdentityKey = identityKeyHex(fields[5], 'owner_identity_key')
  const actorIdentityKey = identityKeyHex(fields[6], 'actor_identity_key')
  const actorKeyId = actorKeyIdField(fields[7])
  const eventData = utf8Field(fields[8], 'event_data')
  if (NO_EVENT_OPS.includes(op)) {
    if (eventData !== '') {
      throw new DppFormatError(`event_data must be empty on ${op}`)
    }
  } else if (eventData !== '') {
    requireJson(eventData, 'event_data')
  }
  const payloadPublic = utf8Field(fields[9], 'payload_public')
  if (payloadPublic.length === 0) {
    throw new DppFormatError('payload_public must be present on every state (T2)')
  }
  requireJson(payloadPublic, 'payload_public')
  const payloadOwnerHash = digestHex(fields[10], 'payload_owner_hash')
  const previousTxid = digestHex(fields[11], 'previous_txid')
  const userSignature = fields[12]
  if (userSignature.length === 0) throw new DppFormatError('user_signature must be present')
  const serverSignature = fields[13]
  if (serverSignature.length === 0) {
    throw new DppFormatError('server_signature must be present (§3 field 14)')
  }
  return {
    protocolMarker: marker,
    version: '1',
    passportId,
    op,
    timestamp,
    ownerIdentityKey,
    actorIdentityKey,
    actorKeyId,
    eventData,
    payloadPublic,
    payloadOwnerHash,
    previousTxid,
    userSignature,
    serverSignature,
  }
}

/** Validate and type raw version 2 fields per `spec/record-model-v2.md` §2-§3. Throws DppFormatError. */
export function fieldsToStateV2(fields: number[][]): DppStateV2 {
  return seventeenFieldsToState(fields, STANDARD_VERSION_V2) as DppStateV2
}

/** Validate and type the raw fields of a carried version 3 body per `spec/token-carrier.md` §4. Throws DppFormatError. */
export function fieldsToStateV3(fields: number[][]): DppStateV3 {
  return seventeenFieldsToState(fields, STANDARD_VERSION_V3) as DppStateV3
}

/**
 * The seventeen-field reader both versions share. The version the caller
 * expects is the layout's: version 2 for a bare body, version 3 for a body
 * read from behind a token prefix. The other version's string is refused by
 * name, because one version has one layout: a version 2 body is never
 * carried and a version 3 body is never bare.
 */
function seventeenFieldsToState(fields: number[][], expectedVersion: '2' | '3'): SeventeenFieldState {
  if (fields.length !== FIELD_COUNT_V2) {
    throw new DppFormatError(`expected ${FIELD_COUNT_V2} fields, found ${fields.length}`)
  }
  refuseLoneNul(fields)
  const marker = Utils.toUTF8(fields[0])
  if (marker !== PROTOCOL_MARKER) {
    throw new DppFormatError(`protocol_marker must be "${PROTOCOL_MARKER}"`)
  }
  const version = Utils.toUTF8(fields[1])
  if (version !== expectedVersion) {
    throw new DppFormatError(
      version === STANDARD_VERSION
        ? `version "${STANDARD_VERSION}" is carried by the ${FIELD_COUNT}-field layout, not the ${FIELD_COUNT_V2}-field one`
        : version === STANDARD_VERSION_V3
          ? `version "${STANDARD_VERSION_V3}" is carried behind a token prefix`
          : version === STANDARD_VERSION_V2
            ? `version "${STANDARD_VERSION_V2}" is not carried behind a token prefix`
            : `unsupported standard version "${version}"`
    )
  }
  const passportId = passportIdField(fields[2])
  const op = Utils.toUTF8(fields[3]) as DppOpV2
  if (!(DPP_OPS_V2 as readonly string[]).includes(op)) {
    throw new DppFormatError(`unknown op "${op}"`)
  }
  const timestamp = timestampField(fields[4])
  const ownerIdentityKey = identityKeyHex(fields[5], 'controller_key')
  const actorIdentityKey = identityKeyHex(fields[6], 'actor_identity_key')
  const actorKeyId = actorKeyIdField(fields[7])
  if (fields[8].length > MAX_EVENT_DATA_BYTES_V2) {
    throw new DppFormatError(`event_data exceeds ${MAX_EVENT_DATA_BYTES_V2} bytes`)
  }
  const eventData = utf8Field(fields[8], 'event_data')
  if (eventData !== '') requireJson(eventData, 'event_data')
  if (fields[9].length > MAX_PAYLOAD_PUBLIC_BYTES_V2) {
    throw new DppFormatError(`payload_public exceeds ${MAX_PAYLOAD_PUBLIC_BYTES_V2} bytes`)
  }
  const payloadPublic = utf8Field(fields[9], 'payload_public')
  if (payloadPublic.length === 0) {
    throw new DppFormatError('payload_public must be present on every state')
  }
  requireJson(payloadPublic, 'payload_public')
  const payloadOwnerHash = digestHex(fields[10], 'payload_owner_hash')
  const lineageGenesis = outpointField(fields[11], 'lineage_genesis')
  const predecessor = outpointField(fields[12], 'previous_outpoint')
  const controlLinkage = digestHex(fields[13], 'control_linkage')
  if (op === 'ISSUE' && controlLinkage !== '') {
    throw new DppFormatError('control_linkage must be empty on ISSUE')
  }
  const authorisationCommitment = digestHex(fields[14], 'authorisation_commitment')
  const userSignature = fields[15]
  if (userSignature.length === 0) throw new DppFormatError('actor_signature must be present')
  const serverSignature = fields[16]
  if (serverSignature.length === 0) throw new DppFormatError('publisher_signature must be present')
  return {
    protocolMarker: marker,
    version: expectedVersion,
    passportId,
    op,
    timestamp,
    ownerIdentityKey,
    actorIdentityKey,
    actorKeyId,
    eventData,
    payloadPublic,
    payloadOwnerHash,
    previousTxid: predecessor?.txid ?? '',
    previousOutputIndex: predecessor?.outputIndex ?? null,
    lineageGenesis,
    controlLinkage,
    authorisationCommitment,
    userSignature,
    serverSignature,
  } as SeventeenFieldState
}

/** What a parsed output yields: the state, the locking key, and the token prefix when the state is carried. */
export interface ParsedDppOutput {
  state: DppState
  lockingPublicKey: PublicKey
  /** Present for a version 3 state, which is always carried; absent for versions 1 and 2, which never are. */
  carrier?: CarrierPrefix
}

const isPushChunk = (c: ScriptChunk): boolean => c.op === 0 || (c.op >= 1 && c.op <= 0x4e) || c.op === 0x4f || (c.op >= 0x51 && c.op <= 0x60)

/**
 * Read the BRC-162 token prefix a carried state begins with
 * (`spec/token-carrier.md` §2, §3), or report that the script carries none.
 * A script whose first chunk is a 33-byte push is a bare body and is read as
 * one; a first chunk of OP_0 or a 32- or 36-byte push is a prefix attempt
 * and is held to the carrier's rules: the id is the 32-byte deploy txid, the
 * amount is one unit as OP_1, then OP_2DROP, then no payload except an empty
 * slot on a deploy. Returns the prefix and the index the body starts at.
 */
function readCarrierPrefix(chunks: ScriptChunk[]): { carrier: CarrierPrefix; bodyStart: number } | null {
  const first = chunks[0]
  if (first == null) return null
  const idLength = first.data?.length ?? 0
  const prefixAttempt = first.op === 0 || idLength === CARRIER_TOKEN_ID_BYTES || idLength === 36
  if (!prefixAttempt) return null
  if (chunks.length < 3) throw new DppFormatError('not a DPP output: malformed token prefix')
  if (idLength === 36) throw new DppFormatError('the token id is the 32-byte deploy txid')
  const amount = chunks[1]
  if (amount.op !== 0x50 + CARRIER_AMOUNT) {
    if (amount.data?.length === 1 && amount.data[0] === CARRIER_AMOUNT) {
      throw new DppFormatError('the token amount is a minimally encoded script number')
    }
    throw new DppFormatError(`the token amount is ${CARRIER_AMOUNT}`)
  }
  if (chunks[2].op !== OP.OP_2DROP || chunks[2].data !== undefined) {
    throw new DppFormatError('not a DPP output: malformed token prefix')
  }
  const role: CarrierPrefix['role'] = first.op === 0 ? 'deploy' : 'value'
  const carrier: CarrierPrefix = { role, tokenId: role === 'deploy' ? null : tokenIdFromWireBytes(first.data as number[]) }
  let bodyStart = 3
  // A payload is one push then OP_DROP right after the OP_2DROP. The body's
  // second chunk is OP_CHECKSIG, so a body is never read as a payload.
  if (chunks.length > 4 && isPushChunk(chunks[3]) && chunks[4].op === OP.OP_DROP && chunks[4].data === undefined) {
    if (role === 'value') throw new DppFormatError('a value output carries no payload')
    if (chunks[3].op !== 0) throw new DppFormatError('a genesis carries no payload beyond an empty slot')
    bodyStart = 5
  }
  return { carrier, bodyStart }
}

/**
 * Parse a DPP output script of any version. Throws DppFormatError when the
 * script is not a well-formed DPP output. A bare body is read by field count
 * (fourteen fields for version 1, seventeen for version 2) and the version
 * field must agree with the count. A body behind a token prefix is version 3,
 * read under the version 2 rules with the version 3 string; a version 2 body
 * behind a prefix and a version 3 body without one are refused by name, so an
 * older reader meeting a newer state fails clearly rather than guessing.
 */
export function parseDppOutput(script: LockingScript): ParsedDppOutput {
  const chunks = script.chunks
  const prefix = readCarrierPrefix(chunks)
  const start = prefix?.bodyStart ?? 0
  const key = chunks[start]
  if (chunks.length < start + 2 || key?.data == null || key.data.length !== 33) {
    throw new DppFormatError('not a DPP output: missing 33-byte locking key push')
  }
  if (chunks[start + 1].op !== OP.OP_CHECKSIG) {
    throw new DppFormatError('not a DPP output: missing OP_CHECKSIG')
  }
  const fields: number[][] = []
  let i = start + 2
  for (; i < chunks.length; i++) {
    const op = chunks[i].op
    if (op === OP.OP_2DROP || op === OP.OP_DROP) break
    const field = chunkToField(chunks[i])
    if (field == null) {
      throw new DppFormatError(`not a DPP output: non-push chunk at index ${i}`)
    }
    fields.push(field)
  }
  if (fields.length !== FIELD_COUNT && fields.length !== FIELD_COUNT_V2) {
    throw new DppFormatError(`expected ${FIELD_COUNT} or ${FIELD_COUNT_V2} fields, found ${fields.length}`)
  }
  const tail = chunks.slice(i)
  const twoDrops = Math.floor(fields.length / 2)
  const oneDrop = fields.length % 2
  const tailValid =
    tail.length === twoDrops + oneDrop &&
    tail.slice(0, twoDrops).every((c) => c.op === OP.OP_2DROP && c.data === undefined) &&
    (oneDrop === 0 || (tail[twoDrops].op === OP.OP_DROP && tail[twoDrops].data === undefined))
  if (!tailValid) {
    throw new DppFormatError('not a DPP output: malformed drop tail')
  }
  let lockingPublicKey: PublicKey
  try {
    lockingPublicKey = PublicKey.fromString(Utils.toHex(key.data))
  } catch {
    // Keep the documented contract: every refusal is a DppFormatError.
    throw new DppFormatError('not a DPP output: locking key is not a valid public key')
  }
  if (prefix != null) {
    if (fields.length !== FIELD_COUNT_V2) {
      throw new DppFormatError(`a carried body has ${FIELD_COUNT_V2} fields, found ${fields.length}`)
    }
    return { state: fieldsToStateV3(fields), lockingPublicKey, carrier: prefix.carrier }
  }
  const state = fields.length === FIELD_COUNT_V2 ? fieldsToStateV2(fields) : fieldsToState(fields)
  return { state, lockingPublicKey }
}

/** Non-throwing variant of parseDppOutput, for scanning arbitrary outputs. */
export function tryParseDppOutput(script: LockingScript): ParsedDppOutput | null {
  try {
    return parseDppOutput(script)
  } catch {
    return null
  }
}
