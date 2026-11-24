import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { BUNDLED_BINDINGS, HISTORICAL_SECTOR_BINDINGS, BUNDLED_BINDING_DIGESTS, CURRENT_SECTOR_BINDINGS, bundledBindingNotices, createProfileRegistry, describeArtefact, profileBindingDigest, profileBindingInconsistencies, readProfileBinding, registerBundledBindings, type ProfileBinding } from '../src/index.js'

// The package ships bindings of its own under bindings/. Two things make
// them safe to use: the list of their digests is written into the source, so
// a changed binding file is not the bundled binding any more, and each
// binding records the length and SHA-256 of every file beside it. These
// tests hold the folder to both, and hold the notice beside each binding to
// the files it has to account for.
const packageRoot = join(import.meta.dirname, '..')
const bindingsDir = join(packageRoot, 'bindings')
const fixturesDir = join(packageRoot, 'test', 'fixtures', 'sector-bindings')
const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => { const path = join(dir, entry); return statSync(path).isDirectory() ? walk(path) : [path] })

const bundled = HISTORICAL_SECTOR_BINDINGS.map((entry) => {
  const folder = join(bindingsDir, entry.profile)
  return { ...entry, folder, bindingBytes: bytesOf(join(folder, 'binding.json')), binding: JSON.parse(readFileSync(join(folder, 'binding.json'), 'utf8')) as ProfileBinding }
})
const each = bundled.map((b) => [b.profile, b] as const)

/** A copy of the shipped folder a test may damage. */
const temporary: string[] = []
const copyOfBindings = (): string => { const dir = mkdtempSync(join(tmpdir(), 'dpp-bundled-bindings-')); temporary.push(dir); cpSync(bindingsDir, dir, { recursive: true }); return dir }
afterAll(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }) })

