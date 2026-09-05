/**
 * Portable vectors for the publisher key policy (`spec/services.md` §1,
 * `contracts/publisher-policy.schema.json`), in the stack's vector format. A
 * second implementation reproduces the signing preimage and the digest of
 * every version, verifies every authorisation, and reaches the same verdict on
 * every refusal. The private keys are synthetic test keys, published
 * deliberately.
 */
import { PrivateKey, Utils } from '@bsv/sdk'
import { policyDigest, policySigningPreimage, publisherKeysAt, verifyPolicyChain, type PublisherPolicy } from '../src/publisherPolicy.js'

const key = (seed: number): PrivateKey => PrivateKey.fromString(Utils.toHex(new Array(31).fill(0).concat([seed])), 'hex')
const pub = (k: PrivateKey): string => k.toPublicKey().toString()
const A = key(11), B = key(12), K1 = key(21), K2 = key(22), K3 = key(23), STRANGER = key(99)
export const POLICY_OPERATOR_KEYS = { 'did:example:a': pub(A), 'did:example:b': pub(B) }

export function signPolicy(policy: PublisherPolicy, signer: PrivateKey, countersigner?: PrivateKey): PublisherPolicy {
  const unsigned: PublisherPolicy = { ...policy, authorisation: { ...policy.authorisation, signer: pub(signer), value: '', ...(countersigner ? { countersigner: pub(countersigner) } : {}) } }
  delete (unsigned.authorisation as { countersignature?: string }).countersignature
  const preimage = policySigningPreimage(unsigned)
  const value = Utils.toHex(signer.sign(preimage).toDER() as number[])
  const countersignature = countersigner ? Utils.toHex(countersigner.sign(preimage).toDER() as number[]) : undefined
  return { ...unsigned, authorisation: { ...unsigned.authorisation, value, ...(countersignature ? { countersignature } : {}) } }
}

