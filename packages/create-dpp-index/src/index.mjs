#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createECDH, randomBytes } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { publicKey, baseUrl } from '../template/scripts/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let json = process.argv.includes('--json')
const report = (value) => console.log(json ? JSON.stringify(value) : value.message)

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    yes: { type: 'boolean', short: 'y' }, json: { type: 'boolean' },
    'no-install': { type: 'boolean' }, config: { type: 'string' },
    'publisher-key': { type: 'string' }, 'anchor-key': { type: 'string', multiple: true },
    network: { type: 'string' }, custody: { type: 'string' }, port: { type: 'string' },
    'public-url': { type: 'string' },
  } })
  json = values.json === true
  if (values.help) {
    console.log(`create-dpp-index ${manifest.version}: scaffold a standalone DPP index.

Usage: npm create @bsv/dpp-index <directory> -- [options]

  --publisher-key <key>  App wallet's compressed public key (required)
  --anchor-key <key>     Authorised anchor publisher; repeat for several
                        Defaults to the passport publisher
  --network main|test   Match the app wallet (default: main)
  --custody managed|baseline  Admission profile (default: managed)
  --port <number>       Local HTTP port (default: 8080)
  --public-url <url>    Advertised origin (default: http://localhost:<port>)
  --config <file>       JSON with publisherKey, anchorKeys, network, custody,
                        port and publicUrl; flags override it
  --yes                 No prompts; missing required input is an error
  --no-install          Create files without downloading dependencies
  --json                One JSON result, no secrets; implies no prompts

The project includes @bsv/dpp-overlay-topics as its runtime dependency.
No separate runtime installation is needed. Use the generated project commands.
No publisher private key or funded wallet is needed to operate the index.
The generated README covers startup, app connection and deployment.
Template release set: ${manifest.dpp.releaseSet}.`)
  } else if (values.version) {
    console.log(manifest.version)
  } else {
    if (positionals.length > 1) throw new Error('Name one target directory')
    let config = values.config ? JSON.parse(readFileSync(resolve(values.config), 'utf8')) : {}
    if (config == null || typeof config !== 'object' || Array.isArray(config)) throw new Error('--config must contain a JSON object')
    const allowed = new Set(['publisherKey', 'anchorKeys', 'network', 'custody', 'port', 'publicUrl'])
    if (Object.keys(config).some(key => !allowed.has(key))) throw new Error('--config contains an unknown setting; run --help for the supported names')
    config = { ...config }
    for (const [flag, key] of Object.entries({ 'publisher-key': 'publisherKey', 'anchor-key': 'anchorKeys', network: 'network', custody: 'custody', port: 'port', 'public-url': 'publicUrl' })) {
      if (values[flag] !== undefined) config[key] = values[flag]
    }
    let directory = positionals[0]
    if (process.stdin.isTTY && !values.yes && !json) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      try {
        directory ??= (await prompt.question('Project directory [my-dpp-index]: ')).trim() || 'my-dpp-index'
        config.publisherKey ??= (await prompt.question('App wallet publisher PUBLIC key (npm run wallet in the app): ')).trim()
        config.network ??= (await prompt.question('Network [main/test, default main]: ')).trim() || 'main'
        config.custody ??= (await prompt.question('Custody [managed/baseline, default managed]: ')).trim() || 'managed'
      } finally { prompt.close() }
    }
    if (!directory) throw new Error('Name a target directory, for example my-dpp-index')
    if (!config.publisherKey) throw new Error('Supply --publisher-key with the app wallet public key. Run npm run wallet in the app; never pass its private key.')
    const publisherKey = publicKey(config.publisherKey, 'publisherKey')
    const rawAnchors = config.anchorKeys ?? [publisherKey]
    if (!Array.isArray(rawAnchors) || rawAnchors.length === 0) throw new Error('anchorKeys must be a non-empty array of public keys')
    const anchors = [...new Set(rawAnchors.map(key => publicKey(key, 'anchorKeys')))]
    const network = config.network ?? 'main'
    if (!['main', 'test'].includes(network)) throw new Error('network must be main or test')
    const custody = config.custody ?? 'managed'
    if (!['managed', 'baseline'].includes(custody)) throw new Error('custody must be managed or baseline')
    const port = Number(config.port ?? 8080)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer from 1 to 65535')
    const url = baseUrl(config.publicUrl ?? `http://localhost:${port}`, 'publicUrl')
    const target = resolve(directory)
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) throw new Error('Target must be a directory, not a file or symbolic link')
      if (readdirSync(target).length !== 0) throw new Error('Target is not empty. Choose an empty or new directory; no files were changed.')
    }
    const projectName = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'dpp-index'
    mkdirSync(target, { recursive: true })
    const skip = new Set(['node_modules', 'dist', '.env', '.app.env', 'package-lock.json', '.DS_Store'])
    cpSync(join(root, 'template'), target, { recursive: true, filter: source => !skip.has(basename(source)) })
    for (const name of readdirSync(target)) {
      if (name.startsWith('_')) renameSync(join(target, name), join(target, `.${name.slice(1)}`))
    }
    const project = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    project.name = projectName
    project.dependencies['@bsv/dpp-overlay-topics'] = manifest.dpp.packages['@bsv/dpp-overlay-topics']
    project.dpp = { generator: `${manifest.name}@${manifest.version}`, releaseSet: manifest.dpp.releaseSet, packages: manifest.dpp.packages }
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(project, null, 2)}\n`)
    const exporter = createECDH('secp256k1')
    exporter.generateKeys()
    const database = projectName.replaceAll('-', '_').slice(0, 63)
    const mongoPassword = randomBytes(32).toString('hex')
    const substitutions = {
      SERVICE_IDENTITY_KEY: publisherKey, ANCHOR_SERVICE_KEYS: anchors.join(','),
      NETWORK: network, ACCEPTANCE_COMMITMENT: custody === 'managed' ? 'required' : '',
      PORT: String(port), PUBLIC_URL: url, MONGO_DB: database,
      MONGO_INDEX_PASSWORD: mongoPassword, MONGO_ROOT_PASSWORD: randomBytes(32).toString('hex'),
      MONGO_URL: `mongodb://dpp_index:${mongoPassword}@mongo:27017/${database}?authSource=${database}`,
      SUBMIT_TOKEN: randomBytes(32).toString('hex'), ARC_CALLBACK_TOKEN: randomBytes(32).toString('hex'),
      EXPORT_TOKEN: randomBytes(32).toString('hex'), EXPORT_SIGNING_KEY: exporter.getPrivateKey().toString('hex').padStart(64, '0'),
    }
    const example = readFileSync(join(target, '.env.example'), 'utf8')
    const env = example.replace(/^([A-Z_]+)=.*$/gm, (line, key) => Object.hasOwn(substitutions, key) ? `${key}=${substitutions[key]}` : line)
    writeFileSync(join(target, '.env'), env, { mode: 0o600, flag: 'wx' })
    let installed = false
    if (!values['no-install']) {
      const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: target, stdio: json ? ['ignore', 2, 2] : 'inherit', shell: process.platform === 'win32',
      })
      installed = result.status === 0
      if (!installed) process.exitCode = 1
    }
    report({ status: process.exitCode ? 'install-failed' : 'created', directory: target, installed,
      generator: `${manifest.name}@${manifest.version}`, releaseSet: manifest.dpp.releaseSet,
      message: `Created ${target}. Secrets are in .env and were not printed.\nThe project includes @bsv/dpp-overlay-topics as its runtime dependency; no separate runtime installation is needed.\n\nNext, inside that directory:\n${installed ? '' : '  npm install --ignore-scripts\n'}  npm test\n  npm run up\n  npm run doctor -- --online\n  npm run connection\n\nThe last command writes .app.env for your application. Read README.md for deployment and optional services.${process.exitCode ? '\nDependency installation failed; the project is saved. Check registry availability and retry npm install.' : ''}` })
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Scaffolding failed'
  if (json) report({ status: 'error', message })
  else console.error(message)
  process.exitCode = 1
}
