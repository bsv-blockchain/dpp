#!/usr/bin/env node
// Operator commands against the running configuration, with no HTTP:
//
//   node apps/api/dist/cli.js wallet                 publisher key, a funding address, balance
//   node apps/api/dist/cli.js wallet fund <txid> <address> <prefix> <suffix>
//                                                    take in a payment made to a funding address
//   node apps/api/dist/cli.js operations             what is still owed, and run the duties once
//   node apps/api/dist/cli.js go-live                register with the index, check everything a real write needs, go live
//   node apps/api/dist/cli.js connect-index --url <index> [--submit-token <t>] [--callback-token <t>]
//   node apps/api/dist/cli.js add-index [directory]  create an index project beside this app and connect to it
import './env.js'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { goLive } from './go-live.js'
import { addIndex, connectIndex } from './index-projects.js'
import { openPlatform } from './platform.js'
import { pendingDuties, runDuties } from './worker.js'
import { ANYONE_IDENTITY_KEY } from './wallet.js'

const [command, ...rest] = process.argv.slice(2)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const envFile = join(projectRoot, '.env')
const manifest = ((): { name?: string; dpp?: { indexStarter?: string } } => {
  try {
    return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { name?: string; dpp?: { indexStarter?: string } }
  } catch {
    return {}
  }
})()
const projectName = manifest.name ?? basename(projectRoot)

if (command === 'go-live' || command === 'connect-index' || command === 'add-index') {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { url: { type: 'string' }, 'submit-token': { type: 'string' }, 'callback-token': { type: 'string' } } })
  const shared = { env: process.env, envFile, projectName, out: (line: string) => console.log(line) }
  const result =
    command === 'go-live'
      ? await goLive(shared)
      : command === 'connect-index'
        ? await connectIndex({ ...shared, url: values.url ?? '', submitToken: values['submit-token'], callbackToken: values['callback-token'] })
        : await addIndex({ ...shared, directory: positionals[0] ?? `${basename(projectRoot)}-index`, parentDirectory: dirname(projectRoot), existsSync, indexStarterVersion: manifest.dpp?.indexStarter })
  if (!result.ok) process.exitCode = 1
} else {
  const config = loadConfig()
  const platform = await openPlatform({ config, mode: 'live', log: () => {} })
  try {
    await operatorCommand(platform, config)
  } finally {
    await platform.close()
  }
}

async function operatorCommand(platform: Awaited<ReturnType<typeof openPlatform>>, _config: ReturnType<typeof loadConfig>): Promise<void> {
  if (command === 'wallet' && rest[0] === 'fund') {
    const [txid, address, derivationPrefix, derivationSuffix] = rest.slice(1)
    if (txid == null || address == null || derivationPrefix == null || derivationSuffix == null) throw new Error('usage: wallet fund <txid> <address> <prefix> <suffix>')
    const taken = await platform.wallet.internalize({ address, derivationPrefix, derivationSuffix, senderIdentityKey: ANYONE_IDENTITY_KEY }, txid)
    console.log(`Took in ${taken.satoshis} satoshis from ${txid}. Balance: ${await platform.wallet.balance()} satoshis.`)
  } else if (command === 'wallet') {
    const funding = await platform.wallet.fundingAddress()
    console.log(`Publisher key (give this to your index; it is public): ${platform.wallet.identityKey}`)
    console.log(`Wallet: ${platform.wallet.kind} on ${platform.wallet.network}`)
    console.log(`Balance: ${await platform.wallet.balance()} satoshis`)
    console.log(`Funding address: ${funding.address}`)
    console.log(`After paying it, take the payment in with: wallet fund <txid> ${funding.address} ${funding.derivationPrefix} ${funding.derivationSuffix}`)
  } else if (command === 'operations') {
    const duties = await pendingDuties(platform.store)
    console.log(duties.length === 0 ? 'Nothing is owed.' : `${duties.length} dut${duties.length === 1 ? 'y' : 'ies'} pending:`)
    for (const d of duties) console.log(`  ${d.op} ${d.txid.slice(0, 12)}... ${d.duty} (${d.passportId})`)
    for (const line of await runDuties({ store: platform.store, index: platform.index, writer: platform.writer })) console.log(`  ${line}`)
  } else {
    console.error('usage: cli.js wallet | wallet fund <txid> <address> <prefix> <suffix> | operations | go-live | connect-index --url <index> [--submit-token <t>] [--callback-token <t>] | add-index [directory]')
    process.exitCode = 2
  }
}