export function buildPolicyDemo(): { genesis: PublisherPolicy; rotation: PublisherPolicy; handover: PublisherPolicy } {
  const genesis = signPolicy({
    policyFormat: 'dpp-publisher-policy@1', policyVersion: 1,
    scope: { operatorProfile: 'single-operator@1', operators: ['did:example:a'] },
    issuedAt: '2026-01-01T00:00:00Z',
    publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' }],
    authorisation: { kind: 'genesis', signer: '', suite: 'bsv-ecdsa-der', value: '' },
  }, A)
  const rotation = signPolicy({
    ...genesis, policyVersion: 2, issuedAt: '2026-06-01T00:00:00Z',
    supersedes: { policyVersion: 1, sha256: policyDigest(genesis) },
    publishers: [
      { key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z', retiredAt: '2026-06-01T00:00:00Z' },
      { key: pub(K2), role: 'state-publisher', activeFrom: '2026-06-01T00:00:00Z' },
    ],
    authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' },
  }, K1)
  const handover = signPolicy({
    ...rotation, policyVersion: 3, issuedAt: '2026-09-01T00:00:00Z',
    scope: { operatorProfile: 'federated-operators@1', operators: ['did:example:a', 'did:example:b'] },
    supersedes: { policyVersion: 2, sha256: policyDigest(rotation) },
    publishers: [
      { key: pub(K2), role: 'state-publisher', operator: 'did:example:a', activeFrom: '2026-06-01T00:00:00Z' },
      { key: pub(K3), role: 'anchor-publisher', operator: 'did:example:b', activeFrom: '2026-09-01T00:00:00Z' },
    ],
    authorisation: { kind: 'handover', signer: '', suite: 'bsv-ecdsa-der', value: '' },
  }, K2, B)
  return { genesis, rotation, handover }
}

const describeChain = (chain: PublisherPolicy[]) => chain.map((p) => ({ policyVersion: p.policyVersion, preimage_hex: Utils.toHex(policySigningPreimage(p)), digest_hex: policyDigest(p) }))

export function publisherPolicyVectors(): Record<string, unknown> {
  const { genesis, rotation, handover } = buildPolicyDemo()
  const identity = POLICY_OPERATOR_KEYS
  const vector = (id: string, description: string, chain: PublisherPolicy[], tags: string[], extra: Record<string, unknown> = {}) => {
    const result = verifyPolicyChain(chain, identity)
    return {
      id,
      description,
      input: { chain, operator_identity_keys: identity },
      expected: {
        ok: result.ok,
        versions: result.versions,
        ...(result.failure == null ? {} : { failure: { version: result.failure.version, reason: result.failure.reason } }),
        versions_detail: describeChain(chain),
        ...extra,
      },
      tags,
    }
  }
  const chain = [genesis, rotation, handover]
  const { supersedes: _s, ...noSupersedes } = rotation
  const alone = signPolicy({ ...handover, policyVersion: 4, issuedAt: '2026-10-01T00:00:00Z', supersedes: { policyVersion: 3, sha256: policyDigest(handover) }, authorisation: { kind: 'rotation', signer: '', suite: 'bsv-ecdsa-der', value: '' } }, K2)
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.publisherpolicy.v1',
    name: 'DPP publisher key policy v1: a chain of versions, and the keys active at a time',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.2.0',
    parity_class: 'required',
    vectors: [
      vector('valid-chain', 'A genesis signed by the operator identity, a rotation signed by the retiring key, and a handover into a federation countersigned by the incoming operator. The preimage is the canonical JSON of each version without its signature values; the digest is the canonical JSON complete.', chain, ['publisher-policy', 'valid'], {
        keys_at: [
          { at: '2025-12-31T23:59:59Z', keys: publisherKeysAt(chain, '2025-12-31T23:59:59Z') },
          { at: '2026-03-01T00:00:00Z', keys: publisherKeysAt(chain, '2026-03-01T00:00:00Z') },
          { at: '2026-06-01T00:00:00Z', keys: publisherKeysAt(chain, '2026-06-01T00:00:00Z') },
          { at: '2026-10-01T00:00:00Z', role: 'anchor-publisher', keys: publisherKeysAt(chain, '2026-10-01T00:00:00Z', 'anchor-publisher') },
          { at: '2026-10-01T00:00:00Z', keys: publisherKeysAt(chain, '2026-10-01T00:00:00Z') },
        ],
      }),
      vector('federation-rotation-countersigned', 'Under a federation no operator authorises a key alone: the fourth version is signed by an active key and countersigned by the other operator.', [...chain, signPolicy(alone, K2, B)], ['publisher-policy', 'valid']),
      vector('outsider-genesis', 'A genesis signed by a key that is no operator identity in its scope.', [signPolicy(genesis, STRANGER)], ['publisher-policy', 'refusal']),
      vector('tampered-body', 'The genesis with a publisher key swapped after signing.', [{ ...genesis, publishers: [{ ...genesis.publishers[0], key: pub(STRANGER) }] }], ['publisher-policy', 'refusal']),
      vector('supersedes-missing', 'A later version that names no superseded version.', [genesis, signPolicy(noSupersedes as PublisherPolicy, K1)], ['publisher-policy', 'refusal']),
      vector('supersedes-wrong-digest', 'A later version naming the right version number and the wrong digest.', [genesis, signPolicy({ ...rotation, supersedes: { policyVersion: 1, sha256: '00'.repeat(32) } }, K1)], ['publisher-policy', 'refusal']),
      vector('backwards-time', 'A later version issued before the one it supersedes.', [genesis, signPolicy({ ...rotation, issuedAt: '2025-06-01T00:00:00Z' }, K1)], ['publisher-policy', 'refusal']),
      vector('second-genesis', 'A genesis authorisation after the first version.', [genesis, signPolicy({ ...rotation, authorisation: { ...rotation.authorisation, kind: 'genesis' } }, A)], ['publisher-policy', 'refusal']),
      vector('signer-not-active', 'A rotation signed by the incoming key, which was not active under the superseded version.', [genesis, signPolicy(rotation, K2)], ['publisher-policy', 'refusal']),
      vector('handover-uncountersigned', 'A handover without the incoming operator\'s countersignature.', [genesis, rotation, signPolicy(handover, K2)], ['publisher-policy', 'refusal']),
      vector('handover-wrong-countersigner', 'A handover countersigned by the outgoing operator instead of the incoming one.', [genesis, rotation, signPolicy(handover, K2, A)], ['publisher-policy', 'refusal']),
      vector('federation-alone', 'A rotation under a federation signed by one operator\'s key with no countersignature.', [...chain, alone], ['publisher-policy', 'refusal']),
      vector('retires-before-activates', 'A publisher entry whose retirement precedes its activation.', [signPolicy({ ...genesis, publishers: [{ key: pub(K1), role: 'state-publisher', activeFrom: '2026-01-02T00:00:00Z', retiredAt: '2026-01-01T00:00:00Z' }] }, A)], ['publisher-policy', 'refusal']),
    ],
  }
}
