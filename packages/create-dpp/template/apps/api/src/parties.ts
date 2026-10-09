// Who signs. Under managed custody the platform holds every key: the
// custodian (the platform wallet) publishes every state, holds the lock and
// signs acceptance records; brands, recipients and members are managed
// identities the platform derives from a secret. The `Party` interface is
// the seam: a later implementation can be a person's own BRC-100 wallet,
// which the standard allows for every role, without changing the writer.
import { CachedKeyDeriver, Hash, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { didKeyFromIdentityKey, ownerKeyFromDeriver, ownerLinkageFromDeriver } from '@bsv/dpp-core'

/** The slice of a BRC-100 wallet the @bsv/dpp packages call on an actor or controller. */
export interface PartyWallet {
  getPublicKey: ProtoWallet['getPublicKey']
  createSignature: ProtoWallet['createSignature']
  encrypt: ProtoWallet['encrypt']
  decrypt: ProtoWallet['decrypt']
  revealSpecificKeyLinkage: ProtoWallet['revealSpecificKeyLinkage']
}

export interface Party {
  /** A label for the journal, never shown as proof of anything. */
  name: string
  /** Compressed public key, hex. */
  identityKey: string
  /** did:key form of the identity key, the issuer of claims. */
  did: string
  wallet: PartyWallet
  /** Field 6 when this party controls the passport: one derivation below the identity key, per passport. */
  controllerKey(passportId: string): Promise<string>
  /** The BRC-69 scalar proving this party derived that controller key: the control proof a later state carries. */
  controlLinkage(passportId: string): Promise<string>
}

/** A party whose root key the platform holds. */
export function managedParty(name: string, key: PrivateKey): Party {
  const deriver = new CachedKeyDeriver(key)
  return {
    name,
    identityKey: key.toPublicKey().toString(),
    did: didKeyFromIdentityKey(key.toPublicKey().toString()),
    wallet: new ProtoWallet(key),
    controllerKey: async (passportId) => ownerKeyFromDeriver(passportId, deriver),
    controlLinkage: async (passportId) => ownerLinkageFromDeriver(passportId, deriver),
  }
}

/** A deterministic private key from a secret and a scope, so nothing per party is stored. */
export function deriveManagedKey(secret: string, scope: string, id: string): PrivateKey {
  if (secret.length < 16) throw new Error('a managed identity secret must be at least 16 characters')
  const seed = Hash.sha256(Utils.toArray(`${secret}\u0000${scope}\u0000${id}`, 'utf8'))
  return PrivateKey.fromHex(Utils.toHex(seed))
}

export interface Parties {
  /** The brand's identity: actor on issue, update and retire, and the controller until a hand-on. */
  brand(brandId: string): Party
  /** A recipient's managed identity for one offer; the hand-on moves control to its controller key. */
  recipient(requestId: string): Party
  /** A signed-in member's identity, the issuer of the lifecycle claims they sign. */
  member(userId: string): Party
}

export function managedParties(options: { brandRootSecret: string; managedIdentitySecret: string }): Parties {
  return {
    brand: (brandId) => managedParty(`brand:${brandId}`, deriveManagedKey(options.brandRootSecret, 'brand', brandId)),
    recipient: (requestId) => managedParty(`recipient:${requestId}`, deriveManagedKey(options.managedIdentitySecret, 'recipient', requestId)),
    member: (userId) => managedParty(`member:${userId}`, deriveManagedKey(options.managedIdentitySecret, 'member', userId)),
  }
}
