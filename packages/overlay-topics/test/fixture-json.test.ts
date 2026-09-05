import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LockingScript, PushDrop } from '@bsv/sdk'
import { tryParseUoraAnchor } from '../src/uoraAnchor.js'
import { ANCHOR_V3_FIXTURE } from './anchor-v3-fixture.js'
import { anchorV3Vectors } from './anchor-v3-vectors.js'

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

/**
 * The anchor files in fixtures/ are served to implementations that cannot
 * import this package, and the contract of each is that it is its generating
 * module, verbatim. This is the enforcement: regenerating the module without
 * regenerating the JSON, or editing the JSON by hand, goes red with a diff.
 *
 * REGENERATE_FIXTURES=1 rewrites the published file from its generator before
 * comparing, so the one way to change a published fixture is to change the
 * module and review the diff (fixtures/README.md, "Two forms, one set of bytes").
 * The same two helpers live in the core's fixture-json.test.ts; the packages
 * share fixtures, never test code, on purpose (see uoraAnchor.ts).
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
  expect(file.id).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/)
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
  it('anchor-v3.json is anchor-v3-fixture.ts, verbatim', () => {
    expectPublished('anchor-v3.json', ANCHOR_V3_FIXTURE)
  })

  it('vectors/dpp/anchor/v3.json is anchorV3Vectors(), verbatim, and shaped as the stack expects', () => {
    const generated = anchorV3Vectors()
    expectPublished('vectors/dpp/anchor/v3.json', generated)
    expectStackShape(generated)
  })

  /*
   * The vector form carries three refusals the bespoke fixture does not, built
   * by the generator from the pinned output. This holds them to what they claim
   * to be: the genuine script with exactly one field one character over its
   * bound, the signature untouched, and refused by this reader all the same.
   */
  it('builds the three overlong refusals from the pinned output, and this reader refuses each', () => {
    const genuine = PushDrop.decode(LockingScript.fromHex(ANCHOR_V3_FIXTURE.lockingScript))
    const overlong: Array<[string, number, number]> = [
      ['refuse-overlong-attestation-id', 2, 257],
      ['refuse-overlong-subject', 4, 513],
      ['refuse-overlong-type', 5, 65],
    ]
    const byId = new Map(anchorV3Vectors().vectors.map((v) => [v.id, v]))
    for (const [id, index, length] of overlong) {
      const hex = (byId.get(id)?.input as { locking_script_hex: string }).locking_script_hex
      const script = LockingScript.fromHex(hex)
      const decoded = PushDrop.decode(script)
      expect(decoded.lockingPublicKey.toString()).toBe(ANCHOR_V3_FIXTURE.lockingKey)
      expect(decoded.fields.length).toBe(genuine.fields.length)
      decoded.fields.forEach((field, i) => {
        if (i === index) expect(field.length).toBe(length)
        else expect(field).toEqual(genuine.fields[i])
      })
      expect(tryParseUoraAnchor(script)).toBeNull()
    }
  })
})
