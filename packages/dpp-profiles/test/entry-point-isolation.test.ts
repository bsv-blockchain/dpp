import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VALIDATION_ENGINE_LIBRARIES } from '../src/validation-engine.js'

// The JSON-LD and SHACL libraries are heavy, and most users of this package
// never validate a JSON-LD profile. Two properties keep them out of the way,
// and both are easy to lose by accident, so both are held here:
//
//   1. nothing reachable from the main entry point imports the adapter or
//      any library but the package's one dependency;
//   2. the index image, which installs production dependencies for three
//      workspaces, installs none of the libraries.
const packageRoot = join(import.meta.dirname, '..')
const repo = join(packageRoot, '..', '..')
const libraries = Object.keys(VALIDATION_ENGINE_LIBRARIES)

const STATIC = /(?:^|[\s;])(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g
const DYNAMIC = /\bimport\(\s*(['"]([^'"]+)['"])?/g

/** Every file reachable from an entry file by an import of any kind, type-only ones included, and every bare specifier met on the way. */
function importGraph(entry: string, extensions: string[]): { files: Set<string>; bare: Set<string>; computed: string[] } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const computed: string[] = []
  const visit = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    const text = readFileSync(file, 'utf8')
    const specifiers = [...text.matchAll(STATIC)].map((m) => m[1]!)
    for (const m of text.matchAll(DYNAMIC)) {
      if (m[2] == null) computed.push(file)
      else specifiers.push(m[2])
    }
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) { bare.add(specifier); continue }
      // Source files import each other by the name the built file will have.
      const base = resolve(dirname(file), specifier)
      const target = extensions.map((ext) => base.replace(/\.js$/, ext)).find((candidate) => existsSync(candidate))
      if (target == null) throw new Error(`${file} imports ${specifier}, which was not found`)
      visit(target)
    }
  }
  visit(entry)
  return { files, bare, computed }
}

describe('the main entry point does not reach the validation engine', () => {
  const graphs: Array<[string, string, string[]]> = [['src/index.ts', 'validation-engine.ts', ['.ts']]]
  // The built package is what a consumer loads. It is checked as well whenever it has been built.
  if (existsSync(join(packageRoot, 'dist', 'index.js'))) graphs.push(['dist/index.js', 'validation-engine.js', ['.js']])

  it.each(graphs)('%s: no import of any kind leads to the adapter or to a library', (entry, adapter, extensions) => {
    const { files, bare, computed } = importGraph(join(packageRoot, entry), extensions)
    expect(files.size).toBeGreaterThan(15)
    expect([...files].filter((file) => file.endsWith(adapter))).toEqual([])
    // The package's whole dependency list, and Node's own modules.
    expect([...bare].filter((specifier) => !specifier.startsWith('node:')).sort()).toEqual(['canonicalize'])
    for (const library of libraries) expect([...bare].some((specifier) => specifier === library || specifier.startsWith(`${library}/`)), library).toBe(false)
    // A computed import could load anything, so the main entry point has none.
    expect(computed).toEqual([])
  })

  it('the adapter itself imports types only, so importing it loads nothing until an engine is asked for', () => {
    const source = readFileSync(join(packageRoot, 'src', 'validation-engine.ts'), 'utf8')
    const statements = source.split('\n').filter((line) => /^(import|export)\s.*\sfrom\s/.test(line))
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) expect(statement).toMatch(/^import type \{[^}]+\} from '\.\/[a-z-]+\.js'$/)
    // Its one computed import is the loader `createValidationEngine` calls.
    expect([...source.matchAll(DYNAMIC)].map((m) => m[2])).toEqual([undefined])
    const built = join(packageRoot, 'dist', 'validation-engine.js')
    if (existsSync(built)) expect([...readFileSync(built, 'utf8').matchAll(STATIC)].map((m) => m[1])).toEqual([])
  })

  it('exports the adapter under its own subpath and nowhere else', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { exports: Record<string, unknown>; main: string }
    expect(manifest.exports['./validation-engine']).toEqual({ types: './dist/validation-engine.d.ts', default: './dist/validation-engine.js' })
    expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' })
  })
})

