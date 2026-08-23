import { describe, expect, it } from 'vitest'
import { Beef, MerklePath, type ChainTracker } from '@bsv/sdk'
import { chainFromBeef, verifyChain } from '../src/index.js'
import {
  attachProof,
  buildChainFixture,
  makeData,
  makerPriv,
  mockTracker,
  signedState,
  stateTx,
} from './helpers.js'

describe('verifyChain, SPV (§8)', () => {
  it('reports verified when every state proves against block headers', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const result = await verifyChain(txs, { chainTracker: mockTracker(roots) })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('verified')
    expect(result.states.every((s) => s.spv === 'verified')).toBe(true)
  })

  it('passes an unmined tip with SPV pending', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.slice(0, 3).forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const result = await verifyChain(txs, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('pending')
    expect(result.states.map((s) => s.spv)).toEqual([
      'verified',
      'verified',
      'verified',
      'pending',
    ])
  })

  it('fails a state whose merkle root the headers do not contain', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    roots[800002] = 'ff'.repeat(32) // corrupt the root recorded for state 2
    const result = await verifyChain(txs, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(false)
    expect(result.states[2].spv).toBe('failed')
    expect(result.error).toContain('merkle path')
    // Never 'verified' beside a failure: a consumer that shows the summary
    // and the chain result separately would otherwise print "inclusion
    // proved" next to "could not verify".
    expect(result.spv).toBe('pending')
  })

  it('fails, not pends, a proof that does not contain the transaction', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    // State 2 carries a structurally sound proof for some OTHER transaction.
    // That refutes itself on local inspection - no header source outage is
    // involved, so it must not hide in 'pending' and keep the chain valid.
    txs[2].merklePath = new MerklePath(800002, [
      [
        { offset: 0, hash: 'ab'.repeat(32) },
        { offset: 1, hash: 'cd'.repeat(32), txid: true },
      ],
    ])
    const result = await verifyChain(txs, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(false)
    expect(result.states[2].spv).toBe('failed')
    expect(result.error).toContain('does not contain this transaction')
    expect(result.spvUnavailable).toBeUndefined()
  })

  it('reports pending, not failed, when the chain tracker cannot answer', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const outage: ChainTracker = {
      isValidRootForHeight: async () => {
        throw new Error('service unavailable')
      },
      currentHeight: async () => {
        throw new Error('service unavailable')
      },
    }
    const result = await verifyChain(txs, { chainTracker: outage })
    // The signatures and the linkage were checked and are sound; only the
    // inclusion proof is unknown. An unreachable header service must not
    // make the product say a genuine passport could not be verified.
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('pending')
    expect(result.states.every((s) => s.spv === 'pending')).toBe(true)
    expect(result.spvUnavailable).toContain('service unavailable')
  })

  it('never says verified beside a signature failure, every proof good', async () => {
    const { txs, states, outputIndexes } = await buildChainFixture()
    // Re-encode state 1 with an altered payload but the ORIGINAL signatures,
    // then prove BOTH transactions against block headers. Inclusion is real;
    // the content is forged. The summary must not carry the one claim that
    // held beside a chain the result just called invalid.
    const tampered = {
      ...states[1],
      payloadPublic: states[1].payloadPublic.replace('Club Jersey', 'Knockoff Jersey'),
    }
    const tx1 = stateTx(
      tampered,
      makerPriv.toPublicKey(),
      { tx: txs[0], outputIndex: outputIndexes[0] },
      true
    )
    const chain = [txs[0], tx1]
    const roots: Record<number, string> = {}
    chain.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const result = await verifyChain(chain, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('user_signature invalid')
    // Every individual proof held...
    expect(result.states.every((s) => s.spv === 'verified')).toBe(true)
    // ...and the summary still refuses the claim.
    expect(result.spv).toBe('pending')
  })

  it('never says verified beside a linkage failure, every proof good', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'SOLD',
        eventData: '{"x":1}',
        previousTxid: 'ef'.repeat(32),
      })
    )
    const tx1 = stateTx(s, makerPriv.toPublicKey(), {
      tx: txs[0],
      outputIndex: outputIndexes[0],
    })
    const chain = [txs[0], tx1]
    const roots: Record<number, string> = {}
    chain.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const result = await verifyChain(chain, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('previous_txid must equal the spent tip txid')
    expect(result.states.every((s) => s.spv === 'verified')).toBe(true)
    expect(result.spv).toBe('pending')
  })

  it('still fails a wrong proof while the tracker is answering', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    // The tracker answers for every height, and disagrees about state 1.
    roots[800001] = 'ff'.repeat(32)
    const result = await verifyChain(txs, { chainTracker: mockTracker(roots) })
    expect(result.valid).toBe(false)
    expect(result.states[1].spv).toBe('failed')
    expect(result.spvUnavailable).toBeUndefined()
  })
})

describe('chainFromBeef', () => {
  it('reconstructs the ordered chain from BEEF binary round-trip', async () => {
    const { txs, states } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))

    // ls_dpp returns tip + full history: every state goes into the BEEF
    // (a mined tip carries its own proof, so merging it alone would not
    // pull in ancestors)
    const beef = new Beef()
    for (const tx of txs) beef.mergeTransaction(tx)

    const restored = Beef.fromBinary(beef.toBinary())
    const chain = chainFromBeef(restored, states[0].passportId)

    expect(chain.map((tx) => tx.id('hex'))).toEqual(txs.map((tx) => tx.id('hex')))
    const result = await verifyChain(chain, { chainTracker: mockTracker(roots) })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('verified')
  })

  it('throws when the BEEF holds no matching passport', async () => {
    const { txs } = await buildChainFixture()
    const beef = new Beef()
    beef.mergeTransaction(txs[0])
    expect(() => chainFromBeef(beef, 'https://id.gs1.org/01/0/21/NOPE')).toThrow(
      /no DPP states/
    )
  })
})
