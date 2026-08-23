import { BigNumber, CachedKeyDeriver, ECDSA, Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import type { LockingScript, WalletProtocol } from '@bsv/sdk'

/**
 * `uora-anchor-v3`: the attestation anchor output, as this overlay reads it.
 *
 * ## Why the format is not v1
 *
 * v1, the anchoring service's original format, is three fields: a prefix, a
 * digest and the attestation id. It proves an attestation existed at a point
 * in the chain's order and nothing else; its own specification recorded both
 * gaps, and this format closes them:
 *
 * 1. **Nothing in a v1 anchor says who claimed anything.** The digest covers an
 *    attestation the chain never sees, so an indexer holding only the output
 *    cannot answer "what has this party attested", which is the whole of a
 *    DID-keyed lookup. This format carries the issuer's `did:key`, the subject
 *    and the UORA type in the clear, because those three are the query.
 * 2. **Nothing in a v1 anchor says who anchored it, either.** v1 locks with
 *    counterparty `self`, whose BRC-42 derivation needs the treasury's root
 *    *private* key, so a third party cannot reproduce the locking key and
 *    cannot tie the output to anyone. That is not a small gap: the anchoring
 *    service established that more than one treasury has already anchored
 *    under the v1 prefix and the format cannot distinguish them. This format
 *    locks with counterparty `'anyone'`, which a stranger *can* reproduce from
 *    a published identity key, so `expectedLockingKey` below is checkable by
 *    anybody and is what this topic's admission rule turns on.
 *
 * v1 is untouched. Every anchor already broadcast keeps verifying under its
 * own rules, exactly as its specification promises, and the prefixes are
 * distinguishable by reading field 0. This is a new format beside it, not an
 * edit to it.
 *
 * ## Why v3 and not v2
 *
 * v2 had these same seven fields, in this order, with this derivation. What it
 * got wrong was the signature. `PushDrop.lock` appends one over `fields.flat()`,
 * the field bytes run together with no delimiters and no lengths, which
 * authenticates the total byte string and says nothing about where one field
 * ends and the next begins.
 *
 * Four of the seven have their boundaries pinned by other checks anyway: the
 * prefix is a fixed literal, the digest is exactly 64 hex characters, and the
 * attestation id and the anchoring key are both fixed by the derivation of the
 * locking key. The subject and the type are neither, and they are adjacent. So
 * anyone holding a v2 anchor could re-cut that one boundary into a different
 * subject and a different type, copy the signature bytes across verbatim, and
 * still pass every check this reader made. The single v2 anchor on mainnet
 * admits 63 such variants, and this reader would have indexed any of them under
 * a subject nobody had signed.
 *
 * v3 signs `uoraAnchorSigningPreimage` instead: each field behind its own
 * length, so any other split of the same bytes is a different preimage and the
 * signature stops verifying. The prefix moves with it because a reader has no
 * other way to know which preimage to rebuild, and because the format's own
 * rule is that a change of layout is a change of prefix. Nothing repairs the
 * outputs already written, so **v2 is superseded and this reader refuses it**
 * rather than reading it leniently.
 *
 * ## Why this file imports nothing of ours
 *
 * `tm_dpp` reads the token standard, so it depends on `@bsv/dpp-core` and can never
 * be published as part of a shared overlay package. `tm_uora_dpp` is meant to
 * be PR'd into the shared mainnet overlay instances, so it deliberately depends
 * on `@bsv/sdk` and `@bsv/overlay` alone. The fifteen lines of `did:key`
 * decoding below are the same fifteen in `@bsv/dpp-core/did.ts`, duplicated on
 * purpose against the repository's own rule about one implementation per
 * concept: the alternative is that a shared overlay instance takes a dependency
 * on this programme's token core, which is a worse trade. The two are pinned
 * together by a shared fixture rather than by an import
 * (`test/anchor-v3-fixture.ts`), which is the same discipline the
 * canonical-bytes digest is held to across the two repositories.
 */

/** Marks the output as ours and versions the field layout. */
export const UORA_ANCHOR_PREFIX = 'uora-anchor-v3'

/**
 * The superseded layout, named so it can be refused deliberately rather than
 * by falling off the end of a string comparison. It is the one near miss worth
 * spelling out: same seven fields, same order, same derivation, often the same
 * treasury, and a signature that does not commit to where the subject stops.
 */
export const UORA_ANCHOR_PREFIX_V2 = 'uora-anchor-v2'

/**
 * BRC-42 child the anchor is locked under. A distinct string from v2's
 * `[1, 'uora anchor v2']` and v1's `[1, 'uora anchor v1']`, because two
 * incompatible formats sharing one protocol name would be two keys wearing one
 * label.
 */
export const UORA_ANCHOR_PROTOCOL: WalletProtocol = [1, 'uora anchor v3']

/**
 * Basket the outputs land in, unchanged from v1 on purpose: the treasury's
 * balance and its anchor count should keep seeing one population, and the
 * version is legible in field 0 for anything that needs to tell them apart.
 */
export const UORA_ANCHOR_BASKET = 'uora-anchor'

/** Fields before the appended signature. */
export const UORA_ANCHOR_FIELD_COUNT = 7

/**
 * The bytes a v3 signature covers: every field preceded by its own length, so
 * the boundaries between the fields are part of what is signed.
 *
 * Byte-identical in behaviour to `anchorSigningPreimage` in the resolver's
 * `src/anchoring/anchor.ts`, and it has to stay that way. The resolver signs
 * this preimage and appends the result as the eighth field, locking with
 * `includeSignature: false`; this package rebuilds it from the output and
 * checks it. Neither repository can import the other, so the shared fixture in
 * `test/anchor-v3-fixture.ts` is what catches a drift.
 *
 * `PushDrop.lock`'s own signature is not used and cannot be made to serve here:
 * it has no option to commit to boundaries, which is the whole of what went
 * wrong with v2.
 */
export function uoraAnchorSigningPreimage(fields: number[][]): number[] {
  const writer = new Utils.Writer()
  for (const field of fields) {
    writer.writeVarIntNum(field.length)
    writer.write(field)
  }
  return writer.toArray()
}

/**
 * Bounds on the free-text fields. An overlay admits from whoever can reach it,
 * and an index keyed on a field a stranger controls is a field a stranger can
 * make expensive. Generous enough that no honest value is near them: a GS1
 * Digital Link with a long serial is under 200 characters.
 */
const MAX_ATTESTATION_ID = 256
const MAX_SUBJECT = 512
const MAX_TYPE = 64

const HEX_64 = /^[0-9a-f]{64}$/
/** Rules out control characters and the stray replacement char a bad decode leaves. */
const PRINTABLE = /^[ -~ -￿]+$/

const OP_CHECKSIG = 0xac
const OP_DROP = 0x75
const OP_2DROP = 0x6d

const SECP256K1_PUB_MULTICODEC = [0xe7, 0x01]
const BASE58BTC = 'z'
const DID_KEY_PREFIX = `did:key:${BASE58BTC}`

const anyone = new CachedKeyDeriver('anyone')

/**
 * One anchor, as read off the chain. Every field validated, nothing inferred.
 *
 * **Two parties appear here and they are not the same one.** `issuer` is who
 * made the claim, and the anchor carries it without checking it. `anchoredBy`
 * is who wrote this output, and the anchor proves it. Conflating them is the
 * one misreading this format invites, which is why they are named apart.
 */
export interface UoraAnchor {
  /** Lower-case hex SHA-256 over the attestation's canonical form. */
  digest: string
  /** The resolver's id for the attestation this digest covers. */
  attestationId: string
  /** The party that made the claim, as a `did:key`. Carried, not proved. */
  issuer: string
  /** The issuer's compressed secp256k1 key, hex, decoded from the DID. */
  issuerKey: string
  /** What the claim is about: a passport id. */
  subject: string
  /** The UORA attestation type, verbatim and unvalidated against any list. */
  uoraType: string
  /**
   * The anchoring service's published identity key, hex.
   *
   * Named by the output itself rather than configured into the reader, so this
   * topic needs no per-deployment key list to attribute an anchor: the locking
   * key must be the BRC-42 child of this one, and producing that needs its
   * private half. A shared overlay can therefore carry anchors from a
   * deployment it has never been told about, and still say whose each one is.
   */
  anchoredBy: string
  /** The key locking the output: the BRC-42 child of `anchoredBy`. */
  lockingKey: string
}

/**
 * The seven fields, in order, for whoever writes one.
 *
 * The eighth field a written anchor carries is the signature over
 * `uoraAnchorSigningPreimage(theseSeven)`, appended by the writer. It is not
 * the signature `PushDrop.lock` appends, and a writer that leaves
 * `includeSignature` at its default produces an output this reader refuses.
 */
export function uoraAnchorFields(
  anchor: Pick<
    UoraAnchor,
    'digest' | 'attestationId' | 'issuer' | 'subject' | 'uoraType' | 'anchoredBy'
  >
): number[][] {
  return [
    Utils.toArray(UORA_ANCHOR_PREFIX, 'utf8'),
    Utils.toArray(anchor.digest, 'utf8'),
    Utils.toArray(anchor.attestationId, 'utf8'),
    Utils.toArray(anchor.issuer, 'utf8'),
    Utils.toArray(anchor.subject, 'utf8'),
    Utils.toArray(anchor.uoraType, 'utf8'),
    Utils.toArray(anchor.anchoredBy, 'utf8'),
  ]
}

/**
 * A 33-byte compressed key in its one canonical spelling, or false.
 *
 * The SDK reduces `x >= p` rather than refusing, so an unchecked encoding would
 * be accepted here and index under a key nobody else computes.
 */
function canonicalCompressedKey(hex: string): boolean {
  if (!/^0[23][0-9a-f]{64}$/.test(hex)) return false
  try {
    return PublicKey.fromString(hex).toString() === hex
  } catch {
    return false
  }
}

/**
 * The compressed key inside a `did:key`, or null.
 *
 * Refuses another curve rather than returning bytes that would fail later: an
 * Ed25519 DID is a well-formed `did:key` and a meaningless secp256k1 key, and
 * the difference is the two bytes at the front. Also refuses a non-canonical
 * encoding, because the SDK reduces `x >= p` mod p and would hand back a key
 * that indexes under a DID nobody else computes.
 */
export function identityKeyFromDidKey(did: string): string | null {
  if (!did.startsWith(DID_KEY_PREFIX)) return null
  let bytes: number[]
  try {
    bytes = Utils.fromBase58(did.slice(DID_KEY_PREFIX.length))
  } catch {
    return null
  }
  if (bytes[0] !== SECP256K1_PUB_MULTICODEC[0] || bytes[1] !== SECP256K1_PUB_MULTICODEC[1]) {
    return null
  }
  const key = bytes.slice(2)
  if (key.length !== 33) return null
  const hex = Utils.toHex(key)
  try {
    return PublicKey.fromString(hex).toString() === hex ? hex : null
  } catch {
    return null
  }
}

/** The inverse, so a writer and a reader cannot drift on the encoding. */
export function didKeyFromIdentityKey(identityKeyHex: string): string {
  const key = PublicKey.fromString(identityKeyHex)
  if (key.toString() !== identityKeyHex) {
    throw new Error('not a canonical compressed public key')
  }
  const bytes = [...SECP256K1_PUB_MULTICODEC, ...(key.encode(true) as number[])]
  return `${DID_KEY_PREFIX}${Utils.toBase58(bytes)}`
}

/**
 * The key an anchor for this attestation id must be locked to, given the
 * anchoring service's published identity key.
 *
 * Half the reason this format exists at all. Counterparty `'anyone'` means this
 * runs with no secret, so the admission rule below is one a stranger can also
 * apply, and a verifier can say "this anchor is that service's" rather than
 * "this anchor is somebody's".
 */
export function expectedLockingKey(serviceIdentityKey: string, attestationId: string): string {
  return anyone.derivePublicKey(UORA_ANCHOR_PROTOCOL, attestationId, serviceIdentityKey).toString()
}

/**
 * Read a PushDrop locking script into its key and its fields.
 *
 * Written over the chunks rather than `PushDrop.decode` for the reason
 * `/spec` spends four lines on: the decoder renders an empty field as a single
 * zero byte, so a preimage built from its output is one byte too long per empty
 * field and the signature check fails for a reason that has nothing to do with
 * the signature. No v3 field may be empty, so an empty one is rejected either
 * way; reading it exactly means it is rejected for the right reason. It matters
 * more under v3 than it did under v2, because the preimage now carries each
 * field's length and a length read one byte out is a different preimage.
 */
function readPushDrop(script: LockingScript): { lockingKey: PublicKey; fields: number[][] } | null {
  const chunks = script.chunks
  if (chunks.length < 3) return null
  const keyData = chunks[0]?.data
  /*
   * Exactly 33 bytes, the compressed encoding a conforming writer emits. A
   * 65-byte uncompressed push used to parse here and then pass attribution,
   * because `PublicKey.toString()` re-compresses before the comparison, which
   * made the acceptance invisible: an anchor in a spelling nobody writes was
   * admitted as though it were canonical. The record rail's reader was always
   * exact about the same push; this one now matches it, and the fixture's
   * `uncompressedKey` vector is what keeps it matched.
   */
  if (keyData == null || keyData.length !== 33) return null
  if (chunks[1]?.op !== OP_CHECKSIG) return null

  let lockingKey: PublicKey
  try {
    lockingKey = PublicKey.fromString(Utils.toHex(keyData))
  } catch {
    return null
  }

  const fields: number[][] = []
  for (const chunk of chunks.slice(2)) {
    if (chunk.op === OP_DROP || chunk.op === OP_2DROP) break
    if (chunk.data != null && chunk.data.length > 0) fields.push(chunk.data)
    else if (chunk.op === 0) fields.push([])
    else if (chunk.op >= 0x51 && chunk.op <= 0x60) fields.push([chunk.op - 0x50])
    else return null
  }

  /*
   * The drop tail, validated exactly the way the record rail's codec validates
   * its own: floor(n/2) OP_2DROPs, one OP_DROP when n is odd, and nothing at
   * all after them. This reader used to stop at the first drop and never look
   * back, so an anchor with a short tail, a wrong mix, or trailing chunks was
   * parsed and admitted; the fixture's `malformedTail` vectors pin the refusal.
   */
  const tail = chunks.slice(2 + fields.length)
  const twoDrops = Math.floor(fields.length / 2)
  const oneDrop = fields.length % 2
  const tailValid =
    tail.length === twoDrops + oneDrop &&
    tail.slice(0, twoDrops).every((chunk) => chunk.op === OP_2DROP) &&
    (oneDrop === 0 || tail[twoDrops]?.op === OP_DROP)
  if (!tailValid) return null

  return { lockingKey, fields }
}

/** UTF-8 that round-trips. A field that does not is not a field we wrote. */
function text(bytes: number[]): string | null {
  let decoded: string
  try {
    decoded = Utils.toUTF8(bytes)
  } catch {
    return null
  }
  if (decoded === '' || !PRINTABLE.test(decoded)) return null
  return Utils.toHex(Utils.toArray(decoded, 'utf8')) === Utils.toHex(bytes) ? decoded : null
}

/**
 * The appended signature, checked.
 *
 * It proves the seven fields were sealed **together, at these boundaries**, by
 * whoever holds the key in the script. An output whose digest or issuer was
 * edited after signing fails here; so does one assembled by copying another
 * anchor's signature; and so, now, does one that moves the boundary between the
 * subject and the type without altering a single byte, which is the forgery v2
 * could not see and the reason the preimage is length-prefixed.
 *
 * On its own that is tamper-evidence over the anchor's structure and not
 * attribution. Attribution is `expectedLockingKey`, and the topic manager wants
 * both.
 */
function sealedByLockingKey(fields: number[][], lockingKey: PublicKey): boolean {
  const signature = fields[UORA_ANCHOR_FIELD_COUNT]
  if (signature == null || signature.length === 0) return false
  const signed = uoraAnchorSigningPreimage(fields.slice(0, UORA_ANCHOR_FIELD_COUNT))
  try {
    return ECDSA.verify(
      new BigNumber(Hash.sha256(signed)),
      Signature.fromDER(signature),
      lockingKey
    )
  } catch {
    return false
  }
}

/**
 * The version prefix in field 0, or null when the output is not a PushDrop with
 * a readable text field there.
 *
 * Says nothing about whether the rest of the output is valid, and is not a
 * shortcut past `tryParseUoraAnchor`. It exists so a reader can *name* what it
 * is refusing: an anchor turned away for being v2 is a different event from a
 * stranger's output that was never an anchor, and only one of the two is worth
 * telling an operator about.
 */
export function uoraAnchorPrefix(script: LockingScript): string | null {
  const decoded = readPushDrop(script)
  const first = decoded?.fields[0]
  return first == null ? null : text(first)
}

/**
 * Parse and fully validate one output. Null for anything that is not a
 * well-formed v3 anchor, including a v1 or a v2 one, neither of which this
 * topic indexes.
 *
 * Nothing is returned unless the signature verifies, which is not a detail. A
 * caller that got the carried fields back beside a failed signature would be
 * holding an issuer, a subject and a type that nothing vouches for, and would
 * have no way to tell them from ones that do.
 *
 * Total: no throw on any input, because it runs against whatever an overlay is
 * handed. A malformed output is not an error, it is an output that is not ours.
 */
export function tryParseUoraAnchor(script: LockingScript): UoraAnchor | null {
  const decoded = readPushDrop(script)
  if (decoded == null) return null
  const { fields, lockingKey } = decoded
  if (fields.length !== UORA_ANCHOR_FIELD_COUNT + 1) return null

  const parts = fields.slice(0, UORA_ANCHOR_FIELD_COUNT).map(text)
  if (parts.some((part) => part == null)) return null
  const [prefix, digest, attestationId, issuer, subject, uoraType, anchoredBy] = parts as string[]

  /*
   * v2 is refused by name, ahead of the general prefix check, because it is the
   * one near miss somebody maintaining this later might be tempted to wave
   * through: the fields are right, the derivation is right, and the treasury is
   * often ours. Waving it through would index a subject and a type its own
   * signature does not cover. The refusal is a decision, and this is where it
   * is written down rather than left to fall out of a string comparison.
   */
  if (prefix === UORA_ANCHOR_PREFIX_V2) return null
  if (prefix !== UORA_ANCHOR_PREFIX) return null
  if (!HEX_64.test(digest)) return null
  if (attestationId.length > MAX_ATTESTATION_ID) return null
  if (subject.length > MAX_SUBJECT) return null
  if (uoraType.length > MAX_TYPE) return null

  const issuerKey = identityKeyFromDidKey(issuer)
  if (issuerKey == null) return null

  if (!sealedByLockingKey(fields, lockingKey)) return null

  /*
   * The attribution check, and it is part of being well-formed rather than a
   * policy on top. An output that names an anchoring service its locking key
   * does not derive from is claiming something untrue about itself, so it is
   * malformed, not merely unwanted. Producing one that passes needs the private
   * half of the key in field 6, which is the whole proof.
   */
  if (!canonicalCompressedKey(anchoredBy)) return null
  let derived: string
  try {
    derived = expectedLockingKey(anchoredBy, attestationId)
  } catch {
    return null
  }
  if (derived !== lockingKey.toString()) return null

  return {
    digest,
    attestationId,
    issuer,
    issuerKey,
    subject,
    uoraType,
    anchoredBy,
    lockingKey: lockingKey.toString(),
  }
}
