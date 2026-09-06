/**
 * EPC binary strings, decoded for the one scope the discovery profile
 * declares (`spec/gs1-discovery.md` §3): a serialised trade item under the
 * GS1 EPC Tag Data Standard's SGTIN-96 and SGTIN-198 schemes. A compressed GS1
 * Digital Link URI whose compression string begins `eh` or `ex` carries such a
 * string (GS1 Digital Link URI: Compression Technical Standard for EPC binary
 * strings, release 1.0.0, July 2025, §4.1 and §4.2), and a GS1-Conformant
 * Resolver must decompress it (GS1-Conformant Resolver 1.2.1 §2.3).
 *
 * Everything here is arithmetic over a bit string: the two alphabets of §4.1
 * and §4.2, the SGTIN partition table of the Tag Data Standard, the 38-bit
 * integer serial of SGTIN-96 and the twenty seven-bit characters of SGTIN-198.
 * Nothing is guessed: a header this module does not implement, a company
 * prefix or item reference outside its partition's digit count, a serial with
 * a character the GS1 encodable set 82 does not contain, or a string of the
 * wrong length is refused by name. A decoding establishes what the bits say
 * and no more; it is not evidence that the GTIN was allocated to anyone.
 */
import { gs1CheckDigit } from './identifiers.js'

/** The EPC header of the SGTIN-96 scheme (Tag Data Standard). */
export const SGTIN_96_HEADER = 0x30
/** The EPC header of the SGTIN-198 scheme (Tag Data Standard). */
export const SGTIN_198_HEADER = 0x36

/** The file-safe, URI-safe base 64 alphabet of the compression standard §4.1 (RFC 4648 §5). */
export const URI_SAFE_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * The SGTIN partition table of the Tag Data Standard: for each partition
 * value, the bits and digits of the GS1 Company Prefix and of the item
 * reference (indicator digit included). The two digit counts always sum to
 * thirteen, so the GTIN-14 is the indicator digit, the company prefix, the
 * rest of the item reference and a check digit.
 */
export const SGTIN_PARTITIONS: ReadonlyArray<{ companyPrefixBits: number; companyPrefixDigits: number; itemReferenceBits: number; itemReferenceDigits: number }> = [
  { companyPrefixBits: 40, companyPrefixDigits: 12, itemReferenceBits: 4, itemReferenceDigits: 1 },
  { companyPrefixBits: 37, companyPrefixDigits: 11, itemReferenceBits: 7, itemReferenceDigits: 2 },
  { companyPrefixBits: 34, companyPrefixDigits: 10, itemReferenceBits: 10, itemReferenceDigits: 3 },
  { companyPrefixBits: 30, companyPrefixDigits: 9, itemReferenceBits: 14, itemReferenceDigits: 4 },
  { companyPrefixBits: 27, companyPrefixDigits: 8, itemReferenceBits: 17, itemReferenceDigits: 5 },
  { companyPrefixBits: 24, companyPrefixDigits: 7, itemReferenceBits: 20, itemReferenceDigits: 6 },
  { companyPrefixBits: 20, companyPrefixDigits: 6, itemReferenceBits: 24, itemReferenceDigits: 7 },
]

/** The GS1 AI encodable character set 82, which the SGTIN-198 serial and every Digital Link qualifier value draw from. */
export const GS1_CHARACTER_SET_82 = /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]+$/

export interface SgtinDecoding {
  ok: true
  scheme: 'sgtin-96' | 'sgtin-198'
  /** The eight-bit EPC header, as read. */
  header: number
  /** The three-bit filter value, preserved and not interpreted. */
  filter: number
  partition: number
  companyPrefix: string
  /** The item reference with its indicator digit first, at the partition's digit count. */
  itemReference: string
  /** The GTIN at fourteen digits, check digit computed. */
  gtin: string
  serial: string
  /** The pure-identity EPC URI of the Tag Data Standard, with the serial percent-escaped as that standard requires. */
  epcUri: string
}

export type EpcBinaryRefusalReason =
  | 'empty'
  | 'not-hex'
  | 'not-uri-safe-base64'
  | 'unsupported-epc-scheme'
  | 'length'
  | 'partition'
  | 'company-prefix'
  | 'item-reference'
  | 'serial'

export interface EpcBinaryRefusal {
  ok: false
  reason: EpcBinaryRefusalReason
  detail: string
  /** The header as two hex digits, when the string was long enough to read one. */
  header?: string
}

export type EpcBinaryDecoding = SgtinDecoding | EpcBinaryRefusal

const refuse = (reason: EpcBinaryRefusal['reason'], detail: string, header?: string): EpcBinaryRefusal => ({ ok: false, reason, detail, ...(header == null ? {} : { header }) })

/** A string of `0` and `1` from lower-case hexadecimal, four bits per character (compression standard §4.2.1). */
export function bitsFromHex(hex: string): string | undefined {
  if (hex.length === 0 || !/^[0-9a-f]+$/.test(hex)) return undefined
  let bits = ''
  for (const character of hex) bits += parseInt(character, 16).toString(2).padStart(4, '0')
  return bits
}

