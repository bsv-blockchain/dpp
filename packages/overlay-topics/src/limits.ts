/**
 * The bounds the node publishes in its capability document and enforces on
 * the wire. They live here, in one module with no imports, so the routes, the
 * paginator and the capability document read the same numbers and none of
 * them can drift from what `contracts/overlay.yaml` says.
 */

/** Refuse absurd bodies before buffering them. A DPP BEEF is a few KB. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** A /history page holds this many items unless the caller asks for fewer or more. */
export const DEFAULT_PAGE_SIZE = 100

/**
 * The most items one /history page carries, and the most records one export
 * read fetches at a time. Equal to the bounded lookup's cap on purpose: a
 * caller who tunes one number has tuned both.
 */
export const MAX_PAGE_SIZE = 500

/**
 * How long a /history snapshot stays resumable. Long enough for a slow reader
 * to walk a long lifecycle, short enough that a cursor from yesterday does not
 * quietly continue from the middle of a history that has since grown
 * (`spec/portable-evidence.md` section 1: an expired snapshot answers a named
 * restart, never a silent continuation).
 */
export const SNAPSHOT_TTL_MS = 10 * 60 * 1000

/**
 * The most states one evidence package carries, the newest by the store's
 * sequence, as the bounded lookup keeps the newest. The remainder is declared
 * absent by outpoint, so a package never implies a history it does not hold
 * and an unauthenticated GET never parses and signs an unbounded number of
 * transactions.
 */
export const MAX_EXPORT_STATES = 500
