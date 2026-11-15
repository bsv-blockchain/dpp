#!/usr/bin/env node
/**
 * Read what is actually inside each built image and each packed npm
 * archive, and hold it to what a release may contain.
 *
 *   node scripts/release-candidates.mjs
 *   node scripts/release-images.mjs build --prefix parity- --tag test
 *   node scripts/image-contents-check.mjs --overlay-image parity-dpp-overlay:test --validator-image parity-dpp-validator:test [--record <file>]
 *
 * For each image it lists every file of the image's file system, the base
 * image's included, by running a reader inside a container with no network.
 * For each archive it lists every file npm would publish. Then, for each:
 *
 *   - LICENSE, NOTICE and PATENTS are there and are this repository's, byte
 *     for byte; the validator image also carries its licence inventory and
 *     the third-party notices its build wrote;
 *   - no file is one of the files GS1 publishes that the packages pin by
 *     digest, which are never redistributed;
 *   - the validator image holds no file of any profile: no binding, context,
 *     shapes file or example document of the bundled bindings or the example
 *     profiles;
 *   - no environment file, no test file or fixture of this repository, and
 *     no private working material;
 *   - no MongoDB server: no server or shell binary anywhere in the image, no
 *     package that downloads one, and no cache of a downloaded one. The
 *     tests of this repository download a MongoDB server to run against; that
 *     package is a development dependency and must stay out of everything
 *     published. The MongoDB driver, which the index uses, is a separate
 *     Apache-2.0 library and is expected in the index image.
 *
 *   - the base system is on record: the image's lowest layers are the
 *     layers of the base image the release set names by digest, every
 *     operating-system package keeps its copyright file, and the Node.js
 *     distribution keeps its licence. The packages, with the licences their
 *     copyright files name, are written to the record, because nothing in a
 *     checkout can list them;
 *   - the index image installs exactly the packages the deployment inventory
 *     lists for @bsv/dpp-overlay, each at the version listed.
 *
 * Files are compared by SHA-256, so a forbidden file is found under any
 * name. It needs Docker and packed candidates, pushes nothing and removes
 * the containers it starts. It pulls the base image when Docker does not
 * hold it, to compare layers. `--record` writes what it read to a file.
 * Results print one sentence per check, never a score. The exit code is 1
 * when anything fails.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCandidates, verifyRecordAgainstSet } from './lib/candidates.mjs'
import { docker, imagesOf, inspectImage } from './lib/images.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1] }
const recordPath = option('--record')
let failures = 0
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); if (!ok) failures += 1; return ok }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] }) : [])
const some = (list, limit = 5) => `${list.slice(0, limit).join(', ')}${list.length > limit ? `, and ${list.length - limit} more` : ''}`

if (!existsSync(join(repo, 'release', 'candidates.json'))) { console.error('There are no packed candidates. Run node scripts/release-candidates.mjs first.'); process.exit(2) }
const record = JSON.parse(readFileSync(join(repo, 'release', 'candidates.json'), 'utf8'))
const setBytes = readFileSync(join(repo, record.releaseSetPath))
const set = JSON.parse(setBytes.toString('utf8'))
const stale = [...verifyRecordAgainstSet(record, set, setBytes), ...verifyCandidates(record, join(repo, 'release', 'candidates'))].filter((f) => !f.ok)
if (stale.length > 0) { console.error(`The packed candidates are not the recorded bytes of this release set:\n${stale.map((f) => `  ${f.sentence}`).join('\n')}\nRun node scripts/release-candidates.mjs again.`); process.exit(2) }
const images = imagesOf(set)
const given = Object.fromEntries(images.own.map((image) => [image.name, option(`--${image.service}-image`)]))
for (const [name, reference] of Object.entries(given)) {
  if (reference == null || inspectImage(reference) == null) { console.error(`Name the built ${name} image, for example --${images.own.find((i) => i.name === name).service}-image parity-${name}:test. Build both with node scripts/release-images.mjs build.`); process.exit(2) }
}

// What must not be inside, by digest. An empty file is nobody's and is left out.
const forbid = (map, paths, label) => { for (const path of paths) { const bytes = readFileSync(path); if (bytes.length > 0) map.set(sha256(bytes), label(path.slice(repo.length + 1))) } }
const gs1 = new Map()
for (const table of ['packages/dpp-profiles/src/gs1-artefacts.ts', 'packages/dpp-credentials/src/gs1-artefacts.ts']) {
  for (const [, digest] of readFileSync(join(repo, table), 'utf8').matchAll(/sha256: '([0-9a-f]{64})'/g)) gs1.set(digest, `a GS1 file pinned in ${table}`)
}
const profileFiles = new Map()
forbid(profileFiles, [...walk(join(repo, 'packages', 'dpp-profiles', 'bindings')), ...walk(join(repo, 'examples', 'custom-profile')), ...walk(join(repo, 'packages', 'dpp-profiles', 'test', 'fixtures'))], (path) => path)
const testFiles = new Map()
forbid(testFiles, [...walk(join(repo, 'fixtures')), ...readdirSync(join(repo, 'packages')).flatMap((name) => walk(join(repo, 'packages', name, 'test'))), ...walk(join(repo, 'conformance', 'test'))], (path) => path)
// A file the packages publish on purpose is not a test file because a test also reads a copy of it.
for (const published of ['LICENSE', 'NOTICE', 'PATENTS', ...walk(join(repo, 'contracts')).map((p) => p.slice(repo.length + 1)), ...walk(join(repo, 'packages', 'dpp-profiles', 'bindings')).map((p) => p.slice(repo.length + 1))]) {
  const digest = sha256(readFileSync(join(repo, published)))
  testFiles.delete(digest)
}
const ownLicences = Object.fromEntries(['LICENSE', 'NOTICE', 'PATENTS'].map((name) => [name, sha256(readFileSync(join(repo, name)))]))

/** The names a MongoDB server, its shell or its tools are installed under, and the package and cache that fetch one for the tests. */
const SERVER_BINARY = /^(mongod|mongos|mongosh|mongo|mongodump|mongorestore|mongoexport|mongoimport|mongostat|mongotop)(\.exe)?$/
const SERVER_FETCHER = /(^|\/)(mongodb-memory-server[^/]*|mongodb-binaries)(\/|$)|(^|\/)mongod-[^/]*$/
const ENVIRONMENT_FILE = /^\.env(\.(?!example$|sample$|template$)[^/]*)?$/
const PRIVATE = /(^|\/)(planning|brc|\.private|notes)(\/|$)|(^|\/)AGENTS\.md$|(^|\/)docs\/private(\/|$)/

