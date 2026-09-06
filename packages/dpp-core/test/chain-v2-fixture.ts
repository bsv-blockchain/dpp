import { CachedKeyDeriver, ProtoWallet, PublicKey, Transaction, Utils } from '@bsv/sdk'
import {
  ACCEPTANCE_COMMITMENT_REFUSAL,
  CONTROL_REFUSALS,
  DPP_PROTOCOL_ID,
  OWNER_PROTOCOL_ID,
  buildLockingScript,
  completeState,
  dataFieldsV2,
  ownerBlobHash,
  type DppState,
  type DppStateDataV2,
  type DppStateV2,
} from '../src/index.js'
import { owner1Deriver, owner1Wallet, serverWallet } from './helpers.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'
import {
  BLOB_V2_2,
  PAYLOAD_V2_2,
  authorityPriv,
  authorityWallet,
  buildChainV2Fixture,
  controlLinkageOf,
  controllerKeyOf,
  custodianPriv,
  custodianWallet,
  idKey,
  issuerPriv,
  issuerWallet,
  makeDataV2,
  outpointOf,
  recipientPriv,
  signedStateV2,
  stateTxV2,
  strangerPriv,
  strangerWallet,
} from './helpers-v2.js'

/**
 * One version 2 passport lineage, pinned byte for byte, the broken links a
 * verifier must refuse, and the upgrade of the version 1 fixture chain
 * (`spec/record-model-v2.md` §6 and §8, `spec/managed-custody.md`).
 *
 * Generated, never typed: `fixtures/chain-v2.json` is this function's output
 * verbatim. Every raw transaction is complete: a reader parses `rawTx`, needs
 * no source transactions hydrated, and checks the spend structurally from the
 * input's own outpoint. Inputs are left unsigned because a verifier does not
 * run scripts. The refusal vectors are each one transaction that extends a
 * prefix of the valid chain (`appendAfter` names the last valid state kept,
 * -1 for a lone genesis) and breaks exactly one rule; a conforming verifier
 * reports the chain invalid with the pinned `error` as its reason. A refusal
 * carrying `managedAcceptance: true` breaks the managed-custody profile and is
 * a valid chain when the profile is off; one carrying `acceptedUnder` names the
 * authorities under which the same bytes are accepted.
 *
 * Keys: `11` issuer, `22` custodian and publisher, `33` recipient, `44`
 * stranger, `55` authority, each repeated to 32 bytes; test keys, published on
 * purpose, and nothing derived from them will ever hold a satoshi.
 */

interface Refusal {
  name: string
  description: string
  appendAfter: number
  rawTx: string
  error: string
  managedAcceptance?: true
  acceptedUnder?: { authorities: string[] }
}

const PREV_TXID_STAND_IN = 'aa'.repeat(32)

