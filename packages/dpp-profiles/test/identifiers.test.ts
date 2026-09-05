import { describe, expect, it } from 'vitest'
import { GS1_EXAMPLE_GTIN_14, buildGs1DigitalLink, gs1CheckDigit, gtin14, isDemonstrationGtin, isValidGtin, parseGs1DigitalLink } from '../src/index.js'

describe('GS1 identifier helpers (spec/profiles.md section 5)', () => {
  it('computes the mod-10 check digit GS1 publishes, on the documented examples', () => {
    expect(gs1CheckDigit('950600013435')).toBe(2)
    expect(gs1CheckDigit('0950600013435')).toBe(2)
    expect(gs1CheckDigit('629104150021')).toBe(3)
    expect(() => gs1CheckDigit('95060001343x')).toThrow()
  })

  it('accepts a GTIN whose last digit is the check digit of the rest, in all four lengths, and nothing else', () => {
    expect(isValidGtin(GS1_EXAMPLE_GTIN_14)).toBe(true)
    expect(isValidGtin('9506000134352')).toBe(true)
    expect(isValidGtin('6291041500213')).toBe(true)
    expect(isValidGtin('96385074')).toBe(true)
    expect(isValidGtin('012345678905')).toBe(true)
    expect(isValidGtin('09506000134353')).toBe(false)
    expect(isValidGtin('950600013435')).toBe(false)
    expect(isValidGtin('0950600013435a')).toBe(false)
  })

  it('spells a GTIN at fourteen digits for the Digital Link path', () => {
    expect(gtin14('9506000134352')).toBe('09506000134352')
    expect(gtin14('96385074')).toBe('00000096385074')
    expect(() => gtin14('123')).toThrow()
  })

  it('recognises the demonstration prefix 952 and knows the GS1 example is not under it', () => {
    const demonstration = '952123456789' + String(gs1CheckDigit('952123456789'))
    expect(isValidGtin(demonstration)).toBe(true)
    expect(isDemonstrationGtin(demonstration)).toBe(true)
    expect(isDemonstrationGtin(gtin14(demonstration))).toBe(true)
    expect(isDemonstrationGtin(GS1_EXAMPLE_GTIN_14)).toBe(false)
    expect(isDemonstrationGtin('6291041500213')).toBe(false)
  })

  it('parses the uncompressed Digital Link path and refuses what it does not read', () => {
    const link = parseGs1DigitalLink('https://id.gs1.org/01/09506000134352/21/JERSEY-001')
    expect(link).toEqual({ host: 'id.gs1.org', gtin: '09506000134352', serial: 'JERSEY-001', checkDigitValid: true, demonstration: false })
    expect(parseGs1DigitalLink('https://dpp.bsvb.net/01/9506000134352/10/LOT-7/21/S1').lot).toBe('LOT-7')
    expect(parseGs1DigitalLink('https://example.test/01/09506000134353/21/X').checkDigitValid).toBe(false)
    expect(() => parseGs1DigitalLink('https://example.test/gtin/09506000134352')).toThrow('application identifier 01')
    expect(() => parseGs1DigitalLink('https://example.test/01/09506000134352/99/X')).toThrow('not read')
    expect(() => parseGs1DigitalLink('https://example.test/01/09506000134')).toThrow('8, 12, 13 or 14 digits')
    expect(() => parseGs1DigitalLink('https://example.test/01/09506000134352/21/')).not.toThrow()
    expect(() => parseGs1DigitalLink('https://example.test/01/09506000134352/21/' + 'a'.repeat(21))).toThrow('1 to 20')
    expect(() => parseGs1DigitalLink('not a url')).toThrow('not a URL')
  })

  it('builds a link only from a GTIN whose check digit holds, and only with an encodable serial', () => {
    expect(buildGs1DigitalLink('dpp.bsvb.net', '9506000134352', 'JERSEY-001')).toBe('https://dpp.bsvb.net/01/09506000134352/21/JERSEY-001')
    expect(() => buildGs1DigitalLink('dpp.bsvb.net', '9506000134353', 'JERSEY-001')).toThrow('check digit')
    expect(() => buildGs1DigitalLink('dpp.bsvb.net', '9506000134352', '')).toThrow()
    expect(() => buildGs1DigitalLink('dpp.bsvb.net', '9506000134352', 'a'.repeat(21))).toThrow()
    expect(() => buildGs1DigitalLink('dpp.bsvb.net', '9506000134352', 'with space')).toThrow('character set')
  })
})
