import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Hash, Utils } from '@bsv/sdk'
import { canonicalBytes, canonicalString } from '../src/index.js'
import { RECORD_V1_FIXTURE } from './record-v1-fixture.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'
import { recordV1Vectors } from './record-v1-vectors.js'
import { chainV1Vectors } from './chain-v1-vectors.js'
import { evidenceV1Fixture } from './evidence-v1-fixture.js'
import { publisherPolicyVectors } from './publisher-policy-vectors.js'
import { evidencePackageVectors } from './evidence-package-vectors.js'

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

/**
 * The files in fixtures/ are served to implementations that cannot import this
 * package, and the contract of each is that it is its generating module,
 * verbatim. This is the enforcement: regenerating the module without
 * regenerating the JSON, or editing the JSON by hand, goes red with a diff.
 *
 * REGENERATE_FIXTURES=1 rewrites the published file from its generator before
 * comparing, so the one way to change a published fixture is to change the
 * module and review the diff (fixtures/README.md, "Two forms, one set of bytes").
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
  it('record-v1.json is record-v1-fixture.ts, verbatim', () => {
    expectPublished('record-v1.json', RECORD_V1_FIXTURE)
  })

  it('chain-v1.json is chain-v1-fixture.ts, verbatim', () => {
    expectPublished('chain-v1.json', CHAIN_V1_FIXTURE)
  })

  it('vectors/dpp/record/v1.json is recordV1Vectors(), verbatim, and shaped as the stack expects', () => {
    const generated = recordV1Vectors()
    expectPublished('vectors/dpp/record/v1.json', generated)
    expectStackShape(generated)
  })

  it('vectors/dpp/chain/v1.json is chainV1Vectors(), verbatim, and shaped as the stack expects', () => {
    const generated = chainV1Vectors()
    expectPublished('vectors/dpp/chain/v1.json', generated)
    expectStackShape(generated)
  })

  it('evidence-v1.json is evidenceV1Fixture(), verbatim: the report every surface produces for each case', async () => {
    const generated = await evidenceV1Fixture()
    expect(generated.cases.map((c) => c.id)).toEqual([...new Set(generated.cases.map((c) => c.id))])
    for (const c of generated.cases) expect(c.report.checkedAt).toBe(generated.checkedAt)
    expectPublished('evidence-v1.json', generated)
  })

  it('vectors/dpp/publisher-policy/v1.json is publisherPolicyVectors(), verbatim, and shaped as the stack expects', () => {
    const generated = publisherPolicyVectors()
    expectPublished('vectors/dpp/publisher-policy/v1.json', generated)
    expectStackShape(generated as never)
  })

  it('vectors/dpp/evidence-package/v1.json is evidencePackageVectors(), verbatim, and shaped as the stack expects', async () => {
    const generated = await evidencePackageVectors()
    expectPublished('vectors/dpp/evidence-package/v1.json', generated)
    expectStackShape(generated as never)
  })

  it('anchor-v3.json canonical bytes and digest are what this package computes', () => {
    const F = JSON.parse(readFileSync(join(FIXTURES, 'anchor-v3.json'), 'utf8'))
    expect(canonicalString(F.attestation)).toBe(F.canonical)
    expect(Utils.toHex(Hash.sha256(canonicalBytes(F.attestation)))).toBe(F.digest)
  })
})
