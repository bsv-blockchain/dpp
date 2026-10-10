import { describe, expect, it } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import {
  DidFormatError,
  completeState,
  didKeyFromIdentityKey,
  identityKeyFromDidKey,
  signingDidFor,
  signingPublicKeyFor,
  verifyUserSignature,
} from '../src/index.js'
import { makeData, makerWallet, serverWallet } from './helpers.js'

/**
 * `did:key` is a re-encoding, so most of what these assert is that it is exactly
 * that: the same bytes, reversibly, with no third party involved.
 *
 * The test that matters is the last one. The standard's claim (`spec/identity.md`)
 * is that a token signature
 * and an SD-JWT attestation are provably the same actor, and the only thing
 * standing between them is a BRC-42 step that nothing in `@bsv/did` performs.
 * `signingPublicKeyFor` is that step, so it is pinned against the verifier itself
 * rather than against a fixture: if the two ever disagree, the DID a verifier
 * resolves stops matching the key that signed, and nothing else would notice.
 */

const KEY = PrivateKey.fromHex('11'.repeat(32)).toPublicKey().toString()

describe('did:key for an identity key', () => {
  it('round-trips the exact bytes', () => {
    expect(identityKeyFromDidKey(didKeyFromIdentityKey(KEY))).toBe(KEY)
  })

  it('is the multicodec form, so it reads as secp256k1 to anyone else', () => {
    // 0xe7 0x01 in base58btc always lands on this prefix; it is how a reader tells
    // this curve from Ed25519 without decoding.
    expect(didKeyFromIdentityKey(KEY).startsWith('did:key:zQ3s')).toBe(true)
  })

  it('is stable: the same key is always the same DID', () => {
    expect(didKeyFromIdentityKey(KEY)).toBe(didKeyFromIdentityKey(KEY))
  })

  it('refuses a key that is not canonically encoded', () => {
    // The SDK reduces x >= p rather than refusing, so a non-canonical encoding
    // would mint a DID for a key that appears nowhere on chain.
    expect(() => didKeyFromIdentityKey('02' + 'ff'.repeat(32))).toThrow(DidFormatError)
  })

  it('refuses another curve rather than returning meaningless bytes', () => {
    // A well-formed Ed25519 did:key, which is two bytes different at the front.
    expect(() => identityKeyFromDidKey('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')).toThrow(
      DidFormatError
    )
  })

  it('refuses a DID it cannot read at all', () => {
    expect(() => identityKeyFromDidKey('did:web:example.com')).toThrow(DidFormatError)
    expect(() => identityKeyFromDidKey('did:key:zNOTBASE58!!')).toThrow(DidFormatError)
  })
})

describe('the step from a DID back to a signature (spec/identity.md §2)', () => {
  it('names the key that actually signed, not the actor it belongs to', async () => {
    const data = makeData()
    const state = await completeState(data, makerWallet, serverWallet)

    expect(verifyUserSignature(state)).toBe(true)

    const signer = signingPublicKeyFor(state)
    // The parent is on chain in field 7; the signer is its BRC-42 child. Two
    // different keys, and the difference is the whole point of this function.
    expect(signer).not.toBe(state.actorIdentityKey)
    expect(signingDidFor(state)).toBe(didKeyFromIdentityKey(signer))
  })

  it('derives the same key the verifier does, with no wallet and no secret', async () => {
    const state = await completeState(makeData(), makerWallet, serverWallet)
    const { PublicKey, Signature } = await import('@bsv/sdk')
    const { userPreimage } = await import('../src/index.js')

    // What a stranger would do: take the DID, decode it, verify the signature.
    const fromDid = identityKeyFromDidKey(signingDidFor(state))
    const verified = PublicKey.fromString(fromDid).verify(
      userPreimage(state),
      Signature.fromDER(state.userSignature)
    )
    expect(verified).toBe(true)
  })

  it('changes with the keyID, because the child does', async () => {
    const a = await completeState(makeData(), makerWallet, serverWallet)
    const b = await completeState(makeData({ actorKeyId: 'someone-else' }), makerWallet, serverWallet)
    expect(signingDidFor(a)).not.toBe(signingDidFor(b))
  })
})
