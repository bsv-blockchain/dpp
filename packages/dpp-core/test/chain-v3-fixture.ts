import { CachedKeyDeriver, LockingScript, OP, ProtoWallet, Transaction, UnlockingScript, Utils, type ScriptChunk } from '@bsv/sdk'
import {
  CARRIER_REFUSALS,
  CONTROL_REFUSALS,
  DPP_PROTOCOL_ID_V2,
  DPP_PROTOCOL_ID_V3,
  OWNER_PROTOCOL_ID,
  RECORD_V2_ACTOR_TAG,
  RECORD_V2_PUBLISHER_TAG,
  RECORD_V3_ACTOR_TAG,
  RECORD_V3_PUBLISHER_TAG,
  buildLockingScript,
  dataFieldsV2,
  frameFields,
  ownerBlobHash,
  tokenIdOf,
  tokenIdWireBytes,
  type DppState,
  type DppStateDataV2,
  type DppStateDataV3,
  type Outpoint,
} from '../src/index.js'
import { custodianWallet, idKey, issuerWallet, recipientPriv, recipientWallet, signedStateV2, strangerPriv } from './helpers-v2.js'
import {
  BLOB_V3_2,
  PASSPORT_ID_V3,
  PAYLOAD_V3_2,
  controlLinkageV3,
  controllerKeyV3,
  custodianPriv,
  issuerPriv,
  makeDataV3,
  outpointOfV3,
  signedStateV3,
  stateTxV3,
} from './helpers-v3.js'

/**
 * One carried version 3 lineage, pinned byte for byte, and the broken links a
 * verifier must refuse (`spec/token-carrier.md` §6 to §9).
 *
 * Generated, never typed: `fixtures/chain-v3.json` is this function's output
 * verbatim. Every raw transaction is complete; inputs are left unsigned
 * because a verifier does not run scripts. The refusal vectors are each one
 * transaction that extends a prefix of the valid chain (`appendAfter` names
 * the last valid state kept, -1 for a lone genesis) and breaks exactly one
 * rule. A refusal carrying `brc162Accepts: true` is a valid token output to a
 * generic reader of the token protocol and a refusal here; the difference is
 * the carrier's own rule. The output-level refusals (a wrong amount, a
 * malformed or 36-byte id, a payload) are pinned in `record-v3.json`; at chain
 * level a refused output reads as no DPP output at all. The burn is not a refusal: it is the tip spent by a
 * transaction with no carrier output, which a token reader records as a burn
 * and a passport reader reports as the lineage ended without a RETIRE.
 *
 * Keys: `11` issuer, `22` custodian and publisher (also the lock), `33`
 * recipient, `44` stranger, each repeated to 32 bytes; test keys, published
 * on purpose, and nothing derived from them will ever hold a satoshi.
 */

interface Refusal {
  name: string
  description: string
  appendAfter: number
  rawTx: string
  error: string
  brc162Accepts?: true
}

export interface ChainV3State {
  actor: string
  prefix: { role: 'deploy' | 'value'; amount: number; tokenId: string | null }
  data: DppStateDataV3
  actorSignature: string
  publisherSignature: string
  txid: string
  outputIndex: number
  lockingKey: string
  lockingScript: string
  rawTx: string
}

