import { PrivateKey, Utils } from '@bsv/sdk'
import { policyDigest, policySigningPreimage, type PublisherPolicy } from '@bsv/dpp-core'

/**
 * A publisher key policy chain for the overlay tests, built with the core's
 * own preimage and digest helpers (the core's publisherPolicy.test.ts builds
 * the same shapes; the packages share the format, not test code). One
 * operator, one state-publisher key rotated once, one anchor-publisher key
 * added at the rotation:
 *
 *   version 1, issued T0 = 2026-01-01: K1 state-publisher from T0
 *   version 2, issued T1 = 2026-06-01: K1 retired at T1, K2 state-publisher
 *                                      from T1, A1 anchor-publisher from T1
 *
 * So a state timestamped in [T0, T1) is K1's, one at or after T1 is K2's, and
 * one before T0 is nobody's.
 */

export const T0 = '2026-01-01T00:00:00Z'
export const T1 = '2026-06-01T00:00:00Z'

export const operatorPriv = PrivateKey.fromHex('61'.repeat(32))
export const K1 = PrivateKey.fromHex('62'.repeat(32))
export const K2 = PrivateKey.fromHex('63'.repeat(32))
export const A1 = PrivateKey.fromHex('64'.repeat(32))
export const STRANGER = PrivateKey.fromHex('65'.repeat(32))
export const OPERATOR = 'did:example:operator-a'
export const pub = (key: PrivateKey): string => key.toPublicKey().toString()
export const OPERATORS: Record<string, string> = { [OPERATOR]: pub(operatorPriv) }

export function signPolicy(policy: PublisherPolicy, signer: PrivateKey, countersigner?: PrivateKey): PublisherPolicy {
  const unsigned: PublisherPolicy = {
    ...policy,
    authorisation: {
      ...policy.authorisation,
      signer: pub(signer),
      value: '',
      ...(countersigner == null ? {} : { countersigner: pub(countersigner) }),
    },
  }
  delete (unsigned.authorisation as { countersignature?: string }).countersignature
  const preimage = policySigningPreimage(unsigned)
  const value = Utils.toHex(signer.sign(preimage).toDER() as number[])
  const countersignature = countersigner == null ? undefined : Utils.toHex(countersigner.sign(preimage).toDER() as number[])
  return {
    ...unsigned,
    authorisation: { ...unsigned.authorisation, value, ...(countersignature == null ? {} : { countersignature }) },
  }
}

/**
 * The federation: two operators in one scope, both roles named, every
 * publisher key held by operator A. Version 1 is signed by operator A's
 * identity key; version 2 retires K1 at T1 and activates K2, signed by K1
 * (active under version 1) and countersigned by operator B, because no
 * operator of a federation authorises a key alone.
 */
export const operatorBPriv = PrivateKey.fromHex('66'.repeat(32))
export const OPERATOR_B = 'did:example:operator-b'
export const FEDERATION_OPERATORS: Record<string, string> = { [OPERATOR]: pub(operatorPriv), [OPERATOR_B]: pub(operatorBPriv) }

export function federatedChain(): { genesis: PublisherPolicy; rotation: PublisherPolicy } {
  const genesis = signPolicy(
    {
      policyFormat: 'dpp-publisher-policy@1',
      policyVersion: 1,
      scope: { operatorProfile: 'federated-operators@1', operators: [OPERATOR, OPERATOR_B] },
      issuedAt: T0,
      publishers: [
        { key: pub(K1), role: 'state-publisher', operator: OPERATOR, activeFrom: T0 },
        { key: pub(A1), role: 'anchor-publisher', operator: OPERATOR, activeFrom: T0 },
      ],
      authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    },
    operatorPriv
  )
  const rotation = signPolicy(
    {
      ...genesis,
      policyVersion: 2,
      issuedAt: T1,
      supersedes: { policyVersion: 1, sha256: policyDigest(genesis) },
      publishers: [
        { key: pub(K1), role: 'state-publisher', operator: OPERATOR, activeFrom: T0, retiredAt: T1 },
        { key: pub(K2), role: 'state-publisher', operator: OPERATOR, activeFrom: T1 },
        { key: pub(A1), role: 'anchor-publisher', operator: OPERATOR, activeFrom: T0 },
      ],
      authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    },
    K1,
    operatorBPriv
  )
  return { genesis, rotation }
}

/** `topics` scopes both versions to the named topics; absent, the policy covers every topic. */
export function policyChain(options: { topics?: string[] } = {}): PublisherPolicy[] {
  const scope = { operatorProfile: 'single-operator@1' as const, operators: [OPERATOR], ...(options.topics == null ? {} : { topics: options.topics }) }
  const genesis = signPolicy(
    {
      policyFormat: 'dpp-publisher-policy@1',
      policyVersion: 1,
      scope,
      issuedAt: T0,
      publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: T0 }],
      authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    },
    operatorPriv
  )
  const rotation = signPolicy(
    {
      ...genesis,
      policyVersion: 2,
      issuedAt: T1,
      supersedes: { policyVersion: 1, sha256: policyDigest(genesis) },
      publishers: [
        { key: pub(K1), role: 'state-publisher', activeFrom: T0, retiredAt: T1 },
        { key: pub(K2), role: 'state-publisher', activeFrom: T1 },
        { key: pub(A1), role: 'anchor-publisher', activeFrom: T1 },
      ],
      authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' },
    },
    K1
  )
  return [genesis, rotation]
}

/** The same chain with its second version's body altered after signing: verifies under nobody. */
export function tamperedChain(): PublisherPolicy[] {
  const [genesis, rotation] = policyChain()
  return [genesis, { ...rotation, notes: 'edited after signing' }]
}
