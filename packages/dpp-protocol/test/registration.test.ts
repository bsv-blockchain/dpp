import { describe, expect, it } from 'vitest'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
  INDEX_REGISTRATION_FORMAT,
  INDEX_REGISTRATION_PROTOCOL_ID,
  inspectRegistration,
  registrationSigningPreimage,
  registrationVerificationKey,
  signRegistration,
  type RegistrationClaim,
} from '../src/index.js'

const appPriv = PrivateKey.fromHex('33'.repeat(32))
const strangerPriv = PrivateKey.fromHex('44'.repeat(32))
const appWallet = new ProtoWallet(appPriv)
const strangerWallet = new ProtoWallet(strangerPriv)
const INDEX_URL = 'https://index.example/'
const NOW = new Date('2026-11-02T10:00:00Z')

const claim = (overrides: Partial<RegistrationClaim> = {}): RegistrationClaim => ({
  registrationFormat: INDEX_REGISTRATION_FORMAT,
  indexUrl: INDEX_URL,
  publisherKey: appPriv.toPublicKey().toString(),
  network: 'test',
  custodyProfile: 'managed-custody@2',
  label: 'Cell pack demo',
  requestedAt: '2026-11-02T09:58:30Z',
  ...overrides,
})

const expectations = { now: NOW, indexUrl: INDEX_URL, network: 'test', custodyProfile: 'managed-custody@2' }

const reasons = (value: unknown, exp = expectations): string[] => inspectRegistration(value, exp).failures.map((f) => f.reason)

describe('the index registration request', () => {
  it('names its format and derivation', () => {
    expect(INDEX_REGISTRATION_FORMAT).toBe('dpp-index-registration@1')
    expect(INDEX_REGISTRATION_PROTOCOL_ID).toEqual([1, 'dpp index registration v1'])
  })

  it('is signed by the wallet with the child of the publisher key for the index URL and verifies from itself', async () => {
    const request = await signRegistration(claim(), appWallet)
    expect(request.signature).toMatch(/^[0-9a-f]+$/)
    const inspection = inspectRegistration(request, expectations)
    expect(inspection.failures).toEqual([])
    expect(inspection.valid).toBe(true)
    expect(inspection.request).toEqual(request)
    const key = registrationVerificationKey(request.publisherKey, INDEX_URL)
    expect(key.toString()).not.toBe(request.publisherKey)
    const { signature: _s, ...unsigned } = request
    expect(Utils.toUTF8(registrationSigningPreimage(unsigned))).toBe(
      `{"custodyProfile":"managed-custody@2","indexUrl":"${INDEX_URL}","label":"Cell pack demo","network":"test","publisherKey":"${request.publisherKey}","registrationFormat":"dpp-index-registration@1","requestedAt":"2026-11-02T09:58:30Z"}`
    )
  })

  it('refuses a signature made with the publisher key directly', async () => {
    const request = await signRegistration(claim(), appWallet)
    const direct = { ...request, signature: Utils.toHex(appPriv.sign(registrationSigningPreimage(request)).toDER() as number[]) }
    expect(reasons(direct)).toEqual(['signature-invalid'])
  })

  it('refuses a signature from another root', async () => {
    const request = await signRegistration(claim(), appWallet)
    const { signature } = await strangerWallet.createSignature({ data: registrationSigningPreimage(request), protocolID: INDEX_REGISTRATION_PROTOCOL_ID, keyID: INDEX_URL, counterparty: 'anyone' })
    expect(reasons({ ...request, signature: Utils.toHex(signature) })).toEqual(['signature-invalid'])
  })

  it('refuses a request whose bytes changed after signing', async () => {
    const request = await signRegistration(claim(), appWallet)
    expect(reasons({ ...request, label: 'Someone else' })).toEqual(['signature-invalid'])
  })

  it('refuses a request signed for another index, whose signature still verifies under its own URL', async () => {
    const request = await signRegistration(claim({ indexUrl: 'https://other.example/' }), appWallet)
    const inspection = inspectRegistration(request, expectations)
    expect(inspection.failures.map((f) => f.reason)).toEqual(['index-url-mismatch'])
    expect(inspection.valid).toBe(false)
  })

  it('refuses the wrong network and the wrong custody profile by name', async () => {
    const request = await signRegistration(claim({ network: 'main', custodyProfile: 'record-model-baseline@2' }), appWallet)
    expect(reasons(request)).toEqual(['network-mismatch', 'custody-profile-mismatch'])
  })

  it('refuses a request outside the clock window', async () => {
    const early = await signRegistration(claim({ requestedAt: '2026-11-02T09:49:59Z' }), appWallet)
    const late = await signRegistration(claim({ requestedAt: '2026-11-02T10:10:01Z' }), appWallet)
    const edge = await signRegistration(claim({ requestedAt: '2026-11-02T09:50:00Z' }), appWallet)
    expect(reasons(early)).toEqual(['request-stale'])
    expect(reasons(late)).toEqual(['request-stale'])
    expect(reasons(edge)).toEqual([])
    expect(reasons(early, { ...expectations, windowMs: 60 * 60 * 1000 })).toEqual([])
  })

  it('checks only what the caller expects', async () => {
    const request = await signRegistration(claim(), appWallet)
    expect(reasons(request, { now: NOW })).toEqual([])
  })

  it('refuses a malformed request as format, before any signature check', async () => {
    const request = await signRegistration(claim(), appWallet)
    expect(reasons({ ...request, extra: 1 })).toEqual(['format'])
    expect(reasons({ ...request, label: '' })).toEqual(['format'])
    expect(reasons({ ...request, label: 'x'.repeat(129) })).toEqual(['format'])
    expect(reasons({ ...request, requestedAt: '2026-11-02T09:58:30' })).toEqual(['format'])
    expect(reasons({ ...request, network: 'regtest' })).toEqual(['format'])
    expect(reasons({ ...request, indexUrl: 'ftp://index.example/' })).toEqual(['format'])
    expect(reasons({ ...request, publisherKey: request.publisherKey.toUpperCase() })).toEqual(['format'])
    expect(reasons({ ...request, registrationFormat: 'dpp-index-registration@2' })).toEqual(['format'])
    expect(reasons(null)).toEqual(['format'])
    const { signature: _s, ...unsigned } = request
    expect(reasons(unsigned)).toEqual(['format'])
  })

  it('refuses to sign a claim that is not well formed or whose wallet holds another root', async () => {
    await expect(signRegistration(claim({ label: '' }), appWallet)).rejects.toThrow(/label/)
    await expect(signRegistration(claim(), strangerWallet)).rejects.toThrow(/publisher key/)
  })
})
