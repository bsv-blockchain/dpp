import { LockingScript, Utils } from '@bsv/sdk'
import { ANCHOR_V3_FIXTURE } from './anchor-v3-fixture.js'

/**
 * The anchor fixture in the BSV stack's cross-language conformance vector format
 * (`conformance/VECTOR-FORMAT.md` in bsv-blockchain/ts-stack), as a pure mapping
 * from the bespoke object, the way the core's `chain-v1-vectors.ts` maps the
 * chain. `fixtures/vectors/dpp/anchor/v3.json` is this function's output,
 * verbatim, and `fixture-json.test.ts` holds the two identical, so neither form
 * of the anchor fixture is ever edited by hand (`fixtures/README.md`, "Two
 * forms, one set of bytes").
 *
 * The vector file carries four refusals the bespoke fixture does not: one over
 * each of the three length bounds in `spec/rules.md` §5, and a claim whose
 * `passportId` exceeds the bound §3 sets. They are built here from the pinned
 * output rather than pinned again: the overlong field is swapped into the
 * genuine script as a minimal push and every other chunk, the signature
 * included, is left exactly as written. A conforming reader refuses each at the
 * bound, before it reaches the signature, so the signature need not cover the
 * new field, and building them this way keeps the bespoke fixture (which three
 * repositories hold verbatim) unchanged.
 *
 * Vector identifiers are permanent once published and the file is append-only:
 * a corrected expectation is a new vector, never an edit.
 */
const PRIVATE_KEYS = {
  anchoring: '77'.repeat(32),
  issuer: '88'.repeat(32),
}

const MAX_ATTESTATION_ID = 256
const MAX_SUBJECT = 512
const MAX_TYPE = 64

const OP_PUSHDATA1 = 0x4c
const OP_PUSHDATA2 = 0x4d

/** `value` extended with `A`s (after `separator`) to exactly `length` characters. */
function overlong(value: string, length: number, separator = ''): string {
  return value + separator + 'A'.repeat(length - value.length - separator.length)
}

/**
 * The genuine script with the field at `index` (0-based among the eight)
 * replaced by `text` as a minimal push. The locking key, the other fields, the
 * signature and the tail are untouched.
 */
function withField(lockingScript: string, index: number, text: string): string {
  const chunks = LockingScript.fromHex(lockingScript).chunks.map((chunk) => ({ ...chunk }))
  const data = Utils.toArray(text, 'utf8')
  const op = data.length <= 75 ? data.length : data.length <= 0xff ? OP_PUSHDATA1 : OP_PUSHDATA2
  chunks[2 + index] = { op, data }
  return new LockingScript(chunks).toHex()
}

