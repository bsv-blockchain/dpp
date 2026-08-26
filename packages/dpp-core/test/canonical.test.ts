import { describe, expect, it } from 'vitest'
import { Hash, Utils } from '@bsv/sdk'
import { CanonicalError, canonicalBytes, canonicalString } from '../src/index.js'

const claim = (overrides: Record<string, unknown> = {}) => ({
  passportId: 'https://id.gs1.org/01/09506000134352/21/JERSEY-001',
  recordId: 'state-1',
  uora_type: 'Origin',
  timestamp: '2026-08-01T09:00:00.000Z',
  issuer: 'did:key:zQ3shNu2oFTbeqexYeunD36my3aQNqEWq8mWD2ACRqQLEipcz',
  issuerKeyId: 'acct/user_fixture',
  profile: 'battery',
  profile_version: 2,
  ...overrides,
})

describe('canonical bytes', () => {
  it('sorts keys, so two writers of the same claim produce one string', () => {
    const forward = canonicalString(claim())
    const shuffled = canonicalString(Object.fromEntries(Object.entries(claim()).reverse()))
    expect(shuffled).toBe(forward)
    expect(forward.startsWith('{"issuer":')).toBe(true)
  })

  it('has no whitespace to disagree about', () => {
    expect(canonicalString(claim())).not.toMatch(/\s(?![^"]*"[,}])/)
  })

  it('changes when any value changes', () => {
    expect(canonicalString(claim())).not.toBe(canonicalString(claim({ uora_type: 'Transfer' })))
  })

  it('refuses what it cannot canonicalise rather than guessing', () => {
    expect(() => canonicalBytes(claim({ profile_version: 2.5 }))).toThrow(CanonicalError)
    expect(() => canonicalBytes(claim({ nested: { a: 1 } }))).toThrow(CanonicalError)
    expect(() => canonicalBytes(claim({ flag: true }))).toThrow(CanonicalError)
    expect(() => canonicalBytes(claim({ issuerKeyDid: undefined }))).toThrow(CanonicalError)
  })

  it('treats an absent property and a present one as different claims', () => {
    const withKeyDid = canonicalString(claim({ issuerKeyDid: 'did:key:zQ3shNu2oFTbeqexYeunD36my3aQNqEWq8mWD2ACRqQLEipcz' }))
    expect(withKeyDid).not.toBe(canonicalString(claim()))
  })
})

describe('the anchor fixture pins the canonicaliser', () => {
  /**
   * The claim from fixtures/anchor-v3.json and the string and digest it pins,
   * carried here as literals so this file needs nothing outside the package;
   * fixture-json.test.ts holds the file itself to the same values.
   */
  const attestation = {
      "passportId": "https://id.gs1.org/01/09506000134352/21/B59E82284DEE",
      "recordId": "state-1",
      "uora_type": "Origin",
      "timestamp": "2026-08-01T09:00:00.000Z",
      "issuer": "did:key:zQ3shNu2oFTbeqexYeunD36my3aQNqEWq8mWD2ACRqQLEipcz",
      "issuerKeyId": "acct/user_fixture",
      "profile": "battery",
      "profile_version": 2
  }
  const canonical = "{\"issuer\":\"did:key:zQ3shNu2oFTbeqexYeunD36my3aQNqEWq8mWD2ACRqQLEipcz\",\"issuerKeyId\":\"acct/user_fixture\",\"passportId\":\"https://id.gs1.org/01/09506000134352/21/B59E82284DEE\",\"profile\":\"battery\",\"profile_version\":2,\"recordId\":\"state-1\",\"timestamp\":\"2026-08-01T09:00:00.000Z\",\"uora_type\":\"Origin\"}"
  const digest = 'e4f663b7e87a40b601716e873a2dec3a37b6a45bd0c8557cb25310ab4e736d11'

  it('reproduces the pinned canonical string byte for byte', () => {
    expect(canonicalString(attestation)).toBe(canonical)
  })

  it('hashes to the digest the anchor carries in field 2', () => {
    expect(Utils.toHex(Hash.sha256(canonicalBytes(attestation)))).toBe(digest)
  })
})
