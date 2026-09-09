import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertApproval, publicationActions, publicationOrder, registryVersion } from '../../scripts/lib/publication.mjs'
import { integrityOf, sha256, verifyCandidates } from '../../scripts/lib/candidates.mjs'
import { dependencyManifest } from '../../scripts/lib/dependency-manifest.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const bytes = Buffer.from('approved package bytes')
const candidate = { name: '@bsv/example', version: '0.1.0', sha256: sha256(bytes), integrity: integrityOf(bytes), size: bytes.length }
const metadata = { name: candidate.name, version: candidate.version, dist: { integrity: candidate.integrity, tarball: 'https://registry.npmjs.org/@bsv/example/-/example-0.1.0.tgz' } }
const response = (value, status = 200) => new Response(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value), { status })

test('publication follows runtime dependencies, independent of archive filename order', () => {
  const app = { name: '@bsv/app', version: '0.1.0' }
  const manifests = {
    [app.name]: { ...app, dependencies: { [candidate.name]: '^0.1.0' } },
    [candidate.name]: candidate,
  }
  assert.deepEqual(publicationOrder([app, candidate], manifests).map((c) => c.name), [candidate.name, app.name])
  manifests[candidate.name] = { ...candidate, dependencies: { [app.name]: '0.1.0' } }
  assert.throws(() => publicationOrder([app, candidate], manifests), /cycle/)
})

test('only a 404 means a version may be published', async () => {
  assert.equal(await registryVersion(candidate, async () => response({}, 404)), null)
  for (const status of [401, 403, 429, 500]) await assert.rejects(registryVersion(candidate, async () => response({}, status)), new RegExp(`HTTP ${status}`))
  await assert.rejects(registryVersion(candidate, async () => { throw new Error('offline') }), /offline/)
})

test('an existing version is skipped only after checking its identity and downloaded bytes', async () => {
  const fetcher = async (url) => response(String(url).endsWith('.tgz') ? bytes : metadata)
  assert.equal((await publicationActions([candidate], fetcher))[0].action, 'already-published')
  await assert.rejects(registryVersion(candidate, async () => response({ ...metadata, version: '0.2.0' })), /identity mismatch/)
  await assert.rejects(registryVersion(candidate, async () => response({ ...metadata, dist: { ...metadata.dist, integrity: 'sha512-other' } })), /integrity differs/)
  await assert.rejects(registryVersion(candidate, async (url) => response(String(url).endsWith('.tgz') ? Buffer.from('changed') : metadata)), /downloaded bytes differ/)
})

test('a partial publication can resume but a conflict aborts preparation', async () => {
  const absent = { ...candidate, name: '@bsv/absent' }
  const fetcher = async (url) => String(url).includes(encodeURIComponent(absent.name)) ? response({}, 404) : response(String(url).endsWith('.tgz') ? bytes : metadata)
  assert.deepEqual((await publicationActions([absent, candidate], fetcher)).map((a) => a.action), ['publish', 'already-published'])
  await assert.rejects(publicationActions([absent, { ...candidate, integrity: 'sha512-conflict' }], fetcher), /integrity differs/)
})

test('approval binds the source, package bytes, tag, provenance and release notes', () => {
  const plan = { sourceRevision: 'a'.repeat(40), sourceState: 'committed', candidates: [candidate], tag: 'next', provenance: true, changelogSha256: 'b'.repeat(64) }
  const digest = sha256(Buffer.from(JSON.stringify(plan, null, 2) + '\n'))
  assert.doesNotThrow(() => assertApproval(plan, digest, plan.sourceRevision, false))
  for (const patch of [{ tag: 'latest' }, { provenance: false }, { candidates: [] }, { changelogSha256: 'c'.repeat(64) }]) assert.throws(() => assertApproval({ ...plan, ...patch }, digest, plan.sourceRevision, false), /approval/)
  assert.throws(() => assertApproval(plan, digest, 'd'.repeat(40), false), /committed revision/)
  assert.throws(() => assertApproval(plan, digest, plan.sourceRevision, true), /clean working tree/)
  assert.throws(() => assertApproval(plan, undefined, plan.sourceRevision, false), /approval/)
})

test('candidate filenames cannot escape the archive directory', () => {
  assert.ok(verifyCandidates({ candidates: [{ ...candidate, filename: '../outside.tgz' }] }, '/unused').some((f) => !f.ok && /invalid candidate filename/.test(f.sentence)))
})

test('the dependency ledger records a workspace dependency before a different hoisted version', () => {
  const root = mkdtempSync(join(tmpdir(), 'dpp-dependencies-'))
  try {
    const workspace = join(root, 'packages/example')
    for (const [directory, version] of [[root, '2.1.0'], [workspace, '4.0.0']]) {
      mkdirSync(join(directory, 'node_modules/canonicalize'), { recursive: true })
      writeFileSync(join(directory, 'node_modules/canonicalize/package.json'), JSON.stringify({ name: 'canonicalize', version }))
    }
    assert.equal(dependencyManifest(workspace, 'canonicalize').version, '4.0.0')
    assert.equal(dependencyManifest(root, 'canonicalize').version, '2.1.0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
