import { describe, expect, it } from 'vitest'
import {
  Hash,
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  Utils,
  type PublicKey,
} from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
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
import { InMemoryOverlayStorage } from '../src/engineStorage.js'

/**
 * The overlay node's wiring, exercised through the real `@bsv/overlay` Engine
 * rather than a hand-rolled stand-in. tmDpp.test.ts checks admission in
 * isolation; what is checked here is everything the Engine does around it:
 * that it finds the previously admitted coin and passes it as `previousCoins`,
 * that `coinsToRetain` keeps the spent state instead of deleting it, that the
 * lookup answer carries the BEEF each state arrived in, and that a second
 * submission of the same transaction is a no-op.
 *
 * SPV is deliberately not what this file proves. The chain tracker is
 * 'scripts only' and the funding root carries a synthetic path, so the
 * transactions are locally spendable without a block. Real SPV was proved
 * against a mainnet DPP record instead.
 */

const makerPriv = PrivateKey.fromHex('11'.repeat(32))
const serverPriv = PrivateKey.fromHex('22'.repeat(32))
const ownerPriv = PrivateKey.fromHex('33'.repeat(32))
const makerWallet = new ProtoWallet(makerPriv)
const serverWallet = new ProtoWallet(serverPriv)
const SERVER_ID = serverPriv.toPublicKey().toString()
const lockKey: PublicKey = makerPriv.toPublicKey()

const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/ENGINE-1'
const UID = 'ENGINE-UID-1'
const ANYONE = new LockingScript([{ op: 0x51 }])
const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID

function makeData(overrides: Partial<DppStateData> = {}): DppStateData {
  return {
    passportId: PASSPORT_ID,
    op: 'ACTIVATE',
    timestamp: '2026-07-26T09:00:00Z',
    ownerIdentityKey: ownerPriv.toPublicKey().toString(),
    actorIdentityKey: makerPriv.toPublicKey().toString(),
    actorKeyId: 'maker',
    eventData: '',
    payloadPublic: JSON.stringify({ name: 'Hearth 10', dataCarrier: UID }),
    payloadOwnerHash: ownerBlobHash([1, 2, 3]),
    previousTxid: '',
    ...overrides,
  }
}

/** A mined funding source. 'scripts only' never checks the path itself. */
function fundingTx(): Transaction {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

/** The DPP output is `<pubkey> OP_CHECKSIG <fields> OP_2DROP...`: a plain
 *  signature push unlocks it, the way P2PK does. */
function unlockDppOutput(spending: Transaction, inputIndex: number): UnlockingScript {
  const input = spending.inputs[inputIndex]
  const source = input.sourceTransaction!
  const sourceOutput = source.outputs[input.sourceOutputIndex]
  const preimage = TransactionSignature.format({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceOutput.satoshis!,
    transactionVersion: spending.version,
    otherInputs: spending.inputs.filter((_, i) => i !== inputIndex),
    outputs: spending.outputs,
    inputIndex,
    subscript: sourceOutput.lockingScript,
    inputSequence: input.sequence ?? 0xffffffff,
    lockTime: spending.lockTime,
    scope: SIGHASH,
  })
  // sha256 here, not hash256: PrivateKey.sign hashes what it is given, so
  // passing the single hash is what makes the signature a double-sha256 one.
  const raw = makerPriv.sign(Hash.sha256(preimage))
  const signature = new TransactionSignature(raw.r, raw.s, SIGHASH)
  const der = [...signature.toChecksigFormat()]
  return new UnlockingScript([{ op: der.length, data: der }])
}

async function genesisTx(): Promise<{ tx: Transaction; state: DppState }> {
  const state = await completeState(makeData(), makerWallet, serverWallet)
  const funding = fundingTx()
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: funding,
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([]),
  })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  return { tx, state }
}

async function eventTx(previous: Transaction): Promise<Transaction> {
  const state = await completeState(
    makeData({
      op: 'SOLD',
      timestamp: '2026-07-26T10:00:00Z',
      eventData: '{"channel":"store"}',
      previousTxid: previous.id('hex'),
    }),
    makerWallet,
    serverWallet
  )
  const funding = fundingTx()
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: previous,
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([]),
  })
  tx.addInput({
    sourceTransaction: funding,
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([]),
  })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  tx.inputs[0].unlockingScript = unlockDppOutput(tx, 0)
  return tx
}

