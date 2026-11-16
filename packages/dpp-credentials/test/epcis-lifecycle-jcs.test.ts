import { describe, expect, it } from 'vitest'
import { Utils } from '@bsv/sdk'
import { JcsError, jcsBytes, jcsString, parseCanonicalJcs, parseStrictJcsJson } from '../src/epcis-lifecycle.js'

/** An IEEE 754 double from its sixteen hex digits, as RFC 8785 Appendix B lists them. */
function double(hex: string): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, BigInt(`0x${hex}`))
  return view.getFloat64(0)
}

describe('RFC 8785 serialisation', () => {
  // RFC 8785 Appendix B: every finite value with its required output.
  it.each([
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ])('writes the double %s as %s (Appendix B)', (hex, expected) => {
    expect(jcsString(double(hex))).toBe(expected)
  })

  it.each([['7fffffffffffffff', 'NaN'], ['7ff0000000000000', 'Infinity']])('refuses the double %s (%s), which JSON cannot carry', (hex) => {
    expect(() => jcsString(double(hex))).toThrow(JcsError)
  })

  it('reproduces the example of section 3.2.2: numbers, escapes and literals', () => {
    // The input string of the RFC example, character by character.
    const value = {
      numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001],
      string: ['€', '$', String.fromCharCode(0x0f), String.fromCharCode(0x0a), 'A', "'", 'B', '"', '\\', '\\', '"', '/'].join(''),
      literals: [null, true, false],
    }
    expect(jcsString(value)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}')
  })

  it('sorts members by UTF-16 code units, as section 3.2.3 requires', () => {
    const value = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    }
    expect(jcsString(value)).toBe('{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}')
  })

  it('escapes the control characters with the short forms and lower-case \\u00xx, and nothing else', () => {
    expect(jcsString('\b\t\n\f\r\u0001\u001f\u007f /')).toBe('"\\b\\t\\n\\f\\r\\u0001\\u001f\u007f /"')
  })

  it('writes UTF-8 bytes', () => {
    expect(Utils.toHex(jcsBytes({ a: '€' }))).toBe(Utils.toHex(Utils.toArray('{"a":"€"}', 'utf8')))
  })

  it.each([
    ['a lone high surrogate', '\ud800'],
    ['a lone low surrogate', 'x\udc00'],
    ['undefined', { a: undefined }],
    ['a bigint', 1n],
    ['a function', () => 1],
    ['a class instance', new Date(0)],
  ])('refuses %s', (_name, value) => {
    expect(() => jcsString(value)).toThrow(JcsError)
  })
})

describe('the strict and canonical readings', () => {
  it('reads a canonical text back to the value that wrote it', () => {
    const value = { b: [1.5, null, 'x'], a: { d: -0.25, c: true } }
    expect(parseCanonicalJcs(jcsString(value))).toEqual(value)
  })

  it.each([
    ['a duplicate member', '{"a":1,"a":1}', /duplicate member/],
    ['a lone surrogate escape', '{"a":"\\ud800"}', /lone surrogate/],
    ['a lone surrogate in a member name', '{"\\udc00":1}', /lone surrogate/],
    ['an integer beyond 2^53 - 1', '{"a":9007199254740992}', /outside the range/],
    ['an integral double in exponent form beyond the safe range', '{"a":1e+30}', /outside the range/],
    ['a member named __proto__', '{"__proto__":{"a":1}}', /__proto__/],
    ['a member named __proto__ with a scalar value', '{"a":1,"__proto__":2}', /__proto__/],
    ['malformed JSON', '{"a":}', /invalid JSON/],
  ])('refuses %s in the strict reading', (_name, text, pattern) => {
    expect(() => parseStrictJcsJson(text)).toThrow(pattern)
  })

  it('refuses malformed UTF-8 bytes', () => {
    expect(() => parseStrictJcsJson([0x22, 0xff, 0x22])).toThrow(/well-formed UTF-8/)
  })

  it.each([
    ['white space', '{"a": 1}'],
    ['another member order', '{"b":1,"a":2}'],
    ['a trailing zero', '{"a":1.50}'],
    ['an exponent where the canonical form has none', '{"a":1e2}'],
    ['an escape where the canonical form has the character', '{"a":"\\u00e9"}'],
    ['an escaped solidus', '{"a":"\\/"}'],
    ['negative zero', '{"a":-0}'],
    ['a trailing newline', '{"a":1}\n'],
  ])('refuses %s in the canonical reading, though the strict reading accepts it', (_name, text) => {
    expect(() => parseStrictJcsJson(text)).not.toThrow()
    expect(() => parseCanonicalJcs(text)).toThrow(/not the RFC 8785 canonical form/)
  })
})
