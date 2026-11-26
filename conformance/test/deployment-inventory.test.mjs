/**
 * The whole-deployment inventory (scripts/deployment-inventory.mjs and
 * conformance/deployment-inventory.json): that the file is what the checkout
 * gives, that every part has a recorded disposition, that a licence nobody
 * reviewed stops the script, and that an open disposition blocks a release.
 * It reads files only, so it needs no Docker and no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = join(root, 'scripts', 'deployment-inventory.mjs')
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
const inventory = JSON.parse(readFileSync(join(root, 'conformance', 'deployment-inventory.json'), 'utf8'))
const set = JSON.parse(readFileSync(join(root, inventory.releaseSetPath), 'utf8'))

/** A copy of every file the script reads, in a directory a test may change. */
const SOURCES = ['package-lock.json', 'release', 'packages/dpp-profiles/bindings', 'packages/dpp-profiles/test/fixtures/sector-bindings', 'packages/dpp-credentials/artifacts/w3c', 'packages/dpp-credentials/src/gs1-artefacts.ts', 'packages/dpp-profiles/src/gs1-artefacts.ts', 'packages/dpp-profiles/validator-image/licence-inventory.json', 'packages/create-dpp-app/template/package.json', 'packages/create-dpp-app/template/apps/api/package.json', 'packages/create-dpp-app/template/apps/web/package.json', 'packages/create-dpp-app/template/_env.example', 'conformance/deployment-inventory.json']
function copyOfSources() {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-inventory-'))
  for (const path of SOURCES) { mkdirSync(dirname(join(dir, path)), { recursive: true }); cpSync(join(root, path), join(dir, path), { recursive: true }) }
  return dir
}
const edit = (dir, path, change) => { const file = join(dir, path); const before = readFileSync(file, 'utf8'); const after = change(before); assert.notEqual(after, before, `the edit to ${path} changed nothing`); writeFileSync(file, after) }

test('the inventory on disk is what the checkout gives', () => {
  const checked = run('--check')
  assert.equal(checked.status, 0, checked.stderr)
  assert.equal(inventory.releaseSet, set.releaseSet)
  assert.deepEqual(inventory.npmPackages.map((p) => `${p.name}@${p.version}`), set.packages.map((p) => `${p.name}@${p.version}`))
})

test('every part names a recorded disposition, and every disposition says why', () => {
  const known = new Map(inventory.dispositions.map((d) => [d.id, d]))
  const named = [
    ...inventory.npmPackages.flatMap((p) => p.installs.packages.map((x) => x.disposition)),
    ...inventory.copiedFiles.map((f) => f.disposition), ...inventory.namedNotCarried.map((f) => f.disposition),
    ...inventory.images.flatMap((i) => i.dispositions), ...inventory.services.map((s) => s.disposition), inventory.starter.disposition,
  ]
  for (const id of named) assert.ok(known.has(id), `${id} has no disposition`)
  for (const d of inventory.dispositions) {
    assert.ok(['held', 'conditional', 'open'].includes(d.status), `${d.id}: ${d.status}`)
    assert.ok(d.basis.length > 40, `${d.id} gives no basis`)
    if (d.status === 'conditional') assert.ok(d.conditions.length > 0, `${d.id} is conditional on nothing`)
    if (d.status === 'open') assert.ok(d.waitsOn.length > 20, `${d.id} is open and waits on nothing`)
  }
})

test('every installed package has a version, an integrity and a licence that was read', () => {
  for (const p of inventory.npmPackages) {
    for (const x of p.installs.packages) {
      assert.match(x.version, /^\d+\.\d+\.\d+/, `${x.name}`)
      assert.ok(typeof x.licence === 'string' && !/^SEE LICEN[CS]E|UNKNOWN/i.test(x.licence), `${x.name}@${x.version} records no licence: ${x.licence}`)
      if (x.own !== true) assert.match(x.integrity, /^sha512-/, `${x.name}@${x.version}`)
    }
  }
})

test('a licence file recorded by hand still opens the way it was read', () => {
  // Installed packages are present in a checkout that ran npm ci, which is every checkout these tests run in.
  let read = 0
  for (const x of inventory.npmPackages.flatMap((p) => p.installs.packages)) {
    if (x.licenceFile == null) continue
    const file = join(root, 'node_modules', x.name, x.licenceFile)
    assert.ok(existsSync(file), `${x.name}@${x.version} is not installed at the root, so its ${x.licenceFile} cannot be read`)
    assert.ok(readFileSync(file, 'utf8').trimStart().startsWith(x.licenceFileOpens), `${x.name}@${x.version}: ${x.licenceFile} no longer opens with "${x.licenceFileOpens}"`)
    read += 1
  }
  assert.ok(read > 0)
})

