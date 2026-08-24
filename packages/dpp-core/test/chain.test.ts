import { describe, expect, it } from 'vitest'
import { Transaction, UnlockingScript } from '@bsv/sdk'
import { verifyChain } from '../src/index.js'
import {
  buildChainFixture,
  idKey,
  makeData,
  makerPriv,
  owner2Priv,
  owner2Wallet,
  serverPriv,
  signedState,
  stateTx,
} from './helpers.js'

const lockKey = makerPriv.toPublicKey()

describe('verifyChain, happy path', () => {
  it('accepts the demo lifecycle ACTIVATE → SOLD → TRANSFER → REPAIRED', async () => {
    const { txs } = await buildChainFixture()
    const result = await verifyChain(txs, { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('pending')
    expect(result.states.map((s) => s.op)).toEqual([
      'ACTIVATE',
      'SOLD',
      'TRANSFER',
      'REPAIRED',
    ])
    expect(result.states.every((s) => s.userSignatureValid && s.linkageValid)).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === null)).toBe(true)
  })

  it('verifies server signatures when the service key is supplied (§8)', async () => {
    const { txs } = await buildChainFixture()
    const result = await verifyChain(txs, {
      chainTracker: 'scripts only',
      serverIdentityKey: idKey(serverPriv),
    })
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
  })

  it('fails against the wrong service key', async () => {
    const { txs } = await buildChainFixture()
    const result = await verifyChain(txs, {
      chainTracker: 'scripts only',
      serverIdentityKey: idKey(owner2Priv),
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('server_signature')
  })
})

describe('verifyChain, invariants (§6)', () => {
  it('rejects an empty chain', async () => {
    const result = await verifyChain([])
    expect(result.valid).toBe(false)
  })

  it('rejects a genesis whose op is not ACTIVATE', async () => {
    const s = await signedState(
      makeData({ op: 'SOLD', eventData: '{"x":1}' })
    )
    const result = await verifyChain([stateTx(s, lockKey)])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('genesis op must be ACTIVATE')
  })

  it('rejects a genesis carrying a previous_txid', async () => {
    const s = await signedState(makeData({ previousTxid: 'ab'.repeat(32) }))
    const result = await verifyChain([stateTx(s, lockKey)])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('previous_txid must be empty')
  })

  it('rejects ACTIVATE after genesis', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const again = await signedState(
      makeData({ previousTxid: txs[0].id('hex') })
    )
    const tx = stateTx(again, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] })
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('genesis only')
  })

  it('rejects a transaction with two DPP outputs (invariant 1)', async () => {
    const s = await signedState(makeData())
    const tx = stateTx(s, lockKey)
    tx.addOutput(tx.outputs[0])
    const result = await verifyChain([tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('exactly one DPP output')
  })

  it('rejects a passport_id change (invariant 3)', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        passportId: 'https://id.gs1.org/01/09506000134352/21/OTHER',
        op: 'SOLD',
        eventData: '{"x":1}',
        previousTxid: txs[0].id('hex'),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] })
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('passport_id is immutable')
  })

  it('rejects previous_txid not matching the spent tip (invariant 2)', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'SOLD',
        eventData: '{"x":1}',
        previousTxid: 'ef'.repeat(32),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] })
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('previous_txid must equal the spent tip txid')
  })

  it('rejects a state that does not spend the previous DPP outpoint', async () => {
    const { txs } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'SOLD',
        eventData: '{"x":1}',
        previousTxid: txs[0].id('hex'),
      })
    )
    // spends output 1 (nonexistent) instead of the DPP output 0
    const tx = new Transaction()
    tx.addInput({
      sourceTransaction: txs[0],
      sourceOutputIndex: 1,
      unlockingScript: new UnlockingScript([]),
    })
    tx.addOutput(stateTx(s, lockKey).outputs[0])
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('does not spend the previous tip output')
  })

  it('rejects an owner change outside TRANSFER (invariant 5)', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'SOLD',
        eventData: '{"x":1}',
        ownerIdentityKey: idKey(owner2Priv),
        previousTxid: txs[0].id('hex'),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] })
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('owner_identity_key changes only on TRANSFER')
  })

  it('rejects a payload change outside ACTIVATE/EDIT/TRANSFER (invariant 5)', async () => {
    const { txs, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'REPAIRED',
        eventData: '{"note":"x"}',
        payloadPublic: '{"name":"Tampered Jersey"}',
        previousTxid: txs[0].id('hex'),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] })
    const result = await verifyChain([txs[0], tx])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('change only on ACTIVATE, EDIT or TRANSFER')
  })

  it('accepts an EDIT carrying the full corrected payload (T2)', async () => {
    const { txs, states, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'EDIT',
        eventData: '',
        payloadPublic: '{"name":"Club Jersey 2026","fibres":{"polyester":80,"cotton":20}}',
        ownerIdentityKey: idKey(owner2Priv),
        actorIdentityKey: idKey(makerPriv),
        actorKeyId: 'maker correction 1',
        payloadOwnerHash: states[3].payloadOwnerHash,
        previousTxid: txs[3].id('hex'),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[3], outputIndex: outputIndexes[3] })
    const result = await verifyChain([...txs, tx], { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
  })

  it('continues past RECYCLED, no terminal spend (T1), RESOLD covered', async () => {
    const { txs, states, outputIndexes } = await buildChainFixture()
    const recycled = await signedState(
      makeData({
        op: 'RECYCLED',
        timestamp: '2028-02-01T08:00:00Z',
        ownerIdentityKey: states[3].ownerIdentityKey,
        actorIdentityKey: states[3].actorIdentityKey,
        actorKeyId: 'owner recycle 1',
        eventData: '{"facility":"NL-031"}',
        payloadOwnerHash: states[3].payloadOwnerHash,
        previousTxid: txs[3].id('hex'),
      }),
      owner2Wallet
    )
    const tx4 = stateTx(recycled, lockKey, { tx: txs[3], outputIndex: outputIndexes[3] })
    // T1: RECYCLED is a state, not a destruction - the chain keeps going
    const resold = await signedState(
      makeData({
        op: 'RESOLD',
        timestamp: '2028-03-01T08:00:00Z',
        ownerIdentityKey: states[3].ownerIdentityKey,
        actorIdentityKey: states[3].actorIdentityKey,
        actorKeyId: 'owner resale 1',
        eventData: '{"channel":"second life"}',
        payloadOwnerHash: states[3].payloadOwnerHash,
        previousTxid: tx4.id('hex'),
      }),
      owner2Wallet
    )
    const tx5 = stateTx(resold, lockKey, { tx: tx4, outputIndex: 0 })
    const result = await verifyChain([...txs, tx4, tx5], { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.states.map((s) => s.op)).toEqual([
      'ACTIVATE',
      'SOLD',
      'TRANSFER',
      'REPAIRED',
      'RECYCLED',
      'RESOLD',
    ])
  })

  it('rejects an EDIT state carrying event_data (§3 field 9)', async () => {
    const { txs, states, outputIndexes } = await buildChainFixture()
    const s = await signedState(
      makeData({
        op: 'EDIT',
        eventData: '{"sneaky":true}',
        ownerIdentityKey: states[3].ownerIdentityKey,
        payloadOwnerHash: states[3].payloadOwnerHash,
        previousTxid: txs[3].id('hex'),
      })
    )
    const tx = stateTx(s, lockKey, { tx: txs[3], outputIndex: outputIndexes[3] })
    const result = await verifyChain([...txs, tx], { chainTracker: 'scripts only' })
    // the codec gate rejects the output at decode time, so the state never
    // even counts as a DPP output
    expect(result.valid).toBe(false)
  })

  it('flags a tampered payload as a signature failure, not a parse error', async () => {
    const { txs, states, outputIndexes } = await buildChainFixture()
    // re-encode state 1 with altered payload but the ORIGINAL signatures
    const tampered = {
      ...states[1],
      payloadPublic: states[1].payloadPublic.replace('Club Jersey', 'Knockoff Jersey'),
    }
    const tx = stateTx(tampered, lockKey, { tx: txs[0], outputIndex: outputIndexes[0] }, true)
    const result = await verifyChain([txs[0], tx], { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('user_signature invalid')
  })
})
