import { describe, expect, it } from 'vitest'
import { Hash, LockingScript, PrivateKey, ProtoWallet, PushDrop, Utils } from '@bsv/sdk'
import { canonicalBytes } from '@bsv/dpp-protocol'
import { tryParseUoraAnchor, uoraAnchorFields } from '../src/uoraAnchor.js'
import { ANCHOR_V3_FIXTURE as F } from './anchor-v3-fixture.js'
import { writeUoraAnchor } from './writeAnchor.js'

/**
 * The four length-bound refusals of the historical anchor, which the bespoke
 * fixture does not pin. Its vector form carried them until that file was
 * removed on 12 November 2026; they are built here from the pinned output
 * rather than pinned again, so `fixtures/anchor-v3.json` stays exactly as the
 * implementing repositories hold it.
 *
 * Three swap one field of the genuine script for a minimal push one character
 * over the bound `spec/legacy-uora-anchor-v3.md` §5 sets on it, leaving the
 * locking key, the other fields, the signature and the tail untouched. A
 * conforming reader refuses each at the bound, before it reaches the
 * signature, so the signature need not cover the new field.
 *
 * The fourth is a claim whose `passportId` is one byte over the bound §3 sets,
 * because the field is the signature's BRC-42 key identifier. Nothing in this
 * repository emits a historical claim, so the refusal is held where this
 * package meets one: an anchor written for that claim and correctly signed by
 * the anchoring service names it as its subject, and is refused at the
 * subject's bound, while the same construction over the pinned claim
 * reproduces the pinned output.
 */
const MAX_ATTESTATION_ID = 256
const MAX_SUBJECT = 512
const MAX_TYPE = 64

const OP_PUSHDATA1 = 0x4c
const OP_PUSHDATA2 = 0x4d

/** `value` extended with `A`s (after `separator`) to exactly `length` characters. */
function overlong(value: string, length: number, separator = ''): string {
  return value + separator + 'A'.repeat(length - value.length - separator.length)
}

/**
 * The genuine script with the field at `index` (0-based among the eight)
 * replaced by `text` as a minimal push. The locking key, the other fields, the
 * signature and the tail are untouched.
 */
function withField(lockingScript: string, index: number, text: string): LockingScript {
  const chunks = LockingScript.fromHex(lockingScript).chunks.map((chunk) => ({ ...chunk }))
  const data = Utils.toArray(text, 'utf8')
  const op = data.length <= 75 ? data.length : data.length <= 0xff ? OP_PUSHDATA1 : OP_PUSHDATA2
  chunks[2 + index] = { op, data }
  return new LockingScript(chunks)
}

describe('the historical anchor: a field over its bound', () => {
  const genuine = PushDrop.decode(LockingScript.fromHex(F.lockingScript))
  const cases: Array<[string, number, string]> = [
    ['attestation id', 2, overlong(F.attestationId, MAX_ATTESTATION_ID + 1)],
    ['subject', 4, overlong(F.subject, MAX_SUBJECT + 1, '/')],
    ['type', 5, overlong(F.uoraType, MAX_TYPE + 1)],
  ]

  it.each(cases)('refuses the pinned output with its %s one character over the bound', (_name, index, text) => {
    const script = withField(F.lockingScript, index, text)
    const decoded = PushDrop.decode(script)
    expect(decoded.lockingPublicKey.toString()).toBe(F.lockingKey)
    expect(decoded.fields.length).toBe(genuine.fields.length)
    decoded.fields.forEach((field, i) => {
      if (i === index) expect(field.length).toBe(text.length)
      else expect(field).toEqual(genuine.fields[i])
    })
    expect(tryParseUoraAnchor(script)).toBeNull()
  })
})

describe('the historical anchor: a claim over its passportId bound', () => {
  const anchoring = new ProtoWallet(PrivateKey.fromHex('77'.repeat(32)))
  const anchorFor = async (claim: { passportId: string } & Record<string, string | number>): Promise<LockingScript> =>
    await writeUoraAnchor(
      anchoring,
      uoraAnchorFields({
        digest: Utils.toHex(Hash.sha256(canonicalBytes(claim))),
        attestationId: F.attestationId,
        issuer: F.issuerDid,
        subject: claim.passportId,
        uoraType: F.uoraType,
        anchoredBy: F.anchoredBy,
      }),
      F.attestationId
    )

  it('reproduces the pinned output from the pinned claim, so the construction is the fixture\'s own', async () => {
    expect((await anchorFor(F.attestation)).toHex()).toBe(F.lockingScript)
  })

  it('refuses a correctly signed anchor for a claim whose passportId is one byte over the bound', async () => {
    const claim = { ...F.attestation, passportId: overlong(F.attestation.passportId, MAX_SUBJECT + 1, '/') }
    expect(Utils.toArray(claim.passportId, 'utf8').length).toBe(MAX_SUBJECT + 1)
    expect(tryParseUoraAnchor(await anchorFor(claim))).toBeNull()
  })
})