describe('the index image does not gain the validation libraries', () => {
  interface LockEntry { version?: string; resolved?: string; link?: boolean; dev?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
  const lock = (JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> }).packages
  const dockerfile = readFileSync(join(repo, 'packages', 'dpp-overlay', 'Dockerfile'), 'utf8')

  /** The lockfile entry a package resolves a dependency to: the nearest node_modules on the way up, as Node resolves it. */
  const resolveFrom = (from: string, name: string): string | undefined => {
    let at = from
    for (;;) {
      const candidate = `${at === '' ? '' : `${at}/`}node_modules/${name}`
      if (lock[candidate] != null) return lock[candidate]!.link === true ? lock[candidate]!.resolved : candidate
      if (at === '') return undefined
      // One level up: out of a nested node_modules, or from a workspace or a hoisted package to the root.
      const cut = at.lastIndexOf('/node_modules/')
      at = cut === -1 ? '' : at.slice(0, cut)
    }
  }

  /**
   * Everything npm can reach from the workspaces the image selects. npm
   * follows a selected workspace's development and peer edges as well as its
   * production ones, and leaves out only what the lockfile marks as
   * development-only. A library another workspace needs in production is not
   * marked that way, so one edge from a selected workspace is enough to pull
   * it into the image.
   */
  const reachable = (workspaces: string[]): Set<string> => {
    const seen = new Set<string>()
    const visit = (path: string): void => {
      if (seen.has(path)) return
      seen.add(path)
      const entry = lock[path]
      if (entry == null) throw new Error(`the lockfile has no entry ${path}`)
      const isWorkspace = path === '' || path.startsWith('packages/')
      const edges = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies, ...(isWorkspace ? entry.devDependencies : {}) }
      for (const name of Object.keys(edges)) {
        const target = resolveFrom(path, name)
        if (target != null) visit(target)
      }
    }
    workspaces.forEach(visit)
    return seen
  }

  it('installs production dependencies for the overlay, protocol and profiles workspaces and the root, as before', () => {
    // Each install command, with its line continuations joined, up to the command that follows it.
    const installs = [...dockerfile.matchAll(/^RUN npm ci ((?:[^\n]*\\\n)*[^\n]*)/gm)].map((m) => m[1]!.replace(/\\\n/g, ' ').split('&&')[0]!.replace(/\s+/g, ' ').trim())
    expect(installs).toEqual([
      '--ignore-scripts -w @bsv/dpp-overlay -w @bsv/dpp-protocol -w @bsv/dpp-profiles --include-workspace-root',
      '--omit=dev --ignore-scripts -w @bsv/dpp-overlay -w @bsv/dpp-protocol -w @bsv/dpp-profiles --include-workspace-root',
    ])
  })

  it('reaches none of the libraries from the workspaces the image selects', () => {
    const selected = reachable(['', 'packages/dpp-overlay', 'packages/dpp-protocol', 'packages/dpp-profiles'])
    expect(selected.size).toBeGreaterThan(100)
    for (const library of libraries) expect(selected.has(`node_modules/${library}`), library).toBe(false)
    // The check can see a leak: the workspace that does declare the libraries reaches every one of them.
    const declaring = reachable(['packages/dpp-credentials'])
    for (const library of libraries) expect(declaring.has(`node_modules/${library}`), library).toBe(true)
  })

  it('declares the libraries in no dependency list of a workspace the image selects', () => {
    for (const workspace of ['', 'packages/dpp-overlay', 'packages/dpp-protocol', 'packages/dpp-profiles']) {
      const manifest = JSON.parse(readFileSync(join(repo, workspace, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
      for (const list of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const library of libraries) expect(manifest[list]?.[library], `${workspace || 'the root'} ${list} ${library}`).toBeUndefined()
      }
    }
  })

  // The tests need the libraries installed, so some workspace must declare them. It is one the image does not
  // select: declared by this package, even for development only, they would come within npm's reach again.
  it('pins the libraries the tests use at the versions the adapter names', () => {
    const manifest = JSON.parse(readFileSync(join(repo, 'packages', 'dpp-credentials', 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    for (const [library, version] of Object.entries(VALIDATION_ENGINE_LIBRARIES)) expect(manifest.devDependencies[library], library).toBe(version)
  })
})
