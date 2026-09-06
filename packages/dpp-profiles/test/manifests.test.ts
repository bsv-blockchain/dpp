import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PROFILE_IDS, fieldsFor, isManifestV2, missingRequired, readConsumerDocument, readFrozen, readManifest, readManifestAny, readPublicPayloadSchema, readRestrictedPayloadSchema } from '../src/index.js'
import { generateAll, readManifests } from '../scripts/build.mjs'

const root = join(import.meta.dirname, '..')
const read = (relative: string): unknown => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')
// strict, with the two union types the manifest schema declares (`extends` may be null, a stamp's `const` may be a string or an integer) allowed explicitly.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateManifest = ajv.compile(read('schemas/profile-manifest.schema.json') as object)
const validateManifestV2 = ajv.compile(read('schemas/profile-manifest-v2.schema.json') as object)

describe('the profile manifests (spec/profiles.md)', () => {
  it.each(PROFILE_IDS)('%s validates against the manifest schema of the version it declares', (profile) => {
    const manifest = readManifestAny(profile)
    // A version 2 manifest validates against the version 2 schema and never
    // against the version 1 one, which does not know its keys; a version 1
    // manifest is exactly as it was.
    const validate = isManifestV2(manifest) ? validateManifestV2 : validateManifest
    const ok = validate(manifest)
    expect(validate.errors ?? [], profile).toEqual([])
    expect(ok).toBe(true)
    if (isManifestV2(manifest)) expect(validateManifest(manifest)).toBe(false)
    expect(manifest.profile).toBe(profile)
    expect(manifest.profile).toBe(`${manifest.id}@${manifest.version}`)
  })

  it.each(PROFILE_IDS)('%s has unique keys, pointers that name them, and obligation separate from legal basis', (profile) => {
    const manifest = readManifest(profile)
    const keys = manifest.fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of manifest.fields) {
      expect(f.pointer).toBe(`/${f.key}`)
      expect(f.legalBasis.length).toBeGreaterThan(0)
      if (f.applicability.rule === 'needs-review') expect(f.applicability.condition).toBeTruthy()
      if (f.applicability.rule === 'category-in') expect(f.applicability.categories?.length).toBeGreaterThan(0)
      if (f.codeList != null) expect(typeof f.codeList.closed).toBe('boolean')
    }
  })

  it('inventories every field the application registries declared, including those not captured at registration', () => {
    expect(readManifest('battery@2').fields).toHaveLength(105)
    expect(readManifest('textile@2').fields).toHaveLength(49)
    expect(readManifest('general@2').fields).toHaveLength(40)
    expect(readManifest('textile@1').fields).toHaveLength(13)
    expect(readManifest('general@1').fields).toHaveLength(0)
    // The draft successors carry every field of their predecessor and the
    // companions the successor adds: 105 plus 12, and 49 plus 11.
    expect(readManifestAny('battery@3').fields).toHaveLength(117)
    expect(readManifestAny('textile@3').fields).toHaveLength(60)
    const captures = new Set(readManifest('battery@2').fields.map((f) => f.provenance.capture))
    expect([...captures].sort()).toEqual(['brand', 'deferred', 'derived', 'event', 'form', 'platform'])
  })

  it('keeps superseded versions published and pointing at their successors', () => {
    for (const [old, next] of [['textile@1', 'textile@2'], ['general@1', 'general@2']] as const) {
      const manifest = readManifest(old)
      expect(manifest.status).toBe('superseded')
      expect(manifest.supersededBy).toBe(next)
      expect(readManifest(next).status).toBe('current')
    }
  })

  it('is frozen: every manifest and generated file has the digest frozen.json records', () => {
    const frozen = readFrozen()
    for (const profile of PROFILE_IDS) {
      expect(sha256(readFileSync(join(root, 'manifests', `${profile}.json`))), profile).toBe(frozen.manifests[profile])
    }
    for (const [relative, digest] of Object.entries(frozen.generated)) {
      expect(sha256(readFileSync(join(root, relative))), relative).toBe(digest)
    }
  })

  it('generates deterministically: the committed generated files equal a fresh generation', () => {
    const fresh = generateAll(readManifests())
    for (const [relative, text] of fresh) {
      expect(readFileSync(join(root, relative), 'utf8'), relative).toBe(text)
    }
  })

  it.each(PROFILE_IDS)('%s records the digests of its generated payload schemas and the 2020-12 dialect', (profile) => {
    const manifest = readManifest(profile)
    expect(manifest.schemaDialect).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(sha256(readFileSync(join(root, manifest.schemaUri)))).toBe(manifest.schemaDigest)
    expect(sha256(readFileSync(join(root, manifest.restrictedSchemaUri)))).toBe(manifest.restrictedSchemaDigest)
    expect((readPublicPayloadSchema(profile) as { $schema: string }).$schema).toBe(manifest.schemaDialect)
    expect((readRestrictedPayloadSchema(profile) as { $schema: string }).$schema).toBe(manifest.schemaDialect)
  })

  it('refuses a manifest that names another dialect or infers a missing version', () => {
    const manifest = readManifest('general@2') as unknown as Record<string, unknown>
    expect(validateManifest({ ...manifest, schemaDialect: 'http://json-schema.org/draft-07/schema#' })).toBe(false)
    const { version: _version, ...withoutVersion } = manifest
    expect(validateManifest(withoutVersion)).toBe(false)
    expect(validateManifest({ ...manifest, version: '1.0.0' })).toBe(false)
  })

  it('separates applies, needs-review and not-applicable by category and never treats review as satisfied', () => {
    const battery = readManifest('battery@2')
    const ev = fieldsFor(battery, 'ev')
    const lmt = fieldsFor(battery, 'lmt')
    expect(ev.needsReview.length + lmt.needsReview.length).toBeGreaterThanOrEqual(0)
    expect(ev.applies.length + ev.needsReview.length + ev.notApplicable.length).toBe(battery.fields.length)
    const categoryBound = battery.fields.filter((f) => f.applicability.categories != null)
    expect(categoryBound.length).toBeGreaterThan(0)
    for (const f of categoryBound) {
      const applicable = f.applicability.categories!.includes('ev')
      expect(ev.notApplicable.includes(f)).toBe(!applicable)
    }
    const textile = readManifest('textile@2')
    const conditional = textile.fields.filter((f) => f.applicability.rule === 'needs-review')
    expect(conditional.length).toBeGreaterThan(0)
    const check = missingRequired(textile, {}, 'apparel')
    for (const f of conditional) {
      expect(check.missing.includes(f)).toBe(false)
      if (f.obligation === 'required') expect(check.needsReview.includes(f)).toBe(true)
    }
    expect(check.missing.length).toBeGreaterThan(0)
  })

  it('produces the legacy consumer document shape the registry and application serve', () => {
    for (const profile of PROFILE_IDS) {
      const doc = readConsumerDocument(profile) as Record<string, unknown>
      expect(doc.profile).toBe(profile)
      expect(Array.isArray(doc.fields)).toBe(true)
      expect(String(doc.status)).toMatch(/^(in use|superseded by |candidate successor to )/)
      expect(String(doc.regulatoryLine)).not.toMatch(/\bcompliant\b/i)
    }
    // The consumer document describes the registry in full, every capture
    // included, exactly as the application published it: 105 battery fields,
    // 49 textile, 40 general, and the two version-1 documents unchanged.
    const battery = readConsumerDocument('battery@2') as { fields: Array<Record<string, unknown>> }
    expect(battery.fields).toHaveLength(105)
    expect([...new Set(battery.fields.map((f) => String(f.source)))].sort()).toEqual(['brand', 'deferred', 'derived', 'event', 'form', 'platform'])
    expect((readConsumerDocument('textile@2') as { fields: unknown[] }).fields).toHaveLength(49)
    expect((readConsumerDocument('general@2') as { fields: unknown[] }).fields).toHaveLength(40)
    expect((readConsumerDocument('textile@1') as { fields: unknown[] }).fields).toHaveLength(13)
    expect((readConsumerDocument('general@1') as { fields: unknown[]; note?: unknown }).note).toBeUndefined()
  })
})

describe('the generated field mapping inventories', () => {
  it('carry one row per declared field for every current profile and draw no legal conclusion', () => {
    for (const profile of ['battery@2', 'textile@2', 'general@2'] as const) {
      const manifest = readManifest(profile)
      const table = readFileSync(join(root, 'generated', 'mapping', `${profile}.md`), 'utf8')
      const rows = table.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Key') )
      expect(rows, profile).toHaveLength(manifest.fields.length)
      for (const f of manifest.fields) expect(table, `${profile} ${f.key}`).toContain(`| ${f.key} |`)
      expect(table).toContain('Nothing here is a legal conclusion')
      expect(table).not.toMatch(/\bcompliant\b/)
    }
  })
})
