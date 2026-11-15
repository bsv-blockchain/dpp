import { Utils } from '@bsv/sdk'
import { parseStrictJson, type StrictJsonLimits } from './epcisShared.js'

/**
 * RFC 8785, the JSON Canonicalization Scheme (JCS), for the formats that
 * select it: the EPCIS lifecycle claim (`spec/epcis-lifecycle-claim.md` §3).
 * It is not the canonical JSON of `spec/rules.md` §4, which the native
 * documents use and which refuses `null` and every number that is not a safe
 * integer; EPCIS sensor data needs both, so this format names RFC 8785.
 *
 * Serialisation follows the RFC exactly. Object members are sorted by the
 * UTF-16 code units of their names, which is JavaScript's default string
 * order and not the code point order of `compareCodePoints`; a number is
 * written as ECMAScript writes a finite double (RFC 8785 §3.2.2.3), which is
 * what `JSON.stringify` writes, with negative zero as `0`; a string is escaped
 * as §3.2.2.2 requires, which again is `JSON.stringify` once lone surrogates
 * are refused. Anything JSON cannot carry is refused by name, never coerced.
 *
 * Reading is stricter than writing. `parseStrictJcsJson` is the strict parse
 * of `parseStrictJson` (malformed UTF-8, duplicate member names, excess depth
 * and inexact number literals refused) with the I-JSON limits RFC 8785 §3.1
 * assumes: a lone surrogate in any string or member name is refused, and so is
 * an integral number outside the safe integer range, because two parsers can
 * read it as two different values. `parseCanonicalJcs` adds the rule a signed
 * representation needs: the bytes must be exactly the canonical form of their
 * own parse, so one value has one byte string and no other.
 */
export class JcsError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path} has no RFC 8785 form: ${detail}`)
    this.name = 'JcsError'
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new JcsError(path, 'JSON has no representation of a non-finite number')
      return JSON.stringify(value)
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new JcsError(path, 'a lone surrogate cannot be written as UTF-8')
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item, index) => serialise(item, `${path}[${index}]`)).join(',')}]`
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new JcsError(path, 'only plain objects are JSON objects')
      const record = value as Record<string, unknown>
      const members: string[] = []
      for (const key of Object.keys(record).sort()) {
        if (LONE_SURROGATE.test(key)) throw new JcsError(`${path}.${key}`, 'a member name with a lone surrogate cannot be written as UTF-8')
        if (record[key] === undefined) throw new JcsError(`${path}.${key}`, 'undefined is not a JSON value; omit the member instead')
        members.push(`${JSON.stringify(key)}:${serialise(record[key], `${path}.${key}`)}`)
      }
      return `{${members.join(',')}}`
    }
    default:
      throw new JcsError(path, `${typeof value} is not a JSON value`)
  }
}

/** The RFC 8785 canonical text of a JSON value. Throws `JcsError` for anything JSON cannot carry. */
export function jcsString(value: unknown): string {
  return serialise(value, 'value')
}

/** The canonical text as UTF-8 bytes: what is signed, hashed and exported. */
export function jcsBytes(value: unknown): number[] {
  return Utils.toArray(jcsString(value), 'utf8')
}

function holdsIJson(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) throw new JcsError(path, 'a string with a lone surrogate is refused')
    return
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new JcsError(path, `the integer ${String(value)} is outside the range -(2^53 - 1) to 2^53 - 1 that every parser reads alike`)
    return
  }
  if (Array.isArray(value)) { value.forEach((item, index) => holdsIJson(item, `${path}[${index}]`)); return }
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new JcsError(path, 'a member named __proto__ is refused')
    for (const [key, child] of Object.entries(value)) {
      if (LONE_SURROGATE.test(key)) throw new JcsError(`${path}.${key}`, 'a member name with a lone surrogate is refused')
      holdsIJson(child, `${path}.${key}`)
    }
  }
}

/**
 * A strict parse under the I-JSON limits: everything `parseStrictJson`
 * refuses, and a lone surrogate or an integral number outside the safe range.
 * The value need not be in canonical form.
 */
export function parseStrictJcsJson(input: string | number[], limits: StrictJsonLimits = {}): unknown {
  const value = parseStrictJson(input, limits)
  // The strict parser assigns members, so a member named __proto__ never becomes a member: an object value
  // replaces the prototype and a scalar one is dropped. The built-in parser defines it as a member, which shows it.
  JSON.parse(typeof input === 'string' ? input : Utils.toUTF8(input), (key, child: unknown) => {
    if (key === '__proto__') throw new JcsError('value', 'a member named __proto__ is refused')
    return child
  })
  holdsIJson(value, 'value')
  return value
}

/**
 * The strict parse of a canonical representation: refused unless the input
 * is exactly the RFC 8785 form of the value it parses to. Insignificant
 * white space, another member order, another number spelling or another
 * string escape are each a different byte string and each refused.
 */
export function parseCanonicalJcs(input: string | number[], limits: StrictJsonLimits = {}): unknown {
  const bytes = typeof input === 'string' ? Utils.toArray(input, 'utf8') : input
  const value = parseStrictJcsJson(bytes, limits)
  const canonical = jcsBytes(value)
  if (canonical.length !== bytes.length || canonical.some((b, i) => b !== bytes[i])) {
    throw new JcsError('value', 'the bytes are not the RFC 8785 canonical form of their own parse')
  }
  return value
}