describe('the bundled bindings are the files the package pins', () => {
  it('lists a digest for every binding folder the package ships, and for no other', () => {
    expect(BUNDLED_BINDINGS.map((b) => b.profile)).toEqual(['eu-battery@1', 'eu-textile@1', 'eu-battery@2', 'eu-textile@2'])
    expect(readdirSync(bindingsDir).sort()).toEqual(HISTORICAL_SECTOR_BINDINGS.map((b) => b.profile).sort())
    expect(BUNDLED_BINDING_DIGESTS).toEqual(BUNDLED_BINDINGS.map((b) => b.bindingDigest))
    expect(new Set(BUNDLED_BINDING_DIGESTS).size).toBe(BUNDLED_BINDINGS.length)
  })

  it.each(each)('%s: the binding file has the digest the list pins, and reads as a format 1 binding', (_profile, b) => {
    expect(profileBindingDigest(b.bindingBytes)).toBe(b.bindingDigest)
    expect(BUNDLED_BINDING_DIGESTS).toContain(profileBindingDigest(b.bindingBytes))
    expect(readProfileBinding(b.bindingBytes)).toMatchObject({ ok: true, digest: b.bindingDigest })
    expect(b.binding.profile).toBe(b.profile)
    expect(b.binding.publisher).toEqual({ name: 'BSV Association', registration: 'bundled' })
  })

  it.each(each)('%s: the folder holds the binding, its notice and the listed artefacts, each as the binding records it', (_profile, b) => {
    const onDisk = walk(b.folder).map((path) => relative(b.folder, path)).sort()
    expect(onDisk).toEqual(['NOTICE.md', 'binding.json', 'binding.v2.json', ...b.binding.artefacts.map((a) => a.path)].sort())
    for (const artefact of b.binding.artefacts) expect({ path: artefact.path, ...describeArtefact(bytesOf(join(b.folder, artefact.path))) }).toEqual({ path: artefact.path, byteLength: artefact.byteLength, sha256: artefact.sha256 })
    expect(b.binding.source.notices).toEqual(['NOTICE.md'])
  })

  it.each(each)('%s: four contexts, one shapes file and one background file, for an item, with SPARQL required and only violations blocking', (_profile, b) => {
    expect(b.binding.artefacts.map((a) => a.role)).toEqual(['context', 'context', 'context', 'context', 'shapes', 'background'])
    expect(b.binding.granularity).toBe('item')
    expect(b.binding.validation).toEqual({ steps: ['json-ld-expand', 'shacl', 'passport-identity'], engine: { requires: ['shacl-core', 'shacl-sparql-constraints'] }, blockingSeverities: ['Violation'] })
    for (const artefact of b.binding.artefacts) expect(artefact.licence).toBe('Apache-2.0')
    expect(b.binding.source).toMatchObject({ licence: 'Apache-2.0', release: '0.13.1', revision: '7a3f28d8869d2e5dd1fb31ace39f538fa04def4e' })
  })

  it.each(each)('%s: the identity rules read the document\'s own identifier and every member that restates it', (_profile, b) => {
    expect(b.binding.identity).toEqual({
      scheme: 'gs1-digital-link',
      comparison: 'gs1-key-tuple',
      subject: { pointers: ['/product/id', '/product/@id'], keys: ['01', '21'] },
      mustEqual: [
        { pointer: '/product/gs1:gtin', part: 'gtin' },
        { pointer: '/product/gs1:hasSerialNumber', part: 'serial' },
        { pointer: '/product/schema:serialNumber', part: 'serial' },
      ],
      mustNotContradict: [{ pointer: '/product/oec:passportIdentifier' }, { pointer: '/product/gs1:productID' }],
      granularityMember: { pointer: '/product/oec:granularityLevel', whenPresent: 'item' },
      // A battery names its model beside the item. It is a related identity and never the subject.
      related: b.profile === 'eu-battery@1' ? [{ pointer: '/product/eubat:batteryModelIdentifier', relation: 'model' }] : [],
    })
  })

  it.each(each)('%s: splits the product document by top-level property, and restricts whatever it does not list', (_profile, b) => {
    const access = b.binding.access!
    expect({ ...access, public: [] }).toEqual({ policy: `${b.binding.id}-access@1`, tierSplit: 'top-level-property', default: 'restricted', public: [] })
    expect(new Set(access.public).size).toBe(access.public.length)
    // What a reader needs to read the payload at all, under either spelling a document may use.
    for (const name of ['@context', 'id', '@id', 'type', '@type']) expect(access.public, name).toContain(name)
    // Every member the identity rules read, so a reader of the public payload makes the writer's comparison.
    const identity = b.binding.identity
    const read = [...identity.subject.pointers, ...identity.mustEqual.map((r) => r.pointer), ...identity.mustNotContradict.map((r) => r.pointer), identity.granularityMember!.pointer]
    expect(read.every((pointer) => /^\/product\/[^/]+$/.test(pointer))).toBe(true)
    for (const pointer of read) expect(access.public, pointer).toContain(pointer.slice('/product/'.length))
    expect(profileBindingInconsistencies(b.binding)).toEqual([])
  })

  it('eu-battery@1 publishes the declaration of conformity and the schema version, and keeps the mixed containers restricted', () => {
    const open = bundled[0]!.binding.access!.public
    expect(open.length).toBe(46)
    for (const name of ['eubat:hasEuDeclarationOfConformity', 'schema:schemaVersion', 'eubat:batteryModelIdentifier', 'eubat:hasCarbonFootprintDeclaration', 'gs1:manufacturer']) expect(open, name).toContain(name)
    for (const name of ['eubat:hasTechnicalSpecifications', 'eubat:criticalRawMaterialsStatement', 'eubat:hasManufacturingPlace', 'eubat:hasBatteryChemistry', 'eubat:hasHazardousSubstances', 'eubat:hasSupplyChainDueDiligence', 'eubat:hasEndOfLifeInfo', 'eubat:hasOperatorInformation', 'eubat:hasBatteryState', 'eubat:hasMaterialComposition', 'eubat:resultOfTestReport', 'gs1:referencedFile', 'gs1:regulatoryInformation', 'schema:status']) expect(open, name).not.toContain(name)
  })

  it('eu-textile@1 publishes the consumer-facing properties, and keeps the operator, the facilities and the mixed containers restricted', () => {
    const open = bundled[1]!.binding.access!.public
    expect(open.length).toBe(54)
    for (const name of ['gs1:textileMaterial', 'eutex:hasCareInstructions', 'oec:passportIdentifier', 'gs1:hasSerialNumber', 'gs1:manufacturer']) expect(open, name).toContain(name)
    for (const name of ['oec:hasOperatorInformation', 'eutex:hasCutAndSewFacility', 'eutex:hasDyeingFacility', 'eutex:hasRecycledContentDeclaration', 'eutex:hasEnvironmentalFootprint', 'eutex:hasSubstancesOfConcern', 'eutex:hasWaterUsage', 'oec:hasDocuments', 'oec:hasAccessRights', 'gs1:referencedFile', 'gs1:regulatoryInformation']) expect(open, name).not.toContain(name)
  })

  it('the documentation page lists the public properties of each binding, and the restricted ones the test documents carry, as the bindings have them', () => {
    const page = readFileSync(join(packageRoot, '..', '..', 'docs', 'profiles', 'eu-sector-bindings.md'), 'utf8')
    const rows = [...page.matchAll(/^\| `([^`]+)` \| (public|restricted) \| (public|restricted) \|$/gm)].map((m) => ({ name: m[1]!, tiers: [m[2]!, m[3]!] }))
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length)
    bundled.forEach((b, column) => {
      expect(rows.filter((row) => row.tiers[column] === 'public').map((row) => row.name).sort(), b.profile).toEqual([...b.binding.access!.public].sort())
      const carried = [...new Set(b.binding.vectors.positive.flatMap((path) => Object.keys(JSON.parse(readFileSync(join(fixturesDir, b.profile, path), 'utf8')) as object)).filter((name) => !name.startsWith('_comment') && !b.binding.access!.public.includes(name)))]
      // The row that counts both, then the row that names the restricted ones.
      expect(page).toContain(`| \`${b.profile}\` | ${b.binding.access!.public.length} | ${carried.length} |`)
      const listed = page.split('\n').find((line) => line.startsWith(`| \`${b.profile}\` | \``) && line.includes('`, `'))?.split(' | ')[1]?.split(', ').map((name) => name.replace(/[`| ]/g, ''))
      expect(listed?.sort(), b.profile).toEqual(carried.sort())
    })
    // A property public in neither binding has no row: the table is of the public lists.
    for (const row of rows) expect(row.tiers, row.name).toContain('public')
  })

  it.each(each)('%s: the scope says the name is about the data model and claims no compliance', (_profile, b) => {
    expect(b.binding.scope).toMatch(/^The name states which data model the product document uses/)
    expect(b.binding.scope).toMatch(/It makes no claim that a passport or its product complies with .* any other law\.$/)
  })
})

describe('the notice beside each bundled binding', () => {
  // The vocabulary notice is reproduced, not summarised. Its digest is held here so an edit to it is seen.
  const VOCABULARY_NOTICE_SHA256 = '092200c8fa77356cddf710a1b869c5f618e6898463a60a50718ddeed3712b357'

  it.each(each)('%s: names the source, the release and the full revision, and says the copies are unmodified and under which licence', (_profile, b) => {
    const notice = readFileSync(join(b.folder, 'NOTICE.md'), 'utf8')
    for (const stated of [b.binding.source.name, b.binding.source.repository!, b.binding.source.release!, b.binding.source.revision!]) expect(notice).toContain(stated)
    expect(notice).toContain('unmodified')
    expect(notice).toContain('Apache License, Version 2.0')
    expect(notice).toContain('http://www.apache.org/licenses/LICENSE-2.0')
  })

  it.each(each)('%s: lists every copied file with its SHA-256 and byte length, the test documents included', (_profile, b) => {
    const notice = readFileSync(join(b.folder, 'NOTICE.md'), 'utf8')
    const rows = notice.split('\n').filter((line) => line.startsWith('| `'))
    const row = (path: string): string | undefined => rows.find((line) => line.startsWith(`| \`${path}\` |`))
    for (const artefact of b.binding.artefacts) {
      expect(row(artefact.path), artefact.path).toContain(`\`${artefact.sha256}\``)
      expect(row(artefact.path), artefact.path).toContain(`| ${artefact.byteLength} |`)
    }
    const vectors = join(fixturesDir, b.profile)
    expect(readdirSync(join(vectors, 'vectors')).filter((name) => name.endsWith('.jsonld')).map((name) => `vectors/${name}`).sort()).toEqual([...b.binding.vectors.positive].sort())
    for (const path of b.binding.vectors.positive) {
      const described = describeArtefact(bytesOf(join(vectors, path)))
      expect(row(path), path).toContain(`\`${described.sha256}\``)
      expect(row(path), path).toContain(`| ${described.byteLength} |`)
    }
    // One row per copied file and no row for anything else.
    expect(rows.length).toBe(b.binding.artefacts.length + b.binding.vectors.positive.length)
  })

  it.each(each)('%s: reproduces the vocabulary notice for the shortcuts context, byte for byte', (_profile, b) => {
    const notice = readFileSync(join(b.folder, 'NOTICE.md'), 'utf8')
    const blocks = [...notice.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map((m) => m[1]!)
    expect(blocks.map((block) => createHash('sha256').update(block, 'utf8').digest('hex'))).toEqual([VOCABULARY_NOTICE_SHA256])
    expect(blocks[0]).toContain('Copyright 2015-2019 GS1 AISBL')
  })

  it('the licence text the notices point to is the Apache License, Version 2.0, and travels with the package', () => {
    const licence = readFileSync(join(packageRoot, 'LICENSE'), 'utf8')
    expect(licence).toContain('Apache License\n                           Version 2.0, January 2004')
    expect(licence).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(licence).toContain('END OF TERMS AND CONDITIONS')
  })
})

describe('what npm would pack', () => {
  it('carries each binding folder whole with the licence text, and none of the test documents', () => {
    // Scripts are off so listing the package does not copy the repository notices into it.
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Array<{ files: Array<{ path: string }> }>
    const paths = packed!.files.map((f) => f.path)
    expect(paths).toContain('LICENSE')
    for (const b of bundled) {
      for (const name of ['binding.json', 'binding.v2.json', 'NOTICE.md', ...b.binding.artefacts.map((a) => a.path)]) expect(paths).toContain(`bindings/${b.profile}/${name}`)
    }
    expect(paths.filter((path) => path.startsWith('bindings/')).length).toBe(bundled.reduce((count, b) => count + 3 + b.binding.artefacts.length, 0))
    expect(paths.filter((path) => path.startsWith('test/') || path.includes('vectors/'))).toEqual([])
  })
})

describe('the index image', () => {
  // The index reads token history and validates no payload, so it has no use for a megabyte of contexts and shapes.
  it('copies named folders of this package into its final stage, and bindings/ is not one of them', () => {
    const dockerfile = readFileSync(join(packageRoot, '..', 'dpp-overlay', 'Dockerfile'), 'utf8')
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
    const copied = [...finalStage.matchAll(/^COPY (.*)$/gm)].map((m) => m[1]!).filter((line) => line.includes('dpp-profiles'))
    expect(copied).toEqual([
      'packages/dpp-profiles/package.json packages/dpp-profiles/',
      ...['dist', 'manifests', 'schemas', 'generated', 'frozen.json'].map((name) => `--from=build /repo/packages/dpp-profiles/${name} packages/dpp-profiles/${name}`),
    ])
    // Nothing copies the packages folder whole into the final stage either.
    expect([...finalStage.matchAll(/^COPY (.*)$/gm)].map((m) => m[1]!).filter((line) => /(^|\s)(\.\/)?packages\/?(\s|$)/.test(line))).toEqual([])
  })
})

describe('registerBundledBindings', () => {
  const trusting = (...digests: string[]) => createProfileRegistry({ trustedBindingDigests: digests })

  it('registers every bundled binding from the package folder into a registry that trusts the list', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    // Nothing is there until it is asked for.
    expect(registry.list().filter((p) => p.format === 'binding')).toEqual([])
    const results = await registerBundledBindings(registry)
    expect(results.map((r) => (r.ok ? [r.profile.profile, r.profile.bindingDigest, r.alreadyRegistered] : r))).toEqual(BUNDLED_BINDINGS.map((b) => [b.profile, b.bindingDigest, false]))
    for (const b of bundled) {
      const resolved = registry.resolve(b.binding.id, b.binding.version)
      if (resolved?.format !== 'binding') throw new Error(`expected ${b.profile} to resolve to a binding`)
      expect(resolved.bindingDigest).toBe(b.bindingDigest)
      expect(resolved.artefacts.map((a) => [a.artefact.path, describeArtefact(a.bytes).sha256])).toEqual(b.binding.artefacts.map((a) => [a.path, a.sha256]))
    }
    // A second call finds them there and changes nothing.
    expect((await registerBundledBindings(registry)).map((r) => r.ok && r.alreadyRegistered)).toEqual([true, true, true, true])
  })

  it('registers the current sector editions with their original artefacts and respects a restricted historical trust list', async () => {
    expect(CURRENT_SECTOR_BINDINGS.map((entry) => entry.profile)).toEqual(['eu-battery@2', 'eu-textile@2'])
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    await registerBundledBindings(registry)
    for (const [index, entry] of CURRENT_SECTOR_BINDINGS.entries()) {
      const original = bundled[index]!
      expect(registry.resolve(original.binding.id, 2)?.profile).toBe(entry.profile)
      expect(await registerBundledBindings(trusting(...HISTORICAL_SECTOR_BINDINGS.map((binding) => binding.bindingDigest)), { profiles: [entry.profile] })).toMatchObject([{ ok: false, code: 'binding-untrusted' }])
      const [result] = await registerBundledBindings(registry, { profiles: [entry.profile] })
      if (!result?.ok) throw new Error(JSON.stringify(result))
      const successor = result.profile
      const subjectClass = index === 0 ? 'https://ref.openepcis.org/extensions/eu/battery/Battery' : 'https://ref.openepcis.org/extensions/eu/textile/TextileProduct'
      expect(successor.bindingDigest).toBe(entry.bindingDigest)
      expect(successor.binding).toEqual({ ...original.binding, version: 2, profile: entry.profile, validation: { ...original.binding.validation, subjectClass } })
      expect(successor.artefacts.map((item) => describeArtefact(item.bytes))).toEqual(original.binding.artefacts.map(({ sha256, byteLength }) => ({ sha256, byteLength })))
      expect(bundledBindingNotices()(successor, 'NOTICE.md')).toEqual(bytesOf(join(original.folder, 'NOTICE.md')))
      expect(registry.resolve(original.binding.id, 1)).toMatchObject({ bindingDigest: original.bindingDigest })
    }
  })

  it('registers only the profiles it is asked for', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    const results = await registerBundledBindings(registry, { profiles: ['eu-textile@1'] })
    expect(results.map((r) => r.ok && r.profile.profile)).toEqual(['eu-textile@1'])
    expect(registry.resolve('eu-textile', 1)?.format).toBe('binding')
    expect(registry.resolve('eu-battery', 1)).toBeUndefined()
  })

  it('refuses a name the package does not bundle, before reading anything', async () => {
    await expect(registerBundledBindings(trusting(...BUNDLED_BINDING_DIGESTS), { profiles: ['example-bottle@1' as never] })).rejects.toThrow(TypeError)
  })

  it('takes the folder as a file URL and refuses anything else', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    await expect(registerBundledBindings(registry, { directory: bindingsDir as never })).rejects.toThrow(TypeError)
    await expect(registerBundledBindings(registry, { directory: new URL('https://bindings.example/') })).rejects.toThrow(TypeError)
    // With or without the trailing slash, the same folder.
    expect((await registerBundledBindings(registry, { directory: pathToFileURL(`${bindingsDir}/`) })).map((r) => r.ok)).toEqual([true, true, true, true])
    expect((await registerBundledBindings(registry, { directory: pathToFileURL(bindingsDir) })).map((r) => r.ok && r.alreadyRegistered)).toEqual([true, true, true, true])
  })

  it('leaves trust with the registry: one that does not trust a bundled digest does not get that binding', async () => {
    const registry = trusting(bundled[1]!.bindingDigest)
    const results = await registerBundledBindings(registry)
    expect(results[0]).toMatchObject({ ok: false, code: 'binding-untrusted', bindingDigest: bundled[0]!.bindingDigest })
    expect(results[1]).toMatchObject({ ok: true })
    expect(registry.resolve('eu-battery', 1)).toBeUndefined()
  })

  it.each(each)('%s: refuses an altered artefact and names it', async (_profile, b) => {
    const dir = copyOfBindings()
    const path = join(dir, b.profile, 'background.ttl')
    const altered = bytesOf(path)
    // One byte changed and the length kept, so only the digest can tell.
    altered[altered.length - 2] = altered[altered.length - 2]! ^ 1
    writeFileSync(path, altered)
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    const [result] = await registerBundledBindings(registry, { profiles: [b.profile], directory: pathToFileURL(dir) })
    expect(result).toMatchObject({ ok: false, code: 'artefact-digest-mismatch', artefact: 'background.ttl', profile: b.profile })
    expect(registry.resolve(b.binding.id, b.binding.version)).toBeUndefined()
  })

  it.each(each)('%s: refuses a missing artefact and names it', async (_profile, b) => {
    const dir = copyOfBindings()
    rmSync(join(dir, b.profile, 'shapes.ttl'))
    const [result] = await registerBundledBindings(trusting(...BUNDLED_BINDING_DIGESTS), { profiles: [b.profile], directory: pathToFileURL(dir) })
    expect(result).toMatchObject({ ok: false, code: 'artefact-unavailable', artefact: 'shapes.ttl' })
  })

  it('refuses a binding file that is not the pinned one, even for a registry that would trust the changed file', async () => {
    const dir = copyOfBindings()
    const path = join(dir, 'eu-battery@1', 'binding.json')
    const changed = new TextEncoder().encode(readFileSync(path, 'utf8').replace('"Violation"', '"Violation",\n      "Warning"'))
    writeFileSync(path, changed)
    const changedDigest = profileBindingDigest(changed)
    expect(readProfileBinding(changed).ok).toBe(true)
    const registry = trusting(...BUNDLED_BINDING_DIGESTS, changedDigest)
    const [result] = await registerBundledBindings(registry, { profiles: ['eu-battery@1'], directory: pathToFileURL(dir) })
    expect(result).toEqual({ ok: false, code: 'bundled-binding-altered', profile: 'eu-battery@1', bindingDigest: changedDigest, detail: expect.stringContaining(bundled[0]!.bindingDigest) })
    expect(registry.resolve('eu-battery', 1)).toBeUndefined()
  })

  it('says so when the binding folder is not where the package expects it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-bundled-bindings-'))
    temporary.push(dir)
    const results = await registerBundledBindings(trusting(...BUNDLED_BINDING_DIGESTS), { directory: pathToFileURL(dir) })
    expect(results).toEqual(BUNDLED_BINDINGS.map((b) => ({ ok: false, code: 'bundled-binding-unavailable', profile: b.profile, detail: expect.stringContaining(b.profile.endsWith('@2') ? 'binding.v2.json' : 'binding.json') })))
  })
})
