#!/usr/bin/env node
/**
 * Delivery parity: the index and the validator service are each one runtime
 * delivered two ways, as npm packages and as images, and this holds the two
 * deliveries to one another.
 *
 *   node scripts/release-candidates.mjs
 *   node scripts/release-images.mjs build --prefix parity- --tag test
 *   node scripts/delivery-parity.mjs --overlay-image parity-dpp-overlay:test --validator-image parity-dpp-validator:test \
 *     [--npm-runtime host|image] [--record <file>] [--project <name>] [--keep]
 *
 * What it does, in order:
 *
 *   1. Reads the labels of both images and holds them to the release set and
 *      to the packed candidates: the same source revision and state, the
 *      same release set, the same package versions, the Node version the
 *      set records. Then it compares the built files inside each image with
 *      the files of the packed package, digest for digest, because one
 *      runtime means the same bytes and not only the same version number.
 *   2. Makes clean consumers outside this checkout from the packed
 *      candidates: one with the protocol package alone, one with the index
 *      and what it depends on, one application with the profiles package and
 *      no engine library, and one that also installs the engine libraries
 *      and runs the dpp-validator command.
 *   3. Starts the index twice over a database each: from the index consumer
 *      with its dpp-index command, and from the operator preset,
 *      deploy/compose.yml, with the built images pinned by digest. The same
 *      settings go to both.
 *   4. Asks both the same things (scripts/lib/index-contract.mjs): the
 *      configuration each refuses at start, the contract over HTTP with a
 *      write refused until a token is issued, the evidence exports, a stop
 *      and start of the index and its database, a restore of one index's
 *      passport into the other from its evidence package, and a database
 *      that goes away and comes back. What the two answered is compared.
 *   5. Runs every profile vector (scripts/validator-parity.mjs) through the
 *      application consumer's validator client against the preset's
 *      validator service and against the dpp-validator command, then against
 *      a second implementation of the contract, then with no service at all.
 *
 * `--npm-runtime host` runs the npm consumers with the Node on this machine,
 * which is what a developer does and what continuous integration does on the
 * pinned Node version. `--npm-runtime image` runs them inside the base image
 * the release set records, so both deliveries run on the same Node version
 * wherever this is run; the consumer's files are still installed from the
 * packed candidates and nothing of the index image is used. With the image
 * runtime the vectors reach the preset's validator as a container that
 * joined its validation network; with the host runtime they reach it through
 * deploy/compose.validator-port.yml, which publishes its port on purpose.
 *
 * The preset pins its images by digest. A locally built image has a digest
 * of its own where Docker keeps images in the containerd store, and then
 * the preset is started exactly as an operator starts it, with that digest.
 * Where Docker has no digest for a local image, the build file
 * deploy/compose.build.yml names the same images by their local tag
 * instead, and the record says which of the two was run.
 *
 * It needs Docker with Compose, network access for npm and for the pinned
 * MongoDB image, and a checkout that has been installed, built and packed.
 * It pushes nothing. It removes every container, network, volume and image
 * tag it creates, unless `--keep` is given; it leaves the images it was
 * handed, and the MongoDB image Docker pulled. Results print one sentence
 * per check, never a score. The exit code is 1 when anything fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, cpSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { verifyCandidates, verifyRecordAgainstSet } from './lib/candidates.mjs'
import { NPM_REGISTRY } from './lib/publication.mjs'
import { DIGEST, docker, imagesOf, inspectImage, labelFindings, thirdPartyReference } from './lib/images.mjs'
import { KEYS, askIndex, buildStates, restoreFromPackage, runAfterRestart, runIndexContract } from './lib/index-contract.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1] }
const keep = args.includes('--keep')
const npmRuntime = option('--npm-runtime') ?? 'host'
if (!['host', 'image'].includes(npmRuntime)) { console.error('--npm-runtime is host or image'); process.exit(2) }
const project = option('--project') ?? `dpp-parity-${randomBytes(3).toString('hex')}`
if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) { console.error('--project is lower-case letters, digits and hyphens'); process.exit(2) }
const recordPath = option('--record')

let failures = 0
const sentences = []
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); sentences.push({ ok: ok === true, sentence }); if (!ok) failures += 1; return ok === true }
const section = (title) => console.log(`\n${title}`)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const run = (command, argv, options = {}) => spawnSync(command, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
const freePort = () => new Promise((done, fail) => { const server = createServer(); server.once('error', fail); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)) }) })
const until = async (probe, seconds, every = 500) => { const end = Date.now() + seconds * 1000; for (;;) { try { if (await probe()) return true } catch { /* not yet */ } if (Date.now() > end) return false; await sleep(every) } }
const healthy = (base, path = '/health') => until(async () => (await fetch(`${base}${path}`, { signal: AbortSignal.timeout(2000) })).status === 200, 90)
const resultOf = (output) => { const line = output.split('\n').find((l) => l.startsWith('RESULT ')); return line == null ? undefined : JSON.parse(line.slice('RESULT '.length)) }
const repeat = (output) => { for (const line of output.split('\n').filter((l) => /^(Holds|FAILS|Measured):/.test(l))) console.log(`    ${line}`) }

// ---------------------------------------------------------------- what is being compared

if (!existsSync(join(repo, 'release', 'candidates.json'))) { console.error('There are no packed candidates. Run node scripts/release-candidates.mjs first.'); process.exit(2) }
const record = JSON.parse(readFileSync(join(repo, 'release', 'candidates.json'), 'utf8'))
const setBytes = readFileSync(join(repo, record.releaseSetPath))
const set = JSON.parse(setBytes.toString('utf8'))
const images = imagesOf(set)
const candidateDir = join(repo, 'release', 'candidates')
const stale = [...verifyRecordAgainstSet(record, set, setBytes), ...verifyCandidates(record, candidateDir)].filter((f) => !f.ok)
if (stale.length > 0) { console.error(`The packed candidates are not the recorded bytes of this release set:\n${stale.map((f) => `  ${f.sentence}`).join('\n')}\nRun node scripts/release-candidates.mjs again.`); process.exit(2) }
const overlayImage = images.own.find((i) => i.service === 'overlay')
const validatorImage = images.own.find((i) => i.service === 'validator')
const given = { [overlayImage.name]: option('--overlay-image'), [validatorImage.name]: option('--validator-image') }
for (const [name, reference] of Object.entries(given)) {
  if (reference == null) { console.error(`Name the built ${name} image. Build both with:\n  node scripts/release-images.mjs build --prefix parity- --tag test`); process.exit(2) }
  if (inspectImage(reference) == null) { console.error(`Docker does not hold ${reference}. Build it with node scripts/release-images.mjs build.`); process.exit(2) }
}
const mongo = images.thirdParty.find((entry) => entry.service === 'mongo')
const mongoReference = thirdPartyReference(mongo)
const tarball = (name) => join(candidateDir, record.candidates.find((c) => c.name === name).filename)
const version = (name) => record.candidates.find((c) => c.name === name).version
const engineLibraries = (await import(pathToFileURL(join(repo, 'packages', 'dpp-profiles', 'dist', 'validation-engine.js')).href)).VALIDATION_ENGINE_LIBRARIES

const created = { containers: [], networks: [], volumes: [], tags: [], children: [], composeProjects: [], directories: [] }
const measured = { limits: {} }
const facts = {}

// ---------------------------------------------------------------- the two ways the npm consumers run

const nodeImage = overlayImage.runtime.baseImage
const uid = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
const cleanEnvironment = (settings) => ({ PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), ...settings })
const environmentFlags = (settings) => Object.entries(settings).flatMap(([name, value]) => ['-e', `${name}=${value}`])

