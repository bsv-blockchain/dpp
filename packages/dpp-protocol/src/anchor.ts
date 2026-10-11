import { CachedKeyDeriver, LockingScript, PublicKey, Signature, Utils, type WalletProtocol } from '@bsv/sdk'

/**
 * The generic complete-representation anchor, `bsv-attestation-anchor-v1`
 * (`spec/rules.md` §5 and §6). It lives in the core rather than in the overlay
 * package because a reader in a browser verifies anchors without a database or
 * an overlay engine, and `verifyPassportEvidence` (evidence.ts) reports the
 * anchor rail beside the token rail from one package. `@bsv/dpp-overlay-topics`
 * re-exports every name below unchanged.
 */

export const ATTESTATION_ANCHOR_PREFIX = 'bsv-attestation-anchor-v1'
export const ATTESTATION_ANCHOR_PROTOCOL: WalletProtocol = [1, 'bsv attestation anchor v1']
export const ATTESTATION_ANCHOR_BASKET = 'attestation-anchor'
export const ATTESTATION_ANCHOR_FIELD_COUNT = 9

/** Metadata is authenticated as the anchor service's statement, not as credential authority. */
export interface AnchorMetadata {
  digest: string
  attestationId: string
  issuer: string
  subject: string
  attestationType: string
  representation: string
  mediaType: string
  anchoredBy: string
}
export interface AttestationAnchor extends AnchorMetadata {
  lockingKey: string
  signature: number[]
}
export interface AnchorSigner {
  createSignature(args: { data: number[]; protocolID: WalletProtocol; keyID: string; counterparty: string }): Promise<{ signature: number[] }>
}

const anyone = new CachedKeyDeriver('anyone')
const bounds = [64, 256, 512, 512, 128, 128, 128, 66]

function decodeText(bytes: number[], maximum: number): string {
  const value = Utils.toUTF8(bytes)
  if (!value || bytes.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || Utils.toHex(Utils.toArray(value, 'utf8')) !== Utils.toHex(bytes)) {
    throw new Error('anchor field is not bounded printable UTF-8')
  }
  return value
}

function compressedKey(value: string): PublicKey {
  if (!/^0[23][0-9a-f]{64}$/.test(value)) throw new Error('expected a canonical compressed public key')
  const key = PublicKey.fromString(value)
  if (key.toString() !== value) throw new Error('non-canonical public key')
  return key
}

export function expectedAttestationLockingKey(anchoredBy: string, attestationId: string): PublicKey {
  compressedKey(anchoredBy)
  decodeText(Utils.toArray(attestationId, 'utf8'), 256)
  return anyone.derivePublicKey(ATTESTATION_ANCHOR_PROTOCOL, attestationId, anchoredBy)
}

export function attestationAnchorFields(anchor: AnchorMetadata): number[][] {
  const values = [anchor.digest, anchor.attestationId, anchor.issuer, anchor.subject, anchor.attestationType, anchor.representation, anchor.mediaType, anchor.anchoredBy]
  const fields = values.map((value, index) => {
    if (typeof value !== 'string') throw new Error('anchor metadata must be text')
    const bytes = Utils.toArray(value, 'utf8')
    if (decodeText(bytes, bounds[index]) !== value) throw new Error('invalid UTF-8 metadata')
    return bytes
  })
  if (!/^[0-9a-f]{64}$/.test(anchor.digest)) throw new Error('invalid SHA-256 digest')
  compressedKey(anchor.anchoredBy)
  return [Utils.toArray(ATTESTATION_ANCHOR_PREFIX, 'utf8'), ...fields]
}

export function attestationAnchorSigningPreimage(fields: number[][]): number[] {
  if (fields.length !== ATTESTATION_ANCHOR_FIELD_COUNT) throw new Error('expected nine signed anchor fields')
  const writer = new Utils.Writer()
  for (const field of fields) { writer.writeVarIntNum(field.length); writer.write(field) }
  return writer.toArray()
}

export async function buildAttestationAnchor(anchor: AnchorMetadata, signer: AnchorSigner): Promise<LockingScript> {
  const fields = attestationAnchorFields(anchor)
  const { signature } = await signer.createSignature({
    data: attestationAnchorSigningPreimage(fields), protocolID: ATTESTATION_ANCHOR_PROTOCOL,
    keyID: anchor.attestationId, counterparty: 'anyone',
  })
  const script = new LockingScript()
  script.writeBin(expectedAttestationLockingKey(anchor.anchoredBy, anchor.attestationId).encode(true) as number[])
  script.writeOpCode(0xac)
  for (const field of [...fields, signature]) script.writeBin(field)
  for (let index = 0; index < 5; index++) script.writeOpCode(0x6d)
  if (decodeAttestationAnchor(script) === null) throw new Error('signer does not match anchoredBy')
  return script
}

