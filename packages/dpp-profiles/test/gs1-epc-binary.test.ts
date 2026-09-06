import { describe, expect, it } from 'vitest'
import {
  SGTIN_198_HEADER,
  SGTIN_96_HEADER,
  bitsFromHex,
  bitsFromUriSafeBase64,
  decodeEpcBinaryBits,
  decodeEpcCompressionString,
  encodeSgtinBits,
  hexFromBits,
  uriSafeBase64FromBits,
} from '../src/gs1-epc-binary.js'

/**
 * The two worked examples of the compression standard (§4.2.1 and §4.2.2)
 * express one SGTIN-96 two ways; both must decode to the same identifiers.
 * They are the independent expected results the decoder is held to: GS1
 * published them, this package did not.
 */
const WORKED_HEX = 'eh30164596f40c0e5cbe991a83'
const WORKED_BASE64 = 'exMBZFlvQMDly-mRqD'
const WORKED = { gtin: '09528765123457', serial: '123456789123', companyPrefix: '9528765', itemReference: '012345', partition: 5, filter: 0 }

describe('EPC binary strings under the two compression alphabets', () => {
  it('reads hexadecimal at four bits a character and the URI-safe base 64 alphabet at six', () => {
    expect(bitsFromHex('30')).toBe('00110000')
    expect(bitsFromHex('3G')).toBeUndefined()
    expect(bitsFromHex('3A')).toBeUndefined()
    expect(bitsFromUriSafeBase64('MB')).toBe('001100000001')
    expect(bitsFromUriSafeBase64('M+')).toBeUndefined()
    expect(bitsFromUriSafeBase64('')).toBeUndefined()
  })

  it('decodes the standard\'s worked example in both spellings to one SGTIN-96', () => {
    for (const compressed of [WORKED_HEX, WORKED_BASE64]) {
      const decoded = decodeEpcCompressionString(compressed)
      expect(decoded.ok, compressed).toBe(true)
      if (!decoded.ok) return
      expect(decoded.scheme).toBe('sgtin-96')
      expect(decoded.header).toBe(SGTIN_96_HEADER)
      expect(decoded.filter).toBe(WORKED.filter)
      expect(decoded.partition).toBe(WORKED.partition)
      expect(decoded.companyPrefix).toBe(WORKED.companyPrefix)
      expect(decoded.itemReference).toBe(WORKED.itemReference)
      expect(decoded.gtin).toBe(WORKED.gtin)
      expect(decoded.serial).toBe(WORKED.serial)
      expect(decoded.epcUri).toBe('urn:epc:id:sgtin:9528765.012345.123456789123')
    }
  })

  it('round-trips every partition through the encoder, in both schemes and both alphabets', () => {
    const prefixes = ['952000000000', '95200000000', '9520000000', '952000000', '95200000', '9520000', '952000']
    const references = ['1', '12', '123', '1234', '12345', '123456', '1234567']
    for (let partition = 0; partition <= 6; partition++) {
      const bits96 = encodeSgtinBits({ scheme: 'sgtin-96', filter: 1, partition, companyPrefix: prefixes[partition], itemReference: references[partition], serial: '274877906943' })
      expect(bits96).toHaveLength(96)
      for (const text of [`eh${hexFromBits(bits96)}`, `ex${uriSafeBase64FromBits(bits96)}`]) {
        const decoded = decodeEpcCompressionString(text)
        expect(decoded.ok, text).toBe(true)
        if (!decoded.ok) return
        expect(decoded.companyPrefix).toBe(prefixes[partition])
        expect(decoded.itemReference).toBe(references[partition])
        expect(decoded.serial).toBe('274877906943')
        expect(decoded.filter).toBe(1)
      }
      const bits198 = encodeSgtinBits({ scheme: 'sgtin-198', filter: 3, partition, companyPrefix: prefixes[partition], itemReference: references[partition], serial: 'SER-2026/A(1)' })
      expect(bits198).toHaveLength(198)
      expect(hexFromBits(bits198)).toHaveLength(50)
      expect(uriSafeBase64FromBits(bits198)).toHaveLength(33)
      for (const text of [`eh${hexFromBits(bits198)}`, `ex${uriSafeBase64FromBits(bits198)}`]) {
        const decoded = decodeEpcCompressionString(text)
        expect(decoded.ok, text).toBe(true)
        if (!decoded.ok) return
        expect(decoded.scheme).toBe('sgtin-198')
        expect(decoded.header).toBe(SGTIN_198_HEADER)
        expect(decoded.serial).toBe('SER-2026/A(1)')
        expect(decoded.epcUri).toBe(`urn:epc:id:sgtin:${prefixes[partition]}.${references[partition]}.SER-2026%2FA(1)`)
      }
    }
  })

  it('computes the GTIN check digit rather than carrying one, on the demonstration prefix', () => {
    const bits = encodeSgtinBits({ scheme: 'sgtin-96', filter: 0, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: '7' })
    const decoded = decodeEpcBinaryBits(bits)
    expect(decoded.ok && decoded.gtin).toBe('09521234000013')
  })

  it('refuses what it does not decode, by name', () => {
    expect(decodeEpcCompressionString('eh')).toMatchObject({ ok: false, reason: 'empty' })
    expect(decodeEpcCompressionString('ex')).toMatchObject({ ok: false, reason: 'empty' })
    expect(decodeEpcCompressionString('eh30164596F40C0E5CBE991A83')).toMatchObject({ ok: false, reason: 'not-hex' })
    expect(decodeEpcCompressionString('exMBZFlvQMDly+mRqD')).toMatchObject({ ok: false, reason: 'not-uri-safe-base64' })
    expect(decodeEpcCompressionString('AQnYUc')).toMatchObject({ ok: false, reason: 'unsupported-epc-scheme' })
    // SSCC-96 carries header 31: a real GS1 scheme, outside the declared scope.
    expect(decodeEpcCompressionString('eh31' + '0'.repeat(22))).toMatchObject({ ok: false, reason: 'unsupported-epc-scheme', header: '31' })
    expect(decodeEpcCompressionString('eh3016')).toMatchObject({ ok: false, reason: 'length', header: '30' })
    expect(decodeEpcCompressionString(`${WORKED_HEX}00`)).toMatchObject({ ok: false, reason: 'length' })
    // Partition 7 is undefined for SGTIN.
    const badPartition = '00110000' + '000' + '111' + '0'.repeat(82)
    expect(decodeEpcBinaryBits(badPartition)).toMatchObject({ ok: false, reason: 'partition' })
    // Partition 5 company prefix has seven digits: a value of ten million does not fit.
    const bigPrefix = '00110000' + '000' + '101' + (10_000_000).toString(2).padStart(24, '0') + '0'.repeat(20) + '0'.repeat(38)
    expect(decodeEpcBinaryBits(bigPrefix)).toMatchObject({ ok: false, reason: 'company-prefix' })
    const bigReference = '00110000' + '000' + '101' + '0'.repeat(24) + (1_000_000).toString(2).padStart(20, '0') + '0'.repeat(38)
    expect(decodeEpcBinaryBits(bigReference)).toMatchObject({ ok: false, reason: 'item-reference' })
    // An SGTIN-198 with no serial, and one whose serial resumes after the terminator.
    const head198 = '00110110' + '000' + '101' + '0'.repeat(24) + '0'.repeat(20)
    expect(decodeEpcBinaryBits(head198 + '0'.repeat(140))).toMatchObject({ ok: false, reason: 'serial' })
    const resumed = head198 + 'A'.charCodeAt(0).toString(2).padStart(7, '0') + '0000000' + 'B'.charCodeAt(0).toString(2).padStart(7, '0') + '0'.repeat(119)
    expect(decodeEpcBinaryBits(resumed)).toMatchObject({ ok: false, reason: 'serial' })
    // A 200-bit hexadecimal SGTIN-198 must pad with zero bits.
    const padded = head198 + 'A'.charCodeAt(0).toString(2).padStart(7, '0') + '0'.repeat(133) + '11'
    expect(decodeEpcBinaryBits(padded)).toMatchObject({ ok: false, reason: 'length' })
  })

  it('refuses to encode what the scheme cannot carry', () => {
    expect(() => encodeSgtinBits({ scheme: 'sgtin-96', filter: 0, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: '274877906944' })).toThrow('below 2^38')
    expect(() => encodeSgtinBits({ scheme: 'sgtin-96', filter: 0, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: '007' })).toThrow('leading zeros')
    expect(() => encodeSgtinBits({ scheme: 'sgtin-198', filter: 0, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: 'a'.repeat(21) })).toThrow('1 to 20')
    expect(() => encodeSgtinBits({ scheme: 'sgtin-198', filter: 0, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: 'with space' })).toThrow('set 82')
    expect(() => encodeSgtinBits({ scheme: 'sgtin-96', filter: 0, partition: 7, companyPrefix: '9521234', itemReference: '000001', serial: '1' })).toThrow('0 to 6')
    expect(() => encodeSgtinBits({ scheme: 'sgtin-96', filter: 0, partition: 5, companyPrefix: '952123', itemReference: '000001', serial: '1' })).toThrow('7 digits')
  })
})
