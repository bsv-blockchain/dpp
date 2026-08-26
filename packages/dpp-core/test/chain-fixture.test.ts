import { describe, expect, it } from 'vitest'
import { ProtoWallet, Transaction, Utils } from '@bsv/sdk'
import { completeState, verifyChain, type DppStateData } from '../src/index.js'
import { makerPriv, owner1Priv, owner2Priv, serverPriv, stateTx } from './helpers.js'
import { CHAIN_V1_FIXTURE as F } from './chain-v1-fixture.js'

/**
 * The chain fixture is the wire contract for the chain invariants, the way
 * `record-v1` is for one output. These tests rebuild every pinned byte of the
 * valid chain from `states[].data` and the test keys, then prove each refusal
 * vector refuses for the pinned reason when read from raw hex alone.
 */
const wallets = {
  maker: new ProtoWallet(makerPriv),
  owner1: new ProtoWallet(owner1Priv),
  owner2: new ProtoWallet(owner2Priv),
} as const
const server = new ProtoWallet(serverPriv)
const lockKey = makerPriv.toPublicKey()

async function rebuild(): Promise<Transaction[]> {
  const txs: Transaction[] = []
  for (const [i, s] of F.states.entries()) {
    const state = await completeState(s.data as DppStateData, wallets[s.actor as keyof typeof wallets], server)
    expect(Utils.toHex(state.userSignature)).toBe(s.userSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(s.serverSignature)
    const prev = i === 0 ? undefined : { tx: txs[i - 1], outputIndex: F.states[i - 1].outputIndex }
    const tx = stateTx(state, lockKey, prev, s.outputIndex === 1)
    expect(tx.outputs[s.outputIndex].lockingScript.toHex()).toBe(s.lockingScript)
    expect(tx.toHex()).toBe(s.rawTx)
    expect(tx.id('hex')).toBe(s.txid)
    txs.push(tx)
  }
  return txs
}

describe('chain-v1 fixture: the writer reproduces every byte', () => {
  it('pins the four test keys', () => {
    expect(makerPriv.toPublicKey().toString()).toBe(F.makerKey)
    expect(serverPriv.toPublicKey().toString()).toBe(F.serverKey)
    expect(owner1Priv.toPublicKey().toString()).toBe(F.owner1Key)
    expect(owner2Priv.toPublicKey().toString()).toBe(F.owner2Key)
    expect(F.lockingKey).toBe(F.makerKey)
  })

  it('rebuilds all four transactions, signatures, scripts and txids', async () => {
    const txs = await rebuild()
    expect(txs).toHaveLength(4)
    expect(F.states.map((s) => s.data.op)).toEqual(['ACTIVATE', 'SOLD', 'TRANSFER', 'REPAIRED'])
    expect(F.states.map((s) => s.outputIndex)).toEqual([0, 1, 0, 0])
  })
})

describe('chain-v1 fixture: the reader accepts the chain and verifies it', () => {
  const fromHex = () => F.states.map((s) => Transaction.fromHex(s.rawTx))

  it('verifies from raw hex alone, with no source transactions hydrated', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('pending')
    expect(result.states.every((s) => s.userSignatureValid && s.linkageValid)).toBe(true)
  })

  it('verifies every server signature against the pinned service key', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only', serverIdentityKey: F.serverKey })
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
  })
})

describe('chain-v1 fixture: the reader refuses every broken link', () => {
  it.each(F.refusals.map((r) => [r.name, r] as const))('refuses %s', async (_name, r) => {
    const prefix = F.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const result = await verifyChain([...prefix, Transaction.fromHex(r.rawTx)], { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
  })

  it('control: every refusal is one invariant, and no two vectors are the same bytes', () => {
    const raws = F.refusals.map((r) => r.rawTx)
    expect(new Set(raws).size).toBe(raws.length)
    for (const raw of raws) expect(F.states.map((s) => s.rawTx)).not.toContain(raw)
  })
})
