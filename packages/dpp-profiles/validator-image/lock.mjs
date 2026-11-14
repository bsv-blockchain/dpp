#!/usr/bin/env node
/**
 * Writes this folder's package-lock.json: the part of the repository's
 * lockfile the engine libraries reach, and nothing else.
 *
 *   node packages/dpp-profiles/validator-image/lock.mjs           write the lockfile
 *   node packages/dpp-profiles/validator-image/lock.mjs --check   exit 1 when the lockfile on disk is not what would be written
 *
 * The image installs from a lockfile of its own, so that it holds the engine
 * and no other workspace's dependencies. Resolving that lockfile afresh would
 * let the image run versions the tests never saw. Every entry is therefore
 * copied from the repository's lockfile, version and integrity included: the
 * image installs exactly the packages the tests ran with. After a change to
 * the repository's lockfile, run this again, then inventory.mjs.
 *
 * It reads two files and writes one. It installs nothing and uses no network.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const source = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
const packages = source.packages

/** The entry a package resolves a dependency to: the nearest node_modules on the way up, as Node resolves it. */
const resolveFrom = (from, name) => {
  let at = from
  for (;;) {
    const candidate = `${at === '' ? '' : `${at}/`}node_modules/${name}`
    if (packages[candidate] != null) return candidate
    if (at === '') return undefined
    const cut = at.lastIndexOf('/node_modules/')
    at = cut === -1 ? '' : at.slice(0, cut)
  }
}

const reached = new Set()
const visit = (path, via) => {
  if (reached.has(path)) return
  const entry = packages[path]
  if (entry.link === true) throw new Error(`${via} reaches ${path}, a workspace. The image installs published packages only.`)
  reached.add(path)
  for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
    const target = resolveFrom(path, name)
    if (target == null) {
      if (entry.optionalDependencies?.[name] != null) continue
      throw new Error(`${path} depends on ${name}, which the repository's lockfile does not hold.`)
    }
    visit(target, path)
  }
  // A peer the package requires is part of what it runs with. One it marks optional is installed only if something else asks for it.
  for (const name of Object.keys(entry.peerDependencies ?? {})) {
    if (entry.peerDependenciesMeta?.[name]?.optional === true) continue
    const target = resolveFrom(path, name)
    if (target == null) throw new Error(`${path} requires the peer ${name}, which the repository's lockfile does not hold.`)
    visit(target, path)
  }
}
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const path = `node_modules/${name}`
  if (packages[path]?.version !== version) throw new Error(`package.json pins ${name}@${version}, and the repository's lockfile holds ${packages[path]?.version ?? 'no such package'}.`)
  visit(path, 'package.json')
}

// In the repository some of these are development dependencies of a workspace. Here every one is a production dependency.
// The entries are in the order npm writes them, so npm has nothing to rewrite.
const WORKSPACE_FLAGS = ['dev', 'devOptional', 'peer', 'optional', 'extraneous']
const out = { '': { name: manifest.name, version: manifest.version, license: manifest.license, dependencies: manifest.dependencies } }
for (const path of [...reached].sort((a, b) => a.localeCompare(b, 'en'))) out[path] = Object.fromEntries(Object.entries(packages[path]).filter(([key]) => !WORKSPACE_FLAGS.includes(key)))
const text = JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: source.lockfileVersion, requires: true, packages: out }, null, 2) + '\n'

const target = join(here, 'package-lock.json')
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(target, 'utf8') } catch { /* reported below */ }
  if (current !== text) {
    console.error('packages/dpp-profiles/validator-image/package-lock.json is not the engine libraries\' part of the repository\'s lockfile. Run node packages/dpp-profiles/validator-image/lock.mjs, then inventory.mjs.')
    process.exit(1)
  }
  console.log(`package-lock.json holds the ${reached.size} packages the engine libraries reach, as the repository's lockfile pins them.`)
} else {
  writeFileSync(target, text)
  console.log(`Wrote package-lock.json: ${reached.size} packages.`)
}
