import { describe, expect, it } from 'vitest'
import {
  Beef,
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Transaction,
  UnlockingScript,
  type PublicKey,
} from '@bsv/sdk'
import {
  buildLockingScript,
  completeState,
  ownerBlobHash,
  type DppState,
  type DppStateData,
} from '@bsv/dpp-core'
import { DppTopicManager } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { InMemoryDppStorage } from '../src/storage.js'

const makerPriv = PrivateKey.fromHex('11'.repeat(32))
const serverPriv = PrivateKey.fromHex('22'.repeat(32))
const ownerPriv = PrivateKey.fromHex('33'.repeat(32))
const makerWallet = new ProtoWallet(makerPriv)
const serverWallet = new ProtoWallet(serverPriv)
const SERVER_ID = serverPriv.toPublicKey().toString()
const lockKey: PublicKey = makerPriv.toPublicKey()

const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/TM-TEST-1'

function makeData(overrides: Partial<DppStateData> = {}): DppStateData {
  return {
    passportId: PASSPORT_ID,
    op: 'ACTIVATE',
    timestamp: '2026-06-12T09:00:00Z',
    ownerIdentityKey: ownerPriv.toPublicKey().toString(),
    actorIdentityKey: makerPriv.toPublicKey().toString(),
    actorKeyId: 'maker',
    eventData: '',
    payloadPublic: JSON.stringify({ name: 'Jersey', dataCarrier: 'EXT-1' }),
    payloadOwnerHash: ownerBlobHash([1, 2, 3]),
    previousTxid: '',
    ...overrides,
  }
}

function stateTx(state: DppState, prev?: { tx: Transaction; outputIndex: number }): Transaction {
  const tx = new Transaction()
  if (prev != null) {
    tx.addInput({
      sourceTransaction: prev.tx,
      sourceOutputIndex: prev.outputIndex,
      unlockingScript: new UnlockingScript([]),
    })
  }
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  return tx
}

async function genesis(): Promise<{ tx: Transaction; state: DppState }> {
  const state = await completeState(makeData(), makerWallet, serverWallet)
  return { tx: stateTx(state), state }
}

