import { describe, expect, it } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet, PushDrop, Utils } from '@bsv/sdk'
import {
  didKeyFromIdentityKey,
  expectedLockingKey,
  identityKeyFromDidKey,
  tryParseUoraAnchor,
  uoraAnchorFields,
  uoraAnchorSigningPreimage,
  UORA_ANCHOR_FIELD_COUNT,
  UORA_ANCHOR_PREFIX,
  UORA_ANCHOR_PREFIX_V2,
  UORA_ANCHOR_PROTOCOL,
} from '../src/uoraAnchor.js'
import { writeUoraAnchor } from './writeAnchor.js'
import { ANCHOR_V3_FIXTURE as F } from './anchor-v3-fixture.js'

/**
 * The v3 anchor format, read the way the topic manager reads it.
 *
 * Three of these carry the format and they are the ones to look at first.
 * `reproduces the locking key from a published identity key` is the attribution
 * v1 could not offer. `forSelf` pins the one call detail that decides whether it
 * works: get that flag wrong and the anchor still parses, still verifies its own
 * signature and is still unattributable, which is exactly the failure v1 shipped
 * with. And `the boundary between the subject and the type` is the one v2
 * shipped with: a signature over the fields run together seals the bytes and not
 * the cuts between them, so a holder could re-read the same output as a
 * different claim.
 */

const servicePriv = PrivateKey.fromHex('77'.repeat(32))
const SERVICE_KEY = servicePriv.toPublicKey().toString()
const serviceWallet = new ProtoWallet(servicePriv)

const issuerPriv = PrivateKey.fromHex('88'.repeat(32))
const ISSUER_KEY = issuerPriv.toPublicKey().toString()
const ISSUER_DID = didKeyFromIdentityKey(ISSUER_KEY)

const ATTESTATION_ID = 'att_01JQ8ZK9'
const SUBJECT = 'https://id.gs1.org/01/09506000134352/21/B59E82284DEE'
const DIGEST = 'a'.repeat(64)
const TYPE = 'Origin'

/**
 * The v2 output this package used to admit, kept as a literal now that its
 * fixture is gone. It was a genuine anchor: written by the same treasury, with
 * the same seven fields, correctly signed under the v2 rules. Refusing exactly
 * these bytes is what "v2 is superseded" has to mean in practice, so the string
 * stays here rather than being described in a comment.
 */
const SUPERSEDED_V2_SCRIPT =
  '21029def2a5ef74efdaf33064367fceaeed5043ddaef4c4813d1d73aeaf1a7196f32ac0e756f72612d616e63686f722d763240653466363633623765383761343062363031373136653837336132646563336133376236613435626430633835353763623235333130616234653733366431313c68747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4235394538323238344445452f73746174652d31396469643a6b65793a7a513373684e75326f465462657165785965756e4433366d793361514e71455771386d57443241435271514c456970637a3468747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f423539453832323834444545064f726967696e4230333739363264343562333865386263663832666138656661383433326130316632306339613533653234633764336631316466313937636238653730393236646146304402203aacc206ccc456e14e39a6850e4087af0d68ac19ec88f20a8998fb22f1212d0d02204e05fd4937c9489d8aca6b9542bc31606d54843a5257d89f255dc428cfedc2736d6d6d6d'

function anchorData(overrides: Partial<Record<string, string>> = {}) {
  return {
    digest: DIGEST,
    attestationId: ATTESTATION_ID,
    issuer: ISSUER_DID,
    subject: SUBJECT,
    uoraType: TYPE,
    anchoredBy: SERVICE_KEY,
    ...overrides,
  }
}

async function writeAnchor(
  fields = uoraAnchorFields(anchorData()),
  keyId = ATTESTATION_ID,
  wallet = serviceWallet
): Promise<LockingScript> {
  return await writeUoraAnchor(wallet, fields, keyId)
}