export async function buildChainV3Fixture(): Promise<{ txs: Transaction[]; states: DppState[]; outputIndexes: number[]; genesis: Outpoint }> {
  const lockKey = custodianPriv.toPublicKey()
  const txs: Transaction[] = []
  const states: DppState[] = []
  const outputIndexes: number[] = []

  const s0 = await signedStateV3(makeDataV3())
  const tx0 = stateTxV3(s0, lockKey)
  txs.push(tx0); states.push(s0); outputIndexes.push(0)
  const genesis = outpointOfV3(tx0, 0)
  const link = (i: number) => ({ previousTxid: txs[i].id('hex'), previousOutputIndex: outputIndexes[i], lineageGenesis: genesis })

  // UPDATE by the issuer account, control by linkage.
  const s1 = await signedStateV3(makeDataV3({ op: 'UPDATE', timestamp: '2026-10-10T09:00:00Z', payloadPublic: PAYLOAD_V3_2, controlLinkage: controlLinkageV3(issuerPriv), ...link(0) }))
  const tx1 = stateTxV3(s1, lockKey, { tx: tx0, outputIndex: 0 })
  txs.push(tx1); states.push(s1); outputIndexes.push(0)

  // TRANSFER to the recipient's controller key, the carrier output behind an OP_RETURN at index 1.
  const s2 = await signedStateV3(
    makeDataV3({
      op: 'TRANSFER',
      timestamp: '2026-10-11T10:30:00Z',
      ownerIdentityKey: controllerKeyV3(recipientPriv),
      eventData: JSON.stringify({ word: 'Passed on' }),
      payloadPublic: PAYLOAD_V3_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V3_2),
      controlLinkage: controlLinkageV3(issuerPriv),
      ...link(1),
    })
  )
  const tx2 = stateTxV3(s2, lockKey, { tx: tx1, outputIndex: 0 }, { opReturnFirst: true })
  txs.push(tx2); states.push(s2); outputIndexes.push(1)

  // UPDATE by the recipient acting under the controller key itself: equality, no linkage.
  const recipientControllerPriv = new CachedKeyDeriver(recipientPriv).derivePrivateKey(OWNER_PROTOCOL_ID, PASSPORT_ID_V3, 'self')
  const s3 = await signedStateV3(
    makeDataV3({
      op: 'UPDATE',
      timestamp: '2026-11-01T08:00:00Z',
      ownerIdentityKey: controllerKeyV3(recipientPriv),
      actorIdentityKey: recipientControllerPriv.toPublicKey().toString(),
      actorKeyId: 'controller',
      eventData: JSON.stringify({ eventType: 'Transformation', note: 'cell balanced' }),
      payloadPublic: PAYLOAD_V3_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V3_2),
      ...link(2),
    }),
    new ProtoWallet(recipientControllerPriv)
  )
  const tx3 = stateTxV3(s3, lockKey, { tx: tx2, outputIndex: 1 })
  txs.push(tx3); states.push(s3); outputIndexes.push(0)

  // RETIRE by the recipient's account, control by linkage: a value output of one unit that nothing may spend.
  const s4 = await signedStateV3(
    makeDataV3({
      op: 'RETIRE',
      timestamp: '2027-03-01T12:00:00Z',
      ownerIdentityKey: controllerKeyV3(recipientPriv),
      actorIdentityKey: idKey(recipientPriv),
      actorKeyId: 'recipient account',
      eventData: JSON.stringify({ reason: 'recycled', evidence: 'urn:sha256:' + 'ab'.repeat(32) }),
      payloadPublic: PAYLOAD_V3_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V3_2),
      controlLinkage: controlLinkageV3(recipientPriv),
      ...link(3),
    }),
    recipientWallet
  )
  const tx4 = stateTxV3(s4, lockKey, { tx: tx3, outputIndex: 0 })
  txs.push(tx4); states.push(s4); outputIndexes.push(0)

  return { txs, states, outputIndexes, genesis }
}

