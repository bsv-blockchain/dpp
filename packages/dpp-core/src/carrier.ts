import { CARRIER_DEPLOY_OUTPUT_INDEX } from './constants.js'
import type { CarrierPrefix, Outpoint } from './types.js'

/**
 * The carrier invariants (`spec/token-carrier.md` §6) that need the
 * transaction and the lineage rather than the body alone: which role the
 * prefix claims against which position the state holds, and which token the
 * prefix names against the lineage's genesis. The codec has already held the
 * prefix to its shape (the 32-byte id, the one-unit amount, no payload); the
 * body rules run after these, under `checkTransition`. Returns null when the
 * state passes, otherwise the reason; the fixtures pin these strings.
 */
export const CARRIER_REFUSALS = {
  genesisNotAtOutputZero: 'a genesis is a deploy at output 0',
  genesisCarriesTokenId: 'a genesis carries an empty token id',
  stateNotValue: 'a state after genesis carries the lineage token id',
  tokenIdMismatch: 'the token id names the lineage genesis',
  genesisUnknown: 'the token id cannot be checked without the chain genesis',
} as const

/** Where a carried state sits: whether it is the genesis, which output it is, and the lineage genesis when known. */
export interface CarrierPosition {
  genesis: boolean
  outputIndex: number
  lineageGenesis?: Outpoint
}

export function checkCarrier(carrier: CarrierPrefix, position: CarrierPosition): string | null {
  if (position.genesis) {
    if (carrier.role !== 'deploy') return CARRIER_REFUSALS.genesisCarriesTokenId
    if (position.outputIndex !== CARRIER_DEPLOY_OUTPUT_INDEX) return CARRIER_REFUSALS.genesisNotAtOutputZero
    return null
  }
  if (carrier.role !== 'value' || carrier.tokenId == null) return CARRIER_REFUSALS.stateNotValue
  if (position.lineageGenesis == null) return CARRIER_REFUSALS.genesisUnknown
  if (position.lineageGenesis.outputIndex !== CARRIER_DEPLOY_OUTPUT_INDEX || carrier.tokenId !== position.lineageGenesis.txid) {
    return CARRIER_REFUSALS.tokenIdMismatch
  }
  return null
}

/** The display form of a lineage's token id: the deploy txid and the implied index (`spec/token-carrier.md` §3). */
export function tokenIdOf(lineageGenesis: Outpoint): string {
  return `${lineageGenesis.txid}_${CARRIER_DEPLOY_OUTPUT_INDEX}`
}
