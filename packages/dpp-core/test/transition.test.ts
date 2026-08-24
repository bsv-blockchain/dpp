import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_MARKER,
  STANDARD_VERSION,
  checkGenesisState,
  checkTransition,
  type DppState,
  type DppStateData,
} from '../src/index.js'
import { idKey, makeData, owner2Priv } from './helpers.js'

/**
 * Direct unit tests of the per-link rules. The codec already rejects most of
 * these at decode time; transition.ts is the defense-in-depth layer used by
 * the topic manager on typed states, so its branches are pinned here.
 */

const PREV_TXID = 'aa'.repeat(32)

function asState(d: DppStateData): DppState {
  return {
    ...d,
    protocolMarker: PROTOCOL_MARKER,
    version: STANDARD_VERSION,
    userSignature: [48, 1, 2],
    serverSignature: [48, 3, 4],
  }
}

const genesis = asState(makeData())

describe('checkGenesisState', () => {
  it('accepts a well-formed ACTIVATE genesis', () => {
    expect(checkGenesisState(genesis)).toBeNull()
  })

  it('rejects non-ACTIVATE ops and a set previous_txid', () => {
    expect(checkGenesisState(asState(makeData({ op: 'SOLD' })))).toContain('ACTIVATE')
    expect(
      checkGenesisState(asState(makeData({ previousTxid: PREV_TXID })))
    ).toContain('previous_txid')
  })
})

describe('checkTransition', () => {
  const next = (overrides: Partial<DppStateData>): DppState =>
    asState(makeData({ previousTxid: PREV_TXID, ...overrides }))

  it('accepts a payload-preserving event op', () => {
    expect(
      checkTransition(genesis, next({ op: 'SOLD', eventData: '{"x":1}' }), PREV_TXID)
    ).toBeNull()
  })

  it('rejects event_data on EDIT (§3 field 9)', () => {
    expect(
      checkTransition(genesis, next({ op: 'EDIT', eventData: '{"x":1}' }), PREV_TXID)
    ).toContain('event_data must be empty on EDIT')
  })

  it('accepts an EDIT with empty event_data and a changed payload', () => {
    expect(
      checkTransition(
        genesis,
        next({ op: 'EDIT', payloadPublic: '{"corrected":true}' }),
        PREV_TXID
      )
    ).toBeNull()
  })

  it('rejects a missing previous_txid on a non-genesis state', () => {
    expect(
      checkTransition(genesis, asState(makeData({ op: 'SOLD', eventData: '{"x":1}' })), PREV_TXID)
    ).toContain('must be set')
  })

  it('accepts an owner change on TRANSFER and rejects it elsewhere', () => {
    expect(
      checkTransition(
        genesis,
        next({ op: 'TRANSFER', ownerIdentityKey: idKey(owner2Priv) }),
        PREV_TXID
      )
    ).toBeNull()
    expect(
      checkTransition(
        genesis,
        next({ op: 'RECYCLED', eventData: '{"x":1}', ownerIdentityKey: idKey(owner2Priv) }),
        PREV_TXID
      )
    ).toContain('TRANSFER')
  })
})