export async function chainV3Fixture() {
  const { txs, states, outputIndexes, genesis } = await buildChainV3Fixture()
  const lockKey = custodianPriv.toPublicKey()
  const tip = (i: number) => ({ tx: txs[i], outputIndex: outputIndexes[i] })
  const link = (i: number) => ({ previousTxid: txs[i].id('hex'), previousOutputIndex: outputIndexes[i], lineageGenesis: genesis })
  const actors = ['issuer', 'issuer', 'issuer', 'recipient-controller', 'recipient']
  const records: ChainV3State[] = states.map((s, i) => {
    const data = Object.fromEntries(Object.entries(s).filter(([k]) => !['userSignature', 'serverSignature', 'protocolMarker'].includes(k))) as DppStateDataV3
    return {
      actor: actors[i],
      prefix: i === 0 ? { role: 'deploy', amount: 1, tokenId: null } : { role: 'value', amount: 1, tokenId: tokenIdOf(genesis) },
      data,
      actorSignature: Utils.toHex(s.userSignature),
      publisherSignature: Utils.toHex(s.serverSignature),
      txid: txs[i].id('hex'),
      outputIndex: outputIndexes[i],
      lockingKey: idKey(custodianPriv),
      lockingScript: txs[i].outputs[outputIndexes[i]].lockingScript.toHex(),
      rawTx: txs[i].toHex(),
    }
  })

  // A version 3 UPDATE by the issuer over the given prefix state, the ordinary successor most refusals start from.
  const update = (after: number, overrides: Partial<DppStateDataV3> = {}): DppStateDataV3 =>
    makeDataV3({ op: 'UPDATE', timestamp: '2026-10-12T12:00:00Z', payloadPublic: PAYLOAD_V3_2, controlLinkage: controlLinkageV3(issuerPriv), ...link(after), ...overrides })
  const refusals: Refusal[] = []
  const refuse = (name: string, description: string, appendAfter: number, tx: Transaction, error: string, extra: Partial<Refusal> = {}): void => {
    refusals.push({ name, description, appendAfter, rawTx: tx.toHex(), error, ...extra })
  }
  const prefixEdit = (edit: (c: ScriptChunk[]) => ScriptChunk[]) => edit

  // The genesis: a deploy at output 0.
  refuse('deployNotAtOutputZero', 'The genesis behind an OP_RETURN, at output 1.', -1,
    stateTxV3(states[0], lockKey, undefined, { opReturnFirst: true }), CARRIER_REFUSALS.genesisNotAtOutputZero)
  refuse('deployCarryingTokenId', 'A genesis body behind a value prefix naming a token id.', -1,
    stateTxV3(states[0], lockKey, undefined, { carrier: { role: 'value', tokenId: 'cd'.repeat(32) } }), CARRIER_REFUSALS.genesisCarriesTokenId, { brc162Accepts: true })

  // Every later state: a value output of one unit naming the lineage genesis.
  refuse('valueWithEmptyId', 'A state after genesis behind a deploy prefix.', 0,
    stateTxV3(await signedStateV3(update(0)), lockKey, tip(0), { carrier: { role: 'deploy', tokenId: null } }), CARRIER_REFUSALS.stateNotValue, { brc162Accepts: true })
  refuse('tokenIdNotLineageGenesis', 'A value output naming another deploy as its token id.', 0,
    stateTxV3(await signedStateV3(update(0)), lockKey, tip(0), { carrier: { role: 'value', tokenId: 'ef'.repeat(32) } }), CARRIER_REFUSALS.tokenIdMismatch, { brc162Accepts: true })
  refuse('tokenIdDisplayOrder', 'The token id written in display byte order: another token to every reader.', 0,
    stateTxV3(await signedStateV3(update(0)), lockKey, tip(0), { editPrefix: prefixEdit((c) => { c[0] = { op: 32, data: Utils.toArray(genesis.txid, 'hex') }; return c }) }), CARRIER_REFUSALS.tokenIdMismatch, { brc162Accepts: true })
  refuse('versionTwoBehindPrefix', 'A version 2 body, signed under the version 2 protocol, behind the prefix: no DPP output to this reader.', 0,
    await (async () => {
      const state = await signedStateV2({ ...update(0), version: '2' } as DppStateDataV2, issuerWallet, custodianWallet)
      const body = buildLockingScript(state, lockKey)
      const tx = new Transaction()
      tx.addInput({ sourceTransaction: txs[0], sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
      tx.addOutput({ satoshis: 1, lockingScript: new LockingScript([...carrierValuePrefix(genesis.txid), ...body.chunks]) })
      return tx
    })(),
    'exactly one DPP output required, found 0')
  refuse('versionThreeWithoutPrefix', 'A version 3 body with no prefix.', 0,
    stateTxV3(await signedStateV3(update(0)), lockKey, tip(0), { editPrefix: prefixEdit((c) => c.slice(3)) }), 'exactly one DPP output required, found 0')
  refuse('signedUnderVersionTwoProtocol', 'A version 3 body whose signatures were made under the version 2 protocol and tags.', 0,
    await (async () => {
      const d = update(0)
      const fields = dataFieldsV2(d)
      const { signature: u } = await issuerWallet.createSignature({ data: frameFields([Utils.toArray(RECORD_V2_ACTOR_TAG, 'utf8'), ...fields]), protocolID: DPP_PROTOCOL_ID_V2, keyID: d.actorKeyId, counterparty: 'anyone' })
      const { signature: s } = await custodianWallet.createSignature({ data: frameFields([Utils.toArray(RECORD_V2_PUBLISHER_TAG, 'utf8'), ...fields, u]), protocolID: DPP_PROTOCOL_ID_V2, keyID: d.passportId, counterparty: 'anyone' })
      return stateTxV3({ ...d, protocolMarker: 'dpp', userSignature: u, serverSignature: s } as DppState, lockKey, tip(0))
    })(),
    'user_signature invalid')

  // Chain rules the carrier keeps from version 2.
  refuse('stateAfterRetire', 'An UPDATE spending the RETIRE.', 4,
    stateTxV3(await signedStateV3(makeDataV3({ op: 'UPDATE', timestamp: '2027-04-01T12:00:00Z', ownerIdentityKey: controllerKeyV3(recipientPriv), actorIdentityKey: idKey(recipientPriv), actorKeyId: 'recipient account', payloadPublic: PAYLOAD_V3_2, payloadOwnerHash: ownerBlobHash(BLOB_V3_2), controlLinkage: controlLinkageV3(recipientPriv), ...link(4) }), recipientWallet), lockKey, tip(4)),
    'the lineage is retired: no state may follow RETIRE')
  refuse('twoCarrierOutputs', 'Two value outputs of the token in one transaction.', 0,
    (() => {
      const tx = stateTxV3(states[1], lockKey, tip(0))
      tx.addOutput({ satoshis: 1, lockingScript: tx.outputs[0].lockingScript })
      return tx
    })(),
    'exactly one DPP output required, found 2')
  refuse('strangerWithoutControl', 'A stranger spending the tip with no control proof.', 0,
    stateTxV3(await signedStateV3(update(0, { actorIdentityKey: idKey(strangerPriv), actorKeyId: 'stranger', controlLinkage: '' }), new ProtoWallet(strangerPriv)), lockKey, tip(0)),
    CONTROL_REFUSALS.notProven)
  refuse('issueAfterGenesis', 'A second ISSUE, as a value output, spending the genesis.', 0,
    stateTxV3(await signedStateV3(makeDataV3({ op: 'ISSUE', timestamp: '2026-10-12T12:00:00Z' })), lockKey, tip(0), { carrier: { role: 'value', tokenId: genesis.txid } }),
    'ISSUE is allowed at genesis only')

  // The burn: the tip after state 1 spent by a transaction with no carrier output.
  const burnTx = new Transaction()
  burnTx.addInput({ sourceTransaction: txs[1], sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  burnTx.addOutput({ satoshis: 1, lockingScript: new LockingScript([{ op: OP.OP_DUP }, { op: OP.OP_HASH160 }, { op: 20, data: Array<number>(20).fill(0) }, { op: OP.OP_EQUALVERIFY }, { op: OP.OP_CHECKSIG }]) })

  return {
    issuerKey: idKey(issuerPriv),
    custodianKey: idKey(custodianPriv),
    recipientKey: idKey(recipientPriv),
    strangerKey: idKey(strangerPriv),
    lockingKey: idKey(custodianPriv),
    protocol: DPP_PROTOCOL_ID_V3,
    actorTag: RECORD_V3_ACTOR_TAG,
    publisherTag: RECORD_V3_PUBLISHER_TAG,
    ownerProtocol: OWNER_PROTOCOL_ID,
    issuerControllerKey: controllerKeyV3(issuerPriv),
    issuerControlLinkage: controlLinkageV3(issuerPriv),
    recipientControllerKey: controllerKeyV3(recipientPriv),
    recipientControlLinkage: controlLinkageV3(recipientPriv),
    lineageGenesis: genesis,
    tokenId: tokenIdOf(genesis),
    tokenIdWire: Utils.toHex(tokenIdWireBytes(genesis.txid)),
    states: records,
    refusals,
    burn: {
      description: 'The tip after state 1 spent by a transaction with no carrier output. A token reader records a burn; a passport reader finds no state in the transaction, reports the lineage as ended without a RETIRE and the tip as spent.',
      appendAfter: 1,
      rawTx: burnTx.toHex(),
      error: 'exactly one DPP output required, found 0',
    },
  }
}

export type ChainV3FixtureFile = Awaited<ReturnType<typeof chainV3Fixture>>

function carrierValuePrefix(genesisTxid: string) {
  return [{ op: 32, data: tokenIdWireBytes(genesisTxid) }, { op: OP.OP_1 }, { op: OP.OP_2DROP }]
}
