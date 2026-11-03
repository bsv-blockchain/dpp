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

test('writes .env with fresh secrets and the default testnet index, and never a placeholder', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-app-test-'))
  try {
    const target = join(scratch, 'my-app')
    const out = execFileSync(process.execPath, [cli, target, '--no-install'], { encoding: 'utf8', cwd: scratch })
    const env = readFileSync(join(target, '.env'), 'utf8')
    const value = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
    const secrets = ['AUTH_SECRET', 'BRAND_ROOT_SECRET', 'MANAGED_IDENTITY_SECRET'].map(value)
    for (const secret of secrets) assert.match(secret, /^[0-9a-f]{64}$/)
    assert.equal(new Set(secrets).size, 3)
    assert.equal(value('NETWORK'), 'test')
    assert.equal(value('INDEX_URL'), 'https://dpp-overlay-testnet.bsvb.net')
    assert.equal(value('WALLET_ROOT_KEY'), '')
    assert.equal(value('LIVE_PUBLISHING'), 'false')
    assert.doesNotMatch(env, /change-me|development-only/)
    assert.match(readFileSync(join(target, '.env.example'), 'utf8'), /change-me-to-32-random-bytes-hex/)
    for (const secret of secrets) assert.ok(!out.includes(secret), 'secrets are not printed')
    assert.doesNotMatch(out, /cp \.env\.example/)
    assert.match(out, /npm run go-live/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