describe('did:key, as this package encodes it', () => {
  /**
   * Pinned against `@bsv/dpp-core`'s own vector rather than imported from it. The
   * duplication is deliberate (see `uoraAnchor.ts`): this file must not depend
   * on the token core, so the two are held together by a committed string. If
   * either implementation drifts, one of the two suites goes red.
   */
  const CORE_KEY = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa'
  const CORE_DID = 'did:key:zQ3shjyJXUaRJC2GC43mX8aPrUhoTdoiongXhZjsdTzPKYZUM'

  it('agrees with the token core on a shared vector', () => {
    expect(didKeyFromIdentityKey(CORE_KEY)).toBe(CORE_DID)
    expect(identityKeyFromDidKey(CORE_DID)).toBe(CORE_KEY)
  })

  it('round-trips', () => {
    expect(identityKeyFromDidKey(didKeyFromIdentityKey(ISSUER_KEY))).toBe(ISSUER_KEY)
  })

  it('refuses another curve, a non-canonical key and a DID it cannot read', () => {
    // A well-formed Ed25519 did:key: two bytes different at the front.
    expect(
      identityKeyFromDidKey('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')
    ).toBeNull()
    expect(identityKeyFromDidKey('did:web:example.com')).toBeNull()
    expect(identityKeyFromDidKey('did:key:zNOTBASE58!!')).toBeNull()
    // The SDK reduces x >= p rather than refusing, so an unchecked encoding
    // would index under a DID that resolves to a key nobody can find on chain.
    expect(() => didKeyFromIdentityKey(`02${'ff'.repeat(32)}`)).toThrow()
  })
})

describe('the signing preimage, which is the whole of what v3 changed', () => {
  it('puts every field behind its own length', () => {
    // Written out by hand rather than round-tripped, because a preimage that
    // agrees with itself proves nothing. This is the layout the resolver's
    // `anchorSigningPreimage` produces, and the two must not drift.
    expect(uoraAnchorSigningPreimage([[1, 2, 3], [], [4]])).toEqual([3, 1, 2, 3, 0, 1, 4])
  })

  it('tells two splits of the same bytes apart, which flattening cannot', () => {
    const left = [Utils.toArray('ab', 'utf8'), Utils.toArray('cd', 'utf8')]
    const right = [Utils.toArray('abc', 'utf8'), Utils.toArray('d', 'utf8')]
    expect(left.flat()).toEqual(right.flat())
    expect(uoraAnchorSigningPreimage(left)).not.toEqual(uoraAnchorSigningPreimage(right))
  })

  it('varint-encodes a length past 252, so a long subject does not collapse', () => {
    // The subject is bounded at 512 characters, well past the single-byte
    // varint range. A length written in one byte there would wrap and two
    // different fields would share a preimage again.
    const long = new Array<number>(300).fill(0x61)
    const preimage = uoraAnchorSigningPreimage([long])
    expect(preimage[0]).toBe(0xfd)
    expect(preimage.length).toBe(303)
  })
})

