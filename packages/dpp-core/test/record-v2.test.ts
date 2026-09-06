import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, LockingScript, ProtoWallet, Utils } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID_V2,
  FIELD_COUNT_V2,
  FieldV2,
  RECORD_V2_ACTOR_TAG,
  RECORD_V2_PUBLISHER_TAG,
  actorPreimageV2,
  buildLockingScript,
  completeState,
  dataFieldsV2,
  fieldsToState,
  parseDppOutput,
  publisherPreimageV2,
  tryParseDppOutput,
  verifyServerSignature,
  verifyUserSignature,
  type DppStateDataV2,
} from '../src/index.js'
import { custodianPriv, issuerPriv } from './helpers-v2.js'

/**
 * The record-v2 fixture is the wire contract for one version 2 output. These
 * tests read the published JSON the way an external implementation does and
 * rebuild every pinned byte from `state` and the test keys, so a change to a
 * field, the framing, a tag or a derivation goes red with a diff instead of
 * quietly forking the format.
 */
const F = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'record-v2.json'), 'utf8'))
const data = F.state as DppStateDataV2

/** The framing rule stated independently of `frameFields`: VarInt length then bytes, for each item. */
function frame(items: number[][]): number[] {
  const out: number[] = []
  for (const item of items) {
    const n = item.length
    if (n < 0xfd) out.push(n)
    else if (n <= 0xffff) out.push(0xfd, n & 0xff, n >> 8)
    else out.push(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff)
    out.push(...item)
  }
  return out
}

describe('record-v2 fixture: the writer reproduces every byte', () => {
  it('pins the test keys to their private halves and the tags', () => {
    expect(issuerPriv.toPublicKey().toString()).toBe(F.issuerKey)
    expect(custodianPriv.toPublicKey().toString()).toBe(F.custodianKey)
    expect(F.actorTag).toBe(RECORD_V2_ACTOR_TAG)
    expect(F.publisherTag).toBe(RECORD_V2_PUBLISHER_TAG)
    expect(F.protocol).toEqual(DPP_PROTOCOL_ID_V2)
  })

  it('pins both preimages, and they are the framed tag and fields', () => {
    const fields = dataFieldsV2(data)
    expect(fields).toHaveLength(15)
    expect(Utils.toHex(actorPreimageV2(data))).toBe(F.actorPreimage)
    expect(Utils.toHex(frame([Utils.toArray(RECORD_V2_ACTOR_TAG, 'utf8'), ...fields]))).toBe(F.actorPreimage)
    const actorSignature = Utils.toArray(F.actorSignature, 'hex')
    expect(Utils.toHex(publisherPreimageV2(data, actorSignature))).toBe(F.publisherPreimage)
    expect(Utils.toHex(frame([Utils.toArray(RECORD_V2_PUBLISHER_TAG, 'utf8'), ...fields, actorSignature]))).toBe(F.publisherPreimage)
  })

  it('pins both signatures: RFC 6979 makes them reproducible', async () => {
    const state = await completeState(data, new ProtoWallet(issuerPriv), new ProtoWallet(custodianPriv))
    expect(Utils.toHex(state.userSignature)).toBe(F.actorSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(F.publisherSignature)
  })

  it('pins both verification keys, re-derived from on-chain data alone under the version 2 protocol', () => {
    const anyone = new CachedKeyDeriver('anyone')
    expect(anyone.derivePublicKey(DPP_PROTOCOL_ID_V2, data.actorKeyId, F.issuerKey).toString()).toBe(F.actorVerificationKey)
    expect(anyone.derivePublicKey(DPP_PROTOCOL_ID_V2, data.passportId, F.custodianKey).toString()).toBe(F.publisherVerificationKey)
  })

  it('pins the whole locking script: seventeen pushes, eight OP_2DROP and one OP_DROP', async () => {
    const state = await completeState(data, new ProtoWallet(issuerPriv), new ProtoWallet(custodianPriv))
    const script = buildLockingScript(state, F.lockingKey)
    expect(script.toHex()).toBe(F.lockingScript)
    const ops = script.chunks.map((c) => c.op)
    expect(ops.slice(2 + FIELD_COUNT_V2)).toEqual([...Array(8).fill(0x6d), 0x75])
  })
})

describe('record-v2 fixture: the reader accepts it and verifies it', () => {
  const parsed = parseDppOutput(LockingScript.fromHex(F.lockingScript))

  it('parses back to the posted state, signatures included, as version 2', () => {
    expect(parsed.state.version).toBe('2')
    expect(parsed.state).toEqual({
      ...data,
      protocolMarker: 'dpp',
      userSignature: Utils.toArray(F.actorSignature, 'hex'),
      serverSignature: Utils.toArray(F.publisherSignature, 'hex'),
    })
    expect(parsed.lockingPublicKey.toString()).toBe(F.lockingKey)
  })

  it('verifies both signatures under the version 2 protocol and preimages', () => {
    expect(verifyUserSignature(parsed.state)).toBe(true)
    expect(verifyServerSignature(parsed.state, F.custodianKey)).toBe(true)
  })

  it('reads the field indices the constants name', () => {
    expect(FieldV2.actorSignature).toBe(15)
    expect(FieldV2.publisherSignature).toBe(16)
    expect(FieldV2.authorisationCommitment).toBe(14)
  })
})

describe('record-v2 fixture: the reader refuses what it must', () => {
  it.each((F.refusals as Array<{ name: string; reason: string; lockingScript: string }>).map((r) => [r.name, r] as const))('refuses %s', (_name, r) => {
    expect(tryParseDppOutput(LockingScript.fromHex(r.lockingScript))).toBeNull()
    expect(() => parseDppOutput(LockingScript.fromHex(r.lockingScript))).toThrow(r.reason)
  })

  it('the version 1 field reader refuses the version 2 string by name', () => {
    const fields = LockingScript.fromHex(F.refusals.find((r: { name: string }) => r.name === 'v1LayoutWithVersion2').lockingScript).chunks.slice(2, 16).map((c) => c.data ?? [])
    expect(() => fieldsToState(fields)).toThrow('17-field layout')
  })

  it('control: every refusal vector differs from the accepted script and from each other', () => {
    const all = (F.refusals as Array<{ lockingScript: string }>).map((r) => r.lockingScript)
    expect(new Set(all).size).toBe(all.length)
    for (const hex of all) expect(hex).not.toBe(F.lockingScript)
  })
})
