import { describe, expect, it } from 'vitest'
import { ProtoWallet, PublicKey, Spend, Transaction, Utils } from '@bsv/sdk'
import {
  completeState,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  verifyChain,
  verifyOwnerLinkage,
  type DppStateData,
} from '../src/index.js'
import {
  PASSPORT_ID,
  makerPriv,
  owner1Deriver,
  owner1Priv,
  owner2Priv,
  owner3Deriver,
  owner3Priv,
  serverPriv,
  spendAsOwner,
  stateTx,
} from './helpers.js'
import { CHAIN_V1_FIXTURE as F } from './chain-v1-fixture.js'

/**
 * The chain fixture is the wire contract for the chain invariants, the way
 * `record-v1` is for one output, and since the fifth and sixth states also for
 * the possession convention and the owner-signed transfer of `spec/custody.md`.
 * These tests rebuild every pinned byte of the valid chain from `states[].data`
 * and the test keys, including the sixth state's unlocking script, which an
 * owner's wallet produces with one derivation, then prove each refusal vector
 * refuses for the pinned reason when read from raw hex alone, under the option
 * the vector names, and is accepted where the fixture says it is.
 */
const wallets = {
  maker: new ProtoWallet(makerPriv),
  owner1: new ProtoWallet(owner1Priv),
  owner2: new ProtoWallet(owner2Priv),
  owner3: new ProtoWallet(owner3Priv),
} as const
type Actor = keyof typeof wallets
const server = new ProtoWallet(serverPriv)

async function rebuild(): Promise<Transaction[]> {
  const txs: Transaction[] = []
  for (const [i, s] of F.states.entries()) {
    const state = await completeState(s.data as DppStateData, wallets[s.actor as Actor], server)
    expect(Utils.toHex(state.userSignature)).toBe(s.userSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(s.serverSignature)
    const prev = i === 0 ? undefined : { tx: txs[i - 1], outputIndex: F.states[i - 1].outputIndex }
    const tx = stateTx(state, PublicKey.fromString(s.lockingKey), prev, s.outputIndex === 1)
    if (s.unlock === 'owner') await spendAsOwner(tx, 0, wallets[s.actor as Actor])
    expect(tx.outputs[s.outputIndex].lockingScript.toHex()).toBe(s.lockingScript)
    expect(tx.toHex()).toBe(s.rawTx)
    expect(tx.id('hex')).toBe(s.txid)
    txs.push(tx)
  }
  return txs
}

const consentOf = (r: (typeof F.refusals)[number]) =>
  'ownerConsent' in r ? (r.ownerConsent as true | { authorities: string[] }) : undefined
const acceptedUnderOf = (r: (typeof F.refusals)[number]) =>
  'acceptedUnder' in r ? (r.acceptedUnder as { authorities: string[] }) : undefined

describe('chain-v1 fixture: the writer reproduces every byte', () => {
  it('pins the five test keys, the derived owner keys and the linkage scalar', () => {
    expect(makerPriv.toPublicKey().toString()).toBe(F.makerKey)
    expect(serverPriv.toPublicKey().toString()).toBe(F.serverKey)
    expect(owner1Priv.toPublicKey().toString()).toBe(F.owner1Key)
    expect(owner2Priv.toPublicKey().toString()).toBe(F.owner2Key)
    expect(owner3Priv.toPublicKey().toString()).toBe(F.owner3Key)
    expect(F.lockingKey).toBe(F.makerKey)
    expect(F.ownerProtocol).toEqual([1, 'dpp owner v1'])
    expect(ownerKeyFromDeriver(PASSPORT_ID, owner3Deriver)).toBe(F.owner3OwnerKey)
    expect(ownerKeyFromDeriver(PASSPORT_ID, owner1Deriver)).toBe(F.owner1OwnerKey)
    expect(ownerLinkageFromDeriver(PASSPORT_ID, owner3Deriver)).toBe(F.owner3OwnerLinkage)
    expect(verifyOwnerLinkage(F.owner3Key, F.owner3OwnerKey, F.owner3OwnerLinkage)).toBe(true)
  })

  it('locks the first four states to the maker and the last two to their own field 6', () => {
    for (const s of F.states.slice(0, 4)) expect(s.lockingKey).toBe(F.makerKey)
    for (const s of F.states.slice(4)) expect(s.lockingKey).toBe(s.data.ownerIdentityKey)
    expect(F.states.map((s) => s.unlock)).toEqual(['none', 'none', 'none', 'none', 'none', 'owner'])
  })

  it('rebuilds all six transactions, signatures, scripts, txids and the owner spend', async () => {
    const txs = await rebuild()
    expect(txs).toHaveLength(6)
    expect(F.states.map((s) => s.data.op)).toEqual([
      'ACTIVATE', 'SOLD', 'TRANSFER', 'REPAIRED', 'TRANSFER', 'TRANSFER',
    ])
    expect(F.states.map((s) => s.outputIndex)).toEqual([0, 1, 0, 0, 0, 0])
    for (const tx of txs.slice(1, 5)) expect(tx.inputs[0].unlockingScript?.toHex()).toBe('')
    expect(txs[5].inputs[0].unlockingScript?.toHex()).not.toBe('')
  })

  it("the owner's wallet spent the tip: the sixth input is a valid spend of the fifth output", () => {
    const tx4 = Transaction.fromHex(F.states[4].rawTx)
    const tx5 = Transaction.fromHex(F.states[5].rawTx)
    const input = tx5.inputs[0]
    expect(input.sourceTXID).toBe(F.states[4].txid)
    // Exactly what Transaction.verify builds per input; not tx.verify itself,
    // which walks every ancestor and the earlier inputs are deliberately unsigned.
    const spend = new Spend({
      sourceTXID: F.states[4].txid,
      sourceOutputIndex: input.sourceOutputIndex,
      lockingScript: tx4.outputs[0].lockingScript,
      sourceSatoshis: tx4.outputs[0].satoshis ?? 0,
      transactionVersion: tx5.version,
      otherInputs: [],
      unlockingScript: input.unlockingScript!,
      inputSequence: input.sequence ?? 0xffffffff,
      inputIndex: 0,
      outputs: tx5.outputs,
      lockTime: tx5.lockTime,
    })
    expect(spend.validate()).toBe(true)
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
    expect(result.states.every((s) => s.ownerConsentValid === null)).toBe(true)
  })

  it('verifies every server signature against the pinned service key', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only', serverIdentityKey: F.serverKey })
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
  })

  it('holds the owner-signed transfer on every TRANSFER when the option is selected', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only', ownerConsent: true })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.states.map((s) => s.ownerConsentValid)).toEqual([null, null, true, null, true, true])
  })
})

