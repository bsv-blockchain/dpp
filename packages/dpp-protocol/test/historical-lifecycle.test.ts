// The historical native claim, `dpp-lifecycle-v1`, is frozen. The public
// starter now issues EPCIS lifecycle claims, and every claim already signed
// in the old format keeps its bytes, its digest and its meaning. This test
// holds the historical fixtures and vectors to the bytes they were published
// with and verifies every claim in them under the native claim's own rules.
// That the EPCIS lifecycle verifier never reads one as its own is held beside
// that verifier, in the credentials package.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LockingScript, Utils } from '@bsv/sdk'
import { describe, expect, it } from 'vitest'
import {
  LIFECYCLE_CLAIM_FORMAT,
  decodeAttestationAnchor,
  lifecycleClaimBytes,
  lifecycleClaimDigest,
  verifyLifecycleClaim,
  type SignedLifecycleClaim,
} from '../src/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (path: string): Buffer => readFileSync(join(ROOT, path))
const json = <T>(path: string): T => JSON.parse(read(path).toString('utf8')) as T

/** Each frozen file and the SHA-256 of the bytes it was published with. A change to any of them is a change to signed history. */
const FROZEN: Record<string, string> = {
  'fixtures/attestation-anchor-v1.json': '5a08fab4ee1739262b1f5f3c4521b92c3e84c9553e9077f1b78b8c786f6befd1',
  'fixtures/battery-lifecycle-v1.json': 'eeea5a2bc1cac27e3a8f4d6cb43ac9c8a9602673922b87ddab40fe6ca3dee330',
  'fixtures/vectors/dpp/attestation-anchor/v1.json': '417dda3c9353283302041a9fac03bde31fe2627c12e4a02260e8c3027fcaa34f',
  'examples/lifecycle-v2.mjs': '2322077ddc982d3e1f4220ae9d5094e4358d3c184039faa898ab8f94a08b75b9',
}

/** The complete-representation digest of each native claim in the battery fixture, in state order, with its historical category. */
const BATTERY_CLAIMS: Array<[string, string]> = [
  ['Origin', '0e9601d65d182a5e29a10208fc4b675baf171aa9542371429e3b5dd6d35a9c9b'],
  ['Transfer', 'c1992f7add3e8919f930360cbccb80f4a12ee60a1e39d2b12a4f58498a457c7f'],
  ['Transfer', 'dc6465594dc5baac3b8b5002b03d4bdb9c7298058d055e22cd6ef04d755f397e'],
  ['Transformation', '90e19a14a0f86a90b9a644a5ef1d714632880245266a09705dc01b659df5f381'],
  ['Transformation', '7942c7fbe31a53585dc77ae5fdb945819edf05b12d1a4803a5071dc3e3ec3205'],
  ['Disposition', '4f2aa2ec3e67ef9b3d82898e6b85f9f141fbc6ab2c01a7167ef909b1dae1422f'],
]
const ANCHOR_CLAIM_DIGEST = 'd9c3a9927974733f9abd40af208e332228dd5ad45269cbbd3a551e2a1ad5aa53'

describe('the historical native claim, frozen', () => {
  it('keeps every historical fixture, vector and example byte for byte', () => {
    for (const [path, digest] of Object.entries(FROZEN)) expect(createHash('sha256').update(read(path)).digest('hex'), path).toBe(digest)
  })

  it('verifies the anchor fixture\'s claim under its own rules, with the digest, bytes and anchor it was published with', () => {
    const fixture = json<{ claim: SignedLifecycleClaim; digest: string; representationHex: string; anchor: Record<string, string>; lockingScript: string }>('fixtures/attestation-anchor-v1.json')
    expect(fixture.claim.claimFormat).toBe(LIFECYCLE_CLAIM_FORMAT)
    expect(verifyLifecycleClaim(fixture.claim).signature).toBe('verified')
    expect(lifecycleClaimDigest(fixture.claim)).toBe(ANCHOR_CLAIM_DIGEST)
    expect(fixture.digest).toBe(ANCHOR_CLAIM_DIGEST)
    expect(Utils.toHex(lifecycleClaimBytes(fixture.claim))).toBe(fixture.representationHex)
    const anchor = decodeAttestationAnchor(LockingScript.fromHex(fixture.lockingScript))
    expect(anchor).toMatchObject(fixture.anchor)
    // A historical event type keeps its historical meaning: the anchor's type is the category, never an EPCIS event type.
    expect(anchor?.attestationType).toBe('Origin')
    expect(anchor?.representation).toBe('dpp-lifecycle-json-v1')
  })

  it('verifies every claim of the battery fixture under its own rules, with the digests it was published with', () => {
    const fixture = json<{ states: Array<{ claim: SignedLifecycleClaim; txid: string }> }>('fixtures/battery-lifecycle-v1.json')
    expect(fixture.states.map((s) => [s.claim.eventType, lifecycleClaimDigest(s.claim)])).toEqual(BATTERY_CLAIMS)
    for (const { claim, txid } of fixture.states) {
      expect(verifyLifecycleClaim(claim).signature, txid).toBe('verified')
      expect(claim.claimFormat).toBe(LIFECYCLE_CLAIM_FORMAT)
    }
  })

  it('reproduces the anchor vector\'s claim and digest under the native rules', () => {
    const vectors = json<{ vectors: Array<{ id: string; expected: { claim?: SignedLifecycleClaim; digest_hex?: string; secured_bytes_hex?: string } }> }>('fixtures/vectors/dpp/attestation-anchor/v1.json')
    const signed = vectors.vectors.find((v) => v.id === 'signed-claim-to-anchor')!.expected
    expect(verifyLifecycleClaim(signed.claim!).signature).toBe('verified')
    expect(lifecycleClaimDigest(signed.claim!)).toBe(signed.digest_hex)
    expect(Utils.toHex(lifecycleClaimBytes(signed.claim!))).toBe(signed.secured_bytes_hex)
  })

  it('still runs the record version 2 example, whose native claim verifies under the native rules', () => {
    const output = execFileSync(process.execPath, [join(ROOT, 'examples/lifecycle-v2.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(output).toContain("ok: the recycler's claim about the retired passport verifies under the recycler's own key")
    expect(output.trimEnd().endsWith('Every sentence above holds.')).toBe(true)
  })
})
