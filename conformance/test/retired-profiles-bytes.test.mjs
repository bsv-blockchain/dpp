/**
 * Retiring a profile changes what the software does with it and never what
 * was published (spec/profiles.md §4). Two sets of files must therefore be,
 * byte for byte, what the main branch holds:
 *
 *   - the frozen definition of every retired profile in
 *     packages/dpp-profiles: its manifest, its generated schemas, consumer
 *     document and mapping inventory, and frozen.json itself;
 *   - every fixture and vector under fixtures/ that names a retired
 *     profile, such as the battery lifecycle, whose signed states and claims
 *     keep their bytes and their original meaning.
 *
 * Nothing is copied by hand. The list of fixtures is found by searching the
 * base revision, and every comparison is between the blob git holds for the
 * file at that revision and the blob git computes for the file in the
 * working tree. The base is origin/main, or the revision DPP_HISTORY_BASE
 * names. A checkout that holds no such revision, such as a shallow clone,
 * cannot make the comparison, and the test then says it was skipped: a
 * comparison that did not run is not a pass.
 * Run by `node --test conformance/test/*.test.mjs`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.DPP_HISTORY_BASE ?? 'origin/main'
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** The base revision as a commit, or why there is none to compare with. */
function baseCommit() {
  try {
    return { commit: git('rev-parse', '--verify', '--quiet', `${BASE}^{commit}`) }
  } catch (cause) {
    return { reason: `this checkout holds no revision ${BASE} to compare with (${String(cause.stderr ?? cause.message).trim() || 'not found'}); fetch it, or set DPP_HISTORY_BASE` }
  }
}

/** The retired identities, read from the one list the package exports. */
function retiredProfiles() {
  const source = readFileSync(join(root, 'packages/dpp-profiles/src/retired-profiles.ts'), 'utf8')
  const list = /export const RETIRED_PROFILE_IDS = \[([^\]]+)\] as const/.exec(source)
  assert.ok(list, 'packages/dpp-profiles/src/retired-profiles.ts exports RETIRED_PROFILE_IDS as one literal list')
  return [...list[1].matchAll(/'([a-z][a-z0-9-]*@[0-9]+)'/g)].map((m) => m[1])
}

/** The blob git holds for a path at the base, and the blob it computes for the working file. */
const blobAtBase = (commit, path) => git('rev-parse', '--verify', '--quiet', `${commit}:${path}`)
const blobInTree = (path) => git('hash-object', '--no-filters', '--', path)
const sameAsBase = (commit, path) => {
  assert.ok(existsSync(join(root, path)), `${path} is on ${BASE} and is missing from the working tree`)
  assert.equal(blobInTree(path), blobAtBase(commit, path), `${path} differs from ${BASE}`)
}

test('the list of retired profiles is the seven earlier sector profiles', () => {
  assert.deepEqual(retiredProfiles(), ['battery@2', 'battery@3', 'battery@4', 'textile@1', 'textile@2', 'textile@3', 'textile@4'])
})

test(`every frozen file of a retired profile is byte-identical to ${BASE}`, (t) => {
  const base = baseCommit()
  if (base.commit == null) return t.skip(base.reason)
  const files = git('ls-tree', '-r', '--name-only', base.commit, '--', 'packages/dpp-profiles/manifests', 'packages/dpp-profiles/generated', 'packages/dpp-profiles/frozen.json').split('\n').filter(Boolean)
  const retired = retiredProfiles()
  const named = (path) => retired.some((profile) => path.includes(`/${profile}.`) || path.endsWith(`/${profile.replace('@', '-v')}.json`))
  const held = files.filter((path) => named(path) || path === 'packages/dpp-profiles/frozen.json' || path === 'packages/dpp-profiles/generated/index.json')
  // A manifest, two schemas and a consumer document for each, and a mapping inventory for all but the first textile version, which never had one.
  for (const profile of retired) {
    const own = held.filter((path) => path.includes(`/${profile}.`) || path.endsWith(`/${profile.replace('@', '-v')}.json`))
    assert.ok(own.length >= 4, `${BASE} holds the manifest, both schemas and the consumer document of ${profile}; found ${own.join(', ')}`)
  }
  for (const path of held) sameAsBase(base.commit, path)
  t.diagnostic(`${held.length} frozen files compared with ${BASE} at ${base.commit.slice(0, 12)}`)
})

test(`every fixture and vector that names a retired profile is byte-identical to ${BASE}`, (t) => {
  const base = baseCommit()
  if (base.commit == null) return t.skip(base.reason)
  // A retired identity written out, or the profile stamp of a payload or a claim, plain or inside a JSON string.
  const pattern = '(battery@[234]|textile@[1234])|\\\\?"profile\\\\?"[[:space:]]*:[[:space:]]*\\\\?"(battery|textile)\\\\?"'
  const found = git('grep', '-lE', pattern, base.commit, '--', 'fixtures').split('\n').filter(Boolean).map((line) => line.slice(base.commit.length + 1))
  const fixtures = found.filter((path) => !path.endsWith('.md'))
  assert.ok(fixtures.includes('fixtures/battery-lifecycle-v1.json'), `the search of ${BASE} finds the battery lifecycle fixture; found ${fixtures.join(', ')}`)
  for (const path of fixtures) sameAsBase(base.commit, path)
  t.diagnostic(`${fixtures.length} fixtures compared with ${BASE} at ${base.commit.slice(0, 12)}: ${fixtures.join(', ')}`)
})
