import { describe, expect, it } from 'vitest'
import { Hash, Utils } from '@bsv/sdk'
import { ownerBlobHash, verifyOwnerBlob } from '../src/index.js'

describe('owner-tier blob binding (§7)', () => {
  const blob = [10, 20, 30, 40]

  it('hashes the ciphertext with SHA-256, hex-encoded', () => {
    expect(ownerBlobHash(blob)).toBe(Utils.toHex(Hash.sha256(blob)))
    expect(ownerBlobHash(blob)).toHaveLength(64)
  })

  it('accepts the matching ciphertext', () => {
    expect(verifyOwnerBlob(blob, ownerBlobHash(blob))).toBe(true)
  })

  it('rejects a swapped or truncated ciphertext', () => {
    expect(verifyOwnerBlob([10, 20, 30], ownerBlobHash(blob))).toBe(false)
    expect(verifyOwnerBlob([99, ...blob.slice(1)], ownerBlobHash(blob))).toBe(false)
  })

  it('rejects against a passport with no owner tier (empty field 11)', () => {
    expect(verifyOwnerBlob(blob, '')).toBe(false)
  })
})
