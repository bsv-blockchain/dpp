import type { managedAcceptanceV1Fixture } from './managed-acceptance-v1-fixture.js'

type Fixture = Awaited<ReturnType<typeof managedAcceptanceV1Fixture>>

/**
 * The managed acceptance fixture in the BSV stack's cross-language conformance
 * vector format. `fixtures/vectors/dpp/managed-acceptance/v1.json` is this
 * function's output, verbatim. The custodian's private key is published so a
 * writer in any language reproduces the signature; vector identifiers are
 * permanent once published and the file is append-only.
 */
export function managedAcceptanceV1Vectors(F: Fixture) {
  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const sign = {
    id: 'sign-and-commit',
    description:
      'Canonicalise the record without its signature (object keys sorted by code point, no whitespace, strings, booleans and safe integers only), sign SHA-256 of those bytes with the custodian key directly (no derivation), then canonicalise the signed record and hash it: that digest is what the TRANSFER carries in field 15 (spec managed-custody.md section 3).',
    input: { claim: { ...F.record, signature: undefined }, custodian_private_key_hex: '22'.repeat(32), signature_nonce: 'rfc6979' },
    expected: { signing_preimage_hex: F.signingPreimageHex, signature_hex: F.record.signature, commitment_hex: F.commitment },
    tags: ['happy-path'],
  }
  const bind = {
    id: 'bind-to-transfer',
    description: 'Verify the record and bind it to the TRANSFER that commits to it: same passport and lineage, the tip the offer named as the spent predecessor, the accepted destination as the new controller key, the offering holder as the actor, the commitment in field 15, and an acceptance no later than the state.',
    input: { record: F.record, transfer_raw_tx_hex: F.transfer.rawTx, transfer_output_index: F.transfer.outputIndex },
    expected: { structure_valid: true, signature_valid: true, commitment_hex: F.commitment, binding_valid: true },
    tags: ['happy-path'],
  }
  const refusals = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description,
    input: { record: r.record, transfer_raw_tx_hex: F.transfer.rawTx, transfer_output_index: F.transfer.outputIndex },
    expected: {
      structure_valid: r.expected.structureValid,
      signature_valid: r.expected.signatureValid,
      binding_valid: false,
      reason: r.expected.reason,
    },
    tags: ['error-case'],
  }))
  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.managedacceptance.v1',
    name: 'DPP managed acceptance record v1: the custodian-attested acceptance a version 2 TRANSFER commits to',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.3.0',
    parity_class: 'required',
    vectors: [sign, bind, ...refusals],
  }
}
