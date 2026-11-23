#!/usr/bin/env node
// Exercise the packed starter outside the workspace. Local checks use packed
// runtime candidates; publication checks require the exact versions on npm.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { PrivateKey } from '@bsv/sdk'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { assertProductionRecordVersions } from '../template/apps/api/src/production-records.mjs'
import { sourceState } from '../../../scripts/lib/images.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(root, '../..')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const pkg = read(join(root, 'package.json'))
const { values } = parseArgs({ options: {
  'registry-dependencies': { type: 'boolean', default: false },
  'prepare-only': { type: 'boolean', default: false },
  directory: { type: 'string' },
  // Where the generated application's exit exercise writes the record of its run, such as deploy/evidence/exit-exercise.json.
  'exit-record': { type: 'string' },
  // Where to write every package the generated application's install brought, with the licence each states, such as deploy/evidence/starter-dependencies.json.
  'dependency-record': { type: 'string' },
} })
if (values['prepare-only'] && !values.directory) throw new Error('--prepare-only requires --directory for the generated project')
if (!existsSync(join(root, 'dist', 'index.js'))) throw new Error('build the packages first: npm run build')
const release = read(join(repository, 'release', `${pkg.dpp.releaseSet}.json`))
assertProductionRecordVersions(release.wire.records.map(record => record.version))
const runtime = release.packages.filter(p => Object.hasOwn(pkg.dpp.packages, p.name))
for (const entry of runtime) assert.equal(entry.version, pkg.dpp.packages[entry.name], 'starter pins must match the declared release set')
assert.equal(runtime.length, 4, 'the app uses the protocol, profiles, overlay and credentials runtime')
assert.equal(pkg.dpp.packages['@bsv/sdk'], release.runtime.dependencies.find(d => d.name === '@bsv/sdk').version)

