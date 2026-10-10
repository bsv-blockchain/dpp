import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const cli = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const publisher = '02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27'
const anchor = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa'
const run = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options })
function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-index-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function create(dir, args = []) {
  return run([dir, '--publisher-key', publisher, '--no-install', '--yes', '--json', ...args])
}

test('help and version need no configuration and unknown flags fail', () => {
  assert.match(run(['--help']).stdout, /publisher-key/)
  assert.equal(run(['--version']).status, 0)
  assert.notEqual(run(['--typo']).status, 0)
  assert.equal(JSON.parse(run(['--typo', '--json']).stdout).status, 'error')
})

test('a fresh project has private independent secrets, pins and no secret output', t => {
  const parent = directory(t)
  const target = join(parent, 'My Index')
  const first = create(target)
  assert.equal(first.status, 0, first.stderr)
  const result = JSON.parse(first.stdout)
  assert.equal(result.status, 'created')
  assert.equal(result.installed, false)
  const env = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  assert.equal(env.SERVICE_IDENTITY_KEY, publisher)
  assert.equal(env.ANCHOR_SERVICE_KEYS, publisher)
  assert.equal(env.ACCEPTANCE_COMMITMENT, 'required')
  assert.equal(env.CHAIN_TRACKER, '')
  const secrets = ['SUBMIT_TOKEN', 'ARC_CALLBACK_TOKEN', 'EXPORT_TOKEN', 'EXPORT_SIGNING_KEY', 'MONGO_INDEX_PASSWORD', 'MONGO_ROOT_PASSWORD'].map(key => env[key])
  assert.equal(new Set(secrets).size, secrets.length)
  for (const secret of secrets) {
    assert.match(secret, /^[0-9a-f]{64}$/)
    assert.ok(!first.stdout.includes(secret))
    assert.ok(!readFileSync(join(target, '.env.example'), 'utf8').includes(secret))
  }
  if (process.platform !== 'win32') assert.equal(statSync(join(target, '.env')).mode & 0o777, 0o600)
  const project = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  assert.equal(project.name, 'my-index')
  assert.equal(project.dependencies['@bsv/dpp-overlay-topics'], project.dpp.packages['@bsv/dpp-overlay-topics'])
  assert.match(project.dpp.generator, /^@bsv\/create-dpp-index@/)
  assert.ok(!readdirSync(target).some(name => name.startsWith('_')))
  const second = join(parent, 'second')
  assert.equal(create(second).status, 0)
  assert.notEqual(parseEnv(readFileSync(join(second, '.env'), 'utf8')).SUBMIT_TOKEN, env.SUBMIT_TOKEN)
  const tests = spawnSync(process.execPath, ['--test', 'test/config.test.mjs'], { cwd: target, encoding: 'utf8' })
  assert.equal(tests.status, 0, tests.stdout + tests.stderr)
})

test('configuration files, explicit overrides and a different anchor publisher work', t => {
  const parent = directory(t)
  const file = join(parent, 'settings.json')
  writeFileSync(file, JSON.stringify({ publisherKey: publisher, anchorKeys: [anchor], network: 'test', custody: 'baseline', port: 18080, publicUrl: 'https://index.example.org/' }))
  const target = join(parent, 'configured')
  const result = run([target, '--config', file, '--network', 'main', '--no-install', '--yes'])
  assert.equal(result.status, 0, result.stderr)
  const env = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  assert.equal(env.NETWORK, 'main')
  assert.equal(env.ANCHOR_SERVICE_KEYS, anchor)
  assert.equal(env.ACCEPTANCE_COMMITMENT, '')
  assert.equal(env.PORT, '18080')
  assert.equal(env.PUBLIC_URL, 'https://index.example.org')
})

test('invalid settings and missing required input create nothing', t => {
  const parent = directory(t)
  for (const args of [
    ['--network', 'bitcoin'], ['--custody', 'anything'], ['--port', '0'],
    ['--publisher-key', '11'.repeat(32)], ['--publisher-key', `02${'ff'.repeat(32)}`],
    ['--anchor-key', 'not-a-key'], ['--public-url', 'https://user:password@index.example.org'],
    ['--public-url', 'http://public.example.org'], ['--public-url', 'https://index.example.org/path'],
  ]) assert.notEqual(create(join(parent, 'invalid'), args).status, 0)
  assert.notEqual(run([join(parent, 'missing'), '--yes', '--no-install']).status, 0)
  assert.deepEqual(readdirSync(parent), [])
})

test('existing work and symlink targets are preserved', t => {
  const parent = directory(t)
  const keep = join(parent, 'keep.txt')
  writeFileSync(keep, 'existing work')
  assert.notEqual(create(parent).status, 0)
  assert.equal(readFileSync(keep, 'utf8'), 'existing work')
  assert.deepEqual(readdirSync(parent), ['keep.txt'])
  if (process.platform !== 'win32') {
    const target = join(parent, 'link')
    symlinkSync(directory(t), target)
    assert.notEqual(create(target).status, 0)
  }
})

test('connection file uses the app contract, hides credentials and stays private on refresh', t => {
  const target = directory(t)
  assert.equal(create(target).status, 0)
  const env = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  for (let pass = 0; pass < 2; pass++) {
    const result = spawnSync(process.execPath, ['scripts/connection.mjs', '--json', '--url', 'https://index.example.org'], { cwd: target, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).ok, true)
    assert.ok(!result.stdout.includes(env.SUBMIT_TOKEN))
    const app = parseEnv(readFileSync(join(target, '.app.env'), 'utf8'))
    assert.deepEqual(app, { NETWORK: 'main', INDEX_URL: 'https://index.example.org', INDEX_SUBMIT_TOKEN: env.SUBMIT_TOKEN, INDEX_CALLBACK_TOKEN: env.ARC_CALLBACK_TOKEN })
    if (process.platform !== 'win32') assert.equal(statSync(join(target, '.app.env')).mode & 0o777, 0o600)
  }
})

test('invalid configuration is reported in JSON before runtime import, with no secret values', t => {
  const target = directory(t)
  assert.equal(create(target).status, 0)
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs', '--json'], {
    cwd: target, encoding: 'utf8', env: { ...process.env, MONGO_URL: '', SUBMIT_TOKEN: 'private-but-invalid' },
  })
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some(error => error.includes('MONGO_URL')))
  assert.ok(!result.stdout.includes('private-but-invalid'))
})

test('dependency installation failure returns non-zero and preserves the project for retry', t => {
  const parent = directory(t)
  const target = join(parent, 'retry')
  const result = run([target, '--publisher-key', publisher, '--yes', '--json'], { env: { ...process.env, PATH: parent } })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).status, 'install-failed')
  assert.ok(readFileSync(join(target, 'README.md'), 'utf8').includes('Start here'))
})

test('doctor and connection keep JSON results even when option parsing fails', t => {
  const target = directory(t)
  assert.equal(create(target).status, 0)
  for (const script of ['doctor', 'connection']) {
    const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, '--typo', '--json'], { cwd: target, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).ok, false)
  }
})
