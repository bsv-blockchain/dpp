import { RECORD_V1_FIXTURE } from './record-v1-fixture.js'

/**
 * The record fixture in the BSV stack's cross-language conformance vector format
 * (`conformance/VECTOR-FORMAT.md` in bsv-blockchain/ts-stack), as a pure mapping
 * from the bespoke object, the way `chain-v1-vectors.ts` maps the chain.
 * `fixtures/vectors/dpp/record/v1.json` is this function's output, verbatim, and
 * `fixture-json.test.ts` holds the two identical, so neither form of the record
 * fixture is ever edited by hand (`fixtures/README.md`, "Two forms, one set of
 * bytes").
 *
 * The vectors publish the test private keys so a writer in any language
 * reproduces the pinned bytes rather than only checking them. Vector identifiers
 * are permanent once published and the file is append-only: a corrected
 * expectation is a new vector, never an edit.
 */
const PRIVATE_KEYS = {
  actor: '11'.repeat(32),
  server: '22'.repeat(32),
  owner: '33'.repeat(32),
}

/**
 * One refusal per leniency the reader has lost, in the order the bespoke fixture
 * lists them. The reason is the standard's wording for the refusal, not the
 * codec's error message: a port in another language reports the rule it applied,
 * not this implementation's string.
 */
const REFUSALS: ReadonlyArray<{
  id: string
  description: string
  script: (F: typeof RECORD_V1_FIXTURE) => string
  reason: string
}> = [
  {
    id: 'refuse-uncompressed-key',
    description:
      'The locking key re-pushed in the 65-byte uncompressed spelling. Refused at the push; the spec requires the compressed encoding.',
    script: (F) => F.uncompressedKey,
    reason: 'locking key push is not 33 bytes',
  },
  {
    id: 'refuse-tail-short',
    description: 'One OP_2DROP short of the seven the fourteen fields need.',
    script: (F) => F.malformedTail[0],
    reason: 'drop tail is not exactly seven OP_2DROP',
  },
  {
    id: 'refuse-tail-wrong-opcodes',
    description: 'The right drop total spelled with OP_DROP pairs instead of OP_2DROP.',
    script: (F) => F.malformedTail[1],
    reason: 'drop tail is not exactly seven OP_2DROP',
  },
  {
    id: 'refuse-tail-trailing-chunk',
    description: 'A trailing chunk after a correct tail.',
    script: (F) => F.malformedTail[2],
    reason: 'drop tail is not exactly seven OP_2DROP',
  },
  {
    id: 'refuse-rolled-timestamp',
    description:
      'Field 5 as 2026-02-30T00:00:00Z, a date the calendar does not contain; hosts that roll it into March accepted it invisibly.',
    script: (F) => F.rolledTimestamp,
    reason: 'timestamp is not a real calendar instant',
  },
  {
    id: 'refuse-mangled-utf8',
    description:
      'payload_public as the bytes 22 ff 22: invalid UTF-8 whose lossy decode is valid JSON. Refused at the bytes, not after them.',
    script: (F) => F.mangledUtf8,
    reason: 'field declared UTF-8 does not round-trip',
  },
  {
    id: 'refuse-nul-passport-id',
    description: 'passport_id pushed non-minimally as the single byte 0x00, which no field may be.',
    script: (F) => F.nulPassportId,
    reason: 'single byte 0x00 is not a field value',
  },
  {
    id: 'refuse-empty-pushdata',
    description:
      "event_data's OP_0 re-encoded as a zero-length PUSHDATA1; OP_0 is the only accepted encoding of the empty field.",
    script: (F) => F.emptyPushdata,
    reason: 'empty field encoded other than OP_0',
  },
  {
    id: 'refuse-overlong-passport-id',
    description:
      'passport_id at 513 bytes, one over the 512-byte bound the spec sets because the field is a BRC-42 key identifier.',
    script: (F) => F.overlongPassportId,
    reason: 'passport_id exceeds 512 bytes',
  },
]

export function recordV1Vectors(F: typeof RECORD_V1_FIXTURE = RECORD_V1_FIXTURE) {
  const stateToScript = {
    id: 'state-to-script',
    description:
      "Sign the twelve data fields as actor and as service, then build the fourteen-field locking script. Signatures are ECDSA with RFC 6979 nonces over SHA-256 of the stated preimages, under BRC-42 children for protocol [1, 'dpp token v1'], counterparty anyone (spec record-model.md sections 2 and 5). The private keys are synthetic test keys, published deliberately.",
    input: {
      state: F.state,
      owner_blob_hex: F.ownerBlob,
      actor_private_key_hex: PRIVATE_KEYS.actor,
      server_private_key_hex: PRIVATE_KEYS.server,
      owner_private_key_hex: PRIVATE_KEYS.owner,
      locking_key_hex: F.lockingKey,
      signature_nonce: 'rfc6979',
    },
    expected: {
      user_preimage_hex: F.userPreimage,
      user_signature_hex: F.userSignature,
      server_preimage_hex: F.serverPreimage,
      server_signature_hex: F.serverSignature,
      user_verification_key_hex: F.userVerificationKey,
      server_verification_key_hex: F.serverVerificationKey,
      locking_script_hex: F.lockingScript,
    },
    tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48'],
  }

  const scriptToState = {
    id: 'script-to-state',
    description:
      "Parse the locking script back to the state, re-derive the user verification key from fields 7 and 8 with no secret, and verify the user signature. The server signature verifies under the service's published identity key, which is admission policy and not token validity.",
    input: {
      locking_script_hex: F.lockingScript,
      server_identity_key_hex: F.serverKey,
    },
    expected: {
      locking_key_hex: F.lockingKey,
      state: F.state,
      user_signature_hex: F.userSignature,
      server_signature_hex: F.serverSignature,
      user_verification_key_hex: F.userVerificationKey,
      user_signature_valid: true,
      server_verification_key_hex: F.serverVerificationKey,
      server_signature_valid: true,
    },
    tags: ['happy-path', 'brc-42', 'brc-48'],
  }

  const refusalVectors = REFUSALS.map((r) => ({
    id: r.id,
    description: r.description,
    input: { locking_script_hex: r.script(F) },
    expected: { accepted: false, stage: 'decode', reason: r.reason },
    tags: ['error-case', 'brc-48'],
  }))

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.record.v1',
    name: 'DPP record model v1: a state to its output and back',
    brc: ['BRC-42', 'BRC-43', 'BRC-48'],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.1.0',
    parity_class: 'required',
    vectors: [stateToScript, scriptToState, ...refusalVectors],
  }
}
