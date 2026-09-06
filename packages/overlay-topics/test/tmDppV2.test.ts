import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Beef, CachedKeyDeriver, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
import {
  ACCEPTANCE_COMMITMENT_REFUSAL,
  OWNER_PROTOCOL_ID,
  buildLockingScript,
  chainFromBeef,
  completeState,
  ownerBlobHash,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  verifyChain,
  type DppStateDataV2,
} from '@bsv/dpp-core'
import { DppTopicManager } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { InMemoryDppStorage } from '../src/storage.js'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import { atomicOver, newNode } from './helpers.js'

/**
 * Version 2 admission (`spec/record-model-v2.md` §6 and §8, `spec/managed-custody.md`)
 * through the topic manager and through the real Engine: the pinned lineage
 * of fixtures/chain-v2.json is admitted state by state, its refusal vectors
 * are refused, the managed-custody profile is enforced only when selected,
 * and the version 1 fixture chain is upgraded by the pinned version 2 UPDATE,
 * which needs the manager to trace the lineage back to its genesis through the
 * bytes it holds.
 */
const FIXTURES = new URL('../../../fixtures/', import.meta.url)
const V2 = JSON.parse(readFileSync(new URL('chain-v2.json', FIXTURES), 'utf8'))
const V1 = JSON.parse(readFileSync(new URL('chain-v1.json', FIXTURES), 'utf8'))
const CUSTODIAN = V2.custodianKey as string
const issuerPriv = PrivateKey.fromHex('11'.repeat(32))
const custodianPriv = PrivateKey.fromHex('22'.repeat(32))
const strangerPriv = PrivateKey.fromHex('44'.repeat(32))

afterEach(() => vi.restoreAllMocks())

/** Each state atomic over its predecessors with a synthetic proof per state: the shape a backfill announces. */
function proven(rawTxs: string[], fromHeight: number): { txs: Transaction[]; beefs: number[][] } {
  const txs = rawTxs.map((raw, i) => {
    const tx = Transaction.fromHex(raw)
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), fromHeight + i)
    return tx
  })
  const beefs = txs.map((tx, i) => {
    const beef = new Beef()
    for (const earlier of txs.slice(0, i + 1)) beef.mergeTransaction(earlier)
    return atomicOver(beef, tx.id('hex'))
  })
  return { txs, beefs }
}

const v2Raw: string[] = V2.states.map((s: { rawTx: string }) => s.rawTx)
const v2Indexes: number[] = V2.states.map((s: { outputIndex: number }) => s.outputIndex)

describe('tm_dpp admits the version 2 fixture lineage', () => {
  it('admits ISSUE, UPDATE, TRANSFER, UPDATE and RETIRE in order, retaining each spent tip', async () => {
    const tm = new DppTopicManager(CUSTODIAN)
    const { beefs } = proven(v2Raw, 810_000)
    for (const [i, beef] of beefs.entries()) {
      const previousCoins = i === 0 ? [] : [0]
      const result = await tm.identifyAdmissibleOutputs(beef, previousCoins)
      expect(result, `state ${i + 1}`).toEqual({ outputsToAdmit: [v2Indexes[i]], coinsToRetain: previousCoins })
    }
  })

  it('refuses every fixture refusal, keeping the offered coin, and names the version 2 reasons in its log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const r of V2.refusals as Array<{ name: string; appendAfter: number; rawTx: string; error: string; managedAcceptance?: true; acceptedUnder?: { authorities: string[] } }>) {
      const tm = new DppTopicManager(CUSTODIAN, { managedAcceptance: r.managedAcceptance === true })
      const prefix = v2Raw.slice(0, r.appendAfter + 1)
      const { beefs } = proven([...prefix, r.rawTx], 820_000)
      for (const [i, beef] of beefs.slice(0, -1).entries()) await tm.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
      const previousCoins = r.appendAfter < 0 ? [] : [0]
      const result = await tm.identifyAdmissibleOutputs(beefs[beefs.length - 1], previousCoins)
      expect(result.outputsToAdmit, r.name).toEqual([])
      expect(result.coinsToRetain, r.name).toEqual(previousCoins)
      if (r.acceptedUnder != null) {
        const lenient = new DppTopicManager(CUSTODIAN, { controlAuthorities: r.acceptedUnder.authorities })
        for (const [i, beef] of beefs.slice(0, -1).entries()) await lenient.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
        expect((await lenient.identifyAdmissibleOutputs(beefs[beefs.length - 1], previousCoins)).outputsToAdmit, `${r.name} under authority`).toEqual([0])
      }
      if (r.managedAcceptance) {
        const baseline = new DppTopicManager(CUSTODIAN)
        for (const [i, beef] of beefs.slice(0, -1).entries()) await baseline.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
        expect((await baseline.identifyAdmissibleOutputs(beefs[beefs.length - 1], previousCoins)).outputsToAdmit, `${r.name} without the profile`).toEqual([0])
      }
    }
    expect(warn.mock.calls.some((c) => String(c[0]).includes(ACCEPTANCE_COMMITMENT_REFUSAL))).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('retired'))).toBe(true)
  })

  it('names the version 2 rules and the profile in its documentation', async () => {
    const off = await new DppTopicManager(CUSTODIAN).getDocumentation()
    expect(off).toContain('record versions 1 and 2')
    expect(off).toContain('Not enforced by this index, which admits a version 2 TRANSFER with an empty authorisation_commitment')
    const on = await new DppTopicManager(CUSTODIAN, { managedAcceptance: true, controlAuthorities: [V2.authorityKey] }).getDocumentation()
    expect(on).toContain('managed-custody profile')
    expect(on).toContain(V2.authorityKey)
  })
})