/** Hold one listing to the rules. `files` is `[{ path, sha256 }]` with paths relative to `scope`; `own` says which paths are this repository's part and not an installed dependency or the base system. */
function hold(label, files, { own, profiles }) {
  const base = (path) => path.slice(path.lastIndexOf('/') + 1)
  const byDigest = (map) => files.filter((f) => map.has(f.sha256)).map((f) => `${f.path} (${map.get(f.sha256)})`)
  const gs1Found = byDigest(gs1)
  say(gs1Found.length === 0, `${label}: none of its ${files.length} files is one of the ${gs1.size} files GS1 publishes that the packages pin${gs1Found.length === 0 ? '' : `: ${some(gs1Found)}`}.`)
  const profileFound = byDigest(profileFiles)
  if (profiles === 'none') say(profileFound.length === 0, `${label}: it holds no file of any profile, bundled or example, of the ${profileFiles.size} this checkout has${profileFound.length === 0 ? '' : `: ${some(profileFound)}`}.`)
  const environment = files.filter((f) => ENVIRONMENT_FILE.test(base(f.path))).map((f) => f.path)
  say(environment.length === 0, `${label}: it holds no environment file${environment.length === 0 ? '' : `: ${some(environment)}`}.`)
  const tests = [...byDigest(testFiles), ...files.filter((f) => own(f.path) && /(^|\/)(test|tests|__tests__|fixtures)\/|\.test\.[cm]?[jt]s$/.test(f.path)).map((f) => f.path)]
  say(tests.length === 0, `${label}: it holds no test file or fixture of this repository, by name or by any of ${testFiles.size} digests${tests.length === 0 ? '' : `: ${some([...new Set(tests)])}`}.`)
  const server = files.filter((f) => SERVER_BINARY.test(base(f.path)) || SERVER_FETCHER.test(f.path)).map((f) => f.path)
  say(server.length === 0, `${label}: it holds no MongoDB server, shell or tool, no package that downloads one and no cache of one${server.length === 0 ? '' : `: ${some(server)}`}.`)
  const secret = files.filter((f) => PRIVATE.test(f.path) && own(f.path)).map((f) => f.path)
  say(secret.length === 0, `${label}: it holds no private working material${secret.length === 0 ? '' : `: ${some(secret)}`}.`)
  return { files: files.length, gs1: gs1Found.length, profileFiles: profileFound.length, environmentFiles: environment.length, testFiles: tests.length, mongoServerFiles: server.length, privateFiles: secret.length }
}

