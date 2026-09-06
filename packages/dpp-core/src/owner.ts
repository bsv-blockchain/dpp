import {
  BigNumber,
  Curve,
  PublicKey,
  Utils,
  type KeyDeriverApi,
  type RevealSpecificKeyLinkageResult,
  type WalletProtocol,
} from '@bsv/sdk'
import {
  OWNER_LINKAGE_HEX,
  OWNER_LINKAGE_KEY,
  OWNER_LINKAGE_REVELATION_PROTOCOL_ID,
  OWNER_PROTOCOL_ID,
} from './constants.js'
import type { DppStateData, DppStateDataV2 } from './types.js'

/**
 * The owner key, the possession convention and the owner-signed transfer
 * (`spec/custody.md` §2 to §4), in the four operations a BRC-100 wallet already
 * has. Everything here is one derivation from a root and exports nothing, which
 * is the constraint the standard imposes on itself (`spec/custody.md` §1): a rule
 * that needed a deeper hierarchy could only be satisfied by software holding raw
 * keys, and would make self-custody impossible while looking neutral.
 *
 * **Why the linkage scalar is safe to publish, and when it is not.** BRC-42
 * derives a child as `parent + s·G`, where `s` is an HMAC keyed by a shared secret
 * only the root can form. Publishing `s` for one passport proves that the root
 * derived that owner key and nothing about any other passport. It also makes the
 * derived private key and the root private key differ by a public number: a
 * wallet that exported the derived key, the one that spends a tip under the
 * possession convention, would hand its root to anyone who had read the chain.
 * The no-export rule is therefore a security requirement of this design, and the
 * helpers below never touch a private key.
 *
 * **The predicate runs in a fixed order.** Equality, then the transfer
 * authorities, then linkage, so two readers cannot differ on one state; the
 * property is read only when the first two do not settle it, and when read it has
 * exactly one accepted spelling.
 */

/** The slice of a BRC-100 wallet that produces field 6. ProtoWallet and WalletClient both fit. */
export interface OwnerKeyWallet {
  getPublicKey: (args: {
    protocolID: WalletProtocol
    keyID: string
    counterparty: string
  }) => Promise<{ publicKey: string }>
}

/**
 * Field 6 as `spec/record-model.md` §3 recommends: the wallet's root derived under
 * OWNER_PROTOCOL_ID with keyID = passport_id and counterparty 'self'.
 */
export async function ownerKeyFor(passportId: string, wallet: OwnerKeyWallet): Promise<string> {
  const { publicKey } = await wallet.getPublicKey({
    protocolID: OWNER_PROTOCOL_ID,
    keyID: passportId,
    counterparty: 'self',
  })
  return publicKey
}

/** The same key straight from a key deriver (server-side custodians, tests). */
export function ownerKeyFromDeriver(passportId: string, deriver: KeyDeriverApi): string {
  return deriver.derivePublicKey(OWNER_PROTOCOL_ID, passportId, 'self').toString()
}

/**
 * The BRC-69 specific key linkage of the owner key, as 64 lower-case hex: the
 * scalar `s` with `ownerKey = identityKey + s·G`. From a deriver, for the side
 * that holds the root outright.
 */
export function ownerLinkageFromDeriver(passportId: string, deriver: KeyDeriverApi): string {
  return Utils.toHex(deriver.revealSpecificSecret('self', OWNER_PROTOCOL_ID, passportId))
}

/** The slice of a BRC-100 wallet that reveals the linkage. */
export interface OwnerLinkageProver {
  getPublicKey: (args: { identityKey: true }) => Promise<{ publicKey: string }>
  revealSpecificKeyLinkage: (args: {
    counterparty: string
    verifier: string
    protocolID: WalletProtocol
    keyID: string
  }) => Promise<RevealSpecificKeyLinkageResult>
}

/**
 * The BRC-100 path to the scalar: the owner's wallet reveals the linkage of its
 * own owner key for this passport, encrypted to `verifierIdentityKey`. The
 * counterparty is the wallet's own identity key, which is what 'self' means and
 * is the spelling the BRC-100 wire accepts.
 */
export async function revealOwnerLinkage(
  passportId: string,
  wallet: OwnerLinkageProver,
  verifierIdentityKey: string
): Promise<RevealSpecificKeyLinkageResult> {
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
  return await wallet.revealSpecificKeyLinkage({
    counterparty: identityKey,
    verifier: verifierIdentityKey,
    protocolID: OWNER_PROTOCOL_ID,
    keyID: passportId,
  })
}

/** The slice of a BRC-100 wallet that decrypts a revelation made to it. */
export interface OwnerLinkageVerifierWallet {
  decrypt: (args: {
    ciphertext: number[]
    protocolID: WalletProtocol
    keyID: string
    counterparty: string
  }) => Promise<{ plaintext: number[] }>
}

/**
 * The verifier's side of `revealOwnerLinkage`: the scalar as 64 lower-case hex,
 * ready to carry in event_data. The writing application does this once and then
 * publishes the scalar in the clear, because on chain the verifier is everyone.
 */
export async function decryptOwnerLinkage(
  revelation: Pick<RevealSpecificKeyLinkageResult, 'prover' | 'keyID' | 'encryptedLinkage'>,
  wallet: OwnerLinkageVerifierWallet
): Promise<string> {
  const { plaintext } = await wallet.decrypt({
    ciphertext: revelation.encryptedLinkage,
    protocolID: OWNER_LINKAGE_REVELATION_PROTOCOL_ID,
    keyID: revelation.keyID,
    counterparty: revelation.prover,
  })
  if (plaintext.length !== 32) {
    throw new Error(`owner linkage must decrypt to 32 bytes, got ${plaintext.length}`)
  }
  return Utils.toHex(plaintext)
}

