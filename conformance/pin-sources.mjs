#!/usr/bin/env node
/**
 * Pin what the checker verifies: the digest of every local source the ledger
 * cites, the digest of every fixture the baseline names, and the licence and
 * version of every direct dependency of every workspace package.
 *
 *   node conformance/pin-sources.mjs
 *
 * Run it after reviewing a change to a specification, contract or fixture, so
 * the review is what moves the recorded digest. The checker refuses a moved
 * source until this has been run, which is the point: an assessment made
 * against one text never silently applies to another.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dependencyManifest } from '../scripts/lib/dependency-manifest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const write = (relative, value) => writeFileSync(join(root, relative), JSON.stringify(value, null, 2) + '\n')
const sha256 = (relative) => createHash('sha256').update(readFileSync(join(root, relative))).digest('hex')

// The baseline first, because the ledger pins the baseline file itself: its
// fixture digests must be final before the ledger records its digest.
for (const path of ['conformance/baseline-native-1.json', 'conformance/baseline-native-2.json']) {
  const baseline = read(path)
  let fixtures = 0
  for (const f of baseline.fixtures) {
    const digest = sha256(f.path)
    if (f.sha256 !== digest) { f.sha256 = digest; fixtures += 1 }
  }
  write(path, baseline)
  console.log(`${fixtures} fixture digest${fixtures === 1 ? '' : 's'} moved in ${path}.`)
}

// The release sets: the artefact digests each names, so a changed contract
// or fixture moves the set's record and the checker says so.
for (const name of readdirSync(join(root, 'release')).filter((f) => /^dpp-release-.*\.json$/.test(f))) {
  const set = read(`release/${name}`)
  // A superseded set keeps the digests it recorded when it was current.
  if (set.status === 'superseded') { console.log(`release/${name} is superseded; its recorded digests are left as history.`); continue }
  let moved = 0
  for (const a of set.artefacts) {
    const digest = sha256(a.path)
    if (a.sha256 !== digest) { a.sha256 = digest; moved += 1 }
  }
  write(`release/${name}`, set)
  console.log(`${moved} artefact digest${moved === 1 ? '' : 's'} moved in release/${name}.`)
}

const ledger = read('conformance/manifest.json')
let pinned = 0
for (const s of ledger.sources) {
  if (s.kind !== 'local' || s.path == null) continue
  const digest = sha256(s.path)
  if (s.digest !== digest) { s.digest = digest; pinned += 1 }
}
write('conformance/manifest.json', ledger)
console.log(`${pinned} local source digest${pinned === 1 ? '' : 's'} moved in conformance/manifest.json.`)

const components = []
for (const dir of readdirSync(join(root, 'packages'))) {
  const manifestPath = join(root, 'packages', dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = []
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    const installed = dependencyManifest(dirname(manifestPath), name)
    if (installed == null) { dependencies.push({ name, range, version: 'not installed', licence: 'UNKNOWN' }); continue }
    dependencies.push({ name, range, version: installed.version, licence: typeof installed.license === 'string' ? installed.license : JSON.stringify(installed.license ?? 'UNKNOWN') })
  }
  components.push({ name: manifest.name, version: manifest.version, licence: manifest.license, dependencies })
}
write('conformance/licences.json', {
  description: 'Direct runtime dependencies of each workspace package with the licence each declares in its installed manifest, recorded so the checker notices a change. The repository itself is under the Open BSV License Version 6 (LICENSE), including the packages that declare SEE LICENSE IN LICENSE; a package with no BSV runtime dependency is not thereby unrestricted open source.',
  repositoryLicence: 'Open BSV License Version 6',
  pinnedAt: new Date().toISOString().slice(0, 10),
  components,
})
console.log(`licences recorded for ${components.length} components in conformance/licences.json.`)