const recorded = { images: {}, archives: {} }

// ---------------------------------------------------------------- the images

const reader = `
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const skip = new Set(['/proc', '/sys', '/dev'])
const out = []
let bytes = 0
const walk = (dir) => {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (skip.has(full)) continue
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) { const data = fs.readFileSync(full); bytes += data.length; out.push({ path: full, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length }) }
    else if (entry.isSymbolicLink()) out.push({ path: full, sha256: 'link', size: 0 })
  }
}
walk('/')
const root = process.argv[1]
let installed = {}
try { installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.package-lock.json'), 'utf8')).packages } catch {}
// A workspace's own node_modules holds a package too, when the version it needs is not the one hoisted.
const packages = Object.entries(installed).filter(([dir, entry]) => entry.link !== true && dir.includes('node_modules/')).map(([dir, entry]) => {
  let names = []
  try { names = fs.readdirSync(path.join(root, dir)) } catch {}
  return { dir, version: entry.version, licence: entry.license, hasLicenceFile: names.some((name) => /^(licen[cs]e|copying|notice)/i.test(name)) }
})
const text = (file) => { try { return fs.readFileSync(file, 'utf8') } catch { return undefined } }
const system = []
for (const block of (text('/var/lib/dpkg/status') || '').split('\\n\\n')) {
  const field = (name) => (block.match(new RegExp('^' + name + ': (.*)$', 'm')) || [])[1]
  if (field('Package') == null || !/ installed$/.test(field('Status') || '')) continue
  const copyright = text('/usr/share/doc/' + field('Package') + '/copyright')
  system.push({ name: field('Package'), version: field('Version'), source: (field('Source') || field('Package')).split(' ')[0], hasCopyright: copyright != null, licences: [...new Set([...(copyright || '').matchAll(/^License: (.+)$/gm)].map((m) => m[1].trim()))].sort() })
}
const versionOf = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).version } catch { return undefined } }
let yarn
try { yarn = versionOf(path.join('/opt', fs.readdirSync('/opt').find((name) => name.startsWith('yarn')), 'package.json')) } catch {}
const nodeLicence = out.find((f) => f.path === '/usr/local/LICENSE')
const base = {
  os: ((text('/etc/os-release') || '').match(/^PRETTY_NAME="?([^"\\n]*)"?$/m) || [])[1],
  packages: system,
  node: { version: process.version, licenceFile: nodeLicence ? '/usr/local/LICENSE' : null, licenceSha256: nodeLicence ? nodeLicence.sha256 : null, npm: versionOf('/usr/local/lib/node_modules/npm/package.json'), corepack: versionOf('/usr/local/lib/node_modules/corepack/package.json'), yarn },
}
console.log(JSON.stringify({ files: out, bytes, packages, base }))`

/** The layers of a local image, lowest first, or undefined when Docker does not hold it. */
const layersOf = (reference) => { const read = docker(['image', 'inspect', '--format', '{{json .RootFS.Layers}}', reference]); return read.status === 0 ? JSON.parse(read.stdout.trim()) : undefined }
const inventoryPath = join(repo, 'conformance', 'deployment-inventory.json')
const inventory = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : undefined

