#!/usr/bin/env node
/**
 * Assemble the implementer bundle: what an independent implementer receives
 * to implement the standard without the reference runtime code. The
 * specifications, the contracts, the fixtures in every published form, the
 * conformance baselines, ledger, schemas, selections, example capability
 * document and licence record, the frozen profile data, the implementer
 * documentation and the licence, with a manifest naming the release set and
 * its digest, the source revision and the SHA-256 of every file. Written to
 * release/implementer-bundle/ (ignored by git) and packed as one archive
 * beside it, and recorded in release/candidates.json when that exists.
 *
 *   node scripts/implementer-bundle.mjs [release-set path] [output directory]
 *
 * Carries no dist/, no src/, no test/ and no package manifest: a consumer of
 * the bundle installs nothing from it and imports nothing from it.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentReleaseSet, sha256 } from './lib/candidates.mjs'
import { fixtureCatalogue } from './lib/fixture-catalogue.mjs'
import { markdownHeadings, markdownTargets, rewriteMarkdownTargets } from './lib/markdown-links.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setPath = process.argv[2] ?? currentReleaseSet(root).path
const set = JSON.parse(readFileSync(join(root, setPath), 'utf8'))
const outputDirectory = resolve(root, process.argv[3] ?? 'release')
const out = join(outputDirectory, 'implementer-bundle')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const copy = (from, to = from) => { cpSync(join(root, from), join(out, to), { recursive: true }) }
copy('spec')
copy('contracts')
copy('fixtures')
writeFileSync(join(out, 'fixture-catalogue.json'), JSON.stringify(fixtureCatalogue(out), null, 2) + '\n')
for (const f of ['baseline-native-1.json', 'baseline-native-2.json', 'baseline.schema.json', 'manifest.json', 'manifest.schema.json', 'selection.schema.json', 'licences.json']) copy(`conformance/${f}`)
copy('conformance/selections')
copy('conformance/examples')
copy('packages/dpp-profiles/manifests', 'profiles/manifests')
copy('packages/dpp-profiles/schemas', 'profiles/schemas')
copy('packages/dpp-profiles/generated', 'profiles/generated')
copy('packages/dpp-profiles/frozen.json', 'profiles/frozen.json')
copy('packages/dpp-profiles/bindings', 'profiles/bindings')
copy('packages/dpp-profiles/test/fixtures/sector-bindings', 'profiles/bindings')
copy('packages/dpp-credentials/artifacts', 'profiles/vsc-artifacts')
// Carry the complete guide navigation, the archived publication plans and the
// parked plans and fixtures, excluding local review material.
cpSync(join(root, 'docs'), join(out, 'docs'), {
  recursive: true,
  filter: (source) => {
    const path = relative(join(root, 'docs'), source)
    return path !== 'private' && !path.startsWith('private/') &&
      (statSync(source).isDirectory() || source.endsWith('.md') || /^reference\/publication-history\/beta-\d+-publication-plan\.json$/.test(path) || /^reference\/parked\/.+\.json$/.test(path))
  },
})
for (const file of ['GOVERNANCE.md', 'SECURITY.md', 'LICENSE', 'NOTICE', 'PATENTS']) copy(file)
// Preserve the source-relative targets of the normative pages and fixture guide.
copy('packages/dpp-credentials/README.md')
copy('packages/dpp-credentials/LICENSE')
copy('packages/dpp-profiles/schemas/passport-projection.schema.json')
copy(setPath, `release/${setPath.split('/').at(-1)}`)
copy('release/release-set.schema.json', 'release/release-set.schema.json')

// Nothing that is code or a package manifest.
const walk = (dir) => readdirSync(dir).flatMap((name) => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(out).map((p) => relative(out, p)).sort()
const forbidden = files.filter((f) => /(^|\/)(dist|src|test|node_modules)\//.test(f) || /package\.json$/.test(f) || /\.(ts|mjs|js)$/.test(f))
if (forbidden.length > 0) throw new Error(`the bundle would carry code or a package manifest: ${forbidden.join(', ')}`)

// The website pins source links to GitHub. Current implementer guides in the archive use the edition beside them.
// A citation to a particular historical revision keeps its original destination even when the same path exists here.
const historicalSources = new Set(['c678cf9281168179d16d599e5fdb3846ddbbaf61/fixtures/README.md'])
const profileFiles = new Map([['packages/dpp-profiles/frozen.json', 'profiles/frozen.json']])
function guideTarget(guide, target) {
  const pinned = /^https:\/\/github\.com\/bsv-blockchain\/dpp\/(?:blob|tree)\/([a-f0-9]{40})\/([^?#]+)(?:#(.+))?$/.exec(target)
  if (pinned == null) return target
  const [, revision, source, fragment] = pinned
  if (historicalSources.has(`${revision}/${source}`)) return target
  const local = profileFiles.get(source) ?? source
  if (!profileFiles.has(source) && source !== 'GOVERNANCE.md' && !/^(?:spec|contracts|fixtures|conformance)(?:\/|$)/.test(source)) return target
  const path = join(out, local)
  if (!existsSync(path)) return target
  const destination = statSync(path).isDirectory() ? join(path, 'README.md') : path
  if (!existsSync(destination)) return target
  // GitHub line selections describe one revision's presentation, including YAML with no Markdown heading.
  const anchor = fragment && !/^L\d+(?:-L\d+)?$/.test(fragment) ? `#${fragment}` : ''
  return relative(dirname(join(out, guide)), destination).split(sep).join('/') + anchor
}
for (const guide of files.filter(file => file.startsWith('docs/implement/') && file.endsWith('.md'))) {
  const path = join(out, guide)
  const source = readFileSync(path, 'utf8')
  const body = rewriteMarkdownTargets(source, target => guideTarget(guide, target))
  if (body !== source) writeFileSync(path, body)
}

// All local Markdown destinations must resolve within the extracted archive.
const pages = new Map(files.filter((file) => file.endsWith('.md')).map((file) => {
  const body = readFileSync(join(out, file), 'utf8')
  return [file, { targets: markdownTargets(body), headings: markdownHeadings(body) }]
}))
for (const [file, page] of pages) {
  for (const target of page.targets) {
    if (/^(?:https?:|mailto:)/i.test(target)) continue
    const [path, fragment] = target.split('#', 2)
    const destination = path ? resolve(out, dirname(file), decodeURIComponent(path)) : join(out, file)
    const local = relative(out, destination)
    if (isAbsolute(path) || local === '..' || local.startsWith('..' + sep) || !existsSync(destination)) throw new Error(`${file} links to missing or external archive path ${target}`)
    if (fragment && pages.has(local) && !pages.get(local).headings.includes(decodeURIComponent(fragment).toLowerCase())) throw new Error(`${file} links to missing heading ${target}`)
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
  licence: 'Apache License 2.0 (Apache-2.0; LICENSE); third-party artefacts carry their own notices beside them',
  carries: 'specifications, contracts, fixtures in every published form, conformance baselines, ledger, schemas, selections, example capability document, licence record, frozen profile data, sector bindings with their upstream artefacts and acceptance vectors, VSC artefacts, implementer documentation with the parked plans and fixtures; no reference runtime code',
  files: Object.fromEntries(files.map((f) => [f, { sha256: sha256(readFileSync(join(out, f))), bytes: statSync(join(out, f)).size }])),
}
writeFileSync(join(out, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const archive = join(outputDirectory, `dpp-implementer-bundle-${set.releaseSet}.tgz`)
rmSync(archive, { force: true })
// The archive contains only the edition files and its manifest, including on macOS.
execFileSync('tar', ['czf', archive, '-C', outputDirectory, 'implementer-bundle'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
  stdio: 'inherit',
})
const archiveDigest = sha256(readFileSync(archive))
console.log(`bundle: ${files.length} files under ${relative(root, out)}/ for ${set.releaseSet} at ${revision.slice(0, 12)} (${manifest.sourceState}); archive ${relative(root, archive)} sha256 ${archiveDigest}`)

const recordPath = join(outputDirectory, 'candidates.json')
if (existsSync(recordPath)) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  if (record.releaseSet === set.releaseSet) {
    record.implementerBundle = { archive: relative(root, archive), sha256: archiveDigest, files: files.length, assembledAt: manifest.assembledAt, sourceRevision: revision }
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
    console.log('recorded the bundle in release/candidates.json')
  }
}
