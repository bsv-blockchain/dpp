import { describe, expect, it } from 'vitest'
import { PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import {
  completeState,
  createUserSignature,
  serverPreimage,
  userPreimage,
  verifyServerSignature,
  verifyUserSignature,
} from '../src/index.js'
import {
  idKey,
  makeData,
  makerWallet,
  serverPriv,
  serverWallet,
} from './helpers.js'

describe('canonical preimage (record-model §5)', () => {
  it('server preimage is the user preimage followed by the user signature bytes', () => {
    const d = makeData()
    const sig = [48, 1, 2]
    expect(serverPreimage(d, sig)).toEqual([...userPreimage(d), ...sig])
  })

  it('is byte-exact: any field change changes the preimage', () => {
    const base = userPreimage(makeData())
    const changed = userPreimage(makeData({ timestamp: '2026-06-11T12:00:01Z' }))
    expect(changed).not.toEqual(base)
  })
})

describe('signature create/verify', () => {
  it('verifies a complete state signed via ProtoWallet', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    expect(verifyUserSignature(state)).toBe(true)
    expect(verifyServerSignature(state, idKey(serverPriv))).toBe(true)
  })

  it('matches raw BRC-42 derivation: identityKey.deriveChild(anyone, invoice)', async () => {
    const d = makeData()
    const sig = await createUserSignature(d, makerWallet)
    const signingPub = PublicKey.fromString(d.actorIdentityKey).deriveChild(
      new PrivateKey(1),
      `1-dpp token v1-${d.actorKeyId}`
    )
    expect(signingPub.verify(userPreimage(d), Signature.fromDER(sig))).toBe(true)
  })

  it('rejects a tampered field', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    const tampered = {
      ...state,
      payloadPublic: state.payloadPublic.replace('82', '99'),
    }
    expect(verifyUserSignature(tampered)).toBe(false)
  })

  it('rejects a signature under a different keyID', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    expect(verifyUserSignature({ ...state, actorKeyId: 'maker batch 2' })).toBe(false)
  })

  it('rejects a server signature checked against the wrong service key', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    expect(verifyServerSignature(state, idKey(PrivateKey.fromHex('55'.repeat(32))))).toBe(false)
  })

  it('rejects tampering with the user signature under the server signature', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    const otherUserSig = await createUserSignature(
      makeData({ timestamp: '2026-06-11T12:00:01Z' }),
      makerWallet
    )
    expect(
      verifyServerSignature({ ...state, userSignature: otherUserSig }, idKey(serverPriv))
    ).toBe(false)
  })

  it('returns false (not throws) on garbage DER', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    expect(verifyUserSignature({ ...state, userSignature: [1, 2, 3] })).toBe(false)
  })
})
