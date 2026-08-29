import { LockingScript, OP, PublicKey, Utils, type ScriptChunk } from '@bsv/sdk'
import {
  DPP_OPS,
  FIELD_COUNT,
  MAX_ACTOR_KEY_ID_BYTES,
  MAX_PASSPORT_ID_BYTES,
  NO_EVENT_OPS,
  PROTOCOL_MARKER,
  STANDARD_VERSION,
} from './constants.js'
import type { DppOp, DppState, DppStateData } from './types.js'

/** Thrown when a script does not carry a well-formed DPP v1 output. */
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

/** Fields 1–12 (the signable content) as raw wire bytes, in standard order. */
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

/** All 14 fields as raw wire bytes. */
export function stateToFields(s: DppState): number[][] {
  return [...dataFields(s), [...s.userSignature], [...s.serverSignature]]
}

/**
 * Build the DPP locking script: <33-byte key> OP_CHECKSIG <14 fields> drops.
 * Custody-neutral (`spec/record-model.md` §2): the locking key may be treasury-derived or user-held.
 */
export function buildLockingScript(
  state: DppState,
  lockingPublicKey: PublicKey | string
): LockingScript {
  const pub =
    typeof lockingPublicKey === 'string'
      ? PublicKey.fromString(lockingPublicKey)
      : lockingPublicKey
  const pubBytes = pub.encode(true) as number[]
  const chunks: ScriptChunk[] = [
    { op: pubBytes.length, data: pubBytes },
    { op: OP.OP_CHECKSIG },
    ...stateToFields(state).map(minimalChunk),
  ]
  let undropped = FIELD_COUNT
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

function requireJson(text: string, name: string): void {
  try {
    JSON.parse(text)
  } catch {
    throw new DppFormatError(`${name} must be valid JSON`)
  }
}

/** Validate and type raw fields per `spec/record-model.md` §2-§3. Throws DppFormatError. */
export function fieldsToState(fields: number[][]): DppState {
  if (fields.length !== FIELD_COUNT) {
    throw new DppFormatError(`expected ${FIELD_COUNT} fields, found ${fields.length}`)
  }
  // No field may be the single byte 0x00 (§2). Minimal writing encodes it
  // as OP_0, which reads back as the empty field, so it can only arrive by a
  // non-minimal push; admitting it would give one value two spellings.
  fields.forEach((f, i) => {
    if (f.length === 1 && f[0] === 0) {
      throw new DppFormatError(`field ${i + 1} is the single byte 0x00`)
    }
  })
  const marker = Utils.toUTF8(fields[0])
  if (marker !== PROTOCOL_MARKER) {
    throw new DppFormatError(`protocol_marker must be "${PROTOCOL_MARKER}"`)
  }
  const version = Utils.toUTF8(fields[1])
  if (version !== STANDARD_VERSION) {
    throw new DppFormatError(`unsupported standard version "${version}"`)
  }
  // Bounded in bytes, before decoding: the field is the server signature's
  // BRC-42 key identifier and a wallet refuses one above 800 characters (§3).
  if (fields[2].length > MAX_PASSPORT_ID_BYTES) {
    throw new DppFormatError(`passport_id exceeds ${MAX_PASSPORT_ID_BYTES} bytes`)
  }
  const passportId = utf8Field(fields[2], 'passport_id')
  if (passportId.length === 0) throw new DppFormatError('passport_id must be non-empty')
  const op = Utils.toUTF8(fields[3]) as DppOp
  if (!(DPP_OPS as readonly string[]).includes(op)) {
    throw new DppFormatError(`unknown op "${op}"`)
  }
  const timestamp = Utils.toUTF8(fields[4])
  const isoMatch = ISO_8601.exec(timestamp)
  if (isoMatch == null || Number.isNaN(Date.parse(timestamp))) {
    throw new DppFormatError('timestamp must be ISO 8601')
  }
  if (!isRealInstant(isoMatch)) {
    throw new DppFormatError('timestamp must name a real calendar instant')
  }
  const ownerIdentityKey = identityKeyHex(fields[5], 'owner_identity_key')
  const actorIdentityKey = identityKeyHex(fields[6], 'actor_identity_key')
  // Same reason as passport_id: the user signature's BRC-42 key identifier.
  if (fields[7].length > MAX_ACTOR_KEY_ID_BYTES) {
    throw new DppFormatError(`actor_keyID exceeds ${MAX_ACTOR_KEY_ID_BYTES} bytes`)
  }
  const actorKeyId = utf8Field(fields[7], 'actor_keyID')
  if (actorKeyId.length === 0) throw new DppFormatError('actor_keyID must be non-empty')
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
    version,
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

/**
 * Parse a DPP output script. Throws DppFormatError when the script is not a
 * well-formed DPP v1 output.
 */
export function parseDppOutput(script: LockingScript): {
  state: DppState
  lockingPublicKey: PublicKey
} {
  const chunks = script.chunks
  if (chunks.length < 2 || chunks[0].data == null || chunks[0].data.length !== 33) {
    throw new DppFormatError('not a DPP output: missing 33-byte locking key push')
  }
  if (chunks[1].op !== OP.OP_CHECKSIG) {
    throw new DppFormatError('not a DPP output: missing OP_CHECKSIG')
  }
  const fields: number[][] = []
  let i = 2
  for (; i < chunks.length; i++) {
    const op = chunks[i].op
    if (op === OP.OP_2DROP || op === OP.OP_DROP) break
    const field = chunkToField(chunks[i])
    if (field == null) {
      throw new DppFormatError(`not a DPP output: non-push chunk at index ${i}`)
    }
    fields.push(field)
  }
  if (fields.length !== FIELD_COUNT) {
    throw new DppFormatError(`expected ${FIELD_COUNT} fields, found ${fields.length}`)
  }
  const tail = chunks.slice(i)
  const twoDrops = Math.floor(FIELD_COUNT / 2)
  const oneDrop = FIELD_COUNT % 2
  const tailValid =
    tail.length === twoDrops + oneDrop &&
    tail.slice(0, twoDrops).every((c) => c.op === OP.OP_2DROP) &&
    (oneDrop === 0 || tail[twoDrops].op === OP.OP_DROP)
  if (!tailValid) {
    throw new DppFormatError('not a DPP output: malformed drop tail')
  }
  let lockingPublicKey: PublicKey
  try {
    lockingPublicKey = PublicKey.fromString(Utils.toHex(chunks[0].data))
  } catch {
    // Keep the documented contract: every refusal is a DppFormatError.
    throw new DppFormatError('not a DPP output: locking key is not a valid public key')
  }
  return { state: fieldsToState(fields), lockingPublicKey }
}

/** Non-throwing variant of parseDppOutput, for scanning arbitrary outputs. */
export function tryParseDppOutput(script: LockingScript): {
  state: DppState
  lockingPublicKey: PublicKey
} | null {
  try {
    return parseDppOutput(script)
  } catch {
    return null
  }
}
