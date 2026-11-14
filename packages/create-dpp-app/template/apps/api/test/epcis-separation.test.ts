// An EPCIS import or pull retains data. It changes no custody, signs nothing,
// writes nothing on chain and never calls the wallet. Two tests hold the
// application to that.
//
// The first reads the source: it follows every import from the EPCIS routes
// and fails if the code they are built from can reach the wallet, the writer,
// the index client or any package that signs or broadcasts. The second runs
// every EPCIS route against a platform whose wallet, writer and index record
// each call made to them, and sees none.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintPassportId } from '../src/identifiers.js'
import { samplePayload } from '../src/profiles.js'
import { epcisDocument, item, objectEvent, startApp, startEpcisSource, testConfig, utf8, type FixtureSource, type Json, type TestApp } from './epcis-fixtures.js'

const SRC = resolve(import.meta.dirname, '..', 'src')

/**
 * What a source file imports at run time: its `import` and `export ... from`
 * statements, its dynamic imports and its `require` calls. An `import type`
 * is left out, because the compiler removes it and nothing is loaded for it.
 * A statement that imports a value beside a type is counted whole.
 */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/^[ \t]*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) found.add(match[1]!)
  for (const match of text.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(match[1]!)
  return [...found]
}

const packageName = (specifier: string): string => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!)

/** The folder a package is installed in, found the way Node finds it: the nearest node_modules above the importer that holds it. */
function packageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return undefined
  }
}

/** Everything the code under `entry` can load: the files of this application it imports, and every package those files import with everything each depends on. */
function reachableFrom(entry: string): { files: string[]; direct: string[]; packages: string[] } {
  const files = new Set<string>()
  const direct = new Set<string>()
  const visit = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      else if (!specifier.startsWith('node:')) direct.add(packageName(specifier))
    }
  }
  visit(join(SRC, entry))
  const packages = new Map<string, string>()
  const install = (name: string, from: string): void => {
    const dir = packageDir(name, from)
    if (dir == null || packages.has(dir)) return
    packages.set(dir, name)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) install(dependency, dir)
  }
  for (const name of direct) install(name, SRC)
  return { files: [...files].map((file) => relative(SRC, file)).sort(), direct: [...direct].sort(), packages: [...new Set(packages.values())].sort() }
}

/** The code that signs, spends, announces or broadcasts. */
const SIGNING_FILES = ['wallet.ts', 'writer.ts', 'index-client.ts', 'custody.ts', 'claims.ts', 'parties.ts', 'platform.ts', 'worker.ts', 'dev-index.ts', 'go-live.ts', 'reader.ts']
const SIGNING_PACKAGES = ['@bsv/sdk', '@bsv/wallet-toolbox', '@bsv/wallet-toolbox-client', '@bsv/overlay', '@bsv/dpp-overlay', '@bsv/dpp-protocol', '@bsv/dpp-profiles']

describe('what the EPCIS routes are built from', () => {
  it('is five files of this application and three packages, none of which signs or broadcasts', () => {
    const graph = reachableFrom('epcis/routes.ts')
    // The whole list, so that a new import into the exchange is a decision someone makes here.
    expect(graph.files).toEqual(['epcis/exchange.ts', 'epcis/mongo-storage.ts', 'epcis/routes.ts', 'epcis/sources.ts', 'http-error.ts'])
    expect(graph.direct).toEqual(['@bsv/dpp-credentials', 'express', 'mongodb'])
    for (const file of SIGNING_FILES) expect(graph.files, file).not.toContain(file)
    // Every package those three depend on, however deep.
    expect(graph.packages.length).toBeGreaterThan(40)
    for (const name of SIGNING_PACKAGES) expect(graph.packages, name).not.toContain(name)
    expect(graph.packages.filter((name) => name.startsWith('@bsv/'))).toEqual(['@bsv/dpp-credentials'])
  })

  it('is found to reach the wallet when it does: the same walk from the start of the API finds it', () => {
    // The check above would pass on anything if the walk followed nothing. From main.ts it follows the platform to everything a passport write uses.
    const graph = reachableFrom('main.ts')
    for (const file of ['wallet.ts', 'writer.ts', 'index-client.ts', 'platform.ts', 'custody.ts']) expect(graph.files, file).toContain(file)
    expect(graph.packages).toEqual(expect.arrayContaining(['@bsv/sdk', '@bsv/dpp-protocol', '@bsv/dpp-overlay']))
    // The exchange is opened beside the platform and handed to the server, never the other way round.
    expect(graph.files).toEqual(expect.arrayContaining(['epcis/exchange.ts', 'epcis/routes.ts', 'http-error.ts']))
  })

  it('reads a type-only import as nothing and a value import as something', () => {
    const routes = importsOf(join(SRC, 'epcis/routes.ts'))
    expect(readFileSync(join(SRC, 'epcis/routes.ts'), 'utf8')).toMatch(/import type \{ Session \} from '\.\.\/auth\.js'/)
    expect(routes).not.toContain('../auth.js')
    expect(routes).toEqual(expect.arrayContaining(['./exchange.js', '../http-error.js', 'express']))
  })
})

