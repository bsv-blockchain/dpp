#!/usr/bin/env node
/**
 * Pack the release set's candidates exactly as npm would publish them, into
 * release/candidates/ (ignored by git), and record their digests in
 * release/candidates.json beside the source revision, so an approval refers
 * to concrete bytes and a consumer check installs those bytes and no others.
 *
 *   node scripts/release-candidates.mjs
 *
 * Builds first, because a tarball packs dist/. Reads the release set to know
 * which packages and versions belong to it and refuses a package whose
 * manifest version differs from the set's.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setPath = process.argv[2] ?? 'release/dpp-release-2026-09.json'
const set = JSON.parse(readFileSync(join(root, setPath), 'utf8'))
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
  const report = JSON.parse(run(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', out], join(root, pkg.directory)))[0]
  const bytes = readFileSync(join(out, report.filename))
  candidates.push({
    name: pkg.name,
    version: pkg.version,
    filename: report.filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: report.integrity,
    size: report.size,
    unpackedSize: report.unpackedSize,
    files: report.entryCount,
    entryPoints: pkg.entryPoints,
  })
  console.log(`${pkg.name}@${pkg.version}: ${report.filename}, ${report.entryCount} files, ${report.size} bytes, sha256 ${candidates.at(-1).sha256.slice(0, 16)}…`)
}
const record = {
  releaseSet: set.releaseSet,
  sourceRevision: revision,
  sourceState: dirty ? 'working-tree' : 'committed',
  packedAt: new Date().toISOString(),
  candidates,
}
writeFileSync(join(root, 'release', 'candidates.json'), JSON.stringify(record, null, 2) + '\n')
console.log(`recorded ${candidates.length} candidates in release/candidates.json (${record.sourceState} at ${revision.slice(0, 12)}); tarballs in ${out}`)
console.log(readdirSync(out).join(', '))
