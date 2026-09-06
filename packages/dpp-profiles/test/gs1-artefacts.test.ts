import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { INTEROPERABILITY_PROFILE_IDS, readInteroperabilityProfile } from '../src/index.js'

const root = join(import.meta.dirname, '..')
const sha256 = (relative: string): string => createHash('sha256').update(readFileSync(join(root, relative))).digest('hex')

/**
 * The GS1 resolver artefacts carried under schemas/gs1/ are the published
 * bytes, held to the digests NOTICE.md records; a changed upstream artefact is
 * a new pinned version, never an edit. The discovery manifest records the
 * same digests, so the manifest, the notice and the bytes cannot drift apart.
 */
const PINNED: Array<[string, string]> = [
  ['schemas/gs1/resolver-linkset-schema-1.2.1.json', 'd2e23510f17558c29f9d1baf9e112a70df42efd6557a49dc9a317048973669f2'],
  ['schemas/gs1/resolver-description-file-schema-1.2.0.json', '99d505c7aa2004cde3277651e8db0e019eab61d2746b2631ddab3fec8a13617e'],
  ['schemas/gs1/resolver-linkset-context-1.2.1.jsonld', '05792d010165fa6f28cc9cc3463cc1668f522ac75c26abe5b2877ec4a37b1312'],
]

describe('the pinned GS1 resolver artefacts', () => {
  it.each(PINNED)('%s has the digest NOTICE.md records', (relative, digest) => {
    expect(sha256(relative)).toBe(digest)
    expect(readFileSync(join(root, 'schemas/gs1/NOTICE.md'), 'utf8')).toContain(digest)
  })

  it('are recorded as pinned, with the same digests, by the discovery manifest', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    addFormats(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas/interoperability-profile.schema.json'), 'utf8')))
    expect((INTEROPERABILITY_PROFILE_IDS as readonly string[]).includes('gs1-digital-link@1')).toBe(true)
    const manifest = readInteroperabilityProfile('gs1-digital-link@1') as { profile: string; role: string; artefacts: Array<{ id: string; retrieval: string; digest?: string; carried?: string }> }
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true)
    expect(manifest.profile).toBe('gs1-digital-link@1')
    expect(manifest.role).toBe('discovery')
    for (const [relative, digest] of PINNED) {
      const artefact = manifest.artefacts.find((a) => a.carried === relative)
      expect(artefact, relative).toBeDefined()
      expect(artefact?.retrieval).toBe('pinned')
      expect(artefact?.digest).toBe(digest)
    }
    for (const artefact of manifest.artefacts) {
      if (artefact.retrieval === 'not-retrieved' || artefact.retrieval === 'unavailable') expect(artefact.digest, artefact.id).toBeUndefined()
      if (artefact.retrieval === 'pinned') expect(artefact.digest).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
