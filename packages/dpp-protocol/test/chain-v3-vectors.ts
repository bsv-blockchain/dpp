import type { ChainV3FixtureFile } from './chain-v3-fixture.js'

/**
 * The version 3 chain fixture in the BSV stack's cross-language conformance
 * vector format, as a pure mapping from the generated object.
 * `fixtures/vectors/dpp/chain/v3.json` is this function's output, verbatim.
 * Vector identifiers are permanent once published and the file is append-only.
 */
const PRIVATE_KEYS: Record<string, string> = {
  issuer: '11'.repeat(32),
  custodian: '22'.repeat(32),
  recipient: '33'.repeat(32),
  stranger: '44'.repeat(32),
}

const STATE_DESCRIPTIONS = [
  "Genesis: ISSUE by the issuer carried as a fixed-supply BRC-162 deploy of one unit at output 0 (prefix OP_0 OP_1 OP_2DROP), the controller key being the issuer account's per-passport child under [1, 'dpp owner v1'], locked to the custodian. The token id is this outpoint (spec token-carrier.md sections 2 to 6).",
  'UPDATE by the issuer account changing the payload, carried as a value output naming the genesis as its token id: predecessor outpoint and lineage genesis bound, control proved by linkage.',
  "TRANSFER by the issuer account to the recipient's controller key, the carrier output at index 1 behind an OP_RETURN so a value output away from index 0 is tested rather than assumed; control proved by linkage.",
  'UPDATE by the recipient acting under the controller key itself: the equality form of control, field 14 empty.',
  'RETIRE by the recipient account, control proved by linkage, event_data carrying the reason: a value output of one unit that nothing may spend; to a token reader the unit is live, to a passport reader the lineage is ended.',
]

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

export function chainV3Vectors(F: ChainV3FixtureFile) {
  const actorKey = (actor: string): string => (actor === 'recipient-controller' ? 'derived' : PRIVATE_KEYS[actor])
  const stateVectors = F.states.map((s, i) => {
    const prev = i === 0 ? undefined : F.states[i - 1]
    return {
      id: `state-${i + 1}-${s.data.op.toLowerCase()}`,
      description: STATE_DESCRIPTIONS[i],
      input: {
        data: s.data,
        ...(actorKey(s.actor) === 'derived'
          ? { actor_private_key_derivation: { root_private_key_hex: PRIVATE_KEYS.recipient, protocol: F.ownerProtocol, key_id: s.data.passportId, counterparty: 'self' } }
          : { actor_private_key_hex: actorKey(s.actor) }),
        publisher_private_key_hex: PRIVATE_KEYS.custodian,
        locking_key_hex: s.lockingKey,
        ...(prev == null ? {} : { previous_raw_tx_hex: prev.rawTx, previous_output_index: prev.outputIndex }),
        op_return_first: s.outputIndex === 1,
        signature_nonce: 'rfc6979',
      },
      expected: {
        prefix: s.prefix,
        actor_signature_hex: s.actorSignature,
        publisher_signature_hex: s.publisherSignature,
        locking_script_hex: s.lockingScript,
        output_index: s.outputIndex,
        txid_hex: s.txid,
        raw_tx_hex: s.rawTx,
      },
      tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48', 'brc-162'],
    }
  })

  const tokenIdVector = {
    id: 'token-id',
    description: 'The token id of the lineage: the genesis outpoint, written on the wire as the deploy txid in internal byte order with the index implied, and displayed as the txid in display order followed by _0.',
    input: { genesis_txid_hex: F.lineageGenesis.txid, genesis_output_index: F.lineageGenesis.outputIndex },
    expected: { token_id: F.tokenId, token_id_wire_hex: F.tokenIdWire },
    tags: ['happy-path', 'brc-162'],
  }

  const controlVectors = [
    {
      id: 'control-issuer',
      description: "The issuer account's controller key for the passport and the scalar that proves the account derived it.",
      input: { root_private_key_hex: PRIVATE_KEYS.issuer, passport_id: F.states[0].data.passportId, protocol: F.ownerProtocol, counterparty: 'self' },
      expected: { root_public_key_hex: F.issuerKey, controller_key_hex: F.issuerControllerKey, linkage_hex: F.issuerControlLinkage, linkage_verifies: true },
      tags: ['happy-path', 'brc-42', 'brc-43'],
    },
    {
      id: 'control-recipient',
      description: "The recipient account's controller key and scalar, the destination the TRANSFER moves control to.",
      input: { root_private_key_hex: PRIVATE_KEYS.recipient, passport_id: F.states[0].data.passportId, protocol: F.ownerProtocol, counterparty: 'self' },
      expected: { root_public_key_hex: F.recipientKey, controller_key_hex: F.recipientControllerKey, linkage_hex: F.recipientControlLinkage, linkage_verifies: true },
      tags: ['happy-path', 'brc-42', 'brc-43'],
    },
  ]

  const verifyVector = {
    id: 'verify-chain',
    description: 'Verify the five raw transactions genesis to tip from hex alone: every state decodes from behind its prefix, the genesis is a deploy at output 0, every later state is a value output naming the genesis, every actor signature verifies under the version 3 protocol, every link holds with control proven, and the publisher signatures verify under the custodian key.',
    input: { raw_tx_hex: F.states.map((s) => s.rawTx), publisher_identity_key_hex: F.custodianKey },
    expected: {
      valid: true,
      token_id: F.tokenId,
      ops: F.states.map((s) => s.data.op),
      output_indexes: F.states.map((s) => s.outputIndex),
      control_valid: [null, true, true, true, true],
    },
    tags: ['happy-path', 'brc-42', 'brc-48', 'brc-162'],
  }

  const refusalVectors = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description + (r.brc162Accepts ? ' A generic reader of the token protocol accepts this output; the refusal is the carrier\'s own rule.' : ''),
    input: { raw_tx_hex: [...F.states.slice(0, r.appendAfter + 1).map((s) => s.rawTx), r.rawTx] },
    expected: { accepted: false, stage: 'chain', reason: r.error, after: r.appendAfter, ...(r.brc162Accepts ? { brc162_accepts: true } : {}) },
    tags: ['error-case', 'brc-162'],
  }))

  const burnVector = {
    id: 'burn-without-retire',
    description: F.burn.description,
    input: { raw_tx_hex: [...F.states.slice(0, F.burn.appendAfter + 1).map((s) => s.rawTx), F.burn.rawTx] },
    expected: { accepted: false, stage: 'chain', reason: F.burn.error, after: F.burn.appendAfter, lineage_ended_without_retire: true },
    tags: ['error-case', 'brc-162'],
  }

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.chain.v3',
    name: 'DPP record version 3: a carried passport lineage, its token id, control, retirement and the refusals',
    brc: ['BRC-42', 'BRC-43', 'BRC-48', 'BRC-162'],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.3.0',
    parity_class: 'required',
    vectors: [...stateVectors, tokenIdVector, ...controlVectors, verifyVector, ...refusalVectors, burnVector],
  }
}
