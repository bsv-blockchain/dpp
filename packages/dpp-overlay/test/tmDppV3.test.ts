import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Beef, CachedKeyDeriver, LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import {
  CARRIER_REFUSALS,
  buildLockingScript,
  chainFromBeef,
  completeState,
  ownerBlobHash,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  tokenIdOf,
  verifyChain,
  type DppStateDataV3,
} from '@bsv/dpp-protocol'
import { DppTopicManager, type DppRefusal } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { InMemoryDppStorage } from '../src/storage.js'
import { atomicOver, newNode, unlockDppOutput } from './helpers.js'

/**
 * Version 3 admission (`spec/token-carrier.md` §6) through the topic manager
 * and through the real Engine: the pinned carried lineage of
 * fixtures/chain-v3.json is admitted state by state, every refusal vector is
 * refused under the code the wire names for it, the burn is no state at all,
 * and a freshly built carried lifecycle is served back by its token id.
 */
const FIXTURES = new URL('../../../fixtures/', import.meta.url)
const V3 = JSON.parse(readFileSync(new URL('chain-v3.json', FIXTURES), 'utf8'))
const V2 = JSON.parse(readFileSync(new URL('chain-v2.json', FIXTURES), 'utf8'))
const CUSTODIAN = V3.custodianKey as string
const issuerPriv = PrivateKey.fromHex('11'.repeat(32))
const custodianPriv = PrivateKey.fromHex('22'.repeat(32))

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

const v3Raw: string[] = V3.states.map((s: { rawTx: string }) => s.rawTx)
const v3Indexes: number[] = V3.states.map((s: { outputIndex: number }) => s.outputIndex)

/**
 * The code the wire names for each pinned refusal. A table rather than a
 * derivation from the fixture's error string, so the contract a writer is
 * held to is written here in full; a refusal the fixture gains and this table
 * does not know fails by name.
 */
const EXPECTED_CODES: Record<string, DppRefusal> = {
  deployNotAtOutputZero: 'carrier-prefix-invalid',
  deployCarryingTokenId: 'carrier-prefix-invalid',
  valueWithEmptyId: 'carrier-prefix-invalid',
  tokenIdNotLineageGenesis: 'token-id-mismatch',
  tokenIdDisplayOrder: 'token-id-mismatch',
  versionTwoBehindPrefix: 'decode-failed',
  versionThreeWithoutPrefix: 'decode-failed',
  signedUnderVersionTwoProtocol: 'actor-signature-invalid',
  stateAfterRetire: 'lineage-retired',
  twoCarrierOutputs: 'decode-failed',
  strangerWithoutControl: 'control-not-proven',
  // An ISSUE body with no predecessor behind a value prefix. The chain
  // verifier judges position by chain index and reaches the body rule (ISSUE
  // at genesis only); the manager judges it by the body's own claim, which is
  // genesis, and the carrier rule for a genesis fails first.
  issueAfterGenesis: 'carrier-prefix-invalid',
}