const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-app-'))
const target = values.directory ? resolve(values.directory) : join(scratch, 'my-dpp')
const registry = 'https://registry.npmjs.org/'
const env = { ...process.env, NPM_CONFIG_CACHE: join(scratch, 'npm-cache'), NPM_CONFIG_REGISTRY: registry }
// The generated app's EPCIS tests read the pinned GS1 files. The repository's own tests keep them in this cache; when
// they are there the app reads them and fetches nothing. When they are not, the app's test set-up obtains them from GS1.
const gs1Cache = join(repository, 'node_modules', '.cache', 'dpp-gs1')
if (env.DPP_GS1_ARTEFACTS_DIR == null && existsSync(join(gs1Cache, 'epcis-json-schema-2.0.1.json'))) env.DPP_GS1_ARTEFACTS_DIR = gs1Cache
// The exit exercise runs inside the generated application, which is not a checkout. It is told where to write its record and which
// source it was generated from, so the record names the revision as the other evidence files do.
if (values['exit-record'] != null) {
  const source = sourceState(repository)
  env.DPP_EXIT_EXERCISE_RECORD = resolve(values['exit-record'])
  env.DPP_EXIT_EXERCISE_SOURCE_REVISION = source.revision
  env.DPP_EXIT_EXERCISE_SOURCE_STATE = source.state
  env.DPP_EXIT_EXERCISE_RELEASE_SET = pkg.dpp.releaseSet
}
const run = (command, args, cwd) => {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, env, stdio: 'inherit' })
}
const pack = cwd => JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], { cwd, env, encoding: 'utf8' }))[0]
let created = false
const stops = []
try {
  if (values['registry-dependencies']) {
    for (const { name, version } of runtime) {
      console.log(`Checking public npm prerequisite ${name}@${version}`)
      const published = JSON.parse(execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { cwd: scratch, env, encoding: 'utf8' }))
      assert.equal(published, version, `${name} must be published before the starter`)
    }
  }
  const archive = pack(root)
  const consumer = join(scratch, 'cli')
  mkdirSync(consumer)
  write(join(consumer, 'package.json'), { name: 'app-starter-consumer', private: true })
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, archive.filename)], consumer)
  const cli = join(consumer, 'node_modules/.bin/create-dpp-app')
  if (!existsSync(cli)) throw new Error('the packed starter must install the create-dpp-app executable')
  run(process.execPath, [cli, target, '--no-install'], scratch)
  created = true
  const manifest = read(join(target, 'package.json'))
  assert.equal(manifest.dpp.releaseSet, pkg.dpp.releaseSet)
  const apiPath = join(target, 'apps/api/package.json')
  const api = read(apiPath)
  assert.ok(!Object.hasOwn(api.dependencies, '@bsv/dpp-core'), 'the generated app must use the protocol name')
  for (const [name, version] of Object.entries(pkg.dpp.packages)) assert.equal(api.dependencies[name], version, `${name} must match the starter's pins`)
  for (const file of ['.gitignore', '.env', '.env.example', '.prettierrc', 'apps/api/package.json', 'apps/web/package.json', 'deploy/compose.yml', 'Dockerfile']) {
    if (!existsSync(join(target, file))) throw new Error(`${file} was not scaffolded`)
  }
  // Secrets exist from the first run and the default index is the hosted testnet one.
  const scaffoldedEnv = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  const secrets = ['AUTH_SECRET', 'BRAND_ROOT_SECRET', 'MANAGED_IDENTITY_SECRET'].map(name => scaffoldedEnv[name])
  for (const secret of secrets) assert.match(secret, /^[0-9a-f]{64}$/, 'the scaffold writes fresh secrets into .env')
  assert.equal(new Set(secrets).size, 3, 'the three secrets differ')
  assert.equal(scaffoldedEnv.NETWORK, 'test')
  assert.equal(scaffoldedEnv.INDEX_URL, 'https://dpp-overlay-testnet.bsvb.net')
  assert.equal(scaffoldedEnv.WALLET_ROOT_KEY, '', 'the root key is generated by go-live or wallet, not the scaffold')
  // The connection path below starts again from this fresh file.
  const freshEnv = readFileSync(join(target, '.env'), 'utf8')
  const archives = new Map()
  if (!values['registry-dependencies']) {
    mkdirSync(join(target, '.dpp-candidates'))
    for (const entry of runtime) {
      const directory = join(repository, entry.directory)
      const candidate = read(join(directory, 'package.json'))
      assert.equal(candidate.name, entry.name)
      assert.equal(candidate.version, entry.version)
      if (!existsSync(join(directory, 'dist/index.js'))) throw new Error(`build ${entry.name} first: npm run build`)
      const packed = pack(directory)
      copyFileSync(join(scratch, packed.filename), join(target, '.dpp-candidates', packed.filename))
      api.dependencies[entry.name] = `file:../../.dpp-candidates/${packed.filename}`
      archives.set(entry.name, packed)
    }
    write(apiPath, api)
    // Only this local test project needs archives copied into the image before
    // dependency installation. The bundled Dockerfile stays unchanged.
    const dockerfile = readFileSync(join(target, 'Dockerfile'), 'utf8')
    const install = 'RUN if [ -f package-lock.json ];'
    assert.ok(dockerfile.includes(install), 'the candidate image must retain the template install step')
    writeFileSync(join(target, '.candidate.Dockerfile'), dockerfile.replace(install, `COPY .dpp-candidates .dpp-candidates\n${install}`))
    console.log('Candidate mode: the generated app uses local runtime archives. This does not verify a public npm installation.')
  }
  if (values['prepare-only']) {
    console.log(`Prepared candidate project at ${target}; dependency installation and tests were not run.`)
  } else {
    run('npm', ['install', '--no-audit', '--no-fund'], target)
    const lock = read(join(target, 'package-lock.json'))
    if (values['dependency-record']) {
      // The generated application resolves its own dependencies, so what it installs is known only from an install. Development-only packages are left out: they do not run in the application.
      const installed = Object.entries(lock.packages).filter(([path, entry]) => path.includes('node_modules/') && entry.link !== true && entry.dev !== true)
        .map(([path, entry]) => ({ name: entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: entry.version, licence: entry.license ?? 'not stated in the lockfile', ...(entry.optional === true ? { optional: true } : {}), ...(values['registry-dependencies'] || !archives.has(entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)) ? {} : { from: 'the packed candidate of this repository' }) }))
        .filter((p, at, all) => all.findIndex(q => q.name === p.name && q.version === p.version) === at)
        .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
      const licences = {}
      for (const p of installed) licences[p.licence] = (licences[p.licence] ?? 0) + 1
      write(resolve(values['dependency-record']), {
        check: 'packages/create-dpp-app/scripts/scaffold-check.mjs',
        recordedAt: new Date().toLocaleDateString('en-CA'),
        releaseSet: pkg.dpp.releaseSet,
        sourceRevision: sourceState(repository).revision,
        sourceState: sourceState(repository).state,
        note: 'Every package one install of a generated application brought for use, development-only packages left out, with the licence each states. Direct dependencies have exact pins. Transitive dependencies may resolve differently in a fresh installation.',
        packageCount: installed.length,
        licences: Object.fromEntries(Object.entries(licences).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))),
        packages: installed,
      })
      console.log(`Wrote ${values['dependency-record']}: ${installed.length} packages.`)
    }
    assert.ok(!Object.keys(lock.packages).some(path => path.endsWith('node_modules/@bsv/dpp-core')), 'the generated app must not install dpp-core transitively')
    for (const [name, version] of Object.entries(pkg.dpp.packages)) {
      const installed = lock.packages[`node_modules/${name}`] ?? lock.packages[`apps/api/node_modules/${name}`]
      assert.equal(installed?.version, version, `${name} must install at its pinned version`)
      assert.ok(!installed.link, `${name} must be installed from an archive`)
      if (values['registry-dependencies'] || name === '@bsv/sdk') {
        assert.equal(new URL(installed.resolved).origin, 'https://registry.npmjs.org')
        assert.ok(installed.integrity.startsWith('sha512-'))
      } else assert.equal(installed.integrity, archives.get(name).integrity, `${name} must match the packed candidate bytes`)
    }
    // A profile held by a binding is validated with three libraries the profiles package does not install itself.
    // The generated app declares them at the exact versions that package is tested with, and installs those from npm.
    const { VALIDATION_ENGINE_LIBRARIES } = await import('@bsv/dpp-profiles/validation-engine')
    for (const [name, version] of Object.entries(VALIDATION_ENGINE_LIBRARIES)) {
      assert.equal(api.dependencies[name], version, `${name} must be declared at the version the validation engine is tested with`)
      const installed = lock.packages[`node_modules/${name}`] ?? lock.packages[`apps/api/node_modules/${name}`]
      assert.equal(installed?.version, version, `${name} must install at its pinned version`)
      assert.equal(new URL(installed.resolved).origin, 'https://registry.npmjs.org')
    }
    run('npm', ['run', 'typecheck'], target)
    run('npm', ['run', 'build'], target)
    run('npm', ['test'], target)
    await goLivePath(target)
    await connectionFilePath(target, freshEnv)
    console.log(`The packed app starter and its ${values['registry-dependencies'] ? 'public registry dependencies' : 'local runtime candidates'} install, build, typecheck and pass the generated application's tests without dpp-core, the sector and custom profile tests, the EPCIS exchange tests, the two validation engines, the identifier host tests and the exit exercise among them, with the validation libraries at their pinned versions; go-live registers with an index, and connect-index takes the connection file the index's own command writes.`)
  }
} finally {
  for (const stop of stops) stop()
  if (created && (process.env.KEEP_DPP_APP === '1' || values.directory)) console.log(`Generated project kept at ${target}`)
  else rmSync(scratch, { recursive: true, force: true })
  if (values.directory) rmSync(scratch, { recursive: true, force: true })
}

