import { describe, expect, it } from 'vitest';
import { canonicalizeJcs, canonicalJcsBytes, JcsError } from '../src/jcs.js';

describe('RFC 8785 canonicalisation', () => {
  it('reproduces the RFC appendix vector: number forms, string escapes and literals', () => {
    const input = JSON.parse('{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}');
    expect(canonicalizeJcs(input)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });

  it('sorts member names by UTF-16 code units, the RFC section 3.2.3 example', () => {
    const input = JSON.parse('{"\\u20ac": "Euro Sign", "\\r": "Carriage Return", "\\u000a": "Newline", "1": "One", "\\u0080": "Control\\u007f", "\\ud83d\\ude02": "Smiley", "\\u00f6": "Latin Small Letter O With Diaeresis", "\\ufb33": "Hebrew Letter Dalet With Dagesh", "</script>": "Browser Challenge"}');
    // Control characters above U+001F are written literally, which is why the two below are escapes in this source and characters in the output.
    const expected = '{"\\n":"Newline","\\r":"Carriage Return","1":"One","</script>":"Browser Challenge","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😂":"Smiley","דּ":"Hebrew Letter Dalet With Dagesh"}';
    expect(canonicalizeJcs(input)).toBe(expected);
    expect(JSON.parse(expected)).toEqual(input);
  });

  it('writes negative zero as zero and keeps array order', () => {
    expect(canonicalizeJcs({ b: [-0, 0, 1.0, 10000000000000000000000], a: '' })).toBe('{"a":"","b":[0,0,1,1e+22]}');
  });

  it('refuses what JSON cannot carry, by name', () => {
    expect(() => canonicalizeJcs({ a: Number.NaN })).toThrow(JcsError);
    expect(() => canonicalizeJcs({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalizeJcs({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalizeJcs({ a: () => 1 })).toThrow(/function/);
    expect(() => canonicalizeJcs({ a: 10n })).toThrow(/bigint/);
    expect(() => canonicalizeJcs({ a: '\ud800' })).toThrow(/lone surrogate/);
    expect(() => canonicalizeJcs({ '\udc00': 1 })).toThrow(/lone surrogate/);
  });

  it('hands back UTF-8 bytes of the canonical text', () => {
    expect(Buffer.from(canonicalJcsBytes({ '€': 1 })).toString('utf8')).toBe('{"€":1}');
    expect(canonicalJcsBytes({ '€': 1 }).byteLength).toBe(9);
  });
});
