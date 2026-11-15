#!/usr/bin/env node
/**
 * Pack the release set's candidates exactly as npm would publish them, into
 * release/candidates/ (ignored by git), and record their digests in
 * release/candidates.json beside the source revision, the set file's own
 * digest, the selection that qualifies the set and the images it names,
 * so an approval refers to concrete bytes and one validated set, and a
 * consumer check installs those bytes and no others.
 *
 *   node scripts/release-candidates.mjs                       # the current candidate set
 *   node scripts/release-candidates.mjs release/<set>.json    # a named set
 *
 * Builds first, from an empty dist/ in each package, because a tarball packs
 * dist/. Copies the repository's NOTICE and PATENTS into each package that
 * publishes them, because the pack runs no script, and refuses an archive
 * that lacks one or the licence. Refuses a set that is not a
 * candidate, a package whose manifest version differs from the set's, a
 * manifest that does not export an entry point the set declares, and a set
 * that names no selection.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
// A tarball packs all of dist/, and tsc never deletes output, so each package
// builds from an empty dist/: a module since removed from src/ is not packed.
for (const pkg of set.packages) rmSync(join(root, pkg.directory, 'dist'), { recursive: true, force: true })
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
  // Each package publishes NOTICE and PATENTS, which are the repository's and are copied in by its prepack script.
  // The pack below runs no script, so the copy is made here, by name and from the root, and taken away again when
  // this run made it. Without it the candidates, which are the bytes that are published, carried the licence alone.
  const carried = ['NOTICE', 'PATENTS'].filter((file) => (manifest.files ?? []).includes(file))
  const copied = carried.filter((file) => !existsSync(join(root, pkg.directory, file)))
  for (const file of carried) copyFileSync(join(root, file), join(root, pkg.directory, file))
  let report
  try {
    report = JSON.parse(run(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', out], join(root, pkg.directory)))[0]
  } finally {
    for (const file of copied) rmSync(join(root, pkg.directory, file), { force: true })
  }
  const packed = new Set(report.files.map((file) => file.path))
  const lacking = ['LICENSE', ...carried].filter((file) => !packed.has(file))
  if (lacking.length > 0) throw new Error(`${pkg.name}: the packed archive lacks ${lacking.join(', ')}`)
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
  // The images that belong to the set, as it records them: built from the
  // same revision as these tarballs and labelled with it, each with its
  // digest or the word unpublished.
  images: set.images == null ? null : { registry: set.images.registry, own: set.images.own.map(({ name, package: of, dockerfile, runtime, digest }) => ({ name, package: of, dockerfile, node: runtime.node, digest })) },
  sourceRevision: revision,
  sourceState: dirty ? 'working-tree' : 'committed',
  packedAt: new Date().toISOString(),
  candidates,
}
writeFileSync(join(root, 'release', 'candidates.json'), JSON.stringify(record, null, 2) + '\n')
console.log(`recorded ${candidates.length} candidates in release/candidates.json (${record.sourceState} at ${revision.slice(0, 12)}, set digest ${record.releaseSetSha256.slice(0, 12)}…, selection ${set.selection}, images ${record.images == null ? record.imageTag : record.images.own.map((image) => `${image.name} (${image.digest})`).join(' and ')}); tarballs in ${out}`)
console.log(readdirSync(out).join(', '))
