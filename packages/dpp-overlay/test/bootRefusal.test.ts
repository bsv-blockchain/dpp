import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { SERVER_ID } from './helpers.js'

/**
 * A setting the index refuses at start, refused by the process as an operator
 * starts it: the `dpp-index` command (dist/cli.js) and the image's entry
 * point (dist/index.js), each over a real database connection.
 *
 * Several refusals are decided after the database connection is open. The
 * command catches the refusal, prints it and sets its exit code, so an open
 * connection used to keep it alive: it said why it would not start and never
 * exited, where the entry point, which lets the refusal end the process,
 * exited at once. Both must refuse the same way, and both must end.
 */
const dist = join(import.meta.dirname, '..', 'dist')
let mongod: MongoMemoryServer | undefined

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
}, 120_000)
afterAll(async () => {
  await mongod?.stop()
})

interface Ended { code: number | null; output: string; timedOut: boolean }

function start(entry: string, settings: Record<string, string>): Promise<Ended> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(dist, entry)], {
      env: { PATH: process.env.PATH ?? '', SERVICE_IDENTITY_KEY: SERVER_ID, NETWORK: 'test', CHAIN_TRACKER: 'scripts-only', HOST: '127.0.0.1', PORT: '0', MONGO_URL: mongod!.getUri(), MONGO_DB: 'boot-refusal', ...settings },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, output, timedOut: true }) }, 20_000)
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code, output, timedOut: false }) })
  })
}

const REFUSALS: Array<[string, Record<string, string>, string]> = [
  ['a removed custody setting', { OWNER_CONSENT: 'required' }, 'OWNER_CONSENT is no longer read'],
  ['another removed custody setting', { TRANSFER_AUTHORITIES: SERVER_ID }, 'TRANSFER_AUTHORITIES is no longer read'],
  ['the parked instruction rule', { INSTRUCTION_COMMITMENT: 'required' }, 'INSTRUCTION_COMMITMENT is no longer read'],
  ['an acceptance commitment that is not "required"', { ACCEPTANCE_COMMITMENT: 'yes' }, 'ACCEPTANCE_COMMITMENT must be "required" or unset'],
  ['registration without its policy', { REGISTRATION: 'open' }, 'REGISTRATION'],
]

describe('a setting refused after the database connection is open', () => {
  it('finds the built package', () => {
    expect(existsSync(join(dist, 'cli.js')), 'packages/dpp-overlay/dist is missing: run npm run build before the tests').toBe(true)
  })

  it.each(REFUSALS)('with %s, the dpp-index command says why and exits with code 1', async (_what, settings, message) => {
    const ended = await start('cli.js', settings)
    expect(ended.timedOut, `the command was still running after 20 s:\n${ended.output}`).toBe(false)
    expect(ended.code).toBe(1)
    expect(ended.output).toContain(message)
  }, 40_000)

  it.each(REFUSALS)('with %s, the entry point the image runs says the same and exits with code 1', async (_what, settings, message) => {
    const ended = await start('index.js', settings)
    expect(ended.timedOut, `the entry point was still running after 20 s:\n${ended.output}`).toBe(false)
    expect(ended.code).toBe(1)
    expect(ended.output).toContain(message)
  }, 40_000)

  it('with nothing refused, the command starts over the same database and stops when told to', async () => {
    const child = spawn(process.execPath, [join(dist, 'cli.js')], {
      env: { PATH: process.env.PATH ?? '', SERVICE_IDENTITY_KEY: SERVER_ID, NETWORK: 'test', CHAIN_TRACKER: 'scripts-only', HOST: '127.0.0.1', PORT: '0', MONGO_URL: mongod!.getUri(), MONGO_DB: 'boot-refusal' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const listening = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the command did not start:\n${output}`)), 20_000)
      const read = (chunk: Buffer): void => { output += chunk.toString('utf8'); if (output.includes('dpp overlay listening')) { clearTimeout(timer); resolve() } }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
    })
    await listening
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    child.kill('SIGTERM')
    expect(await exited).toBe(0)
  }, 40_000)
})
