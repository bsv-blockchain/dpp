import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LockingScript } from '@bsv/sdk'
import { ANCHOR_V3_FIXTURE } from './anchor-v3-fixture.js'
import { attestationV1Fixture, attestationV1Vectors } from './attestation-v1-fixture.js'
import { decodeAttestationAnchor } from '../src/attestationAnchor.js'

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

/**
 * The anchor files in fixtures/ are served to implementations that cannot
 * import this package, and the contract of each is that it is its generating
 * module, verbatim. This is the enforcement: regenerating the module without
 * regenerating the JSON, or editing the JSON by hand, goes red with a diff.
 *
 * REGENERATE_FIXTURES=1 rewrites the published file from its generator before
 * comparing, so the one way to change a published fixture is to change the
 * module and review the diff (fixtures/README.md, "Two forms, one per format").
 * The same two helpers live in the core's fixture-json.test.ts; the packages
 * share fixtures, never test code, on purpose (see uoraAnchor.ts). The
 * current anchor's six refusals are pinned in its vector file, which is why
 * that file stays; the historical anchor's four length-bound refusals are
 * built in anchor-v3-bounds.test.ts.
 */
function expectPublished(relative: string, generated: unknown): void {
  const path = join(FIXTURES, ...relative.split('/'))
  const canonical = JSON.parse(JSON.stringify(generated))
  if (process.env.REGENERATE_FIXTURES === '1') {
    writeFileSync(path, JSON.stringify(canonical, null, 2) + '\n')
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(canonical)
}

type VectorFile = Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> }

/**
 * The stack's structural runner is an external checkout CI cannot run, so the
 * shape it validates is checked here: the envelope, one identifier per vector,
 * the four required properties, and lower-case hex under every key ending in
 * _hex, whether a string or a list of them.
 */
function expectStackShape(file: VectorFile): void {
  for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) {
    expect(file).toHaveProperty(key)
  }
  expect(file.id).toMatch(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/)
  const ids = file.vectors.map((v) => v.id)
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
  for (const v of file.vectors) {
    for (const key of ['id', 'description', 'input', 'expected']) expect(v).toHaveProperty(key)
    expect(v.id).toMatch(/^[a-z0-9-]+$/)
    walk(v, v.id)
  }
}

describe('the published fixture files', () => {
  it('reproduces the portable complete-representation fixture and the stack vectors that carry its refusals', async () => {
    const fixture = await attestationV1Fixture()
    expectPublished('attestation-anchor-v1.json', fixture)
    const generated = attestationV1Vectors(fixture)
    expectPublished('vectors/dpp/attestation-anchor/v1.json', generated)
    expectStackShape(generated)
    for (const vector of generated.vectors) {
      if (!('locking_script_hex' in vector.input)) continue
      const decoded = decodeAttestationAnchor(LockingScript.fromHex(vector.input.locking_script_hex!))
      expect(decoded !== null, vector.id).toBe(vector.expected.accepted)
    }
  })

  it('anchor-v3.json is anchor-v3-fixture.ts, verbatim', () => {
    expectPublished('anchor-v3.json', ANCHOR_V3_FIXTURE)
  })
})
