#!/usr/bin/env node
// Exercise packed packages outside the workspace. Synthetic data never reaches
// a broadcaster; fixture admission uses a separate, explicitly labelled process.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'

const { values } = parseArgs({ options: {
  registry: { type: 'boolean', default: false },
  'registry-dependencies': { type: 'boolean', default: false },
  'app-project': { type: 'string' },
} })
if (values.registry && values['registry-dependencies']) throw new Error('choose the published starter or the local starter with published dependencies')
const registryDependencies = values.registry || values['registry-dependencies']

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pkg = JSON.parse(readFileSync(join(root, 'packages/create-dpp-index/package.json'), 'utf8'))
const temp = mkdtempSync(join(tmpdir(), 'dpp-index-consumer-'))
const archives = join(temp, 'archives')
const project = join(temp, 'operator')
const cliConsumer = join(temp, 'cli')
const say = message => console.log(`ok: ${message}`)
const npmEnv = { NPM_CONFIG_CACHE: join(temp, 'npm-cache'), NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' }
const run = (command, args, cwd = root, env = {}) => {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...npmEnv, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
let mongo
let child
let output = ''
let port
const stop = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 8000)
  try { await exited } finally { clearTimeout(timeout) }
}
try {
  if (!values.registry) run('npm', ['run', 'build'])
  for (const dir of [archives, cliConsumer]) mkdirSync(dir)
  const packed = {}
  const packageDirs = values.registry ? [] : registryDependencies ? ['create-dpp-index'] : ['dpp-protocol', 'dpp-profiles', 'overlay-topics', 'create-dpp-index']
  for (const dir of packageDirs) {
    const manifest = read(join(root, 'packages', dir, 'package.json'))
    if (manifest.name !== pkg.name) assert.equal(manifest.version, pkg.dpp.packages[manifest.name], 'generator pins must match the packed runtime')
    const [report] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', archives], join(root, 'packages', dir)))
    packed[manifest.name] = join(archives, report.filename)
    if (manifest.name === pkg.name) {
      assert.ok(report.files.some(file => file.path === 'template/scripts/start.mjs'))
      assert.ok(!report.files.some(file => /(?:^|\/)(?:planning|node_modules|\.env|\.app.env|AGENTS\.md)(?:\/|$)/.test(file.path)))
    }
  }
  write(join(cliConsumer, 'package.json'), { name: 'cli-consumer', private: true })
  if (!values.registry) run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', packed[pkg.name]], cliConsumer)
  const cli = join(cliConsumer, 'node_modules/@bsv/create-dpp-index/src/index.mjs')
  const fixture = read(join(root, 'fixtures/chain-v2.json'))
  const anchor = read(join(root, 'fixtures/attestation-anchor-v1.json'))
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const flags = ['--publisher-key', fixture.custodianKey, '--anchor-key', anchor.anchor.anchoredBy,
    '--port', String(port), '--yes', '--json', ...(registryDependencies ? [] : ['--no-install'])]
  // After publication, exercise the documented npm create command, including
  // normal dependency installation. Never substitute a local archive here.
  const creationOutput = values.registry
    ? run('npm', ['create', '--yes', `@bsv/dpp-index@${pkg.version}`, project, '--', ...flags], cliConsumer)
    : run(process.execPath, [cli, project, ...flags])
  const created = JSON.parse(creationOutput.trim().split('\n').at(-1))
  assert.equal(created.status, 'created')
  const projectManifest = read(join(project, 'package.json'))
  assert.deepEqual(projectManifest.dependencies, { '@bsv/dpp-overlay-topics': pkg.dpp.packages['@bsv/dpp-overlay-topics'] })
  if (registryDependencies) {
    assert.equal(created.installed, true, 'the starter must install its own runtime dependencies')
    const lock = read(join(project, 'package-lock.json'))
    for (const [name, version] of Object.entries(pkg.dpp.packages)) {
      const installed = lock.packages[`node_modules/${name}`]
      assert.equal(installed?.version, version)
      assert.equal(new URL(installed.resolved).origin, 'https://registry.npmjs.org')
      assert.ok(installed.integrity.startsWith('sha512-'))
      assert.ok(!installed.link)
    }
  } else {
    // Unpublished runtime versions use local archives only in candidate mode.
    for (const [name, path] of Object.entries(packed)) {
      if (name !== pkg.name) projectManifest.dependencies[name] = `file:${path}`
    }
    write(join(project, 'package.json'), projectManifest)
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], project)
  }
  run('npm', ['test'], project)
  assert.ok(!run('npm', ['ls', '--json'], project).includes('link:'))
  say(`${values.registry ? 'the published npm create command' : 'the packed generator'} creates a project outside the repository and its offline checks pass`)
  if (registryDependencies) say('the project installs its exact DPP runtime versions from public npm, with a fresh cache and no local archives')
  assert.equal(run(process.execPath, ['node_modules/@bsv/dpp-overlay-topics/dist/cli.js', '--version'], project).trim(), pkg.dpp.packages['@bsv/dpp-overlay-topics'])
  assert.match(run(process.execPath, ['node_modules/@bsv/dpp-overlay-topics/dist/cli.js', '--help'], project), /env-file/)
  const overlayRequire = createRequire(join(root, 'packages/overlay-topics/package.json'))
  const { MongoMemoryServer } = overlayRequire('mongodb-memory-server')
  const dbPath = join(temp, 'mongo')
  mkdirSync(dbPath)
  mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } })
  const envPath = join(project, '.env')
  writeFileSync(envPath, readFileSync(envPath, 'utf8').replace(/^MONGO_URL=.*$/m, `MONGO_URL=${mongo.getUri()}`), { mode: 0o600 })
  const config = parseEnv(readFileSync(envPath, 'utf8'))
  const url = `http://127.0.0.1:${port}`
  const request = (path, init = {}) => fetch(`${url}${path}`, { ...init, signal: AbortSignal.timeout(5000) })
  const start = async (fixtures = false) => {
    output = ''
    // Use the public runtime command for synthetic fixtures only. The generated
    // start script must refuse that setting, which is checked below.
    const args = fixtures ? ['node_modules/@bsv/dpp-overlay-topics/dist/cli.js', '--env-file', '.env'] : ['scripts/start.mjs']
    child = spawn(process.execPath, args, { cwd: project, env: { ...process.env, ...config, ...(fixtures ? { CHAIN_TRACKER: 'scripts-only' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', bytes => { output += bytes })
    child.stderr.on('data', bytes => { output += bytes })
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Index exited at startup: ${output}`)
      try { if ((await request('/health')).ok) return } catch {}
      await delay(100)
    }
    throw new Error(`Index did not become healthy: ${output}`)
  }
  await start()
  const doctor = JSON.parse(run(process.execPath, ['scripts/doctor.mjs', '--online', '--json'], project))
  assert.equal(doctor.ok, true)
  run(process.execPath, ['scripts/connection.mjs', '--json'], project)
  const app = parseEnv(readFileSync(join(project, '.app.env'), 'utf8'))
  assert.equal(app.INDEX_SUBMIT_TOKEN, config.SUBMIT_TOKEN)
  assert.equal(app.INDEX_CALLBACK_TOKEN, config.ARC_CALLBACK_TOKEN)
  let appClient
  if (values['app-project']) {
    const appProject = resolve(values['app-project'])
    const { IndexClient } = await import(pathToFileURL(join(appProject, 'apps/api/dist/index-client.js')).href)
    appClient = new IndexClient({ url: app.INDEX_URL, submitToken: app.INDEX_SUBMIT_TOKEN, callbackToken: app.INDEX_CALLBACK_TOKEN })
    assert.ok((await appClient.publisherKeys()).includes(fixture.custodianKey))
    assert.equal((await appClient.capabilities()).implementation.version, pkg.dpp.packages['@bsv/dpp-overlay-topics'])
    assert.deepEqual(await appClient.lineage('https://example.org/not-announced'), [])
    assert.equal(await new IndexClient({ url: app.INDEX_URL }).announce([]), 'unauthorised')
    assert.equal(await appClient.announce([]), 'refused')
    say('the generated app client connects with the exported settings and distinguishes missing access from invalid submissions')
  }
  assert.equal((await request('/submit', { method: 'POST' })).status, 401)
  assert.equal((await request('/arc-ingest', { method: 'POST' })).status, 401)
  assert.equal((await request('/evidence-export?passportId=missing')).status, 401)
  assert.equal((await request('/submit', { method: 'POST', headers: { Authorization: `Bearer ${app.INDEX_CALLBACK_TOKEN}` } })).status, 401)
  assert.equal((await request('/arc-ingest', { method: 'POST', headers: { 'X-Callback-Token': app.INDEX_SUBMIT_TOKEN } })).status, 401)
  say('the generated service starts with header checks, matches the app contract and enforces separate token scopes')
  await stop()
  const blocked = spawnSync(process.execPath, ['scripts/start.mjs'], { cwd: project, env: { ...process.env, ...config, CHAIN_TRACKER: 'scripts-only' }, encoding: 'utf8' })
  assert.equal(blocked.status, 1)
  assert.match(blocked.stderr, /synthetic protocol tests/)
  await start(true)
  const { Transaction, MerklePath, LockingScript, UnlockingScript } = createRequire(join(project, 'package.json'))('@bsv/sdk')
  const passport = Transaction.fromHex(fixture.states[0].rawTx)
  passport.merklePath = MerklePath.fromCoinbaseTxidAndHeight(passport.id('hex'), 800000)
  const funding = new Transaction()
  funding.addOutput({ satoshis: 100, lockingScript: LockingScript.fromASM('OP_TRUE') })
  funding.merklePath = MerklePath.fromCoinbaseTxidAndHeight(funding.id('hex'), 800000)
  const attestation = new Transaction()
  attestation.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  attestation.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(anchor.lockingScript) })
  attestation.merklePath = MerklePath.fromCoinbaseTxidAndHeight(attestation.id('hex'), 800000)
  const submit = (tx, topic) => request('/submit', { method: 'POST', headers: { Authorization: `Bearer ${app.INDEX_SUBMIT_TOKEN}`, 'Content-Type': 'application/octet-stream', 'X-Topics': JSON.stringify([topic]) }, body: new Uint8Array(tx.toBEEF()) })
  for (const [tx, topic] of [[passport, 'tm_dpp'], [attestation, 'tm_attestation']]) {
    const response = await submit(tx, topic)
    assert.equal(response.status, 200, await response.text())
    assert.ok(!response.headers.get('x-admission')?.includes('none'), `${topic}: ${response.headers.get('x-admission-refusal')}\n${output}`)
  }
  const lookup = async (service, query) => {
    const response = await request('/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, query }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const before = await lookup('ls_dpp', { passportId: fixture.states[0].data.passportId })
  assert.equal(before.outputs.length, 1)
  if (appClient) assert.deepEqual((await appClient.lineage(fixture.states[0].data.passportId)).map(tx => tx.id('hex')), [passport.id('hex')])
  const beforeAnchor = await lookup('ls_attestation', { digest: anchor.digest })
  assert.equal(beforeAnchor.outputs.length, 1)
  await stop()
  await mongo.stop({ doCleanup: false })
  await mongo.start()
  config.MONGO_URL = mongo.getUri()
  await start(true)
  assert.deepEqual(await lookup('ls_dpp', { passportId: fixture.states[0].data.passportId }), before)
  assert.deepEqual(await lookup('ls_attestation', { digest: anchor.digest }), beforeAnchor)
  if (appClient) {
    assert.deepEqual((await appClient.lineage(fixture.states[0].data.passportId)).map(tx => tx.id('hex')), [passport.id('hex')])
    say('the generated app reads the same synthetic passport from the separate index before and after restart')
  }
  const retry = await submit(passport, 'tm_dpp')
  assert.equal(retry.status, 200)
  assert.match(retry.headers.get('x-admission'), /duplicate/)
  assert.deepEqual(await lookup('ls_dpp', { passportId: fixture.states[0].data.passportId }), before)
  say('passport and anchor data survive index and database restarts; retrying admission is idempotent')
  await stop()
  say('fixture admission used synthetic proofs in a separate process and established no blockchain inclusion')
} finally {
  await stop()
  await mongo?.stop()
  if (process.env.KEEP_INDEX_STARTER === '1') console.log(`Installation evidence and generated project kept at ${temp}`)
  else rmSync(temp, { recursive: true, force: true })
}