/** An index in its own process from the built app's runtime, naming one publisher key; resolves to its URL and a stop. */
async function startCheckIndex(target, publisherKey, registration) {
  const script = join(target, '.check-index.mjs')
  writeFileSync(script, [
    "import { startDevIndex } from './apps/api/dist/dev-index.js'",
    `const index = await startDevIndex({ publisherKey: ${JSON.stringify(publisherKey)}, network: 'test'${registration == null ? '' : `, registration: ${JSON.stringify(registration)}`} })`,
    "console.log(index.url)",
    "setInterval(() => {}, 1_000_000)",
    '',
  ].join('\n'))
  const index = spawn(process.execPath, [script], { cwd: target, stdio: ['ignore', 'pipe', 'inherit'] })
  stops.push(() => index.kill())
  const url = await new Promise((resolve, reject) => {
    let out = ''
    index.stdout.on('data', chunk => { out += chunk; const line = out.split('\n')[0]; if (line.startsWith('http://')) resolve(line.trim()) })
    index.on('exit', code => reject(new Error(`the check index stopped with ${code}`)))
    setTimeout(() => reject(new Error('the check index did not start')), 30_000)
  })
  return { url, stop: () => { index.kill(); rmSync(script, { force: true }) } }
}

/** The newcomer path end to end: an index with registration open, started from the built app's own runtime, and `go-live` against it with the test wallet. */
async function goLivePath(target) {
  const { url, stop } = await startCheckIndex(target, PrivateKey.fromHex('79'.repeat(32)).toPublicKey().toString(), 'open')
  console.log(`$ node apps/api/dist/cli.js go-live  (INDEX_URL=${url}, DPP_TEST_WALLET=1)`)
  execFileSync(process.execPath, ['apps/api/dist/cli.js', 'go-live'], { cwd: target, env: { ...env, INDEX_URL: url, DPP_TEST_WALLET: '1' }, stdio: 'inherit' })
  const after = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  assert.match(after.WALLET_ROOT_KEY, /^[0-9a-f]{64}$/, 'go-live generates the root key')
  assert.match(after.INDEX_SUBMIT_TOKEN, /^[0-9a-f]{64}$/, 'go-live stores the submit token')
  assert.match(after.INDEX_CALLBACK_TOKEN, /^[0-9a-f]{64}$/, 'go-live stores the callback token')
  assert.equal(after.LIVE_PUBLISHING, 'true', 'go-live switches live publishing on')
  const key = PrivateKey.fromHex(after.WALLET_ROOT_KEY).toPublicKey().toString()
  const policy = await (await fetch(`${url}/publisher-policy`)).json()
  assert.ok(policy[policy.length - 1].publishers.some(p => p.key === key), 'the index names the registered key')
  // A second run changes nothing.
  execFileSync(process.execPath, ['apps/api/dist/cli.js', 'go-live'], { cwd: target, env: { ...env, INDEX_URL: url, DPP_TEST_WALLET: '1' }, stdio: 'inherit' })
  assert.deepEqual(parseEnv(readFileSync(join(target, '.env'), 'utf8')), after, 'a second go-live keeps the file')
  stop()
  console.log('ok: go-live generated the root key, registered the publisher key with an index, stored the tokens and switched live publishing on')
}

