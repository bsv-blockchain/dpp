import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { integrityOf, sha256 } from '../../scripts/lib/candidates.mjs'
import { assertApproval, NPM_REGISTRY } from '../../scripts/lib/publication.mjs'
import { checkIndexStarterRegistry, indexStarterPlan, starterRuntimePackages } from '../../scripts/lib/index-starter-publication.mjs'

function fixture() {
  const pins = { '@bsv/dpp-overlay-topics': '0.4.0-beta.11', '@bsv/dpp-profiles': '0.3.0-beta.9', '@bsv/dpp-protocol': '0.3.0-beta.9' }
  const manifest = { name: '@bsv/create-dpp-index', version: '0.1.0-beta.1', publishConfig: { access: 'public', registry: NPM_REGISTRY, tag: 'next' }, dpp: { releaseSet: 'dpp-release-test', packages: pins } }
  const template = { dependencies: { '@bsv/dpp-overlay-topics': pins['@bsv/dpp-overlay-topics'] } }
  const set = { releaseSet: manifest.dpp.releaseSet, status: 'candidate', packages: Object.entries(pins).map(([name, version]) => ({ name, version })) }
  const files = new Map()
  const candidates = [{ name: manifest.name, version: manifest.version }, ...set.packages].map(pkg => {
    const bytes = Buffer.from(JSON.stringify(pkg))
    files.set(pkg.name, bytes)
    return { ...pkg, filename: `${pkg.name.replace('@bsv/', '')}.tgz`, sha256: sha256(bytes), integrity: integrityOf(bytes), size: bytes.length }
  })
  const input = { manifest, template, set, setBytes: Buffer.from(JSON.stringify(set)), candidates, sourceRevision: 'a'.repeat(40), sourceState: 'committed', provenance: true }
  return { ...input, input, files }
}

test('the starter release has one publication target and three separately published prerequisites', () => {
  const f = fixture()
  const plan = indexStarterPlan(f.input)
  assert.deepEqual(plan.candidates, [f.candidates[0]])
  assert.deepEqual(plan.dependencies, f.candidates.slice(1))
  assert.equal(plan.releaseSetSha256, sha256(f.setBytes))
  assert.equal(plan.tag, 'next')
  f.set.status = 'released'
  assert.doesNotThrow(() => starterRuntimePackages(f.manifest, f.template, f.set))
})

test('a mismatched template or release pin cannot be packaged as the selected starter', () => {
  for (const change of [
    f => { f.template.dependencies['@bsv/dpp-overlay-topics'] = '^0.4.0' },
    f => { f.template.dependencies['@bsv/dpp-protocol'] = '0.3.0-beta.9' },
    f => { delete f.manifest.dpp.packages['@bsv/dpp-profiles'] },
    f => { f.manifest.dpp.packages['@bsv/dpp-protocol'] = '0.3.0-beta.8' },
    f => { f.manifest.dpp.releaseSet = 'another-set' },
    f => { f.set.status = 'superseded' },
    f => { f.set.packages.push(f.set.packages[0]) },
    f => { f.manifest.publishConfig.tag = 'latest' },
  ]) {
    const f = fixture()
    change(f)
    assert.throws(() => starterRuntimePackages(f.manifest, f.template, f.set))
  }
})

test('missing, duplicate, extra or changed archives cannot enter the starter plan', () => {
  for (const change of [
    f => { f.candidates.pop() },
    f => { f.candidates.push(f.candidates[0]) },
    f => { f.candidates[1] = f.candidates[0] },
    f => { f.candidates[0].version = '0.2.0' },
    f => { f.candidates[1].name = '@bsv/unselected' },
  ]) {
    const f = fixture()
    change(f)
    assert.throws(() => indexStarterPlan(f.input))
  }
})

test('approval covers runtime archive bytes and the source state as well as the starter', () => {
  const plan = indexStarterPlan(fixture().input)
  const digest = sha256(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))
  assert.doesNotThrow(() => assertApproval(plan, digest, plan.sourceRevision, false))
  const changed = structuredClone(plan)
  changed.dependencies[0].sha256 = 'b'.repeat(64)
  assert.throws(() => assertApproval(changed, digest, plan.sourceRevision, false), /approval/)
  const dirty = { ...plan, sourceState: 'working-tree' }
  const dirtyDigest = sha256(Buffer.from(`${JSON.stringify(dirty, null, 2)}\n`))
  assert.throws(() => assertApproval(dirty, dirtyDigest, dirty.sourceRevision, true), /committed revision/)
})

test('interactive first publication requires an explicit plan without CI provenance', () => {
  const f = fixture()
  assert.throws(() => indexStarterPlan({ ...f.input, authentication: 'interactive' }), /separately approved plan/)
  assert.throws(() => indexStarterPlan({ ...f.input, authentication: 'token' }), /authentication must/)
  const plan = indexStarterPlan({ ...f.input, authentication: 'interactive', provenance: false })
  assert.equal(plan.authentication, 'interactive')
  const digest = sha256(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))
  assert.throws(() => assertApproval({ ...plan, authentication: 'oidc' }, digest, plan.sourceRevision, false), /approval/)
})

const response = (data, status = 200) => new Response(Buffer.isBuffer(data) ? data : JSON.stringify(data), { status })
function registry(f, { missing = new Set(), changed = new Set() } = {}) {
  const requests = []
  return {
    requests,
    fetcher: async url => {
      requests.push(String(url))
      const candidate = f.candidates.find(candidate => String(url).includes(encodeURIComponent(candidate.name)))
      assert.ok(candidate, `unexpected registry URL ${url}`)
      if (missing.has(candidate.name)) return response({}, 404)
      if (String(url).endsWith('.tgz')) return response(changed.has(candidate.name) ? Buffer.from('different bytes') : f.files.get(candidate.name))
      return response({ name: candidate.name, version: candidate.version, dist: { integrity: candidate.integrity, tarball: `${NPM_REGISTRY}${encodeURIComponent(candidate.name)}/${candidate.filename}` } })
    },
  }
}

test('an unpublished prerequisite refuses the starter release before considering publication', async () => {
  const f = fixture()
  const fake = registry(f, { missing: new Set(['@bsv/dpp-protocol']) })
  await assert.rejects(checkIndexStarterRegistry(indexStarterPlan(f.input), fake.fetcher), /Publish the runtime release first.*@bsv\/dpp-protocol/)
  assert.ok(!fake.requests.some(url => url.includes(encodeURIComponent(f.manifest.name))))
})

test('all dependency archives must match before a new starter can publish or an existing one can be skipped', async () => {
  const f = fixture()
  const plan = indexStarterPlan(f.input)
  assert.equal((await checkIndexStarterRegistry(plan, registry(f, { missing: new Set([f.manifest.name]) }).fetcher))[0].action, 'publish')
  assert.equal((await checkIndexStarterRegistry(plan, registry(f).fetcher))[0].action, 'already-published')
  await assert.rejects(checkIndexStarterRegistry(plan, registry(f, { changed: new Set(['@bsv/dpp-overlay-topics']) }).fetcher), /downloaded bytes differ/)
})

test('execution without an exact approval fails before building or packing', () => {
  const script = fileURLToPath(new URL('../../scripts/index-starter-release.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--execute'], { encoding: 'utf8', env: { ...process.env, PATH: '' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /exact publication plan approval is required/)
  assert.doesNotMatch(result.stderr, /spawnSync|ENOENT/)
})
