import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const filesUnder = (dir, base = dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? filesUnder(path, base) : [path.slice(base.length + 1)]
}).sort()

test('the custom profile folders in the template are the repository examples, byte for byte', () => {
  const source = join(root, '../../examples/custom-profile')
  const copy = join(root, 'template/apps/api/test/fixtures/custom-profile')
  assert.deepEqual(filesUnder(copy), filesUnder(source))
  for (const file of filesUnder(source)) assert.ok(readFileSync(join(copy, file)).equals(readFileSync(join(source, file))), `${file} differs from examples/custom-profile`)
  // The scaffold renames a file that starts with an underscore and a letter, which would change a folder a binding pins.
  for (const file of filesUnder(copy)) assert.ok(!file.split('/').some((part) => /^_[a-z]/i.test(part)), `${file} would be renamed when scaffolded`)
})

test('the template installs the validation libraries at the versions the profiles package is tested with', async () => {
  const api = JSON.parse(readFileSync(join(root, 'template/apps/api/package.json'), 'utf8'))
  const { VALIDATION_ENGINE_LIBRARIES } = await import('@bsv/dpp-profiles/validation-engine')
  const pinned = JSON.parse(readFileSync(join(root, '../dpp-credentials/package.json'), 'utf8')).devDependencies
  for (const [name, version] of Object.entries(VALIDATION_ENGINE_LIBRARIES)) {
    assert.equal(api.dependencies[name], version, `${name} is installed at the version the engine adapter names`)
    assert.equal(pinned[name], version, `${name} is the version the repository pins`)
  }
  assert.deepEqual(Object.keys(VALIDATION_ENGINE_LIBRARIES).sort(), ['jsonld', 'n3', 'shacl-engine'])
})

test('the template carries no third-party product document and does not name the source of the bundled bindings', () => {
  const template = join(root, 'template')
  const sources = filesUnder(template).filter((file) => !file.includes('node_modules/') && !file.startsWith('apps/api/dist/') && !file.startsWith('apps/web/dist/'))
  assert.deepEqual(sources.filter((file) => file.endsWith('.jsonld') && !file.startsWith('apps/api/test/fixtures/custom-profile/')), [])
  // The names come from the bindings themselves, which are where their source is credited.
  const names = new Set()
  for (const profile of readdirSync(join(root, '../dpp-profiles/bindings'))) {
    const { source } = JSON.parse(readFileSync(join(root, '../dpp-profiles/bindings', profile, 'binding.json'), 'utf8'))
    names.add(source.name.split(/\s+/)[0].toLowerCase())
    names.add(new URL(source.repository).pathname.split('/')[1].toLowerCase())
  }
  assert.ok(names.size > 0)
  for (const file of sources) {
    const text = readFileSync(join(template, file), 'utf8').toLowerCase()
    for (const name of names) assert.ok(!text.includes(name), `${file} names ${name}`)
  }
})
