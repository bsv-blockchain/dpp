/**
 * RFC 8785, the JSON Canonicalization Scheme, as one small exact function.
 *
 * Object members are sorted by the UTF-16 code units of their names, which
 * is what JavaScript's default string comparison does; numbers are written
 * as ECMAScript's Number-to-string conversion writes them, which is what
 * JSON.stringify writes for a finite number; strings are escaped as
 * JSON.stringify escapes them (section 3.2.2.2: the short escapes, then
 * \u00xx for the remaining control characters, everything else literal).
 * Anything JSON cannot carry (undefined, a function, a symbol, a bigint, a
 * non-finite number, a lone surrogate) is refused by name, so two
 * implementations that both accept a value hash the same bytes.
 *
 * The EPCIS event-body digest (epcis-source.ts) is the reason this exists in
 * this package: a retained source is compared by the digest of its canonical
 * form, never by its formatting.
 */
export class JcsError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} has no canonical form: ${detail}`);
    this.name = 'JcsError';
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new JcsError(path, 'JSON has no representation of a non-finite number');
      // JSON.stringify writes -0 as 0 and otherwise exactly the ES Number-to-string form the RFC requires.
      return JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new JcsError(path, 'a lone surrogate cannot be encoded as UTF-8');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item, index) => serialise(item, `${path}/${index}`)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const members: string[] = [];
      for (const key of keys) {
        if (LONE_SURROGATE.test(key)) throw new JcsError(`${path}/${key}`, 'a lone surrogate cannot be encoded as UTF-8');
        if (record[key] === undefined) throw new JcsError(`${path}/${key}`, 'undefined is not a JSON value');
        members.push(`${JSON.stringify(key)}:${serialise(record[key], `${path}/${key}`)}`);
      }
      return `{${members.join(',')}}`;
    }
    default:
      throw new JcsError(path, `${typeof value} is not a JSON value`);
  }
}

/** The RFC 8785 canonical JSON text of a value. Throws JcsError for anything JSON cannot carry. */
export function canonicalizeJcs(value: unknown): string {
  return serialise(value, '');
}

/** The canonical text as UTF-8 bytes, the form a digest is taken over. */
export function canonicalJcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(value));
}
