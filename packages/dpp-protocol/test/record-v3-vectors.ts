import type { recordV3Fixture } from './record-v3-fixture.js'

type Fixture = Awaited<ReturnType<typeof recordV3Fixture>>

/**
 * The version 3 record fixture in the BSV stack's cross-language conformance
 * vector format, as a pure mapping from the generated object, the way
 * `record-v2-vectors.ts` maps the version 2 fixture.
 * `fixtures/vectors/dpp/record/v3.json` is this function's output, verbatim.
 * The test private keys are published so a writer in any language reproduces
 * the pinned bytes rather than only checking them. Vector identifiers are
 * permanent once published and the file is append-only.
 */
const PRIVATE_KEYS = {
  issuer: '11'.repeat(32),
  custodian: '22'.repeat(32),
}

export function recordV3Vectors(F: Fixture) {
  const stateToScript = (id: string, role: 'genesis' | 'value', description: string) => {
    const R = F[role]
    return {
      id,
      description,
      input: {
        state: R.state,
        owner_blob_hex: F.ownerBlob,
        actor_private_key_hex: PRIVATE_KEYS.issuer,
        publisher_private_key_hex: PRIVATE_KEYS.custodian,
        locking_key_hex: F.lockingKey,
        actor_tag: F.actorTag,
        publisher_tag: F.publisherTag,
        ...(role === 'value' ? { token_id: R.tokenId, token_id_wire_hex: F.genesis.tokenIdWire } : {}),
        signature_nonce: 'rfc6979',
      },
      expected: {
        prefix: R.prefix,
        actor_preimage_hex: R.actorPreimage,
        actor_signature_hex: R.actorSignature,
        publisher_preimage_hex: R.publisherPreimage,
        publisher_signature_hex: R.publisherSignature,
        actor_verification_key_hex: R.actorVerificationKey,
        publisher_verification_key_hex: R.publisherVerificationKey,
        locking_script_hex: R.lockingScript,
      },
      tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48', 'brc-162'],
    }
  }

  const genesisToScript = stateToScript(
    'genesis-to-script',
    'genesis',
    "Sign the fifteen data fields of the genesis as actor and as publisher under BRC-42 children for protocol [1, 'dpp token v3'], counterparty anyone, with the version 3 domain tags, then build the seventeen-field body and carry it behind the deploy prefix OP_0 OP_1 OP_2DROP: a fixed-supply BRC-162 token of one unit (spec token-carrier.md sections 2 to 4). The private keys are synthetic test keys, published deliberately."
  )
  const valueToScript = stateToScript(
    'value-to-script',
    'value',
    'Sign the first state after the genesis and carry it behind the value prefix: the 32-byte token id (the deploy txid in internal byte order), OP_1 and OP_2DROP, then the body. The token id names the lineage genesis that field 12 names in display order.'
  )

  const scriptToState = {
    id: 'script-to-state',
    description:
      "Parse the value output back to its prefix and state: role value, amount one, the token id in display form, then the body under the version 2 field rules with the version 3 string; re-derive the actor verification key from fields 7 and 8 with no secret and verify the actor signature under the version 3 protocol. The publisher signature verifies under the custodian's published identity key, which is admission policy and not token validity.",
    input: {
      locking_script_hex: F.value.lockingScript,
      publisher_identity_key_hex: F.custodianKey,
    },
    expected: {
      prefix: { role: 'value', amount: 1, token_id: F.value.tokenId },
      locking_key_hex: F.lockingKey,
      state: F.value.state,
      actor_signature_hex: F.value.actorSignature,
      publisher_signature_hex: F.value.publisherSignature,
      actor_verification_key_hex: F.value.actorVerificationKey,
      actor_signature_valid: true,
      publisher_verification_key_hex: F.value.publisherVerificationKey,
      publisher_signature_valid: true,
    },
    tags: ['happy-path', 'brc-42', 'brc-48', 'brc-162'],
  }

  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const acceptedVectors = F.accepted.map((a) => ({
    id: `accept-${kebab(a.name)}`,
    description: a.reason,
    input: { locking_script_hex: a.lockingScript },
    expected: { accepted: true, prefix: F.genesis.prefix === 'OP_0 OP_1 OP_2DROP' ? { role: 'deploy', amount: 1, token_id: null } : null, state: F.genesis.state },
    tags: ['happy-path', 'brc-162'],
  }))
  const refusalVectors = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.reason,
    input: { locking_script_hex: r.lockingScript },
    expected: { accepted: false, stage: 'decode', reason: r.reason },
    tags: ['error-case', 'brc-48', 'brc-162'],
  }))

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.record.v3',
    name: 'DPP record version 3: a carried state to its token output and back',
    brc: ['BRC-42', 'BRC-43', 'BRC-48', 'BRC-162'],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.3.0',
    parity_class: 'required',
    vectors: [genesisToScript, valueToScript, scriptToState, ...acceptedVectors, ...refusalVectors],
  }
}