function newEngine(): { engine: Engine; storage: InMemoryOverlayStorage } {
  const storage = new InMemoryOverlayStorage()
  const engine = new Engine(
    { tm_dpp: new DppTopicManager(SERVER_ID) },
    { ls_dpp: new DppLookupService(new InMemoryDppStorage()) },
    storage,
    'scripts only',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { tm_dpp: false }
  )
  return { engine, storage }
}

describe('the overlay node through the real Engine', () => {
  it('admits a genesis and answers a lookup with the BEEF it arrived in', async () => {
    const { engine } = newEngine()
    const { tx } = await genesisTx()
    const beef = tx.toBEEF()

    const steak = await engine.submit({ beef, topics: ['tm_dpp'] })
    expect(steak.tm_dpp.outputsToAdmit).toEqual([0])

    const answer = await engine.lookup({ service: 'ls_dpp', query: { passportId: PASSPORT_ID } })
    expect(answer.type).toBe('output-list')
    const outputs = (answer as { outputs: Array<{ beef: number[]; outputIndex: number }> }).outputs
    expect(outputs).toHaveLength(1)
    expect(outputs[0].outputIndex).toBe(0)
    expect(Utils.toBase64(outputs[0].beef)).toBe(Utils.toBase64(beef))
  })

  it('retains the spent state, so the lookup answers with the whole lifecycle', async () => {
    const { engine } = newEngine()
    const { tx: genesis } = await genesisTx()
    await engine.submit({ beef: genesis.toBEEF(), topics: ['tm_dpp'] })

    const event = await eventTx(genesis)
    const steak = await engine.submit({ beef: event.toBEEF(), topics: ['tm_dpp'] })
    // The Engine found the admitted tip among the inputs and offered it as a
    // previous coin; tm_dpp admitted the new state and retained the old one.
    expect(steak.tm_dpp).toEqual({
      outputsToAdmit: [0],
      coinsToRetain: [0],
      coinsRemoved: [],
    })

    const answer = await engine.lookup({ service: 'ls_dpp', query: { uid: UID } })
    const outputs = (answer as { outputs: Array<{ beef: number[] }> }).outputs
    expect(outputs).toHaveLength(2)

    // The two answers merge into the chain the app verifies.
    const txids = outputs.map((o) => Transaction.fromBEEF(o.beef).id('hex'))
    expect(new Set(txids)).toEqual(new Set([genesis.id('hex'), event.id('hex')]))
  })

  it('treats a re-announcement as a no-op rather than a failure', async () => {
    const { engine } = newEngine()
    const { tx } = await genesisTx()
    const beef = tx.toBEEF()
    await engine.submit({ beef, topics: ['tm_dpp'] })

    const again = await engine.submit({ beef, topics: ['tm_dpp'] })
    expect(again.tm_dpp.outputsToAdmit).toEqual([])

    const answer = await engine.lookup({ service: 'ls_dpp', query: { passportId: PASSPORT_ID } })
    expect((answer as { outputs: unknown[] }).outputs).toHaveLength(1)
  })

  it('refuses a state signed by some other service key', async () => {
    const { engine } = newEngine()
    const wrongServer = new ProtoWallet(PrivateKey.fromHex('44'.repeat(32)))
    const state = await completeState(makeData(), makerWallet, wrongServer)
    const funding = fundingTx()
    const tx = new Transaction()
    tx.addInput({
      sourceTransaction: funding,
      sourceOutputIndex: 0,
      unlockingScript: new UnlockingScript([]),
    })
    tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
    tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })

    const steak = await engine.submit({ beef: tx.toBEEF(), topics: ['tm_dpp'] })
    expect(steak.tm_dpp.outputsToAdmit).toEqual([])
    const answer = await engine.lookup({ service: 'ls_dpp', query: { passportId: PASSPORT_ID } })
    expect((answer as { outputs: unknown[] }).outputs).toHaveLength(0)
  })
})
