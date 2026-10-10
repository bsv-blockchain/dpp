import { CachedKeyDeriver, LockingScript, OP, Utils, type ScriptChunk } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID_V3,
  RECORD_V3_ACTOR_TAG,
  RECORD_V3_PUBLISHER_TAG,
  actorPreimageV3,
  buildLockingScript,
  publisherPreimageV3,
  tokenIdOf,
  tokenIdWireBytes,
  type DppStateV3,
} from '../src/index.js'
import { idKey } from './helpers-v2.js'
import { BLOB_V3_1, PAYLOAD_V3_2, controlLinkageV3, custodianPriv, issuerPriv, makeDataV3, signedStateV3, stateTxV3 } from './helpers-v3.js'

/**
 * One carried version 3 output of each role, pinned byte for byte, and the
 * malformed variants a reader must refuse (`spec/token-carrier.md` §2 to §4).
 *
 * Generated, never typed: `fixtures/record-v3.json` is this function's output
 * verbatim and `fixture-json.test.ts` holds the two identical. The keys are
 * `11` (issuer) and `22` (custodian and publisher), repeated to 32 bytes;
 * test keys, published on purpose, and nothing derived from them will ever
 * hold a satoshi.
 *
 * What the refusals carry, one leniency each: a prefix without its OP_2DROP;
 * the amount of one as a one-byte data push rather than OP_1, which the token
 * protocol refuses as non-minimal; an amount of two and an amount of zero,
 * which the token protocol reads as a value of two and an authority and this
 * document refuses outright; a token id of the wrong length; an empty
 * payload slot on a value output, which the token protocol accepts and this
 * document does not; a version 2 body behind the prefix and a version 3 body
 * without one, so one version has one layout; a drop tail one short; and the
 * locking key in its uncompressed spelling. One accepted variant sits beside
 * them: the genesis with an empty payload slot, which the token protocol's
 * encoder rule allows on a deploy.
 */

function rechunk(script: LockingScript, edit: (chunks: ScriptChunk[]) => ScriptChunk[]): string {
  return new LockingScript(edit(script.chunks.map((c) => ({ ...c })))).toHex()
}