describe('tm_dpp upgrades a version 1 lineage', () => {
  const v1Raw: string[] = V1.states.map((s: { rawTx: string }) => s.rawTx)

  it('admits the pinned version 2 UPDATE over the version 1 fixture chain when the BEEF carries the history', async () => {
    const tm = new DppTopicManager(V1.serverKey)
    const { beefs } = proven([...v1Raw, V2.upgrade.rawTx], 830_000)
    for (const [i, beef] of beefs.slice(0, -1).entries()) {
      const previousCoins = i === 0 ? [] : [0]
      expect((await tm.identifyAdmissibleOutputs(beef, previousCoins)).outputsToAdmit, `v1 state ${i + 1}`).toHaveLength(1)
    }
    const result = await tm.identifyAdmissibleOutputs(beefs[beefs.length - 1], [0])
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [0] })
  })

  it("traces the genesis through the engine's storage when the BEEF stops at the proven tip", async () => {
    const storage = new InMemoryOverlayStorage()
    const tm = new DppTopicManager(V1.serverKey, { admittedOutputs: storage })
    const { txs, beefs } = proven(v1Raw, 840_000)
    // The engine's storage holds every admitted version 1 output, as it would after admission.
    for (const [i, tx] of txs.entries()) {
      await storage.insertOutput({ txid: tx.id('hex'), outputIndex: V1.states[i].outputIndex, outputScript: tx.outputs[V1.states[i].outputIndex].lockingScript.toBinary(), topic: 'tm_dpp', satoshis: 1, spent: i < txs.length - 1, outputsConsumed: [], consumedBy: [], beef: beefs[i] })
    }
    // The upgrade announced with only its own proof-bearing bytes and the tip's: the walk to the genesis goes through storage.
    const upgradeTx = Transaction.fromHex(V2.upgrade.rawTx)
    upgradeTx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(upgradeTx.id('hex'), 840_100)
    const beef = new Beef()
    beef.mergeTransaction(txs[5])
    beef.mergeTransaction(upgradeTx)
    const result = await tm.identifyAdmissibleOutputs(atomicOver(beef, upgradeTx.id('hex')), [0])
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [0] })
  })

  it('refuses the upgrade when the genesis cannot be traced, rather than admitting a lineage it cannot vouch for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tm = new DppTopicManager(V1.serverKey)
    const { txs } = proven(v1Raw, 850_000)
    const upgradeTx = Transaction.fromHex(V2.upgrade.rawTx)
    upgradeTx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(upgradeTx.id('hex'), 850_100)
    const beef = new Beef()
    beef.mergeTransaction(txs[5])
    beef.mergeTransaction(upgradeTx)
    const result = await tm.identifyAdmissibleOutputs(atomicOver(beef, upgradeTx.id('hex')), [0])
    expect(result.outputsToAdmit).toEqual([])
    expect(warn.mock.calls.some((c) => String(c[0]).includes('lineage genesis could not be traced'))).toBe(true)
  })

  it('refuses each pinned upgrade refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const r of V2.upgrade.refusals as Array<{ name: string; rawTx: string }>) {
      const tm = new DppTopicManager(V1.serverKey)
      const { beefs } = proven([...v1Raw, r.rawTx], 860_000)
      for (const [i, beef] of beefs.slice(0, -1).entries()) await tm.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
      expect((await tm.identifyAdmissibleOutputs(beefs[beefs.length - 1], [0])).outputsToAdmit, r.name).toEqual([])
    }
  })
})

