import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertApproval, oidcPublishEnv, publicationActions, publicationOrder, registryVersion, waitForRegistryVersion } from '../../scripts/lib/publication.mjs'
import { integrityOf, sha256, verifyCandidates } from '../../scripts/lib/candidates.mjs'
import { dependencyManifest } from '../../scripts/lib/dependency-manifest.mjs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function waitingClock() {
  let elapsed = 0
  const sleeps = []
  const progress = []
  return {
    sleeps, progress,
    options: {
      timeoutMs: 40, pollIntervalMs: 15,
      now: () => elapsed,
      sleep: async (ms) => { sleeps.push(ms); elapsed += ms },
      onProgress: (message) => progress.push(message),
    },
  }
}

test('post-upload verification waits for metadata and archive propagation before success', async () => {
  const clock = waitingClock()
  const replies = [response({}, 404), response(metadata), response({}, 404), response(metadata), response(bytes)]
  const urls = []
  const result = await waitForRegistryVersion(candidate, {
    ...clock.options,
    fetcher: async (url) => { urls.push(String(url)); return replies.shift() },
  })
  assert.deepEqual(result, metadata)
  assert.deepEqual(clock.sleeps, [15, 15])
  assert.equal(urls.filter((url) => url.endsWith('.tgz')).length, 2)
  assert.equal(replies.length, 0)
  assert.match(clock.progress[0], /upload accepted/)
  assert.match(clock.progress.at(-1), /downloaded archive matches/)
})

test('an immediately available upload is verified without sleeping', async () => {
  const clock = waitingClock()
  await waitForRegistryVersion(candidate, {
    ...clock.options,
    fetcher: async (url) => response(String(url).endsWith('.tgz') ? bytes : metadata),
  })
  assert.deepEqual(clock.sleeps, [])
})

test('post-upload waiting has a deadline and gives safe partial-release recovery instructions', async () => {
  const clock = waitingClock()
  let requests = 0
  await assert.rejects(waitForRegistryVersion(candidate, {
    ...clock.options,
    fetcher: async () => { requests += 1; return response({}, 404) },
  }), /availability was not verified.*resume the same approved plan/)
  assert.deepEqual(clock.sleeps, [15, 15, 10])
  assert.equal(requests, 3)
  assert.ok(clock.progress.every((message) => !message.includes('downloaded archive matches')))
})

test('a slow registry request is aborted by the overall availability deadline', async () => {
  // AbortSignal.timeout does not keep Node alive on its own; a real request would.
  const keepAlive = setTimeout(() => {}, 1000)
  try {
    await assert.rejects(waitForRegistryVersion(candidate, {
      timeoutMs: 20,
      fetcher: async (_url, { signal }) => new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    }), /availability was not verified/)
  } finally { clearTimeout(keepAlive) }
})

test('post-upload waiting fails immediately on registry errors or changed identity or bytes', async () => {
  const scenarios = [
    ...[401, 403, 429, 500].map((status) => ({ fetcher: async () => response({}, status), error: new RegExp(`HTTP ${status}`) })),
    { fetcher: async () => { throw new Error('offline') }, error: /offline/ },
    { fetcher: async () => response({ ...metadata, version: '0.2.0' }), error: /identity mismatch/ },
    { fetcher: async () => response({ ...metadata, dist: { ...metadata.dist, integrity: 'sha512-other' } }), error: /integrity differs/ },
    { fetcher: async () => response({ ...metadata, dist: { ...metadata.dist, tarball: 'https://example.com/archive.tgz' } }), error: /unexpected tarball host/ },
    { fetcher: async (url) => response(String(url).endsWith('.tgz') ? Buffer.from('changed') : metadata), error: /downloaded bytes differ/ },
    { fetcher: async (url) => String(url).endsWith('.tgz') ? response({}, 500) : response(metadata), error: /tarball HTTP 500/ },
  ]
  for (const { fetcher, error } of scenarios) {
    const clock = waitingClock()
    await assert.rejects(waitForRegistryVersion(candidate, { ...clock.options, fetcher }), error)
    assert.deepEqual(clock.sleeps, [])
  }
})

test('prepublication checks still refuse missing archives for existing versions', async () => {
  const fetcher = async (url) => String(url).endsWith('.tgz') ? response({}, 404) : response(metadata)
  await assert.rejects(publicationActions([candidate], fetcher), /tarball HTTP 404/)
})

test('OIDC publication drops leftover npm token environment variables', () => {
  assert.deepEqual(
    oidcPublishEnv({ NODE_AUTH_TOKEN: '', NPM_TOKEN: 'x', PATH: '/bin', HOME: '/tmp' }),
    { PATH: '/bin', HOME: '/tmp' },
  )
})

test('the publication workflow uses GitHub OIDC without an npm token', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/publish.yaml', import.meta.url), 'utf8')
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /registry-url:\s*https:\/\/registry\.npmjs\.org/)
  assert.match(workflow, /_authToken/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/)
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
