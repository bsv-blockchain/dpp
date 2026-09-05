/**
 * Canonical JSON for nested documents: the publisher policy and the evidence
 * package manifest. Native claims keep the flat restricted form of
 * canonical.ts; this one exists because those documents nest objects and
 * arrays. Object keys are sorted recursively by code point, there is no
 * whitespace, arrays keep their order, `undefined` members are omitted, and
 * only strings, booleans and safe integers are values. Anything else has no
 * canonical form and is refused by name, so two implementations that both
 * accept a document hash the same bytes.
 */
export class CanonicalJsonError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} is not canonicalisable: ${detail}`)
    this.name = 'CanonicalJsonError'
  }
}

/**
 * Key order by Unicode code point, so two implementations agree on keys that
 * mix astral characters with U+E000 to U+FFFF, where UTF-16 code unit order
 * differs. Every key in the documents this serves is ASCII today; the rule is
 * stated once so a future key does not turn into a divergence.
 */
export function compareCodePoints(a: string, b: string): number {
  const left = a[Symbol.iterator]()
  const right = b[Symbol.iterator]()
  for (;;) {
    const x = left.next()
    const y = right.next()
    if (x.done && y.done) return 0
    if (x.done) return -1
    if (y.done) return 1
    const cx = x.value.codePointAt(0) as number
    const cy = y.value.codePointAt(0) as number
    if (cx !== cy) return cx < cy ? -1 : 1
  }
}

export function canonicalJson(value: unknown, path = 'document'): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(path, 'only safe integers are canonical numbers')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(',')}]`
  if (value != null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort(compareCodePoints)
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k], `${path}.${k}`)}`).join(',')}}`
  }
  throw new CanonicalJsonError(path, `only strings, booleans, safe integers, arrays and objects are, and this is ${value === null ? 'null' : typeof value}`)
}
