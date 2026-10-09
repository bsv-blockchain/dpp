#!/usr/bin/env node
// Operator commands against the running configuration, with no HTTP:
//
//   node apps/api/dist/cli.js wallet                 identity key, a funding address, balance
//   node apps/api/dist/cli.js wallet fund <txid> <address> <prefix> <suffix>
//                                                    take in a payment made to a funding address
//   node apps/api/dist/cli.js operations             what is still owed, and run the duties once
import { loadConfig } from './config.js'
import { openPlatform } from './platform.js'
import { pendingDuties, runDuties } from './worker.js'
import { ANYONE_IDENTITY_KEY } from './wallet.js'

const [command, ...rest] = process.argv.slice(2)
const config = loadConfig()
const platform = await openPlatform({ config, mode: 'live', log: () => {} })

try {
  if (command === 'wallet' && rest[0] === 'fund') {
    const [txid, address, derivationPrefix, derivationSuffix] = rest.slice(1)
    if (txid == null || address == null || derivationPrefix == null || derivationSuffix == null) throw new Error('usage: wallet fund <txid> <address> <prefix> <suffix>')
    const taken = await platform.wallet.internalize({ address, derivationPrefix, derivationSuffix, senderIdentityKey: ANYONE_IDENTITY_KEY }, txid)
    console.log(`Took in ${taken.satoshis} satoshis from ${txid}. Balance: ${await platform.wallet.balance()} satoshis.`)
  } else if (command === 'wallet') {
    const funding = await platform.wallet.fundingAddress()
    console.log(`Wallet: ${platform.wallet.kind} on ${platform.wallet.network}`)
    console.log(`Identity key (the publisher key your index must admit): ${platform.wallet.identityKey}`)
    console.log(`Balance: ${await platform.wallet.balance()} satoshis`)
    console.log(`Funding address: ${funding.address}`)
    console.log(`After paying it, take the payment in with: wallet fund <txid> ${funding.address} ${funding.derivationPrefix} ${funding.derivationSuffix}`)
  } else if (command === 'operations') {
    const duties = await pendingDuties(platform.store)
    console.log(duties.length === 0 ? 'Nothing is owed.' : `${duties.length} dut${duties.length === 1 ? 'y' : 'ies'} pending:`)
    for (const d of duties) console.log(`  ${d.op} ${d.txid.slice(0, 12)}... ${d.duty} (${d.passportId})`)
    for (const line of await runDuties({ store: platform.store, index: platform.index, writer: platform.writer })) console.log(`  ${line}`)
  } else {
    console.error('usage: cli.js wallet | wallet fund <txid> <address> <prefix> <suffix> | operations')
    process.exitCode = 2
  }
} finally {
  await platform.close()
}
