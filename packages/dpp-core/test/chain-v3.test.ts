import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, ProtoWallet, PublicKey, Transaction, Utils } from '@bsv/sdk'
import {
  completeState,
  inspectChain,
  linkageReasonCode,
  tokenIdOf,
  verifyChain,
  verifyOwnerLinkage,
  type DppStateDataV3,
} from '../src/index.js'
import { custodianPriv, idKey, issuerPriv, recipientPriv, strangerPriv } from './helpers-v2.js'
import { stateTxV3 } from './helpers-v3.js'

/**
 * The chain-v3 fixture is the wire contract for a carried lineage: the deploy
 * at output 0, every later state a value output naming the genesis, the
 * version 2 chain rules under the version 3 protocol, retirement and the
 * carrier's own refusals. These tests read the published JSON the way an
 * external reader does: every valid transaction is rebuilt from
 * `states[].data` and the test keys, and every refusal is refused from raw
 * hex alone.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')
const F = JSON.parse(readFileSync(join(FIXTURES, 'chain-v3.json'), 'utf8'))
const raw: string[] = F.states.map((s: { rawTx: string }) => s.rawTx)
const fromHex = (hexes: string[]) => hexes.map((h) => Transaction.fromHex(h))
const prefixPlus = (r: { appendAfter: number; rawTx: string }) => [...raw.slice(0, r.appendAfter + 1), r.rawTx]

describe('chain-v3 fixture: the writer reproduces every byte', () => {
  it('pins the cast, the controller keys, the linkage scalars and the token id', () => {
    expect(idKey(issuerPriv)).toBe(F.issuerKey)
    expect(idKey(custodianPriv)).toBe(F.custodianKey)
    expect(idKey(recipientPriv)).toBe(F.recipientKey)
    expect(idKey(strangerPriv)).toBe(F.strangerKey)
    expect(verifyOwnerLinkage(F.issuerKey, F.issuerControllerKey, F.issuerControlLinkage)).toBe(true)
    expect(verifyOwnerLinkage(F.recipientKey, F.recipientControllerKey, F.recipientControlLinkage)).toBe(true)
    expect(F.lineageGenesis).toEqual({ txid: F.states[0].txid, outputIndex: 0 })
    expect(F.tokenId).toBe(tokenIdOf(F.lineageGenesis))
    expect(F.tokenIdWire).toBe(Utils.toHex(Utils.toArray(F.states[0].txid, 'hex').reverse()))
    expect(F.states.map((s: { prefix: { role: string } }) => s.prefix.role)).toEqual(['deploy', 'value', 'value', 'value', 'value'])
    expect(F.states.slice(1).every((s: { prefix: { tokenId: string } }) => s.prefix.tokenId === F.tokenId)).toBe(true)
  })

  it('rebuilds every state, signature, prefix, script, transaction and identifier from the data and the keys', async () => {
    const wallets: Record<string, ProtoWallet> = {
      issuer: new ProtoWallet(issuerPriv),
      recipient: new ProtoWallet(recipientPriv),
      'recipient-controller': new ProtoWallet(new CachedKeyDeriver(recipientPriv).derivePrivateKey(F.ownerProtocol, F.states[0].data.passportId, 'self')),
    }
    const custodian = new ProtoWallet(custodianPriv)
    const txs: Transaction[] = []
    for (const [i, s] of F.states.entries()) {
      const state = await completeState(s.data as DppStateDataV3, wallets[s.actor], custodian)
      expect(Utils.toHex(state.userSignature)).toBe(s.actorSignature)
      expect(Utils.toHex(state.serverSignature)).toBe(s.publisherSignature)
      const prev = i === 0 ? undefined : { tx: txs[i - 1], outputIndex: F.states[i - 1].outputIndex }
      const tx = stateTxV3(state, PublicKey.fromString(s.lockingKey), prev, { opReturnFirst: s.outputIndex === 1 })
      expect(tx.outputs[s.outputIndex].lockingScript.toHex()).toBe(s.lockingScript)
      expect(tx.toHex()).toBe(s.rawTx)
      expect(tx.id('hex')).toBe(s.txid)
      txs.push(tx)
    }
    expect(F.states.map((s: { data: { op: string } }) => s.data.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER', 'UPDATE', 'RETIRE'])
    expect(F.states.map((s: { outputIndex: number }) => s.outputIndex)).toEqual([0, 0, 1, 0, 0])
  })
})

describe('chain-v3 fixture: the reader accepts the lineage and verifies it', () => {
  it('verifies from raw hex alone, every state carrying the token id, control proven on every non-genesis state', async () => {
    const inspection = await inspectChain(fromHex(raw), { chainTracker: 'scripts only' })
    expect(inspection.failure).toBeUndefined()
    expect(inspection.complete).toBe(true)
    expect(inspection.states.map((s) => s.version)).toEqual(['3', '3', '3', '3', '3'])
    expect(inspection.states.map((s) => s.tokenId)).toEqual(Array<string>(5).fill(F.tokenId))
    expect(inspection.states.map((s) => s.controlValid)).toEqual([null, true, true, true, true])
    expect(inspection.states.every((s) => s.ownerConsentValid === null)).toBe(true)
  })

  it('verifies every publisher signature against the custodian key', async () => {
    const result = await verifyChain(fromHex(raw), { chainTracker: 'scripts only', serverIdentityKey: F.custodianKey })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
  })
})

describe('chain-v3 fixture: the reader refuses every broken link', () => {
  it.each(F.refusals.map((r: { name: string }) => [r.name, r] as const))('refuses %s', async (_name, r: { appendAfter: number; rawTx: string; error: string }) => {
    const result = await verifyChain(fromHex(prefixPlus(r)), { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
  })

  it('names the carrier refusals by their shared reason codes', () => {
    expect(linkageReasonCode('a genesis is a deploy at output 0')).toBe('carrier-prefix-invalid')
    expect(linkageReasonCode('a genesis carries an empty token id')).toBe('carrier-prefix-invalid')
    expect(linkageReasonCode('a state after genesis carries the lineage token id')).toBe('carrier-prefix-invalid')
    expect(linkageReasonCode('the token id names the lineage genesis')).toBe('token-id-mismatch')
    expect(linkageReasonCode('the lineage is retired: no state may follow RETIRE')).toBe('lineage-retired')
  })

  it('the burn: the tip spent with no carrier output is no state at all', async () => {
    const result = await verifyChain(fromHex([...raw.slice(0, F.burn.appendAfter + 1), F.burn.rawTx]), { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(F.burn.error)
    expect(result.states).toHaveLength(F.burn.appendAfter + 1)
  })

  it('control: every refusal transaction differs from the valid ones and from each other', () => {
    const all = (F.refusals as Array<{ rawTx: string }>).map((r) => r.rawTx)
    expect(new Set(all).size).toBe(all.length)
    for (const hex of all) expect(raw).not.toContain(hex)
  })
})