describe('the Engine round trip for a version 2 lineage', () => {
  it('admits a freshly built version 2 lifecycle through the real Engine and serves it back as one chain', async () => {
    const node = newNode(CUSTODIAN, { managedAcceptance: false }, { quiet: true })
    const passportId = 'https://dpp.bsvb.net/01/09521000000018/21/ENGINE-V2-1'
    const issuer = new ProtoWallet(issuerPriv)
    const custodian = new ProtoWallet(custodianPriv)
    const lockKey = custodianPriv.toPublicKey()
    const controller = ownerKeyFromDeriver(passportId, new CachedKeyDeriver(issuerPriv))
    const linkage = ownerLinkageFromDeriver(passportId, new CachedKeyDeriver(issuerPriv))
    const anyone = new (await import('@bsv/sdk')).LockingScript([{ op: 0x51 }])
    const funding = (): Transaction => {
      const tx = new Transaction()
      tx.addOutput({ satoshis: 10_000, lockingScript: anyone })
      tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 870_000)
      return tx
    }
    const base: DppStateDataV2 = {
      version: '2', passportId, op: 'ISSUE', timestamp: '2026-09-06T09:00:00Z', ownerIdentityKey: controller,
      actorIdentityKey: issuerPriv.toPublicKey().toString(), actorKeyId: 'issuer', eventData: '',
      payloadPublic: JSON.stringify({ name: 'Engine pack', dataCarrier: 'ENGINE-V2-UID-1' }), payloadOwnerHash: ownerBlobHash([1, 2, 3]),
      previousTxid: '', previousOutputIndex: null, lineageGenesis: null, controlLinkage: '', authorisationCommitment: '',
    }
    const genesisState = await completeState(base, issuer, custodian)
    const genesis = new Transaction()
    genesis.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    genesis.addOutput({ satoshis: 1, lockingScript: buildLockingScript(genesisState, lockKey) })
    genesis.addOutput({ satoshis: 9_000, lockingScript: anyone })
    const first = await node.engine.submit({ beef: genesis.toBEEF(), topics: ['tm_dpp'] })
    expect(first.tm_dpp.outputsToAdmit).toEqual([0])

    const updateState = await completeState({
      ...base, op: 'UPDATE', timestamp: '2026-09-07T09:00:00Z', payloadPublic: JSON.stringify({ name: 'Engine pack', dataCarrier: 'ENGINE-V2-UID-1', recycledContent: 5 }),
      previousTxid: genesis.id('hex'), previousOutputIndex: 0, lineageGenesis: { txid: genesis.id('hex'), outputIndex: 0 }, controlLinkage: linkage,
    }, issuer, custodian)
    const update = new Transaction()
    update.addInput({ sourceTransaction: genesis, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    update.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    update.addOutput({ satoshis: 1, lockingScript: buildLockingScript(updateState, lockKey) })
    update.addOutput({ satoshis: 9_000, lockingScript: anyone })
    const { unlockDppOutput } = await import('./helpers.js')
    update.inputs[0].unlockingScript = unlockDppOutput(update, 0, custodianPriv)
    const second = await node.engine.submit({ beef: update.toBEEF(), topics: ['tm_dpp'] })
    expect(second.tm_dpp.outputsToAdmit).toEqual([0])
    expect(second.tm_dpp.coinsToRetain).toEqual([0])

    // A stranger's successor is refused by the same Engine, and the tip stays a tip.
    const strangerState = await completeState({
      ...base, op: 'UPDATE', timestamp: '2026-09-08T09:00:00Z', actorIdentityKey: strangerPriv.toPublicKey().toString(), actorKeyId: 'stranger',
      previousTxid: update.id('hex'), previousOutputIndex: 0, lineageGenesis: { txid: genesis.id('hex'), outputIndex: 0 }, controlLinkage: '',
    }, new ProtoWallet(strangerPriv), custodian)
    const rogue = new Transaction()
    rogue.addInput({ sourceTransaction: update, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    rogue.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    rogue.addOutput({ satoshis: 1, lockingScript: buildLockingScript(strangerState, lockKey) })
    rogue.addOutput({ satoshis: 9_000, lockingScript: anyone })
    rogue.inputs[0].unlockingScript = unlockDppOutput(rogue, 0, custodianPriv)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const third = await node.engine.submit({ beef: rogue.toBEEF(), topics: ['tm_dpp'] })
    expect(third.tm_dpp.outputsToAdmit).toEqual([])

    const answer = await node.engine.lookup({ service: 'ls_dpp', query: { passportId } })
    if (answer.type !== 'output-list') throw new Error('expected an output list')
    expect(answer.outputs).toHaveLength(2)
    const beef = new Beef()
    for (const output of answer.outputs) beef.mergeBeef(output.beef)
    const chain = chainFromBeef(beef, passportId)
    const result = await verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: CUSTODIAN })
    expect(result.valid).toBe(true)
    expect(result.states.map((s) => s.op)).toEqual(['ISSUE', 'UPDATE'])
  })
})

/** The lookup service records both versions by the fields the record store keys on. */
describe('ls_dpp with a version 2 state', () => {
  it('indexes a version 2 state under its passport identifier and data carrier', async () => {
    const records = new InMemoryDppStorage()
    const ls = new DppLookupService(records)
    const tx = Transaction.fromHex(v2Raw[0])
    await ls.outputAdmittedByTopic({ mode: 'locking-script', txid: tx.id('hex'), outputIndex: 0, topic: 'tm_dpp', satoshis: 1, lockingScript: tx.outputs[0].lockingScript })
    const found = await ls.lookup({ service: 'ls_dpp', query: { uid: 'V2-UID-0001' } })
    expect(found).toEqual([{ txid: tx.id('hex'), outputIndex: 0 }])
    expect((await records.findByPassport(V2.states[0].data.passportId))[0].op).toBe('ISSUE')
    expect(new Engine({}, {}, new InMemoryOverlayStorage(), 'scripts only')).toBeDefined()
    expect(OWNER_PROTOCOL_ID).toEqual(V2.ownerProtocol)
  })
})
