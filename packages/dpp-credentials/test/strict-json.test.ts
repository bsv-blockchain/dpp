import { describe, expect, it } from 'vitest';
import { parseStrictJsonBytes } from '../src/strict-json.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('parseStrictJsonBytes', () => {
  it('parses exact UTF-8 JSON and returns the value the bytes carry', () => {
    expect(parseStrictJsonBytes(utf8('{"a":[1,"two",{"b":null}],"c":"\\"d\\""}'))).toEqual({ a: [1, 'two', { b: null }], c: '"d"' });
    expect(parseStrictJsonBytes(utf8(' [ ] '))).toEqual([]);
  });

  it('refuses a duplicate key at any depth before interpretation, whatever the values', () => {
    expect(() => parseStrictJsonBytes(utf8('{"issuer":"did:web:a.example","issuer":"did:web:b.example"}'))).toThrow('Duplicate JSON key: issuer');
    expect(() => parseStrictJsonBytes(utf8('{"a":[{"b":1,"b":1}]}'))).toThrow('Duplicate JSON key: b');
    expect(parseStrictJsonBytes(utf8('{"a":{"b":1},"c":{"b":2}}'))).toEqual({ a: { b: 1 }, c: { b: 2 } });
  });

  it('refuses malformed UTF-8, malformed JSON, nesting past 64 and input over 1 MiB', () => {
    expect(() => parseStrictJsonBytes(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))).toThrow();
    expect(() => parseStrictJsonBytes(utf8('{"a":'))).toThrow();
    expect(parseStrictJsonBytes(utf8('['.repeat(64) + ']'.repeat(64)))).toBeDefined();
    expect(() => parseStrictJsonBytes(utf8('['.repeat(66) + ']'.repeat(66)))).toThrow('nesting exceeds');
    expect(() => parseStrictJsonBytes(new Uint8Array(1_048_577))).toThrow('1 MiB');
  });
});
