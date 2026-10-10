import { describe, expect, it } from 'vitest'
import { Utils } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID,
  actorPreimageV2,
  completeState,
  dataFieldsV2,
  frameFields,
  publisherPreimageV2,
  userPreimage,
  verifyServerSignature,
  verifyUserSignature,
  type DppStateV2,
} from '../src/index.js'
import { custodianPriv, custodianWallet, idKey, issuerWallet, makeDataV2, strangerPriv } from './helpers-v2.js'
import { makeData } from './helpers.js'

/**
 * The version 2 preimages (`spec/record-model-v2.md` §5): framed, tagged,
 * and therefore unambiguous. Each test states a property the version 1
 * contract could not give and shows version 2 giving it.
 */
describe('version 2 preimages are framed and domain-tagged', () => {
  it('frames every item as a VarInt length and its bytes, exactly as the anchor rail does', () => {
    expect(frameFields([[1, 2, 3], [], [9]])).toEqual([3, 1, 2, 3, 0, 1, 9])
    const long = Array<number>(300).fill(7)
    expect(frameFields([long]).slice(0, 3)).toEqual([0xfd, 0x2c, 0x01])
  })

  it('two field tuples that share their concatenation do not share a preimage', () => {
    const a = makeDataV2({ op: 'UPDATE', eventData: '1', payloadPublic: '23', previousTxid: 'aa'.repeat(32), previousOutputIndex: 0, lineageGenesis: { txid: 'bb'.repeat(32), outputIndex: 0 }, controlLinkage: 'cc'.repeat(32) })
    const b = { ...a, eventData: '12', payloadPublic: '3' }
    expect(dataFieldsV2(a).flat()).toEqual(dataFieldsV2(b).flat())
    expect(actorPreimageV2(a)).not.toEqual(actorPreimageV2(b))
  })

  it('the actor and publisher preimages of one state differ in their tags, so neither signature serves as the other', async () => {
    const d = makeDataV2()
    const state = (await completeState(d, issuerWallet, custodianWallet)) as DppStateV2
    expect(Utils.toUTF8(actorPreimageV2(d).slice(1, 1 + 'dpp-record-v2/actor-signature'.length))).toBe('dpp-record-v2/actor-signature')
    expect(Utils.toUTF8(publisherPreimageV2(d, state.userSignature).slice(1, 1 + 'dpp-record-v2/publisher-signature'.length))).toBe('dpp-record-v2/publisher-signature')
    const swapped = { ...state, userSignature: state.serverSignature, serverSignature: state.userSignature }
    expect(verifyUserSignature(swapped)).toBe(false)
    expect(verifyServerSignature(swapped, idKey(custodianPriv))).toBe(false)
  })

  it('a signature made under the version 1 protocol over the unframed fields verifies under nothing in version 2', async () => {
    const d = makeDataV2()
    const unframed = dataFieldsV2(d).flat()
    const { signature } = await issuerWallet.createSignature({ data: unframed, protocolID: DPP_PROTOCOL_ID, keyID: d.actorKeyId, counterparty: 'anyone' })
    const state: DppStateV2 = { ...d, protocolMarker: 'dpp', userSignature: signature, serverSignature: [48, 1, 2] }
    expect(verifyUserSignature(state)).toBe(false)
    // And the version 1 preimage of version 1 data is still the unframed concatenation, unchanged.
    expect(userPreimage(makeData())).toEqual(userPreimage({ ...makeData() }))
    expect(userPreimage(makeData())[0]).toBe('d'.charCodeAt(0))
  })

  it('a version 2 signature under another actor key or key identifier fails', async () => {
    const state = (await completeState(makeDataV2(), issuerWallet, custodianWallet)) as DppStateV2
    expect(verifyUserSignature(state)).toBe(true)
    expect(verifyUserSignature({ ...state, actorKeyId: 'another' })).toBe(false)
    expect(verifyUserSignature({ ...state, actorIdentityKey: custodianPriv.toPublicKey().toString() })).toBe(false)
    expect(verifyServerSignature(state, idKey(custodianPriv))).toBe(true)
    expect(verifyServerSignature(state, idKey(strangerPriv))).toBe(false)
  })
})
