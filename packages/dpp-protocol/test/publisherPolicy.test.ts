import { describe, expect, it } from 'vitest'
import { PrivateKey, Utils } from '@bsv/sdk'
import { canonicalJson } from '../src/canonicalJson.js'
import { appendPublisherVersion, policyDigest, policySigningPreimage, publisherKeysAt, verifyPolicyChain, type PublisherPolicy } from '../src/publisherPolicy.js'

const key = (seed: number) => PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([seed])), 'hex')
const pub = (k: PrivateKey) => k.toPublicKey().toString()
const A = key(11), B = key(12), K1 = key(21), K2 = key(22), K3 = key(23), STRANGER = key(99)
const identity = { 'did:example:a': pub(A), 'did:example:b': pub(B) }

function sign(policy: PublisherPolicy, signer: PrivateKey, countersigner?: PrivateKey): PublisherPolicy {
  const unsigned: PublisherPolicy = { ...policy, authorisation: { ...policy.authorisation, signer: pub(signer), value: '', ...(countersigner ? { countersigner: pub(countersigner) } : {}) } }
  delete (unsigned.authorisation as { countersignature?: string }).countersignature
  const preimage = policySigningPreimage(unsigned)
  const value = Utils.toHex(signer.sign(preimage).toDER() as number[])
  const countersignature = countersigner ? Utils.toHex(countersigner.sign(preimage).toDER() as number[]) : undefined
  return { ...unsigned, authorisation: { ...unsigned.authorisation, value, ...(countersignature ? { countersignature } : {}) } }
}

const genesis = sign({
  policyFormat: 'dpp-publisher-policy@1', policyVersion: 1,
  scope: { operatorProfile: 'single-operator@1', operators: ['did:example:a'] },
  issuedAt: '2026-01-01T00:00:00Z',
  publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' }],
  authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
}, A)

