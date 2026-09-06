#!/usr/bin/env node
/**
 * Pack the release set's candidates exactly as npm would publish them, into
 * release/candidates/ (ignored by git), and record their digests in
 * release/candidates.json beside the source revision, the set file's own
 * digest, the selection that qualifies the set and the image tag it names,
 * so an approval refers to concrete bytes and one validated set, and a
 * consumer check installs those bytes and no others.
 *
 *   node scripts/release-candidates.mjs                       # the current candidate set
 *   node scripts/release-candidates.mjs release/<set>.json    # a named set
 *
 * Builds first, because a tarball packs dist/. Refuses a set that is not a
 * candidate, a package whose manifest version differs from the set's, a
 * manifest that does not export an entry point the set declares, and a set
 * that names no selection.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentReleaseSet, sha256 } from './lib/candidates.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setPath = process.argv[2] ?? currentReleaseSet(root).path
const setBytes = readFileSync(join(root, setPath))
const set = JSON.parse(setBytes.toString('utf8'))
console.log(`packing ${setPath}`)
if (set.status !== 'candidate') throw new Error(`${setPath} is ${set.status}; only a candidate set is packed`)
if (set.selection == null) throw new Error(`${setPath} names no selection; a set names the selection that qualifies it`)
if (!existsSync(join(root, set.selection))) throw new Error(`${setPath} names ${set.selection}, which does not exist`)
const selection = JSON.parse(readFileSync(join(root, set.selection), 'utf8'))
if (selection.releaseSet !== set.releaseSet) throw new Error(`${set.selection} qualifies ${selection.releaseSet}, not ${set.releaseSet}`)

const out = join(root, 'release', 'candidates')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const run = (args, cwd = root) => execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
run(['npm', 'run', 'build'])
const revision = (() => { try { return run(['git', 'rev-parse', 'HEAD']).trim() } catch { return 'unknown' } })()
const dirty = (() => { try { return run(['git', 'status', '--porcelain']).trim() !== '' } catch { return true } })()

const candidates = []
for (const pkg of set.packages) {
  const manifest = JSON.parse(readFileSync(join(root, pkg.directory, 'package.json'), 'utf8'))
  if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
    throw new Error(`${pkg.directory} is ${manifest.name}@${manifest.version}; the release set names ${pkg.name}@${pkg.version}`)
  }
  for (const entry of pkg.entryPoints) {
    if (manifest.exports?.[entry] == null) throw new Error(`${pkg.name} does not export ${entry}, which the release set declares`)
  }
  const report = JSON.parse(run(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', out], join(root, pkg.directory)))[0]
  const bytes = readFileSync(join(out, report.filename))
  candidates.push({
    name: pkg.name,
    version: pkg.version,
    filename: report.filename,
    sha256: sha256(bytes),
    integrity: report.integrity,
    size: report.size,
    unpackedSize: report.unpackedSize,
    files: report.entryCount,
    entryPoints: pkg.entryPoints,
    support: pkg.support,
  })
  console.log(`${pkg.name}@${pkg.version}: ${report.filename}, ${report.entryCount} files, ${report.size} bytes, sha256 ${candidates.at(-1).sha256.slice(0, 16)}…`)
}
const record = {
  releaseSet: set.releaseSet,
  releaseSetPath: setPath,
  releaseSetSha256: sha256(setBytes),
  selection: set.selection,
  imageTag: set.image?.tag ?? null,
  sourceRevision: revision,
  sourceState: dirty ? 'working-tree' : 'committed',
  packedAt: new Date().toISOString(),
  candidates,
}
writeFileSync(join(root, 'release', 'candidates.json'), JSON.stringify(record, null, 2) + '\n')
console.log(`recorded ${candidates.length} candidates in release/candidates.json (${record.sourceState} at ${revision.slice(0, 12)}, set digest ${record.releaseSetSha256.slice(0, 12)}…, selection ${set.selection}, image ${record.imageTag}); tarballs in ${out}`)
console.log(readdirSync(out).join(', '))
