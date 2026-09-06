import type { recordV2Fixture } from './record-v2-fixture.js'

type Fixture = Awaited<ReturnType<typeof recordV2Fixture>>

/**
 * The version 2 record fixture in the BSV stack's cross-language conformance
 * vector format, as a pure mapping from the generated object, the way
 * `record-v1-vectors.ts` maps the version 1 fixture. `fixtures/vectors/dpp/record/v2.json`
 * is this function's output, verbatim. The test private keys are published so a
 * writer in any language reproduces the pinned bytes rather than only checking
 * them. Vector identifiers are permanent once published and the file is
 * append-only.
 */
const PRIVATE_KEYS = {
  issuer: '11'.repeat(32),
  custodian: '22'.repeat(32),
}

export function recordV2Vectors(F: Fixture) {
  const stateToScript = {
    id: 'state-to-script',
    description:
      "Sign the fifteen data fields as actor and as publisher, then build the seventeen-field locking script. Each preimage is the domain tag followed by every signed field, every item as a Bitcoin VarInt length and its bytes; signatures are ECDSA with RFC 6979 nonces over SHA-256 of that preimage, under BRC-42 children for protocol [1, 'dpp token v2'], counterparty anyone (spec record-model-v2.md sections 2 and 5). The private keys are synthetic test keys, published deliberately.",
    input: {
      state: F.state,
      owner_blob_hex: F.ownerBlob,
      actor_private_key_hex: PRIVATE_KEYS.issuer,
      publisher_private_key_hex: PRIVATE_KEYS.custodian,
      locking_key_hex: F.lockingKey,
      actor_tag: F.actorTag,
      publisher_tag: F.publisherTag,
      signature_nonce: 'rfc6979',
    },
    expected: {
      actor_preimage_hex: F.actorPreimage,
      actor_signature_hex: F.actorSignature,
      publisher_preimage_hex: F.publisherPreimage,
      publisher_signature_hex: F.publisherSignature,
      actor_verification_key_hex: F.actorVerificationKey,
      publisher_verification_key_hex: F.publisherVerificationKey,
      locking_script_hex: F.lockingScript,
    },
    tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48'],
  }

  const scriptToState = {
    id: 'script-to-state',
    description:
      "Parse the locking script back to the state, re-derive the actor verification key from fields 7 and 8 with no secret, and verify the actor signature. The publisher signature verifies under the custodian's published identity key, which is admission policy and not token validity.",
    input: {
      locking_script_hex: F.lockingScript,
      publisher_identity_key_hex: F.custodianKey,
    },
    expected: {
      locking_key_hex: F.lockingKey,
      state: F.state,
      actor_signature_hex: F.actorSignature,
      publisher_signature_hex: F.publisherSignature,
      actor_verification_key_hex: F.actorVerificationKey,
      actor_signature_valid: true,
      publisher_verification_key_hex: F.publisherVerificationKey,
      publisher_signature_valid: true,
    },
    tags: ['happy-path', 'brc-42', 'brc-48'],
  }

  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const refusalVectors = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.reason,
    input: { locking_script_hex: r.lockingScript },
    expected: { accepted: false, stage: 'decode', reason: r.reason },
    tags: ['error-case', 'brc-48'],
  }))

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.record.v2',
    name: 'DPP record model v2: a state to its output and back',
    brc: ['BRC-42', 'BRC-43', 'BRC-48'],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.3.0',
    parity_class: 'required',
    vectors: [stateToScript, scriptToState, ...refusalVectors],
  }
}
