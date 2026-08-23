import { CachedKeyDeriver, Signature, type WalletProtocol } from '@bsv/sdk'
import { DPP_PROTOCOL_ID, PROTOCOL_MARKER, STANDARD_VERSION } from './constants.js'
import { dataFields } from './codec.js'
import type { DppState, DppStateData } from './types.js'

/**
 * Canonical user-signature preimage (`spec/record-model.md` §5): the concatenated raw bytes of
 * fields 1–12 in standard order - never a JSON serialization.
 *
 * Framing note: §5 mandates plain concatenation, so the preimage bytes alone
 * do not bind field boundaries. Boundary uniqueness comes from field
 * validation (op enum, ISO timestamp, fixed-width keys/hashes, JSON rules)
 * plus the chain invariants (genesis must be ACTIVATE, spend linkage,
 * passport_id immutability), which together block re-split states from
 * verifying in any spec-sanctioned consumer.
 */
export function userPreimage(d: DppStateData): number[] {
  return dataFields(d).flat()
}

/** Canonical server-signature preimage: fields 1–13 (user preimage + user_signature). */
export function serverPreimage(d: DppStateData, userSignature: number[]): number[] {
  return [...userPreimage(d), ...userSignature]
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
 * Create user_signature (field 13): actor signs fields 1–12 with the child
 * key for (DPP_PROTOCOL_ID, actor_keyID, counterparty 'anyone').
 */
export async function createUserSignature(
  d: DppStateData,
  actorWallet: DataSigner
): Promise<number[]> {
  const { signature } = await actorWallet.createSignature({
    data: userPreimage(d),
    protocolID: DPP_PROTOCOL_ID,
    keyID: d.actorKeyId,
    counterparty: 'anyone',
  })
  return signature
}

/**
 * Create server_signature (field 14): the service signs fields 1–13 with the
 * child key for (DPP_PROTOCOL_ID, keyID = passport_id, counterparty 'anyone').
 * keyID is pinned to passport_id so verifiers can re-derive the service child
 * key from on-chain data plus the published service identity key (§5).
 */
export async function createServerSignature(
  d: DppStateData,
  userSignature: number[],
  serverWallet: DataSigner
): Promise<number[]> {
  const { signature } = await serverWallet.createSignature({
    data: serverPreimage(d, userSignature),
    protocolID: DPP_PROTOCOL_ID,
    keyID: d.passportId,
    counterparty: 'anyone',
  })
  return signature
}

/** Sign fields 1–12 and 1–13 and assemble the complete 14-field state. */
export async function completeState(
  d: DppStateData,
  actorWallet: DataSigner,
  serverWallet: DataSigner
): Promise<DppState> {
  const userSignature = await createUserSignature(d, actorWallet)
  const serverSignature = await createServerSignature(d, userSignature, serverWallet)
  return {
    ...d,
    protocolMarker: PROTOCOL_MARKER,
    version: STANDARD_VERSION,
    userSignature,
    serverSignature,
  }
}

/**
 * Verify user_signature against actor_identity_key + actor_keyID (§5;
 * §8 check 1). Open verification: the key is derived with counterparty
 * 'anyone', so no wallet or secret is needed.
 */
export function verifyUserSignature(state: DppState): boolean {
  try {
    const pub = anyone.derivePublicKey(
      DPP_PROTOCOL_ID,
      state.actorKeyId,
      state.actorIdentityKey
    )
    return pub.verify(userPreimage(state), Signature.fromDER(state.userSignature))
  } catch {
    return false
  }
}

/**
 * Verify server_signature against a configured service identity key.
 * Admission policy, not token validity (§5).
 */
export function verifyServerSignature(
  state: DppState,
  serverIdentityKey: string
): boolean {
  try {
    const pub = anyone.derivePublicKey(
      DPP_PROTOCOL_ID,
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
