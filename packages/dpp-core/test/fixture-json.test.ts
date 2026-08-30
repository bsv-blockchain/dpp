import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECORD_V1_FIXTURE } from './record-v1-fixture.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'
import { chainV1Vectors } from './chain-v1-vectors.js'
import { Hash, Utils } from '@bsv/sdk'
import { canonicalBytes, canonicalString } from '../src/index.js'

/**
 * fixtures/record-v1.json is served to implementations that cannot import
 * this package, and its contract is that it is this module, verbatim. This
 * test is the enforcement: regenerating the module without regenerating the
 * JSON (or editing the JSON by hand) goes red with a diff.
 */
describe('the published fixture files', () => {
  it('record-v1.json is record-v1-fixture.ts, verbatim', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'record-v1.json'),
        'utf8'
      )
    )
    expect(published).toEqual(JSON.parse(JSON.stringify(RECORD_V1_FIXTURE)))
  })

  it('chain-v1.json is chain-v1-fixture.ts, verbatim', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'chain-v1.json'),
        'utf8'
      )
    )
    expect(published).toEqual(JSON.parse(JSON.stringify(CHAIN_V1_FIXTURE)))
  })

  it('vectors/dpp/chain/v1.json is chainV1Vectors(), verbatim, and shaped as the stack expects', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'vectors', 'dpp', 'chain', 'v1.json'),
        'utf8'
      )
    )
    const generated = JSON.parse(JSON.stringify(chainV1Vectors()))
    expect(published).toEqual(generated)

    // The stack's structural runner is an external checkout CI cannot run, so
    // the shape it validates is checked here: the envelope, one identifier per
    // vector, the four required properties, and lower-case hex under every key
    // ending in _hex, whether a string or a list of them.
    for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) {
      expect(generated).toHaveProperty(key)
    }
    expect(generated.id).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/)
    const ids = generated.vectors.map((v: { id: string }) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    const hexOnly = (value: unknown, path: string): void => {
      if (typeof value === 'string') expect(value, path).toMatch(/^[0-9a-f]*$/)
      else if (Array.isArray(value)) value.forEach((v, i) => hexOnly(v, `${path}[${i}]`))
      else expect.fail(`${path} is neither a hex string nor a list of them`)
    }
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`))
      if (value == null || typeof value !== 'object') return
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k.endsWith('_hex')) hexOnly(v, `${path}.${k}`)
        else walk(v, `${path}.${k}`)
      }
    }
    for (const v of generated.vectors) {
      for (const key of ['id', 'description', 'input', 'expected']) expect(v).toHaveProperty(key)
      expect(v.id).toMatch(/^[a-z0-9-]+$/)
      walk(v, v.id)
    }
  })

  it('anchor-v3.json canonical bytes and digest are what this package computes', () => {
    const F = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'anchor-v3.json'),
        'utf8'
      )
    )
    expect(canonicalString(F.attestation)).toBe(F.canonical)
    expect(Utils.toHex(Hash.sha256(canonicalBytes(F.attestation)))).toBe(F.digest)
  })
})
