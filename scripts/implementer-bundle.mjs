#!/usr/bin/env node
/**
 * Assemble the implementer bundle: what an independent implementer receives
 * to implement the standard without the reference runtime code. The
 * specifications, the contracts, the fixtures in both forms, the conformance
 * baselines, ledger, schemas, selections, example capability document and
 * licence record, the frozen profile data, the implementer documentation and
 * the licence, with a manifest naming the release set and its digest, the
 * source revision and the SHA-256 of every file. Written to
 * release/implementer-bundle/ (ignored by git) and packed as one archive
 * beside it, and recorded in release/candidates.json when that exists.
 *
 *   node scripts/implementer-bundle.mjs
 *
 * Carries no dist/, no src/, no test/ and no package manifest: a consumer of
 * the bundle installs nothing from it and imports nothing from it.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentReleaseSet, sha256 } from './lib/candidates.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setPath = process.argv[2] ?? currentReleaseSet(root).path
const set = JSON.parse(readFileSync(join(root, setPath), 'utf8'))
const out = join(root, 'release', 'implementer-bundle')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const copy = (from, to = from) => { cpSync(join(root, from), join(out, to), { recursive: true }) }
copy('spec')
copy('contracts')
copy('fixtures')
for (const f of ['baseline-native-1.json', 'baseline-native-2.json', 'baseline.schema.json', 'manifest.json', 'manifest.schema.json', 'selection.schema.json', 'licences.json']) copy(`conformance/${f}`)
copy('conformance/selections')
copy('conformance/examples')
copy('conformance/demonstrations')
copy('packages/dpp-profiles/manifests', 'profiles/manifests')
copy('packages/dpp-profiles/schemas', 'profiles/schemas')
copy('packages/dpp-profiles/generated', 'profiles/generated')
copy('packages/dpp-profiles/frozen.json', 'profiles/frozen.json')
copy('packages/vsc/artifacts', 'profiles/vsc-artifacts')
// Carry the complete guide navigation, excluding local review material.
cpSync(join(root, 'docs'), join(out, 'docs'), {
  recursive: true,
  filter: (source) => {
    const path = relative(join(root, 'docs'), source)
    return path !== 'private' && !path.startsWith('private/') &&
      (statSync(source).isDirectory() || source.endsWith('.md'))
  },
})
copy('GOVERNANCE.md')
copy('LICENSE')
copy(setPath, `release/${setPath.split('/').at(-1)}`)
copy('release/release-set.schema.json', 'release/release-set.schema.json')

// Nothing that is code or a package manifest.
const walk = (dir) => readdirSync(dir).flatMap((name) => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(out).map((p) => relative(out, p)).sort()
const forbidden = files.filter((f) => /(^|\/)(dist|src|test|node_modules)\//.test(f) || /package\.json$/.test(f) || /\.(ts|mjs|js)$/.test(f))
if (forbidden.length > 0) throw new Error(`the bundle would carry code or a package manifest: ${forbidden.join(', ')}`)

// Every local guide destination must travel with the bundle.
const docsRoot = join(out, 'docs')
for (const file of files.filter((f) => f.startsWith('docs/') && f.endsWith('.md'))) {
  const text = readFileSync(join(out, file), 'utf8')
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const destination = resolve(dirname(join(out, file)), target.split('#')[0])
    if (!destination.startsWith(docsRoot + '/') || !existsSync(destination)) {
      throw new Error(`${file} links to ${target}, which is outside the bundled guides`)
    }
  }
}

const revision = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() } catch { return 'unknown' } })()
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '' } catch { return true } })()
const manifest = {
  bundle: 'dpp-implementer-bundle',
  bundleVersion: '1',
  releaseSet: set.releaseSet,
  releaseSetPath: setPath,
  releaseSetSha256: sha256(readFileSync(join(root, setPath))),
  baseline: set.baseline,
  selection: set.selection ?? null,
  sourceRepository: 'bsv-blockchain/dpp',
  sourceRevision: revision,
  sourceState: dirty ? 'working-tree' : 'committed',
  assembledAt: new Date().toISOString(),
  licence: 'Open BSV License Version 6 (LICENSE); third-party artefacts carry their own notices beside them',
  carries: 'specifications, contracts, fixtures in both forms, conformance baselines, ledger, schemas, selections, example capability document, licence record and demonstration definition, frozen profile data and VSC artefacts, implementer documentation; no reference runtime code',
  files: Object.fromEntries(files.map((f) => [f, { sha256: sha256(readFileSync(join(out, f))), bytes: statSync(join(out, f)).size }])),
}
writeFileSync(join(out, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const archive = join(root, 'release', `dpp-implementer-bundle-${set.releaseSet}.tgz`)
rmSync(archive, { force: true })
execFileSync('tar', ['czf', archive, '-C', join(root, 'release'), 'implementer-bundle'], { stdio: 'inherit' })
const archiveDigest = sha256(readFileSync(archive))
console.log(`bundle: ${files.length} files under release/implementer-bundle/ for ${set.releaseSet} at ${revision.slice(0, 12)} (${manifest.sourceState}); archive ${relative(root, archive)} sha256 ${archiveDigest}`)

const recordPath = join(root, 'release', 'candidates.json')
if (existsSync(recordPath)) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  if (record.releaseSet === set.releaseSet) {
    record.implementerBundle = { archive: relative(root, archive), sha256: archiveDigest, files: files.length, assembledAt: manifest.assembledAt, sourceRevision: revision }
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
    console.log('recorded the bundle in release/candidates.json')
  }
}