describe('what an import or a pull does to the platform', () => {
  const calls: string[] = []
  let api: TestApp
  let fixture: FixtureSource
  let passportId: string

  /**
   * Replace every function an object carries, its own and its class's, with one that notes the call and then makes it.
   * Only the object itself is changed. What it refers to is left alone, because a library object shared with other code
   * would then note calls nobody made through the platform.
   */
  const record = (target: object, name: string): void => {
    const members = new Set<string>(Object.getOwnPropertyNames(target))
    for (let proto = Object.getPrototypeOf(target) as object | null; proto != null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) for (const member of Object.getOwnPropertyNames(proto)) members.add(member)
    for (const member of members) {
      if (member === 'constructor') continue
      const value = (target as Record<string, unknown>)[member]
      if (typeof value !== 'function') continue
      Object.defineProperty(target, member, {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => {
          calls.push(`${name}.${member}`)
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        },
      })
    }
  }

  beforeAll(async () => {
    fixture = await startEpcisSource(Array.from({ length: 5 }, (_, index) => objectEvent(index + 1, [item(`SEP-${index + 1}`)])))
    api = await startApp({ config: testConfig({ EPCIS_SOURCES: 'supplier-a', EPCIS_SOURCE_SUPPLIER_A_URL: fixture.baseUrl, EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'true' }) })
    // A passport written before the doubles go in, so there is custody an import could change.
    const brand = api.platform.parties.brand('dev-brand')
    await api.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: brand.identityKey, did: brand.did, createdAt: new Date().toISOString() })
    passportId = mintPassportId({ host: 'passports.example.com', prefix: '952' }, '100000001', 'SEPARATE-1')
    await api.platform.writer.issue({ brandId: 'dev-brand', brand, passportId, profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
    const { wallet, writer, index, custody, claims } = api.platform
    // The wallet, and the three parts of it that sign, hold the lock and send; then everything that asks it to.
    for (const [name, part] of Object.entries({ wallet, 'wallet.publisher': wallet.publisher, 'wallet.custodian': wallet.custodian, 'wallet.adapter': wallet.adapter, writer, index, custody, claims })) record(part, name)
  })
  afterAll(async () => {
    await api.close()
    await fixture.close()
  })

  it('calls the wallet, the writer, the index, custody and claims not once, and leaves every passport as it was', async () => {
    const journal = JSON.stringify(await api.platform.store.listPassports())
    const offers = JSON.stringify(await api.platform.store.listOffers())
    const lineage = async (): Promise<number> => ((await (await fetch(`${api.platform.index.url}/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }) })).json()) as { outputs: unknown[] }).outputs.length
    const indexed = await lineage()
    expect(indexed).toBeGreaterThan(0)
    calls.length = 0

    // Every EPCIS route, with documents that name the passport itself.
    const ref = encodeURIComponent
    const first = utf8(JSON.stringify(epcisDocument([objectEvent(1, [passportId], { bizStep: 'shipping', disposition: 'in_transit' }), objectEvent(2, [passportId], { action: 'DELETE', bizStep: 'destroying', disposition: 'destroyed' })])))
    const imported = await api.upload('/api/epcis/imports?requestId=separate-1', first)
    expect(imported.status).toBe(201)
    expect((await api.upload('/api/epcis/imports?requestId=separate-1', first)).status).toBe(200)
    const changed = await api.upload('/api/epcis/imports?requestId=separate-2', utf8(JSON.stringify(epcisDocument([objectEvent(1, [passportId], { bizStep: 'receiving', disposition: 'in_progress' })]))))
    expect(changed.body.record.state).toBe('blocked')
    expect((await api.upload('/api/epcis/imports?requestId=separate-1', utf8('{}'))).status).toBe(409)
    expect((await api.upload('/api/epcis/imports?requestId=separate-3', utf8('not json'))).status).toBe(422)
    const importId = imported.body.record.importId as string
    expect((await api.get('/api/epcis/imports')).body.imports).toHaveLength(2)
    expect((await api.get(`/api/epcis/imports/${ref(importId)}`)).status).toBe(200)
    expect((await api.get(`/api/epcis/imports/${ref(importId)}/original`)).status).toBe(200)
    expect((await api.get(`/api/epcis/events?identifier=${ref(passportId)}`)).body.events.length).toBeGreaterThan(0)
    const conflictId = (changed.body.record.events as Json[])[0]!.conflict as Json
    expect((await api.get('/api/epcis/conflicts')).body.conflicts).toHaveLength(1)
    expect((await api.post(`/api/epcis/conflicts/${ref(String(conflictId.conflictId))}/resolutions`, { decision: 'Both are kept.', disposition: 'all-retained' })).status).toBe(201)
    const pulled = await api.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(pulled.body).toMatchObject({ outcome: 'ok', events: { total: 5 } })
    expect((await api.get('/api/epcis/sources/supplier-a/pulls/all')).status).toBe(200)
    expect((await api.get('/api/epcis/sources')).status).toBe(200)
    expect((await api.get('/api/epcis/status')).status).toBe(200)

    // The doubles saw nothing, and neither the journal, the offers nor the index holds anything it did not hold before.
    expect(calls).toEqual([])
    expect(JSON.stringify(await api.platform.store.listPassports())).toBe(journal)
    expect(JSON.stringify(await api.platform.store.listOffers())).toBe(offers)
    expect(await lineage()).toBe(indexed)
    // An event that says the item was destroyed retired nothing.
    expect((await api.get(`/api/passports/${ref(passportId)}`)).body).toMatchObject({ status: 'active' })
    expect(calls).toEqual([])
  })

  it('does record a call when a passport is written, so an empty record means none was made', async () => {
    calls.length = 0
    const updated = await api.post(`/api/passports/${encodeURIComponent(passportId)}/update`, { payload: samplePayload('general@2', true) })
    expect(updated.status).toBe(200)
    expect(calls.some((call) => call.startsWith('writer.update'))).toBe(true)
    expect(calls.some((call) => call.startsWith('wallet.'))).toBe(true)
    expect(calls.some((call) => call.startsWith('index.'))).toBe(true)
  })
})
