import type { ManagedInstructionV1Fixture } from './managed-instruction-v1-fixture.js'

/** The stack's vector form of `managed-instruction-v1.json`: a pure mapping, no new bytes. */
export function managedInstructionV1Vectors(F: ManagedInstructionV1Fixture) {
  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const sign = {
    id: 'sign-and-commit',
    description:
      'Canonicalise the record without its signature (object keys sorted by code point, no whitespace, strings, booleans and safe integers only), sign SHA-256 of those bytes with the custodian key directly (no derivation), then canonicalise the signed record and hash it: that digest is what the UPDATE or RETIRE carries in field 15 (spec managed-custody.md section 6).',
    input: { claim: { ...F.record, signature: undefined }, custodian_private_key_hex: '22'.repeat(32), signature_nonce: 'rfc6979' },
    expected: { signing_preimage_hex: F.signingPreimageHex, signature_hex: F.record.signature, commitment_hex: F.commitment },
    tags: ['happy-path'],
  }
  const bind = {
    id: 'bind-to-state',
    description: 'Verify the record and bind it to the UPDATE that commits to it: the operation asked for, the same passport and lineage, the tip the request named as the spent predecessor, the holder who asked as the actor, the commitment in field 15, and a request no later than the state.',
    input: { record: F.record, state_raw_tx_hex: F.update.rawTx, state_output_index: F.update.outputIndex },
    expected: { structure_valid: true, signature_valid: true, commitment_hex: F.commitment, binding_valid: true },
    tags: ['happy-path'],
  }
  const refusals = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description,
    input: { record: r.record, state_raw_tx_hex: F.update.rawTx, state_output_index: F.update.outputIndex },
    expected: { structure_valid: r.expected.structureValid, signature_valid: r.expected.signatureValid, binding_valid: false, reason: r.expected.reason },
    tags: ['error-case'],
  }))
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.managedinstruction.v1',
    name: 'DPP managed instruction record v1: the custodian-attested request a version 2 UPDATE or RETIRE commits to after a managed transfer',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-protocol@0.3.0',
    parity_class: 'required',
    vectors: [sign, bind, ...refusals],
  }
}
