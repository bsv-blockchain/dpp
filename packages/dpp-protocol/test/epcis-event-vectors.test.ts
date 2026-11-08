import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { epcisEventCredentialVectors, epcisEventHashVectors } from './epcis-event-vectors.js'

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

/**
 * The two published vector files of `epcis-event-vc@1` are their generating
 * module, verbatim (fixtures/README.md, "Two forms, one set of bytes").
 * REGENERATE_FIXTURES=1 rewrites them from the generator before comparing, so
 * the one way to move a published vector is to change the generator and review
 * the diff.
 */
function expectPublished(relative: string, generated: unknown): void {
  const path = join(FIXTURES, ...relative.split('/'))
  const canonical = JSON.parse(JSON.stringify(generated))
  if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(path, JSON.stringify(canonical, null, 2) + '\n')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(canonical)
}

type VectorFile = Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> }

function expectStackShape(file: VectorFile): void {
  for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) expect(file).toHaveProperty(key)
  expect(file.id).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
  const ids = file.vectors.map((v) => v.id)
  expect(new Set(ids).size).toBe(ids.length)
  const hexOnly = (value: unknown, path: string): void => {
    if (typeof value === 'string') expect(value, path).toMatch(/^[0-9a-f]*$/)
    else if (Array.isArray(value)) value.forEach((v, i) => hexOnly(v, `${path}[${i}]`))
    else if (value != null && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v, i) => hexOnly(v, `${path}{${i}}`))
    else expect.fail(`${path} is neither a hex string nor a collection of them`)
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

describe('the published epcis-event-vc@1 vectors', () => {
  it('interoperability/epcis/hash-v1.json is epcisEventHashVectors(), verbatim, and shaped as the stack expects', () => {
    const generated = epcisEventHashVectors()
    expectPublished('vectors/dpp/interoperability/epcis/hash-v1.json', generated)
    expectStackShape(generated)
  })

  it('exchange/epcis-event-vc/v1.json is epcisEventCredentialVectors(), verbatim, and shaped as the stack expects', async () => {
    const generated = await epcisEventCredentialVectors()
    expectPublished('vectors/dpp/exchange/epcis-event-vc/v1.json', generated)
    expectStackShape(generated)
  })
})
