import { CachedKeyDeriver, LockingScript, OP, Utils, type ScriptChunk } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID_V2,
  RECORD_V2_ACTOR_TAG,
  RECORD_V2_PUBLISHER_TAG,
  actorPreimageV2,
  buildLockingScript,
  publisherPreimageV2,
  type DppStateV2,
} from '../src/index.js'
import { BLOB_V2_1, custodianPriv, idKey, issuerPriv, makeDataV2, signedStateV2 } from './helpers-v2.js'

/**
 * One DPP record-model version 2 output, pinned byte for byte, and the
 * malformed variants a reader must refuse (`spec/record-model-v2.md`).
 *
 * Generated, never typed: `fixtures/record-v2.json` is this function's output
 * verbatim and `fixture-json.test.ts` holds the two identical, so a change to
 * a field, a framing rule, a tag or a derivation goes red with a diff. The
 * keys are `11` (issuer) and `22` (custodian and publisher), repeated to 32
 * bytes; test keys, published on purpose, and nothing derived from them will
 * ever hold a satoshi.
 *
 * What the refusals carry, one leniency each: the version 1 field count with
 * the version 2 version string and the reverse, so a reader that reads the
 * count without the version or the version without the count refuses both; a
 * drop tail one short and one with the odd OP_DROP missing; a 35-byte outpoint
 * and a 31-byte control scalar; a control scalar on an ISSUE; event_data one
 * byte over its bound; and a version string this reader does not know.
 */

function rechunk(script: LockingScript, edit: (chunks: ScriptChunk[]) => ScriptChunk[]): string {
  return new LockingScript(edit(script.chunks.map((c) => ({ ...c })))).toHex()
}

export async function recordV2Fixture() {
  const data = makeDataV2()
  const state = (await signedStateV2(data)) as DppStateV2
  const lockingKey = idKey(custodianPriv)
  const script = buildLockingScript(state, lockingKey)
  const anyone = new CachedKeyDeriver('anyone')
  const fieldIndex = (name: number): number => 2 + name

  const push = (bytes: number[]): ScriptChunk =>
    bytes.length === 0 ? { op: 0 } : { op: bytes.length <= 75 ? bytes.length : bytes.length <= 255 ? 0x4c : 0x4d, data: bytes }
  const withField = (index: number, bytes: number[]): string =>
    rechunk(script, (chunks) => {
      chunks[fieldIndex(index)] = push(bytes)
      return chunks
    })

  // A version 2 version string on the fourteen-field layout: the version 1
  // reader would refuse it by version, the version 2 reader by count.
  const v1Layout = rechunk(script, (chunks) => {
    const fields = chunks.slice(2, 2 + 17)
    const fourteen = [...fields.slice(0, 12), fields[15], fields[16]]
    return [chunks[0], chunks[1], ...fourteen, ...Array<ScriptChunk>(7).fill({ op: OP.OP_2DROP })]
  })
  const versionOne = withField(1, Utils.toArray('1', 'utf8'))
  const versionThree = withField(1, Utils.toArray('3', 'utf8'))
  const tailShort = rechunk(script, (chunks) => chunks.slice(0, -1))
  const tailNoOddDrop = rechunk(script, (chunks) => [...chunks.slice(0, -1), { op: OP.OP_2DROP }])
  const outpointShort = withField(12, Array<number>(35).fill(0xab))
  const linkageShort = withField(13, Array<number>(31).fill(0xcd))
  const linkageOnIssue = withField(13, Array<number>(32).fill(0xcd))
  const eventOverBound = withField(8, Utils.toArray(JSON.stringify({ pad: 'x'.repeat(4097 - 10) }), 'utf8'))

  return {
    issuerKey: idKey(issuerPriv),
    custodianKey: lockingKey,
    lockingKey,
    state: data,
    ownerBlob: Utils.toHex(BLOB_V2_1),
    actorTag: RECORD_V2_ACTOR_TAG,
    publisherTag: RECORD_V2_PUBLISHER_TAG,
    protocol: DPP_PROTOCOL_ID_V2,
    actorPreimage: Utils.toHex(actorPreimageV2(data)),
    actorSignature: Utils.toHex(state.userSignature),
    publisherPreimage: Utils.toHex(publisherPreimageV2(data, state.userSignature)),
    publisherSignature: Utils.toHex(state.serverSignature),
    actorVerificationKey: anyone.derivePublicKey(DPP_PROTOCOL_ID_V2, data.actorKeyId, data.actorIdentityKey).toString(),
    publisherVerificationKey: anyone.derivePublicKey(DPP_PROTOCOL_ID_V2, data.passportId, lockingKey).toString(),
    lockingScript: script.toHex(),
    refusals: [
      { name: 'v1LayoutWithVersion2', reason: 'version "2" is carried by the 17-field layout, not the 14-field one', lockingScript: v1Layout },
      { name: 'v2LayoutWithVersion1', reason: 'version "1" is carried by the 14-field layout, not the 17-field one', lockingScript: versionOne },
      { name: 'unsupportedVersion', reason: 'unsupported standard version "3"', lockingScript: versionThree },
      { name: 'tailShort', reason: 'malformed drop tail', lockingScript: tailShort },
      { name: 'tailWithoutOddDrop', reason: 'malformed drop tail', lockingScript: tailNoOddDrop },
      { name: 'outpointWrongLength', reason: 'previous_outpoint must be empty or 36 bytes', lockingScript: outpointShort },
      { name: 'linkageWrongLength', reason: 'control_linkage must be empty or 32 bytes', lockingScript: linkageShort },
      { name: 'linkageOnIssue', reason: 'control_linkage must be empty on ISSUE', lockingScript: linkageOnIssue },
      { name: 'eventDataOverBound', reason: 'event_data exceeds 4096 bytes', lockingScript: eventOverBound },
    ],
  }
}
