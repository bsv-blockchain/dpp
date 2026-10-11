import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'index.js')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('--help names the release set and its packages', () => {
  const out = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.match(out, new RegExp(manifest.dpp.releaseSet))
  for (const [name, version] of Object.entries(manifest.dpp.packages)) assert.match(out, new RegExp(`${name.replace('/', '\\/')}@${version.replace('.', '\\.')}`))
})

test('scaffolds into an empty directory, restores dotfiles and names the project', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-app-test-'))
  try {
    const target = join(scratch, 'My App')
    const out = execFileSync(process.execPath, [cli, target, '--no-install'], { encoding: 'utf8', cwd: scratch })
    assert.match(out, /Creating my-app in/)
    assert.ok(existsSync(join(target, '.gitignore')))
    assert.ok(existsSync(join(target, '.env.example')))
    assert.ok(!existsSync(join(target, '_gitignore')))
    const scaffolded = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    assert.equal(scaffolded.name, 'my-app')
    assert.equal(scaffolded.dpp.releaseSet, manifest.dpp.releaseSet)
    const api = JSON.parse(readFileSync(join(target, 'apps/api/package.json'), 'utf8'))
    assert.ok(!Object.hasOwn(api.dependencies, '@bsv/dpp-core'), 'new apps use the protocol package directly')
    for (const [name, version] of Object.entries(manifest.dpp.packages)) assert.equal(api.dependencies[name], version, `${name} is pinned to the release set`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('refuses a directory that is not empty', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-app-test-'))
  try {
    writeFileSync(join(scratch, 'something.txt'), 'x')
    assert.throws(() => execFileSync(process.execPath, [cli, scratch, '--no-install'], { encoding: 'utf8', stdio: 'pipe' }), /is not empty/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