/** Install packed candidates, and anything else named, into a new project outside this checkout. */
function makeConsumer(label, specs) {
  // The real path, so that a bind mount of it is the same folder on every platform.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${project}-${label}-`)))
  created.directories.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `dpp-parity-${label}`, private: true, type: 'module', version: '0.0.0' }, null, 2))
  const install = ['install', '--save-exact', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', NPM_REGISTRY]
  const result = npmRuntime === 'host'
    ? run('npm', [...install, '--cache', join(dir, '.npm-cache'), ...specs], { cwd: dir, env: cleanEnvironment({}) })
    : docker(['run', '--rm', ...uid, '-e', 'HOME=/tmp', '-e', 'npm_config_cache=/tmp/npm-cache', '-v', `${dir}:/consumer`, '-v', `${candidateDir}:/candidates:ro`, '-w', '/consumer', nodeImage, 'npm', ...install, ...specs.map((spec) => (spec.startsWith(candidateDir) ? `/candidates/${spec.slice(candidateDir.length + 1)}` : spec))])
  if (result.status !== 0) throw new Error(`the ${label} consumer did not install: ${(result.stderr || result.stdout).trim().split('\n').slice(-6).join(' | ')}`)
  const installed = (name) => { const path = join(dir, 'node_modules', ...name.split('/'), 'package.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).version : undefined }
  return { label, dir, installed, has: (name) => installed(name) != null }
}

/** Run one command of a consumer to its end: `{ status, output }`. */
function once(consumer, bin, argv, settings, network) {
  const result = npmRuntime === 'host'
    ? run(join(consumer.dir, 'node_modules', '.bin', bin), argv, { cwd: consumer.dir, env: cleanEnvironment(settings), timeout: 120_000 })
    : docker(['run', '--rm', ...uid, ...(network == null ? [] : ['--network', network]), ...environmentFlags(settings), '-v', `${consumer.dir}:/consumer:ro`, '-w', '/consumer', nodeImage, `node_modules/.bin/${bin}`, ...argv], { timeout: 120_000 })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/**
 * Start a consumer's command as a service. `settings(host, port)` gives its
 * environment. Returns the address this machine reaches it at, the address
 * a container on `network` reaches it at, and how to stop it.
 */
async function startService({ name, consumer, bin, settings, containerPort, network, ready = '/health' }) {
  if (npmRuntime === 'host') {
    const port = await freePort()
    const logs = []
    const child = spawn(join(consumer.dir, 'node_modules', '.bin', bin), [], { cwd: consumer.dir, env: cleanEnvironment(settings('127.0.0.1', port)), stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => logs.push(chunk.toString('utf8')))
    child.stderr.on('data', (chunk) => logs.push(chunk.toString('utf8')))
    created.children.push(child)
    const base = `http://127.0.0.1:${port}`
    const stop = async () => { if (child.exitCode != null) return child.exitCode; const ended = new Promise((done) => child.once('exit', (code) => done(code))); child.kill('SIGTERM'); return ended }
    if (!(await healthy(base, ready))) { await stop(); throw new Error(`${name} did not answer ${ready}: ${logs.join('').trim().split('\n').slice(-5).join(' | ')}`) }
    return { base, internal: base, stop, logs: () => logs.join('') }
  }
  const started = docker(['run', '-d', '--name', name, ...uid, '--network', network, '-p', `127.0.0.1::${containerPort}`, ...environmentFlags(settings('0.0.0.0', containerPort)), '-v', `${consumer.dir}:/consumer:ro`, '-w', '/consumer', nodeImage, `node_modules/.bin/${bin}`])
  if (started.status !== 0) throw new Error(`${name} did not start: ${started.stderr.trim()}`)
  created.containers.push(name)
  const port = docker(['port', name, `${containerPort}/tcp`]).stdout.trim().split('\n')[0].split(':').at(-1)
  const base = `http://127.0.0.1:${port}`
  const stop = async () => { docker(['stop', '-t', '30', name]); const code = Number(docker(['inspect', '-f', '{{.State.ExitCode}}', name]).stdout.trim()); docker(['rm', '-f', name]); return code }
  if (!(await healthy(base, ready))) { const logs = docker(['logs', name]); await stop(); throw new Error(`${name} did not answer ${ready}: ${`${logs.stdout}${logs.stderr}`.trim().split('\n').slice(-5).join(' | ')}`) }
  return { base, internal: `http://${name}:${containerPort}`, stop, logs: () => { const logs = docker(['logs', name]); return `${logs.stdout}${logs.stderr}` } }
}

/** Run scripts/validator-parity.mjs with the application consumer's client: on this machine against `target.base`, or in a container on `target.network` against `target.internal`. */
function vectors(application, target, flags = [], container) {
  const token = target.token == null ? [] : ['--token', target.token]
  if (npmRuntime === 'host') return run(process.execPath, [join(repo, 'scripts', 'validator-parity.mjs'), '--url', target.base, ...token, '--package', join(application.dir, 'node_modules', '@bsv', 'dpp-profiles'), '--result', ...flags])
  const script = ['node', '/checkout/scripts/validator-parity.mjs', '--url', target.internal, ...token, '--package', '/consumer/node_modules/@bsv/dpp-profiles', '--result', ...flags]
  if (container != null) return docker(['exec', container, ...script])
  return docker(['run', '--rm', ...uid, ...(target.network == null ? [] : ['--network', target.network]), '-v', `${resolve(repo)}:/checkout:ro`, '-v', `${application.dir}:/consumer:ro`, nodeImage, ...script])
}

// ---------------------------------------------------------------- the preset

const compose = (files, envFiles, argv, options = {}) => docker(['compose', '-p', options.project ?? project, ...files.flatMap((f) => ['-f', join(repo, f)]), ...envFiles.flatMap((f) => ['--env-file', f]), ...argv], options.spawn ?? {})
const exampleEnvironment = () => Object.fromEntries(readFileSync(join(repo, 'deploy', 'operator.env.example'), 'utf8').split('\n').filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)).map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
const writeEnvironment = (path, values) => { writeFileSync(path, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n') + '\n'); return path }

// ---------------------------------------------------------------- the run

const work = realpathSync(mkdtempSync(join(tmpdir(), `${project}-work-`)))
created.directories.push(work)
const recordedSource = { revision: record.sourceRevision, state: record.sourceState }
let npmIndex, npmValidator, standIn, mongoNpm
try {
  // 1. The images name what the npm candidates name.
  section('The images and the packed candidates name the same release')
  for (const image of [overlayImage, validatorImage]) {
    const { findings, facts: read } = labelFindings(set, image, given[image.name], recordedSource)
    for (const finding of findings) say(finding.ok, finding.sentence)
    facts[image.name] = read
  }
  say(record.releaseSet === set.releaseSet && record.candidates.every((c) => set.packages.some((p) => p.name === c.name && p.version === c.version)), `the packed candidates are ${record.candidates.map((c) => `${c.name}@${c.version}`).join(', ')} of ${record.releaseSet}, packed from ${record.sourceRevision.slice(0, 12)} (${record.sourceState}).`)

  // 2. Clean consumers.
  section('Clean consumers, installed from the packed candidates outside this checkout')
  const protocolOnly = makeConsumer('protocol', [tarball('@bsv/dpp-protocol')])
  const index = makeConsumer('index', [tarball('@bsv/dpp-protocol'), tarball('@bsv/dpp-profiles'), tarball('@bsv/dpp-overlay')])
  const application = makeConsumer('application', [tarball('@bsv/dpp-profiles')])
  const validatorConsumer = makeConsumer('validator', [tarball('@bsv/dpp-profiles'), ...Object.entries(engineLibraries).map(([name, v]) => `${name}@${v}`)])
  const engineNames = Object.keys(engineLibraries)
  const others = (consumer, names) => names.filter((name) => consumer.has(name))
  say(protocolOnly.installed('@bsv/dpp-protocol') === version('@bsv/dpp-protocol') && others(protocolOnly, ['@bsv/dpp-profiles', '@bsv/dpp-overlay', '@bsv/dpp-credentials', 'mongodb', ...engineNames]).length === 0, `the protocol-only consumer holds @bsv/dpp-protocol@${protocolOnly.installed('@bsv/dpp-protocol')} and no other package of the set, no database driver and no engine library.`)
  cpSync(join(repo, 'examples', 'lifecycle-v2.mjs'), join(protocolOnly.dir, 'lifecycle-v2.mjs'))
  const lifecycle = npmRuntime === 'host'
    ? run(process.execPath, ['lifecycle-v2.mjs'], { cwd: protocolOnly.dir, env: cleanEnvironment({}) })
    : docker(['run', '--rm', ...uid, '--network', 'none', '-v', `${protocolOnly.dir}:/consumer:ro`, '-w', '/consumer', nodeImage, 'node', 'lifecycle-v2.mjs'])
  say(lifecycle.status === 0, `the protocol-only consumer issues, updates, transfers and retires a passport and verifies each step offline, with no index, no validator service and no engine library${lifecycle.status === 0 ? '' : `: ${lifecycle.stderr.trim().split('\n').at(-1)}`}.`)
  say(index.installed('@bsv/dpp-overlay') === version('@bsv/dpp-overlay') && others(index, ['@bsv/dpp-credentials', ...engineNames]).length === 0, `the index consumer holds @bsv/dpp-overlay@${index.installed('@bsv/dpp-overlay')} with the two packages it depends on, and neither the credentials package nor any engine library${others(index, ['@bsv/dpp-credentials', ...engineNames]).length === 0 ? '' : `, but it has ${others(index, ['@bsv/dpp-credentials', ...engineNames]).join(', ')}`}.`)
  say(application.installed('@bsv/dpp-profiles') === version('@bsv/dpp-profiles') && others(application, engineNames).length === 0, `the application consumer holds @bsv/dpp-profiles@${application.installed('@bsv/dpp-profiles')} and no engine library: its validation engine is a client and an address.`)
  say(engineNames.every((name) => validatorConsumer.installed(name) === engineLibraries[name]), `the validator consumer adds the engine libraries the adapter is tested with: ${engineNames.map((name) => `${name}@${validatorConsumer.installed(name)}`).join(', ')}.`)
  const npmNode = npmRuntime === 'host' ? process.version : docker(['run', '--rm', nodeImage, 'node', '--version']).stdout.trim()
  facts.npm = { runtime: npmRuntime, node: npmNode, ...(npmRuntime === 'image' ? { image: nodeImage } : {}) }

  // The same runtime means the same files, not only the same version number.
  section('The files inside each image are the files of the packed packages')
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path] }) : [])
  const digestsOf = (dir) => Object.fromEntries(walk(dir).map((path) => [path.slice(dir.length + 1), sha256(readFileSync(path))]))
  const insideReader = `const fs=require('fs'),path=require('path'),crypto=require('crypto');const walk=(d)=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]):[];const out={};for(const dir of JSON.parse(process.argv[1])){out[dir]=Object.fromEntries(walk(dir).map((f)=>[f.slice(dir.length+1),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))};const versions={};for(const m of JSON.parse(process.argv[2])){try{versions[m]=JSON.parse(fs.readFileSync(path.join(process.argv[3],'node_modules',m,'package.json'),'utf8')).version}catch{versions[m]=null}};console.log(JSON.stringify({out,versions,node:process.version}))`
  const readImage = (reference, dirs, modules, rootDir) => JSON.parse(docker(['run', '--rm', '--network', 'none', '--entrypoint', 'node', reference, '-e', insideReader, JSON.stringify(dirs), JSON.stringify(modules), rootDir]).stdout.trim().split('\n').at(-1))
  const runtimeNames = set.runtime.dependencies.map((d) => d.name)
  const inOverlay = readImage(given[overlayImage.name], ['/repo/packages/dpp-overlay/dist', '/repo/packages/dpp-protocol/dist', '/repo/packages/dpp-profiles/dist', '/repo/packages/dpp-protocol/schemas'], [...runtimeNames, '@bsv/dpp-protocol', '@bsv/dpp-profiles', '@bsv/dpp-overlay'], '/repo')
  let filesCompared = 0
  for (const [pkg, inside, part] of [['@bsv/dpp-overlay', '/repo/packages/dpp-overlay/dist', 'dist'], ['@bsv/dpp-protocol', '/repo/packages/dpp-protocol/dist', 'dist'], ['@bsv/dpp-profiles', '/repo/packages/dpp-profiles/dist', 'dist'], ['@bsv/dpp-protocol', '/repo/packages/dpp-protocol/schemas', 'schemas']]) {
    const packed = digestsOf(join(index.dir, 'node_modules', ...pkg.split('/'), part))
    const held = inOverlay.out[inside]
    const differing = [...new Set([...Object.keys(packed), ...Object.keys(held)])].filter((file) => packed[file] !== held[file])
    filesCompared += Object.keys(packed).length
    say(Object.keys(packed).length > 0 && differing.length === 0, `the ${Object.keys(held).length} files of ${pkg} ${part}/ in the index image are the ${Object.keys(packed).length} files of the packed package, byte for byte${differing.length === 0 ? '' : `; these differ: ${differing.slice(0, 6).join(', ')}`}.`)
  }
  const inValidator = readImage(given[validatorImage.name], ['/app/packages/dpp-profiles/dist'], engineNames, '/app')
  const validatorFiles = inValidator.out['/app/packages/dpp-profiles/dist']
  const packedProfiles = digestsOf(join(application.dir, 'node_modules', '@bsv', 'dpp-profiles', 'dist'))
  const validatorDiffering = Object.keys(validatorFiles).filter((file) => packedProfiles[file] !== validatorFiles[file])
  filesCompared += Object.keys(validatorFiles).length
  say(Object.keys(validatorFiles).length > 0 && validatorDiffering.length === 0, `the ${Object.keys(validatorFiles).length} built files in the validator image are the same-named files of the packed @bsv/dpp-profiles, byte for byte${validatorDiffering.length === 0 ? '' : `; these differ: ${validatorDiffering.join(', ')}`}.`)
  say(engineNames.every((name) => inValidator.versions[name] === engineLibraries[name] && validatorConsumer.installed(name) === engineLibraries[name]), `the validator image and the validator consumer both run ${engineNames.map((name) => `${name}@${inValidator.versions[name]}`).join(', ')}.`)
  const dependencyRows = runtimeNames.map((name) => ({ name, set: set.runtime.dependencies.find((d) => d.name === name).version, image: inOverlay.versions[name], npm: index.installed(name) ?? null }))
  for (const row of dependencyRows) say(row.image === row.set && (row.npm === row.set || row.npm == null), `${row.name}: the release set names ${row.set}, the index image has ${row.image} and the index consumer has ${row.npm ?? 'none, because it is not a dependency of the index path'}.`)
  for (const name of ['@bsv/dpp-protocol', '@bsv/dpp-profiles', '@bsv/dpp-overlay']) say(inOverlay.versions[name] === version(name) || inOverlay.versions[name] === null, `${name}: the index image ${inOverlay.versions[name] == null ? 'links the workspace build' : `has ${inOverlay.versions[name]}`} and the candidates have ${version(name)}.`)
  say(inOverlay.node === `v${overlayImage.runtime.node}` && inValidator.node === `v${validatorImage.runtime.node}`, `both images run Node ${inOverlay.node}; the npm consumers ran on Node ${npmNode}${npmNode === inOverlay.node ? ', the same version' : `, which the set's range ${set.runtime.node} admits and which is not the image's version`}.`)
  // The image installs from the repository's lockfile and a consumer resolves each range on the day it installs, so a
  // dependency the packages name by range can differ. What differs today is measured and recorded, not hidden.
  const lockedInImage = JSON.parse(docker(['run', '--rm', '--network', 'none', '--entrypoint', 'cat', given[overlayImage.name], '/repo/node_modules/.package-lock.json']).stdout).packages
  const lockedInConsumer = JSON.parse(readFileSync(join(index.dir, 'package-lock.json'), 'utf8')).packages
  const versionsOf = (packages) => { const versions = new Map(); for (const [path, entry] of Object.entries(packages)) { if (!path.startsWith('node_modules/') || path.slice('node_modules/'.length).includes('node_modules/') || entry.link === true) continue; versions.set(path.slice('node_modules/'.length), entry.version) } return versions }
  const imageVersions = versionsOf(lockedInImage)
  const consumerVersions = versionsOf(lockedInConsumer)
  const shared = [...consumerVersions.keys()].filter((name) => imageVersions.has(name) && !name.startsWith('@bsv/dpp-'))
  const drift = shared.filter((name) => imageVersions.get(name) !== consumerVersions.get(name)).map((name) => ({ name, image: imageVersions.get(name), npm: consumerVersions.get(name) }))
  const consumerOnly = [...consumerVersions.keys()].filter((name) => !imageVersions.has(name) && !name.startsWith('@bsv/dpp-'))
  console.log(`Measured: of the ${shared.length} third-party packages installed at the top level of both, ${shared.length - drift.length} are at the same version in the index image and in the index consumer${drift.length === 0 ? '' : `; these differ, each within the range its dependant names: ${drift.map((d) => `${d.name} (image ${d.image}, npm ${d.npm})`).join(', ')}`}.${consumerOnly.length === 0 ? '' : ` The consumer also has ${consumerOnly.length} the image does not: ${consumerOnly.slice(0, 8).join(', ')}.`}`)
  facts.filesCompared = filesCompared
  facts.runtimeDependencies = dependencyRows
  facts.thirdPartyPackages = { inBoth: shared.length, sameVersion: shared.length - drift.length, differing: drift, onlyInConsumer: consumerOnly }

  // 3. The two indexes.
  section('The same index, started from the npm consumer and from the operator preset')
  const modules = await import(pathToFileURL((() => { writeFileSync(join(index.dir, 'parity-modules.mjs'), "export * as sdk from '@bsv/sdk'\nexport * as protocol from '@bsv/dpp-protocol'\nexport * as overlay from '@bsv/dpp-overlay'\n"); return join(index.dir, 'parity-modules.mjs') })()).href)
  const states = await buildStates(modules, ['npm', 'image'])
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
  addFormats(ajv)
  const schema = (path) => JSON.parse(readFileSync(path, 'utf8'))
  ajv.addSchema(schema(join(repo, 'contracts', 'evidence-package.schema.json')))
  const validators = {
    capabilities: ajv.compile(schema(join(repo, 'contracts', 'capabilities.schema.json'))),
    evidencePackage: ajv.getSchema(schema(join(repo, 'contracts', 'evidence-package.schema.json')).$id),
    history: ajv.compile(schema(join(repo, 'contracts', 'paginated-history.schema.json'))),
    // The complete export's schema is the package's own, read from the installed package.
    evidenceExport: ajv.compile(schema(join(index.dir, 'node_modules', '@bsv', 'dpp-overlay', 'schemas', 'evidence-export.schema.json'))),
  }
  const exportToken = randomBytes(24).toString('hex')
  // Every setting both indexes are given. Only where each finds its database and its port differs.
  const settings = {
    SERVICE_IDENTITY_KEY: states.publisherKey,
    NETWORK: 'test',
    CHAIN_TRACKER: 'scripts-only',
    ACCEPTANCE_COMMITMENT: 'required',
    MONGO_DB: 'dpp',
    EXPORTER_PRIVATE_KEY: KEYS.exporter,
    EXPORT_TOKEN: exportToken,
    PUBLIC_URL: 'http://index.parity.example',
  }

  // The npm path: a database of its own from the same pinned image, and the dpp-index command.
  const npmNetwork = `${project}-npm`
  if (docker(['network', 'create', npmNetwork]).status !== 0) throw new Error('the npm path\'s network could not be created')
  created.networks.push(npmNetwork)
  const npmVolume = `${project}-npm-mongo-data`
  created.volumes.push(npmVolume)
  mongoNpm = `${project}-npm-mongo`
  // One port for the life of the run, so the index finds its database again after the container is stopped and started.
  const mongoPort = await freePort()
  const startMongoNpm = () => {
    const started = docker(['run', '-d', '--name', mongoNpm, '--network', npmNetwork, '-p', `127.0.0.1:${mongoPort}:27017`, '-v', `${npmVolume}:/data/db`, mongoReference, 'mongod', '--bind_ip_all'])
    if (started.status !== 0) throw new Error(`the npm path's MongoDB did not start: ${started.stderr.trim()}`)
    if (!created.containers.includes(mongoNpm)) created.containers.push(mongoNpm)
  }
  const mongoReady = (container) => until(() => docker(['exec', container, 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 }).ok']).stdout.trim() === '1', 120, 1000)
  startMongoNpm()
  if (!(await mongoReady(mongoNpm))) throw new Error('the npm path\'s MongoDB did not become ready')
  const npmSettings = () => ({ ...settings, MONGO_URL: npmRuntime === 'host' ? `mongodb://127.0.0.1:${mongoPort}` : `mongodb://${mongoNpm}:27017` })
  const startNpmIndex = () => startService({ name: `${project}-npm-index`, consumer: index, bin: 'dpp-index', containerPort: 8080, network: npmNetwork, settings: (host, port) => ({ ...npmSettings(), HOST: host, PORT: String(port) }) })
  npmIndex = await startNpmIndex()
  say(true, `the index consumer's dpp-index command is serving at ${npmIndex.base}, over a MongoDB of its own from ${mongo.repository}:${mongo.tag}.`)

  // The image path: the preset, as an operator starts it.
  // Images given as `registry/name@sha256:…` were pulled by a registry digest, and the preset is pinned to exactly
  // that. Images given by a local tag are named under a registry that cannot exist and pinned by their own digest.
  const registryPins = [overlayImage, validatorImage].map((image) => new RegExp(`^(.+)/${image.name}@(sha256:[0-9a-f]{64})$`).exec(given[image.name]))
  const fromRegistry = registryPins.every((match) => match != null) && registryPins[0][1] === registryPins[1][1]
  const testRegistry = fromRegistry ? registryPins[0][1] : `dpp-parity.invalid/${project}`
  const pins = {}
  for (const [index, image] of [overlayImage, validatorImage].entries()) {
    if (fromRegistry) { pins[image.name] = { id: registryPins[index][2], resolvable: true }; continue }
    const local = inspectImage(given[image.name])
    const tag = `${testRegistry}/${image.name}:parity`
    if (docker(['tag', given[image.name], tag]).status === 0) created.tags.push(tag)
    pins[image.name] = { id: local.id, resolvable: DIGEST.test(local.id) && inspectImage(`${testRegistry}/${image.name}@${local.id}`) != null }
  }
  const pinnedByDigest = Object.values(pins).every((pin) => pin.resolvable)
  const overlayPort = await freePort()
  const presetEnvironment = { ...exampleEnvironment(), ...settings, OVERLAY_PORT: `127.0.0.1:${overlayPort}` }
  let presetFiles
  let presetEnvFiles
  if (pinnedByDigest) {
    presetFiles = ['deploy/compose.yml']
    presetEnvFiles = [writeEnvironment(join(work, 'operator.env'), { ...presetEnvironment, DPP_IMAGE_REGISTRY: testRegistry, [overlayImage.digestVariable]: pins[overlayImage.name].id, [validatorImage.digestVariable]: pins[validatorImage.name].id })]
  } else {
    presetFiles = ['deploy/compose.yml', 'deploy/compose.build.yml']
    presetEnvFiles = [writeEnvironment(join(work, 'operator.env'), { ...presetEnvironment, OVERLAY_LOCAL_IMAGE: given[overlayImage.name], VALIDATOR_LOCAL_IMAGE: given[validatorImage.name] }), join(repo, 'deploy', 'build.env')]
  }
  facts.preset = { form: fromRegistry ? 'pinned-by-registry-digest' : pinnedByDigest ? 'pinned-by-local-digest' : 'build-file-with-local-tags', files: presetFiles, registry: fromRegistry ? testRegistry : null }
  created.composeProjects.push({ project, files: presetFiles, envFiles: presetEnvFiles })
  const presetCompose = (argv, options) => compose(presetFiles, presetEnvFiles, argv, options)
  const up = presetCompose(['up', '-d', '--wait', '--no-build', 'overlay'])
  if (up.status !== 0) throw new Error(`the preset did not start: ${up.stderr.trim().split('\n').slice(-6).join(' | ')}`)
  const imageBase = `http://127.0.0.1:${overlayPort}`
  if (!(await healthy(imageBase))) throw new Error('the preset\'s index did not answer /health')
  const running = () => presetCompose(['ps', '--format', '{{.Service}}']).stdout.trim().split('\n').filter((line) => line !== '').sort()
  say(pinnedByDigest, pinnedByDigest
    ? `the preset is started as an operator starts it, from deploy/compose.yml alone, with ${overlayImage.name} and ${validatorImage.name} pinned by ${fromRegistry ? `the digests ${testRegistry} serves` : 'the digests of the locally built images'} (${pins[overlayImage.name].id.slice(0, 19)}… and ${pins[validatorImage.name].id.slice(0, 19)}…).`
    : 'this Docker has no digest for a locally built image, so the preset could not be started from a digest; deploy/compose.build.yml named the images by local tag instead, which is the contributor\'s start and not the operator\'s.')
  say(isDeepStrictEqual(running(), ['mongo', 'overlay']), `started by name, the index runs with its database and without the validator service: the preset is running ${running().join(' and ')}.`)
  const overlayContainer = presetCompose(['ps', '-q', 'overlay']).stdout.trim()
  const hardening = (container) => { const [c] = JSON.parse(docker(['inspect', container]).stdout); return { user: c.Config.User, readOnly: c.HostConfig.ReadonlyRootfs, capDrop: c.HostConfig.CapDrop, securityOpt: c.HostConfig.SecurityOpt, init: c.HostConfig.Init, networks: Object.keys(c.NetworkSettings.Networks).sort(), ports: Object.entries(c.NetworkSettings.Ports ?? {}).filter(([, bound]) => bound != null).map(([port]) => port), image: c.Config.Image } }
  const overlayHardening = hardening(overlayContainer)
  say(overlayHardening.user === 'node' && overlayHardening.readOnly === true && isDeepStrictEqual(overlayHardening.capDrop, ['ALL']) && overlayHardening.securityOpt.includes('no-new-privileges:true') && overlayHardening.init === true, 'the index container runs as the node user on a read-only file system, with no capability, no new privileges and an init.')

  const paths = {
    npm: {
      label: 'the npm consumer',
      base: () => npmIndex.base,
      boot: (extra) => once(index, 'dpp-index', [], { ...npmSettings(), HOST: '127.0.0.1', PORT: '0', ...extra }, npmNetwork),
      cli: (argv) => once(index, 'dpp-index', argv, npmSettings(), npmNetwork),
      restart: async () => {
        const code = await npmIndex.stop()
        // The container goes, with the unnamed volume its image declares; the named data volume stays.
        docker(['stop', '-t', '30', mongoNpm]); docker(['rm', '-f', '-v', mongoNpm])
        startMongoNpm()
        if (!(await mongoReady(mongoNpm))) throw new Error('the npm path\'s MongoDB did not come back')
        npmIndex = await startNpmIndex()
        return code
      },
      stopDatabase: () => docker(['stop', '-t', '30', mongoNpm]),
      startDatabase: async () => { docker(['start', mongoNpm]); await mongoReady(mongoNpm) },
    },
    image: {
      label: 'the preset',
      base: () => imageBase,
      boot: (extra) => {
        const env = writeEnvironment(join(work, `refusal-${randomBytes(3).toString('hex')}.env`), { ...Object.fromEntries(readFileSync(presetEnvFiles[0], 'utf8').trim().split('\n').map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] })), ...extra })
        const result = compose(presetFiles, [env, ...presetEnvFiles.slice(1)], ['run', '--rm', '--no-deps', '-T', 'overlay'], { spawn: { timeout: 120_000 } })
        return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
      },
      cli: (argv) => { const result = presetCompose(['exec', '-T', 'overlay', 'node', 'packages/dpp-overlay/dist/cli.js', ...argv]); return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` } },
      restart: async () => {
        // The containers are stopped and removed, with the unnamed volumes their images declare; the named data
        // volume stays, and up makes new containers over it.
        const down = presetCompose(['rm', '--stop', '--force', '--volumes'])
        if (down.status !== 0) throw new Error(`the preset did not stop: ${down.stderr.trim()}`)
        const again = presetCompose(['up', '-d', '--wait', '--no-build', 'overlay'])
        if (again.status !== 0) throw new Error(`the preset did not start again: ${again.stderr.trim().split('\n').slice(-4).join(' | ')}`)
        if (!(await healthy(imageBase))) throw new Error('the preset\'s index did not answer /health after the restart')
        return 0
      },
      stopDatabase: () => presetCompose(['stop', 'mongo']),
      startDatabase: async () => { presetCompose(['start', 'mongo']); await mongoReady(presetCompose(['ps', '-q', 'mongo']).stdout.trim()) },
    },
  }

  // 4a. What each refuses at start.
  section('Configuration each index refuses at start')
  const refusalCases = [
    ['no identity key', { SERVICE_IDENTITY_KEY: '', SERVER_PRIVATE_KEY: '' }, 'Set SERVICE_IDENTITY_KEY (or SERVER_PRIVATE_KEY) so admission can be checked'],
    ['the removed setting OWNER_CONSENT', { OWNER_CONSENT: 'required' }, 'OWNER_CONSENT is no longer read'],
    ['the removed setting TRANSFER_AUTHORITIES', { TRANSFER_AUTHORITIES: states.publisherKey }, 'TRANSFER_AUTHORITIES is no longer read'],
    ['the removed setting INSTRUCTION_COMMITMENT', { INSTRUCTION_COMMITMENT: 'required' }, 'INSTRUCTION_COMMITMENT is no longer read'],
    ['the removed setting EXPORT_SIGNING_KEY', { EXPORT_SIGNING_KEY: KEYS.exporter }, 'EXPORT_SIGNING_KEY is no longer read'],
    ['an ACCEPTANCE_COMMITMENT that is not "required"', { ACCEPTANCE_COMMITMENT: 'yes' }, 'ACCEPTANCE_COMMITMENT must be "required" or unset'],
    ['a NETWORK that is neither main nor test', { NETWORK: 'mainnet' }, 'NETWORK must be main or test'],
    ['an exporter key that is no key', { EXPORTER_PRIVATE_KEY: 'not-a-key' }, 'EXPORTER_PRIVATE_KEY is not a private key in hex'],
  ]
  const refusalsObserved = { npm: [], image: [] }
  for (const [what, extra, message] of refusalCases) {
    const answers = {}
    for (const name of ['npm', 'image']) {
      const result = paths[name].boot(extra)
      answers[name] = { refused: result.status !== 0 && result.status != null, named: result.output.includes(message) }
      refusalsObserved[name].push({ what, ...answers[name] })
    }
    say(answers.npm.refused && answers.npm.named && answers.image.refused && answers.image.named, `with ${what}, both refuse to start and say "${message}" (npm consumer: ${answers.npm.refused ? 'refused' : 'started'}${answers.npm.named ? '' : ', message missing'}; preset: ${answers.image.refused ? 'refused' : 'started'}${answers.image.named ? '' : ', message missing'}).`)
  }
  say(isDeepStrictEqual(refusalsObserved.npm, refusalsObserved.image), `the ${refusalCases.length} start refusals are the same from the npm consumer and from the preset.`)

  // 4b. The preset's own refusals: an image that is not pinned.
  section('The preset refuses an image that is not pinned by digest')
  const digestA = `sha256:${'a'.repeat(64)}`
  const exampleFile = join(repo, 'deploy', 'operator.env.example')
  const asItStands = compose(['deploy/compose.yml'], [exampleFile], ['config', '--quiet'], { project: `${project}-refusal` })
  const unpublished = images.own.filter((image) => image.digest === 'unpublished').map((image) => image.digestVariable)
  if (unpublished.length > 0) say(asItStands.status !== 0 && unpublished.some((name) => asItStands.stderr.includes(name)), `with deploy/operator.env.example as it stands, whose images are unpublished, docker compose refuses and names the missing digest: ${asItStands.stderr.trim().split('\n').at(-1).slice(0, 160)}`)
  else say(asItStands.status === 0, 'with deploy/operator.env.example as it stands, whose images are published and pinned, the preset\'s configuration is valid.')
  const withDigests = compose(['deploy/compose.yml'], [exampleFile], ['config', '--quiet'], { project: `${project}-refusal`, spawn: { env: { ...process.env, OVERLAY_IMAGE_DIGEST: digestA, VALIDATOR_IMAGE_DIGEST: digestA } } })
  say(withDigests.status === 0, 'with a digest for each image the same file is a valid configuration.')
  const oneMissing = compose(['deploy/compose.yml'], [exampleFile], ['config', '--quiet'], { project: `${project}-refusal`, spawn: { env: { ...process.env, OVERLAY_IMAGE_DIGEST: digestA, VALIDATOR_IMAGE_DIGEST: '' } } })
  say(oneMissing.status !== 0 && oneMissing.stderr.includes('VALIDATOR_IMAGE_DIGEST'), 'with the validator\'s digest alone missing it refuses and names that one.')
  created.composeProjects.push({ project: `${project}-refusal`, files: ['deploy/compose.yml'], envFiles: [exampleFile], env: { OVERLAY_IMAGE_DIGEST: digestA, VALIDATOR_IMAGE_DIGEST: digestA } })
  for (const [what, value] of [['a tag', 'latest'], ['a version', version('@bsv/dpp-overlay')], ['the build file\'s placeholder without the build file', 'built-from-source']]) {
    const attempt = compose(['deploy/compose.yml'], [exampleFile], ['create', '--pull', 'never', 'overlay'], { project: `${project}-refusal`, spawn: { env: { ...process.env, OVERLAY_IMAGE_DIGEST: value, VALIDATOR_IMAGE_DIGEST: value } } })
    const made = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}-refusal`, '--filter', 'label=com.docker.compose.service=overlay']).stdout.trim()
    say(attempt.status !== 0 && /invalid reference format/.test(attempt.stderr) && made === '', `with ${what} (${value}) where the digest belongs, Docker refuses the reference and no index container is made.`)
  }
  const portWithoutToken = compose(['deploy/compose.yml', 'deploy/compose.validator-port.yml'], [exampleFile], ['config', '--quiet'], { project: `${project}-refusal`, spawn: { env: { ...process.env, OVERLAY_IMAGE_DIGEST: digestA, VALIDATOR_IMAGE_DIGEST: digestA, VALIDATOR_TOKEN: '' } } })
  say(portWithoutToken.status !== 0 && portWithoutToken.stderr.includes('VALIDATOR_TOKEN'), 'publishing the validator\'s port without a token is refused, and the refusal names VALIDATOR_TOKEN.')
  const second = (env) => compose(['deploy/compose.second-operator.yml'], [exampleFile], ['config', '--quiet'], { project: `${project}-refusal`, spawn: { env: { ...process.env, SUBMIT_TOKEN: 'a', ARC_CALLBACK_TOKEN: 'b', SYNC_PEERS: 'http://first.example', ...env } } })
  say(second({}).status !== 0 && second({ OVERLAY_IMAGE_DIGEST: digestA }).status === 0, 'the second operator\'s file refuses the same way without a digest and is a valid configuration with one.')
  const buildForm = docker(['compose', '-p', `${project}-refusal`, '-f', join(repo, 'deploy/compose.yml'), '-f', join(repo, 'deploy/compose.build.yml'), '--env-file', exampleFile, '--env-file', join(repo, 'deploy/build.env'), 'config', '--format', 'json'])
  const built = buildForm.status === 0 ? JSON.parse(buildForm.stdout).services : {}
  say(buildForm.status === 0 && built.overlay?.build?.dockerfile === overlayImage.dockerfile && built.validator?.build?.dockerfile === validatorImage.dockerfile && !String(built.overlay?.image).includes('@') && built.mongo?.image === mongoReference, 'with the build file and its env file, the same preset builds both images from this checkout, names them by local tag, and still pins MongoDB by digest.')

  // 4c. The contract, and a write refused until a token is issued.
  section('The index contract over HTTP, asked of both')
  const contract = {}
  const tokens = {}
  for (const name of ['npm', 'image']) {
    const before = await askIndex(paths[name].base(), '/submit', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(states.shared.states[0].beef) })
    const issued = paths[name].cli(['connection'])
    const file = Object.fromEntries(issued.output.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
    const shaped = issued.status === 0 && isDeepStrictEqual(Object.keys(file).sort(), ['INDEX_CALLBACK_TOKEN', 'INDEX_SUBMIT_TOKEN', 'INDEX_URL', 'NETWORK']) && /^[0-9a-f]{64}$/.test(file.INDEX_SUBMIT_TOKEN ?? '') && /^[0-9a-f]{64}$/.test(file.INDEX_CALLBACK_TOKEN ?? '') && file.INDEX_URL === settings.PUBLIC_URL && file.NETWORK === 'test'
    say(before.status === 401 && shaped, `${paths[name].label}: before any token exists a write is refused with ${before.status}, and its own connection command then issues a submit and a callback token and names the index's address and network.`)
    tokens[name] = { submit: file.INDEX_SUBMIT_TOKEN, callback: file.INDEX_CALLBACK_TOKEN, exportToken }
    contract[name] = await runIndexContract({ base: paths[name].base(), modules, states, own: name, tokens: tokens[name], validators })
    console.log(`  ${paths[name].label}:`)
    for (const check of contract[name].checks) say(check.ok, `${paths[name].label}: ${check.sentence}`)
    contract[name].observed.connection = { keys: Object.keys(file).sort(), url: file.INDEX_URL, network: file.NETWORK, refusedBefore: before.status }
  }
  const differing = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !isDeepStrictEqual(a[key], b[key]))
  const contractDifferences = differing(contract.npm.observed, contract.image.observed)
  say(contract.npm.checks.length === contract.image.checks.length && contractDifferences.length === 0, `both answered the ${contract.npm.checks.length} contract checks the same way: ${Object.keys(contract.npm.observed).length} recorded answers agree, from the capability document to the digest of every exported file${contractDifferences.length === 0 ? '' : `; these differ: ${contractDifferences.join(', ')}`}.`)
  if (contractDifferences.length > 0) for (const key of contractDifferences) console.log(`    ${key}\n      npm:   ${JSON.stringify(contract.npm.observed[key]).slice(0, 600)}\n      image: ${JSON.stringify(contract.image.observed[key]).slice(0, 600)}`)

  // 4d. Stop and start.
  section('A stop and a start of the index and its database')
  const afterRestart = {}
  for (const name of ['npm', 'image']) {
    const code = await paths[name].restart()
    say(code === 0, `${paths[name].label}: told to stop, the index closed with exit code ${code}; its database container was removed and made again over the same volume.`)
    afterRestart[name] = await runAfterRestart({ base: paths[name].base(), modules, states, own: name, tokens: tokens[name] })
    for (const check of afterRestart[name].checks) say(check.ok, `${paths[name].label}: ${check.sentence}`)
    say(isDeepStrictEqual(afterRestart[name].observed['lookup:shared'], contract[name].observed.proofs.served) && isDeepStrictEqual(afterRestart[name].observed.evidenceFiles, contract[name].observed.evidencePackage.files) && isDeepStrictEqual(afterRestart[name].observed.history, contract[name].observed.history), `${paths[name].label}: what it serves after the restart is what it served before, byte for byte, the applied proof included.`)
  }
  const { 'lookup:own': _npmOwn, ...npmAfter } = afterRestart.npm.observed
  const { 'lookup:own': _imageOwn, ...imageAfter } = afterRestart.image.observed
  say(isDeepStrictEqual(npmAfter, imageAfter), 'after the restart both still answer the same.')

  // 4e. Restore across the two deliveries.
  section('Evidence exported by one delivery, restored into the other')
  for (const [from, to] of [['npm', 'image'], ['image', 'npm']]) {
    const chain = states.only[from]
    const exported = await askIndex(paths[from].base(), `/evidence-package?passportId=${encodeURIComponent(chain.passportId)}`)
    const empty = await askIndex(paths[to].base(), '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: chain.passportId } }) })
    const restored = exported.status === 200 ? await restoreFromPackage({ base: paths[to].base(), modules, envelope: exported.body, passportId: chain.passportId, token: tokens[to].submit }) : undefined
    const original = await askIndex(paths[from].base(), '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: chain.passportId } }) })
    const originalStates = (original.body?.outputs ?? []).map((o) => ({ outpoint: `${modules.sdk.Transaction.fromBEEF(o.beef).id('hex')}:${o.outputIndex}`, beefSha256: sha256(Buffer.from(o.beef)) })).sort((a, b) => a.outpoint.localeCompare(b.outpoint))
    say(empty.body?.outputs?.length === 0 && restored != null && restored.admissions.every((a) => a === 'tm_dpp=admitted') && isDeepStrictEqual(restored.served.map(({ outpoint, beefSha256 }) => ({ outpoint, beefSha256 })), originalStates), `a passport only ${paths[from].label} held is restored into ${paths[to].label} from its evidence package alone, and ${paths[to].label} then serves the same ${originalStates.length} states, byte for byte.`)
  }

  // 4f. A database that goes away and comes back.
  section('A database that stops and returns')
  const outage = {}
  for (const name of ['npm', 'image']) {
    paths[name].stopDatabase()
    const started = Date.now()
    const during = await askIndex(paths[name].base(), '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: states.shared.passportId } }), signal: AbortSignal.timeout(90_000) }).catch((cause) => ({ status: 0, body: { description: String(cause.message) } }))
    const answeredInMs = Date.now() - started
    const health = await askIndex(paths[name].base(), '/health').catch(() => ({ status: 0 }))
    await paths[name].startDatabase()
    const recovered = await until(async () => (await askIndex(paths[name].base(), '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: states.shared.passportId } }) })).body?.outputs?.length === 2, 90, 1000)
    outage[name] = { status: during.status, answeredInMs, healthDuring: health.status, recovered }
    say(during.status >= 400 && typeof during.body?.description === 'string' && answeredInMs < 60_000 && recovered, `${paths[name].label}: with its database stopped a lookup is answered ${during.status} with a description in ${answeredInMs} ms, not a partial result and not a hang; when the database returns the same index serves both states again without being restarted.`)
  }
  say(outage.npm.status === outage.image.status && outage.npm.healthDuring === outage.image.healthDuring, `both give the same answer while the database is away: status ${outage.npm.status}, and GET /health ${outage.npm.healthDuring}.`)
  measured.limits.databaseOutage = outage

  // 5. The validator service.
  section('The validator service of the preset')
  const full = presetCompose(['up', '-d', '--wait', '--no-build'])
  if (full.status !== 0) throw new Error(`the full preset did not start: ${full.stderr.trim().split('\n').slice(-6).join(' | ')}`)
  say(isDeepStrictEqual(running(), ['mongo', 'overlay', 'validator']), `started whole, the preset runs ${running().join(', ')}: the validator comes with it and nothing else has to be found.`)
  const validatorContainer = () => presetCompose(['ps', '-q', 'validator']).stdout.trim()
  const validatorHardening = hardening(validatorContainer())
  say(validatorHardening.user === 'node' && validatorHardening.readOnly === true && isDeepStrictEqual(validatorHardening.capDrop, ['ALL']) && validatorHardening.securityOpt.includes('no-new-privileges:true') && validatorHardening.init === true, 'the validator container runs as the node user on a read-only file system, with no capability, no new privileges and an init, as the index does.')
  say(validatorHardening.ports.length === 0 && isDeepStrictEqual(validatorHardening.networks, [`${project}_validation`]), `it publishes no port and is on the ${project}_validation network alone, which the database is not on (the index and the database are on ${hardening(presetCompose(['ps', '-q', 'mongo']).stdout.trim()).networks.join(', ')}).`)
  const fromIndexNetwork = docker(['run', '--rm', '--network', `${project}_default`, '--entrypoint', 'node', given[overlayImage.name], '-e', "fetch('http://validator:8090/health',{signal:AbortSignal.timeout(4000)}).then(()=>{console.log('reached');process.exit(0)},()=>{console.log('unreachable');process.exit(0)})"])
  say(fromIndexNetwork.stdout.trim() === 'unreachable', 'a container on the index\'s network does not reach the validator: the index has no route to it and never calls it.')
  const indexLogs = presetCompose(['logs', '--no-color', 'overlay']).stdout
  say(!/validator|8090/i.test(indexLogs), 'nothing in the index\'s log mentions a validator: it admitted and served every state above with none running.')

  const validatorResults = {}
  const reportVectors = (label, result, expectation) => {
    repeat(result.stdout ?? '')
    const parsed = resultOf(result.stdout ?? '')
    validatorResults[label] = parsed
    return say(result.status === 0 && parsed != null && expectation(parsed), `${label}${result.status === 0 ? '' : `: ${`${result.stderr ?? ''}`.trim().split('\n').at(-1)}`}`)
  }
  const identical = (parsed) => parsed.identical === parsed.vectors && parsed.vectors > 0 && parsed.client === 'installed' && parsed.sparqlOnlyViolationsFound === parsed.sparqlOnlyViolations
  const validatorToken = randomBytes(24).toString('hex')
  const validatorPort = await freePort()
  const published = { base: `http://127.0.0.1:${validatorPort}`, token: validatorToken }
  const inNetwork = { internal: 'http://validator:8090', network: `${project}_validation` }
  const publishPort = () => {
    const portEnv = writeEnvironment(join(work, 'validator-port.env'), { VALIDATOR_TOKEN: validatorToken, VALIDATOR_PUBLISH: `127.0.0.1:${validatorPort}` })
    return compose([...presetFiles, 'deploy/compose.validator-port.yml'], [...presetEnvFiles, portEnv], ['up', '-d', '--wait', '--no-build', 'validator'])
  }
  if (npmRuntime === 'image') {
    reportVectors('through the application consumer\'s validator client, in a container that joined the preset\'s validation network, every profile vector gives the answer the engine gives in process', vectors(application, inNetwork), identical)
  }
  const withPort = publishPort()
  if (withPort.status !== 0) throw new Error(`the validator's port could not be published: ${withPort.stderr.trim().split('\n').slice(-4).join(' | ')}`)
  await healthy(published.base)
  const { createValidatorClient } = await import(pathToFileURL(join(application.dir, 'node_modules', '@bsv', 'dpp-profiles', 'dist', 'validator-client.js')).href)
  const withoutToken = await createValidatorClient({ url: published.base, timeoutMs: 5000 }).jsonLd.toRdf({ document: {}, contexts: [] })
  const withToken = await createValidatorClient({ url: published.base, token: validatorToken, timeoutMs: 5000 }).probe()
  say(hardening(validatorContainer()).ports.length === 1 && withoutToken.ok === false && withToken.ok === true, `with deploy/compose.validator-port.yml added the port is published on this machine's loopback address behind a token: a client without the token gets ${withoutToken.ok ? 'a result' : withoutToken.reason}, which a validator reports as unknown, and a client with it reaches ${withToken.ok ? withToken.service.engine.name : 'nothing'}.`)
  if (npmRuntime === 'host') {
    reportVectors('through the application consumer\'s validator client, at the port published on purpose, every profile vector gives the answer the engine gives in process', vectors(application, published), identical)
  }
  measured.limits.validator = validatorResults[Object.keys(validatorResults)[0]]?.service?.limits

  section('The same vectors through the dpp-validator command of the npm package')
  npmValidator = await startService({ name: `${project}-npm-validator`, consumer: validatorConsumer, bin: 'dpp-validator', containerPort: 8090, network: npmNetwork, settings: (host, port) => ({ VALIDATOR_HOST: host, VALIDATOR_PORT: String(port) }) })
  reportVectors('through the same client, against the dpp-validator command a consumer started from the packed package and the engine libraries, every profile vector gives the answer the engine gives in process', vectors(application, { base: npmValidator.base, internal: npmValidator.internal, network: npmNetwork }), identical)
  const fromImage = validatorResults[Object.keys(validatorResults)[0]]
  const fromNpm = validatorResults[Object.keys(validatorResults).at(-1)]
  say(fromImage != null && fromNpm != null && isDeepStrictEqual(fromImage.answers, fromNpm.answers) && isDeepStrictEqual(fromImage.service.engine, fromNpm.service.engine) && isDeepStrictEqual(fromImage.service.capabilities, fromNpm.service.capabilities), `the preset's service and the npm command describe the same engine, ${fromImage?.service.engine.name} ${fromImage?.service.engine.version}, and gave the same answers: ${fromImage?.answers.pass} pass, ${fromImage?.answers.fail} fail and ${fromImage?.answers.unknown} unknown.`)
  const validatorExit = await npmValidator.stop()
  npmValidator = undefined
  say(validatorExit === 0, `told to stop, the dpp-validator command closed with exit code ${validatorExit}.`)

  section('A compatible replacement service')
  let replacementTarget
  let replacementContainer
  if (npmRuntime === 'host') {
    const child = spawn(process.execPath, [join(repo, 'packages', 'dpp-profiles', 'test', 'stand-in-validator.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
    created.children.push(child)
    const port = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', (code) => fail(new Error(`the stand-in service ended with code ${code}`))); child.stdout.once('data', (line) => done(JSON.parse(line.toString('utf8')).port)) })
    standIn = { stop: async () => { child.kill('SIGTERM') } }
    replacementTarget = { base: `http://127.0.0.1:${port}` }
  } else {
    replacementContainer = `${project}-stand-in`
    const started = docker(['run', '-d', '--name', replacementContainer, ...uid, '--network', 'none', '-v', `${resolve(repo)}:/checkout:ro`, '-v', `${application.dir}:/consumer:ro`, nodeImage, 'node', '/checkout/packages/dpp-profiles/test/stand-in-validator.mjs'])
    if (started.status !== 0) throw new Error(`the stand-in service did not start: ${started.stderr.trim()}`)
    created.containers.push(replacementContainer)
    let port
    await until(() => { const line = docker(['logs', replacementContainer]).stdout.trim().split('\n')[0]; try { port = JSON.parse(line).port } catch { /* not yet */ } return port != null }, 30)
    standIn = { stop: async () => { docker(['rm', '-f', replacementContainer]) } }
    replacementTarget = { internal: `http://127.0.0.1:${port}` }
  }
  reportVectors('reconfigured to a second implementation of the contract, written from the contract alone, the same client decides every vector the same way, step for step and finding for finding', vectors(application, replacementTarget, ['--replacement'], replacementContainer), (parsed) => parsed.mode === 'replacement' && parsed.identical === parsed.vectors && parsed.vectors > 0 && parsed.service.engine.name === 'stand-in-validator' && parsed.client === 'installed')
  await standIn.stop()
  standIn = undefined

  section('No validator: stopped, and never started')
  const stopped = compose([...presetFiles, 'deploy/compose.validator-port.yml'], [...presetEnvFiles, join(work, 'validator-port.env')], ['stop', 'validator'])
  if (stopped.status !== 0) throw new Error(`the validator did not stop: ${stopped.stderr.trim()}`)
  const unavailable = (parsed) => parsed.mode === 'unavailable' && parsed.passingWithoutEngine === 0 && parsed.needingEngine > 0 && parsed.unknownThatPassedWithEngine === parsed.passedWithEngine && parsed.passedWithEngine > 0 && parsed.client === 'installed'
  reportVectors('with the preset\'s validator stopped, nothing that needs the engine passes and everything that passed with it is unknown', vectors(application, npmRuntime === 'host' ? published : inNetwork, ['--expect-unavailable']), unavailable)
  reportVectors('with no validator at the configured address at all, as on the index-only start, the answer is the same: nothing reads as a complete pass', vectors(application, { base: 'http://127.0.0.1:9', internal: 'http://127.0.0.1:9', network: npmNetwork }, ['--expect-unavailable']), unavailable)
  const stillServing = await askIndex(imageBase, '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: states.shared.passportId } }) })
  say(stillServing.status === 200 && stillServing.body.outputs.length === 2, 'with the validator stopped the preset\'s index still serves: the index-only path needs no validator.')

  facts.contract = { checksPerPath: contract.npm.checks.length, answersCompared: Object.keys(contract.npm.observed).length, startRefusals: refusalCases.length, statesAdmittedPerIndex: states.shared.states.length + states.only.npm.states.length + states.only.image.states.length }
  facts.validator = validatorResults
  measured.limits.index = { statesPerPassport: states.shared.states.length, passportsPerIndex: 3, largestAnnouncementBytes: Math.max(...[states.shared, states.only.npm, states.only.image].flatMap((chain) => chain.states.map((s) => s.beef.length))), exportParts: contract.npm.observed.evidenceExport.parts }
} catch (cause) {
  say(false, `the check could not finish: ${cause.message}.`)
} finally {
  if (keep) {
    console.log(`\nKept: Compose project ${project}, containers ${created.containers.join(', ') || 'none'}, directories ${created.directories.join(', ')}.`)
  } else {
    for (const child of created.children) if (child.exitCode == null) child.kill('SIGTERM')
    try { await npmIndex?.stop() } catch { /* already gone */ }
    try { await npmValidator?.stop() } catch { /* already gone */ }
    try { await standIn?.stop() } catch { /* already gone */ }
    for (const { project: name, files, envFiles, env } of created.composeProjects) docker(['compose', '-p', name, ...files.flatMap((f) => ['-f', join(repo, f)]), ...envFiles.flatMap((f) => ['--env-file', f]), 'down', '-v', '--remove-orphans'], env == null ? {} : { env: { ...process.env, ...env } })
    for (const container of created.containers) docker(['rm', '-f', '-v', container])
    for (const network of created.networks) docker(['network', 'rm', network])
    for (const volume of created.volumes) docker(['volume', 'rm', '-f', volume])
    for (const tag of created.tags) docker(['rmi', tag])
    for (const dir of created.directories) rmSync(dir, { recursive: true, force: true })
    const left = docker(['ps', '-aq', '--filter', `name=${project}`]).stdout.trim()
    say(left === '', `every container, network, volume and image tag this run made is removed${left === '' ? '' : `, except containers ${left.split('\n').join(', ')}`}.`)
  }
}

const notRun = facts.preset?.form === 'pinned-by-registry-digest'
  ? ['Only this machine\'s platform of each published image was started.']
  : [
      'The images were built on this machine for its own platform only. The multi-platform build for linux/amd64 and linux/arm64 belongs to the image publication workflow and was not run.',
      'No image was pulled from the registry the release set names: the images of this set are unpublished. The preset was started from locally built images.',
      'The image publication workflow, .github/workflows/publish-images.yaml, has never run.',
    ]
console.log(`\nMeasured: ${sentences.length} sentences, ${failures} failing. These are the limits this run reached, not a capacity: ${JSON.stringify(measured.limits.index ?? {})}.`)
for (const line of notRun) console.log(`Not run: ${line}`)
if (recordPath != null) {
  mkdirSync(dirname(resolve(recordPath)), { recursive: true })
  writeFileSync(resolve(recordPath), JSON.stringify({
    check: 'scripts/delivery-parity.mjs',
    recordedAt: new Date().toLocaleDateString('en-CA'),
    docker: docker(['version', '--format', '{{.Server.Version}}']).stdout.trim(),
    platform: `${docker(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']).stdout.trim()}`,
    releaseSet: set.releaseSet,
    sourceRevision: record.sourceRevision,
    sourceState: record.sourceState,
    failures,
    sentences: sentences.length,
    ...facts,
    limits: measured.limits,
    notRun,
  }, null, 2) + '\n')
  console.log(`Wrote ${recordPath}.`)
}
process.exit(failures === 0 ? 0 : 1)
