import { CachedKeyDeriver, PublicKey, Utils } from '@bsv/sdk'
import { DPP_PROTOCOL_ID } from './constants.js'
import type { DppState } from './types.js'

/**
 * `did:key` for the identity keys this standard already carries, and the one
 * derivation step a verifier needs to get from a DID back to a signature.
 *
 * **Additive by construction.** Nothing here touches the field layout, the field
 * count, either signature preimage or the codec: it re-encodes bytes that are
 * already on chain and re-derives a key that is already derivable. Hard rule 3
 * holds, and no published record moves.
 *
 * **Why it lives in the token core rather than in a consumer.** The standard
 * says actor identity keys must be representable as `did:key`, so token
 * signatures and SD-JWT attestations are provably the same actor, and the
 * derivation lives beside the signatures it explains (`spec/identity.md`).
 *
 * **The step nobody had written down, and the reason `signingPublicKeyFor`
 * exists.** `actor_identity_key` (field 7) is the BRC-42 *parent*. The key that
 * actually signs is its child at `(DPP_PROTOCOL_ID, actor_keyID, 'anyone')`, which
 * is what `verifyUserSignature` derives. So there are two candidate DIDs per actor
 * and the difference matters to exactly one reader: someone holding an SD-JWT whose
 * `iss` is a `did:key`, trying to reach the chain. Give them the parent and they
 * cannot verify a signature; give them the child and they cannot find the actor.
 * They need both and the step between, which `@bsv/did` does not supply because it
 * knows nothing of BRC-42.
 *
 * **No new dependency.** `@bsv/did` 0.1.1 would do the encoding and is compatible
 * with the pinned `@bsv/sdk` 2.1.4, but it pulls `qrcode` into a package that
 * promises to stay dependency-light. The encoding below is the same
 * fifteen lines that library's `multibase.ts` runs, over the SDK's own base58.
 */

/**
 * The multicodec prefix for a compressed secp256k1 public key: unsigned varint
 * `0xe7`, which is two bytes once encoded. Fixed by the multicodec table, not by
 * us, and the reason a `did:key` for this curve always starts `did:key:zQ3s`.
 */
const SECP256K1_PUB_MULTICODEC = [0xe7, 0x01]

/** Multibase's prefix for base58btc. One character, and it is not optional. */
const BASE58BTC = 'z'

const anyone = new CachedKeyDeriver('anyone')

/** Thrown when a string is not a DID this method can read. */
export class DidFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DidFormatError'
  }
}

/**
 * The canonical compressed key, or a refusal.
 *
 * The same rule the codec applies to fields 6 and 7 (`identityKeyHex`): the SDK
 * accepts `x >= p` by reducing mod p, so a non-canonical encoding would produce a
 * DID that resolves to a key nobody can find on chain.
 */
function canonicalKey(hex: string): PublicKey {
  let parsed: PublicKey
  try {
    parsed = PublicKey.fromString(hex)
  } catch {
    throw new DidFormatError('not a valid public key')
  }
  if (parsed.toString() !== hex) {
    throw new DidFormatError('not a canonical compressed public key')
  }
  return parsed
}

/**
 * A `did:key` for a 33-byte compressed secp256k1 identity key.
 *
 * Pure, offline and bidirectional: no registry, no network call, and the DID
 * document is computable from the string alone. That is the property that makes
 * this worth doing at all, because it means a verifier needs nothing from us
 * except the key we already published on chain.
 */
export function didKeyFromIdentityKey(identityKeyHex: string): string {
  const key = canonicalKey(identityKeyHex)
  const bytes = [...SECP256K1_PUB_MULTICODEC, ...(key.encode(true) as number[])]
  return `did:key:${BASE58BTC}${Utils.toBase58(bytes)}`
}

/**
 * The identity key inside a `did:key`, or a refusal.
 *
 * Refuses another curve rather than returning bytes that would fail to verify
 * later: an Ed25519 DID is a well-formed `did:key` and a meaningless secp256k1
 * identity key, and the difference is two bytes at the front.
 */
export function identityKeyFromDidKey(did: string): string {
  if (!did.startsWith(`did:key:${BASE58BTC}`)) {
    throw new DidFormatError('not a did:key in base58btc')
  }
  let bytes: number[]
  try {
    bytes = Utils.fromBase58(did.slice(`did:key:${BASE58BTC}`.length))
  } catch {
    throw new DidFormatError('did:key is not valid base58btc')
  }
  const [first, second] = bytes
  if (first !== SECP256K1_PUB_MULTICODEC[0] || second !== SECP256K1_PUB_MULTICODEC[1]) {
    throw new DidFormatError('did:key is not a compressed secp256k1 key')
  }
  const key = bytes.slice(2)
  if (key.length !== 33) {
    throw new DidFormatError('did:key payload must be 33 bytes')
  }
  return canonicalKey(Utils.toHex(key)).toString()
}

/**
 * The public key that actually signed a state's `user_signature`.
 *
 * The step `spec/identity.md` §2 names. `verifyUserSignature` derives exactly this and then
 * throws it away inside a boolean; a verifier who wants to say *which key* signed,
 * or to match a chain state against an SD-JWT's `iss`, needs it in the open.
 *
 * Counterparty `'anyone'`, so this runs with no wallet and no secret, which is the
 * whole reason the standard chose that counterparty for both signatures
 * (`spec/record-model.md` §3 fields 7/8, §5).
 */
export function signingPublicKeyFor(state: Pick<DppState, 'actorKeyId' | 'actorIdentityKey'>): string {
  return anyone
    .derivePublicKey(DPP_PROTOCOL_ID, state.actorKeyId, state.actorIdentityKey)
    .toString()
}

/** The `did:key` of the key that signed, as distinct from the actor it belongs to. */
export function signingDidFor(state: Pick<DppState, 'actorKeyId' | 'actorIdentityKey'>): string {
  return didKeyFromIdentityKey(signingPublicKeyFor(state))
}