describe('reading a well-formed anchor', () => {
  it('returns every field, with the issuer key decoded', async () => {
    const anchor = tryParseUoraAnchor(await writeAnchor())
    expect(anchor).not.toBeNull()
    expect(anchor).toMatchObject({
      digest: DIGEST,
      attestationId: ATTESTATION_ID,
      issuer: ISSUER_DID,
      issuerKey: ISSUER_KEY,
      subject: SUBJECT,
      uoraType: TYPE,
      anchoredBy: SERVICE_KEY,
    })
  })

  it('reproduces the locking key from a published identity key', async () => {
    // A third party holding only the service's public identity key and the
    // attestation id can say this anchor is that service's, which no v1 anchor
    // permits: v1 locks under counterparty `self`, whose derivation needs the
    // treasury's private key.
    const anchor = tryParseUoraAnchor(await writeAnchor())
    expect(anchor?.lockingKey).toBe(expectedLockingKey(SERVICE_KEY, ATTESTATION_ID))
  })

  it('gives a different locking key per attestation, so anchors stay unlinkable', async () => {
    const other = tryParseUoraAnchor(
      await writeAnchor(uoraAnchorFields(anchorData({ attestationId: 'att_other' })), 'att_other')
    )
    const first = tryParseUoraAnchor(await writeAnchor())
    expect(other?.lockingKey).not.toBe(first?.lockingKey)
    // Both still attributable to the same service, which is the trade this
    // format makes: linkable to a named party by anyone who asks, not linkable
    // to each other by anyone who does not.
    expect(other?.lockingKey).toBe(expectedLockingKey(SERVICE_KEY, 'att_other'))
  })

  it('does not attribute an anchor to a service that did not write it', async () => {
    const stranger = PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()
    const anchor = tryParseUoraAnchor(await writeAnchor())
    expect(anchor?.lockingKey).not.toBe(expectedLockingKey(stranger, ATTESTATION_ID))
  })

  it('refuses an anchor naming a treasury its locking key cannot come from', async () => {
    // The check that makes attribution intrinsic rather than configured. This
    // output is signed and sealed correctly by the key that locks it; it simply
    // claims, in field 6, to have been written by somebody else. Producing one
    // that passes needs that somebody's private key, which is the whole proof.
    const stranger = PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()
    const lying = await writeAnchor(uoraAnchorFields(anchorData({ anchoredBy: stranger })))
    expect(tryParseUoraAnchor(lying)).toBeNull()
  })

  it('refuses a field 6 that is not a canonical compressed key', async () => {
    for (const bad of ['not-a-key', '04' + 'ab'.repeat(64), '02' + 'ff'.repeat(32)]) {
      expect(
        tryParseUoraAnchor(await writeAnchor(uoraAnchorFields(anchorData({ anchoredBy: bad }))))
      ).toBeNull()
    }
  })

  it('leaves the caller a fields array it can still use', async () => {
    // Under v2 this pinned the opposite hazard: `PushDrop.lock` appended its
    // signature to the array it was handed, so a caller that built fields once
    // and locked twice signed eight fields the second time. v3 locks with
    // `includeSignature: false` and appends the signature itself, so the array
    // comes back untouched, and a writer that reuses one is safe.
    const fields = uoraAnchorFields(anchorData())
    const before = fields.length
    await writeAnchor(fields)
    expect(fields.length).toBe(before)
  })
})

describe('refusing what is not an anchor', () => {
  it('refuses a v1 anchor, which this topic does not index', async () => {
    const v1 = [
      Utils.toArray('uora-anchor-v1', 'utf8'),
      Utils.toArray(DIGEST, 'utf8'),
      Utils.toArray(ATTESTATION_ID, 'utf8'),
    ]
    expect(tryParseUoraAnchor(await writeAnchor(v1))).toBeNull()
  })

  it('refuses a digest that is not 64 lower-case hex', async () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}b`, 'not a digest']) {
      expect(tryParseUoraAnchor(await writeAnchor(uoraAnchorFields(anchorData({ digest: bad }))))).toBeNull()
    }
  })

  it('refuses an issuer that is not a resolvable secp256k1 did:key', async () => {
    for (const bad of [
      'did:web:example.com',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      ISSUER_KEY, // the bare key, which is not a DID
    ]) {
      expect(tryParseUoraAnchor(await writeAnchor(uoraAnchorFields(anchorData({ issuer: bad }))))).toBeNull()
    }
  })

  it('refuses an empty field rather than indexing a blank subject', async () => {
    const fields = uoraAnchorFields(anchorData())
    fields[4] = []
    expect(tryParseUoraAnchor(await writeAnchor(fields))).toBeNull()
  })

  it('refuses an over-long field, so the index cannot be made expensive', async () => {
    const long = `https://id.gs1.org/01/09506000134352/21/${'x'.repeat(600)}`
    expect(tryParseUoraAnchor(await writeAnchor(uoraAnchorFields(anchorData({ subject: long }))))).toBeNull()
  })

  it('refuses the wrong number of fields', async () => {
    const short = uoraAnchorFields(anchorData()).slice(0, 5)
    expect(tryParseUoraAnchor(await writeAnchor(short))).toBeNull()
    const long = [...uoraAnchorFields(anchorData()), Utils.toArray('extra', 'utf8')]
    expect(tryParseUoraAnchor(await writeAnchor(long))).toBeNull()
  })

  it('refuses an output that is not a PushDrop at all', () => {
    expect(tryParseUoraAnchor(LockingScript.fromASM('OP_DUP OP_HASH160'))).toBeNull()
    expect(tryParseUoraAnchor(new LockingScript([]))).toBeNull()
  })
})

