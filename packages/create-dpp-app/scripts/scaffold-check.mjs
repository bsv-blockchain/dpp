#!/usr/bin/env node
// Exercise the packed starter outside the workspace. Local checks use packed
// runtime candidates; publication checks require the exact versions on npm.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(root, '../..')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const pkg = read(join(root, 'package.json'))
const { values } = parseArgs({ options: {
  'registry-dependencies': { type: 'boolean', default: false },
  'prepare-only': { type: 'boolean', default: false },
  directory: { type: 'string' },
} })
if (values['prepare-only'] && !values.directory) throw new Error('--prepare-only requires --directory for the generated project')
if (!existsSync(join(root, 'dist', 'index.js'))) throw new Error('build the packages first: npm run build')
const release = read(join(repository, 'release', `${pkg.dpp.releaseSet}.json`))
const runtime = release.packages.filter(p => Object.hasOwn(pkg.dpp.packages, p.name))
for (const entry of runtime) assert.equal(entry.version, pkg.dpp.packages[entry.name], 'starter pins must match the declared release set')
assert.equal(runtime.length, 3, 'the app uses the protocol, profiles and overlay runtime')
assert.equal(pkg.dpp.packages['@bsv/sdk'], release.runtime.dependencies.find(d => d.name === '@bsv/sdk').version)

const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-app-'))
const target = values.directory ? resolve(values.directory) : join(scratch, 'my-dpp')
const registry = 'https://registry.npmjs.org/'
const env = { ...process.env, NPM_CONFIG_CACHE: join(scratch, 'npm-cache'), NPM_CONFIG_REGISTRY: registry }
const run = (command, args, cwd) => {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, env, stdio: 'inherit' })
}
const pack = cwd => JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], { cwd, env, encoding: 'utf8' }))[0]
let created = false
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
  for (const file of ['.gitignore', '.env.example', '.prettierrc', 'apps/api/package.json', 'apps/web/package.json', 'deploy/compose.yml', 'Dockerfile']) {
    if (!existsSync(join(target, file))) throw new Error(`${file} was not scaffolded`)
  }
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
    run('npm', ['run', 'typecheck'], target)
    run('npm', ['run', 'build'], target)
    run('npm', ['test'], target)
    console.log(`The packed app starter and its ${values['registry-dependencies'] ? 'public registry dependencies' : 'local runtime candidates'} install, build, typecheck and pass the generated application's tests without dpp-core.`)
  }
} finally {
  if (created && (process.env.KEEP_DPP_APP === '1' || values.directory)) console.log(`Generated project kept at ${target}`)
  else rmSync(scratch, { recursive: true, force: true })
  if (values.directory) rmSync(scratch, { recursive: true, force: true })
}
