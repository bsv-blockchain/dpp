import { LockingScript, PrivateKey, ProtoWallet, PublicKey, Utils } from '@bsv/sdk'
import { canonicalString, didKeyFromIdentityKey, lifecycleClaimBytes, lifecycleClaimDigest, signLifecycleClaim, type LifecycleClaim } from '@bsv/dpp-core'
import { ATTESTATION_ANCHOR_PREFIX, ATTESTATION_ANCHOR_PROTOCOL, attestationAnchorFields, attestationAnchorSigningPreimage, buildAttestationAnchor, decodeAttestationAnchor } from '../src/attestationAnchor.js'

/** Published synthetic keys. Independent implementations reproduce these bytes. */
export async function attestationV1Fixture() {
  const anchoringPrivateKey = '77'.repeat(32)
  const issuerPrivateKey = '88'.repeat(32)
  const issuerKey = PrivateKey.fromHex(issuerPrivateKey).toPublicKey().toString()
  const issuer = didKeyFromIdentityKey(issuerKey)
  const unsignedClaim: LifecycleClaim = {
    claimFormat: 'dpp-lifecycle-v1', eventType: 'Origin', issuer,
    issuerKeyId: 'fixture-issuer-key', passportId: 'https://id.example.test/products/fixture-1',
    profile: 'generic', profile_version: 1, recordId: 'state-1', timestamp: '2026-09-05T00:00:00.000Z',
  }
  const claim = await signLifecycleClaim(unsignedClaim, new ProtoWallet(PrivateKey.fromHex(issuerPrivateKey)))
  const representationBytes = Utils.toUTF8(lifecycleClaimBytes(claim))
  const digest = lifecycleClaimDigest(claim)
  const anchor = {
    digest, attestationId: 'urn:uuid:11111111-1111-4111-8111-111111111111', issuer,
    subject: unsignedClaim.passportId, attestationType: unsignedClaim.eventType,
    representation: 'dpp-lifecycle-json-v1', mediaType: 'application/json',
    anchoredBy: PrivateKey.fromHex(anchoringPrivateKey).toPublicKey().toString(),
  }
  const fields = attestationAnchorFields(anchor)
  const script = await buildAttestationAnchor(anchor, new ProtoWallet(PrivateKey.fromHex(anchoringPrivateKey)))
  const decoded = decodeAttestationAnchor(script)!
  return {
    fixtureVersion: 1, description: 'Public synthetic test keys only. No funds may be sent to fixture outputs.',
    protocol: ATTESTATION_ANCHOR_PROTOCOL, prefix: ATTESTATION_ANCHOR_PREFIX,
    anchoringPrivateKey, issuerPrivateKey, issuerKey, anchor, unsignedClaim, claim,
    canonicalUnsignedClaim: canonicalString(unsignedClaim), representationBytes,
    representationHex: Utils.toHex(lifecycleClaimBytes(claim)), digest,
    fields: fields.map(field => Utils.toUTF8(field)), fieldHex: fields.map(field => Utils.toHex(field)),
    signingPreimage: Utils.toHex(attestationAnchorSigningPreimage(fields)),
    signature: Utils.toHex(decoded.signature), lockingKey: decoded.lockingKey, lockingScript: script.toHex(),
  }
}

export function attestationV1Vectors(fixture: Awaited<ReturnType<typeof attestationV1Fixture>>) {
  const refuse = (id: string, description: string, mutate: (script: LockingScript) => void) => {
    const script = LockingScript.fromHex(fixture.lockingScript)
    mutate(script)
    return { id, description, input: { locking_script_hex: new LockingScript(script.chunks).toHex() }, expected: { accepted: false }, tags: ['error-case'] }
  }
  return {
    $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.attestation-anchor.v1', name: 'Complete secured representation and generic attestation anchor',
    version: '1.0.0', reference_impl: 'dpp-overlay-topics@0.2.0', parity_class: 'required',
    brc: ['BRC-42', 'BRC-43', 'BRC-48'],
    vectors: [
      {
        id: 'signed-claim-to-anchor', description: 'Sign the native claim, hash its complete canonical signed representation, frame nine metadata fields and create the ten-field anchor.',
        input: { unsigned_claim: fixture.unsignedClaim, anchor: fixture.anchor, issuer_private_key_hex: fixture.issuerPrivateKey, anchoring_private_key_hex: fixture.anchoringPrivateKey },
        expected: { claim: fixture.claim, secured_bytes_hex: fixture.representationHex, digest_hex: fixture.digest, signing_preimage_hex: fixture.signingPreimage, signature_hex: fixture.signature, locking_key_hex: fixture.lockingKey, locking_script_hex: fixture.lockingScript }, tags: ['happy-path'],
      },
      {
        id: 'script-to-metadata', description: 'Verify the anchoring service signature, derivation and exact layout. This does not verify issuer authority or VSC conformance.',
        input: { locking_script_hex: fixture.lockingScript }, expected: { accepted: true, anchor: fixture.anchor, locking_key_hex: fixture.lockingKey }, tags: ['happy-path'],
      },
      refuse('refuse-metadata-tampering', 'Change a signed issuer byte without signing again.', script => { script.chunks[5].data![0] ^= 1 }),
      refuse('refuse-boundary-shift', 'Shift the subject/type boundary without changing concatenated data or the signature.', script => {
        const subject = script.chunks[6].data!
        script.chunks[6].data = subject.slice(0, -1)
        script.chunks[7].data = [subject.at(-1)!, ...script.chunks[7].data!]
        script.chunks[6].op = script.chunks[6].data.length
        script.chunks[7].op = script.chunks[7].data.length
      }),
      refuse('refuse-short-tail', 'Remove one of the required five OP_2DROP opcodes.', script => { script.chunks.pop() }),
      refuse('refuse-trailing-code', 'Append code after the required drop tail.', script => { script.writeOpCode(0x51) }),
      refuse('refuse-uncompressed-key', 'Re-encode the derived locking key as 65 bytes.', script => { script.chunks[0] = { op: 65, data: PublicKey.fromString(fixture.lockingKey).encode(false) as number[] } }),
      refuse('refuse-invalid-utf8', 'Replace the subject with invalid UTF-8.', script => { script.chunks[6] = { op: 2, data: [0xc0, 0xaf] } }),
    ],
  }
}