/** A string of `0` and `1` from the URI-safe base 64 alphabet, six bits per character (compression standard §4.1). */
export function bitsFromUriSafeBase64(text: string): string | undefined {
  if (text.length === 0) return undefined
  let bits = ''
  for (const character of text) {
    const index = URI_SAFE_BASE64_ALPHABET.indexOf(character)
    if (index === -1) return undefined
    bits += index.toString(2).padStart(6, '0')
  }
  return bits
}

function integerOf(bits: string): bigint {
  let value = 0n
  for (const bit of bits) value = (value << 1n) | (bit === '1' ? 1n : 0n)
  return value
}

/**
 * The serial of an SGTIN-198: twenty seven-bit characters, the string ending
 * at the first all-zero character, everything after it required to be zero
 * padding. The Tag Data Standard draws the characters from the encodable set
 * 82; a character outside it, or an empty serial, is refused.
 */
function decodeSerial198(bits: string): { serial: string } | { error: string } {
  let serial = ''
  let ended = false
  for (let index = 0; index < 20; index++) {
    const code = Number(integerOf(bits.slice(index * 7, index * 7 + 7)))
    if (code === 0) {
      ended = true
      continue
    }
    if (ended) return { error: 'a character follows the serial terminator' }
    const character = String.fromCharCode(code)
    if (!GS1_CHARACTER_SET_82.test(character)) return { error: `character code ${code} is outside the GS1 encodable set 82` }
    serial += character
  }
  if (serial.length === 0) return { error: 'the serial is empty' }
  return { serial }
}