for (const image of images.own) {
  const reference = given[image.name]
  const inspected = inspectImage(reference)
  const root = inspected.config.WorkingDir
  console.log(`\nThe ${image.name} image, ${reference}`)
  // As root and with no network, so that every file is read and nothing is fetched.
  const read = docker(['run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'node', reference, '-e', reader, root])
  if (read.status !== 0) { say(false, `${image.name}: the image could not be read: ${read.stderr.trim().split('\n').at(-1)}.`); continue }
  const listing = JSON.parse(read.stdout.trim().split('\n').at(-1))
  const files = listing.files
  const at = (name) => files.find((f) => f.path === `${root}/${name}`)
  const own = (path) => path.startsWith(`${root}/`) && !path.includes('/node_modules/')
  const ownFiles = files.filter((f) => own(f.path))
  say(['LICENSE', 'NOTICE', 'PATENTS'].every((name) => at(name)?.sha256 === ownLicences[name]), `${image.name}: ${root}/LICENSE, NOTICE and PATENTS are there and are this repository's, byte for byte.`)
  if (image.service === 'validator') {
    const inventory = at('licence-inventory.json')
    const notices = at('THIRD-PARTY-NOTICES.txt')
    say(inventory?.sha256 === sha256(readFileSync(join(repo, dirname(image.dockerfile), 'licence-inventory.json'))) && (notices?.size ?? 0) > 100_000, `${image.name}: it carries its licence inventory, byte for byte, and the third-party notices its build wrote, ${notices?.size ?? 0} bytes.`)
  }
  const result = hold(image.name, files, { own, profiles: 'none' })
  const withLicence = listing.packages.filter((p) => p.hasLicenceFile).length
  const without = listing.packages.filter((p) => !p.hasLicenceFile)
  const driver = listing.packages.find((p) => p.dir === 'node_modules/mongodb')
  if (image.service === 'overlay') say(driver != null && driver.licence === 'Apache-2.0', `${image.name}: the one MongoDB software in it is the driver library, mongodb@${driver?.version} under ${driver?.licence}, which the index uses to reach a database that runs elsewhere.`)
  else say(driver == null, `${image.name}: it holds no MongoDB software at all, the driver included.`)
  console.log(`Measured: ${image.name} holds ${files.length} files, ${(listing.bytes / 1_000_000).toFixed(1)} MB, of which ${ownFiles.length} are under ${root} outside node_modules; ${listing.packages.length} installed packages, ${withLicence} with a licence or notice file of their own in place${without.length === 0 ? '' : ` and ${without.length} without one (${some(without.map((p) => `${p.dir.slice('node_modules/'.length)}@${p.version}, ${p.licence}`), 8)})`}.`)
  // The base system, which no file of a checkout lists.
  const base = listing.base
  const layers = layersOf(reference) ?? []
  const baseReference = image.runtime.baseImage
  const pinned = /@sha256:[0-9a-f]{64}$/.test(baseReference)
  // A build takes the base image's layers without leaving the image itself behind, so it is fetched here to be compared.
  if (pinned && layersOf(baseReference) == null) docker(['pull', '-q', baseReference])
  const baseLayers = pinned ? layersOf(baseReference) : undefined
  say(pinned && baseLayers != null && baseLayers.length > 0 && baseLayers.every((layer, at) => layers[at] === layer), `${image.name}: its lowest ${baseLayers?.length ?? 0} layers are the layers of ${baseReference}, the base image the release set names by digest${!pinned ? ', but the release set names it by tag only' : baseLayers == null ? ', but Docker does not hold that base image to compare' : ''}.`)
  const uncredited = base.packages.filter((p) => !p.hasCopyright).map((p) => p.name)
  say(base.packages.length > 0 && uncredited.length === 0, `${image.name}: each of the ${base.packages.length} operating-system packages of ${base.os} keeps its copyright file under /usr/share/doc${uncredited.length === 0 ? '' : `, except ${some(uncredited)}`}.`)
  say(base.node.licenceFile != null && base.node.version === `v${image.runtime.node}`, `${image.name}: the Node.js distribution, ${base.node.version}, keeps its licence at /usr/local/LICENSE.`)
  const installed = listing.packages.map((p) => ({ name: p.dir.slice(p.dir.lastIndexOf('node_modules/') + 'node_modules/'.length), version: p.version, licence: p.licence })).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
  let beyond = []
  if (image.service === 'overlay') {
    // The image installs three workspaces: the index and the two packages it is built from.
    const closureOf = (name) => (inventory?.npmPackages.find((p) => p.name === name)?.installs.packages ?? []).filter((p) => p.own !== true).map((p) => `${p.name}@${p.version}`)
    const needed = [...new Set(['@bsv/dpp-overlay', '@bsv/dpp-protocol', '@bsv/dpp-profiles'].flatMap(closureOf))]
    const recorded = new Set((inventory?.npmPackages ?? []).flatMap((p) => closureOf(p.name)))
    const found = [...new Set(installed.map((p) => `${p.name}@${p.version}`))]
    const absent = needed.filter((id) => !found.includes(id))
    const unrecorded = found.filter((id) => !recorded.has(id))
    beyond = found.filter((id) => !needed.includes(id))
    say(inventory != null && absent.length === 0, `${image.name}: it installs each of the ${needed.length} third-party packages conformance/deployment-inventory.json lists for the index and the two packages it is built from, at the version listed${absent.length === 0 ? '' : `; listed and not installed: ${some(absent)}`}.`)
    say(inventory != null && unrecorded.length === 0, `${image.name}: every package it installs is in that inventory with its licence and disposition${unrecorded.length === 0 ? '' : `; not recorded: ${some(unrecorded)}`}.`)
    if (beyond.length > 0) console.log(`Measured: ${image.name} also installs ${beyond.length} packages the index does not use, which another package of the repository declares and the image's install does not leave out: ${some(beyond, 12)}.`)
  }
  recorded.images[image.name] = {
    reference, id: inspected.id, platform: `${inspected.os}/${inspected.architecture}`, root, ...result, bytes: listing.bytes, ownFiles: ownFiles.length,
    installedPackages: listing.packages.length, packagesWithLicenceFile: withLicence, packagesWithoutLicenceFile: without.map((p) => ({ name: p.dir.slice('node_modules/'.length), version: p.version, licence: p.licence })),
    mongodbDriver: driver == null ? null : `${driver.version} (${driver.licence})`,
    top: [...new Set(ownFiles.map((f) => f.path.slice(root.length + 1).split('/').slice(0, 3).join('/')))].sort(),
    baseImage: baseReference, layers: layers.length, baseLayers: baseLayers?.length ?? null,
    baseSystem: { os: base.os, node: base.node, packageCount: base.packages.length, packages: base.packages.map(({ hasCopyright, ...rest }) => rest) },
    ...(image.service === 'overlay' ? { packages: installed, installedAndNotUsed: beyond } : {}),
  }
}

// ---------------------------------------------------------------- the archives

const scratch = mkdtempSync(join(tmpdir(), 'dpp-contents-'))
try {
  for (const candidate of record.candidates) {
    console.log(`\nThe archive of ${candidate.name}@${candidate.version}, ${candidate.filename}`)
    const dir = join(scratch, candidate.filename.replace(/\.tgz$/, ''))
    mkdirSync(dir)
    execFileSync('tar', ['xzf', join(repo, 'release', 'candidates', candidate.filename), '-C', dir])
    const files = walk(dir).map((path) => ({ path: path.slice(dir.length + 1), sha256: sha256(readFileSync(path)), size: statSync(path).size }))
    const at = (name) => files.find((f) => f.path === `package/${name}`)
    // A package's licence file is the one in its own directory, which is the licence text under a copyright line.
    const directory = set.packages.find((p) => p.name === candidate.name).directory
    const packageLicence = sha256(readFileSync(join(repo, directory, 'LICENSE')))
    const missing = ['LICENSE', 'NOTICE', 'PATENTS'].filter((name) => at(name) == null)
    say(missing.length === 0 && at('LICENSE').sha256 === packageLicence && at('NOTICE').sha256 === ownLicences.NOTICE && at('PATENTS').sha256 === ownLicences.PATENTS, `${candidate.name}: the archive carries the package's LICENSE and the repository's NOTICE and PATENTS, byte for byte${missing.length === 0 ? '' : `, but it lacks ${missing.join(' and ')}`}.`)
    // The profiles package publishes its bundled bindings on purpose, each with a notice beside it; no other archive holds a profile file.
    const carriesBindings = candidate.name === '@bsv/dpp-profiles'
    const result = hold(candidate.name, files, { own: () => true, profiles: carriesBindings ? 'bundled' : 'none' })
    if (carriesBindings) {
      const bindings = [...new Set(files.filter((f) => f.path.startsWith('package/bindings/')).map((f) => f.path.split('/')[2]))]
      const noticed = bindings.filter((name) => files.some((f) => f.path === `package/bindings/${name}/NOTICE.md`))
      const strays = files.filter((f) => profileFiles.has(f.sha256) && !f.path.startsWith('package/bindings/')).map((f) => f.path)
      say(bindings.length > 0 && noticed.length === bindings.length && strays.length === 0, `${candidate.name}: it publishes ${bindings.length} bundled bindings, ${bindings.join(' and ')}, each with the notice that names its source and licence, and no example profile or vector outside them.`)
      result.bundledBindings = bindings
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf8'))
    const shipped = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }
    const fetchers = Object.keys(shipped).filter((name) => /mongodb-memory-server/.test(name))
    const hooks = ['preinstall', 'install', 'postinstall'].filter((name) => manifest.scripts?.[name] != null)
    say(fetchers.length === 0 && (manifest.bundleDependencies ?? manifest.bundledDependencies ?? []).length === 0 && hooks.length === 0, `${candidate.name}: installing it runs no script and brings no package that downloads a MongoDB server; the one the tests use is a development dependency and stays in this repository${fetchers.length + hooks.length === 0 ? '' : `: ${[...fetchers, ...hooks].join(', ')}`}.`)
    console.log(`Measured: the archive holds ${files.length} files, ${files.reduce((sum, f) => sum + f.size, 0)} bytes unpacked.`)
    recorded.archives[candidate.name] = { version: candidate.version, filename: candidate.filename, sha256: candidate.sha256, ...result, dependencies: Object.keys(shipped).sort() }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// The server is named by the preset and by nothing that is built or packed here.
console.log('\nWhere MongoDB is named')
const mongo = images.thirdParty.find((entry) => /mongo/.test(entry.name))
for (const image of images.own) {
  const dockerfile = readFileSync(join(repo, image.dockerfile), 'utf8')
  say(!/mongo/i.test(dockerfile.replace(/^\s*#.*$/gm, '')), `${image.dockerfile} names no MongoDB image and installs no MongoDB software by name.`)
}
say(mongo != null && /^sha256:[0-9a-f]{64}$/.test(mongo.digest), `the one MongoDB server in a deployment is the image the preset names, ${mongo?.repository}:${mongo?.tag} at ${mongo?.digest}, which Docker pulls from its publisher (${mongo?.licence}).`)

if (recordPath != null) {
  mkdirSync(dirname(resolve(recordPath)), { recursive: true })
  writeFileSync(resolve(recordPath), JSON.stringify({
    check: 'scripts/image-contents-check.mjs',
    recordedAt: new Date().toLocaleDateString('en-CA'),
    docker: docker(['version', '--format', '{{.Server.Version}}']).stdout.trim(),
    releaseSet: set.releaseSet,
    sourceRevision: record.sourceRevision,
    sourceState: record.sourceState,
    failures,
    forbidden: { gs1Digests: gs1.size, profileFileDigests: profileFiles.size, testFileDigests: testFiles.size },
    ...recorded,
    mongodb: mongo == null ? null : { image: `${mongo.repository}:${mongo.tag}`, digest: mongo.digest, licence: mongo.licence, resolvedAt: mongo.resolvedAt },
  }, null, 2) + '\n')
  console.log(`Wrote ${recordPath}.`)
}
process.exit(failures === 0 ? 0 : 1)
