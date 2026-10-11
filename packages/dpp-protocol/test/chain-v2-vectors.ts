import type { ChainV2FixtureFile } from './chain-v2-fixture.js'

/**
 * The version 2 chain fixture in the BSV stack's cross-language conformance
 * vector format, as a pure mapping from the generated object.
 * `fixtures/vectors/dpp/chain/v2.json` is this function's output, verbatim.
 * Vector identifiers are permanent once published and the file is append-only.
 */
const PRIVATE_KEYS: Record<string, string> = {
  issuer: '11'.repeat(32),
  custodian: '22'.repeat(32),
  recipient: '33'.repeat(32),
  stranger: '44'.repeat(32),
  authority: '55'.repeat(32),
  owner1: '33'.repeat(32),
}

const STATE_DESCRIPTIONS = [
  'Genesis: ISSUE by the issuer, the controller key being the issuer account\'s per-passport child under [1, \'dpp owner v1\'], locked to the custodian. Lineage and predecessor fields empty (spec record-model-v2.md sections 2 to 6).',
  'UPDATE by the issuer account changing the payload: predecessor outpoint and lineage genesis bound, control proved by linkage (field 14 is the scalar with the previous controller key equal to field 7 plus the scalar times G).',
  'TRANSFER by the issuer account to the recipient\'s controller key under the managed-custody profile: field 15 commits to the acceptance record the custodian signed, control proved by linkage, the DPP output at index 1 behind an OP_RETURN so the outpoint field is tested rather than assumed.',
  'UPDATE by the recipient acting under the controller key itself: the equality form of control, field 14 empty.',
  'RETIRE by the recipient account, control proved by linkage, event_data carrying the reason; the lineage is terminal from here.',
]

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

export function chainV2Vectors(F: ChainV2FixtureFile) {
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
        actor_signature_hex: s.actorSignature,
        publisher_signature_hex: s.publisherSignature,
        locking_script_hex: s.lockingScript,
        output_index: s.outputIndex,
        txid_hex: s.txid,
        raw_tx_hex: s.rawTx,
      },
      tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48'],
    }
  })

  const controlVectors = [
    {
      id: 'control-issuer',
      description: 'The issuer account\'s controller key for the passport and the scalar that proves the account derived it: controller_key = identity_key + scalar times G.',
      input: { root_private_key_hex: PRIVATE_KEYS.issuer, passport_id: F.states[0].data.passportId, protocol: F.ownerProtocol, counterparty: 'self' },
      expected: { root_public_key_hex: F.issuerKey, controller_key_hex: F.issuerControllerKey, linkage_hex: F.issuerControlLinkage, linkage_verifies: true },
      tags: ['happy-path', 'brc-42', 'brc-43'],
    },
    {
      id: 'control-recipient',
      description: 'The recipient account\'s controller key and scalar, the destination the TRANSFER moves control to.',
      input: { root_private_key_hex: PRIVATE_KEYS.recipient, passport_id: F.states[0].data.passportId, protocol: F.ownerProtocol, counterparty: 'self' },
      expected: { root_public_key_hex: F.recipientKey, controller_key_hex: F.recipientControllerKey, linkage_hex: F.recipientControlLinkage, linkage_verifies: true },
      tags: ['happy-path', 'brc-42', 'brc-43'],
    },
  ]

  const verifyVector = {
    id: 'verify-chain',
    description:
      'Verify the five raw transactions as a chain, genesis to tip, under the managed-custody profile with no header source: every actor signature verifies, every link holds including control, every publisher signature verifies under the custodian key, the TRANSFER carries its acceptance commitment, and the tip is a RETIRE.',
    input: { raw_tx_hex: F.states.map((s) => s.rawTx), publisher_identity_key_hex: F.custodianKey, managed_acceptance: true },
    expected: {
      valid: true,
      spv: 'pending',
      states: F.states.map((s, i) => ({ op: s.data.op, actor_signature_valid: true, publisher_signature_valid: true, linkage_valid: true, control_valid: i === 0 ? null : true })),
    },
    tags: ['happy-path', 'brc-42', 'brc-43'],
  }

  const boundaryControl = {
    id: 'boundary-control',
    description: F.boundaryControl.description,
    input: { raw_tx_hex: [...F.states.slice(0, F.boundaryControl.appendAfter + 1).map((s) => s.rawTx), F.boundaryControl.rawTx] },
    expected: { valid: true, spv: 'pending' },
    tags: ['happy-path', 'brc-42'],
  }

  const refusalVectors = F.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description,
    input: {
      raw_tx_hex: [...F.states.slice(0, r.appendAfter + 1).map((s) => s.rawTx), r.rawTx],
      ...(r.managedAcceptance == null ? {} : { managed_acceptance: true }),
    },
    expected: {
      accepted: false,
      stage: 'chain',
      reason: r.error,
      ...(r.managedAcceptance == null ? {} : { accepted_without_managed_acceptance: true }),
      ...(r.acceptedUnder == null ? {} : { accepted_with_authorities: r.acceptedUnder.authorities }),
    },
    tags: ['error-case'],
  }))

  const v1Prefix = 'the six raw transactions of fixtures/chain-v1.json'
  const upgradeVector = {
    id: 'upgrade-from-version-1',
    description: F.upgrade.description,
    input: {
      version1_fixture: F.upgrade.version1Fixture,
      data: F.upgrade.data,
      actor_private_key_hex: PRIVATE_KEYS.owner1,
      publisher_private_key_hex: PRIVATE_KEYS.custodian,
      locking_key_hex: F.upgrade.lockingKey,
      signature_nonce: 'rfc6979',
    },
    expected: {
      actor_signature_hex: F.upgrade.actorSignature,
      publisher_signature_hex: F.upgrade.publisherSignature,
      locking_script_hex: F.upgrade.lockingScript,
      output_index: F.upgrade.outputIndex,
      txid_hex: F.upgrade.txid,
      raw_tx_hex: F.upgrade.rawTx,
      valid_after: v1Prefix,
    },
    tags: ['happy-path', 'brc-42', 'brc-43', 'brc-48'],
  }
  const upgradeRefusals = F.upgrade.refusals.map((r) => ({
    id: `refuse-${kebab(r.name)}`,
    description: r.description,
    input: { version1_fixture: F.upgrade.version1Fixture, raw_tx_hex: [r.rawTx] },
    expected: { accepted: false, stage: 'chain', reason: r.error, after: v1Prefix },
    tags: ['error-case'],
  }))

  return {
    $schema:
      'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
    id: 'dpp.chain.v2',
    name: 'DPP record model v2: a passport lineage, its links, control, retirement, the managed-custody profile and the upgrade',
    brc: ['BRC-42', 'BRC-43', 'BRC-48'],
    version: '1.0.0',
    reference_impl: 'dpp-core@0.3.0',
    parity_class: 'required',
    vectors: [...stateVectors, ...controlVectors, verifyVector, boundaryControl, ...refusalVectors, upgradeVector, ...upgradeRefusals],
  }
}