describe('tm_dpp admits the version 3 fixture lineage', () => {
  it('admits the deploy and the four value outputs in order, retaining each spent tip', async () => {
    const tm = new DppTopicManager(CUSTODIAN)
    const { txs, beefs } = proven(v3Raw, 910_000)
    for (const [i, beef] of beefs.entries()) {
      const previousCoins = i === 0 ? [] : [0]
      const result = await tm.identifyAdmissibleOutputs(beef, previousCoins)
      expect(result, `state ${i + 1}`).toEqual({ outputsToAdmit: [v3Indexes[i]], coinsToRetain: previousCoins })
      expect(tm.refusalFor(txs[i].id('hex'))).toBeUndefined()
    }
  })

  it('refuses every fixture refusal under the code the contract names, keeping the offered coin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refusals = V3.refusals as Array<{ name: string; appendAfter: number; rawTx: string; error: string }>
    expect(refusals.map((r) => r.name).sort()).toEqual(Object.keys(EXPECTED_CODES).sort())
    for (const r of refusals) {
      const tm = new DppTopicManager(CUSTODIAN)
      const prefix = v3Raw.slice(0, r.appendAfter + 1)
      const { txs, beefs } = proven([...prefix, r.rawTx], 920_000)
      for (const [i, beef] of beefs.slice(0, -1).entries()) await tm.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
      const previousCoins = r.appendAfter < 0 ? [] : [0]
      const result = await tm.identifyAdmissibleOutputs(beefs[beefs.length - 1], previousCoins)
      expect(result.outputsToAdmit, r.name).toEqual([])
      expect(result.coinsToRetain, r.name).toEqual(previousCoins)
      expect(tm.refusalFor(txs[txs.length - 1].id('hex')), r.name).toBe(EXPECTED_CODES[r.name])
    }
    // The carrier refusals are named in the operator's log, as the version 2 rules are.
    const logged = warn.mock.calls.map((c) => String(c[0]))
    expect(logged.some((line) => line.includes(CARRIER_REFUSALS.genesisNotAtOutputZero))).toBe(true)
    expect(logged.some((line) => line.includes(CARRIER_REFUSALS.genesisCarriesTokenId))).toBe(true)
    expect(logged.some((line) => line.includes(CARRIER_REFUSALS.stateNotValue))).toBe(true)
    expect(logged.some((line) => line.includes(CARRIER_REFUSALS.tokenIdMismatch))).toBe(true)
  })

  it('refuses the burn as no DPP output at all, and the tip stays the tip', async () => {
    const tm = new DppTopicManager(CUSTODIAN)
    const burn = V3.burn as { appendAfter: number; rawTx: string }
    const { txs, beefs } = proven([...v3Raw.slice(0, burn.appendAfter + 1), burn.rawTx], 930_000)
    for (const [i, beef] of beefs.slice(0, -1).entries()) await tm.identifyAdmissibleOutputs(beef, i === 0 ? [] : [0])
    const result = await tm.identifyAdmissibleOutputs(beefs[beefs.length - 1], [0])
    expect(result).toEqual({ outputsToAdmit: [], coinsToRetain: [0] })
    expect(tm.refusalFor(txs[txs.length - 1].id('hex'))).toBe('decode-failed')
  })

  it('names the carrier rules in its documentation and the three versions in its metadata', async () => {
    const tm = new DppTopicManager(CUSTODIAN)
    const docs = await tm.getDocumentation()
    expect(docs).toContain('record versions 1, 2 and 3')
    expect(docs).toContain('BRC-162')
    expect(docs).toContain('deploy')
    expect(docs).toContain('output 0')
    expect(docs).toContain('Control authorities (versions 2 and 3)')
    const meta = await tm.getMetaData()
    expect(meta.version).toBe('3.0.0')
    expect(meta.shortDescription).toContain('versions 1, 2 and 3')
  })
})

