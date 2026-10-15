import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { attestationAnchorFields, attestationAnchorSigningPreimage, buildAttestationAnchor, decodeAttestationAnchor } from '../src/attestationAnchor.js'

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
const wallet = new ProtoWallet(PrivateKey.fromHex(fixture.anchoringPrivateKey))

describe('generic complete-representation anchor', () => {
  it('matches the independently generated portable ten-field fixture', async () => {
    const script = await buildAttestationAnchor(fixture.anchor, wallet)
    expect(script.toHex()).toBe(fixture.lockingScript)
    expect(Utils.toHex(attestationAnchorSigningPreimage(attestationAnchorFields(fixture.anchor)))).toBe(fixture.signingPreimage)
    expect(decodeAttestationAnchor(script)).toMatchObject({ ...fixture.anchor, lockingKey: fixture.lockingKey })
  })

  it('carries an Ed25519/web issuer without treating it as a BSV key', async () => {
    const script = await buildAttestationAnchor({ ...fixture.anchor, issuer: 'did:web:issuer.example', attestationType: 'VSC-SEAL', representation: 'vsc-seal-json-v1', mediaType: 'application/vc+ld+json' }, wallet)
    expect(decodeAttestationAnchor(script)?.issuer).toBe('did:web:issuer.example')
  })

  it.each([3, 4, 5, 6, 7, 8, 9, 10])('rejects mutation of signed field chunk %i', chunk => {
    const script = LockingScript.fromHex(fixture.lockingScript)
    script.chunks[chunk].data![0] ^= 1
    expect(decodeAttestationAnchor(script)).toBeNull()
  })

  it('rejects shifted boundaries despite identical concatenated field bytes', () => {
    const script = LockingScript.fromHex(fixture.lockingScript)
    const subject = script.chunks[6].data!
    const type = script.chunks[7].data!
    script.chunks[6].data = subject.slice(0, -1)
    script.chunks[7].data = [subject.at(-1)!, ...type]
    expect(decodeAttestationAnchor(script)).toBeNull()
  })

  it('rejects uncompressed keys, wrong tails, trailing code and malformed UTF-8', () => {
    for (const change of [
      (script: LockingScript) => { script.chunks[0].data = PrivateKey.fromHex(fixture.anchoringPrivateKey).toPublicKey().encode(false) as number[] },
      (script: LockingScript) => { script.chunks.pop() },
      (script: LockingScript) => { script.chunks[16].op = 0x75 },
      (script: LockingScript) => { script.writeOpCode(0x51) },
      (script: LockingScript) => { script.chunks[6].data = [0xc0, 0xaf] },
    ]) {
      const script = LockingScript.fromHex(fixture.lockingScript)
      change(script)
      expect(decodeAttestationAnchor(script)).toBeNull()
    }
  })

  it('bounds fields by UTF-8 bytes and refuses control characters', async () => {
    for (const subject of ['é'.repeat(257), 'line\nbreak', 'bad\u0080subject', '\ud800']) {
      await expect(buildAttestationAnchor({ ...fixture.anchor, subject }, wallet)).rejects.toThrow()
    }
  })

  it('refuses a wrong anchoring signer and historical layouts', async () => {
    await expect(buildAttestationAnchor(fixture.anchor, new ProtoWallet(PrivateKey.fromHex('66'.repeat(32))))).rejects.toThrow()
    const legacy = JSON.parse(readFileSync(new URL('../../../fixtures/anchor-v3.json', import.meta.url), 'utf8'))
    expect(decodeAttestationAnchor(LockingScript.fromHex(legacy.lockingScript))).toBeNull()
  })
})