const rotation = sign({
  ...genesis, policyVersion: 2, issuedAt: '2026-06-01T00:00:00Z',
  supersedes: { policyVersion: 1, sha256: policyDigest(genesis) },
  publishers: [
    { key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z', retiredAt: '2026-06-01T00:00:00Z' },
    { key: pub(K2), role: 'state-publisher', activeFrom: '2026-06-01T00:00:00Z' },
  ],
  authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' },
}, K1)

const handover = sign({
  ...rotation, policyVersion: 3, issuedAt: '2026-09-01T00:00:00Z',
  scope: { operatorProfile: 'federated-operators@1', operators: ['did:example:a', 'did:example:b'] },
  supersedes: { policyVersion: 2, sha256: policyDigest(rotation) },
  publishers: [
    { key: pub(K2), role: 'state-publisher', operator: 'did:example:a', activeFrom: '2026-06-01T00:00:00Z' },
    { key: pub(K3), role: 'anchor-publisher', operator: 'did:example:b', activeFrom: '2026-09-01T00:00:00Z' },
  ],
  authorisation: { kind: 'handover', signer: '', suite: 'bsv-ecdsa-der', value: '' },
}, K2, B)

describe('the publisher key policy chain (services.md §1)', () => {
  it('accepts a genesis signed by an operator identity, a rotation by an active key and a countersigned handover', () => {
    expect(verifyPolicyChain([genesis], identity)).toEqual({ ok: true, versions: [1] })
    expect(verifyPolicyChain([genesis, rotation], identity)).toEqual({ ok: true, versions: [1, 2] })
    expect(verifyPolicyChain([genesis, rotation, handover], identity)).toEqual({ ok: true, versions: [1, 2, 3] })
  })

  it('answers the keys active at a state\'s time, never the newest list', () => {
    const chain = [genesis, rotation, handover]
    expect(publisherKeysAt(chain, '2025-12-31T23:59:59Z')).toEqual([])
    expect(publisherKeysAt(chain, '2026-03-01T00:00:00Z')).toEqual([pub(K1)])
    expect(publisherKeysAt(chain, '2026-06-01T00:00:00Z')).toEqual([pub(K2)])
    expect(publisherKeysAt(chain, '2026-07-01T00:00:00Z', 'anchor-publisher')).toEqual([])
    expect(publisherKeysAt(chain, '2026-10-01T00:00:00Z', 'anchor-publisher')).toEqual([pub(K3)])
    expect(publisherKeysAt(chain, '2026-10-01T00:00:00Z')).toEqual([pub(K2), pub(K3)])
  })

  it('lets a genesis issued after its key activated govern the instants before its issue, and nothing before the activation', () => {
    // A deployment that writes its first policy months into publishing
    // describes those months in the genesis's key windows. Only the first
    // version reaches back: the rotation still takes effect from its issue.
    const late = sign({ ...genesis, issuedAt: '2026-02-01T00:00:00Z' }, A)
    expect(publisherKeysAt([late], '2025-12-31T23:59:59Z')).toEqual([])
    expect(publisherKeysAt([late], '2026-01-15T00:00:00Z')).toEqual([pub(K1)])
    expect(publisherKeysAt([late], '2026-03-01T00:00:00Z')).toEqual([pub(K1)])
    const lateRotation = sign({ ...rotation, supersedes: { policyVersion: 1, sha256: policyDigest(late) } }, K1)
    expect(verifyPolicyChain([late, lateRotation], identity).ok).toBe(true)
    expect(publisherKeysAt([late, lateRotation], '2026-01-15T00:00:00Z')).toEqual([pub(K1)])
    expect(publisherKeysAt([late, lateRotation], '2026-06-01T00:00:00Z')).toEqual([pub(K2)])
  })

  it('refuses a genesis that an outsider signed, and a tampered body', () => {
    const outsider = sign(genesis, STRANGER)
    expect(verifyPolicyChain([outsider], identity).failure?.reason).toBe('genesis-signer-not-operator')
    const tampered = { ...genesis, publishers: [{ ...genesis.publishers[0], key: pub(STRANGER) }] }
    expect(verifyPolicyChain([tampered], identity).failure?.reason).toBe('signature-invalid')
  })

  it('refuses a later version that skips the digest chain, runs backwards in time or repeats a genesis', () => {
    const { supersedes: _s, ...noSupersedes } = rotation
    expect(verifyPolicyChain([genesis, sign(noSupersedes as PublisherPolicy, K1)], identity).failure?.reason).toBe('supersedes-missing')
    const wrongDigest = sign({ ...rotation, supersedes: { policyVersion: 1, sha256: '00'.repeat(32) } }, K1)
    expect(verifyPolicyChain([genesis, wrongDigest], identity).failure?.reason).toBe('supersedes-mismatch')
    const backwards = sign({ ...rotation, issuedAt: '2025-06-01T00:00:00Z' }, K1)
    expect(verifyPolicyChain([genesis, backwards], identity).failure?.reason).toBe('time-order')
    const secondGenesis = sign({ ...rotation, authorisation: { ...rotation.authorisation, kind: 'genesis' } }, A)
    expect(verifyPolicyChain([genesis, secondGenesis], identity).failure?.reason).toBe('version-order')
  })

  it('refuses a rotation signed by a key that was not active under the superseded version', () => {
    const byNewKey = sign(rotation, K2)
    expect(verifyPolicyChain([genesis, byNewKey], identity).failure?.reason).toBe('signer-not-active')
    const byStranger = sign(rotation, STRANGER)
    expect(verifyPolicyChain([genesis, byStranger], identity).failure?.reason).toBe('signer-not-active')
  })

  it('requires an incoming operator to countersign a handover, and refuses any other countersigner', () => {
    const uncountersigned = sign(handover, K2)
    expect(verifyPolicyChain([genesis, rotation, uncountersigned], identity).failure?.reason).toBe('countersignature-missing')
    const wrongCounter = sign(handover, K2, A)
    expect(verifyPolicyChain([genesis, rotation, wrongCounter], identity).failure?.reason).toBe('countersigner-not-eligible')
    const forged = { ...handover, authorisation: { ...handover.authorisation, countersignature: sign(handover, K2, STRANGER).authorisation.countersignature! } }
    expect(verifyPolicyChain([genesis, rotation, forged], identity).failure?.reason).toBe('countersignature-invalid')
  })

  it('lets no operator of a federation rotate keys alone', () => {
    const alone = sign({
      ...handover, policyVersion: 4, issuedAt: '2026-10-01T00:00:00Z', supersedes: { policyVersion: 3, sha256: policyDigest(handover) },
      authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    }, K2)
    expect(verifyPolicyChain([genesis, rotation, handover, alone], identity).failure?.reason).toBe('countersignature-missing')
    const together = sign({ ...alone }, K2, B)
    expect(verifyPolicyChain([genesis, rotation, handover, together], identity)).toEqual({ ok: true, versions: [1, 2, 3, 4] })
    const sameOperatorTwice = sign({ ...alone }, K2, A)
    expect(verifyPolicyChain([genesis, rotation, handover, sameOperatorTwice], identity).failure?.reason).toBe('countersigner-not-eligible')
  })

  it('names a handover with an unchanged set, and a rotation with a changed one, as the wrong kind', () => {
    const notAHandover = sign({ ...rotation, authorisation: { ...rotation.authorisation, kind: 'handover' } }, K1, A)
    expect(verifyPolicyChain([genesis, notAHandover], identity).failure?.reason).toBe('scope-mismatch')
    const notARotation = sign({ ...handover, authorisation: { ...handover.authorisation, kind: 'rotation' } }, K2, B)
    expect(verifyPolicyChain([genesis, rotation, notARotation], identity).failure?.reason).toBe('scope-mismatch')
  })

  it('refuses a well-formed time that does not exist', () => {
    const unreal = sign({ ...genesis, issuedAt: '2026-13-45T25:61:61Z' }, A)
    expect(verifyPolicyChain([unreal], identity).failure).toMatchObject({ reason: 'format' })
    const unrealEntry = sign({ ...genesis, publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: '2026-13-01T00:00:00Z' }] }, A)
    expect(verifyPolicyChain([unrealEntry], identity).failure).toMatchObject({ reason: 'entry-invalid' })
  })

  it('refuses malformed entries by name and an empty chain', () => {
    const retiresFirst = sign({ ...genesis, publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-02T00:00:00Z', retiredAt: '2026-01-01T00:00:00Z' }] }, A)
    expect(verifyPolicyChain([retiresFirst], identity).failure?.reason).toBe('entry-invalid')
    const operatorless = sign({ ...handover, publishers: [{ key: pub(K2), role: 'state-publisher', activeFrom: '2026-06-01T00:00:00Z' }] }, K2, B)
    expect(verifyPolicyChain([genesis, rotation, operatorless], identity).failure?.reason).toBe('entry-invalid')
    expect(verifyPolicyChain([], identity).failure?.reason).toBe('format')
  })

  it('orders keys by code point, not by UTF-16 code unit', () => {
    // U+FF21 (fullwidth A) sorts after U+1F600 by code point but before it by code unit.
    expect(canonicalJson({ '\u{1F600}': 1, '\uFF21': 2 })).toBe('{"\uFF21":2,"\u{1F600}":1}')
  })

  it('canonicalises with sorted keys and no whitespace, and refuses what has no canonical form', () => {
    expect(canonicalJson({ b: [1, 'x', { d: true, c: 'y' }], a: 'z' })).toBe('{"a":"z","b":[1,"x",{"c":"y","d":true}]}')
    expect(() => canonicalJson({ a: 1.5 })).toThrow(/safe integers/)
    expect(() => canonicalJson({ a: null })).toThrow(/null/)
    expect(verifyPolicyChain([{ ...genesis, notes: 1.5 as unknown as string }], identity).failure?.reason).toBe('format')
  })

  it('has a digest that changes with any byte and a preimage that excludes only the signature values', () => {
    expect(policyDigest(genesis)).not.toBe(policyDigest({ ...genesis, notes: 'x' }))
    const preimage = policySigningPreimage(genesis)
    expect(preimage).toEqual(policySigningPreimage({ ...genesis, authorisation: { ...genesis.authorisation, value: 'ff' } }))
    expect(preimage).not.toEqual(policySigningPreimage({ ...genesis, authorisation: { ...genesis.authorisation, signer: pub(B) } }))
  })
})

describe('appending a version for a registered or retired publisher (services.md §2)', () => {
  const NOW = new Date('2026-03-01T12:00:00.250Z')
  const singleOperator = { 'did:example:a': pub(A) }

  it('adds a state publisher in a rotation the operator signs, which the extended chain accepts', () => {
    const version = appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, A, NOW)
    expect(version.policyVersion).toBe(2)
    expect(version.issuedAt).toBe('2026-03-01T12:00:00.250Z')
    expect(version.supersedes).toEqual({ policyVersion: 1, sha256: policyDigest(genesis) })
    expect(version.scope).toEqual(genesis.scope)
    expect(version.authorisation).toMatchObject({ kind: 'rotation', signer: pub(A), suite: 'bsv-ecdsa-der' })
    expect(version.publishers).toEqual([
      { key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' },
      { key: pub(K2), role: 'state-publisher', activeFrom: '2026-03-01T12:00:00.250Z' },
    ])
    expect(version).not.toHaveProperty('notes')
    expect(verifyPolicyChain([genesis, version], singleOperator)).toEqual({ ok: true, versions: [1, 2] })
    expect(publisherKeysAt([genesis, version], NOW)).toEqual([pub(K1), pub(K2)])
    expect(publisherKeysAt([genesis, version], '2026-03-01T12:00:00.249Z')).toEqual([pub(K1)])
  })

  it('retires a publisher, keeping its entry with its window closed', () => {
    const added = appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, A, NOW)
    const later = new Date('2026-04-01T00:00:00Z')
    const retired = appendPublisherVersion([genesis, added], singleOperator, { retire: pub(K1) }, A, later)
    expect(retired.policyVersion).toBe(3)
    expect(retired.publishers[0]).toEqual({ key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z', retiredAt: '2026-04-01T00:00:00.000Z' })
    expect(verifyPolicyChain([genesis, added, retired], singleOperator).ok).toBe(true)
    expect(publisherKeysAt([genesis, added, retired], later)).toEqual([pub(K2)])
    expect(publisherKeysAt([genesis, added, retired], '2026-03-15T00:00:00Z')).toEqual([pub(K1), pub(K2)])
  })

  it('refuses a signer that is not an operator of the scope, even an active publisher key', () => {
    expect(() => appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, K1, NOW)).toThrow(/operator/)
    expect(() => appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, STRANGER, NOW)).toThrow(/operator/)
  })

  it('refuses a scope that is not single-operator@1', () => {
    expect(() => appendPublisherVersion([genesis, rotation, handover], identity, { add: { key: pub(K1), role: 'state-publisher' } }, A, new Date('2026-10-01T00:00:00Z'))).toThrow(/single-operator@1/)
  })

  it('refuses a key already active, a retirement of a key not active, and a time not after the newest version', () => {
    expect(() => appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K1), role: 'state-publisher' } }, A, NOW)).toThrow(/already active/)
    expect(() => appendPublisherVersion([genesis], singleOperator, { retire: pub(K2) }, A, NOW)).toThrow(/not active/)
    expect(() => appendPublisherVersion([genesis], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, A, new Date('2026-01-01T00:00:00Z'))).toThrow(/after/)
    expect(() => appendPublisherVersion([genesis], singleOperator, {}, A, NOW)).toThrow(/add or retire/)
  })

  it('refuses to grow past the 256 entries a version may hold', () => {
    const full = sign({ ...genesis, publishers: Array.from({ length: 256 }, (_, i) => ({ key: pub(PrivateKey.fromHex((i + 1000).toString(16).padStart(64, '0'))), role: 'state-publisher' as const, activeFrom: '2026-01-01T00:00:00Z' })) }, A)
    expect(verifyPolicyChain([full], singleOperator).ok).toBe(true)
    expect(() => appendPublisherVersion([full], singleOperator, { add: { key: pub(K2), role: 'state-publisher' } }, A, NOW)).toThrow(/256/)
  })
})
