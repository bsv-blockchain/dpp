import { Utils } from '@bsv/sdk'
import { canonicalJson } from './canonicalJson.js'

/** Thrown when a value cannot be canonicalised, rather than guessed at. */
export class CanonicalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalError'
  }
}

/**
 * The bytes both sides of an attestation sign and hash: the canonical JSON of
 * `spec/rules.md` §4 for a flat object, the form a native claim takes.
 *
 * **A deliberate subset of RFC 8785, not an implementation of it.** JCS is
 * mostly a specification for the hard cases: number formatting, surrogate
 * pairs, escape selection. This payload has none of them, and a partial JCS
 * that silently mishandled one would be worse than no JCS at all, because two
 * implementations would agree on every value they had tested and differ on the
 * first one they had not. So a native claim's values are strings and safe
 * integers only, and anything else is refused here; the bytes themselves come
 * from `canonicalJson`, the one serialiser for the native documents of
 * `spec/rules.md` §4, so the flat form and the nested form cannot drift apart. Two honest encoders of
 * one claim produce identical bytes or an error, never a second encoding.
 *
 * An absent optional property and a present-but-undefined one are different
 * things here on purpose: `undefined` is refused, not skipped, so a claim built
 * with a property present and empty is a refusal rather than a different
 * digest. Callers spread optional properties conditionally.
 *
 * `fixtures/anchor-v3.json` and `fixtures/attestation-anchor-v1.json` pin the
 * output for complete claims, and every implementing party asserts against them.
 */
export function canonicalBytes(claim: object): number[] {
  for (const [key, value] of Object.entries(claim)) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) continue
    throw new CanonicalError(
      `${key} is not canonicalisable: only strings and safe integers are, and this is ${typeof value}`
    )
  }
  return Utils.toArray(canonicalJson(claim), 'utf8')
}

/** The canonical string, for a fixture or an error message to show a human. */
export function canonicalString(claim: object): string {
  return Utils.toUTF8(canonicalBytes(claim))
}
