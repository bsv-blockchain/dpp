import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, LockingScript, OP, ProtoWallet, Utils } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID_V3,
  FIELD_COUNT_V3,
  RECORD_V3_ACTOR_TAG,
  RECORD_V3_PUBLISHER_TAG,
  actorPreimageV3,
  buildLockingScript,
  completeState,
  dataFieldsV2,
  parseDppOutput,
  publisherPreimageV3,
  tokenIdWireBytes,
  tryParseDppOutput,
  verifyServerSignature,
  verifyUserSignature,
  type DppStateDataV3,
} from '../src/index.js'
import { custodianPriv, issuerPriv } from './helpers-v2.js'

/**
 * The record-v3 fixture is the wire contract for one carried output of each
 * role. These tests read the published JSON the way an external
 * implementation does and rebuild every pinned byte from `state` and the test
 * keys: the prefix, the framed preimages under the version 3 tags, both
 * signatures, both verification keys and the whole locking script.
 */
const F = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'record-v3.json'), 'utf8'))

describe('record-v3 fixture: the writer reproduces every byte', () => {
  it('pins the test keys, the tags and the protocol', () => {
    expect(issuerPriv.toPublicKey().toString()).toBe(F.issuerKey)
    expect(custodianPriv.toPublicKey().toString()).toBe(F.custodianKey)
    expect(F.actorTag).toBe(RECORD_V3_ACTOR_TAG)
    expect(F.publisherTag).toBe(RECORD_V3_PUBLISHER_TAG)
    expect(F.protocol).toEqual(DPP_PROTOCOL_ID_V3)
  })

  it.each([['genesis'], ['value']] as const)('%s: pins both preimages, signatures and verification keys under the version 3 protocol', async (role) => {
    const R = F[role]
    const data = R.state as DppStateDataV3
    expect(data.version).toBe('3')
    expect(dataFieldsV2(data)).toHaveLength(15)
    expect(Utils.toHex(actorPreimageV3(data))).toBe(R.actorPreimage)
    const state = await completeState(data, new ProtoWallet(issuerPriv), new ProtoWallet(custodianPriv))
    expect(Utils.toHex(state.userSignature)).toBe(R.actorSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(R.publisherSignature)
    expect(Utils.toHex(publisherPreimageV3(data, state.userSignature))).toBe(R.publisherPreimage)
    const anyone = new CachedKeyDeriver('anyone')
    expect(anyone.derivePublicKey(DPP_PROTOCOL_ID_V3, data.actorKeyId, F.issuerKey).toString()).toBe(R.actorVerificationKey)
    expect(anyone.derivePublicKey(DPP_PROTOCOL_ID_V3, data.passportId, F.custodianKey).toString()).toBe(R.publisherVerificationKey)
    expect(buildLockingScript(state, F.lockingKey).toHex()).toBe(R.lockingScript)
  })

  it('the genesis is carried behind OP_0 OP_1 OP_2DROP and the value output behind the 32-byte token id in internal order', () => {
    const genesis = LockingScript.fromHex(F.genesis.lockingScript).chunks
    expect(genesis.slice(0, 3).map((c) => c.op)).toEqual([0, OP.OP_1, OP.OP_2DROP])
    expect(genesis[3].data).toHaveLength(33)
    expect(genesis[4].op).toBe(OP.OP_CHECKSIG)
    const value = LockingScript.fromHex(F.value.lockingScript).chunks
    expect(value[0].data).toEqual(tokenIdWireBytes(F.genesis.txid))
    expect(Utils.toHex(value[0].data!)).toBe(F.genesis.tokenIdWire)
    expect(value.slice(1, 3).map((c) => c.op)).toEqual([OP.OP_1, OP.OP_2DROP])
    expect(F.value.tokenId).toBe(`${F.genesis.txid}_0`)
    expect(F.value.state.lineageGenesis).toEqual({ txid: F.genesis.txid, outputIndex: 0 })
    // Seventeen pushes, eight OP_2DROP and one OP_DROP after the prefix and the key.
    expect(value.slice(5, 5 + FIELD_COUNT_V3)).toHaveLength(FIELD_COUNT_V3)
    expect(value.slice(5 + FIELD_COUNT_V3).map((c) => c.op)).toEqual([...Array<number>(8).fill(OP.OP_2DROP), OP.OP_DROP])
  })
})

describe('record-v3 fixture: the reader accepts the carried outputs and verifies them', () => {
  it.each([['genesis', 'deploy', null], ['value', 'value', 'tokenId']] as const)('%s decodes to its prefix and state', (role, expectedRole, tokenIdKey) => {
    const parsed = parseDppOutput(LockingScript.fromHex(F[role].lockingScript))
    expect(parsed.carrier).toEqual({ role: expectedRole, tokenId: tokenIdKey == null ? null : F.genesis.txid })
    expect(parsed.state.version).toBe('3')
    expect(parsed.lockingPublicKey.toString()).toBe(F.lockingKey)
    expect(verifyUserSignature(parsed.state)).toBe(true)
    expect(verifyServerSignature(parsed.state, F.custodianKey)).toBe(true)
    expect(verifyServerSignature(parsed.state, F.issuerKey)).toBe(false)
  })

  it.each((F.accepted as Array<{ name: string; lockingScript: string }>).map((a) => [a.name, a] as const))('accepts %s', (_name, a) => {
    const parsed = parseDppOutput(LockingScript.fromHex(a.lockingScript))
    expect(parsed.carrier).toEqual({ role: 'deploy', tokenId: null })
    expect(parsed.state).toMatchObject(F.genesis.state)
  })
})

describe('record-v3 fixture: the reader refuses what it must', () => {
  it.each((F.refusals as Array<{ name: string; reason: string; lockingScript: string }>).map((r) => [r.name, r] as const))('refuses %s', (_name, r) => {
    expect(tryParseDppOutput(LockingScript.fromHex(r.lockingScript))).toBeNull()
    expect(() => parseDppOutput(LockingScript.fromHex(r.lockingScript))).toThrow(r.reason)
  })

  it('control: every refusal vector differs from the accepted scripts and from each other', () => {
    const all = (F.refusals as Array<{ lockingScript: string }>).map((r) => r.lockingScript)
    expect(new Set(all).size).toBe(all.length)
    for (const hex of all) {
      expect(hex).not.toBe(F.genesis.lockingScript)
      expect(hex).not.toBe(F.value.lockingScript)
    }
  })
})
