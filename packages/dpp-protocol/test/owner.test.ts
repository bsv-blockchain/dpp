import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, ProtoWallet } from '@bsv/sdk'
import {
  OWNER_LINKAGE_REVELATION_PROTOCOL_ID,
  OWNER_PROTOCOL_ID,
  decryptOwnerLinkage,
  normaliseControlAuthorities,
  ownerKeyFor,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  revealOwnerLinkage,
  verifyOwnerLinkage,
} from '../src/index.js'
import {
  PASSPORT_ID,
  idKey,
  makerPriv,
  owner2Priv,
  owner3Deriver,
  owner3Priv,
  owner3Wallet,
  serverPriv,
  serverWallet,
} from './helpers.js'

/**
 * `spec/custody.md` §2 and `spec/record-model-v2.md` §6 in code: the owner key
 * is one derivation from a BRC-100 root, the linkage scalar of the control
 * proof is what the wallet reveals, and the verifier mirrors the SDK's
 * derivation exactly.
 */
const owner3Key = idKey(owner3Priv)
const owner3OwnerKey = ownerKeyFromDeriver(PASSPORT_ID, owner3Deriver)
const owner3Linkage = ownerLinkageFromDeriver(PASSPORT_ID, owner3Deriver)

describe('the owner key (custody.md §2)', () => {
  it('is what a BRC-100 wallet returns for getPublicKey under the owner protocol, counterparty self', async () => {
    expect(await ownerKeyFor(PASSPORT_ID, owner3Wallet)).toBe(owner3OwnerKey)
    expect(OWNER_PROTOCOL_ID).toEqual([1, 'dpp owner v1'])
  })

  it('is the same key whichever side of the self derivation computes it', () => {
    const fromPrivate = owner3Deriver.derivePrivateKey(OWNER_PROTOCOL_ID, PASSPORT_ID, 'self').toPublicKey().toString()
    expect(fromPrivate).toBe(owner3OwnerKey)
    expect(owner3OwnerKey).not.toBe(owner3Key)
  })

  it('differs per passport and per root', () => {
    expect(ownerKeyFromDeriver(PASSPORT_ID + '/other', owner3Deriver)).not.toBe(owner3OwnerKey)
    expect(ownerKeyFromDeriver(PASSPORT_ID, new CachedKeyDeriver(owner2Priv))).not.toBe(owner3OwnerKey)
  })
})

describe('the linkage scalar (record-model-v2.md §6)', () => {
  it('links the root to the owner key: ownerKey = root + s·G', () => {
    expect(owner3Linkage).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyOwnerLinkage(owner3Key, owner3OwnerKey, owner3Linkage)).toBe(true)
  })

  it('proves nothing for another root, another passport or another spelling', () => {
    expect(verifyOwnerLinkage(idKey(owner2Priv), owner3OwnerKey, owner3Linkage)).toBe(false)
    expect(verifyOwnerLinkage(owner3Key, ownerKeyFromDeriver(PASSPORT_ID + '/other', owner3Deriver), owner3Linkage)).toBe(false)
    expect(verifyOwnerLinkage(owner3Key, owner3OwnerKey, owner3Linkage.toUpperCase())).toBe(false)
    expect(verifyOwnerLinkage(owner3Key, owner3OwnerKey, owner3Linkage.slice(1))).toBe(false)
    expect(verifyOwnerLinkage(owner3Key, owner3OwnerKey, owner3Linkage + '0')).toBe(false)
  })

  it('never throws: an unparseable or non-canonical key is a false', () => {
    expect(verifyOwnerLinkage('not a key', owner3OwnerKey, owner3Linkage)).toBe(false)
    expect(verifyOwnerLinkage(owner3Key.toUpperCase(), owner3OwnerKey, owner3Linkage)).toBe(false)
    expect(verifyOwnerLinkage(owner3Key, 'zz', owner3Linkage)).toBe(false)
  })

  it('is what the BRC-100 revelation yields once the verifier decrypts it', async () => {
    const revelation = await revealOwnerLinkage(PASSPORT_ID, owner3Wallet, idKey(serverPriv))
    expect(revelation.protocolID).toEqual(OWNER_PROTOCOL_ID)
    expect(revelation.keyID).toBe(PASSPORT_ID)
    expect(revelation.prover).toBe(owner3Key)
    expect(revelation.verifier).toBe(idKey(serverPriv))
    expect(await decryptOwnerLinkage(revelation, serverWallet)).toBe(owner3Linkage)
    expect(OWNER_LINKAGE_REVELATION_PROTOCOL_ID).toEqual([2, 'specific linkage revelation 1 dpp owner v1'])
  })

  it('can be revealed to oneself and to any other wallet', async () => {
    const toSelf = await revealOwnerLinkage(PASSPORT_ID, owner3Wallet, owner3Key)
    expect(await decryptOwnerLinkage(toSelf, owner3Wallet)).toBe(owner3Linkage)
    const toMaker = await revealOwnerLinkage(PASSPORT_ID, owner3Wallet, idKey(makerPriv))
    expect(await decryptOwnerLinkage(toMaker, new ProtoWallet(makerPriv))).toBe(owner3Linkage)
    await expect(decryptOwnerLinkage(toMaker, serverWallet)).rejects.toThrow()
  })
})

describe('control authorities', () => {
  it('are normalised to the canonical lower-case spelling fields carry', () => {
    expect(normaliseControlAuthorities([idKey(makerPriv).toUpperCase()])).toEqual([idKey(makerPriv)])
    expect(normaliseControlAuthorities([])).toEqual([])
  })

  it('refuse anything that is not a canonical compressed key, loudly', () => {
    expect(() => normaliseControlAuthorities(['nope'])).toThrow('not a valid public key')
    expect(() => normaliseControlAuthorities([makerPriv.toPublicKey().toDER('hex') as string])).not.toThrow()
    expect(() => normaliseControlAuthorities([makerPriv.toPublicKey().toString().slice(2)])).toThrow()
  })
})