export async function recordV3Fixture() {
  const lockingKey = idKey(custodianPriv)
  const anyone = new CachedKeyDeriver('anyone')

  // The genesis: a fixed-supply deploy of one unit, at output 0 of its transaction.
  const genesisData = makeDataV3()
  const genesisState = (await signedStateV3(genesisData)) as DppStateV3
  const genesisTx = stateTxV3(genesisState, lockingKey)
  const genesisScript = genesisTx.outputs[0].lockingScript
  const genesis = { txid: genesisTx.id('hex'), outputIndex: 0 }

  // A value output: the first state after the genesis, naming it as the token id.
  const valueData = makeDataV3({
    op: 'UPDATE',
    timestamp: '2026-10-10T09:00:00Z',
    payloadPublic: PAYLOAD_V3_2,
    previousTxid: genesis.txid,
    previousOutputIndex: 0,
    lineageGenesis: genesis,
    controlLinkage: controlLinkageV3(issuerPriv),
  })
  const valueState = (await signedStateV3(valueData)) as DppStateV3
  const valueScript = buildLockingScript(valueState, lockingKey)

  const pins = (data: typeof genesisData, state: DppStateV3) => ({
    state: data,
    actorPreimage: Utils.toHex(actorPreimageV3(data)),
    actorSignature: Utils.toHex(state.userSignature),
    publisherPreimage: Utils.toHex(publisherPreimageV3(data, state.userSignature)),
    publisherSignature: Utils.toHex(state.serverSignature),
    actorVerificationKey: anyone.derivePublicKey(DPP_PROTOCOL_ID_V3, data.actorKeyId, data.actorIdentityKey).toString(),
    publisherVerificationKey: anyone.derivePublicKey(DPP_PROTOCOL_ID_V3, data.passportId, lockingKey).toString(),
  })

  const push = (bytes: number[]): ScriptChunk => (bytes.length === 0 ? { op: 0 } : { op: bytes.length <= 75 ? bytes.length : 0x4c, data: bytes })
  // The body's field n (1-based) sits at chunk 3 + 2 + (n - 1) behind a prefix of three chunks.
  const bodyField = (index: number): number => 3 + 2 + index

  const prefixMissingDrop = rechunk(valueScript, (c) => [c[0], c[1], ...c.slice(3)])
  const amountNonMinimal = rechunk(valueScript, (c) => [c[0], { op: 1, data: [1] }, ...c.slice(2)])
  const amountTwo = rechunk(valueScript, (c) => [c[0], { op: OP.OP_2 }, ...c.slice(2)])
  const amountZero = rechunk(valueScript, (c) => [c[0], { op: 0 }, ...c.slice(2)])
  const tokenIdWrongLength = rechunk(valueScript, (c) => [{ op: 31, data: Array<number>(31).fill(0xab) }, ...c.slice(1)])
  const tokenIdThirtySixBytes = rechunk(valueScript, (c) => [{ op: 36, data: [...tokenIdWireBytes(genesis.txid), 0, 0, 0, 0] }, ...c.slice(1)])
  const payloadOnValueOutput = rechunk(valueScript, (c) => [c[0], c[1], c[2], { op: 0 }, { op: OP.OP_DROP }, ...c.slice(3)])
  const payloadOnGenesis = rechunk(genesisScript, (c) => [c[0], c[1], c[2], { op: 2, data: [0xa0, 0x00] }, { op: OP.OP_DROP }, ...c.slice(3)])
  const versionTwoBehindPrefix = rechunk(valueScript, (c) => {
    c[bodyField(1)] = push(Utils.toArray('2', 'utf8'))
    return c
  })
  const versionThreeWithoutPrefix = rechunk(valueScript, (c) => c.slice(3))
  const bodyTailShort = rechunk(valueScript, (c) => c.slice(0, -1))
  const lockingKeyUncompressed = rechunk(valueScript, (c) => {
    c[3] = { op: 65, data: Array<number>(65).fill(0x04) }
    return c
  })
  const genesisWithEmptyPayload = rechunk(genesisScript, (c) => [c[0], c[1], c[2], { op: 0 }, { op: OP.OP_DROP }, ...c.slice(3)])

  return {
    issuerKey: idKey(issuerPriv),
    custodianKey: lockingKey,
    lockingKey,
    ownerBlob: Utils.toHex(BLOB_V3_1),
    actorTag: RECORD_V3_ACTOR_TAG,
    publisherTag: RECORD_V3_PUBLISHER_TAG,
    protocol: DPP_PROTOCOL_ID_V3,
    genesis: {
      prefix: 'OP_0 OP_1 OP_2DROP',
      ...pins(genesisData, genesisState),
      lockingScript: genesisScript.toHex(),
      txid: genesis.txid,
      tokenId: tokenIdOf(genesis),
      tokenIdWire: Utils.toHex(tokenIdWireBytes(genesis.txid)),
    },
    value: {
      prefix: '<32-byte token id> OP_1 OP_2DROP',
      tokenId: tokenIdOf(genesis),
      ...pins(valueData, valueState),
      lockingScript: valueScript.toHex(),
    },
    accepted: [
      { name: 'genesisWithEmptyPayload', reason: 'a deploy may carry an empty payload slot; the body is unchanged', lockingScript: genesisWithEmptyPayload },
    ],
    refusals: [
      { name: 'prefixMissingDrop', reason: 'malformed token prefix', lockingScript: prefixMissingDrop },
      { name: 'amountNonMinimal', reason: 'the token amount is a minimally encoded script number', lockingScript: amountNonMinimal },
      { name: 'amountTwo', reason: 'the token amount is 1', lockingScript: amountTwo },
      { name: 'amountZero', reason: 'the token amount is 1', lockingScript: amountZero },
      { name: 'tokenIdWrongLength', reason: 'not a DPP output: missing 33-byte locking key push', lockingScript: tokenIdWrongLength },
      { name: 'tokenIdThirtySixBytes', reason: 'the token id is the 32-byte deploy txid', lockingScript: tokenIdThirtySixBytes },
      { name: 'payloadOnValueOutput', reason: 'a value output carries no payload', lockingScript: payloadOnValueOutput },
      { name: 'payloadOnGenesis', reason: 'a genesis carries no payload beyond an empty slot', lockingScript: payloadOnGenesis },
      { name: 'versionTwoBehindPrefix', reason: 'version "2" is not carried behind a token prefix', lockingScript: versionTwoBehindPrefix },
      { name: 'versionThreeWithoutPrefix', reason: 'version "3" is carried behind a token prefix', lockingScript: versionThreeWithoutPrefix },
      { name: 'bodyTailShort', reason: 'malformed drop tail', lockingScript: bodyTailShort },
      { name: 'lockingKeyUncompressed', reason: 'not a DPP output: missing 33-byte locking key push', lockingScript: lockingKeyUncompressed },
    ],
  }
}
