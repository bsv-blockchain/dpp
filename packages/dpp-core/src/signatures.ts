import { CachedKeyDeriver, Signature, Utils, type WalletProtocol } from '@bsv/sdk'
import {
  DPP_PROTOCOL_ID,
  DPP_PROTOCOL_ID_V2,
  PROTOCOL_MARKER,
  RECORD_V2_ACTOR_TAG,
  RECORD_V2_PUBLISHER_TAG,
  STANDARD_VERSION,
} from './constants.js'
import { dataFields, dataFieldsV2, isV2Data } from './codec.js'
import type { AnyDppStateData, DppState, DppStateData, DppStateDataV2 } from './types.js'

/**
 * Canonical version 1 user-signature preimage (`spec/record-model.md` §5): the
 * concatenated raw bytes of fields 1–12 in standard order - never a JSON
 * serialization.
 *
 * Framing note: §5 mandates plain concatenation, so the preimage bytes alone
 * do not bind field boundaries. Boundary uniqueness comes from field
 * validation (op enum, ISO timestamp, fixed-width keys/hashes, JSON rules)
 * plus the chain invariants (genesis must be ACTIVATE, spend linkage,
 * passport_id immutability), which together block re-split states from
 * verifying in any spec-sanctioned consumer. Version 2 replaces this with a
 * framed, domain-tagged preimage (`actorPreimageV2`); version 1 keeps it
 * because a published state keeps the contract it was signed under.
 */
export function userPreimageV1(d: DppStateData): number[] {
  return dataFields(d).flat()
}

/** Canonical version 1 server-signature preimage: fields 1–13 (user preimage + user_signature). */
export function serverPreimageV1(d: DppStateData, userSignature: number[]): number[] {
  return [...userPreimageV1(d), ...userSignature]
}

/**
 * Length framing (`spec/record-model-v2.md` §5): each item as its Bitcoin
 * VarInt byte length followed by its bytes, in order. The same framing the
 * anchor rail uses (`spec/rules.md` §5), so one rule serves both.
 */
export function frameFields(items: number[][]): number[] {
  const writer = new Utils.Writer()
  for (const item of items) {
    writer.writeVarIntNum(item.length)
    writer.write(item)
  }
  return writer.toArray()
}

/**
 * The version 2 actor preimage: the actor tag, then fields 1–15, every item
 * length-framed. Two field tuples that differ anywhere produce different
 * bytes, and the tag keeps a signature made for the publisher role, or for
 * version 1, from verifying here.
 */
export function actorPreimageV2(d: DppStateDataV2): number[] {
  return frameFields([Utils.toArray(RECORD_V2_ACTOR_TAG, 'utf8'), ...dataFieldsV2(d)])
}

/** The version 2 publisher preimage: the publisher tag, fields 1–15 and the actor signature, every item length-framed. */
export function publisherPreimageV2(d: DppStateDataV2, actorSignature: number[]): number[] {
  return frameFields([Utils.toArray(RECORD_V2_PUBLISHER_TAG, 'utf8'), ...dataFieldsV2(d), actorSignature])
}

/** The actor's preimage under the version the data declares: version 1 unframed, version 2 framed and tagged. */
export function userPreimage(d: AnyDppStateData): number[] {
  return isV2Data(d) ? actorPreimageV2(d) : userPreimageV1(d)
}

/** The publisher's preimage under the version the data declares. */
export function serverPreimage(d: AnyDppStateData, userSignature: number[]): number[] {
  return isV2Data(d) ? publisherPreimageV2(d, userSignature) : serverPreimageV1(d, userSignature)
}

/** The BRC-43 protocol both signatures of a state derive under: one per version, so keys never cross. */
export function protocolIdFor(d: object): WalletProtocol {
  return isV2Data(d) ? DPP_PROTOCOL_ID_V2 : DPP_PROTOCOL_ID
}

/**
 * The signing capability dpp-core needs: satisfied by @bsv/sdk ProtoWallet
 * (backend, holds a root key) and by a BRC-100 WalletClient (connected path).
 * createSignature signs ECDSA over sha256(data) with the BRC-42 child key for
 * (protocolID, keyID, counterparty).
 */
export interface DataSigner {
  createSignature: (args: {
    data: number[]
    protocolID: WalletProtocol
    keyID: string
    counterparty: string
  }) => Promise<{ signature: number[] }>
}

/** Deriver for counterparty-'anyone' verification keys (rootKey = 1). */
const anyone = new CachedKeyDeriver('anyone')

/**
 * Create the actor signature (field 13 in version 1, field 16 in version 2):
 * the actor signs the version's actor preimage with the child key for
 * (the version's protocol, actor_keyID, counterparty 'anyone').
 */
export async function createUserSignature(
  d: AnyDppStateData,
  actorWallet: DataSigner
): Promise<number[]> {
  const { signature } = await actorWallet.createSignature({
    data: userPreimage(d),
    protocolID: protocolIdFor(d),
    keyID: d.actorKeyId,
    counterparty: 'anyone',
  })
  return signature
}

/**
 * Create the publisher signature (field 14 in version 1, field 17 in version
 * 2): the service signs the version's publisher preimage with the child key
 * for (the version's protocol, keyID = passport_id, counterparty 'anyone').
 * keyID is pinned to passport_id so verifiers can re-derive the service child
 * key from on-chain data plus the published service identity key (§5).
 */
export async function createServerSignature(
  d: AnyDppStateData,
  userSignature: number[],
  serverWallet: DataSigner
): Promise<number[]> {
  const { signature } = await serverWallet.createSignature({
    data: serverPreimage(d, userSignature),
    protocolID: protocolIdFor(d),
    keyID: d.passportId,
    counterparty: 'anyone',
  })
  return signature
}

/** Sign the actor and publisher preimages and assemble the complete state of the version the data declares. */
export async function completeState(
  d: AnyDppStateData,
  actorWallet: DataSigner,
  serverWallet: DataSigner
): Promise<DppState> {
  const userSignature = await createUserSignature(d, actorWallet)
  const serverSignature = await createServerSignature(d, userSignature, serverWallet)
  if (isV2Data(d)) {
    return { ...d, protocolMarker: PROTOCOL_MARKER, userSignature, serverSignature }
  }
  return {
    ...d,
    protocolMarker: PROTOCOL_MARKER,
    version: STANDARD_VERSION,
    userSignature,
    serverSignature,
  }
}

/**
 * Verify the actor signature against actor_identity_key + actor_keyID (§5;
 * §8 check 1), under the version the state carries. Open verification: the
 * key is derived with counterparty 'anyone', so no wallet or secret is needed.
 */
export function verifyUserSignature(state: DppState): boolean {
  try {
    const pub = anyone.derivePublicKey(
      protocolIdFor(state),
      state.actorKeyId,
      state.actorIdentityKey
    )
    return pub.verify(userPreimage(state), Signature.fromDER(state.userSignature))
  } catch {
    return false
  }
}

/**
 * Verify the publisher signature against a configured service identity key.
 * Admission policy, not token validity (§5).
 */
export function verifyServerSignature(
  state: DppState,
  serverIdentityKey: string
): boolean {
  try {
    const pub = anyone.derivePublicKey(
      protocolIdFor(state),
      state.passportId,
      serverIdentityKey
    )
    return pub.verify(
      serverPreimage(state, state.userSignature),
      Signature.fromDER(state.serverSignature)
    )
  } catch {
    return false
  }
}
