import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, LockingScript, ProtoWallet, Utils } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID,
  buildLockingScript,
  completeState,
  ownerBlobHash,
  parseDppOutput,
  serverPreimage,
  tryParseDppOutput,
  userPreimage,
  verifyServerSignature,
  verifyUserSignature,
  type DppStateData,
} from '../src/index.js'
import { makerPriv, owner1Priv, serverPriv } from './helpers.js'
import { RECORD_V1_FIXTURE as F } from './record-v1-fixture.js'

/**
 * The record-v1 fixture is the wire contract with every implementation that
 * cannot import this package (they vendor the copy in bsv-blockchain/dpp,
 * fixtures/record-v1.json, regenerated verbatim from the module here). These
 * tests rebuild every pinned byte from `state` and the test keys, so a change
 * to field order, a preimage, a derivation or a validation rule goes red with
 * a diff instead of quietly forking the format.
 */

const data: DppStateData = { ...F.state }

describe('record-v1 fixture: the writer reproduces every byte', () => {
  it('pins the test keys to their private halves', () => {
    expect(makerPriv.toPublicKey().toString()).toBe(F.actorKey)
    expect(serverPriv.toPublicKey().toString()).toBe(F.serverKey)
    expect(owner1Priv.toPublicKey().toString()).toBe(F.ownerKey)
  })

  it('pins the owner-tier binding: the blob hashes to field 11', () => {
    expect(ownerBlobHash(Utils.toArray(F.ownerBlob, 'hex'))).toBe(F.state.payloadOwnerHash)
  })

  it('pins both preimages', () => {
    expect(Utils.toHex(userPreimage(data))).toBe(F.userPreimage)
    expect(
      Utils.toHex(serverPreimage(data, Utils.toArray(F.userSignature, 'hex')))
    ).toBe(F.serverPreimage)
  })

  it('pins both signatures: RFC 6979 makes them reproducible', async () => {
    const state = await completeState(
      data,
      new ProtoWallet(makerPriv),
      new ProtoWallet(serverPriv)
    )
    expect(Utils.toHex(state.userSignature)).toBe(F.userSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(F.serverSignature)
  })

  it('pins both verification keys, re-derived from on-chain data alone', () => {
    const anyone = new CachedKeyDeriver('anyone')
    expect(
      anyone.derivePublicKey(DPP_PROTOCOL_ID, F.state.actorKeyId, F.actorKey).toString()
    ).toBe(F.userVerificationKey)
    expect(
      anyone.derivePublicKey(DPP_PROTOCOL_ID, F.state.passportId, F.serverKey).toString()
    ).toBe(F.serverVerificationKey)
  })

  it('pins the whole locking script', async () => {
    const state = await completeState(
      data,
      new ProtoWallet(makerPriv),
      new ProtoWallet(serverPriv)
    )
    expect(buildLockingScript(state, F.lockingKey).toHex()).toBe(F.lockingScript)
  })
})

describe('record-v1 fixture: the reader accepts it and verifies it', () => {
  const parsed = parseDppOutput(LockingScript.fromHex(F.lockingScript))

  it('parses back to the posted state, signatures included', () => {
    expect(parsed.state).toEqual({
      ...F.state,
      protocolMarker: 'dpp',
      version: '1',
      userSignature: Utils.toArray(F.userSignature, 'hex'),
      serverSignature: Utils.toArray(F.serverSignature, 'hex'),
    })
    expect(parsed.lockingPublicKey.toString()).toBe(F.lockingKey)
  })

  it('verifies both signatures', () => {
    expect(verifyUserSignature(parsed.state)).toBe(true)
    expect(verifyServerSignature(parsed.state, F.serverKey)).toBe(true)
  })
})

describe('record-v1 fixture: the reader refuses what it must', () => {
  it.each([
    ['uncompressedKey', F.uncompressedKey],
    ['malformedTail: one drop short', F.malformedTail[0]],
    ['malformedTail: right drop total, wrong opcodes', F.malformedTail[1]],
    ['malformedTail: trailing chunk after a correct tail', F.malformedTail[2]],
    ['rolledTimestamp', F.rolledTimestamp],
    ['mangledUtf8', F.mangledUtf8],
    ['nulPassportId', F.nulPassportId],
    ['emptyPushdata', F.emptyPushdata],
  ])('refuses %s', (_name, hex) => {
    expect(tryParseDppOutput(LockingScript.fromHex(hex))).toBeNull()
  })

  it('control: every refusal vector differs from the accepted script', () => {
    const all = [
      F.uncompressedKey,
      ...F.malformedTail,
      F.rolledTimestamp,
      F.mangledUtf8,
      F.nulPassportId,
      F.emptyPushdata,
    ]
    expect(new Set(all).size).toBe(all.length)
    for (const hex of all) expect(hex).not.toBe(F.lockingScript)
  })
})
