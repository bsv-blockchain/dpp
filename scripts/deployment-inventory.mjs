#!/usr/bin/env node
/**
 * Writes conformance/deployment-inventory.json: everything a deployment of
 * the current release set is made of, with the terms each part is under and
 * what was decided about it.
 *
 *   node scripts/deployment-inventory.mjs            write the inventory
 *   node scripts/deployment-inventory.mjs --check    exit 1 when the file on disk is not what would be written
 *   node scripts/deployment-inventory.mjs --release  as --check, and exit 1 while any disposition is open
 *
 * It reads only files of this checkout, so it runs without installing or
 * building anything, and a test holds the file to its sources:
 *
 *   - package-lock.json, for every package each published npm package
 *     installs, direct and transitive, with version, integrity and licence;
 *   - the starter template's manifests, for what a generated application
 *     declares;
 *   - the bundled bindings, the retained credential artefacts and the tables
 *     of GS1 files, for third-party files that are copied or only named;
 *   - the release set, for the images and the services of the presets.
 *
 * What is inside a built image (its layers, the base system's packages, the
 * runtime) cannot be read from a checkout. scripts/image-contents-check.mjs
 * reads it from the images themselves and records it in
 * deploy/evidence/image-contents.json, which this file points at.
 *
 * A licence outside REVIEWED stops the script, and so does a package that
 * names a licence file instead of a licence unless SEPARATE_TERMS records
 * what that file says at that version. Adding to either list is a review of
 * those terms, and the edit to this file is its record. DISPOSITIONS is the decision taken on
 * each part. An open one blocks a release: a release set whose status is
 * not `candidate` must pass --release.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --root <dir> reads another checkout, which the test uses to show what the script refuses.
const rootAt = process.argv.indexOf('--root')
const root = rootAt === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootAt + 1]
const read = (path) => readFileSync(join(root, path))
const json = (path) => JSON.parse(read(path).toString('utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const byName = (a, b) => a.name.localeCompare(b.name, 'en') || String(a.version).localeCompare(String(b.version), 'en')

const releaseSetPath = `release/${readdirSync(join(root, 'release')).filter((name) => /^dpp-release-.*\.json$/.test(name)).sort().at(-1)}`
const set = json(releaseSetPath)
const lockBytes = read('package-lock.json')
const lock = JSON.parse(lockBytes.toString('utf8')).packages

/** Licences reviewed for use beside Apache-2.0 code. Every one is permissive: none asks for the source of anything else. */
const REVIEWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '(MIT OR CC0-1.0)']

/**
 * Packages whose manifest points at a licence file instead of naming a
 * licence. Each file was read in the archive at the version named; `opens`
 * is how that file begins, which a test holds to the installed copy, so a
 * new version is read again before it is recorded.
 */
const W3C_AND_BSD = 'BSD-3-Clause for the package, and the W3C Software and Document License for the context files it carries'
const SEPARATE_TERMS = {
  '@bsv/sdk@2.8.10': { licence: 'Open BSV License Version 6', file: 'LICENSE.txt', opens: 'Open BSV License Version 6', disposition: 'bsv-packages' },
  '@bsv/overlay@2.3.1': { licence: 'Open BSV License Version 6', file: 'LICENSE.txt', opens: 'Open BSV License Version 6', disposition: 'bsv-packages' },
  '@bsv/gasp@1.3.6': { licence: 'Open BSV License Version 6', file: 'LICENSE.txt', opens: 'Open BSV License Version 6', disposition: 'bsv-packages' },
  '@bsv/wallet-toolbox-client@2.11.0': { licence: 'Open BSV License Version 6', file: 'LICENSE.txt', opens: 'Open BSV License Version 6', disposition: 'bsv-packages' },
  '@digitalbazaar/credentials-context@3.2.0': { licence: W3C_AND_BSD, file: 'LICENSE.md', opens: 'Context data files in this repository are from the [vc-data-model][] spec', disposition: 'npm-permissive' },
  'did-context@3.1.1': { licence: W3C_AND_BSD, file: 'LICENSE.md', opens: 'Context data files in this repository are from the [did-spec][]', disposition: 'npm-permissive' },
}

// ------------------------------------------------- what each npm package installs

/** Where the lockfile says `name` resolves for the package at `from`, the way Node looks it up. */
function resolve(from, name) {
  for (let base = from; ; ) {
    const candidate = `${base === '' ? '' : `${base}/`}node_modules/${name}`
    if (lock[candidate] != null) return lock[candidate].link === true ? lock[candidate].resolved : candidate
    if (base === '') return null
    const at = base.lastIndexOf('/node_modules/')
    base = at === -1 ? '' : base.slice(0, at)
  }
}