export function anchorV3Vectors(F: typeof ANCHOR_V3_FIXTURE = ANCHOR_V3_FIXTURE) {
  const claimToAnchor = {
    id: 'claim-to-anchor',
    description:
      "Canonicalise the claim (spec rules.md section 4), hash it, derive the locking key as the BRC-42 child of the anchoring service's key for protocol [1, 'uora anchor v3'], key identifier the attestation id, counterparty anyone, sign the length-delimited preimage of fields 1 to 7 with RFC 6979 nonces, and build the eight-field locking script (section 5). The private keys are synthetic test keys, published deliberately.",
    input: {
      attestation: F.attestation,
      attestation_id: F.attestationId,
      issuer_private_key_hex: PRIVATE_KEYS.issuer,
      anchoring_private_key_hex: PRIVATE_KEYS.anchoring,
      signature_nonce: 'rfc6979',
    },
    expected: {
      canonical: F.canonical,
      digest_hex: F.digest,
      issuer_did: F.issuerDid,
      issuer_key_hex: F.issuerKey,
      anchored_by_hex: F.anchoredBy,
      locking_key_hex: F.lockingKey,
      locking_script_hex: F.lockingScript,
    },
    tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48'],
  }

  const scriptToFields = {
    id: 'script-to-fields',
    description:
      "Parse the locking script to its eight fields, verify the field-8 signature over the SHA-256 of the length-delimited preimage against the field-7 key's derived child, and check the locking key equals that child (spec rules.md section 6).",
    input: { locking_script_hex: F.lockingScript },
    expected: {
      locking_key_hex: F.lockingKey,
      fields: {
        prefix: 'uora-anchor-v3',
        digest_hex: F.digest,
        attestation_id: F.attestationId,
        issuer: F.issuerDid,
        subject: F.subject,
        type: F.uoraType,
        anchored_by_hex: F.anchoredBy,
      },
      signature_valid: true,
      locking_key_matches_derivation: true,
    },
    tags: ['happy-path', 'brc-42', 'brc-48'],
  }

  /** A script a conforming reader refuses while decoding, with the reason it names. */
  const refusal = (id: string, description: string, lockingScript: string, reason: string) => ({
    id,
    description,
    input: {
      locking_script_hex: lockingScript,
      anchoring_identity_key_hex: F.anchoredBy,
    },
    expected: { accepted: false, stage: 'decode', reason },
    tags: ['error-case', 'brc-48'],
  })

  const boundaryShifted = F.boundaryShifted.map((hex, i) =>
    refusal(
      `refuse-boundary-shift-${i + 1}`,
      'Fields 5 and 6 re-cut at a different boundary with the signature bytes untouched. Verified under the superseded v2 layout, which is why the length-delimited preimage exists.',
      hex,
      'field-8 signature does not verify over the length-delimited preimage'
    )
  )

  const uncompressedKey = refusal(
    'refuse-uncompressed-key',
    'The locking key re-pushed in the 65-byte uncompressed spelling. Attribution still matches after decoding, which is exactly why a lenient reader admitted it invisibly; a conforming reader refuses it at the push.',
    F.uncompressedKey,
    'locking key push is not 33 bytes'
  )

  const TAIL_REASON = 'drop tail is not exactly four OP_2DROP'
  const malformedTail = [
    refusal('refuse-tail-short', 'One OP_2DROP short of the four the eight fields need.', F.malformedTail[0], TAIL_REASON),
    refusal(
      'refuse-tail-wrong-opcodes',
      'The right drop total spelled with OP_DROP pairs instead of OP_2DROP.',
      F.malformedTail[1],
      TAIL_REASON
    ),
    refusal('refuse-tail-trailing-chunk', 'A trailing chunk after a correct tail.', F.malformedTail[2], TAIL_REASON),
  ]

  const overlongFields = [
    refusal(
      'refuse-overlong-attestation-id',
      `Field 3 at ${MAX_ATTESTATION_ID + 1} characters, one over its bound. The bound is part of the format: an index admits from whoever can reach it.`,
      withField(F.lockingScript, 2, overlong(F.attestationId, MAX_ATTESTATION_ID + 1)),
      `attestation id exceeds ${MAX_ATTESTATION_ID} characters`
    ),
    refusal(
      'refuse-overlong-subject',
      `Field 5 at ${MAX_SUBJECT + 1} characters, one over its bound.`,
      withField(F.lockingScript, 4, overlong(F.subject, MAX_SUBJECT + 1, '/')),
      `subject exceeds ${MAX_SUBJECT} characters`
    ),
    refusal(
      'refuse-overlong-type',
      `Field 6 at ${MAX_TYPE + 1} characters, one over its bound.`,
      withField(F.lockingScript, 5, overlong(F.uoraType, MAX_TYPE + 1)),
      `type exceeds ${MAX_TYPE} characters`
    ),
  ]

  const overlongClaim = {
    id: 'refuse-overlong-claim-passport-id',
    description: `A claim whose passportId is ${MAX_SUBJECT + 1} bytes, one over the bound spec rules.md section 3 sets because the field is the signature's BRC-42 key identifier. Refused before canonicalisation or signing.`,
    input: {
      attestation: { ...F.attestation, passportId: overlong(F.attestation.passportId, MAX_SUBJECT + 1, '/') },
    },
    expected: { accepted: false, stage: 'claim', reason: `passportId exceeds ${MAX_SUBJECT} bytes` },
    tags: ['error-case', 'brc-42'],
  }

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.anchor.v3',
    name: 'uora-anchor-v3: an attestation claim to its anchor output and back',
    brc: ['BRC-42', 'BRC-43', 'BRC-48'],
    version: '1.0.0',
    reference_impl: 'dpp-overlay-topics@0.1.0',
    parity_class: 'required',
    vectors: [
      claimToAnchor,
      scriptToFields,
      ...boundaryShifted,
      uncompressedKey,
      ...malformedTail,
      ...overlongFields,
      overlongClaim,
    ],
  }
}
