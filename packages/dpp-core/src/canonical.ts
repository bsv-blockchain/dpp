import { Utils } from '@bsv/sdk'

/** Thrown when a value cannot be canonicalised, rather than guessed at. */
export class CanonicalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalError'
  }
}

/**
 * The bytes both sides of an attestation sign and hash (`spec/rules.md` §4).
 *
 * **A deliberate subset of RFC 8785, not an implementation of it.** JCS is
 * mostly a specification for the hard cases: number formatting, surrogate
 * pairs, escape selection. This payload has none of them, and a partial JCS
 * that silently mishandled one would be worse than no JCS at all, because two
 * implementations would agree on every value they had tested and differ on the
 * first one they had not. So this canonicalises what it can, refuses everything
 * else, and the refusal is the feature: keys sorted by code unit, no
 * whitespace, string values JSON-escaped, integer values only when they are
 * safe integers. Two honest encoders of one claim produce identical bytes or an
 * error, never a second encoding.
 *
 * An absent optional property and a present-but-undefined one are different
 * things here on purpose: `undefined` is refused, not skipped, so a claim built
 * with a property present and empty is a refusal rather than a different
 * digest. Callers spread optional properties conditionally.
 *
 * The parameter is `object` rather than a claim type because more than one
 * signed shape uses this rule, and one canonicaliser serving all of them is the
 * point: a fork is a copy that drifts. `fixtures/anchor-v3.json` pins the output
 * for one complete claim, and every implementing party asserts against it.
 */
export function canonicalBytes(claim: object): number[] {
  const entries = Object.entries(claim).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const parts: string[] = []
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`)
      continue
    }
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      parts.push(`${JSON.stringify(key)}:${value}`)
      continue
    }
    throw new CanonicalError(
      `${key} is not canonicalisable: only strings and safe integers are, and this is ${typeof value}`
    )
  }
  return Utils.toArray(`{${parts.join(',')}}`, 'utf8')
}

/** The canonical string, for a fixture or an error message to show a human. */
export function canonicalString(claim: object): string {
  return Utils.toUTF8(canonicalBytes(claim))
}