test('the copied files are the bytes recorded and the files only named are not in the repository', () => {
  assert.ok(inventory.copiedFiles.length > 0 && inventory.namedNotCarried.length > 0)
  for (const f of inventory.copiedFiles) {
    assert.equal(f.modified, false)
    assert.ok(existsSync(join(root, f.notice)), `${f.path} has no notice at ${f.notice}`)
  }
  for (const f of inventory.namedNotCarried) assert.match(f.address, /^https:\/\/ref\.gs1\.org\//)
})

test('a package under a licence nobody reviewed stops the script', () => {
  const dir = copyOfSources()
  try {
    edit(dir, 'package-lock.json', (text) => { const lock = JSON.parse(text); lock.packages['node_modules/mongodb'].license = 'SSPL-1.0'; return JSON.stringify(lock, null, 2) })
    const result = run('--root', dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /mongodb@.* is under SSPL-1\.0, which is not among the licences reviewed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a package that names a licence file at a version nobody read stops the script', () => {
  const dir = copyOfSources()
  try {
    edit(dir, 'package-lock.json', (text) => { const lock = JSON.parse(text); lock.packages['node_modules/did-context'].version = '99.0.0'; return JSON.stringify(lock, null, 2) })
    const result = run('--root', dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /did-context@99\.0\.0 names no licence in the lockfile .* is not in SEPARATE_TERMS at this version/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a copied file that is not the bytes its binding records stops the script', () => {
  const dir = copyOfSources()
  try {
    const first = inventory.copiedFiles.find((f) => f.disposition === 'bundled-bindings')
    edit(dir, first.path, (text) => `${text} `)
    const result = run('--root', dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /is not the bytes its binding records/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an open disposition blocks a release, and a set that is no longer a candidate has none', () => {
  const open = inventory.dispositions.filter((d) => d.status === 'open').map((d) => d.id)
  const released = run('--release')
  if (open.length === 0) {
    assert.equal(released.status, 0, released.stderr)
    assert.equal(inventory.releaseDecision.status, 'no open disposition')
  } else {
    assert.equal(released.status, 1)
    for (const id of open) assert.ok(released.stderr.includes(id), `the refusal does not name ${id}`)
    assert.deepEqual(inventory.releaseDecision.openDispositions, open)
    assert.equal(set.status, 'candidate', `${set.releaseSet} is ${set.status} while ${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} open`)
  }
})

test('the licence page names each open disposition and no other as open', () => {
  const page = readFileSync(join(root, 'docs', 'contribute', 'licence.md'), 'utf8')
  const section = page.slice(page.indexOf('## The whole deployment'))
  const listed = [...section.slice(section.indexOf('open in the current candidate')).matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1])
  assert.deepEqual(listed.sort(), inventory.dispositions.filter((d) => d.status === 'open').map((d) => d.id).sort())
})

test('the W3C context is held while its notice carries the licence text, however that text is punctuated, and open without it', () => {
  const noticePath = 'packages/dpp-credentials/artifacts/w3c/NOTICE.md'
  const status = (dir) => JSON.parse(readFileSync(join(dir, 'conformance', 'deployment-inventory.json'), 'utf8')).dispositions.find((d) => d.id === 'w3c-context').status
  assert.equal(inventory.dispositions.find((d) => d.id === 'w3c-context').status, 'held')
  const dir = copyOfSources()
  try {
    edit(dir, noticePath, (text) => text.replace('"AS IS,"', '\u201cAS IS\u201d,').replace('EXPRESS OR IMPLIED, INCLUDING', 'EXPRESS OR\nIMPLIED, INCLUDING'))
    assert.equal(run('--root', dir).status, 0)
    assert.equal(status(dir), 'held')
    edit(dir, noticePath, (text) => text.slice(0, text.indexOf('### Disclaimers')))
    assert.equal(run('--root', dir).status, 0)
    assert.equal(status(dir), 'open')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('publishing both images closes that disposition and no other', () => {
  const dir = copyOfSources()
  try {
    edit(dir, inventory.releaseSetPath, (text) => { const copy = JSON.parse(text); copy.images.own.forEach((image, at) => { image.digest = `sha256:${String(at + 1).repeat(64)}` }); return JSON.stringify(copy, null, 2) })
    assert.equal(run('--root', dir).status, 0)
    const after = JSON.parse(readFileSync(join(dir, 'conformance', 'deployment-inventory.json'), 'utf8'))
    const status = (list, id) => list.find((d) => d.id === id).status
    assert.equal(status(after.dispositions, 'image-digests'), 'held')
    for (const d of inventory.dispositions) if (d.id !== 'image-digests') assert.equal(status(after.dispositions, d.id), d.status, d.id)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
