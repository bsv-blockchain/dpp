#!/usr/bin/env node
/**
 * Hold the built dpp-validator image to what it is said to be.
 *
 *   docker build -f packages/dpp-profiles/validator-image/Dockerfile -t dpp-validator:local .
 *   node scripts/validator-image-check.mjs [--image dpp-validator:local] [--record <file>]
 *
 * The image is run twice, each time as the unprivileged node user on a
 * read-only file system with every capability dropped:
 *
 *   1. with no network at all. The checkout is mounted read-only and
 *      scripts/validator-parity.mjs is run inside the container, against
 *      the service on the container's own loopback address. Every vector
 *      must give the answer the engine gives in process. A service that
 *      needed to fetch anything could not pass here;
 *   2. with its port published on this machine's loopback address, and the
 *      same vectors run from outside the container, the way an application
 *      reaches it.
 *
 * Between the two it reads the image: which user and process it runs, what
 * it installed against licence-inventory.json, that the licence files are
 * the repository's, and that no file in it is a rule file of any profile
 * this repository knows or a file GS1 publishes.
 *
 * It needs Docker and a checkout that has been installed and built. It
 * pushes nothing and removes every container it starts. `--record` writes
 * what it measured to a file. Results print one sentence per check, never a
 * score. The exit code is 1 when anything fails.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1] }
const image = option('--image') ?? 'dpp-validator:local'
const record = option('--record')

let failures = 0
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); if (!ok) failures += 1 }
const docker = (argv, options = {}) => spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

if (docker(['image', 'inspect', image]).status !== 0) {
  console.error(`The image ${image} is not here. Build it first:\n  docker build -f packages/dpp-profiles/validator-image/Dockerfile -t ${image} .`)
  process.exit(2)
}
if (!existsSync(join(repo, 'packages', 'dpp-profiles', 'dist', 'validator-client.js')) || !existsSync(join(repo, 'node_modules', 'ajv'))) {
  console.error('This checkout has not been installed and built. Run npm ci and npm run build first.')
  process.exit(2)
}

const inspected = JSON.parse(docker(['image', 'inspect', image]).stdout)[0]
const config = inspected.Config
say(config.User === 'node', `the image runs as ${JSON.stringify(config.User)} unless told otherwise.`)
// The base image's entry point hands over to the command with exec, so the command becomes process 1. That is read from the running container below.
say(JSON.stringify(config.Cmd) === JSON.stringify(['node', 'packages/dpp-profiles/dist/validator-cli.js']), `its command is ${JSON.stringify(config.Cmd)}: node itself, not npm.`)
say(config.Healthcheck?.Test?.join(' ') === 'CMD node packages/dpp-profiles/dist/validator-cli.js health', 'its health check is the command\'s own.')

/** The files this image must not hold: every rule file of every profile in this checkout, and every file GS1 publishes that the packages pin. */
const forbidden = new Map()
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] })
for (const path of [...walk(join(repo, 'packages', 'dpp-profiles', 'bindings')), ...walk(join(repo, 'examples', 'custom-profile')), ...walk(join(repo, 'packages', 'dpp-profiles', 'test', 'fixtures'))]) forbidden.set(sha256(readFileSync(path)), path.slice(repo.length + 1))
for (const table of ['packages/dpp-profiles/src/gs1-artefacts.ts', 'packages/dpp-credentials/src/gs1-artefacts.ts']) {
  for (const [, digest] of readFileSync(join(repo, table), 'utf8').matchAll(/sha256: '([0-9a-f]{64})'/g)) forbidden.set(digest, `a GS1 file pinned in ${table}`)
}

const flags = ['--user', 'node', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true']
const started = []
const name = () => { const made = `dpp-validator-check-${randomBytes(4).toString('hex')}`; started.push(made); return made }
const waitHealthy = async (container) => {
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', container, 'node', 'packages/dpp-profiles/dist/validator-cli.js', 'health']).status === 0) return true
    await sleep(500)
  }
  return false
}
const resultOf = (output) => { const line = output.split('\n').find((l) => l.startsWith('RESULT ')); return line == null ? undefined : JSON.parse(line.slice('RESULT '.length)) }
const repeat = (output) => { for (const line of output.split('\n').filter((l) => /^(Holds|FAILS|Measured):/.test(l))) console.log(`    ${line}`) }

