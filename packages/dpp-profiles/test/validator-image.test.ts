import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VALIDATION_ENGINE_LIBRARIES } from '../src/validation-engine.js'

// The validator image installs the engine libraries from a manifest and a
// lockfile of its own, so that no workspace has to declare them and the
// index image stays as it was. These tests hold that arrangement together
// without Docker: the manifest to the adapter, the lockfile to the
// repository's, the inventory to the lockfile and the Dockerfile to its
// promises. scripts/validator-image-check.mjs holds the built image itself.
const packageRoot = join(import.meta.dirname, '..')
const repo = join(packageRoot, '..', '..')
const folder = join(packageRoot, 'validator-image')
const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
interface LockEntry { version: string; resolved?: string; integrity?: string; license?: string; link?: boolean; dev?: boolean; optional?: boolean; peer?: boolean; hasInstallScript?: boolean }
const rootLock = json<{ packages: Record<string, LockEntry> }>(join(repo, 'package-lock.json')).packages
const imageLock = json<{ packages: Record<string, LockEntry & { dependencies?: Record<string, string> }> }>(join(folder, 'package-lock.json')).packages
const manifest = json<{ name: string; private: boolean; type: string; dependencies: Record<string, string>; devDependencies?: unknown; scripts?: unknown }>(join(folder, 'package.json'))
const dockerfile = readFileSync(join(folder, 'Dockerfile'), 'utf8')
const overlayDockerfile = readFileSync(join(repo, 'packages', 'dpp-overlay', 'Dockerfile'), 'utf8')

describe('the validator image\'s own manifest', () => {
  it('pins exactly the libraries the adapter names, at the versions it names, and nothing else', () => {
    expect(manifest.dependencies).toEqual({ ...VALIDATION_ENGINE_LIBRARIES })
    expect(manifest.private).toBe(true)
    expect(manifest.type).toBe('module')
    expect(manifest.devDependencies).toBeUndefined()
    expect(manifest.scripts).toBeUndefined()
  })

  it('is not a workspace, so installing the repository or the index image never reaches it', () => {
    const root = json<{ workspaces: string[] }>(join(repo, 'package.json'))
    expect(root.workspaces).toEqual(['packages/*'])
    expect(Object.keys(rootLock).filter((path) => path.includes('validator-image'))).toEqual([])
    expect(Object.values(rootLock).some((entry) => (entry as { name?: string }).name === manifest.name)).toBe(false)
  })

  it('is not published with the package', () => {
    const published = json<{ files: string[] }>(join(packageRoot, 'package.json')).files
    expect(published.some((entry) => entry.startsWith('validator-image'))).toBe(false)
  })
})

