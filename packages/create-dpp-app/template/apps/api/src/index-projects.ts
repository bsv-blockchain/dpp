// npm run connect-index: the way to an index besides the default one. It
// takes a provider's address and, when the provider handed them out, its
// tokens; without tokens, go-live registers. --from reads the same settings
// from a connection file, the one an index operator writes with
// `dpp-index connection` (the DPP repository's operator preset), so the
// tokens never pass through the command line. Either way the connection is
// written to .env and the go-live checks run.
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { readEnvFile, updateEnvFile } from './env-file.js'
import { goLive, type GoLiveOptions, type GoLiveResult } from './go-live.js'

export interface ConnectIndexOptions extends GoLiveOptions {
  url?: string
  submitToken?: string
  callbackToken?: string
  /** A connection file holding NETWORK, INDEX_URL, INDEX_SUBMIT_TOKEN and INDEX_CALLBACK_TOKEN; a flag given beside it wins. */
  from?: string
}

const USAGE = 'run npm run connect-index -- --from <connection file>, or npm run connect-index -- --url <index> [--submit-token <t> --callback-token <t>]'

export async function connectIndex(options: ConnectIndexOptions): Promise<GoLiveResult> {
  const failure = (problem: string, fix: string): GoLiveResult => {
    options.out(`no  connect-index: ${problem}. Fix: ${fix}`)
    return { ok: false, passed: [], failures: [{ check: 'connect-index', problem, fix }] }
  }
  let file: Record<string, string> = {}
  if (options.from != null && options.from !== '') {
    if (!existsSync(options.from)) return failure(`${options.from} does not exist`, 'give the path of the connection file the index operator wrote with dpp-index connection')
    file = readEnvFile(options.from)
    let network: string
    try {
      network = loadConfig(options.env).network
    } catch (cause) {
      return failure(cause instanceof Error ? cause.message : String(cause), 'edit .env as the message says, then run npm run connect-index again')
    }
    const theirs = (file.NETWORK ?? '').trim()
    if (theirs !== '' && theirs !== network) {
      return failure(`${options.from} connects to a ${theirs} index and this app's NETWORK is ${network}`, `ask the operator for a ${network} index, or set NETWORK=${theirs} in .env if this app belongs on ${theirs}`)
    }
  }
  const url = (options.url ?? file.INDEX_URL ?? '').trim().replace(/\/+$/, '')
  if (url === '') return failure(options.from == null ? 'no address given' : `${options.from} holds no INDEX_URL`, USAGE)
  const values: Record<string, string> = { INDEX_URL: url }
  const submitToken = options.submitToken ?? file.INDEX_SUBMIT_TOKEN
  const callbackToken = options.callbackToken ?? file.INDEX_CALLBACK_TOKEN
  if (submitToken != null && submitToken !== '') values.INDEX_SUBMIT_TOKEN = submitToken
  if (callbackToken != null && callbackToken !== '') values.INDEX_CALLBACK_TOKEN = callbackToken
  await updateEnvFile(options.envFile, values)
  options.out(`Wrote the connection to .env: ${url}${values.INDEX_SUBMIT_TOKEN == null ? ', no tokens yet (go-live registers for them)' : ' with its tokens'}.`)
  return await goLive({ ...options, env: { ...options.env, ...values } })
}
