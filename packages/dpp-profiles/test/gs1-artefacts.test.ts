import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { GS1_RESOLVER_ARTEFACTS, INTEROPERABILITY_PROFILE_IDS, readInteroperabilityProfile } from '../src/index.js'
import { readGs1Artefact, verifyGs1Artefacts } from '../../dpp-credentials/src/gs1-artefacts.js'

const root = join(import.meta.dirname, '..')
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * GS1 publishes the resolver schemas and context under its own terms, so
 * this package pins them by address, digest and length and does not contain
 * them. The test set-up obtains the published bytes; these tests hold the
 * table and the discovery manifest to those bytes, so the table, the manifest
 * and what GS1 serves cannot drift apart. A changed upstream file is a new
 * pinned version, never an edit.
 */
describe('the pinned GS1 resolver artefacts', () => {
  it.each(GS1_RESOLVER_ARTEFACTS.map((a) => [a.fileName, a] as const))('%s is pinned at the SHA-256 and length GS1 serves', (_name, artefact) => {
    // readGs1Artefact refuses bytes that do not match; the digest and length are recomputed here so the test does not lean on it.
    const bytes = readGs1Artefact(artefact)
    expect(sha256(bytes)).toBe(artefact.sha256)
    expect(bytes.byteLength).toBe(artefact.byteLength)
    expect(artefact.uri.startsWith('https://ref.gs1.org/standards/resolver/')).toBe(true)
  })

  it('are all present in the provisioned folder', () => {
    expect(verifyGs1Artefacts({ artefacts: GS1_RESOLVER_ARTEFACTS })).toMatchObject({ ok: true })
  })

  it('are recorded as pinned and not carried, with the same digests, by the discovery manifest', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    addFormats(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas/interoperability-profile.schema.json'), 'utf8')))
    expect((INTEROPERABILITY_PROFILE_IDS as readonly string[]).includes('gs1-digital-link@1')).toBe(true)
    const manifest = readInteroperabilityProfile('gs1-digital-link@1') as { profile: string; role: string; artefacts: Array<{ id: string; uri: string; version: string; retrieval: string; digest?: string; byteLength?: number; carried?: string }> }
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true)
    expect(manifest.profile).toBe('gs1-digital-link@1')
    expect(manifest.role).toBe('discovery')
    for (const pinned of GS1_RESOLVER_ARTEFACTS) {
      const artefact = manifest.artefacts.find((a) => a.id === pinned.id)
      expect(artefact, pinned.id).toBeDefined()
      expect(artefact).toMatchObject({ retrieval: 'pinned', digest: pinned.sha256, byteLength: pinned.byteLength, uri: pinned.uri, version: pinned.version })
      expect(artefact?.carried, pinned.id).toBeUndefined()
    }
    for (const artefact of manifest.artefacts) {
      if (artefact.retrieval === 'not-retrieved' || artefact.retrieval === 'unavailable') expect(artefact.digest, artefact.id).toBeUndefined()
      if (artefact.retrieval === 'pinned') expect(artefact.digest).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('are not in this package: no schemas/gs1 folder, and nothing GS1 publishes in what npm would pack', () => {
    expect(existsSync(join(root, 'schemas', 'gs1'))).toBe(false)
    // Scripts are off so listing the package does not copy the repository notices into it.
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Array<{ files: Array<{ path: string }> }>
    const paths = packed.files.map((f) => f.path)
    expect(paths).toContain('schemas/interoperability-profile.schema.json')
    const names = new Set<string>(GS1_RESOLVER_ARTEFACTS.map((a) => a.fileName))
    expect(paths.filter((path) => path.startsWith('schemas/gs1/') || names.has(path.split('/').at(-1)!))).toEqual([])
  })
})