/**
 * What a reader learnt from one output, check by check, so a report can say
 * which rule failed rather than only that one did. `metadata` is present once
 * the layout and every field bound held; the two Booleans are `null` until the
 * material they need was decoded. `decodeAttestationAnchor` collapses this to
 * the total strict parser the topic manager and the fixtures use.
 */
export interface AttestationAnchorInspection {
  metadata?: AnchorMetadata
  /** Canonical hex of the key in the first push, when it is a canonical compressed key. */
  lockingKey?: string
  /** The child the metadata says the locking key must be, when metadata decoded. */
  derivedKey?: string
  keyDerivationValid: boolean | null
  /** Verified against the derived key, never against whatever key the script happened to carry. */
  signatureValid: boolean | null
  signature?: number[]
  /** The first structural refusal, present when `metadata` is absent or a key did not parse. */
  failure?: string
}

export function inspectAttestationAnchor(script: LockingScript): AttestationAnchorInspection {
  const result: AttestationAnchorInspection = { keyDerivationValid: null, signatureValid: null }
  const chunks = script.chunks
  if (chunks.length !== 17 || chunks[0].data?.length !== 33 || chunks[1].op !== 0xac) {
    result.failure = 'not a bsv-attestation-anchor-v1 layout: expected a 33-byte key, OP_CHECKSIG, ten fields and five OP_2DROP'
    return result
  }
  if (!chunks.slice(12).every(chunk => chunk.op === 0x6d && chunk.data === undefined)) {
    result.failure = 'malformed drop tail: exactly five OP_2DROP must end the script'
    return result
  }
  let fields: number[][]
  try {
    fields = chunks.slice(2, 12).map(chunk => {
      if (chunk.data && chunk.data.length > 0) return chunk.data
      if (chunk.op >= 0x51 && chunk.op <= 0x60) return [chunk.op - 0x50]
      throw new Error('expected nonempty data push')
    })
    if (decodeText(fields[0], 64) !== ATTESTATION_ANCHOR_PREFIX) throw new Error('prefix is not bsv-attestation-anchor-v1')
    const [digest, attestationId, issuer, subject, attestationType, representation, mediaType, anchoredBy] = fields.slice(1, 9).map((field, index) => decodeText(field, bounds[index]))
    const metadata = { digest, attestationId, issuer, subject, attestationType, representation, mediaType, anchoredBy }
    attestationAnchorFields(metadata)
    result.metadata = metadata
  } catch (cause) {
    result.failure = cause instanceof Error ? cause.message : 'anchor fields did not decode'
    return result
  }
  try {
    result.lockingKey = compressedKey(Utils.toHex(chunks[0].data!)).toString()
  } catch (cause) {
    result.failure = `locking key: ${cause instanceof Error ? cause.message : 'invalid'}`
  }
  const derived = expectedAttestationLockingKey(result.metadata.anchoredBy, result.metadata.attestationId)
  result.derivedKey = derived.toString()
  result.keyDerivationValid = result.lockingKey != null && result.lockingKey === result.derivedKey
  try {
    const signature = Signature.fromDER(fields[9])
    if (Utils.toHex(signature.toDER() as number[]) !== Utils.toHex(fields[9])) throw new Error('signature is not canonical DER')
    result.signature = fields[9]
    result.signatureValid = derived.verify(attestationAnchorSigningPreimage(fields.slice(0, 9)), signature)
  } catch (cause) {
    result.signatureValid = false
    result.failure ??= cause instanceof Error ? cause.message : 'signature did not decode'
  }
  return result
}

/** A total strict parser: invalid or legacy outputs return null. No credential proof is implied. */
export function decodeAttestationAnchor(script: LockingScript): AttestationAnchor | null {
  try {
    const inspection = inspectAttestationAnchor(script)
    if (inspection.metadata == null || inspection.lockingKey == null || inspection.signature == null) return null
    if (inspection.keyDerivationValid !== true || inspection.signatureValid !== true) return null
    return { ...inspection.metadata, lockingKey: inspection.lockingKey, signature: inspection.signature }
  } catch { return null }
}