/**
 * `previousOwnerKey == actorIdentityKey + s·G`, mirroring PublicKey.deriveChild
 * exactly: the scalar is the HMAC bytes read big-endian, and Point.mul reduces it
 * modulo the curve order as derivation itself does. Pure, never throws: a key
 * that does not parse is a false, not an exception, because the caller has a
 * reason string to return and this function has none to add.
 */
export function verifyOwnerLinkage(
  actorIdentityKeyHex: string,
  previousOwnerKeyHex: string,
  linkageHex: string
): boolean {
  if (!OWNER_LINKAGE_HEX.test(linkageHex)) return false
  try {
    const actor = PublicKey.fromString(actorIdentityKeyHex)
    if (actor.toString() !== actorIdentityKeyHex) return false
    const s = new BigNumber(Utils.toArray(linkageHex, 'hex'))
    const child = new PublicKey(actor.add(new Curve().g.mul(s)))
    return child.toString() === previousOwnerKeyHex
  } catch {
    return false
  }
}

/** The three refusals of `spec/custody.md` §4, verbatim; fixtures pin these strings. */
export const OWNER_CONSENT_REFUSALS = {
  noLinkage: 'TRANSFER actor is not the previous owner and event_data carries no owner_linkage',
  malformedLinkage: 'owner_linkage must be 64 lower-case hex characters',
  notLinked: 'owner_linkage does not link actor_identity_key to the previous owner_identity_key',
} as const

/** Absent (undefined) when event_data is empty, not JSON, not an object, or lacks the property. */
function readOwnerLinkage(eventData: string): unknown {
  if (eventData === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(eventData)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  if (!Object.hasOwn(parsed, OWNER_LINKAGE_KEY)) return undefined
  return (parsed as Record<string, unknown>)[OWNER_LINKAGE_KEY]
}

type ConsentFields = Pick<DppStateData, 'op' | 'actorIdentityKey' | 'ownerIdentityKey' | 'eventData'>

/**
 * The owner-signed transfer (`spec/custody.md` §4). Returns null when the state
 * passes or the predicate does not apply (not a TRANSFER), otherwise the reason
 * a conforming reader reports. `authorities` are the profile's transfer
 * authorities, already canonical (see `normaliseTransferAuthorities`).
 */
export function checkOwnerConsent(
  prev: Pick<ConsentFields, 'ownerIdentityKey'>,
  next: ConsentFields,
  authorities: readonly string[] = []
): string | null {
  if (next.op !== 'TRANSFER') return null
  if (next.actorIdentityKey === prev.ownerIdentityKey) return null
  if (authorities.includes(next.actorIdentityKey)) return null
  const linkage = readOwnerLinkage(next.eventData)
  if (linkage === undefined) return OWNER_CONSENT_REFUSALS.noLinkage
  if (typeof linkage !== 'string' || !OWNER_LINKAGE_HEX.test(linkage)) {
    return OWNER_CONSENT_REFUSALS.malformedLinkage
  }
  if (!verifyOwnerLinkage(next.actorIdentityKey, prev.ownerIdentityKey, linkage)) {
    return OWNER_CONSENT_REFUSALS.notLinked
  }
  return null
}

/**
 * Transfer authorities as the predicate compares them: canonical compressed
 * lower-case hex, the spelling fields 6 and 7 carry. Upper-case input is
 * accepted and normalised; anything that is not a valid compressed key throws,
 * because a misconfigured authority must fail at boot, not silently never match.
 */
export function normaliseTransferAuthorities(keys: readonly string[]): string[] {
  return keys.map((key) => {
    let parsed: PublicKey
    try {
      parsed = PublicKey.fromString(key)
    } catch {
      throw new Error(`transfer authority is not a valid public key: ${key}`)
    }
    const canonical = parsed.toString()
    if (canonical !== key.toLowerCase()) {
      throw new Error(`transfer authority is not a canonical compressed public key: ${key}`)
    }
    return canonical
  })
}

/** The three refusals of `spec/record-model-v2.md` §6 (control), verbatim; fixtures pin these strings. */
export const CONTROL_REFUSALS = {
  notProven: 'the actor is not the controller and control_linkage is empty',
  redundantLinkage: 'control_linkage must be empty when the actor is the controller or a named authority',
  notLinked: 'control_linkage does not link actor_identity_key to the previous controller_key',
} as const

type ControlFields = Pick<DppStateDataV2, 'op' | 'actorIdentityKey' | 'controlLinkage'>

/**
 * The control proof of a version 2 UPDATE, TRANSFER or RETIRE
 * (`spec/record-model-v2.md` §6): the actor is the previous controller by
 * equality (field 7 equals the previous field 6), or a named authority, or
 * proves it by linkage (field 14 is the scalar with previous field 6 equal to
 * field 7 plus the scalar times G). Evaluated in that order, and the linkage
 * field has one accepted state under each branch: empty under equality and
 * under an authority, the scalar otherwise. Returns null when the state
 * passes or the rule does not apply (an ISSUE), otherwise the reason.
 */
export function checkControl(
  prev: Pick<DppStateData, 'ownerIdentityKey'>,
  next: ControlFields,
  authorities: readonly string[] = []
): string | null {
  if (next.op === 'ISSUE') return null
  const controller = next.actorIdentityKey === prev.ownerIdentityKey
  const authority = !controller && authorities.includes(next.actorIdentityKey)
  if (controller || authority) {
    return next.controlLinkage === '' ? null : CONTROL_REFUSALS.redundantLinkage
  }
  if (next.controlLinkage === '') return CONTROL_REFUSALS.notProven
  if (!verifyOwnerLinkage(next.actorIdentityKey, prev.ownerIdentityKey, next.controlLinkage)) {
    return CONTROL_REFUSALS.notLinked
  }
  return null
}
