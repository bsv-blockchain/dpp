// npm run connect-index and npm run add-index: two ways to an index besides
// the default one. connect-index takes a provider's address and, when the
// provider handed them out, its tokens; without tokens, go-live registers.
// add-index creates an index project beside this app through the index
// starter, with this app's publisher key, takes the connection its
// connection script wrote and runs the configuration checks; the index is
// not running yet, so the next two commands are its start and go-live.
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { loadConfig } from './config.js'
import { readEnvFile, updateEnvFile } from './env-file.js'
import { goLive, type GoLiveOptions, type GoLiveResult } from './go-live.js'
import { openPlatform } from './platform.js'

export interface ConnectIndexOptions extends Omit<GoLiveOptions, 'through'> {
  url: string
  submitToken?: string
  callbackToken?: string
}

export async function connectIndex(options: ConnectIndexOptions): Promise<GoLiveResult> {
  const url = options.url.trim().replace(/\/+$/, '')
  if (url === '') {
    options.out('no  connect-index: no address given. Fix: run npm run connect-index -- --url <index> [--submit-token <t> --callback-token <t>]')
    return { ok: false, passed: [], failures: [{ check: 'connect-index', problem: 'no address given', fix: 'run npm run connect-index -- --url <index> [--submit-token <t> --callback-token <t>]' }] }
  }
  const values: Record<string, string> = { INDEX_URL: url }
  if (options.submitToken != null && options.submitToken !== '') values.INDEX_SUBMIT_TOKEN = options.submitToken
  if (options.callbackToken != null && options.callbackToken !== '') values.INDEX_CALLBACK_TOKEN = options.callbackToken
  await updateEnvFile(options.envFile, values)
  options.out(`Wrote the connection to .env: ${url}${values.INDEX_SUBMIT_TOKEN == null ? ', no tokens yet (go-live registers for them)' : ' with its tokens'}.`)
  return await goLive({ ...options, env: { ...options.env, ...values } })
}

export interface AddIndexOptions extends Omit<GoLiveOptions, 'through'> {
  /** The index project's directory, relative to the app's parent. */
  directory: string
  parentDirectory: string
  existsSync: (path: string) => boolean
  /** The index starter's version to run; DPP_INDEX_STARTER_PACKAGE in the environment overrides the whole package spec. */
  indexStarterVersion?: string
  /** The command that creates the project, before the directory and flags; the default runs the index starter through npm exec. */
  createCommand?: string[]
  /** The command run inside the new project to write .app.env; the default is its connection script. */
  connectionCommand?: string[]
  /** The app's publisher key; read from the wallet when not given. */
  publisherKey?: string
}

/** The wallet's identity key: the root key from .env, generated into it first when the file has none. */
async function publisherKeyFor(options: GoLiveOptions): Promise<string> {
  const env = { ...options.env }
  if ((env.WALLET_ROOT_KEY ?? '').trim() === '') {
    const rootKey = randomBytes(32).toString('hex')
    await updateEnvFile(options.envFile, { WALLET_ROOT_KEY: rootKey })
    env.WALLET_ROOT_KEY = rootKey
    options.out('Generated WALLET_ROOT_KEY into .env. Back the file up: this key is the wallet.')
  }
  const platform = await (options.openPlatform ?? openPlatform)({ config: loadConfig(env), mode: 'live', log: () => {} })
  try {
    return platform.wallet.identityKey
  } finally {
    await platform.close()
  }
}

export async function addIndex(options: AddIndexOptions): Promise<GoLiveResult> {
  const target = resolve(options.parentDirectory, options.directory)
  const failure = (problem: string, fix: string): GoLiveResult => {
    options.out(`no  add-index: ${problem}. Fix: ${fix}`)
    return { ok: false, passed: [], failures: [{ check: 'add-index', problem, fix }] }
  }
  if (options.existsSync(target)) return failure(`${target} already exists`, 'choose another directory: npm run add-index -- <directory>, or connect to the existing project with npm run connect-index')
  let network: string
  try {
    network = loadConfig(options.env).network
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : String(cause), 'edit .env as the message says, then run npm run add-index again')
  }
  const publisherKey = options.publisherKey ?? (await publisherKeyFor(options))
  const override = (options.env.DPP_INDEX_STARTER_PACKAGE ?? '').trim()
  if (override === '' && (options.indexStarterVersion ?? '') === '') return failure('package.json names no dpp.indexStarter version', 'add "dpp": { "indexStarter": "<version>" } to package.json with the index starter version this app was scaffolded with')
  const spec = override || `@bsv/create-dpp-index@${options.indexStarterVersion}`
  const create = options.createCommand ?? ['npm', 'exec', '--yes', '--package', spec, '--', 'create-dpp-index']
  // DPP_INDEX_STARTER_NO_INSTALL=1 is the scaffold check's switch: the project is created without its dependencies, which the check cannot fetch for an unpublished runtime.
  const flags = (options.env.DPP_INDEX_STARTER_NO_INSTALL ?? '').trim() === '1' ? ['--no-install'] : []
  options.out(`Creating the index project at ${target} with the index starter (${spec}), publisher key ${publisherKey}, network ${network}.`)
  try {
    execFileSync(create[0], [...create.slice(1), target, '--yes', '--publisher-key', publisherKey, '--network', network, ...flags], { cwd: options.parentDirectory, stdio: 'inherit' })
  } catch (cause) {
    return failure(`the index starter did not finish: ${cause instanceof Error ? cause.message : String(cause)}`, 'read its output above; a project it created can be connected with npm run connect-index once its npm run connection has run')
  }
  const connection = options.connectionCommand ?? ['npm', 'run', 'connection', '--', '--json', '--url', 'http://localhost:8080']
  try {
    execFileSync(connection[0], connection.slice(1), { cwd: target, stdio: ['ignore', 'ignore', 'inherit'] })
  } catch (cause) {
    return failure(`the index project's connection script failed: ${cause instanceof Error ? cause.message : String(cause)}`, `run npm run connection inside ${target}, then npm run connect-index with the values in its .app.env`)
  }
  const settings = readEnvFile(join(target, '.app.env'))
  if (settings.INDEX_URL == null || settings.INDEX_SUBMIT_TOKEN == null || settings.INDEX_CALLBACK_TOKEN == null) {
    return failure(`${join(target, '.app.env')} holds no complete connection`, `run npm run connection inside ${target}, then npm run connect-index with the values in its .app.env`)
  }
  await updateEnvFile(options.envFile, { INDEX_URL: settings.INDEX_URL.replace(/\/+$/, ''), INDEX_SUBMIT_TOKEN: settings.INDEX_SUBMIT_TOKEN, INDEX_CALLBACK_TOKEN: settings.INDEX_CALLBACK_TOKEN })
  options.out(`Wrote the connection to .env: ${settings.INDEX_URL}, with the tokens the index project issued for this app.`)
  const result = await goLive({ ...options, env: { ...options.env, INDEX_URL: settings.INDEX_URL, INDEX_SUBMIT_TOKEN: settings.INDEX_SUBMIT_TOKEN, INDEX_CALLBACK_TOKEN: settings.INDEX_CALLBACK_TOKEN }, through: 'configuration' })
  if (result.ok) {
    options.out(`Next: start the index with "npm run up" inside ${target} (its README covers hosting), then run npm run go-live here.`)
  }
  return result
}