describe('the validator image\'s lockfile', () => {
  it('is what lock.mjs derives from the repository\'s lockfile', () => {
    expect(execFileSync(process.execPath, [join(folder, 'lock.mjs'), '--check'], { encoding: 'utf8' })).toContain('as the repository\'s lockfile pins them')
  })

  it('holds every package at the version and integrity the tests ran with, and none that the repository does not hold', () => {
    const paths = Object.keys(imageLock).filter((path) => path !== '')
    expect(paths.length).toBeGreaterThan(300)
    for (const path of paths) {
      expect(rootLock[path], path).toBeDefined()
      expect({ version: imageLock[path]!.version, resolved: imageLock[path]!.resolved, integrity: imageLock[path]!.integrity }, path).toEqual({ version: rootLock[path]!.version, resolved: rootLock[path]!.resolved, integrity: rootLock[path]!.integrity })
      // Every package is a production dependency here, whatever it is to a workspace of the repository.
      expect(imageLock[path]!.dev ?? imageLock[path]!.optional ?? imageLock[path]!.peer, path).toBeUndefined()
      expect(imageLock[path]!.link, path).toBeUndefined()
      expect(imageLock[path]!.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//)
    }
    expect(imageLock['']!.dependencies).toEqual({ ...VALIDATION_ENGINE_LIBRARIES })
    for (const [name, version] of Object.entries(VALIDATION_ENGINE_LIBRARIES)) expect(imageLock[`node_modules/${name}`]?.version, name).toBe(version)
  })

  it('holds no package that runs a script at install, so installing with scripts ignored leaves nothing out', () => {
    expect(Object.entries(imageLock).filter(([, entry]) => entry.hasInstallScript === true).map(([path]) => path)).toEqual([])
  })

  it('holds nothing of this repository, of a database or of a chain library', () => {
    const names = Object.keys(imageLock).map((path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length))
    for (const name of names) expect(name).not.toMatch(/^@bsv\/|^mongodb/)
  })
})

describe('the validator image\'s licence inventory', () => {
  interface Inventory { lockfileSha256: string; packageCount: number; distinctPackages: number; licences: Record<string, number>; packages: Array<{ name: string; version: string; licence: string; path: string; integrity: string; licenceSource?: string }> }
  const inventory = json<Inventory>(join(folder, 'licence-inventory.json'))

  it('is what inventory.mjs writes from the lockfile', () => {
    expect(execFileSync(process.execPath, [join(folder, 'inventory.mjs'), '--check'], { encoding: 'utf8' })).toContain(`lists the ${inventory.packageCount} packages`)
  })

  it('names every package of the lockfile once, with its version, its licence and its integrity', () => {
    const paths = Object.keys(imageLock).filter((path) => path !== '').sort()
    expect(inventory.packages.map((p) => p.path).sort()).toEqual(paths)
    expect(inventory.packageCount).toBe(paths.length)
    for (const entry of inventory.packages) {
      expect(entry.version, entry.path).toBe(imageLock[entry.path]!.version)
      expect(entry.integrity, entry.path).toBe(imageLock[entry.path]!.integrity)
      expect(entry.licence, entry.path).toMatch(/\S/)
      // A licence the lockfile does not carry is written by hand, and says where it was read.
      if (imageLock[entry.path]!.license == null) expect(entry.licenceSource, entry.path).toMatch(/manifest/)
      else expect(entry.licence, entry.path).toBe(imageLock[entry.path]!.license)
    }
    expect(inventory.distinctPackages).toBe(new Set(inventory.packages.map((p) => `${p.name}@${p.version}`)).size)
  })

  it('counts each licence, and every one is permissive', () => {
    const counted: Record<string, number> = {}
    for (const entry of inventory.packages) counted[entry.licence] = (counted[entry.licence] ?? 0) + 1
    expect(inventory.licences).toEqual(counted)
    expect(Object.keys(counted).sort()).toEqual(['(WTFPL OR MIT)', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'FreeBSD', 'ISC', 'MIT'])
    expect(Object.keys(counted).filter((licence) => /GPL|AGPL|LGPL|SSPL|EPL|MPL|CDDL|BUSL|Commons|UNLICENSED/i.test(licence))).toEqual([])
  })
})

describe('the validator image\'s Dockerfile', () => {
  const stages = dockerfile.split(/^FROM /m).slice(1)
  const final = stages.at(-1)!

  it('uses the index image\'s pinned base, as a build argument, and checks the runtime in both stages', () => {
    const base = /^ARG BASE_IMAGE=(\S+)$/m
    expect(base.exec(dockerfile)?.[1]).toBe(base.exec(overlayDockerfile)?.[1])
    expect(base.exec(dockerfile)?.[1]).toMatch(/^node:\d+\.\d+\.\d+-slim$/)
    expect(stages.length).toBe(2)
    for (const stage of stages) expect(stage).toMatch(/^\$\{BASE_IMAGE\}/)
    const version = base.exec(dockerfile)![1]!.replace(/^node:|-slim$/g, '')
    expect(dockerfile.match(new RegExp(`^RUN test "\\$\\(node --version\\)" = "v${version.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}"$`, 'gm'))?.length).toBe(2)
  })

  it('installs its dependencies from its own lockfile, with no workspace and no development dependency', () => {
    expect(final).toMatch(/^COPY packages\/dpp-profiles\/validator-image\/package\.json packages\/dpp-profiles\/validator-image\/package-lock\.json \.\/$/m)
    const installs = [...final.matchAll(/^RUN npm (.*)$/gm)].map((m) => m[1])
    expect(installs).toEqual(['ci --omit=dev --ignore-scripts && npm cache clean --force'])
    // The repository's lockfile and manifests are in the build stage only, where the compiler comes from.
    expect(final).not.toMatch(/COPY package\.json|COPY package-lock\.json/)
  })

  it('holds what it installed to the inventory before anything else is copied in', () => {
    expect(final).toMatch(/^COPY packages\/dpp-profiles\/validator-image\/licence-inventory\.json packages\/dpp-profiles\/validator-image\/notices\.mjs \.\/\nRUN node notices\.mjs && rm notices\.mjs$/m)
  })

  it('carries the licence files, and copies no profile, binding, manifest, schema or fixture', () => {
    expect(final).toMatch(/^COPY LICENSE NOTICE PATENTS \.\/$/m)
    const copied = [...dockerfile.matchAll(/^COPY (?:--from=\S+ )?(.+) \S+$/gm)].flatMap((m) => m[1]!.split(' '))
    for (const source of copied) expect(source, source).not.toMatch(/bindings|manifests|schemas|generated|fixtures|examples|contracts|frozen|test|\.ttl|\.jsonld/)
    // From the build stage it takes built files by name, never a folder.
    for (const [, source] of final.matchAll(/^COPY --from=build (\S+) /gm)) expect(source).toMatch(/^\/repo\/packages\/dpp-profiles\/dist\/[a-z-]+\.js$/)
  })

  it('runs as the node user, with node as its command and its own health command', () => {
    expect(final).toMatch(/^USER node$/m)
    expect(final.trimEnd().split('\n').at(-1)).toBe('CMD ["node", "packages/dpp-profiles/dist/validator-cli.js"]')
    expect(final).toMatch(/^ {2}CMD \["node", "packages\/dpp-profiles\/dist\/validator-cli\.js", "health"\]$/m)
    expect(dockerfile).not.toMatch(/npm (start|run start)|ENTRYPOINT/)
    // The user is set after everything is installed and copied, so the service cannot change its own files.
    expect(final.indexOf('USER node')).toBeGreaterThan(final.lastIndexOf('COPY '))
  })

  it('finds its licence files in the build context', () => {
    const ignore = readFileSync(join(repo, '.dockerignore'), 'utf8').split('\n')
    for (const file of ['LICENSE', 'NOTICE', 'PATENTS', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'packages/']) expect(ignore, file).toContain(`!${file}`)
    expect(ignore[ignore.findIndex((line) => !line.startsWith('#'))]).toBe('*')
  })
})

describe('the validator service is nobody\'s dependency', () => {
  const STATIC = /(?:^|[\s;])(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [path] : [] })

  it('the main entry point of this package reaches neither the client nor the service', () => {
    const files = new Set<string>()
    const visit = (file: string): void => {
      if (files.has(file)) return
      files.add(file)
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC)) if (specifier!.startsWith('.')) visit(resolve(dirname(file), specifier!.replace(/\.js$/, '.ts')))
    }
    visit(join(packageRoot, 'src', 'index.ts'))
    expect(files.size).toBeGreaterThan(15)
    expect([...files].filter((file) => /validator-/.test(file))).toEqual([])
  })

  it.each(['dpp-protocol', 'dpp-overlay'])('%s imports nothing of it, so the protocol-only and index-only installations never need it', (workspace) => {
    const files = sources(join(repo, 'packages', workspace, 'src'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/dpp-profiles\/validator-|validator-(service|client|wire|worker|command|cli)|dpp-validator/)
    }
    const declared = json<{ dependencies?: Record<string, string>; bin?: Record<string, string> }>(join(repo, 'packages', workspace, 'package.json'))
    expect(Object.keys(declared.dependencies ?? {}).filter((name) => Object.keys(VALIDATION_ENGINE_LIBRARIES).includes(name))).toEqual([])
  })

  it('this package exports the client, the service and the command, each under a name of its own', () => {
    const own = json<{ bin: Record<string, string>; exports: Record<string, unknown>; dependencies: Record<string, string> }>(join(packageRoot, 'package.json'))
    expect(own.bin).toEqual({ 'dpp-validator': './dist/validator-cli.js' })
    expect(own.exports['./validator-client']).toEqual({ types: './dist/validator-client.d.ts', default: './dist/validator-client.js' })
    expect(own.exports['./validator-service']).toEqual({ types: './dist/validator-service.d.ts', default: './dist/validator-service.js' })
    // Still one dependency: the service and the client need Node and nothing else.
    expect(own.dependencies).toEqual({ canonicalize: '5.0.0' })
    expect(existsSync(join(packageRoot, 'src', 'validator-cli.ts'))).toBe(true)
    expect(readFileSync(join(packageRoot, 'src', 'validator-cli.ts'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})