export async function chainV2Fixture() {
  const { txs, states, outputIndexes, acceptance } = await buildChainV2Fixture()
  const lockKey = custodianPriv.toPublicKey()
  const genesis = outpointOf(txs[0], 0)
  const tip = (i: number) => ({ tx: txs[i], outputIndex: outputIndexes[i] })
  const link = (i: number) => ({ previousTxid: txs[i].id('hex'), previousOutputIndex: outputIndexes[i], lineageGenesis: genesis })

  // A version 2 UPDATE by the issuer over the given prefix state, the ordinary
  // successor most refusals start from.
  const update = (after: number, overrides: Partial<DppStateDataV2> = {}): DppStateDataV2 =>
    makeDataV2({
      op: 'UPDATE',
      timestamp: '2026-09-07T12:00:00Z',
      payloadPublic: PAYLOAD_V2_2,
      controlLinkage: controlLinkageOf(issuerPriv),
      ...link(after),
      ...overrides,
    })
  const append = async (after: number, data: DppStateDataV2, actor: ProtoWallet = issuerWallet, publisher: ProtoWallet = custodianWallet, opReturnFirst = false): Promise<Transaction> => {
    const state = await completeState(data, actor, publisher)
    return stateTxV2(state, lockKey, tip(after), opReturnFirst)
  }
  const appendState = (after: number, state: DppState): Transaction => stateTxV2(state, lockKey, tip(after))

  const refusals: Refusal[] = []
  const refuse = (name: string, description: string, appendAfter: number, tx: Transaction, error: string, extra: Partial<Refusal> = {}): void => {
    refusals.push({ name, description, appendAfter, rawTx: tx.toHex(), error, ...extra })
  }

  // Genesis rules.
  refuse('genesisNotIssue', 'An UPDATE standing alone as a genesis.', -1,
    stateTxV2(await signedStateV2(makeDataV2({ op: 'UPDATE', controlLinkage: controlLinkageOf(issuerPriv) })), lockKey),
    'genesis op must be ISSUE, got UPDATE')
  refuse('genesisWithPredecessor', 'An ISSUE carrying a previous_outpoint.', -1,
    stateTxV2(await signedStateV2(makeDataV2({ previousTxid: PREV_TXID_STAND_IN, previousOutputIndex: 0 })), lockKey),
    'genesis previous_outpoint must be empty')
  refuse('genesisWithLineage', 'An ISSUE carrying a lineage_genesis.', -1,
    stateTxV2(await signedStateV2(makeDataV2({ lineageGenesis: { txid: PREV_TXID_STAND_IN, outputIndex: 0 } })), lockKey),
    'genesis lineage_genesis must be empty')
  refuse('issueAfterGenesis', 'A second ISSUE spending the genesis.', 0,
    await append(0, makeDataV2({ op: 'ISSUE', timestamp: '2026-09-07T12:00:00Z' })),
    'ISSUE is allowed at genesis only')

  // Predecessor and lineage binding.
  refuse('previousOutpointWrongIndex', 'After the TRANSFER whose DPP output sits at index 1, a state naming index 0 while spending index 1.', 2,
    await append(2, makeDataV2({
      op: 'UPDATE', timestamp: '2026-09-09T12:00:00Z', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), actorKeyId: 'recipient account',
      payloadPublic: PAYLOAD_V2_2, payloadOwnerHash: ownerBlobHash(BLOB_V2_2), controlLinkage: controlLinkageOf(recipientPriv),
      ...link(2), previousOutputIndex: 0,
    }), new ProtoWallet(recipientPriv)),
    'previous_outpoint must name the spent tip output')
  refuse('previousOutpointWrongTxid', 'A state naming the genesis as its predecessor while spending the second state.', 1,
    await append(1, update(1, { previousTxid: txs[0].id('hex'), previousOutputIndex: 0 })),
    'previous_outpoint must name the spent tip')
  refuse('previousOutpointEmpty', 'A non-genesis state with an empty previous_outpoint.', 1,
    await append(1, update(1, { previousTxid: '', previousOutputIndex: null })),
    'non-genesis previous_outpoint must be set')
  refuse('lineageGenesisWrong', 'A state naming the second state, not the genesis, as its lineage.', 1,
    await append(1, update(1, { lineageGenesis: outpointOf(txs[1], 0) })),
    'lineage_genesis must name the chain genesis')
  refuse('passportIdChanged', 'A state under another passport identifier.', 1,
    await append(1, update(1, { passportId: 'https://dpp.bsvb.net/01/09521000000018/21/V2-0002' })),
    'passport_id is immutable across the chain')
  refuse('controllerChangedOnUpdate', 'An UPDATE that moves the controller key.', 1,
    await append(1, update(1, { ownerIdentityKey: controllerKeyOf(strangerPriv) })),
    'controller_key changes only on TRANSFER')
  refuse('payloadChangedOnRetire', 'A RETIRE that changes payload_public.', 3,
    await append(3, makeDataV2({
      op: 'RETIRE', timestamp: '2027-03-01T12:00:00Z', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), actorKeyId: 'recipient account',
      eventData: JSON.stringify({ reason: 'recycled' }), payloadPublic: JSON.stringify({ name: 'changed' }), payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
      controlLinkage: controlLinkageOf(recipientPriv), ...link(3),
    }), new ProtoWallet(recipientPriv)),
    'payload_public / payload_owner_hash do not change on RETIRE')

  // Retirement is terminal.
  const afterRetire = (op: 'UPDATE' | 'TRANSFER'): DppStateDataV2 => makeDataV2({
    op, timestamp: '2027-04-01T12:00:00Z', ownerIdentityKey: op === 'TRANSFER' ? controllerKeyOf(strangerPriv) : controllerKeyOf(recipientPriv),
    actorIdentityKey: idKey(recipientPriv), actorKeyId: 'recipient account', payloadPublic: PAYLOAD_V2_2, payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
    controlLinkage: controlLinkageOf(recipientPriv), ...link(4),
  })
  refuse('updateAfterRetire', 'An UPDATE by the controller spending the RETIRE.', 4, await append(4, afterRetire('UPDATE'), new ProtoWallet(recipientPriv)), 'the lineage is retired: no state may follow RETIRE')
  refuse('transferAfterRetire', 'A TRANSFER by the controller spending the RETIRE.', 4, await append(4, afterRetire('TRANSFER'), new ProtoWallet(recipientPriv)), 'the lineage is retired: no state may follow RETIRE')

  // Control.
  refuse('controlNotProven', 'An UPDATE by a stranger with an empty control_linkage.', 1,
    await append(1, update(1, { actorIdentityKey: idKey(strangerPriv), actorKeyId: 'stranger', controlLinkage: '' }), strangerWallet),
    CONTROL_REFUSALS.notProven)
  refuse('controlWrongLinkage', "An UPDATE by a stranger carrying the stranger's own scalar, which links to nothing on this passport.", 1,
    await append(1, update(1, { actorIdentityKey: idKey(strangerPriv), actorKeyId: 'stranger', controlLinkage: controlLinkageOf(strangerPriv) }), strangerWallet),
    CONTROL_REFUSALS.notLinked)
  const issuerControllerPriv = new CachedKeyDeriver(issuerPriv).derivePrivateKey(OWNER_PROTOCOL_ID, states[0].passportId, 'self')
  refuse('controlRedundantLinkage', 'An UPDATE by the controller key itself (equality) that also carries a scalar: one value, one spelling.', 1,
    await append(1, update(1, { actorIdentityKey: issuerControllerPriv.toPublicKey().toString(), actorKeyId: 'controller', controlLinkage: controlLinkageOf(issuerPriv) }), new ProtoWallet(issuerControllerPriv)),
    CONTROL_REFUSALS.redundantLinkage)
  refuse('recoveryWithoutAuthority', 'An UPDATE by the authority key with no control proof: refused unless the profile names it.', 1,
    await append(1, update(1, { actorIdentityKey: idKey(authorityPriv), actorKeyId: 'authority', controlLinkage: '' }), authorityWallet),
    CONTROL_REFUSALS.notProven, { acceptedUnder: { authorities: [idKey(authorityPriv)] } })

  // Versions do not mix except upwards.
  const v1Successor = await completeState({
    passportId: states[0].passportId, op: 'SOLD', timestamp: '2026-09-07T12:00:00Z', ownerIdentityKey: states[1].ownerIdentityKey,
    actorIdentityKey: idKey(issuerPriv), actorKeyId: 'issuer batch 1', eventData: JSON.stringify({ channel: 'store' }),
    payloadPublic: PAYLOAD_V2_2, payloadOwnerHash: states[1].payloadOwnerHash, previousTxid: txs[1].id('hex'),
  }, issuerWallet, custodianWallet)
  refuse('downgradeToVersion1', 'A version 1 SOLD spending a version 2 state.', 1, appendState(1, v1Successor), 'a version 1 state cannot follow a version 2 state')

  // Signatures: the framing and the tags.
  const v1StyleSigned = async (): Promise<DppState> => {
    // A signer that concatenates the version 2 fields unframed under the
    // version 1 protocol: what a version 1 signer would produce if handed the
    // version 2 fields. Its signature verifies under nothing in version 2.
    const data = update(1)
    const unframed = dataFieldsV2(data).flat()
    const { signature: actor } = await issuerWallet.createSignature({ data: unframed, protocolID: DPP_PROTOCOL_ID, keyID: data.actorKeyId, counterparty: 'anyone' })
    const { signature: publisher } = await custodianWallet.createSignature({ data: [...unframed, ...actor], protocolID: DPP_PROTOCOL_ID, keyID: data.passportId, counterparty: 'anyone' })
    return { ...data, protocolMarker: 'dpp', userSignature: actor, serverSignature: publisher }
  }
  refuse('actorSignatureFromVersion1Preimage', 'An UPDATE whose signatures were made over the unframed version 1 preimage under the version 1 protocol: a cross-version replay.', 1,
    appendState(1, await v1StyleSigned()), 'user_signature invalid')
  const swapped = await completeState(update(1), issuerWallet, custodianWallet)
  refuse('publisherSignatureInActorSlot', "An UPDATE with the actor and publisher signatures exchanged: a cross-purpose replay.", 1,
    appendState(1, { ...swapped, userSignature: swapped.serverSignature, serverSignature: swapped.userSignature } as DppStateV2), 'user_signature invalid')

  // The boundary substitution the version 1 contract could not refuse.
  const boundaryA = await completeState(update(1, { eventData: '1', payloadPublic: '23' }), issuerWallet, custodianWallet)
  const boundaryTx = appendState(1, boundaryA)
  refuse('boundarySubstitution', "The state 'boundaryControl' with event_data '1' and payload_public '23' re-split as '12' and '3', both valid JSON, carrying the original's signatures. Under version 1 the two shared a preimage; under version 2 they do not.", 1,
    appendState(1, { ...boundaryA, eventData: '12', payloadPublic: '3' } as DppStateV2), 'user_signature invalid')

  // The managed-custody profile.
  refuse('transferWithoutCommitment', 'A TRANSFER with an empty authorisation_commitment: valid under the record model, refused under the managed-custody profile.', 1,
    await append(1, makeDataV2({
      op: 'TRANSFER', timestamp: '2026-09-08T10:30:00Z', ownerIdentityKey: controllerKeyOf(recipientPriv), payloadPublic: PAYLOAD_V2_2, payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
      controlLinkage: controlLinkageOf(issuerPriv), ...link(1),
    })), ACCEPTANCE_COMMITMENT_REFUSAL, { managedAcceptance: true })

  // The upgrade of the version 1 fixture chain: a version 2 UPDATE by the
  // first owner, who holds the sixth state's controller key, spending its tip.
  const v1 = CHAIN_V1_FIXTURE
  const v1Txs = v1.states.map((s) => Transaction.fromHex(s.rawTx))
  const v1Tip = v1.states[5]
  const v1Genesis = { txid: v1.states[0].txid, outputIndex: v1.states[0].outputIndex }
  const upgradeData = (overrides: Partial<DppStateDataV2> = {}): DppStateDataV2 => ({
    version: '2',
    passportId: v1Tip.data.passportId,
    op: 'UPDATE',
    timestamp: '2028-01-10T09:00:00Z',
    ownerIdentityKey: v1Tip.data.ownerIdentityKey,
    actorIdentityKey: v1.owner1Key,
    actorKeyId: 'owner upgrade 1',
    eventData: JSON.stringify({ note: 'upgraded to record version 2' }),
    payloadPublic: v1Tip.data.payloadPublic,
    payloadOwnerHash: v1Tip.data.payloadOwnerHash,
    previousTxid: v1Tip.txid,
    previousOutputIndex: v1Tip.outputIndex,
    lineageGenesis: v1Genesis,
    controlLinkage: Utils.toHex(owner1Deriver.revealSpecificSecret('self', OWNER_PROTOCOL_ID, v1Tip.data.passportId)),
    ...overrides,
  })
  const upgradeState = await completeState(upgradeData(), owner1Wallet, serverWallet)
  // Locked to the controller key itself, the possession convention the sixth
  // version 1 state already follows (`spec/custody.md` §3).
  const upgradeLock = PublicKey.fromString(v1Tip.data.ownerIdentityKey)
  const upgradeTx = stateTxV2(upgradeState, upgradeLock, { tx: v1Txs[5], outputIndex: v1Tip.outputIndex })
  const upgradeRefusals: Array<{ name: string; description: string; rawTx: string; error: string }> = []
  const upgradeRefuse = async (name: string, description: string, data: DppStateDataV2, error: string): Promise<void> => {
    const state = await completeState(data, owner1Wallet, serverWallet)
    const tx = stateTxV2(state, upgradeLock, { tx: v1Txs[5], outputIndex: v1Tip.outputIndex })
    upgradeRefusals.push({ name, description, rawTx: tx.toHex(), error })
  }
  // The stranger's key: the recipient of the version 2 fixture is the first
  // owner of the version 1 one, so its controller key would be no change.
  await upgradeRefuse('upgradeNotUpdate', 'A version 2 TRANSFER spending the version 1 tip: the upgrade is an UPDATE.', upgradeData({ op: 'TRANSFER', ownerIdentityKey: controllerKeyOf(strangerPriv, v1Tip.data.passportId) }), 'a version 1 state is followed only by a version 2 UPDATE, the upgrade transition')
  await upgradeRefuse('upgradeChangesController', 'A version 2 UPDATE spending the version 1 tip with another controller key.', upgradeData({ ownerIdentityKey: controllerKeyOf(strangerPriv, v1Tip.data.passportId) }), 'the upgrade transition keeps the controller key')
  await upgradeRefuse('upgradeWithoutLineage', 'A version 2 UPDATE spending the version 1 tip that names no lineage genesis.', upgradeData({ lineageGenesis: null }), 'lineage_genesis must name the chain genesis')

  const custodianKey = idKey(custodianPriv)
  return {
    issuerKey: idKey(issuerPriv),
    custodianKey,
    recipientKey: idKey(recipientPriv),
    strangerKey: idKey(strangerPriv),
    authorityKey: idKey(authorityPriv),
    lockingKey: custodianKey,
    ownerProtocol: OWNER_PROTOCOL_ID,
    issuerControllerKey: controllerKeyOf(issuerPriv),
    issuerControlLinkage: controlLinkageOf(issuerPriv),
    recipientControllerKey: controllerKeyOf(recipientPriv),
    recipientControlLinkage: controlLinkageOf(recipientPriv),
    lineageGenesis: genesis,
    acceptance,
    states: states.map((s, i) => {
      const state = s as DppStateV2
      const { protocolMarker: _m, userSignature, serverSignature, ...data } = state
      return {
        actor: i === 0 || i === 1 || i === 2 ? 'issuer' : i === 3 ? 'recipient-controller' : 'recipient',
        data,
        actorSignature: Utils.toHex(userSignature),
        publisherSignature: Utils.toHex(serverSignature),
        txid: txs[i].id('hex'),
        outputIndex: outputIndexes[i],
        lockingKey: custodianKey,
        lockingScript: txs[i].outputs[outputIndexes[i]].lockingScript.toHex(),
        rawTx: txs[i].toHex(),
      }
    }),
    boundaryControl: {
      description: "A valid UPDATE after the second state with event_data '1' and payload_public '23'; the refusal 'boundarySubstitution' re-splits these bytes.",
      appendAfter: 1,
      rawTx: boundaryTx.toHex(),
    },
    refusals,
    upgrade: {
      description: "The version 1 fixture chain's sixth state spent by a version 2 UPDATE from the first owner, who holds its controller key: the lineage keeps its identifier, its genesis and its history, and continues under version 2.",
      version1Fixture: 'fixtures/chain-v1.json',
      data: upgradeData(),
      actorSignature: Utils.toHex(upgradeState.userSignature),
      publisherSignature: Utils.toHex(upgradeState.serverSignature),
      txid: upgradeTx.id('hex'),
      outputIndex: 0,
      lockingKey: v1Tip.data.ownerIdentityKey,
      lockingScript: upgradeTx.outputs[0].lockingScript.toHex(),
      rawTx: upgradeTx.toHex(),
      refusals: upgradeRefusals,
    },
  }
}

export type ChainV2FixtureFile = Awaited<ReturnType<typeof chainV2Fixture>>