describe('the Engine round trip for a version 3 lineage', () => {
  it('admits a freshly built carried lifecycle through the real Engine and serves it back by its token id', async () => {
    const node = newNode(CUSTODIAN, {}, { quiet: true })
    const passportId = 'https://dpp.bsvb.net/01/09521000000018/21/ENGINE-V3-1'
    const issuer = new ProtoWallet(issuerPriv)
    const custodian = new ProtoWallet(custodianPriv)
    const lockKey = custodianPriv.toPublicKey()
    const controller = ownerKeyFromDeriver(passportId, new CachedKeyDeriver(issuerPriv))
    const linkage = ownerLinkageFromDeriver(passportId, new CachedKeyDeriver(issuerPriv))
    const anyone = new LockingScript([{ op: 0x51 }])
    const funding = (): Transaction => {
      const tx = new Transaction()
      tx.addOutput({ satoshis: 10_000, lockingScript: anyone })
      tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 940_000)
      return tx
    }
    const base: DppStateDataV3 = {
      version: '3', passportId, op: 'ISSUE', timestamp: '2026-10-09T09:00:00Z', ownerIdentityKey: controller,
      actorIdentityKey: issuerPriv.toPublicKey().toString(), actorKeyId: 'issuer', eventData: '',
      payloadPublic: JSON.stringify({ name: 'Engine pack', dataCarrier: 'ENGINE-V3-UID-1' }), payloadOwnerHash: ownerBlobHash([1, 2, 3]),
      previousTxid: '', previousOutputIndex: null, lineageGenesis: null, controlLinkage: '', authorisationCommitment: '',
    }
    // The deploy is output 0 of its transaction; the change sits behind it.
    const genesisState = await completeState(base, issuer, custodian)
    const genesis = new Transaction()
    genesis.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    genesis.addOutput({ satoshis: 1, lockingScript: buildLockingScript(genesisState, lockKey) })
    genesis.addOutput({ satoshis: 9_000, lockingScript: anyone })
    const first = await node.engine.submit({ beef: genesis.toBEEF(), topics: ['tm_dpp'] })
    expect(first.tm_dpp.outputsToAdmit).toEqual([0])
    const tokenId = tokenIdOf({ txid: genesis.id('hex'), outputIndex: 0 })

    const updateState = await completeState({
      ...base, op: 'UPDATE', timestamp: '2026-10-10T09:00:00Z', payloadPublic: JSON.stringify({ name: 'Engine pack', dataCarrier: 'ENGINE-V3-UID-1', recycledContent: 5 }),
      previousTxid: genesis.id('hex'), previousOutputIndex: 0, lineageGenesis: { txid: genesis.id('hex'), outputIndex: 0 }, controlLinkage: linkage,
    }, issuer, custodian)
    const update = new Transaction()
    update.addInput({ sourceTransaction: genesis, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    update.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    update.addOutput({ satoshis: 1, lockingScript: buildLockingScript(updateState, lockKey) })
    update.addOutput({ satoshis: 9_000, lockingScript: anyone })
    update.inputs[0].unlockingScript = unlockDppOutput(update, 0, custodianPriv)
    const second = await node.engine.submit({ beef: update.toBEEF(), topics: ['tm_dpp'] })
    expect(second.tm_dpp.outputsToAdmit).toEqual([0])
    expect(second.tm_dpp.coinsToRetain).toEqual([0])

    // The same lineage by its token, by its passport identifier and by its data carrier.
    for (const query of [{ tokenId }, { passportId }, { uid: 'ENGINE-V3-UID-1' }]) {
      const answer = await node.engine.lookup({ service: 'ls_dpp', query })
      if (answer.type !== 'output-list') throw new Error('expected an output list')
      expect(answer.outputs, JSON.stringify(query)).toHaveLength(2)
      const beef = new Beef()
      for (const output of answer.outputs) beef.mergeBeef(output.beef)
      const chain = chainFromBeef(beef, passportId)
      const result = await verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: CUSTODIAN })
      expect(result.valid).toBe(true)
      expect(result.states.map((s) => s.op)).toEqual(['ISSUE', 'UPDATE'])
    }
    expect((await node.records.findByTokenId(tokenId)).map((r) => r.txid)).toEqual([genesis.id('hex'), update.id('hex')])
    expect((await node.records.findByPassport(passportId)).every((r) => r.tokenId === tokenId)).toBe(true)
  })
})

/** The lookup service records a carried state by its token, and an uncarried one by none. */
describe('ls_dpp with a version 3 state', () => {
  it('indexes the fixture genesis and its successor under the lineage token id', async () => {
    const records = new InMemoryDppStorage()
    const ls = new DppLookupService(records)
    for (const [i, raw] of v3Raw.slice(0, 2).entries()) {
      const tx = Transaction.fromHex(raw)
      await ls.outputAdmittedByTopic({ mode: 'locking-script', txid: tx.id('hex'), outputIndex: v3Indexes[i], topic: 'tm_dpp', satoshis: 1, lockingScript: tx.outputs[v3Indexes[i]].lockingScript })
    }
    const found = await ls.lookup({ service: 'ls_dpp', query: { tokenId: V3.tokenId } })
    expect(found).toEqual([
      { txid: V3.states[0].txid, outputIndex: 0 },
      { txid: V3.states[1].txid, outputIndex: 0 },
    ])
    expect((await records.findByPassport(V3.states[0].data.passportId)).map((r) => r.tokenId)).toEqual([V3.tokenId, V3.tokenId])
  })

  it('stores no token id for a version 2 state, which no token id query answers', async () => {
    const records = new InMemoryDppStorage()
    const ls = new DppLookupService(records)
    const tx = Transaction.fromHex(V2.states[0].rawTx)
    await ls.outputAdmittedByTopic({ mode: 'locking-script', txid: tx.id('hex'), outputIndex: 0, topic: 'tm_dpp', satoshis: 1, lockingScript: tx.outputs[0].lockingScript })
    const [record] = await records.findByPassport(V2.states[0].data.passportId)
    expect(record.tokenId).toBeUndefined()
    expect(await ls.lookup({ service: 'ls_dpp', query: { tokenId: `${tx.id('hex')}_0` } })).toEqual([])
  })
})
