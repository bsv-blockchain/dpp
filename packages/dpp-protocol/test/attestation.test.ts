import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Hash, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { canonicalBytes, lifecycleClaimBytes, lifecycleClaimDigest, signLifecycleClaim, verifyLifecycleClaim, type LifecycleClaim } from '../src/index.js'

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
const wallet = new ProtoWallet(PrivateKey.fromHex(fixture.issuerPrivateKey))

describe('native lifecycle claim v1', () => {
  it('verifies the independently generated portable fixture and commits to the signature', () => {
    expect(verifyLifecycleClaim(fixture.claim)).toEqual({ signature: 'verified', identityBinding: 'key-identified', issuerKey: fixture.issuerKey })
    expect(Utils.toHex(lifecycleClaimBytes(fixture.claim))).toBe(fixture.representationHex)
    expect(lifecycleClaimDigest(fixture.claim)).toBe(fixture.anchor.digest)
    expect(Utils.toHex(Hash.sha256(canonicalBytes(fixture.unsignedClaim)))).not.toBe(fixture.anchor.digest)
  })

  it('signs the same portable bytes and refuses a mismatched wallet', async () => {
    expect(await signLifecycleClaim(fixture.unsignedClaim, wallet)).toEqual(fixture.claim)
    await expect(signLifecycleClaim(fixture.unsignedClaim, new ProtoWallet(PrivateKey.fromHex('66'.repeat(32))))).rejects.toThrow('signer does not match')
  })

  it.each([
    { eventType: 'Transfer' }, { profile_version: 3 }, { recordId: 'different-state' }, { recordId: 'aa'.repeat(32) },
    { passportId: 'different-product' }, { claimFormat: 'legacy' },
    { signature: '00'.repeat(64) }, { uora_type: 'Origin' },
    { issuerKeyDid: fixture.claim.issuer }, { nested: { proof: true } },
    { timestamp: '2026-02-31T00:00:00Z' },
  ])('rejects modified, ambiguous or malformed claim %j', change => {
    expect(verifyLifecycleClaim({ ...fixture.claim, ...change }).signature).toBe('invalid')
  })

  it('binds verification to independently expected product and state', () => {
    expect(verifyLifecycleClaim(fixture.claim, { passportId: 'other-product' }).signature).toBe('invalid')
    expect(verifyLifecycleClaim(fixture.claim, { recordId: 'other-state' }).signature).toBe('invalid')
  })

  it('does not infer a resolvable issuer identity from its nominated signing key', async () => {
    const claim: LifecycleClaim = { ...fixture.unsignedClaim, issuer: 'did:web:issuer.example', issuerKeyDid: fixture.claim.issuer }
    const signed = await signLifecycleClaim(claim, wallet)
    expect(verifyLifecycleClaim(signed)).toMatchObject({ signature: 'verified', identityBinding: 'requires-resolution' })
    const { issuerKeyDid: _unused, ...missingKey } = signed
    expect(verifyLifecycleClaim(missingKey).signature).toBe('invalid')
  })

  it.each(['did:', 'did:web:', 'did:WEB:issuer.example', 'did:web:issuer.example#key', 'did:web:bad%escape'])('refuses malformed issuer %s even with a usable signing key', async issuer => {
    await expect(signLifecycleClaim({ ...fixture.unsignedClaim, issuer, issuerKeyDid: fixture.claim.issuer }, wallet)).rejects.toThrow('issuer must be a DID')
  })

  it('refuses an evidence property: a native claim carries no evidence facets (rules.md §3)', async () => {
    const evidence = { workDone: `sha256:${'ab'.repeat(32)}` }
    await expect(signLifecycleClaim({ ...fixture.unsignedClaim, evidence } as never, wallet)).rejects.toThrow('unsupported claim field evidence')
    expect(verifyLifecycleClaim({ ...fixture.claim, evidence }).signature).toBe('invalid')
  })

  it('requires recordId to be the outpoint of the state the claim is about', async () => {
    await expect(signLifecycleClaim({ ...fixture.unsignedClaim, recordId: 'state-1' }, wallet)).rejects.toThrow('recordId must be the outpoint')
    await expect(signLifecycleClaim({ ...fixture.unsignedClaim, recordId: 'aa'.repeat(32) }, wallet)).rejects.toThrow('recordId must be the outpoint')
    await expect(signLifecycleClaim({ ...fixture.unsignedClaim, recordId: `${'aa'.repeat(32)}:01` }, wallet)).rejects.toThrow('recordId must be the outpoint')
    expect(verifyLifecycleClaim({ ...fixture.claim, recordId: `${'aa'.repeat(32)}:0` }).signature).toBe('invalid')
  })
})