const nameOf = (path) => lock[path].name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)

function termsOf(name, entry) {
  const separate = SEPARATE_TERMS[`${name}@${entry.version}`]
  if (separate != null) return { licence: separate.licence, licenceFile: separate.file, licenceFileOpens: separate.opens, disposition: separate.disposition }
  if (entry.license == null || /^SEE LICEN[CS]E/i.test(entry.license)) throw new Error(`${name}@${entry.version} names no licence in the lockfile (${entry.license ?? 'nothing stated'}) and is not in SEPARATE_TERMS at this version. Read the licence file in its archive and record what it states.`)
  if (!REVIEWED.includes(entry.license)) throw new Error(`${name}@${entry.version} is under ${entry.license}, which is not among the licences reviewed (${REVIEWED.join(', ')}). Review it and add it.`)
  return { licence: entry.license, disposition: 'npm-permissive' }
}

/** Every package the workspace at `start` installs for use: its dependencies and optional dependencies and theirs, never a development dependency. */
function closure(start) {
  const seen = new Map()
  const queue = [{ path: start, direct: true, optionalEdge: false, top: true }]
  while (queue.length > 0) {
    const { path, direct, optionalEdge, top } = queue.shift()
    const entry = lock[path]
    if (!top) {
      const known = seen.get(path)
      if (known != null) { known.direct ||= direct; known.optional &&= optionalEdge; continue }
      seen.set(path, { path, direct, optional: optionalEdge })
    }
    const requiredPeers = Object.keys(entry.peerDependencies ?? {}).filter((name) => entry.peerDependenciesMeta?.[name]?.optional !== true)
    const edges = [
      ...Object.keys(entry.dependencies ?? {}).map((name) => ({ name, optional: false })),
      ...requiredPeers.map((name) => ({ name, optional: false })),
      ...Object.keys(entry.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
    ]
    for (const edge of edges) {
      const to = resolve(path, edge.name)
      // An optional dependency for another platform is in no lockfile entry this install made; it is not installed.
      if (to == null) { if (edge.optional) continue; throw new Error(`${edge.name}, needed by ${path}, is not in package-lock.json.`) }
      queue.push({ path: to, direct: top, optionalEdge: optionalEdge || edge.optional, top: false })
    }
  }
  return [...seen.values()].map(({ path, direct, optional }) => {
    const entry = lock[path]
    const name = nameOf(path)
    const own = !path.includes('node_modules/')
    return {
      name, version: entry.version, relation: direct ? 'direct' : 'transitive', ...(optional ? { optional: true } : {}),
      ...(own ? { licence: entry.license, own: true, disposition: 'own-code' } : { ...termsOf(name, entry), integrity: entry.integrity }),
    }
  }).sort(byName)
}

const tally = (list, key) => {
  const counts = {}
  for (const item of list) counts[item[key]] = (counts[item[key]] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')))
}

const npmPackages = set.packages.map((p) => {
  const packages = closure(p.directory)
  return { name: p.name, version: p.version, licence: 'Apache-2.0', notices: ['LICENSE', 'NOTICE', 'PATENTS'], carries: p.carries, installs: { packageCount: packages.length, licences: tally(packages, 'licence'), packages } }
})

// ------------------------------------------------- the generated application

const template = 'packages/create-dpp-app/template'
const declared = (path) => {
  const manifest = json(path)
  return { manifest: path, licence: manifest.license ?? null, dependencies: Object.entries(manifest.dependencies ?? {}).map(([name, range]) => ({ name, range })).sort(byName) }
}
const starter = {
  package: '@bsv/create-dpp-app',
  note: 'The starter package has no dependency of its own. The application it generates declares the dependencies below and resolves them at its own install, so their transitive closure is not fixed by this repository. The starter check installs a generated application and records every package that install brought, with its licence, in the evidence file named here.',
  manifests: [`${template}/package.json`, `${template}/apps/api/package.json`, `${template}/apps/web/package.json`].filter((path) => existsSync(join(root, path))).map(declared),
  installedRecord: 'deploy/evidence/starter-dependencies.json',
  hostedDefaults: [...new Set([...read(`${template}/_env.example`).toString('utf8').matchAll(/^[A-Z_]+=(https:\/\/[^\s#]+)/gm)].map((m) => m[1]))].sort(),
  disposition: 'starter-application',
}

// ------------------------------------------------- third-party files, copied or only named

const bindingsDir = 'packages/dpp-profiles/bindings'
const copied = []
for (const name of readdirSync(join(root, bindingsDir)).sort()) {
  const bindingPath = `${bindingsDir}/${name}/binding.json`
  if (!existsSync(join(root, bindingPath))) continue
  const binding = json(bindingPath)
  for (const artefact of binding.artefacts) {
    const path = `${bindingsDir}/${name}/${artefact.path}`
    const bytes = read(path)
    if (sha256(bytes) !== artefact.sha256) throw new Error(`${path} is not the bytes its binding records.`)
    copied.push({ path, sha256: artefact.sha256, bytes: bytes.length, role: artefact.role, origin: `${binding.source.repository} at ${binding.source.revision} (release ${binding.source.release})`, address: artefact.uri ?? null, licence: artefact.licence ?? binding.source.licence, modified: false, notice: `${bindingsDir}/${name}/NOTICE.md`, distribution: 'In the @bsv/dpp-profiles archive. In neither image.', disposition: 'bundled-bindings' })
  }
}
const w3cDir = 'packages/dpp-credentials/artifacts/w3c'
for (const name of readdirSync(join(root, w3cDir)).sort()) {
  if (!/\.jsonld$/.test(name)) continue
  const bytes = read(`${w3cDir}/${name}`)
  copied.push({ path: `${w3cDir}/${name}`, sha256: sha256(bytes), bytes: bytes.length, role: 'context', origin: 'World Wide Web Consortium', address: null, licence: 'W3C Software and Document License', modified: false, notice: `${w3cDir}/NOTICE.md`, distribution: 'In the @bsv/dpp-credentials archive. In neither image.', disposition: 'w3c-context' })
}

const named = []
for (const table of ['packages/dpp-credentials/src/gs1-artefacts.ts', 'packages/dpp-profiles/src/gs1-artefacts.ts']) {
  for (const [, uri, digest, length] of read(table).toString('utf8').matchAll(/uri: '([^']+)', sha256: '([0-9a-f]{64})', byteLength: (\d+)/g)) {
    if (!named.some((n) => n.sha256 === digest)) named.push({ address: uri, sha256: digest, bytes: Number(length), pinnedIn: table, origin: 'GS1', licence: 'GS1\'s own terms, which this repository does not reproduce', distribution: 'Never carried in the repository, a package or an image. Each deployment obtains the file from GS1 and the package checks every byte against this digest.', disposition: 'gs1-files' })
  }
}

// ------------------------------------------------- images and services

const validatorInventoryPath = 'packages/dpp-profiles/validator-image/licence-inventory.json'
const validatorInventory = json(validatorInventoryPath)
const images = set.images.own.map((image) => ({
  name: image.name, package: image.package, dockerfile: image.dockerfile, baseImage: image.runtime.baseImage, node: image.runtime.node, platforms: image.platforms, digest: image.digest,
  ownFiles: { licence: 'Apache-2.0', notices: ['LICENSE', 'NOTICE', 'PATENTS'] },
  npmPackages: image.service === 'validator'
    ? { inventory: validatorInventoryPath, sha256: sha256(read(validatorInventoryPath)), packageCount: validatorInventory.packageCount, licences: validatorInventory.licences, notices: '/app/THIRD-PARTY-NOTICES.txt in the image', disposition: 'validator-engines' }
    : { inventory: `the installs of ${image.package} above, development dependencies left out`, notices: 'the licence file each package publishes, in place under node_modules' },
  baseSystem: { record: 'deploy/evidence/image-contents.json', note: 'The base image\'s layers, its operating-system packages with the licences their copyright files name, and the Node.js distribution, read from the built image.', disposition: 'base-images' },
  dispositions: ['own-code', image.service === 'validator' ? 'validator-engines' : 'npm-permissive', ...(image.service === 'overlay' ? ['bsv-packages'] : []), 'base-images', 'image-digests'],
}))
const services = set.images.thirdParty.map((entry) => ({ name: entry.name, image: `${entry.repository}:${entry.tag}`, digest: entry.digest, resolvedAt: entry.resolvedAt, licence: entry.licence, distribution: entry.distribution, presets: ['deploy/compose.yml', 'deploy/compose.second-operator.yml', `${template}/deploy/compose.yml`].filter((path) => existsSync(join(root, path))), disposition: 'mongodb' }))

// ------------------------------------------------- what was decided

/**
 * `held`: the terms are met by what the release does. `conditional`: met
 * while the stated conditions hold, which a deployment or a publication must
 * keep. `open`: not decided, or waiting on someone; it blocks a release.
 */
const w3cNotice = read(`${w3cDir}/NOTICE.md`).toString('utf8')
const w3cFullText = /THIS WORK IS PROVIDED "AS IS"/i.test(w3cNotice)
const imagesPublished = set.images.own.every((image) => /^sha256:[0-9a-f]{64}$/.test(image.digest))
const basePinned = set.images.own.every((image) => /@sha256:[0-9a-f]{64}$/.test(image.runtime.baseImage))
const DISPOSITIONS = [
  { id: 'own-code', subject: 'This repository\'s code, specifications, schemas and documentation, in every archive and both images', status: 'held', basis: 'Apache-2.0. LICENSE, NOTICE and PATENTS ship in each npm archive and each image, checked byte for byte by scripts/image-contents-check.mjs.' },
  { id: 'npm-permissive', subject: 'Third-party npm packages under permissive licences', status: 'held', basis: 'Every package an npm package of this set installs is listed above with its licence. Each licence is in the reviewed list of scripts/deployment-inventory.mjs, which stops on any other. Two context packages name a licence file: BSD-3-Clause for the package and the W3C Software and Document License for the context files inside it. Each package publishes its own licence file, which npm installs in place.' },
  { id: 'bsv-packages', subject: '@bsv/sdk, @bsv/overlay, @bsv/gasp and @bsv/wallet-toolbox-client at the pinned versions', status: 'open', basis: 'The archives of these versions carry the Open BSV License Version 6, which among other conditions limits use to the BSV blockchains it defines. It is not Apache-2.0. The index image installs them and every install of @bsv/dpp-overlay brings them.', waitsOn: 'Versions of these packages published under Apache-2.0 and adopted here after compatibility tests, or a recorded grant covering the pinned versions.' },
  { id: 'validator-engines', subject: 'The three engine libraries of the validator image and what they install', status: 'held', basis: `${validatorInventory.packageCount} packages, all permissive, listed in ${validatorInventoryPath}, which stops on any other licence. The image carries the text of every licence and notice file those packages publish. Some publish none; for those the inventory records what the manifest states.` },
  { id: 'bundled-bindings', subject: 'The contexts, shapes and ontology files of the bundled bindings', status: 'held', basis: 'Apache-2.0, unmodified, each held to its SHA-256 by its binding. The NOTICE.md beside each binding names the source, its revision and every file, and reproduces the one notice a file carries.' },
  { id: 'w3c-context', subject: 'The W3C credentials context retained in @bsv/dpp-credentials', status: w3cFullText ? 'held' : 'open', basis: w3cFullText ? 'Unmodified, with the full W3C Software and Document License text beside it.' : 'Unmodified. The notice beside it names the licence and does not yet reproduce its full text, which that licence asks for on every copy.', ...(w3cFullText ? {} : { waitsOn: 'The full licence text beside the file.' }) },
  { id: 'gs1-files', subject: 'GS1\'s EPCIS and resolver schemas and contexts', status: 'held', basis: 'Not redistributed. The packages name each file by address and SHA-256, and scripts/image-contents-check.mjs holds that no archive or image contains one.' },
  { id: 'mongodb', subject: 'MongoDB Community Server in the presets', status: 'conditional', basis: 'Server Side Public License, version 1. A separate program reached over the network through the Apache-2.0 driver.', conditions: ['No image, package, bundle or mirror of this repository contains the server.', 'The presets name the publisher\'s image by tag and digest.', 'The documentation states its licence and never describes a deployment as a whole as Apache-2.0.', 'An operator reads the SSPL for its own use; offering MongoDB\'s functionality to third parties as a service, or redistributing it, is the operator\'s own obligation.', 'MONGO_URL points the index at any other compatible database.'] },
  { id: 'base-images', subject: 'The base image of both images: Debian and the Node.js distribution', status: basePinned ? 'conditional' : 'open', basis: 'Published unmodified as the lower layers of each image, under their own licences, some of which are copyleft (the GNU GPL and LGPL among them). Every package\'s copyright file stays in the image under /usr/share/doc and Node.js\'s licence stays at /usr/local/LICENSE.', conditions: ['The Dockerfiles name the base image by digest, so the packages recorded are the packages shipped.', 'Nothing in the base layers is modified, so the corresponding source is the source Debian and the Node.js project publish for those versions.'], ...(basePinned ? {} : { waitsOn: 'The base image named by digest in both Dockerfiles.' }) },
  { id: 'image-digests', subject: 'The digests of the two published images', status: imagesPublished ? 'held' : 'open', basis: imagesPublished ? 'Both images are published and the release set records their digests.' : 'Neither image is published, so the release set records no digest and the pinned preset cannot start.', ...(imagesPublished ? {} : { waitsOn: 'Publication of both images and the pin that records their digests.' }) },
  { id: 'starter-application', subject: 'The application the starter generates', status: 'conditional', basis: 'Its dependencies are declared in the template and resolved at its own install. The record of one such install lists each package with its licence.', conditions: ['It installs @bsv packages that carry the Open BSV License Version 6 (see bsv-packages), @bsv/wallet-toolbox among them.', 'The tool chain that builds its web client installs lightningcss under MPL-2.0, a copyleft that applies file by file to changes made to lightningcss itself; the application does not change it.', 'Its defaults name hosted services that are offered for demonstration with no stated terms of service; a deployment replaces them with its own.', 'A generated application is its author\'s own project and takes its own licence decision.'] },
  { id: 'consumer-installs', subject: 'What a consumer\'s own install resolves', status: 'conditional', basis: 'This inventory describes the lockfile of this repository, which is what both images install. An npm consumer resolves transitive ranges at install time and may get later versions of the same packages.', conditions: ['Direct dependencies are pinned to exact versions.', 'scripts/delivery-parity.mjs records which transitive versions differ between the image and a fresh install.'] },
]
const used = new Set([...npmPackages.flatMap((p) => p.installs.packages.map((x) => x.disposition)), ...copied.map((c) => c.disposition), ...named.map((n) => n.disposition), ...images.flatMap((i) => i.dispositions), ...services.map((s) => s.disposition), starter.disposition, 'consumer-installs'])
for (const id of used) if (!DISPOSITIONS.some((d) => d.id === id)) throw new Error(`No disposition is recorded for ${id}.`)
const open = DISPOSITIONS.filter((d) => d.status === 'open').map((d) => d.id)

const inventory = {
  inventory: `Everything a deployment of ${set.releaseSet} is made of`,
  description: 'The npm packages of the release set with everything each installs, the application the starter generates, the third-party files that are copied or only named, the images and the services of the presets. Each part names the terms it is under and the disposition recorded for it. This repository\'s code is under Apache-2.0; third-party material keeps its own terms, and a deployment as a whole is under no single licence.',
  generatedBy: 'scripts/deployment-inventory.mjs',
  releaseSet: set.releaseSet,
  releaseSetPath,
  lockfileSha256: sha256(lockBytes),
  npmPackages,
  starter,
  copiedFiles: copied,
  namedNotCarried: named,
  images,
  services,
  dispositions: DISPOSITIONS,
  releaseDecision: open.length === 0
    ? { status: 'no open disposition', note: 'Every disposition is held or conditional. The decision to release these exact artefacts is recorded with the publication.' }
    : { status: 'blocked', openDispositions: open, note: 'A release of these artefacts waits on each open disposition.' },
}
const text = JSON.stringify(inventory, null, 2) + '\n'

const target = 'conformance/deployment-inventory.json'
const checking = process.argv.includes('--check') || process.argv.includes('--release')
const summary = `${npmPackages.map((p) => `${p.name} installs ${p.installs.packageCount}`).join(', ')}; ${copied.length} copied third-party files, ${named.length} named and not carried; ${images.length} images and ${services.length} third-party service; ${DISPOSITIONS.length} dispositions, ${open.length} open${open.length === 0 ? '' : ` (${open.join(', ')})`}`
if (checking) {
  let current = ''
  try { current = read(target).toString('utf8') } catch { /* reported below */ }
  if (current !== text) { console.error(`${target} is not what this checkout gives. Run node scripts/deployment-inventory.mjs and review the change.`); process.exit(1) }
  console.log(`${target} is current: ${summary}.`)
  if (process.argv.includes('--release') && open.length > 0) { console.error(`A release is blocked by ${open.length} open disposition${open.length === 1 ? '' : 's'}: ${open.join(', ')}.`); process.exit(1) }
} else {
  writeFileSync(join(root, target), text)
  console.log(`Wrote ${target}: ${summary}.`)
}
