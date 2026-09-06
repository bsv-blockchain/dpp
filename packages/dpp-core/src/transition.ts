import { NO_EVENT_OPS, PAYLOAD_CHANGE_OPS, PAYLOAD_CHANGE_OPS_V2 } from './constants.js'
import { checkControl } from './owner.js'
import type { DppState, DppStateV2, Outpoint } from './types.js'

/**
 * Per-link rules from `spec/record-model.md` §4 and §6 (version 1) and
 * `spec/record-model-v2.md` §4 and §6 (version 2). Field-level well-formedness
 * (event_data emptiness, JSON validity, ISO timestamps, field bounds) is
 * enforced by the codec at decode time. These functions check the rules that
 * span states. Returns null when valid, otherwise a human-readable reason; the
 * fixtures pin these strings.
 */

/** What a link needs beyond the two states: the predecessor's output index, the lineage's genesis, and the profile's authorities. */
export interface LinkContext {
  /** The output index of the predecessor's DPP output, as spent. Version 2 binds it (field 13). */
  prevOutputIndex?: number
  /** The genesis outpoint of the chain being verified. Version 2 binds it (field 12). */
  lineageGenesis?: Outpoint
  /** Identity keys the profile names as authorities, whose version 2 UPDATE, TRANSFER or RETIRE passes without a control proof. */
  authorities?: readonly string[]
}

export function checkGenesisState(s: DppState): string | null {
  if (s.version === '2') {
    if (s.op !== 'ISSUE') return `genesis op must be ISSUE, got ${s.op}`
    if (s.previousTxid !== '' || s.previousOutputIndex != null) return 'genesis previous_outpoint must be empty'
    if (s.lineageGenesis != null) return 'genesis lineage_genesis must be empty'
    if (s.controlLinkage !== '') return 'genesis control_linkage must be empty'
    return null
  }
  if (s.op !== 'ACTIVATE') return `genesis op must be ACTIVATE, got ${s.op}`
  if (s.previousTxid !== '') return 'genesis previous_txid must be empty'
  return null
}

const sameOutpoint = (a: Outpoint, b: Outpoint): boolean => a.txid === b.txid && a.outputIndex === b.outputIndex

function checkTransitionV1(prev: DppState, next: DppState & { version: '1' }, prevTxid: string): string | null {
  if (prev.version === '2') return 'a version 1 state cannot follow a version 2 state'
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

/**
 * The lineage genesis a version 2 state must name, from what the caller
 * knows: the chain's genesis when supplied; otherwise, for a version 2
 * predecessor, what that predecessor names (or the predecessor itself when it
 * is the ISSUE). A version 1 predecessor names no genesis, so the caller must
 * supply one; a reader that cannot is told so rather than left to guess.
 */
function expectedLineageGenesis(prev: DppState, prevTxid: string, link: LinkContext): Outpoint | undefined {
  if (link.lineageGenesis != null) return link.lineageGenesis
  if (prev.version !== '2') return undefined
  if (prev.lineageGenesis != null) return prev.lineageGenesis
  if (link.prevOutputIndex == null) return undefined
  return { txid: prevTxid, outputIndex: link.prevOutputIndex }
}

function checkTransitionV2(prev: DppState, next: DppStateV2, prevTxid: string, link: LinkContext): string | null {
  if (next.op === 'ISSUE') return 'ISSUE is allowed at genesis only'
  if (prev.version === '2' && prev.op === 'RETIRE') return 'the lineage is retired: no state may follow RETIRE'
  if (prev.version === '1' && next.op !== 'UPDATE') {
    return 'a version 1 state is followed only by a version 2 UPDATE, the upgrade transition'
  }
  if (next.previousTxid === '' || next.previousOutputIndex == null) return 'non-genesis previous_outpoint must be set'
  if (next.passportId !== prev.passportId) return 'passport_id is immutable across the chain'
  if (next.previousTxid !== prevTxid) return 'previous_outpoint must name the spent tip'
  if (link.prevOutputIndex != null && next.previousOutputIndex !== link.prevOutputIndex) {
    return 'previous_outpoint must name the spent tip output'
  }
  const genesis = expectedLineageGenesis(prev, prevTxid, link)
  if (genesis == null) return 'lineage_genesis cannot be checked without the chain genesis'
  if (next.lineageGenesis == null || !sameOutpoint(next.lineageGenesis, genesis)) {
    return 'lineage_genesis must name the chain genesis'
  }
  if (prev.version === '1' && next.ownerIdentityKey !== prev.ownerIdentityKey) {
    return 'the upgrade transition keeps the controller key'
  }
  if (next.op !== 'TRANSFER' && next.ownerIdentityKey !== prev.ownerIdentityKey) {
    return 'controller_key changes only on TRANSFER'
  }
  if (
    !PAYLOAD_CHANGE_OPS_V2.includes(next.op) &&
    (next.payloadPublic !== prev.payloadPublic || next.payloadOwnerHash !== prev.payloadOwnerHash)
  ) {
    return 'payload_public / payload_owner_hash do not change on RETIRE'
  }
  const control = checkControl(prev, next, link.authorities ?? [])
  if (control != null) return control
  return null
}

/**
 * The rules one link must satisfy, under the version of the state that
 * extends the chain. A version 1 successor keeps the version 1 rules exactly;
 * a version 2 successor binds the predecessor outpoint and the lineage
 * genesis, refuses to follow a RETIRE, proves control of the predecessor, and
 * may follow a version 1 predecessor only as the UPDATE that upgrades the
 * lineage (`spec/record-model-v2.md` §8).
 */
export function checkTransition(
  prev: DppState,
  next: DppState,
  prevTxid: string,
  link: LinkContext = {}
): string | null {
  if (next.version === '2') return checkTransitionV2(prev, next, prevTxid, link)
  return checkTransitionV1(prev, next, prevTxid)
}