/**
 * Your own index, in a fresh app's order: `wallet` generates the root key and
 * prints the publisher key, an operator names that key and issues the app's
 * connection with the installed runtime's `dpp-index connection`, and the app
 * takes the file with `connect-index --from` and goes live against that index.
 */
async function connectionFilePath(target, freshEnv) {
  writeFileSync(join(target, '.env'), freshEnv, { mode: 0o600 })
  console.log('$ node apps/api/dist/cli.js wallet  (fresh .env, DPP_TEST_WALLET=1)')
  const wallet = execFileSync(process.execPath, ['apps/api/dist/cli.js', 'wallet'], { cwd: target, env: { ...env, DPP_TEST_WALLET: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  process.stdout.write(wallet)
  const before = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  assert.match(before.WALLET_ROOT_KEY, /^[0-9a-f]{64}$/, 'wallet generates the root key into a fresh .env')
  const publisherKey = PrivateKey.fromHex(before.WALLET_ROOT_KEY).toPublicKey().toString()
  assert.notEqual(publisherKey, PrivateKey.fromHex('11'.repeat(32)).toPublicKey().toString(), 'the printed key is never the fixed test wallet\'s')
  assert.match(wallet, new RegExp(`^Publisher key \\(give this to your index; it is public\\): ${publisherKey}$`, 'm'), 'wallet prints the key of the root key it generated')
  const { url, stop } = await startCheckIndex(target, publisherKey)
  const runtime = [join(target, 'node_modules/@bsv/dpp-overlay/dist/cli.js'), join(target, 'apps/api/node_modules/@bsv/dpp-overlay/dist/cli.js')].find(existsSync)
  assert.ok(runtime != null, 'the installed runtime carries the dpp-index executable')
  const file = join(scratch, 'app.env')
  console.log(`$ dpp-index connection > app.env  (SERVICE_IDENTITY_KEY=${publisherKey}, PUBLIC_URL=${url})`)
  const printed = execFileSync(process.execPath, [runtime, 'connection'], {
    env: { ...env, SERVICE_IDENTITY_KEY: publisherKey, PUBLIC_URL: url, NETWORK: 'test', PUBLISHER_TOKENS_FILE: join(scratch, 'publisher-tokens.json') },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  writeFileSync(file, printed, { mode: 0o600 })
  const connection = parseEnv(printed)
  console.log(`$ node apps/api/dist/cli.js connect-index --from ${file}  (DPP_TEST_WALLET=1)`)
  execFileSync(process.execPath, ['apps/api/dist/cli.js', 'connect-index', '--from', file], {
    cwd: target,
    env: { ...env, DPP_TEST_WALLET: '1', INDEX_URL: '', INDEX_SUBMIT_TOKEN: '', INDEX_CALLBACK_TOKEN: '', LIVE_PUBLISHING: 'false' },
    stdio: 'inherit',
  })
  const app = parseEnv(readFileSync(join(target, '.env'), 'utf8'))
  assert.equal(app.INDEX_URL, connection.INDEX_URL, 'connect-index takes the address from the connection file')
  assert.equal(app.INDEX_SUBMIT_TOKEN, connection.INDEX_SUBMIT_TOKEN)
  assert.equal(app.INDEX_CALLBACK_TOKEN, connection.INDEX_CALLBACK_TOKEN)
  assert.match(app.INDEX_SUBMIT_TOKEN, /^[0-9a-f]{64}$/)
  assert.equal(app.LIVE_PUBLISHING, 'true', 'go-live passes against the index that names the app\'s key')
  assert.equal(app.WALLET_ROOT_KEY, before.WALLET_ROOT_KEY, 'connect-index goes live on the key wallet generated')
  stop()
  console.log('ok: wallet generated the key the index was given, dpp-index connection wrote the app\'s connection file, and connect-index --from took it and went live')
}