describe('the superseded v2 layout', () => {
  it('refuses the exact output this package used to admit', () => {
    // Not a forgery and not malformed under its own rules. It is a real anchor
    // written by the fixture treasury, and it is refused because its signature
    // does not fix where the subject stops.
    const script = LockingScript.fromHex(SUPERSEDED_V2_SCRIPT)
    expect(Utils.toUTF8(script.chunks[2]!.data!)).toBe(UORA_ANCHOR_PREFIX_V2)
    expect(tryParseUoraAnchor(script)).toBeNull()
  })

  it('refuses an anchor signed the way v2 signed, under the v3 prefix', async () => {
    // The mistake a writer makes by leaving `includeSignature` at its default:
    // seven correct fields, the right protocol, the right counterparty, and a
    // signature over `fields.flat()`, which is the thing v3 exists to stop
    // being sufficient.
    const script = await new PushDrop(serviceWallet).lock(
      uoraAnchorFields(anchorData()),
      UORA_ANCHOR_PROTOCOL,
      ATTESTATION_ID,
      'anyone',
      true
    )
    expect(tryParseUoraAnchor(script)).toBeNull()
  })
})

describe('tamper evidence', () => {
  it('refuses a field edited after signing', async () => {
    const script = await writeAnchor()
    const anchor = tryParseUoraAnchor(script)
    expect(anchor).not.toBeNull()

    // Swap the digest for another valid-looking one, leaving everything else,
    // including the signature, exactly as written.
    const chunks = script.chunks.map((chunk) => ({ ...chunk }))
    const digestChunk = chunks.find(
      (chunk) => chunk.data != null && Utils.toUTF8(chunk.data) === DIGEST
    )
    expect(digestChunk).toBeDefined()
    digestChunk!.data = Utils.toArray('b'.repeat(64), 'utf8')

    expect(tryParseUoraAnchor(new LockingScript(chunks))).toBeNull()
  })

  it('refuses a signature lifted from another anchor', async () => {
    const mine = await writeAnchor()
    const theirs = await writeAnchor(
      uoraAnchorFields(anchorData({ attestationId: 'att_other' })),
      'att_other'
    )
    // Two pushes lead (the key and OP_CHECKSIG), then the seven fields, then the
    // signature. Counted rather than taken from the end, because the end is a
    // run of OP_2DROP/OP_DROP and swapping one of those proves nothing.
    const at = 2 + UORA_ANCHOR_FIELD_COUNT
    expect(mine.chunks[at]?.data?.length).toBeGreaterThan(0)

    const chunks = mine.chunks.map((chunk) => ({ ...chunk }))
    chunks[at] = { ...theirs.chunks[at] }
    expect(chunks[at].data).not.toEqual(mine.chunks[at].data)
    expect(tryParseUoraAnchor(new LockingScript(chunks))).toBeNull()
  })

  it('refuses an anchor whose prefix says v3 but whose signature is absent', async () => {
    const script = await new PushDrop(serviceWallet).lock(
      uoraAnchorFields(anchorData()),
      UORA_ANCHOR_PROTOCOL,
      ATTESTATION_ID,
      'anyone',
      true,
      false // includeSignature, and nothing appended in its place
    )
    expect(tryParseUoraAnchor(script)).toBeNull()
  })
})

describe('the format is self-describing', () => {
  it('names itself in field 0, so a stranger can tell what it is', async () => {
    const script = await writeAnchor()
    const first = script.chunks[2]?.data
    expect(first).toBeDefined()
    expect(Utils.toUTF8(first!)).toBe(UORA_ANCHOR_PREFIX)
  })
})