describe('chain-v1 fixture: the reader refuses every broken link', () => {
  it.each(F.refusals.map((r) => [r.name, r] as const))('refuses %s', async (_name, r) => {
    const prefix = F.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const chain = [...prefix, Transaction.fromHex(r.rawTx)]
    const result = await verifyChain(chain, { chainTracker: 'scripts only', ownerConsent: consentOf(r) })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
    if (consentOf(r) != null) {
      // The control: a consent refusal is a valid chain when the option is off.
      const off = await verifyChain(chain, { chainTracker: 'scripts only' })
      expect(off.error).toBeUndefined()
      expect(off.valid).toBe(true)
    }
    const under = acceptedUnderOf(r)
    if (under != null) {
      const accepted = await verifyChain(chain, { chainTracker: 'scripts only', ownerConsent: under })
      expect(accepted.error).toBeUndefined()
      expect(accepted.valid).toBe(true)
      expect(accepted.states.at(-1)?.ownerConsentValid).toBe(true)
    }
  })

  it('control: every refusal is one rule, and no two vectors are the same bytes', () => {
    const raws = F.refusals.map((r) => r.rawTx)
    expect(new Set(raws).size).toBe(raws.length)
    for (const raw of raws) expect(F.states.map((s) => s.rawTx)).not.toContain(raw)
    expect(F.refusals.filter((r) => consentOf(r) != null)).toHaveLength(7)
    expect(F.refusals.filter((r) => acceptedUnderOf(r) != null).map((r) => r.name)).toEqual(['recoveryWithoutAuthority'])
  })
})