describe('tm_dpp admission', () => {
  it('admits a valid genesis', async () => {
    const { tx } = await genesis()
    const result = await new DppTopicManager(SERVER_ID).identifyAdmissibleOutputs(
      tx.toBEEF(true),
      []
    )
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [] })
  })

  it('rejects a state without a valid service signature (§8 admission policy)', async () => {
    const wrongServer = new ProtoWallet(PrivateKey.fromHex('44'.repeat(32)))
    const state = await completeState(makeData(), makerWallet, wrongServer)
    const tx = stateTx(state)
    const result = await new DppTopicManager(SERVER_ID).identifyAdmissibleOutputs(
      tx.toBEEF(true),
      []
    )
    expect(result.outputsToAdmit).toEqual([])
  })

  it('admits a valid event spending the admitted tip and retains the spent state', async () => {
    const tm = new DppTopicManager(SERVER_ID)
    const { tx: g } = await genesis()
    await tm.identifyAdmissibleOutputs(g.toBEEF(true), [])

    const event = await completeState(
      makeData({
        op: 'SOLD',
        eventData: '{"channel":"store"}',
        previousTxid: g.id('hex'),
      }),
      makerWallet,
      serverWallet
    )
    const tx = stateTx(event, { tx: g, outputIndex: 0 })
    // engine reports input 0 as a previously admitted coin
    const result = await tm.identifyAdmissibleOutputs(tx.toBEEF(true), [0])
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [0] })
  })

  /*
   * The regression the 2026-08-12 backfill rehearsal caught, in the exact shape
   * the rehearsal met it. Every earlier event test wires
   * `input.sourceTransaction` by hand and serialises with `toBEEF(true)` before
   * either state has a merkle proof, so the parent's bytes ride along and the
   * SDK's reader hydrates them back. A backfilled state is different in the one
   * way that mattered: `proveMinedStates` has given every state its own proof,
   * the SDK's writer stops walking parents at a proof, and its reader
   * symmetrically leaves `sourceTransaction` unset on a proven subject even
   * when the parent's bytes are present in the BEEF. The topic manager read
   * only the hydration, so every mined event on every multi-state passport was
   * refused, and the refusal consumed the admitted genesis coin: one backfill
   * pass left those passports with an empty index entry.
   */
  it('admits a proven event submitted atomic over its stored chain, the backfill shape', async () => {
    const tm = new DppTopicManager(SERVER_ID)
    const { tx: g } = await genesis()
    g.merklePath = MerklePath.fromCoinbaseTxidAndHeight(g.id('hex'), 800_000)
    await tm.identifyAdmissibleOutputs(g.toBEEF(true), [])

    const event = await completeState(
      makeData({ op: 'SOLD', eventData: '{"channel":"store"}', previousTxid: g.id('hex') }),
      makerWallet,
      serverWallet
    )
    const tx = stateTx(event, { tx: g, outputIndex: 0 })
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_001)

    // What scripts/announce.ts submits: the event as the atomic subject, the
    // whole stored chain in the BEEF. Round-tripped through binary so the test
    // sees what the wire sees, not the hand-wired objects above.
    const stored = new Beef()
    stored.mergeTransaction(g)
    stored.mergeTransaction(tx)
    const result = await tm.identifyAdmissibleOutputs(
      stored.toBinaryAtomic(tx.id('hex')),
      [0]
    )
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [0] })
  })

  it('still refuses a proven event whose BEEF omits the predecessor bytes', async () => {
    // The other half of the submitter contract: when the parent is genuinely
    // absent, the transition rules cannot be held against anything, and
    // refusal is correct. `tx.toBEEF()` on a proven state is exactly that
    // shape, which is why the backfill script must never submit it.
    const tm = new DppTopicManager(SERVER_ID)
    const { tx: g } = await genesis()
    g.merklePath = MerklePath.fromCoinbaseTxidAndHeight(g.id('hex'), 800_000)
    await tm.identifyAdmissibleOutputs(g.toBEEF(true), [])

    const event = await completeState(
      makeData({ op: 'SOLD', eventData: '{"channel":"store"}', previousTxid: g.id('hex') }),
      makerWallet,
      serverWallet
    )
    const tx = stateTx(event, { tx: g, outputIndex: 0 })
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_001)

    const result = await tm.identifyAdmissibleOutputs(tx.toBEEF(), [0])
    expect(result.outputsToAdmit).toEqual([])
  })

  it('rejects a non-genesis state whose spend is not a previously admitted coin', async () => {
    const { tx: g } = await genesis()
    const event = await completeState(
      makeData({
        op: 'SOLD',
        eventData: '{"channel":"store"}',
        previousTxid: g.id('hex'),
      }),
      makerWallet,
      serverWallet
    )
    const tx = stateTx(event, { tx: g, outputIndex: 0 })
    // previousCoins empty: the engine does not know that input as admitted
    const result = await new DppTopicManager(SERVER_ID).identifyAdmissibleOutputs(
      tx.toBEEF(true),
      []
    )
    expect(result.outputsToAdmit).toEqual([])
  })

  it('rejects a transaction carrying two DPP outputs (invariant 1)', async () => {
    const { tx } = await genesis()
    tx.addOutput(tx.outputs[0])
    const result = await new DppTopicManager(SERVER_ID).identifyAdmissibleOutputs(
      tx.toBEEF(true),
      []
    )
    expect(result.outputsToAdmit).toEqual([])
  })

  it('ignores non-DPP transactions without throwing', async () => {
    const tx = new Transaction()
    tx.addOutput({ satoshis: 1, lockingScript: new LockingScript([{ op: 0x51 }]) })
    const result = await new DppTopicManager(SERVER_ID).identifyAdmissibleOutputs(
      tx.toBEEF(true),
      []
    )
    expect(result.outputsToAdmit).toEqual([])
  })
})

describe('ls_dpp indexing', () => {
  it('indexes by passport id and chip uid, marks spends, serves history', async () => {
    const storage = new InMemoryDppStorage()
    const ls = new DppLookupService(storage)
    const { tx, state } = await genesis()

    await ls.outputAdmittedByTopic({
      mode: 'locking-script',
      txid: tx.id('hex'),
      outputIndex: 0,
      topic: 'tm_dpp',
      satoshis: 1,
      lockingScript: tx.outputs[0].lockingScript,
    })

    const byId = await ls.lookup({ service: 'ls_dpp', query: { passportId: state.passportId } })
    expect(byId).toEqual([{ txid: tx.id('hex'), outputIndex: 0 }])
    const byUid = await ls.lookup({ service: 'ls_dpp', query: { uid: 'EXT-1' } })
    expect(byUid).toEqual([{ txid: tx.id('hex'), outputIndex: 0 }])

    await ls.outputSpent?.({
      mode: 'txid',
      txid: tx.id('hex'),
      outputIndex: 0,
      topic: 'tm_dpp',
      spendingTxid: 'ff'.repeat(32),
    })
    // spent states remain in history (record-model §1)
    const after = await ls.lookup({ service: 'ls_dpp', query: { uid: 'EXT-1' } })
    expect(after).toHaveLength(1)

    await ls.outputEvicted(tx.id('hex'), 0)
    await expect(
      ls.lookup({ service: 'ls_dpp', query: { passportId: state.passportId } })
    ).resolves.toEqual([])
  })

  it('rejects queries without passportId or uid', async () => {
    const ls = new DppLookupService(new InMemoryDppStorage())
    await expect(ls.lookup({ service: 'ls_dpp', query: {} })).rejects.toThrow(
      /passportId or uid/
    )
  })
})
