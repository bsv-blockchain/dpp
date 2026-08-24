import { NO_EVENT_OPS, PAYLOAD_CHANGE_OPS } from './constants.js'
import type { DppState } from './types.js'

/**
 * Per-link op rules from `spec/record-model.md` §4 and §6. Field-level well-formedness
 * (event_data emptiness, JSON validity, ISO timestamps) is enforced by the
 * codec at decode time. These functions check the rules that span states.
 * Returns null when valid, otherwise a human-readable reason.
 */

export function checkGenesisState(s: DppState): string | null {
  if (s.op !== 'ACTIVATE') return `genesis op must be ACTIVATE, got ${s.op}`
  if (s.previousTxid !== '') return 'genesis previous_txid must be empty'
  return null
}

export function checkTransition(
  prev: DppState,
  next: DppState,
  prevTxid: string
): string | null {
  if (next.op === 'ACTIVATE') return 'ACTIVATE is allowed at genesis only'
  if (next.previousTxid === '') return 'non-genesis previous_txid must be set'
  if (next.passportId !== prev.passportId) {
    return 'passport_id is immutable across the chain'
  }
  if (next.previousTxid !== prevTxid) {
    return 'previous_txid must equal the spent tip txid'
  }
  if (next.op !== 'TRANSFER' && next.ownerIdentityKey !== prev.ownerIdentityKey) {
    return 'owner_identity_key changes only on TRANSFER'
  }
  if (
    !PAYLOAD_CHANGE_OPS.includes(next.op) &&
    (next.payloadPublic !== prev.payloadPublic ||
      next.payloadOwnerHash !== prev.payloadOwnerHash)
  ) {
    return 'payload_public / payload_owner_hash change only on ACTIVATE, EDIT or TRANSFER'
  }
  if (NO_EVENT_OPS.includes(next.op) && next.eventData !== '') {
    return `event_data must be empty on ${next.op}`
  }
  return null
}