const measured = { image, imageId: inspected.Id, sizeBytes: inspected.Size, base: undefined, node: undefined }
try {
  // 1. No network at all.
  const isolated = name()
  const run = docker(['run', '-d', '--name', isolated, ...flags, '--network', 'none', '-v', `${resolve(repo)}:/checkout:ro`, image])
  say(run.status === 0, `the image starts as the node user, read-only, with no capability and no network${run.status === 0 ? '' : `: ${run.stderr.trim()}`}.`)
  if (run.status !== 0) throw new Error('the container did not start')
  say(await waitHealthy(isolated), 'its health command answers from inside the container.')

  const pid1 = docker(['exec', isolated, 'cat', '/proc/1/cmdline']).stdout.split('\0').filter((part) => part !== '')
  say(pid1[0] === 'node' && pid1[1] === 'packages/dpp-profiles/dist/validator-cli.js', `process 1 is ${pid1.join(' ')}, so a stop signal reaches the service itself.`)
  const uid = docker(['exec', isolated, 'id', '-u']).stdout.trim()
  say(uid === '1000', `it runs as user ${uid}, which is not root.`)
  say(docker(['exec', isolated, 'sh', '-c', 'touch /app/written 2>/dev/null || touch /home/node/written 2>/dev/null']).status !== 0, 'it cannot write to its own file system.')
  measured.node = docker(['exec', isolated, 'node', '--version']).stdout.trim()

  // What the image holds, read by a script run inside it.
  const reader = `
    const fs = require('fs'), path = require('path'), crypto = require('crypto')
    const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : [])
    const files = walk('/app')
    const installed = JSON.parse(fs.readFileSync('/app/node_modules/.package-lock.json', 'utf8')).packages
    const forbidden = new Set(JSON.parse(process.argv[1]))
    console.log(JSON.stringify({
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
      installed: Object.keys(installed).length,
      top: fs.readdirSync('/app').sort(),
      own: walk('/app/packages').sort(),
      digests: Object.fromEntries(['LICENSE', 'NOTICE', 'PATENTS', 'licence-inventory.json', 'package-lock.json', 'package.json'].map((name) => [name, hash('/app/' + name)])),
      noticesBytes: fs.statSync('/app/THIRD-PARTY-NOTICES.txt').size,
      forbidden: files.filter((file) => forbidden.has(hash(file))),
      ruleFilesOutsideLibraries: files.filter((file) => !file.startsWith('/app/node_modules/') && /\\.(ttl|jsonld|shacl|nq|trig)$/.test(file)),
    }))`
  const held = JSON.parse(docker(['exec', isolated, 'node', '-e', reader, JSON.stringify([...forbidden.keys()])]).stdout)
  const inventory = JSON.parse(readFileSync(join(repo, 'packages', 'dpp-profiles', 'validator-image', 'licence-inventory.json'), 'utf8'))
  const local = (path) => sha256(readFileSync(join(repo, path)))
  say(held.installed === inventory.packageCount, `it installed ${held.installed} packages; licence-inventory.json lists ${inventory.packageCount}.`)
  say(held.digests['licence-inventory.json'] === local('packages/dpp-profiles/validator-image/licence-inventory.json') && held.digests['package-lock.json'] === local('packages/dpp-profiles/validator-image/package-lock.json'), 'the inventory and the lockfile inside it are this checkout\'s, byte for byte.')
  say(['LICENSE', 'NOTICE', 'PATENTS'].every((file) => held.digests[file] === local(file)), 'it carries LICENSE, NOTICE and PATENTS, byte for byte.')
  say(held.noticesBytes > 100_000, `it carries THIRD-PARTY-NOTICES.txt, ${held.noticesBytes} bytes, written at build from what was installed.`)
  say(JSON.stringify(held.top) === JSON.stringify(['LICENSE', 'NOTICE', 'PATENTS', 'THIRD-PARTY-NOTICES.txt', 'licence-inventory.json', 'node_modules', 'package-lock.json', 'package.json', 'packages']), `/app holds ${held.top.join(', ')} and nothing else.`)
  say(held.own.length === 8 && held.own.every((file) => /^\/app\/packages\/dpp-profiles\/(package\.json|dist\/(strict-json|validation-engine|validator-[a-z]+)\.js)$/.test(file)), `of the profiles package it holds the manifest and ${held.own.length - 1} built files.`)
  say(held.forbidden.length === 0 && held.ruleFilesOutsideLibraries.length === 0, `none of its ${held.fileCount} files is one of the ${forbidden.size} profile, vector or GS1 files this checkout knows, and it holds no rule file of its own${held.forbidden.length === 0 ? '' : `: ${held.forbidden.join(', ')}`}.`)
  measured.installedPackages = held.installed
  measured.appBytes = held.bytes
  measured.appFiles = held.fileCount
  measured.licences = inventory.licences

  const inside = docker(['exec', isolated, 'node', '/checkout/scripts/validator-parity.mjs', '--url', 'http://127.0.0.1:8090', '--result'])
  repeat(inside.stdout)
  const insideResult = resultOf(inside.stdout)
  say(inside.status === 0 && insideResult?.identical === insideResult?.vectors && insideResult?.vectors > 0, `with no network, every one of the ${insideResult?.vectors ?? 0} vectors gives the answer the engine gives in process${inside.status === 0 ? '' : `: ${inside.stderr.trim().split('\n').at(-1)}`}.`)
  measured.withoutNetwork = insideResult

  const logs = docker(['logs', isolated]).stdout
  const lines = logs.split('\n').filter((line) => line !== '')
  const leaked = ['id.example', 'ref.gs1.org', 'gs1:', 'schema:', 'BTL-0001', 'passports.example'].filter((text) => logs.includes(text))
  say(lines.length > 50 && lines.every((line) => { try { return typeof JSON.parse(line) === 'object' } catch { return false } }) && leaked.length === 0, `its log is ${lines.length} JSON lines, one per request, and repeats nothing from a document${leaked.length === 0 ? '' : `: ${leaked.join(', ')}`}.`)

  const stopStarted = Date.now()
  docker(['stop', '-t', '20', isolated])
  const stopMs = Date.now() - stopStarted
  const exitCode = docker(['inspect', '-f', '{{.State.ExitCode}}', isolated]).stdout.trim()
  say(exitCode === '0' && stopMs < 10_000, `told to stop, it closed and exited with code ${exitCode} in ${stopMs} ms.`)
  measured.stopMs = stopMs
  docker(['rm', '-f', isolated])

  // 2. Reached from outside, as an application reaches it.
  const published = name()
  const second = docker(['run', '-d', '--name', published, ...flags, '-p', '127.0.0.1::8090', image])
  say(second.status === 0, 'the image starts with its port published on this machine\'s loopback address.')
  if (second.status !== 0) throw new Error('the container did not start')
  await waitHealthy(published)
  const port = docker(['port', published, '8090/tcp']).stdout.trim().split('\n')[0].split(':').at(-1)
  const outside = spawnSync(process.execPath, [join(repo, 'scripts', 'validator-parity.mjs'), '--url', `http://127.0.0.1:${port}`, '--result'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  repeat(outside.stdout)
  const outsideResult = resultOf(outside.stdout)
  say(outside.status === 0 && outsideResult?.identical === outsideResult?.vectors && outsideResult?.vectors > 0, `reached from outside the container, every one of the ${outsideResult?.vectors ?? 0} vectors gives the answer the engine gives in process.`)
  measured.fromOutside = outsideResult

  // A stopped service must not read as a pass. One call through the client is enough here; the tests hold every vector to it.
  docker(['stop', '-t', '20', published])
  const { createValidatorClient } = await import(join(repo, 'packages', 'dpp-profiles', 'dist', 'validator-client.js'))
  const afterStop = await createValidatorClient({ url: `http://127.0.0.1:${port}`, timeoutMs: 3000 }).jsonLd.toRdf({ document: {}, contexts: [] })
  say(afterStop.ok === false && (afterStop.reason === 'engine-error' || afterStop.reason === 'timeout'), `once the container is stopped the client answers ${afterStop.ok ? 'a result' : afterStop.reason}, which a validator reports as unknown.`)
} catch (cause) {
  say(false, `the check could not finish: ${cause.message}.`)
} finally {
  for (const container of started) docker(['rm', '-f', container])
}

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`
console.log(`Measured: the image is ${mb(measured.sizeBytes)} as Docker reports it, with ${measured.installedPackages} installed packages in ${measured.appFiles} files and ${mb(measured.appBytes ?? 0)} under /app, on ${measured.node}.`)
if (record != null) {
  writeFileSync(resolve(record), JSON.stringify({ check: 'scripts/validator-image-check.mjs', recordedAt: new Date().toLocaleDateString('en-CA'), docker: execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).trim(), failures, ...measured }, null, 2) + '\n')
  console.log(`Wrote ${record}.`)
}
process.exit(failures === 0 ? 0 : 1)
