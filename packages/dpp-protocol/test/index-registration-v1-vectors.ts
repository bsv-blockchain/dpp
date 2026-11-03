import { REGISTRATION_FIXTURE_PRIVATE_KEY_HEX, type IndexRegistrationV1Fixture } from './index-registration-v1-fixture.js'

/**
 * The index registration fixture in the BSV stack's cross-language
 * conformance vector format. `fixtures/vectors/dpp/index-registration/v1.json`
 * is this function's output, verbatim. The application's private key is
 * published so a writer in any language reproduces the signature; vector
 * identifiers are permanent once published and the file is append-only.
 */
export function indexRegistrationV1Vectors(F: IndexRegistrationV1Fixture) {
  const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const sign = {
    id: 'sign',
    description:
      'Canonicalise the request without its signature (object keys sorted by code point, no whitespace, string values only), sign SHA-256 of those bytes with the BRC-42 child of the publisher key for protocol [1, "dpp index registration v1"], key identifier the index URL and counterparty anyone (the BRC-100 createSignature operation).',
    input: { claim: { ...F.request, signature: undefined }, publisher_private_key_hex: REGISTRATION_FIXTURE_PRIVATE_KEY_HEX, derivation: { protocol_id: F.signing.protocolId, key_id: F.signing.keyId, counterparty: 'anyone' }, signature_nonce: 'rfc6979' },
    expected: { signing_preimage_hex: F.signingPreimageHex, signature_hex: F.request.signature, verification_key_hex: F.signing.verificationKey },
    tags: ['happy-path'],
  }
  const accept = {
    id: 'accept',
    description: 'Verify the request under the child of its own publisherKey and indexUrl, then compare it with what the index expects: its address, network, custody profile and a clock window of ten minutes.',
    input: { request: F.request, expectations: F.expectations },
    expected: { valid: true, reasons: [] as string[] },
    tags: ['happy-path'],
  }
  const refusals = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description,
    input: { request: r.request, expectations: F.expectations },
    expected: r.expected,
    tags: ['error-case'],
  }))
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.indexregistration.v1',
    name: 'DPP index registration request v1: the wallet-signed request an application sends to register its publisher key with an index',
    brc: [],
    version: '1.0.0',
    reference_impl: 'dpp-protocol@0.3.0',
    parity_class: 'required',
    vectors: [sign, accept, ...refusals],
  }
}