/** The Tag Data Standard's percent-escaping of the pure-identity URI's serial component. */
function escapeSerialForUri(serial: string): string {
  return serial.replace(/[%"&/<>?#]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/**
 * Decode an EPC binary string, given as bits, under the SGTIN-96 and SGTIN-198
 * schemes. The bit count must be exactly the scheme's length; a hexadecimal
 * encoding of a 198-bit string carries two padding bits, which must be zero.
 */
export function decodeEpcBinaryBits(bits: string): EpcBinaryDecoding {
  if (bits.length < 8) return refuse('length', `${bits.length} bits cannot carry an EPC header`)
  const header = Number(integerOf(bits.slice(0, 8)))
  const headerHex = header.toString(16).padStart(2, '0')
  let scheme: SgtinDecoding['scheme']
  let serialBits: number
  if (header === SGTIN_96_HEADER) {
    scheme = 'sgtin-96'
    serialBits = 38
    if (bits.length !== 96) return refuse('length', `SGTIN-96 is 96 bits; ${bits.length} were given`, headerHex)
  } else if (header === SGTIN_198_HEADER) {
    scheme = 'sgtin-198'
    serialBits = 140
    if (bits.length === 200) {
      if (bits.slice(198) !== '00') return refuse('length', 'the two padding bits after an SGTIN-198 must be zero', headerHex)
      bits = bits.slice(0, 198)
    } else if (bits.length !== 198) {
      return refuse('length', `SGTIN-198 is 198 bits (200 in hexadecimal with zero padding); ${bits.length} were given`, headerHex)
    }
  } else {
    return refuse('unsupported-epc-scheme', `EPC header ${headerHex} is not SGTIN-96 (30) or SGTIN-198 (36); only serialised trade items are decoded`, headerHex)
  }
  const filter = Number(integerOf(bits.slice(8, 11)))
  const partition = Number(integerOf(bits.slice(11, 14)))
  const layout = SGTIN_PARTITIONS[partition]
  if (layout == null) return refuse('partition', `partition value ${partition} is not defined for SGTIN`, headerHex)
  let at = 14
  const companyPrefixValue = integerOf(bits.slice(at, at + layout.companyPrefixBits))
  at += layout.companyPrefixBits
  const itemReferenceValue = integerOf(bits.slice(at, at + layout.itemReferenceBits))
  at += layout.itemReferenceBits
  if (companyPrefixValue >= 10n ** BigInt(layout.companyPrefixDigits)) return refuse('company-prefix', `the company prefix exceeds ${layout.companyPrefixDigits} digits`, headerHex)
  if (itemReferenceValue >= 10n ** BigInt(layout.itemReferenceDigits)) return refuse('item-reference', `the item reference exceeds ${layout.itemReferenceDigits} digits`, headerHex)
  const companyPrefix = companyPrefixValue.toString().padStart(layout.companyPrefixDigits, '0')
  const itemReference = itemReferenceValue.toString().padStart(layout.itemReferenceDigits, '0')
  let serial: string
  const serialField = bits.slice(at, at + serialBits)
  if (scheme === 'sgtin-96') {
    serial = integerOf(serialField).toString()
  } else {
    const decoded = decodeSerial198(serialField)
    if ('error' in decoded) return refuse('serial', decoded.error, headerHex)
    serial = decoded.serial
  }
  const thirteen = `${itemReference[0]}${companyPrefix}${itemReference.slice(1)}`
  const gtin = `${thirteen}${gs1CheckDigit(thirteen)}`
  return {
    ok: true,
    scheme,
    header,
    filter,
    partition,
    companyPrefix,
    itemReference,
    gtin,
    serial,
    epcUri: `urn:epc:id:sgtin:${companyPrefix}.${itemReference}.${escapeSerialForUri(serial)}`,
  }
}

/**
 * Decode the compression string of a special compressed GS1 Digital Link URI:
 * the two characters after the slash select the alphabet (`eh` hexadecimal,
 * `ex` URI-safe base 64) and the rest is the EPC binary string.
 */
export function decodeEpcCompressionString(compressionString: string): EpcBinaryDecoding {
  if (compressionString.startsWith('eh')) {
    const payload = compressionString.slice(2)
    if (payload.length === 0) return refuse('empty', 'nothing follows the eh prefix')
    const bits = bitsFromHex(payload)
    if (bits == null) return refuse('not-hex', 'the characters after eh are not lower-case hexadecimal')
    return decodeEpcBinaryBits(bits)
  }
  if (compressionString.startsWith('ex')) {
    const payload = compressionString.slice(2)
    if (payload.length === 0) return refuse('empty', 'nothing follows the ex prefix')
    const bits = bitsFromUriSafeBase64(payload)
    if (bits == null) return refuse('not-uri-safe-base64', 'the characters after ex are not from the URI-safe base 64 alphabet')
    return decodeEpcBinaryBits(bits)
  }
  return refuse('unsupported-epc-scheme', 'the compression string begins with neither eh nor ex; the general GS1 Digital Link compression is not decoded here')
}

/**
 * The inverse, for tests and for a writer that prints a compressed carrier:
 * an SGTIN-96 or SGTIN-198 EPC binary string as bits, from its parts. Refuses
 * a serial the scheme cannot carry rather than truncating it.
 */
export function encodeSgtinBits(input: { scheme: 'sgtin-96' | 'sgtin-198'; filter: number; partition: number; companyPrefix: string; itemReference: string; serial: string }): string {
  const layout = SGTIN_PARTITIONS[input.partition]
  if (layout == null) throw new Error('partition value must be 0 to 6')
  if (!/^\d+$/.test(input.companyPrefix) || input.companyPrefix.length !== layout.companyPrefixDigits) throw new Error(`a partition ${input.partition} company prefix has ${layout.companyPrefixDigits} digits`)
  if (!/^\d+$/.test(input.itemReference) || input.itemReference.length !== layout.itemReferenceDigits) throw new Error(`a partition ${input.partition} item reference has ${layout.itemReferenceDigits} digits`)
  if (!Number.isInteger(input.filter) || input.filter < 0 || input.filter > 7) throw new Error('the filter value is three bits')
  const field = (value: bigint, width: number): string => value.toString(2).padStart(width, '0')
  let bits = field(BigInt(input.scheme === 'sgtin-96' ? SGTIN_96_HEADER : SGTIN_198_HEADER), 8) + field(BigInt(input.filter), 3) + field(BigInt(input.partition), 3)
  bits += field(BigInt(input.companyPrefix), layout.companyPrefixBits) + field(BigInt(input.itemReference), layout.itemReferenceBits)
  if (input.scheme === 'sgtin-96') {
    if (!/^(0|[1-9]\d*)$/.test(input.serial) || BigInt(input.serial) >= 2n ** 38n) throw new Error('an SGTIN-96 serial is an integer below 2^38 without leading zeros')
    bits += field(BigInt(input.serial), 38)
  } else {
    if (input.serial.length === 0 || input.serial.length > 20 || !GS1_CHARACTER_SET_82.test(input.serial)) throw new Error('an SGTIN-198 serial is 1 to 20 characters of the GS1 encodable set 82')
    for (const character of input.serial) bits += field(BigInt(character.charCodeAt(0)), 7)
    bits = bits.padEnd(198, '0')
  }
  return bits
}

/** Bits to the `eh` form: lower-case hexadecimal, zero-padded to a multiple of four bits. */
export function hexFromBits(bits: string): string {
  const padded = bits.padEnd(Math.ceil(bits.length / 4) * 4, '0')
  let hex = ''
  for (let at = 0; at < padded.length; at += 4) hex += parseInt(padded.slice(at, at + 4), 2).toString(16)
  return hex
}

/** Bits to the `ex` form: the URI-safe base 64 alphabet, zero-padded to a multiple of six bits. */
export function uriSafeBase64FromBits(bits: string): string {
  const padded = bits.padEnd(Math.ceil(bits.length / 6) * 6, '0')
  let text = ''
  for (let at = 0; at < padded.length; at += 6) text += URI_SAFE_BASE64_ALPHABET[parseInt(padded.slice(at, at + 6), 2)]
  return text
}