describe('the shared fixture, which is the contract with the resolver', () => {
  /**
   * The other half of the agreement. The anchoring service writes this exact output and
   * asserts the same hex in its own suite; this one reads it. Neither imports
   * the other, so the constant is the contract, and a change on one side that
   * is not made on the other turns one of the two suites red with a diff a
   * person can read.
   */
  const script = LockingScript.fromHex(F.lockingScript)

  it('reads every field the resolver wrote', () => {
    expect(tryParseUoraAnchor(script)).toEqual({
      digest: F.digest,
      attestationId: F.attestationId,
      issuer: F.issuerDid,
      issuerKey: F.issuerKey,
      subject: F.subject,
      uoraType: F.uoraType,
      anchoredBy: F.anchoredBy,
      lockingKey: F.lockingKey,
    })
  })

  it('writes the same output the resolver pinned', async () => {
    // The strongest form of the contract: not only can this package read the
    // resolver's bytes, it produces them. If the preimage, the counterparty,
    // the field order or `includeSignature` drifts on either side, this line
    // fails with the two hex strings side by side.
    const written = await writeUoraAnchor(
      serviceWallet,
      uoraAnchorFields({
        digest: F.digest,
        attestationId: F.attestationId,
        issuer: F.issuerDid,
        subject: F.subject,
        uoraType: F.uoraType,
        anchoredBy: F.anchoredBy,
      }),
      F.attestationId
    )
    expect(written.toHex()).toBe(F.lockingScript)
  })

  it('attributes it to the anchoring service from its published key alone', () => {
    expect(expectedLockingKey(F.anchoredBy, F.attestationId)).toBe(F.lockingKey)
  })

  it('decodes the issuer DID to the key the resolver encoded', () => {
    expect(identityKeyFromDidKey(F.issuerDid)).toBe(F.issuerKey)
    expect(didKeyFromIdentityKey(F.issuerKey)).toBe(F.issuerDid)
  })
})

describe('the boundary between the subject and the type', () => {
  /*
   * The forgery v2 admitted, and the reason this package now reads v3 only.
   *
   * Each entry in `boundaryShifted` is the pinned output with that one boundary
   * re-cut and the signature bytes copied across untouched. No field content
   * changes and no signature byte changes, only where one field is said to stop
   * and the next to start. A reader that flattens the fields before hashing
   * cannot tell the difference, which is why this reader does not.
   */
  it('is a forgery that changes no content and no signature, only a boundary', () => {
    const genuine = PushDrop.decode(LockingScript.fromHex(F.lockingScript))
    expect(F.boundaryShifted.length).toBeGreaterThan(0)
    for (const hex of F.boundaryShifted) {
      const forged = PushDrop.decode(LockingScript.fromHex(hex))
      // Identical bytes once the boundaries are thrown away, which is exactly
      // what v2 hashed, and an identical signature over them.
      expect(forged.fields.slice(0, -1).flat()).toEqual(genuine.fields.slice(0, -1).flat())
      expect(forged.fields.at(-1)).toEqual(genuine.fields.at(-1))
      // And yet a different subject and a different type.
      expect(forged.fields[4]).not.toEqual(genuine.fields[4])
      expect(forged.fields[5]).not.toEqual(genuine.fields[5])
    }
  })

  it('refuses every one of them, so nothing unsigned reaches an index', () => {
    for (const hex of F.boundaryShifted) {
      expect(tryParseUoraAnchor(LockingScript.fromHex(hex))).toBeNull()
    }
  })

  it('still reads the genuine anchor, so the check is not simply refusing everything', () => {
    const anchor = tryParseUoraAnchor(LockingScript.fromHex(F.lockingScript))
    expect(anchor?.subject).toBe(F.subject)
    expect(anchor?.uoraType).toBe(F.uoraType)
  })
})

describe('the shapes a lenient reader admitted, and this one refuses', () => {
  /*
   * Both were found by an adversarial verification of the published format
   * text against this reader, not by an incident: nothing on chain uses
   * either shape. The uncompressed push passed attribution because a decoded
   * key re-compresses before the comparison, so admitting it was invisible;
   * the tail was simply never looked at past the first drop opcode. The
   * record rail's codec was always exact about both, and the two rails now
   * refuse alike.
   */
  it('refuses the 65-byte uncompressed locking push', () => {
    expect(tryParseUoraAnchor(LockingScript.fromHex(F.uncompressedKey))).toBeNull()
  })

  it('refuses a short, mixed or trailing drop tail', () => {
    expect(F.malformedTail.length).toBeGreaterThan(0)
    for (const hex of F.malformedTail) {
      expect(tryParseUoraAnchor(LockingScript.fromHex(hex))).toBeNull()
    }
  })
})
