import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { integrityOf, sha256 } from '../../../scripts/lib/candidates.mjs'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const script = join(repository, 'packages/create-dpp-app/scripts/scaffold-check.mjs')
const starter = JSON.parse(readFileSync(join(repository, 'packages/create-dpp-app/package.json')))
const setBytes = readFileSync(join(repository, 'release', starter.dpp.releaseSet + '.json'))
const set = JSON.parse(setBytes)

test('prepares the four recorded archives verbatim and retains the installed starter with its notices', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'dpp-recorded-starter-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const directory = join(scratch, 'candidates')
  const packed = join(scratch, 'package')
  const recordPath = join(scratch, 'candidates.json')
  const retained = join(scratch, 'starter.tgz')
  mkdirSync(directory)
  mkdirSync(packed)

  // A distinct publication payload for each package identifies the archives supplied to the checker.
  const candidates = set.packages.map(({ name, version }) => {
    writeFileSync(join(packed, 'package.json'), JSON.stringify({ name, version }))
    const filename = name.slice('@bsv/'.length) + '.tgz'
    const archive = join(directory, filename)
    execFileSync('tar', ['-czf', archive, '-C', scratch, 'package'])
    const bytes = readFileSync(archive)
    return { name, version, filename, size: bytes.length, sha256: sha256(bytes), integrity: integrityOf(bytes) }
  })
  const record = { releaseSet: set.releaseSet, releaseSetSha256: sha256(setBytes), candidates }
  writeFileSync(recordPath, JSON.stringify(record))
  const prepare = target => execFileSync(process.execPath, [
    script, '--prepare-only', '--directory', target, '--candidate-record', recordPath, '--starter-archive', retained,
  ], { cwd: scratch, env: { ...process.env, NPM_CONFIG_OFFLINE: 'true' }, stdio: 'pipe' })

  const app = join(scratch, 'app')
  prepare(app)
  const api = JSON.parse(readFileSync(join(app, 'apps/api/package.json')))
  for (const { name, filename } of candidates) {
    assert.equal(api.dependencies[name], 'file:../../.dpp-candidates/' + filename)
    assert.deepEqual(readFileSync(join(app, '.dpp-candidates', filename)), readFileSync(join(directory, filename)))
  }
  assert.deepEqual(execFileSync('tar', ['-xOf', retained, 'package/LICENSE']), readFileSync(join(repository, 'packages/create-dpp-app/LICENSE')))
  for (const notice of ['NOTICE', 'PATENTS']) {
    assert.deepEqual(execFileSync('tar', ['-xOf', retained, 'package/' + notice]), readFileSync(join(repository, notice)))
  }

  const stale = join(scratch, 'stale')
  writeFileSync(recordPath, JSON.stringify({ ...record, releaseSetSha256: '0'.repeat(64) }))
  assert.throws(() => prepare(stale), /set file's digest/)
  writeFileSync(recordPath, JSON.stringify(record))
  writeFileSync(join(directory, candidates[0].filename), 'changed packaging')
  assert.throws(() => prepare(stale), /npm integrity that differs from the record/)
  assert.equal(existsSync(stale), false)
})
